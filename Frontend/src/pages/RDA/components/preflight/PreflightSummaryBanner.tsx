import { Badge } from '@/components/ui/badge';
import { AlertTriangle, CheckCircle, Loader2, XCircle } from 'lucide-react';

interface PreflightSummaryBannerProps {
    loading?: boolean;
    status?: 'approved' | 'blocked' | 'warning';
    warningsCount?: number;
    blockersCount?: number;
}

export function PreflightSummaryBanner({
    loading = false,
    status,
    warningsCount = 0,
    blockersCount = 0,
}: PreflightSummaryBannerProps) {
    if (loading) {
        return (
            <div className="flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm">
                <Loader2 className="h-4 w-4 animate-spin" /> Verificando requisitos de geracao...
            </div>
        );
    }

    if (status === 'approved') {
        return (
            <div className="flex items-center justify-between rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm">
                <div className="flex items-center gap-2 text-emerald-800">
                    <CheckCircle className="h-4 w-4" /> Pronto para gerar
                </div>
                <Badge>OK</Badge>
            </div>
        );
    }

    if (status === 'warning') {
        return (
            <div className="flex items-center justify-between rounded-md border border-amber-200 bg-amber-50 p-3 text-sm">
                <div className="flex items-center gap-2 text-amber-800">
                    <AlertTriangle className="h-4 w-4" /> Aprovado com {warningsCount} aviso(s)
                </div>
                <Badge variant="secondary">Atencao</Badge>
            </div>
        );
    }

    return (
        <div className="flex items-center justify-between rounded-md border border-red-200 bg-red-50 p-3 text-sm">
            <div className="flex items-center gap-2 text-red-800">
                <XCircle className="h-4 w-4" /> Geracao bloqueada - {blockersCount} problema(s)
            </div>
            <Badge variant="destructive">Bloqueado</Badge>
        </div>
    );
}