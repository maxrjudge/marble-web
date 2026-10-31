// Runde im Takt mit dem Bild und Mitspielen per Knopf.
// Die Arena meldet einmal je Sekunde ihren Zustand. Was im Bild passiert (Spielart, Rangliste, Sieger), zeigt die Seite
// so viel später, wie das Livebild hinterher ist (delay_ms vom LSM-Embed). Fristen (Anmeldung, Start) laufen in echter
// Zeit: die Arena entscheidet, wann zu ist. Jeder Knopf schickt einen normalen Chat-Befehl an die Arena.
import { getLang, t, type Key } from './i18n';

export interface RoundState {
  v: 1;
  round: number;
  phase: 'start' | 'race' | 'podium' | 'lotto' | 'rad' | 'schieber';
  art: string;
  artName: string;
  next: string;
  nextName: string;
  label: string;
  track: string | null;
  ort: string;
  wetter: string;
  lobbyOpen: boolean;
  lobbyMs: number | null;
  startMs: number | null;
  endMs: number | null;
  raceT: number;
  duration: number;
  lobby: { n: number; max: number; users: string[]; names: string[] };
  field: { name: string; odds: number; user: string | null; house: boolean }[];
  starters: number;
  bets: { pool: number; count: number; open: boolean };
  bananas: { n: number; max: number };
  ranking: { name: string; user: string | null; rank: number }[] | null;
  result: { rank: number; name: string; user: string | null }[] | null;
  payouts: { name: string; payout: number }[] | null;
  eingriffe: 'lastcar' | 'kreisel' | null;
  lotto: { open: boolean; jackpot: number; tipps: number; info: string; letzte: number[] | null };
  rad: { open: boolean; info: string; letzte: string | null };
  schieber: { open: boolean; info: string; feld: number };
  plan: { when: string; what: string; in: string }[];
  week: { key: string; top: { name: string; pts: number }[]; finale: string; inMin: number | null };
  lang: 'de' | 'en';
}
export interface EmbedInfo {
  seen: boolean;
  state: string;
  delay: number;
}
export interface Ctx {
  embed: EmbedInfo;
  me: () => { key: string; perk?: string; kreisel?: { typ?: string; links?: boolean } } | null; // angemeldet (fertig eingerichtet)
  send: (cmd: string) => boolean; // Befehl an die Arena; false = nicht verbunden
  login: () => void;
}

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const RACE_ARTS = new Set(['murmel', 'auto', 'lastcar', 'kreisel', 'turbo']);
const PERKS = ['normal', 'schwer', 'leicht', 'huepfer', 'klebrig', 'gummi'] as const;
const KTYP = ['angriff', 'abwehr', 'ausdauer', 'ausgleich'] as const;
const AMOUNTS = [10, 20, 50, 100, 250, 500];

let ctx: Ctx;
let latest: { s: RoundState; at: number } | null = null; // zuletzt gemeldet (echte Zeit)
const buffer: { s: RoundState; at: number }[] = []; // für die verzögerte Anzeige
let shown: RoundState | null = null; // was gerade zum Bild passt
let online = false;
let sheetFor: string | null = null;
let special: 'lotto' | 'rad' | 'schieber' | null = null; // per „Auch dabei“ geöffnet
let lastFb = '';

export const current = () => latest?.s ?? null;

export function initRunde(c: Ctx): void {
  ctx = c;
  // Knöpfe (einmal verdrahtet; was gilt, entscheidet render())
  $('bJoin').addEventListener('click', () => cmd('!join'));
  $('bDaily').addEventListener('click', () => cmd('!daily'));
  $('bBet').addEventListener('click', () => toggleSheet('bet'));
  $('bBanana').addEventListener('click', () => toggleSheet('banana'));
  document.querySelectorAll<HTMLButtonElement>('#pMore [data-sp]').forEach((b) =>
    b.addEventListener('click', () => {
      const sp = b.dataset.sp as 'lotto' | 'rad' | 'schieber';
      special = special === sp ? null : sp;
      sheetFor = null;
      render();
    }),
  );
  setInterval(tick, 250);
}

export function setOnline(on: boolean): void {
  online = on;
  if (!on) {
    latest = null;
    buffer.length = 0;
    shown = null;
  }
  render();
}

export function onState(s: RoundState | null): void {
  if (!s) return setOnline(false);
  online = true;
  const e = { s, at: Date.now() };
  latest = e;
  buffer.push(e);
  // genug für 15 s Verzögerung (HLS-Ersatz)
  while (buffer.length > 40) buffer.shift();
  tick();
  render();
}

// Antwort der Arena auf einen eigenen Befehl: unter den Knöpfen zeigen
export function onFeedback(text: string, kind: string): void {
  lastFb = kind === 'err' ? '' : text;
  renderStatus();
}

function cmd(c: string): void {
  if (!ctx.me()) return ctx.login();
  if (ctx.send(c)) {
    sheetFor = null;
    renderSheet();
  }
}

// ---------- Zeit ----------
const clock = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const left = (ms: number | null): number | null => (latest && ms !== null ? ms - (Date.now() - latest.at) : null);
const delayMs = () => (ctx.embed.seen ? ctx.embed.delay : 0);

function tick(): void {
  // verzögert: der neueste Stand, der schon im Bild sein kann
  const playing = ctx.embed.seen && ctx.embed.state === 'playing';
  if (!playing) shown = latest?.s ?? null;
  else {
    const due = Date.now() - delayMs();
    let pick: RoundState | null = null;
    for (const e of buffer) if (e.at <= due) pick = e.s;
    shown = pick ?? buffer[0]?.s ?? null;
  }
  renderOverlay();
  renderBar();
}

// ---------- Anzeige über dem Bild (im Takt) ----------
let ovKey = '';
function renderOverlay(): void {
  const ov = $('ov');
  const s = shown;
  if (!s) {
    if (ovKey) ov.innerHTML = '';
    ovKey = '';
    return;
  }
  const head = [t('round_n', { n: s.round.toLocaleString(getLang()) }), s.artName, s.track].filter(Boolean).join(' · ');
  let rank = '';
  if (s.phase === 'race' && s.ranking?.length) rank = s.ranking.slice(0, 3).map((r) => `<span class="rk"><b>${r.rank}</b> ${esc(r.name)}</span>`).join('');
  else if (s.phase === 'podium' && s.result?.length) rank = `<span class="rk win">${esc(t('r_winner', { name: s.result[0].name }))}</span>` + s.result.slice(1, 3).map((r) => `<span class="rk"><b>${r.rank}</b> ${esc(r.name)}</span>`).join('');
  const key = head + rank;
  if (key === ovKey) return;
  ovKey = key;
  ov.innerHTML = `<div class="ovtop"><span class="livetag">${t('live')}</span><span class="ovchip">${esc(head)}</span></div>${rank ? `<div class="ovrank">${rank}</div>` : ''}`;
}

// ---------- Leiste unter dem Bild (echte Zeit) ----------
function renderBar(): void {
  const s = latest?.s;
  const bar = $('roundbar');
  if (!online || !s) {
    bar.dataset.off = 'true';
    $('rbKicker').textContent = '';
    $('rbBig').textContent = t('r_offline');
    $('rbLobby').hidden = true;
    return;
  }
  bar.dataset.off = 'false';
  let kicker = '';
  let big = '';
  const lob = left(s.lobbyMs);
  const st = left(s.startMs);
  const end = left(s.endMs);
  if (s.phase === 'start') {
    kicker = `${t('r_now', { a: s.artName })} · ${st !== null ? t('r_grid') : t('r_signup')}`;
    big = st !== null ? t('r_start_in', { t: clock(st) }) : lob !== null ? t('r_signup_in', { t: clock(lob) }) : s.label;
  } else if (s.phase === 'race') {
    kicker = `${t('r_now', { a: s.artName })} · ${t('r_race')}`;
    big = t('r_next', { a: s.nextName });
  } else if (s.phase === 'podium') {
    kicker = `${t('r_podium')} · ${t('r_next', { a: s.nextName })}`;
    big = end !== null ? `${t('r_signup')} · ${t('r_next_in', { t: clock(end) })}` : t('r_signup');
  } else {
    kicker = t('r_now', { a: s.artName });
    big = (s.phase === 'lotto' ? s.lotto.info : s.phase === 'rad' ? s.rad.info : s.schieber.info) || s.label;
  }
  $('rbKicker').textContent = kicker;
  $('rbBig').textContent = big;
  const showLobby = RACE_ARTS.has(s.phase === 'race' || s.phase === 'start' ? s.art : s.next);
  $('rbLobby').hidden = !showLobby;
  if (showLobby) {
    $('rbLobbyText').textContent = t('r_lobby', { n: s.lobby.n, max: s.lobby.max });
    $('rbLobbyBar').style.width = `${Math.min(100, (100 * s.lobby.n) / Math.max(1, s.lobby.max))}%`;
  }
}

// ---------- Mitspielen ----------
export function render(): void {
  const me = ctx?.me();
  $('playLogin').hidden = !!me;
  $('playBody').hidden = !me;
  renderBar();
  if (!me) return;
  const s = latest?.s ?? null;
  const off = !online || !s;
  const nextArt = s ? (s.phase === 'start' ? s.art : s.next) : 'murmel';
  const raceNext = RACE_ARTS.has(nextArt);
  const inLobby = !!s?.lobby.users.includes(me.key);

  const join = $<HTMLButtonElement>('bJoin');
  join.disabled = off || inLobby;
  join.classList.toggle('done', inLobby);
  join.querySelector('b')!.textContent = t(inLobby ? 'b_joined' : 'b_join');
  $('bJoinSub').textContent = s ? (inLobby ? s.nextName : `${t('b_join_sub')} · ${raceNext ? s.nextName : ''}`.replace(/ · $/, '')) : '';

  const bet = $<HTMLButtonElement>('bBet');
  bet.disabled = off || !s.bets.open;
  $('bBetSub').textContent = !s ? '' : s.bets.open ? (s.bets.count ? t('bet_pool', { s: s.bets.pool.toLocaleString(getLang()), n: s.bets.count }) : t('b_bet_sub')) : t('b_bet_closed');
  const ban = $<HTMLButtonElement>('bBanana');
  ban.disabled = off || (s?.bananas.n ?? 0) >= (s?.bananas.max ?? 6);
  $('bBananaSub').textContent = s ? t('b_banana_sub', { n: s.bananas.n, max: s.bananas.max }) : '';
  $<HTMLButtonElement>('bDaily').disabled = off;

  // Murmel oder Kreisel
  const kreisel = nextArt === 'kreisel' || s?.art === 'kreisel';
  $('pPerk').hidden = kreisel;
  $('pKreisel').hidden = !kreisel;
  renderPerk(me.perk);
  renderKreisel(me.kreisel);

  // Eingriffe im Rennen
  const ein = s?.phase === 'race' ? s.eingriffe : null;
  $('pEin').hidden = !ein;
  if (ein) renderEin(ein, s!);

  // Lotto, Glücksrad, Münzschieber: vorne, wenn sie als Nächstes kommen oder laufen; sonst über „Auch dabei“
  const sp = special ?? (s && (['lotto', 'rad', 'schieber'] as const).find((a) => s.phase === a || s.next === a)) ?? null;
  renderSpecial(sp, s);
  document.querySelectorAll<HTMLButtonElement>('#pMore [data-sp]').forEach((b) => {
    b.hidden = b.dataset.sp === sp;
    b.setAttribute('aria-pressed', String(special === b.dataset.sp));
  });
  renderSheet();
  renderStatus();
}

function chip(label: string, on: boolean, onClick: () => void, cls = ''): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `chip-b ${cls}`.trim();
  b.textContent = label;
  b.setAttribute('aria-pressed', String(on));
  b.addEventListener('click', onClick);
  return b;
}
function fill(box: HTMLElement, keepFirst: boolean, kids: HTMLElement[]): void {
  const first = keepFirst ? box.firstElementChild : null;
  box.replaceChildren(...(first ? [first] : []), ...kids);
}

let perkKey = '';
function renderPerk(cur?: string): void {
  const k = `${cur}|${getLang()}`;
  if (k === perkKey) return;
  perkKey = k;
  fill($('pPerk'), true, PERKS.map((p) => chip(t(`perk_${p}` as Key), cur === p, () => cmd(`!perk ${p}`))));
}
let kreiselKey = '';
function renderKreisel(cur?: { typ?: string; links?: boolean }): void {
  const k = `${cur?.typ}|${cur?.links}|${getLang()}`;
  if (k === kreiselKey) return;
  kreiselKey = k;
  fill($('pKreisel'), true, [
    ...KTYP.map((x) => chip(t(`k_${x}` as Key), cur?.typ === x, () => cmd(`!kreisel ${x}`))),
    chip(t('k_links'), cur?.links === true, () => cmd('!kreisel links'), 'sep'),
    chip(t('k_rechts'), cur?.links === false, () => cmd('!kreisel rechts')),
  ]);
}

let einKey = '';
function renderEin(kind: 'lastcar' | 'kreisel', s: RoundState): void {
  const k = `${kind}|${getLang()}|${sheetFor}`;
  if (k === einKey) return;
  einKey = k;
  const acts: [string, Key, boolean][] =
    kind === 'lastcar'
      ? [['reparatur', 'ein_reparatur', true], ['oel', 'ein_oel', false], ['boost', 'ein_boost', true], ['reserverad', 'ein_reserverad', true]]
      : [['turbo', 'ein_turbo', false], ['schild', 'ein_schild', false], ['rempler', 'ein_rempler', true], ['beben', 'ein_beben', false]];
  fill(
    $('pEinBtns'),
    false,
    [
      ...acts.map(([a, label, target]) => chip(t(label), sheetFor === `ein:${a}`, () => (target ? toggleSheet(`ein:${a}`) : cmd(`!${a}`)))),
      chip(t('b_cheer'), false, () => cmd('!anfeuern'), 'sep'),
    ],
  );
  void s;
}

function renderSpecial(sp: 'lotto' | 'rad' | 'schieber' | null, s: RoundState | null): void {
  const box = $('pSpecial');
  box.hidden = !sp;
  if (!sp) return void (box.dataset.k = '');
  const k = `${sp}|${getLang()}|${s?.lotto.jackpot}|${s?.next}|${s?.phase}`;
  if (box.dataset.k === k) return;
  box.dataset.k = k;
  const head = document.createElement('div');
  head.className = 'sphead';
  const title = document.createElement('b');
  const sub = document.createElement('span');
  sub.className = 'hint';
  title.textContent = s && (s.next === sp || s.phase === sp) ? (s.phase === sp ? t('r_now', { a: t(sp) }) : t('r_next', { a: t(sp) })) : t(sp);
  sub.textContent = sp === 'lotto' ? t('lotto_sub', { s: (s?.lotto.jackpot ?? 0).toLocaleString(getLang()) }) : sp === 'rad' ? t('rad_sub') : t('schieber_sub');
  head.append(title, sub);
  const body = document.createElement('div');
  body.className = 'chips';
  if (sp === 'lotto') {
    body.append(
      chip(t('lotto_quick'), false, () => cmd('!tipp quick'), 'strong'),
      chip(t('lotto_own'), sheetFor === 'lotto', () => toggleSheet('lotto')),
    );
  } else if (sp === 'rad') {
    radPick = radPick ?? 'rot';
    const targets: [string, string][] = [['rot', t('rad_rot')], ['blau', t('rad_blau')], ['gruen', t('rad_gruen')], ['gelb', t('rad_gelb')], ['1-10', '1–10'], ['11-20', '11–20'], ['jackpot', t('rad_jackpot')]];
    const tg = document.createElement('div');
    tg.className = 'chips';
    tg.setAttribute('role', 'group');
    for (const [v, l] of targets) tg.append(chip(l, radPick === v, () => ((radPick = v), (box.dataset.k = ''), render()), `rad-${v.replace(/[^a-z]/g, '')}`));
    const am = amountChips(radAmount, (a) => ((radAmount = a), (box.dataset.k = ''), render()));
    const go = chip(`${t('rad_send')} · ${radAmount} S`, false, () => cmd(`!rad ${radPick === 'gruen' ? 'grün' : radPick} ${radAmount}`), 'strong');
    body.append(tg, am, go);
    body.classList.add('col');
  } else {
    const lanes = document.createElement('div');
    lanes.className = 'chips';
    const lbl = document.createElement('span');
    lbl.className = 'clbl';
    lbl.textContent = t('schieber_bahn');
    lanes.append(lbl);
    for (let i = 1; i <= 5; i++) lanes.append(chip(String(i), false, () => cmd(coins > 1 ? `!muenze ${i} ${coins}` : `!muenze ${i}`), 'lane'));
    const cnt = document.createElement('div');
    cnt.className = 'chips';
    const l2 = document.createElement('span');
    l2.className = 'clbl';
    l2.textContent = t('schieber_count');
    cnt.append(l2, ...[1, 2, 3].map((n) => chip(String(n), coins === n, () => ((coins = n), (box.dataset.k = ''), render()))));
    body.append(lanes, cnt);
    body.classList.add('col');
  }
  box.replaceChildren(head, body);
}
let radPick: string | null = null;
let radAmount = 20;
let coins = 1;
let betAmount = 50;
let betOn: string | null = null;
let lottoPick = new Set<number>();

function amountChips(cur: number, pick: (a: number) => void): HTMLElement {
  const d = document.createElement('div');
  d.className = 'chips';
  const l = document.createElement('span');
  l.className = 'clbl';
  l.textContent = t('bet_amount');
  d.append(l, ...AMOUNTS.map((a) => chip(`${a} S`, cur === a, () => pick(a))));
  return d;
}

function toggleSheet(what: string): void {
  if (!ctx.me()) return ctx.login();
  sheetFor = sheetFor === what ? null : what;
  if (what === 'lotto') lottoPick = new Set();
  einKey = '';
  render();
}

// Auswahl unter den Knöpfen: Wette, Banane, eigene Lottozahlen, Ziel eines Eingriffs
function renderSheet(): void {
  const box = $('sheet');
  $('bBet').setAttribute('aria-expanded', String(sheetFor === 'bet'));
  $('bBanana').setAttribute('aria-expanded', String(sheetFor === 'banana'));
  const s = latest?.s;
  if (!sheetFor || !s) {
    box.hidden = true;
    box.dataset.k = '';
    return;
  }
  box.hidden = false;
  if (sheetFor === 'bet') {
    const names = s.field.length ? s.field.map((f) => ({ name: f.name, odds: f.odds })) : s.lobby.names.map((name) => ({ name, odds: 0 }));
    const k = `bet|${names.map((n) => `${n.name}:${n.odds}`).join(',')}|${betOn}|${betAmount}|${getLang()}`;
    if (box.dataset.k === k) return;
    box.dataset.k = k;
    const h = document.createElement('p');
    h.className = 'clbl';
    h.textContent = t('bet_on');
    const list = document.createElement('div');
    list.className = 'chips';
    if (!names.length) list.append(Object.assign(document.createElement('span'), { className: 'hint', textContent: t('bet_none') }));
    for (const n of names) list.append(chip(n.odds ? `${n.name} · ${n.odds.toLocaleString(getLang(), { maximumFractionDigits: 1 })}×` : n.name, betOn === n.name, () => ((betOn = n.name), render())));
    const am = amountChips(betAmount, (a) => ((betAmount = a), render()));
    const go = chip(`${t('bet_place')}${betOn ? ` · ${betOn} · ${betAmount} S` : ''}`, false, () => betOn && cmd(`!wette ${betOn.replace(/\s+/g, '')} ${betAmount}`), 'strong');
    go.disabled = !betOn;
    box.replaceChildren(h, list, am, go);
  } else if (sheetFor === 'banana') {
    if (box.dataset.k === `banana|${getLang()}`) return;
    box.dataset.k = `banana|${getLang()}`;
    const h = document.createElement('p');
    h.className = 'clbl';
    h.textContent = t('banana_where');
    const list = document.createElement('div');
    list.className = 'chips';
    for (let i = 1; i <= 10; i++) list.append(chip(String(i), false, () => cmd(`!banane ${i}`), 'lane'));
    box.replaceChildren(h, list);
  } else if (sheetFor === 'lotto') {
    const k = `lotto|${[...lottoPick].join(',')}|${getLang()}`;
    if (box.dataset.k === k) return;
    box.dataset.k = k;
    const h = document.createElement('p');
    h.className = 'clbl';
    h.textContent = t('lotto_pick', { n: lottoPick.size });
    const grid = document.createElement('div');
    grid.className = 'lgrid';
    for (let i = 1; i <= 45; i++)
      grid.append(
        chip(String(i), lottoPick.has(i), () => {
          if (lottoPick.has(i)) lottoPick.delete(i);
          else if (lottoPick.size < 6) lottoPick.add(i);
          box.dataset.k = '';
          renderSheet();
        }),
      );
    const go = chip(t('lotto_send'), false, () => cmd(`!tipp ${[...lottoPick].sort((a, b) => a - b).join(' ')}`), 'strong');
    go.disabled = lottoPick.size !== 6;
    box.replaceChildren(h, grid, go);
  } else if (sheetFor.startsWith('ein:')) {
    const act = sheetFor.slice(4);
    const names = (s.field.length ? s.field.map((f) => f.name) : (s.ranking ?? []).map((r) => r.name)).slice(0, 24);
    const k = `ein|${act}|${names.join(',')}|${getLang()}`;
    if (box.dataset.k === k) return;
    box.dataset.k = k;
    const h = document.createElement('p');
    h.className = 'clbl';
    h.textContent = t('ein_target');
    const list = document.createElement('div');
    list.className = 'chips';
    for (const n of names) list.append(chip(n, false, () => cmd(`!${act} ${n.replace(/\s+/g, '')}`)));
    box.replaceChildren(h, list);
  }
}

function renderStatus(): void {
  const el = $('pStatus');
  const me = ctx?.me();
  const s = latest?.s;
  const parts: string[] = [];
  if (me && s) {
    if (s.lobby.users.includes(me.key)) parts.push(`${t('b_joined')} · ${s.nextName}`);
    else if (s.field.some((f) => f.user === me.key) && s.phase !== 'podium') parts.push(t('b_racing'));
  }
  if (lastFb) parts.push(lastFb);
  el.hidden = !parts.length;
  el.textContent = parts.join(' · ');
}

// ---------- Gleich dran und Woche (aus dem Zustand; ohne Arena aus der Bestenliste) ----------
export function renderSide(fallbackWeek: { key: string; top: { name: string; pts: number }[] } | null): void {
  const s = latest?.s;
  const soon = $('soon');
  soon.replaceChildren();
  const rows: [string, string][] = [];
  if (s) {
    rows.push([t('r_now', { a: '' }).replace(/:\s*$/, ''), [s.artName, s.track].filter(Boolean).join(' · ')]);
    if (!s.plan.length) rows.push(['→', s.nextName]);
    for (const p of s.plan.slice(0, 5)) rows.push([p.when, p.what + (p.in ? ` (${p.in})` : '')]);
  }
  if (!rows.length) soon.append(Object.assign(document.createElement('p'), { className: 'hint', textContent: t('r_offline') }));
  for (const [a, b] of rows) {
    const d = document.createElement('div');
    d.className = 'srow';
    const x = document.createElement('span');
    x.textContent = a;
    const y = document.createElement('span');
    y.textContent = b;
    d.append(x, y);
    soon.append(d);
  }
  const wk = s?.week ?? fallbackWeek;
  $('weekTitle').textContent = t('week', { w: wk ? wk.key.replace(/^.*-W0?/, '') : '' });
  const top = $('weekTop');
  top.replaceChildren();
  if (!wk?.top.length) top.append(Object.assign(document.createElement('p'), { className: 'hint', textContent: t('week_none') }));
  wk?.top.slice(0, 5).forEach((r, i) => {
    const d = document.createElement('div');
    d.className = `wrow p${i + 1}`;
    d.innerHTML = '<b></b><span></span><span class="pts"></span>';
    d.children[0].textContent = String(i + 1);
    d.children[1].textContent = r.name;
    d.children[2].textContent = t('pts', { n: r.pts });
    top.append(d);
  });
  $('weekFinale').textContent = s?.week.finale ? t('finale', { at: s.week.finale }) : '';
}

const esc = (x: string) => x.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
