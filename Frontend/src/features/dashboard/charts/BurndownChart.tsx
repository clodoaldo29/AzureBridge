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
import type { SprintSnapshot, WorkItem } from '@/types';
import { useScopeChanges } from '@/features/dashboard/queries/sprints';
import { toAzureEditUrl } from '@/features/dashboard/utils/azure-url';

interface BurndownChartProps {
    data: SprintSnapshot[];
    workItems?: WorkItem[];
    plannedInitial?: number;
    plannedInitialD1Date?: string | null;
    plannedCurrent?: number;
    plannedDelta?: number;
    currentRemaining?: number;
    sprintStartDate?: string;
    sprintEndDate?: string;
    dayOffDates?: string[];
    sprintId?: string;
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
                {point.scopeAdded > 0 && <TooltipRow color="#DC2626" label="Escopo adicionado" value={`+${point.scopeAdded}h`} />}
                {point.scopeRemoved > 0 && <TooltipRow color="#1E3A8A" label="Escopo removido" value={`${point.scopeRemoved}h`} />}
                {point.completedInDay > 0 && <TooltipRow color="#34D399" label="Concluído no dia" value={`${point.completedInDay}h`} />}
            </div>
            {(point.scopeAdded > 0 || point.scopeRemoved > 0) && (
                <div style={{ marginTop: 8, paddingTop: 8, borderTop: `1px solid ${UI_COLORS.border}`, fontSize: 10, color: UI_COLORS.mutedSoft, textAlign: 'center' }}>
                    Clique na barra para ver os itens
                </div>
            )}
        </div>
    );
};

const ActiveDot = ({ cx, cy, stroke }: any) => (
    <g>
        <circle cx={cx} cy={cy} r={6} fill={stroke} opacity={0.2} />
        <circle cx={cx} cy={cy} r={3} fill={stroke} stroke="#FFFFFF" strokeWidth={1.5} />
    </g>
);

const ScopeBarLabel = ({ x, y, width, value, payload, onOpen }: any) => {
    if (!value || value <= 0) return null;
    return (
        <text
            x={x + width / 2}
            y={y - 4}
            textAnchor="middle"
            fill="#B91C1C"
            fontSize={9}
            fontWeight={700}
            pointerEvents="all"
            style={{ cursor: onOpen ? 'pointer' : 'default' }}
            onClick={(e) => {
                e.stopPropagation();
                if (!onOpen || !payload) return;
                onOpen(payload);
            }}
        >
            {value}h
        </text>
    );
};

const ScopeRemovedBarLabel = ({ x, y, width, value, payload, onOpen }: any) => {
    if (!value || value <= 0) return null;
    return (
        <text
            x={x + width / 2}
            y={y - 4}
            textAnchor="middle"
            fill="#1E3A8A"
            fontSize={9}
            fontWeight={700}
            pointerEvents="all"
            style={{ cursor: onOpen ? 'pointer' : 'default' }}
            onClick={(e) => {
                e.stopPropagation();
                if (!onOpen || !payload) return;
                onOpen(payload);
            }}
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
    workItems = [],
    plannedInitial,
    plannedInitialD1Date,
    plannedCurrent,
    plannedDelta,
    currentRemaining,
    sprintStartDate,
    sprintEndDate,
    dayOffDates = [],
    sprintId,
}: BurndownChartProps) {
    const [showIdeal, setShowIdeal] = useState(true);
    const [showActual, setShowActual] = useState(true);
    const [showProjected, setShowProjected] = useState(true);
    const [showScopeAdded, setShowScopeAdded] = useState(true);
    const [showScopeRemoved, setShowScopeRemoved] = useState(true);
    const [showCompletedDaily, setShowCompletedDaily] = useState(true);

    const [scopeModal, setScopeModal] = useState<{
        date: string;
        label: string;
        initialTab: 'added' | 'removed';
    } | null>(null);
    const [scopeTab, setScopeTab] = useState<'added' | 'removed'>('added');
    const azureOrgUrl = (import.meta as any)?.env?.VITE_AZURE_DEVOPS_ORG_URL as string | undefined;

    const { data: scopeChanges, isLoading: scopeLoading } = useScopeChanges(
        sprintId || '',
        scopeModal?.date || null
    );

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
                dateLabel: toIsoDate(ms),
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
            const firstBusinessMs = businessDays[0];
            const d1Ms = plannedInitialD1Date ? toUtcDayMs(plannedInitialD1Date) : firstBusinessMs;
            const d0Ms = d1Ms - (24 * 60 * 60 * 1000);
            const isD0Future = d0Ms > todayMs;

            points.unshift({
                dayKey: 'D0',
                axisLabel: `D0|${capitalizeFirst(weekdayPtBr(d0Ms))} ${shortDatePtBr(d0Ms)}`,
                tooltipLabel: `D0 - ${capitalizeFirst(weekdayPtBr(d0Ms))} ${shortDatePtBr(d0Ms)}`,
                dateLabel: toIsoDate(d0Ms),
                dateMs: d0Ms,
                ideal: baseInitial,
                actual: isD0Future ? null : baseInitial,
                projected: null,
                scopeAdded: 0,
                scopeRemoved: 0,
                completedInDay: 0,
                completedAccum: 0,
                isToday: d0Ms === todayMs,
                isFuture: isD0Future,
                totalWork: baseInitial,
            });

            points[1].ideal = baseInitial;
            // Mudanças de escopo vêm dos campos do snapshot (histórico real), não derivadas da diferença de totalWork.
            for (let i = 1; i < points.length; i++) {
                const snap = snapshotByDay.get(points[i].dateMs);
                points[i].scopeAdded = Math.max(0, Math.round(snap?.addedCount || 0));
                points[i].scopeRemoved = Math.max(0, Math.round(snap?.removedCount || 0));
            }

            // Fallback: if backend still has removedCount = 0, infer removed scope from
            // real item history on changedDate (initial -> planned current).
            const hasExplicitRemoved = points.some((p) => p.scopeRemoved > 0);
            if (!hasExplicitRemoved) {
                for (const item of workItems) {
                    const initial = Math.max(0, Math.round(Number(item.initialRemainingWork || 0)));
                    if (initial <= 0) continue;

                    const last = Math.max(0, Math.round(Number(item.lastRemainingWork || 0)));
                    const done = Math.max(0, Math.round(Number(item.doneRemainingWork || 0)));
                    const remaining = Math.max(0, Math.round(Number(item.remainingWork || 0)));
                    const completed = Math.max(0, Math.round(Number(item.completedWork || 0)));
                    const currentTotal = remaining + completed;
                    const state = String(item.state || '').toLowerCase();
                    const isDone = state === 'done' || state === 'closed' || state === 'completed';

                    const plannedCurrent = item.isRemoved
                        ? (last > 0 ? last : (done > 0 ? done : currentTotal))
                        : (isDone
                            ? (done > 0 ? done : (last > 0 ? last : currentTotal))
                            : (last > 0 ? last : remaining));

                    const removedHours = Math.max(0, initial - plannedCurrent);
                    if (removedHours <= 0) continue;

                    const changedMs = toUtcDayMs(item.changedDate);
                    let idx = points.findIndex((p) => p.dateMs === changedMs);
                    if (idx < 0) {
                        idx = 0;
                        for (let i = points.length - 1; i >= 0; i--) {
                            if (points[i].dateMs <= changedMs) {
                                idx = i;
                                break;
                            }
                        }
                    }
                    if (idx >= 0 && idx < points.length) {
                        points[idx].scopeRemoved += removedHours;
                    }
                }
            }

            // Ideal piecewise: cada aumento de escopo recalcula o burn ideal para os dias restantes.
            let idealCursor = baseInitial;
            for (let i = 2; i < points.length; i++) {
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

        // Concluído no dia usa completedWork acumulado do snapshot (histórico real).
        const completedAccum: number[] = new Array(points.length).fill(0);
        for (let i = 0; i < points.length; i++) {
            completedAccum[i] = Math.max(0, Math.round(points[i].completedAccum || 0));
            const prevAccum = i > 0 ? completedAccum[i - 1] : 0;
            points[i].completedInDay = Math.max(0, completedAccum[i] - prevAccum);
        }

        const totalHours = Math.round(plannedCurrent ?? plannedInitial ?? snapshots[0]?.totalWork ?? 0);
        const snapshotInitial = baseInitial;
        const snapshotFinal = Math.round(
            lastActualIdx >= 0
                ? (points[lastActualIdx]?.totalWork ?? snapshotInitial)
                : (points[points.length - 1]?.totalWork ?? snapshotInitial)
        );
        const snapshotDelta = snapshotFinal - snapshotInitial;
        const headerDelta = typeof plannedDelta === 'number' ? Math.round(plannedDelta) : snapshotDelta;
        const effectiveTotalHours = snapshotFinal || totalHours;
        const remNow = Math.max(
            0,
            Math.round(currentRemaining ?? (todayIdx >= 0 ? (points[todayIdx].actual || 0) : effectiveTotalHours))
        );
        const burnedTotal = lastActualIdx >= 0
            ? Math.max(0, Math.round(completedAccum[lastActualIdx]))
            : Math.max(0, effectiveTotalHours - remNow);
        const workedDays = businessDays.filter((ms) => ms <= todayMs).length;
        const isAfterSprint = todayMs > endMs;
        const remainingDaysIncludingToday = isAfterSprint
            ? 0
            : businessDays.filter((ms) => ms >= todayMs).length;
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
        const remainingDays = Math.max(0, remainingDaysIncludingToday);
        const neededIdealVelocity = businessDays.length > 0 ? effectiveTotalHours / businessDays.length : 0;

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
            headerDelta,
            remNow,
            burnedTotal,
            status,
            statusColor,
            statusBg,
            deviationPct,
            completionPct: effectiveTotalHours > 0 ? Math.round((burnedTotal / effectiveTotalHours) * 100) : 0,
            daysTotal: businessDays.length,
            todayIdx,
            lastActualIdx,
            avgBurn: avgBurnValue,
            remainingDays,
            neededIdealVelocity,
            workedDays,
        };
    }, [data, workItems, plannedInitial, plannedInitialD1Date, plannedCurrent, plannedDelta, currentRemaining, sprintStartDate, sprintEndDate, dayOffDates]);

    if (!model) return null;

    return (
        <>
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
                <MetricCard
                    label="Vel. Real"
                    value={model.avgBurn.toFixed(1)}
                    unit="h/dia"
                    accent="#63B3ED"
                    sublabel={`necessária: ${model.neededIdealVelocity.toFixed(1)}h/dia`}
                />
                <MetricCard label="Dias Restantes" value={model.remainingDays} unit="dias" accent="#9F7AEA" sublabel={`trabalhados: ${model.workedDays} de ${model.daysTotal}`} />
            </div>

            <div style={{ display: 'flex', gap: 14, marginBottom: 16, flexWrap: 'wrap' }}>
                <LegendToggle label="Ideal" color="#63B3ED" checked={showIdeal} onToggle={() => setShowIdeal(!showIdeal)} />
                <LegendToggle label="Remaining" color="#F6AD55" checked={showActual} onToggle={() => setShowActual(!showActual)} />
                <LegendToggle label="Projeção" color="#9F7AEA" checked={showProjected} onToggle={() => setShowProjected(!showProjected)} />
                <LegendToggle label="Escopo Adicionado" color="#DC2626" checked={showScopeAdded} onToggle={() => setShowScopeAdded(!showScopeAdded)} />
                <LegendToggle label="Escopo Removido" color="#1E3A8A" checked={showScopeRemoved} onToggle={() => setShowScopeRemoved(!showScopeRemoved)} />
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
                        {showScopeAdded && (
                            <Bar
                                dataKey="scopeAdded"
                                fill="rgba(220,38,38,0.78)"
                                barSize={20}
                                style={sprintId ? { cursor: 'pointer' } : undefined}
                                onClick={(point: ChartPoint) => {
                                    if (!sprintId || !point.scopeAdded) return;
                                    setScopeTab('added');
                                    setScopeModal({ date: point.dateLabel, label: point.tooltipLabel, initialTab: 'added' });
                                }}
                            >
                                <LabelList
                                    dataKey="scopeAdded"
                                    content={(labelProps: any) => (
                                        <ScopeBarLabel
                                            {...labelProps}
                                            onOpen={(point: ChartPoint) => {
                                                if (!sprintId || !point?.scopeAdded) return;
                                                setScopeTab('added');
                                                setScopeModal({ date: point.dateLabel, label: point.tooltipLabel, initialTab: 'added' });
                                            }}
                                        />
                                    )}
                                />
                            </Bar>
                        )}
                        {showScopeRemoved && (
                            <Bar
                                dataKey="scopeRemoved"
                                fill="rgba(30,58,138,0.78)"
                                barSize={20}
                                style={sprintId ? { cursor: 'pointer' } : undefined}
                                onClick={(point: ChartPoint) => {
                                    if (!sprintId || !point.scopeRemoved) return;
                                    setScopeTab('removed');
                                    setScopeModal({ date: point.dateLabel, label: point.tooltipLabel, initialTab: 'removed' });
                                }}
                            >
                                <LabelList
                                    dataKey="scopeRemoved"
                                    content={(labelProps: any) => (
                                        <ScopeRemovedBarLabel
                                            {...labelProps}
                                            onOpen={(point: ChartPoint) => {
                                                if (!sprintId || !point?.scopeRemoved) return;
                                                setScopeTab('removed');
                                                setScopeModal({ date: point.dateLabel, label: point.tooltipLabel, initialTab: 'removed' });
                                            }}
                                        />
                                    )}
                                />
                            </Bar>
                        )}
                        {showCompletedDaily && (
                            <Bar dataKey="completedInDay" fill="rgba(52,211,153,0.55)" barSize={20}>
                                <LabelList dataKey="completedInDay" content={<CompletedBarLabel />} />
                            </Bar>
                        )}
                    </ComposedChart>
                </ResponsiveContainer>
            </div>
        </div>

        {scopeModal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
                <div className="w-full max-w-2xl rounded-lg border border-border bg-background shadow-xl">
                    <div className="flex items-center justify-between border-b border-border p-4">
                        <div>
                            <h3 className="text-base font-semibold text-foreground">Alterações de Escopo</h3>
                            <p className="text-sm text-muted-foreground">{scopeModal.label}</p>
                        </div>
                        <div className="flex items-center gap-2">
                            <button
                                className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${scopeTab === 'added' ? 'bg-amber-100 text-amber-800' : 'text-muted-foreground hover:bg-muted'}`}
                                onClick={() => setScopeTab('added')}
                            >
                                Adicionados
                                {scopeChanges && (
                                    <span className="ml-1.5 rounded-full bg-amber-200 px-1.5 py-0.5 text-xs text-amber-800">
                                        {scopeChanges.added.length}
                                    </span>
                                )}
                            </button>
                            <button
                                className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${scopeTab === 'removed' ? 'bg-red-100 text-red-800' : 'text-muted-foreground hover:bg-muted'}`}
                                onClick={() => setScopeTab('removed')}
                            >
                                Removidos
                                {scopeChanges && (
                                    <span className="ml-1.5 rounded-full bg-red-200 px-1.5 py-0.5 text-xs text-red-800">
                                        {scopeChanges.removed.length}
                                    </span>
                                )}
                            </button>
                            <button
                                className="ml-2 rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted"
                                onClick={() => setScopeModal(null)}
                            >
                                Fechar
                            </button>
                        </div>
                    </div>

                    <div className="max-h-[60vh] overflow-auto p-4 space-y-2">
                        {scopeLoading && (
                            <div className="py-10 text-center text-sm text-muted-foreground">Carregando...</div>
                        )}
                        {!scopeLoading && scopeChanges && (() => {
                            const items = scopeTab === 'added' ? scopeChanges.added : scopeChanges.removed;
                            if (items.length === 0) {
                                return (
                                    <div className="py-10 text-center text-sm text-muted-foreground">
                                        Nenhum item {scopeTab === 'added' ? 'adicionado' : 'removido'} neste dia.
                                    </div>
                                );
                            }
                            const reasonLabel: Record<string, string> = {
                                added_to_sprint: 'Entrou na sprint',
                                removed_from_sprint: 'Saiu da sprint',
                                hours_increased: 'Horas aumentadas',
                                hours_decreased: 'Horas reduzidas',
                            };
                            const reasonColor: Record<string, string> = {
                                added_to_sprint: 'bg-green-100 text-green-800',
                                removed_from_sprint: 'bg-red-100 text-red-800',
                                hours_increased: 'bg-amber-100 text-amber-800',
                                hours_decreased: 'bg-orange-100 text-orange-800',
                            };
                            return items.map((item) => (
                                <div key={item.id} className="rounded-lg border border-border bg-card p-3">
                                    <div className="flex items-start justify-between gap-2">
                                        <div className="font-medium text-sm text-foreground">
                                            #{item.id} — {item.title}
                                        </div>
                                        <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${reasonColor[item.reason] || 'bg-muted text-muted-foreground'}`}>
                                            {reasonLabel[item.reason] || item.reason}
                                        </span>
                                    </div>
                                    <div className="mt-1 text-xs text-muted-foreground">
                                        {item.type}
                                        {' · '}
                                        <span className={scopeTab === 'added' ? 'text-amber-700 font-semibold' : 'text-red-700 font-semibold'}>
                                            {scopeTab === 'added' ? '+' : ''}{item.hoursChange}h
                                        </span>
                                        {' · '}
                                        por {item.changedBy}
                                    </div>
                                    {(() => {
                                        const azureUrl = toAzureEditUrl(item.azureUrl, item.id, { fallbackOrgUrl: azureOrgUrl });
                                        if (!azureUrl) {
                                            return (
                                                <div className="mt-2 text-xs text-muted-foreground">
                                                    Link Azure indisponivel para este item.
                                                </div>
                                            );
                                        }
                                        return (
                                            <a
                                                href={azureUrl}
                                                target="_blank"
                                                rel="noreferrer"
                                                className="mt-2 inline-block text-blue-600 hover:underline text-sm font-medium"
                                            >
                                                Abrir no Azure DevOps
                                            </a>
                                        );
                                    })()}
                                </div>
                            ));
                        })()}
                    </div>
                </div>
            </div>
        )}
        </>
    );
}
