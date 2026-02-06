import { prisma } from '@/database/client';
import { logger } from '@/utils/logger';

export class SnapshotService {
    /**
     * Capture daily snapshot for all active sprints
     */
    async captureDailySnapshots(): Promise<void> {
        try {
            logger.info('📸 Starting Daily Snapshot capture...');

            // 1. Find all active sprints
            const activeSprints = await prisma.sprint.findMany({
                where: {
                    state: 'active'
                },
                include: {
                    project: true
                }
            });

            if (activeSprints.length === 0) {
                logger.info('No active sprints found for snapshot.');
                return;
            }

            logger.info(`Found ${activeSprints.length} active sprints.`);

            // 2. Process each sprint
            for (const sprint of activeSprints) {
                await this.createSprintSnapshot(sprint.id);
            }

            logger.info('✅ Daily Snapshot capture completed.');
        } catch (error) {
            logger.error('Failed to capture daily snapshots', error);
            throw error;
        }
    }

    /**
     * Create a snapshot for a specific sprint
     */
    async createSprintSnapshot(sprintId: string): Promise<void> {
        try {
            const today = new Date();
            today.setHours(0, 0, 0, 0); // Normalize to start of day

            // Check if snapshot already exists for today
            const existing = await prisma.sprintSnapshot.findUnique({
                where: {
                    sprintId_snapshotDate: {
                        sprintId,
                        snapshotDate: today
                    }
                }
            });

            if (existing) {
                logger.info(`Snapshot for sprint ${sprintId} on ${today.toISOString()} already exists.`);
                return;
            }

            // Get work items metrics
            const workItems = await prisma.workItem.findMany({
                where: {
                    sprintId,
                    isRemoved: false // Exclude removed items
                },
                select: {
                    state: true,
                    remainingWork: true,
                    completedWork: true,
                    storyPoints: true,
                    type: true
                }
            });

            // Calculate Metrics
            let remainingWork = 0;
            let completedWork = 0;
            let totalWork = 0;
            let remainingPoints = 0;
            let completedPoints = 0;
            let totalPoints = 0;

            let todoCount = 0;
            let inProgressCount = 0;
            let doneCount = 0;
            let blockedCount = 0;
            // Note: blocked status not directly in state string usually, but for now we aggregate by state

            for (const item of workItems) {
                // Sum Hours
                remainingWork += item.remainingWork || 0;
                completedWork += item.completedWork || 0;

                // Sum Points (usually only PBI/Bug)
                const points = item.storyPoints || 0;
                totalPoints += points;

                // Simple State Mapping (Adjust as needed based on your process)
                const state = item.state.toLowerCase();

                if (state === 'done' || state === 'closed' || state === 'completed') {
                    completedPoints += points;
                    doneCount++;
                } else if (state === 'in progress' || state === 'committed' || state === 'active') {
                    remainingPoints += points;
                    inProgressCount++;
                } else {
                    // New, To Do, Approved
                    remainingPoints += points;
                    todoCount++;
                }
            }

            totalWork = remainingWork + completedWork;

            // Save Snapshot
            await prisma.sprintSnapshot.create({
                data: {
                    sprintId,
                    snapshotDate: today,
                    remainingWork,
                    completedWork,
                    totalWork,
                    remainingPoints,
                    completedPoints,
                    totalPoints,
                    todoCount,
                    inProgressCount,
                    doneCount,
                    blockedCount
                }
            });

            logger.info(`📸 Snapshot created for sprint ${sprintId}: Rem=${remainingWork}h, Comp=${completedWork}h`);

        } catch (error) {
            logger.error(`Failed to create snapshot for sprint ${sprintId}`, error);
            // Don't throw to allow other sprints to proceed
        }
    }
}

export const snapshotService = new SnapshotService();
