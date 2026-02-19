import { z } from 'zod';

// Para uso futuro se passarmos opcoes para o sync
export const syncBodySchema = z.object({
    force: z.boolean().optional()
});
