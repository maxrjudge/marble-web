// Start: Einstellungen lesen, Seite und WebSockets auf HOST:PORT (hinter Caddy).
import { buildApp, VERSION } from './app.js';
import { configProblems, loadConfig } from './config.js';

const c = loadConfig();
const { app } = await buildApp(c);
for (const p of configProblems(c)) console.warn(`[marble-web] ${p}`);
await app.listen({ port: c.port, host: c.host });
console.log(`[marble-web] ${VERSION} läuft auf http://${c.host}:${c.port} (${c.baseUrl})`);
for (const sig of ['SIGINT', 'SIGTERM'] as const)
  process.on(sig, () => {
    void app.close().then(() => process.exit(0));
  });
