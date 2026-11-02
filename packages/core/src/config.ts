/** All configuration comes from the environment (ADR-8). */
import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { AccessConfig } from './http/access.ts';

export interface Config {
  dataDir: string;
  port: number;
  mode: 'local' | 'remote';
  tokenFile: string;
  timeZone: string;
  /** Set for the phone: the built UI this core should serve. */
  uiDir?: string;
  ntfyUrl?: string;
  /** Where a sirius-voice instance accepts uploaded audio. */
  voiceUrl?: string;
  access?: AccessConfig;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const dataDir = env.SIRIUS_DATA_DIR ?? join(homedir(), '.local/share/sirius');
  return {
    dataDir,
    port: Number(env.SIRIUS_PORT ?? 7337),
    mode: env.SIRIUS_MODE === 'remote' ? 'remote' : 'local',
    tokenFile: env.SIRIUS_TOKEN_FILE ?? join(dataDir, 'token'),
    timeZone: env.SIRIUS_TZ ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
    ...(env.SIRIUS_UI_DIR ? { uiDir: env.SIRIUS_UI_DIR } : {}),
    ...(env.SIRIUS_NTFY_URL ? { ntfyUrl: env.SIRIUS_NTFY_URL } : {}),
    ...(env.SIRIUS_VOICE_URL ? { voiceUrl: env.SIRIUS_VOICE_URL } : {}),
    ...(env.SIRIUS_CF_TEAM_DOMAIN && env.SIRIUS_CF_AUD
      ? { access: { teamDomain: env.SIRIUS_CF_TEAM_DOMAIN, audience: env.SIRIUS_CF_AUD } }
      : {}),
  };
}

/** Reads the bearer token, creating it readable only by this user on first run. */
export function loadOrCreateToken(path: string): string {
  if (existsSync(path)) return readFileSync(path, 'utf8').trim();
  mkdirSync(dirname(path), { recursive: true });
  const token = randomBytes(32).toString('base64url');
  writeFileSync(path, `${token}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
  return token;
}
