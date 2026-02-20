import { PrismaClient } from '@prisma/client';
import * as azdev from 'azure-devops-node-api';
import type { IWikiApi } from 'azure-devops-node-api/WikiApi';
import type { WikiPageDetail } from 'azure-devops-node-api/interfaces/WikiInterfaces';
import 'dotenv/config';

const prisma = new PrismaClient();

const DEFAULT_TARGETS = ['GIGA - Retrabalho', 'GIGA - Tempos e Movimentos'];

type SyncMode = 'incremental' | 'full';

interface SyncStats {
    mode: SyncMode;
    wikisFound: number;
    pagesFound: number;
    created: number;
    updated: number;
    unchanged: number;
    deleted: number;
    failed: number;
    durationSec: number;
}

interface ProjectSyncResult extends SyncStats {
    projectName: string;
    projectId?: string;
    status: 'completed' | 'failed' | 'skipped';
    error?: string;
}

function getRequiredEnv(name: string): string {
    const value = process.env[name];
    if (!value) {
        throw new Error(`Missing required env var: ${name}`);
    }
    return value;
}

function parseMode(): SyncMode {
    const mode = String(process.env.WIKI_SYNC_MODE || 'incremental').toLowerCase();
    return mode === 'full' ? 'full' : 'incremental';
}

function parseBool(name: string, defaultValue: boolean): boolean {
    const raw = process.env[name];
    if (raw == null) {
        return defaultValue;
    }
    return ['1', 'true', 'yes', 'on'].includes(raw.toLowerCase());
}

function parseIntEnv(name: string, defaultValue: number): number {
    const raw = Number.parseInt(String(process.env[name] || ''), 10);
    return Number.isFinite(raw) && raw > 0 ? raw : defaultValue;
}

function getTargetProjectNames(): string[] {
    const envTargets = process.env.TARGET_PROJECTS || process.env.WIKI_SYNC_PROJECTS;
    if (envTargets) {
        return envTargets
            .split(',')
            .map((name) => name.trim())
            .filter(Boolean);
    }

    return DEFAULT_TARGETS;
}

function extractTitle(wikiPath: string): string {
    const parts = wikiPath.split('/').filter(Boolean);
    const lastPart = parts[parts.length - 1] || wikiPath;
    return lastPart.replace(/-/g, ' ');
}

function extractParentPath(wikiPath: string): string | null {
    const parts = wikiPath.split('/').filter(Boolean);
    if (parts.length <= 1) {
        return null;
    }
    return `/${parts.slice(0, -1).join('/')}`;
}

function parseAzurePageId(id?: number): number | null {
    if (typeof id === 'number' && Number.isFinite(id)) {
        return id;
    }
    return null;
}

async function streamToString(stream: NodeJS.ReadableStream): Promise<string> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        stream.on('data', (chunk: Buffer) => chunks.push(chunk));
        stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
        stream.on('error', reject);
    });
}

async function getAllPagesBatch(
    wikiApi: IWikiApi,
    projectName: string,
    wikiIdentifier: string,
): Promise<WikiPageDetail[]> {
    const pages: WikiPageDetail[] = [];
    let continuationToken: string | undefined;

    do {
        const batch = await wikiApi.getPagesBatch(
            {
                top: 100,
                continuationToken,
                pageViewsForDays: 0,
            },
            projectName,
            wikiIdentifier,
        );

        if (Array.isArray(batch) && batch.length > 0) {
            pages.push(...batch);
        }

        continuationToken = batch.continuationToken;
    } while (continuationToken);

    return pages;
}

async function mapLimit<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
    const queue = [...items];
    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (queue.length > 0) {
            const item = queue.shift();
            if (!item) {
                return;
            }
            await worker(item);
        }
    });
    await Promise.all(workers);
}

async function fetchPageContent(
    wikiApi: IWikiApi,
    projectName: string,
    wikiIdentifier: string,
    path: string,
): Promise<string> {
    const stream = await wikiApi.getPageText(projectName, wikiIdentifier, path, undefined, undefined, true);
    return streamToString(stream);
}

async function syncProjectWiki(params: {
    projectName: string;
    wikiApi: IWikiApi;
    mode: SyncMode;
    removeMissing: boolean;
    contentConcurrency: number;
}): Promise<ProjectSyncResult> {
    const startedAt = Date.now();
    const { projectName, wikiApi, mode, removeMissing, contentConcurrency } = params;

    const stats: ProjectSyncResult = {
        projectName,
        status: 'completed',
        mode,
        wikisFound: 0,
        pagesFound: 0,
        created: 0,
        updated: 0,
        unchanged: 0,
        deleted: 0,
        failed: 0,
        durationSec: 0,
    };

    const dbProject = await prisma.project.findFirst({ where: { name: projectName } });
    if (!dbProject) {
        stats.status = 'skipped';
        stats.error = `Projeto nao encontrado na base local: ${projectName}`;
        stats.durationSec = Math.floor((Date.now() - startedAt) / 1000);
        return stats;
    }

    stats.projectId = dbProject.id;

    const syncType = mode === 'full' ? 'wiki_sync_full' : 'wiki_sync_incremental';
    const syncLog = await prisma.syncLog.create({
        data: {
            projectId: dbProject.id,
            syncType,
            status: 'running',
            startedAt: new Date(startedAt),
            metadata: { mode, removeMissing, contentConcurrency, projectName } as any,
        },
    });

    try {
        const wikis = await wikiApi.getAllWikis(projectName);
        stats.wikisFound = wikis?.length || 0;

        const remotePagesMap = new Map<string, { id: number | null; path: string; wikiId: string }>();

        for (const wiki of wikis || []) {
            if (!wiki.id) {
                continue;
            }

            const pages = await getAllPagesBatch(wikiApi, projectName, wiki.id);
            for (const page of pages) {
                if (!page.path) {
                    continue;
                }

                remotePagesMap.set(page.path, {
                    id: parseAzurePageId(page.id),
                    path: page.path,
                    wikiId: wiki.id,
                });
            }
        }

        const remotePages = Array.from(remotePagesMap.values());
        stats.pagesFound = remotePages.length;

        const existingPages = await prisma.wikiPage.findMany({
            where: { projectId: dbProject.id },
            select: {
                id: true,
                path: true,
                title: true,
                parentPath: true,
                azureId: true,
                content: true,
            },
        });

        const existingByPath = new Map(existingPages.map((page) => [page.path, page]));

        await mapLimit(remotePages, contentConcurrency, async (remotePage) => {
            try {
                const existing = existingByPath.get(remotePage.path);
                const title = extractTitle(remotePage.path);
                const parentPath = extractParentPath(remotePage.path);

                let content = '';
                try {
                    content = await fetchPageContent(wikiApi, projectName, remotePage.wikiId, remotePage.path);
                } catch {
                    content = existing ? existing.content : '';
                }

                if (!existing) {
                    await prisma.wikiPage.create({
                        data: {
                            projectId: dbProject.id,
                            azureId: remotePage.id,
                            path: remotePage.path,
                            title,
                            content,
                            parentPath,
                            order: 0,
                            lastSyncAt: new Date(),
                        },
                    });
                    stats.created += 1;
                    return;
                }

                const changed =
                    existing.azureId !== remotePage.id ||
                    existing.title !== title ||
                    existing.parentPath !== parentPath ||
                    existing.content !== content;

                if (!changed) {
                    stats.unchanged += 1;
                    return;
                }

                await prisma.wikiPage.update({
                    where: { id: existing.id },
                    data: {
                        azureId: remotePage.id,
                        title,
                        parentPath,
                        content,
                        lastSyncAt: new Date(),
                    },
                });
                stats.updated += 1;
            } catch (error) {
                stats.failed += 1;
                console.error(`[WIKI SYNC] Falha ao sincronizar pagina ${remotePage.path}:`, (error as Error).message);
            }
        });

        if (removeMissing) {
            const remotePaths = new Set(remotePages.map((page) => page.path));
            const toDelete = existingPages.filter((page) => !remotePaths.has(page.path));
            if (toDelete.length > 0) {
                const deleteResult = await prisma.wikiPage.deleteMany({
                    where: {
                        id: { in: toDelete.map((page) => page.id) },
                    },
                });
                stats.deleted = deleteResult.count;
            }
        }

        stats.durationSec = Math.floor((Date.now() - startedAt) / 1000);

        await prisma.syncLog.update({
            where: { id: syncLog.id },
            data: {
                status: 'completed',
                completedAt: new Date(),
                duration: stats.durationSec,
                itemsProcessed: stats.pagesFound,
                itemsCreated: stats.created,
                itemsUpdated: stats.updated,
                itemsFailed: stats.failed,
                metadata: stats as any,
            },
        });

        return stats;
    } catch (error) {
        stats.status = 'failed';
        stats.error = (error as Error).message;
        stats.durationSec = Math.floor((Date.now() - startedAt) / 1000);

        await prisma.syncLog.update({
            where: { id: syncLog.id },
            data: {
                status: 'failed',
                completedAt: new Date(),
                duration: stats.durationSec,
                itemsProcessed: stats.pagesFound,
                itemsCreated: stats.created,
                itemsUpdated: stats.updated,
                itemsFailed: stats.failed + 1,
                error: stats.error,
                metadata: stats as any,
            },
        });

        return stats;
    }
}

async function run(): Promise<void> {
    const mode = parseMode();
    const removeMissing = parseBool('WIKI_SYNC_REMOVE_MISSING', mode === 'full');
    const contentConcurrency = parseIntEnv('WIKI_SYNC_CONTENT_CONCURRENCY', 4);

    const orgUrl = getRequiredEnv('AZURE_DEVOPS_ORG_URL');
    const pat = getRequiredEnv('AZURE_DEVOPS_PAT');
    const targetProjects = getTargetProjectNames();

    const authHandler = azdev.getPersonalAccessTokenHandler(pat);
    const connection = new azdev.WebApi(orgUrl, authHandler);
    const wikiApi = await connection.getWikiApi();

    console.log(`[WIKI SYNC] mode=${mode} targets=${targetProjects.join(', ')}`);

    const results: ProjectSyncResult[] = [];

    for (const projectName of targetProjects) {
        console.log(`\n[WIKI SYNC] Projeto: ${projectName}`);
        const result = await syncProjectWiki({
            projectName,
            wikiApi,
            mode,
            removeMissing,
            contentConcurrency,
        });
        results.push(result);

        if (result.status === 'completed') {
            console.log('[WIKI SYNC] completed', {
                project: projectName,
                pagesFound: result.pagesFound,
                created: result.created,
                updated: result.updated,
                unchanged: result.unchanged,
                deleted: result.deleted,
                failed: result.failed,
                durationSec: result.durationSec,
            });
            continue;
        }

        if (result.status === 'skipped') {
            console.log('[WIKI SYNC] skipped', { project: projectName, reason: result.error });
            continue;
        }

        console.log('[WIKI SYNC] failed', { project: projectName, error: result.error });
    }

    const summary = {
        mode,
        projects: results.length,
        completed: results.filter((item) => item.status === 'completed').length,
        skipped: results.filter((item) => item.status === 'skipped').length,
        failed: results.filter((item) => item.status === 'failed').length,
        pagesFound: results.reduce((sum, item) => sum + item.pagesFound, 0),
        created: results.reduce((sum, item) => sum + item.created, 0),
        updated: results.reduce((sum, item) => sum + item.updated, 0),
        unchanged: results.reduce((sum, item) => sum + item.unchanged, 0),
        deleted: results.reduce((sum, item) => sum + item.deleted, 0),
        pageFailures: results.reduce((sum, item) => sum + item.failed, 0),
    };

    console.log('\n[WIKI SYNC] summary', summary);

    if (summary.failed > 0) {
        process.exitCode = 1;
    }
}

run()
    .catch((error) => {
        console.error('[WIKI SYNC] failed', error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
