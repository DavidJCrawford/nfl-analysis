/** Two subjects, side by side, as diverging bars.
 *
 *  This is the only rendering on the site that happens in the browser rather
 *  than at build time, and it is here under protest. A comparison cannot be
 *  pre-rendered: 32 clubs make 496 pairs, which would be fine, but 1,743
 *  players make 1.5 million, and holding them to matching positions still
 *  leaves about 198,000. So the page reads two names out of its query string
 *  and fetches the numbers — see `emit_compare` in pipeline/emit.py.
 *
 *  The chart is a diverging bar: a label down the middle, each subject's bar
 *  growing outward from it, both scaled against whichever of the two is
 *  larger. It is bars and not a radar chart because a radar chart plots
 *  quantities on axes that have nothing to do with one another, closes the
 *  shape, and invites the reader to compare areas that mean nothing. Two bars
 *  from a common baseline is the one comparison the eye does accurately.
 */
import { FIELDS, GROUP_LABEL, show, type Fmt } from './stats';
import type { StatName, Stats } from './types';

export interface Row {
  label: string;
  a: number | null;
  b: number | null;
  fmt: Fmt;
  /** Which end of the scale is the good end. `none` draws the bars without
   *  calling either of them the winner — for a total that is neither good nor
   *  bad, like attempts. */
  better: 'high' | 'low' | 'none';
  /** A note shown under the label, for a row whose meaning is not obvious. */
  note?: string;
}

export interface Section { title: string; note?: string; rows: Row[] }

export interface Subject {
  key: string;
  name: string;
  sub: string;
  /** Club abbreviation, for the crest. A club is its own. */
  club: string;
  colour: string;
  face?: string | null;
  href: string;
  line?: string;
}

const n = (v: number | undefined | null): number | null =>
  v === undefined || v === null ? null : v;

// ── Clubs ────────────────────────────────────────────────────────────────────

interface Club {
  abbr: string; name: string; nick: string; conf: string; div: string;
  color: string; color2: string;
  w: number; l: number; t: number; pf: number; pa: number; games: number;
  for: Stats; against: Stats;
}

/** Net yards: passing plus rushing, less what the sacks took off. Sack yardage
 *  is published negative, so it adds. Checked against this pipeline's own box
 *  scores for all thirty-two clubs. */
const netYards = (s: Stats): number | null => {
  if (!s.passing && !s.rushing) return null;
  return (s.passing?.yards ?? 0) + (s.rushing?.yards ?? 0) + (s.passing?.sack_yards ?? 0);
};
const firstDowns = (s: Stats): number | null =>
  !s.passing && !s.rushing ? null : (s.passing?.first ?? 0) + (s.rushing?.first ?? 0);
const scores = (s: Stats): number | null =>
  !s.passing && !s.rushing ? null : (s.passing?.td ?? 0) + (s.rushing?.td ?? 0);
const turnovers = (s: Stats): number | null =>
  !s.passing && !s.rushing ? null : (s.passing?.int ?? 0) + (s.rushing?.lost ?? 0);

export function clubSections(a: Club, b: Club): Section[] {
  const per = (v: number | null, g: number) => (v === null || !g ? null : v / g);
  return [
    {
      title: 'The season',
      rows: [
        { label: 'Wins', a: a.w, b: b.w, fmt: 'int', better: 'high' },
        { label: 'Points scored', a: a.pf, b: b.pf, fmt: 'int', better: 'high' },
        { label: 'Points conceded', a: a.pa, b: b.pa, fmt: 'int', better: 'low' },
        { label: 'Points difference', a: a.pf - a.pa, b: b.pf - b.pa, fmt: 'epa', better: 'high' },
        // Clubs play different numbers of games once the byes start, and a
        // total quietly rewards whoever has played more.
        { label: 'Points a game', a: per(a.pf, a.games), b: per(b.pf, b.games), fmt: 'dec', better: 'high',
          note: 'Scored' },
      ],
    },
    {
      title: 'Offence',
      note: 'With the ball',
      rows: [
        { label: 'Net yards', a: netYards(a.for), b: netYards(b.for), fmt: 'int', better: 'high' },
        { label: 'Passing yards', a: n(a.for.passing?.yards), b: n(b.for.passing?.yards), fmt: 'int', better: 'high' },
        { label: 'Rushing yards', a: n(a.for.rushing?.yards), b: n(b.for.rushing?.yards), fmt: 'int', better: 'high' },
        { label: 'First downs', a: firstDowns(a.for), b: firstDowns(b.for), fmt: 'int', better: 'high' },
        { label: 'Touchdowns', a: scores(a.for), b: scores(b.for), fmt: 'int', better: 'high' },
        { label: 'Giveaways', a: turnovers(a.for), b: turnovers(b.for), fmt: 'int', better: 'low',
          note: 'Thrown or fumbled away' },
        { label: 'Sacks taken', a: n(a.for.passing?.sacked), b: n(b.for.passing?.sacked), fmt: 'int', better: 'low' },
      ],
    },
    {
      title: 'Defence',
      note: 'Against it',
      rows: [
        { label: 'Yards allowed', a: netYards(a.against), b: netYards(b.against), fmt: 'int', better: 'low' },
        { label: 'Passing allowed', a: n(a.against.passing?.yards), b: n(b.against.passing?.yards), fmt: 'int', better: 'low' },
        { label: 'Rushing allowed', a: n(a.against.rushing?.yards), b: n(b.against.rushing?.yards), fmt: 'int', better: 'low' },
        { label: 'Touchdowns allowed', a: scores(a.against), b: scores(b.against), fmt: 'int', better: 'low' },
        { label: 'Takeaways', a: turnovers(a.against), b: turnovers(b.against), fmt: 'int', better: 'high',
          note: 'Forced' },
        { label: 'Sacks made', a: n(a.for.defence?.sacks), b: n(b.for.defence?.sacks), fmt: 'dec', better: 'high' },
      ],
    },
    {
      title: 'Discipline',
      rows: [
        { label: 'Penalties', a: n(a.for.penalty?.n), b: n(b.for.penalty?.n), fmt: 'int', better: 'low' },
        { label: 'Penalty yards', a: n(a.for.penalty?.yards), b: n(b.for.penalty?.yards), fmt: 'int', better: 'low' },
      ],
    },
  ].map((s) => ({ ...s, rows: s.rows.filter((r) => r.a !== null || r.b !== null) }))
   .filter((s) => s.rows.length) as Section[];
}

// ── People ───────────────────────────────────────────────────────────────────

export interface Person {
  id: string; name: string; team: string; pos: string | null; unit: string | null;
  no: number | null; face: boolean; games: number; status: string; stats: Stats;
}

/** Lower is better for exactly these. Everything else counted here is a thing
 *  a player did rather than a thing that happened to him. */
const LOWER_IS_BETTER = new Set(['passing.int', 'passing.sacked', 'rushing.lost', 'penalty.n', 'penalty.yards']);
/** Neither good nor bad on its own: you cannot want more or fewer attempts. */
const NEUTRAL = new Set(['passing.att', 'rushing.att', 'receiving.tgt', 'kicking.fga', 'kicking.pata', 'punting.att']);

export function personSections(a: Person, b: Person): Section[] {
  // Only the groups both of them have. A quarterback and a cornerback share
  // nothing, and drawing a bar of 412 passing yards against a blank is not a
  // comparison — the page says so instead.
  const groups = (Object.keys(GROUP_LABEL) as StatName[])
    .filter((g) => a.stats[g] && b.stats[g]);

  const sections: Section[] = [{
    title: 'Appearances',
    rows: [{ label: 'Games', a: a.games, b: b.games, fmt: 'int', better: 'none' }],
  }];

  for (const g of groups) {
    const rows: Row[] = [];
    for (const f of FIELDS[g]) {
      const av = n(a.stats[g]?.[f.key]);
      const bv = n(b.stats[g]?.[f.key]);
      if (av === null && bv === null) continue;
      if (!av && !bv) continue;                    // both zero says nothing
      const id = `${g}.${f.key}`;
      rows.push({
        label: f.label, a: av, b: bv, fmt: f.fmt,
        better: LOWER_IS_BETTER.has(id) ? 'low' : NEUTRAL.has(id) ? 'none' : 'high',
      });
    }
    if (rows.length) sections.push({ title: GROUP_LABEL[g], rows });
  }
  return sections;
}

/** What the two have in common, said plainly, for the case where it is
 *  nothing. */
export const sharedGroups = (a: Person, b: Person): StatName[] =>
  (Object.keys(GROUP_LABEL) as StatName[]).filter((g) => a.stats[g] && b.stats[g]);

// ── Drawing ──────────────────────────────────────────────────────────────────

const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K, cls?: string, text?: string,
): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

/** Bar length as a share of the longer of the two.
 *
 *  Scaled against the pair rather than against the league, because the
 *  question this page answers is "which of these two, and by how much" — and
 *  against a league maximum two ordinary seasons would both be stubs.
 *  Magnitudes, so a negative points difference still draws a bar; the sign is
 *  in the number beside it. */
const share = (v: number | null, other: number | null): number => {
  if (v === null) return 0;
  const top = Math.max(Math.abs(v), Math.abs(other ?? 0));
  return top === 0 ? 0 : (Math.abs(v) / top) * 100;
};

export function drawRow(row: Row, colourA: string, colourB: string): HTMLElement {
  const wrap = el('div', 'crow');
  const win = row.better === 'none' || row.a === null || row.b === null ? 0
    : row.better === 'high' ? Math.sign(row.a - row.b) : Math.sign(row.b - row.a);

  const va = el('div', `cval left${win > 0 ? ' win' : ''}`, show(row.a ?? undefined, row.fmt, row.a !== null));
  const vb = el('div', `cval right${win < 0 ? ' win' : ''}`, show(row.b ?? undefined, row.fmt, row.b !== null));

  const track = (side: 'a' | 'b') => {
    const t = el('div', `ctrack ${side}`);
    const bar = el('div', `cbar${(side === 'a' ? win > 0 : win < 0) ? ' win' : ''}`);
    bar.style.setProperty('--w', `${share(side === 'a' ? row.a : row.b, side === 'a' ? row.b : row.a)}%`);
    const c = side === 'a' ? colourA : colourB;
    bar.style.background = c;                 // kept if the next line cannot parse
    bar.style.background = legible(c);
    t.append(bar);
    return t;
  };

  const mid = el('div', 'cmid');
  mid.append(el('span', 'clabel', row.label));
  if (row.note) mid.append(el('span', 'cnote', row.note));

  wrap.append(va, track('a'), mid, track('b'), vb);
  // Read as one line by a screen reader, rather than as five cells.
  wrap.setAttribute('role', 'group');
  wrap.setAttribute('aria-label',
    `${row.label}: ${show(row.a ?? undefined, row.fmt, row.a !== null)} against ${show(row.b ?? undefined, row.fmt, row.b !== null)}`);
  return wrap;
}

export function drawSections(sections: Section[], colourA: string, colourB: string): DocumentFragment {
  const frag = document.createDocumentFragment();
  for (const s of sections) {
    const sec = el('section', 'csec');
    const head = el('div', 'chead');
    head.append(el('h2', 'ctitle', s.title));
    if (s.note) head.append(el('p', 'csub', s.note));
    sec.append(head);
    for (const r of s.rows) sec.append(drawRow(r, colourA, colourB));
    frag.append(sec);
  }
  return frag;
}

// ── Colour ───────────────────────────────────────────────────────────────────

/** A club's colour, raised to something that can be seen on the dark panel.
 *
 *  Published club colours are chosen for a helmet and a jersey, not for a
 *  black background: Philadelphia's is `#004C54`, which against
 *  `oklch(17% 0 0)` is very nearly the background. This holds the hue and the
 *  chroma and puts a floor under the lightness, so the bar is still
 *  recognisably the club's colour and is still a colour.
 *
 *  Relative colour syntax, which every browser that can run the replay has had
 *  for two years. Callers set the raw hex first so that anything which cannot
 *  parse this keeps a colour rather than none. */
export const legible = (hex: string): string => {
  const { a, b } = oklab(hex);
  // A chroma floor rescues a dark colour that would otherwise go flat grey
  // when it is lifted — but applied to a colour that is *meant* to be
  // neutral it invents a hue. Las Vegas's silver #A5ACAF came out a pale
  // blue, which then sat almost on top of Philadelphia's lifted teal. Silver
  // is a club colour; it is allowed to stay silver.
  return Math.hypot(a, b) < NEUTRAL_C
    ? `oklch(from ${hex} max(l, 0.62) c h)`
    : `oklch(from ${hex} max(l, 0.62) max(c, 0.055) h)`;
};

/** Below this much chroma a colour is a neutral, not a dark version of a hue. */
const NEUTRAL_C = 0.02;

const rgb = (hex: string): [number, number, number] => {
  const h = hex.replace('#', '').trim();
  const f = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const v = parseInt(f, 16);
  return Number.isNaN(v) ? [128, 128, 128] : [(v >> 16) & 255, (v >> 8) & 255, v & 255];
};

/** sRGB hex to OKLab. Checked against the browser's own conversion: #004C54
 *  comes back C 0.0653 h 206.894, where Chrome computes 0.0652327 / 206.895. */
function oklab(hex: string): { L: number; a: number; b: number } {
  const lin = (x: number) => (x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4));
  const [R, G, B] = rgb(hex).map((v) => lin(v / 255)) as [number, number, number];
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s2 = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  return {
    L: 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s2,
    a: 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s2,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s2,
  };
}

/** The colour as the bar will actually carry it — with `legible`'s floors
 *  already applied. */
function drawn(hex: string): [number, number, number] {
  const { L, a, b } = oklab(hex);
  const C = Math.hypot(a, b);
  const h = Math.atan2(b, a);
  const L2 = Math.max(L, 0.62);
  const C2 = C < NEUTRAL_C ? C : Math.max(C, 0.055);   // mirrors `legible`
  return [L2, C2 * Math.cos(h), C2 * Math.sin(h)];
}

/** How far apart two colours look, measured on what is drawn rather than on
 *  what was published.
 *
 *  This used to be Euclidean distance between the raw hex values, which is a
 *  different question. `legible` puts a floor under lightness and chroma, so
 *  two colours separated in sRGB mostly by *lightness* collapse onto each
 *  other once it has run: Kansas City's gold #FFB612 and Tampa Bay's
 *  near-black #322F2B are 137 apart in RGB and 3.7 degrees apart in hue, and
 *  the old metric cheerfully picked them as the most separated pair available.
 *  Measured after the transform, they are 0.11 apart and rejected. */
const apart = (x: string, y: string): number => {
  const [l1, a1, b1] = drawn(x), [l2, a2, b2] = drawn(y);
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
};

const chroma = (hex: string): number => {
  const [r, g, b] = rgb(hex);
  return Math.max(r, g, b) - Math.min(r, g, b);
};
const light = (hex: string): number => {
  const [r, g, b] = rgb(hex);
  return (r + g + b) / 3;
};

/** The colour a club should actually be drawn in.
 *
 *  Four clubs publish a primary with almost no hue in it, and two of those —
 *  Pittsburgh and Las Vegas — publish plain black. Black has nowhere to go
 *  when it is lifted to be visible: it becomes grey, and a Steelers bar drawn
 *  in grey looks like a bar the page failed to colour. Their second colour is
 *  the one everybody pictures anyway, and is used instead.
 *
 *  Only for the colourless. Chicago's navy and Green Bay's dark green are also
 *  dark, but they are a hue, they survive being lifted, and they are what
 *  those clubs look like. */
const ink = (main: string, alt: string): string => {
  if (!main) return alt || main;
  if (chroma(main) >= 12) return main;
  if (!alt) return main;
  if (chroma(alt) < 12 && light(alt) <= light(main)) return main;
  return alt;
};

/** Two colours that can be told apart.
 *
 *  Clubs share colours — a comparison of two of the league's several navy
 *  blues would otherwise draw both sides of every row in the same one, and
 *  the chart would be unreadable in exactly the case where it is most wanted.
 *  Each club has a second colour; where the primaries are too close this takes
 *  whichever pairing is furthest apart. The threshold is the distance at which
 *  two bars of the same length stop looking like two colours. */
export function pickColours(
  aMain: string, aAlt: string, bMain: string, bAlt: string,
): [string, string] {
  const aInk = ink(aMain, aAlt), bInk = ink(bMain, bAlt);
  const options: [string, string][] = [
    [aInk, bInk], [aInk, bAlt], [aAlt, bInk], [aMain, bMain], [aAlt, bAlt],
  ].filter(([x, y]) => x && y) as [string, string][];
  const best = options.reduce((acc, o) => (apart(o[0], o[1]) > apart(acc[0], acc[1]) ? o : acc), options[0]!);
  // 0.15 in OKLab: comfortably past the point where two bars side by side
  // read as two colours rather than as one colour and a shade of it.
  return apart(options[0]![0], options[0]![1]) >= 0.15 ? options[0]! : best;
}
