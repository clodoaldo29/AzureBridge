import { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { formatHours, formatPercentage } from '@/utils/formatters';
import { cn } from '@/utils/cn';
import type { CapacityComparison } from '@/types';

interface CapacityTableProps {
    data: CapacityComparison;
    plannedCurrent?: number;
    projectName?: string;
}

type UnassignedScope = 'open' | 'done';

function toAzureEditUrl(rawUrl: string | null | undefined, id: number, fallbackOrgUrl?: string, projectName?: string): string | null {
    if (rawUrl) {
        if (rawUrl.includes('/_workitems/edit/')) return rawUrl;

        const apiMatch = rawUrl.match(/^(https:\/\/dev\.azure\.com\/[^/]+\/[^/]+)\/_apis\/wit\/workItems\/(\d+)/i);
        if (apiMatch) {
            const base = apiMatch[1].replace(/\/+$/, '');
            const workItemId = apiMatch[2] || String(id);
            return `${base}/_workitems/edit/${workItemId}`;
        }
    }

    if (fallbackOrgUrl) {
        const base = fallbackOrgUrl.replace(/\/+$/, '');
        if (projectName) return `${base}/${encodeURIComponent(projectName)}/_workitems/edit/${id}`;
        return `${base}/_workitems/edit/${id}`;
    }

    return null;
}

export function CapacityTable({ data, plannedCurrent, projectName }: CapacityTableProps) {
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [modalScope, setModalScope] = useState<UnassignedScope>('open');
    const unassigned = data.summary.unassigned;
    const open = unassigned.open;
    const done = unassigned.done;
    const hasDetailedUnassigned = !!open || !!done;
    const totalAvailable = data.summary.totalAvailable || 0;
    const displayedPlanned = plannedCurrent ?? data.summary.totalPlanned;
    const displayedBalance = totalAvailable - displayedPlanned;
    const displayedUtilization = totalAvailable > 0
        ? Math.round((displayedPlanned / totalAvailable) * 100)
        : 0;

    const openTasks = open?.tasks ?? [];
    const doneTasks = done?.tasks ?? [];
    const modalTasks = modalScope === 'open' ? openTasks : doneTasks;
    const azureOrgUrl = (import.meta as any)?.env?.VITE_AZURE_DEVOPS_ORG_URL as string | undefined;
    const modalTitle = useMemo(
        () => (modalScope === 'open' ? 'Tasks nao alocadas em aberto' : 'Tasks nao alocadas finalizadas'),
        [modalScope]
    );

    const openModal = (scope: UnassignedScope) => {
        setModalScope(scope);
        setIsModalOpen(true);
    };

    return (
        <>
            <Card>
                <CardHeader>
                    <div className="flex items-center justify-between">
                        <CardTitle>Capacidade vs Planejado</CardTitle>
                        <div className="text-sm text-muted-foreground">
                            {data.sprint.name} · {formatPercentage(displayedUtilization)} utilizacao
                        </div>
                    </div>
                </CardHeader>
                <CardContent>
                    <div className="grid grid-cols-3 gap-4 mb-6 p-4 bg-muted/40 rounded-lg">
                        <div>
                            <div className="text-xs text-muted-foreground mb-1">Total Disponivel</div>
                            <div className="text-lg font-semibold">{formatHours(totalAvailable)}</div>
                        </div>
                        <div>
                            <div className="text-xs text-muted-foreground mb-1">Total Planejado</div>
                            <div className="text-lg font-semibold">{formatHours(displayedPlanned)}</div>
                        </div>
                        <div>
                            <div className="text-xs text-muted-foreground mb-1">Balanco</div>
                            <div
                                className={cn(
                                    'text-lg font-semibold',
                                    displayedBalance >= 0 ? 'text-green-600' : 'text-red-600'
                                )}
                            >
                                {displayedBalance >= 0 ? '+' : ''}
                                {formatHours(Math.abs(displayedBalance))}
                            </div>
                        </div>
                    </div>

                    {unassigned.totalHours > 0 && (
                        <>
                            <div className="mb-4 p-4 bg-amber-50 border border-amber-200 rounded-lg">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <div className="text-sm font-medium text-amber-900">Trabalho Nao Alocado</div>
                                        <div className="text-xs text-amber-700">
                                            {unassigned.items} itens · {formatHours(unassigned.totalHours)}
                                        </div>
                                    </div>
                                    <div className="text-2xl font-bold text-amber-600">
                                        {formatHours(unassigned.totalHours)}
                                    </div>
                                </div>
                            </div>

                            {hasDetailedUnassigned && (
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-4">
                                        <div className="text-xs font-semibold uppercase tracking-wide text-amber-800">
                                            Nao alocado em aberto
                                        </div>
                                        <div className="mt-1 text-sm text-amber-900">
                                            {open?.items ?? 0} itens · {formatHours(open?.totalHours ?? 0)}
                                        </div>
                                        <div className="text-xs text-amber-700">
                                            Restante em aberto: {formatHours(open?.remainingHours ?? 0)}
                                        </div>
                                        {!!open?.byType?.length && (
                                            <div className="mt-2 space-y-1">
                                                {open.byType.map((entry) => (
                                                    <div key={`open-${entry.type}`} className="text-xs text-amber-800 flex justify-between gap-3">
                                                        <span>{entry.type} ({entry.items})</span>
                                                        <span>{formatHours(entry.totalHours)}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                        <Button
                                            variant="outline"
                                            className="mt-3 border-amber-300 text-amber-800 hover:bg-amber-100"
                                            onClick={() => openModal('open')}
                                            disabled={openTasks.length === 0}
                                        >
                                            Visualizar itens
                                        </Button>
                                    </div>

                                    <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-4">
                                        <div className="text-xs font-semibold uppercase tracking-wide text-amber-800">
                                            Nao alocado finalizado
                                        </div>
                                        <div className="mt-1 text-sm text-amber-900">
                                            {done?.items ?? 0} itens · {formatHours(done?.totalHours ?? 0)}
                                        </div>
                                        {!!done?.byType?.length && (
                                            <div className="mt-2 space-y-1">
                                                {done.byType.map((entry) => (
                                                    <div key={`done-${entry.type}`} className="text-xs text-amber-800 flex justify-between gap-3">
                                                        <span>{entry.type} ({entry.items})</span>
                                                        <span>{formatHours(entry.totalHours)}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                        <Button
                                            variant="outline"
                                            className="mt-3 border-amber-300 text-amber-800 hover:bg-amber-100"
                                            onClick={() => openModal('done')}
                                            disabled={doneTasks.length === 0}
                                        >
                                            Visualizar itens
                                        </Button>
                                    </div>
                                </div>
                            )}
                        </>
                    )}
                </CardContent>
            </Card>

            {isModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
                    <div className="w-full max-w-3xl rounded-lg border border-border bg-background shadow-xl">
                        <div className="flex items-center justify-between border-b border-border p-4">
                            <div>
                                <h3 className="text-lg font-semibold">{modalTitle}</h3>
                                <p className="text-sm text-muted-foreground">{modalTasks.length} tasks</p>
                            </div>
                            <div className="flex items-center gap-2">
                                <Button variant={modalScope === 'open' ? 'default' : 'outline'} onClick={() => setModalScope('open')}>
                                    Em aberto
                                </Button>
                                <Button variant={modalScope === 'done' ? 'default' : 'outline'} onClick={() => setModalScope('done')}>
                                    Finalizadas
                                </Button>
                                <Button variant="outline" onClick={() => setIsModalOpen(false)}>
                                    Fechar
                                </Button>
                            </div>
                        </div>

                        <div className="max-h-[65vh] overflow-auto p-4 space-y-3">
                            {modalTasks.length === 0 ? (
                                <div className="text-center py-10 text-muted-foreground">
                                    Nenhuma task para este filtro.
                                </div>
                            ) : (
                                modalTasks.map((task) => {
                                    const azureUrl = toAzureEditUrl(task.url, task.id, azureOrgUrl, projectName);
                                    return (
                                        <div key={`${modalScope}-${task.id}`} className="rounded-lg border border-border bg-card p-3">
                                            <div className="font-medium text-sm text-foreground">#{task.id} - {task.title}</div>
                                            <div className="mt-1 text-xs text-muted-foreground">
                                                Estado: {task.state || '-'} · Planejado: {formatHours(task.plannedHours)} · Restante: {formatHours(task.remainingHours)}
                                            </div>
                                            {azureUrl ? (
                                                <a
                                                    href={azureUrl}
                                                    target="_blank"
                                                    rel="noreferrer"
                                                    className="mt-2 inline-block text-blue-600 hover:underline text-sm font-medium"
                                                >
                                                    Abrir no Azure DevOps
                                                </a>
                                            ) : (
                                                <div className="mt-2 text-xs text-muted-foreground">
                                                    Link Azure indisponivel (configure `VITE_AZURE_DEVOPS_ORG_URL`).
                                                </div>
                                            )}
                                        </div>
                                    );
                                })
                            )}
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
