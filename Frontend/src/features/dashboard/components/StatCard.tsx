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

export function StatCard({ title, value, icon: Icon, description, trend, color = 'blue' }: StatCardProps) {
    return (
        <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-gray-600">{title}</CardTitle>
                <div className={`p-2 rounded-lg bg-${color}-50`}>
                    <Icon className={`w-4 h-4 text-${color}-600`} />
                </div>
            </CardHeader>
            <CardContent>
                <div className="text-2xl font-bold">{value}</div>
                {description && (
                    <div className="text-xs text-gray-500 mt-1">
                        {description}
                    </div>
                )}
                {trend && (
                    <div className="flex items-center gap-1 mt-2">
                        <span
                            className={`text-xs font-medium ${trend.isPositive ? 'text-green-600' : 'text-red-600'
                                }`}
                        >
                            {trend.isPositive ? '↑' : '↓'} {Math.abs(trend.value)}%
                        </span>
                        <span className="text-xs text-gray-500">vs sprint anterior</span>
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
