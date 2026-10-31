// Auswertungen aus den Spielständen der Arena: Stufe und Titel, Wochenwertung, ewige Liste, letzte Runden.
// Regeln wie in der Arena (src/game/profiles.ts, src/game/woche.ts) – hier nachgebaut, damit die Seite sie auch zeigt,
// wenn die Arena gerade nicht verbunden ist.
import type { DB } from './db.js';
import { allProfiles, type ProfileJson } from './profiles.js';

export const WOCHE = { countBest: 20 };

const fmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Vienna', year: 'numeric', month: '2-digit', day: '2-digit' });
// ISO-Kalenderwoche nach Wiener Datum, z. B. „2026-W44“ (wie die Arena)
export function weekKey(d = new Date()): string {
  const p: Record<string, string> = {};
  for (const x of fmt.formatToParts(d)) p[x.type] = x.value;
  const date = Date.UTC(+p.year, +p.month - 1, +p.day);
  const dayNum = (new Date(date).getUTCDay() + 6) % 7;
  const thursday = date + (3 - dayNum) * 86400000;
  const year = new Date(thursday).getUTCFullYear();
  const week = 1 + Math.round((thursday - Date.UTC(year, 0, 4) - 3 * 86400000 + ((new Date(Date.UTC(year, 0, 4)).getUTCDay() + 6) % 7) * 86400000) / (7 * 86400000));
  return `${year}-W${String(week).padStart(2, '0')}`;
}
export const sumBest = (list: number[]) => [...list].sort((a, b) => b - a).slice(0, WOCHE.countBest).reduce((a, b) => a + b, 0);
export const levelFor = (xp: number) => 1 + Math.floor(Math.sqrt(Math.max(0, xp) / 40));
export const xpForLevel = (level: number) => (level - 1) ** 2 * 40;

const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

export function titlesFor(p: ProfileJson, en: boolean): string[] {
  const tr = (de: string, e: string) => (en ? e : de);
  const t: string[] = [];
  const wins = n(p.wins), champ = n(p.champ);
  if (wins >= 10) t.push(tr('Legende', 'Legend'));
  else if (wins >= 3) t.push(tr('Seriensieger', 'Serial winner'));
  if (n(p.seconds) >= 5 && n(p.seconds) > wins) t.push(tr('Ewiger Zweiter', 'Eternal runner-up'));
  if (n(p.bananas) >= 10) t.push(tr('Bananenkönig', 'Banana king'));
  if (n(p.slips) >= 5) t.push(tr('Rutschgefährdet', 'Slippery'));
  if (n(p.respawns) >= 10) t.push('Kamikaze');
  if (n(p.betWon) >= 1000) t.push(tr('Zocker', 'High roller'));
  if (n(p.races) >= 50) t.push(tr('Stammgast', 'Regular'));
  if (champ) t.unshift(champ > 1 ? tr(`${champ}× Wochenchampion`, `${champ}× weekly champion`) : tr('Wochenchampion', 'Weekly champion'));
  return t;
}

export interface BoardRow {
  key: string;
  name: string;
  pts: number;
  races: number;
  wins: number;
  xp: number;
  level: number;
}
export interface Boards {
  week: string;
  woche: BoardRow[];
  siege: BoardRow[];
  xp: BoardRow[];
  at: number;
}

// Bestenlisten: höchstens alle 20 s neu gerechnet
let cache: Boards | null = null;
export function boards(db: DB, force = false): Boards {
  const t = Date.now();
  if (cache && !force && t - cache.at < 20_000) return cache;
  const wk = weekKey();
  const rows: (BoardRow & { wkOk: boolean })[] = [];
  for (const [key, p] of Object.entries(allProfiles(db))) {
    const wkOk = p.wk === wk && Array.isArray(p.wkPts);
    rows.push({ key, name: String(p.name ?? key), pts: wkOk ? sumBest((p.wkPts as unknown[]).map(n)) : 0, races: wkOk ? n(p.wkRaces) : 0, wins: wkOk ? n(p.wkWins) : 0, xp: n(p.xp), level: levelFor(n(p.xp)), wkOk });
  }
  const strip = ({ wkOk: _w, ...r }: BoardRow & { wkOk: boolean }) => r;
  const woche = rows.filter((r) => r.wkOk && r.pts > 0).sort((a, b) => b.pts - a.pts || b.wins - a.wins || a.name.localeCompare(b.name)).map(strip);
  const all = Object.entries(allProfiles(db));
  const ewig = (by: (p: ProfileJson) => number) =>
    all
      .map(([key, p]) => ({ key, name: String(p.name ?? key), pts: by(p), races: n(p.races), wins: n(p.wins), xp: n(p.xp), level: levelFor(n(p.xp)) }))
      .filter((r) => r.pts > 0)
      .sort((a, b) => b.pts - a.pts || a.name.localeCompare(b.name));
  cache = { week: wk, woche, siege: ewig((p) => n(p.wins)), xp: ewig((p) => n(p.xp)), at: t };
  return cache;
}
export const dropBoards = () => {
  cache = null;
};

// Zustand der laufenden Runde, wie ihn die Arena meldet (nur was die Seite für die letzten Runden braucht)
export interface RoundCtx {
  round: number;
  art: string;
  artName: string;
  track: string | null;
  result: { rank: number; name: string; user: string | null }[] | null;
  field: number;
}

// Änderung am Spielstand eines Nutzers: der laufenden Runde zuschreiben (Schilling und XP summiert, Platz aus dem Ergebnis)
export function noteHistory(db: DB, key: string, old: ProfileJson | null, neu: ProfileJson, ctx: RoundCtx | null): void {
  if (!ctx || !old) return;
  const ds = n(neu.s) - n(old.s);
  const dxp = n(neu.xp) - n(old.xp);
  const raced = n(neu.races) > n(old.races) ? 1 : 0;
  if (!ds && !dxp && !raced) return;
  const r = ctx.result?.find((x) => x.user === key);
  db.prepare(
    `INSERT INTO history (user_key, round, at, art, art_name, track, rank, of, ds, dxp, raced) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_key, round) DO UPDATE SET at = excluded.at, ds = ds + excluded.ds, dxp = dxp + excluded.dxp, raced = MAX(raced, excluded.raced),
       rank = COALESCE(excluded.rank, rank), of = COALESCE(excluded.of, of), track = COALESCE(excluded.track, track)`,
  ).run(key, ctx.round, Date.now(), ctx.art, ctx.artName, ctx.track, r?.rank ?? null, r ? ctx.field || null : null, ds, dxp, raced);
}

export function historyOf(db: DB, key: string, limit = 15) {
  return db.prepare('SELECT round, at, art, art_name artName, track, rank, of, ds, dxp, raced FROM history WHERE user_key = ? ORDER BY at DESC LIMIT ?').all(key, limit) as {
    round: number;
    at: number;
    art: string;
    artName: string;
    track: string | null;
    rank: number | null;
    of: number | null;
    ds: number;
    dxp: number;
    raced: number;
  }[];
}
