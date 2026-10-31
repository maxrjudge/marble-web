# Änderungen

Fassungen der MarbleArena-Website (arena.maxr.at).

**Schema** `MAJOR.MINOR.PATCH`:

- **PATCH**: Fehler behoben, Texte, Kleinigkeiten. Gefahrlos tauschen.
- **MINOR**: Neues dazu. Datenbank und Einstellungen bleiben gültig (neue Tabellen legt der Server selbst an).
- **MAJOR**: Datenbank oder Anschluss der Arena ändern sich so, dass alte und neue Teile nicht mehr zusammenpassen. Steht dann hier unter „Achtung“.

Neue Fassung: `node scripts/version.mjs patch|minor|major`.

## Unveröffentlicht

## 0.1.0 – 2026-10-31

- Etappe 1 der Website: Livebild aus LSM als Embed (Low Latency über SLDP/Nimio, Verzögerung per `postMessage` unter dem Bild), Chat mit Twitch-Brücke in beide Richtungen (`[web] Name: Text` nach Twitch, Twitch-Zeilen auf der Seite), Anmeldung mit Twitch oder Link per Mail (ohne Passwort), erstes Einrichten mit Name, Murmelfarbe und Altersbestätigung, Kontoseite mit Spielstand, Verknüpfungen, Datenauskunft und Löschen
- Anschluss der Murmel-Arena (`/arena` mit Token): Befehle von der Seite kommen in der Arena an, Antworten nur beim Absender, Ferdls Ansagen für alle, Spielstände am Server (`/arena-api/profiles`, dasselbe Protokoll wie der Hilfsdienst); Übernahme aus dem Hilfsdienst mit `import-profiles`
- Moderation: Twitch-Mods automatisch, eigene Mods, Löschen und 10 Minuten Stummschalten, Bremse (1 je Sekunde, 5 in 10 s), Links nur für Mods, Wortfilter und Namenssperren; `/admin` mit Bot-Anschluss, Brücke an/aus, Listen
- Deutsch/Englisch umschaltbar, Handy-Ansicht
- Sicherheit: Sitzungen nur gehasht in der Datenbank, Cookie `httpOnly`/`SameSite=Lax`/`Secure`, Herkunftsprüfung für alle Formulare (auch `/admin`), Content-Security-Policy (Rahmen nur `io.maxr.at`, keine Fremd-Einbettung der Seite), Referrer-Policy wie LSM sie braucht
- Betrieb: systemd-Unit mit Schutz-Einstellungen, Caddy-Block, Vorlage für `/etc/marble-web.env` (nur Platzhalter), Update-Skript
