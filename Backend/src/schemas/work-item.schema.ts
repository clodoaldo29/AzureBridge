import { z } from 'zod';

export const workItemQuerySchema = z.object({
    sprintId: z.string().optional(),
    projectId: z.string().optional(),
    type: z.string().optional(),
    state: z.string().optional(),
    assignedTo: z.string().optional(),
    limit: z.coerce.number().min(1).max(100).default(50),
    offset: z.coerce.number().default(0)
});

export const workItemParamsSchema = z.object({
    id: z.coerce.number()
});
