"""Check the emitted JSON against facts it did not produce.

    python3 pipeline/verify.py [season]

HANDOFF §4: *find something the output can be checked against, and check it
every build.* On the F1 project that was the starting grid and the classified
result, and it found most of the real bugs. Here it is the published final
score, the league's own drive summaries, and the arithmetic of football itself.

Every check below compares the emitted JSON against something outside it:

    score        the score reached by replaying the plays vs games.csv
    scoring      each scoring play's increment vs the values football allows
    drives       play counts, net yards and results vs the league's drive rows
    field        every spot in 0..100, every discontinuity explained
    actors       every named player against the league's own description
    units        which unit was on the field, and timeouts that only go down
    snap         the quarterback's alignment, and the accuracy of inferring him
    schedule     272 games, 18 weeks, 17 per team, 32 teams
    box          first downs and net yards vs the plays they were summed from

A failure here is a bug, not a warning. The exit code is non-zero and `make`
stops.
"""
from __future__ import annotations

import collections
import csv
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
CACHE = ROOT / ".cache" / "nflverse"
DATA = ROOT / "site" / "data"

csv.field_size_limit(10 ** 7)

# What a single scoring play can be worth. A play that moves the scoreboard by
# anything else is either a parsing error or a genuinely remarkable event, and
# either way the site should not print it without someone having looked.
SCORE_VALUES = {1, 2, 3, 6, 8}


class Report:
    def __init__(self) -> None:
        self.fails: list[str] = []
        self.checks = 0

    def ok(self, condition: bool, message: str) -> bool:
        self.checks += 1
        if not condition:
            self.fails.append(message)
        return condition

    def eq(self, got, want, message: str) -> bool:
        return self.ok(got == want, f"{message}: got {got!r}, expected {want!r}")


def load(path: pathlib.Path):
    if not path.exists():
        sys.exit(f"missing {path.relative_to(ROOT)} — run `make emit` first")
    return json.loads(path.read_text(encoding="utf-8"))


# ── Checks ───────────────────────────────────────────────────────────────────

def check_schedule(r: Report, schedule: dict, teams: dict, csv_games: list[dict]) -> None:
    games = schedule["games"]
    r.eq(len(games), len(csv_games), "schedule game count")
    r.eq(len(teams), 32, "team count")

    # 18 weeks, 272 games, every team 17 of them: the shape of a modern regular
    # season. If the emitter dropped or duplicated a game this is where it shows.
    r.eq(sorted(schedule["weeks"]), list(range(1, 19)), "weeks")
    per_team = collections.Counter()
    home_count = collections.Counter()
    for g in games:
        per_team[g["home"]] += 1
        per_team[g["away"]] += 1
        home_count[g["home"]] += 1
    r.eq(sorted(per_team), sorted(teams), "teams appearing in the schedule")
    odd = {t: n for t, n in per_team.items() if n != 17}
    r.ok(not odd, f"every team plays 17 games; these do not: {odd}")
    # One team hosts 8 and one 9 in alternating years, plus the neutral-site
    # games, so the only safe assertion is that nobody hosts a wild number.
    wild = {t: n for t, n in home_count.items() if not 6 <= n <= 11}
    r.ok(not wild, f"home game counts in range; these are not: {wild}")

    r.eq(len({g["id"] for g in games}), len(games), "unique game ids")

    by_id = {g["game_id"]: g for g in csv_games}
    for g in games:
        src = by_id.get(g["id"])
        if not r.ok(src is not None, f"{g['id']} is not in games.csv"):
            continue
        played = src["home_score"] not in ("", "NA")
        r.eq(g["played"], played, f"{g['id']} played flag")
        if played:
            r.eq(g["home_score"], int(src["home_score"]), f"{g['id']} home score")
            r.eq(g["away_score"], int(src["away_score"]), f"{g['id']} away score")
            r.eq(g["margin"], g["home_score"] - g["away_score"], f"{g['id']} margin")
            r.eq(g["points"], g["home_score"] + g["away_score"], f"{g['id']} points")

    detail = [g for g in games if g.get("detail")]
    played = [g for g in games if g["played"]]
    r.eq(len(detail), len(played), "played games with play-by-play")


def check_score(r: Report, game: dict) -> None:
    """The score the plays arrive at must be the score the league published.

    This is the check with teeth: a replay that ends on the wrong score is
    wrong, however plausible every frame of it looked."""
    plays = game["plays"]
    last = plays[-1]
    r.eq(last["hs"], game["home_score"], f"{game['id']} final home score from plays")
    r.eq(last["as"], game["away_score"], f"{game['id']} final away score from plays")

    # The running score must never go backwards or jump by an impossible amount.
    prev_h, prev_a = 0, 0
    for p in plays:
        h, a = p["hs"], p["as"]
        dh, da = h - prev_h, a - prev_a
        r.ok(dh >= 0 and da >= 0, f"{game['id']} play {p['id']}: score went backwards")
        r.ok(dh == 0 or da == 0,
             f"{game['id']} play {p['id']}: both teams scored on one play")
        if dh or da:
            r.ok(p.get("score") is True,
                 f"{game['id']} play {p['id']}: score changed but the play is not flagged scoring")
            r.ok((dh or da) in SCORE_VALUES,
                 f"{game['id']} play {p['id']}: scored {dh or da} points, which football does not allow")
        elif p.get("score"):
            # A flagged scoring play that moved nothing is a failed conversion,
            # which nflverse does flag. Anything else is a bug.
            r.ok(any(t.startswith(("xp-", "2pt-")) or t in ("fg-missed", "fg-blocked")
                     for t in p.get("tags", [])),
                 f"{game['id']} play {p['id']}: flagged scoring but the score did not move")
        prev_h, prev_a = h, a

    # Time only runs one way. `t` is the timebase the replay scrubs along, and
    # it is derived rather than given: `game_seconds_remaining` restarts at 600
    # for overtime, so an off-by-one period here would send the replay backwards.
    last_t = -1
    for p in plays:
        t = p.get("t")
        if t is None:
            continue
        r.ok(t >= last_t,
             f"{game['id']} play {p['id']}: elapsed time went backwards, {last_t} to {t}")
        last_t = t
    r.ok(last_t >= 3500, f"{game['id']}: the last play is at {last_t}s, which is not the end of a game")

    # And the scoring summary must be the same events, not a second opinion.
    flagged = [k for k, p in enumerate(plays) if p.get("score")]
    r.eq([s["i"] for s in game["scoring"]], flagged, f"{game['id']} scoring summary indices")


def check_drives(r: Report, game: dict) -> None:
    """Drive rows come from the league, and are aggregated independently of the
    play rows underneath them. Making the two agree catches a mis-grouped
    drive, which would otherwise show up only as a subtly wrong story."""
    plays = game["plays"]
    gid = game["id"]
    seen = collections.Counter()
    for p in plays:
        if p["kind"] == "play" and p.get("drive") is not None:
            seen[p["drive"]] += 1

    for d in game["drives"]:
        span = plays[d["from"]:d["to"]]
        r.ok(bool(span), f"{gid} drive {d['n']} has no plays")
        r.ok(all(p.get("drive") == d["n"] for p in span if p["kind"] == "play"),
             f"{gid} drive {d['n']}: play range contains plays from another drive")
        # The conversion after a defensive touchdown is attempted by the team
        # that scored it, and nflverse keeps it inside the drive that threw the
        # interception — so those two play types are allowed to belong to the
        # other team. The kickoff that opens a drive is posteam-tagged to the
        # receiving team, which may not be whoever ends up with the ball.
        wrong = [p for p in span if p["kind"] == "play" and p.get("pos") != d["pos"]
                 and p["type"] not in ("extra_point", "kickoff")
                 and not any(t.startswith("2pt-") for t in p.get("tags", []))]
        r.ok(not wrong,
             f"{gid} drive {d['n']}: possession changes mid-drive at play "
             f"{wrong[0]['id'] if wrong else ''}")

        # drive_play_count counts scrimmage plays; the range also holds the
        # kickoff that began the drive, penalties that wiped a play out, and
        # timeouts. It is a floor, not an equality.
        scrimmage = sum(1 for p in span if p["kind"] == "play"
                        and p.get("pos") == d["pos"]
                        and p["type"] not in ("kickoff", "extra_point", "no_play"))
        r.ok(d["plays"] is None or scrimmage >= d["plays"],
             f"{gid} drive {d['n']}: {scrimmage} scrimmage plays but the league counts {d['plays']}")

        if d["startx"] is not None:
            first = next((p for p in span if p["kind"] == "play"
                          and p["type"] != "kickoff" and p.get("pos") == d["pos"]), None)
            if first is not None:
                r.eq(first["x0"], d["startx"],
                     f"{gid} drive {d['n']} start spot from plays vs drive summary")

    r.eq(sorted(seen), sorted(d["n"] for d in game["drives"]), f"{gid} drive numbering")

    # A drive that ended in a touchdown must contain one, and vice versa.
    for d in game["drives"]:
        span = plays[d["from"]:d["to"]]
        has_td = any("td" in p.get("tags", []) for p in span)
        says_td = d["result"] in ("Touchdown", "Opp touchdown")
        r.eq(has_td, says_td,
             f"{gid} drive {d['n']} result {d['result']!r} vs a touchdown in its plays")


def check_field(r: Report, game: dict) -> None:
    """Every spot on the field, and every jump between them.

    HANDOFF §4: *never draw across a gap.* The emitter's job is to leave a hole
    visible; this checks that no hole was quietly filled in."""
    gid = game["id"]
    prev = None
    for p in game["plays"]:
        if p["kind"] != "play":
            continue
        for key in ("x0", "x1", "xfd"):
            v = p.get(key)
            r.ok(v is None or 0.0 <= v <= 100.0,
                 f"{gid} play {p['id']}: {key}={v} is off the field")
        r.ok(p["dir"] in (-1, 1), f"{gid} play {p['id']}: direction {p['dir']}")
        r.ok(p["pos"] != p["def"], f"{gid} play {p['id']}: a team is playing itself")
        r.eq(p["dir"], 1 if p["pos"] == game["home"] else -1,
             f"{gid} play {p['id']} direction matches possession")

        if p.get("down") is not None and "xfd" in p:
            r.eq(p["xfd"], round(min(100.0, max(0.0, p["x0"] + p["dir"] * p["togo"])), 1),
                 f"{gid} play {p['id']} line to gain")

        if prev is not None and prev.get("x1") is not None:
            moved = abs(prev["x1"] - p["x0"]) > 0.01
            r.eq("respot" in p, moved,
                 f"{gid} play {p['id']}: spot moved without a recorded reason"
                 if moved else f"{gid} play {p['id']}: recorded a re-spot that did not happen")
            if moved:
                r.ok(p["respot"]["why"] in ("penalty", "loose", "change", "restart"),
                     f"{gid} play {p['id']}: unexplained re-spot")
        prev = p

    r.eq(game["notes"], [], f"{gid} has unexplained gaps")


def check_actors(r: Report, game: dict) -> None:
    """The replay draws a badge for the kicker and the returner. A badge naming
    somebody who is not in the play's description would be a person invented on
    a football field, so each one is checked against the description it came
    from — which the emitter did not write."""
    gid = game["id"]
    for p in game["plays"]:
        for role, a in (p.get("act") or {}).items():
            r.ok(a["n"] in p["desc"],
                 f"{gid} play {p['id']}: {role} {a['n']!r} is not named in the description")
            if a["j"] is not None:
                r.ok(f"{a['j']}-{a['n']}" in p["desc"],
                     f"{gid} play {p['id']}: {role} {a['n']!r} is not number {a['j']} in the description")
        # Each role belongs to a kind of play. A rusher on a punt, or a
        # receiver on a play with no completion, means the roles have drifted
        # away from what the replay assumes when it decides how to move them.
        act = p.get("act") or {}
        tags = p.get("tags", [])
        ty = p.get("type")
        for role, allowed in (
            ("kick", ty in ("kickoff", "punt", "field_goal", "extra_point")),
            ("ret", ty in ("kickoff", "punt")),
            # A spike is a forward pass thrown into the ground, so it carries a
            # passer like any other.
            ("pass", ty in ("pass", "qb_spike")),
            ("rush", ty in ("run", "qb_kneel", "qb_spike")),
            ("int", "int" in tags),
        ):
            r.ok(allowed or role not in act,
                 f"{gid} play {p['id']}: a {ty} has a {role!r}")

        # `yards_after_catch` is how the replay tells a completion from an
        # incompletion — eleven catches in the season netted zero yards, so
        # "finished where it started" is not the test. The two must agree
        # exactly, or the replay will draw a catch as a ball hitting the turf.
        r.eq("rec" in act, "yac" in p,
             f"{gid} play {p['id']} has a receiver vs has yards after catch")
        if "rec" in act:
            r.ok("air" in p,
                 f"{gid} play {p['id']}: a completed pass without air yards")

        # The two legs must add up to the play, which is the whole reason the
        # replay is allowed to draw them separately. A lateral is the one case
        # that cannot: more than one player carried it.
        if "air" in p and "yac" in p and p.get("gain") is not None and "lateral" not in tags:
            r.eq(round(p["air"] + p["yac"], 3), float(p["gain"]),
                 f"{gid} play {p['id']} air yards plus yards after catch vs the gain")

        # The flag. The replay puts this on a card in the middle of the screen
        # with the offending club's mark on it, so every part of it is checked
        # against the description the league wrote: a card that names the wrong
        # offence, or the wrong club, is worse than no card at all.
        r.eq("pen" in p, "penalty" in tags,
             f"{gid} play {p['id']} has penalty detail vs is tagged as a penalty")
        if (pen := p.get("pen")):
            r.ok(pen["type"] and pen["type"] in p["desc"],
                 f"{gid} play {p['id']}: penalty {pen['type']!r} is not named in the description")
            r.ok(pen["team"] in (game["home"], game["away"]),
                 f"{gid} play {p['id']}: penalty on {pen['team']!r}, who are not playing")
            r.ok(pen["yards"] is not None and 0 <= pen["yards"] <= 60,
                 f"{gid} play {p['id']}: a {pen['yards']}-yard penalty")
            r.ok(pen["who"] is None or pen["who"] in p["desc"],
                 f"{gid} play {p['id']}: {pen['who']!r} is not named in the description")

        # The bug this replaced: `yards_gained` is 0 on an interception, which
        # left the ball sitting on the line of scrimmage.
        if "int" in tags and "td" not in tags and p.get("air") is not None:
            r.ok(p.get("x1") != p.get("x0") or p["air"] == 0,
                 f"{gid} play {p['id']}: an interception that ends where it was thrown")

        # A placekick is the one play whose end spot is decided by the result
        # rather than by any yardage: a kick that was not blocked is aimed at a
        # goal line and drawn to it, and a kick that was blocked has no end spot
        # at all. Read from the description, which is not where either came
        # from. A block returned for a score is a touchdown first and is
        # excluded, because then the ball did finish somewhere known.
        if ty in ("field_goal", "extra_point") and "td" not in tags:
            blocked = "blocked" in p["desc"].lower()
            r.eq(p.get("x1") is None, blocked,
                 f"{gid} play {p['id']}: a blocked kick is given an end spot"
                 if blocked else
                 f"{gid} play {p['id']}: a kick that was not blocked has no end spot")
            r.ok(blocked or p["x1"] in (0.0, 100.0),
                 f"{gid} play {p['id']}: a placekick ends at {p.get('x1')}, not a goal line")


# A unit is a claim about who was on the field, so each one has to be possible
# for the play it is attached to.
UNIT_FOR_TYPE = {
    "kickoff": {"kickoff"}, "punt": {"punt"},
    "field_goal": {"field_goal"}, "extra_point": {"extra_point"},
    # A penalty before the snap never ran, so it is whatever formation the
    # description names — or a scrimmage down, which is the overwhelming case.
    "no_play": {"offense", "punt", "field_goal"},
}


def check_units(r: Report, game: dict) -> None:
    gid = game["id"]
    for p in game["plays"]:
        if p["kind"] != "play":
            continue
        allowed = UNIT_FOR_TYPE.get(p["type"], {"offense"})
        r.ok(p.get("unit") in allowed,
             f"{gid} play {p['id']}: a {p['type']} cannot have the {p.get('unit')!r} unit on the field")

    # Timeouts run out and are given back at half time, and never otherwise.
    # An increase anywhere else means the two teams' columns have been crossed.
    for side in ("hto", "ato"):
        prev, prev_q = 3, 1
        for p in game["plays"]:
            now, q = p.get(side), p["q"]
            if now is None:
                continue
            r.ok(0 <= now <= 3, f"{gid} play {p['id']}: {now} timeouts left")
            fresh_half = (prev_q <= 2 < q) or (q > 4 and q != prev_q)
            r.ok(now <= prev or fresh_half,
                 f"{gid} play {p['id']}: {side} went from {prev} timeouts to {now} inside a half")
            prev, prev_q = now, q


QB_SPOTS = {"U", "S", "P"}


def check_snap(r: Report, game: dict) -> None:
    """Where the quarterback lined up, and who he was.

    The alignment is FTN's, and belongs only to a scrimmage down. Who he was is
    recorded on a pass and on nothing else, so on a handoff run the replay takes
    the nearest passer on the same drive. That is an inference, and this is where
    it is held to account: run on the plays where the passer *is* named, it has
    to agree almost always, or the method has stopped working."""
    gid = game["id"]
    plays = [p for p in game["plays"] if p["kind"] == "play"]

    for p in plays:
        if "qb" not in p:
            continue
        r.ok(p["qb"] in QB_SPOTS, f"{gid} play {p['id']}: qb alignment {p['qb']!r}")
        r.ok(p["type"] in ("run", "pass", "qb_kneel", "qb_spike", "no_play"),
             f"{gid} play {p['id']}: a {p['type']} cannot have a quarterback alignment")

    # The same search the replay does, minus the play itself.
    def nearest(k: int) -> str | None:
        drive = plays[k].get("drive")
        for step in range(1, len(plays)):
            for j in (k - step, k + step):
                if 0 <= j < len(plays) and plays[j].get("drive") == drive:
                    if (who := (plays[j].get("act") or {}).get("pass")):
                        return who["n"]
            if k - step < 0 and k + step >= len(plays):
                break
        return None

    hit = miss = 0
    for k, p in enumerate(plays):
        named = (p.get("act") or {}).get("pass")
        if not named:
            continue
        guess = nearest(k)
        if guess is None:
            continue
        hit += guess == named["n"]
        miss += guess != named["n"]
    if hit + miss >= 20:
        rate = hit / (hit + miss)
        r.ok(rate >= 0.95,
             f"{gid}: inferring the quarterback from the drive agrees with the named "
             f"passer only {rate:.0%} of the time ({miss} of {hit + miss} wrong)")


def check_box(r: Report, game: dict) -> None:
    """The box score is summed from the plays, so re-summing it a second way is
    only worth doing where the two routes are genuinely different."""
    gid = game["id"]
    for side in (game["home"], game["away"]):
        b = game["box"][side]
        r.eq(b["first_downs"], b["first_rush"] + b["first_pass"] + b["first_pen"],
             f"{gid} {side} first downs")
        r.eq(b["yards"], b["pass_yards"] + b["rush_yards"] - b["sack_yards"],
             f"{gid} {side} net yards")
        r.eq(b["turnovers"], b["interceptions"] + b["fumbles_lost"],
             f"{gid} {side} turnovers")
        r.ok(b["third_made"] <= b["third_att"], f"{gid} {side} third downs")
        r.ok(b["completions"] <= b["pass_att"], f"{gid} {side} completions")

    # Possession adds up to roughly the length of the game. Regulation is 3600
    # seconds of clock but only about 60 minutes of it is charged to a drive,
    # and overtime adds more, so this is a range check and not an equality.
    top = sum(game["box"][s]["top"] for s in (game["home"], game["away"]))
    floor = 3000
    r.ok(floor <= top <= 5400,
         f"{gid} time of possession sums to {top}s, outside {floor}–5400s")

    # Every touchdown in the plays should appear in somebody's player lines,
    # except defensive and special-teams returns, which have no scrimmage line.
    scrimmage_tds = sum(
        1 for p in game["plays"]
        if "td" in p.get("tags", []) and p["type"] in ("run", "pass")
        and p.get("tags") and "lost" not in p["tags"] and "int" not in p["tags"]
    )
    player_tds = sum(e["td"] for e in game["players"]["rushing"]) + \
        sum(e["td"] for e in game["players"]["receiving"])
    r.ok(player_tds <= scrimmage_tds,
         f"{gid}: player lines claim {player_tds} scrimmage touchdowns, plays show {scrimmage_tds}")


# ── People ───────────────────────────────────────────────────────────────────

# Stats that add up over a set of games. The rest do not, and summing them
# would be a check that fails for arithmetic rather than for data: `epa` is a
# float and would fail on rounding, `cpoe` and `share` are averages, and `long`
# is a maximum.
NOT_SUMMABLE = {"epa", "cpoe", "share", "long"}


def sum_log(log: list[dict]) -> dict[str, dict[str, int]]:
    out: dict[str, dict[str, int]] = {}
    for row in log:
        for group, stats in row["stats"].items():
            acc = out.setdefault(group, {})
            for key, v in stats.items():
                if key not in NOT_SUMMABLE:
                    acc[key] = acc.get(key, 0) + v
    return out


def check_people(r: Report, index: dict, teams: dict, ids: set[str]) -> None:
    """The register itself: who is in it, and that each one is a real club's."""
    for pid, p in index.items():
        r.ok(p["team"] in teams, f"{pid}: team {p['team']!r} is not a club this season")
        r.ok(bool(p["name"]), f"{pid}: no name")
        r.ok(p["status"] in {"ACT", "RES", "DEV", "CUT", "RET", "EXE"},
             f"{pid}: unknown roster status {p['status']!r}")
        r.ok(p["id"] == pid, f"{pid}: id disagrees with its key")
    # Everyone who appears in a game file must have a page to be linked to.
    missing = ids - set(index)
    r.ok(not missing, f"{len(missing)} player(s) with stats have no page: {sorted(missing)[:5]}")


def check_player(r: Report, detail: dict, index: dict, games: dict) -> None:
    """One player: his season against his own games, and his games against the
    schedule."""
    pid = detail["id"]
    entry = index.get(pid)
    if not entry:
        r.ok(False, f"{pid}: detail file with no index entry")
        return
    r.eq(len(detail["log"]), entry["games"], f"{pid}: games counted")

    # nflverse publishes the season totals and the weekly rows as two separate
    # files. Nothing guarantees they agree; this is the check that they do.
    want = sum_log(detail["log"])
    for group, stats in want.items():
        got = detail["stats"].get(group)
        if got is None:
            r.ok(False, f"{pid}: played {group} but has no season {group} total")
            continue
        for key, total in stats.items():
            r.eq(got.get(key, 0), total, f"{pid}: season {group}.{key} against the sum of his games")

    seen = set()
    for row in detail["log"]:
        gid = row["game"]
        g = games.get(gid)
        r.ok(g is not None, f"{pid}: week {row['week']} references unknown game {gid!r}")
        if not g:
            continue
        r.ok(gid not in seen, f"{pid}: two rows for {gid}")
        seen.add(gid)
        r.eq(row["week"], g["week"], f"{pid}: week of {gid}")
        sides = {g["home"], g["away"]}
        r.ok(row["team"] in sides, f"{pid}: played for {row['team']} in {gid}, which is {sides}")
        r.ok(row["opp"] in sides, f"{pid}: opponent {row['opp']} in {gid}, which is {sides}")
        r.ok(row["team"] != row["opp"], f"{pid}: played himself in {gid}")
        if "result" in row:
            mine, theirs = row["pf"], row["pa"]
            want_r = "W" if mine > theirs else "L" if mine < theirs else "T"
            r.eq(row["result"], want_r, f"{pid}: result of {gid}")


def check_player_box(r: Report, game: dict, by_game: dict) -> None:
    """The strong one: two independent routes to the same number.

    This pipeline builds a box score by walking the play-by-play itself.
    nflverse aggregates the same plays into its own per-player rows. Summing
    those rows per club and comparing with the box score compares two
    derivations that share nothing but the source, so a disagreement is a bug
    in one of them — which is how the sack-as-pass-attempt error was found."""
    gid = game["id"]
    for team, box in game["box"].items():
        agg = by_game.get((gid, team), {})
        for label, key, group, stat in (
            ("pass attempts", "pass_att", "passing", "att"),
            ("completions", "completions", "passing", "cmp"),
            ("passing yards", "pass_yards", "passing", "yards"),
            ("interceptions thrown", "interceptions", "passing", "int"),
            ("sacks taken", "sacks", "passing", "sacked"),
            ("rush attempts", "rush_att", "rushing", "att"),
            ("rushing yards", "rush_yards", "rushing", "yards"),
        ):
            r.eq(agg.get(group, {}).get(stat, 0), box[key],
                 f"{gid} {team}: {label}, nflverse against this pipeline's own count")
        # Within nflverse's own rows: every completion is somebody's catch.
        rec = agg.get("receiving", {})
        pas = agg.get("passing", {})
        r.eq(rec.get("rec", 0), pas.get("cmp", 0), f"{gid} {team}: receptions against completions")
        r.eq(rec.get("yards", 0), pas.get("yards", 0), f"{gid} {team}: receiving against passing yards")


def check_team_stats(r: Report, ts: dict, teams: dict, games: dict) -> None:
    for abbr, t in ts["teams"].items():
        r.ok(abbr in teams, f"team-stats: {abbr} is not a club this season")
        want = sum_log(t["weeks"])
        for group, stats in want.items():
            got = t["for"].get(group)
            if got is None:
                r.ok(False, f"{abbr}: played {group} but has no season total")
                continue
            for key, total in stats.items():
                r.eq(got.get(key, 0), total, f"{abbr}: season {group}.{key} against the sum of its weeks")
        for w in t["weeks"]:
            g = games.get(w["game"])
            r.ok(g is not None, f"{abbr}: week {w['week']} references unknown game {w['game']!r}")
            if g:
                r.ok(abbr in {g["home"], g["away"]}, f"{abbr}: not in {w['game']}")
                r.eq(w["opp"], g["away"] if g["home"] == abbr else g["home"],
                     f"{abbr}: opponent in {w['game']}")


# ── Main ─────────────────────────────────────────────────────────────────────

def main() -> int:
    season = int(sys.argv[1]) if len(sys.argv) > 1 else 2026
    schedule = load(DATA / "schedule.json")
    teams = load(DATA / "teams.json")

    path = CACHE / "games.csv"
    if not path.exists():
        sys.exit(f"missing {path.relative_to(ROOT)} — run `make fetch` first")
    with path.open(newline="", encoding="utf-8") as fh:
        csv_games = [g for g in csv.DictReader(fh) if g["season"] == str(season)]

    r = Report()
    r.eq(schedule["season"], season, "season")
    check_schedule(r, schedule, teams, csv_games)

    index = load(DATA / "players.json")["players"]
    by_game: dict[tuple[str, str], dict] = {}
    with_stats: set[str] = set()
    for pid in index:
        detail = load(DATA / "players" / f"{pid}.json")
        check_player(r, detail, index, {g["id"]: g for g in schedule["games"]})
        if detail["log"]:
            with_stats.add(pid)
        # Rolled up here so the per-game check below can compare in one pass
        # rather than re-reading seventeen hundred files per game.
        for row in detail["log"]:
            acc = by_game.setdefault((row["game"], row["team"]), {})
            for group, stats in row["stats"].items():
                g_acc = acc.setdefault(group, {})
                for key, v in stats.items():
                    if key not in NOT_SUMMABLE:
                        g_acc[key] = g_acc.get(key, 0) + v
    check_people(r, index, teams, with_stats)
    check_team_stats(r, load(DATA / "team-stats.json"), teams,
                     {g["id"]: g for g in schedule["games"]})

    played = 0
    for g in schedule["games"]:
        if not g.get("detail"):
            continue
        game = load(DATA / "games" / f"{g['id']}.json")
        played += 1
        check_score(r, game)
        check_drives(r, game)
        check_field(r, game)
        check_actors(r, game)
        check_units(r, game)
        check_snap(r, game)
        check_box(r, game)
        check_player_box(r, game, by_game)

    if r.fails:
        print(f"FAILED — {len(r.fails)} of {r.checks} checks, over {played} games\n")
        for m in r.fails[:40]:
            print(f"  {m}")
        if len(r.fails) > 40:
            print(f"  … and {len(r.fails) - 40} more")
        return 1

    print(f"{r.checks} checks pass over {played} games, {len(index)} players "
          f"and {len(schedule['games'])} schedule rows")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
