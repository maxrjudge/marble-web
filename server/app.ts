// Die Seite als Ganzes: HTTP (Fastify), WebSockets (/ws für Browser, /arena für die Arena), Twitch-Chat, Admin.
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyRequest } from 'fastify';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import nodemailer, { type Transporter } from 'nodemailer';
import { WebSocket, WebSocketServer } from 'ws';
import { authRoutes, nameProblem, userFromCookieHeader, userFromRequest } from './auth.js';
import { ChatHub, modLog, slowSeconds, userByKey, type ArenaChatMsg } from './chat.js';
import { clipVisible, listClips, saveClip, validClipFile } from './clips.js';
import { configProblems, type Config } from './config.js';
import { housekeeping, kvGet, kvSet, now, openDb, userKey, type User } from './db.js';
import { allProfiles, mergeProfiles, profileOf } from './profiles.js';
import { boards, dropBoards, historyOf, levelFor, noteHistory, titlesFor, weekKey, xpForLevel, type RoundCtx } from './stats.js';
import { loadBot, saveBot, TwitchIrc, type Fetch } from './twitch.js';
import { adminPage } from './admin.js';

export const VERSION = '0.3.2';

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
    const key = userKey(u);
    const p = profileOf(db, key);
    const en = (req.query as Record<string, string>).lang === 'en';
    if (!p) return { key, profile: null, history: [] };
    const xp = Number(p.xp) || 0;
    const level = levelFor(xp);
    const b = boards(db);
    const wi = b.woche.findIndex((r) => r.key === key);
    return {
      key,
      profile: p,
      level,
      xpFrom: xpForLevel(level),
      xpTo: xpForLevel(level + 1),
      titles: titlesFor(p, en),
      week: { key: b.week, place: wi >= 0 ? wi + 1 : null, pts: wi >= 0 ? b.woche[wi].pts : 0, of: b.woche.length },
      history: historyOf(db, key),
    };
  });
  // Bestenlisten: Woche (beste 20 Rennen), ewig nach Siegen und nach Erfahrung; dazu der eigene Platz
  app.get('/api/board', async (req) => {
    const b = boards(db);
    const u = userFromRequest(db, req);
    const key = u ? userKey(u) : null;
    const place = (list: typeof b.woche) => {
      const i = key ? list.findIndex((r) => r.key === key) : -1;
      return i >= 0 ? { place: i + 1, row: list[i] } : null;
    };
    const top = (list: typeof b.woche) => list.slice(0, 50).map(({ key: k, ...r }) => ({ ...r, me: k === key }));
    return { week: b.week, now: weekKey(), woche: top(b.woche), siege: top(b.siege), xp: top(b.xp), me: key ? { woche: place(b.woche), siege: place(b.siege), xp: place(b.xp) } : null };
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
  app.post('/arena-api/profiles', async (req, reply) => {
    if (!arenaOk(req)) return reply.code(401).send({ error: 'token' });
    const taken = mergeProfiles(db, req.body, (k, old, neu) => noteHistory(db, k, old, neu, roundCtx()));
    if (taken) dropBoards();
    return { ok: true, taken };
  });

  // --- Clips: die Arena lädt jeden Auto-Clip hoch (Rohdaten, bis 80 MB) ---
  const CLIP_LIMIT = 80 * 1024 * 1024;
  app.addContentTypeParser(['application/octet-stream', 'video/mp4', 'video/webm'], { parseAs: 'buffer', bodyLimit: CLIP_LIMIT }, (_req, body, done) => done(null, body));
  app.addContentTypeParser(/^video\/(mp4|webm);/, { parseAs: 'buffer', bodyLimit: CLIP_LIMIT }, (_req, body, done) => done(null, body));
  app.post('/arena-api/clip', { bodyLimit: CLIP_LIMIT }, async (req, reply) => {
    if (!arenaOk(req)) return reply.code(401).send({ error: 'token' });
    const body = req.body as Buffer;
    if (!Buffer.isBuffer(body) || body.length < 1000) return reply.code(400).send({ error: 'leer' });
    const clip = saveClip(db, c.clipsDir, c.clipsMax, body, req.query as Record<string, string>);
    hub.broadcast({ t: 'clip', clip });
    log(`Clip: ${clip.file}`);
    return { ok: true, file: clip.file };
  });
  app.get('/api/clips', async (req) => {
    const q = req.query as Record<string, string>;
    const u = userFromRequest(db, req);
    return { clips: listClips(db, { limit: Number(q.limit) || 24, before: Number(q.before) || undefined, withHidden: hub.isMod(u) }) };
  });

  // --- Spielplan der Woche (kommt alle 15 s mit dem Zustand der Arena; bleibt gespeichert) ---
  app.get('/api/plan', async () => ({ plan: kvGet(db, 'planWeek'), off: kvGet<boolean>(db, 'planOff') ?? false, at: kvGet<number>(db, 'planAt') ?? 0 }));

  // --- Mods: Langsam-Modus, Wortfilter, Sperren aufheben, Clips ausblenden, Protokoll ---
  const modOnly = (req: FastifyRequest) => {
    const u = userFromRequest(db, req);
    return u && hub.isMod(u) ? u : null;
  };
  app.get('/api/mod', async (req, reply) => {
    if (!modOnly(req)) return reply.code(403).send({ error: 'mod' });
    const t = now();
    const restricted = (db.prepare('SELECT * FROM users WHERE banned = 1 OR muted_until > ? ORDER BY name').all(t) as User[]).map((u) => ({ key: userKey(u), name: u.name, banned: !!u.banned, until: u.banned ? null : u.muted_until }));
    const log = db.prepare('SELECT at, mod_name modName, action, target, detail FROM mod_log ORDER BY id DESC LIMIT 50').all();
    return { slow: slowSeconds(db), filter: kvGet<string[]>(db, 'filter') ?? [], restricted, log };
  });
  app.post('/api/mod/slow', async (req, reply) => {
    const m = modOnly(req);
    if (!m) return reply.code(403).send({ error: 'mod' });
    const sec = Math.max(0, Math.min(120, Math.round(Number((req.body as { seconds?: number })?.seconds) || 0)));
    kvSet(db, 'slow', sec);
    modLog(db, m.name, 'slow', '', sec ? `${sec} s` : 'aus');
    hub.broadcast({ t: 'slow', s: sec });
    return { ok: true, slow: sec };
  });
  app.post('/api/mod/filter', async (req, reply) => {
    const m = modOnly(req);
    if (!m) return reply.code(403).send({ error: 'mod' });
    const raw = (req.body as { words?: unknown })?.words;
    const words = (Array.isArray(raw) ? raw : String(raw ?? '').split(/[\n,]+/)).map((x) => String(x).trim()).filter(Boolean).slice(0, 500);
    kvSet(db, 'filter', words);
    modLog(db, m.name, 'filter', '', `${words.length} Wörter`);
    return { ok: true, filter: words };
  });
  app.post('/api/mod/lift', async (req, reply) => {
    const m = modOnly(req);
    if (!m) return reply.code(403).send({ error: 'mod' });
    const u = userByKey(db, String((req.body as { key?: string })?.key ?? ''));
    if (!u) return reply.code(404).send({ error: 'nouser' });
    db.prepare('UPDATE users SET banned = 0, muted_until = 0 WHERE id = ?').run(u.id);
    modLog(db, m.name, 'lift', u.name);
    return { ok: true };
  });
  app.post('/api/mod/clip', async (req, reply) => {
    const m = modOnly(req);
    if (!m) return reply.code(403).send({ error: 'mod' });
    const b = (req.body ?? {}) as { file?: string; hidden?: boolean };
    const file = String(b.file ?? '');
    if (!validClipFile(file)) return reply.code(400).send({ error: 'file' });
    const r = db.prepare('UPDATE clips SET hidden = ? WHERE file = ?').run(b.hidden ? 1 : 0, file);
    if (!r.changes) return reply.code(404).send({ error: 'file' });
    modLog(db, m.name, b.hidden ? 'clip_hide' : 'clip_show', file);
    return { ok: true };
  });

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

  // --- Clip-Dateien (ausgeblendete nicht) ---
  const clipRoot = resolve(c.clipsDir);
  mkdirSync(clipRoot, { recursive: true });
  await app.register(async (a) => {
    a.addHook('onRequest', async (req, reply) => {
      const f = decodeURIComponent(req.url.split('?')[0].replace(/^\/clips\//, ''));
      if (!validClipFile(f) || !clipVisible(db, f)) return reply.code(404).send({ error: 'not found' });
    });
    await a.register(fastifyStatic, { root: clipRoot, prefix: '/clips/', decorateReply: false, maxAge: '7d', immutable: true });
  });

  // --- Seite (gebaute Dateien) ---
  const dir = resolve(c.publicDir);
  if (existsSync(dir)) {
    await app.register(fastifyStatic, { root: dir, index: ['index.html'] });
    app.setNotFoundHandler((req, reply) => (req.method === 'GET' && !req.url.startsWith('/api') ? reply.sendFile('index.html') : reply.code(404).send({ error: 'not found' })));
  }

  // --- Zustand der Runde (von der Arena, an alle Browser) ---
  let roundState: Record<string, unknown> | null = null;
  const roundCtx = (): RoundCtx | null => {
    const r = roundState;
    if (!r) return null;
    return { round: Number(r.round) || 0, art: String(r.art ?? ''), artName: String(r.artName ?? ''), track: typeof r.track === 'string' ? r.track : null, result: Array.isArray(r.result) ? (r.result as RoundCtx['result']) : null, field: Number(r.starters) || 0 };
  };
  hub.state = () => roundState;

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
          let m: { type?: string; user?: string; kind?: string; text?: string; version?: string; who?: string; s?: unknown };
          try {
            m = JSON.parse(String(raw));
          } catch {
            return;
          }
          if (m.type === 'hello') arenaVersion = String(m.version ?? '');
          else if (m.type === 'feedback' && m.user && m.text) hub.toKey(m.user, { t: 'fb', kind: m.kind ?? 'info', text: String(m.text).slice(0, 300) });
          else if ((m.type === 'ferdl' || m.type === 'sys') && m.text) hub.fromArena(m.type, String(m.text), m.who);
          else if (m.type === 'state' && m.s && typeof m.s === 'object' && (m.s as { v?: number }).v === 1) {
            roundState = m.s as Record<string, unknown>;
            const off = roundState.planOff === true;
            if (Array.isArray(roundState.planWeek) || (off && kvGet<boolean>(db, 'planOff') !== true)) {
              kvSet(db, 'planWeek', off ? null : roundState.planWeek);
              kvSet(db, 'planOff', off);
              kvSet(db, 'planAt', now());
            }
            delete roundState.planWeek;
            hub.broadcast({ t: 'state', s: roundState });
          }
        });
        const ping = setInterval(() => ws.readyState === WebSocket.OPEN && ws.ping(), 20000);
        ws.on('close', () => {
          clearInterval(ping);
          if (arena === ws) {
            arena = null;
            roundState = null;
            hub.broadcast({ t: 'arena', on: false });
            hub.broadcast({ t: 'state', s: null });
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
