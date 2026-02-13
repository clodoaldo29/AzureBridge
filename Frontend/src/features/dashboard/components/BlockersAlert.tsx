import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import { formatRelativeTime } from '@/utils/formatters';
import type { WorkItem } from '@/types';

interface BlockersAlertProps {
    blockedItems: WorkItem[];
}

export function BlockersAlert({ blockedItems }: BlockersAlertProps) {
    if (blockedItems.length === 0) {
        return (
            <Card>
                <CardHeader>
                    <CardTitle className="text-lg">Blockers</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="text-center py-8 text-muted-foreground">
                        <div className="flex justify-center mb-3">
                            <CheckCircle2 className="w-10 h-10 text-green-600" />
                        </div>
                        <div className="font-medium">Nenhum blocker ativo!</div>
                    </div>
                </CardContent>
            </Card>
        );
    }

    return (
        <Card className="border-amber-200 bg-amber-50">
            <CardHeader>
                <div className="flex items-center gap-2">
                    <AlertTriangle className="w-5 h-5 text-amber-600" />
                    <CardTitle className="text-lg text-amber-900">
                        Blockers Ativos ({blockedItems.length})
                    </CardTitle>
                </div>
            </CardHeader>
            <CardContent>
                <div className="space-y-3">
                    {blockedItems.map((item) => (
                        <div key={item.id} className="bg-card border border-amber-200 rounded-lg p-3">
                            <div className="flex items-start justify-between gap-2">
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 mb-1">
                                        <Badge variant="outline" className="text-xs">
                                            #{item.azureId}
                                        </Badge>
                                        <Badge variant="secondary" className="text-xs">
                                            {item.type}
                                        </Badge>
                                    </div>
                                    <div className="font-medium text-sm text-foreground truncate">{item.title}</div>
                                    <div className="text-xs text-muted-foreground mt-1">
                                        Bloqueado {formatRelativeTime(item.changedDate)}
                                    </div>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            </CardContent>
        </Card>
    );
}
