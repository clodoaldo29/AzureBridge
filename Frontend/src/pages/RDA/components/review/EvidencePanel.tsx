import { Calendar, ExternalLink, FileText, Globe, List } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { Evidence, ValidationIssue } from '@/pages/RDA/hooks/useReview';

interface EvidencePanelProps {
    evidence: Evidence[];
    issues: ValidationIssue[];
}

function sourceIcon(type: Evidence['sourceType']) {
    if (type === 'Document') return <FileText className="h-4 w-4 text-sky-600" />;
    if (type === 'WikiPage') return <Globe className="h-4 w-4 text-emerald-600" />;
    if (type === 'WorkItem') return <List className="h-4 w-4 text-violet-600" />;
    return <Calendar className="h-4 w-4 text-amber-600" />;
}

function issueVariant(severity: ValidationIssue['severity']): 'destructive' | 'secondary' | 'outline' {
    if (severity === 'error') return 'destructive';
    if (severity === 'warning') return 'secondary';
    return 'outline';
}

export function EvidencePanel({ evidence, issues }: EvidencePanelProps) {
    return (
        <div className="mt-3 space-y-3 rounded-md border bg-muted/20 p-3">
            <div>
                <h5 className="text-sm font-semibold">Evidencias ({evidence.length})</h5>
                {evidence.length === 0 && (
                    <p className="mt-2 text-sm italic text-muted-foreground">Nenhuma evidencia encontrada.</p>
                )}
                {evidence.length > 0 && (
                    <div className="mt-2 space-y-2">
                        {evidence.map((item, index) => (
                            <div key={`${item.sourceId}-${index}`} className="rounded border bg-background p-2">
                                <div className="flex items-center gap-2 text-sm">
                                    {sourceIcon(item.sourceType)}
                                    <span className="font-medium">{item.sourceType}</span>
                                    <span className="text-muted-foreground">|</span>
                                    <span>{item.sourceName}</span>
                                </div>
                                <p className="mt-1 text-xs text-muted-foreground">
                                    {item.location} - "{item.snippet.slice(0, 200)}"
                                </p>
                                {item.url && (
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        className="mt-1 h-7 px-0 text-xs text-blue-600 hover:text-blue-700"
                                        asChild
                                    >
                                        <a href={item.url} target="_blank" rel="noreferrer">
                                            Abrir no Azure DevOps
                                            <ExternalLink className="ml-1 h-3 w-3" />
                                        </a>
                                    </Button>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {issues.length > 0 && (
                <div className="border-t pt-3">
                    <h5 className="text-sm font-semibold">Issues ({issues.length})</h5>
                    <div className="mt-2 space-y-2">
                        {issues.map((issue, index) => (
                            <div key={`${issue.field}-${issue.type}-${index}`} className="rounded border bg-background p-2">
                                <div className="flex items-center gap-2 text-sm">
                                    <Badge variant={issueVariant(issue.severity)}>{issue.severity}</Badge>
                                    <span>{issue.message}</span>
                                </div>
                                <p className="ml-2 mt-1 text-xs text-muted-foreground">{issue.suggestion}</p>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
