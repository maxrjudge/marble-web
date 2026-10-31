// SQLite (eine Datei, WAL): Konten, Sitzungen, E-Mail-Links, Profile der Arena, Twitch-Mods, Bot-Zugang, Chat.
import Database from 'better-sqlite3';
import { createHash, randomBytes } from 'node:crypto';

export type DB = Database.Database;

export interface User {
  id: number;
  name: string;
  color: string;
  email: string | null;
  twitch_id: string | null;
  twitch_login: string | null;
  age_ok: number;
  is_mod: number; // eigener Mod (Regie/Admin)
  muted_until: number; // ms; 0 = nicht stumm
  banned: number;
  created: number;
}

export const now = () => Date.now();
export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
export const token = (bytes = 32) => randomBytes(bytes).toString('base64url');

export function openDb(path: string): DB {
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE COLLATE NOCASE,
      color TEXT NOT NULL DEFAULT '#ff5fb0',
      email TEXT UNIQUE COLLATE NOCASE,
      twitch_id TEXT UNIQUE,
      twitch_login TEXT,
      age_ok INTEGER NOT NULL DEFAULT 0,
      is_mod INTEGER NOT NULL DEFAULT 0,
      muted_until INTEGER NOT NULL DEFAULT 0,
      banned INTEGER NOT NULL DEFAULT 0,
      created INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      id_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS magic (
      token_hash TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      expires INTEGER NOT NULL,
      used INTEGER NOT NULL DEFAULT 0,
      created INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS profiles (
      user_key TEXT PRIMARY KEY,
      json TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS twitch_mods (
      login TEXT PRIMARY KEY,
      seen INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS kv (
      k TEXT PRIMARY KEY,
      v TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS chat (
      id INTEGER PRIMARY KEY,
      ts INTEGER NOT NULL,
      source TEXT NOT NULL,
      user_key TEXT NOT NULL,
      name TEXT NOT NULL,
      color TEXT,
      text TEXT NOT NULL,
      mod INTEGER NOT NULL DEFAULT 0,
      deleted INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS chat_ts ON chat(ts);
  `);
  return db;
}

// Schlüssel, unter dem die Arena einen Nutzer kennt: mit Twitch verknüpft = Twitch-Login (dasselbe Profil wie im
// Twitch-Chat), sonst „web:<name>“
export const userKey = (u: Pick<User, 'twitch_login' | 'name'>) => (u.twitch_login ? u.twitch_login.toLowerCase() : `web:${u.name.toLowerCase()}`);

export function kvGet<T>(db: DB, k: string): T | null {
  const r = db.prepare('SELECT v FROM kv WHERE k = ?').get(k) as { v: string } | undefined;
  return r ? (JSON.parse(r.v) as T) : null;
}
export function kvSet(db: DB, k: string, v: unknown): void {
  db.prepare('INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v').run(k, JSON.stringify(v));
}

// Aufräumen: abgelaufene Sitzungen und Links, Chat älter als 30 Tage
export function housekeeping(db: DB): void {
  const t = now();
  db.prepare('DELETE FROM sessions WHERE expires < ?').run(t);
  db.prepare('DELETE FROM magic WHERE expires < ?').run(t - 86400e3);
  db.prepare('DELETE FROM chat WHERE ts < ?').run(t - 30 * 86400e3);
}
