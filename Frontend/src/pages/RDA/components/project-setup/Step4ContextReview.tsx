import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { ProjectContextData } from '@/pages/RDA/hooks/useProjectContext';
import type { ChunkStats, RAGSearchResult } from '@/pages/RDA/hooks/useRAGSearch';

interface Step4ContextReviewProps {
    context: ProjectContextData | null | undefined;
    stats: ChunkStats | undefined;
    contextLoading: boolean;
    contextError: boolean;
    onRetryContext: () => void;
    isSaving: boolean;
    onSave: (payload: Partial<ProjectContextData>) => void;
    onRebuild: () => void;
    onReset: () => void;
    onGoToMonthly?: () => void;
    onRestartSetup?: () => void;
    onSearch: (query: string) => void;
    searchResults: RAGSearchResult[];
    searchLoading: boolean;
}

export function Step4ContextReview({
    context,
    stats,
    contextLoading,
    contextError,
    onRetryContext,
    isSaving,
    onSave,
    onRebuild,
    onReset,
    onGoToMonthly,
    onRestartSetup,
    onSearch,
    searchResults,
    searchLoading,
}: Step4ContextReviewProps) {
    const [editScope, setEditScope] = useState(false);
    const [editSummary, setEditSummary] = useState(false);
    const [projectScope, setProjectScope] = useState(context?.projectScope ?? '');
    const [summary, setSummary] = useState(context?.summary ?? '');
    const [query, setQuery] = useState('atividades desenvolvidas no periodo');

    useEffect(() => {
        setProjectScope(context?.projectScope ?? '');
        setSummary(context?.summary ?? '');
    }, [context]);

    const sourceTypeSummary = useMemo(() => {
        if (!stats?.chunksBySourceType) {
            return [] as Array<{ key: string; value: number }>;
        }

        return Object.entries(stats.chunksBySourceType).map(([key, value]) => ({ key, value }));
    }, [stats]);

    const saveScope = () => {
        onSave({ projectScope });
        setEditScope(false);
    };

    const saveSummary = () => {
        onSave({ summary });
        setEditSummary(false);
    };

    return (
        <div className="space-y-4">
            <Card>
                <CardHeader>
                    <CardTitle>Revisao do ProjectContext</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    {contextLoading && (
                        <p className="text-sm text-muted-foreground">Carregando contexto do projeto...</p>
                    )}

                    {!contextLoading && contextError && (
                        <div className="space-y-2 rounded border border-destructive/40 bg-destructive/5 p-3 text-sm">
                            <p className="text-destructive">Falha ao carregar o contexto deste projeto.</p>
                            <Button variant="outline" size="sm" onClick={onRetryContext}>Tentar novamente</Button>
                        </div>
                    )}

                    {!contextLoading && !contextError && !context && (
                        <div className="space-y-2">
                            <p className="text-sm text-muted-foreground">
                                Contexto ainda nao construido. Execute a etapa de Processamento.
                            </p>
                            <Button variant="outline" size="sm" onClick={onRetryContext}>Recarregar contexto</Button>
                        </div>
                    )}

                    {context && (
                        <div className="grid gap-4 lg:grid-cols-2">
                            <Card>
                                <CardHeader className="pb-2">
                                    <CardTitle className="text-base">Projeto</CardTitle>
                                </CardHeader>
                                <CardContent className="space-y-2 text-sm">
                                    <p><strong>Nome:</strong> {context.projectName || '-'}</p>
                                    {!editScope ? (
                                        <>
                                            <p className="whitespace-pre-wrap"><strong>Escopo:</strong> {context.projectScope || '-'}</p>
                                            <Button variant="outline" size="sm" onClick={() => setEditScope(true)}>Editar</Button>
                                        </>
                                    ) : (
                                        <div className="space-y-2">
                                            <textarea
                                                className="min-h-[140px] w-full rounded border border-input bg-background p-2 text-sm"
                                                value={projectScope}
                                                onChange={(event) => setProjectScope(event.target.value)}
                                            />
                                            <div className="flex gap-2">
                                                <Button size="sm" onClick={saveScope} disabled={isSaving}>Salvar</Button>
                                                <Button size="sm" variant="outline" onClick={() => setEditScope(false)}>Cancelar</Button>
                                            </div>
                                        </div>
                                    )}
                                </CardContent>
                            </Card>

                            <Card>
                                <CardHeader className="pb-2">
                                    <CardTitle className="text-base">Equipe e Tecnologias</CardTitle>
                                </CardHeader>
                                <CardContent className="space-y-3 text-sm">
                                    <div>
                                        <p className="font-medium">Equipe ({context.teamMembers.length})</p>
                                        <ul className="list-disc pl-5 text-xs text-muted-foreground">
                                            {context.teamMembers.slice(0, 8).map((member) => (
                                                <li key={`${member.name}-${member.role}`}>{member.name} - {member.role}</li>
                                            ))}
                                        </ul>
                                    </div>
                                    <div>
                                        <p className="font-medium">Tecnologias ({context.technologies.length})</p>
                                        <ul className="list-disc pl-5 text-xs text-muted-foreground">
                                            {context.technologies.slice(0, 8).map((tech) => (
                                                <li key={`${tech.name}-${tech.category}`}>{tech.name} ({tech.category})</li>
                                            ))}
                                        </ul>
                                    </div>
                                </CardContent>
                            </Card>

                            <Card>
                                <CardHeader className="pb-2">
                                    <CardTitle className="text-base">Marcos e Plano de Entrega</CardTitle>
                                </CardHeader>
                                <CardContent className="space-y-3 text-sm">
                                    <div>
                                        <p className="font-medium">Marcos ({context.keyMilestones.length})</p>
                                        <ul className="list-disc pl-5 text-xs text-muted-foreground">
                                            {context.keyMilestones.slice(0, 8).map((item) => (
                                                <li key={`${item.name}-${item.status}`}>{item.name} - {item.status}</li>
                                            ))}
                                        </ul>
                                    </div>
                                    <div>
                                        <p className="font-medium">Fases ({context.deliveryPlan.length})</p>
                                        <ul className="list-disc pl-5 text-xs text-muted-foreground">
                                            {context.deliveryPlan.slice(0, 8).map((phase) => (
                                                <li key={phase.phase}>{phase.phase}</li>
                                            ))}
                                        </ul>
                                    </div>
                                </CardContent>
                            </Card>

                            <Card>
                                <CardHeader className="pb-2">
                                    <CardTitle className="text-base">Resumo e Regras de Negocio</CardTitle>
                                </CardHeader>
                                <CardContent className="space-y-2 text-sm">
                                    <p><strong>Regras:</strong> {context.businessRules.length}</p>
                                    {!editSummary ? (
                                        <>
                                            <p className="whitespace-pre-wrap text-xs text-muted-foreground">{context.summary || '-'}</p>
                                            <Button variant="outline" size="sm" onClick={() => setEditSummary(true)}>Editar resumo</Button>
                                        </>
                                    ) : (
                                        <div className="space-y-2">
                                            <textarea
                                                className="min-h-[140px] w-full rounded border border-input bg-background p-2 text-sm"
                                                value={summary}
                                                onChange={(event) => setSummary(event.target.value)}
                                            />
                                            <div className="flex gap-2">
                                                <Button size="sm" onClick={saveSummary} disabled={isSaving}>Salvar</Button>
                                                <Button size="sm" variant="outline" onClick={() => setEditSummary(false)}>Cancelar</Button>
                                            </div>
                                        </div>
                                    )}
                                </CardContent>
                            </Card>
                        </div>
                    )}
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>Estatisticas do RAG</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                    <div className="grid gap-3 md:grid-cols-3">
                        <div className="rounded border p-3">
                            <p className="text-xs text-muted-foreground">Total de chunks</p>
                            <p className="font-semibold">{stats?.totalChunks ?? 0}</p>
                        </div>
                        <div className="rounded border p-3">
                            <p className="text-xs text-muted-foreground">Media tokens/chunk</p>
                            <p className="font-semibold">{Math.round(stats?.avgTokensPerChunk ?? 0)}</p>
                        </div>
                        <div className="rounded border p-3">
                            <p className="text-xs text-muted-foreground">Tokens totais</p>
                            <p className="font-semibold">{stats?.totalTokens ?? 0}</p>
                        </div>
                    </div>

                    <div className="flex flex-wrap gap-2 text-xs">
                        {sourceTypeSummary.map((item) => (
                            <span key={item.key} className="rounded-full border px-2 py-1">
                                {item.key}: {item.value}
                            </span>
                        ))}
                    </div>

                    <div className="rounded border p-3">
                        <p className="mb-2 font-medium">Testar busca RAG</p>
                        <div className="flex gap-2">
                            <input
                                className="w-full rounded border border-input bg-background px-2 py-1"
                                value={query}
                                onChange={(event) => setQuery(event.target.value)}
                            />
                            <Button onClick={() => onSearch(query)} disabled={searchLoading || query.trim().length < 2}>
                                {searchLoading ? 'Buscando...' : 'Buscar'}
                            </Button>
                        </div>
                        <div className="mt-3 space-y-2 text-xs">
                            {searchResults.slice(0, 5).map((result) => (
                                <div key={result.id} className="rounded border p-2">
                                    <p className="font-medium">{result.sourceType} - score {result.score.toFixed(4)}</p>
                                    <p className="line-clamp-3 text-muted-foreground">{result.content}</p>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="flex gap-2">
                        <Button variant="outline" onClick={onRebuild}>Reconstruir Contexto</Button>
                        <Button variant="outline" onClick={onReset}>Resetar Setup</Button>
                        {onRestartSetup && (
                            <Button variant="outline" onClick={onRestartSetup}>Iniciar novo setup</Button>
                        )}
                        {onGoToMonthly && <Button onClick={onGoToMonthly}>Ir para Preparacao Mensal</Button>}
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
