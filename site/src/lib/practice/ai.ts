/** The computer's side of the ball: what it calls, and why.
 *
 *  Every choice starts from what the league actually did in that situation
 *  in 2025 — the down, the distance, the red zone — and is then bent by the
 *  club's own 2026 tendencies: how much more than average it throws, how
 *  often it blitzes. It does not see the user's call before making its own,
 *  which is the one thing real play-callers cannot do either. */
import { CONCEPTS, ELIGIBLE, GAPS, MAN, RUNS, ROUTE, type Coverage, type Gap, type OffSlot } from './kb';
import { FIT, formation, type Rand } from './engine';
import type { DefCall, League, League2026, OffCall, Situation, TeamDoc } from './types';

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const pick = <T>(rand: Rand, weighted: [T, number][]): T => {
  const total = weighted.reduce((n, [, w]) => n + Math.max(0, w), 0);
  let u = rand() * total;
  for (const [v, w] of weighted) { u -= Math.max(0, w); if (u <= 0) return v; }
  return weighted[weighted.length - 1]![0];
};

/** The key the measured tables are filed under — the same as
 *  pipeline/practice.py's `situation()`. Falls back a step at a time when a
 *  combination is too rare to have its own row. */
export function sitKey(sit: Situation, table: Record<string, unknown>): string {
  const d = Math.min(3, sit.down);
  const dist = sit.togo <= 3 ? 'short' : sit.togo <= 7 ? 'med' : 'long';
  const rz = 100 - sit.los <= 20 ? '-rz' : '';
  for (const k of [`${d}-${dist}${rz}`, `${d}-${dist}`, `${d}-long${rz}`, '1-long']) if (k in table) return k;
  return Object.keys(table)[0]!;
}

/** Late in the game, the score bends everything: a side that is behind
 *  throws, a side that is ahead runs. "Late" is the last third of the last
 *  quarter, whatever length the quarters are. */
const lateness = (sit: Situation, quarterLen: number) =>
  sit.quarter >= 4 && sit.clock < quarterLen * 0.67 ? 1 - sit.clock / (quarterLen * 0.67) : 0;

// ── Defence ──────────────────────────────────────────────────────────────────

export function defCall(sit: Situation, L: League, lg26: League2026, team: TeamDoc, rand: Rand): DefCall {
  const k = sitKey(sit, L.cover);
  const row = L.cover[k]!;
  const coverage = pick(rand, Object.entries(row.mix) as [Coverage, number][]);
  // Rushers given the coverage, with the club's blitz rate leaning on the
  // five-and-more column.
  const lean = clamp(team.rates.blitz / Math.max(0.01, lg26.blitz), 0.5, 1.8);
  const rush = Object.entries(L.coverRush[coverage]).map(([n, w]) => [Number(n), Number(n) >= 5 ? w * lean : w] as [number, number]);
  // Press, in man, at the rate fitted to the league's cushion at the snap.
  const press = MAN[coverage] && rand() < (FIT.press ?? 0.3);
  return { coverage, rushers: pick(rand, rush), press };
}

// ── Offence ──────────────────────────────────────────────────────────────────

const RUN_FOR_GAP: Record<Gap, string> = {
  'left end': 'oz-l', 'left tackle': 'power-l', 'left guard': 'iz-l', middle: 'dive',
  'right guard': 'iz-r', 'right tackle': 'power-r', 'right end': 'oz-r',
};

export function passRate(sit: Situation, L: League, team: TeamDoc, quarterLen: number): number {
  const row = L.calls[sitKey(sit, L.calls)]!;
  let p = row.pass * team.rates.passLean;
  const late = lateness(sit, quarterLen);
  if (late > 0) {
    const want = sit.scoreDiff <= -4 ? L.callsLate.trailing : sit.scoreDiff >= 4 ? L.callsLate.leading : L.callsLate.close;
    p += late * (want - L.callsLate.all);
  }
  // The end of the first half, with the ball and time short: throw.
  if (sit.quarter === 2 && sit.clock < 90) p = Math.max(p, 0.85);
  return clamp(p, 0.08, 0.95);
}

export function offCall(sit: Situation, L: League, team: TeamDoc, quarterLen: number, rand: Rand): OffCall {
  const row = L.calls[sitKey(sit, L.calls)]!;
  const pass = rand() < passRate(sit, L, team, quarterLen);
  if (!pass) {
    if (sit.togo <= 1 && rand() < 0.3) return runCall('sneak', rand() < 0.5 ? 'singleback' : 'i-form');
    const gap = pick(rand, GAPS.map((g) => [g, L.run.gaps[g].share] as [Gap, number]));
    const short = sit.togo <= 2 || 100 - sit.los <= 5;
    const fid = pick(rand, short
      ? [['i-form', 0.45], ['singleback', 0.45], ['pistol', 0.1]]
      : [['gun-doubles', row.shotgun * 0.6], ['pistol', row.shotgun * 0.4], ['singleback', (1 - row.shotgun) * 0.6], ['i-form', (1 - row.shotgun) * 0.4]]);
    return runCall(RUN_FOR_GAP[gap], fid);
  }
  // A pass: the concept whose routes look most like what the league threw
  // in this situation, the formation by how often it is from the gun.
  const gun = rand() < row.shotgun;
  const fid = gun ? pick(rand, [['gun-trips', 0.4], ['gun-doubles', 0.4], ['empty', 0.08], ['pistol', 0.12]])
                  : pick(rand, [['singleback', 0.7], ['i-form', 0.3]]);
  const f = formation(fid);
  const slots = new Set(f.align.map((a) => a.slot));
  const ws = CONCEPTS.map((c) => {
    const routes = Object.entries(c.jobs).filter(([s, j]) => slots.has(s as OffSlot) && j !== 'BLOCK').map(([, j]) => j as keyof typeof ROUTE);
    let w = routes.reduce((n, r) => n + (row.routes[r] ?? 0), 0) / Math.max(1, routes.length);
    if (c.playAction) w *= gun ? 0.3 : 2.2;
    // A screen, once called, is thrown (engine.ts): how often it is called is
    // fitted to how often the league throws one.
    if (c.id.startsWith('screen')) w *= FIT.screenCall ?? 1;
    // A bubble wants a slot split out with room outside him; a wing or a man
    // tight to the formation is thrown it among the rushers. (Called from
    // singleback and empty, it went a yard after the catch.)
    if (c.id === 'screen-wr' && Math.abs(f.align.find((a) => a.slot === 'SL')?.y ?? 0) < 8) w = 0;
    if (sit.down >= 3 && sit.togo >= 8 && (c.id.startsWith('screen') || c.id === 'curl-flat')) w *= 0.4;
    if (100 - sit.los <= 12 && (c.id === 'verts' || c.id === 'pa-shot')) w *= 0.3;
    return [c, w] as [typeof c, number];
  });
  const c = pick(rand, ws);
  const jobs = Object.fromEntries(Object.entries(c.jobs).filter(([s]) => slots.has(s as OffSlot))) as OffCall['jobs'];
  return { formation: fid, playId: c.id, kind: 'pass', jobs, reads: c.reads.filter((s) => slots.has(s)), playAction: !!c.playAction };
}

export function runCall(id: string, fid: string): OffCall {
  const r = RUNS.find((x) => x.id === id) ?? RUNS[0]!;
  return { formation: fid, playId: r.id, kind: 'run', jobs: {}, reads: [], playAction: false, gap: r.gap, runner: r.runner };
}

/** A pass call from a concept, for the user's play picker: the concept's
 *  routes for whichever slots the formation has. */
export function passCall(conceptId: string, fid: string): OffCall {
  const c = CONCEPTS.find((x) => x.id === conceptId) ?? CONCEPTS[0]!;
  const f = formation(fid);
  const slots = new Set(f.align.map((a) => a.slot));
  const jobs = Object.fromEntries(Object.entries(c.jobs).filter(([s]) => slots.has(s as OffSlot))) as OffCall['jobs'];
  // A slot the concept says nothing about blocks.
  for (const s of ELIGIBLE) if (slots.has(s) && !jobs[s]) jobs[s] = 'BLOCK';
  return { formation: fid, playId: c.id, kind: 'pass', jobs, reads: c.reads.filter((s) => slots.has(s)), playAction: !!c.playAction };
}

// ── Fourth down ──────────────────────────────────────────────────────────────

export type FourthChoice = 'go' | 'punt' | 'fg';

/** Go, kick or punt. The measured go-rate for the distance and the field,
 *  pushed toward going when behind late, and toward a kick at the end of the
 *  half. A field goal is tried from fifty-five yards, sometimes fifty-eight. */
export function fourthCall(sit: Situation, L: League, quarterLen: number, rand: Rand): FourthChoice {
  const y100 = 100 - sit.los;
  const kick = y100 + 17;
  const dist = sit.togo <= 3 ? 'short' : sit.togo <= 7 ? 'med' : 'long';
  const zone = y100 >= 51 ? 'own' : y100 >= 35 ? 'mid' : 'fg';
  let go = L.fourth[`${dist}-${zone}`]?.go ?? 0.1;
  const late = lateness(sit, quarterLen);
  const needTd = sit.scoreDiff <= -4, needAny = sit.scoreDiff < 0;
  if (late > 0 && needAny) go = Math.max(go, needTd || kick > 55 ? 0.5 + 0.5 * late : go);
  if (late > 0.9 && needTd) go = 1;
  if (sit.quarter === 2 && sit.clock < 10 && kick <= 57) return 'fg';
  if (late > 0.95 && sit.scoreDiff >= -3 && sit.scoreDiff <= 0 && kick <= 57) return 'fg';
  if (rand() < go) return 'go';
  // Kickers now try from fifty-five as a matter of course, and from a little
  // further about half the time.
  return kick <= 55 || (kick <= 58 && rand() < 0.5) ? 'fg' : 'punt';
}

/** The probability a kick from this many yards goes over, by the measured
 *  bins and the kicker's own season, shrunk hard — kickers' percentages
 *  over a few weeks are mostly noise. */
export function fgMake(dist: number, L: League, team: TeamDoc): number {
  const bin = L.fg.find((b) => dist >= b.lo && dist <= b.hi) ?? L.fg[L.fg.length - 1]!;
  const k = team.kicker ? team.players[team.kicker.id]?.k : undefined;
  const lean = k ? ((k.fgm + 12 * 0.85) / (k.fga + 12)) / 0.85 : 1;
  return clamp(bin.make * lean, 0.02, 0.995) * (dist > 66 ? 0 : 1);
}

