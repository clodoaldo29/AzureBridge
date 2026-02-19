import { Prisma } from '@prisma/client';
import { prisma } from '@/database/client';
import { logger } from '@/utils/logger';

export abstract class BaseAgent {
    protected readonly name: string;

    constructor(name: string) {
        this.name = name;
    }

    protected async updateProgress(generationId: string, progress: number, currentStep: string): Promise<void> {
        await prisma.rDAGeneration.update({
            where: { id: generationId },
            data: { progress, currentStep, status: 'processing' },
        });
    }

    protected async mergePartialResults(generationId: string, patch: Record<string, unknown>): Promise<void> {
        const current = await prisma.rDAGeneration.findUnique({
            where: { id: generationId },
            select: { partialResults: true },
        });

        const partialResults = (current?.partialResults as Record<string, unknown> | null) ?? {};
        await prisma.rDAGeneration.update({
            where: { id: generationId },
            data: {
                partialResults: {
                    ...partialResults,
                    ...patch,
                } as Prisma.InputJsonValue,
            },
        });
    }

    protected logInfo(message: string, data?: Record<string, unknown>): void {
        logger.info(`[${this.name}] ${message}`, data ?? {});
    }

    protected logWarn(message: string, data?: Record<string, unknown>): void {
        logger.warn(`[${this.name}] ${message}`, data ?? {});
    }
}
