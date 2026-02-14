import { useMemo, useState } from 'react';
import {
    Area,
    Bar,
    CartesianGrid,
    ComposedChart,
    LabelList,
    Line,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from 'recharts';
import type { SprintSnapshot } from '@/types';

interface BurndownChartProps {
    data: SprintSnapshot[];
    plannedInitial?: number;
    plannedCurrent?: number;
    plannedDelta?: number;
    currentRemaining?: number;
    sprintStartDate?: string;
    sprintEndDate?: string;
    dayOffDates?: string[];
}

type ChartPoint = {
    dayKey: string;
    axisLabel: string;
    tooltipLabel: string;
    dateLabel: string;
    dateMs: number;
    ideal: number;
    actual: number | null;
    projected: number | null;
    scopeAdded: number;
    scopeRemoved: number;
    completedInDay: number;
    completedAccum: number;
    isToday: boolean;
    isFuture: boolean;
    totalWork: number;
};

const UI_COLORS = {
    bg: '#FFFFFF',
    bgSoft: '#F8FAFC',
    border: '#E5E7EB',
    text: '#111827',
    muted: '#6B7280',
    mutedSoft: '#94A3B8',
    tooltipText: '#4B5563',
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

const TooltipRow = ({ color, label, value }: { color: string; label: string; value: string }) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 10, height: 3, borderRadius: 2, background: color }} />
            <span style={{ color: UI_COLORS.mutedSoft }}>{label}</span>
        </div>
        <span style={{ fontWeight: 600, color }}>{value}</span>
    </div>
);

const CustomXAxisTick = ({ x, y, payload }: any) => {
    const raw = String(payload?.value || '');
    const [day = '', date = ''] = raw.split('|');

    return (
        <g transform={`translate(${x},${y})`}>
            <text x={0} y={0} dy={14} textAnchor="middle" fill={UI_COLORS.muted} fontSize={11} fontWeight={600}>
                {day}
            </text>
            <text x={0} y={0} dy={30} textAnchor="middle" fill={UI_COLORS.muted} fontSize={10}>
                {date}
            </text>
        </g>
    );
};

const CustomTooltip = ({ active, payload }: any) => {
    if (!active || !payload || payload.length === 0) return null;
    const point = payload[0]?.payload as ChartPoint | undefined;
    if (!point) return null;

    return (
        <div
            style={{
                background: UI_COLORS.bg,
                border: `1px solid ${UI_COLORS.border}`,
                borderRadius: 12,
                padding: '14px 18px',
                fontSize: 12,
                color: UI_COLORS.tooltipText,
                minWidth: 210,
                boxShadow: '0 8px 24px rgba(15, 23, 42, 0.08)',
            }}
        >
            <div
                style={{
                    fontWeight: 700,
                    fontSize: 13,
                    color: UI_COLORS.text,
                    marginBottom: 10,
                    paddingBottom: 8,
                    borderBottom: `1px solid ${UI_COLORS.border}`,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                }}
            >
                {point.tooltipLabel}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <TooltipRow color="#63B3ED" label="Ideal" value={`${point.ideal}h`} />
                {point.actual !== null && <TooltipRow color="#F6AD55" label="Remaining" value={`${point.actual}h`} />}
                {point.projected !== null && <TooltipRow color="#9F7AEA" label="Projeção" value={`${point.projected}h`} />}
                {point.scopeAdded > 0 && <TooltipRow color="#FC8181" label="Escopo adicionado" value={`+${point.scopeAdded}h`} />}
                {point.scopeRemoved > 0 && <TooltipRow color="#EF4444" label="Escopo removido" value={`-${point.scopeRemoved}h`} />}
                {point.completedInDay > 0 && <TooltipRow color="#34D399" label="Concluído no dia" value={`${point.completedInDay}h`} />}
            </div>
        </div>
    );
};

const ActiveDot = ({ cx, cy, stroke }: any) => (
    <g>
        <circle cx={cx} cy={cy} r={6} fill={stroke} opacity={0.2} />
        <circle cx={cx} cy={cy} r={3} fill={stroke} stroke="#FFFFFF" strokeWidth={1.5} />
    </g>
);

const ScopeBarLabel = ({ x, y, width, value }: any) => {
    if (!value || value <= 0) return null;
    return (
        <text
            x={x + width / 2}
            y={y - 4}
            textAnchor="middle"
            fill="#B91C1C"
            fontSize={9}
            fontWeight={700}
        >
            {value}h
        </text>
    );
};

const CompletedBarLabel = ({ x, y, width, value }: any) => {
    if (!value || value <= 0) return null;
    return (
        <text
            x={x + width / 2}
            y={y - 12}
            textAnchor="middle"
            fill="#047857"
            fontSize={9}
            fontWeight={700}
        >
            {value}h
        </text>
    );
};

const MetricCard = ({
    label,
    value,
    unit,
    accent,
    sublabel,
}: {
    label: string;
    value: string | number;
    unit: string;
    accent: string;
    sublabel?: string;
}) => (
    <div
        style={{
            background: UI_COLORS.bg,
            border: `1px solid ${UI_COLORS.border}`,
            borderRadius: 12,
            padding: '14px 18px',
            flex: 1,
            minWidth: 120,
        }}
    >
        <div style={{ fontSize: 10, color: UI_COLORS.muted, textTransform: 'uppercase', letterSpacing: '1px', fontWeight: 600, marginBottom: 8 }}>
            {label}
        </div>
        <div style={{ fontSize: 24, fontWeight: 800, color: accent, lineHeight: 1 }}>
            {value}
            <span style={{ fontSize: 12, fontWeight: 400, color: UI_COLORS.muted, marginLeft: 3 }}>{unit}</span>
        </div>
        {sublabel && <div style={{ fontSize: 10, color: UI_COLORS.muted, marginTop: 6 }}>{sublabel}</div>}
    </div>
);

const LegendToggle = ({
    label,
    color,
    checked,
    onToggle,
}: {
    label: string;
    color: string;
    checked: boolean;
    onToggle: () => void;
}) => (
    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 11, color: UI_COLORS.muted }}>
        <input type="checkbox" checked={checked} onChange={onToggle} style={{ accentColor: color }} />
        <span style={{ color }}>{label}</span>
    </label>
);

const StatusBadge = ({ status, color, bgColor, deviation }: { status: string; color: string; bgColor: string; deviation: string }) => (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 12px', borderRadius: 20, background: bgColor, border: `1px solid ${color}33`, fontSize: 12, fontWeight: 600, color }}>
        {status}
        <span style={{ opacity: 0.6, fontWeight: 400, fontSize: 11 }}>{deviation}</span>
    </div>
);

export function BurndownChart({
    data,
    plannedInitial,
    plannedCurrent,
    plannedDelta,
    currentRemaining,
    sprintStartDate,
    sprintEndDate,
    dayOffDates = [],
}: BurndownChartProps) {
    const [showIdeal, setShowIdeal] = useState(true);
    const [showActual, setShowActual] = useState(true);
    const [showProjected, setShowProjected] = useState(true);
    const [showScope, setShowScope] = useState(true);
    const [showCompletedDaily, setShowCompletedDaily] = useState(true);

    const model = useMemo(() => {
        if (!data.length || !sprintStartDate || !sprintEndDate) return null;

        const snapshots = [...data].sort((a, b) => toUtcDayMs(a.snapshotDate) - toUtcDayMs(b.snapshotDate));
        const snapshotByDay = new Map<number, SprintSnapshot>();
        snapshots.forEach((s) => snapshotByDay.set(toUtcDayMs(s.snapshotDate), s));

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

        const points: ChartPoint[] = businessDays.map((ms, idx) => {
            const exact = snapshotByDay.get(ms);

            let snap = exact;
            if (!snap) {
                for (let i = snapshots.length - 1; i >= 0; i--) {
                    const sMs = toUtcDayMs(snapshots[i].snapshotDate);
                    if (sMs <= ms) {
                        snap = snapshots[i];
                        break;
                    }
                }
            }

            const isFuture = ms > todayMs;
            const ideal = Math.round(snap?.idealRemaining || 0);
            const actual = isFuture ? null : Math.round(snap?.remainingWork || 0);
            const totalWork = Math.round(snap?.totalWork || 0);

            return {
                dayKey: `D${idx + 1}`,
                axisLabel: `D${idx + 1}|${capitalizeFirst(weekdayPtBr(ms))} ${shortDatePtBr(ms)}`,
                tooltipLabel: `D${idx + 1} - ${capitalizeFirst(weekdayPtBr(ms))} ${shortDatePtBr(ms)}`,
                dateLabel: shortDatePtBr(ms),
                dateMs: ms,
                ideal,
                actual,
                projected: null,
                scopeAdded: 0,
                scopeRemoved: 0,
                completedInDay: 0,
                completedAccum: Math.round(snap?.completedWork || 0),
                isToday: ms === todayMs,
                isFuture,
                totalWork,
            };
        });

        const baseInitial = Math.max(
            0,
            Math.round(plannedInitial ?? snapshots[0]?.totalWork ?? points[0]?.totalWork ?? 0)
        );
        if (points.length > 0) {
            points[0].ideal = baseInitial;
            // Scope changes come from snapshot fields (real history), not derived from totalWork diff.
            for (let i = 0; i < points.length; i++) {
                const snap = snapshotByDay.get(points[i].dateMs);
                points[i].scopeAdded = Math.max(0, Math.round(snap?.addedCount || 0));
                points[i].scopeRemoved = Math.max(0, Math.round(snap?.removedCount || 0));
            }

            // Piecewise ideal: every scope increase recalculates the ideal burn for remaining days.
            let idealCursor = baseInitial;
            for (let i = 1; i < points.length; i++) {
                idealCursor += points[i].scopeAdded - points[i].scopeRemoved;
                idealCursor = Math.max(0, idealCursor);
                const stepsRemaining = points.length - i;
                const burnStep = stepsRemaining > 0 ? idealCursor / stepsRemaining : idealCursor;
                idealCursor = Math.max(0, idealCursor - burnStep);
                points[i].ideal = Math.round(idealCursor);
            }
        }

        let todayIdx = -1;
        for (let i = points.length - 1; i >= 0; i--) {
            if (!points[i].isFuture) {
                todayIdx = i;
                break;
            }
        }
        let lastActualIdx = -1;
        for (let i = points.length - 1; i >= 0; i--) {
            if (points[i].actual !== null) {
                lastActualIdx = i;
                break;
            }
        }

        // Completed in day uses snapshot accumulated completedWork (real history).
        const completedAccum: number[] = new Array(points.length).fill(0);
        for (let i = 0; i < points.length; i++) {
            completedAccum[i] = Math.max(0, Math.round(points[i].completedAccum || 0));
            const prevAccum = i > 0 ? completedAccum[i - 1] : 0;
            points[i].completedInDay = Math.max(0, completedAccum[i] - prevAccum);
        }

        const totalHours = Math.round(plannedCurrent ?? plannedInitial ?? snapshots[0]?.totalWork ?? 0);
        const snapshotInitialD1 = Math.round(points[0]?.totalWork ?? 0);
        const dayOneNetScope = Math.round((points[0]?.scopeAdded || 0) - (points[0]?.scopeRemoved || 0));
        // Header baseline (D0) = first visible day total minus the D1 net scope.
        // This keeps all D1..Dn scope bars visible and makes Delta match bar net sum.
        const snapshotInitial = Math.max(0, snapshotInitialD1 - dayOneNetScope);
        const snapshotFinal = Math.round(
            lastActualIdx >= 0
                ? (points[lastActualIdx]?.totalWork ?? snapshotInitial)
                : (points[points.length - 1]?.totalWork ?? snapshotInitial)
        );
        const snapshotDelta = snapshotFinal - snapshotInitial;
        const effectiveTotalHours = snapshotFinal || totalHours;
        const remNow = Math.max(
            0,
            Math.round(currentRemaining ?? (todayIdx >= 0 ? (points[todayIdx].actual || 0) : effectiveTotalHours))
        );
        const burnedTotal = lastActualIdx >= 0
            ? Math.max(0, Math.round(completedAccum[lastActualIdx]))
            : Math.max(0, effectiveTotalHours - remNow);
        const workedDays = lastActualIdx >= 0 ? lastActualIdx + 1 : 0;
        const avgBurnValue = workedDays > 0 ? burnedTotal / workedDays : 0;
        if (lastActualIdx >= 0) {
            const anchorIdx = lastActualIdx;
            const anchorRemaining = Math.max(0, Math.round(points[anchorIdx].actual ?? remNow));

            points[anchorIdx].projected = anchorRemaining;
            if (avgBurnValue > 0) {
                for (let i = anchorIdx + 1; i < points.length; i++) {
                    const steps = i - anchorIdx;
                    points[i].projected = Math.max(0, Math.round(anchorRemaining - avgBurnValue * steps));
                }
            } else {
                for (let i = anchorIdx + 1; i < points.length; i++) {
                    points[i].projected = anchorRemaining;
                }
            }
        }

        const deviationAbs = remNow - (todayIdx >= 0 ? points[todayIdx].ideal : effectiveTotalHours);
        const deviationPct = effectiveTotalHours > 0 ? (deviationAbs / effectiveTotalHours) * 100 : 0;
        const idealNow = lastActualIdx >= 0 ? Math.max(0, Math.round(points[lastActualIdx].ideal)) : effectiveTotalHours;
        const remainingDays = Math.max(0, points.length - workedDays);
        const neededIdealVelocity = remainingDays > 0 ? idealNow / remainingDays : 0;

        let status = 'No Prazo';
        let statusColor = '#63B3ED';
        let statusBg = 'rgba(99,179,237,0.1)';
        if (deviationPct <= -5) {
            status = 'Adiantado';
            statusColor = '#48BB78';
            statusBg = 'rgba(72,187,120,0.1)';
        } else if (deviationPct > 5 && deviationPct <= 15) {
            status = 'Em Risco';
            statusColor = '#F6AD55';
            statusBg = 'rgba(246,173,85,0.1)';
        } else if (deviationPct > 15) {
            status = 'Atrasado';
            statusColor = '#FC8181';
            statusBg = 'rgba(252,129,129,0.1)';
        }

        return {
            points,
            totalHours: effectiveTotalHours,
            headerInitial: snapshotInitial,
            headerFinal: snapshotFinal,
            headerDelta: snapshotDelta,
            remNow,
            burnedTotal,
            status,
            statusColor,
            statusBg,
            deviationPct,
            completionPct: effectiveTotalHours > 0 ? Math.round((burnedTotal / effectiveTotalHours) * 100) : 0,
            daysTotal: points.length,
            todayIdx,
            lastActualIdx,
            avgBurn: avgBurnValue,
            remainingDays,
            neededIdealVelocity,
            workedDays,
        };
    }, [data, plannedInitial, plannedCurrent, plannedDelta, currentRemaining, sprintStartDate, sprintEndDate, dayOffDates]);

    if (!model) return null;

    return (
        <div style={{ background: UI_COLORS.bg, borderRadius: 12, padding: 24, color: UI_COLORS.text, maxWidth: '100%', margin: '0 auto', border: `1px solid ${UI_COLORS.border}`, boxShadow: '0 1px 3px rgba(15, 23, 42, 0.08)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
                <div>
                    <div style={{ fontSize: 10, color: UI_COLORS.muted, textTransform: 'uppercase', letterSpacing: '2px', fontWeight: 600, marginBottom: 6 }}>
                        Sprint Burndown - {model.daysTotal} dias úteis
                    </div>
                    <h2 style={{ fontSize: 22, fontWeight: 800, margin: 0, color: UI_COLORS.text, letterSpacing: '-0.2px' }}>
                        Análise de Burn da Sprint
                    </h2>
                    <div style={{ fontSize: 12, color: UI_COLORS.muted, marginTop: 4, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                        <span>Inicial: {model.headerInitial}h</span>
                        <span>Final: {model.headerFinal}h</span>
                        <span style={{ color: model.headerDelta >= 0 ? '#FC8181' : '#3B82F6' }}>
                            Delta {model.headerDelta >= 0 ? '+' : ''}{model.headerDelta}h
                        </span>
                    </div>
                </div>
                <StatusBadge status={model.status} color={model.statusColor} bgColor={model.statusBg} deviation={`${model.deviationPct > 0 ? '+' : ''}${model.deviationPct.toFixed(1)}%`} />
            </div>

            <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
                <MetricCard label="Restante" value={model.remNow} unit="h" accent="#F6AD55" sublabel={`de ${model.totalHours}h planejadas`} />
                <MetricCard label="Concluído" value={model.burnedTotal} unit="h" accent="#48BB78" sublabel={`${model.completionPct}% da sprint`} />
                <MetricCard label="Vel. Média" value={model.avgBurn.toFixed(1)} unit="h/dia" accent="#63B3ED" sublabel={`necessário: ${model.neededIdealVelocity.toFixed(1)}h/dia`} />
                <MetricCard label="Dias Restantes" value={model.remainingDays} unit="dias" accent="#9F7AEA" sublabel={`trabalhados: ${model.workedDays} de ${model.daysTotal}`} />
            </div>

            <div style={{ display: 'flex', gap: 14, marginBottom: 16, flexWrap: 'wrap' }}>
                <LegendToggle label="Ideal" color="#63B3ED" checked={showIdeal} onToggle={() => setShowIdeal(!showIdeal)} />
                <LegendToggle label="Remaining" color="#F6AD55" checked={showActual} onToggle={() => setShowActual(!showActual)} />
                <LegendToggle label="Projeção" color="#9F7AEA" checked={showProjected} onToggle={() => setShowProjected(!showProjected)} />
                <LegendToggle label="Mudanças de Escopo" color="#FC8181" checked={showScope} onToggle={() => setShowScope(!showScope)} />
                <LegendToggle label="Concluído no dia" color="#34D399" checked={showCompletedDaily} onToggle={() => setShowCompletedDaily(!showCompletedDaily)} />
            </div>

            <div style={{ background: UI_COLORS.bgSoft, borderRadius: 12, padding: '18px 12px 12px 0', border: `1px solid ${UI_COLORS.border}` }}>
                <ResponsiveContainer width="100%" height={400}>
                    <ComposedChart data={model.points} margin={{ top: 10, right: 20, left: 10, bottom: 5 }}>
                        <defs>
                            <linearGradient id="idealGrad" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor="#3B82F6" stopOpacity={0.15} />
                                <stop offset="100%" stopColor="#63B3ED" stopOpacity={0} />
                            </linearGradient>
                        </defs>

                        <CartesianGrid strokeDasharray="3 6" stroke={UI_COLORS.grid} vertical={false} />

                        <XAxis
                            dataKey="axisLabel"
                            stroke={UI_COLORS.mutedSoft}
                            tickLine={false}
                            axisLine={{ stroke: UI_COLORS.axisLine }}
                            tick={<CustomXAxisTick />}
                            interval={0}
                            height={48}
                        />
                        <YAxis stroke={UI_COLORS.mutedSoft} tick={{ fill: UI_COLORS.muted, fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={(v) => `${v}h`} width={50} domain={[0, (max: number) => Math.max(100, Math.ceil(max / 10) * 10)]} />

                        <Tooltip content={<CustomTooltip />} cursor={{ stroke: 'rgba(59,130,246,0.2)', strokeWidth: 1 }} />

                        {showIdeal && <Area type="monotone" dataKey="ideal" stroke="#63B3ED" strokeWidth={2} fill="url(#idealGrad)" dot={false} activeDot={<ActiveDot />} strokeOpacity={0.7} name="Ideal" />}
                        {showActual && <Line type="monotone" dataKey="actual" stroke="#F6AD55" strokeWidth={2} dot={false} activeDot={<ActiveDot />} connectNulls={false} name="Remaining" />}
                        {showProjected && <Line type="monotone" dataKey="projected" stroke="#9F7AEA" strokeWidth={2} dot={false} strokeDasharray="4 4" connectNulls={false} name="Projeção" />}
                        {showScope && (
                            <Bar dataKey="scopeAdded" fill="rgba(252,129,129,0.6)" barSize={12}>
                                <LabelList dataKey="scopeAdded" content={<ScopeBarLabel />} />
                            </Bar>
                        )}
                        {showCompletedDaily && (
                            <Bar dataKey="completedInDay" fill="rgba(52,211,153,0.55)" barSize={12}>
                                <LabelList dataKey="completedInDay" content={<CompletedBarLabel />} />
                            </Bar>
                        )}
                    </ComposedChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
}


