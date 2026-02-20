import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatHours, formatPercentage } from '@/utils/formatters';
import { cn } from '@/utils/cn';
import type { CapacityComparison } from '@/types';

interface CapacityTableProps {
    data: CapacityComparison;
    plannedCurrent?: number;
}

export function CapacityTable({ data, plannedCurrent }: CapacityTableProps) {
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

    return (
        <Card>
            <CardHeader>
                <div className="flex items-center justify-between">
                    <CardTitle>Capacidade vs Planejado</CardTitle>
                    <div className="text-sm text-muted-foreground">
                        {data.sprint.name} · {formatPercentage(displayedUtilization)} utilização
                    </div>
                </div>
            </CardHeader>
            <CardContent>
                <div className="grid grid-cols-3 gap-4 mb-6 p-4 bg-muted/40 rounded-lg">
                    <div>
                        <div className="text-xs text-muted-foreground mb-1">Total Disponível</div>
                        <div className="text-lg font-semibold">{formatHours(totalAvailable)}</div>
                    </div>
                    <div>
                        <div className="text-xs text-muted-foreground mb-1">Total Planejado</div>
                        <div className="text-lg font-semibold">{formatHours(displayedPlanned)}</div>
                    </div>
                    <div>
                        <div className="text-xs text-muted-foreground mb-1">Balanço</div>
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
                    <div className="mb-2 p-4 bg-amber-50 border border-amber-200 rounded-lg">
                        <div className="flex items-center justify-between">
                            <div>
                                <div className="text-sm font-medium text-amber-900">Trabalho Não Alocado</div>
                                <div className="text-xs text-amber-700">
                                    {unassigned.items} itens · {formatHours(unassigned.totalHours)}
                                </div>
                            </div>
                            <div className="text-2xl font-bold text-amber-600">
                                {formatHours(unassigned.totalHours)}
                            </div>
                        </div>

                        {hasDetailedUnassigned && (
                            <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
                                <div className="rounded-md border border-amber-200 bg-white/60 p-3">
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
                                </div>

                                <div className="rounded-md border border-amber-200 bg-white/60 p-3">
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
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
