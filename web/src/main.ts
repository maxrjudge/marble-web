// MarbleArena-Website: Livebild (LSM-Embed), Chat, Anmeldung, Konto.
import { applyStatic, getLang, hasKey, setLang, t, type Key, type Lang } from './i18n';

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
  if (location.hash.startsWith('#konto')) void renderKonto();
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
(window as unknown as { maEmbed: EmbedState }).maEmbed = embed; // für Etappe 2: Rundenanzeige im Takt
function mountPlayer(): void {
  const box = $('player');
  if (!cfg.embed) {
    box.innerHTML = `<p class="nostream">${t('no_stream')}</p>`;
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
  box.append(f);
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
}
async function loadSchilling(): Promise<void> {
  const chip = $('schilling');
  if (!me || me.setup) return void (chip.hidden = true);
  const r = await api<{ profile: { s?: number } | null }>('/api/profile');
  const s = r.data.profile?.s;
  chip.hidden = typeof s !== 'number';
  if (typeof s === 'number') chip.textContent = `${s.toLocaleString(getLang())} S`;
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
      lines.innerHTML = '';
      (m.history as Line[]).forEach(addLine);
      lines.scrollTop = lines.scrollHeight;
    } else if (m.t === 'msg') addLine(m.m);
    else if (m.t === 'del') lines.querySelector(`[data-id="${Number(m.id)}"]`)?.remove();
    else if (m.t === 'count') $('count').textContent = t('viewers', { n: m.n });
    else if (m.t === 'arena') {
      arenaOn = !!m.on;
      renderArena();
    } else if (m.t === 'fb') {
      toast(m.text, m.kind === 'err' ? 'err' : m.kind === 'ok' ? 'ok' : 'info');
      if (m.kind === 'ok') void loadSchilling();
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
  const r = await api<{ profile: Record<string, number> | null }>('/api/profile');
  const p = r.data.profile;
  const tiles = $('kTiles');
  tiles.innerHTML = '';
  if (!p) tiles.innerHTML = `<p class="hint">${t('k_noprofile')}</p>`;
  else
    for (const [k, v, sub] of [
      ['k_schilling', `${(p.s ?? 0).toLocaleString(getLang())} S`, ''],
      ['k_xp', `${(p.xp ?? 0).toLocaleString(getLang())} XP`, ''],
      ['k_races', String(p.races ?? 0), `${p.wins ?? 0} ${t('k_wins')} · ${p.podiums ?? 0} ${t('k_podiums')}`],
    ] as [Key, string, string][]) {
      const d = document.createElement('div');
      d.className = 'tile';
      d.innerHTML = `<span class="lbl"></span><span class="val"></span><span class="hint"></span>`;
      (d.children[0] as HTMLElement).textContent = t(k);
      (d.children[1] as HTMLElement).textContent = v;
      (d.children[2] as HTMLElement).textContent = sub;
      tiles.append(d);
    }
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

// ---------- Ansichten ----------
function route(): void {
  const h = location.hash;
  const konto = h.startsWith('#konto') && !!me;
  $('viewLive').hidden = konto;
  $('viewKonto').hidden = !konto;
  document.querySelectorAll<HTMLAnchorElement>('#nav a').forEach((a) => a.setAttribute('aria-current', String((a.dataset.view === 'konto') === konto)));
  if (konto) void renderKonto();
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
  renderLang();
  mountPlayer();
  connectChat();
  route();
  if (me?.setup) openSetup();
  void loadSchilling();
}
void start();
