import { prisma } from '@/database/client';
import { getAzureDevOpsClient } from '@/integrations/azure/client';
import { logger } from '@/utils/logger';

interface WikiPageBatchItem {
    id?: number | string;
    path?: string;
}

export class WikiService {
    private static readonly WIKI_BATCH_SIZE = 100;

    /**
     * Sincroniza paginas Wiki do Azure DevOps para o banco local
     */
    async syncWikiPages(projectId: string) {
        const project = await prisma.project.findUnique({ where: { id: projectId } });
        if (!project) {
            throw new Error(`Projeto nao encontrado: ${projectId}`);
        }

        const client = getAzureDevOpsClient();
        const config = client.getConfig();
        const wikiApi = await client.getWikiApi();

        const wikis = await wikiApi.getAllWikis(config.project);
        if (!wikis || wikis.length === 0) {
            logger.warn(`Nenhuma wiki encontrada para o projeto ${config.project}`);
            return { synced: 0, total: 0 };
        }

        logger.info(`Encontradas ${wikis.length} wiki(s) no projeto ${config.project}`);

        let totalSynced = 0;
        let totalFound = 0;

        for (const wiki of wikis) {
            if (!wiki.id) {
                continue;
            }

            const wikiIdentifier = wiki.id;

            try {
                const pagesBatch = await this.getAllPagesBatch(wikiApi, config.project, wikiIdentifier);
                totalFound += pagesBatch.length;

                if (pagesBatch.length === 0) {
                    logger.info(`Wiki "${wiki.name}" sem paginas`);
                    continue;
                }

                logger.info(`Wiki "${wiki.name}": ${pagesBatch.length} pagina(s) encontradas`);

                for (const page of pagesBatch) {
                    if (!page.path) {
                        continue;
                    }

                    try {
                        const azurePageId = this.parseAzurePageId(page.id);
                        const content = await this.fetchPageContent(
                            wikiApi,
                            config.project,
                            wikiIdentifier,
                            page.path,
                        );

                        await prisma.wikiPage.upsert({
                            where: {
                                projectId_path: {
                                    projectId,
                                    path: page.path,
                                },
                            },
                            create: {
                                projectId,
                                azureId: azurePageId,
                                path: page.path,
                                title: this.extractTitle(page.path),
                                content,
                                parentPath: this.extractParentPath(page.path),
                                order: 0,
                                lastSyncAt: new Date(),
                            },
                            update: {
                                azureId: azurePageId,
                                title: this.extractTitle(page.path),
                                content,
                                parentPath: this.extractParentPath(page.path),
                                lastSyncAt: new Date(),
                            },
                        });

                        totalSynced += 1;
                    } catch (error) {
                        logger.warn(`Erro ao sincronizar pagina ${page.path}:`, error);
                    }
                }
            } catch (error) {
                logger.error(`Erro ao processar wiki "${wiki.name}":`, error);
            }
        }

        logger.info(`Wiki sync concluido: ${totalSynced} pagina(s) sincronizadas de ${totalFound} encontradas`);
        return { synced: totalSynced, total: totalFound };
    }

    /**
     * Lista paginas Wiki de um projeto
     */
    async getWikiPages(projectId: string) {
        return prisma.wikiPage.findMany({
            where: { projectId },
            orderBy: [{ path: 'asc' }, { order: 'asc' }],
            select: {
                id: true,
                azureId: true,
                path: true,
                title: true,
                content: true,
                parentPath: true,
                order: true,
                remoteUrl: true,
                lastSyncAt: true,
                createdAt: true,
                updatedAt: true,
            },
        });
    }

    /**
     * Busca full-text no conteudo das paginas Wiki
     */
    async searchWikiContent(projectId: string, query: string) {
        return prisma.wikiPage.findMany({
            where: {
                projectId,
                OR: [
                    { title: { contains: query, mode: 'insensitive' } },
                    { content: { contains: query, mode: 'insensitive' } },
                ],
            },
            orderBy: { path: 'asc' },
            select: {
                id: true,
                path: true,
                title: true,
                content: true,
                lastSyncAt: true,
            },
        });
    }

    /**
     * Busca uma pagina Wiki por ID (com conteudo completo)
     */
    async getWikiPageById(id: string) {
        return prisma.wikiPage.findUnique({ where: { id } });
    }

    private async getAllPagesBatch(
        wikiApi: any,
        projectName: string,
        wikiIdentifier: string,
    ): Promise<WikiPageBatchItem[]> {
        const allPages: WikiPageBatchItem[] = [];
        let continuationToken: string | undefined;

        do {
            const batch = await wikiApi.getPagesBatch(
                {
                    top: WikiService.WIKI_BATCH_SIZE,
                    continuationToken,
                    pageViewsForDays: 0,
                },
                projectName,
                wikiIdentifier,
            );

            if (Array.isArray(batch) && batch.length > 0) {
                allPages.push(...(batch as WikiPageBatchItem[]));
            }

            continuationToken = (batch as { continuationToken?: string })?.continuationToken;
        } while (continuationToken);

        return allPages;
    }

    private parseAzurePageId(id?: number | string): number | null {
        if (typeof id === 'number' && Number.isFinite(id)) {
            return id;
        }

        if (typeof id === 'string') {
            const parsed = Number.parseInt(id, 10);
            return Number.isFinite(parsed) ? parsed : null;
        }

        return null;
    }

    private async fetchPageContent(
        wikiApi: any,
        projectName: string,
        wikiIdentifier: string,
        path: string,
    ): Promise<string> {
        try {
            const stream = await wikiApi.getPageText(projectName, wikiIdentifier, path, undefined, undefined, true);
            return await this.streamToString(stream);
        } catch (error) {
            logger.warn(`Falha ao buscar conteudo da pagina ${path}:`, error);
            return '';
        }
    }

    private async streamToString(stream: NodeJS.ReadableStream): Promise<string> {
        return new Promise((resolve, reject) => {
            const chunks: Buffer[] = [];
            stream.on('data', (chunk: Buffer | string) =>
                chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)),
            );
            stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
            stream.on('error', reject);
        });
    }

    /**
     * Extrai titulo do path da Wiki (ultima parte do caminho)
     */
    private extractTitle(wikiPath: string): string {
        const parts = wikiPath.split('/').filter(Boolean);
        const lastPart = parts[parts.length - 1] || wikiPath;
        return lastPart.replace(/-/g, ' ');
    }

    /**
     * Extrai path pai de um path Wiki
     */
    private extractParentPath(wikiPath: string): string | null {
        const parts = wikiPath.split('/').filter(Boolean);
        if (parts.length <= 1) return null;
        return '/' + parts.slice(0, -1).join('/');
    }
}

export const wikiService = new WikiService();
