import { useMemo, useState } from 'react';
import { ArrowRight, Eye, FileText, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PreflightCheckItem } from '@/pages/RDA/components/preflight/PreflightCheckItem';
import { PreflightSummaryBanner } from '@/pages/RDA/components/preflight/PreflightSummaryBanner';
import { TemplatePreview } from '@/pages/RDA/components/preflight/TemplatePreview';
import { toast } from '@/hooks/use-toast';
import { useDryRun, useFillingGuide, useRunPreflight, useTemplateInfo } from '@/pages/RDA/hooks/usePreflight';

interface PreflightPanelProps {
    projectId: string;
    period: {
        month: number;
        year: number;
    };
    onGenerationReady?: (generationId: string) => void;
}

export function PreflightPanel({ projectId, period, onGenerationReady }: PreflightPanelProps) {
    const dryRun = useDryRun(projectId, period, Boolean(projectId));
    const runPreflight = useRunPreflight();
    const templateInfo = useTemplateInfo(projectId);
    const fillingGuide = useFillingGuide(projectId);
    const [showTemplatePreview, setShowTemplatePreview] = useState(false);

    const orderedChecks = useMemo(() => dryRun.data?.checks ?? [], [dryRun.data?.checks]);

    const run = async () => {
        if (dryRun.data?.status === 'warning') {
            const confirmed = window.confirm('Preflight aprovado com avisos. Deseja continuar mesmo assim?');
            if (!confirmed) {
                return;
            }
        }

        const result = await runPreflight.mutateAsync({
            projectId,
            period,
        });

        if (result.generationReady?.generationId && onGenerationReady) {
            onGenerationReady(result.generationReady.generationId);
        }

        toast({
            title: 'Preflight concluido',
            description: `Status: ${result.status}.`,
            variant: result.status === 'blocked' ? 'destructive' : 'default',
        });
    };

    const blocked = dryRun.data?.status === 'blocked';
    const runDisabled = blocked || runPreflight.isPending || dryRun.isLoading;

    return (
        <Card>
            <CardHeader>
                <CardTitle className="text-base">Preflight - verificacao pre-geracao</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
                <PreflightSummaryBanner
                    loading={dryRun.isLoading}
                    status={dryRun.data?.status}
                    warningsCount={dryRun.data?.warnings.length ?? 0}
                    blockersCount={dryRun.data?.blockers.length ?? 0}
                />

                <div className="space-y-2">
                    {orderedChecks.map((check) => (
                        <PreflightCheckItem
                            key={check.key}
                            check={check}
                            onAction={() => {
                                toast({
                                    title: check.name,
                                    description: check.action ?? 'Sem acao sugerida.',
                                    variant: check.status === 'fail' ? 'destructive' : 'default',
                                });
                            }}
                        />
                    ))}
                </div>

                {dryRun.data?.blockers?.length ? (
                    <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                        {dryRun.data.blockers.map((item) => (
                            <p key={item}>- {item}</p>
                        ))}
                    </div>
                ) : null}

                <div className="grid gap-2 rounded-md border p-3 text-sm md:grid-cols-2">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <FileText className="h-4 w-4 text-sky-600" />
                            <span>Template ativo</span>
                        </div>
                        <span className="text-muted-foreground">
                            {templateInfo.data?.template?.name ? String(templateInfo.data.template.name) : 'Carregando...'}
                        </span>
                    </div>
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <FileText className="h-4 w-4 text-sky-600" />
                            <span>Guia de preenchimento</span>
                        </div>
                        <span className="text-muted-foreground">
                            {fillingGuide.data?.placeholderCount ?? 0} placeholders mapeados
                        </span>
                    </div>
                    <div className="md:col-span-2">
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setShowTemplatePreview((prev) => !prev)}
                            disabled={!templateInfo.data?.placeholders?.length}
                        >
                            <Eye className="mr-2 h-4 w-4" />
                            {showTemplatePreview ? 'Ocultar preview do template' : 'Visualizar preview do template'}
                        </Button>
                    </div>
                </div>

                {showTemplatePreview && templateInfo.data?.placeholders && (
                    <TemplatePreview placeholders={templateInfo.data.placeholders} />
                )}

                <div className="flex items-center justify-end gap-2">
                    <Button variant="outline" onClick={() => dryRun.refetch()} disabled={dryRun.isFetching}>
                        <RefreshCw className="mr-2 h-4 w-4" /> Revalidar
                    </Button>
                    <Button onClick={run} disabled={runDisabled}>
                        {runPreflight.isPending ? 'Executando...' : 'Iniciar geracao'}
                        <ArrowRight className="ml-2 h-4 w-4" />
                    </Button>
                </div>
            </CardContent>
        </Card>
    );
}