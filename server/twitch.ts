// Twitch: Anmeldung (OAuth, nur Identität), Bot-Zugang für die Brücke (chat:read chat:edit, Token erneuert sich
// selbst) und der Chat über IRC (WebSocket). Ohne Bot liest die Seite anonym mit und schreibt nicht nach Twitch.
import { WebSocket } from 'ws';
import type { Config } from './config.js';
import { kvGet, kvSet, type DB } from './db.js';

export type Fetch = typeof fetch;

export const authorizeUrl = (c: Config, state: string, scope = '') =>
  `https://id.twitch.tv/oauth2/authorize?${new URLSearchParams({ response_type: 'code', client_id: c.twitch.clientId, redirect_uri: `${c.baseUrl}/auth/twitch`, scope, state, force_verify: scope ? 'true' : 'false' })}`;

export interface TwitchToken {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
}
export async function exchangeCode(c: Config, code: string, f: Fetch = fetch): Promise<TwitchToken> {
  const r = await f('https://id.twitch.tv/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: c.twitch.clientId, client_secret: c.twitch.clientSecret, code, grant_type: 'authorization_code', redirect_uri: `${c.baseUrl}/auth/twitch` }),
  });
  if (!r.ok) throw new Error(`Twitch-Token: HTTP ${r.status}`);
  return (await r.json()) as TwitchToken;
}
export async function refreshToken(c: Config, refresh: string, f: Fetch = fetch): Promise<TwitchToken> {
  const r = await f('https://id.twitch.tv/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: c.twitch.clientId, client_secret: c.twitch.clientSecret, grant_type: 'refresh_token', refresh_token: refresh }),
  });
  if (!r.ok) throw new Error(`Twitch-Erneuerung: HTTP ${r.status}`);
  return (await r.json()) as TwitchToken;
}
export interface TwitchUser {
  id: string;
  login: string;
  display_name: string;
}
export async function getTwitchUser(c: Config, access: string, f: Fetch = fetch): Promise<TwitchUser> {
  const r = await f('https://api.twitch.tv/helix/users', { headers: { Authorization: `Bearer ${access}`, 'Client-Id': c.twitch.clientId } });
  if (!r.ok) throw new Error(`Twitch-Nutzer: HTTP ${r.status}`);
  const j = (await r.json()) as { data: TwitchUser[] };
  if (!j.data?.[0]) throw new Error('Twitch-Nutzer: leer');
  return j.data[0];
}

// --- Bot-Zugang (in kv gespeichert) ---
export interface BotAuth {
  login: string;
  access: string;
  refresh: string;
  expires: number; // ms
}
export const loadBot = (db: DB) => kvGet<BotAuth>(db, 'twitchBot');
export const saveBot = (db: DB, b: BotAuth | null) => kvSet(db, 'twitchBot', b);

// --- IRC ---
export interface IrcMsg {
  login: string;
  name: string;
  color?: string;
  text: string;
  mod: boolean; // Mod oder Kanalbesitzer
  id?: string; // Twitch-Nachrichten-ID
}
export function parseIrc(line: string): IrcMsg | null {
  // @tags :login!login@login.tmi.twitch.tv PRIVMSG #kanal :Text
  const m = line.match(/^(?:@(\S+) )?:(\w+)!\S+ PRIVMSG #\w+ :(.*)$/);
  if (!m) return null;
  const tags: Record<string, string> = {};
  for (const kv of (m[1] ?? '').split(';')) {
    const i = kv.indexOf('=');
    if (i > 0) tags[kv.slice(0, i)] = kv.slice(i + 1).replace(/\\s/g, ' ').replace(/\\:/g, ';').replace(/\\\\/g, '\\');
  }
  let text = m[3];
  if (text.startsWith('\u0001ACTION ') && text.endsWith('\u0001')) text = text.slice(8, -1);
  const badges = tags.badges ?? '';
  return {
    login: m[2].toLowerCase(),
    name: tags['display-name'] || m[2],
    color: /^#[0-9a-fA-F]{6}$/.test(tags.color ?? '') ? tags.color : undefined,
    text,
    mod: tags.mod === '1' || /(^|,)broadcaster\//.test(badges),
    id: tags.id,
  };
}

// Verbindung zum Twitch-Chat: liest immer, schreibt nur mit Bot-Zugang
export class TwitchIrc {
  private ws: WebSocket | null = null;
  private retry = 1000;
  private stopped = false;
  status: 'aus' | 'verbinde' | 'verbunden' | 'getrennt' = 'aus';
  canWrite = false;
  botLogin = '';

  constructor(
    private c: Config,
    private db: DB,
    private onMsg: (m: IrcMsg) => void,
    private log: (s: string) => void = () => {},
    private url = 'wss://irc-ws.chat.twitch.tv:443',
    private f: Fetch = fetch,
  ) {}

  private async botAccess(): Promise<BotAuth | null> {
    let b = loadBot(this.db);
    if (!b) return null;
    if (b.expires - Date.now() < 10 * 60e3 && b.refresh && this.c.twitch.clientId) {
      try {
        const t = await refreshToken(this.c, b.refresh, this.f);
        b = { ...b, access: t.access_token, refresh: t.refresh_token ?? b.refresh, expires: Date.now() + (t.expires_in ?? 14400) * 1000 };
        saveBot(this.db, b);
      } catch (e) {
        this.log(`Bot-Zugang: Erneuern fehlgeschlagen (${String(e)}), lese anonym`);
        return null;
      }
    }
    return b;
  }

  async connect(): Promise<void> {
    if (this.stopped || !this.c.twitch.channel) return;
    this.status = 'verbinde';
    const bot = await this.botAccess();
    const ws = new WebSocket(this.url);
    this.ws = ws;
    ws.on('open', () => {
      ws.send('CAP REQ :twitch.tv/tags twitch.tv/commands');
      if (bot) {
        ws.send(`PASS oauth:${bot.access}`);
        ws.send(`NICK ${bot.login}`);
      } else {
        ws.send('PASS SCHMOOPIIE');
        ws.send(`NICK justinfan${Math.floor(10000 + Math.random() * 80000)}`);
      }
      ws.send(`JOIN #${this.c.twitch.channel}`);
    });
    ws.on('message', (data) => {
      for (const line of String(data).split('\r\n')) {
        if (!line) continue;
        if (line.startsWith('PING')) {
          ws.send('PONG :tmi.twitch.tv');
          continue;
        }
        if (/ 366 | JOIN #/.test(line)) {
          this.status = 'verbunden';
          this.retry = 1000;
          this.canWrite = !!bot;
          this.botLogin = bot?.login ?? '';
        }
        if (/NOTICE \* :Login authentication failed/.test(line)) {
          this.log('Bot-Zugang abgelehnt – neu verbinden in /admin');
          this.canWrite = false;
        }
        const m = parseIrc(line);
        if (m && m.login !== this.botLogin) this.onMsg(m);
      }
    });
    ws.on('close', () => {
      this.status = 'getrennt';
      this.canWrite = false;
      if (this.stopped) return;
      setTimeout(() => void this.connect(), this.retry);
      this.retry = Math.min(30000, this.retry * 2);
    });
    ws.on('error', () => ws.close());
  }
  say(text: string): boolean {
    if (!this.canWrite || !this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    this.ws.send(`PRIVMSG #${this.c.twitch.channel} :${text.replace(/[\r\n]+/g, ' ').slice(0, 480)}`);
    return true;
  }
  reconnect(): void {
    this.ws?.close();
  }
  stop(): void {
    this.stopped = true;
    this.ws?.close();
  }
}
