/** One snap: two calls in, one result out.
 *
 *  The order is the order of a real play. Both sides line up; the defence's
 *  jobs are settled against the formation the offence actually shows; the
 *  rush gets home or does not, and when; the quarterback works his reads
 *  against that clock; and the ball goes somewhere. Football logic decides
 *  everything up to the throw. The measured tables decide what happens to the
 *  throw — Docs/PRACTICE.md §0 says why the line is drawn there.
 *
 *  Pure: everything random comes from the `rand` passed in, so a seeded game
 *  replays exactly and the calibration harness is reproducible. */
import {
  BLITZ_ORDER, ELIGIBLE, FORMATIONS, GAP_Y, HALF_WIDTH, HASH, LANDMARK, MAN, ROUTE, SHELLS,
  type Coverage, type DefJob, type DefSlot, type Formation, type Gap, type OffSlot, type RouteId, type Zone,
} from './kb';
import fit from './fit.json';
import { DEPTHED, World, setPace, type Look, type Motion, type Trace } from './world';
import type { Card, DefCall, League, League2026, OffCall, PlayerStats, Situation, TeamDoc } from './types';

// ── Randomness ───────────────────────────────────────────────────────────────

export type Rand = () => number;
export const seeded = (seed: number): Rand => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};
/** Draw from a measured distribution, given as evenly spaced quantiles.
 *  Between quantiles, a straight line. The two end values are not the
 *  extremes but the mean of the outermost bin (pipeline/practice.py
 *  `quantiles`), and those bins are drawn as an exponential tail with that
 *  mean — long runs are mostly a little long and now and then very long. */
export const sampleQ = (q: number[], u: number): number => {
  if (!q.length) return 0;
  const n = q.length - 1;
  const pos = Math.min(0.999999, Math.max(0, u)) * n;
  const lo = Math.floor(pos), f = pos - lo;
  if (n >= 4 && lo === n - 1) return q[n - 1]! + Math.max(0, q[n]! - q[n - 1]!) * -Math.log(1 - Math.min(f, 0.9999));
  if (n >= 4 && lo === 0) return q[1]! - Math.max(0, q[1]! - q[0]!) * -Math.log(Math.max(f, 0.0001));
  return q[lo]! + (q[Math.min(n, lo + 1)]! - q[lo]!) * f;
};
const normal = (rand: Rand) => Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());
const tri = (rand: Rand, a: number, m: number, b: number) => {
  const u = rand(), f = (m - a) / (b - a);
  return u < f ? a + Math.sqrt(u * (b - a) * (m - a)) : b - Math.sqrt((1 - u) * (b - a) * (b - m));
};
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const pick = <T>(rand: Rand, weighted: [T, number][]): T => {
  const total = weighted.reduce((n, [, w]) => n + Math.max(0, w), 0);
  let u = rand() * total;
  for (const [v, w] of weighted) { u -= Math.max(0, w); if (u <= 0) return v; }
  return weighted[weighted.length - 1]![0];
};

// ── Who is where ─────────────────────────────────────────────────────────────

export interface Spot { x: number; y: number; }
export interface Lineup<S extends string> { cards: Partial<Record<S, Card>>; at: Partial<Record<S, Spot>>; }

export const formation = (id: string): Formation => FORMATIONS.find((f) => f.id === id) ?? FORMATIONS[0]!;

/** The offence's eleven for a formation: its starters, slotted by what the
 *  formation asks for. A formation wanting a second tight end the club does
 *  not have takes a receiver instead, and so on down — the dot keeps the
 *  player's real position whatever slot he fills. */
export function offLineup(team: TeamDoc, f: Formation, moved?: OffCall['moved'], hashY = 0): Lineup<OffSlot> {
  const pool = (pos: string) => team.offence.filter((c) => c.pos === pos);
  const queues: Record<string, Card[]> = { QB: pool('QB'), RB: pool('RB'), WR: pool('WR'), TE: pool('TE') };
  const fallback: Record<string, string[]> = { TE: ['TE', 'WR', 'RB'], WR: ['WR', 'TE', 'RB'], RB: ['RB', 'WR', 'TE'], QB: ['QB'] };
  const cards: Partial<Record<OffSlot, Card>> = {};
  for (const a of f.align) {
    const kind = f.fill[a.slot];
    if (!kind) continue;
    for (const k of fallback[kind]!) {
      const c = queues[k]!.shift();
      if (c) { cards[a.slot] = c; break; }
    }
  }
  const T = pool('T'), G = pool('G'), C = pool('C');
  cards.LT = T[0] ?? G[2]; cards.RT = T[1] ?? G[2];
  cards.LG = G[0]; cards.RG = G[1]; cards.C = C[0] ?? G[2];
  const at: Partial<Record<OffSlot, Spot>> = {};
  for (const a of f.align) {
    const m = moved?.[a.slot];
    const y = m ? m.y : a.y + hashY;
    at[a.slot] = { x: m ? m.x : a.x, y: clamp(y, -HALF_WIDTH + 1, HALF_WIDTH - 1) };
  }
  return { cards, at };
}

const LINE_POS = new Set(['DE', 'DT', 'NT']);
const LB_POS = new Set(['OLB', 'ILB', 'MLB', 'LB']);
const S_POS = new Set(['FS', 'SS', 'S']);

/** The defence's eleven, slotted. Linemen on the line; edge linebackers made
 *  up to four rushers if the club lines up three down; corners outside, the
 *  third corner in the slot; safeties deep — and if a club plays its dime
 *  with one safety, its fourth corner stands in at the other. */
export function defLineup(team: TeamDoc): Partial<Record<DefSlot, Card>> {
  const left = [...team.defence];
  const take = (test: (c: Card) => boolean) => {
    const i = left.findIndex(test);
    return i < 0 ? undefined : left.splice(i, 1)[0];
  };
  const out: Partial<Record<DefSlot, Card>> = {};
  out.T1 = take((c) => c.pos === 'DT' || c.pos === 'NT') ?? take((c) => c.pos === 'DE');
  out.T2 = take((c) => c.pos === 'DT' || c.pos === 'NT') ?? take((c) => c.pos === 'DE');
  out.E1 = take((c) => c.pos === 'DE') ?? take((c) => c.pos === 'OLB') ?? take((c) => LINE_POS.has(c.pos));
  out.E2 = take((c) => c.pos === 'DE') ?? take((c) => c.pos === 'OLB') ?? take((c) => LINE_POS.has(c.pos));
  out.CB1 = take((c) => c.pos === 'CB' || c.pos === 'DB');
  out.CB2 = take((c) => c.pos === 'CB' || c.pos === 'DB');
  out.FS = take((c) => c.pos === 'FS') ?? take((c) => S_POS.has(c.pos));
  out.SS = take((c) => c.pos === 'SS') ?? take((c) => S_POS.has(c.pos));
  out.NB = take((c) => c.pos === 'CB' || c.pos === 'DB');
  out.FS ??= take((c) => c.pos === 'CB' || c.pos === 'DB');
  out.SS ??= take((c) => c.pos === 'CB' || c.pos === 'DB');
  out.LB2 = take((c) => LB_POS.has(c.pos));
  out.LB1 = take((c) => LB_POS.has(c.pos));
  out.LB3 = take((c) => LB_POS.has(c.pos));
  out.NB ??= take(() => true);
  out.LB3 ??= take(() => true);
  for (const k of Object.keys(out) as DefSlot[]) if (!out[k]) delete out[k];
  return out;
}

const TWO_HIGH = new Set<Coverage>(['2_MAN', 'COVER_2', 'COVER_4', 'COVER_6']);

/** Where the defence lines up before the snap. Corners over the widest
 *  receiver each side, the nickel over the slot, linebackers at five, the
 *  shell's safeties where it shows them. Coverages are disguised only so far
 *  as two-high and one-high look different; that is real, and it is the one
 *  thing a quarterback can see before the ball is snapped. `heavy` is an
 *  under-centre formation, which brings the eighth man down. */
export function defAlign(cards: Partial<Record<DefSlot, Card>>, cov: Coverage, off: Partial<Record<OffSlot, Spot>>, hashY: number,
                         heavy = false, maxX = Infinity, press = false): Partial<Record<DefSlot, Spot>> {
  const wide = (sign: 1 | -1) => {
    const ys = ELIGIBLE.map((s) => off[s]?.y).filter((y): y is number => y !== undefined && Math.sign(y - hashY) === sign && Math.abs(y - hashY) > 6);
    return ys.length ? (sign > 0 ? Math.max(...ys) : Math.min(...ys)) : hashY + sign * 16;
  };
  // The nickel takes the slot: an inside receiver who is not the widest man
  // on his side — the corner already has that one — and is outside the
  // tackle box. A tight end on the line is a linebacker's; following him
  // in, the nickel made an eight-man box twice as often as the league does.
  const slotY = (() => {
    const w1 = wide(1), w2 = wide(-1);
    const ys = ELIGIBLE.map((s) => off[s]?.y)
      .filter((y): y is number => y !== undefined && y !== w1 && y !== w2 && Math.abs(y - hashY) > 7 && Math.abs(y - hashY) < 16)
      .sort((a, b) => Math.abs(b - hashY) - Math.abs(a - hashY));
    return ys.length ? ys[0]! : hashY - 10;
  })();
  const at: Partial<Record<DefSlot, Spot>> = {
    E1: { x: 1.3, y: hashY + 4.9 }, T1: { x: 1.2, y: hashY + 1.3 }, T2: { x: 1.2, y: hashY - 1.3 }, E2: { x: 1.3, y: hashY - 4.9 },
    LB1: { x: 5, y: hashY + 3.5 }, LB2: { x: 5.5, y: hashY }, LB3: { x: 5, y: hashY - 3.5 },
    CB1: { x: 6, y: wide(1) }, CB2: { x: 6, y: wide(-1) }, NB: { x: 4.5, y: slotY },
    FS: TWO_HIGH.has(cov) ? { x: 12, y: hashY + 9 } : cov === 'COVER_0' ? { x: 7, y: hashY + 3 } : { x: 13, y: hashY },
    // The one-high strong safety walks down into the box against a heavy,
    // under-centre set; against spread looks he stays at eight, outside it.
    SS: TWO_HIGH.has(cov) ? { x: 12, y: hashY - 9 } : heavy ? { x: 6.5, y: hashY - 5 } : { x: 8.5, y: hashY - 7 },
  };
  if (!cards.LB3) { at.LB1 = { x: 5, y: hashY + 2 }; at.LB2 = { x: 5, y: hashY - 2 }; }
  // Press: in man, the corners and the nickel come up to a yard off their
  // men, shaded inside.
  if (press && MAN[cov]) for (const k of ['CB1', 'CB2', 'NB'] as DefSlot[]) {
    const p = at[k]; if (!p) continue;
    at[k] = { x: 1.2, y: p.y + Math.sign(hashY - p.y) * 0.6 };
  }
  for (const k of Object.keys(at) as DefSlot[]) if (!cards[k]) delete at[k];
  // Near the goal line the whole defence comes up: depths shrink with the
  // field left in front of the end line, and nobody lines up behind it. (Off
  // the ball at midfield depths, corners gave every hitch and out on the goal
  // line a five-yard cushion: inside the ten the engine completed 64% to the
  // league's 52.)
  const k = Number.isFinite(maxX) ? clamp((maxX - 9 + 4) / 16, 0.35, 1) : 1;
  for (const [slot, p] of Object.entries(at) as [DefSlot, Spot][]) {
    if (!['E1', 'T1', 'T2', 'E2'].includes(slot)) p.x = 1 + (p.x - 1) * k;
    if (p.x > maxX) p.x = maxX;
  }
  return at;
}

/** Defenders standing in the box: within seven yards of the ball and inside
 *  the tackles plus a step. What the measured run table is keyed on. */
export const boxCount = (at: Partial<Record<DefSlot, Spot>>, hashY: number): number =>
  Object.values(at).filter((p) => p && p.x <= 7.5 && Math.abs(p.y - hashY) <= 6).length;

// ── Jobs ─────────────────────────────────────────────────────────────────────

/** Every defender's job for this snap: the shell's, made to fit the offence
 *  that is actually there, with the blitz added and then any job the player
 *  has changed by hand.
 *
 *  Fitting matters for man coverage. A shell says the nickel takes the slot
 *  receiver; in two-tight-end sets there is no slot receiver, so he takes
 *  whoever is left uncovered, the way a real defence checks its calls. */
export function assignments(call: DefCall, cards: Partial<Record<DefSlot, Card>>, eligible: OffSlot[],
                            withOverrides = true, at?: Partial<Record<DefSlot, Spot>>): Partial<Record<DefSlot, DefJob>> {
  const jobs: Partial<Record<DefSlot, DefJob>> = {};
  for (const s of ['E1', 'T1', 'T2', 'E2'] as DefSlot[]) if (cards[s]) jobs[s] = { kind: 'rush' };
  const shell = SHELLS[call.coverage];
  for (const [s, j] of Object.entries(shell) as [DefSlot, DefJob][]) if (cards[s]) jobs[s] = j;
  for (const s of Object.keys(cards) as DefSlot[]) jobs[s] ??= { kind: 'zone', zone: 'HOOK_M' };

  // Man targets that do not exist go to receivers nobody has.
  if (MAN[call.coverage]) {
    const covered = new Set<OffSlot>();
    const lost: DefSlot[] = [];
    for (const [s, j] of Object.entries(jobs) as [DefSlot, DefJob][]) {
      if (j.kind !== 'man') continue;
      if (eligible.includes(j.on) && !covered.has(j.on)) covered.add(j.on);
      else lost.push(s);
    }
    const open = eligible.filter((e) => !covered.has(e));
    for (const s of lost) {
      const on = open.shift();
      jobs[s] = on ? { kind: 'man', on } : { kind: 'zone', zone: 'ROBBER' };
    }
    // Anyone still uncovered is taken by the robber, then a rusher spared.
    for (const on of open) {
      const spare = (Object.entries(jobs) as [DefSlot, DefJob][]).find(([, j]) => j.kind === 'zone' && (j.zone === 'ROBBER' || j.zone === 'HOOK_M'));
      if (spare) jobs[spare[0]] = { kind: 'man', on };
    }
  }

  // A shell's extra rushers stand down when the call sends fewer: the last
  // to blitz is the first to drop, into the middle or the deep middle.
  let rushing = (Object.values(jobs) as DefJob[]).filter((j) => j.kind === 'rush').length;
  for (const s of ['FS', ...[...BLITZ_ORDER].reverse()] as DefSlot[]) {
    if (rushing <= Math.max(4, call.rushers)) break;
    if (jobs[s]?.kind !== 'rush') continue;
    jobs[s] = { kind: 'zone', zone: s === 'FS' ? 'DEEP_M' : s === 'LB2' ? 'ROBBER' : 'HOOK_M' };
    rushing--;
  }
  // The blitz: more rushers, taken in order, each leaving his job empty.
  for (const s of BLITZ_ORDER) {
    if (rushing >= call.rushers) break;
    if (!cards[s] || jobs[s]?.kind === 'rush') continue;
    const was = jobs[s]!;
    jobs[s] = { kind: 'rush' };
    rushing++;
    // A blitzing man defender hands his man to the robber if there is one.
    if (was.kind === 'man') {
      const robber = (Object.entries(jobs) as [DefSlot, DefJob][]).find(([, j]) => j.kind === 'zone' && j.zone === 'ROBBER');
      if (robber) jobs[robber[0]] = { kind: 'man', on: was.on };
    }
  }
  // Fewer than four: an end drops into the middle.
  for (const s of ['E2', 'E1'] as DefSlot[]) {
    if (rushing <= call.rushers || rushing <= 3) break;
    if (call.rushers < 4 && jobs[s]?.kind === 'rush') { jobs[s] = { kind: 'zone', zone: 'HOOK_M' }; rushing--; }
  }
  if (at) spreadZones(jobs, at, SHELLS[call.coverage]);
  if (withOverrides && call.jobs) for (const [s, j] of Object.entries(call.jobs) as [DefSlot, DefJob][]) if (cards[s]) jobs[s] = j;
  return jobs;
}

/** Zones go to the defenders by where they line up, left to right — the
 *  underneath ones among those dropping underneath, the deep ones among those
 *  dropping deep — and when the blitz has taken some of the underneath
 *  droppers, those left spread across the field rather than keep the zones
 *  they had. (By slot, the nickel lined up over a slot on the left took the
 *  right flat, and a Cover 3 that sent both outside linebackers left one
 *  side of the field with nobody under it: hitches there were caught with the
 *  nearest defender fourteen yards off.) */
function spreadZones(jobs: Partial<Record<DefSlot, DefJob>>, at: Partial<Record<DefSlot, Spot>>,
                     shell: Partial<Record<DefSlot, DefJob>>): void {
  for (const deep of [false, true]) {
    const isDeep = (z: Zone) => LANDMARK[z].x >= 14;
    const who = (Object.entries(jobs) as [DefSlot, DefJob][])
      .filter(([s, j]) => j.kind === 'zone' && isDeep(j.zone) === deep && at[s]).map(([s]) => s);
    if (!who.length) continue;
    const mine = who.map((s) => (jobs[s] as { zone: Zone }).zone);
    // The shell's zones for the defenders on the field — those dropping and
    // those the blitz has taken — not for the ones it names who are not
    // there. (Counting the base defence's third linebacker against a nickel,
    // there was a zone too many to share out, and the one left out was the
    // middle: Cover 2's middle linebacker and Cover 4's hook defender were
    // gone on most snaps, and a dig crossing the middle had the nearest
    // underneath defender eight yards away when it was thrown; §27.)
    const meant = (Object.entries(shell) as [DefSlot, DefJob][]).flatMap(([s2, j]) => jobs[s2] && j.kind === 'zone' && isDeep(j.zone) === deep ? [j.zone] : []);
    let zones = [...new Set([...mine, ...meant])].sort((a, b) => LANDMARK[b].y - LANDMARK[a].y);
    // Deep, the blitz having taken a safety, those left rotate to cover the
    // whole field: one plays the deep middle, two the halves, three the
    // thirds. (Left with his half, the one safety in a Cover 2 that sent the
    // other had nobody beside him, and the go up the empty half was caught
    // with nobody behind it: half the go balls with twenty yards after the
    // catch were those.)
    if (deep && zones.length > who.length) {
      zones = who.length === 1 ? ['DEEP_M'] : who.length === 2 ? ['HALF_L', 'HALF_R'] : ['DEEP_L', 'DEEP_M', 'DEEP_R'].slice(0, who.length) as Zone[];
    }
    if (zones.length > who.length) {
      const m = who.length, k = zones.length;
      zones = m === 1 ? [zones.reduce((a, b) => Math.abs(LANDMARK[a].y) <= Math.abs(LANDMARK[b].y) ? a : b)]
        : Array.from({ length: m }, (_, i) => zones[Math.round((i * (k - 1)) / (m - 1))]!);
    }
    const order = [...who].sort((a, b) => at[b]!.y - at[a]!.y);
    order.forEach((s, i) => { jobs[s] = { kind: 'zone', zone: zones[Math.min(i, zones.length - 1)]! }; });
  }
}

// ── Geometry ─────────────────────────────────────────────────────────────────

const TYPICAL_BLOCKERS = 5.1;
const HURRY = 0.45;          // seconds he has to get rid of it once the rush arrives
/** What is fitted, by scripts/calibrate.ts (`make calibrate ARGS=fit`) so
 *  that the computer playing itself reproduces the league:
 *
 *  - readBias: how much more or less he looks to each route than its value
 *    alone says. The quick out is thrown far more than its expected points
 *    would justify, because it is there; the post far less.
 *  - manBias: how much more or less he looks to each route against man
 *    than against zone. Against man the league throws deeper and seldom
 *    behind the line; against zone it takes what is underneath.
 *  - nobody: what he does when the progression finds no one, pressured or
 *    clean — eat it, run, throw it away, or force it.
 *  - motion: the world's numbers and the catch model's (below). */
export const FIT = fit as {
  readBias: Partial<Record<RouteId, number>>;
  manBias?: Partial<Record<RouteId, number>>;
  /** How often the computer calls a screen, against its routes' share. */
  screenCall?: number;
  /** How often the computer presses in man coverage. */
  press?: number;
  nobody: Record<'pressured' | 'clean', { sack: number; scramble: number; away: number; throw: number }>;
  motion?: Partial<MotionFit>;
};
/** The world's numbers (world.ts, Docs/PRACTICE-MOTION.md), and the
 *  quarterback's and the catch's:
 *
 *  - tauCut, tauZoneBall, tauManBall, eye, v0, lead: see world.ts `Motion`.
 *  - pace: the share of top speed routes are run at.
 *  - kw, w0, thr: how much a yard of window is worth to the passer, the
 *    window he treats as ordinary, and how good a read has to look before he
 *    lets it go — fitted so he finds nobody open as often as the league's do.
 *  - acc: each route's accuracy against the league's for its depth — fitted
 *    to the route's completion rate; kwin, how a tight window makes a throw
 *    harder to place.
 *  - cthr: how close a defender has to be for the ball to be contested —
 *    fitted to FTN's share of contested balls; kcon, how much closer is worse.
 *  - intU, intC: interceptions off target and in a contest — fitted to the
 *    league's rate. hands: drops, if the fit needs them.
 *  - accP: accuracy under pressure, conF: the contested catch's level — each
 *    fitted to FTN's figure.
 *  - firstB, chkB: what the first read and the checkdown are worth over
 *    their windows — fitted to FTN's shares of throws by read.
 *  - manT, under, rob: man tightness, underneath zone depth, deep defenders
 *    robbing — fitted to FTN's contested shares against man and by depth
 *    (world.ts `Motion`).
 *  - bat: the chance a pass is batted down when a rusher's hands are in its
 *    path at the line (world.ts `throwTo`).
 *  - tackle: the chance a defender who reaches the ball-carrier after a catch
 *    brings him down — fitted to the league's yards after the catch. */
export interface MotionFit extends Motion {
  kw: number; w0: number; bat: number; thr: number; pace: number; tackle: number;
  acc?: Partial<Record<RouteId, number>>; kwin: number; cthr: number; kcon: number; intU: number; intC: number; hands?: number;
  /** Accuracy against man and against zone (§18). */
  accMan?: number; accZone?: number;
  accP: number; conF: number; firstB: number; chkB: number;
  manT: number; under: number; rob: number;
}
export const MOTION: MotionFit = {
  // Reaction: to a receiver's cut, a quarter of a second and a bit; a zone
  // defender watching the passer reads the windup and breaks almost as the
  // ball leaves; a man defender with his back to it, a third of a second on.
  tauCut: 0.28, tauZoneBall: 0.15, tauManBall: 0.35, eye: 0.3, v0: 24,
  kw: 0.22, w0: 2.5, bat: 0.3, thr: 0.15, pace: 0.9, tackle: 0.85,
  kwin: 0.06, cthr: 1.0, kcon: 0.5, intU: 1, intC: 0.15, accP: 1, conF: 1, firstB: 0.1, chkB: 0.1,
  manT: 1, under: 1, rob: 0.3, recog: 0.3, jump: 0.35,
  ...(fit as { motion?: Partial<MotionFit> }).motion,
};
const READ_NOISE = 0.15;     // what the world does not see: a misread, a receiver's own feel
const READY_JITTER = 0.12;   // seconds: how much a read's timing varies from snap to snap
/** The league's on-target rate for a throw `air` yards downfield, clean or
 *  pressured: interpolated between FTN's five-yard steps, held at the ends. */
function onTargetAt(C: League['catch'], air: number, pressured: boolean): number {
  const t = C.catchableByAir, k = pressured ? 'pressured' : 'clean';
  if (!t?.length) return C.catchable[air <= 0 ? 'behind' : air < 10 ? 'short' : air < 20 ? 'mid' : 'deep'][k];
  if (air <= t[0]!.air) return t[0]![k];
  for (let i = 1; i < t.length; i++) if (air <= t[i]!.air) {
    const a = t[i - 1]!, b = t[i]!, u = (air - a.air) / (b.air - a.air);
    return a[k] + (b[k] - a[k]) * u;
  }
  return t[t.length - 1]![k];
}
export const zoneSpot = (zone: keyof typeof LANDMARK, hashY: number): Spot =>
  ({ x: LANDMARK[zone].x, y: clamp(LANDMARK[zone].y + 0.4 * hashY, -HALF_WIDTH + 2, HALF_WIDTH - 2) });

// ── The snap ─────────────────────────────────────────────────────────────────

export interface Ctx { league: League; lg26: League2026; off: TeamDoc; def: TeamDoc; rand: Rand; }

export interface Result {
  kind: 'complete' | 'incomplete' | 'int' | 'sack' | 'scramble' | 'throwaway' | 'run';
  /** Yards for the offence, from the line of scrimmage. */
  gain: number;
  td: boolean; safety: boolean; turnover: boolean;
  /** Where the play ended, in the offence's frame, for the next snap and the
   *  picture. */
  end: Spot;
  clock: 'run' | 'complete' | 'incomplete' | 'sack' | 'scramble';
  coverage: Coverage; rushers: number; box: number;
  pressured: boolean; tPress: number | null;
  target?: OffSlot; route?: RouteId; air?: number; yac?: number; tThrow?: number;
  ballCarrier?: OffSlot | 'QB';
  gap?: Gap;
  credit: { by?: DefSlot; what?: 'tackle' | 'sack' | 'int' | 'pd' };
  /** The reads, as considered: who, when, how open. For the picture and the
   *  explanation. */
  reads: { slot: OffSlot; route: RouteId; tb: number; value: number }[];
  /** Which read in the progression he threw to; -1 if nobody came open and
   *  he did something else, or threw late to whoever was best. */
  readNo: number;
  /** The arithmetic, in words, for the panel after the play. */
  explain: string[];
  /** The world's frames, snap to catch (or to the moment he gave up on
   *  throwing), for a pass: the picture draws them as they were. */
  trace?: Trace;
  /** Knocked down at the line. */
  batted?: boolean;
  /** The ball as it arrived: on target or not, contested or not. */
  ball?: { onTarget: boolean; contested: boolean };
  /** How an incompletion happened, or that a pick was one — for the picture. */
  how?: 'drop' | 'pbu' | 'miss' | 'batted' | 'pick';
  /** Tackles broken after the catch. */
  broken?: number;
  /** Everything the picture needs to draw the play. */
  stage: {
    off: Lineup<OffSlot>; def: { cards: Partial<Record<DefSlot, Card>>; at: Partial<Record<DefSlot, Spot>> };
    jobs: Partial<Record<DefSlot, DefJob>>; call: OffCall; hashY: number; under: boolean;
    /** Yards to the goal line: the back of the end zone is ten beyond. */
    toGoal: number;
  };
}

const stat = (team: TeamDoc, c: Card | undefined): PlayerStats => (c ? team.players[c.id] ?? {} : {});
const pct = (x: number) => `${Math.round(x * 100)}%`;
const ratio = (x: number) => `×${x.toFixed(2)}`;

export function resolve(sit: Situation, oc: OffCall, dc: DefCall, ctx: Ctx): Result {
  const { league: L, off, def, rand } = ctx;
  const toGoal = 100 - sit.los;
  const f = formation(oc.formation);
  const O = offLineup(off, f, oc.moved, sit.hashY);
  const dCards = defLineup(def);
  const eligible = ELIGIBLE.filter((s) => O.cards[s]);
  const dAt = defAlign(dCards, dc.coverage, O.at, sit.hashY, f.under, toGoal + 9, dc.press);
  const jobs = assignments(dc, dCards, eligible, true, dAt);
  const rushers = (Object.values(jobs) as DefJob[]).filter((j) => j.kind === 'rush').length;
  const box = boxCount(dAt, sit.hashY);
  const stage = { off: O, def: { cards: dCards, at: dAt }, jobs, call: oc, hashY: sit.hashY, under: f.under, toGoal };
  const base = { coverage: dc.coverage, rushers, box, stage, credit: {} as Result['credit'] };
  const offR = off.rates.off, defR = def.rates.def;

  if (oc.kind === 'run') return run(sit, oc, ctx, base, jobs, dAt, O);

  // ── The rush.
  const blockers = 5 + eligible.filter((s) => oc.jobs[s] === 'BLOCK').length;
  const rKey = String(clamp(rushers, 3, 7));
  const basePress = L.pressure.byRushers[rKey]?.pressure ?? 0.26;
  // The measured rate already has a typical protection in it, a back staying
  // in a little under half the time; more blockers than that help, fewer
  // hurt, and a rusher nobody can block is worse again.
  const protection = clamp(Math.exp(0.25 * (TYPICAL_BLOCKERS - blockers)) * 1.3 ** Math.max(0, rushers - blockers), 0.6, 2.6);
  const pPress = clamp(basePress * protection * offR.sack ** 0.6 * defR.sack ** 0.6, 0.04, 0.92);
  const pressured = rand() < pPress;
  const free = blockers < rushers;
  const tPress = pressured
    ? (free ? tri(rand, 1.2, 1.5, 1.9) : tri(rand, 1.6, 2.5, 3.5) * (4 / Math.max(3, rushers)) ** 0.3)
    : null;
  /** Where each defender is likely to be by the time the ball-carrier goes
   *  down, for who can plausibly be credited with the tackle: a zone
   *  defender in his zone, a man defender with his man, a rusher near the
   *  line. */
  const likely = (target?: OffSlot, end?: Spot) => (s: DefSlot): Spot | undefined => {
    const j = jobs[s], a = dAt[s];
    if (!j || !a) return a;
    if (j.kind === 'zone') return zoneSpot(j.zone, sit.hashY);
    if (j.kind === 'man') return j.on === target && end ? end : O.at[j.on] ? { x: 8, y: O.at[j.on]!.y } : a;
    return { x: 0, y: a.y };
  };
  const qb = stat(off, O.cards.QB).qb;
  const qbCmp = qb?.cmp ?? 1, qbInt = qb?.int ?? 1, qbSack = qb?.sack ?? 1, qbAdot = qb?.adot ?? 7.5;
  const explain: string[] = [];
  explain.push(`${rushers} rushed against ${blockers} blocking: pressure on ${pct(basePress)} of dropbacks against ${rushers}, ` +
    `here ${pct(pPress)} after protection and both clubs' sack rates (${off.nick} ${ratio(offR.sack)}, ${def.nick} ${ratio(defR.sack)}).`);

  // ── The play, in the world (world.ts). The rush is the measured one —
  // whether it gets home, and when — and the man who gets there runs at the
  // quarterback in the world from a moment before; everything else there
  // moves as bodies do.
  const presser = pressured ? credit(def, dCards, jobs, 'sack', rand).by : undefined;
  setPace(MOTION.pace);
  const world = new World({ oCards: O.cards, oAt: O.at, dCards, dAt, jobs, call: oc, hashY: sit.hashY, under: f.under,
                            coverage: dc.coverage, toGoal, tPress, presser,
                            recog: Object.fromEntries(Object.keys(jobs).map((k) => [k, rand()])),
                            release: Object.fromEntries(Object.keys(jobs).map((k) => [k, rand()])),
                            speed: Object.fromEntries(Object.keys(jobs).map((k) => [k, normal(rand)])),
                            // How deep each break is this time: a hitch is a
                            // curl one snap in five, a quick out a flat one in
                            // five, as the league's are (§24). One depth for
                            // each route, the engine threw behind the line a
                            // quarter less often than the league, and never
                            // past twenty on a dig or a deep out.
                            depth: Object.fromEntries(eligible.flatMap((sl) => {
                              const job = oc.jobs[sl];
                              if (!job || job === 'BLOCK' || !DEPTHED.has(job)) return [];
                              const q = L.routes[job].air;
                              return [[sl, clamp(sampleQ(q, rand()) - sampleQ(q, 0.5), -6, 10)]];
                            })),
                            rhythm: Object.fromEntries(Object.entries(L.routes).map(([k, v]) => [k, v.ttt[1] - 0.2])) }, MOTION);
  const v0 = MOTION.v0 * clamp(1 + 0.015 * (qbAdot - 7.5), 0.94, 1.06);
  // No two dropbacks are timed alike: when each read comes up varies a
  // little from snap to snap. (Timed to the frame on every snap, a whole
  // concept's plays came out of a read together or not at all: a change of
  // six thousandths of a second in the wheel's timing took the post from 8%
  // of targets to 4%, and the fit could not settle across the cliff; §20.)
  for (const sl of Object.keys(world.ready) as OffSlot[]) world.ready[sl] = Math.max(0.3, world.ready[sl]! + READY_JITTER * normal(rand));

  // What each read is worth before anyone moves: the route against this
  // coverage, the receiver, the situation. What the world shows when the
  // quarterback looks is added to it then.
  const blitzing = rushers >= 5;
  const statics: Partial<Record<OffSlot, number>> = {};
  for (const sl of eligible) {
    const job = oc.jobs[sl];
    if (!job || job === 'BLOCK' || !world.routes[sl]) continue;
    const rs = L.routes[job], vs = L.vs[job][dc.coverage];
    const rec = stat(off, O.cards[sl]).rec;
    let v = (FIT.readBias[job] ?? 0) + (MAN[dc.coverage] ? FIT.manBias?.[job] ?? 0 : 0) + vs.epa + normal(rand) * READ_NOISE + 0.15 * Math.log((rec?.catch ?? 0.65) / 0.65);
    const typical = sampleQ(rs.air, 0.5) + sampleQ(rs.yac, 0.5);
    if (sit.down >= 3) v += typical < sit.togo ? -0.35 * clamp((sit.togo - typical) / sit.togo, 0, 1) : 0.08;
    if (blitzing && rs.ttt[1] <= 2.3) v += 0.12;                     // the hot read
    if (sampleQ(rs.air, 0.5) >= 12) v += 0.08 * (qbAdot - 7.5);       // a quarterback who looks deep
    if (sit.los + sampleQ(rs.air, 0.5) > 108) v -= 0.3;               // no room behind it near the goal line
    statics[sl] = v;
  }
  // Open is open: past three and a half yards a wider window is worth no
  // more to him. (Uncapped, a screen's ten-yard window outbid everything and
  // screens were thrown half again as often as the league throws them.)
  const reads: Result['reads'] = [];
  const note = (sl: OffSlot, t: number, v: number) => {
    const r = reads.find((x) => x.slot === sl);
    if (!r) reads.push({ slot: sl, route: oc.jobs[sl] as RouteId, tb: t, value: v });
    else if (v > r.value) { r.value = v; r.tb = t; }
  };

  // The progression. He looks at one read at a time, in the order called,
  // from when it is ready; he throws the moment the man he is looking at has
  // a window worth throwing into, or moves his eyes on. The world runs on
  // the whole time — and the zone defenders watch where he looks.
  // First read, second read, then the checkdown — the called order's last,
  // a back or a tight end underneath — and only then anyone else. Worked
  // straight down the order, the checkdown came too late to be thrown: 2% of
  // throws against FTN's 14%.
  const called = [...oc.reads.filter((x) => statics[x] !== undefined),
                  ...(Object.keys(statics) as OffSlot[]).filter((x) => !oc.reads.includes(x)).sort((a2, b2) => world.ready[a2]! - world.ready[b2]!)];
  const order = called.length > 3 ? [called[0]!, called[1]!, called[called.length - 1]!, ...called.slice(2, -1)] : called;
  // The first read is the play — he wants to throw it — and the last is the
  // checkdown, there to be thrown when nothing else is. (FTN: 58% of throws
  // go to the first read and 10% more are designed throws, 11% to the
  // second, 14% are checkdowns.)
  const value = (sl: OffSlot, lk: Look) => statics[sl]! + MOTION.kw * (Math.min(lk.window, lk.lane + 0.6, 3.5) - MOTION.w0)
    + (sl === order[0] ? MOTION.firstB : 0) + (order.length > 2 && sl === order[2] ? MOTION.chkB : 0);
  const T_CLEAN = 4.0, DWELL = 0.4, EYES = 0.12;
  const limit = tPress ?? T_CLEAN;
  let target: OffSlot | null = null, hurried = false, readNo = -1;
  let k = 0, from = order.length ? Math.max(world.tDrop, world.ready[order[0]!]! - 0.1) : Infinity;
  // A route is thrown in its window: from when it is ready until the league's
  // late time for it (its three-quarter time to throw) and half a second
  // more. After that it is not the throw any more — a slant thrown late was
  // caught at eleven yards, a go at forty.
  const expires = (sl: OffSlot) => {
    const q = L.routes[oc.jobs[sl] as RouteId].ttt;
    return world.ready[sl]! + (q[2] - q[0]) + 0.5;
  };
  while (world.t < limit) {
    const sl = order[k];
    if (sl && world.t >= from && world.t > expires(sl)) {
      k++;
      const nx = order[k];
      if (nx) from = Math.max(world.t + EYES, world.ready[nx]! - 0.1);
    } else if (sl && world.t >= from) {
      world.looking = sl;
      if (world.t >= world.ready[sl]!) {
        const lk = world.look(sl, v0), v = value(sl, lk);
        note(sl, world.t, v);
        // A screen is a designed throw: it goes when it is set up, unless a
        // defender is already on it — not when it looks better than the
        // threshold, by which time it was blown up. (Weighed like any read,
        // receiver screens were thrown at three seconds for no yards.)
        const designed = oc.jobs[sl] === 'SCREEN' && k === 0 && lk.window > 1.2;
        if (designed || v >= MOTION.thr - 0.07 * k) { target = sl; readNo = k; break; }
        if (world.t >= Math.max(from, world.ready[sl]!) + DWELL) {
          k++;
          const nx = order[k];
          if (nx) from = Math.max(world.t + EYES, world.ready[nx]! - 0.1);
        }
      }
    }
    world.step();
  }

  if (!target) {
    // Pressure gives him a beat more — a hitch, a slide — to get it to
    // whoever is open, before he has to eat it or run.
    if (tPress !== null) while (world.t < tPress + HURRY) world.step();
    // Forced, he throws to whoever is least covered — the window first, what
    // the read is worth only between windows alike. (Taking the read worth
    // most, he threw the go into coverage: nearly half the deep balls against
    // man were forced, two in three of them contested.)
    const ready = order.filter((x) => world.ready[x]! <= world.t)
      .map((x) => { const lk = world.look(x, v0); return { x, v: value(x, lk), w: Math.min(lk.window, lk.lane + 0.6) + 0.3 * statics[x]! }; })
      .sort((p, q) => q.w - p.w);
    const nb = tPress !== null ? FIT.nobody.pressured : FIT.nobody.clean;
    const w: [string, number][] = [['sack', nb.sack * qbSack], ['scramble', nb.scramble], ['away', nb.away],
      ['throw', ready.length ? nb.throw : 0]];
    const what = pick(rand, w);
    const limitT = world.t;
    if (what === 'throw') { target = ready[0]!.x; hurried = tPress !== null; note(target, world.t, ready[0]!.v); }
    else if (what === 'sack') {
      const lost = Math.round(sampleQ(L.pressure.sackYards, rand()));
      const gain = -Math.min(lost, sit.los);
      explain.push(`Nobody open before the rush arrived at ${limitT.toFixed(1)}s — sacked, as ${pct(L.pressure.sackGivenPressure)} of pressured dropbacks are.`);
      return { ...base, kind: 'sack', gain, td: false, safety: sit.los + gain <= 0, turnover: false, end: { x: gain, y: sit.hashY },
               clock: 'sack', pressured, tPress, reads, readNo, explain, ballCarrier: 'QB', trace: world.trace(),
               credit: presser ? { by: presser, what: 'sack' } : credit(def, dCards, jobs, 'sack', rand) };
    } else if (what === 'scramble') {
      const gain = Math.round(Math.min(toGoal, sampleQ(L.pressure.scrambleYards, rand())));
      explain.push(`Nothing there, so he ran: scrambles gain ${sampleQ(L.pressure.scrambleYards, 0.5)} yards at the median.`);
      return { ...base, kind: 'scramble', gain, td: sit.los + gain >= 100, safety: false, turnover: false, end: { x: gain, y: sit.hashY + 4 * (rand() - 0.5) },
               clock: 'scramble', pressured, tPress, reads, readNo, explain, ballCarrier: 'QB', trace: world.trace(),
               credit: credit(def, dCards, jobs, 'tackle', rand, undefined, { end: { x: gain, y: sit.hashY }, at: likely() }) };
    } else {
      explain.push(`Nobody open${tPress !== null ? ' and the rush home' : ''} — thrown away, as ${pct(tPress !== null ? L.pressure.awayPressured : L.pressure.awayClean)} of ${tPress !== null ? 'pressured' : 'clean'} throws are.`);
      return { ...base, kind: 'throwaway', gain: 0, td: false, safety: false, turnover: false, end: { x: 0, y: sit.hashY },
               clock: 'incomplete', pressured, tPress, reads, readNo, explain, credit: {}, trace: world.trace() };
    }
  }

  // ── The throw, and the catch (Docs/PRACTICE-MOTION.md §9). Three things
  // decide it, in the order they happen, each from what the world shows and
  // each fitted to FTN's charting of 2025's passes:
  //  1. On target? At the release: the league's rate for the depth and the
  //     pressure, moved by the passer and by the window he is throwing into.
  //     A throw off target goes where it went, past or short of the man.
  //  2. Contested? At the arrival: a defender within reach of the ball.
  //  3. Who wins it? Contested: the receiver's hands against the defender's
  //     position — lost, it is broken up, now and then picked. Uncontested:
  //     caught, unless dropped. Off target: picked off if a defender is where
  //     it comes down; once in a long while caught anyway.
  const s = target, route = oc.jobs[s] as RouteId;
  const C = L.catch;
  world.looking = s;
  const lk = world.look(s, v0);
  const plannedAir = lk.at.x;
  // How often the league puts a throw this deep where it can be caught —
  // smoothly with depth, between FTN's five-yard steps (§25). (In its four
  // bands, it stepped down at ten yards and again at twenty: a go caught at
  // fifteen was put on target as often as a curl, one at thirty as often as
  // one at twenty-one, and the deep balls were completed too seldom while
  // every deep route's completion as a whole was the league's.)
  const baseAcc = onTargetAt(C, plannedAir, pressured);
  const accF = (MOTION.acc?.[route] ?? 1) * qbCmp ** 0.8 * offR.cmp ** 0.3 * defR.cmp ** 0.3 * (hurried ? 0.92 : 1) * (pressured ? MOTION.accP : 1)
    * Math.exp(MOTION.kwin * (Math.min(lk.window, 4) - 2.9))
    // Against man and against zone, each fitted to FTN's on-target rate for
    // it (§18): a ball into man coverage has to be put where only he can get
    // it, with a body on him; into zone, to a spot. (From the window alone,
    // the engine had the two a point or two apart, to the league's ten.)
    * (MAN[dc.coverage] ? MOTION.accMan ?? 1 : MOTION.accZone ?? 1);
  const pOn = clamp(baseAcc * accF, 0.05, 0.98);
  const onTarget = rand() < pOn;
  // Off target: long more often than short, now and then wide.
  let offBy: Spot | undefined;
  let missed: 'long' | 'short' | 'wide' | null = null;
  if (!onTarget) {
    const from = world.qb(), dx = lk.at.x - from.x, dy = lk.at.y - from.y, dl = Math.hypot(dx, dy) || 1;
    const ux = dx / dl, uy = dy / dl;
    const u = rand();
    missed = u < 0.55 ? 'long' : u < 0.8 ? 'short' : 'wide';
    const m = missed === 'long' ? 3 + rand() * 3.5 : missed === 'short' ? -(2 + rand() * 2.5) : 0;
    const w = missed === 'wide' ? (rand() < 0.5 ? -1 : 1) * (3 + rand() * 2) : (rand() - 0.5) * 1.5;
    offBy = { x: ux * m - uy * w, y: uy * m + ux * w };
  }
  world.throwTo(s, v0, offBy);
  const onHim = world.batBy;
  world.flyToCatch();
  const tr = world.trace();
  const tThrow = tr.tThrow!;
  const catchAt = tr.catchAt!;
  const sepEff = Math.min(tr.sep, tr.lane + 0.6);
  const close = tr.lane + 0.6 < tr.sep ? tr.laneBy : tr.nearest;
  const rec = stat(off, O.cards[s]).rec;
  const recF = (rec?.catch ?? 0.65) / 0.65;
  const who = O.cards[s]?.short ?? s;
  const name = (d2: DefSlot | null | undefined) => (d2 ? dCards[d2]?.short ?? 'a defender' : 'a defender');
  const covName = dc.coverage.replace('COVER_', 'Cover ').replace('2_MAN', '2-Man');
  const nth = ['first', 'second', 'third', 'fourth', 'fifth'][readNo] ?? null;
  const yd = (x: number) => `${Math.round(x)} yard${Math.abs(Math.round(x)) === 1 ? '' : 's'}`;
  explain.push(`Thrown to ${who} on the ${route.toLowerCase()} against ${covName}${nth ? `, his ${nth} read` : hurried ? ', hurried' : ', late'}, ${plannedAir < 0.5 ? 'behind the line' : `${yd(plannedAir)} downfield`}.`);
  explain.push(`${onTarget ? 'On target' : `Off target — ${missed === 'long' ? 'overthrown' : missed === 'short' ? 'short of him' : 'wide of him'}`}: ` +
    `the league puts ${pct(baseAcc)} of throws that deep${pressured ? ' under pressure' : ' from a clean pocket'} where they can be caught; this one ${pct(pOn)} — ` +
    `${O.cards.QB?.short ?? 'the quarterback'} ${ratio(qbCmp)}, into a ${lk.window.toFixed(1)}-yard window.`);

  const air = Math.round(catchAt.x);
  // Contested is geometry, on target or not: a defender on the ball.
  const ball = { onTarget, contested: sepEff < MOTION.cthr };
  const result = (kind: Result['kind'], how: Result['how'], cr: Result['credit'], extra: Partial<Result> = {}): Result =>
    ({ ...base, kind, gain: 0, td: false, safety: false, turnover: false, end: { x: 0, y: sit.hashY },
       clock: 'incomplete', pressured, tPress, reads, readNo, explain, credit: cr, target: s, route, air, tThrow, ballCarrier: s, trace: tr, how, ball, ...extra });
  // Batted at the line: a rusher's hands in the ball's path as it left.
  if (onHim && rand() < MOTION.bat) {
    explain.push(`Batted down at the line by ${name(onHim)}, whose hands were in the path of a low throw.`);
    return result('incomplete', 'batted', { by: onHim, what: 'pd' }, { batted: true });
  }
  // A ball that comes down beyond the end line is no catch.
  if (air > toGoal + 10) {
    explain.push('Out of the back of the end zone.');
    return result('incomplete', 'miss', {});
  }
  const intPick = (p: number, by: DefSlot | null) => {
    const back = Math.round(Math.max(0, tri(rand, -2, 5, 30)));
    explain.push(`Intercepted by ${name(by)} — ${pct(p)} chance on this one.`);
    return result('int', 'pick', by ? { by, what: 'int' } : {}, { turnover: true, end: { x: air - back, y: catchAt.y } });
  };
  if (!onTarget) {
    // A bad ball: picked if a defender is where it came down, which is how
    // nine interceptions in ten happen.
    const pInt = clamp(C.intUncatchable * MOTION.intU * qbInt ** 0.7 * defR.int * Math.exp(-0.6 * (tr.ballSep - 2)), 0, 0.6);
    if (rand() < pInt) return intPick(pInt, tr.ballBy);
    if (tr.reach < 2 && rand() < C.cmpUncatchable / 0.4) { explain.push(`${who} got to it anyway — one of the ${pct(C.cmpUncatchable)} of bad balls that are caught.`); }
    else {
      explain.push(`${tr.ballBy && tr.ballSep < 3 ? `${name(tr.ballBy)} was ${tr.ballSep.toFixed(1)} yards from it; ` : ''}${pct(pInt)} it would be picked.`);
      return result('incomplete', 'miss', {});
    }
  } else if (sepEff < MOTION.cthr) {
    // Contested: hands against position. Closer is worse for the receiver.
    const pWin = clamp(C.cmpContested * MOTION.conF * recF ** 0.6 * defR.cmp ** 0.5 * Math.exp(MOTION.kcon * (sepEff - MOTION.cthr / 2)), 0.15, 0.95);
    explain.push(`Contested: ${name(close)} was ${sepEff.toFixed(1)} yards from him when it arrived. Receivers win ${pct(C.cmpContested)} of contested catchable balls; here ${pct(pWin)} — ${who} ${ratio(recF)} the league's catch rate, ${def.nick} allow ${ratio(defR.cmp)}.`);
    if (rand() >= pWin) {
      const pPick = clamp(MOTION.intC * defR.int, 0, 0.5);
      if (rand() < pPick) return intPick(pPick * (1 - pWin), close);
      explain.push(`Broken up by ${name(close)}.`);
      return result('incomplete', 'pbu', close ? { by: close, what: 'pd' } : {});
    }
  } else {
    // Open: caught, unless he drops it.
    const pCatch = clamp(C.cmpUncontested * recF ** 0.4 * (MOTION.hands ?? 1), 0.6, 0.995);
    explain.push(`${sepEff >= 3 ? `Open: nobody within ${sepEff.toFixed(1)} yards of him when it arrived` : `Uncontested: the nearest defender ${sepEff.toFixed(1)} yards off when it arrived`}. ` +
      `Catchable balls nobody contests are caught ${pct(C.cmpUncontested)} of the time; ${who} ${pct(pCatch)}.`);
    if (rand() >= pCatch) { explain.push('Dropped.'); return result('incomplete', 'drop', {}); }
  }
  // After the catch, in the world: he runs, they run him down. A receiver
  // with more yards after the catch than the league breaks more tackles; so
  // does a defence that gives up more yards a throw.
  const elusive = clamp(((rec?.yac ?? 4.8) / 4.8) ** 0.7 * (offR.ypa * defR.ypa) ** 0.5 * L.vs[route][dc.coverage].yac, 0.4, 2.5);
  const miss = clamp((1 - MOTION.tackle) * elusive, 0.02, 0.7);
  const ac = air >= toGoal ? null : world.afterCatch(s, { rand, tackle: () => 1 - miss });
  const trace = world.trace();
  const endX = ac ? ac.end.x : catchAt.x;
  let gain = Math.round(Math.min(endX, toGoal));
  if (air >= toGoal || ac?.td) gain = toGoal;
  const yac = gain - air;
  const td = sit.los + gain >= 100;
  const endY = clamp(ac ? ac.end.y : catchAt.y, -HALF_WIDTH + 0.5, HALF_WIDTH - 0.5);
  if (ac) explain.push(`After the catch: ${yac} yard${Math.abs(yac) === 1 ? '' : 's'}` +
    `${ac.broken.length ? `, through ${ac.broken.length === 1 ? 'a broken tackle' : `${ac.broken.length} broken tackles`} (${ac.broken.map((b) => dCards[b]?.short ?? b).join(', ')})` : ''}` +
    `${ac.td ? ', into the end zone' : ac.out ? ', and out of bounds' : ac.by ? `, brought down by ${dCards[ac.by]?.short ?? 'the defence'}` : ''}` +
    ` — ${pct(miss)} of tackles missed against him, ${who} ${ratio(((rec?.yac ?? 4.8) / 4.8))} the league's yards after the catch.`);
  // The man who made the tackle is the man the world says did; pushed out,
  // whoever was on him.
  const pushedBy = ac?.out ? (Object.entries(world.d) as [DefSlot, { x: number; y: number }][])
    .filter(([, b]) => Math.hypot(b.x - ac.end.x, b.y - ac.end.y) < 2.5).map(([d2]) => d2)[0] : undefined;
  return { ...base, kind: 'complete', gain, td, safety: false, turnover: false,
           end: { x: gain, y: endY },
           clock: 'complete', pressured, tPress, reads, readNo, explain, trace,
           credit: td ? {} : ac?.by ? { by: ac.by, what: 'tackle' } : pushedBy ? { by: pushedBy, what: 'tackle' } : {}, target: s, route, air, yac, tThrow, ballCarrier: s,
           broken: ac?.broken.length ?? 0, ball };
}

function run(sit: Situation, oc: OffCall, ctx: Ctx, base: Omit<Result, 'kind' | 'gain' | 'td' | 'safety' | 'turnover' | 'end' | 'clock' | 'pressured' | 'tPress' | 'reads' | 'readNo' | 'explain'>,
             jobs: Partial<Record<DefSlot, DefJob>>, dAt: Partial<Record<DefSlot, Spot>>, O: Lineup<OffSlot>): Result {
  const { league: L, lg26, off, def, rand } = ctx;
  const gap = oc.gap ?? 'middle';
  const toGoal = 100 - sit.los;
  const explain: string[] = [];
  let gain: number;
  const runner = oc.runner === 'QB' ? O.cards.QB : O.cards.RB ?? O.cards.FB;
  if (oc.runner === 'QB') {
    gain = pick(rand, [[-1, 0.05], [0, 0.12], [1, 0.45], [2, 0.23], [3, 0.1], [5, 0.05]]);
    explain.push(`A sneak behind the centre: a yard or more about four times in five.`);
  } else {
    const g = L.run.gaps[gap];
    const box = clamp(base.box, 4, 9);
    const shift = L.run.box[String(box)]?.shift ?? 0;
    const rush = stat(off, runner).rush;
    const team = ((off.rates.off.ypc ** 0.6) * (def.rates.def.ypc ** 0.6) * ((rush?.ypc ?? 1) ** 0.5) - 1) * lg26.ypc;
    let blitz = 0;
    for (const [s, j] of Object.entries(jobs) as [DefSlot, DefJob][]) {
      if (j.kind !== 'rush' || ['E1', 'T1', 'T2', 'E2'].includes(s)) continue;
      blitz += Math.abs((dAt[s]?.y ?? 0) - sit.hashY - GAP_Y[gap]) <= 2.5 ? -0.9 : 0.5;
    }
    gain = sampleQ(g.yards, rand()) + shift + team + blitz;
    explain.push(`${runner?.short ?? 'The back'} ${gap === 'middle' ? 'up the middle' : `off ${gap}`}: runs there gain ${sampleQ(g.yards, 0.5)} yards at the median ` +
      `(${g.n} in 2025); ${box} in the box is ${shift >= 0 ? '+' : ''}${shift.toFixed(1)} against the average.`);
    explain.push(`${off.nick} run for ${ratio(off.rates.off.ypc)} the league's yards a carry, ${def.nick} allow ${ratio(def.rates.def.ypc)}` +
      `${rush ? `, ${runner!.short} ${ratio(rush.ypc)}` : ''}${blitz ? `; the blitz ${blitz < 0 ? 'came through the hole' : 'went elsewhere, one fewer to tackle'}` : ''}.`);
  }
  gain = Math.round(clamp(gain, -sit.los, toGoal));
  const fumble = oc.runner !== 'QB' && rand() < L.run.fumbleLost;
  const td = !fumble && sit.los + gain >= 100;
  if (fumble) explain.push(`Fumbled and lost, as ${pct(L.run.fumbleLost)} of runs are.`);
  return { ...base, kind: 'run', gain, td, safety: sit.los + gain <= 0, turnover: fumble,
           end: { x: gain, y: sit.hashY + GAP_Y[gap] * 0.8 + (rand() - 0.5) * 3 }, clock: 'run',
           pressured: false, tPress: null, reads: [], readNo: -1, explain, gap, ballCarrier: oc.runner === 'QB' ? 'QB' : 'RB',
           credit: td ? {} : credit(def, base.stage.def.cards, jobs, 'tackle', rand, undefined,
             { end: { x: gain, y: sit.hashY + GAP_Y[gap] }, at: (sl) => dAt[sl] }) };
}

/** Who gets the credit on screen. Weighted by the defender's own season —
 *  a club's leading tackler makes more of its tackles here, as he does there
 *  — and by who was in a position to: rushers for sacks, the man covering
 *  the target for a pass broken up or picked off. */
function credit(def: TeamDoc, cards: Partial<Record<DefSlot, Card>>, jobs: Partial<Record<DefSlot, DefJob>>,
                what: 'tackle' | 'sack' | 'int' | 'pd', rand: Rand, target?: OffSlot,
                near?: { end: Spot; at: (s: DefSlot) => Spot | undefined }): Result['credit'] {
  const ws: [DefSlot, number][] = [];
  for (const [s, c] of Object.entries(cards) as [DefSlot, Card][]) {
    const d = def.players[c.id]?.def;
    const j = jobs[s];
    let w = 0.4;
    if (what === 'sack') w = j?.kind === 'rush' ? 1 + 2 * (d?.sk ?? 0) + 0.3 * (d?.qbh ?? 0) : 0;
    else if (what === 'tackle') {
      w = 1 + (d?.tkl ?? 0);
      // And by who could have been there. Weighted by season alone, a club's
      // leading tackler made tackles thirty yards from where he was playing,
      // and the picture had him cross the field at four times a man's speed
      // to make them.
      const at = near?.at(s);
      if (near && at) w *= Math.exp(-Math.hypot(at.x - near.end.x, at.y - near.end.y) / 6);
    }
    else {
      const on = j?.kind === 'man' && j.on === target;
      w = (on ? 6 : j?.kind === 'zone' ? 1.2 : 0.1) * (1 + (what === 'int' ? 2 * (d?.int ?? 0) : 0.6 * (d?.pd ?? 0)));
    }
    if (w > 0) ws.push([s, w]);
  }
  return ws.length ? { by: pick(rand, ws), what } : {};
}

export { HASH };
