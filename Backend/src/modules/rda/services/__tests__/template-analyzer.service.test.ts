import { TemplateAnalyzerService } from '@/modules/rda/services/template-analyzer.service';
import type { DocumentStructure, TemplateAnalysisResult } from '@/modules/rda/schemas/template-factory.schema';

function buildStructure(index: number, elementsCount: number): DocumentStructure {
    return {
        filename: `model-${index}.docx`,
        styles: {},
        headers: [],
        footers: [],
        metadata: {},
        elements: Array.from({ length: elementsCount }).map((_, position) => ({
            type: 'paragraph',
            content: `Conteudo muito longo ${index}-${position} ${'x'.repeat(420)}`,
            style: 'Normal',
            position,
        })),
    };
}

function analysisResult(name: string): TemplateAnalysisResult {
    return {
        sections: [
            {
                title: 'Resumo',
                headingLevel: 1,
                order: 1,
                fixedText: null,
                placeholders: [
                    {
                        name,
                        type: 'text',
                        required: true,
                        section: 'Resumo',
                        description: 'Campo resumo',
                        examples: [],
                    },
                ],
            },
        ],
        fixedElements: [],
        globalPlaceholders: [
            {
                name,
                type: 'text',
                required: true,
                section: 'Resumo',
                description: 'Campo resumo',
                examples: [],
            },
        ],
    };
}

describe('TemplateAnalyzerService', () => {
    it('faz chunking quando prompt excede limite e consolida placeholders', async () => {
        const completeJSON = jest
            .fn()
            .mockResolvedValueOnce({ data: analysisResult('resumo executivo'), tokensUsed: 100 })
            .mockResolvedValueOnce({ data: analysisResult('RESUMO_EXECUTIVO'), tokensUsed: 100 })
            .mockResolvedValueOnce({ data: analysisResult('resumo executivo'), tokensUsed: 100 });

        const analyzer = new TemplateAnalyzerService({ completeJSON } as never);
        const structures = [
            buildStructure(1, 220),
            buildStructure(2, 220),
            buildStructure(3, 220),
            buildStructure(4, 220),
            buildStructure(5, 220),
        ];

        const result = await analyzer.analyzeModels(structures);

        expect(completeJSON.mock.calls.length).toBeGreaterThan(1);
        expect(result.globalPlaceholders).toHaveLength(1);
        expect(result.globalPlaceholders[0].name).toBe('RESUMO_EXECUTIVO');
    });

    it('usa fallback heuristico quando Claude falha na analise', async () => {
        const completeJSON = jest.fn().mockRejectedValue(new Error('Falha simulada do Claude'));
        const analyzer = new TemplateAnalyzerService({ completeJSON } as never);

        const structures: DocumentStructure[] = [
            {
                filename: 'a.docx',
                styles: {},
                headers: [],
                footers: [],
                metadata: {},
                elements: [
                    { type: 'heading', content: 'Resumo Executivo', style: 'Heading1', position: 0, level: 1 },
                    { type: 'paragraph', content: 'Entrega 01 concluida', style: 'Normal', position: 1 },
                    { type: 'paragraph', content: 'Total: 10', style: 'Normal', position: 2 },
                ],
            },
            {
                filename: 'b.docx',
                styles: {},
                headers: [],
                footers: [],
                metadata: {},
                elements: [
                    { type: 'heading', content: 'Resumo Executivo', style: 'Heading1', position: 0, level: 1 },
                    { type: 'paragraph', content: 'Entrega 02 concluida', style: 'Normal', position: 1 },
                    { type: 'paragraph', content: 'Total: 25', style: 'Normal', position: 2 },
                ],
            },
        ];

        const result = await analyzer.analyzeModels(structures);

        expect(result.sections.length).toBeGreaterThan(0);
        expect(result.globalPlaceholders.length).toBeGreaterThan(0);
    });
});
