# SPEC — NFL Analysis

**A static, editorial site for one NFL season: the whole schedule as a single
picture, and every game that has been played replayed down the field, play by
play.**

- **Status:** Scaffolded 2026-09-16. Nothing is built yet. The data below is
  verified against the live sources, not assumed — see §3.
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
the score and win probability turning. It is not enough for routes, coverage or
a passing chart, and the site should not imply otherwise.

## 4. Information architecture

```
/                       The season as one picture — the schedule tree
/games/2026/1/NE-SEA/   One game: the replay, drives, box score
/teams/                 Index
/teams/SEA/             Team page — schedule, results, form
/credits/               Sources and terms
```

Slugs derive from nflverse's `game_id` (`2026_01_NE_SEA`), which is stable.

### 4.1 The schedule tree — the home page

The whole season as a single visualisation: 18 weeks, 272 games, results filled
in as they are played. This is the front door and the thing that has to be
beautiful.

Open question, and the first real design decision: **what shape is it?** A tree
is one reading; a grid of weeks, a bracket that grows toward the playoffs, and a
per-team ribbon across the season are others. The user asked for a tree — the
next session should design it properly and put options up.

Whatever it is, **most of it is future** for months. Unplayed games must look
deliberate, not empty. That constraint should drive the design, not follow it.

### 4.2 The game replay

The F1 race replay is the reference: a full-screen overlay, dark instrument
panel, play/pause/scrub/speed, a strip along the bottom, and a camera that
follows the action. Canvas 2D.

Instead of a circuit, **a football field**: 100 yards, hash marks, end zones,
the line of scrimmage and the first-down marker. The ball moves play by play;
the chains reset; drives change possession and the field flips.

What to show alongside, in rough order of value: the play description, down and
distance, the clock, the score, and the win-probability swing. `epa` per play is
the honest measure of whether a play mattered.

## 5. Build

Same shape as F1, and much simpler because the data is one source:

```bash
make fetch     # nflverse releases -> .cache/nflverse
make emit      # -> canonical JSON in site/data/
make build     # Astro + Pagefind
```

`fetch.py` is written and works. `emit.py` is not written yet.

## 6. Open decisions

1. **The shape of the schedule tree** (§4.1). The first real design question.
2. **How much of a game to encode.** F1 shipped 2 Hz binary position data
   because it had 22 cars moving continuously. A game is ~170 plays — small
   enough that plain JSON per game is almost certainly right, and the binary
   format would be over-engineering.
3. **Whether unplayed games get a page** at all, or only a row in the tree.
4. **Whether to widen scope** to past seasons once the season treatment works.
   nflverse has play-by-play to 1999, and unlike F1 the format is uniform.
