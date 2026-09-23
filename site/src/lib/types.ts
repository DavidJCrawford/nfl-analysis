/** The shape of what pipeline/emit.py writes into site/data/.
 *
 *  These are declarations, not validation: the emitter is the single producer
 *  and `pipeline/verify.py` is what actually checks the contents. Keeping them
 *  in step with emit.py is a manual job, and `astro check` is the thing that
 *  notices when a page reads a field that no longer exists. */

export interface Team {
  abbr: string;
  name: string;
  nick: string;
  conf: 'AFC' | 'NFC';
  /** "AFC North". */
  div: string;
  /** "North" — the division without its conference. */
  region: string;
  color: string;
  color2: string;
}

export type Teams = Record<string, Team>;

/** One game as the schedule knows it. Scores and everything downstream of them
 *  are absent until the game has been played — which, for most of the season,
 *  is most of the file. */
export interface ScheduleGame {
  id: string;
  week: number;
  date: string;
  weekday: string;
  kickoff: string;
  away: string;
  home: string;
  played: boolean;
  div: boolean;
  neutral: boolean;
  stadium: string | null;
  roof: string | null;
  /** Home-relative and positive when the home team is favoured. Only published
   *  a few weeks ahead of kickoff, so null for most of the season. */
  spread: number | null;
  total_line: number | null;
  away_rest: number | null;
  home_rest: number | null;
  /** True when a per-game file exists under data/games/. */
  detail?: boolean;
  away_score?: number;
  home_score?: number;
  /** Home minus away. Positive is a home win, 0 is a tie. */
  margin?: number;
  points?: number;
  ot?: boolean;
  plays?: number;
  drives?: number;
  notes?: number;
}

export interface Schedule {
  season: number;
  games: ScheduleGame[];
  weeks: number[];
  counts: { games: number; played: number; weeks: number; teams: number };
  /** The date of the last game with a final score — the season's own edge. */
  through: string | null;
  first: string | null;
  last: string | null;
  source: { name: string; url: string; licence: string };
}

/** Why a play was snapped somewhere other than where the last one ended.
 *  See the `mark_respots` pass in pipeline/emit.py. */
/** A named player. The jersey number is read out of the league's own play
 *  description, so it is null where the description does not give one. */
export interface Actor { n: string; j: number | null; }

export interface Respot {
  from: number;
  why: 'penalty' | 'loose' | 'change' | null;
}

export interface PlayBase {
  id: number;
  q: number;
  clock: string;
  /** Seconds left, as the stadium clock shows them. NOT monotonic: it counts
   *  3600 down to 0 through regulation and then restarts at 600 for overtime. */
  left: number;
  /** Seconds since kickoff, continuing through overtime. The timebase. */
  t: number;
  desc: string;
  hs: number;
  as: number;
  /** Timeouts left after this row, per team. */
  hto: number | null;
  ato: number | null;
}

/** A row that is not a play: kickoff of the game, end of a quarter, a timeout.
 *  It has no field position, and the replay must hold the ball where it was
 *  rather than invent one. */
export interface PlayNote extends PlayBase {
  kind: 'note';
  note: 'start' | 'quarter' | 'final' | 'timeout' | 'other';
  team?: string;
}

export interface Play extends PlayBase {
  kind: 'play';
  /** Which kind of unit was on the field — not its personnel, which does not
   *  exist for this season. See unit_of in pipeline/emit.py. */
  unit: string;
  pos: string;
  def: string;
  /** +1 if the team in possession attacks x = 100, -1 if it attacks x = 0. */
  dir: 1 | -1;
  /** Snap spot, in yards from the home team's goal line. */
  x0: number;
  /** Spot at the whistle. Null where the data does not say. */
  x1: number | null;
  drive: number;
  series: number;
  type: string;
  epa: number | null;
  /** Home win probability, so it does not flip meaning with possession. */
  hwp: number | null;
  down?: number;
  togo?: number;
  goal?: boolean;
  /** The line to gain, in the same coordinate as the ball. Absent goal-to-go. */
  xfd?: number;
  gain?: number;
  tags?: string[];
  score?: boolean;
  kick?: { land: number; dist: number; ret?: number; touchback?: boolean };
  respot?: Respot;
  /** Who did it — the players whose movement the replay can honestly draw.
   *  See build_actors in pipeline/emit.py. */
  act?: Partial<Record<'kick' | 'ret' | 'pass' | 'rec' | 'rush' | 'int', Actor>>;
  /** How far a pass travelled in the air, and how far it was carried after the
   *  catch. Between them they say where it was caught, not just where it
   *  finished. `yac` is present on completions and on nothing else. */
  air?: number;
  yac?: number;
}

export type AnyPlay = Play | PlayNote;

export interface Drive {
  n: number;
  pos: string;
  result: string;
  start: string | null;
  end: string | null;
  startx: number | null;
  endx: number | null;
  start_via: string | null;
  end_via: string | null;
  plays: number | null;
  yards: number | null;
  top: string | null;
  firsts: number | null;
  q0: number | null;
  q1: number | null;
  clock0: string | null;
  clock1: string | null;
  /** Half-open range into `plays`. */
  from: number;
  to: number;
}

export interface BoxSide {
  first_downs: number; first_rush: number; first_pass: number; first_pen: number;
  plays: number; yards: number; pass_yards: number; rush_yards: number;
  rush_att: number; pass_att: number; completions: number;
  sacks: number; sack_yards: number;
  third_att: number; third_made: number; fourth_att: number; fourth_made: number;
  turnovers: number; interceptions: number; fumbles_lost: number;
  penalties: number; penalty_yards: number;
  top: number; top_text: string;
}

/** `name` is the league's own abbreviation as it appears in a play description
 *  ("G.Smith"); `id` is the gsis id, which is what links to the player's page.
 *  It is optional because the play-by-play can name a role without identifying
 *  who filled it — though in practice all 847 lines of this season have one. */
export interface BoxLine { team: string; name: string; id?: string | null; }
export interface Passing extends BoxLine { att: number; cmp: number; yards: number; td: number; int: number; sacks: number; }
export interface Rushing extends BoxLine { att: number; yards: number; td: number; }
export interface Receiving extends BoxLine { tgt: number; rec: number; yards: number; td: number; }

export interface ScoringPlay {
  /** Index into `plays`. */
  i: number;
  q: number;
  clock: string;
  pos: string | null;
  desc: string;
  hs: number;
  as: number;
  tags: string[];
}

export interface Game {
  id: string;
  season: number;
  week: number;
  date: string;
  weekday: string;
  kickoff: string;
  home: string;
  away: string;
  home_score: number;
  away_score: number;
  ot: boolean;
  neutral: boolean;
  div: boolean;
  venue: {
    stadium: string | null; roof: string | null; surface: string | null;
    temp: number | null; wind: number | null; sky: string | null; weather: string | null;
  };
  officials: { referee: string | null };
  coaches: { home: string | null; away: string | null };
  starters: { home_qb: string | null; away_qb: string | null };
  line: { spread: number | null; total: number | null; home_ml: number | null; away_ml: number | null };
  rest: { home: number | null; away: number | null };
  opening_kickoff: string;
  drives: Drive[];
  plays: AnyPlay[];
  scoring: ScoringPlay[];
  box: Record<string, BoxSide>;
  players: { passing: Passing[]; rushing: Rushing[]; receiving: Receiving[] };
  /** Gaps the emitter found and could not explain. An empty list is a claim
   *  that nothing is missing, and the page prints whatever is here. */
  notes: string[];
}

// ── People ───────────────────────────────────────────────────────────────────

/** One group of statistics. Every field is optional because emit.py writes a
 *  group only when the player did that thing at all, and writes a key within it
 *  only when nflverse published one — a missing key inside a group that exists
 *  means zero, not unknown. */
export interface StatGroup { [key: string]: number | undefined; }

export interface Stats {
  passing?: StatGroup;
  rushing?: StatGroup;
  receiving?: StatGroup;
  defence?: StatGroup;
  kicking?: StatGroup;
  punting?: StatGroup;
  returns?: StatGroup;
  penalty?: StatGroup;
}

export type StatName = keyof Stats;

/** A player as the index knows him: enough to list, sort and link. */
export interface PlayerEntry {
  id: string;
  name: string;
  first: string | null;
  last: string | null;
  team: string;
  /** The roster's coarse position: one of eleven — QB RB WR TE OL DL LB DB K P LS.
   *  What a squad is grouped by. */
  pos: string | null;
  /** The club's depth-chart designation — CB rather than DB. What is shown. */
  depth_pos: string | null;
  /** nflverse's grouping, from the stats rather than the roster, so it is null
   *  for anyone who has not played. */
  group: string | null;
  no: number | null;
  /** ACT on a 53-man roster; RES injured; DEV practice squad; CUT released. */
  status: string;
  exp: number | null;
  games: number;
  face: boolean;
  stats: Stats;
}

export interface PlayerIndex {
  season: number;
  players: Record<string, PlayerEntry>;
  counts: { all: number; active: number; played: number; faces: number };
}

/** One game in a player's season. */
export interface PlayerGame {
  week: number;
  game: string;
  team: string;
  opp: string;
  home?: boolean;
  pf?: number;
  pa?: number;
  result?: 'W' | 'L' | 'T';
  stats: Stats;
  /** Snaps taken and the share of his unit's. Absent for the ~1% of snap-count
   *  rows that resolve to no player, and for weeks nobody charted. */
  snaps?: { off?: number; def?: number; st?: number; off_pct?: number; def_pct?: number; st_pct?: number };
}

export interface Player {
  id: string;
  season: number;
  name: string;
  team: string;
  pos: string | null;
  depth_pos: string | null;
  no: number | null;
  status: string;
  bio: {
    born: string | null;
    /** Inches and pounds, as published. */
    height_in: number | null;
    weight_lb: number | null;
    college: string | null;
    exp: number | null;
    rookie: number | null;
    /** Null means undrafted, which is a fact about a player and not a gap. */
    draft: { club: string | null; pick: number | null } | null;
  };
  stats: Stats;
  log: PlayerGame[];
}

export interface TeamWeek { week: number; game: string; opp: string; stats: Stats; }

export interface TeamStat {
  team: string;
  /** What this club's offence did. */
  for: Stats;
  /** What was done to it — read off its opponents' rows, since nflverse
   *  publishes a club's own offence and not what it conceded. */
  against: Stats;
  weeks: TeamWeek[];
}

export interface TeamStats { season: number; teams: Record<string, TeamStat>; }
