/** How each statistic is named and written.
 *
 *  emit.py decides what exists; this decides what it is called and how it
 *  reads. Kept in one place because the same number appears in four contexts —
 *  a player's season, his game log, a club's totals and a leaderboard — and it
 *  should be the same word every time.
 *
 *  Long labels for a definition list, `short` for a table head where the
 *  column is three characters wide. Where the short form is the one everybody
 *  actually uses ("TD", "INT", "YDS") it is the abbreviation; where an
 *  abbreviation would be a puzzle, it is not.
 */
import type { StatGroup, StatName, Stats } from './types';

export type Fmt = 'int' | 'yards' | 'epa' | 'pct' | 'dec' | 'plain';

export interface Field { key: string; label: string; short: string; fmt: Fmt; }

export const GROUP_LABEL: Record<StatName, string> = {
  passing: 'Passing',
  rushing: 'Rushing',
  receiving: 'Receiving',
  defence: 'Defence',
  kicking: 'Kicking',
  punting: 'Punting',
  returns: 'Returns',
  penalty: 'Penalties',
};

export const FIELDS: Record<StatName, Field[]> = {
  passing: [
    { key: 'cmp', label: 'Completions', short: 'CMP', fmt: 'int' },
    { key: 'att', label: 'Attempts', short: 'ATT', fmt: 'int' },
    { key: 'yards', label: 'Yards', short: 'YDS', fmt: 'yards' },
    { key: 'td', label: 'Touchdowns', short: 'TD', fmt: 'int' },
    { key: 'int', label: 'Interceptions', short: 'INT', fmt: 'int' },
    { key: 'sacked', label: 'Sacked', short: 'SK', fmt: 'int' },
    { key: 'first', label: 'First downs', short: '1ST', fmt: 'int' },
    { key: 'air', label: 'Air yards', short: 'AIR', fmt: 'yards' },
    { key: 'yac', label: 'Yards after catch', short: 'YAC', fmt: 'yards' },
    { key: 'epa', label: 'EPA', short: 'EPA', fmt: 'epa' },
    { key: 'cpoe', label: 'Completion % over expected', short: 'CPOE', fmt: 'epa' },
  ],
  rushing: [
    { key: 'att', label: 'Carries', short: 'ATT', fmt: 'int' },
    { key: 'yards', label: 'Yards', short: 'YDS', fmt: 'yards' },
    { key: 'td', label: 'Touchdowns', short: 'TD', fmt: 'int' },
    { key: 'first', label: 'First downs', short: '1ST', fmt: 'int' },
    { key: 'lost', label: 'Fumbles lost', short: 'FUM', fmt: 'int' },
    { key: 'epa', label: 'EPA', short: 'EPA', fmt: 'epa' },
  ],
  receiving: [
    { key: 'rec', label: 'Receptions', short: 'REC', fmt: 'int' },
    { key: 'tgt', label: 'Targets', short: 'TGT', fmt: 'int' },
    { key: 'yards', label: 'Yards', short: 'YDS', fmt: 'yards' },
    { key: 'td', label: 'Touchdowns', short: 'TD', fmt: 'int' },
    { key: 'first', label: 'First downs', short: '1ST', fmt: 'int' },
    { key: 'air', label: 'Air yards', short: 'AIR', fmt: 'yards' },
    { key: 'yac', label: 'Yards after catch', short: 'YAC', fmt: 'yards' },
    { key: 'share', label: 'Share of targets', short: 'TGT%', fmt: 'pct' },
    { key: 'epa', label: 'EPA', short: 'EPA', fmt: 'epa' },
  ],
  defence: [
    { key: 'solo', label: 'Solo tackles', short: 'SOLO', fmt: 'int' },
    { key: 'assist', label: 'Assisted tackles', short: 'AST', fmt: 'int' },
    { key: 'tfl', label: 'Tackles for loss', short: 'TFL', fmt: 'int' },
    { key: 'sacks', label: 'Sacks', short: 'SK', fmt: 'dec' },
    { key: 'qb_hits', label: 'Hits on the quarterback', short: 'QBH', fmt: 'int' },
    { key: 'pd', label: 'Passes defended', short: 'PD', fmt: 'int' },
    { key: 'int', label: 'Interceptions', short: 'INT', fmt: 'int' },
    { key: 'ff', label: 'Forced fumbles', short: 'FF', fmt: 'int' },
    { key: 'td', label: 'Touchdowns', short: 'TD', fmt: 'int' },
  ],
  kicking: [
    { key: 'fgm', label: 'Field goals', short: 'FGM', fmt: 'int' },
    { key: 'fga', label: 'Attempts', short: 'FGA', fmt: 'int' },
    { key: 'long', label: 'Longest', short: 'LNG', fmt: 'yards' },
    { key: 'patm', label: 'Extra points', short: 'XPM', fmt: 'int' },
    { key: 'pata', label: 'Extra point attempts', short: 'XPA', fmt: 'int' },
  ],
  punting: [
    { key: 'att', label: 'Punts', short: 'PUNT', fmt: 'int' },
    { key: 'yards', label: 'Yards', short: 'YDS', fmt: 'yards' },
    { key: 'net', label: 'Net yards', short: 'NET', fmt: 'yards' },
    { key: 'in20', label: 'Inside the 20', short: 'IN20', fmt: 'int' },
    { key: 'long', label: 'Longest', short: 'LNG', fmt: 'yards' },
  ],
  returns: [
    { key: 'pr', label: 'Punt returns', short: 'PR', fmt: 'int' },
    { key: 'pr_yards', label: 'Punt return yards', short: 'PR YDS', fmt: 'yards' },
    { key: 'kr', label: 'Kick returns', short: 'KR', fmt: 'int' },
    { key: 'kr_yards', label: 'Kick return yards', short: 'KR YDS', fmt: 'yards' },
  ],
  penalty: [
    { key: 'n', label: 'Penalties', short: 'PEN', fmt: 'int' },
    { key: 'yards', label: 'Yards', short: 'YDS', fmt: 'yards' },
  ],
};

/** A number as its field wants to be read. A key that is absent from a group
 *  that exists means zero — see types.ts — so this prints 0 rather than a dash
 *  once the group is there at all. */
export const show = (v: number | undefined, fmt: Fmt, present = true): string => {
  if (v === undefined) return present ? (fmt === 'epa' ? '—' : '0') : '—';
  switch (fmt) {
    case 'epa': return (v > 0 ? '+' : '') + v.toFixed(v % 1 === 0 ? 0 : 1);
    case 'pct': return `${Math.round(v * 100)}%`;
    case 'dec': return v % 1 === 0 ? String(v) : v.toFixed(1);
    default: return v.toLocaleString('en-GB');
  }
};

/** The groups a player actually has, in the order they should be read: what he
 *  is paid to do first. Penalties last, always — they are a footnote, not an
 *  achievement. */
const ORDER: StatName[] = ['passing', 'rushing', 'receiving', 'defence',
                           'kicking', 'punting', 'returns', 'penalty'];

export const groupsOf = (stats: Stats): [StatName, StatGroup][] =>
  ORDER.filter((g) => stats[g]).map((g) => [g, stats[g]!] as [StatName, StatGroup]);

/** The one line that sums a player up, chosen by what he does most of.
 *
 *  A quarterback is his passing, a receiver his catches, a linebacker his
 *  tackles. Picked from the numbers rather than from the position on the
 *  roster, because a position is a label and what somebody actually did is
 *  not: a running back who caught eight passes and carried twice should read
 *  as a receiver that week. */
export const headline = (stats: Stats): { group: StatName; fields: Field[] } | null => {
  const weight: [StatName, number][] = [
    ['passing', stats.passing?.att ?? 0],
    ['rushing', stats.rushing?.att ?? 0],
    ['receiving', stats.receiving?.tgt ?? 0],
    ['defence', (stats.defence?.solo ?? 0) + (stats.defence?.assist ?? 0)],
    ['kicking', stats.kicking?.fga ?? 0],
    ['punting', stats.punting?.att ?? 0],
    ['returns', (stats.returns?.pr ?? 0) + (stats.returns?.kr ?? 0)],
  ];
  const best = weight.filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1])[0];
  if (!best) return null;
  const KEYS: Partial<Record<StatName, string[]>> = {
    passing: ['cmp', 'att', 'yards', 'td', 'int'],
    rushing: ['att', 'yards', 'td'],
    receiving: ['rec', 'tgt', 'yards', 'td'],
    defence: ['solo', 'assist', 'sacks', 'int'],
    kicking: ['fgm', 'fga', 'long'],
    punting: ['att', 'net', 'in20'],
    returns: ['pr', 'pr_yards', 'kr', 'kr_yards'],
  };
  const keys = KEYS[best[0]] ?? [];
  return { group: best[0], fields: FIELDS[best[0]].filter((f) => keys.includes(f.key)) };
};
