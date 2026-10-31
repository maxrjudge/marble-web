// /admin: Zustand, Twitch-Bot verbinden, Brücke an/aus, Mods, Wortfilter und gesperrte Namen. Basic-Auth (admin).
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export interface AdminStatus {
  version: string;
  problems: string[];
  arena: { since: number; version: string } | null;
  twitch: { status: string; write: boolean; bot: string | null } | null;
  bridge: boolean;
  viewers: number;
  users: number;
  mods: string[];
  twitchMods: string[];
  filter: string[];
  namesBlocked: string[];
}

export function adminPage(s: AdminStatus): string {
  const row = (k: string, v: string) => `<tr><th>${esc(k)}</th><td>${v}</td></tr>`;
  const since = s.arena ? new Date(s.arena.since).toLocaleString('de-AT') : '';
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MarbleArena Admin</title>
<style>
body{margin:0;background:#0b1222;color:#f4f6fb;font:15px/1.5 system-ui,sans-serif}
main{max-width:860px;margin:0 auto;padding:24px 16px}
h1{font-size:24px;margin:0 0 16px}h2{font-size:17px;margin:28px 0 8px}
table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:8px 10px;border-top:1px solid rgba(255,255,255,.1);vertical-align:top}th{width:200px;color:#a9b3c7;font-weight:600}
.ok{color:#9fe3a8}.bad{color:#ffb0a8}.hint{color:#a9b3c7;font-size:13px}
form{display:inline-flex;gap:8px;flex-wrap:wrap;align-items:center;margin:4px 0}
input,textarea,button,a.btn{font:inherit;border-radius:10px;border:1px solid rgba(255,255,255,.18);background:#121a2e;color:#f4f6fb;padding:8px 12px}
textarea{width:100%;min-height:90px;box-sizing:border-box}button,a.btn{cursor:pointer;background:#f6c343;color:#1a1300;border:0;font-weight:700;text-decoration:none;display:inline-block}
button.sec{background:#17213a;color:#f4f6fb;border:1px solid rgba(255,255,255,.18)}
ul{margin:4px 0;padding-left:20px}
</style></head><body><main>
<h1>MarbleArena Admin <span class="hint">${esc(s.version)}</span></h1>
${s.problems.length ? `<p class="bad">${s.problems.map(esc).join('<br>')}</p>` : '<p class="ok">Einstellungen vollständig.</p>'}
<table>
${row('Arena', s.arena ? `<span class="ok">verbunden</span> seit ${esc(since)}${s.arena.version ? ` · ${esc(s.arena.version)}` : ''}` : '<span class="bad">nicht verbunden</span>')}
${row('Twitch-Chat', s.twitch ? `${esc(s.twitch.status)} · ${s.twitch.write ? `<span class="ok">schreibt als ${esc(s.twitch.bot)}</span>` : '<span class="bad">liest nur (kein Bot)</span>'}` : 'aus')}
${row('Brücke', s.bridge ? '<span class="ok">an</span> (beide Richtungen)' : '<span class="bad">aus</span>')}
${row('Gerade auf der Seite', String(s.viewers))}
${row('Konten', String(s.users))}
</table>
<h2>Twitch-Bot</h2>
<p class="hint">Mit dem Konto anmelden, das in der Brücke schreibt (z. B. ein eigener Bot-Account). Rechte: Chat lesen und schreiben.</p>
<a class="btn" href="/auth/twitch?bot=1">${s.twitch?.bot ? 'Anderes Konto verbinden' : 'Bot-Konto verbinden'}</a>
${s.twitch?.bot ? `<form method="post" action="/admin/bot/disconnect"><button class="sec">Bot trennen</button></form>` : ''}
<h2>Brücke</h2>
<form method="post" action="/admin/bridge"><input type="hidden" name="on" value="${s.bridge ? '0' : '1'}"><button class="sec">${s.bridge ? 'Brücke ausschalten' : 'Brücke einschalten'}</button></form>
<h2>Mods</h2>
<p class="hint">Twitch-Mods sind automatisch Mods auf der Seite, sobald sie ihr Konto mit Twitch verknüpfen. Eigene Mods hier nach Namen:</p>
<form method="post" action="/admin/mod"><input name="name" placeholder="Name auf der Seite" required><input type="hidden" name="on" value="1"><button>Zum Mod machen</button></form>
<ul>${s.mods.map((m) => `<li>${esc(m)} <form method="post" action="/admin/mod"><input type="hidden" name="name" value="${esc(m)}"><input type="hidden" name="on" value="0"><button class="sec">entfernen</button></form></li>`).join('') || '<li class="hint">keine</li>'}</ul>
<p class="hint">Twitch-Mods (gesehen im Twitch-Chat): ${s.twitchMods.map(esc).join(', ') || 'noch keine'}</p>
<h2>Wortfilter und gesperrte Namen</h2>
<form method="post" action="/admin/lists" style="display:block">
<label class="hint">Wortfilter (eines je Zeile): Nachrichten damit kommen nicht in den Chat</label>
<textarea name="filter">${esc(s.filter.join('\n'))}</textarea>
<label class="hint">Gesperrte Namensteile (eines je Zeile)</label>
<textarea name="namesBlocked">${esc(s.namesBlocked.join('\n'))}</textarea>
<p><button>Speichern</button></p>
</form>
</main></body></html>`;
}
