const DATE_TIME_FORMAT_OPTIONS: Intl.DateTimeFormatOptions = {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
};

const TIMEZONES = {
    utc: 'UTC',
    brasilia: 'America/Sao_Paulo',
    manaus: 'America/Manaus',
} as const;

function formatForTimezone(date: Date, timeZone: string): string {
    return new Intl.DateTimeFormat('pt-BR', {
        ...DATE_TIME_FORMAT_OPTIONS,
        timeZone,
    }).format(date);
}

function getDualTimezoneParts(date = new Date()): { brasilia: string; manaus: string } {
    return {
        brasilia: formatForTimezone(date, TIMEZONES.brasilia),
        manaus: formatForTimezone(date, TIMEZONES.manaus),
    };
}

function getTripleTimezoneParts(date = new Date()): { utc: string; brasilia: string; manaus: string } {
    return {
        utc: formatForTimezone(date, TIMEZONES.utc),
        ...getDualTimezoneParts(date),
    };
}

function formatDualTimezoneInline(date = new Date()): string {
    const parts = getDualTimezoneParts(date);
    return `Brasilia: ${parts.brasilia} | Manaus: ${parts.manaus}`;
}

function formatUtcDualTimezoneInline(date = new Date()): string {
    const utc = formatForTimezone(date, TIMEZONES.utc);
    const parts = getDualTimezoneParts(date);
    return `UTC: ${utc} | Brasilia: ${parts.brasilia} | Manaus: ${parts.manaus}`;
}

export {
    TIMEZONES,
    formatForTimezone,
    getDualTimezoneParts,
    getTripleTimezoneParts,
    formatDualTimezoneInline,
    formatUtcDualTimezoneInline,
};
