// Bestenliste: Woche (beste 20 Rennen), ewig nach Siegen und nach Erfahrung. Kommt vom Server (aus den Spielständen),
// geht also auch, wenn die Arena gerade nicht verbunden ist.
import { getLang, t, type Key } from './i18n';

export interface BoardRow {
  name: string;
  pts: number;
  races: number;
  wins: number;
  xp: number;
  level: number;
  me: boolean;
}
export interface Board {
  week: string;
  woche: BoardRow[];
  siege: BoardRow[];
  xp: BoardRow[];
  me: Record<'woche' | 'siege' | 'xp', { place: number; row: BoardRow } | null> | null;
}
type Tab = 'woche' | 'siege' | 'xp';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
let tab: Tab = 'woche';
let data: Board | null = null;
let loadedAt = 0;

export async function loadBoard(force = false): Promise<Board | null> {
  if (!force && data && Date.now() - loadedAt < 20_000) return data;
  try {
    const r = await fetch('/api/board', { credentials: 'same-origin' });
    if (r.ok) {
      data = (await r.json()) as Board;
      loadedAt = Date.now();
    }
  } catch {
    /* später noch einmal */
  }
  return data;
}

export function initBoard(): void {
  document.querySelectorAll<HTMLButtonElement>('#bdTabs [data-bd]').forEach((b) =>
    b.addEventListener('click', () => {
      tab = b.dataset.bd as Tab;
      void renderBoard();
    }),
  );
}

export async function renderBoard(): Promise<void> {
  const b = await loadBoard();
  document.querySelectorAll<HTMLButtonElement>('#bdTabs [data-bd]').forEach((x) => x.setAttribute('aria-selected', String(x.dataset.bd === tab)));
  $('bdNote').textContent = tab === 'woche' ? `${t('week', { w: b ? b.week.replace(/^.*-W0?/, '') : '' })} · ${t('bd_week_note')}` : '';
  const table = $('bdTable');
  const rows = b ? b[tab] : [];
  const valKey: Key = tab === 'woche' ? 'bd_woche' : tab === 'siege' ? 'bd_siege' : 'bd_xp';
  const head = document.createElement('thead');
  head.innerHTML = '<tr><th class="num"></th><th></th><th class="num"></th><th class="num"></th></tr>';
  const ths = head.querySelectorAll('th');
  ths[0].textContent = t('bd_rank');
  ths[1].textContent = t('bd_name');
  ths[2].textContent = t(valKey);
  ths[3].textContent = t('bd_races');
  const body = document.createElement('tbody');
  if (!rows.length) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 4;
    td.className = 'hint';
    td.textContent = t('bd_empty');
    tr.append(td);
    body.append(tr);
  }
  rows.forEach((r, i) => {
    const tr = document.createElement('tr');
    if (r.me) tr.className = 'me';
    const cells = [String(i + 1), r.name, tab === 'woche' ? t('pts', { n: r.pts }) : tab === 'siege' ? String(r.wins) : `${r.xp.toLocaleString(getLang())} XP · ${t('k_level', { n: r.level })}`, String(r.races)];
    cells.forEach((c, j) => {
      const td = document.createElement('td');
      td.textContent = c;
      if (j !== 1) td.className = 'num';
      if (j === 0 && i < 3) td.classList.add(`p${i + 1}`);
      tr.append(td);
    });
    body.append(tr);
  });
  table.replaceChildren(head, body);
  const mine = b?.me?.[tab];
  $('bdMe').textContent = mine && mine.place > 50 ? t('bd_you', { n: mine.place }) : '';
}
