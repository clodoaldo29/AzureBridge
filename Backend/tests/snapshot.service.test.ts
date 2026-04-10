jest.mock('@/database/client', () => {
    const prisma = {
        sprint: {
            findUnique: jest.fn(),
        },
        workItemRevision: {
            findMany: jest.fn(),
        },
        workItem: {
            findMany: jest.fn(),
        },
        sprintSnapshot: {
            findMany: jest.fn(),
            findFirst: jest.fn(),
        },
        sprintItemOutcome: {
            findMany: jest.fn(),
        },
    };

    return { prisma };
});

import { snapshotService } from '@/services/snapshot.service';
import { prisma } from '@/database/client';

const prismaMock = prisma as unknown as {
    sprint: { findUnique: jest.Mock };
    workItemRevision: { findMany: jest.Mock };
    workItem: { findMany: jest.Mock };
    sprintSnapshot: { findMany: jest.Mock; findFirst: jest.Mock };
    sprintItemOutcome: { findMany: jest.Mock };
};

function baseSprint() {
    return {
        path: 'Projeto\\Sprint 1',
        projectId: 'proj-1',
        project: { name: 'Projeto' },
    };
}

describe('SnapshotService day mapping', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        prismaMock.sprint.findUnique.mockResolvedValue(baseSprint());
        prismaMock.sprintItemOutcome.findMany.mockResolvedValue([]);
    });

    it('uses the canonical snapshot UTC day when reconciling completed hours for a normal day', async () => {
        prismaMock.workItemRevision.findMany
            .mockResolvedValueOnce([
                {
                    workItemId: 101,
                    rev: 2,
                    revisedDate: new Date('2026-03-17T15:00:00Z'),
                    revisedBy: 'Gabriel Pinto',
                    workItem: {
                        id: 101,
                        title: 'Task 2h',
                        type: 'Task',
                        createdDate: new Date('2026-03-10T12:00:00Z'),
                        url: null,
                    },
                },
            ])
            .mockResolvedValueOnce([
                {
                    workItemId: 101,
                    rev: 1,
                    changes: {
                        'Microsoft.VSTS.Scheduling.RemainingWork': 2,
                        'System.State': 'Active',
                        'System.IterationPath': 'Projeto\\Sprint 1',
                    },
                },
                {
                    workItemId: 101,
                    rev: 2,
                    changes: {
                        'Microsoft.VSTS.Scheduling.RemainingWork': 0,
                        'System.State': 'Done',
                        'System.IterationPath': 'Projeto\\Sprint 1',
                    },
                },
            ]);

        prismaMock.workItem.findMany
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce([
                {
                    id: 202,
                    title: 'Task 27h',
                    type: 'Task',
                    state: 'Done',
                    changedDate: new Date('2026-03-17T16:00:00Z'),
                    url: null,
                    doneRemainingWork: 27,
                    lastRemainingWork: 27,
                    remainingWork: 0,
                    completedWork: 27,
                },
            ]);

        prismaMock.sprintSnapshot.findMany.mockResolvedValueOnce([
            { snapshotDate: new Date('2026-03-16T00:00:00Z'), completedWork: 6 },
            { snapshotDate: new Date('2026-03-17T00:00:00Z'), completedWork: 35 },
            { snapshotDate: new Date('2026-03-18T00:00:00Z'), completedWork: 37 },
        ]);
        prismaMock.sprintSnapshot.findFirst.mockResolvedValueOnce({
            snapshotDate: new Date('2026-03-20T00:00:00Z'),
        });

        const result = await snapshotService.getScopeChangesForDay('sprint-1', '2026-03-17');

        expect(result.completed.map((item) => item.hoursChange).sort((a, b) => a - b)).toEqual([2, 27]);
        expect(result.completed.reduce((sum, item) => sum + item.hoursChange, 0)).toBe(29);
        expect(prismaMock.workItem.findMany).toHaveBeenCalledTimes(2);
        expect(prismaMock.sprintItemOutcome.findMany).not.toHaveBeenCalled();
    });

    it('does not include post-sprint outcomes when the requested day is not the last sprint day', async () => {
        prismaMock.workItemRevision.findMany
            .mockResolvedValueOnce([
                {
                    workItemId: 301,
                    rev: 2,
                    revisedDate: new Date('2026-03-19T14:00:00Z'),
                    revisedBy: 'User A',
                    workItem: {
                        id: 301,
                        title: 'Task neutra',
                        type: 'Task',
                        createdDate: new Date('2026-03-10T12:00:00Z'),
                        url: null,
                    },
                },
            ])
            .mockResolvedValueOnce([
                {
                    workItemId: 301,
                    rev: 1,
                    changes: {
                        'Microsoft.VSTS.Scheduling.RemainingWork': 0,
                        'System.State': 'Active',
                        'System.IterationPath': 'Projeto\\Sprint 1',
                    },
                },
                {
                    workItemId: 301,
                    rev: 2,
                    changes: {
                        'Microsoft.VSTS.Scheduling.RemainingWork': 0,
                        'System.State': 'Active',
                        'System.IterationPath': 'Projeto\\Sprint 1',
                    },
                },
            ]);

        prismaMock.workItem.findMany.mockResolvedValueOnce([]);
        prismaMock.sprintSnapshot.findMany.mockResolvedValueOnce([]);
        prismaMock.sprintSnapshot.findFirst.mockResolvedValueOnce({
            snapshotDate: new Date('2026-03-20T00:00:00Z'),
        });

        const result = await snapshotService.getScopeChangesForDay('sprint-1', '2026-03-19');

        expect(result.added).toEqual([]);
        expect(result.removed).toEqual([]);
        expect(result.completed).toEqual([]);
        expect(prismaMock.sprintItemOutcome.findMany).not.toHaveBeenCalled();
    });

    it('includes post-sprint outcomes only on the last sprint day', async () => {
        prismaMock.workItemRevision.findMany
            .mockResolvedValueOnce([
                {
                    workItemId: 401,
                    rev: 2,
                    revisedDate: new Date('2026-03-20T14:00:00Z'),
                    revisedBy: 'User B',
                    workItem: {
                        id: 401,
                        title: 'Task final',
                        type: 'Task',
                        createdDate: new Date('2026-03-10T12:00:00Z'),
                        url: null,
                    },
                },
            ])
            .mockResolvedValueOnce([
                {
                    workItemId: 401,
                    rev: 1,
                    changes: {
                        'Microsoft.VSTS.Scheduling.RemainingWork': 0,
                        'System.State': 'Active',
                        'System.IterationPath': 'Projeto\\Sprint 1',
                    },
                },
                {
                    workItemId: 401,
                    rev: 2,
                    changes: {
                        'Microsoft.VSTS.Scheduling.RemainingWork': 0,
                        'System.State': 'Active',
                        'System.IterationPath': 'Projeto\\Sprint 1',
                    },
                },
            ]);

        prismaMock.workItem.findMany
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce([
                {
                    id: 777,
                    title: 'Item pós-sprint',
                    type: 'Task',
                    url: null,
                },
            ]);
        prismaMock.sprintSnapshot.findMany.mockResolvedValueOnce([
            { snapshotDate: new Date('2026-03-20T00:00:00Z'), completedWork: 0 },
        ]);
        prismaMock.sprintSnapshot.findFirst.mockResolvedValueOnce({
            snapshotDate: new Date('2026-03-20T00:00:00Z'),
        });
        prismaMock.sprintItemOutcome.findMany.mockResolvedValueOnce([
            {
                workItemId: 777,
                completedAfterSprintHours: 5,
                scopeAddedAfterSprintHours: 3,
                scopeRemovedAfterSprintHours: 2,
            },
        ]);

        const result = await snapshotService.getScopeChangesForDay('sprint-1', '2026-03-20');

        expect(result.completed).toEqual([
            expect.objectContaining({
                id: 777,
                hoursChange: 5,
                changedBy: 'Pós-sprint (consolidado em D10)',
                reason: 'completed',
            }),
        ]);
        expect(result.added).toEqual([
            expect.objectContaining({
                id: 777,
                hoursChange: 3,
                changedBy: 'Pós-sprint (consolidado em D10)',
                reason: 'hours_increased',
            }),
        ]);
        expect(result.removed).toEqual([
            expect.objectContaining({
                id: 777,
                hoursChange: 2,
                changedBy: 'Pós-sprint (consolidado em D10)',
                reason: 'hours_decreased',
            }),
        ]);
    });
});
