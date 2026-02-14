import { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { CapacityComparison, WorkItem } from '@/types';

interface WorkItemAgingCardProps {
    workItems: WorkItem[];
    capacityData?: CapacityComparison;
    sprintStartDate?: string;
    sprintEndDate?: string;
    dayOffDates?: string[];
    projectName?: string;
}

type AgingStatus = 'ok' | 'warning' | 'critical';
type ModalFilter = 'all' | 'critical' | 'warning' | 'ok';

type AgingRow = {
    id: number;
    title: string;
    assignee: string;
    actualDays: number;
    expectedDays: number;
    actualHours: number;
    expectedHours: number;
    effortHours: number;
    capacityPerDay: number;
    inProgressAt: string;
    dueAt: string;
    azureUrl: string | null;
    ratio: number;
    status: AgingStatus;
};

const IN_PROGRESS_STATES = new Set(['in progress', 'active']);
const ALLOWED_TYPES = ['Task'];
const WORK_HOURS_PER_DAY = 8;
const WORK_START_HOUR = 8;
const WORK_END_HOUR = 17;
const LUNCH_START_HOUR = 12;
const LUNCH_END_HOUR = 13;

function toUtcDayMs(value: string | Date): number {
    const d = new Date(value);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

function toIsoDate(ms: number): string {
    return new Date(ms).toISOString().slice(0, 10);
}

function isInProgressState(state?: string): boolean {
    const s = String(state || '').trim().toLowerCase();
    return IN_PROGRESS_STATES.has(s) || s.includes('progress');
}

function businessDaysBetween(start: Date, end: Date, dayOffSet: Set<string>): number {
    const startMs = toUtcDayMs(start);
    const endMs = toUtcDayMs(end);
    if (endMs < startMs) return 0;

    let count = 0;
    for (let ms = startMs; ms <= endMs; ms += 24 * 60 * 60 * 1000) {
        const d = new Date(ms);
        const wd = d.getUTCDay();
        if (wd === 0 || wd === 6) continue;
        if (dayOffSet.has(toIsoDate(ms))) continue;
        count++;
    }
    return count;
}

function overlapHours(startA: Date, endA: Date, startB: Date, endB: Date): number {
    const start = Math.max(startA.getTime(), startB.getTime());
    const end = Math.min(endA.getTime(), endB.getTime());
    if (end <= start) return 0;
    return (end - start) / (1000 * 60 * 60);
}

function businessHoursBetween(start: Date, end: Date, dayOffSet: Set<string>): number {
    if (end <= start) return 0;

    let totalHours = 0;
    const day = new Date(start);
    day.setHours(0, 0, 0, 0);

    const endDay = new Date(end);
    endDay.setHours(0, 0, 0, 0);

    while (day <= endDay) {
        const iso = new Date(Date.UTC(day.getFullYear(), day.getMonth(), day.getDate())).toISOString().slice(0, 10);
        const weekday = day.getDay();
        const isWeekend = weekday === 0 || weekday === 6;
        if (!isWeekend && !dayOffSet.has(iso)) {
            const workStart = new Date(day);
            workStart.setHours(WORK_START_HOUR, 0, 0, 0);
            const workEnd = new Date(day);
            workEnd.setHours(WORK_END_HOUR, 0, 0, 0);

            const lunchStart = new Date(day);
            lunchStart.setHours(LUNCH_START_HOUR, 0, 0, 0);
            const lunchEnd = new Date(day);
            lunchEnd.setHours(LUNCH_END_HOUR, 0, 0, 0);

            const dayWorkHours = overlapHours(start, end, workStart, workEnd);
            const lunchHours = overlapHours(start, end, lunchStart, lunchEnd);
            totalHours += Math.max(0, dayWorkHours - lunchHours);
        }

        day.setDate(day.getDate() + 1);
    }

    return totalHours;
}

function isBusinessDayLocal(date: Date, dayOffSet: Set<string>): boolean {
    const weekday = date.getDay();
    if (weekday === 0 || weekday === 6) return false;
    const iso = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())).toISOString().slice(0, 10);
    return !dayOffSet.has(iso);
}

function addBusinessHours(start: Date, hoursToAdd: number, dayOffSet: Set<string>): Date {
    if (hoursToAdd <= 0) return new Date(start);

    let remaining = hoursToAdd;
    let cursor = new Date(start);

    while (remaining > 0) {
        const dayStart = new Date(cursor);
        dayStart.setHours(WORK_START_HOUR, 0, 0, 0);
        const lunchStart = new Date(cursor);
        lunchStart.setHours(LUNCH_START_HOUR, 0, 0, 0);
        const lunchEnd = new Date(cursor);
        lunchEnd.setHours(LUNCH_END_HOUR, 0, 0, 0);
        const dayEnd = new Date(cursor);
        dayEnd.setHours(WORK_END_HOUR, 0, 0, 0);

        if (!isBusinessDayLocal(cursor, dayOffSet)) {
            cursor.setDate(cursor.getDate() + 1);
            cursor.setHours(WORK_START_HOUR, 0, 0, 0);
            continue;
        }

        if (cursor < dayStart) cursor = new Date(dayStart);
        if (cursor >= dayEnd) {
            cursor.setDate(cursor.getDate() + 1);
            cursor.setHours(WORK_START_HOUR, 0, 0, 0);
            continue;
        }
        if (cursor >= lunchStart && cursor < lunchEnd) cursor = new Date(lunchEnd);

        const blockEnd = cursor < lunchStart ? lunchStart : dayEnd;
        const available = Math.max(0, (blockEnd.getTime() - cursor.getTime()) / (1000 * 60 * 60));
        if (available <= 0) {
            cursor = new Date(blockEnd);
            continue;
        }

        const consume = Math.min(available, remaining);
        cursor = new Date(cursor.getTime() + consume * 60 * 60 * 1000);
        remaining -= consume;
    }

    return cursor;
}

function getSprintBusinessDays(startDate?: string, endDate?: string, dayOffDates: string[] = []): number {
    if (!startDate || !endDate) return 10;
    return Math.max(1, businessDaysBetween(new Date(startDate), new Date(endDate), new Set(dayOffDates)));
}

function getPlannedEffortHours(item: WorkItem): number {
    const initial = item.initialRemainingWork ?? 0;
    const original = item.originalEstimate ?? 0;
    const currentTotal = (item.completedWork ?? 0) + (item.remainingWork ?? 0);
    const lastRemaining = item.lastRemainingWork ?? 0;
    const baseline = Math.max(initial, original);
    const dynamic = Math.max(currentTotal, lastRemaining, 0);
    const effort = Math.max(baseline, dynamic);

    if (effort > 0) return effort;

    return 1;
}

function toAzureEditUrl(rawUrl: string | undefined, id: number, fallbackOrgUrl?: string, projectName?: string): string | null {
    if (rawUrl) {
        if (rawUrl.includes('/_workitems/edit/')) return rawUrl;

        const apiMatch = rawUrl.match(/^(https:\/\/dev\.azure\.com\/[^/]+\/[^/]+)\/_apis\/wit\/workItems\/(\d+)/i);
        if (apiMatch) {
            const base = apiMatch[1].replace(/\/+$/, '');
            const workItemId = apiMatch[2] || String(id);
            return `${base}/_workitems/edit/${workItemId}`;
        }
    }

    if (fallbackOrgUrl) {
        const base = fallbackOrgUrl.replace(/\/+$/, '');
        if (projectName) return `${base}/${encodeURIComponent(projectName)}/_workitems/edit/${id}`;
        return `${base}/_workitems/edit/${id}`;
    }

    return null;
}

export function WorkItemAgingCard({
    workItems,
    capacityData,
    sprintStartDate,
    sprintEndDate,
    dayOffDates = [],
    projectName,
}: WorkItemAgingCardProps) {
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [modalFilter, setModalFilter] = useState<ModalFilter>('all');
    const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());

    const dayOffSet = useMemo(() => new Set(dayOffDates), [dayOffDates]);
    const sprintBusinessDays = getSprintBusinessDays(sprintStartDate, sprintEndDate, dayOffDates);
    const today = new Date();

    const memberDailyMap = new Map<string, number>();
    if (capacityData?.byMember) {
        for (const m of capacityData.byMember) {
            const memberId = m.member.id;
            let daily = 0;
            if (typeof m.capacity === 'number') {
                daily = m.capacity / sprintBusinessDays;
            } else {
                const daysOffCount = m.capacity.daysOffCount || 0;
                const memberDays = Math.max(1, sprintBusinessDays - daysOffCount);
                daily = m.capacity.available / memberDays;
            }
            memberDailyMap.set(memberId, Number.isFinite(daily) && daily > 0 ? daily : 0);
        }
    }

    const teamDailyValues = Array.from(memberDailyMap.values()).filter((v) => v > 0);
    const teamDailyAvg = teamDailyValues.length > 0
        ? teamDailyValues.reduce((a, b) => a + b, 0) / teamDailyValues.length
        : 5;

    const azureOrgUrl = (import.meta as any)?.env?.VITE_AZURE_DEVOPS_ORG_URL as string | undefined;
    const getAzureWorkItemUrl = (id: number): string | null => {
        if (!azureOrgUrl) return null;
        const base = azureOrgUrl.replace(/\/+$/, '');
        if (projectName) return `${base}/${encodeURIComponent(projectName)}/_workitems/edit/${id}`;
        return `${base}/_workitems/edit/${id}`;
    };

    const rows: AgingRow[] = workItems
        .filter((wi) => ALLOWED_TYPES.includes(wi.type))
        .filter((wi) => isInProgressState(wi.state))
        .map((wi) => {
            const activated = wi.activatedDate
                ? new Date(wi.activatedDate)
                : wi.changedDate
                    ? new Date(wi.changedDate)
                    : wi.createdDate
                        ? new Date(wi.createdDate)
                    : new Date();

            const actualHours = Math.max(0.1, businessHoursBetween(activated, today, dayOffSet));
            const actualDays = Math.max(1, Math.ceil(actualHours / WORK_HOURS_PER_DAY));
            const effortHours = Math.max(1, Math.round(getPlannedEffortHours(wi)));

            const dailyCapacity =
                (wi.assignedToId ? memberDailyMap.get(wi.assignedToId) : undefined) || teamDailyAvg;

            const dailyCapacitySafe = Math.max(0.1, dailyCapacity);
            const capacityPerWorkHour = dailyCapacitySafe / WORK_HOURS_PER_DAY;
            const expectedHours = Math.max(1, effortHours / Math.max(0.01, capacityPerWorkHour));
            const expectedDays = Math.max(1, Math.ceil(expectedHours / WORK_HOURS_PER_DAY));
            const ratio = actualHours / expectedHours;
            const dueAt = addBusinessHours(activated, expectedHours, dayOffSet);

            let status: AgingStatus = 'ok';
            if (ratio > 1.2) status = 'critical';
            else if (ratio > 1) status = 'warning';

            return {
                id: wi.id,
                title: wi.title,
                assignee: wi.assignedTo?.displayName || 'Nao Alocados',
                actualDays,
                expectedDays,
                actualHours: Number(actualHours.toFixed(1)),
                expectedHours: Number(expectedHours.toFixed(1)),
                effortHours,
                capacityPerDay: Number(dailyCapacity.toFixed(1)),
                inProgressAt: activated.toISOString(),
                dueAt: dueAt.toISOString(),
                azureUrl: toAzureEditUrl(wi.url, wi.id, azureOrgUrl, projectName) || getAzureWorkItemUrl(wi.id),
                ratio,
                status,
            };
        })
        .sort((a, b) => b.ratio - a.ratio);

    const alertRows = rows.filter((r) => r.status !== 'ok');
    const okRows = rows.filter((r) => r.status === 'ok');
    const criticalRows = alertRows.filter((r) => r.status === 'critical');
    const warningRows = alertRows.filter((r) => r.status === 'warning');

    const modalRows =
        modalFilter === 'critical'
            ? criticalRows
            : modalFilter === 'warning'
                ? warningRows
                : modalFilter === 'ok'
                    ? okRows
                    : rows;

    const openModal = (filter: ModalFilter) => {
        setModalFilter(filter);
        setExpandedKeys(new Set());
        setIsModalOpen(true);
    };

    const toggleExpanded = (key: string) => {
        setExpandedKeys((prev) => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
        });
    };

    return (
        <>
            <Card>
                <CardHeader>
                    <div className="flex items-center justify-between">
                        <CardTitle className="text-lg">Work Item Aging</CardTitle>
                    </div>
                </CardHeader>
                <CardContent>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        <div className="rounded-lg border border-red-200 bg-red-50 p-4">
                            <div className="text-xs uppercase tracking-wide text-red-700 font-medium">Critico</div>
                            <div className="text-3xl font-bold text-red-700 mt-1">{criticalRows.length}</div>
                            <Button
                                variant="outline"
                                className="mt-3 border-red-300 text-red-700 hover:bg-red-100"
                                onClick={() => openModal('critical')}
                                disabled={criticalRows.length === 0}
                            >
                                Ver criticos
                            </Button>
                        </div>

                        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
                            <div className="text-xs uppercase tracking-wide text-amber-700 font-medium">Atencao</div>
                            <div className="text-3xl font-bold text-amber-700 mt-1">{warningRows.length}</div>
                            <Button
                                variant="outline"
                                className="mt-3 border-amber-300 text-amber-700 hover:bg-amber-100"
                                onClick={() => openModal('warning')}
                                disabled={warningRows.length === 0}
                            >
                                Ver atencao
                            </Button>
                        </div>

                        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
                            <div className="text-xs uppercase tracking-wide text-emerald-700 font-medium">No prazo</div>
                            <div className="text-3xl font-bold text-emerald-700 mt-1">{okRows.length}</div>
                            <Button
                                variant="outline"
                                className="mt-3 border-emerald-300 text-emerald-700 hover:bg-emerald-100"
                                onClick={() => openModal('ok')}
                                disabled={okRows.length === 0}
                            >
                                Ver no prazo
                            </Button>
                        </div>
                    </div>
                </CardContent>
            </Card>

            {isModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
                    <div className="w-full max-w-4xl rounded-lg border border-border bg-background shadow-xl">
                        <div className="flex items-center justify-between border-b border-border p-4">
                            <div>
                                <h3 className="text-lg font-semibold">Detalhamento de Aging</h3>
                                <p className="text-sm text-muted-foreground">
                                    {modalRows.length} itens
                                </p>
                            </div>
                            <div className="flex items-center gap-2">
                                <Button variant={modalFilter === 'all' ? 'default' : 'outline'} onClick={() => setModalFilter('all')}>
                                    Todos
                                </Button>
                                <Button variant={modalFilter === 'critical' ? 'default' : 'outline'} onClick={() => setModalFilter('critical')}>
                                    Criticos
                                </Button>
                                <Button variant={modalFilter === 'warning' ? 'default' : 'outline'} onClick={() => setModalFilter('warning')}>
                                    Atencao
                                </Button>
                                <Button variant={modalFilter === 'ok' ? 'default' : 'outline'} onClick={() => setModalFilter('ok')}>
                                    No prazo
                                </Button>
                                <Button variant="outline" onClick={() => setIsModalOpen(false)}>Fechar</Button>
                            </div>
                        </div>

                        <div className="max-h-[65vh] overflow-auto p-4 space-y-3">
                            {modalRows.length === 0 ? (
                                <div className="text-center py-10 text-muted-foreground">
                                    Nenhum item para este filtro.
                                </div>
                            ) : (
                                modalRows.map((row, index) => {
                                    const badgeClass =
                                        row.status === 'critical'
                                            ? 'bg-red-50 text-red-700 border-red-200'
                                            : row.status === 'warning'
                                                ? 'bg-amber-50 text-amber-700 border-amber-200'
                                                : 'bg-emerald-50 text-emerald-700 border-emerald-200';

                                    const delayDays = Math.max(0, row.actualDays - row.expectedDays);
                                    const delayHours = Math.max(0, row.actualHours - row.expectedHours);
                                    const dueDate = new Date(row.dueAt);
                                    const overdueHours = Math.max(0, businessHoursBetween(dueDate, today, dayOffSet));
                                    const remainingToDueHours = Math.max(0, businessHoursBetween(today, dueDate, dayOffSet));
                                    const rowKey = `${row.id}-${row.status}-${index}`;
                                    const isExpanded = expandedKeys.has(rowKey);
                                    const azureUrl = row.azureUrl;

                                    return (
                                        <div key={rowKey} className="rounded-lg border border-border bg-card p-3">
                                            <div className="flex items-start justify-between gap-3">
                                                <div className="min-w-0 flex-1">
                                                    <div className="font-medium text-sm text-foreground truncate">
                                                        #{row.id} - {row.title}
                                                    </div>
                                                    <div className="text-xs text-muted-foreground mt-1">
                                                        {row.assignee}
                                                    </div>
                                                </div>
                                                <Badge variant="outline" className={badgeClass}>
                                                    {row.actualDays}/{row.expectedDays} dias
                                                </Badge>
                                            </div>
                                            <div className="mt-3">
                                                <Button variant="outline" size="sm" onClick={() => toggleExpanded(rowKey)}>
                                                    {isExpanded ? 'Ocultar detalhes' : 'Ver detalhes'}
                                                </Button>
                                            </div>
                                            {isExpanded && (
                                                <div className="mt-3 rounded-md border border-border bg-muted/30 p-3 text-xs text-muted-foreground space-y-2">
                                                    <div><span className="font-medium text-foreground">Horas previstas:</span> {row.effortHours}h</div>
                                                    <div><span className="font-medium text-foreground">Capacidade:</span> {row.capacityPerDay}h/dia</div>
                                                    <div><span className="font-medium text-foreground">Inicio em progresso:</span> {new Date(row.inProgressAt).toLocaleString('pt-BR')}</div>
                                                    <div><span className="font-medium text-foreground">Previsao de conclusao:</span> {dueDate.toLocaleString('pt-BR')}</div>
                                                    <div><span className="font-medium text-foreground">Dias em atraso:</span> {delayDays}</div>
                                                    <div><span className="font-medium text-foreground">Horas uteis em atraso:</span> {delayHours.toFixed(1)}h</div>
                                                    <div>
                                                        <span className="font-medium text-foreground">Status do prazo:</span>{' '}
                                                        {overdueHours > 0
                                                            ? `vencido ha ${overdueHours.toFixed(1)}h uteis`
                                                            : `faltam ${remainingToDueHours.toFixed(1)}h uteis`}
                                                    </div>
                                                    <div><span className="font-medium text-foreground">Responsavel:</span> {row.assignee}</div>
                                                    {azureUrl && (
                                                        <div>
                                                            <a
                                                                href={azureUrl}
                                                                target="_blank"
                                                                rel="noreferrer"
                                                                className="text-blue-600 hover:underline font-medium"
                                                            >
                                                                Abrir no Azure DevOps
                                                            </a>
                                                        </div>
                                                    )}
                                                    {!azureUrl && (
                                                        <div className="text-xs text-muted-foreground">
                                                            Link Azure indisponivel (configure `VITE_AZURE_DEVOPS_ORG_URL`).
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })
                            )}
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
