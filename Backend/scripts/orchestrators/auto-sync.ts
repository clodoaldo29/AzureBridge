import { spawn } from 'child_process';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import 'dotenv/config';

type Step = {
    name: string;
    cmd: string;
    args: string[];
    env?: Record<string, string>;
};

type StepResult = {
    name: string;
    status: 'OK' | 'FAILED';
    durationSec: number;
    attempts: number;
    error?: string;
};

const prisma = new PrismaClient();
const backendDir = path.resolve(__dirname, '..', '..');

function nowIso(): string {
    return new Date().toISOString();
}

function runStep(step: Step): Promise<number> {
    return new Promise((resolve, reject) => {
        const startedAt = Date.now();
        console.log(`\n🚀 ${step.name}`);
        console.log(`🕒 started_at=${nowIso()}`);

        const child = spawn(step.cmd, step.args, {
            cwd: backendDir,
            stdio: 'inherit',
            env: { ...process.env, ...step.env }
        });

        child.on('exit', code => {
            const duration = Math.floor((Date.now() - startedAt) / 1000);
            if (code === 0) {
                console.log(`✅ ${step.name} (${duration}s)`);
                resolve(duration);
            } else {
                reject(new Error(`${step.name} exited with code ${code} after ${duration}s`));
            }
        });

        child.on('error', err => reject(err));
    });
}

async function runStepWithRetry(step: Step, maxAttempts: number): Promise<StepResult> {
    let attempt = 0;
    let lastErr: any;

    while (attempt < maxAttempts) {
        attempt += 1;
        try {
            if (attempt > 1) {
                const waitSec = Math.min(15, attempt * 3);
                console.log(`🔁 Retry ${step.name} | tentativa=${attempt}/${maxAttempts} | espera=${waitSec}s`);
                await new Promise(r => setTimeout(r, waitSec * 1000));
            }
            const durationSec = await runStep(step);
            return {
                name: step.name,
                status: 'OK',
                durationSec,
                attempts: attempt
            };
        } catch (err: any) {
            lastErr = err;
            console.error(`⚠️ ${step.name} falhou na tentativa ${attempt}/${maxAttempts}: ${err?.message || err}`);
        }
    }

    return {
        name: step.name,
        status: 'FAILED',
        durationSec: 0,
        attempts: maxAttempts,
        error: String(lastErr?.message || lastErr || 'unknown error')
    };
}

function nodeStep(name: string, scriptPath: string, env?: Record<string, string>): Step {
    const cmd = process.platform === 'win32' ? 'node.exe' : 'node';
    return { name, cmd, args: [scriptPath], env };
}

function tsxStep(name: string, scriptPath: string, env?: Record<string, string>): Step {
    const cmd = process.platform === 'win32' ? 'node.exe' : 'node';
    return { name, cmd, args: ['node_modules/tsx/dist/cli.mjs', scriptPath], env };
}

async function getProjectsNeedingInitialSync(): Promise<string[]> {
    const projects = await prisma.project.findMany({
        include: {
            _count: { select: { workItems: true, sprints: true } }
        }
    });

    return projects
        .filter(p => p._count.sprints > 0 && p._count.workItems === 0)
        .map(p => p.name);
}

async function main() {
    const rawMode = (process.env.AUTO_SYNC_MODE || process.argv[2] || 'daily').toLowerCase();
    const mode = rawMode === 'bootstrap' ? 'full' : rawMode;
    const runNewProjects = (process.env.AUTO_SYNC_NEW_PROJECTS || 'true').toLowerCase() === 'true';
    const runHierarchy = (process.env.AUTO_SYNC_HIERARCHY || 'false').toLowerCase() === 'true';
    const targetProjects = process.env.TARGET_PROJECTS || '';
    const maxAttempts = Math.max(1, Number(process.env.AUTO_SYNC_STEP_RETRIES || 3));
    const startedAt = Date.now();

    console.log('SYNC PIPELINE');
    console.log('='.repeat(72));
    console.log(`MODE: ${mode}`);
    console.log(`NEW_PROJECTS: ${runNewProjects ? 'enabled' : 'disabled'}`);
    console.log(`HIERARCHY: ${runHierarchy ? 'enabled' : 'disabled'}`);
    console.log(`STEP_RETRIES: ${maxAttempts}`);
    if (targetProjects) {
        console.log(`TARGET_PROJECTS: ${targetProjects}`);
    }

    const steps: Step[] = [];

    if (mode === 'hourly') {
        steps.push(tsxStep('SMART SYNC', 'scripts/sync/smart-sync.ts'));
        steps.push(tsxStep('RUN SNAPSHOT', 'scripts/run-snapshot.ts'));
        steps.push(tsxStep('REBUILD ACTIVE BURNDOWN (EVENT MODEL)', 'scripts/backfill/rebuild-active-burndown-event-model.ts'));
    } else if (mode === 'full') {
        steps.push(nodeStep('SYNC ALL PROJECTS', 'scripts/sync/sync-all-projects.js'));
        steps.push(nodeStep('SYNC ALL TEAM MEMBERS', 'scripts/sync/sync-all-team-members.js'));
        steps.push(nodeStep('FULL SYNC (ALL WORK ITEMS)', 'scripts/sync/complete-massive-sync.js'));
        steps.push(tsxStep('BACKFILL HISTORY (MISSING FIELDS)', 'scripts/backfill-project-history-batch.ts'));
        steps.push(tsxStep('BACKFILL CLOSED DATES', 'scripts/backfill/backfill-closed-dates.ts'));
        steps.push(nodeStep('SYNC CAPACITY', 'scripts/sync/sync-capacity.js'));
        steps.push(tsxStep('RUN SNAPSHOT', 'scripts/run-snapshot.ts'));
        steps.push(tsxStep('REBUILD SNAPSHOT COUNTS (ALL)', 'scripts/backfill/rebuild-snapshot-counts.ts', { REBUILD_MODE: 'all' }));
        steps.push(tsxStep('REBUILD ACTIVE BURNDOWN (EVENT MODEL)', 'scripts/backfill/rebuild-active-burndown-event-model.ts'));
        steps.push(tsxStep('VALIDATE SNAPSHOT COUNTS', 'scripts/maintenance/validate-snapshot-counts.ts'));
        if (runHierarchy) steps.push(nodeStep('SYNC HIERARCHY', 'scripts/sync/sync-hierarchy.js'));
    } else {
        steps.push(nodeStep('SYNC ALL PROJECTS', 'scripts/sync/sync-all-projects.js'));
        steps.push(nodeStep('SYNC ALL TEAM MEMBERS', 'scripts/sync/sync-all-team-members.js'));

        if (runNewProjects) {
            const newProjects = await getProjectsNeedingInitialSync();
            if (newProjects.length > 0) {
                console.log(`ℹ️ Novos projetos para bootstrap: ${newProjects.join(', ')}`);
                steps.push(nodeStep(
                    `FULL SYNC NEW PROJECTS (${newProjects.join(', ')})`,
                    'scripts/sync/sync-target-projects.js',
                    { TARGET_PROJECTS: newProjects.join(', '), RUN_SMART_SYNC: 'false' }
                ));
            } else {
                console.log('ℹ️ Nenhum projeto novo requerendo full sync.');
            }
        }

        steps.push(tsxStep('SMART SYNC', 'scripts/sync/smart-sync.ts'));
        steps.push(tsxStep('BACKFILL HISTORY (MISSING FIELDS)', 'scripts/backfill-project-history-batch.ts'));
        steps.push(tsxStep('BACKFILL CLOSED DATES', 'scripts/backfill/backfill-closed-dates.ts'));
        steps.push(nodeStep('SYNC CAPACITY', 'scripts/sync/sync-capacity.js'));
        steps.push(tsxStep('RUN SNAPSHOT', 'scripts/run-snapshot.ts'));
        steps.push(tsxStep('REBUILD ACTIVE BURNDOWN (EVENT MODEL)', 'scripts/backfill/rebuild-active-burndown-event-model.ts'));
        steps.push(tsxStep('VALIDATE SNAPSHOT COUNTS', 'scripts/maintenance/validate-snapshot-counts.ts'));
    }

    const results: StepResult[] = [];
    try {
        for (const step of steps) {
            const result = await runStepWithRetry(step, maxAttempts);
            results.push(result);
            if (result.status === 'FAILED') {
                throw new Error(`${result.name} failed after ${result.attempts} attempts: ${result.error}`);
            }
        }

        const duration = Math.floor((Date.now() - startedAt) / 1000);
        console.log('\n' + '='.repeat(72));
        console.log(`SYNC PIPELINE COMPLETED (${duration}s)`);
        console.log('='.repeat(72));
        console.log('📋 RESUMO');
        for (const r of results) {
            const icon = r.status === 'OK' ? '✅' : '❌';
            const dur = r.durationSec ? `${r.durationSec}s` : '-';
            console.log(`${icon} ${r.name} | attempts=${r.attempts} | duration=${dur}`);
        }
        const totalAttempts = results.reduce((acc, r) => acc + r.attempts, 0);
        console.log('-'.repeat(72));
        console.log(`steps=${results.length} | total_attempts=${totalAttempts} | finished_at=${nowIso()}`);
    } finally {
        await prisma.$disconnect();
    }
}

main().catch(async (err) => {
    console.error(`\n❌ SYNC PIPELINE FALHOU: ${err.message || err}`);
    await prisma.$disconnect();
    process.exit(1);
});
