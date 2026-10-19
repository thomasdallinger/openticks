import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface Config {
  port: number;
  dataDir: string;
  accessKey: string;
  /** How long an open waits before it is counted, so a self-view report can still cancel it. */
  settleMs: number;
  /** Opens this close to a self-view report of the same message are the sender's own. */
  selfViewWindowMs: number;
  /** Opens this soon after sending are security scanners, not humans. */
  minOpenDelayMs: number;
  retentionDays: number;
}

function intFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number.parseInt(raw, 10);
  if (Number.isNaN(value)) throw new Error(`${name} must be an integer, got "${raw}"`);
  return value;
}

function generateKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return Buffer.from(bytes).toString('base64url');
}

/** Uses OPENTICKS_ACCESS_KEY, else a key persisted in the data dir, else generates one. */
function resolveAccessKey(dataDir: string): string {
  const fromEnv = process.env.OPENTICKS_ACCESS_KEY?.trim();
  if (fromEnv) return fromEnv;
  const file = join(dataDir, 'access-key');
  if (existsSync(file)) return readFileSync(file, 'utf8').trim();
  const key = generateKey();
  writeFileSync(file, `${key}\n`, { mode: 0o600 });
  return key;
}

export function loadConfig(): Config {
  const dataDir = process.env.OPENTICKS_DATA_DIR ?? join(process.cwd(), 'data');
  mkdirSync(dataDir, { recursive: true });
  return {
    port: intFromEnv('PORT', 8787),
    dataDir,
    accessKey: resolveAccessKey(dataDir),
    settleMs: intFromEnv('OPENTICKS_SETTLE_MS', 4000),
    selfViewWindowMs: intFromEnv('OPENTICKS_SELF_VIEW_WINDOW_MS', 15000),
    minOpenDelayMs: intFromEnv('OPENTICKS_MIN_OPEN_DELAY_MS', 3000),
    retentionDays: intFromEnv('OPENTICKS_RETENTION_DAYS', 180),
  };
}
