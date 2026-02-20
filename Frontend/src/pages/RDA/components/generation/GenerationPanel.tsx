import { useMemo } from 'react';
import { AlertCircle, CheckCircle2, Clock3, Download, Loader2, RotateCcw, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { useCancelGeneration, useGenerationDetails, useGenerationProgress, useRetryGeneration } from '@/pages/RDA/hooks/useGeneration';
import { api } from '@/services/api';

interface GenerationPanelProps {
    projectId: string;
    generationId: string;
    onReviewClick?: (generationId: string) => void;
}

function statusLabel(status: string): string {
    if (status === 'queued') return 'Aguardando na fila';
    if (status === 'processing') return 'Processando';
    if (status === 'completed') return 'Concluida';
    if (status === 'failed') return 'Falhou';
    if (status === 'cancelled') return 'Cancelada';
    return status;
}

function currentAgentFromStep(step?: string | null): string {
    if (!step) return 'Preparacao';
    if (step.includes('extractor')) return 'Extracao';
    if (step.includes('normalizer')) return 'Normalizacao';
    if (step.includes('validator')) return 'Validacao';
    if (step.includes('formatter')) return 'Formatacao';
    if (step.includes('docx')) return 'Documento';
    return step;
}

export function GenerationPanel({ projectId, generationId, onReviewClick }: GenerationPanelProps) {
    const { data: progress, isLoading } = useGenerationProgress(projectId, generationId);
    const { data: details, refetch } = useGenerationDetails(projectId, generationId);
    const cancelMutation = useCancelGeneration(projectId);
    const retryMutation = useRetryGeneration(projectId);

    const validationReport = (details?.partialResults as Record<string, unknown> | undefined)?.validationReport as Record<string, unknown> | undefined;

    const errors = useMemo(() => {
        const issues = (validationReport?.issues as Array<Record<string, unknown>> | undefined) ?? [];
        return issues.filter((item) => item.severity === 'error').length;
    }, [validationReport]);

    const warnings = useMemo(() => {
        const issues = (validationReport?.issues as Array<Record<string, unknown>> | undefined) ?? [];
        return issues.filter((item) => item.severity === 'warning').length;
    }, [validationReport]);
    const errorMessage = typeof details?.errorMessage === 'string' ? details.errorMessage : null;

    const handleDownload = async () => {
        const response = await api.get(`/rda/generations/${projectId}/${generationId}/download`, {
            responseType: 'blob',
        });

        const blob = new Blob([response.data], {
            type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `rda-${generationId}.docx`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
    };

    if (isLoading || !progress) {
        return (
            <Card>
                <CardHeader><CardTitle className="text-base">Geracao do RDA</CardTitle></CardHeader>
                <CardContent className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" /> Carregando status da geracao...
                </CardContent>
            </Card>
        );
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center justify-between text-base">
                    <span>Geracao do RDA</span>
                    <span className="text-sm text-muted-foreground">{statusLabel(progress.status)}</span>
                </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="flex items-center gap-2 text-sm">
                    {progress.status === 'queued' && <Clock3 className="h-4 w-4 text-amber-600" />}
                    {progress.status === 'processing' && <Loader2 className="h-4 w-4 animate-spin text-blue-600" />}
                    {progress.status === 'completed' && <CheckCircle2 className="h-4 w-4 text-emerald-600" />}
                    {progress.status === 'failed' && <AlertCircle className="h-4 w-4 text-red-600" />}
                    {progress.status === 'cancelled' && <Square className="h-4 w-4 text-slate-600" />}
                    <span className="text-muted-foreground">{currentAgentFromStep(progress.currentStep)}</span>
                    <span className="ml-auto font-semibold">{progress.progress}%</span>
                </div>

                <Progress value={progress.progress} />

                {progress.status === 'completed' && validationReport && (
                    <div className="grid gap-2 text-sm md:grid-cols-4">
                        <div className="rounded border px-3 py-2">Score: <b>{Math.round(Number(validationReport.overallScore ?? 0) * 100)}%</b></div>
                        <div className="rounded border px-3 py-2">Campos: <b>{Number(validationReport.filledFields ?? 0)}/{Number(validationReport.totalFields ?? 0)}</b></div>
                        <div className="rounded border px-3 py-2">Erros: <b>{errors}</b></div>
                        <div className="rounded border px-3 py-2">Avisos: <b>{warnings}</b></div>
                    </div>
                )}

                {progress.status === 'failed' && errorMessage && (
                    <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                        {errorMessage}
                    </div>
                )}

                <div className="flex flex-wrap items-center gap-2">
                    {progress.status === 'processing' && (
                        <Button variant="outline" onClick={() => cancelMutation.mutate(generationId)}>
                            <Square className="mr-2 h-4 w-4" /> Cancelar
                        </Button>
                    )}
                    {progress.status === 'failed' && (
                        <Button variant="outline" onClick={() => retryMutation.mutate(generationId)}>
                            <RotateCcw className="mr-2 h-4 w-4" /> Tentar novamente
                        </Button>
                    )}
                    {progress.status === 'completed' && (
                        <>
                            <Button variant="outline" onClick={() => onReviewClick?.(generationId)}>
                                Revisar
                            </Button>
                            <Button onClick={handleDownload}>
                                <Download className="mr-2 h-4 w-4" /> Download DOCX
                            </Button>
                        </>
                    )}
                    <Button variant="ghost" onClick={() => refetch()}>Atualizar</Button>
                </div>
            </CardContent>
        </Card>
    );
}
