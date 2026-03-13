import { z } from 'zod';

const booleanQuerySchema = z.preprocess((value) => {
    if (value === undefined || value === null || value === '') return undefined;
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        if (normalized === 'true') return true;
        if (normalized === 'false') return false;
    }
    return value;
}, z.boolean().optional());

export const sprintQuerySchema = z.object({
    projectId: z.string().optional(),
    state: z.string().optional(),
    limit: z.coerce.number().min(1).max(100).default(20),
    includeDetails: booleanQuerySchema
});

export const sprintParamsSchema = z.object({
    id: z.string().uuid().or(z.string()) // Accepts UUID or string ID from Azure
});
