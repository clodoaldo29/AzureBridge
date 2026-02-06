import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Progress } from '@/components/ui/progress';
import { formatHours, formatPercentage, getUtilizationColor } from '@/utils/formatters';
import { cn } from '@/utils/cn';
import type { CapacityComparison } from '@/types';

interface CapacityTableProps {
    data: CapacityComparison;
}

export function CapacityTable({ data }: CapacityTableProps) {
    const membersWithCapacity = data.byMember.filter((member) => member.capacity.available > 0);

    return (
        <Card>
            <CardHeader>
                <div className="flex items-center justify-between">
                    <CardTitle>Capacidade vs Planejado</CardTitle>
                    <div className="text-sm text-gray-500">
                        {data.sprint.name} · {formatPercentage(data.summary.utilization)} utilização
                    </div>
                </div>
            </CardHeader>
            <CardContent>
                {/* Summary */}
                <div className="grid grid-cols-3 gap-4 mb-6 p-4 bg-gray-50 rounded-lg">
                    <div>
                        <div className="text-xs text-gray-600 mb-1">Total Disponível</div>
                        <div className="text-lg font-semibold">{formatHours(data.summary.totalAvailable)}</div>
                    </div>
                    <div>
                        <div className="text-xs text-gray-600 mb-1">Total Planejado</div>
                        <div className="text-lg font-semibold">{formatHours(data.summary.totalPlanned)}</div>
                    </div>
                    <div>
                        <div className="text-xs text-gray-600 mb-1">Balanço</div>
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

                {/* Unassigned Work */}
                {data.summary.unassigned.totalHours > 0 && (
                    <div className="mb-6 p-4 bg-amber-50 border border-amber-200 rounded-lg">
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

                {/* Members Table */}
                <div className="space-y-3">
                    {membersWithCapacity.map((member) => (
                        <div key={member.member.id} className="border rounded-lg p-4 hover:bg-gray-50 transition-colors">
                            <div className="flex items-center gap-4">
                                <Avatar>
                                    <AvatarImage src={member.member.imageUrl} alt={member.member.displayName} />
                                    <AvatarFallback>
                                        {member.member.displayName
                                            .split(' ')
                                            .map((n) => n[0])
                                            .join('')
                                            .toUpperCase()
                                            .slice(0, 2)}
                                    </AvatarFallback>
                                </Avatar>

                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center justify-between mb-2">
                                        <div>
                                            <div className="font-medium text-gray-900">{member.member.displayName}</div>
                                            <div className="text-xs text-gray-500">{member.member.uniqueName}</div>
                                        </div>
                                        <div className={cn('px-2 py-1 rounded-full text-xs font-medium', getUtilizationColor(member.utilization))}>
                                            {formatPercentage(member.utilization)}
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-3 gap-4 text-sm mb-2">
                                        <div>
                                            <div className="text-xs text-gray-500">Disponível</div>
                                            <div className="font-medium">{formatHours(member.capacity.available)}</div>
                                        </div>
                                        <div>
                                            <div className="text-xs text-gray-500">Planejado</div>
                                            <div className="font-medium">{formatHours(member.planned.total)}</div>
                                        </div>
                                        <div>
                                            <div className="text-xs text-gray-500">Balanço</div>
                                            <div
                                                className={cn(
                                                    'font-medium',
                                                    member.balance >= 0 ? 'text-green-600' : 'text-red-600'
                                                )}
                                            >
                                                {member.balance >= 0 ? '+' : ''}
                                                {formatHours(Math.abs(member.balance))}
                                            </div>
                                        </div>
                                    </div>

                                    <Progress value={member.utilization} className="h-2" />
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            </CardContent>
        </Card>
    );
}
