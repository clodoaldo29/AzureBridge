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

const prisma = new PrismaClient();
const backendDir = path.resolve(__dirname, '..', '..');

function runStep(step: Step): Promise<void> {
    return new Promise((resolve, reject) => {
        const startedAt = Date.now();
        console.log(`\n=== ${step.name} ===`);
        const child = spawn(step.cmd, step.args, {
            cwd: backendDir,
            stdio: 'inherit',
            env: { ...process.env, ...step.env }
        });
        child.on('exit', code => {
            const duration = Math.floor((Date.now() - startedAt) / 1000);
            if (code === 0) {
                console.log(`=== ${step.name} concluído (${duration}s) ===`);
                resolve();
            } else {
                reject(new Error(`${step.name} exited with code ${code} after ${duration}s`));
            }
        });
        child.on('error', err => reject(err));
    });
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
    const mode = (process.env.AUTO_SYNC_MODE || process.argv[2] || 'daily').toLowerCase();
    const runNewProjects = (process.env.AUTO_SYNC_NEW_PROJECTS || 'true').toLowerCase() === 'true';
    const runHierarchy = (process.env.AUTO_SYNC_HIERARCHY || 'false').toLowerCase() === 'true';
    const startedAt = Date.now();

    console.log('AUTO SYNC');
    console.log('='.repeat(60));
    console.log(`MODE: ${mode}`);
    console.log(`NEW PROJECTS: ${runNewProjects ? 'enabled' : 'disabled'}`);
    console.log(`HIERARCHY: ${runHierarchy ? 'enabled' : 'disabled'}`);

    const steps: Step[] = [];

    if (mode === 'hourly') {
        steps.push(tsxStep('SMART SYNC', 'scripts/sync/smart-sync.ts'));
        steps.push(tsxStep('RUN SNAPSHOT', 'scripts/run-snapshot.ts'));
    } else if (mode === 'bootstrap') {
        steps.push(nodeStep('SYNC ALL PROJECTS', 'scripts/sync/sync-all-projects.js'));
        steps.push(nodeStep('SYNC ALL TEAM MEMBERS', 'scripts/sync/sync-all-team-members.js'));
        steps.push(nodeStep('FULL SYNC (ALL WORK ITEMS)', 'scripts/sync/complete-massive-sync.js'));
        steps.push(tsxStep('BACKFILL HISTORY (MISSING FIELDS)', 'scripts/backfill-project-history-batch.ts'));
        steps.push(tsxStep('BACKFILL BURNDOWN (REBUILD)', 'scripts/backfill-burndown.ts', { BACKFILL_MODE: 'rebuild' }));
        steps.push(nodeStep('SYNC CAPACITY', 'scripts/sync/sync-capacity.js'));
        steps.push(tsxStep('RUN SNAPSHOT', 'scripts/run-snapshot.ts'));
        if (runHierarchy) steps.push(nodeStep('SYNC HIERARCHY', 'scripts/sync/sync-hierarchy.js'));
    } else {
        // daily (default)
        steps.push(nodeStep('SYNC ALL PROJECTS', 'scripts/sync/sync-all-projects.js'));
        steps.push(nodeStep('SYNC ALL TEAM MEMBERS', 'scripts/sync/sync-all-team-members.js'));

        if (runNewProjects) {
            const newProjects = await getProjectsNeedingInitialSync();
            if (newProjects.length > 0) {
                console.log(`New projects to bootstrap: ${newProjects.join(', ')}`);
                steps.push(nodeStep(
                    `FULL SYNC NEW PROJECTS (${newProjects.join(', ')})`,
                    'scripts/sync/sync-target-projects.js',
                    { TARGET_PROJECTS: newProjects.join(', '), RUN_SMART_SYNC: 'false' }
                ));
            } else {
                console.log('No new projects requiring full sync.');
            }
        }

        steps.push(tsxStep('SMART SYNC', 'scripts/sync/smart-sync.ts'));
        steps.push(tsxStep('BACKFILL HISTORY (MISSING FIELDS)', 'scripts/backfill-project-history-batch.ts'));
        steps.push(nodeStep('SYNC CAPACITY', 'scripts/sync/sync-capacity.js'));
        steps.push(tsxStep('RUN SNAPSHOT', 'scripts/run-snapshot.ts'));
        steps.push(tsxStep('BACKFILL BURNDOWN (NEW ONLY)', 'scripts/backfill-burndown.ts', { BACKFILL_MODE: 'new' }));
    }

    try {
        for (const step of steps) {
            await runStep(step);
        }
        const duration = Math.floor((Date.now() - startedAt) / 1000);
        console.log('='.repeat(60));
        console.log(`AUTO SYNC COMPLETED (${duration}s)`);
    } finally {
        await prisma.$disconnect();
    }
}

main().catch(async (err) => {
    console.error('\n❌ AUTO SYNC FAILED:', err.message || err);
    await prisma.$disconnect();
    process.exit(1);
});
