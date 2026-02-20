import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useDeleteRDA, useDownloadRDA, useRDAs, useRetryRDA } from '@/services/queries/rda';
import { toast } from '@/hooks/use-toast';
import type { RDAGeneration } from '@/types';

interface RDAListProps {
    projectId: string;
}

export function RDAList({ projectId }: RDAListProps) {
    const { data: generations = [], isLoading } = useRDAs(projectId);
    const [statusFilter, setStatusFilter] = useState<'all' | RDAGeneration['status']>('all');
    const [periodStartFilter, setPeriodStartFilter] = useState('');
    const [periodEndFilter, setPeriodEndFilter] = useState('');

    const downloadMutation = useDownloadRDA();
    const deleteMutation = useDeleteRDA();
    const retryMutation = useRetryRDA();

    const filtered = useMemo(() => {
        return generations.filter((generation) => {
            const statusMatch = statusFilter === 'all' || generation.status === statusFilter;
            if (!statusMatch) {
                return false;
            }

            const generationStart = new Date(generation.periodStart);
            const generationEnd = new Date(generation.periodEnd);
            const filterStart = periodStartFilter ? new Date(periodStartFilter) : null;
            const filterEnd = periodEndFilter ? new Date(periodEndFilter) : null;

            if (!filterStart && !filterEnd) {
                return true;
            }

            if (filterStart && generationEnd < filterStart) {
                return false;
            }

            if (filterEnd && generationStart > filterEnd) {
                return false;
            }

            return true;
        });
    }, [generations, periodEndFilter, periodStartFilter, statusFilter]);

    const handleDownload = async (id: string) => {
        try {
            await downloadMutation.mutateAsync(id);
            toast({
                title: 'Download concluído',
                description: 'Arquivo RDA baixado com sucesso.',
            });
        } catch {
            toast({
                title: 'Falha no download',
                description: 'Não foi possível baixar este arquivo.',
                variant: 'destructive',
            });
        }
    };

    const handleRetry = async (id: string) => {
        try {
            await retryMutation.mutateAsync(id);
            toast({
                title: 'Retry iniciado',
                description: 'Nova tentativa de geração criada.',
            });
        } catch {
            toast({
                title: 'Falha no retry',
                description: 'Não foi possível iniciar a nova tentativa.',
                variant: 'destructive',
            });
        }
    };

    const handleDelete = async (id: string) => {
        try {
            await deleteMutation.mutateAsync(id);
            toast({
                title: 'RDA removido',
                description: 'A geração foi removida/cancelada com sucesso.',
            });
        } catch {
            toast({
                title: 'Falha ao remover',
                description: 'Não foi possível remover esta geração.',
                variant: 'destructive',
            });
        }
    };

    if (!projectId) {
        return <p className="text-sm text-muted-foreground">Selecione um projeto para ver o histórico.</p>;
    }

    return (
        <Card>
            <CardHeader className="space-y-3">
                <CardTitle>Histórico de Gerações</CardTitle>
                <div className="flex flex-wrap gap-2">
                    <select
                        className="rounded-md border border-input bg-background px-3 py-1 text-sm"
                        value={statusFilter}
                        onChange={(event) => setStatusFilter(event.target.value as 'all' | RDAGeneration['status'])}
                    >
                        <option value="all">Todos</option>
                        <option value="processing">Processing</option>
                        <option value="completed">Completed</option>
                        <option value="failed">Failed</option>
                        <option value="cancelled">Cancelled</option>
                    </select>
                    <input
                        type="date"
                        value={periodStartFilter}
                        onChange={(event) => setPeriodStartFilter(event.target.value)}
                        className="rounded-md border border-input bg-background px-3 py-1 text-sm"
                    />
                    <input
                        type="date"
                        value={periodEndFilter}
                        onChange={(event) => setPeriodEndFilter(event.target.value)}
                        className="rounded-md border border-input bg-background px-3 py-1 text-sm"
                    />
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                            setStatusFilter('all');
                            setPeriodStartFilter('');
                            setPeriodEndFilter('');
                        }}
                    >
                        Limpar filtros
                    </Button>
                </div>
            </CardHeader>
            <CardContent>
                {isLoading && <p className="text-sm text-muted-foreground">Carregando...</p>}
                {!isLoading && filtered.length === 0 && <p className="text-sm text-muted-foreground">Nenhum RDA encontrado.</p>}
                {filtered.length > 0 && (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b">
                                    <th className="px-2 py-2 text-left">Período</th>
                                    <th className="px-2 py-2 text-left">Template</th>
                                    <th className="px-2 py-2 text-left">Status</th>
                                    <th className="px-2 py-2 text-left">Progresso</th>
                                    <th className="px-2 py-2 text-left">Criado em</th>
                                    <th className="px-2 py-2 text-left">Ações</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filtered.map((item) => (
                                    <tr key={item.id} className="border-b">
                                        <td className="px-2 py-2">{item.periodStart} - {item.periodEnd}</td>
                                        <td className="px-2 py-2">{item.templateId}</td>
                                        <td className="px-2 py-2">{item.status}</td>
                                        <td className="px-2 py-2">{item.progress}%</td>
                                        <td className="px-2 py-2">{new Date(item.createdAt).toLocaleString('pt-BR')}</td>
                                        <td className="px-2 py-2">
                                            <div className="flex gap-2">
                                                <Button
                                                    size="sm"
                                                    variant="outline"
                                                    onClick={() => handleDownload(item.id)}
                                                    disabled={item.status !== 'completed'}
                                                >
                                                    Download
                                                </Button>
                                                <Button
                                                    size="sm"
                                                    variant="outline"
                                                    onClick={() => handleRetry(item.id)}
                                                    disabled={item.status !== 'failed'}
                                                >
                                                    Retry
                                                </Button>
                                                <Button
                                                    size="sm"
                                                    variant="outline"
                                                    onClick={() => handleDelete(item.id)}
                                                >
                                                    Delete
                                                </Button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
