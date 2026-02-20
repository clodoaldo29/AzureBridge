import { type ComponentType, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CalendarDays, CheckCircle2, ClipboardCheck, Cog, Download, FileCheck2, FileText, FolderKanban, PlayCircle, Settings, UserCheck2 } from 'lucide-react';
import { api } from '@/services/api';
import type { Project } from '@/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ProjectSetupWizard } from '@/pages/RDA/components/project-setup/ProjectSetupWizard';
import { useSetupStatus } from '@/pages/RDA/hooks/useProjectSetup';
import { useMonthlySnapshots, usePreparationStatus, useStartPreparation } from '@/pages/RDA/hooks/useMonthlyPreparation';
import { PreflightPanel } from '@/pages/RDA/components/preflight/PreflightPanel';
import { useGenerationsList } from '@/pages/RDA/hooks/useGeneration';
import { GenerationPanel } from '@/pages/RDA/components/generation/GenerationPanel';
import { ReviewPanel } from '@/pages/RDA/components/review/ReviewPanel';
import { toast } from '@/hooks/use-toast';

type WorkflowStage = 'setup' | 'monthly' | 'preflight' | 'generation' | 'review' | 'finalization';

interface SetupAvailabilityItem {
    projectId: string;
    projectName: string;
    contextProjectName?: string;
    isSetupComplete: boolean;
    hasProjectContext: boolean;
    totalChunks: number;
    jobStatus: string | null;
    lastUpdated?: string;
}

const STAGES: Array<{ key: WorkflowStage; label: string; icon: ComponentType<{ className?: string }> }> = [
    { key: 'setup', label: 'Setup do Projeto', icon: Settings },
    { key: 'monthly', label: 'Preparacao Mensal', icon: CalendarDays },
    { key: 'preflight', label: 'Preflight', icon: ClipboardCheck },
    { key: 'generation', label: 'Geracao do RDA', icon: PlayCircle },
    { key: 'review', label: 'Revisao Humana', icon: UserCheck2 },
    { key: 'finalization', label: 'Finalizacao', icon: FileCheck2 },
];

const MONTH_OPTIONS = [
    { value: 1, label: 'Janeiro' },
    { value: 2, label: 'Fevereiro' },
    { value: 3, label: 'Marco' },
    { value: 4, label: 'Abril' },
    { value: 5, label: 'Maio' },
    { value: 6, label: 'Junho' },
    { value: 7, label: 'Julho' },
    { value: 8, label: 'Agosto' },
    { value: 9, label: 'Setembro' },
    { value: 10, label: 'Outubro' },
    { value: 11, label: 'Novembro' },
    { value: 12, label: 'Dezembro' },
];

function periodFromDate(value: string): string {
    const date = new Date(value);
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    return `${date.getUTCFullYear()}-${month}`;
}

function periodLabel(period: string): string {
    const [yearText, monthText] = period.split('-');
    const year = Number(yearText);
    const month = Number(monthText);
    const monthLabel = MONTH_OPTIONS.find((item) => item.value === month)?.label;
    if (!monthLabel || !Number.isFinite(year)) return period;
    return `${monthLabel}/${year}`;
}

function statusBadge(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
    if (status === 'completed' || status === 'ready') return 'default';
    if (status === 'failed' || status === 'cancelled') return 'destructive';
    if (status === 'processing' || status === 'collecting' || status === 'queued') return 'secondary';
    return 'outline';
}

export function RDAWorkflowV2() {
    const [activeStage, setActiveStage] = useState<WorkflowStage>('setup');
    const [selectedProjectId, setSelectedProjectId] = useState<string>('');
    const [selectedMonthlyPeriod, setSelectedMonthlyPeriod] = useState<string>('');
    const [selectedPreflightPeriod, setSelectedPreflightPeriod] = useState<string>('');
    const [selectedGenerationId, setSelectedGenerationId] = useState<string>('');
    const [selectedReviewGenerationId, setSelectedReviewGenerationId] = useState<string>('');
    const [selectedFinalGenerationId, setSelectedFinalGenerationId] = useState<string>('');

    const [monthlyMonth, setMonthlyMonth] = useState<number>(new Date().getMonth() + 1);
    const [monthlyYear, setMonthlyYear] = useState<number>(new Date().getFullYear());
    const [includeWiki, setIncludeWiki] = useState(true);
    const [includeOperationalSync, setIncludeOperationalSync] = useState(true);
    const [refreshProjectContext, setRefreshProjectContext] = useState(true);

    const startMonthlyMutation = useStartPreparation();
    const setupStatusQuery = useSetupStatus(selectedProjectId, true);
    const monthlySnapshotsQuery = useMonthlySnapshots(selectedProjectId);
    const monthlyStatusQuery = usePreparationStatus(
        selectedProjectId,
        selectedMonthlyPeriod,
        Boolean(selectedProjectId && selectedMonthlyPeriod),
    );
    const generationsQuery = useGenerationsList(selectedProjectId);

    const { data: projectsResponse } = useQuery<{ data: Project[] }>({
        queryKey: ['projects'],
        queryFn: async () => {
            const response = await api.get('/projects');
            return response.data;
        },
    });
    const projects = projectsResponse?.data ?? [];

    const { data: availableSetups = [], isLoading: loadingSetups } = useQuery<SetupAvailabilityItem[]>({
        queryKey: ['rda-available-setups'],
        enabled: activeStage === 'setup' || activeStage === 'monthly',
        retry: 1,
        staleTime: 30_000,
        queryFn: async () => {
            const response = await api.get<{ success: boolean; data: SetupAvailabilityItem[] }>(
                '/rda/setup/available',
                { timeout: 12_000 },
            );
            return response.data?.data ?? [];
        },
    });

    const monthlySnapshots = (monthlySnapshotsQuery.data ?? []) as Array<Record<string, unknown>>;
    const generations = generationsQuery.data?.items ?? [];

    const completedGenerations = useMemo(
        () => generations.filter((item) => item.status === 'completed'),
        [generations],
    );

    const startMonthlyPreparation = async () => {
        if (!selectedProjectId) return;

        const result = await startMonthlyMutation.mutateAsync({
            projectId: selectedProjectId,
            period: { month: monthlyMonth, year: monthlyYear },
            includeWiki,
            includeOperationalSync,
            refreshProjectContext,
            syncMode: 'incremental',
        });

        setSelectedMonthlyPeriod(result.periodKey);
        setSelectedPreflightPeriod(result.periodKey);
        setActiveStage('preflight');
        toast({
            title: 'Preparacao iniciada',
            description: `Periodo ${result.periodKey} criado com sucesso.`,
        });
    };

    const handleDownloadFinal = async () => {
        if (!selectedProjectId || !selectedFinalGenerationId) return;
        const response = await api.get(`/rda/review/${selectedProjectId}/${selectedFinalGenerationId}/download`, {
            responseType: 'blob',
        });
        const blob = new Blob([response.data], {
            type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `rda-final-${selectedFinalGenerationId}.docx`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
    };

    return (
        <div className="space-y-4">
            <Card className="border-slate-200 bg-gradient-to-r from-slate-50 to-white">
                <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                        <FolderKanban className="h-4 w-4 text-blue-600" />
                        Timeline de Execucao RDA
                    </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                    <div className="grid gap-2 md:grid-cols-3 lg:grid-cols-6">
                        {STAGES.map((stage) => {
                            const Icon = stage.icon;
                            return (
                                <button
                                    key={stage.key}
                                    className={`rounded-md border px-3 py-2 text-left text-sm transition-colors ${activeStage === stage.key ? 'border-blue-500 bg-blue-50 shadow-sm' : 'border-slate-200 bg-white hover:bg-slate-50'}`}
                                    onClick={() => setActiveStage(stage.key)}
                                >
                                    <div className="flex items-center justify-between gap-2">
                                        <span className="font-medium">{stage.label}</span>
                                        <Icon className="h-4 w-4 text-slate-500" />
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                    <p className="text-sm text-muted-foreground">
                        Escolha um item por etapa e avance no fluxo com rastreabilidade.
                    </p>
                </CardContent>
            </Card>

            {activeStage === 'setup' && (
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-base">
                            <Settings className="h-4 w-4 text-blue-600" />
                            Setup do Projeto
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="space-y-2 rounded-md border border-blue-100 bg-blue-50/40 p-3">
                            <p className="text-sm font-semibold text-blue-900">Passo a passo do setup</p>
                            <div className="grid gap-2 md:grid-cols-4">
                                <div className="rounded border bg-white px-3 py-2 text-xs">
                                    <p className="font-medium">Escolher projeto</p>
                                    <p className="text-muted-foreground">Defina o projeto que sera preparado.</p>
                                </div>
                                <div className="rounded border bg-white px-3 py-2 text-xs">
                                    <p className="font-medium">Ingestao de base</p>
                                    <p className="text-muted-foreground">Documentos, wiki e dados operacionais.</p>
                                </div>
                                <div className="rounded border bg-white px-3 py-2 text-xs">
                                    <p className="font-medium">Revisao de contexto</p>
                                    <p className="text-muted-foreground">Valide e ajuste o contexto do projeto.</p>
                                </div>
                                <div className="rounded border bg-white px-3 py-2 text-xs">
                                    <p className="font-medium">Avancar manualmente</p>
                                    <p className="text-muted-foreground">Siga para Preparacao Mensal quando quiser.</p>
                                </div>
                            </div>
                        </div>

                        <div className="space-y-3 rounded-md border p-3">
                            <p className="text-sm font-semibold">Novo setup</p>
                            <div className="grid gap-3 md:grid-cols-4">
                                <label className="space-y-1 text-sm md:col-span-2">
                                    <span>Projeto</span>
                                    <select
                                        className="w-full rounded border px-2 py-2"
                                        value={selectedProjectId}
                                        onChange={(event) => {
                                            setSelectedProjectId(event.target.value);
                                            setSelectedMonthlyPeriod('');
                                            setSelectedPreflightPeriod('');
                                            setSelectedGenerationId('');
                                            setSelectedReviewGenerationId('');
                                            setSelectedFinalGenerationId('');
                                        }}
                                    >
                                        <option value="">Selecione um projeto</option>
                                        {projects.map((project) => (
                                            <option key={project.id} value={project.id}>{project.name}</option>
                                        ))}
                                    </select>
                                </label>
                                <div className="rounded border px-3 py-2 text-sm">
                                    <p className="text-muted-foreground">Status setup</p>
                                    <p className="font-semibold">{setupStatusQuery.data?.jobStatus ?? 'idle'}</p>
                                </div>
                                <div className="rounded border px-3 py-2 text-sm">
                                    <p className="text-muted-foreground">Chunks totais</p>
                                    <p className="font-semibold">{setupStatusQuery.data?.totalChunks ?? 0}</p>
                                </div>
                            </div>
                        </div>

                        {selectedProjectId ? (
                            <>
                                <ProjectSetupWizard
                                    projectId={selectedProjectId}
                                    onGoToMonthly={() => setActiveStage('monthly')}
                                />
                                {setupStatusQuery.data?.jobStatus === 'completed' && (
                                    <div className="flex items-center justify-end">
                                        <Button onClick={() => setActiveStage('monthly')}>
                                            Avancar para Preparacao Mensal
                                        </Button>
                                    </div>
                                )}
                            </>
                        ) : (
                            <p className="text-sm text-muted-foreground">Selecione um projeto para iniciar ou atualizar o setup.</p>
                        )}

                        <div className="space-y-2 rounded-md border p-3">
                            <p className="text-sm font-semibold">Setups disponiveis</p>
                            {loadingSetups && <p className="text-sm text-muted-foreground">Carregando setups...</p>}
                            {!loadingSetups && availableSetups.length === 0 && (
                                <p className="text-sm text-muted-foreground">Nenhum setup pronto encontrado ainda.</p>
                            )}
                            {availableSetups.map((setup) => (
                                <div key={setup.projectId} className="flex items-center justify-between rounded border px-3 py-2 text-sm">
                                    <div className="flex items-center gap-2">
                                        <Cog className="h-4 w-4 text-slate-500" />
                                        <span>{setup.projectName}</span>
                                        <Badge variant="default">setup pronto</Badge>
                                        <span className="text-muted-foreground">{setup.totalChunks} chunks</span>
                                    </div>
                                    <Button
                                        variant={selectedProjectId === setup.projectId ? 'default' : 'outline'}
                                        size="sm"
                                        onClick={() => {
                                            setSelectedProjectId(setup.projectId);
                                            setSelectedMonthlyPeriod('');
                                            setSelectedPreflightPeriod('');
                                            setSelectedGenerationId('');
                                            setSelectedReviewGenerationId('');
                                            setSelectedFinalGenerationId('');
                                        }}
                                    >
                                        {selectedProjectId === setup.projectId ? 'Selecionado' : 'Usar setup'}
                                    </Button>
                                </div>
                            ))}
                        </div>
                    </CardContent>
                </Card>
            )}

            {activeStage === 'monthly' && (
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-base">
                            <CalendarDays className="h-4 w-4 text-blue-600" />
                            Preparacao Mensal
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="space-y-2">
                            <p className="text-sm font-medium">Setups disponiveis</p>
                            {loadingSetups && <p className="text-sm text-muted-foreground">Carregando setups...</p>}
                            {!loadingSetups && availableSetups.length === 0 && (
                                <p className="text-sm text-muted-foreground">Nenhum setup pronto encontrado. Finalize um setup na etapa Setup do Projeto.</p>
                            )}
                            {availableSetups.map((setup) => (
                                <div key={setup.projectId} className="flex items-center justify-between rounded border px-3 py-2 text-sm">
                                    <div className="flex items-center gap-2">
                                        <Cog className="h-4 w-4 text-slate-500" />
                                        <span>{setup.projectName}</span>
                                        <Badge variant="default">setup pronto</Badge>
                                        <span className="text-muted-foreground">{setup.totalChunks} chunks</span>
                                    </div>
                                    <Button
                                        variant={selectedProjectId === setup.projectId ? 'default' : 'outline'}
                                        size="sm"
                                        onClick={() => {
                                            setSelectedProjectId(setup.projectId);
                                            setSelectedMonthlyPeriod('');
                                            setSelectedPreflightPeriod('');
                                            setSelectedGenerationId('');
                                            setSelectedReviewGenerationId('');
                                            setSelectedFinalGenerationId('');
                                        }}
                                    >
                                        {selectedProjectId === setup.projectId ? 'Selecionado' : 'Usar setup'}
                                    </Button>
                                </div>
                            ))}
                        </div>

                        {!selectedProjectId && (
                            <p className="text-sm text-muted-foreground">Selecione um setup acima para criar a preparacao mensal.</p>
                        )}
                        {selectedProjectId && (
                            <>
                                <div className="grid gap-3 md:grid-cols-4">
                                    <label className="space-y-1 text-sm">
                                        <span>Mes</span>
                                        <select className="w-full rounded border px-2 py-2" value={monthlyMonth} onChange={(event) => setMonthlyMonth(Number(event.target.value))}>
                                            {MONTH_OPTIONS.map((month) => (
                                                <option key={month.value} value={month.value}>{month.label}</option>
                                            ))}
                                        </select>
                                    </label>
                                    <label className="space-y-1 text-sm">
                                        <span>Ano</span>
                                        <select className="w-full rounded border px-2 py-2" value={monthlyYear} onChange={(event) => setMonthlyYear(Number(event.target.value))}>
                                            {[new Date().getFullYear(), new Date().getFullYear() - 1].map((value) => (
                                                <option key={value} value={value}>{value}</option>
                                            ))}
                                        </select>
                                    </label>
                                    <label className="flex items-center gap-2 text-sm">
                                        <input type="checkbox" checked={includeOperationalSync} onChange={(event) => setIncludeOperationalSync(event.target.checked)} />
                                        Sincronizar dados operacionais
                                    </label>
                                    <label className="flex items-center gap-2 text-sm">
                                        <input type="checkbox" checked={includeWiki} onChange={(event) => setIncludeWiki(event.target.checked)} />
                                        Sincronizar wiki
                                    </label>
                                </div>
                                <label className="flex items-center gap-2 text-sm">
                                    <input type="checkbox" checked={refreshProjectContext} onChange={(event) => setRefreshProjectContext(event.target.checked)} />
                                    Atualizar contexto do projeto via IA
                                </label>
                                <div className="flex gap-2">
                                    <Button onClick={startMonthlyPreparation} disabled={startMonthlyMutation.isPending}>
                                        {startMonthlyMutation.isPending ? 'Executando...' : 'Criar preparacao mensal'}
                                    </Button>
                                    {selectedMonthlyPeriod && (
                                        <Button variant="outline" onClick={() => setActiveStage('preflight')}>
                                            Ir para Preflight
                                        </Button>
                                    )}
                                </div>
                                <div className="space-y-2">
                                    <p className="text-sm font-medium">Preparacoes existentes</p>
                                    {monthlySnapshots.length === 0 && <p className="text-sm text-muted-foreground">Nenhuma preparacao mensal encontrada.</p>}
                                    {monthlySnapshots.map((snapshot) => {
                                        const period = String(snapshot.period ?? '');
                                        const status = String(snapshot.status ?? 'collecting');
                                        return (
                                            <div key={String(snapshot.id)} className="flex items-center justify-between rounded border px-3 py-2 text-sm">
                                                <div className="flex items-center gap-2">
                                                    <Cog className="h-4 w-4 text-slate-500" />
                                                    <span>{periodLabel(period)}</span>
                                                    <Badge variant={statusBadge(status)}>{status}</Badge>
                                                </div>
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    onClick={() => {
                                                        setSelectedMonthlyPeriod(period);
                                                        setSelectedPreflightPeriod(period);
                                                    }}
                                                >
                                                    Selecionar
                                                </Button>
                                            </div>
                                        );
                                    })}
                                </div>
                                {selectedMonthlyPeriod && (
                                    <div className="rounded border bg-muted/30 px-3 py-2 text-sm">
                                        Periodo ativo na etapa: <b>{periodLabel(selectedMonthlyPeriod)}</b>
                                        {monthlyStatusQuery.data && (
                                            <span className="ml-2 text-muted-foreground">({monthlyStatusQuery.data.status} - {Math.round(monthlyStatusQuery.data.progress)}%)</span>
                                        )}
                                    </div>
                                )}
                            </>
                        )}
                    </CardContent>
                </Card>
            )}

            {activeStage === 'preflight' && (
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-base">
                            <ClipboardCheck className="h-4 w-4 text-blue-600" />
                            Preflight
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        {!selectedProjectId && <p className="text-sm text-muted-foreground">Selecione um projeto no Setup.</p>}
                        {selectedProjectId && (
                            <>
                                <div className="space-y-2">
                                    <p className="text-sm font-medium">Escolha uma preparacao para validar</p>
                                    <div className="flex flex-wrap gap-2">
                                        {monthlySnapshots.map((snapshot) => {
                                            const period = String(snapshot.period ?? '');
                                            return (
                                                <Button
                                                    key={String(snapshot.id)}
                                                    variant={selectedPreflightPeriod === period ? 'default' : 'outline'}
                                                    size="sm"
                                                    onClick={() => setSelectedPreflightPeriod(period)}
                                                >
                                                    {period}
                                                </Button>
                                            );
                                        })}
                                    </div>
                                </div>

                                {selectedPreflightPeriod ? (
                                    <PreflightPanel
                                        projectId={selectedProjectId}
                                        period={{
                                            month: Number(selectedPreflightPeriod.split('-')[1]),
                                            year: Number(selectedPreflightPeriod.split('-')[0]),
                                        }}
                                        onGenerationReady={(generationId) => {
                                            setSelectedGenerationId(generationId);
                                            setSelectedReviewGenerationId(generationId);
                                            setSelectedFinalGenerationId(generationId);
                                            setActiveStage('generation');
                                        }}
                                    />
                                ) : (
                                    <p className="text-sm text-muted-foreground">Selecione um periodo para executar o preflight.</p>
                                )}
                            </>
                        )}
                    </CardContent>
                </Card>
            )}

            {activeStage === 'generation' && (
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-base">
                            <PlayCircle className="h-4 w-4 text-blue-600" />
                            Geracao do RDA
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        {!selectedProjectId && <p className="text-sm text-muted-foreground">Selecione um projeto no Setup.</p>}
                        {selectedProjectId && (
                            <>
                                <div className="space-y-2">
                                    <p className="text-sm font-medium">Geracoes do projeto</p>
                                    {generations.length === 0 && <p className="text-sm text-muted-foreground">Nenhuma geracao encontrada.</p>}
                                    {generations.map((item) => (
                                        <div key={item.id} className="flex items-center justify-between rounded border px-3 py-2 text-sm">
                                            <div className="flex items-center gap-2">
                                                <FileText className="h-4 w-4 text-slate-500" />
                                                <span>{item.id.slice(0, 8)}...</span>
                                                <span className="text-muted-foreground">{periodFromDate(item.periodStart)}</span>
                                                <Badge variant={statusBadge(item.status)}>{item.status}</Badge>
                                            </div>
                                            <Button variant="outline" size="sm" onClick={() => setSelectedGenerationId(item.id)}>Selecionar</Button>
                                        </div>
                                    ))}
                                </div>

                                {selectedGenerationId && (
                                    <GenerationPanel
                                        projectId={selectedProjectId}
                                        generationId={selectedGenerationId}
                                        onReviewClick={(generationId) => {
                                            setSelectedReviewGenerationId(generationId);
                                            setSelectedFinalGenerationId(generationId);
                                            setActiveStage('review');
                                        }}
                                    />
                                )}
                            </>
                        )}
                    </CardContent>
                </Card>
            )}

            {activeStage === 'review' && (
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-base">
                            <UserCheck2 className="h-4 w-4 text-blue-600" />
                            Revisao Humana
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        {!selectedProjectId && <p className="text-sm text-muted-foreground">Selecione um projeto no Setup.</p>}
                        {selectedProjectId && (
                            <>
                                <div className="space-y-2">
                                    <p className="text-sm font-medium">Escolha um RDA gerado para revisar</p>
                                    {completedGenerations.length === 0 && <p className="text-sm text-muted-foreground">Nenhuma geracao concluida para revisar.</p>}
                                    {completedGenerations.map((item) => (
                                        <div key={item.id} className="flex items-center justify-between rounded border px-3 py-2 text-sm">
                                            <div className="flex items-center gap-2">
                                                <UserCheck2 className="h-4 w-4 text-slate-500" />
                                                <span>{item.id.slice(0, 8)}...</span>
                                                <span className="text-muted-foreground">{periodFromDate(item.periodStart)}</span>
                                            </div>
                                            <Button variant="outline" size="sm" onClick={() => setSelectedReviewGenerationId(item.id)}>
                                                Revisar
                                            </Button>
                                        </div>
                                    ))}
                                </div>

                                {selectedReviewGenerationId && (
                                    <ReviewPanel
                                        projectId={selectedProjectId}
                                        generationId={selectedReviewGenerationId}
                                        onClose={() => setSelectedReviewGenerationId('')}
                                    />
                                )}
                            </>
                        )}
                    </CardContent>
                </Card>
            )}

            {activeStage === 'finalization' && (
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-base">
                            <Download className="h-4 w-4 text-blue-600" />
                            Finalizacao e Download
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        {!selectedProjectId && <p className="text-sm text-muted-foreground">Selecione um projeto no Setup.</p>}
                        {selectedProjectId && (
                            <>
                                <div className="space-y-2">
                                    <p className="text-sm font-medium">RDAs disponiveis para finalizacao/download</p>
                                    {completedGenerations.length === 0 && <p className="text-sm text-muted-foreground">Nenhum RDA finalizado encontrado.</p>}
                                    {completedGenerations.map((item) => (
                                        <div key={item.id} className="flex items-center justify-between rounded border px-3 py-2 text-sm">
                                            <div className="flex items-center gap-2">
                                                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                                                <span>{item.id.slice(0, 8)}...</span>
                                                <span className="text-muted-foreground">{periodFromDate(item.periodStart)}</span>
                                            </div>
                                            <Button variant="outline" size="sm" onClick={() => setSelectedFinalGenerationId(item.id)}>Selecionar</Button>
                                        </div>
                                    ))}
                                </div>

                                <div className="rounded border bg-muted/30 px-3 py-2 text-sm">
                                    RDA selecionado: <b>{selectedFinalGenerationId || 'nenhum'}</b>
                                </div>

                                <div className="flex gap-2">
                                    <Button onClick={handleDownloadFinal} disabled={!selectedFinalGenerationId}>
                                        <Download className="mr-2 h-4 w-4" />
                                        Baixar RDA final
                                    </Button>
                                </div>
                            </>
                        )}
                    </CardContent>
                </Card>
            )}
        </div>
    );
}
