# HANDOFF — NFL Analysis

Rewritten 2026-09-16 at the end of the session that built the site; revised
2026-09-17 after the session that reworked the pages, and 2026-09-24 after the
one that added people. Read [SPEC.md](SPEC.md) first; this says what is done,
what is verified, and what will bite you.

The previous version of this file described a scaffold. Everything it said to
build is built. §5 is the part to read whatever else you skip.

---

## 1. What exists

```
Makefile                      fetch / emit / verify / week / build / links
pipeline/fetch.py             nflverse release assets -> .cache/nflverse
pipeline/emit.py              CSV -> canonical JSON in site/data/
pipeline/verify.py            checks the JSON against facts it did not produce
pipeline/update.py            the weekly refresh, as one command — §6
pipeline/check_site.py        follows every internal link in the built site
site/data/                    committed: schedule.json, teams.json,
                              team-stats.json, players.json,
                              games/*.json (32), players/*.json (1,743)
site/src/lib/                 data.ts, game.ts, types.ts, format.ts, url.ts,
                              scope.ts, stats.ts, replay.ts
site/src/components/game/     GameReplay, BoxScore, PlayerLines, PlayLog
site/src/components/people/   Face
site/src/pages/               index, games/[season]/[week]/[matchup],
                              teams/, teams/[abbr], players/, players/[id],
                              credits
site/public/                  logos/ (32), logos/sm/ (32), faces/ (1,734),
                              nfl.webp
```

`make week` works and produces 2,051 pages and 38,663 internal links.

**People were added on 2026-09-24.** Six more nflverse datasets — rosters,
player and club stats by week and by season, snap counts — and a page for
everyone on a roster. Who gets a page is the union of the active rosters and
everyone who has played, which is not tidiness: fifty-one players have appeared
this season and have since gone to a practice squad or injured reserve, and all
847 box-score lines in the published game pages link to a player page. Active
alone would have orphaned some of them, and more every week.

**Six components were deleted on 2026-09-17** and are in the history if wanted:
`SeasonWeave`, `SeasonGrid`, `SeasonLedger` (the old front page and `/games/`),
`WinProbability`, `DriveChart`, `ScoringSummary` (the old game page). Each went
because the page said the same thing another way — SPEC §4.1 and §4.2. Deleting
them turned up five library exports nothing could reach; if you delete a
component, sweep for that, and count *in-file* references before you do. Five
constants in `game.ts` look unused from outside and are reached by `gameLength`
and `lineScore`.

**Two positions per player, on purpose.** The roster files everyone under
eleven coarse positions (QB RB WR TE OL DL LB DB K P LS) and that is what a
squad list groups by; the club's own depth chart says CB rather than DB and
that is what gets written down. A third vocabulary exists in the stats files
and is finer again — grouping by that one dropped 234 defensive linemen into an
"Elsewhere" bucket, because `DL` is not in it.

## 2. What is verified, so you need not re-check it

Measured against the live sources on 2026-09-16, and again on 2026-09-24.

- nflverse publishes as **GitHub release assets**, not an API: release tag plus
  asset name. Ten are fetched: `schedules`, `teams`, `pbp`, `ftn_charting`,
  `rosters`, `stats_player` (week and season), `stats_team` (week and season)
  and `snap_counts`.
- **2026 is live and refreshing nightly.** 272 games, 18 weeks, 32 played.
- **The two aggregations agree.** This pipeline derives a box score by walking
  the plays; nflverse aggregates the same plays into per-player rows. Summed
  per club and compared, they match exactly on pass attempts, completions,
  passing yards, interceptions, sacks taken, rush attempts and rushing yards,
  over all 64 (game, club) pairs — once the sack bug was fixed. `verify.py`
  keeps them that way.
- **Snap counts join at 98.7%, with nothing ambiguous.** They are keyed on Pro
  Football Reference's player id, not the league's: `pfr_id` covers 80.6% and
  name-plus-club a further 18.1%, and no (name, club) pair in the roster maps
  to two people. The 1.3% left are name variants ("Paris Johnson" against
  "Paris Johnson Jr.") and are reported rather than guessed at.
- **Headshot URLs are Cloudinary**, so the resizing is asked of the CDN:
  `f_webp,q_auto,w_96,h_96,c_fill,g_face` gives 96x96 WebP at about 1.8 KB
  against a published 3400x2450 PNG at 3.7 MB. Twenty-four are served from
  `/image/private/` rather than `/image/upload/`; matching only the latter
  leaves those twenty-four untransformed, at 95 MB between them.
- **The field coordinate works.** `yardline_100` converted to `x` (yards from
  the home team's goal line) agrees with the `yrdln` text on every one of the
  2,569 plays with a position. That check runs on every emit.
- **The plays add up to the published score in all 16 games.**
- **`ftn_charting` is fetched but unused.** It holds manual per-play charting —
  play action, pocket, screens — and nothing on the site reads it yet. It also
  holds `starting_hash`, the only lateral information in the whole dataset:
  which hash the ball was spotted on, present on 1,910 of 1,911 runs and passes.
  The replay does not use it and its overlay is worded accordingly.
- **The club marks are fetched and committed** to `site/public/logos/`. They are
  trademarks of the clubs and are *not* covered by nflverse's CC BY 4.0, which
  applies to its data — nflverse publishes the image addresses but does not own
  the marks. `/credits/` says so, and says a page loads only the marks of the
  clubs it is about.

  There are two sets, and which one a page uses is a weight decision:

  - `logos/` — the 500px PNGs as fetched, **1.7 MB for all 32, ~52 KB each**.
    Only for pages that need one or two of them: a game page (2), a club's own
    page (1). Never all 32.
  - `logos/sm/` — 96px WebP, ink-cropped and centred in a square, **105 KB for
    all 32, ~3 KB each**. For anywhere that shows many clubs at a small size.
    The front page uses these and holds all 32; in the originals it would have
    been 1.7 MB of PNG to draw something 24px across.

  Cropping to the ink also settles something measured: the originals normalise
  ink for width (0.73–0.92 of the canvas) but **not for height (0.29–0.93)**, a
  3x spread, so a wide mark drawn to a fixed box reads far lighter than a tall
  one. Squared, every club is the same size.

  Regenerate the small set from the originals with PIL — a one-off, not a build
  step; the pipeline stays dependency-free and neither set is built by `make`.
- **The league's shield is fetched too**, to `.cache/nflverse/nfl.png` and cut to
  `site/public/nfl.webp` (128px, 5 KB). It sits in the masthead on every page.
  nflverse's teams file has no row for the league, so `fetch.py` writes the
  address down — it is the same ESPN CDN the club marks come from.

  It is the NFL's trademark and a stronger claim than the club marks: a club mark
  beside a fixture says *which club*, a shield beside the site's own name says
  *whose site*. David's call, on a personal experiment that is not and will not
  be monetised; `/credits/` names it explicitly alongside the unofficial and
  unaffiliated statement. Worth re-reading that page before doing anything that
  would make the site look official.
- **There is no public player tracking for 2026** — SPEC §3.1. This is the hard
  ceiling on the replay and it shaped the replay from the start.

## 3. Five things about the data that cost time to find

**`game_seconds_remaining` is not monotonic.** It counts 3600 down to 0 through
regulation and then **restarts at 600 for overtime**. Anything on a timeline
must use the emitted `t` (seconds since kickoff), which is derived, not given.
`verify.py` checks it never goes backwards.

**A play's end spot is not in the data.** `end_yard_line` is empty on all 2,756
rows. It is derived in `emit.py` per play type, and the rules are written out
there. The derivation is checked against the next play's snap spot, and every
difference must have a reason — `penalty`, `loose`, `change`, `restart` — or it
is reported as a hole.

**Betting lines are only published about two weeks ahead.** 48 of 272 games have
a spread today; 224 have none. Any design that fills the unplayed season with a
forecast will be blank until December. This killed the first idea for the home
page, and it was cheaper to find out before drawing it than after.

**nflverse revises games it has already published.** The Week 2 refresh added
sixteen games and also rewrote three Week 1 games that had been live on the site
for a week: two play descriptions the league amended after the fact (a replay
assist, a sideline ruling reversed), and win probability recomputed over the
last eleven plays of one game. All three were improvements. None announced
itself. Assume every refresh can change the past, which is why `update.py`
diffs the old JSON against the new and reports any already-published game that
moved — see §6.

**nflverse sets `pass_attempt` on a sack.** It marks a dropback, not an
official attempt, and no box score the NFL prints counts a sack as a pass
attempt. Taking the flag at face value inflated every club's attempts by its
sacks taken and every quarterback's line on every game page — Geno Smith read
27 of 45 against Green Bay where the official line is 27 of 41. Completions and
passing yards were never wrong, because a sack is neither. The general lesson
is that a flag in this data is named for what the feed needs it for, not for
what a box score means by the same word.

## 4. Lessons from F1 that applied here, and how

These were expensive on the sibling project. Each one earned its keep again.

**Verify what the data holds before designing around it.** The betting-line
finding above. Half a day saved by twenty minutes of counting.

**Never draw across a gap.** The replay places the ball rather than tweening it
whenever the next snap is not where the last whistle was, and says why on the
page. Nine apparent "holes" turned out to be offence-recovered fumbles, which
carry `fumble` but not `fumble_lost`; fixing the tag took the unexplained count
to zero. Do not let it creep back above zero.

**Find something the output can be checked against, and check it every build.**
`verify.py` — 78,429 checks over 16 games and 272 schedule rows. It found three real drive-grouping
bugs, all of which were real football: a drive belongs to the team in the row
carrying the drive summary, not the posteam on its first row (a fumbled kickoff
return gives the drive to the other team); the conversion after a defensive
touchdown sits inside the drive that threw the interception; the END GAME row
gets a drive number of its own with no plays in it.

`check_site.py` — added late, found 544 dead links on the first run, because
two components were still building a game's URL by hand. Both checks are in
`make build`.

**A cached download is a snapshot.** nflverse refreshes nightly. Re-fetch
before concluding anything is missing.

**Say what is missing, on the page.** The replay's overlay states in words that
there is no tracking data, that the ball is on the centre line because the data
gives a yard line and not a position, and that every play gets the same beat
because a play's real duration is not recorded. `/credits/` says it again at
length. A game with an unexplained gap prints it in a box at the top of its
page; today no game has one.

**Check the trivial things too.** Two more for the list:

- **Astro's template parser cannot read `<=` inside a JSX expression**, nor a
  nested template literal inside an attribute. Both fail as *"svg has no
  corresponding closing tag"* a hundred lines away and then as dozens of
  TypeScript errors inside the `<style>` block. Resolve the expression in the
  frontmatter.
- JSX still collapses whitespace around expressions: `18 weeks.16 have been
  played`. `{' '}` fixes it.
- **`astro dev` will serve stale data after `make emit`** if anything caches
  across hot reload. `src/lib/data.ts` now skips its cache in dev for exactly
  this reason; a production build was correct while the dev server showed a bug
  that had already been fixed.
- **`astro dev` will also serve stale CSS**, and this one cost an hour on
  2026-09-17 across three separate occasions. A scoped rule was present in the
  source and in `dist` and simply absent from what the dev server handed the
  browser — so a correct rule looked like a bug, and later a real change looked
  like no change at all. Restarting the dev server fixes it. **Verify against a
  static server on `site/dist`, not against `astro dev`.** That is what ships.
- **Astro's `compressHTML` deletes a newline between running text and an inline
  element** rather than collapsing it to the space HTML says it is, so
  `comes from\n<a>nflverse-data</a>` was published as `comes fromnflverse-data`.
  Four sentences on `/credits/` shipped like that. It is invisible in the source
  and only appears in the build. `compressHTML: false` is set in
  `astro.config.mjs`; keeping the whitespace costs 33 KB gzipped across all the
  pages, about 107 bytes each, and takes the whole class of bug off the table.
- **An `<img>` in a baseline-aligned flex row sets the row's baseline from its
  own bottom edge**, so a mark beside a wordmark drags the whole masthead down
  as it grows. Give the text `align-items: baseline` and the image
  `align-self: center`, and the row stops moving whatever size the mark is.

**When something does not add up, search for what actually happened.** Every
anomaly this session turned out to be real football described by the data, not
a bug in the data. Assume that first.

## 5. What to do next, and what to be careful of

In rough order of value:

1. **Run `make week` after each slate of games.** That is the whole routine —
   see §6. The site fills in by itself: a card's crests come out of grey, its
   kickoff becomes a score, the fixture pages become reports at the same URLs,
   the division band thins as the ties resolve, and the next week's fixtures
   appear. Nothing needs editing. If it reports nothing moved, nothing upstream
   moved.
2. **The bye now draws, and the front page has still not met one.** A club
   page renders its bye week correctly — seen on Kansas City, week 5 — but a
   bye also means a week with fewer than sixteen games, and the front page's
   fixed four-column grid has never been given one. The first such week reaches
   the board when week 4 finishes.
3. **`ftn_charting` is still unused**, and so are `injuries` and
   `depth_charts`, which were looked at and left: the injury report is 36.5%
   populated and the depth-chart file is 52 MB of per-week rows. Play action, pocket and screens
   per play would add a genuine layer to the play log without implying any
   tracking. It is the obvious next feature.
4. **Nobody has a career.** Every player page is one season, because one
   season is what is fetched. nflverse has rosters and player stats back to
   1999 in the same shape, so a career table is mostly a matter of fetching
   more and deciding what a page does with a man who played for six clubs.
5. **Past seasons.** `site/src/lib/scope.ts` is one constant. nflverse has
   play-by-play to 1999 and the format is uniform, so this is mostly a matter
   of emitting more and paginating the front page.

Careful of:

- **The replay's payload is inlined per game page** — about 40 KB of JSON. Fine
  for 272 games; think again before widening to 1999.
- **`prefers-reduced-motion` turns the replay into a stepper.** Every play lands
  already finished, because nothing will animate it. If you change `goTo`, keep
  that branch.
- **Nothing shows the score before the whistle during playback.** The scoreboard
  and caption both come from the play's own row, which is post-play. Stepping
  and scrubbing deliberately reveal everything; playback does not.

## 6. The weekly refresh

```bash
make week                  # fetch, emit, verify, build, check links, report
make week ARGS=--strict    # …and stop if a published game was rewritten
make week ARGS=--no-build  # data only, for a quick look mid-slate
```

`pipeline/update.py`. It runs the four steps that never vary and then reports
the part that does. Design notes, because they are the reason it can be a script
at all:

- **It edits no source file.** The front page used to carry a hand-held count of
  how many weeks to show, which would have forced this script to patch a page's
  frontmatter by regex. That count is now derived — `index.astro` runs the board
  down to the first week that is not complete — so the job is data in, pages
  out, and `update.py` only ever writes to `site/data/`.
- **First *incomplete* week, not last played.** Keying the board off the last
  played week would publish next week's fixtures on a Friday, because a
  Thursday-night game would have completed the week. The season ends with every
  week complete, so the whole board shows.
- **It does not commit.** What to say about a week is a judgement, and so is the
  one thing it exists to surface.
- **It diffs the old JSON against the new** and names any already-published game
  that changed, with the fields collapsed (`plays[].hwp ×5` rather than five
  paths). See §3: nflverse rewrites the past, quietly and usually for the
  better. `--strict` turns that into exit 2.

The judgement it cannot make: whether a revision to a live game is a correction
or a regression. Everything else here is deterministic.

## 7. Conventions worth keeping

- **Design tokens are unchanged from F1**, except five `--nfl-*` additions:
  `--nfl-turnover` aliases `--f1-corner`, so NFL code has an NFL name for the one
  colour that encodes data; `--nfl-turf` and `--nfl-turf-end` are the field's two
  greens; `--nfl-strip-ink` and `--nfl-strip-chip` are the lettering on the
  scrubber strip.

  The page's copy of the strip overrides the two greens locally, lighter and
  with more chroma. That is not a mistake: measured, the strip in the replay and
  the strip on the page were `rgb(31,38,31)` and `rgb(17,27,17)` to the pixel and
  still did not look alike, because the replay draws them on near-black and the
  page is white paper. The picture of a field is lifted to look like the thing
  it is a picture of, rather than to match it in a colour picker.
- **Comments say why, not what.** That is what made this handoff writable.
- **Pushing `main` deploys.**
- **Commit the emitted data with the code.** The site builds from the repo alone.
- **Every link to a game goes through `gameUrl()`.** The 544 dead links are what
  happens otherwise.
