import fs from 'fs';
import { docxGeneratorService } from '@/services/rda/docx-generator.service';
import type { PlaceholderMap } from '@/modules/rda/schemas/generation.schema';

export class RDADocxGeneratorService {
    async generate(templatePath: string, payload: PlaceholderMap, generationId: string): Promise<{ filePath: string; sizeBytes: number }> {
        const templateBuffer = await docxGeneratorService.readTemplate(templatePath);
        const rendered = await docxGeneratorService.replaceText(templateBuffer, {}, payload);
        const outputPath = docxGeneratorService.getDefaultOutputPath(generationId);
        const filePath = await docxGeneratorService.save(rendered, outputPath);
        const stat = fs.statSync(filePath);
        return {
            filePath,
            sizeBytes: stat.size,
        };
    }
}

export const rdaDocxGeneratorService = new RDADocxGeneratorService();
