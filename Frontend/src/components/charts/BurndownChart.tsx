import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { formatDate } from '@/utils/formatters';
import type { SprintSnapshot } from '@/types';

interface BurndownChartProps {
    data: SprintSnapshot[];
}

export function BurndownChart({ data }: BurndownChartProps) {
    const chartData = data.map((snapshot) => ({
        date: formatDate(snapshot.snapshotDate),
        remaining: snapshot.remainingWork,
        ideal: snapshot.idealRemaining || 0,
    }));

    // Simple logic to set isOnTrack based on last data point vs ideal
    const lastPoint = data.length > 0 ? data[data.length - 1] : null;
    const isOnTrack = lastPoint ? (lastPoint.remainingWork || 0) <= (lastPoint.idealRemaining || Infinity) : true;

    return (
        <Card>
            <CardHeader>
                <div className="flex items-center justify-between">
                    <CardTitle>Sprint Burndown</CardTitle>
                    <div className="flex items-center gap-2">
                        <div className={`px-3 py-1 rounded-full text-xs font-medium ${isOnTrack ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
                            }`}>
                            {isOnTrack ? '✓ No Prazo' : '⚠ Atrasado'}
                        </div>
                    </div>
                </div>
            </CardHeader>
            <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                    <LineChart data={chartData}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="date" />
                        <YAxis label={{ value: 'Horas', angle: -90, position: 'insideLeft' }} />
                        <Tooltip />
                        <Legend />
                        <Line
                            type="monotone"
                            dataKey="ideal"
                            stroke="#94a3b8"
                            strokeDasharray="5 5"
                            name="Ideal"
                        />
                        <Line
                            type="monotone"
                            dataKey="remaining"
                            stroke="#3b82f6"
                            strokeWidth={2}
                            name="Real"
                        />
                    </LineChart>
                </ResponsiveContainer>
            </CardContent>
        </Card>
    );
}
