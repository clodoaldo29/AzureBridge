import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { useDownloadRDA, useRDAGeneration, useRetryRDA } from '@/services/queries/rda';
import { toast } from '@/hooks/use-toast';

interface Step4ProgressTrackingProps {
    generationId: string | null;
}

type PipelineStep = {
    key: string;
    label: string;
    agentName?: string;
};

const PIPELINE_STEPS: PipelineStep[] = [
    { key: 'syncing_wiki', label: 'Sincronizando Wiki' },
    { key: 'data_collection_start', label: 'Coleta de dados', agentName: 'DataCollectorAgent' },
    { key: 'analysis_start', label: 'Analise de dados', agentName: 'AnalyzerAgent' },
    { key: 'writing_start', label: 'Redacao do relatorio', agentName: 'WriterAgent' },
    { key: 'review_start', label: 'Revisao de qualidade', agentName: 'ReviewerAgent' },
    { key: 'formatting_start', label: 'Formatacao para DOCX', agentName: 'FormatterAgent' },
    { key: 'generating_docx', label: 'Gerando arquivo DOCX' },
    { key: 'completed', label: 'Concluido' },
];

const STEP_ALIASES: Record<string, string> = {
    collecting_data: 'data_collection_start',
    DataCollectorAgent: 'data_collection_done',
    AnalyzerAgent: 'analysis_done',
    WriterAgent: 'writing_done',
    ReviewerAgent: 'review_done',
    FormatterAgent: 'formatting_done',
};

const DONE_STEP_TO_START: Record<string, string> = {
    data_collection_done: 'data_collection_start',
    analysis_done: 'analysis_start',
    writing_done: 'writing_start',
    review_done: 'review_start',
    formatting_done: 'formatting_start',
};

function normalizeStep(currentStep?: string): string {
    if (!currentStep) {
        return 'syncing_wiki';
    }
    return STEP_ALIASES[currentStep] || currentStep;
}

function formatDuration(ms?: number): string {
    if (!ms || ms <= 0) {
        return '-';
    }
    const seconds = Math.round(ms / 1000);
    return `${seconds}s`;
}

export function Step4ProgressTracking({ generationId }: Step4ProgressTrackingProps) {
    const { data: generation } = useRDAGeneration(generationId, {
        refetchInterval: 1000,
        enabled: Boolean(generationId),
    });

    const downloadMutation = useDownloadRDA();
    const retryMutation = useRetryRDA();

    const elapsed = generation?.createdAt
        ? formatDistanceToNow(new Date(generation.createdAt), { addSuffix: false, locale: ptBR })
        : '-';

    const currentStep = normalizeStep(generation?.currentStep);
    const activeIndex = PIPELINE_STEPS.findIndex((step) => step.key === currentStep);
    const failed = generation?.status === 'failed';
    const completed = generation?.status === 'completed';

    const agentResults = generation?.partialResults || [];
    const successfulAgents = new Set(agentResults.filter((item) => item.success).map((item) => item.agentName));

    const currentAgent = PIPELINE_STEPS.find((step) => step.key === currentStep)?.agentName;

    const handleDownload = async () => {
        if (!generationId) {
            return;
        }

        try {
            await downloadMutation.mutateAsync(generationId);
            toast({
                title: 'Download concluido',
                description: 'Arquivo RDA baixado com sucesso.',
            });
        } catch {
            toast({
                title: 'Falha no download',
                description: 'Nao foi possivel baixar o arquivo.',
                variant: 'destructive',
            });
        }
    };

    const handleRetry = async () => {
        if (!generationId) {
            return;
        }

        try {
            await retryMutation.mutateAsync(generationId);
            toast({
                title: 'Retry iniciado',
                description: 'Nova tentativa de geracao iniciada.',
            });
        } catch {
            toast({
                title: 'Falha no retry',
                description: 'Nao foi possivel iniciar nova tentativa.',
                variant: 'destructive',
            });
        }
    };

    if (!generationId) {
        return (
            <Card>
                <CardHeader>
                    <CardTitle>Step 4: Progresso da Geracao</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm text-muted-foreground">
                    <p>Inicializando geracao do RDA...</p>
                    <Progress value={5} />
                </CardContent>
            </Card>
        );
    }

    return (
        <Card className="border-blue-100 bg-gradient-to-b from-blue-50/40 to-white">
            <CardHeader>
                <CardTitle className="flex items-center justify-between">
                    <span>Step 4: Progresso da Geracao</span>
                    <span className="rounded-full border border-blue-200 bg-blue-100 px-3 py-1 text-xs font-medium text-blue-800">
                        {generation?.status || 'processing'}
                    </span>
                </CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
                <div className="rounded-md border bg-white p-4">
                    <div className="mb-2 flex items-center justify-between text-sm">
                        <span className="font-medium">{generation?.currentStep || 'Inicializando'}</span>
                        <span className="font-semibold">{generation?.progress ?? 0}%</span>
                    </div>
                    <Progress value={generation?.progress ?? 0} />
                </div>

                <div className="grid gap-3 md:grid-cols-3">
                    <div className="rounded-md border bg-white p-3 text-sm">
                        <p className="text-xs text-muted-foreground">Tempo decorrido</p>
                        <p className="font-semibold">{elapsed}</p>
                    </div>
                    <div className="rounded-md border bg-white p-3 text-sm">
                        <p className="text-xs text-muted-foreground">Tokens usados</p>
                        <p className="font-semibold">{generation?.tokensUsed ?? 0}</p>
                    </div>
                    <div className="rounded-md border bg-white p-3 text-sm">
                        <p className="text-xs text-muted-foreground">Agente atual</p>
                        <p className="font-semibold">{currentAgent || 'Preparacao'}</p>
                    </div>
                </div>

                <div className="grid gap-4 lg:grid-cols-2">
                    <div className="rounded-md border bg-white p-4">
                        <p className="mb-3 text-sm font-semibold">Etapas do pipeline</p>
                        <div className="space-y-2 text-sm">
                            {PIPELINE_STEPS.map((step, index) => {
                                const isAgentDone = step.agentName ? successfulAgents.has(step.agentName) : false;
                                const isDoneByIndex = completed || index < activeIndex;
                                const isCurrent = index === activeIndex;

                                let marker = '[ ]';
                                let className = 'text-muted-foreground';

                                if (step.key === 'completed' && completed) {
                                    marker = '[x]';
                                    className = 'text-green-700';
                                } else if (isAgentDone || isDoneByIndex || DONE_STEP_TO_START[currentStep] === step.key) {
                                    marker = '[x]';
                                    className = 'text-green-700';
                                } else if (failed && isCurrent) {
                                    marker = '[!]';
                                    className = 'text-red-700';
                                } else if (isCurrent) {
                                    marker = '[>]';
                                    className = 'text-blue-700 font-medium';
                                }

                                return (
                                    <p key={step.key} className={className}>
                                        {marker} {step.label}
                                    </p>
                                );
                            })}
                        </div>
                    </div>

                    <div className="rounded-md border bg-white p-4">
                        <p className="mb-3 text-sm font-semibold">Execucao dos agentes</p>
                        <div className="space-y-2 text-sm">
                            {['DataCollectorAgent', 'AnalyzerAgent', 'WriterAgent', 'ReviewerAgent', 'FormatterAgent'].map((agent) => {
                                const item = agentResults.find((result) => result.agentName === agent);
                                const isCurrent = currentAgent === agent && generation?.status === 'processing';
                                const status = item
                                    ? item.success
                                        ? 'concluido'
                                        : 'falha'
                                    : isCurrent
                                        ? 'em andamento'
                                        : 'pendente';

                                const color =
                                    status === 'concluido'
                                        ? 'text-green-700'
                                        : status === 'falha'
                                            ? 'text-red-700'
                                            : status === 'em andamento'
                                                ? 'text-blue-700'
                                                : 'text-muted-foreground';

                                return (
                                    <div key={agent} className="flex items-center justify-between rounded border px-3 py-2">
                                        <div>
                                            <p className={`font-medium ${color}`}>{agent}</p>
                                            <p className="text-xs text-muted-foreground">
                                                status: {status}
                                            </p>
                                        </div>
                                        <div className="text-right text-xs text-muted-foreground">
                                            <p>duracao: {formatDuration(item?.durationMs)}</p>
                                            <p>tokens: {item?.tokensUsed ?? 0}</p>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>

                {generation?.status === 'completed' && (
                    <div className="flex gap-2">
                        <Button onClick={handleDownload}>Download</Button>
                    </div>
                )}

                {generation?.status === 'failed' && (
                    <div className="space-y-2 rounded-md border border-red-200 bg-red-50 p-3">
                        <p className="text-sm text-red-700">{generation.errorMessage || 'Falha na geracao do RDA.'}</p>
                        <Button variant="outline" onClick={handleRetry}>Tentar Novamente</Button>
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
