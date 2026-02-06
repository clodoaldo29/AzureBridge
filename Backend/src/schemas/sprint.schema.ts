import { z } from 'zod';

export const sprintQuerySchema = z.object({
    projectId: z.string().optional(),
    state: z.string().optional(),
    limit: z.coerce.number().min(1).max(100).default(20)
});

export const sprintParamsSchema = z.object({
    id: z.string().uuid().or(z.string()) // Accepts UUID or string ID from Azure
});
