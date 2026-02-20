import { generateTemplateBodySchema, templateAnalysisResultSchema } from '@/modules/rda/schemas/template-factory.schema';

describe('template-factory.schema', () => {
    it('aceita payload de generate com analysisId opcional', () => {
        const parsed = generateTemplateBodySchema.parse({
            projectId: 'p1',
            name: 'Factory',
        });

        expect(parsed.projectId).toBe('p1');
        expect(parsed.analysisId).toBeUndefined();
    });

    it('valida analysis result minimo', () => {
        const parsed = templateAnalysisResultSchema.parse({
            sections: [],
            fixedElements: [],
            globalPlaceholders: [],
        });

        expect(parsed.sections).toHaveLength(0);
    });
});
