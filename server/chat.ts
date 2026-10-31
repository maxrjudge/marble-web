// Chat der Seite: Browser hängen per WebSocket an /ws. Angemeldete schreiben, alle lesen. Befehle (!join, !muenze 3 …)
// gehen an die Arena und nicht in den Chat; die Antwort der Arena kommt nur beim Absender an. Brücke zu Twitch in
// beide Richtungen (Twitch-Befehle zeigt die Seite nicht: die Arena liest sie ohnehin direkt bei Twitch).
import { WebSocket } from 'ws';
import { now, userKey, type DB, type User } from './db.js';

export interface ChatLine {
  id: number;
  ts: number;
  src: 'web' | 'twitch' | 'ferdl' | 'sys';
  key: string;
  name: string;
  color?: string;
  text: string;
  mod: boolean;
}
export interface ArenaChatMsg {
  user: string;
  name: string;
  text: string;
  mod?: boolean;
  color?: string;
}
export interface Hooks {
  toArena: (m: ArenaChatMsg) => boolean; // false = Arena nicht verbunden
  toTwitch: (text: string) => boolean;
  bridgeOn: () => boolean;
}

const LIMITS = { len: 300, history: 60, perSecond: 1, burst: 5, burstWindow: 10_000 };
const LINK = /(https?:\/\/|www\.)\S+/i;

interface Client {
  ws: WebSocket;
  user: User | null;
  sent: number[]; // Zeitpunkte der letzten Nachrichten
}

export class ChatHub {
  private clients = new Set<Client>();
  private history: ChatLine[] = [];

  constructor(
    private db: DB,
    private hooks: Hooks,
  ) {
    const rows = db.prepare('SELECT id, ts, source, user_key, name, color, text, mod FROM chat WHERE deleted = 0 ORDER BY id DESC LIMIT ?').all(LIMITS.history) as {
      id: number;
      ts: number;
      source: ChatLine['src'];
      user_key: string;
      name: string;
      color: string | null;
      text: string;
      mod: number;
    }[];
    this.history = rows.reverse().map((r) => ({ id: r.id, ts: r.ts, src: r.source, key: r.user_key, name: r.name, color: r.color ?? undefined, text: r.text, mod: !!r.mod }));
  }

  get count(): number {
    return this.clients.size;
  }

  isMod(u: User | null): boolean {
    if (!u) return false;
    if (u.is_mod) return true;
    if (!u.twitch_login) return false;
    return !!this.db.prepare('SELECT 1 FROM twitch_mods WHERE login = ?').get(u.twitch_login.toLowerCase());
  }

  attach(ws: WebSocket, user: User | null, arenaOnline: boolean): void {
    const c: Client = { ws, user, sent: [] };
    this.clients.add(c);
    this.send(c, {
      t: 'hello',
      me: user && user.age_ok ? { name: user.name, color: user.color, key: userKey(user), mod: this.isMod(user) } : null,
      history: this.history,
      arena: arenaOnline,
    });
    this.broadcast({ t: 'count', n: this.clients.size });
    ws.on('message', (raw) => {
      let m: { t?: string; text?: string; id?: number; key?: string; minutes?: number };
      try {
        m = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (m.t === 'say' && typeof m.text === 'string') this.say(c, m.text);
      else if (m.t === 'del' && typeof m.id === 'number') this.del(c, m.id);
      else if (m.t === 'mute' && typeof m.key === 'string') this.mute(c, m.key, Number(m.minutes) || 5);
    });
    ws.on('close', () => {
      this.clients.delete(c);
      this.broadcast({ t: 'count', n: this.clients.size });
    });
  }

  private send(c: Client, o: unknown): void {
    if (c.ws.readyState === WebSocket.OPEN) c.ws.send(JSON.stringify(o));
  }
  broadcast(o: unknown): void {
    const s = JSON.stringify(o);
    for (const c of this.clients) if (c.ws.readyState === WebSocket.OPEN) c.ws.send(s);
  }
  // Antwort der Arena an einen Nutzer (alle seine offenen Fenster)
  toKey(key: string, o: unknown): number {
    let n = 0;
    for (const c of this.clients)
      if (c.user && userKey(c.user) === key) {
        this.send(c, o);
        n++;
      }
    return n;
  }
  // Fenster eines Nutzers neu einlesen (nach Namens- oder Farbwechsel, Sperre)
  refreshUser(u: User): void {
    for (const c of this.clients) if (c.user?.id === u.id) c.user = u;
  }

  private add(line: Omit<ChatLine, 'id'>): ChatLine {
    const r = this.db.prepare('INSERT INTO chat (ts, source, user_key, name, color, text, mod) VALUES (?, ?, ?, ?, ?, ?, ?)').run(line.ts, line.src, line.key, line.name, line.color ?? null, line.text, line.mod ? 1 : 0);
    const full = { ...line, id: Number(r.lastInsertRowid) };
    this.history.push(full);
    if (this.history.length > LIMITS.history) this.history.shift();
    this.broadcast({ t: 'msg', m: full });
    return full;
  }

  private fresh(c: Client): User | null {
    if (!c.user) return null;
    const u = this.db.prepare('SELECT * FROM users WHERE id = ?').get(c.user.id) as User | undefined;
    c.user = u ?? null;
    return c.user;
  }

  say(c: Client, raw: string): void {
    const u = this.fresh(c);
    if (!u || !u.age_ok) return this.send(c, { t: 'err', code: 'login' });
    if (u.banned) return this.send(c, { t: 'err', code: 'banned' });
    if (u.muted_until > now()) return this.send(c, { t: 'err', code: 'muted', until: u.muted_until });
    const text = raw.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, LIMITS.len);
    if (!text) return;
    const t = now();
    c.sent = c.sent.filter((x) => t - x < LIMITS.burstWindow);
    const mod = this.isMod(u);
    if (!mod && (c.sent.length >= LIMITS.burst || (c.sent.length && t - c.sent[c.sent.length - 1] < 1000 / LIMITS.perSecond))) return this.send(c, { t: 'err', code: 'slow' });
    c.sent.push(t);
    const key = userKey(u);
    if (text.startsWith('!')) {
      // Befehl: nur an die Arena
      const ok = this.hooks.toArena({ user: key, name: u.name, text, mod, color: u.color });
      if (!ok) this.send(c, { t: 'err', code: 'arena' });
      return;
    }
    if (!mod && LINK.test(text)) return this.send(c, { t: 'err', code: 'link' });
    if (this.blocked(text)) return this.send(c, { t: 'err', code: 'filter' });
    this.add({ ts: t, src: 'web', key, name: u.name, color: u.color, text, mod });
    if (this.hooks.bridgeOn()) this.hooks.toTwitch(`[web] ${u.name}: ${text}`);
  }

  private blocked(text: string): boolean {
    const r = this.db.prepare("SELECT v FROM kv WHERE k = 'filter'").get() as { v: string } | undefined;
    const words: string[] = r ? JSON.parse(r.v) : [];
    const low = text.toLowerCase();
    return words.some((w) => w && low.includes(w.toLowerCase()));
  }

  // aus dem Twitch-Chat
  // (Mods merkt sich die Seite immer; zeigen nur bei eingeschalteter Brücke)
  fromTwitch(login: string, name: string, text: string, mod: boolean, color?: string, show = true): void {
    if (mod) this.db.prepare('INSERT INTO twitch_mods (login, seen) VALUES (?, ?) ON CONFLICT(login) DO UPDATE SET seen = excluded.seen').run(login, now());
    if (!show || text.startsWith('!')) return;
    this.add({ ts: now(), src: 'twitch', key: login, name, color, text: text.slice(0, 500), mod });
  }
  // Ansagen (Ferdl) und Systemmeldungen aus der Arena
  fromArena(src: 'ferdl' | 'sys', text: string, who?: string): void {
    const name = src === 'sys' ? 'Arena' : who === 'resi' ? 'Resi' : 'Ferdl';
    this.add({ ts: now(), src, key: src, name, text: text.slice(0, 400), mod: false });
  }

  private del(c: Client, id: number): void {
    if (!this.isMod(this.fresh(c))) return;
    this.db.prepare('UPDATE chat SET deleted = 1 WHERE id = ?').run(id);
    this.history = this.history.filter((l) => l.id !== id);
    this.broadcast({ t: 'del', id });
  }
  private mute(c: Client, key: string, minutes: number): void {
    if (!this.isMod(this.fresh(c))) return;
    const until = minutes >= 100000 ? 8.64e15 : now() + Math.min(100000, Math.max(1, minutes)) * 60e3;
    const u = (key.startsWith('web:')
      ? this.db.prepare('SELECT * FROM users WHERE name = ? COLLATE NOCASE').get(key.slice(4))
      : this.db.prepare('SELECT * FROM users WHERE twitch_login = ? COLLATE NOCASE').get(key)) as User | undefined;
    if (!u) return this.send(c, { t: 'err', code: 'nouser' });
    this.db.prepare('UPDATE users SET muted_until = ? WHERE id = ?').run(until, u.id);
    // was er zuletzt geschrieben hat, verschwindet
    const gone = this.history.filter((l) => l.key === key).map((l) => l.id);
    if (gone.length) {
      this.db.prepare(`UPDATE chat SET deleted = 1 WHERE id IN (${gone.map(() => '?').join(',')})`).run(...gone);
      this.history = this.history.filter((l) => l.key !== key);
      for (const id of gone) this.broadcast({ t: 'del', id });
    }
    this.send(c, { t: 'sys', code: 'muted', name: u.name, minutes });
  }
}
