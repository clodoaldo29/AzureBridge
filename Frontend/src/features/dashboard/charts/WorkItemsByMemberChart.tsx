import { useMemo } from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { WorkItem } from '@/types';

interface WorkItemsByMemberChartProps {
    workItems: WorkItem[];
}

const ALLOWED_TYPES = ['Task', 'Bug', 'Test Suite', 'Test Case', 'Test Plan'];

const MEMBER_PALETTE = [
    '#3B82F6', '#F6AD55', '#48BB78', '#9F7AEA', '#FC8181',
    '#63B3ED', '#F59E0B', '#34D399', '#A78BFA', '#FB7185',
    '#06B6D4', '#84CC16', '#E879F9', '#F97316', '#14B8A6',
];

const UNASSIGNED_COLOR = '#CBD5E1';
const UNASSIGNED_LABEL = 'Não Alocados';

type SliceData = { name: string; displayName: string; value: number; color: string; _total: number };

const CustomTooltip = ({ active, payload }: any) => {
    if (!active || !payload?.[0]) return null;
    const { name, value, color, _total } = payload[0].payload as SliceData;
    const pct = _total > 0 ? ((value / _total) * 100).toFixed(1) : '0';

    return (
        <div style={{
            background: '#fff',
            border: '1px solid #E5E7EB',
            borderRadius: 10,
            padding: '10px 14px',
            fontSize: 12,
            boxShadow: '0 4px 12px rgba(15,23,42,0.08)',
        }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                <div style={{ width: 10, height: 10, borderRadius: 3, background: color }} />
                <span style={{ fontWeight: 600, color: '#111827' }}>{name}</span>
            </div>
            <div style={{ color: '#6B7280' }}>
                {value} {value === 1 ? 'item' : 'itens'} ({pct}%)
            </div>
        </div>
    );
};

const SliceLabel = ({ cx, cy, midAngle, innerRadius, outerRadius, value }: any) => {
    const RADIAN = Math.PI / 180;
    const radius = innerRadius + (outerRadius - innerRadius) * 0.5;
    const x = cx + radius * Math.cos(-midAngle * RADIAN);
    const y = cy + radius * Math.sin(-midAngle * RADIAN);

    return (
        <text x={x} y={y} fill="#fff" textAnchor="middle" dominantBaseline="central"
            fontSize={12} fontWeight={700}>
            {value}
        </text>
    );
};

function buildDisplayNames(fullNames: string[]): Map<string, string> {
    const result = new Map<string, string>();
    const firstNameCount = new Map<string, number>();

    for (const full of fullNames) {
        if (full === UNASSIGNED_LABEL) continue;
        const first = full.trim().split(/\s+/)[0];
        firstNameCount.set(first, (firstNameCount.get(first) || 0) + 1);
    }

    for (const full of fullNames) {
        if (full === UNASSIGNED_LABEL) {
            result.set(full, full);
            continue;
        }
        const parts = full.trim().split(/\s+/);
        const first = parts[0];
        if ((firstNameCount.get(first) || 0) > 1 && parts.length > 1) {
            result.set(full, `${parts[0]} ${parts[parts.length - 1]}`);
        } else {
            result.set(full, first);
        }
    }

    return result;
}

export function WorkItemsByMemberChart({ workItems }: WorkItemsByMemberChartProps) {
    const { data, total } = useMemo(() => {
        const filtered = workItems.filter(wi => ALLOWED_TYPES.includes(wi.type));
        const counts = new Map<string, number>();
        filtered.forEach(wi => {
            const name = wi.assignedTo?.displayName || UNASSIGNED_LABEL;
            counts.set(name, (counts.get(name) || 0) + 1);
        });

        const total = filtered.length;
        const fullNames = Array.from(counts.keys());
        const displayNames = buildDisplayNames(fullNames);

        let colorIdx = 0;
        const data: SliceData[] = Array.from(counts.entries())
            .sort((a, b) => b[1] - a[1])
            .map(([name, value]) => ({
                name,
                displayName: displayNames.get(name) || name,
                value,
                color: name === UNASSIGNED_LABEL
                    ? UNASSIGNED_COLOR
                    : MEMBER_PALETTE[colorIdx++ % MEMBER_PALETTE.length],
                _total: total,
            }));

        return { data, total };
    }, [workItems]);

    if (total === 0) {
        return (
            <Card>
                <CardHeader><CardTitle className="text-base">Work Items por Membro</CardTitle></CardHeader>
                <CardContent>
                    <div className="flex items-center justify-center h-[260px] text-gray-400 text-sm">
                        Sem work items na sprint.
                    </div>
                </CardContent>
            </Card>
        );
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle className="text-base">Work Items por Membro</CardTitle>
            </CardHeader>
            <CardContent>
                <div className="relative">
                    <ResponsiveContainer width="100%" height={260}>
                        <PieChart>
                            <Pie
                                data={data}
                                cx="50%"
                                cy="50%"
                                innerRadius={60}
                                outerRadius={95}
                                paddingAngle={2}
                                dataKey="value"
                                stroke="none"
                                label={SliceLabel}
                                labelLine={false}
                            >
                                {data.map((entry, i) => (
                                    <Cell key={i} fill={entry.color} />
                                ))}
                            </Pie>
                            <Tooltip content={<CustomTooltip />} />
                        </PieChart>
                    </ResponsiveContainer>
                    <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                        <span className="text-3xl font-bold text-gray-900">{total}</span>
                        <span className="text-xs text-gray-500">itens</span>
                    </div>
                </div>
                <div className="flex flex-wrap justify-center gap-x-4 gap-y-1 mt-2">
                    {data.map((entry, i) => (
                        <div key={i} className="flex items-center gap-1.5 text-xs text-gray-600 shrink-0">
                            <div className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: entry.color }} />
                            <span className="whitespace-nowrap">{entry.displayName}</span>
                            <span className="font-medium text-gray-900 shrink-0">{entry.value}</span>
                        </div>
                    ))}
                </div>
            </CardContent>
        </Card>
    );
}

