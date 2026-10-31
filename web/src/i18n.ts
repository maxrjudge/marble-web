// Oberfläche Deutsch/Englisch (ein Stream, ein Chat – nur die Seite wechselt die Sprache)
export type Lang = 'de' | 'en';
const T = {
  nav_live: ['Live', 'Live'],
  nav_konto: ['Konto', 'Account'],
  login: ['Anmelden', 'Log in'],
  chat: ['Chat', 'Chat'],
  say_label: ['Nachricht an alle (auch im Twitch-Chat)', 'Message to everyone (also in the Twitch chat)'],
  say_ph: ['Schreib was oder !befehl', 'Say something or !command'],
  send: ['Senden', 'Send'],
  login_to_chat: ['Anmelden zum Mitschreiben', 'Log in to chat'],
  settings: ['Einstellungen', 'Settings'],
  display_name: ['Anzeigename', 'Display name'],
  color: ['Farbe der Murmel', 'Marble colour'],
  save: ['Speichern', 'Save'],
  saved: ['Gespeichert.', 'Saved.'],
  linked: ['Verknüpft', 'Linked'],
  link_twitch: ['Verknüpfen', 'Link'],
  email: ['E-Mail-Adresse', 'Email address'],
  email_ph: ['du@beispiel.at', 'you@example.com'],
  send_link: ['Link schicken', 'Send link'],
  your_data: ['Deine Daten', 'Your data'],
  download: ['Meine Daten herunterladen', 'Download my data'],
  logout: ['Abmelden', 'Log out'],
  delete: ['Konto löschen', 'Delete account'],
  delete_q: ['Konto wirklich löschen? Name, Chat und (ohne Twitch) dein Spielstand sind dann weg.', 'Really delete your account? Name, chat and (without Twitch) your game progress will be gone.'],
  imprint: ['Impressum', 'Imprint'],
  privacy: ['Datenschutz', 'Privacy'],
  rules: ['Regeln', 'Rules'],
  login_title: ['Anmelden zum Mitspielen', 'Log in to play'],
  login_text: ['Zuschauen geht ohne Konto. Zum Mitfahren, Wetten und Chatten brauchst du eines – ohne Passwort.', 'Watching needs no account. To race, bet and chat you need one – no password.'],
  with_twitch: ['Mit Twitch anmelden', 'Log in with Twitch'],
  twitch_hint: ['Schon über Twitch gespielt? Dein Spielstand ist sofort da.', 'Played via Twitch before? Your progress is there right away.'],
  or: ['oder', 'or'],
  login_none: ['Anmelden ist gerade nicht eingerichtet – zuschauen geht trotzdem.', 'Logging in is not set up right now – you can still watch.'],
  schilling_note: ['Schilling sind Spielgeld: nicht kaufbar, nicht auszahlbar.', 'Schilling are play money: not for sale, not paid out.'],
  welcome: ['Willkommen!', 'Welcome!'],
  name_rule: ['3–20 Zeichen: Buchstaben, Ziffern, _ . -', '3–20 characters: letters, digits, _ . -'],
  age: ['Ich bin mindestens 14 Jahre alt und einverstanden mit den Regeln und dem Datenschutz.', 'I am at least 14 years old and agree to the rules and the privacy policy.'],
  lets_go: ["Los geht's", "Let's go"],
  mail_sent: ['Link ist unterwegs – schau in dein Postfach (auch im Spam).', 'Link is on its way – check your inbox (and spam).'],
  viewers: ['{n} da', '{n} here'],
  arena_on: ['Arena verbunden', 'Arena connected'],
  arena_off: ['Arena gerade nicht verbunden', 'Arena not connected right now'],
  no_stream: ['Das Livebild ist noch nicht eingerichtet.', 'The live picture is not set up yet.'],
  st_playing: ['Live · Bild {d} s hinter echt', 'Live · picture {d} s behind real time'],
  st_hls: ['Ersatz-Stream · Bild {d} s hinter echt', 'Fallback stream · picture {d} s behind real time'],
  st_waiting: ['Stream startet gleich', 'Stream starting soon'],
  st_offline: ['Stream gerade offline', 'Stream offline right now'],
  st_loading: ['Stream lädt …', 'Stream loading …'],
  st_muted: ['Ton im Player einschalten', 'Turn on sound in the player'],
  src_twitch: ['Twitch', 'Twitch'],
  src_web: ['Web', 'Web'],
  mod: ['Mod', 'Mod'],
  del: ['Nachricht löschen', 'Delete message'],
  mute10: ['10 Minuten stumm', 'Mute 10 minutes'],
  k_since: ['dabei seit {d}', 'here since {d}'],
  k_schilling: ['Schilling', 'Schilling'],
  k_xp: ['Erfahrung', 'Experience'],
  k_races: ['Runden', 'Rounds'],
  k_wins: ['Siege', 'Wins'],
  k_podiums: ['am Stockerl', 'on the podium'],
  k_noprofile: ['Noch kein Spielstand – fahr mit !join in der nächsten Runde mit.', 'No progress yet – join the next round with !join.'],
  k_twitch_none: ['nicht verknüpft', 'not linked'],
  k_name_locked: ['Der Name ist dein Schlüssel in der Arena. Ändern geht erst nach dem Verknüpfen mit Twitch.', 'Your name is your key in the arena. You can change it after linking Twitch.'],
  e_login: ['Bitte zuerst anmelden.', 'Please log in first.'],
  e_banned: ['Dein Konto ist gesperrt.', 'Your account is banned.'],
  e_muted: ['Du bist gerade stummgeschaltet.', 'You are muted right now.'],
  e_slow: ['Langsam – eine Nachricht je Sekunde.', 'Slow down – one message per second.'],
  e_arena: ['Die Arena ist gerade nicht verbunden – Befehle kommen nicht an.', 'The arena is not connected – commands do not arrive.'],
  e_link: ['Links dürfen nur Mods posten.', 'Only mods may post links.'],
  e_filter: ['Diese Nachricht geht nicht durch den Filter.', 'This message did not pass the filter.'],
  e_nouser: ['Kein Konto auf der Seite dazu.', 'No account on the site for that.'],
  e_name_format: ['3–20 Zeichen: Buchstaben, Ziffern, _ . -', '3–20 characters: letters, digits, _ . -'],
  e_name_reserved: ['Dieser Name ist reserviert.', 'This name is reserved.'],
  e_name_taken: ['Den Namen hat schon jemand.', 'That name is taken.'],
  e_name_blocked: ['Dieser Name geht nicht.', 'That name is not allowed.'],
  e_name_locked: ['Der Name ist dein Schlüssel in der Arena und bleibt.', 'Your name is your key in the arena and stays.'],
  e_age: ['Bitte bestätigen, dass du mindestens 14 bist.', 'Please confirm you are at least 14.'],
  e_email: ['Diese Adresse stimmt nicht.', 'That address looks wrong.'],
  e_slowmail: ['Zu viele Links – bitte in ein paar Minuten noch einmal.', 'Too many links – try again in a few minutes.'],
  e_nomail: ['Anmeldung per E-Mail ist gerade nicht eingerichtet.', 'Email login is not set up right now.'],
  e_send: ['Die Mail ging nicht raus – bitte später noch einmal.', 'The mail could not be sent – try again later.'],
  e_twitch: ['Die Anmeldung mit Twitch hat nicht geklappt.', 'Logging in with Twitch did not work.'],
  e_linkexp: ['Der Link ist abgelaufen oder schon benutzt.', 'The link has expired or was used already.'],
  e_gesperrt: ['Dieses Konto ist gesperrt.', 'This account is banned.'],
  e_twitch_vergeben: ['Dieses Twitch-Konto gehört schon zu einem anderen Konto.', 'That Twitch account already belongs to another account.'],
  muted_ok: ['{name} ist {m} Minuten stumm.', '{name} is muted for {m} minutes.'],
} as const;
export type Key = keyof typeof T;
export const hasKey = (k: string): k is Key => Object.prototype.hasOwnProperty.call(T, k);

let lang: Lang = (() => {
  try {
    const s = localStorage.getItem('ma-lang');
    if (s === 'de' || s === 'en') return s;
  } catch {
    /* privat */
  }
  return navigator.language?.toLowerCase().startsWith('de') ? 'de' : 'en';
})();
export const getLang = () => lang;
export function setLang(l: Lang): void {
  lang = l;
  try {
    localStorage.setItem('ma-lang', l);
  } catch {
    /* privat */
  }
}
export function t(k: Key, vars: Record<string, string | number> = {}): string {
  let s: string = T[k][lang === 'de' ? 0 : 1];
  for (const [a, b] of Object.entries(vars)) s = s.replace(`{${a}}`, String(b));
  return s;
}
export function applyStatic(root: ParentNode = document): void {
  document.documentElement.lang = lang;
  root.querySelectorAll<HTMLElement>('[data-t]').forEach((el) => (el.textContent = t(el.dataset.t as Key)));
  root.querySelectorAll<HTMLInputElement>('[data-tp]').forEach((el) => (el.placeholder = t(el.dataset.tp as Key)));
}
