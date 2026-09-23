"""The weekly refresh, as one command.

    python3 pipeline/update.py [season] [--strict] [--no-build]

A week of the season lands on the site in four steps that never vary: pull what
nflverse has published since last time, turn it into JSON, check that JSON
against the published results, and rebuild. This runs all four and then reports
what actually moved — which is the part worth reading, because the four steps
are the same every week and the answer is not.

Two things it deliberately does NOT do.

It does not edit any source file. It used to be that showing a new week meant
also bumping a count in site/src/pages/index.astro, which would have made this
script patch a page's frontmatter by regex — a thing that works until someone
reflows a comment. The page now reads how far to run off the data instead, so
the whole job is data in, pages out, and this script only ever writes to
site/data/.

It does not commit. What to say about a week is a judgement, and the one case
that always needs a human eye is the one this script exists to surface: a game
that was already published and has since been rewritten underneath us.

On that last point — nflverse refreshes nightly and revises retroactively. A
typical week does not only add the games just played; it also quietly corrects
games from a fortnight ago. Those corrections are almost always improvements
(a play description the league amended, a model rerun), but "almost always" is
not "always", and the difference between a correction and a regression is not
something a diff can tell you. So revisions are counted, attributed to a field,
and put under a banner. Use --strict to make them stop the run.
"""
from __future__ import annotations

import collections
import json
import pathlib
import subprocess
import sys
import time

ROOT = pathlib.Path(__file__).resolve().parent.parent
DATA = ROOT / "site" / "data"
PY = sys.executable or "python3"


# ---------------------------------------------------------------- running things

def run(label: str, args: list[str], cwd: pathlib.Path = ROOT) -> tuple[bool, str]:
    """Run a step, echoing it as it goes. Returns (ok, captured output)."""
    print(f"\n\033[1m{label}\033[0m")
    started = time.time()
    proc = subprocess.run(args, cwd=cwd, text=True, capture_output=True)
    out = (proc.stdout or "") + (proc.stderr or "")
    for line in out.rstrip().splitlines():
        print(f"  {line}")
    print(f"  \033[2m{time.time() - started:.1f}s\033[0m")
    return proc.returncode == 0, out


# ---------------------------------------------------------------- comparing data

def snapshot() -> dict[str, bytes]:
    """Every emitted file, as bytes, before we touch anything.

    Read from the working tree rather than from git, so this tells the truth
    when site/data has uncommitted edits in it."""
    if not DATA.exists():
        return {}
    return {
        str(p.relative_to(DATA)): p.read_bytes()
        for p in sorted(DATA.rglob("*.json"))
    }


def fields(old, new, at: str = "") -> collections.Counter:
    """Which fields changed, with list indices collapsed.

    `plays[7].desc` and `plays[8].desc` are the same finding twice, and a game
    is three thousand values deep — reported one path per value it would bury
    the one line that matters. They come back as `plays[].desc ×2`."""
    hits: collections.Counter = collections.Counter()
    if type(old) is not type(new):
        hits[at or "(root)"] += 1
    elif isinstance(old, dict):
        for k in set(old) | set(new):
            if k not in old or k not in new:
                hits[f"{at}.{k}".lstrip(".")] += 1
            else:
                hits += fields(old[k], new[k], f"{at}.{k}".lstrip("."))
    elif isinstance(old, list):
        if len(old) != len(new):
            hits[f"{at}[] length"] += 1
        for a, b in zip(old, new):
            hits += fields(a, b, f"{at}[]")
    elif old != new:
        hits[at or "(root)"] += 1
    return hits


def summarise(hits: collections.Counter, limit: int = 4) -> str:
    top = hits.most_common(limit)
    tail = len(hits) - len(top)
    s = ", ".join(f"{k} ×{n}" if n > 1 else k for k, n in top)
    return s + (f", +{tail} more" if tail > 0 else "")


# ---------------------------------------------------------------- reading state

def week_state() -> dict[int, dict]:
    """What each week looks like now: scheduled, played, and detailed."""
    sched = json.loads((DATA / "schedule.json").read_text(encoding="utf-8"))
    weeks: dict[int, dict] = {}
    for g in sched["games"]:
        w = weeks.setdefault(g["week"], {"games": 0, "played": 0, "detail": 0, "pending": []})
        w["games"] += 1
        if g["played"]:
            w["played"] += 1
            if g.get("detail"):
                w["detail"] += 1
            else:
                w["pending"].append(g["id"])
    return weeks


# ---------------------------------------------------------------- the report

def report(before: dict[str, bytes], strict: bool) -> bool:
    """What moved. Returns False if something wants a human before it ships."""
    after = snapshot()
    added = sorted(set(after) - set(before))
    gone = sorted(set(before) - set(after))
    revised = sorted(k for k in set(before) & set(after) if before[k] != after[k])

    print("\n\033[1mWhat changed\033[0m")
    weeks = week_state()
    for w in sorted(weeks):
        s = weeks[w]
        if not s["played"]:
            continue
        note = f"  week {w:>2}: {s['detail']}/{s['games']} games with play-by-play"
        if s["pending"]:
            note += f"  \033[33m— {len(s['pending'])} final without plays yet\033[0m"
        print(note)

    new_games = [a for a in added if a.startswith("games/")]
    if new_games:
        by_week = collections.Counter(g.split("/")[1].split("_")[1] for g in new_games)
        print(f"  {len(new_games)} game(s) newly written: " +
              ", ".join(f"week {int(w)} ×{n}" for w, n in sorted(by_week.items())))
    for g in gone:
        if not g.startswith("players/"):
            print(f"  \033[33mremoved: {g}\033[0m")

    # Roster churn, which is its own weekly event and nothing to do with the
    # games. Reported by name, because "17 players left" is not something
    # anybody can act on and "A.J. Brown is on injured reserve" is.
    joined = [a for a in added if a.startswith("players/")]
    left = [g for g in gone if g.startswith("players/")]
    if joined or left:
        print(f"\n  squads: {len(joined)} in, {len(left)} out")
        names = {}
        if (DATA / "players.json").exists():
            names = json.loads((DATA / "players.json").read_text("utf-8"))["players"]
        for f in joined[:8]:
            pid = pathlib.Path(f).stem
            p = names.get(pid)
            print(f"    + {p['name']} ({p['team']}, {p['pos']})" if p else f"    + {pid}")
        if len(joined) > 8:
            print(f"    … and {len(joined) - 8} more")
        for f in left[:8]:
            old_row = json.loads(before[f])
            print(f"    - {old_row.get('name', pathlib.Path(f).stem)} ({old_row.get('team')})")
        if len(left) > 8:
            print(f"    … and {len(left) - 8} more")

    faces = ROOT / "site" / "public" / "faces"
    if faces.exists():
        print(f"  {len(list(faces.glob('*.webp')))} portraits on the site")

    # Anything that was already on the site and is not what it was.
    # Only games. A player file changing is what a week of football looks
    # like; a published game changing is not.
    republished = [r for r in revised if r.startswith("games/")]
    if republished:
        print(f"\n\033[1;33m⚠ {len(republished)} already-published game(s) revised by nflverse\033[0m")
        print("  \033[2mThese were live on the site and have been rewritten. Read them before pushing.\033[0m")
        for r in republished:
            old = json.loads(before[r]); new = json.loads(after[r])
            print(f"    {pathlib.Path(r).stem}: {summarise(fields(old, new))}")

    if "schedule.json" in revised:
        old = json.loads(before["schedule.json"]); new = json.loads(after["schedule.json"])
        moved = {k: (old.get(k), new.get(k)) for k in ("through", "counts")
                 if old.get(k) != new.get(k)}
        for k, (a, b) in moved.items():
            print(f"\n  schedule {k}: {a} → {b}")

    if not (added or gone or revised):
        print("  nothing — nflverse has published nothing new since last time")

    return not (republished and strict)


def main() -> int:
    args = sys.argv[1:]
    strict = "--strict" in args
    build = "--no-build" not in args
    season = next((a for a in args if a.isdigit()), None)

    before = snapshot()

    ok, _ = run("Fetching from nflverse", [PY, "pipeline/fetch.py"] + ([season] if season else []))
    if not ok:
        print("\n\033[31mfetch failed — nothing has been changed\033[0m")
        return 1

    ok, _ = run("Emitting JSON", [PY, "pipeline/emit.py"] + ([season] if season else []))
    if not ok:
        return 1

    ok, _ = run("Verifying against published results", [PY, "pipeline/verify.py"])
    if not ok:
        print("\n\033[31mverify failed — site/data is written but wrong. Do not push.\033[0m")
        return 1

    if build:
        ok, _ = run("Building the site", ["npm", "run", "build"], cwd=ROOT / "site")
        if not ok:
            return 1
        ok, _ = run("Checking links", [PY, "pipeline/check_site.py"])
        if not ok:
            return 1

    clean = report(before, strict)

    print("\n\033[1mNext\033[0m")
    print("  git diff --stat        see it as files")
    print("  git add -A && git commit")
    if not build:
        print("  \033[2m(built nothing — run `make build` before you push)\033[0m")
    if not clean:
        print("\n\033[31m--strict: stopping because published games were revised\033[0m")
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
