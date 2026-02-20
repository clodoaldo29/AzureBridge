import { useMemo, useState } from 'react';
import {
    AlertTriangle,
    CheckCircle2,
    Download,
    Eye,
    RefreshCw,
    RotateCcw,
    Save,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from '@/hooks/use-toast';
import { api } from '@/services/api';
import { EvidencePanel } from '@/pages/RDA/components/review/EvidencePanel';
import { FieldEditor } from '@/pages/RDA/components/review/FieldEditor';
import {
    useFinalizeReview,
    useReprocessSections,
    useReviewData,
} from '@/pages/RDA/hooks/useReview';

interface ReviewPanelProps {
    projectId: string;
    generationId: string;
    onClose?: () => void;
}

function confidenceBadge(confidence: number): { variant: 'destructive' | 'secondary' | 'outline'; label: string } {
    if (confidence < 0.5) return { variant: 'destructive', label: `${Math.round(confidence * 100)}%` };
    if (confidence < 0.8) return { variant: 'secondary', label: `${Math.round(confidence * 100)}%` };
    return { variant: 'outline', label: `${Math.round(confidence * 100)}%` };
}

function displayValue(value: unknown): string {
    if (value == null) return '[vazio]';
    if (typeof value === 'string') return value;
    return JSON.stringify(value);
}

export function ReviewPanel({ projectId, generationId, onClose }: ReviewPanelProps) {
    const { data, isLoading, isError, refetch, isFetching } = useReviewData(projectId, generationId, Boolean(projectId && generationId));
    const reprocessMutation = useReprocessSections(projectId, generationId);
    const finalizeMutation = useFinalizeReview(projectId, generationId);

    const [editingFieldKey, setEditingFieldKey] = useState<string | null>(null);
    const [evidenceFieldKey, setEvidenceFieldKey] = useState<string | null>(null);
    const [saveAsExample, setSaveAsExample] = useState(false);
    const [selectedSections, setSelectedSections] = useState<Array<'dados_projeto' | 'atividades' | 'resultados'>>([]);
    const [activeSection, setActiveSection] = useState<'all' | 'dados_projeto' | 'atividades' | 'resultados'>('all');

    const allFields = useMemo(() => data?.sections.flatMap((section) => section.fields) ?? [], [data?.sections]);
    const visibleSections = useMemo(
        () => {
            const sections = data?.sections ?? [];
            return activeSection === 'all' ? sections : sections.filter((section) => section.sectionName === activeSection);
        },
        [activeSection, data?.sections],
    );
    const editingField = useMemo(
        () => allFields.find((field) => field.fieldKey === editingFieldKey) ?? null,
        [allFields, editingFieldKey],
    );

    const handleToggleSection = (section: 'dados_projeto' | 'atividades' | 'resultados') => {
        setSelectedSections((current) => {
            if (current.includes(section)) {
                return current.filter((item) => item !== section);
            }
            return [...current, section];
        });
    };

    const handleReprocess = async () => {
        if (selectedSections.length === 0) {
            toast({
                title: 'Selecione ao menos uma secao',
                description: 'Marque as secoes que devem ser reprocessadas.',
                variant: 'destructive',
            });
            return;
        }

        const confirmed = window.confirm(`Reprocessar secoes: ${selectedSections.join(', ')}?`);
        if (!confirmed) return;

        await reprocessMutation.mutateAsync({
            sections: selectedSections,
        });

        setSelectedSections([]);
        toast({
            title: 'Reprocessamento concluido',
            description: 'Os campos selecionados foram reprocessados.',
        });
    };

    const handleFinalizeAndDownload = async () => {
        const confirmed = window.confirm('Finalizar revisao e gerar DOCX final para download?');
        if (!confirmed) return;

        await finalizeMutation.mutateAsync(saveAsExample);
        const response = await api.get(`/rda/review/${projectId}/${generationId}/download`, {
            responseType: 'blob',
        });

        const blob = new Blob([response.data], {
            type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `rda-review-${generationId}.docx`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);

        toast({
            title: 'RDA finalizado',
            description: 'O documento final foi gerado e baixado.',
        });
    };

    if (isLoading) {
        return (
            <Card>
                <CardContent className="p-4 text-sm text-muted-foreground">
                    Carregando dados de revisao...
                </CardContent>
            </Card>
        );
    }

    if (isError || !data) {
        return (
            <Card>
                <CardContent className="space-y-3 p-4 text-sm text-muted-foreground">
                    <p>Falha ao carregar o painel de revisao.</p>
                    <Button variant="outline" size="sm" onClick={() => refetch()}>
                        Tentar novamente
                    </Button>
                </CardContent>
            </Card>
        );
    }

    return (
        <Card className="border-blue-100">
            <CardHeader>
                <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
                    <span>Revisao Human-in-the-Loop</span>
                    <div className="flex items-center gap-2">
                        <Badge variant="outline">Score {Math.round(data.overallScore * 100)}%</Badge>
                        {data.qualityAlert && (
                            <Badge variant="destructive">Alerta qualidade</Badge>
                        )}
                    </div>
                </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="grid gap-2 text-sm md:grid-cols-4">
                    <div className="rounded border px-3 py-2">Secoes: <b>{data.sections.length}</b></div>
                    <div className="rounded border px-3 py-2">Campos: <b>{allFields.length}</b></div>
                    <div className="rounded border px-3 py-2">Editados: <b>{Object.keys(data.overrides).length}</b></div>
                    <div className="rounded border px-3 py-2">% Edicao: <b>{data.editPercentage.toFixed(1)}%</b></div>
                </div>

                <div className="flex flex-wrap gap-2 rounded-md border p-2">
                    <Button variant={activeSection === 'all' ? 'default' : 'outline'} size="sm" onClick={() => setActiveSection('all')}>
                        Todas as secoes
                    </Button>
                    <Button variant={activeSection === 'dados_projeto' ? 'default' : 'outline'} size="sm" onClick={() => setActiveSection('dados_projeto')}>
                        Dados do projeto
                    </Button>
                    <Button variant={activeSection === 'atividades' ? 'default' : 'outline'} size="sm" onClick={() => setActiveSection('atividades')}>
                        Atividades
                    </Button>
                    <Button variant={activeSection === 'resultados' ? 'default' : 'outline'} size="sm" onClick={() => setActiveSection('resultados')}>
                        Resultados
                    </Button>
                </div>

                {data.qualityAlert && (
                    <div className="flex items-start gap-2 rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                        <AlertTriangle className="mt-0.5 h-4 w-4" />
                        <p>Mais de 20% dos campos foram editados. Revise prompts e base de conhecimento para reduzir retrabalho.</p>
                    </div>
                )}

                <div className="space-y-3">
                    {visibleSections.map((section) => (
                        <div key={section.sectionName} className="rounded-md border">
                            <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/20 px-3 py-2">
                                <div className="flex items-center gap-2">
                                    <input
                                        type="checkbox"
                                        checked={selectedSections.includes(section.sectionName)}
                                        onChange={() => handleToggleSection(section.sectionName)}
                                    />
                                    <p className="font-medium">{section.label}</p>
                                    <Badge variant="outline">{Math.round(section.sectionScore * 100)}%</Badge>
                                </div>
                                <p className="text-xs text-muted-foreground">
                                    {section.filledFields}/{section.totalFields} preenchidos | {section.overriddenFields} editados
                                </p>
                            </div>

                            <div className="space-y-2 p-3">
                                {section.fields.map((field) => {
                                    const score = confidenceBadge(field.confidence);
                                    const showEvidence = evidenceFieldKey === field.fieldKey;
                                    const showEditor = editingField?.fieldKey === field.fieldKey;

                                    return (
                                        <div key={field.fieldKey} className="rounded border p-2">
                                            <div className="flex flex-wrap items-center justify-between gap-2">
                                                <div className="flex items-center gap-2">
                                                    <p className="text-sm font-medium">{field.label}</p>
                                                    <Badge variant={score.variant}>{score.label}</Badge>
                                                    {field.hasOverride && <Badge variant="secondary">Editado</Badge>}
                                                    {field.status === 'filled' && <CheckCircle2 className="h-4 w-4 text-emerald-600" />}
                                                </div>
                                                <div className="flex gap-1">
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        onClick={() => setEvidenceFieldKey(showEvidence ? null : field.fieldKey)}
                                                    >
                                                        <Eye className="mr-1 h-3 w-3" /> Evidencias
                                                    </Button>
                                                    <Button
                                                        variant="outline"
                                                        size="sm"
                                                        onClick={() => setEditingFieldKey(showEditor ? null : field.fieldKey)}
                                                    >
                                                        <Save className="mr-1 h-3 w-3" /> Editar
                                                    </Button>
                                                </div>
                                            </div>

                                            <p className="mt-1 text-sm text-muted-foreground">{displayValue(field.value)}</p>

                                            {showEditor && editingField && (
                                                <FieldEditor
                                                    field={editingField}
                                                    projectId={projectId}
                                                    generationId={generationId}
                                                    onClose={() => setEditingFieldKey(null)}
                                                />
                                            )}

                                            {showEvidence && (
                                                <EvidencePanel evidence={field.evidence} issues={field.issues} />
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    ))}
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3">
                    <div className="flex flex-wrap items-center gap-3 text-sm">
                        <label className="flex items-center gap-2">
                            <input
                                type="checkbox"
                                checked={saveAsExample}
                                onChange={(event) => setSaveAsExample(event.target.checked)}
                            />
                            Salvar como few-shot example
                        </label>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                        {onClose && (
                            <Button variant="outline" size="sm" onClick={onClose}>
                                Fechar revisao
                            </Button>
                        )}
                        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
                            <RefreshCw className="mr-1 h-3 w-3" />
                            Atualizar
                        </Button>
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={handleReprocess}
                            disabled={reprocessMutation.isPending}
                        >
                            <RotateCcw className="mr-1 h-3 w-3" />
                            {reprocessMutation.isPending ? 'Reprocessando...' : 'Reprocessar secoes'}
                        </Button>
                        <Button onClick={handleFinalizeAndDownload} disabled={finalizeMutation.isPending}>
                            <Download className="mr-1 h-3 w-3" />
                            {finalizeMutation.isPending ? 'Finalizando...' : 'Baixar RDA final'}
                        </Button>
                    </div>
                </div>
            </CardContent>
        </Card>
    );
}
