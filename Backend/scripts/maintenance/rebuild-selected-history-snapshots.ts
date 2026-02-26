import { prisma } from '../../src/database/client';
import { snapshotService } from '../../src/services/snapshot.service';

const RETRY_DELAYS_MS = [5000, 15000, 30000];

type TargetSprint = {
    id: string;
    name: string;
    state: string;
    startDate: Date;
    endDate: Date;
    projectName: string;
};

function isTransientDbError(error: unknown): boolean {
    const msg = String((error as any)?.message || error || '');
    return (
        msg.includes('PrismaClientInitializationError') ||
        msg.includes("Can't reach database server") ||
        msg.includes('Connection terminated unexpectedly') ||
        msg.includes('Timed out fetching a new connection')
    );
}

async function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractAvNavNumber(name: string): number | null {
    const match = String(name || '').match(/AV-NAV\s+SP\s*0*(\d{1,2})/i);
    if (!match) return null;

    const parsed = Number(match[1]);
    return Number.isFinite(parsed) ? parsed : null;
}

async function getSnapshotCountBySprintId(sprintId: string): Promise<number> {
    return prisma.sprintSnapshot.count({ where: { sprintId } });
}

async function loadTargetSprints(): Promise<{
    targets: TargetSprint[];
    retrabalhoPastCount: number;
    temposPastCount: number;
}> {
    const projects = await prisma.project.findMany({
        where: { name: { in: ['GIGA - Retrabalho', 'GIGA - Tempos e Movimentos'] } },
        select: {
            name: true,
            sprints: {
                where: { state: { in: ['Past', 'past'] } },
                orderBy: { startDate: 'asc' },
                select: {
                    id: true,
                    name: true,
                    state: true,
                    startDate: true,
                    endDate: true,
                },
            },
        },
    });

    const retrabalho = projects.find((p) => p.name === 'GIGA - Retrabalho');
    const tempos = projects.find((p) => p.name === 'GIGA - Tempos e Movimentos');

    if (!retrabalho) throw new Error('Projeto nao encontrado: GIGA - Retrabalho');
    if (!tempos) throw new Error('Projeto nao encontrado: GIGA - Tempos e Movimentos');

    const retrabalhoTargets: TargetSprint[] = retrabalho.sprints.map((sprint) => ({
        ...sprint,
        projectName: retrabalho.name,
    }));

    const temposTargets: TargetSprint[] = tempos.sprints
        .filter((sprint) => {
            const n = extractAvNavNumber(sprint.name);
            return n !== null && n >= 1 && n <= 11;
        })
        .map((sprint) => ({
            ...sprint,
            projectName: tempos.name,
        }));

    return {
        targets: [...retrabalhoTargets, ...temposTargets],
        retrabalhoPastCount: retrabalho.sprints.length,
        temposPastCount: tempos.sprints.length,
    };
}

async function rebuildWithRetry(sprint: TargetSprint): Promise<void> {
    for (let attempt = 1; attempt <= RETRY_DELAYS_MS.length + 1; attempt++) {
        try {
            await snapshotService.rebuildSprintHistorySnapshots(sprint.id);
            return;
        } catch (error) {
            const retriable = isTransientDbError(error);
            const hasNextAttempt = attempt <= RETRY_DELAYS_MS.length;
            if (!retriable || !hasNextAttempt) throw error;

            const delay = RETRY_DELAYS_MS[attempt - 1];
            console.warn(
                `WARN: DB unavailable for ${sprint.projectName} / ${sprint.name} (attempt ${attempt}). Retrying in ${Math.floor(delay / 1000)}s...`
            );
            await sleep(delay);
        }
    }
}

async function main() {
    const { targets, retrabalhoPastCount, temposPastCount } = await loadTargetSprints();

    if (!targets.length) {
        console.log('No matching past sprints found for requested filters.');
        return;
    }

    console.log('REBUILD SELECTED HISTORY SNAPSHOTS');
    console.log('='.repeat(72));
    console.log(`Retrabalho past sprints found: ${retrabalhoPastCount}`);
    console.log(`Tempos e Movimentos past sprints found: ${temposPastCount}`);
    console.log(`Selected targets: ${targets.length}`);
    console.log('');

    let success = 0;
    const failures: Array<{ sprintId: string; project: string; sprint: string; error: string }> = [];

    for (const sprint of targets) {
        const beforeCount = await getSnapshotCountBySprintId(sprint.id);
        try {
            await rebuildWithRetry(sprint);
            const afterCount = await getSnapshotCountBySprintId(sprint.id);
            success++;
            console.log(
                `OK: ${sprint.projectName} / ${sprint.name} | snapshots ${beforeCount} -> ${afterCount}`
            );
        } catch (error) {
            const errMsg = String((error as any)?.message || error);
            failures.push({
                sprintId: sprint.id,
                project: sprint.projectName,
                sprint: sprint.name,
                error: errMsg,
            });
            console.error(`FAIL: ${sprint.projectName} / ${sprint.name} | ${errMsg}`);
        }
    }

    console.log('');
    console.log('-'.repeat(72));
    console.log(`Processed: ${targets.length}`);
    console.log(`Success: ${success}`);
    console.log(`Failures: ${failures.length}`);

    if (failures.length > 0) {
        console.log('Failure details:');
        for (const f of failures) {
            console.log(`- ${f.project} / ${f.sprint} (${f.sprintId}): ${f.error}`);
        }
        throw new Error(`Failed to rebuild ${failures.length} sprint(s).`);
    }
}

main()
    .catch((err) => {
        console.error(err);
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
