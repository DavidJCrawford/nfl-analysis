/** The shapes of what pipeline/practice.py writes, and of what the engine
 *  passes around. */
import type { Coverage, DefJob, DefSlot, Gap, Job, OffSlot, RouteId } from './kb';

export interface RouteStat {
  n: number; share: number; cmp: number; int: number; td: number;
  air: number[]; yac: number[]; ttt: [number, number, number]; epa: number;
}
export interface VsStat { n: number; cmp: number; int: number; yac: number; epa: number; }

export interface League {
  season: number; plays: number;
  routes: Record<RouteId, RouteStat>;
  vs: Record<RouteId, Record<Coverage, VsStat>>;
  pressure: {
    byRushers: Record<string, { n: number; pressure: number; sack: number }>;
    sackGivenPressure: number; scrambleGivenPressure: number; scrambleClean: number;
    cmpPressured: number; cmpClean: number; intPressured: number; intClean: number;
    awayPressured: number; awayClean: number;
    sackYards: number[]; scrambleYards: number[]; ttt: number[];
  };
  playAction: { ypa: number; ypaWithout: number; adot: number; adotWithout: number; cmp: number; cmpWithout: number };
  cover: Record<string, { n: number; mix: Record<Coverage, number>; rushers: Record<string, number> }>;
  coverRush: Record<Coverage, Record<string, number>>;
  run: {
    n: number; mean: number; fumbleLost: number;
    gaps: Record<Gap, { n: number; share: number; yards: number[] }>;
    box: Record<string, { n: number; shift: number }>;
    boxByWR: Record<string, Record<string, number>>;
  };
  calls: Record<string, { n: number; pass: number; routes: Record<RouteId, number>; shotgun: number }>;
  callsLate: { trailing: number; leading: number; close: number; all: number };
  fg: { lo: number; hi: number; n: number; make: number }[];
  xp: number;
  punt: Record<'deep' | 'mid' | 'plus', { n: number; net: number[]; touchback: number }>;
  fourth: Record<string, { n: number; go: number }>;
  clock: Record<'run' | 'complete' | 'incomplete' | 'sack' | 'scramble', number>;
  /** The ball, as FTN charts it (pipeline/practice.py; Docs/PRACTICE-MOTION.md §9). */
  catch: {
    n: number;
    catchable: Record<'behind' | 'short' | 'mid' | 'deep', { clean: number; pressured: number; n: number }>;
    contested: Record<'behind' | 'short' | 'mid' | 'deep', number>;
    catchableAll: number; contestedAll: number; contestedMan: number; contestedZone: number;
    cmpUncontested: number; cmpContested: number; cmpUncatchable: number;
    drop: number; intUncatchable: number; intCatchable: number;
    reads: Record<'1' | '2' | 'CHK' | 'DES' | 'SD', number>;
    byCoverage: Record<string, { n: number; cmp: number; int: number; contested: number }>;
    catchableByAir: { air: number; n: number; clean: number; pressured: number }[];
    byMZ: Record<'man' | 'zone', { n: number; catchable: number; cmp: number; adot: number; behind: number;
      contested: Record<'behind' | 'short' | 'mid' | 'deep', number> }>;
  };
}

export interface League2026 {
  cmp: number; int: number; ypa: number; sack: number; hit: number; ypc: number; stuff: number;
  neutralPass: number; scramble: number; blitz: number;
  kickoff: { start: number[]; returnTd: number; n: number };
}

export interface Card { id: string; name: string; short: string; no: number; pos: string; face: boolean; }

export interface Rates {
  cmp: number; int: number; ypa: number; sack: number; hit: number; ypc: number; stuff: number;
  n: { dropbacks: number; runs: number };
}

export interface PlayerStats {
  qb?: { att: number; cmp: number; int: number; sack: number; adot: number };
  rec?: { tgt: number; share: number; catch: number; yac: number };
  rush?: { att: number; ypc: number };
  def?: { tkl: number; sk: number; int: number; pd: number; qbh: number };
  k?: { fgm: number; fga: number; long: number; xpm: number; xpa: number };
  p?: { n: number; net: number };
}

export interface TeamDoc {
  team: string; name: string; nick: string; color: string; color2: string;
  offence: Card[]; defence: Card[]; kicker: Card | null; punter: Card | null;
  rates: { off: Rates; def: Rates; passLean: number; blitz: number };
  players: Record<string, PlayerStats>;
}

// ── Calls ────────────────────────────────────────────────────────────────────

export interface OffCall {
  formation: string;
  playId: string;                         // a concept or a run, for the label
  kind: 'pass' | 'run';
  jobs: Partial<Record<OffSlot, Job>>;    // passes: each eligible's route or block
  reads: OffSlot[];
  playAction: boolean;
  gap?: Gap;                              // runs
  runner?: 'RB' | 'QB';
  /** Where each slot lines up, if a player has been moved from the template. */
  moved?: Partial<Record<OffSlot, { x: number; y: number }>>;
}

export interface DefCall {
  coverage: Coverage;
  rushers: number;                        // 4 = base; more is a blitz
  /** In man coverage, the corners and nickel press: up on the line, a yard
   *  off their men, rather than six or seven. */
  press?: boolean;
  /** A player's own change to his job, over the shell's. */
  jobs?: Partial<Record<DefSlot, DefJob>>;
}

export interface Situation {
  down: number; togo: number;
  /** Yards from the offence's own goal line. */
  los: number;
  /** Where across the field the ball is snapped. */
  hashY: number;
  quarter: number; clock: number; scoreDiff: number;   // offence minus defence
}
