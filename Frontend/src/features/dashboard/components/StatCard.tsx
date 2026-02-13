import type { LucideIcon } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface StatCardProps {
    title: string;
    value: string | number;
    icon: LucideIcon;
    description?: string | React.ReactNode;
    trend?: {
        value: number;
        isPositive: boolean;
    };
    color?: string;
}

const colorStyles: Record<string, { bg: string; icon: string }> = {
    blue: { bg: 'bg-blue-50', icon: 'text-blue-600' },
    green: { bg: 'bg-green-50', icon: 'text-green-600' },
    amber: { bg: 'bg-amber-50', icon: 'text-amber-600' },
    red: { bg: 'bg-red-50', icon: 'text-red-600' },
    gray: { bg: 'bg-muted', icon: 'text-muted-foreground' },
};

export function StatCard({ title, value, icon: Icon, description, trend, color = 'blue' }: StatCardProps) {
    const palette = colorStyles[color] || colorStyles.blue;

    return (
        <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
                <div className={`p-2 rounded-lg ${palette.bg}`}>
                    <Icon className={`w-4 h-4 ${palette.icon}`} />
                </div>
            </CardHeader>
            <CardContent>
                <div className="text-2xl font-bold text-foreground">{value}</div>
                {description && (
                    <div className="text-xs text-muted-foreground mt-1">
                        {description}
                    </div>
                )}
                {trend && (
                    <div className="flex items-center gap-1 mt-2">
                        <span className={`text-xs font-medium ${trend.isPositive ? 'text-green-600' : 'text-red-600'}`}>
                            {trend.isPositive ? '↑' : '↓'} {Math.abs(trend.value)}%
                        </span>
                        <span className="text-xs text-muted-foreground">vs sprint anterior</span>
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
