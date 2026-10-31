// Profile der Arena am Server: dasselbe Protokoll wie der Hilfsdienst (tools/arena-helfer.py) – GET liefert alle,
// POST nimmt geänderte; je Nutzer gewinnt der neuere Stand (updatedAt). Die Arena zeigt mit &seite= hierher.
import type { DB } from './db.js';

export type ProfileJson = Record<string, unknown> & { user?: string; name?: string; updatedAt?: number; s?: number; xp?: number };

export function allProfiles(db: DB): Record<string, ProfileJson> {
  const out: Record<string, ProfileJson> = {};
  for (const r of db.prepare('SELECT user_key, json FROM profiles').iterate() as Iterable<{ user_key: string; json: string }>) {
    try {
      out[r.user_key] = JSON.parse(r.json);
    } catch {
      /* kaputter Eintrag: überspringen */
    }
  }
  return out;
}

// onChange: je übernommenem Profil alter und neuer Stand (für die letzten Runden)
export function mergeProfiles(db: DB, incoming: unknown, onChange?: (key: string, old: ProfileJson | null, neu: ProfileJson) => void): number {
  if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) return 0;
  const get = db.prepare('SELECT updated_at, json FROM profiles WHERE user_key = ?');
  const put = db.prepare('INSERT INTO profiles (user_key, json, updated_at) VALUES (?, ?, ?) ON CONFLICT(user_key) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at');
  let n = 0;
  db.transaction(() => {
    for (const [key, p] of Object.entries(incoming as Record<string, unknown>)) {
      if (!key || key.length > 80 || !p || typeof p !== 'object' || Array.isArray(p)) continue;
      const json = JSON.stringify(p);
      if (json.length > 20000) continue;
      const at = Number((p as ProfileJson).updatedAt) || 0;
      const mine = get.get(key) as { updated_at: number; json: string } | undefined;
      if (mine && at < mine.updated_at) continue;
      put.run(key, json, at);
      if (onChange) {
        let old: ProfileJson | null = null;
        try {
          old = mine ? (JSON.parse(mine.json) as ProfileJson) : null;
        } catch {
          old = null;
        }
        onChange(key, old, p as ProfileJson);
      }
      n++;
    }
  })();
  return n;
}

export function profileOf(db: DB, key: string): ProfileJson | null {
  const r = db.prepare('SELECT json FROM profiles WHERE user_key = ?').get(key) as { json: string } | undefined;
  return r ? (JSON.parse(r.json) as ProfileJson) : null;
}
