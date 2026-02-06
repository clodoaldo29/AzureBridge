import { z } from 'zod';

// For future use if we pass options to sync
export const syncBodySchema = z.object({
    force: z.boolean().optional()
});
