import { format, formatDistanceToNow, differenceInDays } from 'date-fns';
import { ptBR } from 'date-fns/locale';

export const formatDate = (date: string | Date) => {
    return format(new Date(date), 'dd/MM/yyyy', { locale: ptBR });
};

export const formatDateTime = (date: string | Date) => {
    return format(new Date(date), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR });
};

export const formatRelativeTime = (date: string | Date) => {
    return formatDistanceToNow(new Date(date), { addSuffix: true, locale: ptBR });
};

export const formatHours = (hours: number) => {
    if (hours === 0) return '0h';
    if (hours < 1) return `${Math.round(hours * 60)}min`;
    return `${hours.toFixed(1)}h`;
};

export const formatPercentage = (value: number, decimals = 0) => {
    return `${value.toFixed(decimals)}%`;
};

export const getDaysRemaining = (endDate: string) => {
    return differenceInDays(new Date(endDate), new Date());
};

export const getUtilizationColor = (utilization: number) => {
    if (utilization < 60) return 'text-blue-600 bg-blue-50';
    if (utilization < 85) return 'text-green-600 bg-green-50';
    if (utilization < 100) return 'text-amber-600 bg-amber-50';
    return 'text-red-600 bg-red-50';
};

export const getRiskColor = (risk?: string) => {
    switch (risk) {
        case 'low':
            return 'text-green-600 bg-green-50';
        case 'medium':
            return 'text-amber-600 bg-amber-50';
        case 'high':
            return 'text-orange-600 bg-orange-50';
        case 'critical':
            return 'text-red-600 bg-red-50';
        default:
            return 'text-gray-600 bg-gray-50';
    }
};
