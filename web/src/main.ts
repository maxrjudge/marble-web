// MarbleArena-Website: Livebild (LSM-Embed), Runde im Takt, Mitspielen per Knopf, Chat, Anmeldung, Konto, Bestenliste.
import { initBoard, loadBoard, renderBoard } from './board';
import { applyStatic, getLang, hasKey, setLang, t, type Key, type Lang } from './i18n';
import { initRunde, onFeedback, onState, render as renderPlay, renderSide, setOnline, type RoundState } from './runde';

interface Me {
  name: string;
  color: string;
  key: string;
  twitch: string | null;
  email: string | null;
  mod: boolean;
  setup: boolean;
}
interface Line {
  id: number;
  ts: number;
  src: 'web' | 'twitch' | 'ferdl' | 'sys';
  key: string;
  name: string;
  color?: string;
  text: string;
  mod: boolean;
}
interface Cfg {
  version: string;
  embed: string | null;
  embedOrigin: string;
  channel: string;
  twitchLogin: boolean;
  mailLogin: boolean;
}

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const COLORS = ['#ff5fb0', '#3b82f6', '#22c55e', '#f97316', '#8b5cf6', '#f6c343', '#14b8a6', '#ef4444'];
let me: Me | null = null;
let cfg: Cfg;
let chatMe: { mod: boolean } | null = null;
let ws: WebSocket | null = null;

async function api<T>(path: string, body?: unknown): Promise<{ ok: boolean; status: number; data: T }> {
  const r = await fetch(path, body === undefined ? { credentials: 'same-origin' } : { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  let data: T;
  try {
    data = (await r.json()) as T;
  } catch {
    data = {} as T;
  }
  return { ok: r.ok, status: r.status, data };
}
const errText = (code: string | undefined): string => {
  if (!code) return '';
  const k = `e_${code}`;
  return hasKey(k) ? t(k) : code;
};
function toast(text: string, kind: 'ok' | 'err' | 'info' = 'info'): void {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = text;
  $('toasts').append(el);
  setTimeout(() => el.classList.add('out'), 4200);
  setTimeout(() => el.remove(), 4800);
}

// ---------- Sprache ----------
function renderLang(): void {
  applyStatic();
  document.querySelectorAll<HTMLButtonElement>('[data-lang]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.lang === getLang())));
  renderStatus();
  renderMe();
  renderArena();
  renderPlay();
  void side();
  if (location.hash.startsWith('#konto')) void renderKonto();
  if (location.hash.startsWith('#bestenliste')) void renderBoard();
}
document.querySelectorAll<HTMLButtonElement>('[data-lang]').forEach((b) =>
  b.addEventListener('click', () => {
    setLang(b.dataset.lang as Lang);
    renderLang();
  }),
);

// ---------- Livebild: LSM-Embed, Verzögerung per postMessage ----------
interface EmbedState {
  player: 'sldp' | 'hls' | 'none';
  state: string;
  delay: number;
  muted: boolean;
  seen: boolean;
}
const embed: EmbedState = { player: 'none', state: 'loading', delay: 1000, muted: true, seen: false };
function mountPlayer(): void {
  const box = $('player');
  if (!cfg.embed) {
    box.insertAdjacentHTML('afterbegin', `<p class="nostream">${t('no_stream')}</p>`);
    return;
  }
  const f = document.createElement('iframe');
  f.src = cfg.embed;
  f.title = 'MarbleArena live';
  f.allow = 'autoplay; fullscreen; picture-in-picture';
  f.allowFullscreen = true;
  f.referrerPolicy = 'strict-origin-when-cross-origin';
  f.loading = 'eager';
  f.addEventListener('load', () => f.contentWindow?.postMessage({ type: 'lsm-embed-hello' }, cfg.embedOrigin));
  box.prepend(f);
  addEventListener('message', (e) => {
    if (e.origin !== cfg.embedOrigin) return;
    const d = e.data as { type?: string; player?: EmbedState['player']; state?: string; delay_ms?: number; muted?: boolean };
    if (d?.type !== 'lsm-embed') return;
    embed.player = d.player ?? embed.player;
    embed.state = d.state ?? embed.state;
    if (typeof d.delay_ms === 'number' && d.delay_ms >= 0) embed.delay = d.delay_ms;
    if (typeof d.muted === 'boolean') embed.muted = d.muted;
    embed.seen = true;
    renderStatus();
  });
}
function renderStatus(): void {
  const el = $('status');
  if (!cfg?.embed) return void (el.textContent = '');
  const d = (embed.delay / 1000).toLocaleString(getLang(), { maximumFractionDigits: 1 });
  let s = '';
  if (!embed.seen || embed.state === 'loading' || embed.state === 'buffering') s = t('st_loading');
  else if (embed.state === 'playing') s = t(embed.player === 'hls' ? 'st_hls' : 'st_playing', { d });
  else if (embed.state === 'offline' || embed.state === 'ended') s = t('st_offline');
  else s = t('st_waiting');
  el.textContent = s + (embed.seen && embed.state === 'playing' && embed.muted ? ` · ${t('st_muted')}` : '');
  el.dataset.mode = embed.state === 'playing' ? embed.player : 'wait';
}

// ---------- Anmeldung ----------
const loginDlg = $<HTMLDialogElement>('loginDlg');
const setupDlg = $<HTMLDialogElement>('setupDlg');
function openLogin(): void {
  $('twitchLogin').hidden = !cfg.twitchLogin;
  $('twitchHint').hidden = !cfg.twitchLogin;
  $('mailForm').hidden = !cfg.mailLogin;
  $('loginOr').hidden = !(cfg.twitchLogin && cfg.mailLogin);
  $('loginNone').hidden = cfg.twitchLogin || cfg.mailLogin;
  $('mailMsg').textContent = '';
  loginDlg.showModal();
}
$('loginBtn').addEventListener('click', openLogin);
document.querySelectorAll('[data-open-login]').forEach((b) => b.addEventListener('click', openLogin));
$('mailForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const r = await api<{ error?: string }>('/auth/mail', { email: $<HTMLInputElement>('mailIn').value, lang: getLang() });
  $('mailMsg').textContent = r.ok ? t('mail_sent') : errText(r.data.error === 'slow' ? 'slowmail' : r.data.error);
});
function swatches(boxId: string, current: string, onPick: (c: string) => void): void {
  const box = $(boxId);
  box.innerHTML = '';
  for (const c of COLORS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'sw';
    b.style.background = c;
    b.setAttribute('aria-label', c);
    b.setAttribute('aria-pressed', String(c === current));
    b.addEventListener('click', () => {
      box.querySelectorAll('.sw').forEach((x) => x.setAttribute('aria-pressed', 'false'));
      b.setAttribute('aria-pressed', 'true');
      onPick(c);
    });
    box.append(b);
  }
}
let setupColor = COLORS[0];
function openSetup(): void {
  if (!me) return;
  $<HTMLInputElement>('setupName').value = me.name;
  setupColor = me.color;
  swatches('setupSwatches', setupColor, (c) => (setupColor = c));
  $('setupErr').textContent = '';
  setupDlg.showModal();
}
$('setupForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const r = await api<{ user?: Me; error?: string }>('/api/setup', { name: $<HTMLInputElement>('setupName').value.trim(), color: setupColor, age: $<HTMLInputElement>('setupAge').checked });
  if (!r.ok) return void ($('setupErr').textContent = errText(r.data.error));
  me = r.data.user ?? me;
  setupDlg.close();
  history.replaceState(null, '', '#live');
  renderMe();
  reconnectChat();
});

function renderMe(): void {
  const logged = !!me && !me.setup;
  $('loginBtn').hidden = !!me;
  $('meLink').hidden = !me;
  (document.querySelector('[data-view="konto"]') as HTMLElement).hidden = !me;
  if (me) {
    $('meName').textContent = me.name;
    $('meDot').style.background = me.color;
  }
  $('say').hidden = !logged;
  $('loginHint').hidden = logged;
  renderPlay();
}
// eigener Spielstand (Schilling oben, Murmel und Kreisel bei den Knöpfen)
interface ProfileData {
  profile: { s?: number; xp?: number; races?: number; wins?: number; podiums?: number; perk?: string; kreisel?: { typ?: string; links?: boolean } } | null;
  level?: number;
  xpFrom?: number;
  xpTo?: number;
  titles?: string[];
  week?: { key: string; place: number | null; pts: number; of: number };
  history?: { round: number; at: number; art: string; artName: string; track: string | null; rank: number | null; of: number | null; ds: number; dxp: number; raced: number }[];
}
let prof: ProfileData | null = null;
async function loadSchilling(): Promise<void> {
  const chip = $('schilling');
  if (!me || me.setup) return void (chip.hidden = true);
  const r = await api<ProfileData>(`/api/profile?lang=${getLang()}`);
  prof = r.ok ? r.data : null;
  const s = prof?.profile?.s;
  chip.hidden = typeof s !== 'number';
  if (typeof s === 'number') chip.textContent = `${s.toLocaleString(getLang())} S`;
  renderPlay();
}
let fbReload: ReturnType<typeof setTimeout> | undefined;
// Spielstand kommt mit ein paar Sekunden Verzug von der Arena an den Server
function reloadSoon(): void {
  clearTimeout(fbReload);
  fbReload = setTimeout(() => void loadSchilling(), 3500);
}

// ---------- Chat ----------
const lines = $<HTMLOListElement>('lines');
function lineEl(l: Line): HTMLLIElement {
  const li = document.createElement('li');
  li.dataset.id = String(l.id);
  li.className = `l ${l.src}`;
  if (l.src === 'ferdl' || l.src === 'sys') {
    const b = document.createElement('b');
    b.textContent = l.name;
    li.append(b, ' ', l.text);
    return li;
  }
  const badge = document.createElement('span');
  badge.className = `badge ${l.src}`;
  badge.textContent = t(l.src === 'twitch' ? 'src_twitch' : 'src_web');
  li.append(badge, ' ');
  if (l.mod) {
    const m = document.createElement('span');
    m.className = 'badge mod';
    m.textContent = t('mod');
    li.append(m, ' ');
  }
  const n = document.createElement('b');
  n.textContent = l.name;
  if (l.color) n.style.color = l.color;
  li.append(n, ' ', l.text);
  if (chatMe?.mod && l.src === 'web') {
    const tools = document.createElement('span');
    tools.className = 'tools';
    const del = document.createElement('button');
    del.type = 'button';
    del.textContent = '×';
    del.title = t('del');
    del.setAttribute('aria-label', t('del'));
    del.onclick = () => ws?.send(JSON.stringify({ t: 'del', id: l.id }));
    const mute = document.createElement('button');
    mute.type = 'button';
    mute.textContent = '10′';
    mute.title = t('mute10');
    mute.setAttribute('aria-label', t('mute10'));
    mute.onclick = () => ws?.send(JSON.stringify({ t: 'mute', key: l.key, minutes: 10 }));
    tools.append(del, mute);
    li.append(tools);
  }
  return li;
}
function addLine(l: Line): void {
  const stick = lines.scrollHeight - lines.scrollTop - lines.clientHeight < 60;
  lines.append(lineEl(l));
  while (lines.children.length > 200) lines.firstElementChild?.remove();
  if (stick) lines.scrollTop = lines.scrollHeight;
}
let arenaOn = false;
function renderArena(): void {
  const p = $('arenaPill');
  p.textContent = arenaOn ? t('arena_on') : t('arena_off');
  p.dataset.on = String(arenaOn);
}
let retry = 1000;
function connectChat(): void {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const s = new WebSocket(`${proto}://${location.host}/ws`);
  ws = s;
  s.onopen = () => (retry = 1000);
  s.onmessage = (ev) => {
    const m = JSON.parse(String(ev.data));
    if (m.t === 'hello') {
      chatMe = m.me;
      arenaOn = !!m.arena;
      renderArena();
      setOnline(arenaOn);
      onState((m.state as RoundState | null) ?? null);
      void side();
      lines.innerHTML = '';
      (m.history as Line[]).forEach(addLine);
      lines.scrollTop = lines.scrollHeight;
    } else if (m.t === 'msg') addLine(m.m);
    else if (m.t === 'del') lines.querySelector(`[data-id="${Number(m.id)}"]`)?.remove();
    else if (m.t === 'count') $('count').textContent = t('viewers', { n: m.n });
    else if (m.t === 'arena') {
      arenaOn = !!m.on;
      renderArena();
      setOnline(arenaOn);
    } else if (m.t === 'state') {
      onState((m.s as RoundState | null) ?? null);
      sideSoon();
    } else if (m.t === 'fb') {
      toast(m.text, m.kind === 'err' ? 'err' : m.kind === 'ok' ? 'ok' : 'info');
      onFeedback(String(m.text), String(m.kind));
      if (m.kind === 'ok') {
        void loadSchilling();
        reloadSoon();
      }
    } else if (m.t === 'err') toast(errText(m.code), 'err');
    else if (m.t === 'sys' && m.code === 'muted') toast(t('muted_ok', { name: m.name, m: m.minutes }), 'ok');
  };
  s.onclose = () => {
    if (ws !== s) return;
    setTimeout(connectChat, retry);
    retry = Math.min(20000, retry * 2);
  };
}
function reconnectChat(): void {
  const old = ws;
  ws = null;
  old?.close();
  connectChat();
}
$('say').addEventListener('submit', (e) => {
  e.preventDefault();
  const i = $<HTMLInputElement>('sayText');
  const text = i.value.trim();
  if (!text || !ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ t: 'say', text }));
  i.value = '';
});

// ---------- Konto ----------
let kColor = COLORS[0];
async function renderKonto(): Promise<void> {
  if (!me) return;
  $('kName').textContent = me.name;
  $('kBall').style.background = me.color;
  const r = await api<ProfileData>(`/api/profile?lang=${getLang()}`);
  const d0 = r.ok ? r.data : null;
  const p = d0?.profile ?? null;
  const L = getLang();
  $('kSub').textContent = p && d0 ? [t('k_level', { n: d0.level ?? 1 }), ...(d0.titles ?? []).slice(0, 2)].join(' · ') : '';
  const tiles = $('kTiles');
  tiles.innerHTML = '';
  if (!p || !d0) tiles.innerHTML = `<p class="hint">${t('k_noprofile')}</p>`;
  else {
    const xp = p.xp ?? 0;
    const span = Math.max(1, (d0.xpTo ?? 1) - (d0.xpFrom ?? 0));
    const frac = Math.min(1, Math.max(0, (xp - (d0.xpFrom ?? 0)) / span));
    const wk = d0.week;
    for (const [k, v, sub, bar] of [
      ['k_schilling', `${(p.s ?? 0).toLocaleString(L)} S`, '', null],
      ['k_xp', `${xp.toLocaleString(L)} XP`, t('k_to_next', { n: Math.max(0, (d0.xpTo ?? 0) - xp).toLocaleString(L), l: (d0.level ?? 1) + 1 }), frac],
      ['k_races', String(p.races ?? 0), `${p.wins ?? 0} ${t('k_wins')} · ${p.podiums ?? 0} ${t('k_podiums')}`, null],
      ['k_week', wk?.place ? t('k_week_place', { n: wk.place }) : t('k_week_none'), wk?.place ? t('k_week_sub', { p: wk.pts, n: wk.of }) : '', null],
    ] as [Key, string, string, number | null][]) {
      const d = document.createElement('div');
      d.className = 'tile';
      d.innerHTML = `<span class="lbl"></span><span class="val"></span>${bar !== null ? '<div class="bar"><i></i></div>' : ''}<span class="hint"></span>`;
      (d.querySelector('.lbl') as HTMLElement).textContent = t(k);
      (d.querySelector('.val') as HTMLElement).textContent = v;
      (d.querySelector('.hint') as HTMLElement).textContent = sub;
      if (bar !== null) (d.querySelector('.bar i') as HTMLElement).style.width = `${Math.round(bar * 100)}%`;
      tiles.append(d);
    }
  }
  renderHistory(d0?.history ?? []);
  $<HTMLInputElement>('kNameIn').value = me.name;
  const locked = !me.twitch && !!p;
  $<HTMLInputElement>('kNameIn').disabled = locked;
  $('kNameHint').textContent = locked ? t('k_name_locked') : '';
  kColor = me.color;
  swatches('kSwatches', kColor, (c) => (kColor = c));
  $('kTwitch').textContent = me.twitch ?? t('k_twitch_none');
  $('kTwitchBtn').hidden = !!me.twitch || !cfg.twitchLogin;
  $('kMail').textContent = me.email ?? '–';
  $('kMailForm').hidden = !!me.email || !cfg.mailLogin;
}
function renderHistory(h: NonNullable<ProfileData['history']>): void {
  const table = $('kHistTable');
  const L = getLang();
  const head = document.createElement('thead');
  head.innerHTML = '<tr><th></th><th></th><th></th><th class="num"></th></tr>';
  const ths = head.querySelectorAll('th');
  (['k_h_when', 'k_h_art', 'k_h_result', 'k_h_s'] as Key[]).forEach((k, i) => (ths[i].textContent = t(k)));
  const body = document.createElement('tbody');
  if (!h.length) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 4;
    td.className = 'hint';
    td.textContent = t('k_h_none');
    tr.append(td);
    body.append(tr);
  }
  const day = (ts: number) => new Date(ts).toLocaleDateString(L, { timeZone: 'Europe/Vienna' });
  const today = day(Date.now());
  const yest = day(Date.now() - 86400e3);
  for (const r of h) {
    const tr = document.createElement('tr');
    const dd = day(r.at);
    const time = new Date(r.at).toLocaleTimeString(L, { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Vienna' });
    const when = `${dd === today ? t('today') : dd === yest ? t('yesterday') : dd} ${time}`;
    const res = r.rank ? (r.of ? t('k_h_rank', { r: r.rank, n: r.of }) : t('k_h_rank1', { r: r.rank })) : r.raced ? t('k_h_raced') : t('k_h_bet');
    const ds = r.ds > 0 ? `+${r.ds.toLocaleString(L)} S` : r.ds < 0 ? `−${Math.abs(r.ds).toLocaleString(L)} S` : '0 S';
    [when, [r.artName, r.track].filter(Boolean).join(' · '), res, ds].forEach((c, i) => {
      const td = document.createElement('td');
      td.textContent = c;
      if (i === 3) td.className = `num ${r.ds > 0 ? 'plus' : r.ds < 0 ? 'minus' : ''}`;
      tr.append(td);
    });
    body.append(tr);
  }
  table.replaceChildren(head, body);
}
$('kForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const r = await api<{ user?: Me; error?: string }>('/api/setup', { name: $<HTMLInputElement>('kNameIn').value.trim(), color: kColor });
  $('kSaved').textContent = r.ok ? t('saved') : errText(r.data.error);
  if (r.ok && r.data.user) {
    me = r.data.user;
    renderMe();
    void renderKonto();
    reconnectChat();
  }
});
$('kMailForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const r = await api<{ error?: string }>('/auth/mail', { email: $<HTMLInputElement>('kMailIn').value, lang: getLang() });
  toast(r.ok ? t('mail_sent') : errText(r.data.error), r.ok ? 'ok' : 'err');
});
$('kLogout').addEventListener('click', async () => {
  await api('/auth/logout', {});
  location.href = '/';
});
$('kDelete').addEventListener('click', async () => {
  if (!confirm(t('delete_q'))) return;
  await api('/api/account/delete', {});
  location.href = '/';
});

// ---------- Gleich dran und Woche ----------
let sideT: ReturnType<typeof setTimeout> | undefined;
function sideSoon(): void {
  if (sideT) return;
  sideT = setTimeout(() => {
    sideT = undefined;
    void side();
  }, 2000);
}
async function side(): Promise<void> {
  const b = arenaOn ? null : await loadBoard();
  renderSide(b ? { key: b.week, top: b.woche.slice(0, 5) } : null);
}

// ---------- Ansichten ----------
function route(): void {
  const h = location.hash;
  const view = h.startsWith('#konto') && me ? 'konto' : h.startsWith('#bestenliste') ? 'board' : 'live';
  $('viewLive').hidden = view !== 'live';
  $('viewKonto').hidden = view !== 'konto';
  $('viewBoard').hidden = view !== 'board';
  const konto = view === 'konto';
  document.querySelectorAll<HTMLAnchorElement>('#nav a').forEach((a) => a.setAttribute('aria-current', String(a.dataset.view === view)));
  if (konto) void renderKonto();
  if (view === 'board') void renderBoard();
  if (h.startsWith('#willkommen') && me) openSetup();
  const err = h.match(/fehler=([a-z_]+)/)?.[1] ?? new URLSearchParams(location.search).get('fehler');
  if (err) {
    toast(errText(err === 'link' ? 'linkexp' : err), 'err');
    history.replaceState(null, '', location.pathname + (konto ? '#konto' : '#live'));
  }
}
addEventListener('hashchange', route);

async function start(): Promise<void> {
  cfg = (await api<Cfg>('/api/config')).data;
  me = (await api<{ user: Me | null }>('/api/me')).data.user;
  $('ver').textContent = `MarbleArena ${cfg.version}`;
  applyStatic();
  initRunde({
    embed,
    me: () => (me && !me.setup ? { key: me.key, perk: prof?.profile?.perk, kreisel: prof?.profile?.kreisel } : null),
    send: (text) => {
      if (!arenaOn) {
        toast(errText('arena'), 'err');
        return false;
      }
      if (!ws || ws.readyState !== WebSocket.OPEN) return false;
      ws.send(JSON.stringify({ t: 'say', text }));
      return true;
    },
    login: () => (me?.setup ? openSetup() : openLogin()),
  });
  initBoard();
  renderLang();
  mountPlayer();
  connectChat();
  route();
  if (me?.setup) openSetup();
  void loadSchilling();
}
void start();
