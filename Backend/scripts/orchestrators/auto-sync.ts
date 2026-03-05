import { spawn } from 'child_process';
import path from 'path';
import 'dotenv/config';

type StepResult = {
    name: string;
    status: 'OK' | 'FAILED';
    durationSec: number;
    attempts: number;
    error?: string;
};

const backendDir = path.resolve(__dirname, '..', '..');

function nowIso(): string {
    return new Date().toISOString();
}

function runStep(name: string, scriptPath: string, env?: Record<string, string>): Promise<number> {
    return new Promise((resolve, reject) => {
        const startedAt = Date.now();
        console.log(`\n🚀 ${name}`);
        console.log(`🕒 started_at=${nowIso()}`);

        const cmd = process.platform === 'win32' ? 'node.exe' : 'node';
        const child = spawn(cmd, ['node_modules/tsx/dist/cli.mjs', scriptPath], {
            cwd: backendDir,
            stdio: 'inherit',
            env: { ...process.env, ...env }
        });

        child.on('exit', code => {
            const duration = Math.floor((Date.now() - startedAt) / 1000);
            if (code === 0) {
                console.log(`✅ ${name} (${duration}s)`);
                resolve(duration);
            } else {
                reject(new Error(`${name} exited with code ${code} after ${duration}s`));
            }
        });

        child.on('error', err => reject(err));
    });
}

async function runStepWithRetry(
    name: string,
    scriptPath: string,
    env: Record<string, string> | undefined,
    maxAttempts: number
): Promise<StepResult> {
    let attempt = 0;
    let lastErr: any;

    while (attempt < maxAttempts) {
        attempt++;
        try {
            if (attempt > 1) {
                const waitSec = Math.min(15, attempt * 3);
                console.log(`🔁 Retry ${name} | tentativa=${attempt}/${maxAttempts} | espera=${waitSec}s`);
                await new Promise(r => setTimeout(r, waitSec * 1000));
            }
            const durationSec = await runStep(name, scriptPath, env);
            return { name, status: 'OK', durationSec, attempts: attempt };
        } catch (err: any) {
            lastErr = err;
            console.error(`⚠️ ${name} falhou na tentativa ${attempt}/${maxAttempts}: ${err?.message || err}`);
        }
    }

    return {
        name,
        status: 'FAILED',
        durationSec: 0,
        attempts: maxAttempts,
        error: String(lastErr?.message || lastErr || 'unknown error')
    };
}

async function main() {
    const rawMode = (process.env.AUTO_SYNC_MODE || process.argv[2] || 'daily').toLowerCase();
    const mode = rawMode === 'bootstrap' ? 'full' : rawMode;
    const maxAttempts = Math.max(1, Number(process.env.AUTO_SYNC_STEP_RETRIES || 3));
    const startedAt = Date.now();

    console.log('SYNC PIPELINE');
    console.log('='.repeat(72));
    console.log(`MODE: ${mode}`);
    console.log(`STEP_RETRIES: ${maxAttempts}`);
    console.log(`started_at=${nowIso()}`);

    let scriptPath: string;
    let scriptEnv: Record<string, string> | undefined;
    let stepName: string;

    if (mode === 'hourly') {
        scriptPath = 'scripts/sync/sync-hourly.ts';
        stepName = 'SYNC HORÁRIO';
    } else if (mode === 'full') {
        scriptPath = 'scripts/sync/sync-daily.ts';
        scriptEnv = { FULL_SYNC: 'true' };
        stepName = 'SYNC DIÁRIO (FULL)';
    } else {
        scriptPath = 'scripts/sync/sync-daily.ts';
        stepName = 'SYNC DIÁRIO';
    }

    const result = await runStepWithRetry(stepName, scriptPath, scriptEnv, maxAttempts);

    const duration = Math.floor((Date.now() - startedAt) / 1000);
    console.log('\n' + '='.repeat(72));

    if (result.status === 'OK') {
        console.log(`SYNC PIPELINE COMPLETED (${duration}s)`);
    } else {
        console.log(`SYNC PIPELINE FAILED (${duration}s)`);
        console.error(`❌ ${result.name}: ${result.error}`);
    }

    console.log('='.repeat(72));
    const icon = result.status === 'OK' ? '✅' : '❌';
    console.log(`${icon} ${result.name} | attempts=${result.attempts} | duration=${result.durationSec}s`);
    console.log(`finished_at=${nowIso()}`);

    if (result.status === 'FAILED') {
        process.exit(1);
    }
}

main().catch(err => {
    console.error(`\n❌ SYNC PIPELINE FALHOU: ${err.message || err}`);
    process.exit(1);
});
