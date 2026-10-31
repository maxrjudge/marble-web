// Einstellungen aus der Umgebung (systemd: EnvironmentFile=/etc/marble-web.env, lokal: .env im Projektordner).
// Geheimnisse (Twitch-Secret, SMTP-Passwort, Arena-Token, Admin-Passwort) stehen nur dort, nie im Code.
import { existsSync, readFileSync } from 'node:fs';

function loadEnvFile(path: string): void {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m || line.trim().startsWith('#')) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
}
loadEnvFile(process.env.MARBLE_ENV ?? '.env');

const env = (k: string, d = ''): string => process.env[k] ?? d;

export interface Config {
  port: number;
  host: string;
  baseUrl: string; // https://arena.maxr.at (ohne Schrägstrich am Ende)
  dbPath: string;
  publicDir: string;
  lsmEmbedBase: string; // https://io.maxr.at/embed/live/
  lsmStreamKey: string;
  twitch: { clientId: string; clientSecret: string; channel: string };
  smtp: { host: string; port: number; user: string; pass: string; from: string; secure: boolean };
  arenaToken: string; // die Arena meldet sich damit an (/arena, /arena-api/profiles)
  adminPassword: string; // /admin (Benutzer „admin“)
  secureCookies: boolean;
}

export function loadConfig(over: Partial<Config> = {}): Config {
  const baseUrl = env('BASE_URL', 'http://127.0.0.1:5310').replace(/\/+$/, '');
  const cfg: Config = {
    port: Number(env('PORT', '5310')),
    host: env('HOST', '127.0.0.1'),
    baseUrl,
    dbPath: env('DB_PATH', 'marble-web.db'),
    publicDir: env('PUBLIC_DIR', 'dist/public'),
    lsmEmbedBase: env('LSM_EMBED_BASE', 'https://io.maxr.at/embed/live/'),
    lsmStreamKey: env('LSM_STREAM_KEY'),
    twitch: { clientId: env('TWITCH_CLIENT_ID'), clientSecret: env('TWITCH_CLIENT_SECRET'), channel: env('TWITCH_CHANNEL', 'marblearena').toLowerCase() },
    smtp: { host: env('SMTP_HOST'), port: Number(env('SMTP_PORT', '465')), user: env('SMTP_USER'), pass: env('SMTP_PASS'), from: env('MAIL_FROM', 'MarbleArena <noreply@maxr.at>'), secure: env('SMTP_SECURE', 'true') !== 'false' },
    arenaToken: env('ARENA_TOKEN'),
    adminPassword: env('ADMIN_PASSWORD'),
    secureCookies: baseUrl.startsWith('https://'),
    ...over,
  };
  return cfg;
}

// was fehlt, damit alles läuft (beim Start im Log, auf /admin)
export function configProblems(c: Config): string[] {
  const p: string[] = [];
  if (!c.lsmStreamKey) p.push('LSM_STREAM_KEY fehlt: kein Livebild');
  if (!c.twitch.clientId || !c.twitch.clientSecret) p.push('TWITCH_CLIENT_ID/TWITCH_CLIENT_SECRET fehlen: keine Twitch-Anmeldung, keine Brücke zum Schreiben');
  if (!c.smtp.host) p.push('SMTP_HOST fehlt: keine Anmeldung per E-Mail');
  if (c.arenaToken.length < 16) p.push('ARENA_TOKEN fehlt oder ist kürzer als 16 Zeichen: die Arena kann sich nicht verbinden');
  if (c.adminPassword.length < 10) p.push('ADMIN_PASSWORD fehlt oder ist kürzer als 10 Zeichen: /admin ist gesperrt');
  return p;
}
