/** The football the practice engine knows, as data. Docs/PRACTICE.md is the
 *  same thing in prose, and says where each piece came from.
 *
 *  One frame throughout: the offence attacks toward +x; x is yards from the
 *  line of scrimmage (negative is the backfield), y is yards from the middle
 *  of the field, positive to the quarterback's left. The renderer flips it for
 *  whichever end the offence is attacking. */

export const HALF_WIDTH = 26.67;
export const HASH = 3.08;

// ── Who is on the field ──────────────────────────────────────────────────────

/** A slot in a formation. The label is the job, not the player's position:
 *  a tight end can stand in the X slot, and the dot still says TE. */
export type OffSlot = 'QB' | 'RB' | 'FB' | 'X' | 'Z' | 'SL' | 'SL2' | 'Y' | 'LT' | 'LG' | 'C' | 'RG' | 'RT';
export const ELIGIBLE: OffSlot[] = ['RB', 'FB', 'X', 'Z', 'SL', 'SL2', 'Y'];

export interface Align { slot: OffSlot; x: number; y: number; }

export interface Formation {
  id: string; name: string; personnel: string;
  /** What the slots are filled from, in order. */
  fill: Partial<Record<OffSlot, 'QB' | 'RB' | 'WR' | 'TE'>>;
  under: boolean;          // QB under center, so a drop is needed
  align: Align[];
}

/** The line: a yard and two-thirds between linemen's centres, which is a
 *  body's width and a two-to-three-foot split. */
const LINE: Align[] = [
  { slot: 'LT', x: -0.7, y: 3.4 }, { slot: 'LG', x: -0.7, y: 1.7 }, { slot: 'C', x: -0.6, y: 0 },
  { slot: 'RG', x: -0.7, y: -1.7 }, { slot: 'RT', x: -0.7, y: -3.4 },
];

export const FORMATIONS: Formation[] = [
  {
    id: 'gun-trips', name: 'Shotgun Trips', personnel: '11', under: false,
    fill: { QB: 'QB', RB: 'RB', X: 'WR', Z: 'WR', SL: 'WR', Y: 'TE' },
    align: [...LINE, { slot: 'QB', x: -5, y: 0 }, { slot: 'RB', x: -5, y: 1.8 },
      { slot: 'X', x: -0.8, y: 19 }, { slot: 'Z', x: -1.5, y: -20 }, { slot: 'SL', x: -1.5, y: -13 }, { slot: 'Y', x: -1.5, y: -6.5 }],
  },
  {
    id: 'gun-doubles', name: 'Shotgun Doubles', personnel: '11', under: false,
    fill: { QB: 'QB', RB: 'RB', X: 'WR', Z: 'WR', SL: 'WR', Y: 'TE' },
    align: [...LINE, { slot: 'QB', x: -5, y: 0 }, { slot: 'RB', x: -5, y: -1.8 },
      { slot: 'X', x: -0.8, y: 19 }, { slot: 'SL', x: -1.5, y: 11 }, { slot: 'Y', x: -1.5, y: -9 }, { slot: 'Z', x: -1.5, y: -19 }],
  },
  {
    id: 'singleback', name: 'Singleback', personnel: '12', under: true,
    fill: { QB: 'QB', RB: 'RB', X: 'WR', Z: 'WR', Y: 'TE', SL: 'TE' },
    align: [...LINE, { slot: 'QB', x: -1.7, y: 0 }, { slot: 'RB', x: -7, y: 0 },
      { slot: 'X', x: -0.8, y: 18 }, { slot: 'Y', x: -0.8, y: -5.1 }, { slot: 'SL', x: -1.5, y: -6.5 }, { slot: 'Z', x: -1.5, y: -18 }],
  },
  {
    id: 'i-form', name: 'I-Form', personnel: '21', under: true,
    fill: { QB: 'QB', RB: 'RB', FB: 'TE', X: 'WR', Z: 'WR', Y: 'TE' },
    align: [...LINE, { slot: 'QB', x: -1.7, y: 0 }, { slot: 'FB', x: -4, y: 0 }, { slot: 'RB', x: -7, y: 0 },
      { slot: 'X', x: -0.8, y: 18 }, { slot: 'Y', x: -0.8, y: -5.1 }, { slot: 'Z', x: -1.5, y: -17 }],
  },
  {
    id: 'empty', name: 'Empty', personnel: '10', under: false,
    fill: { QB: 'QB', X: 'WR', Z: 'WR', SL: 'WR', SL2: 'RB', Y: 'TE' },
    align: [...LINE, { slot: 'QB', x: -5, y: 0 },
      { slot: 'X', x: -0.8, y: 20 }, { slot: 'SL2', x: -1.5, y: 12 }, { slot: 'SL', x: -1.5, y: 5.5 },
      { slot: 'Y', x: -1.5, y: -11 }, { slot: 'Z', x: -0.8, y: -20 }],
  },
  {
    id: 'pistol', name: 'Pistol', personnel: '11', under: false,
    fill: { QB: 'QB', RB: 'RB', X: 'WR', Z: 'WR', SL: 'WR', Y: 'TE' },
    align: [...LINE, { slot: 'QB', x: -4, y: 0 }, { slot: 'RB', x: -7, y: 0 },
      { slot: 'X', x: -0.8, y: 19 }, { slot: 'SL', x: -1.5, y: 11 }, { slot: 'Y', x: -0.8, y: -5.1 }, { slot: 'Z', x: -1.5, y: -19 }],
  },
];

// ── Routes ───────────────────────────────────────────────────────────────────

/** The thirteen route families the participation file records, keyed as it
 *  keys them so the measured tables can be looked up directly. A path is a
 *  list of waypoints in yards — forward, and *outward*, toward the sideline
 *  on the receiver's own side — so one definition serves both sides. */
export type RouteId = 'QUICK OUT' | 'HITCH/CURL' | 'SCREEN' | 'IN/DIG' | 'GO' | 'DEEP OUT' | 'SHALLOW CROSS/DRAG'
  | 'SLANT' | 'POST' | 'SWING' | 'CORNER' | 'WHEEL' | 'TEXAS/ANGLE';
export type Job = RouteId | 'BLOCK';

export interface RouteDef {
  id: RouteId; label: string; short: string; path: [number, number][];
  /** Settles at the end of its path — sits down in the window, facing the
   *  passer — rather than running on (a route that comes back settles anyway). */
  settle?: boolean;
}

export const ROUTES: RouteDef[] = [
  // The out breaks at four or five yards and settles six yards outside, near
  // the numbers; the drag crosses thirteen yards and sits down in the window.
  // (Run on, the out reached the sideline and the drag the far hash by the
  // league's time to throw them, seven and six yards from the nearest zone
  // defender — a third of all the separation at the catch; §30.)
  { id: 'QUICK OUT', label: 'Quick out', short: 'Out', path: [[4, 0], [4.5, 6]], settle: true },
  { id: 'HITCH/CURL', label: 'Hitch / curl', short: 'Curl', path: [[8, 0], [6.5, -1]] },
  { id: 'SLANT', label: 'Slant', short: 'Slant', path: [[2, 0], [7, -6]] },
  { id: 'SHALLOW CROSS/DRAG', label: 'Drag', short: 'Drag', path: [[2, -1], [3, -13]], settle: true },
  { id: 'IN/DIG', label: 'Dig', short: 'Dig', path: [[13.5, 0], [13.5, -12]] },
  { id: 'DEEP OUT', label: 'Deep out', short: 'Out 14', path: [[13.5, 0], [13.5, 7]] },
  { id: 'POST', label: 'Post', short: 'Post', path: [[11, 0], [24, -9]] },
  { id: 'CORNER', label: 'Corner', short: 'Corner', path: [[11, 0], [22, 9]] },
  { id: 'GO', label: 'Go', short: 'Go', path: [[30, 1]] },
  { id: 'WHEEL', label: 'Wheel', short: 'Wheel', path: [[1, 6], [5, 8], [24, 9]] },
  { id: 'TEXAS/ANGLE', label: 'Angle', short: 'Angle', path: [[2, 3], [5, -4]] },
  { id: 'SWING', label: 'Swing', short: 'Swing', path: [[-0.5, 4], [0.5, 9]] },
  { id: 'SCREEN', label: 'Screen', short: 'Screen', path: [[-1, -2], [-1.5, -3]] },
];
export const ROUTE = Object.fromEntries(ROUTES.map((r) => [r.id, r])) as Record<RouteId, RouteDef>;

/** Which routes make sense from where. A lineman cannot run one at all; a back
 *  out of the backfield runs a back's routes; everyone else, everything. */
export const ROUTES_FOR = (slot: OffSlot): RouteId[] =>
  slot === 'RB' || slot === 'FB'
    ? ['SWING', 'TEXAS/ANGLE', 'WHEEL', 'SHALLOW CROSS/DRAG', 'QUICK OUT', 'SCREEN', 'HITCH/CURL']
    : ROUTES.map((r) => r.id).filter((r) => r !== 'SWING' && r !== 'TEXAS/ANGLE');

// ── Concepts ─────────────────────────────────────────────────────────────────

export interface Concept {
  id: string; name: string; kind: 'pass';
  /** Route by slot. A slot the formation does not have is skipped. */
  jobs: Partial<Record<OffSlot, Job>>;
  /** The quarterback's read order. */
  reads: OffSlot[];
  playAction?: boolean;
  note: string;
}

export const CONCEPTS: Concept[] = [
  { id: 'verts', name: 'Four Verticals', kind: 'pass', note: 'Four deep threats on three deep defenders.',
    jobs: { X: 'GO', Z: 'GO', SL: 'POST', SL2: 'GO', Y: 'GO', RB: 'SWING' }, reads: ['SL', 'Y', 'X', 'Z', 'RB'] },
  { id: 'smash', name: 'Smash', kind: 'pass', note: 'A corner over a hitch — the corner beats the squatting cornerback.',
    jobs: { X: 'HITCH/CURL', SL: 'CORNER', Z: 'HITCH/CURL', Y: 'CORNER', SL2: 'HITCH/CURL', RB: 'TEXAS/ANGLE' }, reads: ['SL', 'X', 'Y', 'Z', 'RB'] },
  { id: 'flood', name: 'Flood', kind: 'pass', note: 'Three levels to one side.',
    jobs: { Z: 'GO', SL: 'DEEP OUT', Y: 'QUICK OUT', X: 'POST', SL2: 'HITCH/CURL', RB: 'SWING' }, reads: ['SL', 'Y', 'Z', 'X', 'RB'] },
  { id: 'mesh', name: 'Mesh', kind: 'pass', note: 'Two drags crossing — the man-beater.',
    jobs: { X: 'SHALLOW CROSS/DRAG', Z: 'SHALLOW CROSS/DRAG', SL: 'HITCH/CURL', Y: 'POST', SL2: 'HITCH/CURL', RB: 'SWING' }, reads: ['X', 'Z', 'SL', 'RB', 'Y'] },
  { id: 'slant-flat', name: 'Slant–Flat', kind: 'pass', note: 'The flat defender cannot take both.',
    jobs: { X: 'SLANT', Z: 'SLANT', SL: 'QUICK OUT', Y: 'QUICK OUT', SL2: 'SLANT', RB: 'SWING' }, reads: ['X', 'SL', 'Z', 'Y', 'RB'] },
  { id: 'curl-flat', name: 'Curl–Flat', kind: 'pass', note: 'High-low on the curl-flat defender.',
    jobs: { X: 'HITCH/CURL', Z: 'HITCH/CURL', SL: 'QUICK OUT', Y: 'QUICK OUT', SL2: 'HITCH/CURL', RB: 'TEXAS/ANGLE' }, reads: ['X', 'SL', 'Z', 'Y', 'RB'] },
  { id: 'dagger', name: 'Dagger', kind: 'pass', note: 'A seam pulls the safety off the dig behind it.',
    jobs: { SL: 'GO', X: 'IN/DIG', Z: 'GO', Y: 'HITCH/CURL', SL2: 'IN/DIG', RB: 'SWING' }, reads: ['X', 'SL', 'Y', 'RB', 'Z'] },
  { id: 'y-cross', name: 'Y-Cross', kind: 'pass', note: 'A deep cross under a clear-out post.',
    jobs: { Y: 'IN/DIG', X: 'POST', Z: 'GO', SL: 'QUICK OUT', SL2: 'HITCH/CURL', RB: 'TEXAS/ANGLE' }, reads: ['Y', 'X', 'SL', 'RB', 'Z'] },
  { id: 'post-wheel', name: 'Post–Wheel', kind: 'pass', note: 'The wheel beats a linebacker in man.',
    jobs: { X: 'POST', SL: 'WHEEL', Z: 'POST', Y: 'HITCH/CURL', SL2: 'WHEEL', RB: 'WHEEL' }, reads: ['SL', 'X', 'RB', 'Y', 'Z'] },
  { id: 'slants', name: 'Slants', kind: 'pass', note: 'Out before the blitz gets home.',
    jobs: { X: 'SLANT', Z: 'SLANT', SL: 'SLANT', Y: 'SLANT', SL2: 'SLANT', RB: 'BLOCK' }, reads: ['X', 'SL', 'Z', 'Y'] },
  // To the slot, the man outside him blocking the corner and the line
  // releasing in front of him: a jailbreak. (Thrown to the split end, often
  // alone on his side, it had nobody within five yards to block for it and
  // went two yards after the catch; with the line kept in, the rushers ran
  // the slot down from behind.)
  { id: 'screen-wr', name: 'WR Screen', kind: 'pass', note: 'To the slot: the outside receiver takes the corner, the line releases in front.',
    jobs: { SL: 'SCREEN', X: 'BLOCK', Z: 'BLOCK', Y: 'BLOCK', SL2: 'BLOCK', RB: 'BLOCK' }, reads: ['SL'] },
  { id: 'screen-rb', name: 'RB Screen', kind: 'pass', note: 'Let the rush through and dump it over it.',
    jobs: { RB: 'SCREEN', X: 'GO', Z: 'GO', SL: 'HITCH/CURL', Y: 'BLOCK', SL2: 'GO' }, reads: ['RB'] },
  { id: 'pa-shot', name: 'Play-action shot', kind: 'pass', playAction: true, note: 'Sell the run, then post and go.',
    jobs: { X: 'POST', Z: 'GO', SL: 'DEEP OUT', Y: 'BLOCK', SL2: 'GO', RB: 'BLOCK', FB: 'BLOCK' }, reads: ['X', 'Z', 'SL'] },
];

// ── Runs ─────────────────────────────────────────────────────────────────────

export type Gap = 'left end' | 'left tackle' | 'left guard' | 'middle' | 'right guard' | 'right tackle' | 'right end';
export const GAPS: Gap[] = ['left end', 'left tackle', 'left guard', 'middle', 'right guard', 'right tackle', 'right end'];
/** Where each gap is across the line, for drawing the run and for whether a
 *  blitzer came through it. */
export const GAP_Y: Record<Gap, number> = {
  'left end': 5.5, 'left tackle': 3.75, 'left guard': 2.25, middle: 0, 'right guard': -2.25, 'right tackle': -3.75, 'right end': -5.5,
};

export interface RunPlay { id: string; name: string; kind: 'run'; gap: Gap; runner: 'RB' | 'QB'; note: string; }
export const RUNS: RunPlay[] = [
  { id: 'iz-l', name: 'Inside Zone left', kind: 'run', gap: 'left guard', runner: 'RB', note: 'Read the backside, cut it up.' },
  { id: 'iz-r', name: 'Inside Zone right', kind: 'run', gap: 'right guard', runner: 'RB', note: 'Read the backside, cut it up.' },
  { id: 'oz-l', name: 'Outside Zone left', kind: 'run', gap: 'left end', runner: 'RB', note: 'Stretch it to the edge. Boom or bust.' },
  { id: 'oz-r', name: 'Outside Zone right', kind: 'run', gap: 'right end', runner: 'RB', note: 'Stretch it to the edge. Boom or bust.' },
  { id: 'power-l', name: 'Power left', kind: 'run', gap: 'left tackle', runner: 'RB', note: 'Pull the guard, kick out the end.' },
  { id: 'power-r', name: 'Power right', kind: 'run', gap: 'right tackle', runner: 'RB', note: 'Pull the guard, kick out the end.' },
  { id: 'dive', name: 'Dive', kind: 'run', gap: 'middle', runner: 'RB', note: 'Straight ahead. Steady.' },
  { id: 'sneak', name: 'QB Sneak', kind: 'run', gap: 'middle', runner: 'QB', note: 'A yard, behind the centre.' },
];

export type Play = Concept | RunPlay;

// ── Defence ──────────────────────────────────────────────────────────────────

export type Coverage = 'COVER_0' | 'COVER_1' | '2_MAN' | 'COVER_2' | 'COVER_3' | 'COVER_4' | 'COVER_6';
export const COVERAGE_LABEL: Record<Coverage, string> = {
  COVER_0: 'Cover 0', COVER_1: 'Cover 1', '2_MAN': '2-Man', COVER_2: 'Cover 2',
  COVER_3: 'Cover 3', COVER_4: 'Cover 4', COVER_6: 'Cover 6',
};
export const MAN: Record<Coverage, boolean> = {
  COVER_0: true, COVER_1: true, '2_MAN': true, COVER_2: false, COVER_3: false, COVER_4: false, COVER_6: false,
};

/** Zone landmarks: where a dropping defender settles, yards downfield and
 *  across. Docs/PRACTICE.md §5. */
export type Zone = 'FLAT_L' | 'FLAT_R' | 'CURL_L' | 'CURL_R' | 'HOOK_L' | 'HOOK_R' | 'HOOK_M' | 'MID_HOOK' | 'ROBBER'
  | 'DEEP_L' | 'DEEP_M' | 'DEEP_R' | 'HALF_L' | 'HALF_R' | 'QTR_L1' | 'QTR_L2' | 'QTR_R2' | 'QTR_R1';
export const LANDMARK: Record<Zone, { x: number; y: number; r: number; label: string }> = {
  FLAT_L: { x: 5, y: 18, r: 6, label: 'Flat' }, FLAT_R: { x: 5, y: -18, r: 6, label: 'Flat' },
  CURL_L: { x: 11, y: 12, r: 6, label: 'Curl' }, CURL_R: { x: 11, y: -12, r: 6, label: 'Curl' },
  HOOK_L: { x: 9, y: 5, r: 5.5, label: 'Hook' }, HOOK_R: { x: 9, y: -5, r: 5.5, label: 'Hook' },
  HOOK_M: { x: 9, y: 0, r: 5.5, label: 'Hook' }, MID_HOOK: { x: 12, y: 0, r: 7, label: 'Middle' },
  ROBBER: { x: 10, y: 0, r: 6, label: 'Robber' },
  DEEP_L: { x: 18, y: 17, r: 9, label: 'Deep ⅓' }, DEEP_M: { x: 18, y: 0, r: 9, label: 'Deep ⅓' }, DEEP_R: { x: 18, y: -17, r: 9, label: 'Deep ⅓' },
  HALF_L: { x: 18, y: 11, r: 12, label: 'Deep ½' }, HALF_R: { x: 18, y: -11, r: 12, label: 'Deep ½' },
  QTR_L1: { x: 15, y: 20, r: 7.5, label: 'Deep ¼' }, QTR_L2: { x: 15, y: 7, r: 7.5, label: 'Deep ¼' },
  QTR_R2: { x: 15, y: -7, r: 7.5, label: 'Deep ¼' }, QTR_R1: { x: 15, y: -20, r: 7.5, label: 'Deep ¼' },
};

export type DefSlot = 'E1' | 'T1' | 'T2' | 'E2' | 'LB1' | 'LB2' | 'LB3' | 'CB1' | 'CB2' | 'NB' | 'FS' | 'SS';
/** A defender's job. Man is on a slot, resolved against the formation the
 *  offence actually shows. */
export type DefJob = { kind: 'rush' } | { kind: 'man'; on: OffSlot } | { kind: 'zone'; zone: Zone };

/** Each coverage's base jobs. Man coverages pair corners with the widest
 *  receivers, the nickel with the slot, a linebacker with the tight end and
 *  another with the back; zones drop to the landmarks above. A slot a
 *  formation does not fill is reassigned by the engine — see `assignments`. */
export const SHELLS: Record<Coverage, Partial<Record<DefSlot, DefJob>>> = {
  COVER_0: { CB1: { kind: 'man', on: 'X' }, CB2: { kind: 'man', on: 'Z' }, NB: { kind: 'man', on: 'SL' },
    SS: { kind: 'man', on: 'Y' }, LB1: { kind: 'man', on: 'RB' }, FS: { kind: 'rush' }, LB2: { kind: 'rush' }, LB3: { kind: 'rush' } },
  COVER_1: { CB1: { kind: 'man', on: 'X' }, CB2: { kind: 'man', on: 'Z' }, NB: { kind: 'man', on: 'SL' },
    SS: { kind: 'man', on: 'Y' }, LB1: { kind: 'man', on: 'RB' }, LB2: { kind: 'zone', zone: 'ROBBER' }, LB3: { kind: 'rush' }, FS: { kind: 'zone', zone: 'DEEP_M' } },
  '2_MAN': { CB1: { kind: 'man', on: 'X' }, CB2: { kind: 'man', on: 'Z' }, NB: { kind: 'man', on: 'SL' },
    LB1: { kind: 'man', on: 'RB' }, LB2: { kind: 'man', on: 'Y' }, LB3: { kind: 'zone', zone: 'HOOK_M' },
    FS: { kind: 'zone', zone: 'HALF_L' }, SS: { kind: 'zone', zone: 'HALF_R' } },
  COVER_2: { CB1: { kind: 'zone', zone: 'FLAT_L' }, CB2: { kind: 'zone', zone: 'FLAT_R' }, NB: { kind: 'zone', zone: 'CURL_R' },
    LB1: { kind: 'zone', zone: 'CURL_L' }, LB2: { kind: 'zone', zone: 'MID_HOOK' }, LB3: { kind: 'zone', zone: 'HOOK_R' },
    FS: { kind: 'zone', zone: 'HALF_L' }, SS: { kind: 'zone', zone: 'HALF_R' } },
  // Four under, curl–hook–hook–curl, the curl players taking the flat too
  // (world.ts). (With a flat on one side and none on the other, quick outs
  // to the side without one were caught with nobody within eight yards.)
  COVER_3: { CB1: { kind: 'zone', zone: 'DEEP_L' }, CB2: { kind: 'zone', zone: 'DEEP_R' }, FS: { kind: 'zone', zone: 'DEEP_M' },
    SS: { kind: 'zone', zone: 'CURL_R' }, NB: { kind: 'zone', zone: 'CURL_L' }, LB1: { kind: 'zone', zone: 'HOOK_L' },
    LB2: { kind: 'zone', zone: 'HOOK_R' }, LB3: { kind: 'zone', zone: 'HOOK_M' } },
  COVER_4: { CB1: { kind: 'zone', zone: 'QTR_L1' }, FS: { kind: 'zone', zone: 'QTR_L2' }, SS: { kind: 'zone', zone: 'QTR_R2' },
    CB2: { kind: 'zone', zone: 'QTR_R1' }, NB: { kind: 'zone', zone: 'FLAT_R' }, LB1: { kind: 'zone', zone: 'FLAT_L' },
    LB2: { kind: 'zone', zone: 'HOOK_M' }, LB3: { kind: 'zone', zone: 'CURL_R' } },
  COVER_6: { CB1: { kind: 'zone', zone: 'QTR_L1' }, FS: { kind: 'zone', zone: 'QTR_L2' }, SS: { kind: 'zone', zone: 'HALF_R' },
    CB2: { kind: 'zone', zone: 'FLAT_R' }, NB: { kind: 'zone', zone: 'CURL_R' }, LB1: { kind: 'zone', zone: 'FLAT_L' },
    LB2: { kind: 'zone', zone: 'HOOK_M' }, LB3: { kind: 'zone', zone: 'HOOK_R' } },
};
/** Who rushes, by default, in each shell. The four linemen always; Cover 0
 *  sends the rest. Extra rushers for a blitz are taken in this order. */
export const BLITZ_ORDER: DefSlot[] = ['LB2', 'LB1', 'NB', 'SS', 'LB3'];
