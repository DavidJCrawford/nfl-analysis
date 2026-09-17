/** Join a site-root-relative path onto Astro's configured base.
 *  Astro does not prefix <a href> automatically; a project site served from
 *  /f1-analysis/ breaks silently without this. */
const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');
export const u = (path: string): string => `${BASE}/${path.replace(/^\//, '')}`;

/** A game's permanent URL, derived from the nflverse game_id.
 *
 *  `2026_01_NE_SEA` -> `/games/2026/1/NE-SEA/`  (SPEC §4)
 *
 *  Every link to a game goes through here, so the one place that knows how an
 *  id maps to a path is this function — including the pages themselves, which
 *  build their routes from the same split. */
export const gameParts = (id: string): { season: string; week: string; matchup: string } => {
  const [season, week, ...teams] = id.split('_');
  return {
    season: season!,
    // Weeks are zero-padded in the id and should not be in a URL: nobody
    // writes "week 01".
    week: String(Number(week)),
    matchup: teams.join('-'),
  };
};

export const gameUrl = (id: string): string => {
  const { season, week, matchup } = gameParts(id);
  return u(`/games/${season}/${week}/${matchup}/`);
};
