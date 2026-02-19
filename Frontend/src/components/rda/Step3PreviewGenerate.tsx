import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { api } from '@/services/api';
import type { ApiListResponse, WorkItem } from '@/types';
import type { RDAWizardFormData } from './types';

interface Step3PreviewGenerateProps {
    formData: RDAWizardFormData;
    projectName?: string;
    onBack: () => void;
    onGenerate: () => void;
    isGenerating: boolean;
}

export function Step3PreviewGenerate({
    formData,
    projectName,
    onBack,
    onGenerate,
    isGenerating,
}: Step3PreviewGenerateProps) {
    const { data: workItemsResponse } = useQuery({
        queryKey: ['workItemsPreview', formData.projectId, formData.periodStart, formData.periodEnd],
        queryFn: async () => {
            const response = await api.get<ApiListResponse<WorkItem>>('/work-items', {
                params: { projectId: formData.projectId, limit: 1, offset: 0 },
            });
            return response.data;
        },
        enabled: !!formData.projectId,
    });

    const estimatedItems = workItemsResponse?.meta?.total ?? workItemsResponse?.data?.length ?? 0;

    return (
        <Card>
            <CardHeader>
                <CardTitle>Step 3: Preview e Confirmacao</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
                <p><strong>Projeto:</strong> {projectName || formData.projectId}</p>
                <p><strong>Template:</strong> Template oficial global ativo</p>
                <p><strong>Periodo:</strong> {formData.periodStart} ate {formData.periodEnd}</p>
                <p><strong>Documentos selecionados:</strong> {formData.documentIds.length}</p>
                <p><strong>Wikis selecionadas:</strong> {formData.wikiPageIds.length}</p>
                <p><strong>Work items no projeto (estimado):</strong> {estimatedItems}</p>

                <div className="flex gap-2 pt-2">
                    <Button variant="outline" onClick={onBack}>Voltar</Button>
                    <Button onClick={onGenerate} disabled={isGenerating}>
                        {isGenerating ? 'Gerando...' : 'Gerar RDA'}
                    </Button>
                </div>
            </CardContent>
        </Card>
    );
}
