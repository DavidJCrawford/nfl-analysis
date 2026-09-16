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


def main() -> int:
    season = int(sys.argv[1]) if len(sys.argv) > 1 else 2026
    CACHE.mkdir(parents=True, exist_ok=True)
    print(f"nflverse, season {season}")
    ok = 0
    for release, asset, name in WANTED:
        ok += grab(release, asset.format(season=season), CACHE / name.format(season=season))
    print(f"{ok}/{len(WANTED)} downloaded to {CACHE.relative_to(ROOT)}")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
