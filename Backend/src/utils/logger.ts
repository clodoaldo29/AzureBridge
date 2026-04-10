import { formatDualTimezoneInline } from './timezone-display';

function buildLogPrefix(level: string): string {
    return `[${level}] [${formatDualTimezoneInline()}]`;
}

const logger = {
    info: (...args: any[]) => console.log(buildLogPrefix('INFO'), ...args),
    error: (...args: any[]) => console.error(buildLogPrefix('ERROR'), ...args),
    warn: (...args: any[]) => console.warn(buildLogPrefix('WARN'), ...args),
    debug: (...args: any[]) => console.debug(buildLogPrefix('DEBUG'), ...args),
};

export { logger };
