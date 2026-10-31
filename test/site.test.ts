// Ende-zu-Ende gegen einen echten Server auf einem freien Port: Anmeldung (E-Mail, Twitch), Schutz, Chat mit
// Twitch-Brücke (falscher IRC-Server), Befehle an die Arena und Antworten zurück, Profile, Mods, Admin, Konto.
import { strict as assert } from 'node:assert';
import { after, before, test } from 'node:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import nodemailer from 'nodemailer';
import { WebSocket, WebSocketServer } from 'ws';
import { buildApp } from '../server/app.ts';
import { loadConfig } from '../server/config.ts';
import { openDb } from '../server/db.ts';
import { parseIrc, saveBot } from '../server/twitch.ts';

const TOKEN = 'arena-token-0123456789';
let base = '';
let origin = '';
let site: Awaited<ReturnType<typeof buildApp>>;
const mails: { to: string; text: string }[] = [];
let irc: WebSocketServer;
const ircLines: string[] = [];
let ircClient: WebSocket | null = null;

// Twitch-API, nachgebaut
const twitchFetch = (async (url: string | URL, init?: RequestInit) => {
  const u = String(url);
  if (u.startsWith('https://id.twitch.tv/oauth2/token')) {
    const body = new URLSearchParams(String(init?.body));
    return new Response(JSON.stringify({ access_token: `acc-${body.get('code')}`, refresh_token: 'ref', expires_in: 14400 }), { status: 200 });
  }
  if (u.startsWith('https://api.twitch.tv/helix/users')) {
    const who = String((init?.headers as Record<string, string>).Authorization).includes('acc-bot') ? { id: '999', login: 'arenabot', display_name: 'ArenaBot' } : { id: '42', login: 'sepp_tv', display_name: 'Sepp_TV' };
    return new Response(JSON.stringify({ data: [who] }), { status: 200 });
  }
  return new Response('nope', { status: 404 });
}) as typeof fetch;

function cookieJar() {
  const jar = new Map<string, string>();
  const f = async (path: string, init: RequestInit & { json?: unknown } = {}) => {
    const headers: Record<string, string> = { ...(init.headers as Record<string, string>) };
    if (jar.size) headers.cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
    if (init.json !== undefined) {
      headers['content-type'] = 'application/json';
      headers.origin ??= origin;
    }
    const r = await fetch(`${base}${path}`, { ...init, headers, body: init.json !== undefined ? JSON.stringify(init.json) : init.body, redirect: 'manual' });
    for (const c of r.headers.getSetCookie()) {
      const [kv] = c.split(';');
      const [k, v] = kv.split('=');
      if (/Max-Age=0|Expires=Thu, 01 Jan 1970/.test(c) || v === '') jar.delete(k);
      else jar.set(k, v);
    }
    return r;
  };
  return { f, jar };
}
function wsClient(jar?: Map<string, string>, path = '/ws') {
  const headers: Record<string, string> = { origin };
  if (jar?.size) headers.cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
  const ws = new WebSocket(`${base.replace('http', 'ws')}${path}`, { headers });
  const got: Record<string, unknown>[] = [];
  ws.on('message', (d) => got.push(JSON.parse(String(d))));
  const opened = new Promise<void>((res, rej) => {
    ws.on('open', () => res());
    ws.on('error', rej);
  });
  const waitFor = async (pred: (m: Record<string, unknown>) => boolean, ms = 3000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      const m = got.find(pred);
      if (m) return m;
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error(`nicht bekommen: ${JSON.stringify(got.slice(-5))}`);
  };
  return { ws, got, opened, waitFor };
}
async function mailLogin(email: string, name: string) {
  const s = cookieJar();
  const r = await s.f('/auth/mail', { method: 'POST', json: { email } });
  assert.equal(r.status, 200);
  const link = mails.filter((m) => m.to === email).pop()!.text.match(/https?:\/\/\S+/)![0];
  const v = await s.f(new URL(link).pathname + new URL(link).search);
  assert.equal(v.status, 302);
  assert.equal(v.headers.get('location'), '/#willkommen');
  const st = await s.f('/api/setup', { method: 'POST', json: { name, color: '#3b82f6', age: true } });
  assert.equal(st.status, 200, await st.clone().text());
  return s;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

before(async () => {
  irc = new WebSocketServer({ port: 0 });
  await new Promise((r) => irc.once('listening', r));
  irc.on('connection', (ws) => {
    ircClient = ws;
    ws.on('message', (d) => {
      for (const line of String(d).split('\r\n')) {
        if (!line) continue;
        ircLines.push(line);
        if (line.startsWith('JOIN')) ws.send(':tmi.twitch.tv 366 arenabot #marblearena :End of /NAMES list\r\n');
      }
    });
  });
  const dir = mkdtempSync(join(tmpdir(), 'mw-'));
  const dbPath = join(dir, 't.db');
  // Bot-Zugang vorab (schreibt in den Twitch-Chat)
  const db0 = openDb(dbPath);
  saveBot(db0, { login: 'arenabot', access: 'acc-bot', refresh: 'ref', expires: Date.now() + 3600e3 });
  db0.close();
  const c = loadConfig({ port: 0, baseUrl: 'http://127.0.0.1:1', dbPath, publicDir: join(dir, 'leer'), lsmStreamKey: 'abc123', arenaToken: TOKEN, adminPassword: 'geheim-admin-1', twitch: { clientId: 'cid', clientSecret: 'sec', channel: 'marblearena' }, smtp: { host: 'x', port: 1, user: '', pass: '', from: 'a@b.at', secure: false }, secureCookies: false });
  const transport = nodemailer.createTransport({ jsonTransport: true });
  const orig = transport.sendMail.bind(transport);
  transport.sendMail = (async (m: { to: string; text: string }) => {
    mails.push({ to: m.to, text: m.text });
    return orig(m as never);
  }) as never;
  site = await buildApp(c, { mailer: transport, fetch: twitchFetch, twitchIrcUrl: `ws://127.0.0.1:${(irc.address() as { port: number }).port}`, log: () => {} });
  await site.app.listen({ port: 0, host: '127.0.0.1' });
  const port = (site.app.server.address() as { port: number }).port;
  base = `http://127.0.0.1:${port}`;
  origin = base;
  // Basis-URL nachziehen (Links in Mails, Origin-Prüfung)
  (c as { baseUrl: string }).baseUrl = base;
  for (let i = 0; i < 100 && !site.irc?.canWrite; i++) await sleep(20);
});
after(async () => {
  await site.app.close();
  irc.close();
});

test('IRC-Zeilen lesen', () => {
  const m = parseIrc('@badges=moderator/1;color=#FF0000;display-name=Sepp_TV;mod=1;id=x1 :sepp_tv!sepp_tv@sepp_tv.tmi.twitch.tv PRIVMSG #marblearena :Servus beinand');
  assert.deepEqual(m, { login: 'sepp_tv', name: 'Sepp_TV', color: '#FF0000', text: 'Servus beinand', mod: true, id: 'x1' });
  assert.equal(parseIrc(':tmi.twitch.tv PING'), null);
});

test('Einstellungen für die Seite: Embed-Adresse aus dem Stream-Key', async () => {
  const r = await (await fetch(`${base}/api/config`)).json();
  assert.equal(r.embed, 'https://io.maxr.at/embed/live/abc123/');
  assert.equal(r.embedOrigin, 'https://io.maxr.at');
});

test('POST nur von der eigenen Seite (Origin)', async () => {
  const r = await fetch(`${base}/auth/mail`, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://boese.example' }, body: '{"email":"a@b.at"}' });
  assert.equal(r.status, 403);
});

test('E-Mail-Anmeldung: Link, einmalig, Name, Alter', async () => {
  const s = cookieJar();
  await s.f('/auth/mail', { method: 'POST', json: { email: 'Lisi@Beispiel.at' } });
  const link = mails.pop()!.text.match(/https?:\/\/\S+/)![0];
  const u = new URL(link);
  const v = await s.f(u.pathname + u.search);
  assert.equal(v.headers.get('location'), '/#willkommen');
  const again = await cookieJar().f(u.pathname + u.search);
  assert.equal(again.headers.get('location'), '/?fehler=link', 'Link nur einmal');
  const me = await (await s.f('/api/me')).json();
  assert.equal(me.user.setup, true);
  assert.equal((await s.f('/api/setup', { method: 'POST', json: { name: 'Lisi' } })).status, 400, 'ohne Alter');
  assert.equal((await s.f('/api/setup', { method: 'POST', json: { name: 'x', age: true } })).status, 400, 'Name zu kurz');
  assert.equal((await s.f('/api/setup', { method: 'POST', json: { name: 'Ferdl', age: true } })).status, 400, 'reserviert');
  const ok = await (await s.f('/api/setup', { method: 'POST', json: { name: 'Lisi', color: '#ff5fb0', age: true } })).json();
  assert.equal(ok.user.key, 'web:lisi');
});

test('Twitch-Anmeldung: Status-Prüfung, Konto mit Twitch-Login', async () => {
  const s = cookieJar();
  const start = await s.f('/auth/twitch');
  assert.equal(start.status, 302);
  const state = new URL(start.headers.get('location')!).searchParams.get('state')!;
  const bad = await s.f(`/auth/twitch?code=c1&state=falsch`);
  assert.equal(bad.headers.get('location'), '/?fehler=twitch');
  await s.f('/auth/twitch');
  const st2 = [...s.jar].find(([k]) => k === 'ma_tw')![1].split('.')[0];
  const cb = await s.f(`/auth/twitch?code=c1&state=${st2}`);
  assert.equal(cb.headers.get('location'), '/#willkommen');
  void state;
  await s.f('/api/setup', { method: 'POST', json: { name: 'Sepp_TV', age: true } });
  const me = await (await s.f('/api/me')).json();
  assert.equal(me.user.key, 'sepp_tv', 'gleicher Schlüssel wie im Twitch-Chat');
  assert.equal(me.user.twitch, 'sepp_tv');
});

test('Chat: Nachricht an alle und über den Bot nach Twitch; Befehl an die Arena, Antwort nur beim Absender', async () => {
  const lisi = await mailLogin('lisi2@beispiel.at', 'Lisi2');
  const a = wsClient(lisi.jar);
  const b = wsClient();
  await Promise.all([a.opened, b.opened]);
  await a.waitFor((m) => m.t === 'hello');
  a.ws.send(JSON.stringify({ t: 'say', text: 'Servus miteinand' }));
  await b.waitFor((m) => m.t === 'msg' && (m.m as { text: string }).text === 'Servus miteinand');
  for (let i = 0; i < 50 && !ircLines.some((l) => l.includes('[web] Lisi2: Servus miteinand')); i++) await sleep(20);
  assert.ok(ircLines.some((l) => l === 'PRIVMSG #marblearena :[web] Lisi2: Servus miteinand'), 'Brücke nach Twitch');

  // Befehl ohne Arena
  await sleep(1100);
  a.ws.send(JSON.stringify({ t: 'say', text: '!join' }));
  await a.waitFor((m) => m.t === 'err' && m.code === 'arena');

  // Arena verbindet sich
  const arena = wsClient(undefined, `/arena?token=${TOKEN}`);
  await arena.opened;
  await a.waitFor((m) => m.t === 'arena' && m.on === true);
  await sleep(1100);
  a.ws.send(JSON.stringify({ t: 'say', text: '!muenze 3' }));
  const cmd = (await arena.waitFor((m) => m.type === 'chat')) as { msg: { user: string; name: string; text: string } };
  assert.deepEqual([cmd.msg.user, cmd.msg.name, cmd.msg.text], ['web:lisi2', 'Lisi2', '!muenze 3']);
  assert.ok(!b.got.some((m) => m.t === 'msg' && (m.m as { text: string }).text.startsWith('!')), 'Befehle nicht im Chat');
  arena.ws.send(JSON.stringify({ type: 'feedback', user: 'web:lisi2', kind: 'ok', text: 'wirft eine Münze in Bahn 3 (1/3)' }));
  await a.waitFor((m) => m.t === 'fb' && m.text === 'wirft eine Münze in Bahn 3 (1/3)');
  await sleep(200);
  assert.ok(!b.got.some((m) => m.t === 'fb'), 'Antwort nur beim Absender');
  // Ferdl im Chat
  arena.ws.send(JSON.stringify({ type: 'ferdl', who: 'resi', text: 'Und los geht’s!' }));
  await b.waitFor((m) => m.t === 'msg' && (m.m as { src: string; name: string }).src === 'ferdl' && (m.m as { name: string }).name === 'Resi');
  // eine zweite Arena ersetzt die erste
  const closed = new Promise<number>((r) => arena.ws.on('close', (code) => r(code)));
  const arena2 = wsClient(undefined, `/arena?token=${TOKEN}`);
  await arena2.opened;
  assert.equal(await closed, 4000);
  assert.ok(site.arenaConnected);
  // falsches Token
  const wrong = new WebSocket(`${base.replace('http', 'ws')}/arena?token=falsch`);
  await assert.rejects(new Promise((res, rej) => (wrong.on('open', res), wrong.on('error', rej))));
  arena2.ws.close();
  a.ws.close();
  b.ws.close();
});

test('Chat: Bremse, Links nur für Mods, Twitch herein, Twitch-Mods', async () => {
  const otto = await mailLogin('otto@beispiel.at', 'Otto');
  const a = wsClient(otto.jar);
  await a.opened;
  await a.waitFor((m) => m.t === 'hello');
  a.ws.send(JSON.stringify({ t: 'say', text: 'eins' }));
  a.ws.send(JSON.stringify({ t: 'say', text: 'zwei' }));
  await a.waitFor((m) => m.t === 'err' && m.code === 'slow');
  await sleep(1100);
  a.ws.send(JSON.stringify({ t: 'say', text: 'schau www.beispiel.at' }));
  await a.waitFor((m) => m.t === 'err' && m.code === 'link');
  // aus dem Twitch-Chat: Nachricht kommt an, Befehl nicht; Mod wird gemerkt
  ircClient!.send('@badges=moderator/1;display-name=Sepp_TV;mod=1 :sepp_tv!sepp_tv@sepp_tv.tmi.twitch.tv PRIVMSG #marblearena :Bitte nett bleiben\r\n');
  ircClient!.send('@display-name=Hansi :hansi!hansi@hansi.tmi.twitch.tv PRIVMSG #marblearena :!join\r\n');
  await a.waitFor((m) => m.t === 'msg' && (m.m as { src: string; text: string }).src === 'twitch' && (m.m as { text: string }).text === 'Bitte nett bleiben');
  await sleep(200);
  assert.ok(!a.got.some((m) => m.t === 'msg' && (m.m as { text: string }).text === '!join'));
  const row = site.db.prepare('SELECT login FROM twitch_mods').all() as { login: string }[];
  assert.deepEqual(row.map((r) => r.login), ['sepp_tv']);
  a.ws.close();
});

test('Mods: Twitch-Mod mit verknüpftem Konto löscht und schaltet stumm', async () => {
  // Sepp_TV ist über Twitch angemeldet (Test oben) und Twitch-Mod
  const sepp = cookieJar();
  await sepp.f('/auth/twitch');
  const st = [...sepp.jar].find(([k]) => k === 'ma_tw')![1].split('.')[0];
  await sepp.f(`/auth/twitch?code=c2&state=${st}`);
  const mod = wsClient(sepp.jar);
  const troll = await mailLogin('troll@beispiel.at', 'Troll');
  const t = wsClient(troll.jar);
  await Promise.all([mod.opened, t.opened]);
  const hello = (await mod.waitFor((m) => m.t === 'hello')) as { me: { mod: boolean } };
  assert.equal(hello.me.mod, true);
  await t.waitFor((m) => m.t === 'hello');
  t.ws.send(JSON.stringify({ t: 'say', text: 'blöder Spruch' }));
  const msg = (await mod.waitFor((m) => m.t === 'msg' && (m.m as { text: string }).text === 'blöder Spruch')) as { m: { id: number; key: string } };
  mod.ws.send(JSON.stringify({ t: 'del', id: msg.m.id }));
  await t.waitFor((m) => m.t === 'del' && m.id === msg.m.id);
  mod.ws.send(JSON.stringify({ t: 'mute', key: msg.m.key, minutes: 10 }));
  await mod.waitFor((m) => m.t === 'sys' && m.code === 'muted');
  await sleep(1100);
  t.ws.send(JSON.stringify({ t: 'say', text: 'noch was' }));
  await t.waitFor((m) => m.t === 'err' && m.code === 'muted');
  // kein Mod: darf nicht löschen
  t.ws.send(JSON.stringify({ t: 'del', id: 1 }));
  await sleep(200);
  assert.ok(!mod.got.some((m) => m.t === 'del' && m.id === 1));
  mod.ws.close();
  t.ws.close();
});

test('Profile: Protokoll wie der Hilfsdienst, neuerer Stand gewinnt, Konto sieht seinen', async () => {
  assert.equal((await fetch(`${base}/arena-api/profiles`)).status, 401);
  const post = (b: unknown) => fetch(`${base}/arena-api/profiles?token=${TOKEN}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
  assert.equal((await (await post({ 'web:lisi': { user: 'web:lisi', s: 300, updatedAt: 2000 } })).json()).taken, 1);
  assert.equal((await (await post({ 'web:lisi': { user: 'web:lisi', s: 100, updatedAt: 1000 } })).json()).taken, 0, 'älterer Stand verliert');
  const all = await (await fetch(`${base}/arena-api/profiles?token=${TOKEN}`)).json();
  assert.equal(all['web:lisi'].s, 300);
  const s = await mailLogin('lisi3@beispiel.at', 'Lisi3');
  await post({ 'web:lisi3': { user: 'web:lisi3', s: 1240, xp: 8430, updatedAt: Date.now() } });
  const p = await (await s.f('/api/profile')).json();
  assert.equal(p.profile.s, 1240);
  // Name bleibt, sobald die Arena ihn als Schlüssel kennt
  const r = await s.f('/api/setup', { method: 'POST', json: { name: 'Lisi4' } });
  assert.equal((await r.json()).error, 'name_locked');
});

test('Admin nur mit Passwort; Konto löschen', async () => {
  assert.equal((await fetch(`${base}/admin`)).status, 401);
  const r = await fetch(`${base}/admin`, { headers: { authorization: `Basic ${Buffer.from('admin:geheim-admin-1').toString('base64')}` } });
  assert.equal(r.status, 200);
  assert.match(await r.text(), /schreibt als arenabot/);
  assert.match(r.headers.get('content-security-policy') ?? '', /frame-ancestors 'none'/);
  // fremde Seite darf kein Admin-Formular abschicken, auch wenn der Browser Basic-Auth mitschickt
  const evil = await fetch(`${base}/admin/bridge`, { method: 'POST', headers: { origin: 'https://boese.example', authorization: `Basic ${Buffer.from('admin:geheim-admin-1').toString('base64')}`, 'content-type': 'application/x-www-form-urlencoded' }, body: 'on=0' });
  assert.equal(evil.status, 403);
  const s = await mailLogin('weg@beispiel.at', 'Weg');
  const data = await (await s.f('/api/account/data')).json();
  assert.equal(data.konto.name, 'Weg');
  assert.equal((await s.f('/api/account/delete', { method: 'POST', json: {} })).status, 200);
  assert.equal((await (await s.f('/api/me')).json()).user, null);
});
