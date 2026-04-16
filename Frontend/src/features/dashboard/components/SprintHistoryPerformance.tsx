import {
    Area,
    Bar,
    Cell,
    CartesianGrid,
    ComposedChart,
    LabelList,
    Legend,
    Line,
    ReferenceArea,
    ReferenceLine,
    ResponsiveContainer,
    Scatter,
    ScatterChart,
    Tooltip,
    XAxis,
    YAxis,
    ZAxis,
} from 'recharts';
import type { SprintHistorySummary } from '@/types';

interface SprintHistoryPerformanceProps {
    summaries: SprintHistorySummary[];
    projectName?: string;
}

type HistoryRow = {
    sprintId: string;
    sprintName: string;
    startDateLabel: string;
    endDateLabel: string;
    isCurrent: boolean;
    capacity: number;
    planned: number;
    delivered: number;
    planVsCapacity: number;
    deliveredVsPlanned: number;
    deliveredVsCapacity: number;
    scopeAdded: number;
    scopeRemoved: number;
    scopeRemovedVisual: number;
    scopeNet: number;
    finalDeviation: number;
};

function formatDatePtBr(value: string): string {
    return new Date(value).toLocaleDateString('pt-BR', { timeZone: 'UTC' });
}

function round(value: number, decimals = 1): number {
    const factor = Math.pow(10, decimals);
    return Math.round(value * factor) / factor;
}

function formatHours(value: number): string {
    return `${Math.round(Number(value || 0))}h`;
}

function mean(values: number[]): number {
    if (!values.length) return 0;
    return values.reduce((acc, value) => acc + value, 0) / values.length;
}

function stdDev(values: number[]): number {
    if (!values.length) return 0;
    const avg = mean(values);
    const variance = mean(values.map((v) => Math.pow(v - avg, 2)));
    return Math.sqrt(variance);
}

function getPlanVsCapacityClass(value: number): string {
    if (value >= 85) return 'bg-emerald-50 text-emerald-700 border-emerald-200';
    if (value >= 60) return 'bg-amber-50 text-amber-700 border-amber-200';
    return 'bg-red-50 text-red-700 border-red-200';
}

function getDeliveredVsPlannedClass(value: number): string {
    if (value >= 90) return 'bg-emerald-50 text-emerald-700 border-emerald-200';
    if (value >= 70) return 'bg-amber-50 text-amber-700 border-amber-200';
    return 'bg-red-50 text-red-700 border-red-200';
}

function TooltipContent({ active, payload, label }: any) {
    if (!active || !payload?.length) return null;
    const row = payload[0]?.payload as HistoryRow | undefined;
    if (!row) return null;

    return (
        <div className="rounded-md border border-border bg-background p-3 text-xs shadow-md">
            <div className="font-semibold text-foreground">{label}</div>
            <div className="text-muted-foreground mb-2">{row.startDateLabel}</div>
            <div className="space-y-1">
                <div>Capacidade: {formatHours(row.capacity)}</div>
                <div>Planejado: {formatHours(row.planned)}</div>
                <div>Entregue: {formatHours(row.delivered)}</div>
                <div>Plan x Cap: {row.planVsCapacity.toFixed(1)}%</div>
                <div>Ent x Plan: {row.deliveredVsPlanned.toFixed(1)}%</div>
                <div>Ent x Cap: {row.deliveredVsCapacity.toFixed(1)}%</div>
            </div>
        </div>
    );
}

function EfficiencyTooltip({ active, payload }: any) {
    if (!active || !payload?.length) return null;
    const row = payload[0]?.payload as HistoryRow | undefined;
    if (!row) return null;

    return (
        <div className="rounded-md border border-border bg-background p-3 text-xs shadow-md">
            <div className="font-semibold text-foreground">{row.sprintName}</div>
            <div className="text-muted-foreground mb-2">
                {row.startDateLabel} - {row.endDateLabel}
            </div>
            <div className="space-y-1">
                <div>Plan x Cap: {row.planVsCapacity.toFixed(1)}%</div>
                <div>Ent x Plan: {row.deliveredVsPlanned.toFixed(1)}%</div>
                <div>Planejado: {formatHours(row.planned)}</div>
                <div>Entregue: {formatHours(row.delivered)}</div>
            </div>
        </div>
    );
}

export function SprintHistoryPerformance({ summaries, projectName }: SprintHistoryPerformanceProps) {
    const rows: HistoryRow[] = [...summaries]
        .sort((a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime())
        .map((summary) => ({
            sprintId: summary.sprintId,
            sprintName: summary.sprintName,
            startDateLabel: formatDatePtBr(summary.startDate),
            endDateLabel: formatDatePtBr(summary.endDate),
            isCurrent: Boolean(summary.isCurrent),
            capacity: round(Number(summary.capacityHours || 0), 0),
            planned: round(Number(summary.plannedHours || 0), 0),
            delivered: round(Number(summary.deliveredHours || 0), 0),
            planVsCapacity: round(Number(summary.planVsCapacityPct || 0), 1),
            deliveredVsPlanned: round(Number(summary.deliveredVsPlannedPct || 0), 1),
            deliveredVsCapacity: round(Number(summary.deliveredVsCapacityPct || 0), 1),
            scopeAdded: round(Number(summary.scopeAddedHours || 0), 0),
            scopeRemoved: round(Number(summary.scopeRemovedHours || 0), 0),
            scopeRemovedVisual: round(-Number(summary.scopeRemovedHours || 0), 0),
            scopeNet: round(Number(summary.scopeAddedHours || 0) - Number(summary.scopeRemovedHours || 0), 0),
            finalDeviation: round(Number(summary.finalDeviationHours || 0), 0),
        }));

    const chartRows = rows.filter((row) => !row.isCurrent);
    const nonZeroRows = rows.filter((row) => row.capacity > 0 || row.planned > 0 || row.delivered > 0);
    const metricRows = chartRows.length > 0 ? chartRows : [];
    const avgCapacity = round(mean(metricRows.map((row) => row.capacity)), 0);
    const avgPlanned = round(mean(metricRows.map((row) => row.planned)), 0);
    const avgDelivered = round(mean(metricRows.map((row) => row.delivered)), 0);
    const avgPredictability = round(mean(metricRows.map((row) => row.deliveredVsPlanned)), 1);
    const hasChartRows = chartRows.length > 0;
    const deliveredValues = chartRows.map((row) => row.delivered);
    const deliveryMean = round(mean(deliveredValues), 0);
    const deliveryStd = round(stdDev(deliveredValues), 0);
    const deliveryUpper = round(deliveryMean + deliveryStd, 0);
    const deliveryLower = Math.max(0, round(deliveryMean - deliveryStd, 0));
    const controlChartRows = chartRows.map((row) => ({
        ...row,
        deliveryMean,
        deliveryUpper,
        deliveryLower,
    }));

    if (!rows.length) {
        return (
            <div className="rounded-lg border border-dashed border-border bg-card py-16 text-center text-muted-foreground">
                Sem sprints para montar o historico.
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <div className="rounded-lg border border-border bg-card p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                        <h3 className="text-lg font-semibold text-foreground">Historico de performance por sprint</h3>
                        <p className="text-sm text-muted-foreground">
                            {projectName || 'Projeto'} - {rows.length} sprints
                        </p>
                    </div>
                    <div className="text-xs text-muted-foreground">
                        Sprints com dados de horas: {nonZeroRows.length}/{rows.length}
                    </div>
                </div>
                <div className="mt-2 text-xs text-muted-foreground">Ponto azul = sprint atual</div>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
                    <div className="text-xs uppercase tracking-wide text-blue-700 font-medium">Capacidade media</div>
                    <div className="mt-1 text-2xl font-bold text-blue-700">{formatHours(avgCapacity)}</div>
                </div>
                <div className="rounded-lg border border-violet-200 bg-violet-50 p-4">
                    <div className="text-xs uppercase tracking-wide text-violet-700 font-medium">Planejado medio</div>
                    <div className="mt-1 text-2xl font-bold text-violet-700">{formatHours(avgPlanned)}</div>
                </div>
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
                    <div className="text-xs uppercase tracking-wide text-emerald-700 font-medium">Entregue medio</div>
                    <div className="mt-1 text-2xl font-bold text-emerald-700">{formatHours(avgDelivered)}</div>
                </div>
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
                    <div className="text-xs uppercase tracking-wide text-amber-700 font-medium">Previsibilidade media</div>
                    <div className="mt-1 text-2xl font-bold text-amber-700">{avgPredictability}%</div>
                </div>
            </div>

            <div className="overflow-x-auto rounded-lg border border-border bg-card">
                <table className="w-full min-w-[940px] text-sm">
                    <thead className="bg-muted/40">
                        <tr className="text-left">
                            <th className="px-3 py-2 font-medium text-muted-foreground">Sprint</th>
                            <th className="px-3 py-2 font-medium text-muted-foreground">Inicio</th>
                            <th className="px-3 py-2 font-medium text-muted-foreground">Fim</th>
                            <th className="px-3 py-2 font-medium text-muted-foreground">Capacidade</th>
                            <th className="px-3 py-2 font-medium text-muted-foreground">Planejado</th>
                            <th className="px-3 py-2 font-medium text-muted-foreground">Entregue</th>
                            <th className="px-3 py-2 font-medium text-muted-foreground">Plan x Cap</th>
                            <th className="px-3 py-2 font-medium text-muted-foreground">Ent x Plan</th>
                            <th className="px-3 py-2 font-medium text-muted-foreground">Ent x Cap</th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((row) => (
                            <tr
                                key={row.sprintId}
                                className={`border-t border-border ${row.isCurrent ? 'bg-blue-100/80' : ''}`}
                            >
                                <td className={`px-3 py-2 font-medium ${row.isCurrent ? 'text-blue-700' : 'text-foreground'}`}>
                                    <span className="inline-flex items-center gap-2">
                                        <span>{row.sprintName}</span>
                                        {row.isCurrent && (
                                            <span
                                                className="h-2 w-2 rounded-full bg-blue-500"
                                                aria-label="Sprint atual"
                                                title="Sprint atual"
                                            />
                                        )}
                                    </span>
                                </td>
                                <td className="px-3 py-2 text-muted-foreground">{row.startDateLabel}</td>
                                <td className="px-3 py-2 text-muted-foreground">{row.endDateLabel}</td>
                                <td className="px-3 py-2">{formatHours(row.capacity)}</td>
                                <td className="px-3 py-2">{formatHours(row.planned)}</td>
                                <td className="px-3 py-2">{formatHours(row.delivered)}</td>
                                <td className="px-3 py-2">
                                    <span className={`rounded-md border px-2 py-1 text-xs font-medium ${getPlanVsCapacityClass(row.planVsCapacity)}`}>
                                        {row.planVsCapacity.toFixed(1)}%
                                    </span>
                                </td>
                                <td className="px-3 py-2">
                                    <span className={`rounded-md border px-2 py-1 text-xs font-medium ${getDeliveredVsPlannedClass(row.deliveredVsPlanned)}`}>
                                        {row.deliveredVsPlanned.toFixed(1)}%
                                    </span>
                                </td>
                                <td className="px-3 py-2">
                                    <span className={`rounded-md border px-2 py-1 text-xs font-medium ${getPlanVsCapacityClass(row.deliveredVsCapacity)}`}>
                                        {row.deliveredVsCapacity.toFixed(1)}%
                                    </span>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            <div className="rounded-lg border border-border bg-card p-4">
                <div className="mb-3 text-sm font-medium text-muted-foreground">
                    Capacidade x Planejado x Entregue e indicadores percentuais
                </div>
                {hasChartRows ? (
                    <div className="h-[360px] w-full">
                        <ResponsiveContainer width="100%" height="100%">
                            <ComposedChart data={chartRows} margin={{ top: 18, right: 16, left: 4, bottom: 8 }}>
                                <CartesianGrid strokeDasharray="3 6" vertical={false} />
                                <XAxis dataKey="sprintName" tick={{ fontSize: 11 }} />
                                <YAxis yAxisId="hours" tick={{ fontSize: 11 }} tickFormatter={(value) => formatHours(Number(value))} />
                                <YAxis yAxisId="pct" orientation="right" tick={{ fontSize: 11 }} tickFormatter={(value) => `${value}%`} />
                                <Tooltip content={<TooltipContent />} />
                                <Legend />

                                <Bar yAxisId="hours" dataKey="capacity" name="Capacidade" fill="#60A5FA" radius={[4, 4, 0, 0]}>
                                    <LabelList dataKey="capacity" position="top" formatter={(value: number) => formatHours(value)} fill="#2563EB" fontSize={11} />
                                </Bar>
                                <Bar yAxisId="hours" dataKey="planned" name="Planejado" fill="#A78BFA" radius={[4, 4, 0, 0]}>
                                    <LabelList dataKey="planned" position="top" formatter={(value: number) => formatHours(value)} fill="#6D28D9" fontSize={11} />
                                </Bar>
                                <Bar yAxisId="hours" dataKey="delivered" name="Entregue" fill="#34D399" radius={[4, 4, 0, 0]}>
                                    <LabelList dataKey="delivered" position="top" formatter={(value: number) => formatHours(value)} fill="#047857" fontSize={11} />
                                </Bar>
                                <Line yAxisId="pct" type="monotone" dataKey="planVsCapacity" name="Plan x Cap (%)" stroke="#2563EB" strokeWidth={2} dot={false} />
                                <Line yAxisId="pct" type="monotone" dataKey="deliveredVsPlanned" name="Ent x Plan (%)" stroke="#D97706" strokeWidth={2} dot={false} />
                            </ComposedChart>
                        </ResponsiveContainer>
                    </div>
                ) : (
                    <div className="rounded-md border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
                        Sem sprints passadas para montar este grafico.
                    </div>
                )}
            </div>

            <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
            <div className="rounded-lg border border-border bg-card p-4">
                <div className="mb-3 text-sm font-medium text-muted-foreground">
                    Planejamento x Capacidade com Faixas de Saude
                </div>
                {hasChartRows ? (
                    <div className="h-[260px] w-full">
                        <ResponsiveContainer width="100%" height="100%">
                            <ComposedChart data={chartRows} margin={{ top: 8, right: 16, left: 4, bottom: 8 }}>
                                <CartesianGrid strokeDasharray="3 6" vertical={false} />
                                <XAxis dataKey="sprintName" tick={{ fontSize: 11 }} />
                                <YAxis domain={[0, 130]} tick={{ fontSize: 11 }} tickFormatter={(value) => `${value}%`} />
                                <Tooltip formatter={(value: any) => [`${Number(value).toFixed(1)}%`, 'Plan x Cap']} />
                                <Legend />
                                <ReferenceArea y1={0} y2={60} fill="#FEE2E2" fillOpacity={0.35} />
                                <ReferenceArea y1={60} y2={85} fill="#FEF3C7" fillOpacity={0.4} />
                                <ReferenceArea y1={85} y2={130} fill="#DCFCE7" fillOpacity={0.35} />
                                <ReferenceLine y={60} stroke="#D97706" strokeDasharray="4 4" />
                                <ReferenceLine y={85} stroke="#16A34A" strokeDasharray="4 4" />
                                <Area
                                    type="monotone"
                                    dataKey="planVsCapacity"
                                    legendType="none"
                                    stroke="#2563EB"
                                    fill="#93C5FD"
                                    fillOpacity={0.25}
                                />
                                <Line
                                    type="monotone"
                                    dataKey="planVsCapacity"
                                    name="Plan x Cap (%)"
                                    stroke="#1D4ED8"
                                    strokeWidth={2}
                                />
                            </ComposedChart>
                        </ResponsiveContainer>
                    </div>
                ) : (
                    <div className="rounded-md border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
                        Sem sprints passadas para montar este grafico.
                    </div>
                )}
            </div>

            <div className="rounded-lg border border-border bg-card p-4">
                <div className="mb-3 text-sm font-medium text-muted-foreground">
                    Tendencia de Previsibilidade (Entregue x Planejado %)
                </div>
                {hasChartRows ? (
                    <div className="h-[260px] w-full">
                        <ResponsiveContainer width="100%" height="100%">
                            <ComposedChart data={chartRows} margin={{ top: 8, right: 16, left: 4, bottom: 8 }}>
                                <CartesianGrid strokeDasharray="3 6" vertical={false} />
                                <XAxis dataKey="sprintName" tick={{ fontSize: 11 }} />
                                <YAxis
                                    domain={[0, 120]}
                                    tick={{ fontSize: 11 }}
                                    tickFormatter={(value) => `${value}%`}
                                />
                                <Tooltip formatter={(value: any) => [`${Number(value).toFixed(1)}%`, 'Ent x Plan']} />
                                <Legend />
                                <ReferenceLine y={90} stroke="#16A34A" strokeDasharray="4 4" />
                                <ReferenceLine y={70} stroke="#D97706" strokeDasharray="4 4" />
                                <Line
                                    type="monotone"
                                    dataKey="deliveredVsPlanned"
                                    name="Ent x Plan (%)"
                                    stroke="#0EA5E9"
                                    strokeWidth={3}
                                />
                            </ComposedChart>
                        </ResponsiveContainer>
                    </div>
                ) : (
                    <div className="rounded-md border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
                        Sem sprints passadas para montar este grafico.
                    </div>
                )}
            </div>

            <div className="rounded-lg border border-border bg-card p-4">
                <div className="mb-3 text-sm font-medium text-muted-foreground">
                    Escopo Adicionado x Removido (h) e Saldo
                </div>
                {hasChartRows ? (
                    <div className="h-[260px] w-full">
                        <ResponsiveContainer width="100%" height="100%">
                            <ComposedChart data={chartRows} margin={{ top: 18, right: 16, left: 4, bottom: 8 }}>
                                <CartesianGrid strokeDasharray="3 6" vertical={false} />
                                <XAxis dataKey="sprintName" tick={{ fontSize: 11 }} />
                                <YAxis tick={{ fontSize: 11 }} tickFormatter={(value) => formatHours(Number(value))} />
                                <Tooltip
                                    formatter={(value: any, name: string) => {
                                        if (name === 'Escopo Removido') return [formatHours(Math.abs(Number(value))), name];
                                        if (name === 'Saldo') return [formatHours(Number(value)), name];
                                        return [formatHours(Number(value)), name];
                                    }}
                                />
                                <Legend />
                                <ReferenceLine y={0} stroke="#64748B" />
                                <Bar dataKey="scopeAdded" name="Escopo Adicionado" fill="#34D399" radius={[4, 4, 0, 0]}>
                                    <LabelList dataKey="scopeAdded" position="top" formatter={(value: number) => formatHours(value)} fill="#047857" fontSize={11} />
                                </Bar>
                                <Bar dataKey="scopeRemovedVisual" name="Escopo Removido" fill="#F87171" radius={[4, 4, 0, 0]}>
                                    <LabelList dataKey="scopeRemovedVisual" position="top" formatter={(value: number) => formatHours(Math.abs(value))} fill="#B91C1C" fontSize={11} />
                                </Bar>
                                <Line
                                    type="monotone"
                                    dataKey="scopeNet"
                                    name="Saldo"
                                    stroke="#1D4ED8"
                                    strokeWidth={2}
                                />
                            </ComposedChart>
                        </ResponsiveContainer>
                    </div>
                ) : (
                    <div className="rounded-md border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
                        Sem sprints passadas para montar este grafico.
                    </div>
                )}
            </div>

            <div className="rounded-lg border border-border bg-card p-4">
                <div className="mb-3 text-sm font-medium text-muted-foreground">
                    Eficiencia da Sprint (Plan x Cap vs Ent x Plan)
                </div>
                {hasChartRows ? (
                    <div className="h-[260px] w-full">
                        <ResponsiveContainer width="100%" height="100%">
                            <ScatterChart margin={{ top: 8, right: 16, left: 4, bottom: 8 }}>
                                <CartesianGrid strokeDasharray="3 6" />
                                <XAxis
                                    type="number"
                                    dataKey="planVsCapacity"
                                    name="Plan x Cap"
                                    domain={[0, 130]}
                                    tick={{ fontSize: 11 }}
                                    tickFormatter={(value) => `${value}%`}
                                />
                                <YAxis
                                    type="number"
                                    dataKey="deliveredVsPlanned"
                                    name="Ent x Plan"
                                    domain={[0, 120]}
                                    tick={{ fontSize: 11 }}
                                    tickFormatter={(value) => `${value}%`}
                                />
                                <ZAxis type="number" dataKey="planned" range={[80, 420]} name="Planejado" />
                                <Tooltip content={<EfficiencyTooltip />} />
                                <Legend />
                                <ReferenceLine x={60} stroke="#D97706" strokeDasharray="4 4" />
                                <ReferenceLine x={85} stroke="#16A34A" strokeDasharray="4 4" />
                                <ReferenceLine y={70} stroke="#D97706" strokeDasharray="4 4" />
                                <ReferenceLine y={90} stroke="#16A34A" strokeDasharray="4 4" />
                                <Scatter name="Sprints" data={chartRows}>
                                    {chartRows.map((row) => {
                                        const healthy = row.planVsCapacity >= 85 && row.deliveredVsPlanned >= 90;
                                        const attention = row.planVsCapacity >= 60 && row.deliveredVsPlanned >= 70;
                                        const fill = healthy ? '#16A34A' : attention ? '#D97706' : '#DC2626';
                                        return <Cell key={`efficiency-${row.sprintId}`} fill={fill} />;
                                    })}
                                </Scatter>
                            </ScatterChart>
                        </ResponsiveContainer>
                    </div>
                ) : (
                    <div className="rounded-md border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
                        Sem sprints passadas para montar este grafico.
                    </div>
                )}
            </div>

            <div className="rounded-lg border border-border bg-card p-4">
                <div className="mb-3 text-sm font-medium text-muted-foreground">
                    Desvio Final por Sprint (Planejado - Entregue)
                </div>
                {hasChartRows ? (
                    <div className="h-[260px] w-full">
                        <ResponsiveContainer width="100%" height="100%">
                            <ComposedChart data={chartRows} margin={{ top: 18, right: 16, left: 4, bottom: 8 }}>
                                <CartesianGrid strokeDasharray="3 6" vertical={false} />
                                <XAxis dataKey="sprintName" tick={{ fontSize: 11 }} />
                                <YAxis tick={{ fontSize: 11 }} tickFormatter={(value) => formatHours(Number(value))} />
                                <Tooltip formatter={(value: any) => [formatHours(Number(value)), 'Desvio Final']} />
                                <Legend />
                                <ReferenceLine y={0} stroke="#64748B" />
                                <Bar dataKey="finalDeviation" name="Desvio Final (h)" radius={[4, 4, 0, 0]}>
                                    {chartRows.map((row) => (
                                        <Cell
                                            key={`deviation-${row.sprintId}`}
                                            fill={row.finalDeviation > 0 ? '#EF4444' : row.finalDeviation < 0 ? '#16A34A' : '#94A3B8'}
                                        />
                                    ))}
                                    <LabelList
                                        dataKey="finalDeviation"
                                        position="top"
                                        formatter={(value: number) => formatHours(value)}
                                        fill="#334155"
                                        fontSize={11}
                                    />
                                </Bar>
                            </ComposedChart>
                        </ResponsiveContainer>
                    </div>
                ) : (
                    <div className="rounded-md border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
                        Sem sprints passadas para montar este grafico.
                    </div>
                )}
            </div>

            <div className="rounded-lg border border-border bg-card p-4">
                <div className="mb-3 text-sm font-medium text-muted-foreground">
                    Volatilidade de Entrega (Control Chart)
                </div>
                {hasChartRows ? (
                    <div className="h-[260px] w-full">
                        <ResponsiveContainer width="100%" height="100%">
                            <ComposedChart data={controlChartRows} margin={{ top: 18, right: 16, left: 4, bottom: 8 }}>
                                <CartesianGrid strokeDasharray="3 6" vertical={false} />
                                <XAxis dataKey="sprintName" tick={{ fontSize: 11 }} />
                                <YAxis tick={{ fontSize: 11 }} tickFormatter={(value) => formatHours(Number(value))} />
                                <Tooltip
                                    formatter={(value: any, name: string) => {
                                        if (name === 'Media') return [formatHours(Number(value)), 'Media'];
                                        if (name === 'Limite Superior') return [formatHours(Number(value)), 'Limite Superior (+1σ)'];
                                        if (name === 'Limite Inferior') return [formatHours(Number(value)), 'Limite Inferior (-1σ)'];
                                        return [formatHours(Number(value)), 'Entregue'];
                                    }}
                                />
                                <Legend />
                                <Line
                                    type="monotone"
                                    dataKey="delivered"
                                    name="Entregue"
                                    stroke="#0EA5E9"
                                    strokeWidth={3}
                                >
                                    <LabelList
                                        dataKey="delivered"
                                        position="top"
                                        formatter={(value: number) => formatHours(value)}
                                        fill="#0369A1"
                                        fontSize={11}
                                    />
                                </Line>
                                <Line
                                    type="monotone"
                                    dataKey="deliveryMean"
                                    name="Media"
                                    stroke="#334155"
                                    strokeDasharray="5 5"
                                    dot={false}
                                />
                                <Line
                                    type="monotone"
                                    dataKey="deliveryUpper"
                                    name="Limite Superior"
                                    stroke="#DC2626"
                                    strokeDasharray="4 4"
                                    dot={false}
                                />
                                <Line
                                    type="monotone"
                                    dataKey="deliveryLower"
                                    name="Limite Inferior"
                                    stroke="#D97706"
                                    strokeDasharray="4 4"
                                    dot={false}
                                />
                            </ComposedChart>
                        </ResponsiveContainer>
                    </div>
                ) : (
                    <div className="rounded-md border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
                        Sem sprints passadas para montar este grafico.
                    </div>
                )}
            </div>
            </div>
        </div>
    );
}
