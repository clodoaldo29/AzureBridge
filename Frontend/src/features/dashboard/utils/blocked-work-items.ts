import type { WorkItem } from '@/types';

export function isBlockedWorkItem(item: WorkItem): boolean {
    if (item.isBlocked) return true;

    const state = String(item.state || '').trim().toLowerCase();
    if (state === 'blocked' || state === 'impedido' || state === 'impeded') return true;

    return (item.tags || []).some((tag) => {
        const normalized = String(tag || '').trim().toLowerCase();
        return normalized.includes('block') || normalized.includes('imped');
    });
}
