# NFL Analysis

The 2026 NFL season: every game as a card, week by week, and every game that has
been played replayed down the field, play by play.

Sibling to [F1 Analysis](https://github.com/DavidJCrawford/f1-analysis), whose
design system and build shape it inherits.

**Status: built and working.** The schedule, every game page, the replay, and a
page for every player and club are in. Start with
[`Docs/HANDOFF.md`](Docs/HANDOFF.md).

```bash
make week      # the weekly refresh: fetch + emit + verify + build, and a report
make data      # fetch + emit + verify
make build     # Astro + Pagefind, then check every internal link
make preview
```

`make week` is the whole in-season routine. Nothing in the site is hand-held to
a particular week — the front page runs to whichever week is being played, read
off the data — so a week of results lands without any source file being edited.
It ends by reporting what moved, including any **already-published game that
nflverse has since rewritten**, which is the one part of the job that wants a
human eye. `--strict` makes those stop the run rather than just report.

| | |
| --- | --- |
| `/` | a card per game, a block per week, newest first, over the top of every division |
| `/games/2026/1/NE-SEA/` | one game: the replay, every play, the totals |
| `/teams/` · `/teams/SEA/` | 32 clubs; one club's season, squad and totals for and against |
| `/players/` · `/players/00-0033873/` | the league's leaders and every name; one player's life, season and games |
| `/credits/` | sources and terms |

There is no `/games/` index: the front page is that list. A game page lives at a
permanent URL from the moment the schedule does — a fixture before kickoff, the
report afterwards, same address.

Two checks run on every build and both fail it. `pipeline/verify.py` re-reads the
emitted JSON and tests it against things it did not produce — the published final
scores, the league's own drive summaries, the point values football allows, and
whether the ball ever teleports. `pipeline/check_site.py` follows every internal
link in the built site — 38,663 of them across 2,051 pages.

## Data

Everything from [nflverse](https://github.com/nflverse/nflverse-data), CC BY 4.0,
refreshed nightly during the season. Nine datasets: 272 games, 18 weeks,
**372 fields per play** — field position, down, distance, yards gained, clock,
drive, EPA, win probability — plus rosters, player and club statistics by week
and by season, and snap counts. The site draws the first several; it shows EPA
against each play in the log and deliberately shows no win probability at all.

Player numbers are nflverse's own totals, not sums worked out here. They could
have been derived from the plays, but a receiving yard would then mean whatever
this pipeline decided it meant. What the pipeline does instead is check the two
against each other, club by club and game by game — which is how it found that
it had been counting every sack as a pass attempt.

There is no public player tracking for the current season, so the replay shows
the ball, the chains and the drive rather than 22 moving players. See
[SPEC §3.1](Docs/SPEC.md).

---

<sub>Unofficial and unaffiliated. Not associated with the NFL or any club.</sub>
