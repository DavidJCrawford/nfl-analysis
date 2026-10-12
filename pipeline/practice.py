"""The numbers behind the practice game.

    python3 pipeline/practice.py            # both, if the research cache exists
    python3 pipeline/practice.py teams      # the clubs only — what `make week` runs
    python3 pipeline/practice.py league     # the league tables only

Two outputs, for two different questions.

    site/public/data/practice/league.json   how football plays, on average
    site/public/data/practice/<ABBR>.json   how one club plays, and who for it

THE LEAGUE TABLES are measured from the 2025 regular season, because 2025 has
something 2026 does not yet: nflverse's participation file, which says for
every passing play what coverage the defence was in, man or zone, and which
route the targeted receiver ran — along with the time to throw, whether the
quarterback was pressured, how many rushed and how many stood in the box.
Joined to the play-by-play and to FTN's charting, that is the empirical
ground the simulation stands on: what a slant does against Cover 1, how often
five rushers get home, what a run gains into an eight-man box. Nothing in
these tables is a guess about football; every one is a count. The research
files are large and the season is closed, so they live in .cache/research/
and this half runs only when asked — `make research`.

THE CLUB FILES are 2026, rebuilt every week. A starting lineup read off the
snap counts rather than a depth chart — who actually played, most recently —
and the club's rates against the 2026 league: how it passes, runs, protects,
rushes and covers. Four weeks is not much football, so every rate is shrunk
toward the league's in proportion to how little of it there is. A quarterback
with forty attempts is mostly the league's average quarterback; one with a
hundred and forty is mostly himself.
"""
from __future__ import annotations

import collections
import csv
import json
import math
import pathlib
import statistics as st
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
CACHE = ROOT / ".cache" / "nflverse"
RESEARCH = ROOT / ".cache" / "research"
OUT = ROOT / "site" / "public" / "data" / "practice"
csv.field_size_limit(10 ** 8)

sys.path.insert(0, str(ROOT / "pipeline"))
from emit import write_json, snap_index  # noqa: E402

MISSING = {"", "NA", "NaN", "None"}


def num(v):
    if v in MISSING or v is None:
        return None
    try:
        return float(v)
    except ValueError:
        return None


def flag(r, k):
    return r.get(k) == "1"


def quantiles(xs: list[float], k: int = 20) -> list[float]:
    """k+1 evenly spaced points of a distribution, for drawing from it by
    inverse CDF in the browser. Rounded to a tenth of a yard: finer than that
    is noise at this sample size, and it keeps the file small.

    The two end points are not the minimum and maximum but the mean of the
    outermost k-th at each end. The browser draws those bins as an
    exponential tail with that mean (site/src/lib/practice/engine.ts
    `sampleQ`): a season's single longest run says almost nothing about how
    long the long runs are, and the mean of the top twentieth says exactly
    what the average needs."""
    xs = sorted(xs)
    if not xs:
        return []
    out = []
    for i in range(k + 1):
        pos = i / k * (len(xs) - 1)
        lo, hi = int(math.floor(pos)), int(math.ceil(pos))
        out.append(round(xs[lo] + (xs[hi] - xs[lo]) * (pos - lo), 1))
    if len(xs) >= 2 * k:
        m = len(xs) / k
        out[0] = round(st.mean(xs[: max(1, int(m))]), 1)
        out[k] = round(st.mean(xs[-max(1, int(m)):]), 1)
    return out


def shrink(hits: float, n: float, prior: float, k: float) -> float:
    """A rate pulled toward a prior by k pseudo-observations. The standard
    empirical-Bayes move: with no data it is the prior, with a great deal it
    is the data, and in between it is honest about which it mostly is."""
    return (hits + k * prior) / (n + k) if (n + k) else prior


def r3(x):
    return None if x is None else round(x, 3)


# ── Situations ───────────────────────────────────────────────────────────────

def dist_bucket(togo: float) -> str:
    return "short" if togo <= 3 else "med" if togo <= 7 else "long"


def situation(r) -> str:
    """The key a defence's and an offence's tendencies are filed under: the
    down (fourth folded into third, since the same calls are made), the
    distance in three bands, and whether the field has shortened to the red
    zone, where both sides change what they do."""
    d = int(num(r["down"]) or 1)
    d = 3 if d >= 3 else d
    t = num(r["ydstogo"]) or 10
    y = num(r["yardline_100"]) or 50
    return f"{d}-{dist_bucket(t)}" + ("-rz" if y <= 20 else "")


# The coverages the engine knows. Cover 9 — a pattern-matched quarters
# variant — is 2.5% of snaps and plays like Cover 4 in this data, so it is
# folded in rather than given a cell too thin to trust.
COVERAGES = ["COVER_0", "COVER_1", "2_MAN", "COVER_2", "COVER_3", "COVER_4", "COVER_6"]
FOLD = {"COVER_9": "COVER_4"}
ROUTES = ["QUICK OUT", "HITCH/CURL", "SCREEN", "IN/DIG", "GO", "DEEP OUT", "SHALLOW CROSS/DRAG",
          "SLANT", "POST", "SWING", "CORNER", "WHEEL", "TEXAS/ANGLE"]
GAPS = ["left end", "left tackle", "left guard", "middle", "right guard", "right tackle", "right end"]


def gap_of(r) -> str | None:
    loc, gap = r.get("run_location"), r.get("run_gap")
    if loc == "middle":
        return "middle"
    if loc in ("left", "right") and gap in ("end", "tackle", "guard"):
        return f"{loc} {gap}"
    return None


# ── The league, from 2025 ────────────────────────────────────────────────────

def load_2025() -> list[dict]:
    pbp_path = RESEARCH / "play_by_play_2025.csv"
    part_path = RESEARCH / "pbp_participation_2025.csv"
    ftn_path = RESEARCH / "ftn_charting_2025.csv"
    for p in (pbp_path, part_path, ftn_path):
        if not p.exists():
            sys.exit(f"missing {p.relative_to(ROOT)} — run `make research` first")
    part = {(r["nflverse_game_id"], r["play_id"]): r for r in csv.DictReader(part_path.open(newline="", encoding="utf-8"))}
    ftn = {(r["nflverse_game_id"], r["nflverse_play_id"]): r for r in csv.DictReader(ftn_path.open(newline="", encoding="utf-8"))}
    keep = ("game_id", "play_id", "posteam", "play_type", "down", "ydstogo", "yardline_100", "qtr",
            "game_seconds_remaining", "score_differential", "pass_attempt", "complete_pass", "interception",
            "sack", "qb_scramble", "qb_dropback", "air_yards", "yards_after_catch", "yards_gained", "epa",
            "pass_touchdown", "run_location", "run_gap", "fumble_lost", "kick_distance", "field_goal_result",
            "extra_point_result", "punt_blocked", "return_yards", "touchback")
    rows = []
    for full in csv.DictReader(pbp_path.open(newline="", encoding="utf-8")):
        if full["season_type"] != "REG" or flag(full, "two_point_attempt"):
            continue
        r = {k: full[k] for k in keep}
        k = (r["game_id"], r["play_id"])
        pa, f = part.get(k, {}), ftn.get(k, {})
        r["_cov"] = FOLD.get(pa.get("defense_coverage_type"), pa.get("defense_coverage_type"))
        r["_mz"] = pa.get("defense_man_zone_type")
        r["_route"] = pa.get("route")
        r["_rush"] = num(pa.get("number_of_pass_rushers"))
        r["_box"] = num(pa.get("defenders_in_box"))
        r["_press"] = pa.get("was_pressure")
        r["_ttt"] = num(pa.get("time_to_throw"))
        r["_form"] = pa.get("offense_formation")
        r["_pers"] = pa.get("offense_personnel")
        # FTN writes its flags as TRUE and FALSE, not 1 and 0 as nflverse does.
        r["_pa"] = f.get("is_play_action") == "TRUE"
        r["_screen"] = f.get("is_screen_pass") == "TRUE"
        r["_away"] = f.get("is_throw_away") == "TRUE"
        r["_blitzers"] = num(f.get("n_blitzers"))
        # FTN's charting of the ball itself: could it be caught, was it
        # contested, was it dropped, should it have been picked, and which
        # read in the progression it went to.
        r["_charted"] = bool(f)
        r["_catchable"] = f.get("is_catchable_ball") == "TRUE"
        r["_contested"] = f.get("is_contested_ball") == "TRUE"
        r["_drop"] = f.get("is_drop") == "TRUE"
        r["_read"] = f.get("read_thrown") or ""
        rows.append(r)
    return rows


def wr_count(pers: str | None) -> int | None:
    if not pers:
        return None
    for part in pers.split(","):
        part = part.strip()
        if part.endswith(" WR"):
            return int(part.split()[0])
    return 0


def league(rows: list[dict]) -> dict:
    out: dict = {"season": 2025, "plays": len(rows)}

    # ── Passing: what a route does when it is thrown to.
    targets = [r for r in rows if flag(r, "pass_attempt") and not flag(r, "sack") and r["_route"] in ROUTES]
    all_t = len(targets)
    route_tab = {}
    for rt in ROUTES:
        rs = [r for r in targets if r["_route"] == rt]
        n = len(rs)
        cmp_n = sum(flag(r, "complete_pass") for r in rs)
        ints = sum(flag(r, "interception") for r in rs)
        tds = sum(flag(r, "pass_touchdown") for r in rs)
        air = [num(r["air_yards"]) for r in rs if num(r["air_yards"]) is not None]
        yac = [num(r["yards_after_catch"]) or 0 for r in rs if flag(r, "complete_pass")]
        ttt = [r["_ttt"] for r in rs if r["_ttt"]]
        q = st.quantiles(ttt, n=4) if len(ttt) > 3 else [2.0, 2.5, 3.0]
        route_tab[rt] = {
            "n": n, "share": r3(n / all_t), "cmp": r3(cmp_n / n), "int": r3(ints / n), "td": r3(tds / n),
            "air": quantiles(air), "yac": quantiles(yac), "ttt": [round(q[0], 2), round(q[1], 2), round(q[2], 2)],
            "epa": r3(sum(num(r["epa"]) or 0 for r in rs) / n),
        }
    # Each route against each coverage, pulled toward the route's own rate by
    # sixty pseudo-targets — a cell needs sixty of its own before it outvotes
    # the route as a whole, and some (a wheel against Cover 6) have twelve.
    K = 60
    vs = {}
    for rt in ROUTES:
        base = route_tab[rt]
        base_yac = st.mean([num(r["yards_after_catch"]) or 0 for r in targets
                            if r["_route"] == rt and flag(r, "complete_pass")] or [0]) or 1
        vs[rt] = {}
        for cov in COVERAGES:
            rs = [r for r in targets if r["_route"] == rt and r["_cov"] == cov]
            n = len(rs)
            yac_c = [num(r["yards_after_catch"]) or 0 for r in rs if flag(r, "complete_pass")]
            yac_f = (sum(yac_c) + K * base_yac) / (len(yac_c) + K) / base_yac if base_yac else 1
            vs[rt][cov] = {
                "n": n,
                "cmp": r3(shrink(sum(flag(r, "complete_pass") for r in rs), n, base["cmp"], K)),
                "int": r3(shrink(sum(flag(r, "interception") for r in rs), n, base["int"], K)),
                "yac": r3(yac_f),
                "epa": r3(shrink(sum(num(r["epa"]) or 0 for r in rs), n, base["epa"], K)),
            }
    out["routes"] = route_tab
    out["vs"] = vs

    # ── The rush and the clock it puts on the quarterback.
    drop = [r for r in rows if flag(r, "qb_dropback") and r["_rush"] is not None]
    press: dict = {"byRushers": {}}
    for n in range(3, 8):
        rs = [r for r in drop if (min(r["_rush"], 7) if r["_rush"] >= 3 else 3) == n]
        press["byRushers"][str(n)] = {
            "n": len(rs), "pressure": r3(sum(r["_press"] == "TRUE" for r in rs) / max(1, len(rs))),
            "sack": r3(sum(flag(r, "sack") for r in rs) / max(1, len(rs))),
        }
    pr = [r for r in drop if r["_press"] == "TRUE"]
    cl = [r for r in drop if r["_press"] == "FALSE"]
    throws = lambda rs: [r for r in rs if flag(r, "pass_attempt") and not flag(r, "sack")]
    press["sackGivenPressure"] = r3(sum(flag(r, "sack") for r in pr) / len(pr))
    press["scrambleGivenPressure"] = r3(sum(flag(r, "qb_scramble") for r in pr) / len(pr))
    press["scrambleClean"] = r3(sum(flag(r, "qb_scramble") for r in cl) / len(cl))
    press["cmpPressured"] = r3(sum(flag(r, "complete_pass") for r in throws(pr)) / len(throws(pr)))
    press["cmpClean"] = r3(sum(flag(r, "complete_pass") for r in throws(cl)) / len(throws(cl)))
    press["intPressured"] = r3(sum(flag(r, "interception") for r in throws(pr)) / len(throws(pr)))
    press["intClean"] = r3(sum(flag(r, "interception") for r in throws(cl)) / len(throws(cl)))
    press["awayPressured"] = r3(sum(r["_away"] for r in throws(pr)) / len(throws(pr)))
    press["awayClean"] = r3(sum(r["_away"] for r in throws(cl)) / len(throws(cl)))
    press["sackYards"] = quantiles([-(num(r["yards_gained"]) or 0) for r in drop if flag(r, "sack")])
    press["scrambleYards"] = quantiles([num(r["yards_gained"]) or 0 for r in drop if flag(r, "qb_scramble")])
    press["ttt"] = quantiles([r["_ttt"] for r in drop if r["_ttt"]], 10)
    out["pressure"] = press

    # Play action, measured against straight dropbacks on early downs, where
    # both are called.
    early = [r for r in rows if flag(r, "pass_attempt") and not flag(r, "sack") and int(num(r["down"]) or 1) <= 2]
    pa = [r for r in early if r["_pa"]]
    npa = [r for r in early if not r["_pa"]]
    ypa = lambda rs: sum(num(r["yards_gained"]) or 0 for r in rs) / max(1, len(rs))
    adot = lambda rs: st.mean([num(r["air_yards"]) for r in rs if num(r["air_yards"]) is not None] or [0])
    out["playAction"] = {"n": len(pa), "ypa": r3(ypa(pa)), "ypaWithout": r3(ypa(npa)),
                         "adot": r3(adot(pa)), "adotWithout": r3(adot(npa)),
                         "cmp": r3(sum(flag(r, "complete_pass") for r in pa) / len(pa)),
                         "cmpWithout": r3(sum(flag(r, "complete_pass") for r in npa) / len(npa))}

    # ── What a defence calls, and how many it sends.
    cov_rows = [r for r in rows if flag(r, "qb_dropback") and r["_cov"] in COVERAGES]
    by_sit = collections.defaultdict(list)
    for r in cov_rows:
        by_sit[situation(r)].append(r)
    cover: dict = {}
    overall = collections.Counter(r["_cov"] for r in cov_rows)
    for key in sorted(by_sit):
        rs = by_sit[key]
        c = collections.Counter(r["_cov"] for r in rs)
        k = 80     # thin situations lean on the league's overall mix
        mix = {cv: r3((c[cv] + k * overall[cv] / len(cov_rows)) / (len(rs) + k)) for cv in COVERAGES}
        rush = collections.Counter(min(7, max(3, int(r["_rush"]))) for r in rs if r["_rush"] is not None)
        nr = sum(rush.values()) or 1
        cover[key] = {"n": len(rs), "mix": mix, "rushers": {str(n): r3(rush[n] / nr) for n in range(3, 8)}}
    out["cover"] = cover
    # How many each coverage tends to send — Cover 0 is a blitz by definition.
    out["coverRush"] = {}
    for cv in COVERAGES:
        rs = [r for r in cov_rows if r["_cov"] == cv and r["_rush"] is not None]
        rush = collections.Counter(min(7, max(3, int(r["_rush"]))) for r in rs)
        out["coverRush"][cv] = {str(n): r3(rush[n] / len(rs)) for n in range(3, 8)}

    # ── The running game.
    runs = [r for r in rows if r["play_type"] == "run" and not flag(r, "qb_scramble") and gap_of(r)]
    allyds = [num(r["yards_gained"]) or 0 for r in runs]
    mean_all = st.mean(allyds)
    run_tab = {"n": len(runs), "mean": r3(mean_all), "gaps": {}, "box": {},
               "fumbleLost": r3(sum(flag(r, "fumble_lost") for r in runs) / len(runs))}
    for g in GAPS:
        ys = [num(r["yards_gained"]) or 0 for r in runs if gap_of(r) == g]
        run_tab["gaps"][g] = {"n": len(ys), "share": r3(len(ys) / len(runs)), "yards": quantiles(ys)}
    for b in range(4, 10):
        ys = [num(r["yards_gained"]) or 0 for r in runs if r["_box"] is not None and min(9, max(4, int(r["_box"]))) == b]
        if len(ys) > 50:
            run_tab["box"][str(b)] = {"n": len(ys), "shift": r3(st.mean(ys) - mean_all)}
    # Who a defence puts in the box against how many receivers.
    run_tab["boxByWR"] = {}
    for w in (1, 2, 3, 4):
        bs = [int(r["_box"]) for r in rows if r["_box"] is not None and wr_count(r["_pers"]) == w and r["play_type"] in ("run", "pass")]
        if bs:
            c = collections.Counter(min(9, max(4, b)) for b in bs)
            run_tab["boxByWR"][str(w)] = {str(b): r3(c[b] / len(bs)) for b in range(4, 10)}
    out["run"] = run_tab

    # ── What an offence calls.
    scrim = [r for r in rows if r["play_type"] in ("run", "pass") and int(num(r["down"]) or 0) in (1, 2, 3, 4)]
    calls = collections.defaultdict(list)
    for r in scrim:
        calls[situation(r)].append(r)
    out["calls"] = {}
    for key, rs in sorted(calls.items()):
        passes = [r for r in rs if flag(r, "qb_dropback")]
        thrown = [r for r in passes if r["_route"] in ROUTES]
        rmix = collections.Counter(r["_route"] for r in thrown)
        out["calls"][key] = {
            "n": len(rs), "pass": r3(len(passes) / len(rs)),
            "routes": {rt: r3((rmix[rt] + 20 * route_tab[rt]["share"]) / (len(thrown) + 20)) for rt in ROUTES},
            "shotgun": r3(sum(r["_form"] in ("SHOTGUN", "PISTOL") for r in rs if r["_form"]) /
                          max(1, sum(1 for r in rs if r["_form"]))),
        }
    # How the score and the clock bend that: passing more when behind late.
    late = [r for r in scrim if int(num(r["qtr"]) or 1) == 4 and (num(r["game_seconds_remaining"]) or 0) < 600]
    def prate(rs):
        return r3(sum(flag(r, "qb_dropback") for r in rs) / max(1, len(rs)))
    out["callsLate"] = {
        "trailing": prate([r for r in late if (num(r["score_differential"]) or 0) <= -4]),
        "leading": prate([r for r in late if (num(r["score_differential"]) or 0) >= 4]),
        "close": prate([r for r in late if abs(num(r["score_differential"]) or 0) < 4]),
        "all": prate(scrim),
    }

    # ── Kicking.
    fg = [r for r in rows if r["play_type"] == "field_goal" and num(r["kick_distance"])]
    bins = [(0, 29), (30, 39), (40, 49), (50, 54), (55, 59), (60, 70)]
    out["fg"] = []
    for lo, hi in bins:
        rs = [r for r in fg if lo <= num(r["kick_distance"]) <= hi]
        if rs:
            out["fg"].append({"lo": lo, "hi": hi, "n": len(rs), "make": r3(sum(r["field_goal_result"] == "made" for r in rs) / len(rs))})
    xp = [r for r in rows if r["play_type"] == "extra_point"]
    out["xp"] = r3(sum(r.get("extra_point_result") == "good" for r in xp) / max(1, len(xp)))
    punts = [r for r in rows if r["play_type"] == "punt" and not flag(r, "punt_blocked")]
    out["punt"] = {}
    for name, lo, hi in (("deep", 70, 99), ("mid", 50, 69), ("plus", 1, 49)):
        rs = [r for r in punts if lo <= (num(r["yardline_100"]) or 0) <= hi]
        net = [(num(r["kick_distance"]) or 0) - (num(r["return_yards"]) or 0) - (20 if flag(r, "touchback") else 0) for r in rs]
        out["punt"][name] = {"n": len(rs), "net": quantiles(net, 10), "touchback": r3(sum(flag(r, "touchback") for r in rs) / max(1, len(rs)))}
    # Fourth down: how often a team goes for it, by distance and field.
    fourth = [r for r in rows if int(num(r["down"]) or 0) == 4 and r["play_type"] in ("run", "pass", "punt", "field_goal")]
    out["fourth"] = {}
    for dist in ("short", "med", "long"):
        for zone, lo, hi in (("own", 51, 99), ("mid", 35, 50), ("fg", 1, 34)):
            rs = [r for r in fourth if dist_bucket(num(r["ydstogo"]) or 10) == dist and lo <= (num(r["yardline_100"]) or 50) <= hi]
            if rs:
                out["fourth"][f"{dist}-{zone}"] = {"n": len(rs), "go": r3(sum(r["play_type"] in ("run", "pass") for r in rs) / len(rs))}

    # ── The clock: seconds a play takes off it, by what happened.
    ordered = sorted(rows, key=lambda r: (r["game_id"], -(num(r["game_seconds_remaining"]) or 0)))
    used = collections.defaultdict(list)
    for a, b in zip(ordered, ordered[1:]):
        if a["game_id"] != b["game_id"] or a["qtr"] != b["qtr"]:
            continue
        dt = (num(a["game_seconds_remaining"]) or 0) - (num(b["game_seconds_remaining"]) or 0)
        if dt <= 0 or dt > 60 or (num(a["game_seconds_remaining"]) or 0) % 900 < 120:
            continue
        if a["play_type"] == "run":
            kind = "run"
        elif flag(a, "sack"):
            kind = "sack"
        elif flag(a, "qb_scramble"):
            kind = "scramble"
        elif flag(a, "complete_pass"):
            kind = "complete"
        elif flag(a, "pass_attempt"):
            kind = "incomplete"
        else:
            continue
        used[kind].append(dt)
    out["clock"] = {k: round(st.median(v), 1) for k, v in used.items()}

    # ── The catch, as FTN charts it: what the step-3 catch model is fitted to
    # (Docs/PRACTICE-MOTION.md §9). Attempts only — no throwaways, no spikes.
    att = [r for r in rows if flag(r, "pass_attempt") and not flag(r, "sack") and r["_charted"] and not r["_away"]
           and num(r["air_yards"]) is not None]
    band = lambda a: "behind" if a <= 0 else "short" if a < 10 else "mid" if a < 20 else "deep"
    rate = lambda xs, test: r3(sum(1 for x in xs if test(x)) / max(1, len(xs)))
    pressed = lambda r: r["_press"] in ("TRUE", "1", "True")
    catch = {"n": len(att), "catchable": {}, "contested": {}, "byCoverage": {}}
    for b in ("behind", "short", "mid", "deep"):
        bs = [r for r in att if band(num(r["air_yards"])) == b]
        catch["catchable"][b] = {"clean": rate([r for r in bs if not pressed(r)], lambda r: r["_catchable"]),
                                 "pressured": rate([r for r in bs if pressed(r)], lambda r: r["_catchable"]), "n": len(bs)}
        catch["contested"][b] = rate(bs, lambda r: r["_contested"])
    # On target by how far it is thrown, in five-yard steps — for an accuracy
    # that falls smoothly with depth rather than in FTN's four bands (§25).
    edges = [-99, -5, 0, 5, 10, 15, 20, 25, 30, 40, 99]
    catch["catchableByAir"] = []
    for lo, hi in zip(edges, edges[1:]):
        bs = [r for r in att if lo < num(r["air_yards"]) <= hi]
        if len(bs) < 100: continue
        catch["catchableByAir"].append({"air": round(sum(num(r["air_yards"]) for r in bs) / len(bs), 1), "n": len(bs),
            "clean": rate([r for r in bs if not pressed(r)], lambda r: r["_catchable"]),
            "pressured": rate([r for r in bs if pressed(r)], lambda r: r["_catchable"])})
    cat = [r for r in att if r["_catchable"]]
    unc = [r for r in att if not r["_catchable"]]
    cu = [r for r in cat if not r["_contested"]]
    cc = [r for r in cat if r["_contested"]]
    catch.update({
        "contestedAll": rate(att, lambda r: r["_contested"]),
        "contestedMan": rate([r for r in att if r["_mz"] == "MAN_COVERAGE"], lambda r: r["_contested"]),
        "contestedZone": rate([r for r in att if r["_mz"] == "ZONE_COVERAGE"], lambda r: r["_contested"]),
        "catchableAll": rate(att, lambda r: r["_catchable"]),
        "cmpUncontested": rate(cu, lambda r: flag(r, "complete_pass")),
        "cmpContested": rate(cc, lambda r: flag(r, "complete_pass")),
        "cmpUncatchable": rate(unc, lambda r: flag(r, "complete_pass")),
        "drop": rate(cat, lambda r: r["_drop"]),
        "intUncatchable": rate(unc, lambda r: flag(r, "interception")),
        "intCatchable": rate(cat, lambda r: flag(r, "interception")),
        "reads": {k: rate(att, lambda r, k=k: r["_read"] == k) for k in ("1", "2", "CHK", "DES", "SD")},
    })
    # Against man and against zone: how deep, how often behind the line, how
    # often on target — a passer facing man throws deeper into tighter
    # windows, and misses more of them.
    catch["byMZ"] = {}
    for mz, key in (("MAN_COVERAGE", "man"), ("ZONE_COVERAGE", "zone")):
        ms = [r for r in att if r["_mz"] == mz]
        ay = [num(r["air_yards"]) for r in ms]
        catch["byMZ"][key] = {"n": len(ms), "catchable": rate(ms, lambda r: r["_catchable"]),
                              "cmp": rate(ms, lambda r: flag(r, "complete_pass")),
                              "adot": round(sum(ay) / max(1, len(ay)), 2),
                              "behind": rate(ms, lambda r: num(r["air_yards"]) <= 0),
                              "contested": {b: rate([r for r in ms if band(num(r["air_yards"])) == b], lambda r: r["_contested"])
                                            for b in ("behind", "short", "mid", "deep")}}
    for cov in COVERAGES:
        cs = [r for r in att if r["_cov"] == cov]
        catch["byCoverage"][cov] = {"n": len(cs), "cmp": rate(cs, lambda r: flag(r, "complete_pass")),
                                    "int": rate(cs, lambda r: flag(r, "interception")),
                                    "contested": rate(cs, lambda r: r["_contested"])}
    out["catch"] = catch
    return out


# ── The clubs, from 2026 ─────────────────────────────────────────────────────

OFF_SLOTS = [("QB", 1), ("RB", 1), ("WR", 3), ("TE", 2), ("T", 2), ("G", 2), ("C", 1)]


def teams_2026() -> int:
    pbp = [r for r in csv.DictReader((CACHE / "pbp_2026.csv").open(newline="", encoding="utf-8"))
           if r.get("season_type") == "REG" and not flag(r, "two_point_attempt")]
    ftn = {(r["nflverse_game_id"], r["nflverse_play_id"]): r for r in
           csv.DictReader((CACHE / "ftn_charting_2026.csv").open(newline="", encoding="utf-8"))}
    roster = list(csv.DictReader((CACHE / "roster_2026.csv").open(newline="", encoding="utf-8")))
    stats = {r["player_id"]: r for r in csv.DictReader((CACHE / "stats_player_reg_2026.csv").open(newline="", encoding="utf-8"))}
    teams_meta = json.loads((ROOT / "site" / "data" / "teams.json").read_text("utf-8"))
    by_id = {r["gsis_id"]: r for r in roster if r.get("gsis_id")}
    snaps = snap_index(2026, roster)
    faces = ROOT / "site" / "public" / "faces"

    # Every club's rates, then the league's as the prior they are pulled to.
    def tally(side: str) -> dict:
        t = collections.defaultdict(lambda: collections.Counter())
        for r in pbp:
            team = r["posteam"] if side == "off" else r["defteam"]
            if not team or r["play_type"] not in ("run", "pass"):
                continue
            c = t[team]
            if flag(r, "qb_dropback"):
                c["drop"] += 1
                c["sack"] += flag(r, "sack")
                c["hit"] += flag(r, "qb_hit")
                c["scramble"] += flag(r, "qb_scramble")
                if flag(r, "pass_attempt") and not flag(r, "sack"):
                    c["att"] += 1
                    c["cmp"] += flag(r, "complete_pass")
                    c["int"] += flag(r, "interception")
                    c["pyds"] += num(r["yards_gained"]) or 0
                f = ftn.get((r["game_id"], r["play_id"]))
                if f and num(f.get("n_blitzers")) is not None:
                    c["charted"] += 1
                    c["blitz"] += (num(f["n_blitzers"]) or 0) > 0
            elif r["play_type"] == "run" and not flag(r, "qb_scramble"):
                y = num(r["yards_gained"]) or 0
                c["runs"] += 1
                c["ryds"] += y
                c["stuff"] += y <= 0
            # A neutral down, for how much a club throws when it has a choice.
            if int(num(r["down"]) or 0) in (1, 2) and abs(num(r["score_differential"]) or 0) <= 8 and int(num(r["qtr"]) or 1) <= 3:
                c["neutral"] += 1
                c["neutral_pass"] += flag(r, "qb_dropback")
        return t
    off, de = tally("off"), tally("def")
    L = collections.Counter()
    for c in off.values():
        L.update(c)
    lg = {
        "cmp": L["cmp"] / L["att"], "int": L["int"] / L["att"], "ypa": L["pyds"] / L["att"],
        "sack": L["sack"] / L["drop"], "hit": L["hit"] / L["drop"], "ypc": L["ryds"] / L["runs"],
        "stuff": L["stuff"] / L["runs"], "neutralPass": L["neutral_pass"] / L["neutral"],
        "scramble": L["scramble"] / L["drop"],
    }
    blitz_all = sum(c["blitz"] for c in de.values()) / max(1, sum(c["charted"] for c in de.values()))

    def rates(c: collections.Counter) -> dict:
        """A club's rates as ratios to the league — 1.0 is average — after
        shrinkage. Ratios rather than rates so the engine can lay them over
        any situation's base without knowing what the base was."""
        ypa_n = c["att"]
        return {
            "cmp": r3(shrink(c["cmp"], c["att"], lg["cmp"], 120) / lg["cmp"]),
            "int": r3(shrink(c["int"], c["att"], lg["int"], 300) / lg["int"]),
            "ypa": r3(((c["pyds"] + 120 * lg["ypa"]) / (ypa_n + 120)) / lg["ypa"]),
            "sack": r3(shrink(c["sack"], c["drop"], lg["sack"], 150) / lg["sack"]),
            "hit": r3(shrink(c["hit"], c["drop"], lg["hit"], 150) / lg["hit"]),
            "ypc": r3(((c["ryds"] + 80 * lg["ypc"]) / (c["runs"] + 80)) / lg["ypc"]),
            "stuff": r3(shrink(c["stuff"], c["runs"], lg["stuff"], 80) / lg["stuff"]),
            "n": {"dropbacks": c["drop"], "runs": c["runs"]},
        }

    # The most recent two games each player took part in, by snaps, are who
    # starts: a depth chart says who is listed, snaps say who played.
    games_of = collections.defaultdict(list)
    for (pid, gid), s in snaps.items():
        games_of[pid].append((gid, s))
    team_games = collections.defaultdict(set)
    for (pid, gid) in snaps:
        if pid in by_id:
            team_games[by_id[pid]["team"]].add(gid)

    def recent_snaps(pid: str, unit: str, team: str) -> float:
        recent = sorted(team_games[team])[-2:]
        return sum(s.get(unit, 0) for gid, s in games_of.get(pid, []) if gid in recent)

    def card(pid: str, slot: str) -> dict:
        r = by_id[pid]
        return {"id": pid, "name": r["full_name"], "short": f"{r['first_name'][:1]}.{r['last_name']}",
                "no": int(num(r["jersey_number"]) or 0), "pos": slot,
                "face": (faces / f"{pid}.webp").exists()}

    written = 0
    OUT.mkdir(parents=True, exist_ok=True)
    for team in sorted(teams_meta):
        squad = [p for p, r in by_id.items() if r["team"] == team and r["status"] in ("ACT", "INA")]

        # Offence: the slot's most-used players, most recent games first.
        offence = []
        for pos, k in OFF_SLOTS:
            pool = [p for p in squad if by_id[p]["depth_chart_position"] == pos or (pos == "RB" and by_id[p]["depth_chart_position"] in ("RB", "HB"))]
            pool.sort(key=lambda p: -recent_snaps(p, "off", team))
            for p in pool[:k]:
                offence.append(card(p, pos))
        # Defence: the eleven who played most. Their positions make the
        # shape — a club that lives in nickel shows three corners.
        dpool = [p for p in squad if by_id[p]["depth_chart_position"] in
                 ("DE", "DT", "NT", "OLB", "ILB", "MLB", "LB", "CB", "FS", "SS", "S", "DB")]
        dpool.sort(key=lambda p: -recent_snaps(p, "def", team))
        defence = [card(p, by_id[p]["depth_chart_position"]) for p in dpool[:11]]
        kicker = next((card(p, "K") for p in sorted(squad, key=lambda p: -recent_snaps(p, "st", team)) if by_id[p]["depth_chart_position"] == "K"), None)
        punter = next((card(p, "P") for p in sorted(squad, key=lambda p: -recent_snaps(p, "st", team)) if by_id[p]["depth_chart_position"] == "P"), None)

        # Each player's own numbers, as the engine wants them.
        players = {}
        team_targets = sum(num(stats[p].get("targets")) or 0 for p in squad if p in stats)
        for c in offence + defence + [x for x in (kicker, punter) if x]:
            s = stats.get(c["id"], {})
            g = lambda k: num(s.get(k)) or 0
            pl: dict = {}
            if c["pos"] == "QB":
                att, sacked = g("attempts"), g("sacks_suffered")
                pl["qb"] = {"att": int(att),
                            "cmp": r3(shrink(g("completions"), att, lg["cmp"], 150) / lg["cmp"]),
                            "int": r3(shrink(g("passing_interceptions"), att, lg["int"], 400) / lg["int"]),
                            "sack": r3(shrink(sacked, att + sacked, lg["sack"], 200) / lg["sack"]),
                            "adot": r3((g("passing_air_yards") + 150 * 7.5) / (att + 150))}
            if g("targets"):
                tg = g("targets")
                pl["rec"] = {"tgt": int(tg), "share": r3(tg / max(1, team_targets)),
                             "catch": r3(shrink(g("receptions"), tg, 0.65, 40)),
                             "yac": r3((g("receiving_yards_after_catch") + 40 * 4.8) / (g("receptions") + 40))}
            if g("carries"):
                pl["rush"] = {"att": int(g("carries")), "ypc": r3((g("rushing_yards") + 60 * lg["ypc"]) / (g("carries") + 60) / lg["ypc"])}
            tk = g("def_tackles_solo") + g("def_tackle_assists")
            if tk or g("def_sacks") or g("def_interceptions") or g("def_pass_defended"):
                pl["def"] = {"tkl": int(tk), "sk": g("def_sacks"), "int": int(g("def_interceptions")),
                             "pd": int(g("def_pass_defended")), "qbh": int(g("def_qb_hits"))}
            if c["pos"] == "K":
                pl["k"] = {"fgm": int(g("fg_made")), "fga": int(g("fg_att")), "long": int(g("fg_long")),
                           "xpm": int(g("pat_made")), "xpa": int(g("pat_att"))}
            if c["pos"] == "P":
                pl["p"] = {"n": int(g("pt_att")), "net": r3(g("pt_net_yards") / max(1, g("pt_att")))}
            if pl:
                players[c["id"]] = pl

        o, d = off.get(team, collections.Counter()), de.get(team, collections.Counter())
        meta = teams_meta[team]
        doc = {
            "team": team, "name": meta["name"], "nick": meta["nick"],
            "color": meta["color"], "color2": meta["color2"],
            "offence": offence, "defence": defence, "kicker": kicker, "punter": punter,
            "rates": {
                "off": rates(o), "def": rates(d),
                # How much a club throws on a neutral down, as a ratio to the league.
                "passLean": r3(shrink(o["neutral_pass"], o["neutral"], lg["neutralPass"], 80) / lg["neutralPass"]),
                "blitz": r3(shrink(d["blitz"], d["charted"], blitz_all, 120)),
            },
            "players": players,
        }
        written += write_json(OUT / f"{team}.json", doc)

    # Kickoffs from 2026 and not 2025, because the kickoff itself changed
    # between them. Where the receiving side's drive actually began, read off
    # its first snap — which folds in the return, the touchback and any flag.
    by_game = collections.defaultdict(list)
    for r in pbp:
        by_game[r["game_id"]].append(r)
    starts, ko_tds = [], 0
    for rs in by_game.values():
        rs.sort(key=lambda r: num(r["play_id"]) or 0)
        for k, r in enumerate(rs):
            if r["play_type"] != "kickoff":
                continue
            if flag(r, "return_touchdown"):
                ko_tds += 1
                continue
            nxt = next((x for x in rs[k + 1:] if x["play_type"] in ("run", "pass") and x["posteam"] == r["posteam"]), None)
            if nxt and num(nxt["yardline_100"]) is not None:
                starts.append(100 - num(nxt["yardline_100"]))
    kick = {"start": quantiles(starts), "returnTd": r3(ko_tds / max(1, len(starts) + ko_tds)), "n": len(starts)}
    written += write_json(OUT / "league2026.json", {k: r3(v) for k, v in lg.items()} | {"blitz": r3(blitz_all), "kickoff": kick})
    print(f"  practice: {len(teams_meta)} club files, {written} changed")
    return written


def tables_md(L: dict) -> str:
    """The knowledge base's measured half, as a document. Written by the same
    code that writes league.json, so the prose in PRACTICE.md can point at a
    table and the table cannot drift from what the engine actually reads."""
    pc = lambda x: f"{x:.0%}"
    out = ["# Practice — measured tables", "",
           f"Generated by `pipeline/practice.py` from {L['plays']:,} plays of the 2025 regular season, "
           "nflverse play-by-play joined to its participation file and to FTN's charting. "
           "Do not edit by hand; edit the pipeline and rerun `make research`.", ""]
    covs = ["COVER_0", "COVER_1", "2_MAN", "COVER_2", "COVER_3", "COVER_4", "COVER_6"]
    short = lambda c: c.replace("COVER_", "C").replace("2_MAN", "2-Man")
    out += ["## Routes, when targeted", "",
            "| route | targets | share | cmp | int | median air | median ttt | EPA |", "|---|--:|--:|--:|--:|--:|--:|--:|"]
    for rt, v in sorted(L["routes"].items(), key=lambda kv: -kv[1]["n"]):
        out.append(f"| {rt} | {v['n']:,} | {pc(v['share'])} | {pc(v['cmp'])} | {v['int']:.1%} | {v['air'][10]} | {v['ttt'][1]}s | {v['epa']:+.2f} |")
    out += ["", "## Route against coverage — completion rate, shrunk toward the route's own", "",
            "| route | " + " | ".join(short(c) for c in covs) + " |", "|---|" + "--:|" * len(covs)]
    for rt in L["routes"]:
        out.append(f"| {rt} | " + " | ".join(pc(L["vs"][rt][c]["cmp"]) for c in covs) + " |")
    out += ["", "## Route against coverage — EPA per target", "",
            "| route | " + " | ".join(short(c) for c in covs) + " |", "|---|" + "--:|" * len(covs)]
    for rt in L["routes"]:
        out.append(f"| {rt} | " + " | ".join(f"{L['vs'][rt][c]['epa']:+.2f}" for c in covs) + " |")
    P = L["pressure"]
    out += ["", "## The pass rush", "", "| rushers | dropbacks | pressured | sacked |", "|--:|--:|--:|--:|"]
    for n, v in P["byRushers"].items():
        out.append(f"| {n} | {v['n']:,} | {pc(v['pressure'])} | {v['sack']:.1%} |")
    out += ["", f"Pressured: sacked {pc(P['sackGivenPressure'])}, scrambles {pc(P['scrambleGivenPressure'])}; "
            f"of throws, {pc(P['cmpPressured'])} complete, {P['intPressured']:.1%} intercepted, {pc(P['awayPressured'])} thrown away.  ",
            f"Clean: scrambles {pc(P['scrambleClean'])}; of throws, {pc(P['cmpClean'])} complete, {P['intClean']:.1%} intercepted, {pc(P['awayClean'])} thrown away.", ""]
    pa = L["playAction"]
    out += [f"Play action on first and second down: {pa['ypa']:.1f} yards an attempt against {pa['ypaWithout']:.1f} without, "
            f"average depth {pa['adot']:.1f} against {pa['adotWithout']:.1f}.", ""]
    out += ["## What defences call", "", "| situation | dropbacks | " + " | ".join(short(c) for c in covs) + " | 5+ rushers |",
            "|---|--:|" + "--:|" * len(covs) + "--:|"]
    for k, v in L["cover"].items():
        if v["n"] < 150:
            continue
        five = sum(v["rushers"][x] for x in ("5", "6", "7"))
        out.append(f"| {k} | {v['n']:,} | " + " | ".join(pc(v["mix"][c]) for c in covs) + f" | {pc(five)} |")
    R = L["run"]
    out += ["", "## The running game", "", "| gap | runs | share | 10th pct | median | 90th pct |", "|---|--:|--:|--:|--:|--:|"]
    for g, v in R["gaps"].items():
        out.append(f"| {g} | {v['n']:,} | {pc(v['share'])} | {v['yards'][2]} | {v['yards'][10]} | {v['yards'][18]} |")
    out += ["", "| defenders in the box | runs | yards against the average |", "|--:|--:|--:|"]
    for b, v in R["box"].items():
        out.append(f"| {b} | {v['n']:,} | {v['shift']:+.2f} |")
    out += ["", "## What offences call", "", "| situation | plays | pass rate | shotgun |", "|---|--:|--:|--:|"]
    for k, v in L["calls"].items():
        if v["n"] >= 300:
            out.append(f"| {k} | {v['n']:,} | {pc(v['pass'])} | {pc(v['shotgun'])} |")
    cl = L["callsLate"]
    out += ["", f"Fourth quarter, under ten minutes: pass rate {pc(cl['trailing'])} trailing by four or more, "
            f"{pc(cl['close'])} within three, {pc(cl['leading'])} leading by four or more.", ""]
    out += ["## Kicking", "", "| field goal | attempts | made |", "|---|--:|--:|"]
    for b in L["fg"]:
        out.append(f"| {b['lo']}–{b['hi']} yards | {b['n']} | {pc(b['make'])} |")
    out += ["", f"Extra points: {pc(L['xp'])} good.", "", "| punting from | punts | median net | touchback |", "|---|--:|--:|--:|"]
    for k, v in L["punt"].items():
        out.append(f"| {k} | {v['n']:,} | {v['net'][5]} | {pc(v['touchback'])} |")
    out += ["", "## Fourth down — how often a team goes for it", "", "| distance, field | n | go |", "|---|--:|--:|"]
    for k, v in L["fourth"].items():
        out.append(f"| {k} | {v['n']} | {pc(v['go'])} |")
    out += ["", "## The clock — median seconds a play takes off it", "", "| | seconds |", "|---|--:|"]
    for k, v in L["clock"].items():
        out.append(f"| {k} | {v} |")
    return "\n".join(out) + "\n"


def main() -> int:
    what = sys.argv[1] if len(sys.argv) > 1 else "all"
    if what in ("all", "league"):
        if (RESEARCH / "play_by_play_2025.csv").exists():
            rows = load_2025()
            L = league(rows)
            write_json(OUT / "league.json", L)
            (ROOT / "Docs" / "PRACTICE-TABLES.md").write_text(tables_md(L), encoding="utf-8")
            print(f"  practice: league tables from {len(rows)} plays of 2025, and Docs/PRACTICE-TABLES.md")
        elif what == "league":
            sys.exit("no research cache — run `make research`")
    if what in ("all", "teams"):
        teams_2026()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
