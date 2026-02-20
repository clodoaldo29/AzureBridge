import { useMemo, useState } from 'react';
import { Wand2 } from 'lucide-react';
import type { AxiosError } from 'axios';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/hooks/use-toast';
import { api } from '@/services/api';
import { useActivateTemplate } from '@/services/queries/templates';
import { useGenerateTemplate } from './hooks/useGenerateTemplate';
import { useTemplateFactoryStatus } from './hooks/useTemplateFactoryStatus';
import { Step1ModelUpload } from './Step1ModelUpload';
import { Step2AnalysisReview } from './Step2AnalysisReview';
import { Step3TemplatePreview } from './Step3TemplatePreview';
import type { AnalyzeModelsResponse, GenerateTemplateResponse, PlaceholderDefinition } from './types';

interface TemplateFactoryWizardProps {
    projectId?: string;
}

export function TemplateFactoryWizard({ projectId }: TemplateFactoryWizardProps) {
    const [currentStep, setCurrentStep] = useState(1);
    const [analysis, setAnalysis] = useState<AnalyzeModelsResponse | null>(null);
    const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
    const [placeholders, setPlaceholders] = useState<PlaceholderDefinition[]>([]);
    const [generated, setGenerated] = useState<GenerateTemplateResponse | null>(null);

    const generateTemplateMutation = useGenerateTemplate();
    const activateTemplateMutation = useActivateTemplate();

    const analysisStatusQuery = useTemplateFactoryStatus(analysis?.analysisId ?? null, {
        enabled: Boolean(analysis?.analysisId) && currentStep >= 2,
        refetchInterval: currentStep === 2 ? 5000 : false,
    });

    const handleAnalyzed = (payload: { analysis: AnalyzeModelsResponse; files: File[] }) => {
        setAnalysis(payload.analysis);
        setSelectedFiles(payload.files);
        setPlaceholders(payload.analysis.analysis.globalPlaceholders);
        setGenerated(null);
        setCurrentStep(2);
    };

    const handleGenerate = async () => {
        if (!analysis) {
            return;
        }

        try {
            const result = await generateTemplateMutation.mutateAsync({
                analysisId: analysis.analysisId,
                projectId,
                files: selectedFiles,
                placeholderOverrides: placeholders,
            });

            setGenerated(result);
            setCurrentStep(3);

            toast({
                title: 'Template gerado',
                description: 'Template e schema foram gerados com sucesso.',
            });
        } catch {
            toast({
                title: 'Falha na geracao',
                description: 'Nao foi possivel gerar o template a partir dos modelos.',
                variant: 'destructive',
            });
        }
    };

    const handleDownload = async () => {
        if (!generated) {
            return;
        }

        try {
            const response = await api.get(`/rda/templates/${generated.templateId}/download`, {
                responseType: 'blob',
            });

            const blob = new Blob([response.data], {
                type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            });

            const url = window.URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `template-factory-${generated.templateId}.docx`;
            document.body.appendChild(link);
            link.click();
            link.remove();
            window.URL.revokeObjectURL(url);
        } catch (cause) {
            const error = cause as AxiosError<{ message?: string; error?: string; details?: Array<{ message?: string }> }>;
            const message = error.response?.data?.details?.[0]?.message
                || error.response?.data?.message
                || error.response?.data?.error;

            toast({
                title: 'Falha no download',
                description: message || 'Nao foi possivel baixar o template gerado.',
                variant: 'destructive',
            });
        }
    };

    const handleActivate = async () => {
        if (!generated) {
            return;
        }

        try {
            await activateTemplateMutation.mutateAsync(generated.templateId);
            toast({
                title: 'Template ativado',
                description: 'O template gerado foi ativado com sucesso.',
            });
        } catch (cause) {
            const error = cause as AxiosError<{ message?: string; error?: string; details?: Array<{ message?: string }> }>;
            const message = error.response?.data?.details?.[0]?.message
                || error.response?.data?.message
                || error.response?.data?.error;

            toast({
                title: 'Falha ao ativar',
                description: message || 'Nao foi possivel ativar o template.',
                variant: 'destructive',
            });
        }
    };

    const statusBadge = useMemo(() => {
        if (analysisStatusQuery.isLoading) {
            return 'consultando';
        }

        return analysisStatusQuery.data?.status ?? 'sem status';
    }, [analysisStatusQuery.data?.status, analysisStatusQuery.isLoading]);

    const restartFlow = () => {
        setCurrentStep(1);
        setAnalysis(null);
        setSelectedFiles([]);
        setPlaceholders([]);
        setGenerated(null);
    };

    return (
        <div className="space-y-4">
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Wand2 className="h-5 w-5" />
                        Template Factory
                    </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                        {[1, 2, 3].map((step) => (
                            <Badge key={step} variant={currentStep === step ? 'default' : 'secondary'}>
                                Step {step}
                            </Badge>
                        ))}
                        <Badge variant="outline">Status: {statusBadge}</Badge>
                    </div>

                    <div className="text-sm text-muted-foreground">
                        Fluxo: upload de modelos, revisao de placeholders e geracao do template final.
                    </div>
                </CardContent>
            </Card>

            {currentStep === 1 && (
                <Step1ModelUpload projectId={projectId} onAnalyzed={handleAnalyzed} />
            )}

            {currentStep === 2 && analysis && (
                <Step2AnalysisReview
                    analysis={analysis}
                    placeholders={placeholders}
                    onChangePlaceholders={setPlaceholders}
                    onBack={() => setCurrentStep(1)}
                    onGenerate={handleGenerate}
                    isGenerating={generateTemplateMutation.isPending}
                />
            )}

            {currentStep === 3 && generated && (
                <Step3TemplatePreview
                    generation={generated}
                    isGenerating={generateTemplateMutation.isPending}
                    isActivating={activateTemplateMutation.isPending}
                    onActivate={handleActivate}
                    onDownload={handleDownload}
                    onRestart={restartFlow}
                />
            )}

            {currentStep === 3 && !generated && (
                <div className="flex justify-end">
                    <Button variant="outline" onClick={() => setCurrentStep(2)}>
                        Voltar para revisao
                    </Button>
                </div>
            )}
        </div>
    );
}