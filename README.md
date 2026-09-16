# NFL Analysis

The 2026 NFL season: the whole schedule as one picture, and every game that has
been played replayed down the field, play by play.

Sibling to [F1 Analysis](https://github.com/DavidJCrawford/f1-analysis), whose
design system and build shape it inherits.

**Status: scaffolded, nothing built yet.** Start with
[`Docs/HANDOFF.md`](Docs/HANDOFF.md).

```bash
make fetch     # schedule + play-by-play from nflverse
make emit      # -> canonical JSON  (not written yet)
make build     # Astro + Pagefind
```

## Data

Everything from [nflverse](https://github.com/nflverse/nflverse-data), CC BY 4.0,
refreshed nightly during the season. 272 games, 18 weeks, **372 fields per play**
— field position, down, distance, yards gained, clock, drive, EPA, win
probability.

There is no public player tracking for the current season, so the replay shows
the ball, the chains and the drive rather than 22 moving players. See
[SPEC §3.1](Docs/SPEC.md).

---

<sub>Unofficial and unaffiliated. Not associated with the NFL or any club.</sub>
