import { useMemo, useState } from 'react';
import { CalendarDays, CheckCircle2, Clock3, DatabaseZap, Plus, RefreshCw, XCircle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
    getApiErrorMessage,
    useDeletePreparation,
    useMonthlySnapshots,
    usePreparationStatus,
    useStartPreparation,
    toPeriodKey,
} from '@/pages/RDA/hooks/useMonthlyPreparation';
import { GenerationReadinessIndicator } from '@/pages/RDA/components/preflight/GenerationReadinessIndicator';
import { PreflightPanel } from '@/pages/RDA/components/preflight/PreflightPanel';
import { GenerationPanel } from '@/pages/RDA/components/generation/GenerationPanel';
import { ReviewPanel } from '@/pages/RDA/components/review/ReviewPanel';
import { toast } from '@/hooks/use-toast';

interface MonthlyPreparationPanelProps {
    projectId: string;
}

interface SnapshotRow {
    id: string;
    period: string;
    status: 'collecting' | 'ready' | 'failed';
    workItemsTotal: number;
    sprintsCount: number;
    chunksCreated: number;
    updatedAt: string;
}

const MONTHS = [
    'Janeiro',
    'Fevereiro',
    'Marco',
    'Abril',
    'Maio',
    'Junho',
    'Julho',
    'Agosto',
    'Setembro',
    'Outubro',
    'Novembro',
    'Dezembro',
];

function toSnapshotRow(input: Record<string, unknown>): SnapshotRow {
    return {
        id: String(input.id ?? ''),
        period: String(input.period ?? ''),
        status: (String(input.status ?? 'failed') as SnapshotRow['status']),
        workItemsTotal: Number(input.workItemsTotal ?? 0),
        sprintsCount: Number(input.sprintsCount ?? 0),
        chunksCreated: Number(input.chunksCreated ?? 0),
        updatedAt: String(input.updatedAt ?? new Date().toISOString()),
    };
}

export function MonthlyPreparationPanel({ projectId }: MonthlyPreparationPanelProps) {
    const now = new Date();
    const [month, setMonth] = useState(now.getMonth() + 1);
    const [year, setYear] = useState(now.getFullYear());
    const [includeWiki, setIncludeWiki] = useState(true);
    const [includeOperationalSync, setIncludeOperationalSync] = useState(true);
    const [syncMode, setSyncMode] = useState<'none' | 'incremental' | 'full'>('incremental');
    const [forceReprocess, setForceReprocess] = useState(false);
    const [refreshProjectContext, setRefreshProjectContext] = useState(true);
    const [trackingPeriod, setTrackingPeriod] = useState('');
    const [generationId, setGenerationId] = useState<string | null>(null);
    const [reviewGenerationId, setReviewGenerationId] = useState<string | null>(null);
    const [showNewSetupForm, setShowNewSetupForm] = useState(true);

    const periodKey = toPeriodKey({ month, year });

    const startMutation = useStartPreparation();
    const snapshotsQuery = useMonthlySnapshots(projectId);
    const deleteMutation = useDeletePreparation(projectId);
    const statusQuery = usePreparationStatus(projectId, trackingPeriod, Boolean(projectId && trackingPeriod));

    const snapshots = useMemo(
        () => ((snapshotsQuery.data ?? []) as Array<Record<string, unknown>>).map(toSnapshotRow),
        [snapshotsQuery.data],
    );
    const snapshotsSummary = useMemo(() => ({
        total: snapshots.length,
        ready: snapshots.filter((item) => item.status === 'ready').length,
        collecting: snapshots.filter((item) => item.status === 'collecting').length,
        failed: snapshots.filter((item) => item.status === 'failed').length,
    }), [snapshots]);

    const currentStatus = statusQuery.data;
    const progress = Number(currentStatus?.progress ?? 0);
    const trackedPeriodConfig = trackingPeriod
        ? (() => {
            const [yearRaw, monthRaw] = trackingPeriod.split('-');
            const parsedYear = Number(yearRaw);
            const parsedMonth = Number(monthRaw);
            if (!Number.isInteger(parsedYear) || !Number.isInteger(parsedMonth)) {
                return null;
            }
            return { year: parsedYear, month: parsedMonth };
        })()
        : null;

    const startPreparation = async () => {
        setTrackingPeriod(periodKey);
        try {
            const result = await startMutation.mutateAsync({
                projectId,
                period: { month, year },
                includeWiki,
                includeOperationalSync,
                syncMode,
                forceReprocessChunks: forceReprocess,
                forceReprocess,
                refreshProjectContext,
            });

            setTrackingPeriod(result.periodKey);
            setGenerationId(null);
            setReviewGenerationId(null);
            setShowNewSetupForm(false);
            await Promise.all([snapshotsQuery.refetch(), statusQuery.refetch()]);
        } catch (error: unknown) {
            const message = getApiErrorMessage(error);
            toast({
                title: 'Erro ao iniciar',
                description: message,
                variant: 'destructive',
            });
        }
    };

    const renderStatusIcon = (status: string) => {
        if (status === 'done' || status === 'ready') {
            return <CheckCircle2 className="h-4 w-4 text-emerald-600" />;
        }
        if (status === 'collecting') {
            return <RefreshCw className="h-4 w-4 animate-spin text-blue-600" />;
        }
        if (status === 'error' || status === 'failed') {
            return <XCircle className="h-4 w-4 text-red-600" />;
        }
        return <Clock3 className="h-4 w-4 text-slate-500" />;
    };

    const applyPeriod = (period: string) => {
        const [yearRaw, monthRaw] = period.split('-');
        const parsedYear = Number(yearRaw);
        const parsedMonth = Number(monthRaw);
        if (Number.isInteger(parsedYear) && Number.isInteger(parsedMonth) && parsedMonth >= 1 && parsedMonth <= 12) {
            setYear(parsedYear);
            setMonth(parsedMonth);
        }

        setTrackingPeriod(period);
        setGenerationId(null);
        setReviewGenerationId(null);
        setShowNewSetupForm(false);
    };

    const startNewSetupFlow = () => {
        setTrackingPeriod('');
        setGenerationId(null);
        setReviewGenerationId(null);
        setShowNewSetupForm(true);
    };

    const cancelNewSetupFlow = () => {
        setShowNewSetupForm(false);
    };

    if (!projectId) {
        return (
            <Card>
                <CardContent className="p-4 text-sm text-muted-foreground">
                    Selecione um projeto na Etapa de geracao para iniciar a preparacao mensal.
                </CardContent>
            </Card>
        );
    }

    return (
        <div className="space-y-4">
            {snapshots.length > 0 && (
                <Card className="border-blue-100 bg-gradient-to-r from-blue-50/60 via-white to-white">
                    <CardHeader>
                        <CardTitle className="flex items-center justify-between gap-2 text-base">
                            <span className="flex items-center gap-2">
                                <CalendarDays className="h-4 w-4 text-blue-600" />
                                Ciclos Mensais Existentes
                            </span>
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3 text-sm">
                        <div className="grid gap-2 md:grid-cols-4">
                            <div className="rounded border px-3 py-2">Total: <b>{snapshotsSummary.total}</b></div>
                            <div className="rounded border px-3 py-2">Prontos: <b>{snapshotsSummary.ready}</b></div>
                            <div className="rounded border px-3 py-2">Coletando: <b>{snapshotsSummary.collecting}</b></div>
                            <div className="rounded border px-3 py-2">Falhos: <b>{snapshotsSummary.failed}</b></div>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                            <span className="text-muted-foreground">Continuar periodo:</span>
                            {snapshots.slice(0, 8).map((snapshot) => (
                                <Button
                                    key={snapshot.id}
                                    variant={trackingPeriod === snapshot.period ? 'default' : 'outline'}
                                    size="sm"
                                    onClick={() => applyPeriod(snapshot.period)}
                                >
                                    {snapshot.period}
                                </Button>
                            ))}
                        </div>
                    </CardContent>
                </Card>
            )}

            <Card className="border-sky-100 bg-gradient-to-r from-sky-50/50 via-white to-white">
                <CardHeader>
                    <CardTitle className="flex items-center justify-between gap-2 text-base">
                        <span className="flex items-center gap-2">
                        <DatabaseZap className="h-4 w-4 text-sky-600" />
                            Novo Ciclo Mensal
                        </span>
                        {showNewSetupForm ? (
                            snapshots.length > 0 ? (
                                <Button size="sm" variant="outline" onClick={cancelNewSetupFlow}>Cancelar</Button>
                            ) : null
                        ) : (
                            <Button size="sm" onClick={startNewSetupFlow}>
                                <Plus className="mr-1 h-4 w-4" />
                                Novo setup
                            </Button>
                        )}
                    </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    {!showNewSetupForm && (
                        <div className="rounded-md border bg-muted/30 p-3 text-sm">
                            <p className="font-medium">Modo acompanhamento de ciclo mensal</p>
                            <p className="text-muted-foreground">
                                Periodo selecionado: <b>{trackingPeriod || periodKey}</b>. Use <b>Novo setup</b> para criar outro ciclo.
                            </p>
                        </div>
                    )}

                    {showNewSetupForm && (
                        <>
                            <div className="grid gap-3 md:grid-cols-4">
                                <label className="space-y-1 text-sm">
                                    <span>Mes</span>
                                    <select className="w-full rounded border px-2 py-1" value={month} onChange={(e) => setMonth(Number(e.target.value))}>
                                        {MONTHS.map((label, index) => (
                                            <option key={label} value={index + 1}>{label}</option>
                                        ))}
                                    </select>
                                </label>

                                <label className="space-y-1 text-sm">
                                    <span>Ano</span>
                                    <select className="w-full rounded border px-2 py-1" value={year} onChange={(e) => setYear(Number(e.target.value))}>
                                        {[now.getFullYear(), now.getFullYear() - 1].map((value) => (
                                            <option key={value} value={value}>{value}</option>
                                        ))}
                                    </select>
                                </label>

                                <label className="space-y-1 text-sm">
                                    <span>Modo de sync</span>
                                    <select className="w-full rounded border px-2 py-1" value={syncMode} onChange={(e) => setSyncMode(e.target.value as 'none' | 'incremental' | 'full')}>
                                        <option value="incremental">Incremental</option>
                                        <option value="full">Completo</option>
                                        <option value="none">Sem sync operacional</option>
                                    </select>
                                </label>

                                <div className="flex items-end">
                                    <Button onClick={startPreparation} disabled={startMutation.isPending} className="w-full">
                                        {startMutation.isPending ? 'Executando...' : `Iniciar ${periodKey}`}
                                    </Button>
                                </div>
                            </div>

                            <div className="grid gap-2 text-sm md:grid-cols-2">
                                <label className="flex items-center gap-2">
                                    <input type="checkbox" checked={includeOperationalSync} onChange={(e) => setIncludeOperationalSync(e.target.checked)} />
                                    Sincronizar dados operacionais (work items, sprints, equipe)
                                </label>
                                <label className="flex items-center gap-2">
                                    <input type="checkbox" checked={includeWiki} onChange={(e) => setIncludeWiki(e.target.checked)} />
                                    Sincronizar wiki do projeto
                                </label>
                                <label className="flex items-center gap-2">
                                    <input type="checkbox" checked={refreshProjectContext} onChange={(e) => setRefreshProjectContext(e.target.checked)} />
                                    Atualizar contexto do projeto via IA
                                </label>
                                <label className="flex items-center gap-2">
                                    <input type="checkbox" checked={forceReprocess} onChange={(e) => setForceReprocess(e.target.checked)} />
                                    Reprocessar periodo (limpa snapshot e chunks mensais)
                                </label>
                            </div>
                        </>
                    )}

                    {trackingPeriod && !currentStatus && (
                        <div className="space-y-2 rounded-md border p-3 text-sm text-muted-foreground">
                            <p className="font-medium text-foreground">Aguardando status da preparação...</p>
                            <p>Periodo: {trackingPeriod}. O processo foi iniciado e o acompanhamento será exibido assim que o backend publicar o primeiro status.</p>
                        </div>
                    )}

                    {currentStatus && (
                        <div className="space-y-3 rounded-md border p-3">
                            <div className="flex items-center justify-between text-sm">
                                <div className="flex items-center gap-2">
                                    <CalendarDays className="h-4 w-4 text-sky-600" />
                                    <span>Periodo: {currentStatus.period}</span>
                                </div>
                                <Badge variant={currentStatus.status === 'ready' ? 'default' : currentStatus.status === 'failed' ? 'destructive' : 'secondary'}>
                                    {currentStatus.status}
                                </Badge>
                            </div>

                            <div className="h-2 w-full overflow-hidden rounded bg-slate-200">
                                <div className="h-full bg-blue-600 transition-all" style={{ width: `${progress}%` }} />
                            </div>

                            <p className="text-sm text-muted-foreground">{currentStatus.step}</p>

                            <div className="grid gap-2 md:grid-cols-2">
                                {[
                                    ['Work items', currentStatus.workItemsStatus],
                                    ['Sprints', currentStatus.sprintsStatus],
                                    ['Wiki', currentStatus.wikiStatus],
                                    ['Documentos', currentStatus.documentsStatus],
                                    ['Contexto', currentStatus.contextStatus],
                                ].map(([label, status]) => (
                                    <div key={label} className="flex items-center justify-between rounded border px-3 py-2 text-sm">
                                        <span>{label}</span>
                                        <span className="flex items-center gap-1">{renderStatusIcon(String(status))}{status}</span>
                                    </div>
                                ))}
                            </div>

                            <div className="grid gap-2 text-sm md:grid-cols-4">
                                <div className="rounded border px-3 py-2">WIs: <b>{currentStatus.counters.workItemsTotal}</b></div>
                                <div className="rounded border px-3 py-2">Sprints: <b>{currentStatus.counters.sprintsCount}</b></div>
                                <div className="rounded border px-3 py-2">Wiki atualizada: <b>{currentStatus.counters.wikiPagesUpdated}</b></div>
                                <div className="rounded border px-3 py-2">Chunks no mes: <b>{currentStatus.counters.chunksCreated}</b></div>
                            </div>

                            {currentStatus.errors.length > 0 && (
                                <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                                    <p className="font-medium">Alertas da preparacao</p>
                                    <ul className="list-disc pl-5">
                                        {currentStatus.errors.map((error) => (
                                            <li key={`${error.source}-${error.timestamp}`}>[{error.source}] {error.message}</li>
                                        ))}
                                    </ul>
                                </div>
                            )}
                        </div>
                    )}
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle className="text-base">Meses preparados</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                    {snapshots.length === 0 && <p className="text-sm text-muted-foreground">Nenhum snapshot mensal encontrado.</p>}
                    {snapshots.map((snapshot) => (
                        <div key={snapshot.id} className="flex items-center justify-between rounded border px-3 py-2 text-sm">
                            <div>
                                <p className="font-medium flex items-center gap-2">
                                    {renderStatusIcon(snapshot.status)}
                                    {snapshot.period}
                                </p>
                                <p className="text-xs text-muted-foreground">WIs {snapshot.workItemsTotal} • Sprints {snapshot.sprintsCount} • Chunks {snapshot.chunksCreated}</p>
                            </div>
                            <div className="flex items-center gap-2">
                                <GenerationReadinessIndicator
                                    projectId={projectId}
                                    period={snapshot.period}
                                    enabled={snapshot.status === 'ready'}
                                />
                                <Badge variant={snapshot.status === 'ready' ? 'default' : snapshot.status === 'failed' ? 'destructive' : 'secondary'}>
                                    {snapshot.status}
                                </Badge>
                                <Button variant="outline" size="sm" onClick={() => applyPeriod(snapshot.period)}>Continuar</Button>
                                <Button variant="outline" size="sm" onClick={() => deleteMutation.mutate({ period: snapshot.period })}>Remover</Button>
                            </div>
                        </div>
                    ))}
                </CardContent>
            </Card>

            {trackedPeriodConfig && currentStatus?.status === 'ready' && (
                <PreflightPanel
                    projectId={projectId}
                    period={trackedPeriodConfig}
                    onGenerationReady={(id) => setGenerationId(id)}
                />
            )}

            {generationId && (
                <div className="space-y-4">
                    <GenerationPanel
                        projectId={projectId}
                        generationId={generationId}
                        onReviewClick={(id) => setReviewGenerationId(id)}
                    />
                    {reviewGenerationId && (
                        <ReviewPanel
                            projectId={projectId}
                            generationId={reviewGenerationId}
                            onClose={() => setReviewGenerationId(null)}
                        />
                    )}
                </div>
            )}
        </div>
    );
}
