import { TemplateBuilderService } from '@/modules/rda/services/template-builder.service';

describe('TemplateBuilderService', () => {
    it('substitui placeholder em texto fragmentado por paragrafos', () => {
        const builder = new TemplateBuilderService() as unknown as {
            replaceInXml: (xml: string, originalContent: string, placeholder: string, fuzzyMatch: boolean) => string;
        };

        const xml = [
            '<w:p>',
            '<w:r><w:t>Resumo do</w:t></w:r>',
            '<w:r><w:t> mes em andamento</w:t></w:r>',
            '</w:p>',
        ].join('');

        const replaced = builder.replaceInXml(xml, 'Resumo do mes em andamento', '{{RESUMO_MES}}', true);

        expect(replaced).toContain('{{RESUMO_MES}}');
    });
});
