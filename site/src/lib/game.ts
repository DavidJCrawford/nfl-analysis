/** Views of one game that more than one component needs.
 *
 *  Nothing here reads a file: these are pure functions over the emitted game,
 *  so a page can compute them once and hand them down. Anything that had to be
 *  *checked* against the source belongs in pipeline/verify.py, not here. */
import type { AnyPlay, Game, Play } from './types';

export const isPlay = (p: AnyPlay): p is Play => p.kind === 'play';

export const plays = (g: Game): Play[] => g.plays.filter(isPlay);

/** Regulation is four fifteen-minute quarters; overtime is ten. Mirrors the
 *  constants in pipeline/emit.py, which is where `t` is computed. */
export const QUARTER = 900;
export const OVERTIME = 600;
export const REGULATION = 3600;

/** Where each quarter ends on the elapsed-time axis. Overtime periods are
 *  shorter than quarters, so this cannot be `q * 900`. */
export const quarterEnd = (q: number): number =>
  q <= 4 ? q * QUARTER : REGULATION + (q - 4) * OVERTIME;

/** The last period the game actually reached — 4, or 5 and up for overtime. */
export const lastQuarter = (g: Game): number =>
  g.plays.reduce((n, p) => Math.max(n, p.q), 4);

export const gameLength = (g: Game): number => quarterEnd(lastQuarter(g));

export interface QuarterScore { q: number; home: number; away: number; }

/** Points scored in each quarter, by difference of the running totals.
 *
 *  Derived rather than counted from scoring plays: a running total cannot
 *  disagree with itself, and the last row is guaranteed to add up to the final
 *  score that pipeline/verify.py already checked against the schedule. */
export const lineScore = (g: Game): QuarterScore[] => {
  const out: QuarterScore[] = [];
  let home = 0, away = 0;
  for (let q = 1; q <= lastQuarter(g); q += 1) {
    const upTo = g.plays.filter((p) => p.q <= q);
    const h = upTo.length ? upTo[upTo.length - 1]!.hs : home;
    const a = upTo.length ? upTo[upTo.length - 1]!.as : away;
    out.push({ q, home: h - home, away: a - away });
    home = h; away = a;
  }
  return out;
};

/** How the result compared with what the market expected, when there was one.
 *  `spread` is home-relative and positive when the home team is favoured. */
export const versusSpread = (g: Game): { expected: number; actual: number; diff: number } | null => {
  if (g.line.spread === null) return null;
  const actual = g.home_score - g.away_score;
  return { expected: g.line.spread, actual, diff: actual - g.line.spread };
};

/** How many times the lead actually changed hands.
 *
 *  A tie is not a lead change on its own — the lead changes when the team in
 *  front becomes the team behind — so a game that is level at half-time and
 *  then goes the other way counts once, not twice. */
export const countLeadChanges = (g: Game): number => {
  let leader = 0;   // -1 away in front, 0 level, +1 home in front
  let changes = 0;
  for (const p of g.plays) {
    const now = Math.sign(p.hs - p.as);
    if (now !== 0 && leader !== 0 && now !== leader) changes += 1;
    if (now !== 0) leader = now;
  }
  return changes;
};
