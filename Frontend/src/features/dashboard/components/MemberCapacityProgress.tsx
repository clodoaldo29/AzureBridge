import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatHours, formatPercentage } from '@/utils/formatters';
import {
    Bar,
    BarChart,
    CartesianGrid,
    ReferenceLine,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from 'recharts';
import type { CapacityComparison } from '@/types';

interface MemberCapacityProgressProps {
    data: CapacityComparison;
}

function getCapacityAvailable(member: CapacityComparison['byMember'][number]): number {
    return typeof member.capacity === 'number' ? member.capacity : member.capacity.available;
}

function getCompleted(member: CapacityComparison['byMember'][number]): number {
    return member.completed || 0;
}

function getCompletionPct(member: CapacityComparison['byMember'][number]): number {
    const capacity = getCapacityAvailable(member);
    if (capacity <= 0) return 0;
    if (typeof member.completionPct === 'number') return member.completionPct;
    return Math.round((getCompleted(member) / capacity) * 100);
}

type ChartRow = {
    id: string;
    name: string;
    capacity: number;
    completed: number;
    completedInCapacity: number;
    remainingToCapacity: number;
    overCapacity: number;
    pct: number;
};

const TooltipContent = ({ active, payload }: any) => {
    if (!active || !payload?.length) return null;
    const row = payload[0].payload as ChartRow;
    return (
        <div className="rounded-lg border border-border bg-card p-3 text-xs shadow-sm">
            <div className="mb-2 font-semibold text-foreground">{row.name}</div>
            <div className="space-y-1 text-muted-foreground">
                <div>Capacidade: <span className="font-medium text-foreground">{formatHours(row.capacity)}</span></div>
                <div>Concluído: <span className="font-medium text-foreground">{formatHours(row.completed)}</span></div>
                <div>Restante: <span className="font-medium text-foreground">{formatHours(row.remainingToCapacity)}</span></div>
                {row.overCapacity > 0 && (
                    <div>Excedente: <span className="font-medium text-amber-700">+{formatHours(row.overCapacity)}</span></div>
                )}
                <div>Percentual: <span className="font-medium text-foreground">{formatPercentage(row.pct)}</span></div>
            </div>
        </div>
    );
};

export function MemberCapacityProgress({ data }: MemberCapacityProgressProps) {
    const rows: ChartRow[] = data.byMember
        .map((member) => {
            const capacity = getCapacityAvailable(member);
            const completed = getCompleted(member);
            const pct = getCompletionPct(member);
            const remaining = member.remainingToCapacity ?? Math.max(0, capacity - completed);
            const over = member.overCapacity ?? Math.max(0, completed - capacity);
            return {
                id: member.member.id,
                name: member.member.displayName,
                capacity,
                completed,
                completedInCapacity: Math.min(completed, capacity),
                remainingToCapacity: remaining,
                overCapacity: over,
                pct,
            };
        })
        .filter((m) => m.capacity > 0)
        .sort((a, b) => b.pct - a.pct);

    const totalCapacity = rows.reduce((acc, row) => acc + row.capacity, 0);
    const totalCompleted = rows.reduce((acc, row) => acc + row.completed, 0);
    const teamPct = totalCapacity > 0 ? Math.round((totalCompleted / totalCapacity) * 100) : 0;
    const maxHours = rows.reduce((acc, row) => Math.max(acc, row.capacity + row.overCapacity), 0);
    const chartHeight = Math.max(240, rows.length * 44);

    return (
        <Card>
            <CardHeader>
                <div className="flex items-center justify-between">
                    <CardTitle>Capacidade por Pessoa</CardTitle>
                    <div className="text-sm text-muted-foreground">
                        {formatHours(totalCompleted)} de {formatHours(totalCapacity)} · {formatPercentage(teamPct)}
                    </div>
                </div>
            </CardHeader>
            <CardContent>
                <div className="mb-4 flex flex-wrap items-center gap-4 text-xs">
                    <div className="flex items-center gap-2 text-muted-foreground">
                        <span className="inline-block h-2 w-2 rounded-full bg-blue-600" />
                        Concluído
                    </div>
                    <div className="flex items-center gap-2 text-muted-foreground">
                        <span className="inline-block h-2 w-2 rounded-full bg-gray-300" />
                        Restante para capacidade
                    </div>
                    <div className="flex items-center gap-2 text-muted-foreground">
                        <span className="inline-block h-2 w-2 rounded-full bg-amber-500" />
                        Excedente
                    </div>
                </div>

                <div className="rounded-lg border border-border bg-muted/20 p-3">
                    <ResponsiveContainer width="100%" height={chartHeight}>
                        <BarChart data={rows} layout="vertical" margin={{ top: 8, right: 20, left: 24, bottom: 8 }}>
                            <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#E5E7EB" />
                            <XAxis
                                type="number"
                                tick={{ fill: '#6B7280', fontSize: 11 }}
                                axisLine={false}
                                tickLine={false}
                                domain={[0, Math.max(50, Math.ceil(maxHours / 10) * 10)]}
                                tickFormatter={(value) => `${value}h`}
                            />
                            <YAxis
                                type="category"
                                dataKey="name"
                                tick={{ fill: '#374151', fontSize: 12 }}
                                axisLine={false}
                                tickLine={false}
                                width={130}
                            />
                            <Tooltip content={<TooltipContent />} cursor={{ fill: 'rgba(59,130,246,0.04)' }} />
                            <ReferenceLine x={0} stroke="#E5E7EB" />
                            <Bar dataKey="completedInCapacity" stackId="capacity" fill="#2563EB" radius={[4, 0, 0, 4]} />
                            <Bar dataKey="remainingToCapacity" stackId="capacity" fill="#CBD5E1" radius={[0, 4, 4, 0]} />
                            <Bar dataKey="overCapacity" stackId="capacity" fill="#F59E0B" radius={[0, 4, 4, 0]} />
                        </BarChart>
                    </ResponsiveContainer>
                </div>
            </CardContent>
        </Card>
    );
}


