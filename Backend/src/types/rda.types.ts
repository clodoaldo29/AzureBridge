export type RDAReportPeriodType = 'monthly' | 'general';
export type AgentOutputType = 'text' | 'json';

export interface GenerateRDARequest {
    projectId: string;
    templateId?: string;
    periodType: RDAReportPeriodType;
    periodStart: string;
    periodEnd: string;
    documentIds: string[];
    wikiPageIds: string[];
    generatedBy: string;
}

export interface RDATemplateData {
    id: string;
    projectId: string;
    name: string;
    description?: string | null;
    filePath: string;
    placeholders: string[];
    templateContract?: TemplateContractData;
    isActive: boolean;
    version?: number;
    createdAt?: Date;
    updatedAt?: Date;
}

export interface TemplateContractField {
    placeholder: string;
    key: string;
    required: boolean;
    category: 'project' | 'period' | 'section' | 'evidence' | 'metadata' | 'unknown';
}

export interface TemplateContractSection {
    title: string;
    key: string;
    placeholders: string[];
    expectedContentHint?: string;
}

export interface TemplateContractData {
    placeholders: string[];
    requiredFields: TemplateContractField[];
    sections: TemplateContractSection[];
    tableAnchors: string[];
}

export interface WikiPageData {
    id: string;
    projectId: string;
    path: string;
    title: string;
    content: string;
    parentPath?: string | null;
    order?: number;
    lastSyncAt?: Date | null;
}

export interface DocumentData {
    id: string;
    projectId: string;
    filename: string;
    mimeType: string;
    sizeBytes: number;
    extractedText?: string | null;
    createdAt?: Date;
}

export interface WorkItemData {
    id: number;
    azureId: number;
    url: string;
    projectId: string;
    sprintId?: string | null;
    type: string;
    state: string;
    title: string;
    description?: string | null;
    storyPoints?: number | null;
    originalEstimate?: number | null;
    completedWork?: number | null;
    remainingWork?: number | null;
    createdDate?: Date;
    changedDate?: Date;
    closedDate?: Date | null;
    assignedToId?: string | null;
}

export interface SprintData {
    id: string;
    azureId: string;
    projectId: string;
    name: string;
    startDate: Date;
    endDate: Date;
    state: string;
    timeFrame: string;
    totalPlannedHours?: number | null;
    totalCompletedHours?: number | null;
    totalRemainingHours?: number | null;
    totalStoryPoints?: number | null;
    completedStoryPoints?: number | null;
    teamCapacityHours?: number | null;
    commitmentHours?: number | null;
}

export interface AgentPromptData {
    agentName: string;
    objective: string;
    instructions: string[];
    expectedOutput: AgentOutputType;
    contextSummary?: string;
    temperature?: number;
    maxTokens?: number;
}

export interface RDATemplateResponsiblePayload {
    NOME_RESPONSAVEL: string;
    CPF_RESPONSAVEL: string;
    JUSTIFICATIVA_RESPONSAVEL: string;
}

export interface RDATemplateActivityPayload {
    NUMERO_ATIVIDADE: string;
    NOME_ATIVIDADE: string;
    PERIODO_ATIVIDADE: string;
    DESCRICAO_ATIVIDADE: string;
    JUSTIFICATIVA_ATIVIDADE: string;
    RESULTADO_OBTIDO_ATIVIDADE: string;
    DISPENDIOS_ATIVIDADE: string;
    RESPONSAVEIS: RDATemplateResponsiblePayload[];
}

export interface RDATemplateDocPayload {
    PROJETO_NOME: string;
    ANO_BASE: string;
    COMPETENCIA: string;
    COORDENADOR_TECNICO: string;
    ATIVIDADES: RDATemplateActivityPayload[];
    RESULTADOS_ALCANCADOS: string;
}

export interface RDASection {
    title: string;
    content: string;
    subsections: Array<{
        title: string;
        content: string;
    }>;
}

export interface AgentResult<TData = unknown> {
    agentName: string;
    success: boolean;
    startedAt: string;
    finishedAt: string;
    durationMs: number;
    tokensUsed: number;
    data?: TData;
    error?: string;
}

export interface AgentContext {
    generationId: string;
    request: GenerateRDARequest;
    template: RDATemplateData;
    workItems: WorkItemData[];
    sprints: SprintData[];
    documents: DocumentData[];
    wikiPages: WikiPageData[];
    evidencePack?: ProjectEvidencePack;
    previousResults: AgentResult[];
    totalTokensUsed: number;
}

export interface ProjectEvidencePack {
    project: {
        id: string;
        name: string;
    };
    period: {
        start: string;
        end: string;
        type: RDAReportPeriodType;
    };
    plannedVsDelivered: {
        plannedStoryPoints: number;
        deliveredStoryPoints: number;
        completionRatePercent: number;
        plannedItems: number;
        deliveredItems: number;
    };
    pbiReferences: Array<{
        id: number;
        title: string;
        type: string;
        state: string;
        url: string;
    }>;
    designLinks: Array<{
        title: string;
        path: string;
        url: string;
    }>;
    wikiLinks: Array<{
        title: string;
        path: string;
        url: string;
    }>;
    sprintPlan: Array<{
        sprintName: string;
        startDate: string;
        endDate: string;
        plannedStoryPoints: number;
        deliveredStoryPoints: number;
    }>;
}

export interface RDAGenerationData {
    id: string;
    projectId: string;
    templateId: string;
    status: 'processing' | 'completed' | 'failed' | 'cancelled';
    progress: number;
    currentStep?: string | null;
    periodType: RDAReportPeriodType;
    periodStart: Date;
    periodEnd: Date;
    outputFilePath?: string | null;
    fileSize?: number | null;
    tokensUsed?: number | null;
    errorMessage?: string | null;
    partialResults?: unknown;
    createdBy: string;
    createdAt: Date;
    updatedAt: Date;
}

export interface ClaudeCompletionOptions {
    systemPrompt?: string;
    temperature?: number;
    maxTokens?: number;
}
