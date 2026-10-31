// Anmeldung: mit Twitch (OAuth, nur Identität) oder per E-Mail-Link, ohne Passwort. Sitzung = zufällige ID im
// httpOnly-Cookie, in der Datenbank nur als Hash. Neue Konten wählen beim ersten Mal Namen und Farbe und bestätigen,
// dass sie mindestens 14 sind.
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Transporter } from 'nodemailer';
import type { Config } from './config.js';
import { now, sha256, token, type DB, type User } from './db.js';
import { authorizeUrl, exchangeCode, getTwitchUser, saveBot, type Fetch } from './twitch.js';

export const SESSION_COOKIE = 'ma_s';
const SESSION_DAYS = 30;
const MAGIC_MINUTES = 15;
export const NAME_RE = /^[\p{L}\p{N}_.-]{3,20}$/u;
const RESERVED = ['ferdl', 'resi', 'arena', 'admin', 'mod', 'moderator', 'system', 'marblearena', 'murmelarena'];

export function userFromRequest(db: DB, req: FastifyRequest): User | null {
  const sid = req.cookies?.[SESSION_COOKIE];
  if (!sid) return null;
  const r = db.prepare('SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id_hash = ? AND s.expires > ?').get(sha256(sid), now()) as User | undefined;
  return r ?? null;
}
export function userFromCookieHeader(db: DB, header: string | undefined): User | null {
  const m = (header ?? '').match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`));
  if (!m) return null;
  const r = db.prepare('SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id_hash = ? AND s.expires > ?').get(sha256(decodeURIComponent(m[1])), now()) as User | undefined;
  return r ?? null;
}

function startSession(db: DB, c: Config, reply: FastifyReply, userId: number): void {
  const sid = token();
  db.prepare('INSERT INTO sessions (id_hash, user_id, expires) VALUES (?, ?, ?)').run(sha256(sid), userId, now() + SESSION_DAYS * 86400e3);
  reply.setCookie(SESSION_COOKIE, sid, { path: '/', httpOnly: true, sameSite: 'lax', secure: c.secureCookies, maxAge: SESSION_DAYS * 86400 });
}

export function nameProblem(db: DB, name: string, selfId?: number): string | null {
  if (!NAME_RE.test(name)) return 'name_format';
  if (RESERVED.includes(name.toLowerCase())) return 'name_reserved';
  const other = db.prepare('SELECT id FROM users WHERE name = ? COLLATE NOCASE').get(name) as { id: number } | undefined;
  if (other && other.id !== selfId) return 'name_taken';
  const blocked = db.prepare("SELECT v FROM kv WHERE k = 'namesBlocked'").get() as { v: string } | undefined;
  if (blocked && (JSON.parse(blocked.v) as string[]).some((w) => name.toLowerCase().includes(w.toLowerCase()))) return 'name_blocked';
  return null;
}
function freeName(db: DB, wanted: string): string {
  let base = wanted.replace(/[^\p{L}\p{N}_.-]/gu, '').slice(0, 16);
  if (base.length < 3) base = `gast${base}`;
  if (!nameProblem(db, base)) return base;
  for (let i = 2; i < 1000; i++) if (!nameProblem(db, `${base}${i}`)) return `${base}${i}`;
  return `gast${token(4)}`;
}

// einfache Bremse je Schlüssel (E-Mail, IP)
const hits = new Map<string, number[]>();
export function tooMany(key: string, max: number, windowMs: number): boolean {
  const t = now();
  const l = (hits.get(key) ?? []).filter((x) => t - x < windowMs);
  l.push(t);
  hits.set(key, l);
  return l.length > max;
}

export interface AuthDeps {
  db: DB;
  c: Config;
  mailer: () => Transporter | null;
  fetch?: Fetch;
  isAdmin: (req: FastifyRequest) => boolean;
  onBot: () => void; // Bot-Zugang neu: Twitch-Chat neu verbinden
  log: (s: string) => void;
}

export function authRoutes(app: FastifyInstance, d: AuthDeps): void {
  const { db, c } = d;

  // Twitch: Start (ohne code) und Rückkehr (mit code) unter derselben Adresse, die bei Twitch eingetragen ist
  app.get('/auth/twitch', async (req, reply) => {
    const q = req.query as Record<string, string | undefined>;
    if (!c.twitch.clientId) return reply.code(503).send('Twitch-Anmeldung ist nicht eingerichtet');
    if (!q.code && !q.error) {
      const bot = q.bot === '1';
      if (bot && !d.isAdmin(req)) return reply.code(401).header('WWW-Authenticate', 'Basic realm="MarbleArena Admin"').send('Admin');
      const state = token(18);
      reply.setCookie('ma_tw', `${state}.${bot ? 'bot' : 'login'}`, { path: '/auth', httpOnly: true, sameSite: 'lax', secure: c.secureCookies, maxAge: 600 });
      return reply.redirect(authorizeUrl(c, state, bot ? 'chat:read chat:edit' : ''));
    }
    const [state, purpose] = (req.cookies.ma_tw ?? '').split('.');
    reply.clearCookie('ma_tw', { path: '/auth' });
    if (q.error || !q.code || !state || q.state !== state) return reply.redirect('/?fehler=twitch');
    try {
      const t = await exchangeCode(c, q.code, d.fetch);
      const tu = await getTwitchUser(c, t.access_token, d.fetch);
      if (purpose === 'bot') {
        saveBot(db, { login: tu.login.toLowerCase(), access: t.access_token, refresh: t.refresh_token ?? '', expires: now() + (t.expires_in ?? 14400) * 1000 });
        d.log(`Bot-Zugang verbunden: ${tu.login}`);
        d.onBot();
        return reply.redirect('/admin?bot=ok');
      }
      // angemeldet → Twitch verknüpfen; sonst anmelden oder neues Konto
      const me = userFromRequest(db, req);
      const owner = db.prepare('SELECT * FROM users WHERE twitch_id = ?').get(tu.id) as User | undefined;
      if (me) {
        if (owner && owner.id !== me.id) return reply.redirect('/#konto?fehler=twitch_vergeben');
        db.prepare('UPDATE users SET twitch_id = ?, twitch_login = ? WHERE id = ?').run(tu.id, tu.login.toLowerCase(), me.id);
        return reply.redirect('/#konto');
      }
      let u = owner;
      if (u) db.prepare('UPDATE users SET twitch_login = ? WHERE id = ?').run(tu.login.toLowerCase(), u.id);
      else {
        const r = db.prepare('INSERT INTO users (name, twitch_id, twitch_login, created) VALUES (?, ?, ?, ?)').run(freeName(db, tu.display_name || tu.login), tu.id, tu.login.toLowerCase(), now());
        u = db.prepare('SELECT * FROM users WHERE id = ?').get(r.lastInsertRowid) as User;
      }
      if (u.banned) return reply.redirect('/?fehler=gesperrt');
      startSession(db, c, reply, u.id);
      return reply.redirect(u.age_ok ? '/' : '/#willkommen');
    } catch (e) {
      d.log(`Twitch-Anmeldung: ${String(e)}`);
      return reply.redirect('/?fehler=twitch');
    }
  });

  // E-Mail-Link anfordern
  app.post('/auth/mail', async (req, reply) => {
    const b = (req.body ?? {}) as { email?: string; lang?: string };
    const email = String(b.email ?? '').trim().toLowerCase();
    if (!/^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,}$/i.test(email)) return reply.code(400).send({ error: 'email' });
    const m = d.mailer();
    if (!m) return reply.code(503).send({ error: 'nomail' });
    if (tooMany(`mail:${email}`, 3, 10 * 60e3) || tooMany(`ip:${req.ip}`, 10, 10 * 60e3)) return reply.code(429).send({ error: 'slow' });
    const t = token();
    db.prepare('INSERT INTO magic (token_hash, email, expires, created) VALUES (?, ?, ?, ?)').run(sha256(t), email, now() + MAGIC_MINUTES * 60e3, now());
    const link = `${c.baseUrl}/auth/mail?t=${t}`;
    const en = b.lang === 'en';
    try {
      await m.sendMail({
        from: c.smtp.from,
        to: email,
        subject: en ? 'Your MarbleArena login link' : 'Dein Anmelde-Link für die MarbleArena',
        text: en
          ? `Click to log in to the MarbleArena (valid for ${MAGIC_MINUTES} minutes):\n\n${link}\n\nIf you did not ask for this, just ignore this mail.`
          : `Klick, um dich bei der MarbleArena anzumelden (gilt ${MAGIC_MINUTES} Minuten):\n\n${link}\n\nWenn du das nicht angefordert hast, ignorier die Mail einfach.`,
      });
    } catch (e) {
      d.log(`Mail an ${email.replace(/^(.).*@/, '$1…@')}: ${String(e)}`);
      return reply.code(502).send({ error: 'send' });
    }
    return { ok: true };
  });

  // E-Mail-Link einlösen
  app.get('/auth/mail', async (req, reply) => {
    const t = String((req.query as Record<string, string>).t ?? '');
    const row = db.prepare('SELECT * FROM magic WHERE token_hash = ?').get(sha256(t)) as { email: string; expires: number; used: number } | undefined;
    if (!row || row.used || row.expires < now()) return reply.redirect('/?fehler=link');
    db.prepare('UPDATE magic SET used = 1 WHERE token_hash = ?').run(sha256(t));
    let u = db.prepare('SELECT * FROM users WHERE email = ?').get(row.email) as User | undefined;
    const me = userFromRequest(db, req);
    if (!u && me && !me.email) {
      // angemeldet (z. B. über Twitch) und noch ohne Adresse: hinzufügen
      db.prepare('UPDATE users SET email = ? WHERE id = ?').run(row.email, me.id);
      return reply.redirect('/#konto');
    }
    if (!u) {
      const r = db.prepare('INSERT INTO users (name, email, created) VALUES (?, ?, ?)').run(freeName(db, row.email.split('@')[0]), row.email, now());
      u = db.prepare('SELECT * FROM users WHERE id = ?').get(r.lastInsertRowid) as User;
    }
    if (u.banned) return reply.redirect('/?fehler=gesperrt');
    startSession(db, c, reply, u.id);
    return reply.redirect(u.age_ok ? '/' : '/#willkommen');
  });

  app.post('/auth/logout', async (req, reply) => {
    const sid = req.cookies?.[SESSION_COOKIE];
    if (sid) db.prepare('DELETE FROM sessions WHERE id_hash = ?').run(sha256(sid));
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });
}
