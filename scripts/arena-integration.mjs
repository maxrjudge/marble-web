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
// Etappe 2: Zustand der Runde an die Seite, Knöpfe im Browser, letzte Runden
const stLobby = await waitFor((m) => m.t === 'state' && m.s?.lobby?.users?.includes('web:lisi'), 20000);
check(!!stLobby, `Zustand der Runde an der Seite: ${stLobby ? `Runde ${stLobby.s.round}, ${stLobby.s.artName}, ${stLobby.s.lobby.n} angemeldet` : '-'}`);
const raceSt = await waitFor((m) => m.t === 'state' && m.s?.phase === 'race' && m.s.ranking?.length, 180000);
check(!!raceSt, `im Rennen: Rangliste ${raceSt ? raceSt.s.ranking.map((r) => `${r.rank}. ${r.name}`).slice(0, 3).join(', ') : '-'}`);
// die Seite im Browser, angemeldet als Lisi: Rundenanzeige über dem Bild
const ctx2 = await browser.newContext({ viewport: { width: 1440, height: 1500 } });
await ctx2.addCookies([{ name: 'ma_s', value: 'sid-int', url: BASE }]);
const site = await ctx2.newPage();
const siteErrs = [];
site.on('pageerror', (e) => siteErrs.push(e.message));
await site.goto(BASE);
await site.waitForFunction(() => document.querySelector('#ov .ovchip')?.textContent?.includes('Runde') || document.querySelector('#ov .ovchip')?.textContent?.includes('Round'), null, { timeout: 30000 }).catch(() => {});
const ov = await site.evaluate(() => document.querySelector('#ov')?.textContent ?? '');
check(/Runde|Round/.test(ov), `Anzeige über dem Bild: „${ov.slice(0, 80)}“`);
await site.screenshot({ path: `${process.env.SHOTS ?? '/tmp'}/site-runde.png` });
// Knopf „Mitfahren“ im Rennen: Lisi steht danach in der Anmeldung für die nächste Runde
const nGot = got.length;
await site.click('#bJoin');
const reJoin = await waitFor((m) => got.indexOf(m) >= nGot && m.t === 'state' && m.s?.lobby?.users?.includes('web:lisi'), 30000);
check(!!reJoin, `Knopf Mitfahren: Lisi für die nächste Runde angemeldet (${reJoin ? reJoin.s.lobby.n : '-'} in der Anmeldung)`);
await site.waitForTimeout(1500);
const pst = await site.evaluate(() => document.getElementById('pStatus').textContent);
check(/in|dabei|fährst/.test(pst ?? ''), `Hinweis unter den Knöpfen: „${pst}“`);
await site.screenshot({ path: `${process.env.SHOTS ?? '/tmp'}/site-knopf.png` });
// Siegerehrung und letzte Runden: nur mit PODIUM=1 (mit Software-Grafik läuft ein Rennen hier rund zehnmal langsamer als echt)
if (process.env.PODIUM === '1') {
  await site.goto('about:blank');
  const podSt = await waitFor((m) => m.t === 'state' && m.s?.phase === 'podium' && m.s.result?.length, 1800000);
  check(!!podSt, `Siegerehrung: ${podSt ? podSt.s.result.slice(0, 3).map((r) => `${r.rank}. ${r.name}`).join(', ') : '-'}`);
  const lisiRank = podSt?.s.result.find((r) => r.user === 'web:lisi')?.rank ?? null;
  let hist = [];
  for (let i = 0; i < 30 && !hist.some((h) => h.raced); i++) { hist = (await (await fetch(`${BASE}/api/profile`, { headers: { cookie: 'ma_s=sid-int' } })).json()).history ?? []; if (!hist.some((h) => h.raced)) await new Promise((r) => setTimeout(r, 500)); }
  const h0 = hist.find((h) => h.raced);
  check(!!h0 && (lisiRank === null || h0.rank === lisiRank), `letzte Runden: ${h0 ? `Runde ${h0.round} ${h0.artName}, Platz ${h0.rank ?? '-'} von ${h0.of ?? '-'}, ${h0.ds} S` : '-'} (Ergebnis: Platz ${lisiRank ?? '>10'})`);
}
await site.goto(`${BASE}/#konto`);
await site.waitForTimeout(1200);
await site.screenshot({ path: `${process.env.SHOTS ?? '/tmp'}/site-konto2.png`, fullPage: true });
await site.goto(`${BASE}/#bestenliste`);
await site.waitForTimeout(1000);
await site.screenshot({ path: `${process.env.SHOTS ?? '/tmp'}/site-bestenliste.png` });
check(siteErrs.length === 0, `keine Fehler auf der Seite (${siteErrs.slice(0, 2).join(' | ')})`);
check(errs.length === 0, `keine Seitenfehler in der Arena (${errs.slice(0, 2).join(' | ')})`);
ws.close();
await browser.close();
console.log(fails ? `${fails} FEHLER` : 'alles ok');
process.exit(fails ? 1 : 0);
