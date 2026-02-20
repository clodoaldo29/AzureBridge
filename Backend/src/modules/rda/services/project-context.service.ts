import { prisma } from '@/database/client';
import { openAITextService } from '@/services/rda/openai-text.service';
import {
    ProjectContextData,
    ProjectContextDataSchema,
    SearchResult,
} from '@/modules/rda/schemas/rag.schema';
import { EmbeddingService, embeddingService } from '@/modules/rda/services/embedding.service';

type ContextField = keyof ProjectContextData;

interface MappingInput {
    documentType: 'visao' | 'plano_trabalho' | 'delivery_plan' | 'requisitos' | 'regras_negocio' | 'prototipagem' | 'outro';
    fieldsToExtract?: ContextField[];
    searchQueries?: string[];
}

const DEFAULT_CONTEXT: ProjectContextData = {
    projectName: '',
    projectScope: '',
    objectives: [],
    teamMembers: [],
    technologies: [],
    keyMilestones: [],
    businessRules: [],
    deliveryPlan: [],
    stakeholders: [],
    summary: '',
};

const DEFAULT_MAPPINGS: Record<MappingInput['documentType'], { fields: ContextField[]; queries: string[] }> = {
    visao: {
        fields: ['projectName', 'projectScope', 'objectives', 'stakeholders'],
        queries: ['visao do projeto', 'escopo do projeto', 'objetivos do projeto'],
    },
    plano_trabalho: {
        fields: ['deliveryPlan', 'keyMilestones', 'teamMembers'],
        queries: ['plano de trabalho', 'fases do projeto', 'marcos'],
    },
    delivery_plan: {
        fields: ['deliveryPlan', 'keyMilestones'],
        queries: ['delivery plan', 'cronograma', 'entregaveis'],
    },
    requisitos: {
        fields: ['businessRules', 'objectives'],
        queries: ['requisitos funcionais', 'regras de negocio'],
    },
    regras_negocio: {
        fields: ['businessRules'],
        queries: ['regras de negocio', 'criterios'],
    },
    prototipagem: {
        fields: ['technologies', 'objectives'],
        queries: ['prototipo', 'design', 'figma'],
    },
    outro: {
        fields: ['projectScope', 'technologies'],
        queries: ['contexto do projeto', 'tecnologias utilizadas'],
    },
};

const DEFAULT_AUTO_MAPPINGS: MappingInput[] = [
    { documentType: 'visao' },
    { documentType: 'plano_trabalho' },
    { documentType: 'delivery_plan' },
    { documentType: 'requisitos' },
    { documentType: 'regras_negocio' },
    { documentType: 'prototipagem' },
    { documentType: 'outro' },
];

export class ProjectContextService {
    constructor(private readonly embedding: EmbeddingService) {}

    async buildProjectContext(
        projectId: string,
        mappings: MappingInput[] = [],
        onProgress?: (progress: { current: number; total: number; field?: string }) => void,
    ): Promise<ProjectContextData> {
        const project = await prisma.project.findUnique({ where: { id: projectId } });
        if (!project) {
            throw new Error(`Projeto nao encontrado: ${projectId}`);
        }

        const effectiveMappings = mappings.length > 0 ? mappings : DEFAULT_AUTO_MAPPINGS;
        const totalSteps = mappings.length > 0 ? effectiveMappings.length : 1;

        let currentData: Partial<ProjectContextData> = await this.getProjectContext(projectId) ?? {
            ...DEFAULT_CONTEXT,
            projectName: project.name,
        };

        if (mappings.length === 0) {
            const allFields: ContextField[] = [
                'projectName',
                'projectScope',
                'objectives',
                'teamMembers',
                'technologies',
                'keyMilestones',
                'businessRules',
                'deliveryPlan',
                'stakeholders',
            ];
            const queries = Array.from(
                new Set(DEFAULT_AUTO_MAPPINGS.flatMap((item) => DEFAULT_MAPPINGS[item.documentType].queries)),
            );

            onProgress?.({ current: 1, total: totalSteps, field: allFields.join(', ') });
            const chunks = await this.fetchRelevantChunks(projectId, queries, 14);
            if (chunks.length > 0) {
                const extracted = await this.extractFieldsFromChunks(chunks, allFields, currentData);
                currentData = this.mergeContextData(currentData, extracted);
            }
        } else {
            for (let index = 0; index < effectiveMappings.length; index++) {
                const mapping = effectiveMappings[index];
                const defaultRule = DEFAULT_MAPPINGS[mapping.documentType];
                const fieldsToExtract = mapping.fieldsToExtract && mapping.fieldsToExtract.length > 0
                    ? mapping.fieldsToExtract
                    : defaultRule.fields;
                const queries = mapping.searchQueries && mapping.searchQueries.length > 0
                    ? mapping.searchQueries
                    : defaultRule.queries;

                const fieldProgress = fieldsToExtract.join(', ');
                onProgress?.({ current: index + 1, total: totalSteps, field: fieldProgress });

                const chunks = await this.fetchRelevantChunks(projectId, queries, 12);
                if (chunks.length === 0) {
                    console.log('[ProjectContext] Nenhum chunk relevante encontrado', {
                        projectId,
                        documentType: mapping.documentType,
                    });
                    continue;
                }

                const extracted = await this.extractFieldsFromChunks(chunks, fieldsToExtract, currentData);
                currentData = this.mergeContextData(currentData, extracted);
            }
        }

        currentData = await this.enrichWithOperationalData(projectId, currentData);
        currentData = await this.enrichWithEvidencePack(projectId, currentData);
        currentData = await this.applyDeterministicFallback(projectId, currentData);

        const normalized: ProjectContextData = this.normalizeContextData({
            ...DEFAULT_CONTEXT,
            ...currentData,
            projectName: currentData.projectName || project.name,
            projectScope: currentData.projectScope || 'Escopo nao identificado automaticamente. Revisar manualmente.',
        });

        normalized.summary = await this.generateProjectSummary(normalized);

        await prisma.projectContext.upsert({
            where: { projectId },
            create: {
                projectId,
                projectName: normalized.projectName,
                projectScope: normalized.projectScope,
                objectives: normalized.objectives,
                teamMembers: normalized.teamMembers,
                technologies: normalized.technologies,
                keyMilestones: normalized.keyMilestones,
                businessRules: normalized.businessRules,
                deliveryPlan: normalized.deliveryPlan,
                stakeholders: normalized.stakeholders,
                summary: normalized.summary,
            },
            update: {
                projectName: normalized.projectName,
                projectScope: normalized.projectScope,
                objectives: normalized.objectives,
                teamMembers: normalized.teamMembers,
                technologies: normalized.technologies,
                keyMilestones: normalized.keyMilestones,
                businessRules: normalized.businessRules,
                deliveryPlan: normalized.deliveryPlan,
                stakeholders: normalized.stakeholders,
                summary: normalized.summary,
            },
        });

        console.log('[ProjectContext] buildProjectContext concluido', {
            projectId,
            mappings: effectiveMappings.length,
        });

        return normalized;
    }

    async getProjectContext(projectId: string): Promise<ProjectContextData | null> {
        const row = await prisma.projectContext.findUnique({ where: { projectId } });
        if (!row) {
            return null;
        }

        return this.normalizeContextData({
            projectName: row.projectName,
            projectScope: row.projectScope,
            objectives: this.safeArray<ProjectContextData['objectives'][number]>(row.objectives),
            teamMembers: this.safeArray<ProjectContextData['teamMembers'][number]>(row.teamMembers),
            technologies: this.safeArray<ProjectContextData['technologies'][number]>(row.technologies),
            keyMilestones: this.safeArray<ProjectContextData['keyMilestones'][number]>(row.keyMilestones),
            businessRules: this.safeArray<ProjectContextData['businessRules'][number]>(row.businessRules),
            deliveryPlan: this.safeArray<ProjectContextData['deliveryPlan'][number]>(row.deliveryPlan),
            stakeholders: this.safeArray<ProjectContextData['stakeholders'][number]>(row.stakeholders),
            summary: row.summary ?? '',
        });
    }

    async deleteProjectContext(projectId: string): Promise<void> {
        await prisma.projectContext.deleteMany({ where: { projectId } });
    }

    async updateProjectContext(projectId: string, patch: Partial<ProjectContextData>): Promise<ProjectContextData> {
        const project = await prisma.project.findUnique({ where: { id: projectId } });
        if (!project) {
            throw new Error(`Projeto nao encontrado: ${projectId}`);
        }

        const existing = await this.getProjectContext(projectId);
        const merged = this.mergeContextData(
            existing ?? {
                ...DEFAULT_CONTEXT,
                projectName: project.name,
            },
            patch,
        );

        const normalized = this.normalizeContextData({
            ...DEFAULT_CONTEXT,
            ...merged,
            projectName: merged.projectName || project.name,
            projectScope: merged.projectScope || 'Escopo nao identificado automaticamente. Revisar manualmente.',
        });

        await prisma.projectContext.upsert({
            where: { projectId },
            create: {
                projectId,
                projectName: normalized.projectName,
                projectScope: normalized.projectScope,
                objectives: normalized.objectives,
                teamMembers: normalized.teamMembers,
                technologies: normalized.technologies,
                keyMilestones: normalized.keyMilestones,
                businessRules: normalized.businessRules,
                deliveryPlan: normalized.deliveryPlan,
                stakeholders: normalized.stakeholders,
                summary: normalized.summary,
            },
            update: {
                projectName: normalized.projectName,
                projectScope: normalized.projectScope,
                objectives: normalized.objectives,
                teamMembers: normalized.teamMembers,
                technologies: normalized.technologies,
                keyMilestones: normalized.keyMilestones,
                businessRules: normalized.businessRules,
                deliveryPlan: normalized.deliveryPlan,
                stakeholders: normalized.stakeholders,
                summary: normalized.summary,
            },
        });

        return normalized;
    }

    private async fetchRelevantChunks(projectId: string, queries: string[], topK: number): Promise<SearchResult[]> {
        const resultMap = new Map<string, SearchResult>();

        for (const query of queries) {
            const results = await this.embedding.hybridSearch({
                projectId,
                query,
                topK,
                minScore: 0,
            });

            results.forEach((item) => {
                if (!resultMap.has(item.id)) {
                    resultMap.set(item.id, item);
                }
            });
        }

        if (resultMap.size < Math.max(8, Math.floor(topK / 2))) {
            const fallbackRows = await prisma.documentChunk.findMany({
                where: { projectId },
                orderBy: { updatedAt: 'desc' },
                take: topK * 3,
            });

            fallbackRows.forEach((row) => {
                if (!resultMap.has(row.id)) {
                    resultMap.set(row.id, {
                        id: row.id,
                        content: row.content,
                        metadata: this.safeMetadata(row.metadata),
                        sourceType: row.sourceType,
                        score: 0.01,
                        matchType: 'hybrid',
                    });
                }
            });
        }

        return Array.from(resultMap.values()).slice(0, 24);
    }

    private async extractFieldsFromChunks(
        chunks: SearchResult[],
        fieldsToExtract: ContextField[],
        existingContext?: Partial<ProjectContextData>,
    ): Promise<Partial<ProjectContextData>> {
        const prompt = this.buildExtractionPrompt(fieldsToExtract);
        const message = this.buildChunksMessage(chunks, existingContext);

        const { data } = await openAITextService.completeJSON<Partial<ProjectContextData>>(message, {
            systemPrompt: prompt,
            temperature: 0.1,
            maxTokens: 4000,
        });

        return this.validateContextData(data);
    }

    private async generateProjectSummary(context: ProjectContextData): Promise<string> {
        const systemPrompt = [
            'Voce e um analista senior de projetos de software.',
            'Gere um resumo executivo do contexto do projeto em portugues, objetivo e factual.',
            'Nao invente dados.',
        ].join(' ');

        const prompt = [
            'Com base no JSON abaixo, gere um resumo executivo entre 140 e 220 palavras.',
            'Destaque escopo, objetivos, equipe, tecnologias, marcos e plano de entrega.',
            '',
            JSON.stringify(context, null, 2),
        ].join('\n');

        const response = await openAITextService.complete(prompt, {
            systemPrompt,
            temperature: 0.3,
            maxTokens: 1000,
        });

        return response.text.trim();
    }

    private buildExtractionPrompt(fieldsToExtract: ContextField[]): string {
        return [
            'Voce e um extrator de dados de documentacao de projetos de software.',
            'Retorne EXCLUSIVAMENTE JSON valido, sem markdown, sem comentarios e sem texto extra.',
            'Extraia informacoes dos trechos fornecidos.',
            'Quando houver multiplos indicios coerentes, e permitido inferir com cautela.',
            'Se nao encontrar dado para um campo, use [] para listas ou "" para texto.',
            `Campos alvo: ${fieldsToExtract.join(', ')}`,
            'Schema base esperado:',
            JSON.stringify(ProjectContextDataSchema.pick(Object.fromEntries(fieldsToExtract.map((f) => [f, true])) as Record<ContextField, true>).partial().shape, null, 2),
        ].join('\n');
    }

    private buildChunksMessage(chunks: SearchResult[], existingContext?: Partial<ProjectContextData>): string {
        const compactChunks = chunks.slice(0, 20);
        const formattedChunks = compactChunks.map((chunk, index) => {
            const snippet = chunk.content.length > 900 ? `${chunk.content.slice(0, 900)}...` : chunk.content;
            return [
                `## CHUNK ${index + 1}`,
                `sourceType: ${chunk.sourceType}`,
                `score: ${chunk.score}`,
                `metadata: ${JSON.stringify(chunk.metadata)}`,
                `conteudo: ${snippet}`,
            ].join('\n');
        });

        return [
            'Contexto atual (use para merge e evitar perda de dados):',
            JSON.stringify(existingContext ?? {}, null, 2),
            '',
            'Trechos para extracao:',
            formattedChunks.join('\n\n'),
        ].join('\n');
    }

    private mergeContextData(
        existing: Partial<ProjectContextData>,
        incoming: Partial<ProjectContextData>,
    ): Partial<ProjectContextData> {
        const merged: Partial<ProjectContextData> = { ...existing };

        const mergeArray = <T extends Record<string, unknown>>(current: T[] = [], next: T[] = [], key: keyof T): T[] => {
            const map = new Map<string, T>();
            [...current, ...next].forEach((item) => {
                const id = String(item[key] ?? '').trim();
                if (!id) return;
                if (!map.has(id)) {
                    map.set(id, item);
                }
            });
            return Array.from(map.values());
        };

        merged.objectives = mergeArray(existing.objectives, incoming.objectives, 'description');
        merged.teamMembers = mergeArray(existing.teamMembers, incoming.teamMembers, 'name');
        merged.technologies = mergeArray(existing.technologies, incoming.technologies, 'name');
        merged.keyMilestones = mergeArray(existing.keyMilestones, incoming.keyMilestones, 'name');
        merged.businessRules = mergeArray(existing.businessRules, incoming.businessRules, 'id');
        merged.deliveryPlan = mergeArray(existing.deliveryPlan, incoming.deliveryPlan, 'phase');
        merged.stakeholders = mergeArray(existing.stakeholders, incoming.stakeholders, 'name');

        merged.projectName = incoming.projectName?.trim() || existing.projectName || '';
        merged.projectScope = incoming.projectScope?.trim() || existing.projectScope || '';
        merged.summary = incoming.summary?.trim() || existing.summary;

        return merged;
    }

    private validateContextData(data: unknown): Partial<ProjectContextData> {
        const normalized = this.coerceContextData(data);
        const result = ProjectContextDataSchema.partial().safeParse(normalized);
        if (!result.success) {
            console.log('[ProjectContext] validacao parcial falhou, mantendo campos validos conhecidos');
            return {};
        }

        return result.data;
    }

    private async enrichWithOperationalData(
        projectId: string,
        currentData: Partial<ProjectContextData>,
    ): Promise<Partial<ProjectContextData>> {
        const missingFields = this.getMissingFields(currentData);
        if (missingFields.length === 0) {
            return currentData;
        }

        const [workItems, sprints] = await Promise.all([
            prisma.workItem.findMany({
                where: { projectId },
                orderBy: { changedDate: 'desc' },
                take: 80,
                select: {
                    id: true,
                    type: true,
                    state: true,
                    title: true,
                    tags: true,
                    url: true,
                    iterationPath: true,
                    createdBy: true,
                    changedBy: true,
                    assignedTo: { select: { displayName: true, role: true } },
                },
            }),
            prisma.sprint.findMany({
                where: { projectId },
                orderBy: { startDate: 'desc' },
                take: 16,
                select: {
                    name: true,
                    path: true,
                    startDate: true,
                    endDate: true,
                    state: true,
                    timeFrame: true,
                    riskLevel: true,
                    isOnTrack: true,
                },
            }),
        ]);

        if (workItems.length === 0 && sprints.length === 0) {
            return currentData;
        }

        const compactOps = {
            workItems: workItems.map((item) => ({
                id: item.id,
                type: item.type,
                state: item.state,
                title: this.truncate(item.title, 140),
                tags: item.tags,
                url: item.url,
                iterationPath: item.iterationPath,
                assignedTo: item.assignedTo?.displayName ?? null,
                assignedRole: item.assignedTo?.role ?? null,
                createdBy: item.createdBy,
                changedBy: item.changedBy,
            })),
            sprints: sprints.map((sprint) => ({
                name: sprint.name,
                path: sprint.path,
                startDate: sprint.startDate.toISOString(),
                endDate: sprint.endDate.toISOString(),
                state: sprint.state,
                timeFrame: sprint.timeFrame,
                riskLevel: sprint.riskLevel,
                isOnTrack: sprint.isOnTrack,
            })),
        };

        const systemPrompt = [
            'Voce e um analista senior de projetos de software.',
            'Retorne EXCLUSIVAMENTE JSON valido.',
            'Complete somente os campos solicitados usando evidencias de work items e sprints.',
            'Nao invente nomes, tecnologias, marcos ou regras sem indicio.',
        ].join(' ');

        const prompt = [
            `Campos faltantes para completar: ${missingFields.join(', ')}`,
            'Contexto atual:',
            JSON.stringify(currentData, null, 2),
            '',
            'Dados operacionais (work items/sprints):',
            JSON.stringify(compactOps, null, 2),
            '',
            'Retorne apenas os campos faltantes em JSON.',
        ].join('\n');

        try {
            const { data } = await openAITextService.completeJSON<Partial<ProjectContextData>>(prompt, {
                systemPrompt,
                temperature: 0.1,
                maxTokens: 2000,
            });
            const validated = this.validateContextData(data);
            return this.mergeContextData(currentData, validated);
        } catch (error) {
            console.log('[ProjectContext] enrichWithOperationalData falhou', {
                projectId,
                error: error instanceof Error ? error.message : String(error),
            });
            return currentData;
        }
    }

    private async enrichWithEvidencePack(
        projectId: string,
        currentData: Partial<ProjectContextData>,
    ): Promise<Partial<ProjectContextData>> {
        const missingFields = this.getMissingFields(currentData);
        if (missingFields.length === 0) {
            return currentData;
        }

        const evidence = await this.buildProjectEvidencePack(projectId);
        const systemPrompt = [
            'Voce e um analista senior de projetos de software.',
            'Retorne EXCLUSIVAMENTE JSON valido.',
            'Use as evidencias consolidadas para completar os campos faltantes do contexto.',
            'Nao invente informacoes fora das evidencias.',
        ].join(' ');

        const prompt = [
            `Campos faltantes para completar: ${missingFields.join(', ')}`,
            'Contexto atual:',
            JSON.stringify(currentData, null, 2),
            '',
            'Evidence pack consolidado do projeto:',
            JSON.stringify(evidence, null, 2),
            '',
            'Retorne apenas JSON com os campos faltantes.',
        ].join('\n');

        try {
            const { data } = await openAITextService.completeJSON<Partial<ProjectContextData>>(prompt, {
                systemPrompt,
                temperature: 0.1,
                maxTokens: 1800,
            });
            const validated = this.validateContextData(data);
            return this.mergeContextData(currentData, validated);
        } catch (error) {
            console.log('[ProjectContext] enrichWithEvidencePack falhou', {
                projectId,
                error: error instanceof Error ? error.message : String(error),
            });
            return currentData;
        }
    }

    private async buildProjectEvidencePack(projectId: string): Promise<Record<string, unknown>> {
        const [project, docs, wikiPages, teamMembers, sprints, recentWorkItems] = await Promise.all([
            prisma.project.findUnique({
                where: { id: projectId },
                select: { id: true, name: true, description: true, state: true, visibility: true },
            }),
            prisma.document.findMany({
                where: { projectId },
                orderBy: { createdAt: 'asc' },
                select: { id: true, filename: true, mimeType: true, sizeBytes: true, createdAt: true },
            }),
            prisma.wikiPage.findMany({
                where: { projectId },
                orderBy: { updatedAt: 'desc' },
                select: { id: true, title: true, path: true, remoteUrl: true, updatedAt: true },
            }),
            prisma.teamMember.findMany({
                where: { projectId, isActive: true },
                orderBy: { displayName: 'asc' },
                select: { displayName: true, role: true, uniqueName: true },
            }),
            prisma.sprint.findMany({
                where: { projectId },
                orderBy: { startDate: 'asc' },
                select: { name: true, path: true, startDate: true, endDate: true, state: true, timeFrame: true, isOnTrack: true },
            }),
            prisma.workItem.findMany({
                where: { projectId },
                orderBy: { changedDate: 'desc' },
                take: 250,
                select: {
                    id: true,
                    type: true,
                    state: true,
                    title: true,
                    url: true,
                    iterationPath: true,
                    tags: true,
                    assignedTo: { select: { displayName: true, role: true } },
                },
            }),
        ]);

        const workItemTypeState = await prisma.$queryRaw<Array<{ type: string; state: string; total: bigint | number | string }>>`
            SELECT "type", "state", COUNT(*) AS total
            FROM "work_items"
            WHERE "projectId" = ${projectId}
            GROUP BY "type", "state"
            ORDER BY "type", "state"
        `;

        const workItemsByIteration = await prisma.$queryRaw<Array<{ iterationPath: string; total: bigint | number | string }>>`
            SELECT "iterationPath", COUNT(*) AS total
            FROM "work_items"
            WHERE "projectId" = ${projectId}
            GROUP BY "iterationPath"
            ORDER BY COUNT(*) DESC
            LIMIT 60
        `;

        return {
            project,
            counts: {
                documents: docs.length,
                wikiPages: wikiPages.length,
                teamMembers: teamMembers.length,
                sprints: sprints.length,
                recentWorkItems: recentWorkItems.length,
            },
            documents: docs.map((d) => ({
                filename: d.filename,
                mimeType: d.mimeType,
                sizeBytes: d.sizeBytes,
            })),
            wikiPages: wikiPages.slice(0, 300).map((w) => ({
                title: w.title,
                path: w.path,
                remoteUrl: w.remoteUrl,
            })),
            wikiPagesTruncated: Math.max(0, wikiPages.length - 300),
            teamMembers,
            sprints: sprints.map((s) => ({
                name: s.name,
                path: s.path,
                startDate: s.startDate.toISOString(),
                endDate: s.endDate.toISOString(),
                state: s.state,
                timeFrame: s.timeFrame,
                isOnTrack: s.isOnTrack,
            })),
            workItemTypeState: workItemTypeState.map((row) => ({
                type: row.type,
                state: row.state,
                total: Number(row.total ?? 0),
            })),
            workItemsByIteration: workItemsByIteration.map((row) => ({
                iterationPath: row.iterationPath,
                total: Number(row.total ?? 0),
            })),
            recentWorkItems: recentWorkItems.map((w) => ({
                id: w.id,
                type: w.type,
                state: w.state,
                title: this.truncate(w.title, 160),
                url: w.url,
                iterationPath: w.iterationPath,
                tags: w.tags,
                assignedTo: w.assignedTo?.displayName ?? null,
                assignedRole: w.assignedTo?.role ?? null,
            })),
        };
    }

    private async applyDeterministicFallback(
        projectId: string,
        currentData: Partial<ProjectContextData>,
    ): Promise<Partial<ProjectContextData>> {
        const [project, teamMembers, sprints] = await Promise.all([
            prisma.project.findUnique({ where: { id: projectId }, select: { name: true, description: true } }),
            prisma.teamMember.findMany({
                where: { projectId, isActive: true },
                orderBy: { displayName: 'asc' },
                select: { displayName: true, role: true },
            }),
            prisma.sprint.findMany({
                where: { projectId },
                orderBy: { startDate: 'asc' },
                select: { name: true, startDate: true, endDate: true, state: true },
            }),
        ]);

        const patched: Partial<ProjectContextData> = { ...currentData };

        if (!patched.projectName?.trim() && project?.name) {
            patched.projectName = project.name;
        }
        if (!patched.projectScope?.trim() && project?.description?.trim()) {
            patched.projectScope = project.description.trim();
        }
        if ((patched.teamMembers?.length ?? 0) === 0 && teamMembers.length > 0) {
            patched.teamMembers = teamMembers.map((m) => ({
                name: m.displayName,
                role: m.role ?? 'Membro do time',
                area: 'Projeto',
            }));
        }
        if ((patched.keyMilestones?.length ?? 0) === 0 && sprints.length > 0) {
            patched.keyMilestones = sprints.map((s) => ({
                name: s.name,
                date: s.endDate.toISOString().slice(0, 10),
                deliverable: `Sprint ${s.name}`,
                status: this.mapSprintStateToMilestoneStatus(s.state),
            }));
        }
        if ((patched.deliveryPlan?.length ?? 0) === 0 && sprints.length > 0) {
            patched.deliveryPlan = sprints.map((s) => ({
                phase: s.name,
                startDate: s.startDate.toISOString().slice(0, 10),
                endDate: s.endDate.toISOString().slice(0, 10),
                objectives: [`Execucao da sprint ${s.name}`],
                deliverables: [`Itens concluídos na sprint ${s.name}`],
            }));
        }

        return patched;
    }

    private mapSprintStateToMilestoneStatus(state: string): 'planejado' | 'em_andamento' | 'concluido' | 'atrasado' {
        const normalized = state.trim().toLowerCase();
        if (normalized === 'past' || normalized === 'done' || normalized === 'completed') {
            return 'concluido';
        }
        if (normalized === 'active' || normalized === 'current') {
            return 'em_andamento';
        }
        if (normalized === 'future' || normalized === 'planned') {
            return 'planejado';
        }
        return 'planejado';
    }

    private getMissingFields(data: Partial<ProjectContextData>): ContextField[] {
        const missing: ContextField[] = [];
        if (!data.projectScope?.trim()) missing.push('projectScope');
        if ((data.objectives?.length ?? 0) === 0) missing.push('objectives');
        if ((data.teamMembers?.length ?? 0) === 0) missing.push('teamMembers');
        if ((data.technologies?.length ?? 0) === 0) missing.push('technologies');
        if ((data.keyMilestones?.length ?? 0) === 0) missing.push('keyMilestones');
        if ((data.businessRules?.length ?? 0) === 0) missing.push('businessRules');
        if ((data.deliveryPlan?.length ?? 0) === 0) missing.push('deliveryPlan');
        if ((data.stakeholders?.length ?? 0) === 0) missing.push('stakeholders');
        return missing;
    }

    private safeMetadata(value: unknown): SearchResult['metadata'] {
        if (value && typeof value === 'object' && !Array.isArray(value)) {
            const raw = value as Record<string, unknown>;
            return {
                documentId: typeof raw.documentId === 'string' ? raw.documentId : undefined,
                wikiPageId: typeof raw.wikiPageId === 'string' ? raw.wikiPageId : undefined,
                documentName: typeof raw.documentName === 'string' ? raw.documentName : 'Fonte sem identificacao',
                pageNumber: typeof raw.pageNumber === 'number' ? raw.pageNumber : undefined,
                sectionHeading: typeof raw.sectionHeading === 'string' ? raw.sectionHeading : undefined,
                contentType: (typeof raw.contentType === 'string' ? raw.contentType : 'text') as SearchResult['metadata']['contentType'],
                position: typeof raw.position === 'number' ? raw.position : 0,
                sourceType: (typeof raw.sourceType === 'string' ? raw.sourceType : 'document') as SearchResult['metadata']['sourceType'],
            };
        }

        return {
            documentName: 'Fonte sem identificacao',
            contentType: 'text',
            position: 0,
            sourceType: 'document',
        };
    }

    private truncate(value: string, max: number): string {
        return value.length > max ? `${value.slice(0, max)}...` : value;
    }

    private normalizeContextData(data: Partial<ProjectContextData>): ProjectContextData {
        const coerced = this.coerceContextData(data);
        const parsed = ProjectContextDataSchema.safeParse({
            ...DEFAULT_CONTEXT,
            ...coerced,
        });

        if (parsed.success) {
            return parsed.data;
        }

        const shape = ProjectContextDataSchema.shape;
        const objectives = shape.objectives.safeParse((coerced as Partial<ProjectContextData>).objectives).success
            ? (coerced as Partial<ProjectContextData>).objectives ?? []
            : [];
        const teamMembers = shape.teamMembers.safeParse((coerced as Partial<ProjectContextData>).teamMembers).success
            ? (coerced as Partial<ProjectContextData>).teamMembers ?? []
            : [];
        const technologies = shape.technologies.safeParse((coerced as Partial<ProjectContextData>).technologies).success
            ? (coerced as Partial<ProjectContextData>).technologies ?? []
            : [];
        const keyMilestones = shape.keyMilestones.safeParse((coerced as Partial<ProjectContextData>).keyMilestones).success
            ? (coerced as Partial<ProjectContextData>).keyMilestones ?? []
            : [];
        const businessRules = shape.businessRules.safeParse((coerced as Partial<ProjectContextData>).businessRules).success
            ? (coerced as Partial<ProjectContextData>).businessRules ?? []
            : [];
        const deliveryPlan = shape.deliveryPlan.safeParse((coerced as Partial<ProjectContextData>).deliveryPlan).success
            ? (coerced as Partial<ProjectContextData>).deliveryPlan ?? []
            : [];
        const stakeholders = shape.stakeholders.safeParse((coerced as Partial<ProjectContextData>).stakeholders).success
            ? (coerced as Partial<ProjectContextData>).stakeholders ?? []
            : [];

        return {
            ...DEFAULT_CONTEXT,
            projectName: (coerced as Partial<ProjectContextData>).projectName ?? '',
            projectScope: (coerced as Partial<ProjectContextData>).projectScope ?? '',
            objectives,
            teamMembers,
            technologies,
            keyMilestones,
            businessRules,
            deliveryPlan,
            stakeholders,
            summary: (coerced as Partial<ProjectContextData>).summary,
        };
    }

    private coerceContextData(input: unknown): Partial<ProjectContextData> {
        if (!input || typeof input !== 'object' || Array.isArray(input)) {
            return {};
        }

        const raw = input as Record<string, unknown>;
        const asText = (value: unknown, fallback = ''): string => (typeof value === 'string' ? value.trim() : fallback);
        const asStringArray = (value: unknown): string[] => (Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []);

        const objectivesRaw = Array.isArray(raw.objectives) ? raw.objectives : [];
        const objectives = objectivesRaw
            .map((item) => {
                if (typeof item === 'string') {
                    return { description: item.trim(), priority: 'media' as const };
                }
                if (item && typeof item === 'object') {
                    const row = item as Record<string, unknown>;
                    const description = asText(row.description || row.objetivo || row.title);
                    const priority = asText(row.priority, 'media').toLowerCase();
                    if (!description) return null;
                    return {
                        description,
                        priority: (priority === 'alta' || priority === 'baixa' ? priority : 'media') as 'alta' | 'media' | 'baixa',
                    };
                }
                return null;
            })
            .filter((item): item is NonNullable<typeof item> => Boolean(item));

        const teamMembersRaw = Array.isArray(raw.teamMembers) ? raw.teamMembers : [];
        const teamMembers = teamMembersRaw
            .map((item) => {
                if (typeof item === 'string') {
                    return { name: item.trim(), role: 'Membro do time', area: 'Projeto' };
                }
                if (item && typeof item === 'object') {
                    const row = item as Record<string, unknown>;
                    const name = asText(row.name || row.displayName || row.fullName);
                    if (!name) return null;
                    return {
                        name,
                        role: asText(row.role, 'Membro do time'),
                        area: asText(row.area || row.department || row.squad, 'Projeto'),
                    };
                }
                return null;
            })
            .filter((item): item is NonNullable<typeof item> => Boolean(item));

        const technologiesRaw = Array.isArray(raw.technologies) ? raw.technologies : [];
        const technologies = technologiesRaw
            .map((item) => {
                if (typeof item === 'string') {
                    return { name: item.trim(), category: 'other' as const };
                }
                if (item && typeof item === 'object') {
                    const row = item as Record<string, unknown>;
                    const name = asText(row.name || row.technology);
                    if (!name) return null;
                    const category = asText(row.category, 'other').toLowerCase();
                    return {
                        name,
                        category: (
                            ['frontend', 'backend', 'database', 'infrastructure', 'tool', 'other'].includes(category)
                                ? category
                                : 'other'
                        ) as 'frontend' | 'backend' | 'database' | 'infrastructure' | 'tool' | 'other',
                        version: asText(row.version || row.versao) || undefined,
                    };
                }
                return null;
            })
            .filter((item): item is NonNullable<typeof item> => Boolean(item));

        const keyMilestonesRaw = Array.isArray(raw.keyMilestones) ? raw.keyMilestones : [];
        const keyMilestones = keyMilestonesRaw
            .map((item, idx) => {
                if (typeof item === 'string') {
                    return {
                        name: item.trim(),
                        deliverable: item.trim(),
                        status: 'planejado' as const,
                    };
                }
                if (item && typeof item === 'object') {
                    const row = item as Record<string, unknown>;
                    const name = asText(row.name || row.milestone || row.title, `Marco ${idx + 1}`);
                    const status = asText(row.status, 'planejado').toLowerCase();
                    return {
                        name,
                        date: asText(row.date || row.endDate || row.deadline) || undefined,
                        deliverable: asText(row.deliverable || row.entregavel, name),
                        status: (
                            ['planejado', 'em_andamento', 'concluido', 'atrasado'].includes(status)
                                ? status
                                : 'planejado'
                        ) as 'planejado' | 'em_andamento' | 'concluido' | 'atrasado',
                    };
                }
                return null;
            })
            .filter((item): item is NonNullable<typeof item> => Boolean(item));

        const businessRulesRaw = Array.isArray(raw.businessRules) ? raw.businessRules : [];
        const businessRules = businessRulesRaw
            .map((item, idx) => {
                if (typeof item === 'string') {
                    return {
                        id: `BR-${idx + 1}`,
                        description: item.trim(),
                        area: 'Negocio',
                        priority: 'media' as const,
                    };
                }
                if (item && typeof item === 'object') {
                    const row = item as Record<string, unknown>;
                    const description = asText(row.description || row.regra || row.text);
                    if (!description) return null;
                    const priority = asText(row.priority, 'media').toLowerCase();
                    return {
                        id: asText(row.id, `BR-${idx + 1}`),
                        description,
                        area: asText(row.area, 'Negocio'),
                        priority: (priority === 'alta' || priority === 'baixa' ? priority : 'media') as 'alta' | 'media' | 'baixa',
                    };
                }
                return null;
            })
            .filter((item): item is NonNullable<typeof item> => Boolean(item));

        const deliveryPlanRaw = Array.isArray(raw.deliveryPlan) ? raw.deliveryPlan : [];
        const deliveryPlan = deliveryPlanRaw
            .map((item, idx) => {
                if (typeof item === 'string') {
                    return {
                        phase: item.trim() || `Fase ${idx + 1}`,
                        objectives: [],
                        deliverables: [],
                    };
                }
                if (item && typeof item === 'object') {
                    const row = item as Record<string, unknown>;
                    return {
                        phase: asText(row.phase || row.fase, `Fase ${idx + 1}`),
                        startDate: asText(row.startDate || row.inicio) || undefined,
                        endDate: asText(row.endDate || row.fim) || undefined,
                        objectives: asStringArray(row.objectives || row.objetivos),
                        deliverables: asStringArray(row.deliverables || row.entregaveis),
                    };
                }
                return null;
            })
            .filter((item): item is NonNullable<typeof item> => Boolean(item));

        const stakeholdersRaw = Array.isArray(raw.stakeholders) ? raw.stakeholders : [];
        const stakeholders = stakeholdersRaw
            .map((item) => {
                if (typeof item === 'string') {
                    return { name: item.trim(), role: 'Stakeholder', organization: 'Projeto' };
                }
                if (item && typeof item === 'object') {
                    const row = item as Record<string, unknown>;
                    const name = asText(row.name || row.displayName);
                    if (!name) return null;
                    return {
                        name,
                        role: asText(row.role, 'Stakeholder'),
                        organization: asText(row.organization || row.orgao, 'Projeto'),
                        contact: asText(row.contact || row.email) || undefined,
                    };
                }
                return null;
            })
            .filter((item): item is NonNullable<typeof item> => Boolean(item));

        return {
            projectName: asText(raw.projectName),
            projectScope: asText(raw.projectScope),
            objectives,
            teamMembers,
            technologies,
            keyMilestones,
            businessRules,
            deliveryPlan,
            stakeholders,
            summary: asText(raw.summary) || undefined,
        };
    }

    private safeArray<T>(value: unknown): T[] {
        return Array.isArray(value) ? (value as T[]) : [];
    }
}

export const projectContextService = new ProjectContextService(embeddingService);

export type { MappingInput };
