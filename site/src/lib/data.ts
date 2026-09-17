/** Read the emitted JSON at build time.
 *
 *  `__DATA_DIR__` is an absolute path injected by astro.config.mjs. It cannot
 *  be derived here from `import.meta.url`: after bundling that points at the
 *  output chunk rather than at this file, and the path silently resolves to
 *  somewhere inside dist/.
 *
 *  Everything is read once and cached. A season is 272 schedule rows and
 *  sixteen 60 KB game files today; by January it is 272 game files, and every
 *  page that lists games would otherwise re-read and re-parse the schedule.
 *
 *  The cache is off in dev. It survives Astro's hot reload, so a page that had
 *  already been rendered kept serving the data as it was before `make emit` —
 *  which cost half an hour of chasing a bug that had already been fixed. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Game, Schedule, ScheduleGame, Teams } from './types';

declare const __DATA_DIR__: string;

const cache = new Map<string, unknown>();

function read<T>(rel: string): T {
  if (!import.meta.env.DEV) {
    const hit = cache.get(rel);
    if (hit !== undefined) return hit as T;
  }
  const value = JSON.parse(readFileSync(join(__DATA_DIR__, rel), 'utf8')) as T;
  if (!import.meta.env.DEV) cache.set(rel, value);
  return value;
}

export const getSchedule = (): Schedule => read<Schedule>('schedule.json');
export const getTeams = (): Teams => read<Teams>('teams.json');
export const getGame = (id: string): Game => read<Game>(join('games', `${id}.json`));

/** Games in kickoff order, which is the order emit.py wrote them in. */
export const getGames = (): ScheduleGame[] => getSchedule().games;

/** One team's season in week order, with a null where the bye is.
 *  The bye is the absence of a game, so it is represented as one — a page that
 *  wants to draw it can, and one that does not will not accidentally shift a
 *  row by a column. */
export const getTeamSeason = (abbr: string): (ScheduleGame | null)[] => {
  const byWeek = new Map<number, ScheduleGame>();
  for (const g of getGames()) {
    if (g.home === abbr || g.away === abbr) byWeek.set(g.week, g);
  }
  return getSchedule().weeks.map((w) => byWeek.get(w) ?? null);
};

/** Won–lost–tied through the games played so far. */
export interface Record_ { w: number; l: number; t: number; }

export const getRecords = (): Map<string, Record_> => {
  const records = new Map<string, Record_>();
  const bump = (abbr: string, key: keyof Record_) => {
    const r = records.get(abbr) ?? { w: 0, l: 0, t: 0 };
    r[key] += 1;
    records.set(abbr, r);
  };
  for (const abbr of Object.keys(getTeams())) records.set(abbr, { w: 0, l: 0, t: 0 });
  for (const g of getGames()) {
    if (!g.played || g.margin === undefined) continue;
    if (g.margin > 0) { bump(g.home, 'w'); bump(g.away, 'l'); }
    else if (g.margin < 0) { bump(g.home, 'l'); bump(g.away, 'w'); }
    else { bump(g.home, 't'); bump(g.away, 't'); }
  }
  return records;
};

/** Teams in division order — AFC then NFC, East North South West, and within a
 *  division by current record. Any grid of 32 rows needs an order, and this is
 *  the one a reader already has in their head. */
export const getTeamOrder = (): string[] => {
  const teams = getTeams();
  const records = getRecords();
  const rank = { East: 0, North: 1, South: 2, West: 3 } as Record<string, number>;
  return Object.keys(teams).sort((a, b) => {
    const ta = teams[a]!, tb = teams[b]!;
    if (ta.conf !== tb.conf) return ta.conf === 'AFC' ? -1 : 1;
    if (ta.region !== tb.region) return (rank[ta.region] ?? 9) - (rank[tb.region] ?? 9);
    const ra = records.get(a)!, rb = records.get(b)!;
    if (ra.w !== rb.w) return rb.w - ra.w;
    if (ra.l !== rb.l) return ra.l - rb.l;
    return a.localeCompare(b);
  });
};

/** One week, with the span of dates it actually occupies. A week is not seven
 *  days: it runs Thursday to Monday, and a few run Wednesday to Monday or hold
 *  a Friday game in Brazil. */
export interface Week {
  week: number;
  games: ScheduleGame[];
  first: string;
  last: string;
  played: number;
  complete: boolean;
  byes: string[];
}

export const getWeeks = (): Week[] => {
  const teams = Object.keys(getTeams());
  return getSchedule().weeks.map((week) => {
    const games = getGames().filter((g) => g.week === week);
    const dates = games.map((g) => g.date).sort();
    const playing = new Set(games.flatMap((g) => [g.home, g.away]));
    return {
      week,
      games,
      first: dates[0] ?? '',
      last: dates[dates.length - 1] ?? '',
      played: games.filter((g) => g.played).length,
      complete: games.length > 0 && games.every((g) => g.played),
      // Every team not playing this week is on a bye. Derived rather than
      // stored: nflverse has no bye row, a bye is the absence of a game.
      byes: teams.filter((t) => !playing.has(t)).sort(),
    };
  });
};
