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
    label: string;
    dateLabel: string;
    dateMs: number;
    ideal: number;
    actual: number | null;
    projected: number | null;
    scopeAdded: number;
    isToday: boolean;
    isFuture: boolean;
    totalWork: number;
};

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

const TooltipRow = ({ color, label, value }: { color: string; label: string; value: string }) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 10, height: 3, borderRadius: 2, background: color }} />
            <span style={{ color: '#A0AEC0' }}>{label}</span>
        </div>
        <span style={{ fontWeight: 600, color }}>{value}</span>
    </div>
);

const CustomTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload || payload.length === 0) return null;
    const point = payload[0]?.payload as ChartPoint | undefined;
    if (!point) return null;

    return (
        <div
            style={{
                background: '#FFFFFF',
                border: '1px solid #E5E7EB',
                borderRadius: 12,
                padding: '14px 18px',
                fontSize: 12,
                color: '#4B5563',
                minWidth: 210,
                boxShadow: '0 8px 24px rgba(15, 23, 42, 0.08)',
            }}
        >
            <div
                style={{
                    fontWeight: 700,
                    fontSize: 13,
                    color: '#111827',
                    marginBottom: 10,
                    paddingBottom: 8,
                    borderBottom: '1px solid #E5E7EB',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                }}
            >
                {label}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <TooltipRow color="#63B3ED" label="Ideal" value={`${point.ideal}h`} />
                {point.actual !== null && <TooltipRow color="#F6AD55" label="Remaining" value={`${point.actual}h`} />}
                {point.projected !== null && <TooltipRow color="#9F7AEA" label="Projecao" value={`${point.projected}h`} />}
                {point.scopeAdded > 0 && <TooltipRow color="#FC8181" label="Escopo adicionado" value={`+${point.scopeAdded}h`} />}
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
            y={y - 6}
            textAnchor="middle"
            fill="#B91C1C"
            fontSize={10}
            fontWeight={700}
        >
            +{value}h
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
            background: '#FFFFFF',
            border: '1px solid #E5E7EB',
            borderRadius: 12,
            padding: '14px 18px',
            flex: 1,
            minWidth: 120,
        }}
    >
        <div style={{ fontSize: 10, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '1px', fontWeight: 600, marginBottom: 8 }}>
            {label}
        </div>
        <div style={{ fontSize: 24, fontWeight: 800, color: accent, lineHeight: 1 }}>
            {value}
            <span style={{ fontSize: 12, fontWeight: 400, color: '#6B7280', marginLeft: 3 }}>{unit}</span>
        </div>
        {sublabel && <div style={{ fontSize: 10, color: '#6B7280', marginTop: 6 }}>{sublabel}</div>}
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
    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 11, color: '#6B7280' }}>
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
                label: `D${idx + 1} - ${weekdayPtBr(ms)} ${shortDatePtBr(ms)}`,
                dateLabel: shortDatePtBr(ms),
                dateMs: ms,
                ideal,
                actual,
                projected: null,
                scopeAdded: 0,
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
            points[0].scopeAdded = 0;

            // Daily scope changes are derived from totalWork day-to-day.
            for (let i = 1; i < points.length; i++) {
                const delta = Math.round(points[i].totalWork - points[i - 1].totalWork);
                points[i].scopeAdded = delta > 0 ? delta : 0;
            }

            // Piecewise ideal: every scope increase recalculates the ideal burn for remaining days.
            let idealCursor = baseInitial;
            for (let i = 1; i < points.length; i++) {
                idealCursor += points[i].scopeAdded;
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

        const totalHours = Math.round(plannedCurrent ?? plannedInitial ?? snapshots[0]?.totalWork ?? 0);
        const remNow = Math.max(0, Math.round(currentRemaining ?? (todayIdx >= 0 ? (points[todayIdx].actual || 0) : totalHours)));
        const burnedTotal = Math.max(0, totalHours - remNow);
        const workedDays = Math.max(0, lastActualIdx);
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

        const deviationAbs = remNow - (todayIdx >= 0 ? points[todayIdx].ideal : totalHours);
        const deviationPct = totalHours > 0 ? (deviationAbs / totalHours) * 100 : 0;
        const idealNow = lastActualIdx >= 0 ? Math.max(0, Math.round(points[lastActualIdx].ideal)) : totalHours;
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
            totalHours,
            remNow,
            burnedTotal,
            status,
            statusColor,
            statusBg,
            deviationPct,
            completionPct: totalHours > 0 ? Math.round((burnedTotal / totalHours) * 100) : 0,
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
        <div style={{ background: '#FFFFFF', borderRadius: 12, padding: 24, color: '#111827', maxWidth: '100%', margin: '0 auto', border: '1px solid #E5E7EB', boxShadow: '0 1px 3px rgba(15, 23, 42, 0.08)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
                <div>
                    <div style={{ fontSize: 10, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '2px', fontWeight: 600, marginBottom: 6 }}>
                        Sprint Burndown - {model.daysTotal} dias uteis
                    </div>
                    <h2 style={{ fontSize: 22, fontWeight: 800, margin: 0, color: '#111827', letterSpacing: '-0.3px' }}>
                        Analise de Burn da Sprint
                    </h2>
                    <div style={{ fontSize: 12, color: '#6B7280', marginTop: 4, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                        <span>Inicial: {Math.round(plannedInitial ?? model.totalHours)}h</span>
                        <span>Final: {model.totalHours}h</span>
                        <span style={{ color: '#FC8181' }}>Delta +{Math.max(0, Math.round(plannedDelta ?? 0))}h</span>
                    </div>
                </div>
                <StatusBadge status={model.status} color={model.statusColor} bgColor={model.statusBg} deviation={`${model.deviationPct > 0 ? '+' : ''}${model.deviationPct.toFixed(1)}%`} />
            </div>

            <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
                <MetricCard label="Restante" value={model.remNow} unit="h" accent="#F6AD55" sublabel={`de ${model.totalHours}h planejadas`} />
                <MetricCard label="Concluido" value={model.burnedTotal} unit="h" accent="#48BB78" sublabel={`${model.completionPct}% da sprint`} />
                <MetricCard label="Vel. Media" value={model.avgBurn.toFixed(1)} unit="h/dia" accent="#63B3ED" sublabel={`necessario: ${model.neededIdealVelocity.toFixed(1)}h/dia`} />
                <MetricCard label="Dias Restantes" value={model.remainingDays} unit="dias" accent="#9F7AEA" sublabel={`trabalhados: ${model.workedDays} de ${model.daysTotal}`} />
            </div>

            <div style={{ display: 'flex', gap: 14, marginBottom: 16, flexWrap: 'wrap' }}>
                <LegendToggle label="Ideal" color="#63B3ED" checked={showIdeal} onToggle={() => setShowIdeal(!showIdeal)} />
                <LegendToggle label="Remaining" color="#F6AD55" checked={showActual} onToggle={() => setShowActual(!showActual)} />
                <LegendToggle label="Projecao" color="#9F7AEA" checked={showProjected} onToggle={() => setShowProjected(!showProjected)} />
                <LegendToggle label="Mudancas de Escopo" color="#FC8181" checked={showScope} onToggle={() => setShowScope(!showScope)} />
            </div>

            <div style={{ background: '#F8FAFC', borderRadius: 12, padding: '18px 12px 12px 0', border: '1px solid #E5E7EB' }}>
                <ResponsiveContainer width="100%" height={400}>
                    <ComposedChart data={model.points} margin={{ top: 10, right: 20, left: 10, bottom: 5 }}>
                        <defs>
                            <linearGradient id="idealGrad" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor="#3B82F6" stopOpacity={0.15} />
                                <stop offset="100%" stopColor="#63B3ED" stopOpacity={0} />
                            </linearGradient>
                        </defs>

                        <CartesianGrid strokeDasharray="3 6" stroke="rgba(148,163,184,0.35)" vertical={false} />

                        <XAxis dataKey="label" stroke="#94A3B8" tick={{ fill: '#64748B', fontSize: 9 }} tickLine={false} axisLine={{ stroke: '#E2E8F0' }} angle={-40} textAnchor="end" height={65} />
                        <YAxis stroke="#94A3B8" tick={{ fill: '#64748B', fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={(v) => `${v}h`} width={50} domain={[0, (max: number) => Math.max(100, Math.ceil(max / 10) * 10)]} />

                        <Tooltip content={<CustomTooltip />} cursor={{ stroke: 'rgba(59,130,246,0.2)', strokeWidth: 1 }} />

                        {showIdeal && <Area type="monotone" dataKey="ideal" stroke="#63B3ED" strokeWidth={2} fill="url(#idealGrad)" dot={false} activeDot={<ActiveDot />} strokeOpacity={0.7} name="Ideal" />}
                        {showActual && <Line type="monotone" dataKey="actual" stroke="#F6AD55" strokeWidth={2} dot={false} activeDot={<ActiveDot />} connectNulls={false} name="Remaining" />}
                        {showProjected && <Line type="monotone" dataKey="projected" stroke="#9F7AEA" strokeWidth={2} dot={false} strokeDasharray="4 4" connectNulls={false} name="Projecao" />}
                        {showScope && (
                            <Bar dataKey="scopeAdded" fill="rgba(252,129,129,0.6)" barSize={8}>
                                <LabelList dataKey="scopeAdded" content={<ScopeBarLabel />} />
                            </Bar>
                        )}
                    </ComposedChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
}


