import { z } from 'zod';
import { MonthPeriodSchema } from '@/modules/rda/schemas/monthly.schema';
import { ProjectContextDataSchema } from '@/modules/rda/schemas/rag.schema';

export const PreflightCheckStatusSchema = z.enum(['pass', 'fail', 'warn', 'skip']);
export const PreflightCheckSeveritySchema = z.enum(['critical', 'warning', 'info']);

export const PlaceholderTypeSchema = z.enum(['simple', 'loop', 'nested_loop']);

export type PlaceholderInfo = {
    name: string;
    type: z.infer<typeof PlaceholderTypeSchema>;
    required: boolean;
    section: string;
    guideType?: string;
    description?: string;
    sourceHint?: string;
    rules?: string[];
    loopVariable?: string;
    childPlaceholders?: PlaceholderInfo[];
};

export const PlaceholderInfoSchema: z.ZodType<PlaceholderInfo> = z.lazy(() => z.object({
    name: z.string().min(1),
    type: PlaceholderTypeSchema,
    required: z.boolean(),
    section: z.string().min(1),
    guideType: z.string().optional(),
    description: z.string().optional(),
    sourceHint: z.string().optional(),
    rules: z.array(z.string()).optional(),
    loopVariable: z.string().optional(),
    childPlaceholders: z.array(PlaceholderInfoSchema).optional(),
}));

export const PreflightCheckSchema = z.object({
    name: z.string().min(1),
    key: z.string().min(1),
    status: PreflightCheckStatusSchema,
    severity: PreflightCheckSeveritySchema,
    message: z.string().min(1),
    details: z.record(z.string(), z.unknown()).optional(),
    action: z.string().optional(),
    duration: z.number().int().min(0).optional(),
});

export const GenerationContextSchema = z.object({
    projectId: z.string().min(1),
    periodKey: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
    generationId: z.string().min(1),
    templateId: z.string().min(1),
    templatePath: z.string().min(1),
    placeholders: z.array(PlaceholderInfoSchema),
    fillingGuide: z.string(),
    projectContext: ProjectContextDataSchema,
    monthlySnapshot: z.object({
        workItemsTotal: z.number().int().min(0),
        workItemsClosed: z.number().int().min(0),
        workItemsActive: z.number().int().min(0),
        sprintsCount: z.number().int().min(0),
        wikiPagesUpdated: z.number().int().min(0),
        chunksCreated: z.number().int().min(0),
    }),
    azureDevOps: z.object({
        organization: z.string().min(1),
        project: z.string().min(1),
        teamName: z.string().min(1),
    }),
    chunkStats: z.object({
        document: z.number().int().min(0),
        wiki: z.number().int().min(0),
        workitem: z.number().int().min(0),
        sprint: z.number().int().min(0),
        total: z.number().int().min(0),
    }),
});

export const PreflightCheckConfigSchema = z.object({
    minWorkItems: z.number().int().min(0).default(1),
    minSprints: z.number().int().min(0).default(0),
    maxContextAge: z.number().int().min(1).default(60),
    maxWikiAge: z.number().int().min(1).default(30),
    minChunksPerSource: z.number().int().min(0).default(0),
    requiredSourceTypes: z.array(z.enum(['document', 'wiki', 'workitem', 'sprint'])).default(['document', 'workitem']),
});

export const PreflightConfigSchema = z.object({
    projectId: z.string().min(1),
    period: MonthPeriodSchema,
    templateId: z.string().min(1).optional(),
    options: z.object({
        skipWikiCheck: z.boolean().default(false),
        allowPartialData: z.boolean().default(false),
        dryRun: z.boolean().default(false),
    }).default({}),
    checkConfig: PreflightCheckConfigSchema.partial().optional(),
});

export const PreflightResultSchema = z.object({
    projectId: z.string().min(1),
    period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
    status: z.enum(['approved', 'blocked', 'warning']),
    checks: z.array(PreflightCheckSchema),
    summary: z.object({
        total: z.number().int().min(0),
        passed: z.number().int().min(0),
        failed: z.number().int().min(0),
        warnings: z.number().int().min(0),
        skipped: z.number().int().min(0),
    }),
    blockers: z.array(z.string()),
    warnings: z.array(z.string()),
    generationReady: z.object({
        generationId: z.string().min(1),
        templateId: z.string().min(1),
        templatePath: z.string().min(1),
        periodKey: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
        context: GenerationContextSchema,
    }).optional(),
    duration: z.number().int().min(0),
});

export type PreflightConfig = z.infer<typeof PreflightConfigSchema>;
export type PreflightCheck = z.infer<typeof PreflightCheckSchema>;
export type PreflightResult = z.infer<typeof PreflightResultSchema>;
export type GenerationContext = z.infer<typeof GenerationContextSchema>;
export type PreflightCheckConfig = z.infer<typeof PreflightCheckConfigSchema>;
