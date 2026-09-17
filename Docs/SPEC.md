# SPEC — NFL Analysis

**A static, editorial site for one NFL season: every game as a card, week by
week, and every game that has been played replayed down the field, play by
play.**

- **Status:** Built 2026-09-16, reworked 2026-09-17. The schedule, every game
  page and the replay are in; nothing is deployed. The data below is verified against the live sources,
  not assumed — see §3.
- **Sibling project:** [F1 Analysis](https://github.com/DavidJCrawford/f1-analysis),
  whose design system, build shape and hard-won lessons this inherits. See
  [HANDOFF.md](HANDOFF.md) §4 for the lessons, which are not optional reading.
- **Deployment target:** GitHub Pages, personal account, `/nfl-analysis/`.
- **Aesthetic reference:** [impeccable.style](https://impeccable.style), via F1
  Analysis — calm, editorial, typographically led. Decoration reads as wrong.

---

## 1. The promise

One sentence, used to accept and reject every feature:

> **The season at a glance, and any game in it played back.**

Two things, done properly, rather than a statistics site that also has a
schedule. If a feature serves neither, it does not belong.

## 2. Scope

**The 2026 season only**, which began on 2026-09-09.

| | |
| --- | ---: |
| Regular-season games | 272 |
| Weeks | 18 |
| Teams | 32 |
| Games played as of 2026-09-16 | **16** |

The season is one week old. That is a feature for building — the schedule tree
is mostly future, so the treatment of *unplayed* games is not an edge case to
bolt on later, it is most of the page on day one.

**No equivalent of F1's circuit pages.** Every game is played on the same
100-yard field; there is nothing to analyse about the venue that would carry a
page. Stadium, roof and surface are properties of a game, not subjects.

Scope is a single switch, as in F1 — `site/src/lib/scope.ts` — so widening to
past seasons later is one line. nflverse carries play-by-play back to 1999.

## 3. Data — verified 2026-09-16

Everything comes from **[nflverse](https://github.com/nflverse/nflverse-data)**,
published as GitHub release assets and **refreshed nightly during the season**.
No API key, no rate limit, no residential-IP requirement — none of the fetch
pain the F1 project was built around.

| Dataset | Licence | Holds | 2026? |
| --- | --- | --- | --- |
| `schedules` / `games.csv` | CC BY 4.0 | 272 games, kickoff times, scores, stadium, roof, surface, rest days, betting lines. 46 fields | **yes**, updated daily |
| `pbp` / `play_by_play_2026.csv` | CC BY 4.0 | **372 fields per play.** Field position, down, distance, yards gained, clock, drive, series, play type, description, EPA, win probability, players involved | **yes**, updated nightly |
| `ftn_charting` | CC BY 4.0 | Manual per-play charting — play action, pocket, screens | **yes** |
| `nextgen_stats` | CC BY 4.0 | Aggregated speed/separation metrics | **not yet for 2026** |
| `pbp_participation` | CC BY 4.0 | Personnel on field per play | **not yet for 2026** |

Attribution is a licence condition, not courtesy. A credits page carries it, as
in F1.

### 3.1 What the replay can and cannot show

**This is the single most important fact in this document.** Getting the
equivalent wrong on F1 cost several rebuilds.

**There is no public player tracking for the current season.** The NFL's Next
Gen Stats tracking data — 22 players at 10 Hz — is released only for specific
historical weeks through the Big Data Bowl, under Kaggle competition terms. It
is not available for 2026 and cannot be redistributed.

So the replay shows **the ball, the chains and the drive** — not 22 moving
players. Concretely, every play gives:

- `yardline_100` — distance to the opponent's end zone, 0–100. This is the
  field-position equivalent of arc distance along a circuit, and it is what
  makes a field replay possible at all.
- `yards_gained`, `down`, `ydstogo`, `qtr`, `time`, `drive`, `series`
- `play_type`, the full play description, and the players involved
- `epa`, `wp` — how much the play changed the game

That is enough for a genuinely good replay: the ball advancing and retreating
down a field, the chains moving, the down marker, drives building and stalling,
the score turning. (`wp` is published and is deliberately not drawn — see §4.1.) It is not enough for routes, coverage or
a passing chart, and the site should not imply otherwise.

## 4. Information architecture

```
/                       The board: a card per game, a block per week, newest
                        week first, over a band showing the top of every division
/games/2026/1/NE-SEA/   One game: the replay, every play, the totals
/teams/                 Index
/teams/SEA/             Team page — schedule, results, form
/credits/               Sources and terms
```

There is no `/games/` index. There was, and the front page pointed at it; a front
page whose job is to point at the page the reader came for is a front page doing
nothing, so the board moved to `/` and the index went. `Games` left the masthead
with it, and `/credits/` is reached from a colophon at the foot of the board, as
on the sibling F1 site.

Slugs derive from nflverse's `game_id` (`2026_01_NE_SEA`), which is stable.

### 4.1 The home page — decided, then superseded

*The reasoning below stands; the conclusion did not survive contact with the
season. Kept because the constraint it turned on is permanent.*

**What is there now:** a card per game — both clubs' crests, the score or the
kickoff, the date, a division badge — four to a row, a block per week, newest
week first, under a band carrying the top of each division. A game still to be
played has its crests in grey, so a week reads as ahead of us without a word
saying so.

**Why the weave went.** It was built to be complete on day one and it was. But
it is a drawing of *pairings*, and a reader who arrives in week two wants the
games: who played, what the score was, who is next. Eighteen bands of hairline
with one column of ink is an honest picture of a season 6% played and not a
useful one. The grid had the same problem at 576 cells. Both are in the history
if a season-long picture is ever wanted again.

Two things from the original exercise that did carry:

- **A fixture carries no forecast** (below). Still true, still binding.
- **Club marks are a weight decision, not a taste one.** The board shows all 32
  clubs, which the 500px originals could not have paid for. See HANDOFF §2.

---

*The original decision, 2026-09-16:*

Four shapes were built from the real season and compared: a weave, a grid, a
tree and a ledger. **The weave over the grid** was chosen.

- **Weave.** Thirty-two lanes, one per team; eighteen bands, one per week; one
  vertical stroke per game joining the two teams that play it, with a filled
  foot at the home end and a hollow one away. Played games are ink, fixtures are
  hairline, so the picture fills in from the left as the season is played. It is
  complete on day one, because a pairing is known for all 272 games while a
  score is known for sixteen, and what it shows is the *structure* of the
  schedule: division games as short strokes between neighbouring lanes, the few
  interconference games crossing the whole field, byes as gaps.
- **Grid.** Teams down, weeks across. 576 cells, every one with content today.
  A fixture is the opponent in light type; a result adds the score, written from
  the row's own point of view, with a hairline under a win.

**The tree was dropped.** It read well, but the hierarchy it draws is not in the
data — week 2 is not inside week 1 — and once each leaf is big enough to carry a
label it shows exactly what a plain list of weeks shows, with more ink. The
ledger survived as `/games/`, where a complete fixture list belongs. *(The ledger
went too, when the board replaced it.)*

The constraint that decided it: **a fixture carries no forecast.** Betting lines
are published about two weeks ahead, so 48 of 272 games have a spread and 224
have none. Every shape here works from the pairing itself, which is known for
every game in the season.

### 4.2 The game replay — built

Full-screen dark overlay, transport, a strip along the bottom, Canvas 2D. A
hundred-yard field with hash marks at the real 70′9″ from each sideline, yard
numbers counting down from both goal lines, named end zones, the line of
scrimmage in teal and the line to gain in gold with the chains bracketed above.

Four rules, which are the design:

1. **The ball travels from the snap to the whistle and nowhere else.** Where the
   data gives no end spot it does not move, and the caption says so.
2. **Between plays it is placed, not tweened.** Every re-spot carries its reason
   on the page — penalty, loose ball, change of possession, restart — because
   nothing was carried between those two points.
3. **It sits on the centre line**, because the data gives a yard line and not a
   position. The overlay says that in words rather than implying otherwise.
4. **Every play gets the same beat.** A play's real duration is not recorded, so
   the replay advances play by play and does not pretend to run in real time.

**The camera does not move.** On a hundred-yard field, field position is the
subject; a camera that followed the ball would take away the thing the reader is
there to see.

Alongside: a toast carrying what just happened, and a broadcast bug with down and
distance, the clock and the score. The gain, EPA and win probability were all
there and all came out — the toast says the gain in words, and a model's number
beside a drawing of what actually happened invites the reader to trust the wrong
one. Beneath the field, a strip: the whole game as a trace of field position,
with a possession ribbon and a bead at every score. It draws itself as the game
plays, and the same routine draws it finished on the game page, above the fold,
so the shape of a game is readable without opening anything.

Both the bug and the toast reveal at the whistle during playback — they come from the play's own row, which is post-play,
so showing them at the snap gave the touchdown away. Stepping and scrubbing
reveal everything, because there the reader has chosen the play.

`#play-42` deep-links to one play, paused, and every play in the log links to
itself in the replay.

## 5. Build

Same shape as F1, and much simpler because the data is one source:

```bash
make fetch     # nflverse releases -> .cache/nflverse
make emit      # -> canonical JSON in site/data/
make build     # Astro + Pagefind
```

All of it is written and works:

```bash
make data      # fetch + emit + verify
make build     # Astro + Pagefind, then check every internal link
```

Two checks fail the build. `pipeline/verify.py` re-reads the emitted JSON and
tests it against things it did not produce — the published final scores, the
league's drive summaries, the point values football allows, whether elapsed time
ever runs backwards, and whether the ball ever moves without a recorded reason.
`pipeline/check_site.py` follows every internal link in the built site.

## 6. Decisions taken, and what is still open

**Taken:**

1. **The shape of the home page** — a board of game cards. Superseded the weave;
   see §4.1 for both, and for why the weave did not survive a season that is 6%
   played.
2. **How much of a game to encode** — plain JSON per game, about 60 KB. A game
   is ~170 plays, so F1's binary position format would have been
   over-engineering. The replay's own payload is a trimmed ~40 KB inlined into
   the game page.
3. **Unplayed games get a page.** The same URL is the fixture before kickoff and
   the report afterwards, which is what "one permanent page each" means, and it
   keeps every cell of the schedule pointing somewhere. All 272 are generated.

**Still open:**

4. **Widening scope to past seasons.** `site/src/lib/scope.ts` is one constant
   and nflverse has play-by-play to 1999 in a uniform format. The front page
   would need to paginate and the inlined replay payload would need rethinking.
5. **`ftn_charting` is fetched and unused.** Play action, pocket and screens per
   play would add a real layer to the play log without implying tracking.
