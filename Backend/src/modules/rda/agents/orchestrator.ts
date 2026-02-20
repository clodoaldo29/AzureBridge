import { Prisma } from '@prisma/client';
import { prisma } from '@/database/client';
import { ExtractorAgent } from '@/modules/rda/agents/extractor.agent';
import { NormalizerAgent } from '@/modules/rda/agents/normalizer.agent';
import { ValidatorAgent } from '@/modules/rda/agents/validator.agent';
import { FormatterAgent } from '@/modules/rda/agents/formatter.agent';
import { rdaDocxGeneratorService } from '@/modules/rda/services/docx-generator.service';
import { GenerationContextSchema, type GenerationContext } from '@/modules/rda/schemas/preflight.schema';
import type { GenerationMetadata } from '@/modules/rda/schemas/generation.schema';

interface StoredPartialResults {
    context?: unknown;
    extraction?: unknown;
    normalization?: unknown;
    validationReport?: unknown;
    placeholderMap?: unknown;
}

export class GenerationOrchestrator {
    private extractorAgent = new ExtractorAgent();
    private normalizerAgent = new NormalizerAgent();
    private validatorAgent = new ValidatorAgent();
    private formatterAgent = new FormatterAgent();

    async run(generationId: string): Promise<void> {
        const startedAt = Date.now();
        const generation = await prisma.rDAGeneration.findUnique({
            where: { id: generationId },
            include: { template: true },
        });

        if (!generation) {
            throw new Error(`Geracao nao encontrada: ${generationId}`);
        }

        if (generation.status === 'cancelled') {
            return;
        }

        const partial = (generation.partialResults as StoredPartialResults | null) ?? {};
        const rawContext = partial.context ?? (generation.partialResults as unknown);
        const context = GenerationContextSchema.parse(rawContext) as GenerationContext;

        await prisma.rDAGeneration.update({
            where: { id: generationId },
            data: { status: 'processing', progress: 5, currentStep: 'pipeline_start', errorMessage: null },
        });

        const extractionStart = Date.now();
        const extraction = await this.extractorAgent.run({ generationId, context });
        const extractionDuration = Date.now() - extractionStart;

        const normalizationStart = Date.now();
        const normalization = await this.normalizerAgent.run({
            generationId,
            extraction,
            fillingGuide: context.fillingGuide,
        });
        const normalizationDuration = Date.now() - normalizationStart;

        const validationStart = Date.now();
        const validation = await this.validatorAgent.run({
            generationId,
            normalization,
            placeholders: context.placeholders,
        });
        const validationDuration = Date.now() - validationStart;

        if (!validation.approved) {
            await prisma.rDAGeneration.update({
                where: { id: generationId },
                data: {
                    status: 'failed',
                    progress: 100,
                    currentStep: 'validation_failed',
                    errorMessage: 'Validacao bloqueou a geracao. Revise os campos pendentes.',
                },
            });
            return;
        }

        const formatterStart = Date.now();
        const placeholderMap = await this.formatterAgent.run({ generationId, normalization });
        const formatterDuration = Date.now() - formatterStart;

        await prisma.rDAGeneration.update({
            where: { id: generationId },
            data: { progress: 92, currentStep: 'docx_rendering' },
        });

        const docxStart = Date.now();
        const generated = await rdaDocxGeneratorService.generate(context.templatePath, placeholderMap, generationId);
        const docxDuration = Date.now() - docxStart;

        const metadata: GenerationMetadata = {
            modelVersion: process.env.CLAUDE_MODEL?.trim() || 'claude-sonnet-4-5-20250929',
            schemaVersion: '3.0.0',
            templateId: generation.templateId,
            tokensUsed: {
                extractor: extraction.totalTokens,
                normalizer: normalization.totalTokens,
                validator: { input: 0, output: 0 },
                total: extraction.totalTokens.input + extraction.totalTokens.output + normalization.totalTokens.input + normalization.totalTokens.output,
            },
            chunksUsed: [],
            validationReport: validation,
            duration: {
                total: Date.now() - startedAt,
                perStep: {
                    extractor: extractionDuration,
                    normalizer: normalizationDuration,
                    validator: validationDuration,
                    formatter: formatterDuration,
                    docxRender: docxDuration,
                },
            },
            retryCount: 0,
            generatedAt: new Date().toISOString(),
        };

        const currentPartial = (generation.partialResults as Record<string, unknown> | null) ?? {};
        await prisma.rDAGeneration.update({
            where: { id: generationId },
            data: {
                status: 'completed',
                progress: 100,
                currentStep: 'completed',
                outputFilePath: generated.filePath,
                fileSize: generated.sizeBytes,
                tokensUsed: metadata.tokensUsed.total,
                validationReport: validation as unknown as Prisma.InputJsonValue,
                metadata: metadata as unknown as Prisma.InputJsonValue,
                period: {
                    month: generation.periodStart.getUTCMonth() + 1,
                    year: generation.periodStart.getUTCFullYear(),
                } as unknown as Prisma.InputJsonValue,
                schemaVersion: metadata.schemaVersion,
                partialResults: {
                    ...currentPartial,
                    extraction,
                    normalization,
                    validationReport: validation,
                    placeholderMap,
                    metadata,
                } as Prisma.InputJsonValue,
            },
        });
    }

    async fail(generationId: string, error: unknown): Promise<void> {
        await prisma.rDAGeneration.update({
            where: { id: generationId },
            data: {
                status: 'failed',
                progress: 100,
                currentStep: 'failed',
                errorMessage: error instanceof Error ? error.message : String(error),
            },
        });
    }
}

export const generationOrchestrator = new GenerationOrchestrator();
