/** The field as a physical place: bodies that accelerate and cut, defenders
 *  who see some things and not others, a ball that flies.
 *
 *  Docs/PRACTICE-MOTION.md is the design. The engine (engine.ts) runs a pass
 *  play here from the snap — receivers on their routes, coverage reacting,
 *  the rush, the quarterback's eyes moving through his reads — and decides
 *  from what it sees: who is open when he looks, where the ball has to go to
 *  meet the man, how far it has to fly, how close the nearest defender is
 *  when it gets there. The same frames are what the picture draws up to the
 *  catch, so the picture and the result cannot disagree.
 *
 *  All in the offence's frame: x downfield from the line, y across, positive
 *  to the quarterback's left. Pure: randomness comes in from outside. */
import { ELIGIBLE, HALF_WIDTH, LANDMARK, ROUTE, type DefJob, type DefSlot, type OffSlot, type RouteId } from './kb';
import type { Card, OffCall } from './types';

export const FPS = 30;
export const DT = 1 / FPS;
const G = 10.7;                 // gravity, yards a second squared
const T_MAX = 7;                // the longest a pass play is simulated
const REACH = 3.0;              // how high a defender can get a hand to the ball, yards

export interface Spot { x: number; y: number; }
const dist = (a: Spot, b: Spot) => Math.hypot(a.x - b.x, a.y - b.y);
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

// ── Bodies ───────────────────────────────────────────────────────────────────

/** Top speed and acceleration by position. Representative of Next Gen
 *  Stats in-game figures (the fastest ball-carriers reach about ten yards a
 *  second, linemen seven); the calibration refines what matters through the
 *  reaction delays rather than these. */
export interface Profile { vmax: number; acc: number; }
export function profile(pos: string): Profile {
  if (['WR', 'CB', 'DB', 'FS', 'SS', 'S'].includes(pos)) return { vmax: 9.2, acc: 4.2 };
  if (pos === 'RB' || pos === 'FB') return { vmax: 9.0, acc: 4.3 };
  if (pos === 'TE') return { vmax: 8.5, acc: 3.7 };
  if (['OLB', 'ILB', 'MLB', 'LB'].includes(pos)) return { vmax: 8.6, acc: 3.8 };
  if (pos === 'QB') return { vmax: 7.8, acc: 3.4 };
  if (pos === 'DE') return { vmax: 8.2, acc: 3.5 };
  if (pos === 'DT' || pos === 'NT') return { vmax: 7.2, acc: 3.0 };
  if (['T', 'G', 'C', 'OT', 'OG'].includes(pos)) return { vmax: 6.8, acc: 2.8 };
  return { vmax: 8.0, acc: 3.4 };
}

interface Body extends Spot { vx: number; vy: number; vmax: number; acc: number; }
const body = (at: Spot, p: Profile): Body => ({ x: at.x, y: at.y, vx: 0, vy: 0, vmax: p.vmax, acc: p.acc });

/** Steer toward a point, arriving rather than overshooting: accelerate up to
 *  `speed` (never past top speed), brake in time to stop on it. Stopping is
 *  quicker than starting. */
/** Acceleration falls off with speed — hardest from a standstill, least at
 *  top speed, two and a half times as hard from a standing start as at full
 *  speed — as a sprinter's does; braking and planting to change direction
 *  use the legs' stopping power, which is greater. (With one flat rate, a
 *  receiver took a second to cover his first two yards and a backpedalling
 *  corner two seconds to turn round and drive on a slant.) */
const accel = (b: { acc: number; vmax: number }, v: number) => b.acc * (2.4 - 1.8 * Math.min(1, v / b.vmax));
const BRAKE = 2.3;            // about 9.5 yd/s² for a back — the top of what tracking shows
/** Change velocity toward (tx, ty) within what legs allow: speeding up
 *  along the way he is going is the slow part, and tapers toward top speed;
 *  slowing down and turning are what a planted foot does, up to the braking
 *  limit, together. (Turning drawn from the speeding-up budget, a corner at
 *  full speed could hardly turn at all, and ran two or three yards past
 *  every break he had read.) */
function steer(b: Body, tx: number, ty: number): void {
  let ax = tx - b.vx, ay = ty - b.vy;
  const v0 = Math.hypot(b.vx, b.vy), grip = b.acc * BRAKE * DT;
  // Up to a jog he pushes off whichever way he wants at the rate he can
  // speed up: splitting his push into along and across the way he was
  // drifting, a zone defender shuffling at a yard a second spent the push on
  // turning and covered a yard of a three-and-a-half-yard break on the ball
  // while it was in the air (§26).
  if (v0 < 2.5) {
    const a = Math.hypot(ax, ay), lim = accel(b, v0) * DT;
    if (a > lim) { ax = (ax / a) * lim; ay = (ay / a) * lim; }
  } else {
    const ux = b.vx / v0, uy = b.vy / v0;
    let al = ax * ux + ay * uy, px = ax - al * ux, py = ay - al * uy;
    al = al > 0 ? Math.min(al, accel(b, v0) * DT) : Math.max(al, -grip);
    // Going back the way he came — a reversal, more than 120 degrees — he
    // plants and stops first; otherwise slowing and turning share the grip.
    // (Sharing it on a reversal, an underneath defender backpedalling at the
    // throw swung round in a two-yard arc the wrong way, and a deep third
    // in a five-yard one.)
    const tl = Math.hypot(tx, ty);
    if (tl > 0.3 && (tx * b.vx + ty * b.vy) / (tl * v0) < -0.5) {
      const pl = Math.hypot(px, py), room = Math.sqrt(Math.max(0, grip * grip - al * al));
      if (pl > room) { px *= room / pl; py *= room / pl; }
    } else {
      const tot = Math.hypot(al, px, py);
      if (tot > grip) { al *= grip / tot; px *= grip / tot; py *= grip / tot; }
    }
    ax = al * ux + px; ay = al * uy + py;
  }
  b.vx += ax; b.vy += ay;
}
function seek(b: Body, to: Spot, speed: number): void {
  const dx = to.x - b.x, dy = to.y - b.y, d = Math.hypot(dx, dy);
  const brake = Math.sqrt(2 * b.acc * BRAKE * Math.max(0, d - 0.05));
  const want = Math.min(speed, b.vmax, brake);
  const tx = d > 1e-6 ? (dx / d) * want : 0, ty = d > 1e-6 ? (dy / d) * want : 0;
  steer(b, tx, ty);
  const v = Math.hypot(b.vx, b.vy);
  if (v > b.vmax) { b.vx *= b.vmax / v; b.vy *= b.vmax / v; }
  b.x += b.vx * DT; b.y = clamp(b.y + b.vy * DT, -HALF_WIDTH + 0.4, HALF_WIDTH - 0.4);
}
/** Run with a moving man: match his velocity (as seen), and close on the
 *  spot you should hold relative to him. "Arrive" steering, braking to stop
 *  on that spot, had a corner standing still at nine yards as his receiver
 *  ran past him at full speed — and from a standstill he trailed every route
 *  that broke after it. */
function pursue(b: Body, at: Spot, vel: Spot, maxSpeed: number): void {
  const k = 2.6;
  let tx = vel.x + (at.x - b.x) * k, ty = vel.y + (at.y - b.y) * k;
  const tv = Math.hypot(tx, ty), cap = Math.min(maxSpeed, b.vmax);
  if (tv > cap) { tx *= cap / tv; ty *= cap / tv; }
  steer(b, tx, ty);
  b.x += b.vx * DT; b.y = clamp(b.y + b.vy * DT, -HALF_WIDTH + 0.4, HALF_WIDTH - 0.4);
}
/** How far a body can get in `s` seconds from its current speed `u` along
 *  the way it wants to go, accelerating to top speed. */
function reach(u: number, p: Profile, s: number): number {
  if (s <= 0) return 0;
  let v = Math.max(0, u), x = 0;
  for (let t = 0; t < s; t += 0.05) { const h = Math.min(0.05, s - t); v = Math.min(p.vmax, v + accel(p, v) * h); x += v * h; }
  return x;
}

// ── Routes, run ──────────────────────────────────────────────────────────────

/** A route as a body runs it: up to route pace from a standstill, slowed by
 *  every cut in proportion to its angle — the receiver knows where he is
 *  going and the man covering him does not, so the cut is where a route is
 *  won. Ends settling if the route comes back, carrying
 *  on (and turning upfield at the sideline) if not.
 *
 *  Receivers' paths do not depend on the defence, so they are run in full
 *  before anything else: the quarterback can then lead a man to where he
 *  will be, as a quarterback does. */
/** Routes are run under control, not flat out: this share of top speed,
 *  fitted (MotionFit.pace) to the league's air yards by route. */
let PACE = 0.9;
export const setPace = (p: number) => { PACE = p; };
/** The routes that finish going up the field: thrown to at a sprint. */
const VERTICAL = new Set<RouteId>(['GO', 'POST', 'CORNER', 'WHEEL']);
const keep = (turn: number) => 1 - 0.75 * Math.pow(turn / Math.PI, 1.3);
/** The routes whose catch depth is set by their break, not by when the ball
 *  is thrown: each is run at a depth drawn from the league's for it (§24). */
export const DEPTHED = new Set<RouteId>(['HITCH/CURL', 'QUICK OUT', 'IN/DIG', 'DEEP OUT', 'SHALLOW CROSS/DRAG']);
/** The path a route is run on, relative to where the receiver starts: the
 *  route's own, moved `dx` yards up or down the field (never more than a
 *  yard behind where he starts). A back's screen goes out to the side and a
 *  step up, to be caught three or four yards behind the line with the wall in
 *  front of him — not back, as a receiver's does. (Run the receiver's way from
 *  the backfield, it was caught eight yards behind the line among the rushers,
 *  and gained three yards less than nothing.) */
export function pathOf(route: RouteId, start: Spot, dx = 0): [number, number][] {
  const path = route === 'SCREEN' && start.x < -2 ? [[1.2, 3.5], [2, 6]] as [number, number][] : ROUTE[route].path;
  return dx ? path.map(([x, y]) => [Math.max(Math.min(x, -1), x + dx), y] as [number, number]) : path;
}
export function runRoute(start: Spot, route: RouteId, hashY: number, p: Profile, jam: number, endLine = Infinity, dx = 0): Float32Array {
  const out = start.y >= hashY ? 1 : -1;
  // The back of the end zone is the end of the field: no route goes past it.
  // A route that would is cut off at it — a post becomes a skinny in along
  // it, a go a fade that stops there. (Without it, on first and goal the
  // receivers ran off the back of the field.)
  const back = endLine - 0.7;
  const pts = pathOf(route, start, dx).map(([px, py]) => ({ x: Math.min(back, start.x + px), y: start.y + py * out }));
  const n = Math.round(T_MAX * FPS);
  const tr = new Float32Array(n * 2);
  let x = start.x, y = start.y, v = 0, k = 0;
  let hx = 1, hy = 0;                       // heading
  const settles = (() => {
    const a = ROUTE[route].path;
    const [ax, ay] = a.length > 1 ? a[a.length - 2]! : [0, 0];
    const [bx] = a[a.length - 1]!;
    void ay;
    return !!ROUTE[route].settle || (a.length > 1 && bx - ax < -0.05);
  })();
  for (let f = 0; f < n; f++) {
    const t = f * DT;
    const cap = t < jam ? 3.5 : p.vmax * PACE;
    if (k < pts.length) {
      const w = pts[k]!;
      const dx = w.x - x, dy = w.y - y, d = Math.hypot(dx, dy);
      // Into a sharp cut he sinks his hips and slows to the speed he will
      // come out of it at — at full tilt, a corner could not stop with him
      // either, and overshot every dig by four yards.
      let into = cap;
      if (k + 1 < pts.length) {
        const w2 = pts[k + 1]!;
        const ex = w2.x - w.x, ey = w2.y - w.y, e = Math.hypot(ex, ey) || 1;
        const turn = Math.acos(clamp((dx * ex + dy * ey) / ((d || 1) * e), -1, 1));
        if (turn > 0.9) into = Math.max(keep(turn) * cap, Math.sqrt((keep(turn) * cap) ** 2 + 2 * p.acc * BRAKE * 0.5 * d));
      }
      v = Math.min(cap, into, v + accel(p, v) * DT);
      if (d <= v * DT) {
        x = w.x; y = w.y;
        const nx = d > 1e-6 ? dx / d : hx, ny = d > 1e-6 ? dy / d : hy;
        hx = nx; hy = ny;
        k++;
        if (k < pts.length) {
          const w2 = pts[k]!;
          const ex = w2.x - x, ey = w2.y - y, e = Math.hypot(ex, ey) || 1;
          const turn = Math.acos(clamp((hx * ex + hy * ey) / e, -1, 1));
          v = Math.min(v, keep(turn) * cap);
        }
      } else { hx = dx / d; hy = dy / d; x += hx * v * DT; y += hy * v * DT; }
    } else if (settles) {
      v = Math.max(0, v - p.acc * 2 * DT);
      x += hx * v * DT; y += hy * v * DT;
    } else {
      v = Math.min(cap, v + accel(p, v) * DT);
      const edge = HALF_WIDTH - 1;
      // At the sideline: a route already going upfield carries on up it; an
      // out stops there. (Turned upfield, every quick out became a go.)
      if (Math.abs(y + hy * v * DT) > edge) {
        if (hx > 0.5) { hx = 1; hy = 0; } else { v = 0; }
      }
      x += hx * v * DT; y += hy * v * DT;
    }
    // At the end line: going upfield, he stops there; going across, he runs
    // along it.
    if (x > back) {
      x = back;
      if (hx > 0.7 || Math.abs(hy) < 0.2) { hx = 1; hy = 0; v = Math.max(0, v - p.acc * 2 * DT); }
      else { hx = 0; hy = Math.sign(hy); }
    }
    y = clamp(y, -HALF_WIDTH + 0.4, HALF_WIDTH - 0.4);
    tr[f * 2] = x; tr[f * 2 + 1] = y;
  }
  return tr;
}
/** When a route is ready to be thrown: when the receiver comes out of his
 *  break, or, for a route with no break, when he is eight yards on. */
export function readyAt(tr: Float32Array, route: RouteId, start: Spot, hashY: number, dx = 0): number {
  const path = pathOf(route, start, dx);
  const out = start.y >= hashY ? 1 : -1;
  const n = tr.length / 2;
  if (path.length >= 2) {
    const b = { x: start.x + path[0]![0], y: start.y + path[0]![1] * out };
    for (let f = 0; f < n; f++) if (Math.hypot(tr[f * 2]! - b.x, tr[f * 2 + 1]! - b.y) < 0.6) return f * DT + 0.15;
  }
  for (let f = 0; f < n; f++) if (Math.hypot(tr[f * 2]! - start.x, tr[f * 2 + 1]! - start.y) >= 8) return f * DT;
  return 2.5;
}

// ── The ball ─────────────────────────────────────────────────────────────────

/** A pass from a release two yards up to a catch a yard and a third up,
 *  thrown at `v0` on the flattest trajectory that gets there: the angle,
 *  and how long it is in the air. A ball beyond the arm's range is thrown at
 *  forty-five degrees and falls short of nothing — the passer simply cannot
 *  lead a man that far, which the decision accounts for. */
export interface Flight { theta: number; T: number; v0: number; }
export function flight(D: number, v0: number): Flight {
  const f = (th: number) => 0.7 + D * Math.tan(th) - (G * D * D) / (2 * v0 * v0 * Math.cos(th) ** 2);
  let lo = -0.12, hi = Math.PI / 4;
  if (f(lo) >= 0) return { theta: lo, T: D / (v0 * Math.cos(lo)), v0 };
  if (f(hi) < 0) return { theta: hi, T: D / (v0 * Math.cos(hi)), v0 };
  for (let i = 0; i < 22; i++) { const m = (lo + hi) / 2; if (f(m) >= 0) hi = m; else lo = m; }
  return { theta: hi, T: D / (v0 * Math.cos(hi)), v0 };
}
export const heightAt = (fl: Flight, s: number) => 2 + fl.v0 * Math.sin(fl.theta) * s - 0.5 * G * s * s;

// ── The play ─────────────────────────────────────────────────────────────────

/** The numbers the calibration fits (scripts/calibrate.ts → fit.json):
 *  how long a defender takes to see and react to what he cannot know in
 *  advance, how strongly zone defenders follow the quarterback's eyes. */
export interface Motion {
  /** A man defender's reaction to his receiver's cut. */
  tauCut: number;
  /** After the throw: a zone defender, watching the quarterback, breaks on
   *  the ball after this; a man defender, watching his man, after the other. */
  tauZoneBall: number; tauManBall: number;
  /** How far a zone defender's spot drifts toward where the quarterback is
   *  looking (0 none, 1 all the way). */
  eye: number;
  /** The quarterback's release speed, yards a second, for a league-average
   *  arm. */
  v0: number;
  /** How far ahead he leads each route, as a share of the ball's flight. */
  lead?: Partial<Record<RouteId, number>>;
  /** Coverage, fitted to FTN's contested balls (Docs/PRACTICE-MOTION.md
   *  §10): how loose man defenders play their men (1 as designed; less is
   *  tighter — held at 1 since §11); how deep the underneath zones sink (1 as the landmarks say);
   *  how far a deep defender with no vertical threat comes down to drive on
   *  the route in front of him (0 never, 1 all the way). */
  manT?: number; under?: number; rob?: number;
  /** Route recognition (§11): the chance a man defender reads his man's
   *  route from the stem and plays the break before it comes; and how long
   *  before the break he reads it. */
  recog?: number; jump?: number;
  /** How much earlier (less) or later (more) than its break each route is
   *  first thrown, fitted to the league's time to throw for it. */
  tOff?: Partial<Record<RouteId, number>>;
  /** How much of his speed a receiver keeps through the catch. */
  gather?: number;
  /** How far over the top a man defender runs in phase on a go. */
  phase?: number;
  /** How long an off corner takes to turn and run when his man eats his
   *  cushion: the hip flip, in seconds (§13). */
  flip?: number;
  /** How far on the passer's side of his man an underneath zone defender
   *  sits (§14). */
  zgap?: number;
  /** How long a defender not on the receiver takes to see the catch and
   *  turn to run it down (§14). */
  react?: number;
  /** The spread of the difference in top speed between a receiver and the
   *  man covering him, yards a second (§17). */
  spd?: number;
  /** The chance a pressed receiver wins his release, and how long the man
   *  pressing him is left lunging when he does (§16). */
  relWin?: number; beat?: number;
  /** How much further a man going up the field is led for each yard his
   *  nearest defender trails him (and less for each yard over the top), as a
   *  share of the ball's flight (§15). */
  open?: number;
}

export interface Setup {
  oCards: Partial<Record<OffSlot, Card>>; oAt: Partial<Record<OffSlot, Spot>>;
  dCards: Partial<Record<DefSlot, Card>>; dAt: Partial<Record<DefSlot, Spot>>;
  jobs: Partial<Record<DefSlot, DefJob>>; call: OffCall; hashY: number; under: boolean;
  coverage: string;
  /** Yards from the line of scrimmage to the goal line. */
  toGoal: number;
  /** When the rush gets home, if it does, and who gets there. */
  tPress: number | null; presser?: DefSlot;
  /** The earliest each route is thrown, by the league's timing. */
  rhythm?: Partial<Record<RouteId, number>>;
  /** A draw in [0, 1) for each man defender: under the chance of reading
   *  his man's route (Motion.recog), he reads it. From outside, so the world
   *  stays pure. */
  recog?: Partial<Record<DefSlot, number>>;
  /** A draw in [0, 1) for each man defender pressing his man: under the
   *  receiver's chance of winning the release (Motion.relWin), he wins it. */
  release?: Partial<Record<DefSlot, number>>;
  /** For each receiver on a route whose depth is its break's (DEPTHED), how
   *  much deeper (or shallower) than the route's own he runs it this time. */
  depth?: Partial<Record<OffSlot, number>>;
  /** A standard normal draw for each man matchup: how much quicker the
   *  receiver is than the man covering him, in spreads of Motion.spd. */
  speed?: Partial<Record<DefSlot, number>>;
}

/** What the world shows the quarterback when he looks at a receiver: the
 *  window — how far from the nearest defender he will be when a ball thrown
 *  now arrives — and where and when that would be. */
export interface Look { slot: OffSlot; t: number; window: number; lane: number; at: Spot; T: number; }

interface Measure { sep: number; nearest: DefSlot | null; ballSep: number; ballBy: DefSlot | null; reach: number; frames: number; }

export interface AfterCatch {
  yac: number; end: Spot;
  /** Who made the tackle; none if he scored or went out of bounds. */
  by: DefSlot | null; td: boolean; out: boolean;
  /** Tackles broken on the way. */
  broken: DefSlot[];
}

export interface Trace {
  frames: number;
  off: Partial<Record<OffSlot, Float32Array>>;
  def: Partial<Record<DefSlot, Float32Array>>;
  /** x, y, height. */
  ball: Float32Array;
  tThrow: number | null; tCatch: number | null; catchAt: Spot | null;
  /** At the catch: the nearest defender and how far off, and the closest any
   *  defender got to the ball on its way while it was low enough to reach. */
  sep: number; nearest: DefSlot | null; lane: number; laneBy: DefSlot | null;
  /** Where the quarterback was looking, frame by frame (the receiver's slot). */
  eyes: (OffSlot | null)[];
  /** Each receiver's route as the world runs it, to the end of the longest
   *  play — so a route carries on after the catch the way it was being run. */
  routes: Partial<Record<OffSlot, Float32Array>>;
  /** A rusher whose hands were in the ball's path as it left. */
  batBy: DefSlot | null;
  /** The frame of the catch; and whether the run after it is in the trace
   *  too, through to the tackle. */
  catchFrame: number; post: boolean;
  /** Where the ball came down against the nearest defender to it, and how far
   *  the receiver was from it — far, when the throw was off target; and where
   *  it was meant to go. */
  ballSep: number; ballBy: DefSlot | null; reach: number; aim: Spot | null;
}

/** One pass play, run frame by frame. The engine drives it: `look` asks
 *  what the quarterback sees, `throwTo` releases the ball, `step` moves
 *  everyone on. */
export class World {
  readonly t0 = 0;
  f = 0;
  readonly o: Partial<Record<OffSlot, Body>> = {};
  readonly d: Partial<Record<DefSlot, Body>> = {};
  readonly oP: Partial<Record<OffSlot, Profile>> = {};
  readonly dP: Partial<Record<DefSlot, Profile>> = {};
  readonly routes: Partial<Record<OffSlot, Float32Array>> = {};
  readonly ready: Partial<Record<OffSlot, number>> = {};
  /** When each receiver actually comes out of his break — what a defender
   *  reacts to, as against `ready`, the quarterback's rhythm for the route. */
  readonly brk: Partial<Record<OffSlot, number>> = {};
  private readonly rec: { off: Partial<Record<OffSlot, number[]>>; def: Partial<Record<DefSlot, number[]>>; ball: number[] } = { off: {}, def: {}, ball: [] };
  eyes: (OffSlot | null)[] = [];
  looking: OffSlot | null = null;
  // The throw, once made.
  thrown: { at: number; from: Spot; to: Spot; aim: Spot; slot: OffSlot; fl: Flight } | null = null;
  lane = 99; laneBy: DefSlot | null = null;
  readonly pocket: Spot;
  /** The back of the end zone, in the offence's frame. */
  readonly endLine: number;
  /** A screen is called: the receivers who are not running it block for it. */
  private readonly screen: boolean;
  /** Each man defender's cushion at the snap: how far off his man he lines up. */
  private readonly cushion: Partial<Record<DefSlot, number>> = {};
  /** A press defender beaten at the line: until when he is still lunging. */
  private readonly beaten: Partial<Record<DefSlot, number>> = {};
  /** When each off man defender turned to run with his man. */
  private readonly turnAt: Partial<Record<DefSlot, number>> = {};
  /** The man defenders who read their man's route, and when they read it. */
  readonly reads: Partial<Record<DefSlot, number>> = {};
  readonly tDrop: number;

  constructor(readonly s: Setup, readonly m: Motion) {
    for (const [slot, at] of Object.entries(s.oAt) as [OffSlot, Spot][]) {
      const p = profile(s.oCards[slot]?.pos ?? 'WR');
      this.o[slot] = body(at, p); this.oP[slot] = p; this.rec.off[slot] = [];
    }
    for (const [slot, at] of Object.entries(s.dAt) as [DefSlot, Spot][]) {
      const p = profile(s.dCards[slot]?.pos ?? 'LB');
      this.d[slot] = body(at, p); this.dP[slot] = p; this.rec.def[slot] = [];
    }
    for (const [ds, j] of Object.entries(s.jobs) as [DefSlot, DefJob][]) {
      const a = s.dAt[ds], m = j.kind === 'man' ? s.oAt[j.on] : undefined;
      if (a && m) this.cushion[ds] = Math.max(0, a.x - m.x);
      // Who is faster. Every corner and every receiver had the same top
      // speed, so a man defender matched his man stride for stride on a go
      // for as long as it took; in the league one of them is a few tenths of
      // a yard a second the quicker, and over twenty yards that is a yard or
      // two. Drawn for each matchup, with its spread fitted (spd, §17).
      if (j.kind === 'man' && this.o[j.on] && this.d[ds]) {
        const dv = (s.speed?.[ds] ?? 0) * (this.m.spd ?? 0);
        for (const [b, p, sg] of [[this.o[j.on]!, this.oP[j.on]!, 0.5], [this.d[ds]!, this.dP[ds]!, -0.5]] as const) {
          p.vmax += sg * dv; b.vmax = p.vmax;
        }
      }
    }
    this.screen = Object.values(s.call.jobs).includes('SCREEN');
    this.endLine = s.toGoal + 10;
    const qb0 = s.oAt.QB ?? { x: -5, y: s.hashY };
    this.pocket = { x: s.under ? -7.2 : Math.min(qb0.x, -5) - 1.4, y: qb0.y };
    this.tDrop = (s.under ? 1.15 : 0.75) + (s.call.playAction ? 0.5 : 0);
    // Receivers' routes, run in advance; a pressed receiver is slowed off
    // the line for half a second.
    for (const slot of ELIGIBLE) {
      const job = s.call.jobs[slot], at = s.oAt[slot];
      if (!at || !job || job === 'BLOCK') continue;
      // The release. Pressed, he wins it or loses it: won, he is off the line
      // clean and the man pressing him has lunged at nothing; lost, he is
      // jammed for half a second and the man is on him. (Every pressed
      // receiver used to lose it.)
      const presser = (Object.entries(s.jobs) as [DefSlot, DefJob][]).find(([ds, j]) => j?.kind === 'man' && j.on === slot && s.dAt[ds] && dist(s.dAt[ds]!, at) < 2.2)?.[0];
      const won = presser !== undefined && (s.release?.[presser] ?? 1) < (m.relWin ?? 0.5);
      if (won) this.beaten[presser!] = m.beat ?? 0.4;
      const dx = DEPTHED.has(job) ? s.depth?.[slot] ?? 0 : 0;
      this.routes[slot] = runRoute(at, job, s.hashY, this.oP[slot]!, presser !== undefined && !won ? 0.45 : 0, this.endLine, dx);
      // Ready when he is out of his break — and not before the quarterback's
      // rhythm for that route allows: the earliest a route is thrown in the
      // league (its quarter-way time to throw) is when he is first looked at.
      this.brk[slot] = readyAt(this.routes[slot]!, job, at, s.hashY, dx);
      // Thrown on rhythm, a route is thrown a moment before the break — the
      // ball is out as he turns — not once he has come out of it.
      this.ready[slot] = Math.max(0.5, Math.max(this.brk[slot]! - 0.25, (s.rhythm?.[job] ?? 0)) + (m.tOff?.[job] ?? 0)) + (s.call.playAction ? 0.25 : 0);
      // A screen to a receiver on the line goes as soon as he has turned
      // for it — the league's time for screens is the back's, who waits for
      // the rush to come through. (On it, the corner had a second and a half
      // to come down on a receiver standing still.)
      if (job === 'SCREEN' && at.x > -2) this.ready[slot] = Math.max(0.5, this.brk[slot]! - 0.25);
    }
    // Route recognition: a corner reads the route from the stem — the
    // release, the depth, where the receiver is in the formation — and, when
    // he reads it, is moving to the break before it comes. A go has no break
    // to jump.
    for (const [ds, j] of Object.entries(s.jobs) as [DefSlot, DefJob][]) {
      if (j.kind !== 'man' || !this.routes[j.on]) continue;
      const job = s.call.jobs[j.on], b = this.brk[j.on] ?? 0;
      // Nor does a short one: a hitch, a quick out, a slant are on him before
      // the stem has told him anything. (Read too, short balls against man
      // were contested a third of the time — FTN has a fifth.)
      const bp = this.routeAt(j.on, b);
      if (job === 'GO' || b < 0.5 || bp.x - (s.oAt[j.on]?.x ?? 0) < 7) continue;
      if ((s.recog?.[ds] ?? 1) < (m.recog ?? 0)) this.reads[ds] = Math.max(0.3, b - (m.jump ?? 0.35));
    }
  }

  get t() { return this.f * DT; }

  /** A receiver's position at time t on his route. */
  routeAt(slot: OffSlot, t: number): Spot {
    const tr = this.routes[slot]!;
    const n = tr.length / 2;
    const i = clamp(Math.round(t * FPS), 0, n - 1);
    return { x: tr[i * 2]!, y: tr[i * 2 + 1]! };
  }
  private routeVel(slot: OffSlot, t: number): Spot {
    const a = this.routeAt(slot, t - DT), b = this.routeAt(slot, t + DT);
    return { x: (b.x - a.x) / (2 * DT), y: (b.y - a.y) / (2 * DT) };
  }
  /** Where a receiver was at time t as a defender can see him: on his route —
   *  or, once the ball is thrown to him and he has left it, where he
   *  actually went (as recorded), and never ahead of now. */
  private seenAt(slot: OffSlot, t: number): Spot {
    const th = this.thrown;
    if (!th || th.slot !== slot || t <= th.at) return this.routeAt(slot, t);
    const r = this.rec.off[slot]!, n = r.length / 2;
    const i = Math.round(t * FPS);
    if (i >= n) return { x: this.o[slot]!.x, y: this.o[slot]!.y };
    return { x: r[i * 2]!, y: r[i * 2 + 1]! };
  }
  private seenVel(slot: OffSlot, t: number): Spot {
    const th = this.thrown;
    if (!th || th.slot !== slot || t <= th.at) return this.routeVel(slot, t);
    if (Math.round(t * FPS) >= this.rec.off[slot]!.length / 2 - 1) return { x: this.o[slot]!.vx, y: this.o[slot]!.vy };
    const a = this.seenAt(slot, t - DT), b = this.seenAt(slot, t + DT);
    return { x: (b.x - a.x) / (2 * DT), y: (b.y - a.y) / (2 * DT) };
  }
  qb(): Spot { return this.o.QB ?? { x: -6, y: this.s.hashY }; }

  /** Where a ball thrown now to `slot` meets him, and how long it takes: the
   *  quarterback leads him, so this is solved for the two together. */
  lead(slot: OffSlot, v0: number, from = this.qb()): { at: Spot; fl: Flight } {
    // He leads the man by a share of the ball's flight — less than all of it
    // on most routes: a ball thrown to where a receiver would be running flat
    // out is caught five to fifteen yards deeper than the league's are. The
    // share is fitted by route (MotionFit.lead) to the league's air yards.
    // (Led in stride at a sprint, with the routes slowed to keep the air
    // yards, the run after the catch went to seven yards; §13.)
    const job = this.s.call.jobs[slot] as RouteId;
    // And by the leverage on him: a man going up the field with his defender
    // trailing is thrown open, out in front where only he can get it; with
    // the defender on top of him, it is thrown short, to his back shoulder.
    // (Led the same whatever the leverage, a go with the corner beaten was
    // thrown short and he pulled up under it for the corner to catch him:
    // go routes against man were contested five times in six.)
    const r = this.o[slot]!;
    let lev = 0;
    if (r.vx > 3) {
      let nd = 4;
      for (const [ds, d] of Object.entries(this.d) as [DefSlot, Body][]) {
        if (this.s.jobs[ds]?.kind === 'rush') continue;
        const dd = dist(d, r);
        if (dd < nd) { nd = dd; lev = clamp(r.x - d.x, -2, 2); }
      }
    }
    const lam = clamp((this.m.lead?.[job] ?? 1) + (this.m.open ?? 0) * lev, 0.2, 1.3);
    // A man going deep is led at a sprint: the share is of the ground he
    // covers flat out, not at the pace he runs the route at. (Led at route
    // pace he ran under it at seven and a half yards a second, and a corner
    // he had beaten ran him down at nine.)
    const sprint = VERTICAL.has(job) && r.vx > 3;
    const u = Math.hypot(r.vx, r.vy), pr = this.oP[slot]!;
    const along = (T: number) => sprint ? this.onRoute(slot, lam * reach(u, pr, T)) : this.routeAt(slot, this.t + lam * T);
    let T = 0.6, at = along(T), fl = flight(dist(from, at), v0);
    for (let i = 0; i < 5; i++) { T = fl.T; at = along(T); fl = flight(dist(from, at), v0); }
    return { at, fl };
  }
  /** The point `s` yards further along a receiver's route from where he is. */
  private onRoute(slot: OffSlot, s: number): Spot {
    const tr = this.routes[slot]!, n = tr.length / 2;
    let i = clamp(Math.round(this.t * FPS), 0, n - 1), px = tr[i * 2]!, py = tr[i * 2 + 1]!, left = s;
    while (i + 1 < n) {
      const qx = tr[(i + 1) * 2]!, qy = tr[(i + 1) * 2 + 1]!, d = Math.hypot(qx - px, qy - py);
      if (d >= left && d > 1e-6) return { x: px + ((qx - px) / d) * left, y: py + ((qy - py) / d) * left };
      left -= d; px = qx; py = qy; i++;
    }
    return { x: px, y: py };
  }

  /** What the quarterback sees when he looks at `slot` now: how open the man
   *  will be when a ball thrown now arrives. Each defender is given the
   *  reaction his eyes allow — a zone defender sees the throw, a man
   *  defender turned to his man sees it late — then as straight a run at the
   *  catch point as his body allows. The lane is the same reckoning for the
   *  ball's path while it is low enough to be reached. */
  look(slot: OffSlot, v0 = this.m.v0): Look {
    const from = this.qb();
    const { at, fl } = this.lead(slot, v0, from);
    let win = 99, lane = 99;
    for (const [ds, b] of Object.entries(this.d) as [DefSlot, Body][]) {
      const j = this.s.jobs[ds];
      if (!j || j.kind === 'rush') continue;
      const tau = j.kind === 'man' ? this.m.tauManBall : this.m.tauZoneBall;
      const p = this.dP[ds]!;
      const after = { x: b.x + b.vx * Math.min(tau, fl.T), y: b.y + b.vy * Math.min(tau, fl.T) };
      const u = Math.hypot(b.vx, b.vy);
      win = Math.min(win, Math.max(0.3, dist(after, at) - reach(u, p, fl.T - tau)));
      // The ball's path: can he get a hand to it on the way?
      for (const frac of [0.2, 0.35, 0.5, 0.65, 0.8]) {
        const s = fl.T * frac;
        if (heightAt(fl, s) > REACH) continue;
        const pt = { x: from.x + (at.x - from.x) * frac, y: from.y + (at.y - from.y) * frac };
        lane = Math.min(lane, Math.max(0, dist(after, pt) - reach(u, p, s - tau)));
      }
    }
    return { slot, t: this.t, window: win, lane, at, T: fl.T };
  }

  /** Release the ball to `slot`: led to where he will be, on the trajectory
   *  `v0` gives. A touch throw is a slower ball on a higher arc. */
  throwTo(slot: OffSlot, v0 = this.m.v0, miss?: Spot): { at: Spot; T: number } {
    const from = this.qb();
    const { at: aim, fl: fl0 } = this.lead(slot, v0, from);
    // A throw off target goes where it was thrown, not where it was meant
    // to: the receiver works to the spot it should have been, the ball goes
    // to the one it was.
    const at = miss ? { x: aim.x + miss.x, y: clamp(aim.y + miss.y, -HALF_WIDTH - 2, HALF_WIDTH + 2) } : aim;
    const fl = miss ? flight(dist(from, at), v0) : fl0;
    this.thrown = { at: this.t, from: { ...from }, to: at, aim, slot, fl };
    // Line of sight at the line of scrimmage: a rusher still near it whose
    // hands are in the ball's path where it passes him, while it is low
    // enough for a lineman's reach (about ten and a half feet).
    this.batBy = null;
    const D = dist(from, at);
    for (const [ds, b] of Object.entries(this.d) as [DefSlot, Body][]) {
      if (this.s.jobs[ds]?.kind !== 'rush' || b.x < from.x + 0.8) continue;
      const along = ((b.x - from.x) * (at.x - from.x) + (b.y - from.y) * (at.y - from.y)) / (D * D || 1);
      if (along <= 0 || along >= 0.6) continue;
      const px = from.x + (at.x - from.x) * along, py = from.y + (at.y - from.y) * along;
      if (Math.hypot(b.x - px, b.y - py) < 0.9 && heightAt(fl, fl.T * along) < 3.5) { this.batBy = ds; break; }
    }
    return { at, T: fl.T };
  }
  /** A rusher whose hands were in the ball's path as it left. */
  batBy: DefSlot | null = null;

  /** Record the play as it stands now, then move everyone one frame on. */
  step(): void {
    const t = this.t;
    const s = this.s;
    // Receivers are where their routes have them — except the man the ball
    // is thrown to, who leaves his route and works to where it is coming
    // down, arriving with it.
    for (const slot of Object.keys(this.routes) as OffSlot[]) {
      const b = this.o[slot]!;
      if (this.thrown && slot === this.thrown.slot && t > this.thrown.at) {
        const left = this.thrown.at + this.thrown.fl.T - t;
        const goal = this.thrown.aim;
        const d = dist(b, goal);
        const want = Math.min(b.vmax, d / Math.max(DT, left));
        const ux = d > 1e-6 ? (goal.x - b.x) / d : 0, uy = d > 1e-6 ? (goal.y - b.y) / d : 0;
        // Within what his legs allow, like anyone else. (Set outright, a
        // receiver under a ball led short went from full speed to half in a
        // frame, and his man ran three yards past him: deep balls against man
        // were contested a third as often as FTN has them.)
        steer(b, ux * want, uy * want);
        b.x += b.vx * DT; b.y += b.vy * DT;
        // Inside the sideline, as everyone is: carried past a ball thrown to
        // the boundary, he stops at it.
        if (Math.abs(b.y) > HALF_WIDTH - 0.4) { b.y = Math.sign(b.y) * (HALF_WIDTH - 0.4); b.vy = 0; }
        continue;
      }
      const p = this.routeAt(slot, t), v = this.routeVel(slot, t);
      b.x = p.x; b.y = p.y; b.vx = v.x; b.vy = v.y;
    }
    const qb = this.qb();
    const ball = this.thrown;
    // The ball, now.
    let bx: number, by: number, bh: number;
    const snapT = s.under ? 0.12 : 0.35;
    if (ball) {
      const u = t - ball.at;
      const frac = clamp(u / ball.fl.T, 0, 1);
      bx = ball.from.x + (ball.to.x - ball.from.x) * frac; by = ball.from.y + (ball.to.y - ball.from.y) * frac;
      bh = Math.max(1.3, heightAt(ball.fl, Math.min(u, ball.fl.T)));
      // Anyone in the lane while it is low enough to reach.
      if (bh <= REACH && frac > 0.05 && frac < 0.92) for (const [ds, b] of Object.entries(this.d) as [DefSlot, Body][]) {
        if (s.jobs[ds]?.kind === 'rush') continue;
        const dd = Math.hypot(b.x - bx, b.y - by);
        if (dd < this.lane) { this.lane = dd; this.laneBy = ds; }
      }
    } else if (t < snapT) { const fr = t / snapT; bx = fr * qb.x; by = s.hashY + fr * (qb.y - s.hashY); bh = s.under ? 0.3 : 0.6 * Math.sin(Math.PI * fr); }
    else { bx = qb.x; by = qb.y; bh = 1.0; }
    for (const [slot, b] of Object.entries(this.o) as [OffSlot, Body][]) this.rec.off[slot]!.push(b.x, b.y);
    for (const [ds, b] of Object.entries(this.d) as [DefSlot, Body][]) this.rec.def[ds]!.push(b.x, b.y);
    this.rec.ball.push(bx, by, bh);
    this.eyes.push(this.looking);

    // ── Move on. The offence other than the receivers.
    const look = this.looking ? this.routeAt(this.looking, t) : null;
    // On a screen the receivers and backs not running it block for it: the
    // defenders nearest the man it is thrown to, each taken by the blocker
    // nearest that defender. (Each taking the defender nearest himself, they
    // blocked the far side of the field, and the corner on the screen
    // tackled him where he caught it.)
    // The linemen release too: on a back's screen once they have let the rush
    // through, on a receiver's at once. (Held in to protect, they never got
    // in front of a screen: the man it was thrown to caught it with nobody
    // within five yards of him on either side, and was tackled a second
    // later — the league's screens go eight yards after the catch at the
    // median, the engine's two.)
    const screenBlock: Partial<Record<OffSlot, Body>> = {};
    const OL: OffSlot[] = ['LT', 'LG', 'C', 'RG', 'RT'];
    let release = Infinity;
    if (this.screen) {
      const sc = (Object.keys(this.routes) as OffSlot[]).find((k) => s.call.jobs[k] === 'SCREEN');
      const at = sc ? this.o[sc]! : null;
      if (sc) release = (s.oAt[sc]?.x ?? 0) < -2 ? 0.9 : 0.3;
      if (at) {
        const free = (Object.keys(this.o) as OffSlot[]).filter((k) => !this.routes[k] && (ELIGIBLE as readonly string[]).includes(k));
        const defs = (Object.entries(this.d) as [DefSlot, Body][]).filter(([ds]) => s.jobs[ds]?.kind !== 'rush')
          .sort((a, b) => dist(a[1], at) - dist(b[1], at)).slice(0, free.length);
        for (const [, db] of defs) {
          let best: OffSlot | null = null, bd = Infinity;
          for (const k of free) if (!screenBlock[k] && dist(this.o[k]!, db) < bd) { bd = dist(this.o[k]!, db); best = k; }
          if (best) screenBlock[best] = db;
        }
      }
    }
    // Released, the linemen do not chase the coverage: they set a wall across
    // the field two yards in front of where the man the screen is for will be,
    // and block whoever comes to them.
    const wall: Partial<Record<OffSlot, Spot>> = {};
    if (this.screen && t >= release) {
      const sc = (Object.keys(this.routes) as OffSlot[]).find((k) => s.call.jobs[k] === 'SCREEN')!;
      const p = this.routeAt(sc, Math.max(t, this.ready[sc] ?? t)), side = Math.sign(p.y - s.hashY) || 1;
      OL.forEach((k, i) => { if (this.o[k]) wall[k] = { x: p.x + 2, y: p.y - side * (i - 1) * 1.8 }; });
    }
    for (const [slot, b] of Object.entries(this.o) as [OffSlot, Body][]) {
      if (this.routes[slot]) continue;
      const a = s.oAt[slot]!;
      if (slot === 'QB') {
        if (t < this.tDrop) seek(b, s.call.playAction && t < 0.55 ? { x: -3.2, y: a.y - 1 } : this.pocket, 7);
        else if (!ball) seek(b, { x: this.pocket.x + 0.8, y: this.pocket.y }, 1.5);
        else seek(b, b, 0);
      } else if (OL.includes(slot) && wall[slot]) seek(b, wall[slot]!, b.vmax);
      else if (OL.includes(slot)) seek(b, { x: a.x - 1.4, y: s.hashY + (a.y - s.hashY) * 1.1 }, 2.4);
      else if (screenBlock[slot]) {
        const near = screenBlock[slot]!;
        seek(b, { x: near.x - 0.9, y: near.y + (s.hashY - near.y) * 0.08 }, b.vmax * 0.85);
      } else seek(b, a.x < -2 ? { x: this.pocket.x + 2, y: this.pocket.y + (a.y >= s.hashY ? 2 : -2) } : { x: a.x - 1, y: a.y }, 4);
    }
    // Zone defenders' spots, and who each is matched to: one receiver per
    // underneath defender and one per deep one, closest pairs first. Chosen
    // each on his own, two would sit on the same hitch and leave the flat.
    const spots: Partial<Record<DefSlot, Spot>> = {};
    const matched: Partial<Record<DefSlot, OffSlot>> = {};
    const pairs: { ds: DefSlot; os: OffSlot; d: number; deep: boolean }[] = [];
    for (const [ds, j] of Object.entries(s.jobs) as [DefSlot, DefJob][]) {
      if (j.kind !== 'zone' || !this.d[ds]) continue;
      const L = LANDMARK[j.zone];
      // Near the goal line every drop is shorter, in proportion to the field
      // left (as the alignment is), and the deepest is the back of the end
      // zone. (At midfield depths, hook and curl defenders dropped into the
      // back of the end zone and left everything short of it open.)
      const kz = clamp((s.toGoal + 4) / 16, 0.35, 1);
      // Underneath zones sink under the routes in front of them — not to sit
      // on a hitch, but to take the curl behind it away.
      const sink = L.x < 14 ? (this.m.under ?? 1) : 1;
      let spot: Spot = { x: Math.min(1 + (L.x - 1) * kz * sink, this.endLine - 1.5), y: clamp(L.y + 0.4 * s.hashY, -HALF_WIDTH + 2, HALF_WIDTH - 2) };
      // Eyes on the quarterback: his spot leans toward where he looks.
      if (look && t > 0.6) {
        const lx = look.x - spot.x, ly = look.y - spot.y, ld = Math.hypot(lx, ly) || 1;
        const shift = Math.min(5, ld * this.m.eye);
        spot = { x: spot.x + (lx / ld) * shift * 0.4, y: spot.y + (ly / ld) * shift };
      }
      spots[ds] = spot;
      for (const os of Object.keys(this.routes) as OffSlot[]) {
        const rp = this.routeAt(os, t), d = dist(rp, spot);
        // A deep defender is as deep as the deepest: the man going deep in
        // his area is his, before the one nearest him. (Nearest first, a
        // deep third took the curl in front of him and the go beside it ran
        // free.)
        const deep = L.x >= 14;
        const v = deep ? this.routeVel(os, t).x : 0;
        if (d < L.r * 1.9) pairs.push({ ds, os, d: deep ? d - 0.8 * Math.max(0, rp.x - 4) - 0.6 * Math.max(0, v) : d, deep });
      }
    }
    pairs.sort((a, b) => a.d - b.d);
    const takenU = new Set<OffSlot>(), takenD = new Set<OffSlot>();
    for (const pr of pairs) {
      const taken = pr.deep ? takenD : takenU;
      if (matched[pr.ds] || taken.has(pr.os)) continue;
      matched[pr.ds] = pr.os; taken.add(pr.os);
    }
    // A defender a screen blocker has got to is held up: he moves at under
    // half his speed while engaged, as he does after the catch.
    const held = new Map<Body, { x: number; y: number }>();
    for (const [os, db] of Object.entries(screenBlock) as [OffSlot, Body][]) if (dist(this.o[os]!, db) < 1.1) held.set(db, { x: db.x, y: db.y });
    for (const k of Object.keys(wall) as OffSlot[]) {
      const ob = this.o[k]!;
      for (const db of Object.values(this.d) as Body[]) if (dist(ob, db) < 1.3) held.set(db, { x: db.x, y: db.y });
    }
    // The defence.
    for (const [ds, b] of Object.entries(this.d) as [DefSlot, Body][]) {
      const j = s.jobs[ds], p = this.dP[ds]!;
      if (!j) continue;
      if (j.kind === 'rush') {
        const free = ds === s.presser && s.tPress !== null && t > s.tPress - 0.7;
        if (free) seek(b, { x: qb.x + 0.6, y: qb.y }, p.vmax);
        else seek(b, { x: Math.max(-0.9, qb.x + 1.1), y: s.dAt[ds]!.y + (qb.y - s.dAt[ds]!.y) * 0.2 }, ['E1', 'E2', 'T1', 'T2'].includes(ds) ? 2.6 : 5);
        continue;
      }
      // The ball is in the air: each breaks on it when his eyes let him. A
      // zone defender breaks to where it is coming down; a man defender plays
      // the man, to get a hand in on the ball's side of him.
      if (ball) {
        const tau = j.kind === 'man' ? this.m.tauManBall : this.m.tauZoneBall;
        if (t >= ball.at + tau) {
          if (j.kind === 'man' && this.o[j.on]) {
            const r = this.o[j.on]!, qb2 = ball.from;
            const ux = qb2.x - r.x, uy = qb2.y - r.y, ul = Math.hypot(ux, uy) || 1;
            // Into his hip, on the ball's side: a man defender plays through
            // the receiver to the ball. (Held a yard and a bit off, no man
            // coverage was ever contested: FTN has a fifth of balls against
            // man contested, and the engine had a ninth.)
            const off = 0.8 * (this.m.manT ?? 1);
            // Running with him as he works back to the ball, not steering at
            // where he is and braking to stop on it.
            pursue(b, { x: r.x + (ux / ul) * off, y: r.y + (uy / ul) * off }, { x: r.vx, y: r.vy }, p.vmax);
          } else {
            // To make the play from a yard off, on his own side — not to stand
            // on the spot, which put him on the receiver's square yard.
            const ox = b.x - ball.to.x, oy = b.y - ball.to.y, od = Math.hypot(ox, oy) || 1;
            // And to get there with it, not before it and stopped: at the speed
            // that arrives as the ball does, flat out when he is late. (Braking
            // to stand on the spot, a deep defender was slowing as the ball came
            // down and the receiver ran past him at full speed: a third of the
            // go and post balls were caught with nobody deeper, half of those
            // going for twenty yards and more after the catch.)
            const to = { x: ball.to.x + (ox / od) * 0.7, y: ball.to.y + (oy / od) * 0.7 };
            const left = ball.at + ball.fl.T - t, dx = to.x - b.x, dy = to.y - b.y, dd = Math.hypot(dx, dy);
            if (left > DT && dd > 0.3) {
              // Flat out unless he would be there early with room to spare —
              // the time is short and speed takes time to find. (At the
              // speed that would arrive with the ball if he had it already,
              // a hook defender three and a half yards in front of a dig
              // standing still at the throw had covered a yard of it when the
              // ball arrived, and the dig was caught untouched — contested one
              // time in a hundred, to the league's one in five; §26.)
              const u0 = Math.hypot(b.vx, b.vy);
              const want = reach(u0, p, left) <= dd * 1.15 ? p.vmax : Math.min(p.vmax, Math.max(dd / left, u0));
              steer(b, (dx / dd) * want, (dy / dd) * want);
              const v = Math.hypot(b.vx, b.vy); if (v > b.vmax) { b.vx *= b.vmax / v; b.vy *= b.vmax / v; }
              b.x += b.vx * DT; b.y = clamp(b.y + b.vy * DT, -HALF_WIDTH + 0.4, HALF_WIDTH - 0.4);
            } else seek(b, to, p.vmax);
          }
          continue;
        }
      }
      if (j.kind === 'man') {
        // He sees his man as he was a moment ago and plays to where that
        // says he is going — which, out of a cut, is the wrong place.
        if (!this.routes[j.on]) { seek(b, { x: (s.oAt[j.on]?.x ?? 0) + 3, y: s.oAt[j.on]?.y ?? b.y }, 4); continue; }
        // Man coverage. What he can see: his man as he was a reaction ago
        // (tauCut) — where he was and which way he was going — and, at once,
        // how fast he is going now, because a receiver sinking his hips into
        // a break is visible straight away. So he runs at his man's speed now,
        // the way his man was heading then. (Running at the speed he last
        // saw, he was carried four or five yards past every break.)
        // Read, he plays the route itself: where his man is going, a moment
        // ahead, not where he was a reaction ago.
        const read = this.reads[ds] !== undefined && t >= this.reads[ds]!;
        // He plays where his man will be half a second on — the break he
        // has read, before it comes. (A moment ahead was not enough: running
        // with the stem at its speed, he could not stop in time and was
        // carried two or three yards past every break he had read.)
        const seen = read ? (this.thrown?.slot === j.on ? t : t + 0.5) : Math.max(0, t - this.m.tauCut);
        // (Once the ball is in the air to him, his man is played as he
        // actually goes — pulling up under a ball led short is as visible as
        // sinking into a break — until the defender turns for the ball.)
        const r = this.seenAt(j.on, seen), v = this.seenVel(j.on, seen);
        const vNow = this.seenVel(j.on, t), sNow = Math.hypot(vNow.x, vNow.y), sSeen = Math.hypot(v.x, v.y) || 1;
        const vRun = read ? v : { x: (v.x / sSeen) * Math.min(sSeen, sNow), y: (v.y / sSeen) * Math.min(sSeen, sNow) };
        const inside = Math.sign(s.hashY - r.y) || 1;
        // Leverage: over the top and inside in Cover 1 and 0, trailing
        // underneath in 2-Man (the safeties have the top). How far over the
        // top is fitted (manT); inside leverage is held, since it is what puts
        // a corner on an in-breaking route.
        const mt = this.m.manT ?? 1;
        const lev0 = s.coverage === '2_MAN' ? { dx: -0.9, dy: 1.0 } : s.coverage === 'COVER_0' ? { dx: 0.8, dy: 0.8 } : { dx: 1.25, dy: 1.0 };
        // On a go there is no break to be over the top of: once the receiver
        // is past the stem and still going, the corner runs in phase with
        // him, hip to hip, and plays the ball at the catch point.
        const phase = this.s.call.jobs[j.on] === 'GO' && t > 1.4;
        const lev = read ? { dx: Math.min(lev0.dx * mt, 0.4), dy: 0.6 }
          : phase ? { dx: this.m.phase ?? 0.3, dy: 0.5 + (this.m.phase ?? 0.3) }
          : { dx: lev0.dx * mt, dy: Math.max(lev0.dy, 1.2) };
        const ahead = read ? 0 : this.m.tauCut;
        // Over the top is against a man going up the field; against one
        // running across it — the dig, the out — he plays level with him, on
        // his inside. (Held over the top after the break, a corner stayed
        // three yards above every dig, and none was contested.)
        const vs = Math.hypot(vRun.x, vRun.y);
        const up = vs > 1 ? clamp(vRun.x / vs, 0, 1) : 1;
        const trailX = r.x + vRun.x * ahead + lev.dx * up;
        // Before the break, off the ball: he backpedals for the first second
        // (less near the goal line, where there is no ground to give), keeps a
        // cushion that the receiver eats up — three yards shrinking to one by
        // two seconds — against where the man will be a moment on, and comes
        // off it as the receiver sinks into his break. A receiver who stays
        // behind the line is played downhill, not given ground; in 2-Man
        // there is no cushion to keep.
        const stem = !read && seen < (this.brk[j.on] ?? 1.5) - 0.4 && (seen < 0.4 || v.x > 1);
        const c0 = this.cushion[ds] ?? 1;
        const give = 3 * clamp((s.toGoal + 4) / 16, 0.2, 1);
        const cush = Math.max(1, Math.min(c0, 3) * (1 - t / 2));
        const rAhead = r.x + Math.max(0, vRun.x) * 0.25;
        const over = stem && s.coverage !== '2_MAN' ? Math.max(this.s.dAt[ds]!.x + give * Math.min(t, 1), rAhead + cush) : -Infinity;
        const pedal = stem && over > trailX && t < 1;
        // He matches his man's speed in the stem and keeps the cushion by
        // where he stands. (Matching only part of it, to let the cushion
        // close, he was moving at a quarter of his man's speed at a second
        // and a half and was run past before every break.)
        const runWith = vRun;
        // The turn. Off the ball he faces the quarterback, backpedalling; when
        // his man is going up the field and has eaten the cushion, he has to
        // turn and run, and while he turns he cannot drive — that is the
        // moment a receiver wins deep. (Turning for free, a corner matched
        // his man stride for stride from his backpedal, and deep balls
        // against man were contested four times in five.)
        if ((this.cushion[ds] ?? 0) >= 3 && this.turnAt[ds] === undefined && !this.thrown && v.x > 3 && (b.x - r.x < 3 || t > 1.6)) this.turnAt[ds] = t;
        if (t < (this.beaten[ds] ?? 0)) { b.x += b.vx * DT; b.y += b.vy * DT; continue; }
        const ta = this.turnAt[ds];
        if (ta !== undefined && t < ta + (this.m.flip ?? 0.25)) {
          b.x += b.vx * DT; b.y = clamp(b.y + b.vy * DT, -HALF_WIDTH + 0.4, HALF_WIDTH - 0.4);
          continue;
        }
        pursue(b, { x: Math.max(trailX, over), y: r.y + vRun.y * ahead + lev.dy * inside }, runWith, pedal ? p.vmax * 0.85 : p.vmax);
      } else {
        const L = LANDMARK[j.zone];
        const spot = spots[ds]!;
        const deep = L.x >= 14;
        let target = spot;
        const mo = matched[ds];
        // A screen: a receiver in front of him who stays behind the line is
        // read and driven on — he does not keep dropping while it is set up.
        if (!deep && t > 0.5) {
          // (In his own area: driving on a swing that started on the far side
          // of the formation, the flat defender left the flat.)
          let scr: Spot | null = null, sd = L.r * 1.2;
          for (const os of Object.keys(this.routes) as OffSlot[]) {
            const rp = this.routeAt(os, t);
            if (rp.x > 0 || this.routeVel(os, t).x > 1) continue;
            const dd = Math.abs(rp.y - spot.y);
            if (dd < sd) { sd = dd; scr = rp; }
          }
          if (scr) { seek(b, { x: scr.x + 1.2, y: scr.y + (qb.y - scr.y) * 0.1 }, p.vmax); continue; }
        }
        if (mo) {
          const rp = this.routeAt(mo, t);
          const tx = qb.x - rp.x, ty = qb.y - rp.y, tl = Math.hypot(tx, ty) || 1;
          // Deep: deeper than his man by two and a half yards. Underneath: on
          // the passer's side of him, but not shallower than a yard under him
          // — a flat defender who simply got between the receiver and the
          // passer ended up several yards under a man running to the sideline.
          if (deep) {
            const over = Math.max(spot.x, rp.x + 2.5);
            // Robbing: with nothing going deep in his area, a deep defender
            // comes down on the route in front of him — the dig, the curl —
            // rather than stay over a man who is not going past him.
            // (Not a man still running straight at him: that is the go.)
            const rob = rp.x + 2.5 < spot.x - 1.5 && rp.x >= 7 && this.routeVel(mo, t).x < 3 ? (this.m.rob ?? 0) : 0;
            target = { x: over + (rp.x + 2 - over) * rob, y: spot.y + (rp.y - spot.y) * (0.8 + 0.2 * rob) };
          } else {
            // How far on the passer's side of his man he sits is fitted
            // (zgap) to FTN's contested short balls against zone.
            const g = this.m.zgap ?? 2.6;
            target = { x: Math.max(rp.x - 2.5, rp.x + (tx / tl) * g), y: rp.y + (ty / tl) * g };
          }
          // He walls a man through his area and hands him on; he does not
          // follow him out of it. (Following, the hook defenders were pulled
          // wide and every drag crossed an empty middle.)
          // A curl defender takes the flat too, when his man goes there and
          // nobody outside him does (Cover 3's curl–flat).
          const room = L.r * (deep ? 1.4 : j.zone.startsWith('CURL') ? 1.5 : 1.0);
          const ox = target.x - spot.x, oy = target.y - spot.y, od = Math.hypot(ox, oy);
          if (od > room) target = { x: spot.x + (ox / od) * room, y: spot.y + (oy / od) * room };
        }
        // A deep defender over a man coming at him runs with him — matching
        // his speed upfield, keeping on top — rather than steering at a spot
        // ahead of him and braking to stop on it, which let every go route
        // run past him. (Clamped to his area, he holds the edge of it.)
        if (deep && mo && target.x > spot.x + 0.3) {
          const rv = this.routeVel(mo, t);
          pursue(b, target, { x: Math.max(0, rv.x), y: rv.y * 0.8 }, p.vmax);
          continue;
        }
        // Dropping, he backpedals for the first steps, then turns and runs.
        seek(b, target, b.vx > 0.5 && t < 0.8 ? p.vmax * 0.75 : p.vmax);
      }
    }
    for (const [db, was] of held) {
      db.x = was.x + (db.x - was.x) * 0.45; db.y = was.y + (db.y - was.y) * 0.45;
      db.vx *= 0.45; db.vy *= 0.45;
    }
    // Nobody runs out of the back of the end zone.
    for (const b of [...Object.values(this.o), ...Object.values(this.d)] as Body[]) if (b.x > this.endLine - 0.5) { b.x = this.endLine - 0.5; b.vx = Math.min(0, b.vx); }
    this.f++;
  }

  /** Run on to the catch, and note how things stood at it. */
  flyToCatch(): void {
    if (!this.thrown) return;
    while (this.t < this.thrown.at + this.thrown.fl.T && this.t < T_MAX) this.step();
    this.atCatch = this.measure();
  }
  private atCatch: Measure | null = null;
  /** At the last recorded frame: how far the nearest defender is from the
   *  receiver, and from where the ball came down — the same place unless the
   *  throw was off target — and how far the receiver is from the ball. */
  private measure(): Measure {
    let sep = 99, nearest: DefSlot | null = null, ballSep = 99, ballBy: DefSlot | null = null, reach = 99;
    const th = this.thrown;
    const n = this.rec.ball.length / 3;
    if (th && n > 0) {
      const last = n - 1;
      const ro = this.rec.off[th.slot]!;
      const r = { x: ro[last * 2]!, y: ro[last * 2 + 1]! };
      reach = Math.hypot(r.x - th.to.x, r.y - th.to.y);
      for (const [ds, arr] of Object.entries(this.rec.def) as [DefSlot, number[]][]) {
        if (this.s.jobs[ds]?.kind === 'rush') continue;
        const px = arr[last * 2]!, py = arr[last * 2 + 1]!;
        const dd = Math.hypot(px - r.x, py - r.y);
        if (dd < sep) { sep = dd; nearest = ds; }
        const db = Math.hypot(px - th.to.x, py - th.to.y);
        if (db < ballSep) { ballSep = db; ballBy = ds; }
      }
    }
    return { sep, nearest, ballSep, ballBy, reach, frames: n };
  }

  /** After the catch: the carrier runs for daylight and the defence runs
   *  him down. He heads for the goal line, turned away from the defenders in
   *  front of him and off the sideline; every defender takes a pursuit angle
   *  to where he is going; teammates near him block the nearest pursuer.
   *  Every contact is a tackle attempt — made with probability `tackle`, or
   *  broken, which costs the carrier speed and leaves the defender beaten for
   *  a moment. Ends at the tackle, out of bounds, or in the end zone.
   *  (Yards after the catch drawn from a table had a receiver run thirty
   *  yards through three defenders, because nothing told the table they were
   *  there.) */
  afterCatch(slot: OffSlot, o: { tackle: (by: DefSlot) => number; rand: () => number }): AfterCatch {
    const c = this.o[slot]!;
    const start = { x: c.x, y: c.y };
    const toGoal = this.endLine - 10;
    const beaten: Partial<Record<DefSlot, number>> = {};
    const broken: DefSlot[] = [];
    this.carrier = slot;
    // Making the catch costs him speed — gathering it in, often over his
    // shoulder, and turning upfield. That is where a trailing defender gets
    // him; at full speed from the catch, a deep ball was a footrace he won.
    // (Fitted to the league's yards after the catch, Docs/PRACTICE-MOTION.md §12.)
    c.vx *= this.m.gather ?? 0.5; c.vy *= this.m.gather ?? 0.5;
    const t0 = this.t;
    let by: DefSlot | null = null, td = false, out = false;
    while (this.t - t0 < 7) {
      this.record();
      const t = this.t;
      if (c.x >= toGoal) { td = true; break; }
      if (Math.abs(c.y) >= HALF_WIDTH - 0.45) { out = true; break; }
      // The carrier: for the goal line, away from trouble.
      let dx = 1.2, dy = 0;
      for (const [ds, d] of Object.entries(this.d) as [DefSlot, Body][]) {
        if ((beaten[ds] ?? 0) > t) continue;
        const rx = c.x - d.x, ry = c.y - d.y, rd = Math.hypot(rx, ry);
        if (rd > 7 || rd < 1e-6) continue;
        const front = d.x > c.x - 1 ? 1 : 0.35;
        const w = (2.2 * front) / Math.max(1, rd * rd);
        dx += (rx / rd) * w; dy += (ry / rd) * w;
      }
      const edge = HALF_WIDTH - 3;
      if (Math.abs(c.y) > edge) dy -= Math.sign(c.y) * (Math.abs(c.y) - edge) * 0.6;
      const dl = Math.hypot(dx, dy) || 1;
      seek(c, { x: c.x + (Math.max(0.15, dx / dl)) * 5, y: c.y + (dy / dl) * 5 }, c.vmax * 0.97);
      // His blockers: each teammate near him takes the defender nearest him.
      const blocked = new Set<DefSlot>();
      for (const [os, b] of Object.entries(this.o) as [OffSlot, Body][]) {
        if (os === slot || dist(b, c) > 12) continue;
        let near: DefSlot | null = null, nd = Infinity;
        for (const [ds, d] of Object.entries(this.d) as [DefSlot, Body][]) {
          if (blocked.has(ds)) continue;
          const dd = dist(d, c);
          if (dd < nd) { nd = dd; near = ds; }
        }
        if (!near) continue;
        const d = this.d[near]!;
        if (dist(b, d) < 1.1) blocked.add(near);
        else seek(b, { x: d.x + (c.x - d.x) * 0.2, y: d.y + (c.y - d.y) * 0.2 }, b.vmax * 0.85);
      }
      // The pursuit: to where he will be, not where he is — once he has seen
      // the catch. A defender not already on the receiver was playing the
      // ball or his own man, and carries on a moment before he turns to run
      // the catch down (react, fitted to the league's yards after the catch).
      for (const [ds, d] of Object.entries(this.d) as [DefSlot, Body][]) {
        const p = this.dP[ds]!;
        if (t - t0 < (this.m.react ?? 0) && dist(d, start) > 3) {
          d.x += d.vx * DT; d.y = clamp(d.y + d.vy * DT, -HALF_WIDTH + 0.4, HALF_WIDTH - 0.4);
          continue;
        }
        // To where he can meet him: the earliest moment the carrier's path
        // and his own top speed cross — an angle, not a chase; close, he
        // drives straight at him. (Aimed a fixed moment ahead of the carrier,
        // a safety level with a receiver ran beside him to the end zone three
        // yards off, and a post caught in the open went fourteen yards
        // further than the league's at the top end; §21.)
        const rx = c.x - d.x, ry = c.y - d.y, dd = Math.hypot(rx, ry);
        let lead = Math.min(1.2, dd / p.vmax);
        if (dd < 3) lead = 0.12;
        else {
          const a2 = c.vx * c.vx + c.vy * c.vy - p.vmax * p.vmax, b2 = 2 * (rx * c.vx + ry * c.vy), c2 = rx * rx + ry * ry;
          const disc = b2 * b2 - 4 * a2 * c2;
          if (Math.abs(a2) > 1e-6 && disc >= 0) {
            const ti = [(-b2 - Math.sqrt(disc)) / (2 * a2), (-b2 + Math.sqrt(disc)) / (2 * a2)].filter((x) => x > 0).sort((x, y) => x - y)[0];
            if (ti !== undefined) lead = Math.min(ti, 2.5);
          }
        }
        const aim = { x: c.x + c.vx * lead, y: c.y + c.vy * lead };
        const slow = (beaten[ds] ?? 0) > t ? 0.35 : blocked.has(ds) ? 0.45 : 1;
        seek(d, aim, p.vmax * slow);
      }
      // Contact.
      let stop = false;
      for (const [ds, d] of Object.entries(this.d) as [DefSlot, Body][]) {
        // Contact is at arm's length.
        if ((beaten[ds] ?? 0) > t || blocked.has(ds) || dist(d, c) > 1.2) continue;
        if (o.rand() < o.tackle(ds)) { by = ds; stop = true; break; }
        beaten[ds] = t + 0.8; broken.push(ds);
        c.vx *= 0.65; c.vy *= 0.65;
      }
      if (stop) { this.f++; this.record(); break; }
      for (const b of [...Object.values(this.o), ...Object.values(this.d)] as Body[]) {
        if (b.x > this.endLine - 0.5) { b.x = this.endLine - 0.5; b.vx = Math.min(0, b.vx); }
      }
      this.f++;
    }
    this.carrier = null;
    this.post = true;
    return { yac: c.x - start.x, end: { x: c.x, y: c.y }, by, td, out, broken };
  }
  /** Who has the ball after the catch, for the record. */
  private carrier: OffSlot | null = null;
  private post = false;
  /** Record the frame as it stands — the bodies, and the ball with the
   *  carrier. */
  private record(): void {
    for (const [slot, b] of Object.entries(this.o) as [OffSlot, Body][]) this.rec.off[slot]!.push(b.x, b.y);
    for (const [ds, b] of Object.entries(this.d) as [DefSlot, Body][]) this.rec.def[ds]!.push(b.x, b.y);
    const c = this.carrier ? this.o[this.carrier]! : this.qb();
    this.rec.ball.push(c.x, c.y, 0.5);
    this.eyes.push(null);
  }

  /** The recorded play, and what it shows at the catch. */
  trace(): Trace {
    const off: Trace['off'] = {}, def: Trace['def'] = {};
    for (const [k, v] of Object.entries(this.rec.off) as [OffSlot, number[]][]) off[k] = Float32Array.from(v);
    for (const [k, v] of Object.entries(this.rec.def) as [DefSlot, number[]][]) def[k] = Float32Array.from(v);
    const th = this.thrown;
    const at = this.atCatch ?? this.measure();
    const sep = at.sep, nearest = at.nearest;
    const ballSep = at.ballSep, ballBy = at.ballBy, reachBall = at.reach;
    return {
      frames: this.rec.ball.length / 3, off, def, ball: Float32Array.from(this.rec.ball),
      tThrow: th ? th.at : null, tCatch: th ? th.at + th.fl.T : null, catchAt: th ? { ...th.to } : null,
      sep, nearest, lane: this.lane, laneBy: this.laneBy, eyes: this.eyes, routes: this.routes, batBy: this.batBy,
      catchFrame: at.frames - 1, post: this.post, ballSep, ballBy, reach: reachBall,
      aim: th ? { ...th.aim } : null,
    };
  }
}
