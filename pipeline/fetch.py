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
    # People. The roster is the register of who is on a club and what they are
    # — the only place with a birth date, a height, a college or a draft pick.
    # The stats files are nflverse's own aggregation of the play-by-play: the
    # site could sum them itself, but it would be summing to a different
    # definition than everyone else's, and a receiving yard should mean what it
    # means everywhere. `_week` is one row per player per game, `_reg` the
    # season to date.
    ("rosters", "roster_{season}.csv", "roster_{season}.csv"),
    ("stats_player", "stats_player_week_{season}.csv", "stats_player_week_{season}.csv"),
    ("stats_player", "stats_player_reg_{season}.csv", "stats_player_reg_{season}.csv"),
    ("stats_team", "stats_team_week_{season}.csv", "stats_team_week_{season}.csv"),
    ("stats_team", "stats_team_reg_{season}.csv", "stats_team_reg_{season}.csv"),
    # Who was actually on the field. The only source that counts the offensive
    # line, who take every snap and record almost no statistics.
    ("snap_counts", "snap_counts_{season}.csv", "snap_counts_{season}.csv"),
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


def headshots(season: int) -> int:
    """One portrait per player, at the size the site actually draws.

    The roster gives a URL per player. Those URLs are Cloudinary, and the
    published image is a 3400x2450 PNG of about 3.7 MB — 6 GB if all of them
    were taken as published, to draw something 40px across.

    Cloudinary reads its transformations out of the path, so the resizing is
    asked of the CDN rather than done here: `w_96,h_96,c_fill,g_face` crops to
    the face and returns 96x96, and `f_webp` returns it as WebP. That is about
    1.4 KB each, and it keeps this pipeline free of an image library — which is
    the same reason the club marks are left at their published size, except
    that thirty-two marks can afford it and seventeen hundred faces cannot.

    Skips anything already cached: a face does not change, and re-running this
    every week should cost one request per player who is new to a roster."""
    import concurrent.futures
    import csv

    src = CACHE / f"roster_{season}.csv"
    if not src.exists():
        print("  no roster yet — skipping headshots")
        return 0
    out = CACHE / "faces"
    out.mkdir(parents=True, exist_ok=True)

    want: dict[str, str] = {}
    with src.open(newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            pid, url = row.get("gsis_id"), row.get("headshot_url")
            if pid and url and url != "NA":
                want.setdefault(pid, url)

    # A Cloudinary URL is {host}/image/{delivery}/{transformations}/{asset}.
    # Published URLs already carry a transformation, so it is replaced rather
    # than inserted. The delivery type has to be read rather than assumed: 24
    # of these are served from /image/private/ instead of /image/upload/, and
    # matching only the latter left them untransformed — which is to say, left
    # them as 24 full-size PNGs totalling 95 MB.
    def sized(url: str) -> str:
        marker = "/image/"
        if marker not in url:
            return url
        head, rest = url.split(marker, 1)
        parts = rest.split("/")
        if len(parts) < 3:
            return url
        delivery, asset = parts[0], "/".join(parts[2:])
        return f"{head}{marker}{delivery}/f_webp,q_auto,w_96,h_96,c_fill,g_face/{asset}"

    todo = [(p, u) for p, u in want.items() if not (out / f"{p}.webp").exists()]
    if not todo:
        print(f"  {len(want)} faces already cached")
        return len(want)

    def one(item: tuple[str, str]) -> bool:
        pid, url = item
        req = urllib.request.Request(sized(url), headers={"User-Agent": "nfl-analysis/0.1 (personal project)"})
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                blob = r.read()
        except Exception:
            return False
        if not blob:
            return False
        (out / f"{pid}.webp").write_bytes(blob)
        return True

    got = 0
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        for ok in pool.map(one, todo):
            got += ok
    have = sum(1 for p in want if (out / f"{p}.webp").exists())
    size = sum(f.stat().st_size for f in out.glob("*.webp")) / 1024 / 1024
    print(f"  {got} new face(s), {have}/{len(want)} cached in {out.relative_to(ROOT)} ({size:.1f} MB)")
    return have


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
    headshots(season)
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
