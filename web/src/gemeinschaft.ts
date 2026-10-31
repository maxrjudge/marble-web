// Spielplan der Woche, Clips der Arena und die Mod-Seite.
import { getLang, t, type Key } from './i18n';
import { current } from './runde';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};
async function getJson<T>(path: string): Promise<T | null> {
  try {
    const r = await fetch(path, { credentials: 'same-origin' });
    return r.ok ? ((await r.json()) as T) : null;
  } catch {
    return null;
  }
}
async function postJson(path: string, body: unknown): Promise<boolean> {
  try {
    const r = await fetch(path, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return r.ok;
  } catch {
    return false;
  }
}

// ---------- Spielplan ----------
interface PlanDay {
  day: string;
  today: boolean;
  items: { at: string; what: string; art: string }[];
}
export async function renderPlan(): Promise<void> {
  const r = await getJson<{ plan: PlanDay[] | null; off: boolean; at: number }>('/api/plan');
  const s = current();
  $('plNote').textContent = r?.off ? t('pl_off') : r?.plan ? t('pl_note') : t('pl_unknown');
  // als Nächstes (aus dem Zustand der Arena)
  const next = $('plNext');
  next.replaceChildren();
  const rows: [string, string][] = s ? [[t('r_now', { a: '' }).replace(/:\s*$/, ''), [s.artName, s.track].filter(Boolean).join(' · ')], ...(s.plan.length ? s.plan.map((p) => [p.when, p.what + (p.in ? ` (${p.in})` : '')] as [string, string]) : [['→', s.nextName] as [string, string]])] : [];
  $('plNextBox').hidden = !rows.length;
  for (const [a, b] of rows) {
    const d = el('div', 'srow');
    d.append(el('span', '', a), el('span', '', b));
    next.append(d);
  }
  const wk = $('plWeek');
  wk.replaceChildren();
  for (const day of r?.plan ?? []) {
    const box = el('section', `panel pday${day.today ? ' today' : ''}`);
    box.append(el('h2', '', day.day));
    if (!day.items.length) box.append(el('p', 'hint', t('pl_empty')));
    for (const it of day.items) {
      const d = el('div', `srow art-${it.art}`);
      d.append(el('span', '', it.at), el('span', '', it.what));
      box.append(d);
    }
    wk.append(box);
  }
}

// ---------- Clips ----------
export interface Clip {
  file: string;
  at: number;
  kind: string;
  title: string;
  track: string;
  round: number | null;
  dur: number;
  hidden: number;
}
let clips: Clip[] = [];
let more = true;
let isMod = false;
export function setMod(m: boolean): void {
  isMod = m;
}
const when = (at: number) => {
  const d = new Date(at);
  const L = getLang();
  const day = d.toLocaleDateString(L, { timeZone: 'Europe/Vienna' });
  const today = new Date().toLocaleDateString(L, { timeZone: 'Europe/Vienna' });
  return `${day === today ? t('today') : day} ${d.toLocaleTimeString(L, { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Vienna' })}`;
};
function clipCard(c: Clip, small: boolean, toast: (s: string) => void): HTMLElement {
  const card = el('article', `clip${c.hidden ? ' hid' : ''}`);
  card.id = `clip-${c.file}`;
  const v = el('video');
  v.src = `/clips/${encodeURIComponent(c.file)}#t=0.5`; // erstes Bild als Vorschau
  v.preload = 'metadata';
  v.controls = true;
  v.playsInline = true;
  v.setAttribute('aria-label', c.title);
  if (c.hidden) v.removeAttribute('src');
  card.append(v);
  const meta = el('div', 'cmeta');
  meta.append(el('b', '', c.title || t('cl_title')));
  meta.append(el('span', 'hint', [c.track, when(c.at), c.dur ? `${c.dur.toLocaleString(getLang(), { maximumFractionDigits: 0 })} s` : ''].filter(Boolean).join(' · ')));
  if (!small) {
    const row = el('div', 'chips');
    const copy = el('button', 'chip-b', t('cl_copy')) as HTMLButtonElement;
    copy.type = 'button';
    copy.onclick = async () => {
      const url = `${location.origin}/#clip=${encodeURIComponent(c.file)}`;
      try {
        await navigator.clipboard.writeText(url);
        toast(t('cl_copied'));
      } catch {
        prompt(t('cl_copy'), url);
      }
    };
    row.append(copy);
    if (isMod) {
      const hide = el('button', 'chip-b', t(c.hidden ? 'cl_show' : 'cl_hide')) as HTMLButtonElement;
      hide.type = 'button';
      hide.onclick = async () => {
        if (await postJson('/api/mod/clip', { file: c.file, hidden: !c.hidden })) {
          c.hidden = c.hidden ? 0 : 1;
          card.replaceWith(clipCard(c, small, toast));
        }
      };
      row.append(hide);
      if (c.hidden) row.append(el('span', 'hint', t('cl_hidden')));
    }
    meta.append(row);
  }
  card.append(meta);
  return card;
}
export async function renderClips(toast: (s: string) => void, reset = true): Promise<void> {
  if (reset) {
    const r = await getJson<{ clips: Clip[] }>('/api/clips?limit=24');
    clips = r?.clips ?? [];
    more = clips.length === 24;
  }
  const grid = $('clipGrid');
  grid.replaceChildren(...clips.map((c) => clipCard(c, false, toast)));
  if (!clips.length) grid.append(el('p', 'hint', t('cl_none')));
  $('clipMore').hidden = !more;
  // geteilter Link: #clip=datei
  const want = decodeURIComponent(location.hash.match(/clip=([^&]+)/)?.[1] ?? '');
  if (want) {
    const card = document.getElementById(`clip-${want}`);
    if (card) {
      card.classList.add('focus');
      card.scrollIntoView({ block: 'center' });
    }
  }
}
export async function moreClips(toast: (s: string) => void): Promise<void> {
  const last = clips[clips.length - 1];
  if (!last) return;
  const r = await getJson<{ clips: Clip[] }>(`/api/clips?limit=24&before=${last.at}`);
  const got = r?.clips ?? [];
  clips.push(...got);
  more = got.length === 24;
  await renderClips(toast, false);
}
// Streifen auf der Live-Seite: die neuesten vier
export async function renderClipStrip(toast: (s: string) => void): Promise<void> {
  const r = await getJson<{ clips: Clip[] }>('/api/clips?limit=4');
  const list = (r?.clips ?? []).filter((c) => !c.hidden).slice(0, 4);
  $('clipStrip').hidden = !list.length;
  $('clipStripGrid').replaceChildren(...list.map((c) => clipCard(c, true, toast)));
}

// ---------- Mod-Seite ----------
interface ModData {
  slow: number;
  filter: string[];
  restricted: { key: string; name: string; banned: boolean; until: number | null }[];
  log: { at: number; modName: string; action: string; target: string; detail: string }[];
}
const SLOW = [0, 3, 10, 30, 60];
export async function renderMod(toast: (s: string, k?: 'ok' | 'err') => void): Promise<void> {
  const d = await getJson<ModData>('/api/mod');
  if (!d) return;
  const L = getLang();
  const slow = $('mSlow');
  slow.replaceChildren(
    ...SLOW.map((n) => {
      const b = el('button', 'chip-b', n ? `${n} s` : t('m_slow_off')) as HTMLButtonElement;
      b.type = 'button';
      b.setAttribute('aria-pressed', String(d.slow === n));
      b.onclick = async () => {
        if (await postJson('/api/mod/slow', { seconds: n })) void renderMod(toast);
      };
      return b;
    }),
  );
  const ta = $<HTMLTextAreaElement>('mFilter');
  if (document.activeElement !== ta) ta.value = d.filter.join('\n');
  $('mFilterSave').onclick = async () => {
    const ok = await postJson('/api/mod/filter', { words: ta.value });
    toast(ok ? t('saved') : 'Fehler', ok ? 'ok' : 'err');
    void renderMod(toast);
  };
  const rs = $('mRestricted');
  rs.replaceChildren();
  if (!d.restricted.length) rs.append(el('p', 'hint', t('m_restricted_none')));
  for (const r of d.restricted) {
    const row = el('div', 'linkrow');
    row.append(el('b', '', r.name), el('span', '', r.banned ? t('m_banned') : t('m_until', { t: new Date(r.until ?? 0).toLocaleTimeString(L, { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Vienna' }) })));
    const b = el('button', 'btn sec', t('m_lift')) as HTMLButtonElement;
    b.type = 'button';
    b.onclick = async () => {
      if (await postJson('/api/mod/lift', { key: r.key })) void renderMod(toast);
    };
    row.append(b);
    rs.append(row);
  }
  const log = $('mLog');
  const body = el('tbody');
  if (!d.log.length) {
    const tr = el('tr');
    const td = el('td', 'hint', t('m_log_none'));
    td.colSpan = 3;
    tr.append(td);
    body.append(tr);
  }
  for (const x of d.log) {
    const tr = el('tr');
    const k = `m_a_${x.action}` as Key;
    tr.append(el('td', 'num', new Date(x.at).toLocaleString(L, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Vienna' })), el('td', '', x.modName), el('td', '', [t(k), x.target, x.detail].filter(Boolean).join(' · ')));
    body.append(tr);
  }
  log.replaceChildren(body);
}
