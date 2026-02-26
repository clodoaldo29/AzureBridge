type AzureEditUrlOptions = {
    fallbackOrgUrl?: string;
    projectName?: string;
};

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

export function toAzureEditUrl(
    rawUrl: string | null | undefined,
    id: number,
    options?: AzureEditUrlOptions
): string | null {
    if (rawUrl) {
        const fromRaw = fromRawUrl(rawUrl, id);
        if (fromRaw) return fromRaw;
    }

    const fallbackOrgUrl = String(options?.fallbackOrgUrl || '').trim().replace(/\/+$/, '');
    if (!fallbackOrgUrl) return null;

    const projectName = String(options?.projectName || '').trim();
    if (projectName) {
        return `${fallbackOrgUrl}/${encodeURIComponent(projectName)}/_workitems/edit/${id}`;
    }

    return `${fallbackOrgUrl}/_workitems/edit/${id}`;
}
