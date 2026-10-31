// Fassungen verwalten.  node scripts/version.mjs [check | patch | minor | major | 1.2.3] [--ohne-git] [--leer]
//   check     prüft, ob package.json, VERSION im Server und CHANGELOG.md zusammenpassen
//   patch …   neue Nummer: package.json (+ lock), VERSION in server/app.ts, „## Unveröffentlicht“ in CHANGELOG.md
//             wird zum Eintrag mit Datum; ohne --ohne-git dazu Commit „Fassung x.y.z“ und Tag vx.y.z
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const P = { pkg: join(ROOT, 'package.json'), lock: join(ROOT, 'package-lock.json'), app: join(ROOT, 'server/app.ts'), log: join(ROOT, 'CHANGELOG.md') };
const read = (p) => readFileSync(p, 'utf8');
const args = process.argv.slice(2);
const what = args.find((a) => !a.startsWith('--')) ?? 'check';
const flag = (f) => args.includes(f);

function stand() {
  const pkg = JSON.parse(read(P.pkg)).version;
  const app = read(P.app).match(/export const VERSION = '([^']+)'/)?.[1];
  const log = read(P.log);
  const offen = log.match(/## Unveröffentlicht\n([\s\S]*?)(?=\n## |$)/)?.[1].trim() ?? '';
  return { pkg, app, log, offen, eintrag: new RegExp(`^## ${pkg.replace(/\./g, '\\.')} `, 'm').test(log) };
}

function check() {
  const s = stand();
  const fehler = [];
  if (s.app !== s.pkg) fehler.push(`server/app.ts ${s.app}, package.json ${s.pkg}`);
  if (!s.eintrag) fehler.push(`CHANGELOG.md hat keinen Eintrag „## ${s.pkg} …“`);
  console.log(`Fassung ${s.pkg}${s.offen ? ` · unveröffentlicht: ${s.offen.split('\n').filter((l) => l.startsWith('- ')).length} Punkte` : ''}`);
  for (const f of fehler) console.log('FEHLER', f);
  return fehler.length === 0;
}

if (what === 'check') process.exit(check() ? 0 : 1);

const s = stand();
const [ma, mi, pa] = s.pkg.split('.').map(Number);
const neu = what === 'major' ? `${ma + 1}.0.0` : what === 'minor' ? `${ma}.${mi + 1}.0` : what === 'patch' ? `${ma}.${mi}.${pa + 1}` : /^\d+\.\d+\.\d+$/.test(what) ? what : null;
if (!neu) {
  console.log('node scripts/version.mjs [check | patch | minor | major | 1.2.3] [--ohne-git] [--leer]');
  process.exit(1);
}
if (!s.offen && !flag('--leer')) {
  console.log('Unter „## Unveröffentlicht“ in CHANGELOG.md steht nichts – erst eintragen, was neu ist (oder --leer).');
  process.exit(1);
}
const datum = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Vienna' }).format(new Date());
writeFileSync(P.log, s.log.replace(/## Unveröffentlicht\n[\s\S]*?(?=\n## |$)/, `## Unveröffentlicht\n\n## ${neu} – ${datum}\n\n${s.offen}\n`));
writeFileSync(P.pkg, read(P.pkg).replace(/"version": "[^"]+"/, `"version": "${neu}"`));
if (existsSync(P.lock)) writeFileSync(P.lock, read(P.lock).replace(/("name": "marble-web",\s*"version": )"[^"]+"/g, `$1"${neu}"`));
writeFileSync(P.app, read(P.app).replace(/export const VERSION = '[^']+'/, `export const VERSION = '${neu}'`));
console.log(`Fassung ${s.pkg} -> ${neu}`);
if (!check()) process.exit(1);
if (!flag('--ohne-git') && existsSync(join(ROOT, '.git'))) {
  const git = (c) => execSync(`git ${c}`, { cwd: ROOT, stdio: 'pipe' }).toString().trim();
  git('add -A');
  git(`commit -q -m "Fassung ${neu}"`);
  git(`tag -a v${neu} -m "Fassung ${neu}"`);
  console.log(`git: Commit ${git('rev-parse --short HEAD')}, Tag v${neu}`);
}
