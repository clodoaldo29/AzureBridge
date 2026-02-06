import { Prisma } from '@prisma/client';

const missingTableCodes = new Set(['P2021', 'P2022']);

export function isMissingDatabaseTableError(error: unknown): boolean {
    return (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        missingTableCodes.has(error.code)
    );
}
