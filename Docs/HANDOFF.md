# HANDOFF — NFL Analysis

Written 2026-09-16, at the end of the session that built
[F1 Analysis](https://github.com/DavidJCrawford/f1-analysis), for whoever picks
this up next. Read [SPEC.md](SPEC.md) first; this says what is done, what is
verified, and what will bite you.

---

## 1. What exists

Scaffolding and a verified data path. No feature is built.

```
Makefile                    fetch / emit / build / preview / check
pipeline/fetch.py           works — pulls schedule + play-by-play from nflverse
.cache/nflverse/            8 MB already downloaded
site/                       Astro 7, builds clean, one placeholder page
  src/styles/               the F1 design system, copied unchanged
  src/lib/url.ts format.ts  copied unchanged
  src/components/Stat.astro copied unchanged
  src/layouts/Base.astro    adapted — two nav entries, Games and Teams
.github/workflows/deploy.yml  copied; pushing main deploys to Pages
```

`make fetch && cd site && npm run build` works today.

**Not done:** `pipeline/emit.py`, every page, the schedule tree, the replay, the
credits page, `scope.ts`, and the git remote.

## 2. What is verified, so you need not re-check it

Measured against the live sources on 2026-09-16:

- nflverse publishes as **GitHub release assets**, not an API. Release tag +
  asset name, e.g. `.../releases/download/pbp/play_by_play_2026.csv`.
- **2026 is live and refreshing nightly.** Play-by-play was updated the day
  before this was written; the schedule the same day.
- **272 games, 18 weeks, 16 played.** The season is one week old.
- **Play-by-play has 372 fields**, including `yardline_100`, `yards_gained`,
  `down`, `ydstogo`, `qtr`, `time`, `drive`, `series`, `play_type`, `desc`,
  `epa`, `wp`. All 29 fields a replay plausibly needs are present.
- **`nflverse-data` is CC BY 4.0.** Attribution is a condition.
- **There is no public player tracking for 2026** — see SPEC §3.1. This is the
  hard ceiling on the replay and should shape it from the start rather than be
  discovered halfway.

## 3. What to do first

In this order, because each answers a question the next one needs:

1. **`pipeline/emit.py`** — schedule and per-game play-by-play into
   `site/data/`. Canonical serialisation: sorted keys, tight separators, so an
   unchanged rebuild is byte-identical and git shows no diff. Copy F1's
   `f1db_emit.py` shape.
2. **The schedule tree** (SPEC §4.1). Design it properly and show the user
   options — they asked for a tree but the season is 95% unplayed, and that
   constraint should drive the shape rather than be papered over.
3. **A game page**, static first: drives, scoring, box score. Prove the data
   reads well before animating it.
4. **The replay.** Field, ball, chains, clock. Lift the shell of F1's
   `RaceReplay.astro` — overlay, transport controls, strip, camera — and
   replace the circuit with a field.

## 4. Lessons from F1 that apply here

These were expensive. They are not general advice; each one cost a rebuild.

**Verify what the data holds before designing around it.** Most of the F1
rebuilds traced to assuming a feed held something it did not. Here: there is no
tracking data. Design the replay for what play-by-play gives.

**Never draw across a gap.** F1 interpolated between two position samples fifty
minutes apart and drew a plausible-looking picture of nothing that happened. If
a game's play-by-play has a hole, show the hole.

**Find something the output can be checked against, and check it every build.**
F1's `verify_replay.py` scored each replay against the starting grid, the
classified result and the lap count — facts it could not have produced itself —
and found most of the real bugs. The NFL equivalent is sitting there: **the
final score, and the drive summaries.** A replay that does not end on the right
score is wrong, and that check costs nothing.

**A cached download is a snapshot, not a final answer.** nflverse refreshes
nightly. A game fetched an hour after it ends may be corrected later. Re-fetch
before concluding data is missing.

**When something does not add up, search for what actually happened.** A race
that looked anomalous in the data was assumed anomalous; it took a web search to
find the real story, and the real story showed the bug was ours. The NFL
equivalent: a game with a strange play sequence probably had a real event —
a weather delay, an overturned call — and the report will say so.

**Say what is missing, on the page.** Every absence on the F1 site is
deliberate and most began as a bug that drew something plausible instead.

**Check the trivial things too.** JSX collapses whitespace around expressions
and silently joins words (`the37 circuits`); `<hr>` is `overflow: hidden` in the
browser's own stylesheet; an SVG drawn in a sub-unit coordinate space rasterises
badly under partial repaint. All three shipped before being caught.

## 5. Conventions worth keeping

- **Design tokens are already there** and unchanged from F1. Dark instrument
  panels on a light page; no theme switch.
- **Comments say why, not what.** The F1 codebase is commented at the level of
  "this is here because the obvious thing was wrong, and here is how" — that is
  what made this handoff writable.
- **Pushing `main` deploys.** The workflow ignores `Docs/**` and `*.md`, so
  documentation commits do not rebuild the site.
- **Commit data with the code.** The emitted JSON is committed, as in F1.
