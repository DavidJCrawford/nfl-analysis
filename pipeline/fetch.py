"""Download what nflverse publishes, and cache it.

nflverse ships its datasets as GitHub release assets rather than through an API:
one release per dataset, one asset per season. They refresh nightly during the
season, so a cached file is a snapshot and not a final answer — re-run this
after a slate of games and the play-by-play will have grown.

    python3 pipeline/fetch.py [season]
"""
from __future__ import annotations

import pathlib
import sys
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
CACHE = ROOT / ".cache" / "nflverse"
BASE = "https://github.com/nflverse/nflverse-data/releases/download"

# Verified present and refreshing for 2026 on 2026-09-16. Parquet is a third the
# size of CSV but needs a reader; CSV keeps the pipeline dependency-free, which
# matters more here than the download does.
WANTED = [
    ("schedules", "games.csv", "games.csv"),
    ("teams", "teams_colors_logos.csv", "teams_colors_logos.csv"),
    ("pbp", "play_by_play_{season}.csv", "pbp_{season}.csv"),
    ("ftn_charting", "ftn_charting_{season}.csv", "ftn_charting_{season}.csv"),
]


def grab(release: str, asset: str, out: pathlib.Path) -> bool:
    url = f"{BASE}/{release}/{asset}"
    req = urllib.request.Request(url, headers={"User-Agent": "nfl-analysis/0.1 (personal project)"})
    try:
        with urllib.request.urlopen(req, timeout=300) as r:
            out.write_bytes(r.read())
    except Exception as e:
        print(f"  {asset}: {e}")
        return False
    print(f"  {asset} -> {out.name} ({out.stat().st_size / 1024 / 1024:.1f} MB)")
    return True


def logos() -> int:
    """The clubs' primary marks, one PNG each.

    nflverse's teams file gives a URL per team rather than the image, so these
    are pulled separately and cached like everything else — the site must build
    from the repository alone, and a page that reaches out to somebody else's
    CDN on every load is neither that nor polite.

    The marks themselves are trademarks of the clubs. nflverse's CC BY 4.0
    covers its data and cannot cover these; they are used here to identify which
    team is which, on a site that says on its face that it is unofficial. See
    the credits page."""
    import csv

    src = CACHE / "teams_colors_logos.csv"
    if not src.exists():
        print("  no teams file yet — skipping logos")
        return 0
    out = CACHE / "logos"
    out.mkdir(parents=True, exist_ok=True)

    got = 0
    with src.open(newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            abbr, url = row.get("team_abbr"), row.get("team_logo_espn")
            if not abbr or not url:
                continue
            dest = out / f"{abbr}.png"
            if dest.exists() and dest.stat().st_size > 0:
                got += 1
                continue
            req = urllib.request.Request(url, headers={"User-Agent": "nfl-analysis/0.1 (personal project)"})
            try:
                with urllib.request.urlopen(req, timeout=60) as r:
                    dest.write_bytes(r.read())
                got += 1
            except Exception as e:
                print(f"  {abbr}: {e}")
    print(f"  {got} club marks in {out.relative_to(ROOT)}")
    return got


def league_mark() -> int:
    """The league's own shield, from the same CDN the club marks come from.

    nflverse's teams file has no row for the league, so the address is written
    down here rather than read out of the data. It is the same 500px PNG in the
    same place as the thirty-two club marks beside it.

    It is a trademark of the National Football League and is used, like the club
    marks, on a site that says on its face that it is unofficial, unaffiliated
    and not endorsed. See the credits page."""
    dest = CACHE / "nfl.png"
    if dest.exists() and dest.stat().st_size > 0:
        print("  league mark already cached")
        return 1
    url = "https://a.espncdn.com/i/teamlogos/leagues/500/nfl.png"
    req = urllib.request.Request(url, headers={"User-Agent": "nfl-analysis/0.1 (personal project)"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            dest.write_bytes(r.read())
        print(f"  league mark in {dest.relative_to(ROOT)}")
        return 1
    except Exception as e:
        print(f"  league mark: {e}")
        return 0


def main() -> int:
    season = int(sys.argv[1]) if len(sys.argv) > 1 else 2026
    CACHE.mkdir(parents=True, exist_ok=True)
    print(f"nflverse, season {season}")
    ok = 0
    for release, asset, name in WANTED:
        ok += grab(release, asset.format(season=season), CACHE / name.format(season=season))
    print(f"{ok}/{len(WANTED)} downloaded to {CACHE.relative_to(ROOT)}")
    logos()
    league_mark()
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
