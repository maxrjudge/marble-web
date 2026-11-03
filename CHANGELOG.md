# Änderungen

Fassungen der MarbleArena-Website (arena.maxr.at).

**Schema** `MAJOR.MINOR.PATCH`:

- **PATCH**: Fehler behoben, Texte, Kleinigkeiten. Gefahrlos tauschen.
- **MINOR**: Neues dazu. Datenbank und Einstellungen bleiben gültig (neue Tabellen legt der Server selbst an).
- **MAJOR**: Datenbank oder Anschluss der Arena ändern sich so, dass alte und neue Teile nicht mehr zusammenpassen. Steht dann hier unter „Achtung“.

Neue Fassung: `node scripts/version.mjs patch|minor|major`.

## Unveröffentlicht

## 0.3.1 – 2026-11-03

- Caddy-Block ohne eigene Logdatei (Zugriffe ins Journal): nach `caddy validate` als root gehörte `/var/log/caddy/arena.maxr.at.log` root, der Reload scheiterte mit „permission denied“

## 0.3.0 – 2026-10-31

- Etappe 3: Clips – die Arena lädt jeden Auto-Clip auf die Seite hoch (`/arena-api/clip`, MP4 oder WebM bis 80 MB); Seite „Clips“ mit allen Clips (Hochformat, abspielbar, „Link kopieren“ auf genau diesen Clip, „Mehr laden“), die neuesten vier unter dem Livebild; behalten werden die neuesten 300 (`CLIPS_MAX`), Ordner `CLIPS_DIR`
- Spielplan als eigene Seite: die ganze Woche aus der Arena (kommt alle 15 s mit, bleibt am Server gespeichert, auch wenn die Arena gerade nicht da ist) und „Als Nächstes“
- Moderation: an jeder Zeile löschen, 5 Minuten oder 1 Stunde stumm, sperren (mit Rückfrage); Twitch-Zeilen lassen sich auf der Seite ausblenden; Mods kann man nicht stummschalten. Eigene Seite „Mod“ (nur für Mods): Langsam-Modus (aus, 3, 10, 30, 60 s je Zeile, Hinweis unter dem Eingabefeld für alle), Wortfilter, wer stumm oder gesperrt ist (mit „Aufheben“), Protokoll der letzten 50 Mod-Aktionen; Clips ausblenden

## 0.2.0 – 2026-10-31

- Etappe 2: Mitspielen per Knopf – Mitfahren, Murmel-Eigenschaft (bzw. Kreisel-Typ und Drehrichtung), Wetten (Starter mit Quote, Einsatz 10–500 S), Banane auf Abschnitt 1–10, Tagesbonus; Lotto (Quicktipp oder eigene 6 Zahlen), Glücksrad (Farbe, Hälfte, Jackpot, Einsatz), Münzschieber (Bahn 1–5, 1–3 Münzen) vorne, wenn sie als Nächstes dran sind, sonst unter „Auch dabei“; im Rennen Eingriffe für Last Car Standing und Kreiselkampf (mit Ziel) und Anfeuern. Jeder Knopf schickt den normalen Befehl, die Antwort der Arena steht unter den Knöpfen
- Runde im Takt mit dem Bild: über dem Livebild Runde, Spielart, Strecke, im Rennen die ersten drei, in der Siegerehrung der Sieg – um so viel später, wie das Bild hinterher ist (`delay_ms` vom LSM-Embed); darunter die Leiste in echter Zeit (Anmeldung schließt in …, Start in …, nächste Runde, Plätze im Feld)
- „Gleich dran“ (Spielplan der Arena) und Woche (die ersten fünf, Finale) neben den Knöpfen; ohne Arena kommt die Woche vom Server
- Bestenliste als eigene Seite: Woche (beste 20 Rennen, wie in der Arena), ewig nach Siegen und nach Erfahrung, der eigene Platz markiert
- Konto: Stufe und Titel, Erfahrung mit Balken bis zur nächsten Stufe, Platz in der Woche, letzte Runden (je Runde Spielart, Platz, Schilling) – aufgezeichnet aus den Spielständen, die die Arena schickt
- Befehle haben eine eigene Bremse (8 in 10 s) statt „eine Zeile je Sekunde“, damit mehrere Knöpfe schnell hintereinander gehen

## 0.1.0 – 2026-10-31

- Etappe 1 der Website: Livebild aus LSM als Embed (Low Latency über SLDP/Nimio, Verzögerung per `postMessage` unter dem Bild), Chat mit Twitch-Brücke in beide Richtungen (`[web] Name: Text` nach Twitch, Twitch-Zeilen auf der Seite), Anmeldung mit Twitch oder Link per Mail (ohne Passwort), erstes Einrichten mit Name, Murmelfarbe und Altersbestätigung, Kontoseite mit Spielstand, Verknüpfungen, Datenauskunft und Löschen
- Anschluss der Murmel-Arena (`/arena` mit Token): Befehle von der Seite kommen in der Arena an, Antworten nur beim Absender, Ferdls Ansagen für alle, Spielstände am Server (`/arena-api/profiles`, dasselbe Protokoll wie der Hilfsdienst); Übernahme aus dem Hilfsdienst mit `import-profiles`
- Moderation: Twitch-Mods automatisch, eigene Mods, Löschen und 10 Minuten Stummschalten, Bremse (1 je Sekunde, 5 in 10 s), Links nur für Mods, Wortfilter und Namenssperren; `/admin` mit Bot-Anschluss, Brücke an/aus, Listen
- Deutsch/Englisch umschaltbar, Handy-Ansicht
- Sicherheit: Sitzungen nur gehasht in der Datenbank, Cookie `httpOnly`/`SameSite=Lax`/`Secure`, Herkunftsprüfung für alle Formulare (auch `/admin`), Content-Security-Policy (Rahmen nur `io.maxr.at`, keine Fremd-Einbettung der Seite), Referrer-Policy wie LSM sie braucht
- Betrieb: systemd-Unit mit Schutz-Einstellungen, Caddy-Block, Vorlage für `/etc/marble-web.env` (nur Platzhalter), Update-Skript
