import { z } from 'zod';

export const MonthPeriodSchema = z.object({
    month: z.number().int().min(1).max(12),
    year: z.number().int().min(2000).max(2100),
});

export const MonthlyPreparationRequestSchema = z.object({
    projectId: z.string().min(1),
    period: MonthPeriodSchema,
    includeWiki: z.boolean().default(true),
    includeOperationalSync: z.boolean().default(true),
    syncMode: z.enum(['none', 'incremental', 'full']).default('incremental'),
    forceReprocessChunks: z.boolean().default(false),
    forceReprocess: z.boolean().default(false),
    refreshProjectContext: z.boolean().default(true),
});

export const MonthlyStatusStepSchema = z.enum(['pending', 'collecting', 'done', 'error']);

export const PeriodKeySchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

export const MonthlyPreparationStatusSchema = z.object({
    snapshotId: z.string().min(1),
    projectId: z.string().min(1),
    period: PeriodKeySchema,
    status: z.enum(['collecting', 'ready', 'failed']),
    step: z.string().min(1),
    progress: z.number().int().min(0).max(100),
    updatedAt: z.string().datetime(),
    workItemsStatus: MonthlyStatusStepSchema,
    sprintsStatus: MonthlyStatusStepSchema,
    wikiStatus: MonthlyStatusStepSchema,
    documentsStatus: MonthlyStatusStepSchema,
    contextStatus: MonthlyStatusStepSchema,
    counters: z.object({
        workItemsTotal: z.number().int().min(0),
        workItemsNew: z.number().int().min(0),
        workItemsClosed: z.number().int().min(0),
        workItemsActive: z.number().int().min(0),
        sprintsCount: z.number().int().min(0),
        wikiPagesUpdated: z.number().int().min(0),
        documentsUploaded: z.number().int().min(0),
        chunksCreated: z.number().int().min(0),
    }),
    errors: z.array(
        z.object({
            source: z.string().min(1),
            message: z.string().min(1),
            timestamp: z.string().datetime(),
        }),
    ),
});

export const MonthlyStatusParamsSchema = z.object({
    projectId: z.string().min(1),
    period: PeriodKeySchema,
});

export const MonthlyProjectParamsSchema = z.object({
    projectId: z.string().min(1),
});

export const MonthlyWorkItemsFilterSchema = z.object({
    type: z.string().optional(),
    state: z.string().optional(),
    assignedTo: z.string().optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(50),
});

export type MonthPeriod = z.infer<typeof MonthPeriodSchema>;
export type MonthlyPreparationRequest = z.infer<typeof MonthlyPreparationRequestSchema>;
export type MonthlyPreparationStatus = z.infer<typeof MonthlyPreparationStatusSchema>;
