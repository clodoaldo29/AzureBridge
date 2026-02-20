import { z } from 'zod';

export const documentElementTypeSchema = z.enum(['heading', 'paragraph', 'table', 'list', 'image', 'pageBreak']);
export const placeholderTypeSchema = z.enum(['text', 'date', 'number', 'list', 'table', 'enum', 'date_range']);
export const styleTypeSchema = z.enum(['paragraph', 'character', 'table', 'numbering']);
export const headerFooterTypeSchema = z.enum(['header', 'footer']);
export const headerFooterPositionSchema = z.enum(['default', 'first', 'even']);
export const fixedElementTypeSchema = z.enum(['header', 'footer', 'paragraph', 'image']);

export interface DocumentStructure {
    filename: string;
    elements: DocumentElement[];
    styles: Record<string, StyleInfo>;
    headers: HeaderFooterContent[];
    footers: HeaderFooterContent[];
    metadata: { author?: string; created?: string; modified?: string };
}

export interface DocumentElement {
    type: 'heading' | 'paragraph' | 'table' | 'list' | 'image' | 'pageBreak';
    content: string;
    style: string;
    level?: number;
    children?: DocumentElement[];
    tableData?: {
        headers: string[];
        rows: string[][];
        columnCount: number;
        rowCount: number;
    };
    listItems?: string[];
    position: number;
    xmlPath?: string;
}

export interface StyleInfo {
    id: string;
    name: string;
    type: 'paragraph' | 'character' | 'table' | 'numbering';
    basedOn?: string;
    formatting: {
        bold?: boolean;
        italic?: boolean;
        fontSize?: number;
        fontFamily?: string;
        color?: string;
        alignment?: string;
    };
}

export interface HeaderFooterContent {
    type: 'header' | 'footer';
    position: 'default' | 'first' | 'even';
    content: string;
    elements: DocumentElement[];
}

export interface PlaceholderDefinition {
    name: string;
    type: 'text' | 'date' | 'number' | 'list' | 'table' | 'enum' | 'date_range';
    required: boolean;
    section: string;
    description: string;
    maxLength?: number;
    enumValues?: string[];
    tableColumns?: ColumnDefinition[];
    examples: string[];
    avgLength?: number;
}

export interface ColumnDefinition {
    name: string;
    displayName: string;
    type: 'text' | 'date' | 'number' | 'enum';
    required: boolean;
}

export interface TemplateAnalysisResult {
    sections: TemplateSection[];
    fixedElements: FixedElement[];
    globalPlaceholders: PlaceholderDefinition[];
}

export interface TemplateSection {
    title: string;
    headingLevel: number;
    order: number;
    fixedText: string | null;
    placeholders: PlaceholderDefinition[];
    subsections?: TemplateSection[];
}

export interface FixedElement {
    type: 'header' | 'footer' | 'paragraph' | 'image';
    content: string;
    position: number;
    note?: string;
}

export interface RDAOutputSchema {
    schemaVersion: string;
    templateId: string;
    sections: Record<string, {
        fields: Record<string, {
            type: PlaceholderDefinition['type'];
            required: boolean;
            description: string;
            maxLength?: number;
            tableSchema?: { columns: ColumnDefinition[] };
            enumValues?: string[];
        }>;
    }>;
}

export const styleInfoSchema = z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    type: styleTypeSchema,
    basedOn: z.string().optional(),
    formatting: z.object({
        bold: z.boolean().optional(),
        italic: z.boolean().optional(),
        fontSize: z.number().optional(),
        fontFamily: z.string().optional(),
        color: z.string().optional(),
        alignment: z.string().optional(),
    }),
});

export const documentElementSchema: z.ZodType<DocumentElement> = z.lazy(() => z.object({
    type: documentElementTypeSchema,
    content: z.string(),
    style: z.string(),
    level: z.number().int().min(1).max(9).optional(),
    children: z.array(documentElementSchema).optional(),
    tableData: z.object({
        headers: z.array(z.string()),
        rows: z.array(z.array(z.string())),
        columnCount: z.number().int().nonnegative(),
        rowCount: z.number().int().nonnegative(),
    }).optional(),
    listItems: z.array(z.string()).optional(),
    position: z.number().int().nonnegative(),
    xmlPath: z.string().optional(),
}));

export const headerFooterContentSchema: z.ZodType<HeaderFooterContent> = z.object({
    type: headerFooterTypeSchema,
    position: headerFooterPositionSchema,
    content: z.string(),
    elements: z.array(documentElementSchema),
});

export const documentStructureSchema: z.ZodType<DocumentStructure> = z.object({
    filename: z.string().min(1),
    elements: z.array(documentElementSchema),
    styles: z.record(styleInfoSchema),
    headers: z.array(headerFooterContentSchema),
    footers: z.array(headerFooterContentSchema),
    metadata: z.object({
        author: z.string().optional(),
        created: z.string().optional(),
        modified: z.string().optional(),
    }),
});

export const columnDefinitionSchema: z.ZodType<ColumnDefinition> = z.object({
    name: z.string().min(1),
    displayName: z.string().min(1),
    type: z.enum(['text', 'date', 'number', 'enum']),
    required: z.boolean(),
});

export const placeholderDefinitionSchema: z.ZodType<PlaceholderDefinition> = z.object({
    name: z.string().min(1),
    type: placeholderTypeSchema,
    required: z.boolean(),
    section: z.string().min(1),
    description: z.string().min(1),
    maxLength: z.number().int().positive().optional(),
    enumValues: z.array(z.string()).optional(),
    tableColumns: z.array(columnDefinitionSchema).optional(),
    examples: z.array(z.string()),
    avgLength: z.number().nonnegative().optional(),
});

export const templateSectionSchema: z.ZodType<TemplateSection> = z.lazy(() => z.object({
    title: z.string().min(1),
    headingLevel: z.number().int().min(1).max(9),
    order: z.number().int().nonnegative(),
    fixedText: z.string().nullable(),
    placeholders: z.array(placeholderDefinitionSchema),
    subsections: z.array(templateSectionSchema).optional(),
}));

export const fixedElementSchema: z.ZodType<FixedElement> = z.object({
    type: fixedElementTypeSchema,
    content: z.string(),
    position: z.number().int().nonnegative(),
    note: z.string().optional(),
});

export const templateAnalysisResultSchema: z.ZodType<TemplateAnalysisResult> = z.object({
    sections: z.array(templateSectionSchema),
    fixedElements: z.array(fixedElementSchema),
    globalPlaceholders: z.array(placeholderDefinitionSchema),
});

export const rdaOutputSchemaSchema: z.ZodType<RDAOutputSchema> = z.object({
    schemaVersion: z.string().min(1),
    templateId: z.string().min(1),
    sections: z.record(z.object({
        fields: z.record(z.object({
            type: placeholderTypeSchema,
            required: z.boolean(),
            description: z.string(),
            maxLength: z.number().int().positive().optional(),
            tableSchema: z.object({
                columns: z.array(columnDefinitionSchema),
            }).optional(),
            enumValues: z.array(z.string()).optional(),
        })),
    })),
});

export const analyzeModelsBodySchema = z.object({
    projectId: z.string().optional(),
});

export const generateTemplateBodySchema = z.object({
    analysisId: z.string().min(1).optional(),
    projectId: z.string().optional(),
    name: z.string().min(1).default('Template Factory'),
    placeholderOverrides: z.array(placeholderDefinitionSchema).optional(),
});

export const templateFactoryStatusParamsSchema = z.object({
    id: z.string().min(1),
});
