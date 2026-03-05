type AzureWorkItemUrlParams = {
    id: number;
    rawUrl?: string | null;
    orgUrl?: string | null;
    projectName?: string | null;
};

function normalizeBase(value?: string | null): string | null {
    const trimmed = String(value || '').trim();
    if (!trimmed) return null;
    return trimmed.replace(/\/+$/, '');
}

function fromRawUrl(rawUrl: string, id: number): string | null {
    const trimmed = rawUrl.trim();
    if (!trimmed) return null;

    if (trimmed.includes('/_workitems/edit/')) return trimmed;

    try {
        const parsed = new URL(trimmed);
        const match = parsed.pathname.match(/^(.*)\/_apis\/wit\/workitems\/(\d+)/i);
        if (!match) return null;

        const basePath = (match[1] || '').replace(/\/+$/, '');
        const workItemId = match[2] || String(id);
        return `${parsed.origin}${basePath}/_workitems/edit/${workItemId}`;
    } catch {
        return null;
    }
}

export function buildAzureWorkItemUrl(params: AzureWorkItemUrlParams): string | null {
    const fromRaw = params.rawUrl ? fromRawUrl(params.rawUrl, params.id) : null;
    if (fromRaw) return fromRaw;

    const base = normalizeBase(params.orgUrl ?? process.env.AZURE_DEVOPS_ORG_URL ?? null);
    if (!base) return null;

    const projectName = String(params.projectName || '').trim();
    if (projectName) {
        return `${base}/${encodeURIComponent(projectName)}/_workitems/edit/${params.id}`;
    }

    return `${base}/_workitems/edit/${params.id}`;
}
