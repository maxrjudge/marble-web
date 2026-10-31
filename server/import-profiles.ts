// Spielstände aus dem Hilfsdienst übernehmen (einmalig beim Umstieg):
//   node dist/server/import-profiles.js /pfad/zu/profiles.json
// Je Nutzer gewinnt der neuere Stand (updatedAt) – mehrmals ausführen schadet nicht.
import { readFileSync } from 'node:fs';
import { loadConfig } from './config.js';
import { openDb } from './db.js';
import { allProfiles, mergeProfiles } from './profiles.js';

const file = process.argv[2];
if (!file) {
  console.log('node dist/server/import-profiles.js profiles.json');
  process.exit(1);
}
// profiles.json des Hilfsdiensts: { twitchname: profil, … } – dasselbe Format wie GET /arena-api/profiles
const data = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
const c = loadConfig();
const db = openDb(c.dbPath);
const vorher = Object.keys(allProfiles(db)).length;
const n = mergeProfiles(db, data);
console.log(`${n} Profile übernommen (${Object.keys(data as object).length} in der Datei, vorher ${vorher}, jetzt ${Object.keys(allProfiles(db)).length} am Server).`);
db.close();
