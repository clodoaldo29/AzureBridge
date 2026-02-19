export type PlaceholderType = 'text' | 'date' | 'number' | 'list' | 'table' | 'enum' | 'date_range';

export interface ColumnDefinition {
    name: string;
    displayName: string;
    type: 'text' | 'date' | 'number' | 'enum';
    required: boolean;
}

export interface PlaceholderDefinition {
    name: string;
    type: PlaceholderType;
    required: boolean;
    section: string;
    description: string;
    maxLength?: number;
    enumValues?: string[];
    tableColumns?: ColumnDefinition[];
    examples: string[];
    avgLength?: number;
}

export interface TemplateSection {
    title: string;
    headingLevel: number;
    order: number;
    fixedText: string | null;
    placeholders: PlaceholderDefinition[];
}

export interface FixedElement {
    type: 'header' | 'footer' | 'paragraph' | 'image';
    content: string;
    position: number;
    note?: string;
}

export interface TemplateAnalysisResult {
    sections: TemplateSection[];
    fixedElements: FixedElement[];
    globalPlaceholders: PlaceholderDefinition[];
}

export interface AnalyzeModelsResponse {
    analysisId: string;
    createdAt: string;
    structures: Array<{ filename: string; elements: number }>;
    analysis: TemplateAnalysisResult;
}

export interface GenerateTemplateResponse {
    templateId: string;
    schemaId: string;
    placeholders: PlaceholderDefinition[];
    validationResult: {
        valid: boolean;
        errors: string[];
    };
}

export interface TemplateFactoryStatusResponse {
    id: string;
    projectId?: string;
    filenames: string[];
    structures: Array<{ filename: string; elements: number }>;
    analysis: TemplateAnalysisResult;
    createdAt: string;
    status: 'ready' | 'expired';
}
