import { z } from 'zod';

export const projectParamsSchema = z.object({
    id: z.string()
});
