import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatHours, formatPercentage } from '@/utils/formatters';
import { cn } from '@/utils/cn';
import type { CapacityComparison } from '@/types';

interface CapacityTableProps {
    data: CapacityComparison;
}

export function CapacityTable({ data }: CapacityTableProps) {
    return (
        <Card>
            <CardHeader>
                <div className="flex items-center justify-between">
                    <CardTitle>Capacidade vs Planejado</CardTitle>
                    <div className="text-sm text-muted-foreground">
                        {data.sprint.name} · {formatPercentage(data.summary.utilization)} utilização
                    </div>
                </div>
            </CardHeader>
            <CardContent>
                <div className="grid grid-cols-3 gap-4 mb-6 p-4 bg-muted/40 rounded-lg">
                    <div>
                        <div className="text-xs text-muted-foreground mb-1">Total Disponível</div>
                        <div className="text-lg font-semibold">{formatHours(data.summary.totalAvailable)}</div>
                    </div>
                    <div>
                        <div className="text-xs text-muted-foreground mb-1">Total Planejado</div>
                        <div className="text-lg font-semibold">{formatHours(data.summary.totalPlanned)}</div>
                    </div>
                    <div>
                        <div className="text-xs text-muted-foreground mb-1">Balanço</div>
                        <div
                            className={cn(
                                'text-lg font-semibold',
                                data.summary.balance >= 0 ? 'text-green-600' : 'text-red-600'
                            )}
                        >
                            {data.summary.balance >= 0 ? '+' : ''}
                            {formatHours(Math.abs(data.summary.balance))}
                        </div>
                    </div>
                </div>

                {data.summary.unassigned.totalHours > 0 && (
                    <div className="mb-2 p-4 bg-amber-50 border border-amber-200 rounded-lg">
                        <div className="flex items-center justify-between">
                            <div>
                                <div className="text-sm font-medium text-amber-900">Trabalho Não Alocado</div>
                                <div className="text-xs text-amber-700">
                                    {data.summary.unassigned.items} items · {formatHours(data.summary.unassigned.totalHours)}
                                </div>
                            </div>
                            <div className="text-2xl font-bold text-amber-600">
                                {formatHours(data.summary.unassigned.totalHours)}
                            </div>
                        </div>
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
