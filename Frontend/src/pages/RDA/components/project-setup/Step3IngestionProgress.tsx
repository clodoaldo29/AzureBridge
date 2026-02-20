import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';

interface SetupStatusData {
    isSetupComplete: boolean;
    documentsChunked: number;
    documentsTotal: number;
    wikiPagesChunked: number;
    hasProjectContext: boolean;
    operationalData?: {
        workItemsTotal: number;
        sprintsTotal: number;
        teamMembersTotal: number;
        capacitiesTotal: number;
    };
    totalChunks: number;
    progress?: {
        phase: string;
        currentStep: string;
        overallProgress: number;
        details?: Record<string, unknown>;
    } | null;
    jobStatus?: 'processing' | 'completed' | 'failed' | null;
    lastError?: string | null;
    lastResult?: unknown;
}

interface Step3IngestionProgressProps {
    status?: SetupStatusData;
    setupStartedAt?: string | null;
    isStarting: boolean;
    onStart: () => void;
    onBack: () => void;
    onNext: () => void;
}

function hasHistoricalSetupData(status?: SetupStatusData): boolean {
    if (!status) return false;
    return (
        status.documentsChunked > 0
        || status.wikiPagesChunked > 0
        || status.totalChunks > 0
        || status.hasProjectContext
        || (typeof status.progress?.overallProgress === 'number' && status.progress.overallProgress > 0)
    );
}

function resolveDisplayedStatus(status?: SetupStatusData): 'processing' | 'completed' | 'failed' | 'partial' | 'not_started' {
    if (!status) return 'not_started';
    if (status.jobStatus === 'processing') return 'processing';
    if (status.jobStatus === 'failed') return 'failed';
    if (status.jobStatus === 'completed' || status.isSetupComplete) return 'completed';
    if (hasHistoricalSetupData(status)) return 'partial';
    return 'not_started';
}

function computeProgress(status?: SetupStatusData): number {
    if (!status) return 0;
    const displayedStatus = resolveDisplayedStatus(status);

    if (displayedStatus === 'completed') return 100;
    if (displayedStatus !== 'processing') return 0;

    if (typeof status.progress?.overallProgress === 'number') {
        return Math.max(0, Math.min(100, status.progress.overallProgress));
    }

    const docsRatio = status.documentsTotal > 0 ? status.documentsChunked / status.documentsTotal : 0;
    const docsProgress = Math.min(60, Math.round(docsRatio * 60));

    let wikiProgress = 0;
    if (status.documentsTotal > 0 && status.wikiPagesChunked > 0) {
        wikiProgress = 20;
    }

    const contextProgress = status.hasProjectContext ? 20 : 0;

    return Math.min(95, docsProgress + wikiProgress + contextProgress);
}

export function Step3IngestionProgress({
    status,
    setupStartedAt,
    isStarting,
    onStart,
    onBack,
    onNext,
}: Step3IngestionProgressProps) {
    const progress = computeProgress(status);
    const displayedStatus = resolveDisplayedStatus(status);
    const displayedStatusText = (() => {
        if (displayedStatus === 'processing') return 'processando';
        if (displayedStatus === 'completed') return 'concluido';
        if (displayedStatus === 'failed') return 'falhou';
        if (displayedStatus === 'partial') return 'parcial';
        return 'nao iniciado';
    })();
    const canAdvance = status?.jobStatus === 'completed' || status?.isSetupComplete || status?.hasProjectContext;
    const elapsed = setupStartedAt
        ? formatDistanceToNow(new Date(setupStartedAt), { addSuffix: false, locale: ptBR })
        : '-';
    const currentStepText = (() => {
        if (displayedStatus === 'processing') {
            return status?.progress?.currentStep || 'Processando setup';
        }
        if (displayedStatus === 'completed') {
            return 'Setup concluido.';
        }
        if (displayedStatus === 'failed') {
            return status?.lastError || 'Falha no setup. Revise o erro e tente novamente.';
        }
        if (displayedStatus === 'partial') {
            return 'Dados parciais detectados. Clique em "Iniciar Setup" para consolidar o processamento.';
        }
        return 'Aguardando inicio do processamento';
    })();
    const embeddingCost = (() => {
        if (!status?.lastResult || typeof status.lastResult !== 'object') {
            return undefined;
        }

        const root = status.lastResult as { stats?: { embeddingCost?: number } };
        return root.stats?.embeddingCost;
    })();

    return (
        <Card>
            <CardHeader>
                <CardTitle>Progresso da Ingestao</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="rounded border bg-muted/30 p-3">
                    <div className="mb-2 flex items-center justify-between text-sm">
                        <span>Status: {displayedStatusText}</span>
                        <span>{progress}%</span>
                    </div>
                    <Progress value={progress} />
                    <p className="mt-2 text-xs text-muted-foreground">{currentStepText}</p>
                </div>

                <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
                    <div className="rounded border p-3 text-sm">
                        <p className="text-xs text-muted-foreground">Work items</p>
                        <p className="font-semibold">{status?.operationalData?.workItemsTotal ?? 0}</p>
                    </div>
                    <div className="rounded border p-3 text-sm">
                        <p className="text-xs text-muted-foreground">Sprints</p>
                        <p className="font-semibold">{status?.operationalData?.sprintsTotal ?? 0}</p>
                    </div>
                    <div className="rounded border p-3 text-sm">
                        <p className="text-xs text-muted-foreground">Membros do time</p>
                        <p className="font-semibold">{status?.operationalData?.teamMembersTotal ?? 0}</p>
                    </div>
                    <div className="rounded border p-3 text-sm">
                        <p className="text-xs text-muted-foreground">Capacidades</p>
                        <p className="font-semibold">{status?.operationalData?.capacitiesTotal ?? 0}</p>
                    </div>
                </div>

                <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
                    <div className="rounded border p-3 text-sm">
                        <p className="text-xs text-muted-foreground">Documentos processados</p>
                        <p className="font-semibold">{status?.documentsChunked ?? 0}/{status?.documentsTotal ?? 0}</p>
                    </div>
                    <div className="rounded border p-3 text-sm">
                        <p className="text-xs text-muted-foreground">Paginas wiki com chunks</p>
                        <p className="font-semibold">{status?.wikiPagesChunked ?? 0}</p>
                    </div>
                    <div className="rounded border p-3 text-sm">
                        <p className="text-xs text-muted-foreground">Total de chunks</p>
                        <p className="font-semibold">{status?.totalChunks ?? 0}</p>
                    </div>
                    <div className="rounded border p-3 text-sm">
                        <p className="text-xs text-muted-foreground">Tempo decorrido</p>
                        <p className="font-semibold">{elapsed}</p>
                    </div>
                </div>

                {embeddingCost !== undefined && (
                    <p className="text-sm text-muted-foreground">
                        Custo estimado de embeddings: ${embeddingCost.toFixed(6)}
                    </p>
                )}

                {status?.lastError && (
                    <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                        {status.lastError}
                    </div>
                )}

                <div className="flex justify-between">
                    <Button variant="outline" onClick={onBack}>Voltar</Button>
                    <div className="flex gap-2">
                        <Button onClick={onStart} disabled={isStarting || status?.jobStatus === 'processing'}>
                            {isStarting || status?.jobStatus === 'processing' ? 'Processando...' : 'Iniciar Setup'}
                        </Button>
                        <Button onClick={onNext} disabled={!canAdvance}>Proximo</Button>
                    </div>
                </div>
            </CardContent>
        </Card>
    );
}
