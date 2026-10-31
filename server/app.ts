// Die Seite als Ganzes: HTTP (Fastify), WebSockets (/ws für Browser, /arena für die Arena), Twitch-Chat, Admin.
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyRequest } from 'fastify';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import nodemailer, { type Transporter } from 'nodemailer';
import { WebSocket, WebSocketServer } from 'ws';
import { authRoutes, nameProblem, userFromCookieHeader, userFromRequest } from './auth.js';
import { ChatHub, type ArenaChatMsg } from './chat.js';
import { configProblems, type Config } from './config.js';
import { housekeeping, kvGet, kvSet, now, openDb, userKey, type User } from './db.js';
import { allProfiles, mergeProfiles, profileOf } from './profiles.js';
import { loadBot, saveBot, TwitchIrc, type Fetch } from './twitch.js';
import { adminPage } from './admin.js';

export const VERSION = '0.1.0';

export interface AppOpts {
  mailer?: Transporter | null; // Tests: eigener Transport
  fetch?: Fetch;
  twitchIrcUrl?: string | null; // null = kein Twitch-Chat (Tests)
  log?: (s: string) => void;
}

const COLOR = /^#[0-9a-fA-F]{6}$/;
const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export async function buildApp(c: Config, o: AppOpts = {}) {
  const log = o.log ?? ((s: string) => console.log(`[marble-web] ${s}`));
  const db = openDb(c.dbPath);
  const app = Fastify({ logger: false, trustProxy: true, bodyLimit: 2 * 1024 * 1024 });
  await app.register(cookie);

  let mailer: Transporter | null | undefined = o.mailer;
  const getMailer = () => {
    if (mailer !== undefined) return mailer;
    mailer = c.smtp.host ? nodemailer.createTransport({ host: c.smtp.host, port: c.smtp.port, secure: c.smtp.secure, auth: c.smtp.user ? { user: c.smtp.user, pass: c.smtp.pass } : undefined }) : null;
    return mailer;
  };

  // --- Arena-Verbindung ---
  let arena: WebSocket | null = null;
  let arenaSince = 0;
  let arenaVersion = '';
  const toArena = (m: ArenaChatMsg) => {
    if (!arena || arena.readyState !== WebSocket.OPEN) return false;
    arena.send(JSON.stringify({ type: 'chat', msg: m }));
    return true;
  };
  const bridgeOn = () => kvGet<boolean>(db, 'bridge') !== false;

  // --- Twitch-Chat ---
  let irc: TwitchIrc | null = null;
  const hub = new ChatHub(db, { toArena, toTwitch: (t) => irc?.say(t) ?? false, bridgeOn });
  if (o.twitchIrcUrl !== null && c.twitch.channel) {
    irc = new TwitchIrc(c, db, (m) => hub.fromTwitch(m.login, m.name, m.text, m.mod, m.color, bridgeOn()), log, o.twitchIrcUrl ?? undefined, o.fetch);
    void irc.connect();
  }

  // --- Schutz: Formulare und API nur von der eigenen Seite (Origin) ---
  const originOf = () => new URL(c.baseUrl).origin;
  app.addHook('onRequest', async (req, reply) => {
    // /admin auch: der Browser schickt Basic-Auth sonst bei einem fremden Formular mit
    if (req.method === 'POST' && !req.url.startsWith('/arena-api/')) {
      const o2 = req.headers.origin;
      if (o2 && o2 !== originOf()) return reply.code(403).send({ error: 'origin' });
      if (!o2 && !String(req.headers.referer ?? '').startsWith(originOf())) return reply.code(403).send({ error: 'origin' });
    }
  });
  app.addHook('onSend', async (_req, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    // nie no-referrer: das LSM-Embed prüft die einbettende Seite über den Referer
    reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    if (!reply.hasHeader('Content-Security-Policy') && !_req.url.startsWith('/arena-api/')) {
      const embed = (() => {
        try {
          return new URL(c.lsmEmbedBase).origin;
        } catch {
          return '';
        }
      })();
      reply.header(
        'Content-Security-Policy',
        `default-src 'self'; frame-src ${embed || "'none'"}; img-src 'self' data: https://static-cdn.jtvnw.net; style-src 'self' 'unsafe-inline'; connect-src 'self' ${originOf().replace(/^http/, 'ws')}; frame-ancestors 'none'; base-uri 'self'; form-action 'self' https://id.twitch.tv`,
      );
    }
    return payload;
  });

  const isAdmin = (req: FastifyRequest) => {
    if (c.adminPassword.length < 10) return false;
    const m = String(req.headers.authorization ?? '').match(/^Basic (.+)$/);
    if (!m) return false;
    const [u, ...p] = Buffer.from(m[1], 'base64').toString().split(':');
    return u === 'admin' && same(p.join(':'), c.adminPassword);
  };

  authRoutes(app, { db, c, mailer: getMailer, fetch: o.fetch, isAdmin, onBot: () => irc?.reconnect(), log });

  // --- API für die Seite ---
  const pub = (u: User) => ({ name: u.name, color: u.color, key: userKey(u), twitch: u.twitch_login, email: u.email ? u.email.replace(/^(.).*?@/, '$1…@') : null, mod: hub.isMod(u), setup: !u.age_ok });
  app.get('/api/config', async () => ({ version: VERSION, embed: c.lsmStreamKey ? `${c.lsmEmbedBase.replace(/\/?$/, '/')}${encodeURIComponent(c.lsmStreamKey)}/` : null, embedOrigin: new URL(c.lsmEmbedBase).origin, channel: c.twitch.channel, twitchLogin: !!c.twitch.clientId, mailLogin: !!c.smtp.host }));
  app.get('/api/me', async (req) => {
    const u = userFromRequest(db, req);
    return { user: u ? pub(u) : null };
  });
  app.post('/api/setup', async (req, reply) => {
    const u = userFromRequest(db, req);
    if (!u) return reply.code(401).send({ error: 'login' });
    const b = (req.body ?? {}) as { name?: string; color?: string; age?: boolean };
    const name = String(b.name ?? u.name).trim();
    const p = nameProblem(db, name, u.id);
    if (p) return reply.code(400).send({ error: p });
    if (b.color !== undefined && !COLOR.test(String(b.color))) return reply.code(400).send({ error: 'color' });
    if (!u.age_ok && b.age !== true) return reply.code(400).send({ error: 'age' });
    // Name nur ändern, solange die Arena ihn nicht als Schlüssel kennt (web:<name>) – sonst ginge der Spielstand verloren
    if (name !== u.name && !u.twitch_login && u.age_ok && profileOf(db, userKey(u))) return reply.code(400).send({ error: 'name_locked' });
    db.prepare('UPDATE users SET name = ?, color = ?, age_ok = 1 WHERE id = ?').run(name, b.color ?? u.color, u.id);
    const nu = db.prepare('SELECT * FROM users WHERE id = ?').get(u.id) as User;
    hub.refreshUser(nu);
    return { user: pub(nu) };
  });
  app.get('/api/profile', async (req, reply) => {
    const u = userFromRequest(db, req);
    if (!u) return reply.code(401).send({ error: 'login' });
    return { key: userKey(u), profile: profileOf(db, userKey(u)) };
  });
  app.get('/api/account/data', async (req, reply) => {
    const u = userFromRequest(db, req);
    if (!u) return reply.code(401).send({ error: 'login' });
    const key = userKey(u);
    const chat = db.prepare('SELECT ts, text FROM chat WHERE user_key = ? AND source = ? ORDER BY ts').all(key, 'web');
    reply.header('Content-Disposition', 'attachment; filename="marblearena-meine-daten.json"');
    return { konto: { name: u.name, farbe: u.color, email: u.email, twitch: u.twitch_login, seit: new Date(u.created).toISOString() }, spielstand: profileOf(db, key), chat };
  });
  app.post('/api/account/delete', async (req, reply) => {
    const u = userFromRequest(db, req);
    if (!u) return reply.code(401).send({ error: 'login' });
    const key = userKey(u);
    db.transaction(() => {
      db.prepare('DELETE FROM chat WHERE user_key = ? AND source = ?').run(key, 'web');
      if (!u.twitch_login) db.prepare('DELETE FROM profiles WHERE user_key = ?').run(key);
      db.prepare('DELETE FROM users WHERE id = ?').run(u.id);
    })();
    reply.clearCookie('ma_s', { path: '/' });
    return { ok: true };
  });

  // --- Arena: Profile (Protokoll wie der Hilfsdienst) ---
  // (die Arena läuft im Browser von vMix/OBS, von file:// oder localhost: CORS frei, geschützt durch das Token)
  app.addHook('onRequest', async (req, reply) => {
    if (!req.url.startsWith('/arena-api/')) return;
    reply.header('Access-Control-Allow-Origin', '*');
    reply.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    reply.header('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return reply.code(204).send();
  });
  const arenaOk = (req: FastifyRequest) => c.arenaToken.length >= 16 && same(String((req.query as Record<string, string>).token ?? ''), c.arenaToken);
  app.get('/arena-api/profiles', async (req, reply) => (arenaOk(req) ? allProfiles(db) : reply.code(401).send({ error: 'token' })));
  app.post('/arena-api/profiles', async (req, reply) => (arenaOk(req) ? { ok: true, taken: mergeProfiles(db, req.body) } : reply.code(401).send({ error: 'token' })));

  // --- Admin ---
  app.register(async (a) => {
    await a.register((await import('@fastify/formbody')).default);
    a.addHook('onRequest', async (req, reply) => {
      if (!isAdmin(req)) return reply.code(401).header('WWW-Authenticate', 'Basic realm="MarbleArena Admin"').send('Admin');
    });
    const status = () => ({
      version: VERSION,
      problems: configProblems(c),
      arena: arena ? { since: arenaSince, version: arenaVersion } : null,
      twitch: irc ? { status: irc.status, write: irc.canWrite, bot: loadBot(db)?.login ?? null } : null,
      bridge: bridgeOn(),
      viewers: hub.count,
      users: (db.prepare('SELECT COUNT(*) n FROM users').get() as { n: number }).n,
      mods: (db.prepare('SELECT name FROM users WHERE is_mod = 1 ORDER BY name').all() as { name: string }[]).map((r) => r.name),
      twitchMods: (db.prepare('SELECT login FROM twitch_mods ORDER BY login').all() as { login: string }[]).map((r) => r.login),
      filter: kvGet<string[]>(db, 'filter') ?? [],
      namesBlocked: kvGet<string[]>(db, 'namesBlocked') ?? [],
    });
    a.get('/admin', async (_req, reply) => reply.type('text/html; charset=utf-8').send(adminPage(status())));
    a.get('/admin/status', async () => status());
    a.post('/admin/mod', async (req, reply) => {
      const b = req.body as { name?: string; on?: string };
      db.prepare('UPDATE users SET is_mod = ? WHERE name = ? COLLATE NOCASE').run(b.on === '1' ? 1 : 0, String(b.name ?? ''));
      return reply.redirect('/admin');
    });
    a.post('/admin/lists', async (req, reply) => {
      const b = req.body as { filter?: string; namesBlocked?: string };
      const list = (s?: string) => String(s ?? '').split(/[\n,]+/).map((x) => x.trim()).filter(Boolean).slice(0, 500);
      kvSet(db, 'filter', list(b.filter));
      kvSet(db, 'namesBlocked', list(b.namesBlocked));
      return reply.redirect('/admin');
    });
    a.post('/admin/bridge', async (req, reply) => {
      kvSet(db, 'bridge', (req.body as { on?: string }).on === '1');
      return reply.redirect('/admin');
    });
    a.post('/admin/bot/disconnect', async (_req, reply) => {
      saveBot(db, null);
      irc?.reconnect();
      return reply.redirect('/admin');
    });
  });

  // --- Seite (gebaute Dateien) ---
  const dir = resolve(c.publicDir);
  if (existsSync(dir)) {
    await app.register(fastifyStatic, { root: dir, index: ['index.html'] });
    app.setNotFoundHandler((req, reply) => (req.method === 'GET' && !req.url.startsWith('/api') ? reply.sendFile('index.html') : reply.code(404).send({ error: 'not found' })));
  }

  // --- WebSockets ---
  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
  app.server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://x');
    if (url.pathname === '/ws') {
      if (req.headers.origin && req.headers.origin !== originOf()) return socket.destroy();
      wss.handleUpgrade(req, socket, head, (ws) => hub.attach(ws, userFromCookieHeader(db, req.headers.cookie), !!arena));
    } else if (url.pathname === '/arena') {
      if (!(c.arenaToken.length >= 16 && same(url.searchParams.get('token') ?? '', c.arenaToken))) return socket.destroy();
      wss.handleUpgrade(req, socket, head, (ws) => {
        // die neueste Verbindung gilt (Neustart der Arena)
        if (arena && arena !== ws) arena.close(4000, 'ersetzt');
        arena = ws;
        arenaSince = now();
        arenaVersion = '';
        hub.broadcast({ t: 'arena', on: true });
        log('Arena verbunden');
        ws.on('message', (raw) => {
          let m: { type?: string; user?: string; kind?: string; text?: string; version?: string; who?: string };
          try {
            m = JSON.parse(String(raw));
          } catch {
            return;
          }
          if (m.type === 'hello') arenaVersion = String(m.version ?? '');
          else if (m.type === 'feedback' && m.user && m.text) hub.toKey(m.user, { t: 'fb', kind: m.kind ?? 'info', text: String(m.text).slice(0, 300) });
          else if ((m.type === 'ferdl' || m.type === 'sys') && m.text) hub.fromArena(m.type, String(m.text), m.who);
        });
        const ping = setInterval(() => ws.readyState === WebSocket.OPEN && ws.ping(), 20000);
        ws.on('close', () => {
          clearInterval(ping);
          if (arena === ws) {
            arena = null;
            hub.broadcast({ t: 'arena', on: false });
            log('Arena getrennt');
          }
        });
      });
    } else socket.destroy();
  });

  const hk = setInterval(() => housekeeping(db), 3600e3);
  housekeeping(db);
  app.addHook('onClose', async () => {
    clearInterval(hk);
    irc?.stop();
    for (const ws of wss.clients) ws.terminate();
    db.close();
  });
  return { app, db, hub, get irc() { return irc; }, get arenaConnected() { return !!arena; } };
}
