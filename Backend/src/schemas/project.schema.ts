import { z } from 'zod';

export const projectParamsSchema = z.object({
    id: z.string()
});

export const projectSprintHistoryQuerySchema = z.object({
    limit: z.coerce.number().min(1).max(100).default(100),
});
