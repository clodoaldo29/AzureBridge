import { Button } from '@/components/ui/button';
import { PreflightCheck } from '@/pages/RDA/hooks/usePreflight';
import { AlertTriangle, CheckCircle, Loader2, SkipForward, XCircle } from 'lucide-react';

interface PreflightCheckItemProps {
    check: PreflightCheck;
    loading?: boolean;
    onAction?: (check: PreflightCheck) => void;
}

function statusIcon(check: PreflightCheck, loading?: boolean) {
    if (loading) return <Loader2 className="h-4 w-4 animate-spin text-slate-500" />;
    if (check.status === 'pass') return <CheckCircle className="h-4 w-4 text-emerald-600" />;
    if (check.status === 'fail') return <XCircle className="h-4 w-4 text-red-600" />;
    if (check.status === 'warn') return <AlertTriangle className="h-4 w-4 text-amber-600" />;
    return <SkipForward className="h-4 w-4 text-slate-500" />;
}

export function PreflightCheckItem({ check, loading = false, onAction }: PreflightCheckItemProps) {
    return (
        <div className="rounded-md border p-3">
            <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-2">
                    <div className="mt-0.5">{statusIcon(check, loading)}</div>
                    <div>
                        <p className="text-sm font-medium">{check.name}</p>
                        <p className="text-xs text-muted-foreground">{check.message}</p>
                        {check.details && (
                            <p className="text-[11px] text-muted-foreground">
                                {Object.entries(check.details).slice(0, 2).map(([key, value]) => `${key}: ${String(value)}`).join(' • ')}
                            </p>
                        )}
                        {check.duration !== undefined && (
                            <p className="text-[11px] text-muted-foreground">{check.duration} ms</p>
                        )}
                    </div>
                </div>

                {check.action && (check.status === 'fail' || check.status === 'warn') && onAction && (
                    <Button size="sm" variant="outline" onClick={() => onAction(check)}>
                        Acao sugerida
                    </Button>
                )}
            </div>
        </div>
    );
}
