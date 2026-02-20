import fs from 'fs';
import os from 'os';
import path from 'path';
import { logger } from '@/utils/logger';

function ensureWritableDir(dirPath: string): boolean {
    try {
        fs.mkdirSync(dirPath, { recursive: true });
        fs.accessSync(dirPath, fs.constants.W_OK);
        return true;
    } catch {
        return false;
    }
}

function resolveUploadsBaseDir(): string {
    const configuredDir = process.env.RDA_UPLOADS_DIR?.trim();
    const preferredDir = configuredDir
        ? path.resolve(configuredDir)
        : path.resolve(process.cwd(), 'uploads');

    if (ensureWritableDir(preferredDir)) {
        return preferredDir;
    }

    const fallbackDir = path.resolve(os.tmpdir(), 'azurebridge', 'uploads');
    if (!ensureWritableDir(fallbackDir)) {
        throw new Error('Não foi possível preparar diretório gravável para uploads do RDA.');
    }

    logger.warn('[RDA Storage] Usando diretório fallback de uploads', {
        preferredDir,
        fallbackDir,
    });

    return fallbackDir;
}

export const RDA_UPLOADS_DIR = resolveUploadsBaseDir();
export const RDA_TEMPLATES_DIR = path.join(RDA_UPLOADS_DIR, 'templates');
export const RDA_GENERATED_DIR = path.join(RDA_UPLOADS_DIR, 'generated');
export const RDA_TEMPLATE_FACTORY_ANALYSES_DIR = path.join(RDA_UPLOADS_DIR, 'template-factory-analyses');
