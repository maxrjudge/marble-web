# MarbleArena-Website (marble-web)

Die Seite **arena.maxr.at**: Livebild der Murmel-Arena aus LSM (Low-Latency-Embed, SLDP/Nimio), Chat mit Brücke zu Twitch in beide Richtungen, Anmeldung mit Twitch oder per E-Mail-Link (ohne Passwort), Spielstand und Konto. Die Arena hängt sich als zweiter Chat an: Befehle von der Seite (`!join`, `!wette` …) kommen in der Arena an, Ferdls Ansagen und die Antworten der Arena kommen zurück, die Spielstände liegen am Server.

Dazu Mitspielen per Knopf (Mitfahren, Wetten, Banane, Lotto, Glücksrad, Münzschieber, Eingriffe), über dem Bild der Stand der Runde im Takt mit dem Livebild, Bestenliste (Woche und ewig) und im Konto Stufe, Titel und die letzten Runden.

Twitch bleibt der Hauptkanal; die Seite ist ein zweiter Weg hinein. Die Oberfläche ist Deutsch/Englisch umschaltbar (ein Stream, ein Chat).

## Aufbau

| Teil | Wo | Was |
|---|---|---|
| Server | `server/` | Node 22, Fastify, SQLite (better-sqlite3), WebSockets (`ws`), nodemailer |
| Seite | `web/` | Vite + TypeScript ohne Framework, gebaut nach `dist/public` |
| Betrieb | `deploy/` | systemd-Unit, Caddy-Block, Vorlage für die Einstellungen, Update-Skript |
| Prüfungen | `test/`, `scripts/arena-integration.mjs` | Ende-zu-Ende mit nachgebautem Twitch; Zusammenspiel mit der echten Arena im Browser |

Wege am Server:

- `/` die Seite, `/impressum.html`, `/datenschutz.html`, `/regeln.html`
- `/api/…` Konto, Einstellungen, Spielstand mit Stufe, Titeln, Wochenplatz und letzten Runden (`/api/profile`), Bestenliste (`/api/board`), Datenauskunft, Löschen
- `/auth/twitch`, `/auth/mail` Anmeldung (Twitch-OAuth bzw. Link per Mail, 15 Minuten gültig, einmal benutzbar)
- `/ws` Chat der Seite (WebSocket, Sitzungs-Cookie)
- `/arena` Anschluss der Arena (WebSocket mit `ARENA_TOKEN`, die neueste Arena gewinnt)
- `/arena-api/profiles` Spielstände für die Arena (dasselbe Protokoll wie der Hilfsdienst: GET alle, POST geänderte, je Nutzer gewinnt der neuere Stand)
- `/admin` Verwaltung (Benutzer `admin`, Passwort `ADMIN_PASSWORD`)

## Einrichten am Server (IONOS-Ubuntu, Caddy)

Einmalig, als root bzw. mit sudo:

```bash
# Node 22 (falls noch nicht da) und ein eigener Benutzer
id marble-web || useradd --system --home /opt/marble-web --shell /usr/sbin/nologin marble-web
mkdir -p /opt/marble-web && chown marble-web:marble-web /opt/marble-web

# Quellcode nach /opt/marble-web (git clone oder Zip auspacken), dann:
cd /opt/marble-web
sudo -u marble-web npm ci && sudo -u marble-web npm run build && sudo -u marble-web npm prune --omit=dev

# Einstellungen: Vorlage kopieren, Werte eintragen (Geheimnisse nur hier, nicht im Git, nicht im Chat)
cp deploy/marble-web.env.example /etc/marble-web.env
chmod 600 /etc/marble-web.env && chown root:root /etc/marble-web.env
nano /etc/marble-web.env

# Dienst
cp deploy/marble-web.service /etc/systemd/system/
systemctl daemon-reload && systemctl enable --now marble-web
journalctl -u marble-web -n 20     # zeigt, was in den Einstellungen noch fehlt

# Caddy: Block aus deploy/Caddyfile in /etc/caddy/Caddyfile einfügen
systemctl reload caddy
```

Der Code liegt im privaten GitHub-Repo `maxrjudge/marble-web` (Zweig `main`), Neues wird dorthin gepusht. Erstes Einrichten mit `git clone git@github.com:maxrjudge/marble-web.git /opt/marble-web` (bzw. HTTPS, wie bei HORDE). Update später (im Ordner `/opt/marble-web`, als root, holt den Stand aus GitHub, baut, startet neu, Datenbank bleibt):

```bash
sudo deploy/update.sh
```

Die Datenbank liegt unter `/var/lib/marble-web/marble-web.db` (systemd legt den Ordner an). Sicherung: `sqlite3 /var/lib/marble-web/marble-web.db ".backup /root/marble-web-$(date +%F).db"`.

### Einstellungen (`/etc/marble-web.env`)

| Name | Wofür |
|---|---|
| `BASE_URL` | `https://arena.maxr.at` (für Links in Mails, Twitch-Rücksprung, Herkunftsprüfung) |
| `LSM_STREAM_KEY` | Stream-Schlüssel aus LSM (Stream › Teilen & Einbetten); ohne ihn kein Livebild |
| `LSM_EMBED_BASE` | Vorgabe `https://io.maxr.at/embed/live/` |
| `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET` | Twitch-App; ohne sie keine Twitch-Anmeldung und keine Brücke von der Seite nach Twitch |
| `TWITCH_CHANNEL` | Vorgabe `marblearena` |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` | Versand der Anmelde-Links; ohne `SMTP_HOST` keine Anmeldung per Mail |
| `ARENA_TOKEN` | Schlüssel, mit dem sich die Arena anmeldet (mind. 16 Zeichen, `openssl rand -hex 24`) |
| `ADMIN_PASSWORD` | `/admin` (mind. 10 Zeichen) |
| `PORT`, `HOST`, `DB_PATH` | Vorgaben 5310, 127.0.0.1, `marble-web.db` |
| `CLIPS_DIR`, `CLIPS_MAX` | Ordner für die Clips der Arena (Vorgabe `clips`, am Server `/var/lib/marble-web/clips`) und wie viele bleiben (300) |

Was fehlt, steht beim Start im Log und oben auf `/admin`. Die Seite läuft auch mit Lücken (z. B. ohne Mail nur Twitch-Anmeldung).

### Twitch

1. In der Twitch-App (dev.twitch.tv › Console) als OAuth-Redirect `https://arena.maxr.at/auth/twitch` eintragen.
2. `/admin` öffnen › „Bot-Konto verbinden“. Bei Twitch mit dem Konto anmelden, das die Zeilen von der Seite in den Twitch-Chat schreiben soll (eigener Bot oder der Kanal selbst). Verlangt werden nur `chat:read` und `chat:edit`. Der Schlüssel wird am Server erneuert, solange er gültig bleibt.
3. Ohne Bot liest die Seite den Twitch-Chat trotzdem mit (anonym), schreibt aber nicht hinein.

Zeilen von der Seite stehen in Twitch als `[web] Name: Text`. Befehle (`!…`) gehen nur an die Arena, nicht in den Twitch-Chat. Die Brücke lässt sich in `/admin` abschalten.

### LSM

1. In LSM beim Stream unter „Teilen & Einbetten“ die Domain `arena.maxr.at` freigeben.
2. „Echtzeit wie die Livestream-Seite“ einschalten, Start „Automatisch“.
3. Den Stream-Schlüssel (`https://io.maxr.at/livestream/<schlüssel>/`) als `LSM_STREAM_KEY` eintragen.

Die Seite bettet nur das iframe ein; Stream-Adressen und Signaturen (publishsign/WMSAuth) bleiben bei LSM. Über `postMessage` meldet das Embed, wie weit das Bild hinter echt ist (`delay_ms`). Die Seite zeigt das unter dem Bild an. Die Content-Security-Policy erlaubt nur `https://io.maxr.at` als Rahmen. Die Referrer-Policy steht auf `strict-origin-when-cross-origin`, nie `no-referrer`, weil LSM die einbettende Domain prüft.

### Arena anschließen

An die Adresse der Arena (Browserquelle in OBS) zwei Teile anhängen:

```
&seite=https://arena.maxr.at&seitentoken=<ARENA_TOKEN>
```

Dann:

- Chat-Zeilen von der Seite kommen in der Arena an wie Twitch-Zeilen. Nutzer, die sich nur per Mail angemeldet haben, heißen in der Arena `web:<name>`.
- Antworten der Arena (fährt mit, Wette angenommen, Fehler) bekommt nur der Absender. Ferdls Ansagen gehen an alle.
- Die Statuszeile der Arena zeigt „Website verbunden“.
- Die Spielstände liegen dann am Server statt im Hilfsdienst. Beim ersten Verbinden lädt die Arena ihren eigenen Stand hoch, je Nutzer gewinnt der neuere.

Spielstände aus dem Hilfsdienst einmalig übernehmen:

```bash
cd /opt/marble-web
sudo MARBLE_ENV=/etc/marble-web.env node dist/server/import-profiles.js /pfad/zu/profiles.json
sudo chown -R marble-web:marble-web /var/lib/marble-web
```

Mehrmaliges Ausführen schadet nicht: je Nutzer gewinnt der neuere Stand.

## Mitspielen und Runde im Takt

Die Arena meldet einmal je Sekunde ihren Zustand über `/arena` (Phase, Spielart, Strecke, Anmeldung und Start in ms, wer angemeldet ist, Starter mit Quoten, Rangliste im Rennen, Ergebnis, Lotto/Rad/Münzschieber, Spielplan, Woche). Der Server reicht ihn an alle Browser weiter; wer neu kommt, bekommt den letzten Stand gleich mit.

- **Über dem Bild** zeigt die Seite Runde, Spielart, Strecke und im Rennen die ersten drei. Was das Bild betrifft, kommt so viel später, wie das LSM-Embed hinterher ist (`delay_ms`): die Seite hält die Meldungen zurück, bis das Bild so weit ist. Meldet das Embed nichts (oder spielt nicht), zeigt sie den neuesten Stand.
- **Die Leiste darunter** läuft in echter Zeit: „Anmeldung schließt in 0:03“, „Start in 0:12“, „nächste Runde in 0:20“. Die Arena entscheidet, wann zu ist; zählt die Seite mit Verzögerung, kämen Klicks zu spät.
- **Knöpfe** schicken normale Chat-Befehle (`!join`, `!perk gummi`, `!wette Pepi 50`, `!banane 4`, `!daily`, `!tipp quick`, `!tipp 3 12 17 25 33 41`, `!rad rot 50`, `!muenze 3 2`, `!kreisel angriff`, `!reparatur Name` …) über den Chat der Seite an die Arena. Sie erscheinen nicht im Chat; die Antwort der Arena kommt nur beim Absender an (als Meldung und unter den Knöpfen). Für Befehle gilt eine eigene Bremse: 8 in 10 Sekunden.
- **Letzte Runden im Konto:** Der Server vergleicht jeden Spielstand, den die Arena schickt, mit dem vorigen und schreibt die Änderung der laufenden Runde zu (Schilling, Erfahrung, mitgefahren; den Platz aus dem Ergebnis, die ersten zehn). Eine Wette, die in der Siegerehrung für das nächste Rennen gesetzt wird, steht deshalb bei der Runde, in der sie gesetzt wurde. Aufbewahrt 90 Tage.
- **Bestenliste:** Woche wie in der Arena (beste 20 Rennen, Montag bis Sonntag, Wiener Zeit), ewig nach Siegen und nach Erfahrung; gerechnet aus den Spielständen am Server, höchstens alle 20 Sekunden neu.

## Clips, Spielplan, Moderation

- **Clips:** Mit `&seite=…` nimmt die Arena ihre Auto-Clips auch ohne Hilfsdienst auf (einschalten mit `&clips=1` oder in der Regie) und lädt jeden auf die Seite hoch. Sie liegen in `CLIPS_DIR` (am Server `/var/lib/marble-web/clips`), die neuesten `CLIPS_MAX` (Vorgabe 300) bleiben. Die Seite „Clips“ zeigt sie, „Link kopieren“ teilt genau einen (`/#clip=<datei>`). Mods können einen Clip ausblenden; dann ist auch die Datei nicht mehr abrufbar. Die Clips beim Hilfsdienst (Regie, Best-of) bleiben wie bisher.
- **Spielplan:** Die Arena schickt alle 15 Sekunden die ganze Woche mit; der Server hebt sie auf (`/api/plan`), die Seite „Spielplan“ zeigt sie auch, wenn die Arena gerade nicht verbunden ist.
- **Moderation:** Mods (Twitch-Mods des Kanals, sobald sie mit Twitch angemeldet sind, und eigene Mods aus `/admin`) haben an jeder Zeile Werkzeuge: löschen, 5 Minuten, 1 Stunde, sperren. Twitch-Zeilen lassen sich nur auf der Seite ausblenden (in Twitch bleiben sie). Die Seite „Mod“ hat den Langsam-Modus, den Wortfilter, die Liste der Stummen und Gesperrten zum Aufheben und das Protokoll. Gesperrte können nichts mehr schreiben und nicht mitspielen; neu anmelden geht für sie nicht.

## Konten und Regeln

- Zuschauen geht ohne Konto. Zum Mitfahren, Wetten und Chatten braucht es eines: Twitch oder Link per Mail, kein Passwort.
- Wer schon über Twitch gespielt hat, meldet sich mit Twitch an und hat seinen Stand sofort.
- Name: 3–20 Zeichen, Buchstaben, Ziffern, `_ . -`. Reservierte Namen (Ferdl, Resi, Admin, Mod …) und Namen aus der Sperrliste gehen nicht. Ein reines Mail-Konto behält seinen Namen, sobald die Arena einen Spielstand dazu hat (der Name ist dort der Schlüssel).
- Schilling sind Spielgeld: nicht kaufbar, nicht auszahlbar. Mindestalter 14, bestätigt bei der Anmeldung.
- Chat: eine Zeile je Sekunde, höchstens 5 in 10 Sekunden. Links nur von Mods. Wortfilter in `/admin`.
- Mods: Twitch-Mods des Kanals werden automatisch erkannt; eigene Mods für die Seite in `/admin`. Mods können Zeilen löschen und für 10 Minuten stummschalten.
- Konto: Daten als JSON herunterladen, Konto löschen (Name, Chat, Sitzungen; ohne Twitch auch der Spielstand).

Impressum, Datenschutz und Regeln liegen als Vorlagen in `web/public/`. Alles in [eckigen Klammern] vor dem Start ausfüllen.

## Entwickeln

```bash
npm ci
npm run dev        # Server mit tsx (lädt .env im Projektordner)
npx vite           # Seite mit Neuladen, leitet /api, /auth, /ws an den Server weiter
npm test           # Ende-zu-Ende: Anmeldung, Chat, Brücke, Arena, Admin (nachgebautes Twitch)
npm run check      # Typen Server und Seite
npm run build      # dist/public + dist/server
```

Zusammenspiel mit der echten Arena (gebaute Murmel-Arena im Nachbarordner, Seite läuft lokal mit `ARENA_TOKEN=arena-token-0123456789`):

```bash
node scripts/arena-integration.mjs
```

## Fassungen

`MAJOR.MINOR.PATCH` wie bei der Arena. Neues kommt in `CHANGELOG.md` unter „## Unveröffentlicht“, dann:

```bash
node scripts/version.mjs patch|minor|major   # Nummer in package.json und server/app.ts, Eintrag mit Datum, Commit und Tag
node scripts/version.mjs check               # passt alles zusammen?
```
