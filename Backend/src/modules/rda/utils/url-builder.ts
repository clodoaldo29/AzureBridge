export type ExternalUrlType =
    | 'azure_devops_sprint'
    | 'azure_devops_wiki'
    | 'azure_devops_workitem'
    | 'azure_devops_deliveryplan'
    | 'figma'
    | 'sharepoint'
    | 'planner'
    | 'network_path'
    | 'other';

export interface ClassifiedUrl {
    url: string;
    type: ExternalUrlType;
}

export interface BuildUrlOptions {
    organization: string;
    project: string;
    teamName?: string;
}

function trimSlash(value: string): string {
    return value.replace(/\/+$/, '');
}

function encodePathSegment(value: string): string {
    return encodeURIComponent(value);
}

export class AzureDevOpsUrlBuilder {
    private readonly organization: string;
    private readonly project: string;
    private readonly teamName?: string;

    constructor(options: BuildUrlOptions) {
        this.organization = trimSlash(options.organization);
        this.project = options.project;
        this.teamName = options.teamName;
    }

    sprintTaskboard(sprintName: string): string {
        const team = this.teamName ?? this.project;
        return `${this.organization}/${encodePathSegment(this.project)}/${encodePathSegment(team)}/_sprints/taskboard/${encodePathSegment(sprintName)}`;
    }

    workItem(workItemId: number | string): string {
        return `${this.organization}/${encodePathSegment(this.project)}/_workitems/edit/${workItemId}`;
    }

    wikiPage(wikiIdentifier: string, pagePath: string): string {
        const sanitizedPath = pagePath.startsWith('/') ? pagePath : `/${pagePath}`;
        return `${this.organization}/${encodePathSegment(this.project)}/_wiki/wikis/${encodePathSegment(wikiIdentifier)}/page${sanitizedPath}`;
    }

    deliveryPlans(planId?: string): string {
        if (!planId) {
            return `${this.organization}/${encodePathSegment(this.project)}/_deliveryplans`;
        }

        return `${this.organization}/${encodePathSegment(this.project)}/_deliveryplans?planId=${encodeURIComponent(planId)}`;
    }
}

export function classifyExternalUrl(url: string): ExternalUrlType {
    const input = url.trim().toLowerCase();

    if (!input) {
        return 'other';
    }

    if (/^\\\\[^\\]+\\[^\\]+/.test(url) || /^[a-z]:\\/i.test(url)) {
        return 'network_path';
    }

    if (/dev\.azure\.com|visualstudio\.com/.test(input)) {
        if (/_workitems\/edit\//.test(input)) return 'azure_devops_workitem';
        if (/_wiki\//.test(input)) return 'azure_devops_wiki';
        if (/_sprints\//.test(input)) return 'azure_devops_sprint';
        if (/_deliveryplans/.test(input)) return 'azure_devops_deliveryplan';
    }

    if (/figma\.com/.test(input)) return 'figma';
    if (/sharepoint\.com|sharepoint\.cn/.test(input)) return 'sharepoint';
    if (/planner\.cloud\.microsoft|tasks\.office\.com|tasks\.microsoft\.com/.test(input)) return 'planner';

    return 'other';
}

export function extractAndClassifyUrls(text: string): ClassifiedUrl[] {
    if (!text) {
        return [];
    }

    const matches = text.match(/https?:\/\/[^\s)>"']+/gi) ?? [];
    const seen = new Set<string>();

    return matches
        .map((raw) => raw.trim())
        .filter((raw) => {
            if (seen.has(raw)) {
                return false;
            }
            seen.add(raw);
            return true;
        })
        .map((cleanUrl) => ({
            url: cleanUrl,
            type: classifyExternalUrl(cleanUrl),
        }));
}
