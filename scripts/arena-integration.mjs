// Zusammenspiel mit der echten Arena (Browser): ein angemeldeter Nutzer der Seite schickt !join, die Arena nimmt ihn
// in die Lobby, die Antwort kommt nur bei ihm an, Ferdls Ansagen erscheinen im Chat, das Profil landet am Server.
// Voraussetzung: Seite läuft (BASE, DB, TOKEN wie unten), Arena gebaut.  node scripts/arena-integration.mjs
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import Database from 'better-sqlite3';
import WebSocket from 'ws';
const require = createRequire('/home/claude/murmel-arena/package.json');
const { chromium } = require('playwright-core');
const BASE = process.env.BASE ?? 'http://127.0.0.1:5310', TOKEN = process.env.TOKEN ?? 'arena-token-0123456789', DB = process.env.DB ?? '/tmp/mw-int.db';
let fails = 0;
const check = (ok, what) => { console.log(ok ? 'ok  ' : 'FEHLER', what); if (!ok) fails++; };
// Nutzer samt Sitzung direkt anlegen
const db = new Database(DB);
const r = db.prepare("INSERT INTO users (name, color, age_ok, created) VALUES ('Lisi', '#ff5fb0', 1, ?)").run(Date.now());
db.prepare('INSERT INTO sessions (id_hash, user_id, expires) VALUES (?, ?, ?)').run(createHash('sha256').update('sid-int').digest('hex'), r.lastInsertRowid, Date.now() + 3600e3);
db.close();
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.goto(`file:///home/claude/murmel-arena/dist/index.html?fx=aus&demo=0&fast&seed=31&watchdog=0&kulisse=0&tts=none&audio=0&kanalpunkte=0&reel=0&rennart=murmel&seite=${encodeURIComponent(BASE)}&seitentoken=${TOKEN}`, { waitUntil: 'commit' });
await page.waitForFunction(() => window.arena && window.arena.phase === 'start', null, { timeout: 600000, polling: 500 });
const admin = () => fetch(`${BASE}/admin/status`, { headers: { authorization: `Basic ${Buffer.from('admin:geheim-admin-1').toString('base64')}` } }).then((x) => x.json());
let st;
for (let i = 0; i < 60; i++) { st = await admin(); if (st.arena) break; await new Promise((r) => setTimeout(r, 500)); }
check(!!st.arena, `Arena an der Seite angemeldet (${st.arena?.version ?? '-'})`);
const status = await page.evaluate(() => document.getElementById('status').textContent);
check(/Website verbunden|website connected/.test(status), `Statuszeile der Arena: ${status}`);
const got = [];
const ws = new WebSocket(`${BASE.replace('http', 'ws')}/ws`, { headers: { origin: BASE, cookie: 'ma_s=sid-int' } });
ws.on('message', (d) => got.push(JSON.parse(String(d))));
await new Promise((r) => ws.on('open', r));
const waitFor = async (pred, ms = 20000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const m = got.find(pred); if (m) return m; await new Promise((r) => setTimeout(r, 100)); } return null; };
await waitFor((m) => m.t === 'hello');
ws.send(JSON.stringify({ t: 'say', text: '!join gummi' }));
const fb = await waitFor((m) => m.t === 'fb');
check(!!fb, `Antwort der Arena beim Absender: ${fb?.kind} „${fb?.text}“`);
const inLobby = await page.evaluate(() => !!window.arena.profile('web:lisi'));
check(inLobby, 'Arena kennt web:lisi (Profil angelegt, in der Lobby)');
const ferdl = await waitFor((m) => m.t === 'msg' && m.m.src === 'ferdl', 60000);
check(!!ferdl, `Ferdl im Chat der Seite: „${ferdl?.m.text ?? ''}“`);
let prof = null;
for (let i = 0; i < 40 && !prof; i++) { prof = (await (await fetch(`${BASE}/arena-api/profiles?token=${TOKEN}`)).json())['web:lisi']; if (!prof) await new Promise((r) => setTimeout(r, 500)); }
check(!!prof, `Profil am Server (${prof ? `${prof.s} S` : '-'})`);
check(errs.length === 0, `keine Seitenfehler in der Arena (${errs.slice(0, 2).join(' | ')})`);
ws.close();
await browser.close();
console.log(fails ? `${fails} FEHLER` : 'alles ok');
process.exit(fails ? 1 : 0);
