import { Badge } from '@/components/ui/badge';
import { useReadiness } from '@/pages/RDA/hooks/usePreflight';

interface GenerationReadinessIndicatorProps {
    projectId: string;
    period: string;
    enabled?: boolean;
}

export function GenerationReadinessIndicator({ projectId, period, enabled = true }: GenerationReadinessIndicatorProps) {
    const readiness = useReadiness(projectId, period, enabled, enabled ? 30_000 : false);

    if (!enabled) {
        return <Badge variant="outline">Nao verificado</Badge>;
    }

    if (readiness.isLoading) {
        return <Badge variant="secondary">Verificando...</Badge>;
    }

    if (readiness.isError || !readiness.data) {
        return <Badge variant="outline">Nao verificado</Badge>;
    }

    if (!readiness.data.ready) {
        return <Badge variant="destructive">Bloqueado</Badge>;
    }

    if ((readiness.data.warnings?.length ?? 0) > 0) {
        return <Badge variant="secondary">Com avisos</Badge>;
    }

    return <Badge>Pronto</Badge>;
}
