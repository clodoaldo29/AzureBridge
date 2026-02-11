import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { getHealthStatus } from '@/utils/calculations';
import { CheckCircle2, Info, AlertTriangle, XCircle } from 'lucide-react';
import { cn } from '@/utils/cn';

interface SprintHealthCardProps {
    score: number;
    factors?: {
        capacity: number;
        progress: number;
        quality: number;
        blockers: number;
    };
    reasons?: string[];
}

const iconMap = {
    CheckCircle2,
    Info,
    AlertTriangle,
    XCircle,
};

export function SprintHealthCard({ score, factors, reasons }: SprintHealthCardProps) {
    const status = getHealthStatus(score);
    const Icon = iconMap[status.icon as keyof typeof iconMap];

    return (
        <Card>
            <CardHeader>
                <CardTitle className="text-lg">Sprint Health Score</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="flex items-center gap-4">
                    <div className="flex-1">
                        <div className="flex items-center justify-between mb-2">
                            <span className="text-3xl font-bold">{score}</span>
                            <div className={cn('px-3 py-1 rounded-full text-sm font-medium', status.color)}>
                                <div className="flex items-center gap-1">
                                    <Icon className="w-4 h-4" />
                                    <span>{status.label}</span>
                                </div>
                            </div>
                        </div>
                        <Progress value={score} className="h-2" />
                    </div>
                </div>

                {factors && (
                    <div className="space-y-2 pt-4 border-t">
                        <h4 className="text-sm font-medium text-gray-700">Fatores</h4>
                        <div className="grid grid-cols-2 gap-2 text-xs">
                            <div className="flex justify-between">
                                <span className="text-gray-600">Capacidade:</span>
                                <span className="font-medium">{factors.capacity}/30</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-gray-600">Progresso:</span>
                                <span className="font-medium">{factors.progress}/40</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-gray-600">Qualidade:</span>
                                <span className="font-medium">{factors.quality}/20</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-gray-600">Blockers:</span>
                                <span className="font-medium">{factors.blockers}/10</span>
                            </div>
                        </div>
                    </div>
                )}

                <div className="space-y-1 pt-4 border-t">
                    <h4 className="text-sm font-medium text-gray-700">Por que essa nota?</h4>
                    {reasons && reasons.length > 0 ? (
                        reasons.map((r, i) => (
                            <div key={i} className="text-xs text-gray-600">
                                {r}
                            </div>
                        ))
                    ) : (
                        <div className="text-xs text-gray-600">Sem penalidades.</div>
                    )}
                </div>

                {/* Metrics block removed per request */}
            </CardContent>
        </Card>
    );
}
