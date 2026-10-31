// Clips der Arena: die Arena schickt jeden Auto-Clip (MP4 oder WebM, Hochformat) an /arena-api/clip, der Server legt
// ihn im Clip-Ordner ab und führt eine Liste. Die Seite zeigt sie unter „Clips“; Mods können einen ausblenden.
import { mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { DB } from './db.js';

export interface Clip {
  file: string;
  at: number;
  kind: string;
  title: string;
  track: string;
  round: number | null;
  dur: number;
  score: number;
  lang: string;
  hidden: number;
}

const FILE = /^[0-9]{8}-[0-9]{6}-[a-z0-9-]{1,48}\.(mp4|webm)$/;
export const validClipFile = (f: string) => FILE.test(f);

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'clip';

// Zeitstempel im Dateinamen nach Wiener Zeit (wie beim Hilfsdienst)
function stamp(d = new Date()): string {
  const p: Record<string, string> = {};
  for (const x of new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Vienna', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(d)) p[x.type] = x.value;
  return `${p.year}${p.month}${p.day}-${p.hour}${p.minute}${p.second}`;
}

export function saveClip(db: DB, dir: string, max: number, data: Buffer, q: Record<string, string>): Clip {
  const root = resolve(dir);
  mkdirSync(root, { recursive: true });
  const ext = q.ext === 'mp4' ? 'mp4' : 'webm';
  let file = `${stamp()}-${slug(String(q.title ?? ''))}.${ext}`;
  for (let i = 2; db.prepare('SELECT 1 FROM clips WHERE file = ?').get(file); i++) file = `${stamp()}-${slug(String(q.title ?? ''))}-${i}.${ext}`;
  writeFileSync(join(root, file), data);
  const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const c: Clip = {
    file,
    at: Date.now(),
    kind: String(q.kind ?? '').slice(0, 20),
    title: String(q.title ?? '').slice(0, 120),
    track: String(q.track ?? '').slice(0, 80),
    round: Number.isFinite(Number(q.round)) ? Number(q.round) : null,
    dur: Math.round(num(q.dur) * 10) / 10,
    score: num(q.score),
    lang: q.lang === 'en' ? 'en' : 'de',
    hidden: 0,
  };
  db.prepare('INSERT INTO clips (file, at, kind, title, track, round, dur, score, lang, size, hidden) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)').run(c.file, c.at, c.kind, c.title, c.track, c.round, c.dur, c.score, c.lang, data.length);
  prune(db, root, max);
  return c;
}

// nur die neuesten behalten; Dateien ohne Eintrag (abgebrochen) und Einträge ohne Datei aufräumen
export function prune(db: DB, dir: string, max: number): number {
  const root = resolve(dir);
  const old = db.prepare('SELECT file FROM clips ORDER BY at DESC LIMIT -1 OFFSET ?').all(max) as { file: string }[];
  for (const { file } of old) {
    rmSync(join(root, file), { force: true });
    db.prepare('DELETE FROM clips WHERE file = ?').run(file);
  }
  let files: string[] = [];
  try {
    files = readdirSync(root);
  } catch {
    return old.length;
  }
  const known = new Set((db.prepare('SELECT file FROM clips').all() as { file: string }[]).map((r) => r.file));
  for (const f of files) if (validClipFile(f) && !known.has(f) && Date.now() - statSync(join(root, f)).mtimeMs > 3600e3) rmSync(join(root, f), { force: true });
  for (const f of known) if (!files.includes(f)) db.prepare('DELETE FROM clips WHERE file = ?').run(f);
  return old.length;
}

export function listClips(db: DB, opts: { limit?: number; before?: number; withHidden?: boolean } = {}): Clip[] {
  const limit = Math.min(60, Math.max(1, opts.limit ?? 24));
  return db
    .prepare(`SELECT file, at, kind, title, track, round, dur, score, lang, hidden FROM clips WHERE at < ? ${opts.withHidden ? '' : 'AND hidden = 0'} ORDER BY at DESC LIMIT ?`)
    .all(opts.before ?? 8.64e15, limit) as Clip[];
}
export const clipVisible = (db: DB, file: string) => !!db.prepare('SELECT 1 FROM clips WHERE file = ? AND hidden = 0').get(file);
