/**
 * The replay engine. Canvas 2D, no dependencies, one game at a time.
 *
 * The honesty rules this has to keep are in the header of GameReplay.astro and
 * are worth restating where the drawing actually happens:
 *
 *   1. The ball travels from the snap spot to the spot at the whistle, and
 *      nowhere else. If the end spot is unknown it does not move.
 *   2. Between plays it is *placed*. A re-spot — penalty, loose ball, change of
 *      possession — is drawn as a dotted move with its reason written out,
 *      never as a run nobody made.
 *   3. Lateral position is not in the data. The ball stays on the centre line.
 *
 * Coordinates. `fx` is the field coordinate the whole site uses: yards from the
 * home team's goal line, 0 to 100, extended to -10..110 for the two end zones.
 * The home team always attacks +x and the away team -x, for the whole game.
 */

/** A play, exactly as pipeline/emit.py wrote it. The replay used to receive a
 *  renamed subset; it now receives the play itself, so a field added upstream
 *  arrives here without anyone having to remember a mapping. */
import { bandColour, readableOn } from './colour';

interface Frame {
  id: number;
  q: number;
  clock: string;
  t: number;
  hs: number;
  as: number;
  hto: number | null;
  ato: number | null;
  desc: string;
  unit: string;
  pos: string;
  def: string;
  dir: 1 | -1;
  x0: number;
  x1: number | null;
  drive: number;
  type: string;
  epa: number | null;
  /** Home win probability, so it does not flip with possession. */
  hwp: number | null;
  down?: number;
  togo?: number;
  goal?: boolean;
  xfd?: number;
  gain?: number;
  tags?: string[];
  score?: boolean;
  kick?: { land: number; dist: number; ret?: number; touchback?: boolean };
  respot?: { from: number; why: 'penalty' | 'loose' | 'change' | 'restart' | null };
  /** Who did it — the players whose movement the replay can honestly draw. */
  act?: { kick?: Actor; ret?: Actor; pass?: Actor; rec?: Actor; rush?: Actor; int?: Actor };
  /** Both legs of a pass: through the air, then after the catch. */
  air?: number;
  yac?: number;
  pen?: Penalty;
  /** Where the quarterback lined up: U, S or P. */
  qb?: string;
}

interface Penalty { team: string; type: string; yards: number | null; who: string | null; }

/** A card over the middle of the field. One thing worth stopping for, said in
 *  a word, with the club it belongs to on it.
 *
 *  `tone` picks the colour the word is set in, which is the site's own reading
 *  of the event and not decoration: things that went wrong and things that
 *  changed hands are the turnover colour, and a gain is gold, the same gold the
 *  line to gain is drawn in. */
interface Card {
  title: string;
  kind: string;
  meta: string;
  /** Whose mark goes on it, or null for a card that belongs to the game rather
   *  than to either side — the half ending is nobody's. */
  team: string | null;
  tone: 'turnover' | 'gain' | 'flat';
  ms: number;
}

interface Actor { n: string; j: number | null; }

interface Payload {
  home: string; away: string;
  homeName: string; awayName: string;
  homeColor: string; awayColor: string;
  homeColor2: string; awayColor2: string;
  finalHome: number; finalAway: number;
  length: number;
  drives: { n: number; pos: string; result: string }[];
  frames: Frame[];
  /** Where the clubs' marks are served from, so the penalty card can name one
   *  at runtime rather than every team's being written into the page. */
  logos: string;
}

/** Timing, at 1×, in milliseconds.
 *
 *  A play is a sequence of *beats*: something moves, then everything stops long
 *  enough to be seen, then the next thing moves. The kick, the catch, the carry
 *  and the tackle are separate events and the replay gives each of them its own
 *  moment — run together they were unreadable even at half speed.
 *
 *  None of this is a measurement. The play-by-play does not record how long a
 *  play took: the gap between two clock stamps is the play plus the huddle. The
 *  one thing the durations do carry is distance — a one-yard plunge and a
 *  forty-yard catch-and-run should not take the same time — and that *is* in
 *  the data. */
// The pause between one thing happening and the next. Long, deliberately: the
// movements themselves read at this speed, but run together they gave no time
// to take in what had just happened before the next thing started.
const HOLD = 1100;
// And longer still at the end of a down, which is where everything arrives at
// once — the yardage, the score, the caption, what the man with the ball did —
// and where a game itself stops while the chains are set.
const SETTLE = 1900;
const RUNUP_MS = 400;      // a kicker's approach
const SET_MS = 800;        // the offence set over the ball, before it moves
const SNAP_HOLD = 380;     // the ball in his hands, before the play develops
/** How long the snap takes. A short one is an exchange and is quick; a long
 *  one is a throw and takes a beat longer. */
const snapMs = (depth: number) => clamp(120 + depth * 28, 160, 280);

/** How long a movement takes, from how far the ball goes. */
const travelMs = (yards: number) => clamp(220 + Math.abs(yards) * 24, 300, 1150);

const KICK_TYPES = new Set(['kickoff', 'punt', 'field_goal', 'extra_point']);

const FIELD_YARDS = 120;   // 100 plus two end zones
const FIELD_WIDTH = 53 + 1 / 3;

/** NFL hash marks are 70 feet 9 inches from each sideline. */
const HASH_FROM_SIDELINE = 70.75 / 3;

/** How far back a kicker starts his run-up.
 *
 *  This is the one piece of movement in the replay that is not derived from the
 *  data — nothing records where a kicker stood or when he started. It is here
 *  because a ball that simply departs does not read as a kick, and it is kept
 *  small and along the ball's own line so that it says "this man kicked it" and
 *  nothing about where anybody was. */
const RUNUP_YARDS = 8;

const ease = (u: number): number =>
  u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** A design token's current value, read off the element rather than hard-coded,
 *  so the canvas cannot drift away from the rest of the design system. */
const cssVar = (el: Element, name: string): string =>
  getComputedStyle(el).getPropertyValue(name).trim();

/** A yard line the way a broadcast says it, from the shared field coordinate. */
const spotText = (fx: number, home: string, away: string): string => {
  if (fx <= 0) return `${home} end zone`;
  if (fx >= 100) return `${away} end zone`;
  if (Math.abs(fx - 50) < 0.5) return 'the 50';
  return fx < 50 ? `${home} ${Math.round(fx)}` : `${away} ${Math.round(100 - fx)}`;
};

const DOWN = ['', '1st', '2nd', '3rd', '4th'];

/** Where the quarterback lined up, and how far behind the ball that puts him.
 *
 *  The alignment is recorded — FTN charts it on every scrimmage down. The depth
 *  is not: it is the conventional depth for each of the three, which is why the
 *  overlay says the badge is showing an alignment and not a measurement. */
const QB_SPOT: Record<string, { name: string; depth: number }> = {
  U: { name: 'under centre', depth: 1.5 },
  P: { name: 'pistol', depth: 4 },
  S: { name: 'shotgun', depth: 5 },
};

/** What each side had on the field, as [team in possession, other team].
 *  On a kickoff the team in possession is the one receiving it. */
const UNIT_LABEL: Record<string, [string, string]> = {
  offense: ['Offense', 'Defense'],
  kickoff: ['Kick return', 'Kickoff'],
  punt: ['Punt', 'Punt return'],
  field_goal: ['Field goal', 'FG block'],
  extra_point: ['Extra point', 'PAT block'],
};

const unitFor = (f: Frame, team: string): string =>
  (UNIT_LABEL[f.unit] ?? UNIT_LABEL.offense!)[team === f.pos ? 0 : 1];

/** A substitution: both sides' units, as a pair, so a change is a change of
 *  either one. */
const unitPair = (f: Frame, home: string, away: string): string =>
  `${unitFor(f, away)}|${unitFor(f, home)}`;

/** A change of unit, in three beats rather than one.
 *
 *  Everything used to happen at once — the toast, the badges and the lines all
 *  moving together — which read as a single smear. It is a sequence in a real
 *  game and it is one here: the announcement, then the players, then the
 *  officials setting the ball and the chains.
 *
 *  None of it is a measurement. Nothing records how long a substitution takes;
 *  a play that starts the instant the last one ended is simply unreadable. */
/** How long the flag stays up. Long enough to read four short lines, and no
 *  longer: it is a card over a game, not a page. */
const FLAG_MS = 2600;
/** A turnover is rare — a shade over one a game — and is the biggest thing
 *  that happens without anybody scoring, so it gets nearly a flag's weight. */
const TURNOVER_MS = 2300;
/** The biggest thing that happens, and it happens six times a game. */
const SCORE_MS = 2600;
/** The smallest card, for the commonest thing that gets one: a quarter of a
 *  game's plays are passes that fell to the ground. Long enough to register and
 *  go, because it is the absence of a play and should not hold one up. A spike
 *  borrows it, being an incompletion by rule and on purpose. */
const INCOMPLETE_MS = 900;
/** A break between quarters. Half time gets a score card's weight; the other
 *  two are shorter, because all they have to do is cover the turn. */
const BREAK_MS = 1500;
/** Four and a half a game, and the worst thing that can happen to a down
 *  without the ball changing hands. */
const SACK_MS = 2000;

/** The hit at the end of a carry: the ball rocks, hard and then less hard, and
 *  is still again inside a third of a second.
 *
 *  It rocks the way the man carrying it was going — clockwise when he was
 *  running to the right, anticlockwise to the left — so the jolt reads as
 *  something that happened *to* him and in the direction he was travelling,
 *  rather than as the ball wobbling on its own. Nothing moves off the spot: the
 *  ball turns about its own centre and finishes square, so this claims nothing
 *  about where anything was. It is the one thing the data cannot say and
 *  everybody watching already knows — somebody was brought down there. */
const HIT_MS = 300;
/** Radians, positive clockwise. Two and a half rocks, the first the biggest,
 *  each one squarer than the last. */
const rockBy = (k: number, toward: number) =>
  Math.sin(k * Math.PI * 5) * (1 - k) ** 2 * 0.5 * (toward < 0 ? -1 : 1);
/** A first down is not rare. There are 38 a game, better than one play in five,
 *  and a card of a flag's length on each of them would put the replay behind a
 *  modal for a minute and a half a game. This one is brisk on purpose: long
 *  enough to rise, be read and go, and no longer. */
const FIRST_MS = 1200;

const SUB_TOAST_MS = 800;    // 1. the toast comes up
const SUB_UNITS_MS = 1100;   // 2. one unit goes off, the other comes on
const SUB_LINES_MS = 900;    // 3. the ball and the two lines are set

/** What a ball carrier is doing, which is not always running. */
const carryVerb = (type: string, tags: string[]): string =>
  type === 'qb_kneel' ? 'kneeling'
  : type === 'qb_spike' ? 'spiking'
  : tags.includes('sack') ? 'sacked'
  : 'running';

/** The same verb once it is over. The last beat of a play is where a reader
 *  who is stepping rather than watching spends all of their time, so it says
 *  what the player did rather than nothing at all. */
const PAST: Record<string, string> = {
  running: 'ran', kneeling: 'knelt', spiking: 'spiked', sacked: 'sacked',
  catching: 'caught', returning: 'returned', throwing: 'threw',
  kicking: 'kicked', punting: 'punted', 'kicking off': 'kicked off',
  'running up': 'kicked', intercepting: 'intercepted',
};
const past = (verb: string): string => PAST[verb] ?? verb;

export function mountReplay(): void {
  const mount = document.querySelector<HTMLElement>('.replay-mount');
  const script = document.querySelector<HTMLScriptElement>('[data-replay-payload]');
  const found = document.querySelector<HTMLDialogElement>('[data-replay]');
  if (!mount || !script || !found) return;
  // Re-bound so the null check holds inside the hoisted drawing functions
  // below, which TypeScript does not narrow through.
  const dialog: HTMLDialogElement = found;

  const data = JSON.parse(script.textContent ?? '{}') as Payload;
  if (!data.frames?.length) return;

  const field = dialog.querySelector<HTMLCanvasElement>('[data-field]')!;
  const strip = dialog.querySelector<HTMLCanvasElement>('[data-strip]')!;
  const fx = field.getContext('2d')!;
  const sx = strip.getContext('2d')!;

  // The same strip again, on the page and finished. Absent from any page that
  // does not ask for one, so everything touching it is optional.
  const still = mount.querySelector<HTMLCanvasElement>('[data-strip-still]');
  const stillBox = still?.parentElement ?? null;
  const stillCx = still?.getContext('2d') ?? null;

  const q = <T extends Element>(sel: string) => dialog.querySelector<T>(sel)!;
  const el = {
    qtr: q<HTMLElement>('[data-qtr]'),
    clock: q<HTMLElement>('[data-clock]'),
    down: q<HTMLElement>('[data-down]'),
    toast: q<HTMLElement>('[data-toast]'),
    flag: q<HTMLElement>('[data-flag]'),
    flagMark: q<HTMLImageElement>('[data-flag-mark]'),
    flagEdge: q<HTMLElement>('[data-flag-edge]'),
    flagTitle: q<HTMLElement>('[data-flag-title]'),
    flagKind: q<HTMLElement>('[data-flag-kind]'),
    flagMeta: q<HTMLElement>('[data-flag-meta]'),
    flagTimer: q<HTMLElement>('[data-flag-timer]'),
    tosHome: q<HTMLElement>('[data-tos="home"]'),
    tosAway: q<HTMLElement>('[data-tos="away"]'),
    sideHomeBox: q<HTMLElement>('[data-side="home"]'),
    sideAwayBox: q<HTMLElement>('[data-side="away"]'),
    index: q<HTMLElement>('[data-index]'),
    scoreHome: q<HTMLElement>('[data-score="home"]'),
    scoreAway: q<HTMLElement>('[data-score="away"]'),
    play: q<HTMLButtonElement>('[data-play]'),
  };

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');

  const state = {
    i: 0,
    beat: 0,
    elapsed: 0,
    playing: false,
    speed: 1,
  };

  /** The beats of the play currently on screen, rebuilt whenever it changes. */
  let beats: Beat[] = [];
  const lastBeat = () => beats.length - 1;

  // Theme colours are read from the stylesheet once rather than hard-coded, so
  // the canvas cannot drift away from the rest of the design system.
  const ink = (scope: Element = dialog) => cssVar(scope, '--ks-instrument-text') || '#eee';
  const gold = (scope: Element = dialog) => cssVar(scope, '--ks-kinpaku') || '#e8b84b';
  const patina = () => cssVar(dialog, '--ks-patina') || '#3fb8c4';
  const turnover = () => cssVar(dialog, '--nfl-turnover') || '#e0523a';

  /** The two lines on the field have a life of their own.
   *
   *  Where the ball is belongs to the beat, but the line of scrimmage and the
   *  line to gain are marks the officials move: they slide to a new spot rather
   *  than being somewhere else the next time you look. So they are state, eased
   *  towards whatever the current beat says they should be, instead of being
   *  read straight off it.
   *
   *  `grow` is how much of their height they have: they open from a point at
   *  the middle of the field out to both sidelines when they first appear, and
   *  close the same way when there is no line to draw — a kickoff has no line
   *  to gain, so the gold one genuinely goes away. */
  interface Line { x: number; grow: number; live: boolean; }
  const losLine: Line = { x: 0, grow: 0, live: false };
  const fdLine: Line = { x: 0, grow: 0, live: false };

  /** How far either side of the line of scrimmage a unit's badge sits. Far
   *  enough that the badges clear the ball and each other at the snap, near
   *  enough that they read as being lined up against this down rather than
   *  camped somewhere. The two face each other across the line. */
  const UNIT_DEPTH = 12;

  /** Where a unit stands when it is not going anywhere.
   *
   *  Twelve yards off the line of scrimmage on its own side of it — except for
   *  the side receiving a kick, which is not standing anywhere near the line of
   *  scrimmage. It is sixty yards away under the ball, waiting for it to come
   *  down. So it lines up off the landing spot instead, behind it, on the side
   *  the return will start from.
   *
   *  It then stays there. It does not chase the return: the man carrying the
   *  ball is named and drawn, and a unit badge following him would add nothing
   *  but movement. Standing behind where the ball came down says the one thing
   *  it is there to say, which is that this is the side that fielded it.
   *
   *  Who is receiving flips between the two kinds of kick: a kickoff is
   *  possessed by the team receiving it, a punt by the team kicking it. */
  const unitRest = (f: Frame, defending: boolean) => {
    const receives = f.type === 'kickoff' ? !defending : f.type === 'punt' && defending;
    if (receives && f.kick) {
      // Behind the landing spot, against the way the return will run.
      return f.kick.land + f.dir * (f.type === 'kickoff' ? -UNIT_DEPTH : UNIT_DEPTH);
    }
    return f.x0 + f.dir * (defending ? UNIT_DEPTH : -UNIT_DEPTH);
  };

  /** Both badges slide down the field with the line of scrimmage, on the same
   *  easing the lines themselves use, rather than appearing at each new spot.
   *  `live` is false when there is no unit on the field to move —
   *  mid-substitution, or before the first play — and the next spot it is given
   *  it takes up at once instead of sliding in from where the last one was. */
  const unitEase = { off: { x: 0, live: false }, def: { x: 0, live: false } };

  /** Time constant for the slide and duration of the open, in milliseconds. */
  const LINE_TAU = 120;
  const GROW_MS = 340;

  /** Move one line towards where it should be. Returns whether it is still
   *  going, so the frame loop knows to keep running after playback stops. */
  function stepLine(line: Line, target: number | null, dt: number): boolean {
    // Reduced motion: the lines are where they are, at once. This is content
    // motion, and the policy is that it collapses to a static frame.
    if (reduced.matches) {
      line.live = target !== null;
      line.x = target ?? line.x;
      line.grow = line.live ? 1 : 0;
      return false;
    }
    if (target !== null) {
      // A line that was not there arrives at its spot and opens; it does not
      // slide in from wherever the last one happened to be.
      if (!line.live) { line.live = true; line.x = target; line.grow = 0; }
      let busy = false;
      const dx = target - line.x;
      if (Math.abs(dx) > 0.02) { line.x += dx * (1 - Math.exp(-dt / LINE_TAU)); busy = true; }
      else line.x = target;
      if (line.grow < 1) { line.grow = Math.min(1, line.grow + dt / GROW_MS); busy = true; }
      return busy;
    }
    if (line.grow > 0) {
      line.grow = Math.max(0, line.grow - dt / GROW_MS);
      if (line.grow === 0) line.live = false;
      return true;
    }
    return false;
  }

  function resetLines(): void {
    losLine.live = fdLine.live = false;
    losLine.grow = fdLine.grow = 0;
    unitEase.off.live = unitEase.def.live = false;
  }

  /** Move a unit's badge towards where it should be standing. Same time
   *  constant as the lines, because they move together and for the same
   *  reason. */
  function stepUnit(mark: { x: number; live: boolean }, target: number | null, dt: number): boolean {
    if (target === null) { mark.live = false; return false; }
    if (reduced.matches || !mark.live) { mark.live = true; mark.x = target; return false; }
    const dx = target - mark.x;
    if (Math.abs(dx) <= 0.02) { mark.x = target; return false; }
    mark.x += dx * (1 - Math.exp(-dt / LINE_TAU));
    return true;
  }

  // ── Geometry ─────────────────────────────────────────────────────────────
  let box = { x: 0, y: 0, w: 0, h: 0, scale: 1 };

  function layoutField(): void {
    const wrap = field.parentElement!;
    const availW = wrap.clientWidth;
    const availH = wrap.clientHeight;
    if (!availW || !availH) return;

    // The field's own proportions decide the canvas, not the other way round:
    // a stretched field would misstate every distance on it.
    const aspect = FIELD_YARDS / FIELD_WIDTH;
    // Room above and below the field: the chains bracket and, above that, the
    // outcome tag. At 34 the two collided on any play that had both — but 46
    // fixed was most of the screen on a landscape phone, where this box is
    // about 125px tall: the two pads took 92 of them and left the field 33.
    // It keeps its 46 wherever there is room for it and gives way where there
    // is not, which costs the bracket some air on a short screen and costs the
    // field everything if it does not.
    const pad = clamp(Math.round(availH * 0.12), 15, 46);
    let w = availW;
    let h = w / aspect + pad * 2;
    if (h > availH) { h = availH; w = (h - pad * 2) * aspect; }

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    field.width = Math.round(w * dpr);
    field.height = Math.round(h * dpr);
    field.style.width = `${Math.round(w)}px`;
    field.style.height = `${Math.round(h)}px`;
    fx.setTransform(dpr, 0, 0, dpr, 0, 0);

    box = { x: 0, y: pad, w, h: h - pad * 2, scale: w / FIELD_YARDS };
  }

  /** Which way round the field is drawn. Sides change ends at the end of every
   *  quarter, so everything on the field turns over with them: the ball, the
   *  lines, the numbers, the end zones and whose crest is in which one. Three
   *  turns in a game: after the first, at half time, and after the third — and
   *  another before overtime, which the odd-and-even of it gives for free.
   *
   *  This is the rule and not the data. Nothing nflverse publishes says which
   *  physical end of a stadium anybody was defending — `x` is yards from the
   *  home team's goal line and stays that way all game, which is why the strip
   *  below is not turned over and every spot the replay quotes still means what
   *  it did. The turn is drawn because it happens, not because it is recorded.
   *
   *  The half-time card is up while it happens, which is what keeps it from
   *  reading as the ball jumping the length of the field. */
  /** The two clubs' marks, for the end zones. The same two files the scorebug
   *  and the cards already load, so this costs nothing on the wire — and two is
   *  all a game page ever needs, which is the whole reason logos are not on the
   *  pages that would want all thirty-two. A repaint is asked for as each
   *  arrives, because they land after the first one. */
  interface Crest { img: HTMLImageElement; ink: [number, number, number, number]; }
  const crest: Record<string, Crest> = {};

  /** The part of a crest's file that actually has a mark on it.
   *
   *  They are all square, and all of them are padded — every one fills about
   *  nine tenths of its width and anywhere between four and nine tenths of its
   *  height. Sizing off the file rather than the mark would put a tall crest in
   *  the end zone at twice the size of a wide one, so the mark is measured once
   *  and it is the mark that gets drawn. */
  function inkOf(img: HTMLImageElement): [number, number, number, number] {
    const w = img.naturalWidth, h = img.naturalHeight;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d', { willReadFrequently: true });
    if (!g) return [0, 0, w, h];
    g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, w, h).data;
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        if (d[(y * w + x) * 4 + 3]! > 8) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
      }
    }
    return x1 < 0 ? [0, 0, w, h] : [x0, y0, x1 - x0 + 1, y1 - y0 + 1];
  }

  for (const team of [data.home, data.away]) {
    const img = new Image();
    img.addEventListener('load', () => {
      crest[team] = { img, ink: inkOf(img) };
      render();
    });
    img.src = `${data.logos}${team}.png`;
  }

  let mirrored = false;
  const px = (fxYard: number) =>
    box.x + (mirrored ? 110 - fxYard : fxYard + 10) * box.scale;
  /** A direction along the field, as a direction across the screen. */
  const onScreen = (d: number) => (mirrored ? -d : d);
  const py = (frac: number) => box.y + frac * box.h;

  /** The yard numbers, and the top of the lower row of them. Anything written
   *  down there has to keep clear of the numbers, and the only way to be sure
   *  of that is to ask where they are rather than to guess a fraction. */
  const numberSize = () => clamp(box.h * 0.13, 9, 26);
  const numberTop = () => py(0.8) + numberSize() / 3 - numberSize() * 0.7;

  // ── The field ────────────────────────────────────────────────────────────
  function drawField(): void {
    const { w, h } = box;
    fx.fillStyle = cssVar(dialog, '--ks-instrument-deep') || '#1a1a1a';
    fx.fillRect(0, 0, w, box.y * 2 + h);

    // Playing surface. Read off the element, like every other colour here, so
    // the canvas cannot drift away from the rest of the design system.
    fx.fillStyle = cssVar(dialog, '--nfl-turf') || 'oklch(26% 0.018 145)';
    fx.fillRect(px(0), box.y, (px(100) - px(0)), h);

    // End zones, a shade deeper so the goal line reads as an edge.
    fx.fillStyle = cssVar(dialog, '--nfl-turf-end') || 'oklch(21% 0.024 145)';
    fx.fillRect(px(-10), box.y, px(0) - px(-10), h);
    fx.fillRect(px(100), box.y, px(110) - px(100), h);

    // Yard lines every five; every ten brighter. Half-pixel offsets keep a
    // one-pixel line one pixel wide instead of two grey ones.
    for (let y = 0; y <= 100; y += 5) {
      const x = Math.round(px(y)) + 0.5;
      fx.strokeStyle = y % 10 === 0 ? 'oklch(100% 0 0 / 0.26)' : 'oklch(100% 0 0 / 0.13)';
      fx.lineWidth = 1;
      fx.beginPath();
      fx.moveTo(x, box.y);
      fx.lineTo(x, box.y + h);
      fx.stroke();
    }

    // Hash marks: one per yard, in two rows at the real distance from the
    // sidelines. They are what makes the thing read as a football field.
    const hashFrac = HASH_FROM_SIDELINE / FIELD_WIDTH;
    const tick = Math.max(3, h * 0.022);
    fx.strokeStyle = 'oklch(100% 0 0 / 0.2)';
    fx.lineWidth = 1;
    fx.beginPath();
    for (let y = 1; y < 100; y += 1) {
      if (y % 5 === 0) continue;
      const x = Math.round(px(y)) + 0.5;
      fx.moveTo(x, py(hashFrac) - tick / 2); fx.lineTo(x, py(hashFrac) + tick / 2);
      fx.moveTo(x, py(1 - hashFrac) - tick / 2); fx.lineTo(x, py(1 - hashFrac) + tick / 2);
    }
    fx.stroke();

    // Goal lines and sidelines.
    fx.strokeStyle = 'oklch(100% 0 0 / 0.5)';
    fx.lineWidth = 2;
    for (const y of [0, 100]) {
      const x = Math.round(px(y)) + 0.5;
      fx.beginPath(); fx.moveTo(x, box.y); fx.lineTo(x, box.y + h); fx.stroke();
    }
    // A one-pixel stroke is centred on its own coordinate, so a rectangle drawn
    // on the field's true edges puts half of every side outside the canvas. On
    // the left, rounding happened to push it back inward and it survived; on
    // the right it did not, and the sideline there was drawn entirely off the
    // edge of the canvas and never seen at all. Both sides are now placed on a
    // pixel the canvas actually has.
    fx.strokeStyle = 'oklch(100% 0 0 / 0.28)';
    fx.lineWidth = 1;
    // Which end of the field is on which side of the screen changes every
    // quarter, so the two sidelines are taken from wherever the ends actually
    // landed. Naming them by the end they belong to put both strokes off the
    // canvas for the whole of the second and fourth quarters, and there were no
    // sidelines at all.
    //
    // The right one is rounded the same way the canvas's own width is, so it
    // lands on the last column the canvas has — and the sliver of part-painted
    // turf that would otherwise sit outside it is underneath it instead.
    const ends = [px(-10), px(110)];
    const edgeL = Math.round(Math.min(...ends)) + 0.5;
    const edgeR = Math.round(Math.max(...ends)) - 0.5;
    fx.strokeRect(edgeL, Math.round(box.y) + 0.5, edgeR - edgeL, Math.round(h));

    // Yard numbers, counting down from each goal line as they do on a field.
    const size = numberSize();
    fx.font = `500 ${size}px ${cssVar(dialog, '--ks-mono') || 'monospace'}, monospace`;
    fx.textAlign = 'center';
    fx.fillStyle = 'oklch(100% 0 0 / 0.3)';
    for (let y = 10; y <= 90; y += 10) {
      const label = String(y <= 50 ? y : 100 - y);
      fx.fillText(label, px(y), py(0.2) + size / 3);
      fx.fillText(label, px(y), py(0.8) + size / 3);
    }

    // The clubs' marks in their own end zones, turned along them the way the
    // lettering on a real one is. Both turn the same way: a stadium mirrors
    // them, which leaves one of the two upside down and much harder to read on
    // a screen. Held well back in strength — this is the ground the play is
    // drawn on, not a thing to look at.
    const ezW = Math.abs(px(0) - px(-10));
    for (const [team, at] of [[data.home, -5], [data.away, 105]] as const) {
      const c = crest[team];
      if (!c) continue;
      const [ix, iy, iw, ih] = c.ink;
      // Turned a quarter, so the mark's own height runs across the end zone —
      // which is the narrow way, and the one that decides how big it can be —
      // and its width runs along the field. A long mark is held to half the
      // field's length rather than running the whole way down it.
      let across = ezW * 0.68;
      let along = across * (iw / ih);
      if (along > h * 0.5) { along = h * 0.5; across = along * (ih / iw); }
      // Turned outwards, each towards its own touchline, the way a real end
      // zone is painted — so the two are mirrors of each other rather than both
      // lying the same way. Which is which is a question about the screen and
      // not about the club, so it survives the field turning over.
      const ex = px(at);
      fx.save();
      fx.globalAlpha = 0.4;
      fx.translate(ex, py(0.5));
      fx.rotate(ex > box.w / 2 ? Math.PI / 2 : -Math.PI / 2);
      fx.drawImage(c.img, ix, iy, iw, ih, -along / 2, -across / 2, along, across);
      fx.restore();
    }
  }

  // ── One frame of the replay ──────────────────────────────────────────────
  /** A player on the field: an identity at a point on the ball's line, never a
   *  position on the field's width. */
  interface Mark {
    x: number; name: string; num: number | null; colour: string; alpha: number;
    /** Drawn as an outline rather than a solid badge: this man is not named on
     *  this play, he is the nearest passer on the drive. */
    inferred?: boolean;
    /** What this player is doing at this beat — kicking, catching, running.
     *  Absent when they are simply standing there. */
    action?: string;
  }

  /** A unit on the field, named. `dy` is how far it has moved off the top:
   *  0 in place, 1 clear of the field's upper edge. */
  interface UnitMark {
    at: number; label: string; colour: string; dy: number;
    /** Which of the two units this is, and so which eased position it
     *  follows. Both stand on the ball's own line, one either side of the line
     *  of scrimmage. */
    unit: 'off' | 'def';
    /** Coming across to make a tackle: where the ball is, how far along the
     *  way there this badge is, and which side of the ball it belongs on. Laid
     *  over the resting spot rather than replacing it, so that the slow drift
     *  down the field and the quick dart at the ball stay two separate motions
     *  and neither smears the other. */
    close?: { to: number; t: number; side: number };
  }

  interface Shot {
    ball: number;
    lift: number;          // 0 on the ground, 1 at the top of a kick's arc
    /** How far the ball is turned from square, in radians, positive clockwise.
     *  Only the hit uses it, and only for a moment. */
    spin: number;
    los: number;
    fd: number | null;
    trailFrom: number;
    showGain: boolean;
    marks: Mark[];
    units: UnitMark[];
    /** Where an incomplete pass came down. Marked, never occupied: the ball
     *  itself is back on the spot the next play is snapped from. */
    fell?: number;
  }

  const teamColour = (team: string) => (team === data.home ? data.homeColor : data.awayColor);

  /** Who took the snap.
   *
   *  On a pass the league names him. On a handoff run it names nobody — the
   *  passer columns are empty on all 842 runs of the season — so the nearest
   *  passer on the same drive stands in. That is an inference, and it is drawn
   *  as one: the badge is an outline rather than a solid, and the overlay says
   *  so. Run against the plays where the passer *is* named it agrees 1,010
   *  times in 1,013, and the three it misses are the three times a team changed
   *  quarterback mid-drive. pipeline/verify.py holds it to that.
   *
   *  Where a drive has no pass at all — 34 runs in the season — there is nobody
   *  to infer, and nobody is shown. */
  function snapTaker(i: number): { who: Actor; inferred: boolean } | null {
    const f = data.frames[i];
    if (!f) return null;
    if (f.act?.pass) return { who: f.act.pass, inferred: false };
    if (f.act?.rush && (f.type === 'qb_kneel' || f.type === 'qb_spike')) {
      return { who: f.act.rush, inferred: false };
    }
    for (let step = 1; step < data.frames.length; step += 1) {
      let looked = false;
      for (const j of [i - step, i + step]) {
        const g = data.frames[j];
        if (!g || g.drive !== f.drive) continue;
        looked = true;
        if (g.act?.pass) return { who: g.act.pass, inferred: true };
      }
      if (!looked && i - step < 0 && i + step >= data.frames.length) break;
    }
    return null;
  }

  /** A placekick that was good. A missed or blocked one is not: where that
   *  ball actually went is nowhere in the data, so it is not drawn going
   *  anywhere the data does not say. */
  const throughPosts = (f: Frame) => {
    const tags = f.tags ?? [];
    return (f.type === 'field_goal' || f.type === 'extra_point')
      && (tags.includes('fg-made') || tags.includes('xp-good'));
  };

  /** Where the ball is *drawn* to, which on a score is not where it is
   *  recorded. The league puts a touchdown on the goal line, because crossing
   *  the plane is the score — but a ball that stops dead on the line does not
   *  look like one, and the end zone it was carried into is the whole point. So
   *  it runs on to the middle of that end zone, and a placekick that was good
   *  comes down in the same place: it went over the bar, and then it landed,
   *  and landing where a carried ball would have landed puts the two kinds of
   *  score in one spot on the field.
   *
   *  This is a drawing convention and nothing else. `x1` is untouched, and the
   *  gain, the spot and every number the read-out quotes still come from it.
   *  Which end zone needs no guessing: x1 is already the goal line of the one
   *  that was scored in or kicked at, whichever side did it. */
  function drawnEnd(f: Frame): number | null {
    if (f.x1 === null) return f.x1;
    if (!throughPosts(f) && !(f.tags ?? []).includes('td')) return f.x1;
    return f.x1 === 0 ? -5 : f.x1 === 100 ? 105 : f.x1;
  }

  /** One beat of a play: a movement, or a pause after one. */
  interface Beat {
    ms: number;
    at: (k: number) => Shot;
    tag?: 'sub' | 'flag';
    /** Carried on the beat rather than looked up again, so the card and the
     *  beat it is shown over cannot disagree about what it is announcing. */
    card?: Card;
  }

  /** The play broken into beats, in order.
   *
   *  Each thing that happens gets a movement and then a hold: the ball is
   *  kicked, and stops being kicked; it is caught, and sits caught for a
   *  moment; it is carried, and comes to rest. Nothing is drawn between two
   *  points the ball did not travel between — where it was *placed* rather than
   *  carried, it simply appears there on the next beat. */
  function buildBeats(f: Frame, prev?: Frame, at = 0): Beat[] {
    const kickTeam = f.type === 'kickoff' ? f.def : f.pos;
    const kickDir = f.type === 'kickoff' ? -f.dir : f.dir;
    const kicker = f.act?.kick;
    const returner = f.act?.ret;
    const passer = f.act?.pass;
    const receiver = f.act?.rec;
    const picker = f.act?.int;
    const holder = f.act?.rush ?? passer;

    const mark = (a: Actor, x: number, team: string, alpha = 1, action?: string): Mark =>
      ({ x, name: a.n, num: a.j, colour: teamColour(team), alpha, action });

    /** Both sides' units, named, standing twelve yards off the ball and facing
     *  each other across the line of scrimmage. Both move down the field with
     *  the line as the drive does, and only the defence's ever leaves that spot
     *  — it is the one that has to get to the ball. */
    const unitsAt = (frame: Frame, dy = 0, closing?: { to: number; t: number }): UnitMark[] =>
      [data.home, data.away].map((team) => {
        const defending = team === frame.def;
        return {
          at: unitRest(frame, defending),
          label: `${team} ${unitFor(frame, team)}`,
          colour: teamColour(team),
          dy,
          unit: (defending ? 'def' : 'off') as 'off' | 'def',
          close: defending && closing ? { ...closing, side: frame.dir } : undefined,
        };
      });

    const shot = (over: Partial<Shot> = {}): Shot => ({
      ball: f.x0, lift: 0, spin: 0, los: f.x0, fd: f.xfd ?? null, trailFrom: f.x0,
      showGain: false, marks: [], units: unitsAt(f), ...over,
    });

    /** The defence coming across to make the tackle.
     *
     *  It leaves the spot it lined up on and closes on the ball while the ball
     *  is still moving, arriving exactly as the ball stops — so the hit and the
     *  arrival are the same moment and one explains the other. It comes in late
     *  and fast rather than tracking along: `t` squared keeps it more or less
     *  where it started for the first half of the carry and then brings it in.
     *
     *  It finishes beside the ball on the side it came from, not over it. */
    let closedIn = false;
    const closeTo = (ball: number, t: number): UnitMark[] =>
      unitsAt(f, 0, { to: ball, t: clamp(t, 0, 1) });
    /** The units for a beat during which the ball is being run down, or nothing
     *  if this play ends with nobody being brought down. */
    const chasing = (ball: number, t: number) =>
      (defenceTackles(f) ? { units: closeTo(ball, t * t) } : {});
    /** Said when a carry beat is *pushed*, not when it is drawn: whether the
     *  defence had a carry to close over is a fact about the play, and reading
     *  it off whether a frame happened to be painted would make stepping to a
     *  play behave differently from watching it. */
    const willChase = () => { closedIn = defenceTackles(f); };

    const beats: Beat[] = [];
    const hold = (s: Shot) => beats.push({ ms: HOLD, at: () => s });
    /** The end of a play: the card it earned, if any, over the field already at
     *  rest, and then the long beat worth dwelling on. Every branch finishes
     *  through here, so the card is decided once rather than in five places —
     *  and the settle stays the last beat, which is what the read-out and the
     *  toast key off. */
    const rest = (s: Shot, toward: number = f.dir) => {
      // The hit lands first, on the ball alone: the badge beside it is a label
      // and labels do not get knocked about.
      if (tackled(f)) {
        // A play where the ball never moved has no carry for the defence to
        // close over, so it closes here instead, in the first half of the hit.
        const meets = defenceTackles(f);
        const arrived = closeTo(s.ball, 1);
        beats.push({
          ms: HIT_MS,
          at: (k) => ({
            ...s,
            spin: rockBy(k, toward),
            ...(meets
              ? { units: closedIn ? arrived : closeTo(s.ball, ease(clamp(k / 0.5, 0, 1))) }
              : {}),
          }),
        });
        if (meets) s = { ...s, units: arrived };
      }
      const card = endCard(f, at);
      if (card) beats.push({ ms: card.ms, tag: 'flag', card, at: () => s });
      beats.push({ ms: SETTLE, at: () => s });
    };
    const move = (ms: number, at: (k: number) => Shot) =>
      beats.push({ ms, at: (k) => at(ease(k)) });

    /** The quarterback over the ball, set back at his alignment. Used for the
     *  snap hold of every scrimmage down, so a snap looks like one. */
    const taker = snapTaker(at);
    const spot = f.qb ? QB_SPOT[f.qb] : undefined;
    /** Where the quarterback stands: behind the ball, by as much as his
     *  recorded alignment implies. He stays there for as long as he is drawn,
     *  rather than stepping up to the line to throw. */
    const snapX = clamp(f.x0 - f.dir * (spot?.depth ?? 1.5), -9, 109);
    const snapMark = (alpha = 1, action = spot?.name, x = snapX): Mark | null =>
      (taker ? { ...mark(taker.who, x, f.pos, alpha, action), inferred: taker.inferred } : null);
    const snapMarks = (): Mark[] => {
      const m = snapMark();
      return m ? [m] : [];
    };

    const end = drawnEnd(f);

    const standBack = clamp(f.x0 - kickDir * RUNUP_YARDS, -9, 109);
    const isKick = f.type === 'kickoff' || f.type === 'punt';
    const isPlace = f.type === 'field_goal' || f.type === 'extra_point';

    /** The snap, and where the play therefore starts from.
     *
     *  The ball goes back to him before it goes anywhere else, so the rest of
     *  the play begins in his hands rather than on the line. Under centre it is
     *  an exchange and never leaves the ground; from the pistol or the shotgun
     *  it is thrown, and lifts. The line of scrimmage stays where it is while
     *  the ball goes behind it — which is what a snap looks like.
     *
     *  Where there is nobody to snap it to — a drive with no pass anywhere on
     *  it, so no quarterback can be inferred — none of this is drawn and the
     *  ball starts on the line, because a snap to no one is not a thing to
     *  show. */
    const depth = spot?.depth ?? 1.5;
    const snapped = taker !== null && f.x1 !== null && !isKick && !isPlace;
    const from = snapped ? snapX : f.x0;
    const takeSnap = () => {
      beats.push({ ms: SET_MS, at: () => shot({ marks: snapMarks() }) });
      if (!snapped) return;
      const taking = snapMark(1, 'taking the snap');
      move(snapMs(depth), (k) => {
        const ball = f.x0 + (snapX - f.x0) * k;
        // The ball travelling backwards to him is not ground gained, so it
        // leaves no trail behind it.
        return shot({
          ball,
          trailFrom: ball,
          // Low: high enough to read as a throw rather than a handover, low
          // enough to stay out from behind his own badge.
          lift: depth > 2 ? Math.sin(k * Math.PI) * 0.12 : 0,
          marks: taking ? [taking] : [],
        });
      });
      beats.push({
        ms: SNAP_HOLD,
        at: () => shot({ ball: snapX, trailFrom: snapX, marks: snapMarks() }),
      });
    };

    // Units coming on and off. A real game stops for this, so the replay does
    // too — an empty field for a beat, before whoever is out there is drawn.
    // Where everything was when the last play ended. The beats before the ball
    // is set hold it there, so that exactly one thing moves at a time.
    const heldAt = prev ? drawnEnd(prev) ?? prev.x0 : 0;
    const held = prev ? {
      ball: heldAt,
      trailFrom: heldAt,
      los: prev.x0,
      fd: prev.xfd ?? null,
      marks: [],
    } : null;

    // 0a. The quarter ending. It belongs before this play rather than after
    //     the last one, because what it explains is about to happen: the field
    //     turns over, and at half time the ball is suddenly on a tee at the
    //     thirty-five with the same side still in possession. Without it the
    //     turn reads as the ball jumping the length of the field — and at the
    //     first and third it happens in the middle of a drive, where there is
    //     nothing else to account for it.
    //
    //     It is the one card that belongs to neither club, so it carries no
    //     mark, and the score on it is the score at the break: the one the play
    //     before it left behind.
    if (prev && f.q > prev.q && held) {
      const title = f.q === 3 ? 'Halftime' : f.q >= 5 ? 'Overtime' : `End of Q${f.q - 1}`;
      const ms = f.q === 3 ? SCORE_MS : BREAK_MS;
      beats.push({
        ms, tag: 'flag',
        card: {
          title, tone: 'flat', ms, team: null,
          kind: `${data.away} ${prev.as} · ${data.home} ${prev.hs}`,
          meta: 'sides change ends',
        },
        at: () => shot({ ...held, units: unitsAt(prev) }),
      });
    }

    // 0b. The flag. A penalty is announced before anything else happens, and
    //    the detail belongs to the play the flag was thrown on — which is the
    //    one before this, since it is this play whose ball has been moved.
    const pen = f.respot?.why === 'penalty' ? (prev?.pen ?? f.pen) : undefined;
    if (pen && held) {
      beats.push({
        ms: FLAG_MS, tag: 'flag', card: flagCard(pen),
        at: () => shot({ ...held, units: unitsAt(prev!) }),
      });
    }

    if (held && unitPair(prev!, data.home, data.away) !== unitPair(f, data.home, data.away)) {
      // 1. The toast comes up. Nothing else moves.
      beats.push({ ms: SUB_TOAST_MS, tag: 'sub', at: () => shot({ ...held, units: unitsAt(prev!) }) });

      // 2. The unit coming off goes up and out through the top of the field;
      //    the one coming on drops in behind it. They do not cross: the field is
      //    empty for a moment in between, which is the substitution.
      beats.push({
        ms: SUB_UNITS_MS, tag: 'sub',
        at: (k) => shot({
          ...held,
          units: k < 0.45 ? unitsAt(prev!, ease(k / 0.45))
            : k < 0.55 ? []
            : unitsAt(f, 1 - ease((k - 0.55) / 0.45)),
        }),
      });

      // 3. Only now are the ball and the two lines set, and the lines ease
      //    across rather than arriving.
      beats.push({ ms: SUB_LINES_MS, tag: 'sub', at: () => shot({ marks: [] }) });
    } else if (pen && held) {
      // A flag with no change of unit still needs the ball setting after it.
      beats.push({ ms: SUB_LINES_MS, at: () => shot({ marks: [] }) });
    }

    // ── Kicks: the run-up, the strike, the flight, the return ──────────────
    if (isKick || isPlace) {
      const verb = f.type === 'punt' ? 'punting' : f.type === 'kickoff' ? 'kicking off' : 'kicking';
      const atBall = kicker ? [mark(kicker, f.x0, kickTeam, 1, verb)] : [];
      hold(shot({ marks: kicker ? [mark(kicker, standBack, kickTeam)] : [] }));
      if (kicker) {
        // Accelerating, not eased. Every other movement in the replay uses the
        // shared ease-in-out, which is right for a ball that comes to rest and
        // wrong for a man running at one: it spends its last fifth of a second
        // decelerating, and that read as the kicker arriving and then standing
        // there. He is quickest at the moment he makes contact, so the run-up
        // gets its own curve and finishes at full speed.
        beats.push({
          ms: RUNUP_MS,
          at: (k) => shot({
            marks: [mark(kicker, standBack + (f.x0 - standBack) * (k * k), kickTeam, 1, 'running up')],
          }),
        });
      }
      // Nothing between the run-up and the strike either. There used to be a
      // beat of him set over the ball, and it read the same way: a kicker's
      // foot meets the ball at the end of his run, not a second later. The
      // action line turning from "running up" to "kicking" on the first frame
      // of the flight is the contact.

      const land = isKick && f.kick ? f.kick.land : end;
      if (land !== null && Math.abs(land - f.x0) > 0.05) {
        move(travelMs(land - f.x0), (k) => shot({
          ball: f.x0 + (land - f.x0) * k,
          // A kick that was good is still climbing away as it crosses the back
          // line; everything else comes down where it came down.
          lift: Math.sin(k * Math.PI),
          marks: atBall,
        }));
      }

      const returned = isKick && f.x1 !== null && land !== null
        && Math.abs(f.x1 - land) > 0.05 && returner !== undefined;
      if (returned) {
        const retTeam = f.type === 'kickoff' ? f.pos : f.def;
        hold(shot({ ball: land!, marks: [...atBall, mark(returner!, land!, retTeam, 1, 'catching')] }));
        willChase();
        move(travelMs(end! - land!), (k) => {
          const ball = land! + (end! - land!) * k;
          return shot({
            ball,
            ...chasing(ball, k),
            marks: [
              ...atBall.map((m) => ({ ...m, alpha: 1 - k, action: undefined })),
              mark(returner!, ball, retTeam, 1, 'returning'),
            ],
          });
        });
      }

      rest(shot({
        ball: end ?? f.x0,
        showGain: true,
        marks: returned
          ? [mark(returner!, end!, f.type === 'kickoff' ? f.pos : f.def, 1, 'returned')]
          : atBall.map((m) => ({ ...m, action: past(verb) })),
      }), returned ? Math.sign(end! - land!) : f.dir);
      return beats;
    }

    // ── A play with no recorded end spot does not move ─────────────────────
    const set = shot({ marks: snapMarks() });
    if (f.x1 === null) {
      hold(set);
      rest({ ...set, showGain: true });
      return beats;
    }

    // ── Passes: through the air, then whatever happened next ───────────────
    if (f.type === 'pass' && f.air !== undefined) {
      const point = clamp(f.x0 + f.dir * f.air, -9, 109);     // where it came down
      // The thrower stays where he lined up, and the ball leaves from there,
      // because that is where the snap has just put it. Where it comes down is
      // still the line of scrimmage plus `air_yards` — the measurement is
      // untouched, only the hand it starts in.
      const thrower = passer ? [mark(passer, snapX, f.pos)] : [];
      const fading = (k: number) => thrower.map((m) => ({ ...m, alpha: 1 - k * 0.6, action: undefined }));

      takeSnap();
      move(travelMs(point - from), (k) => shot({
        ball: from + (point - from) * k,
        lift: Math.sin(k * Math.PI) * 0.8,
        marks: passer ? [mark(passer, snapX, f.pos, 1, 'throwing')] : [],
      }));

      // Incomplete: it hits the ground out there, and is then *placed* back on
      // the spot. It is not carried back, so nothing is drawn moving back — the
      // ball simply is where it belongs, with a ring left where it fell.
      if (f.yac === undefined && !picker) {
        hold(shot({ ball: point, marks: fading(0.5) }));
        rest(shot({
          ball: f.x0, fell: point, showGain: true,
          marks: passer ? [mark(passer, f.x0, f.pos, 0.55, 'incomplete')] : [],
        }));
        return beats;
      }

      const taker = picker ?? receiver;
      const takerTeam = picker ? f.def : f.pos;
      const caught = taker
        ? [...fading(0.5), mark(taker, point, takerTeam, 1, picker ? 'intercepting' : 'catching')]
        : fading(0.5);
      hold(shot({ ball: point, marks: caught }));

      if (Math.abs(end! - point) > 0.05) {
        willChase();
        move(travelMs(end! - point), (k) => {
          const ball = point + (end! - point) * k;
          return shot({
            ball,
            ...chasing(ball, k),
            marks: taker
              ? [...fading(0.5 + k * 0.5), mark(taker, ball, takerTeam, 1, picker ? 'returning' : 'running')]
              : fading(1),
          });
        });
      }
      // A man who caught it runs on the way his side is going; a man who
      // intercepted it turns round and runs the other.
      rest(shot({
        ball: end!,
        showGain: true,
        marks: taker ? [mark(taker, end!, takerTeam, 1, picker ? 'intercepted' : 'caught')] : [],
      }), Math.sign(end! - point) || (picker ? -f.dir : f.dir));
      return beats;
    }

    // ── Everything else off a snap: a run, a kneel, a spike, a sack ────────
    // The snap shows the quarterback, not the man he is about to hand it to:
    // the carrier is several yards from the ball at this moment and the data
    // does not say where. He appears when he has it — which is now behind the
    // line, where the snap left it, rather than on the line.
    takeSnap();
    if (Math.abs(end! - from) > 0.05) {
      const verb = carryVerb(f.type, f.tags ?? []);
      // A man who took the snap keeps it — a quarterback sacked, kneeling or
      // spiking. Otherwise it is handed off, and the quarterback lets go of it
      // as the carrier picks it up.
      const tookIt = holder !== undefined && holder.n === taker?.who.n;
      const handing = snapped && !tookIt ? snapMark(1, 'handing off') : null;
      willChase();
      move(travelMs(end! - from), (k) => {
        const ball = from + (end! - from) * k;
        return shot({
          ball,
          ...chasing(ball, k),
          marks: [
            ...(handing ? [{ ...handing, alpha: Math.max(0, 1 - k * 2.4), action: undefined }] : []),
            ...(holder ? [mark(holder, ball, f.pos, 1, verb)] : []),
          ],
        });
      });
    }
    // Forwards on a run, backwards on a sack — the sign of the ground he
    // actually covered, which on a sack is the wrong way.
    rest(shot({
      ball: end!,
      showGain: true,
      marks: holder ? [mark(holder, end!, f.pos, 1, past(carryVerb(f.type, f.tags ?? [])))] : [],
    }), Math.sign(end! - from) || f.dir);
    return beats;
  }

  /** A player, as a labelled badge above the line the ball runs along.
   *
   *  It is drawn above the field's centre, not on it, and it has no position
   *  across the field's width — because the data has none. It says who, what
   *  they are doing, and a stem says where along the field they are.
   *
   *  Horizontal spans already used this frame, per stacked row: a passer and a
   *  receiver five yards apart would otherwise print on top of each other. */
  let badgeRows: { a: number; b: number }[][] = [];

  function drawBadge(m: Mark, groundY: number): void {
    if (m.alpha <= 0.01) return;
    const line = clamp(box.h * 0.085, 17, 25);
    const font = Math.round(line * 0.5);
    const small = Math.max(8, Math.round(line * 0.38));
    const pad = Math.round(line * 0.38);
    const numW = m.num === null ? 0 : Math.round(line * 0.95);
    const h = m.action ? line + small + 3 : line;

    fx.save();
    fx.globalAlpha = clamp(m.alpha, 0, 1);
    fx.font = `500 ${font}px ${cssVar(dialog, '--ks-font') || 'sans-serif'}, sans-serif`;
    const nameW = fx.measureText(m.name).width;
    fx.font = `500 ${small}px ${cssVar(dialog, '--ks-mono') || 'monospace'}, monospace`;
    // Measured the way it is drawn, letter by letter with the same tracking.
    // Measuring the string in one go left the box a character short of the
    // longer actions — "taking the snap" ran out through its own right edge.
    const track = small * 0.16;
    const trackedW = (t: string) => {
      let x = -track;
      for (const ch of t) x += fx.measureText(ch).width + track;
      return x;
    };
    const actionW = m.action ? trackedW(m.action.toUpperCase()) : 0;
    const w = numW + pad + Math.max(nameW, actionW) + pad;

    // Kept inside the canvas: a kicker standing eight yards behind his own goal
    // line would otherwise take his badge off the left edge.
    const cx = clamp(px(m.x), w / 2 + 2, box.w - w / 2 - 2);
    const span = { a: cx - w / 2 - 4, b: cx + w / 2 + 4 };
    let row = 0;
    while ((badgeRows[row] ??= []).some((o) => span.a < o.b && span.b > o.a)) row += 1;
    badgeRows[row]!.push(span);

    const top = Math.round(groundY - h - 22 - row * (h + 4));
    const left = Math.round(cx - w / 2);

    // A stem down to the ball's line, so the badge reads as being *at* a yard
    // line rather than floating over the field. In the team's colour it
    // disappeared against the dark field; it is drawn in ink and tinted.
    const stemX = Math.round(clamp(px(m.x), 1, box.w - 1)) + 0.5;
    fx.strokeStyle = 'oklch(100% 0 0 / 0.45)';
    fx.lineWidth = 1;
    fx.beginPath();
    fx.moveTo(stemX, top + h);
    fx.lineTo(stemX, groundY - 10);
    fx.stroke();
    fx.fillStyle = m.colour;
    fx.beginPath();
    fx.arc(stemX, groundY - 10, 2.5, 0, Math.PI * 2);
    fx.fill();

    fx.beginPath();
    fx.roundRect(left, top, w, h, 3);
    fx.fillStyle = m.inferred ? 'oklch(16% 0 0 / 0.72)' : 'oklch(16% 0 0 / 0.9)';
    fx.fill();
    // An inference is drawn as an outline. This man is not named on this play;
    // he is the nearest passer on the drive, and the badge should not look as
    // solid as one the league actually wrote down.
    fx.strokeStyle = m.colour;
    fx.lineWidth = 1;
    if (m.inferred) fx.setLineDash([4, 3]);
    fx.stroke();
    fx.setLineDash([]);

    if (m.num !== null) {
      fx.beginPath();
      fx.roundRect(left + 1, top + 1, numW, h - 2, [2, 0, 0, 2]);
      fx.fillStyle = m.colour;
      fx.globalAlpha = clamp(m.alpha, 0, 1) * (m.inferred ? 0.55 : 1);
      fx.fill();
      fx.globalAlpha = clamp(m.alpha, 0, 1);
      fx.fillStyle = readableOn(m.colour);
      fx.textAlign = 'center';
      fx.font = `700 ${font}px ${cssVar(dialog, '--ks-mono') || 'monospace'}, monospace`;
      fx.fillText(String(m.num), left + 1 + numW / 2, top + line / 2 + font * 0.36);
    }

    fx.fillStyle = ink();
    fx.textAlign = 'left';
    fx.font = `500 ${font}px ${cssVar(dialog, '--ks-font') || 'sans-serif'}, sans-serif`;
    fx.fillText(m.name, left + numW + pad, top + line / 2 + font * 0.36);

    // What they are doing, beneath the name. Set in the mono face and tracked,
    // like every other label on the site, so it reads as a caption and not as
    // part of the name.
    if (m.action) {
      fx.fillStyle = cssVar(dialog, '--ks-instrument-muted') || '#aaa';
      fx.font = `500 ${small}px ${cssVar(dialog, '--ks-mono') || 'monospace'}, monospace`;
      let x = left + numW + pad;
      for (const ch of m.action.toUpperCase()) {
        fx.fillText(ch, x, top + line + small);
        x += fx.measureText(ch).width + track;
      }
    }
    fx.restore();
  }

  /** The unit on the field, named, over the end of the field that side
   *  defends. Clipped to the playing surface, so when it moves up during a
   *  substitution it goes off the field rather than over the chains. */
  function drawUnits(units: UnitMark[]): void {
    if (!units.length) return;
    const h = clamp(box.h * 0.062, 14, 20);
    const font = Math.max(8, Math.round(h * 0.46));
    const padX = Math.round(h * 0.6);
    // Both units stand in the ball's own lane, one either side of the line of
    // scrimmage, rather than one on the field and one up in the rafters.
    const lane = py(0.5) - h / 2;

    fx.save();
    fx.beginPath();
    fx.rect(0, box.y, box.w, box.h);
    fx.clip();

    for (const u of units) {
      fx.font = `600 ${font}px ${cssVar(dialog, '--ks-mono') || 'monospace'}, monospace`;
      const label = u.label.toUpperCase();
      const track = font * 0.14;
      const textW = [...label].reduce((n, ch) => n + fx.measureText(ch).width + track, 0);
      const w = padX + 4 + padX + textW + padX;
      // The defence stands where the easing has got it to, not where this beat
      // says it should be: the drift down the field is a thing of its own, on
      // the lines' clock. The close is then laid over that, and it is not eased
      // — it is aimed, and it has to land on the beat that the ball stops.
      const rest = unitEase[u.unit].x;
      const t = u.close ? clamp(u.close.t, 0, 1) : 0;
      const at = rest + ((u.close?.to ?? rest) - rest) * t;
      // Leaning clear by half the badge and the whole of the ball, so that a
      // defence that has come across stands *beside* the ball, not under it.
      //
      // Which side is a fact about the play and not about the badge: a defence
      // stands between the ball and the end it is defending, always. Deciding
      // it instead by comparing where the badge was standing with where the
      // ball stopped put it on the wrong side of every carry that finished
      // past the defence's own alignment.
      const gap = w / 2 + clamp(box.h * 0.045, 5, 11) * 1.45 + 7;
      const cx = clamp(px(at) + (u.close ? onScreen(u.close.side) * t : 0) * gap,
                       w / 2 + 4, box.w - w / 2 - 4);
      // Far enough to clear the field's top edge entirely at dy = 1.
      const top = Math.round(lane - u.dy * (lane - box.y + h + 8));
      const left = Math.round(cx - w / 2);

      fx.beginPath();
      fx.roundRect(left, top, w, h, 2);
      fx.fillStyle = 'oklch(16% 0 0 / 0.82)';
      fx.fill();
      fx.strokeStyle = 'oklch(100% 0 0 / 0.14)';
      fx.lineWidth = 1;
      fx.stroke();

      fx.fillStyle = u.colour;
      fx.fillRect(left + padX, top + 4, 4, h - 8);

      fx.fillStyle = cssVar(dialog, '--ks-instrument-text') || '#eee';
      fx.textAlign = 'left';
      let x = left + padX + 4 + padX;
      for (const ch of label) {
        fx.fillText(ch, x, top + h / 2 + font * 0.36);
        x += fx.measureText(ch).width + track;
      }
    }
    fx.restore();
  }

  function drawPlay(f: Frame, shot: Shot): void {
    const h = box.h;

    // Where the ball has come from on this play. A thin band on the ball's own
    // line: as a tall block it read as a region of the field, which is exactly
    // what it is not.
    if (Math.abs(shot.ball - shot.trailFrom) > 0.2) {
      fx.fillStyle = 'oklch(100% 0 0 / 0.14)';
      const a = px(Math.min(shot.trailFrom, shot.ball));
      const b = px(Math.max(shot.trailFrom, shot.ball));
      const t = Math.max(2, Math.round(h * 0.012));
      fx.fillRect(a, Math.round(py(0.5) - t / 2), b - a, t);
    }

    // The two lines, drawn from their own eased state rather than from the
    // beat: they slide to a new spot, and open from a point at the middle of
    // the field out to both sidelines when they first appear.
    const openLine = (line: Line, colour: string): number | null => {
      if (line.grow <= 0.001) return null;
      const x = Math.round(px(line.x)) + 0.5;
      // Ease-out, so it decelerates into the sidelines rather than stopping dead.
      const reach = (h / 2) * (1 - (1 - line.grow) ** 3);
      fx.strokeStyle = colour;
      fx.lineWidth = 2;
      fx.beginPath();
      fx.moveTo(x, py(0.5) - reach);
      fx.lineTo(x, py(0.5) + reach);
      fx.stroke();
      return x;
    };

    // Gold, as the broadcast line to gain is yellow; teal, as its line of
    // scrimmage is blue.
    openLine(fdLine, gold());
    openLine(losLine, patina());

    // The chains: a bracket from the line of scrimmage to the line to gain,
    // above the field, which is where a viewer looks for the distance. It
    // belongs to the gold line and comes and goes with it.
    if (fdLine.grow > 0.001 && f.down) {
      fx.save();
      fx.globalAlpha = fdLine.grow;
      const y = box.y - 12;
      const a = px(losLine.x), b = px(fdLine.x);
      fx.strokeStyle = gold();
      fx.lineWidth = 1;
      fx.beginPath();
      fx.moveTo(a, y - 4); fx.lineTo(a, y); fx.lineTo(b, y); fx.lineTo(b, y - 4);
      fx.stroke();
      fx.fillStyle = gold();
      fx.font = `500 11px ${cssVar(dialog, '--ks-mono') || 'monospace'}, monospace`;
      fx.textAlign = 'center';
      fx.fillText(f.goal ? 'GOAL' : `${f.togo}`, (a + b) / 2, y - 7);
      fx.restore();
    }

    // Which way this team is going: a rule under the field, starting at the
    // line of scrimmage and pointing the way they are attacking.
    //
    // It used to be drawn in the club's own colour, three pixels thick and
    // centred under the ball. Half the league's primaries are near-black, so on
    // a dark ground it was a heavy smudge nobody could read. It is now the
    // line of scrimmage's own colour at the chains' own weight — it is saying
    // something about that line, so it should look like it belongs to it — and
    // it starts where the line does rather than floating under the ball.
    const arrowY = Math.round(box.y + h + 17) + 0.5;
    fx.font = `600 10px ${cssVar(dialog, '--ks-mono') || 'monospace'}, monospace`;
    // The club's name reads first and the arrow runs on from it, so the whole
    // thing starts at the line of scrimmage and points away down the field —
    // the name's leading edge on the line, not its trailing one.
    // Which way that is across the screen, not along the field: after half
    // time they are the opposite of each other.
    const sd = onScreen(f.dir);
    fx.textAlign = sd > 0 ? 'left' : 'right';
    const m = fx.measureText(f.pos);
    const reach = m.width + 8 + 40;
    // Only at a goal line on a narrow screen is there not room for it; there
    // it gives up the alignment rather than running off the edge half drawn.
    const ax = Math.round(sd > 0
      ? clamp(px(losLine.x), 2, Math.max(2, box.w - reach - 2))
      : clamp(px(losLine.x), Math.min(box.w - 2, reach + 2), box.w - 2));
    // Set by the ink rather than the advance box: what has to meet the line is
    // the letter, not the space the letter is sitting in. In this face that is
    // a correction of about half a pixel, so it changes nothing to look at —
    // but it is the thing that is actually meant, and it stays true if the face
    // ever changes to one with more air in it.
    const anchor = sd > 0 ? ax + m.actualBoundingBoxLeft : ax - m.actualBoundingBoxRight;
    const tail = anchor + (m.width + 8) * sd;
    const tip = tail + 40 * sd;
    fx.fillStyle = patina();
    fx.fillText(f.pos, anchor, arrowY + 4);
    fx.strokeStyle = patina();
    fx.lineWidth = 1;
    fx.beginPath();
    fx.moveTo(tail, arrowY);
    fx.lineTo(tip, arrowY);
    fx.moveTo(tip, arrowY);
    fx.lineTo(tip - 8 * sd, arrowY - 5);
    fx.moveTo(tip, arrowY);
    fx.lineTo(tip - 8 * sd, arrowY + 5);
    fx.stroke();

    // The units first, so that the ball and the men are drawn on top of them.
    // A defence standing on the ball's own line will sometimes be standing
    // where the ball is, and the ball is the thing worth seeing.
    drawUnits(shot.units);

    // The ball. On the centre line, because the data gives a yard line and not
    // a position — rule 3, and the overlay says so in words too.
    const r = clamp(h * 0.045, 5, 11);
    // Kept whole, the way a badge is: nothing the ball does should leave it
    // hanging half off the edge of the canvas.
    const bx = clamp(px(shot.ball), r * 1.45 + 1, box.w - r * 1.45 - 1);
    const by = py(0.5) - shot.lift * h * 0.34;
    fx.save();
    fx.translate(bx, by);
    if (shot.spin) fx.rotate(shot.spin);
    fx.fillStyle = ink();
    fx.beginPath();
    fx.ellipse(0, 0, r * 1.45, r, 0, 0, Math.PI * 2);
    fx.fill();
    fx.strokeStyle = 'oklch(20% 0 0 / 0.6)';
    fx.lineWidth = 1;
    fx.beginPath(); fx.moveTo(-r * 0.6, 0); fx.lineTo(r * 0.6, 0); fx.stroke();
    fx.restore();

    // Where an incomplete pass came down: a hollow ring, because the ball is
    // not there — it was brought back to the spot and that is where it is drawn.
    if (shot.fell !== undefined) {
      const fx0 = Math.round(px(shot.fell)) + 0.5;
      fx.strokeStyle = 'oklch(100% 0 0 / 0.62)';
      fx.setLineDash([3, 3]);
      fx.lineWidth = 1.5;
      fx.beginPath();
      fx.ellipse(fx0, py(0.5), r * 1.45, r, 0, 0, Math.PI * 2);
      fx.stroke();
      fx.setLineDash([]);

      // Clear of the hash marks, on its own plate: over a row of ticks the
      // word was unreadable at any size that did not shout.
      const label = 'INCOMPLETE';
      fx.font = `500 10px ${cssVar(dialog, '--ks-mono') || 'monospace'}, monospace`;
      fx.textAlign = 'center';
      const lw = fx.measureText(label).width;
      // Centred in the clear band between the line the ball runs along and the
      // top of the yard numbers under it. It used to be pinned at four fifths
      // of the way down the field, which is on top of those numbers.
      const ly = (py(0.5) + numberTop()) / 2 + 3;
      fx.fillStyle = 'oklch(16% 0 0 / 0.85)';
      fx.beginPath();
      fx.roundRect(fx0 - lw / 2 - 6, ly - 11, lw + 12, 16, 2);
      fx.fill();
      fx.fillStyle = 'oklch(100% 0 0 / 0.72)';
      fx.fillText(label, fx0, ly);
      fx.strokeStyle = 'oklch(100% 0 0 / 0.25)';
      fx.lineWidth = 1;
      fx.beginPath();
      fx.moveTo(fx0, py(0.5) + r + 2);
      fx.lineTo(fx0, ly - 12);
      fx.stroke();
    }

    badgeRows = [];
    // Badges are drawn from the ground line, never from `by`: a player does not
    // go up in the air when the ball he has just kicked does.
    for (const m of shot.marks) drawBadge(m, py(0.5));

    // The yards gained, at the ball, once the play has run. Not on a kick:
    // every one of them is recorded as gaining nothing, which is true and says
    // nothing — a made field goal headlined "0" is worse than no number. Only
    // the kickoff used to be excluded; the other three gained nothing either.
    if (shot.showGain && f.gain != null && !KICK_TYPES.has(f.type)) {
      const tags = f.tags ?? [];
      const td = tags.includes('td');
      const lost = tags.includes('int') || tags.includes('lost');
      // On a turnover the offence's gain is zero, which is true and useless.
      // What happened is that they lost the ball.
      const tag = tags.includes('int') ? 'INTERCEPTED'
        : tags.includes('lost') ? 'FUMBLE LOST'
        : (f.gain > 0 ? `+${f.gain}` : String(f.gain)) + (td ? '  TD' : '');
      fx.font = `600 ${clamp(h * 0.1, 11, 22)}px ${cssVar(dialog, '--ks-font') || 'sans-serif'}, sans-serif`;
      fx.textAlign = 'center';
      fx.fillStyle = td ? gold() : lost ? turnover() : ink();
      fx.fillText(tag, clamp(bx, fx.measureText(tag).width / 2 + 4,
                             box.w - fx.measureText(tag).width / 2 - 4), box.y - 28);
    }
  }

  function render(shot?: Shot | null): void {
    if (!box.w) return;
    const now = shot === undefined ? currentShot() : shot;
    if (!now) return;
    // Sides change at the end of each quarter, so the odd ones are drawn one
    // way round and the even ones the other. Decided once, here, so that every
    // part of the picture agrees about which way it is facing.
    mirrored = ((data.frames[state.i]?.q ?? 1) % 2) === 0;
    drawField();
    drawPlay(data.frames[state.i]!, now);
    drawStrip(now.ball);
    paintToast();
    paintFlag();
  }

  // ── The strip ────────────────────────────────────────────────────────────
  function layoutStrip(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = strip.clientWidth, h = strip.clientHeight;
    if (!w || !h) return;
    strip.width = Math.round(w * dpr);
    strip.height = Math.round(h * dpr);
    sx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /** The ball on the head of the trace, and the room the strip leaves at each
   *  end for it. Without the room it sits on the first play's mark and the
   *  last one's with half of itself off the edge. */
  const BALL_R = 6;
  const STRIP_SIDE = BALL_R * 1.45 + 3;
  /** How far in from the side the clubs' names are set.
   *
   *  The strip on the page is clipped to a rounded corner, and a name sits in
   *  exactly the band that corner eats: level with the tops of the letters the
   *  panel's own edge has already come in by seven pixels, so a name set hard
   *  against the side is crowded by the curve. This clears it without giving
   *  the margin more of the strip than it needs. */
  const NAME_X = 8;
  /** Where the game starts along the strip. Held on to because the scrubber has
   *  to invert the same mapping the drawing lays out, and the drawing is what
   *  knows how wide the two club names are. It is set on the first paint, which
   *  is long before anybody can click. */
  let stripLeft = STRIP_SIDE;

  /** `live` is where the ball is on the field at this very moment, which is
   *  what the head of the trace has to be. Given the play's finishing spot
   *  instead, the strip ran the play before the field did: on a touchdown the
   *  line was already in the end zone while the ball was still at the snap. The
   *  same rule the scoreboard, the read-out and the cards all keep. */
  /** Where a strip is being drawn, and how far through the game it is.
   *
   *  There are two of them: the scrubber inside the replay, which grows as the
   *  game is played, and the still one on the page, which is the same picture
   *  finished. One routine draws both. A second copy of these 195 lines would
   *  be two things to keep in step, and this strip has been rebuilt enough
   *  times to know how that ends. */
  interface StripOn {
    cv: HTMLCanvasElement;
    cx: CanvasRenderingContext2D;
    /** The last play to draw. Everything after it is still to come. */
    upTo: number;
    /** What to read the colours and the type off. */
    scope: Element;
    /** Has `upTo` finished? A score is not shown until the whistle. */
    settled: boolean;
    /** Draw the playhead. The scrubber needs it — it is the thing you are
     *  dragging. The still strip does not: nothing there is moving, and a
     *  bright rule down a finished picture reads as a cursor that is not one.
     *  The ball stays either way; on the still strip it marks where the game
     *  ran out rather than where the reader is. */
    playhead: boolean;
  }

  const liveStrip = (): StripOn => ({
    cv: strip, cx: sx, upTo: state.i, scope: dialog,
    settled: state.beat >= lastBeat() || !state.playing,
    playhead: true,
  });

  function drawStrip(live?: number, on: StripOn = liveStrip()): void {
    const cx = on.cx;
    const upTo = on.upTo;
    const w = on.cv.clientWidth, h = on.cv.clientHeight;
    if (!w || !h) return;
    const n = data.frames.length;

    // The game begins clear of both club names, so that the trace and the
    // possession line under it start on the same vertical rather than one of
    // them ducking out from behind a word. The right-hand margin is the ball's,
    // which sits on the last play's mark.
    cx.font = `9px ${cssVar(on.scope, '--ks-mono') || 'monospace'}, monospace`;
    const nameRoom = (t: string) => NAME_X + cx.measureText(t).width + 7;
    const left = Math.max(STRIP_SIDE, nameRoom(data.home), nameRoom(data.away));
    // Only the scrubber's own margin is kept. seek() inverts it to turn a
    // click back into a play, and the still strip beside it is its own width.
    if (on.cv === strip) stripLeft = left;
    const slot = (w - left - STRIP_SIDE) / n;
    /** The left edge of a play's own share of the strip, and the middle of it,
     *  which is where that play's mark goes. */
    const edgeX = (k: number) => left + k * slot;
    const markX = (k: number) => left + (k + 0.5) * slot;

    cx.clearRect(0, 0, w, h);

    // The field itself, stood on its end, laid out the way the field above it
    // is: the home team's own goal line at one edge and the away team's at the
    // other, each named where the end zone on the field is named. So the trace
    // sits nearest whichever end the ball is nearest, and the shape of a whole
    // game is which half of the strip it spent its time in — a trace camped
    // against one end is the side that defends that end being pushed around.
    // The margin is the room for the two names and the possession line beside
    // each of them. The field is what is left between.
    const pad = 18;
    /** Where a spot on the field sits up the strip.
     *
     *  Between the goal lines it is the field, to scale. Beyond them it is the
     *  end zone, to its own — the margins are deeper than ten yards would be,
     *  because they carry the club names and the possession lines as well, so a
     *  score five yards in lands in the middle of one rather than a hair past
     *  the goal line. Which is what the field above does with the same ball. */
    const yOf = (x: number) => {
      if (x < 0) return pad * (1 + clamp(x, -10, 0) / 10);
      if (x > 100) return (h - pad) + (pad * (clamp(x, 100, 110) - 100)) / 10;
      return pad + (x / 100) * (h - pad * 2);
    };
    /** Where the ball finished, drawn — which on a score is the middle of the
     *  end zone, exactly as the field draws it. */
    const spotOf = (fr: Frame) => drawnEnd(fr) ?? fr.x0;

    // The same two greens the field is drawn in, laid out the same way round:
    // the deeper one in the margins, which are the end zones and where the
    // clubs' names are, and the playing surface between the goal lines. It is
    // a picture of the same field, so it is the same colour as the field.
    cx.fillStyle = cssVar(on.scope, '--nfl-turf-end') || 'oklch(21% 0.024 145)';
    cx.fillRect(0, 0, w, h);
    cx.fillStyle = cssVar(on.scope, '--nfl-turf') || 'oklch(26% 0.018 145)';
    cx.fillRect(0, yOf(0), w, yOf(100) - yOf(0));

    // The two goal lines and, dashed between them, the fifty.
    cx.strokeStyle = 'oklch(100% 0 0 / 0.16)';
    cx.lineWidth = 1;
    for (const at of [0, 100]) {
      const y = Math.round(yOf(at)) + 0.5;
      cx.beginPath(); cx.moveTo(0, y); cx.lineTo(w, y); cx.stroke();
    }
    cx.setLineDash([2, 3]);
    const mid = Math.round(yOf(50)) + 0.5;
    cx.beginPath(); cx.moveTo(0, mid); cx.lineTo(w, mid); cx.stroke();
    cx.setLineDash([]);

    // Whose end is whose. Without this the trace is a shape rather than a
    // story: which way is up is the whole of what it has to say. They sit
    // outside their own goal lines, where an end zone is on the field itself.
    cx.font = `9px ${cssVar(on.scope, '--ks-mono') || 'monospace'}, monospace`;
    cx.textAlign = 'left';
    cx.fillStyle = cssVar(on.scope, '--nfl-strip-ink') || 'oklch(100% 0 0)';
    cx.fillText(data.home, NAME_X, yOf(0) - 7);
    cx.fillText(data.away, NAME_X, yOf(100) + 14);

    // Who had the ball. A run of plays with the same side in possession is a
    // line on that side's own row, just inside its name: a dot where they got
    // it, a line while they kept it, a dot where they lost it — and the other
    // side's dot in the very same place, because the moment one loses it is the
    // moment the other has it. Only one of the two rows is ever live, so the
    // ribbon says who was attacking without anybody having to read anything.
    //
    // It grows with the playhead like the trace does. The line of the
    // possession being watched has no closing dot: it has not ended yet.
    const rowOf = (team: string) => (team === data.home ? yOf(0) - 10.5 : yOf(100) + 10.5);
    const cut = markX(upTo);
    cx.strokeStyle = 'oklch(100% 0 0 / 0.5)';
    cx.fillStyle = 'oklch(100% 0 0 / 0.5)';
    cx.lineWidth = 1;
    let held = 0;
    for (let k = 1; k <= n; k += 1) {
      if (k < n && data.frames[k]!.pos === data.frames[held]!.pos) continue;
      const team = data.frames[held]!.pos;
      const y = Math.round(rowOf(team) - 0.5) + 0.5;
      const from = edgeX(held);
      const to = Math.min(edgeX(k), cut);
      if (to > from) {
        cx.beginPath(); cx.moveTo(from, y); cx.lineTo(to, y); cx.stroke();
        const ends = edgeX(k) <= cut ? [from, to] : [from];
        for (const x of ends) { cx.beginPath(); cx.arc(x, y, 2, 0, Math.PI * 2); cx.fill(); }
      }
      held = k;
    }

    // Where the ball was snapped from, play by play — but only as far as the
    // play being watched. The strip draws itself as the game is played, so it
    // is a record of what has happened rather than a map of what is going to.
    // The rest of the furniture stays, because it is what makes the strip a
    // scrubber: you have to be able to see where you are aiming.
    // It starts at the left edge of the first play's share of the strip rather
    // than at the middle of it, which is where the possession line under it
    // starts, and out of a dot of the same size — the two are the same game
    // beginning and should begin together. The first play's spot holds for the
    // whole of its own slot, so the little run-in is at its own height.
    // Everything behind the play being watched is where it finished; the play
    // being watched is only as far as the ball has got.
    const here = live ?? spotOf(data.frames[upTo]!);
    const atK = (k: number) => (k < upTo ? spotOf(data.frames[k]!) : here);
    const openY = yOf(atK(0));
    cx.strokeStyle = 'oklch(100% 0 0 / 0.5)';
    cx.lineWidth = 1.5;
    cx.beginPath();
    cx.moveTo(edgeX(0), openY);
    for (let k = 0; k <= upTo; k += 1) cx.lineTo(markX(k), yOf(atK(k)));
    cx.stroke();
    cx.fillStyle = 'oklch(100% 0 0 / 0.5)';
    cx.beginPath(); cx.arc(edgeX(0), openY, 2, 0, Math.PI * 2); cx.fill();

    // Scoring plays, and the quarters. A score is marked at the end it was
    // scored in, which is read off the scoreboard rather than worked out from
    // the play: whichever of the two numbers went up is the side that scored,
    // and by how much says whether it was a kick or a touchdown.
    data.frames.forEach((f, k) => {
      const was = k > 0 ? data.frames[k - 1]! : { hs: 0, as: 0 };
      const home = f.hs - was.hs;
      const away = f.as - was.as;
      // A score that has not been reached yet would be giving it away, which
      // is the same rule the scoreboard and the read-out already follow — and
      // the play being watched has not reached it until the whistle, or until
      // a reader stepping has chosen to stand on it.
      const done = k < upTo || on.settled;
      if (k <= upTo && done && (home > 0 || away > 0)) {
        const pts = Math.max(home, away);
        // At the end it was scored in, which is the other side's: a home score
        // happens in the away team's end zone, and that is the end the trace
        // has just run into. Three sizes against the possession dot's own —
        // twice across for a touchdown, half as much again for a field goal,
        // the same for the kick after one — so the shape of a game's scoring
        // reads without a legend.
        const r = pts >= 6 ? 4 : pts === 3 ? 3 : 2;
        cx.fillStyle = gold(on.scope);
        cx.beginPath();
        cx.arc(markX(k), rowOf(home > 0 ? data.away : data.home), r, 0, Math.PI * 2);
        cx.fill();
      }
      if (k > 0 && f.q !== data.frames[k - 1]!.q) {
        cx.strokeStyle = 'oklch(100% 0 0 / 0.3)';
        cx.lineWidth = 1;
        cx.beginPath();
        cx.moveTo(Math.round(edgeX(k)) + 0.5, 0);
        cx.lineTo(Math.round(edgeX(k)) + 0.5, h);
        cx.stroke();
        const label = f.q > 4 ? 'OT' : `Q${f.q}`;
        cx.font = `9px ${cssVar(on.scope, '--ks-mono') || 'monospace'}, monospace`;
        cx.textAlign = 'left';
        const lw = cx.measureText(label).width;
        cx.fillStyle = cssVar(on.scope, '--nfl-strip-chip') || 'oklch(14% 0 0 / 0.92)';
        cx.fillRect(Math.round(edgeX(k)) + 3, yOf(0) + 2, lw + 7, 12);
        cx.fillStyle = cssVar(on.scope, '--nfl-strip-ink') || 'oklch(100% 0 0)';
        cx.fillText(label, Math.round(edgeX(k)) + 6, yOf(0) + 11);
      }
    });

    // The playhead.
    const hx = markX(upTo);
    if (on.playhead) {
      cx.strokeStyle = gold(on.scope);
      cx.lineWidth = 2;
      cx.beginPath(); cx.moveTo(hx, 0); cx.lineTo(hx, h); cx.stroke();
    }

    // And the ball itself, on the head of the trace: the same shape it is on
    // the field, drawn the same way, so that the height of the line at that
    // moment is not a thing to work out. Drawn last, over the playhead it
    // shares an x with — big enough not to need an outline to hold against it.
    const br = BALL_R;
    cx.save();
    cx.translate(hx, yOf(here));
    cx.fillStyle = ink(on.scope);
    cx.beginPath();
    cx.ellipse(0, 0, br * 1.45, br, 0, 0, Math.PI * 2);
    cx.fill();
    cx.strokeStyle = 'oklch(20% 0 0 / 0.6)';
    cx.lineWidth = 1;
    cx.beginPath(); cx.moveTo(-br * 0.6, 0); cx.lineTo(br * 0.6, 0); cx.stroke();
    cx.restore();
  }

  /** The strip on the page: the whole game, finished.
   *
   *  The scrubber is already a picture of the shape of a game — who camped in
   *  whose half, who kept scoring and from which end — and that picture is
   *  worth having without opening anything. So it is drawn once on the page,
   *  exactly as the last play leaves it: the full trace, both possession rows,
   *  every score, the playhead at the end and the ball where the game finished.
   *
   *  Its height is the stylesheet's; what is read here is the box it has been
   *  given, so that the canvas is sized in device pixels to match. */
  function drawStill(): void {
    if (!still || !stillCx || !stillBox) return;
    const w = still.clientWidth, h = still.clientHeight;
    if (!w || !h) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    still.width = Math.round(w * dpr);
    still.height = Math.round(h * dpr);
    stillCx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawStrip(undefined, {
      cv: still, cx: stillCx, scope: still,
      upTo: data.frames.length - 1,
      // The game is over. Every score it contains has been scored.
      settled: true,
      // Nothing here is being scrubbed. The ball still marks the end.
      playhead: false,
    });
  }

  // ── The toast ────────────────────────────────────────────────────────────
  // One line of context above the bug, as a broadcast puts it there: what has
  // just changed, or what the man with the ball has done on this drive. Built
  // out of text nodes rather than markup, so a player's name is never parsed
  // as anything but a name.

  /** What a player has done on the drive so far, counted from the plays.
   *  Shown only once there is something to count. */
  function driveLine(upTo: number): (string | [string, string])[] | null {
    const f = data.frames[upTo]!;
    const who = f.act?.rush ?? f.act?.rec;
    if (!who) return null;

    let rush = 0, rushYds = 0, rec = 0, recYds = 0;
    for (let k = 0; k <= upTo; k += 1) {
      const g = data.frames[k]!;
      if (g.drive !== f.drive) continue;
      if (g.act?.rush?.n === who.n) { rush += 1; rushYds += g.gain ?? 0; }
      if (g.act?.rec?.n === who.n) { rec += 1; recYds += g.gain ?? 0; }
    }
    const touches = rush + rec;
    if (touches < 2) return null;

    const bits: (string | [string, string])[] = [['lead', who.n], ['sep', '·'], 'this drive'];
    if (rush) bits.push(['sep', '·'], `${rush} rush`, ['sep', '·'], `${rushYds} yds`);
    if (rec) bits.push(['sep', '·'], `${rec} rec`, ['sep', '·'], `${recYds} yds`);
    bits.push(['sep', '·'], `${(( rushYds + recYds) / touches).toFixed(1)} avg`);
    return bits;
  }

  type Bits = (string | [string, string])[];
  const SEP: [string, string] = ['sep', '·'];

  /** The play in shorthand, built from the structured fields rather than by
   *  cutting down the league's sentence.
   *
   *  The full description is not lost: it is on the game page, verbatim, under
   *  every drive, and each play there links back into the replay. What belongs
   *  on a card over a moving field is the shape of the play, not eighteen words
   *  of it — and a rewritten description would be a description nobody can
   *  check, where this is only ever the numbers said shortly. */
  function playLine(f: Frame): Bits {
    const tags = f.tags ?? [];
    const spot = (x: number | null) => (x === null ? null : spotText(x, data.home, data.away));
    const signed = (n: number) => (n > 0 ? `+${n}` : String(n));
    const bits: Bits = [];
    const a = f.act ?? {};

    if (f.type === 'kickoff' || f.type === 'punt') {
      bits.push(['lead', a.kick?.n ?? (f.type === 'punt' ? 'Punt' : 'Kickoff')], SEP,
                `${f.type === 'punt' ? 'punt' : 'kickoff'}${f.kick?.dist ? ` ${Math.round(f.kick.dist)}` : ''}`);
      if (f.kick?.touchback) bits.push(SEP, 'touchback');
      else if (a.ret && f.kick?.ret) bits.push(SEP, ['dim', `${a.ret.n} `], `return ${Math.round(f.kick.ret)}`);
    } else if (f.type === 'field_goal' || f.type === 'extra_point') {
      const kind = f.type === 'field_goal'
        ? `${f.kick?.dist ? `${Math.round(f.kick.dist)} yd ` : ''}field goal` : 'extra point';
      const result = tags.find((t) => t.startsWith('fg-') || t.startsWith('xp-'));
      bits.push(['lead', a.kick?.n ?? 'Kick'], SEP, kind);
      if (result) bits.push(SEP, result.slice(3).replace(/_/g, ' '));
    } else if (f.type === 'no_play') {
      bits.push(['lead', 'No play'], SEP, tags.includes('penalty') ? 'penalty' : 'nothing run');
    } else if (tags.includes('int')) {
      bits.push(['lead', a.pass?.n ?? 'Pass'], SEP, 'intercepted');
      if (a.int) bits.push(SEP, ['dim', `${a.int.n} `], `${Math.abs(Math.round((f.x1 ?? f.x0) - (f.x0 + f.dir * (f.air ?? 0))))} yd return`);
    } else if (tags.includes('sack')) {
      bits.push(['lead', a.pass?.n ?? 'Sacked'], SEP, 'sacked', SEP, `${signed(f.gain ?? 0)} yds`);
    } else if (f.type === 'pass') {
      if (f.yac === undefined) {
        bits.push(['lead', a.pass?.n ?? 'Pass'], SEP, 'incomplete');
        if (f.air !== undefined) bits.push(SEP, `${Math.round(f.air)} yds downfield`);
      } else {
        bits.push(['lead', a.pass?.n ?? 'Pass'], ['dim', ' → '], ['lead', a.rec?.n ?? '?'],
                  SEP, `${signed(f.gain ?? 0)} yds`);
        const to = spot(f.x1);
        if (to) bits.push(SEP, ['dim', 'to '], to);
      }
    } else {
      const verb = f.type === 'qb_kneel' ? 'kneel' : f.type === 'qb_spike' ? 'spike' : 'rush';
      // A spike carries its man as the passer, not the rusher — it is a forward
      // pass thrown into the ground — so looking only for a rusher named him
      // "Run".
      bits.push(['lead', a.rush?.n ?? a.pass?.n ?? 'Run'], SEP, verb);
      if (f.type === 'run') {
        bits.push(SEP, `${signed(f.gain ?? 0)} yds`);
        const to = spot(f.x1);
        if (to) bits.push(SEP, ['dim', 'to '], to);
      }
    }

    if (tags.includes('td')) bits.push(SEP, ['lead', 'touchdown']);
    else if (tags.includes('first')) bits.push(SEP, 'first down');
    return bits;
  }

  function unitLine(f: Frame): (string | [string, string])[] {
    return [
      ['lead', 'Units change'], ['sep', '·'],
      data.away, ['dim', ` ${unitFor(f, data.away)}`], ['sep', '·'],
      data.home, ['dim', ` ${unitFor(f, data.home)}`],
    ];
  }

  /** Whether somebody was brought down at the end of this play.
   *
   *  Nothing records a tackle, so this is the inference the picture needs
   *  rather than a fact: the ball was carried, it stopped, and the play did not
   *  end for any of the reasons that mean nobody had to stop it. A score is not
   *  a tackle — he got in. A kneel and a spike are not — the ball is put down
   *  on purpose. An incompletion is not, and neither is a kick nobody ran back.
   *  A sack is the most certain one there is. Some of these were men running
   *  out of bounds instead, and the data cannot tell the two apart. */
  function tackled(f: Frame): boolean {
    const tags = f.tags ?? [];
    if (f.x1 === null || tags.includes('td')) return false;
    if (f.type === 'qb_kneel' || f.type === 'qb_spike') return false;
    if (f.type === 'field_goal' || f.type === 'extra_point' || f.type === 'no_play') return false;
    if (tags.includes('sack')) return true;
    if (f.type === 'punt' || f.type === 'kickoff') return (f.kick?.ret ?? 0) > 0;
    if (f.type === 'pass') return f.yac !== undefined || tags.includes('int');
    return f.type === 'run';
  }

  /** Whether the badge on the field is the one that made the tackle.
   *
   *  It stands for the defending unit, which on nearly every play is the side
   *  without the ball at the whistle — but not always, and the exceptions are
   *  exactly the plays where the ball changed hands. A punt is kicked by the
   *  team in possession, so the man who returns it is a defender and the
   *  coverage running him down is the offence. An interception puts the ball in
   *  the defence's hands outright, and whoever brings the return down played
   *  the down on offence.
   *
   *  In both, a badge sliding across to meet the ball would be claiming a
   *  tackle for the eleven who were being tackled. So it stays where it is and
   *  only the ball takes the hit. */
  const defenceTackles = (f: Frame): boolean =>
    tackled(f) && f.type !== 'punt' && !(f.tags ?? []).includes('int');

  /** The card a play *ends* on, if it earns one.
   *
   *  A flag is announced before its play, because what it explains is the spot
   *  the next ball is put down on. These two are the opposite: they are what
   *  the play turned out to be, so they come after the ball has stopped and
   *  before the read-out settles — and never before, because a card reading
   *  INTERCEPTED over a ball that has not moved yet gives the play away.
   *
   *  One card each, so the order is the order of what matters: a score, then a
   *  turnover, then a sack, a spike, a pass that fell, and a first down. Ninety of the season's
   *  ninety-three touchdowns are tagged as first downs too, and FIRST DOWN is a
   *  poor thing to say about a touchdown; two of them were also interceptions,
   *  and the card says so under the word rather than coming up twice.
   *
   *  A first down takes a card only where the ball reached the line to gain.
   *  One awarded by a penalty belongs to the flag card on the next play, not to
   *  the down that fell short of it. */
  function endCard(f: Frame, at: number): Card | null {
    const tags = f.tags ?? [];
    const a = f.act ?? {};

    // A kick nobody ran back. The ball is dead where it landed and a rule puts
    // it out on the field, so the one thing worth saying is where it comes out
    // to — which is not a guess: it is the spot the next play is snapped from.
    if (f.kick?.touchback) {
      const takes = f.type === 'kickoff' ? f.pos : f.def;
      const out = data.frames[at + 1];
      return {
        title: 'Touchback', tone: 'flat', ms: INCOMPLETE_MS, team: takes,
        kind: out ? `out to ${spotText(out.x0, data.home, data.away)}` : 'no return',
        meta: [takes, f.kick.dist ? `${Math.round(f.kick.dist)} yard kick` : null]
          .filter(Boolean).join(' · '),
      };
    }

    // A touchdown first, including one the defence scored: `x1` is the goal
    // line that was crossed, and the emitter puts a defensive score on the
    // offence's own, so which end it is says who scored without being told.
    if (tags.includes('td')) {
      const own = f.dir > 0 ? 0 : 100;
      const by = f.x1 === own ? f.def : f.pos;
      // A defensive score names the man who intercepted it; nobody is named on
      // a fumble returned, so it says what happened instead of guessing who.
      const who = by === f.def
        ? (a.int?.n ?? (tags.includes('lost') ? 'Fumble returned' : null))
        : (a.rec?.n ?? a.rush?.n ?? null);
      return {
        title: 'Touchdown', tone: 'gain', ms: SCORE_MS, team: by,
        kind: who ?? `${by} score`,
        meta: [by, tags.includes('int') ? 'intercepted' : null,
               by === f.def && tags.includes('sack') ? 'strip sack' : null,
               f.gain == null ? null : `${f.gain > 0 ? '+' : ''}${f.gain} yards`]
          .filter(Boolean).join(' · '),
      };
    }

    if (tags.includes('int') && a.int) {
      const caught = f.x0 + f.dir * (f.air ?? 0);
      const back = Math.abs(Math.round((f.x1 ?? f.x0) - caught));
      return {
        title: 'Intercepted', tone: 'turnover', ms: TURNOVER_MS, team: f.def,
        kind: a.int.n,
        meta: [f.def, back > 0 ? `${back} yd return` : null].filter(Boolean).join(' · '),
      };
    }

    // The sack names only the quarterback: the league records who was sacked
    // and not who did it. So the mark is the defence's, because they made the
    // play, and the man under the word is the one it happened to.
    if (tags.includes('sack')) {
      const lost = Math.abs(f.gain ?? 0);
      return {
        title: 'Sacked', tone: 'turnover', ms: SACK_MS, team: f.def,
        kind: a.pass?.n ?? 'Quarterback',
        meta: [f.def, lost ? `${lost} yard${lost === 1 ? '' : 's'} lost` : null,
               tags.includes('lost') ? 'fumble lost' : null].filter(Boolean).join(' · '),
      };
    }

    // Thrown into the ground to stop the clock. An incompletion by rule, and
    // the only one anybody meant to throw.
    if (f.type === 'qb_spike') {
      return {
        title: 'Spike', tone: 'flat', ms: INCOMPLETE_MS, team: f.pos,
        kind: a.pass?.n ?? a.rush?.n ?? 'Quarterback',
        meta: [f.pos, 'clock stopped', f.clock ?? null].filter(Boolean).join(' · '),
      };
    }

    // A pass that hit the ground, having been thrown at somebody.
    if (f.type === 'pass' && f.yac === undefined) {
      return {
        title: 'Incomplete', tone: 'flat', ms: INCOMPLETE_MS, team: f.pos,
        kind: a.pass?.n ?? 'Pass',
        meta: [f.pos, a.rec?.n ?? null,
               f.air === undefined ? null : `${Math.round(f.air)} yds downfield`]
          .filter(Boolean).join(' · '),
      };
    }

    // A first down is only this play's to claim if this play's ball reached
    // the line to gain. Fifty-one in the season did not: a penalty awarded
    // them, and on six of those the down itself counted and came up short —
    // "scrambles right end for 1 yard ... PENALTY on SEA, Unnecessary
    // Roughness, 15 yards" on a third and five. FIRST DOWN over a gain that
    // fell short says the yards did it, and the flag that did do it is not
    // announced until the next play, so the card would land before its own
    // cause. The flag card carries those.
    //
    // This is the same rule the nullified plays were being excluded by, said
    // properly: a play that was blown dead never moved the ball to the sticks
    // either, so it needs no clause of its own.
    if (!tags.includes('first')) return null;
    if (f.x1 === null || f.xfd === undefined || f.dir * (f.x1 - f.xfd) < 0) return null;

    const who = a.rec?.n ?? a.rush?.n ?? a.pass?.n ?? null;
    const gain = f.gain ?? 0;
    return {
      title: 'First down', tone: 'gain', ms: FIRST_MS, team: f.pos,
      kind: `${gain > 0 ? '+' : ''}${gain} yard${Math.abs(gain) === 1 ? '' : 's'}`,
      meta: [f.pos, who, f.x1 === null ? null : `to ${spotText(f.x1, data.home, data.away)}`]
        .filter(Boolean).join(' · '),
    };
  }

  /** The flag, as a card. The yardage is the enforced distance, which is what
   *  the officials signalled, not the distance the ball moved. */
  const flagCard = (pen: Penalty): Card => ({
    title: 'Penalty', tone: 'turnover', ms: FLAG_MS, team: pen.team,
    kind: pen.type,
    meta: [pen.team, pen.who, pen.yards === null ? null : `${pen.yards} yards`]
      .filter(Boolean).join(' · '),
  });

  let flagKey = '';
  function paintFlag(): void {
    const beat = beats[state.beat];
    const card = beat?.tag === 'flag' ? beat.card : undefined;
    const key = card ? `${state.i}:${card.title}:${card.kind}` : '';

    if (key !== flagKey) {
      flagKey = key;
      el.flag.setAttribute('aria-hidden', String(!card));
      if (card) {
        el.flag.dataset.tone = card.tone;
        // A card with no club on it shows no mark and takes a neutral rule.
        el.flagMark.style.display = card.team ? '' : 'none';
        if (card.team) {
          el.flagMark.src = `${data.logos}${card.team}.png`;
          el.flagMark.alt = card.team;
        }
        el.flagEdge.style.background = card.team
          ? bandColour(teamColour(card.team),
                       card.team === data.home ? data.homeColor2 : data.awayColor2)
          : (cssVar(dialog, '--ks-instrument-muted') || '#aaa');
        el.flagTitle.textContent = card.title;
        el.flagKind.textContent = card.kind;
        el.flagMeta.textContent = card.meta;
      }
    }

    // The pause running out, driven by the beat's own clock so the line cannot
    // finish before the card goes.
    if (card && beat) {
      el.flagTimer.style.transform = `scaleX(${clamp(state.elapsed / beat.ms, 0, 1).toFixed(3)})`;
    }
  }

  let toastKey = '';
  function paintToast(): void {
    const f = data.frames[state.i]!;
    const beat = beats[state.beat];
    // The card is speaking during a flag, so the toast holds its tongue. At the
    // end of a play it says what the play was, and then — for the back half of
    // that long final beat — what the man with the ball has done on the drive.
    const k = beat ? clamp(state.elapsed / beat.ms, 0, 1) : 0;
    const drive = state.beat >= lastBeat() ? driveLine(state.i) : null;
    const bits = beat?.tag === 'flag' ? null
      : beat?.tag === 'sub' ? unitLine(f)
      : state.beat >= lastBeat() ? (drive && k > 0.55 ? drive : playLine(f))
      : null;

    const key = bits ? JSON.stringify(bits) : '';
    if (key === toastKey) return;          // do not rewrite the DOM every frame
    toastKey = key;

    el.toast.textContent = '';
    el.toast.classList.toggle('on', bits !== null);
    el.toast.setAttribute('aria-hidden', String(bits === null));
    if (!bits) return;
    for (const bit of bits) {
      if (typeof bit === 'string') {
        el.toast.append(document.createTextNode(bit));
      } else {
        const span = document.createElement('span');
        span.className = bit[0];
        span.textContent = bit[1];
        el.toast.append(span);
      }
    }
  }

  /** Three marks per team, one per timeout, spent ones greyed. The marks are
   *  in the markup rather than created here, so that Astro's scoped styles
   *  actually reach them. */
  /** The three pips beside each score: a side's timeouts, lit while it still
   *  has them. A screen reader was told what they were and nobody else was, so
   *  the same sentence is on the title as well — it is the only thing on the
   *  bug whose meaning is a convention rather than a word. */
  function paintTimeouts(box: HTMLElement, left: number | null): void {
    const want = left ?? 0;
    [...box.children].forEach((m, k) => m.classList.toggle('spent', k >= want));
    const said = `${want} timeout${want === 1 ? '' : 's'} left`;
    box.setAttribute('aria-label', said);
    box.title = said;
  }

  // ── The read-out ─────────────────────────────────────────────────────────
  function paintHud(): void {
    const f = data.frames[state.i]!;
    el.qtr.textContent = f.q > 4 ? (f.q === 5 ? 'OT' : `OT${f.q - 4}`) : `Q${f.q}`;
    el.clock.textContent = f.clock.replace(/^0(\d:)/, '$1');

    // Down and distance, as a bug states it: the situation, then where.
    el.down.textContent = f.down
      ? `${DOWN[f.down]} & ${f.goal ? 'Goal' : f.togo} · ${spotText(f.x0, data.home, data.away)}`
      : f.type === 'kickoff' ? 'Kickoff'
      : f.type === 'extra_point' ? 'Extra point'
      : f.type === 'field_goal' ? 'Field goal'
      : f.type === 'punt' ? 'Punt' : '—';
    // The band belongs to whoever has the ball — but only when there is a down
    // to own. A kickoff has none, and tinting it would say the receiving team
    // was on offence.
    const owned = f.down ? teamColour(f.pos) : '';
    el.down.style.background = owned || 'var(--ks-instrument-raised)';
    el.down.style.color = owned ? readableOn(owned) : 'var(--ks-instrument-text)';
    el.down.style.borderBottomColor = owned || 'var(--ks-instrument-rule)';

    paintTimeouts(el.tosAway, f.ato);
    paintTimeouts(el.tosHome, f.hto);

    // What the play did is revealed at the whistle, not at the snap — during
    // playback a caption reading "TOUCHDOWN" over a ball that has not moved
    // gives the play away. Stepping or scrubbing is different: there the reader
    // has chosen the play and wants to read it, so everything is shown at once.
    const settled = state.beat >= lastBeat() || !state.playing;

    // `hs`/`as` are the score *after* the play, so showing them at the snap
    // gives away the touchdown that is about to happen. Until the whistle the
    // scoreboard shows what the previous play left behind.
    const before = state.i > 0 ? data.frames[state.i - 1]! : { hs: 0, as: 0 };
    const hs = settled ? f.hs : before.hs;
    const as = settled ? f.as : before.as;
    el.scoreHome.textContent = String(hs);
    el.scoreAway.textContent = String(as);
    el.sideHomeBox.classList.toggle('lead', hs >= as);
    el.sideAwayBox.classList.toggle('lead', as >= hs);

    el.index.textContent = String(state.i + 1);
    strip.setAttribute('aria-valuenow', String(state.i + 1));
    strip.setAttribute('aria-valuetext',
      `Play ${state.i + 1}, ${el.qtr.textContent} ${el.clock.textContent}, ${f.desc}`);
  }

  // ── Transport ────────────────────────────────────────────────────────────
  function goTo(i: number, { play = false } = {}): void {
    state.i = clamp(i, 0, data.frames.length - 1);
    beats = buildBeats(data.frames[state.i]!, data.frames[state.i - 1], state.i);
    // Stepping or scrubbing lands on the finished play: somebody who has chosen
    // a play wants to see what it was, not what it looked like before it
    // started. Playing starts it from the beginning. Reduced motion is the
    // stepper all the time, because nothing there is going to animate.
    state.beat = play && !reduced.matches ? 0 : lastBeat();
    state.elapsed = 0;
    state.playing = play;
    reflectPlaying();
    paintHud();
    render();
    // The lines slide to their new spots rather than being there already, so
    // stepping and scrubbing need the loop running too.
    schedule();
  }

  /** Everything outside `state` that has to agree with it about whether the
   *  replay is running: the key you press to stop it, and the screen it is
   *  running on. Pause, the end of the game and closing the dialog all come
   *  through here, so neither can be left behind. */
  function reflectPlaying(): void {
    el.play.textContent = state.playing ? '❚❚' : '▶';
    el.play.setAttribute('aria-label', state.playing ? 'Pause' : 'Play');
    void keepAwake(state.playing);
  }

  function setPlaying(on: boolean): void {
    // Pressing play on a play that has already finished runs it again from the
    // start, rather than skipping straight to the next one.
    if (on && !reduced.matches && state.beat >= lastBeat()) {
      state.beat = 0;
      state.elapsed = 0;
    }
    state.playing = on && state.i < data.frames.length - 1;
    reflectPlaying();
    // Pausing reveals the current play, so the read-out has to be repainted.
    paintHud();
    if (state.playing) schedule();
  }

  /** The shot the current beat is showing. */
  function currentShot(): Shot | null {
    const beat = beats[state.beat] ?? beats[lastBeat()];
    return beat ? beat.at(clamp(state.elapsed / beat.ms, 0, 1)) : null;
  }

  function advanceBeats(dt: number): void {
    state.elapsed += dt;
    while (state.elapsed >= (beats[state.beat]?.ms ?? 0)) {
      state.elapsed -= beats[state.beat]!.ms;
      if (state.beat < lastBeat()) {
        state.beat += 1;
        // The read-out reveals what the play did at the final beat, so it has
        // to be repainted when the play settles rather than only when it turns
        // over to the next one.
        if (state.beat === lastBeat()) paintHud();
      } else if (state.i < data.frames.length - 1) {
        state.i += 1;
        beats = buildBeats(data.frames[state.i]!, data.frames[state.i - 1], state.i);
        state.beat = 0;
        paintHud();
      } else {
        state.elapsed = beats[lastBeat()]!.ms;
        setPlaying(false);
        break;
      }
    }
  }

  // One loop drives everything. It used to run only during playback, which was
  // fine while the lines jumped: now they have to keep moving after the beats
  // have stopped, and after a step or a scrub where nothing is playing at all.
  let raf = 0;
  let lastAt = 0;
  function frame(now: number): void {
    const dt = lastAt ? Math.min(now - lastAt, 120) : 16;
    lastAt = now;
    const scaled = dt * state.speed;

    if (state.playing) advanceBeats(scaled);
    const shot = currentShot();
    let settling = false;
    if (shot) {
      settling = stepLine(losLine, shot.los, scaled);
      settling = stepLine(fdLine, shot.fd, scaled) || settling;
      for (const side of ['off', 'def'] as const) {
        const target = shot.units.find((u) => u.unit === side)?.at ?? null;
        settling = stepUnit(unitEase[side], target, scaled) || settling;
      }
    }
    render(shot);

    if (state.playing || settling) {
      raf = requestAnimationFrame(frame);
    } else {
      raf = 0; lastAt = 0;
    }
  }

  function schedule(): void {
    if (raf) return;
    lastAt = 0;
    raf = requestAnimationFrame(frame);
  }

  // ── Wiring ───────────────────────────────────────────────────────────────
  q<HTMLButtonElement>('[data-first]').addEventListener('click', () => goTo(0));
  q<HTMLButtonElement>('[data-prev]').addEventListener('click', () => goTo(state.i - 1));
  q<HTMLButtonElement>('[data-next]').addEventListener('click', () => goTo(state.i + 1));
  q<HTMLButtonElement>('[data-last]').addEventListener('click', () => goTo(data.frames.length - 1));
  el.play.addEventListener('click', () => {
    if (!state.playing && state.i === data.frames.length - 1) goTo(0);
    setPlaying(!state.playing);
  });

  dialog.querySelectorAll<HTMLButtonElement>('[data-speed]').forEach((b) => {
    b.addEventListener('click', () => {
      state.speed = Number(b.dataset.speed);
      dialog.querySelectorAll('[data-speed]').forEach((o) =>
        o.setAttribute('aria-pressed', String(o === b)));
    });
  });

  const seek = (clientX: number) => {
    const r = strip.getBoundingClientRect();
    const inner = Math.max(1, r.width - stripLeft - STRIP_SIDE);
    goTo(Math.floor(((clientX - r.left - stripLeft) / inner) * data.frames.length));
  };
  let dragging = false;
  strip.addEventListener('pointerdown', (e) => {
    dragging = true; strip.setPointerCapture(e.pointerId); setPlaying(false); seek(e.clientX);
  });
  strip.addEventListener('pointermove', (e) => { if (dragging) seek(e.clientX); });
  strip.addEventListener('pointerup', () => { dragging = false; });
  strip.addEventListener('keydown', (e) => {
    const step = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1
      : e.key === 'PageDown' ? -10 : e.key === 'PageUp' ? 10 : 0;
    if (!step) return;
    e.preventDefault();
    setPlaying(false);
    goTo(state.i + step);
  });

  dialog.addEventListener('keydown', (e) => {
    if (e.key === ' ') { e.preventDefault(); setPlaying(!state.playing); }
    if (e.key === 'ArrowRight' && e.target !== strip) { e.preventDefault(); goTo(state.i + 1); }
    if (e.key === 'ArrowLeft' && e.target !== strip) { e.preventDefault(); goTo(state.i - 1); }
  });

  const relayout = () => { layoutField(); layoutStrip(); render(); drawStill(); };
  const ro = new ResizeObserver(relayout);
  // Belt and braces. A ResizeObserver is delivered with the rendering steps, so
  // anywhere those are throttled it can arrive late or not at all — and a stale
  // measurement does not fail loudly here, it just leaves the canvas bigger
  // than its box for `max-height` to scale down.
  window.addEventListener('resize', relayout);

  // The still strip is on the page rather than in the dialog, so it is drawn
  // straight away and keeps its own watch on its box — the observer above is
  // disconnected whenever the replay is closed. Observing draws it once.
  if (stillBox) new ResizeObserver(drawStill).observe(stillBox);
  // The club names are measured in the mono face, which lands after this runs.
  void document.fonts?.ready.then(drawStill);

  /** Hold the page still behind the replay.
   *
   *  A modal dialog does not stop the document underneath it scrolling, so the
   *  page kept its scrollbar down the side of a replay that covers the screen.
   *  Taking the scrollbar away reflows the page by its width, which would
   *  rewrap the text behind and land the reader somewhere else when they come
   *  back — so the same width goes back on as padding. Where scrollbars are
   *  drawn over the content rather than beside it, that width is zero and none
   *  of this does anything. */
  let heldOverflow = '';
  let heldPadRight = '';
  function holdPage(on: boolean): void {
    const root = document.documentElement;
    if (on) {
      if (root.dataset.replayLock) return;        // already held; do not re-save
      const bar = window.innerWidth - root.clientWidth;
      heldOverflow = root.style.overflow;
      heldPadRight = root.style.paddingRight;
      root.dataset.replayLock = '1';
      root.style.overflow = 'hidden';
      if (bar > 0) root.style.paddingRight = `${bar}px`;
    } else if (root.dataset.replayLock) {
      delete root.dataset.replayLock;
      root.style.overflow = heldOverflow;
      root.style.paddingRight = heldPadRight;
    }
  }

  /** Hold the screen awake while the replay is actually running.
   *
   *  A game plays for minutes on end without a single keypress, which is
   *  exactly the shape every display timeout reads as "idle" — so the screen
   *  dims somewhere in the third quarter. Held only while it is playing:
   *  pausing is itself an input, and somebody who paused and walked off should
   *  get their battery back rather than donate it to a still frame.
   *
   *  All of it is best-effort and none of it is worth telling the reader
   *  about. There is no `wakeLock` at all on Firefox before 126 or over plain
   *  http, and a request can simply be refused — on low battery, say. The
   *  replay plays the same either way. */
  let awake: WakeLockSentinel | null = null;
  let asking = false;

  async function keepAwake(on: boolean): Promise<void> {
    if (!on) {
      const held = awake;
      awake = null;
      await held?.release().catch(() => {});
      return;
    }
    // A hidden document cannot take one, and asking twice would strand the
    // first sentinel with nothing holding a reference to release it.
    if (awake || asking || document.hidden || !navigator.wakeLock) return;
    asking = true;
    try {
      const got = await navigator.wakeLock.request('screen');
      // The request is a round trip, and the reader may well have hit pause
      // during it.
      if (!state.playing || !dialog.open) { void got.release().catch(() => {}); return; }
      awake = got;
      // The browser drops it by itself whenever the tab goes away, and says so
      // here — so the handle can never be left claiming a lock that is gone.
      got.addEventListener('release', () => { if (awake === got) awake = null; });
    } catch {
      // Refused. The replay does not depend on it.
    } finally {
      asking = false;
    }
  }

  // Coming back to the tab has to ask again, because leaving it released it.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && state.playing && dialog.open) void keepAwake(true);
  });

  /** Open the replay, optionally on a particular play.
   *
   *  `showModal()` is synchronous and reading `clientWidth` straight after it
   *  forces the layout, so the canvas can be sized immediately. This used to
   *  wait a frame, which meant none of the setup ran anywhere that throttles
   *  requestAnimationFrame — including, unhelpfully, when trying to measure it. */
  function open(at = 0, autoplay = true): void {
    // Before `showModal`, so the scrollbar is still there to be measured.
    holdPage(true);
    if (!dialog.open) dialog.showModal();
    // Opened afresh, the lines draw themselves on rather than being there.
    resetLines();
    layoutField();
    layoutStrip();
    ro.observe(field.parentElement!);
    ro.observe(strip.parentElement!);
    goTo(at);
    // No autoplay under reduced motion: the reader steps through it.
    if (autoplay && !reduced.matches) setPlaying(true);
    render();

    // Webfonts land after this runs and reflow everything around the canvas, so
    // the size measured above is of a page that no longer exists. Left alone,
    // the canvas ends up taller than its box and `max-height` quietly scales
    // the whole field down — a smaller field with no error anywhere.
    void document.fonts?.ready.then(() => { layoutField(); layoutStrip(); render(); });
  }

  mount.querySelector<HTMLButtonElement>('[data-replay-open]')!.addEventListener('click', () => open(0));

  /** #replay opens it; #play-42 opens it on that play, paused — a link to one
   *  moment of a game is the thing anybody actually wants to send. */
  function openFromHash(): void {
    const m = /^#play-(\d+)$/.exec(location.hash);
    if (m) { open(Number(m[1]) - 1, false); return; }
    if (location.hash === '#replay') open(0);
  }
  window.addEventListener('hashchange', openFromHash);
  openFromHash();

  q<HTMLButtonElement>('[data-replay-close]').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => {
    holdPage(false);
    setPlaying(false);
    ro.disconnect();
    // The frame loop keeps going while the lines settle, so closing has to stop
    // it rather than leaving it painting a canvas nobody is looking at.
    if (raf) { cancelAnimationFrame(raf); raf = 0; lastAt = 0; }
  });
}
