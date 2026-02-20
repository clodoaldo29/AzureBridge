import { useMemo } from 'react';
import {
    Area,
    AreaChart,
    CartesianGrid,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from 'recharts';
import type { SprintSnapshot } from '@/types';

interface CumulativeFlowChartProps {
    data: SprintSnapshot[];
    sprintStartDate?: string;
    sprintEndDate?: string;
    dayOffDates?: string[];
}

type CfdPoint = {
    axisLabel: string;
    tooltipLabel: string;
    done: number;
    blocked: number;
    inProgress: number;
    todo: number;
    total: number;
};

const COLORS = {
    done: '#48BB78',
    doneGrad: 'rgba(72,187,120,0.6)',
    blocked: '#FC8181',
    blockedGrad: 'rgba(252,129,129,0.6)',
    inProgress: '#63B3ED',
    inProgressGrad: 'rgba(99,179,237,0.6)',
    todo: '#CBD5E1',
    todoGrad: 'rgba(203,213,225,0.5)',
} as const;

const UI = {
    bg: '#FFFFFF',
    bgSoft: '#F8FAFC',
    border: '#E5E7EB',
    text: '#111827',
    muted: '#6B7280',
    mutedSoft: '#94A3B8',
    grid: 'rgba(148,163,184,0.35)',
    axisLine: '#E2E8F0',
} as const;

function toUtcDayMs(value: string | Date): number {
    const d = new Date(value);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

function toIsoDate(ms: number): string {
    return new Date(ms).toISOString().slice(0, 10);
}

function weekdayPtBr(dateMs: number): string {
    return new Date(dateMs)
        .toLocaleDateString('pt-BR', { weekday: 'short', timeZone: 'UTC' })
        .replace('.', '');
}

function shortDatePtBr(dateMs: number): string {
    return new Date(dateMs).toLocaleDateString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        timeZone: 'UTC',
    });
}

function capitalizeFirst(value: string): string {
    if (!value) return value;
    return value.charAt(0).toUpperCase() + value.slice(1);
}

const CustomXAxisTick = ({ x, y, payload }: any) => {
    const raw = String(payload?.value || '');
    const [day = '', date = ''] = raw.split('|');
    return (
        <g transform={`translate(${x},${y})`}>
            <text x={0} y={0} dy={14} textAnchor="middle" fill={UI.muted} fontSize={11} fontWeight={600}>
                {day}
            </text>
            <text x={0} y={0} dy={30} textAnchor="middle" fill={UI.muted} fontSize={10}>
                {date}
            </text>
        </g>
    );
};

const TooltipRow = ({ color, label, value }: { color: string; label: string; value: number }) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 10, height: 10, borderRadius: 3, background: color }} />
            <span style={{ color: UI.mutedSoft }}>{label}</span>
        </div>
        <span style={{ fontWeight: 600, color: UI.text }}>{value}</span>
    </div>
);

const CustomTooltip = ({ active, payload }: any) => {
    if (!active || !payload?.length) return null;
    const point = payload[0]?.payload as CfdPoint | undefined;
    if (!point) return null;

    return (
        <div style={{
            background: UI.bg,
            border: `1px solid ${UI.border}`,
            borderRadius: 12,
            padding: '14px 18px',
            fontSize: 12,
            minWidth: 200,
            boxShadow: '0 8px 24px rgba(15,23,42,0.08)',
        }}>
            <div style={{
                fontWeight: 700,
                fontSize: 13,
                color: UI.text,
                marginBottom: 10,
                paddingBottom: 8,
                borderBottom: `1px solid ${UI.border}`,
            }}>
                {point.tooltipLabel}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <TooltipRow color={COLORS.done} label="Concluido" value={point.done} />
                {point.blocked > 0 && (
                    <TooltipRow color={COLORS.blocked} label="Bloqueado" value={point.blocked} />
                )}
                <TooltipRow color={COLORS.inProgress} label="Em Progresso" value={point.inProgress} />
                <TooltipRow color={COLORS.todo} label="A Fazer" value={point.todo} />
                <div style={{
                    borderTop: `1px solid ${UI.border}`,
                    paddingTop: 6,
                    marginTop: 2,
                    display: 'flex',
                    justifyContent: 'space-between',
                }}>
                    <span style={{ color: UI.muted, fontWeight: 600 }}>Total</span>
                    <span style={{ fontWeight: 700, color: UI.text }}>{point.total}</span>
                </div>
            </div>
        </div>
    );
};

const LegendItem = ({ color, label }: { color: string; label: string }) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: UI.muted }}>
        <div style={{ width: 12, height: 12, borderRadius: 3, background: color }} />
        <span>{label}</span>
    </div>
);

export function CumulativeFlowChart({
    data,
    sprintStartDate,
    sprintEndDate,
    dayOffDates = [],
}: CumulativeFlowChartProps) {
    const model = useMemo(() => {
        if (!data.length || !sprintStartDate || !sprintEndDate) return null;

        const snapshots = [...data].sort(
            (a, b) => toUtcDayMs(a.snapshotDate) - toUtcDayMs(b.snapshotDate),
        );
        const snapshotByDay = new Map<number, SprintSnapshot>();
        snapshots.forEach(s => snapshotByDay.set(toUtcDayMs(s.snapshotDate), s));

        const offSet = new Set(dayOffDates);
        const startMs = toUtcDayMs(sprintStartDate);
        const endMs = toUtcDayMs(sprintEndDate);
        const todayMs = toUtcDayMs(new Date());

        const businessDays: number[] = [];
        for (let ms = startMs; ms <= endMs; ms += 24 * 60 * 60 * 1000) {
            const d = new Date(ms);
            const wd = d.getUTCDay();
            if (wd === 0 || wd === 6) continue;
            if (offSet.has(toIsoDate(ms))) continue;
            businessDays.push(ms);
        }

        let hasBlocked = false;
        const points: CfdPoint[] = [];

        for (const ms of businessDays) {
            if (ms > todayMs) break;

            let snap = snapshotByDay.get(ms);
            if (!snap) {
                for (let i = snapshots.length - 1; i >= 0; i--) {
                    if (toUtcDayMs(snapshots[i].snapshotDate) <= ms) {
                        snap = snapshots[i];
                        break;
                    }
                }
            }
            if (!snap) continue;

            const rawBlocked = snap.blockedCount || 0;
            const rawInProgress = snap.inProgressCount || 0;

            // Blocked é um subconjunto de inProgress para fins de empilhamento no gráfico
            const blocked = Math.min(rawBlocked, rawInProgress);
            const inProgress = rawInProgress - blocked;
            const done = snap.doneCount || 0;
            const todo = snap.todoCount || 0;

            if (blocked > 0) hasBlocked = true;

            points.push({
                axisLabel: `${capitalizeFirst(weekdayPtBr(ms))}|${shortDatePtBr(ms)}`,
                tooltipLabel: `${capitalizeFirst(weekdayPtBr(ms))} ${shortDatePtBr(ms)}`,
                done,
                blocked,
                inProgress,
                todo,
                total: done + blocked + inProgress + todo,
            });
        }

        return { points, hasBlocked };
    }, [data, sprintStartDate, sprintEndDate, dayOffDates]);

    if (!model || model.points.length === 0) return null;

    const { points, hasBlocked } = model;
    const lastPoint = points[points.length - 1];

    return (
        <div style={{
            background: UI.bg,
            borderRadius: 12,
            padding: 24,
            color: UI.text,
            maxWidth: '100%',
            border: `1px solid ${UI.border}`,
            boxShadow: '0 1px 3px rgba(15,23,42,0.08)',
        }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16, flexWrap: 'wrap', gap: 12 }}>
                <div>
                    <div style={{ fontSize: 10, color: UI.muted, textTransform: 'uppercase', letterSpacing: '2px', fontWeight: 600, marginBottom: 6 }}>
                        Cumulative Flow Diagram
                    </div>
                    <h2 style={{ fontSize: 22, fontWeight: 800, margin: 0, color: UI.text, letterSpacing: '-0.2px' }}>
                        Fluxo Acumulado da Sprint
                    </h2>
                </div>
                <div style={{
                    display: 'flex',
                    gap: 6,
                    fontSize: 11,
                    color: UI.muted,
                    background: UI.bgSoft,
                    borderRadius: 8,
                    padding: '8px 14px',
                    border: `1px solid ${UI.border}`,
                }}>
                    <span style={{ fontWeight: 600, color: UI.text }}>{lastPoint.total}</span>
                    <span>itens na sprint</span>
                </div>
            </div>

            <div style={{ display: 'flex', gap: 14, marginBottom: 16, flexWrap: 'wrap' }}>
                <LegendItem color={COLORS.done} label="Concluido" />
                {hasBlocked && <LegendItem color={COLORS.blocked} label="Bloqueado" />}
                <LegendItem color={COLORS.inProgress} label="Em Progresso" />
                <LegendItem color={COLORS.todo} label="A Fazer" />
            </div>

            <div style={{
                background: UI.bgSoft,
                borderRadius: 12,
                padding: '18px 12px 12px 0',
                border: `1px solid ${UI.border}`,
            }}>
                <ResponsiveContainer width="100%" height={360}>
                    <AreaChart data={points} margin={{ top: 10, right: 20, left: 10, bottom: 5 }}>
                        <defs>
                            <linearGradient id="cfdDoneGrad" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor={COLORS.done} stopOpacity={0.7} />
                                <stop offset="100%" stopColor={COLORS.done} stopOpacity={0.4} />
                            </linearGradient>
                            <linearGradient id="cfdBlockedGrad" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor={COLORS.blocked} stopOpacity={0.7} />
                                <stop offset="100%" stopColor={COLORS.blocked} stopOpacity={0.4} />
                            </linearGradient>
                            <linearGradient id="cfdInProgressGrad" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor={COLORS.inProgress} stopOpacity={0.7} />
                                <stop offset="100%" stopColor={COLORS.inProgress} stopOpacity={0.4} />
                            </linearGradient>
                            <linearGradient id="cfdTodoGrad" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor={COLORS.todo} stopOpacity={0.5} />
                                <stop offset="100%" stopColor={COLORS.todo} stopOpacity={0.2} />
                            </linearGradient>
                        </defs>

                        <CartesianGrid strokeDasharray="3 6" stroke={UI.grid} vertical={false} />

                        <XAxis
                            dataKey="axisLabel"
                            stroke={UI.mutedSoft}
                            tickLine={false}
                            axisLine={{ stroke: UI.axisLine }}
                            tick={<CustomXAxisTick />}
                            interval={0}
                            height={48}
                        />
                        <YAxis
                            stroke={UI.mutedSoft}
                            tick={{ fill: UI.muted, fontSize: 11 }}
                            tickLine={false}
                            axisLine={false}
                            width={40}
                            allowDecimals={false}
                        />

                        <Tooltip content={<CustomTooltip />} cursor={{ stroke: 'rgba(59,130,246,0.2)', strokeWidth: 1 }} />

                        <Area
                            type="monotone"
                            dataKey="done"
                            stackId="cfd"
                            stroke={COLORS.done}
                            strokeWidth={1.5}
                            fill="url(#cfdDoneGrad)"
                            name="Concluido"
                        />
                        {hasBlocked && (
                            <Area
                                type="monotone"
                                dataKey="blocked"
                                stackId="cfd"
                                stroke={COLORS.blocked}
                                strokeWidth={1.5}
                                fill="url(#cfdBlockedGrad)"
                                name="Bloqueado"
                            />
                        )}
                        <Area
                            type="monotone"
                            dataKey="inProgress"
                            stackId="cfd"
                            stroke={COLORS.inProgress}
                            strokeWidth={1.5}
                            fill="url(#cfdInProgressGrad)"
                            name="Em Progresso"
                        />
                        <Area
                            type="monotone"
                            dataKey="todo"
                            stackId="cfd"
                            stroke={COLORS.todo}
                            strokeWidth={1.5}
                            fill="url(#cfdTodoGrad)"
                            name="A Fazer"
                        />
                    </AreaChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
}
