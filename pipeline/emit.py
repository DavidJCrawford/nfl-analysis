"""nflverse CSV -> canonical JSON in site/data/.

    python3 pipeline/emit.py [season]

Five kinds of output:

    teams.json              32 teams: name, division, colours
    team-stats.json         each club's season and weeks, for and against
    schedule.json           all 272 games, one light row each — the home page
    games/<game_id>.json    one played game in full — drives, plays, box score
    players.json            everyone with a page, and their season totals
    players/<gsis_id>.json  one player: biography, season, game by game

and two payloads written to site/public/data/ for the browser rather than the
build, because a comparison of two subjects cannot be pre-rendered — see
`emit_compare`.

The two pairs are the same shape twice: an index light enough for a page that
lists everybody, and a file per subject with the detail in it.

Serialisation is canonical (sorted keys, tight separators, fixed float
precision, no timestamps anywhere). Re-running on unchanged input produces
byte-identical files, so `git status` after a rebuild is the signal that the
upstream data actually moved.

──────────────────────────────────────────────────────────────────────────────
THE FIELD COORDINATE

Everything downstream — the replay especially — works in one coordinate, `x`:

    x = yards from the HOME team's goal line, 0 at the home end zone,
        100 at the away end zone.

nflverse gives `yardline_100`, the distance from the team in possession to the
end zone it is attacking, which flips meaning every time possession changes.
That is unusable for drawing. The conversion is:

    posteam is away  ->  x = yardline_100        (away attacks x = 0)
    posteam is home  ->  x = 100 - yardline_100  (home attacks x = 100)

and so each team has a constant direction of travel for the whole game:

    dir(home) = +1,  dir(away) = -1

This is checked against the `yrdln` text ("SEA 24", "MID 50") on every single
play — see `check_x`. It agreed on all 2569 plays of week 1, which is why the
rest of this file can trust it.
"""
from __future__ import annotations

import collections
import csv
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
CACHE = ROOT / ".cache" / "nflverse"
OUT = ROOT / "site" / "data"

# A whole game of play-by-play is one CSV row per play with 372 columns, and a
# few descriptions are long. The default 128 KB field limit is not the problem;
# raising it costs nothing and removes a class of silent truncation.
csv.field_size_limit(10 ** 7)

MISSING = {"", "NA", "NaN", "None"}


# ── Reading ──────────────────────────────────────────────────────────────────

def read_csv(path: pathlib.Path) -> list[dict[str, str]]:
    if not path.exists():
        sys.exit(f"missing {path.relative_to(ROOT)} — run `make fetch` first")
    with path.open(newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def s(row: dict, key: str) -> str | None:
    """A field as text, or None. nflverse writes empty strings and the literal
    'NA' interchangeably; both mean absent and neither means the empty string."""
    v = row.get(key, "")
    return None if v in MISSING else v


def i(row: dict, key: str) -> int | None:
    v = s(row, key)
    if v is None:
        return None
    try:
        return int(float(v))
    except ValueError:
        return None


def f(row: dict, key: str, nd: int | None = None) -> float | None:
    v = s(row, key)
    if v is None:
        return None
    try:
        x = float(v)
    except ValueError:
        return None
    return x if nd is None else round(x, nd)


def flag(row: dict, key: str) -> bool:
    return s(row, key) == "1"


# ── Writing ──────────────────────────────────────────────────────────────────

def write_json(path: pathlib.Path, obj) -> bool:
    """Canonical write. Returns True if the bytes changed.

    Rewriting an identical file would still touch its mtime and make the build
    look non-deterministic, so read first and skip."""
    path.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False) + "\n"
    blob = text.encode("utf-8")
    if path.exists() and path.read_bytes() == blob:
        return False
    path.write_bytes(blob)
    return True


# ── Teams ────────────────────────────────────────────────────────────────────

def emit_teams(teams_rows: list[dict], live: set[str]) -> dict[str, dict]:
    """`teams_colors_logos` carries 36 rows: the 32 current franchises plus the
    abbreviations they used before relocating (OAK, SD, STL, LAR). Filter to the
    abbreviations the season actually uses, or the site grows four ghost teams."""
    teams = {}
    for r in teams_rows:
        abbr = s(r, "team_abbr")
        if abbr not in live:
            continue
        div = s(r, "team_division") or ""
        teams[abbr] = {
            "abbr": abbr,
            "name": s(r, "team_name"),
            "nick": s(r, "team_nick"),
            "conf": s(r, "team_conf"),
            "div": div,
            # The part after the conference: "AFC North" -> "North".
            "region": div.split(" ", 1)[1] if " " in div else div,
            "color": s(r, "team_color"),
            "color2": s(r, "team_color2"),
        }
    missing = live - set(teams)
    if missing:
        sys.exit(f"no team metadata for {sorted(missing)}")
    return teams


def emit_logos(live: set[str]) -> int:
    """Copy the clubs' marks into the site, for the teams the season uses.

    They go to public/ rather than data/ because they are served as files, not
    read at build time, and they are committed alongside the emitted JSON for
    the same reason: the site builds from the repository alone.

    Left at their published 500px and scaled down by the browser. Two are loaded
    per game page, about 70 KB, and resizing them would put an image library in
    a pipeline that has no dependencies at all."""
    src = CACHE / "logos"
    out = ROOT / "site" / "public" / "logos"
    if not src.exists():
        print("  no club marks cached — run `make fetch`")
        return 0
    out.mkdir(parents=True, exist_ok=True)
    written = 0
    for abbr in sorted(live):
        f = src / f"{abbr}.png"
        if not f.exists():
            print(f"  no mark for {abbr}")
            continue
        dest = out / f"{abbr}.png"
        blob = f.read_bytes()
        if not dest.exists() or dest.read_bytes() != blob:
            dest.write_bytes(blob)
            written += 1
    return written


# ── Schedule ─────────────────────────────────────────────────────────────────

def game_row(g: dict) -> dict:
    """One game as the home page needs it.

    An unplayed game is most of the season for months, so it carries the fields
    that give it something true to show: the closing spread, the total line and
    the rest advantage are all real numbers about a game that has not happened."""
    home_score, away_score = i(g, "home_score"), i(g, "away_score")
    played = home_score is not None and away_score is not None

    row = {
        "id": s(g, "game_id"),
        "week": i(g, "week"),
        "date": s(g, "gameday"),
        "weekday": s(g, "weekday"),
        "kickoff": s(g, "gametime"),
        "away": s(g, "away_team"),
        "home": s(g, "home_team"),
        "played": played,
        "div": flag(g, "div_game"),
        "neutral": s(g, "location") == "Neutral",
        "stadium": s(g, "stadium"),
        "roof": s(g, "roof"),
        # spread_line is home-relative and positive when the home team is
        # favoured: 3 means "home by 3". Kept in that orientation throughout.
        "spread": f(g, "spread_line", 1),
        "total_line": f(g, "total_line", 1),
        "away_rest": i(g, "away_rest"),
        "home_rest": i(g, "home_rest"),
    }
    if played:
        row |= {
            "away_score": away_score,
            "home_score": home_score,
            # result is home minus away, so positive is a home win. Ties are 0,
            # which is a real outcome and not a missing value.
            "margin": i(g, "result"),
            "points": i(g, "total"),
            "ot": flag(g, "overtime"),
        }
    return row


# ── Plays ────────────────────────────────────────────────────────────────────

# Rows that are not plays. nflverse interleaves administrative rows with real
# ones; they have no field position and must not be drawn as a ball somewhere.
ADMIN_NFL = {"GAME_START", "END_QUARTER", "END_GAME", "TIMEOUT", "COMMENT"}

SCRIMMAGE = {"run", "pass", "qb_kneel", "qb_spike"}

# Which unit each side had on the field. This is not personnel — there is no
# participation data for 2026 (SPEC §3.1) and so no way to name the eleven. It
# is the *kind* of unit, which the play itself settles: a punt happened, so the
# punt team was out there.
#
# `special_teams_play` looks like it would do this and does not: it is 0 on all
# 58 field goals in the season. The play type is the reliable signal.
UNIT_BY_TYPE = {
    "kickoff": "kickoff",
    "punt": "punt",
    "field_goal": "field_goal",
    "extra_point": "extra_point",
}


# FTN's manual charting, joined on nflverse's own play key. The one field taken
# from it is where the quarterback lined up — the only thing in any of these
# datasets that says anything about the snap itself. The rest of the file (play
# action, blitzers, men in the box) is now one line away; see HANDOFF.
QB_LOCATION = {"U": "under centre", "S": "shotgun", "P": "pistol"}


def charting(season: int) -> dict[tuple[str, str], dict]:
    path = CACHE / f"ftn_charting_{season}.csv"
    if not path.exists():
        print(f"  no charting for {season} — qb alignment will be absent")
        return {}
    out = {}
    for r in read_csv(path):
        gid, pid = s(r, "nflverse_game_id"), i(r, "nflverse_play_id")
        if gid and pid is not None:
            out[(gid, str(pid))] = r
    return out


def unit_of(r: dict) -> str:
    """The unit on the field, from the play.

    A penalty before the snap is the one ambiguous case: the play never ran, so
    the type says nothing. The league writes the formation into the description
    when it is a kicking one — all four punt-formation penalties in the season
    are followed by an actual punt — and everything else is a scrimmage down."""
    ptype = s(r, "play_type") or ""
    if ptype in UNIT_BY_TYPE:
        return UNIT_BY_TYPE[ptype]
    if ptype == "no_play":
        desc = s(r, "desc") or ""
        if "Punt formation" in desc:
            return "punt"
        if "Field Goal formation" in desc:
            return "field_goal"
    return "offense"

# The half of `desc` before the first clock stamp is boilerplate on some rows
# ("(Shotgun)", "(No Huddle)") and meaningful on others. Only the leading clock
# is stripped: it duplicates the `time` column and reads as noise in a caption.
# Under a minute the league writes "(:26)" rather than "(0:26)", so the minutes
# are optional. Missing that left a stray clock at the front of exactly the
# plays most likely to be quoted — the ones at the end of a close game.
LEADING_CLOCK = re.compile(r"^\((?:\d{1,2})?:\d{2}\)\s*")


# Regulation is four fifteen-minute quarters; a regular-season overtime period
# is ten minutes. Both are clock time, not real time.
QUARTER, OVERTIME, REGULATION = 900, 600, 3600


def elapsed(r: dict) -> int | None:
    """Seconds since kickoff, continuing through overtime."""
    left, q = i(r, "game_seconds_remaining"), i(r, "qtr")
    if left is None or q is None:
        return None
    if q <= 4:
        return REGULATION - left
    return REGULATION + (q - 5) * OVERTIME + (OVERTIME - left)


def side_to_x(text: str | None, home: str) -> float | None:
    """'SEA 24' / 'MID 50' / '50' -> x. Used to place drive starts and ends,
    which nflverse only gives as this text."""
    if not text:
        return None
    parts = text.split()
    if len(parts) == 1:
        return 50.0 if parts[0] in ("50", "MID") else None
    side, num = parts[0], parts[1]
    try:
        n = float(num)
    except ValueError:
        return None
    if side == "MID":
        return 50.0
    return n if side == home else 100.0 - n


def check_x(r: dict, x: float, home: str) -> str | None:
    """`yardline_100` and the `yrdln` text are two independent spellings of the
    same spot. Disagreement means the coordinate conversion is wrong, which
    would put the whole replay in the wrong place, so it is checked every play
    rather than assumed once."""
    expect = side_to_x(s(r, "yrdln"), home)
    if expect is None or abs(expect - x) < 0.01:
        return None
    return f"play {s(r, 'play_id')}: yardline_100 says x={x:g}, yrdln '{s(r, 'yrdln')}' says x={expect:g}"


# The league writes a player into a description as "8-A.Borregales" every time,
# which is the only place a kicker's or returner's jersey number appears —
# nflverse gives jersey numbers for passers, rushers and receivers and for
# nobody else. Reading it back out of the description is not a guess: the name
# has to match the one in the structured column for the number to be taken.
JERSEY = "(\\d{1,2})-"


def jersey_of(desc: str, name: str) -> int | None:
    m = re.search(JERSEY + re.escape(name) + r"\b", desc)
    return int(m.group(1)) if m else None


def build_actors(r: dict, desc: str) -> dict[str, dict]:
    """Who did the thing — not where they were standing.

    This is deliberately narrow: only the people whose movement the replay can
    draw from a recorded number. A kicker runs up to the ball; a returner takes
    it where it lands; a passer throws from the spot; a receiver catches at the
    air-yards point and runs; a runner carries it; an interceptor takes it at
    the same air-yards point and runs the other way. Nobody else is here —
    a tackler's name is known and his position is not, so he stays in the
    description where he belongs.

    The intended receiver on an incomplete pass is deliberately absent. The
    throw went to a point the data gives; whether he was standing at it is
    exactly what an incompletion leaves unsaid."""
    actors: dict[str, dict] = {}

    def add(role: str, name: str | None) -> None:
        if not name:
            return
        actors[role] = {"n": name, "j": jersey_of(desc, name)}

    ptype = s(r, "play_type")
    add("kick", s(r, "punter_player_name") if ptype == "punt" else s(r, "kicker_player_name"))
    add("ret", s(r, "kickoff_returner_player_name") or s(r, "punt_returner_player_name"))
    add("pass", s(r, "passer_player_name"))
    if flag(r, "complete_pass"):
        add("rec", s(r, "receiver_player_name"))
    add("rush", s(r, "rusher_player_name"))
    add("int", s(r, "interception_player_name"))
    return actors


def play_tags(r: dict) -> list[str]:
    """Only tags that change what the play *is*. Anything derivable from the
    numbers already present (a gain, a score) is not repeated here."""
    t = []
    if flag(r, "touchdown"):
        t.append("td")
    if flag(r, "safety"):
        t.append("safety")
    if flag(r, "interception"):
        t.append("int")
    # A fumble recovered by the offence is still a loose ball, and it still
    # moves the spot in a way `yards_gained` does not describe — so the two
    # are tagged separately rather than only recording the ones that were lost.
    if flag(r, "fumble"):
        t.append("fumble")
    if flag(r, "fumble_lost"):
        t.append("lost")
    if flag(r, "sack"):
        t.append("sack")
    if flag(r, "penalty"):
        t.append("penalty")
    if flag(r, "first_down"):
        t.append("first")
    if flag(r, "third_down_converted") or flag(r, "fourth_down_converted"):
        t.append("converted")
    if flag(r, "fourth_down_failed") or flag(r, "third_down_failed"):
        t.append("stopped")
    if flag(r, "qb_scramble"):
        t.append("scramble")
    if flag(r, "aborted_play"):
        t.append("aborted")
    # A lateral means more than one player carried the ball, which is why it is
    # the single completed pass in the season where air yards plus yards after
    # catch do not add up to the gain.
    if any(flag(r, k) for k in ("lateral_reception", "lateral_rush",
                                "lateral_return", "lateral_recovery")):
        t.append("lateral")
    if s(r, "field_goal_result"):
        t.append("fg-" + s(r, "field_goal_result"))
    if s(r, "extra_point_result"):
        t.append("xp-" + s(r, "extra_point_result"))
    if s(r, "two_point_conv_result"):
        t.append("2pt-" + s(r, "two_point_conv_result"))
    return t


def build_play(r: dict, home: str, away: str, notes: list[str],
               chart: dict | None = None) -> dict:
    """One row of play-by-play as the replay and the game page need it.

    The contract with the replay: `x0` is where the ball was snapped, `x1` is
    where it was when the whistle blew, and nothing is drawn between them that
    the data does not support. Where the end spot is genuinely unknown, `x1` is
    null and the ball does not move — see HANDOFF §4, 'never draw across a gap'."""
    nfl = s(r, "play_type_nfl") or ""
    ptype = s(r, "play_type")
    pos, dfn = s(r, "posteam"), s(r, "defteam")
    y100 = f(r, "yardline_100")

    play = {
        "id": i(r, "play_id"),
        "q": i(r, "qtr"),
        "clock": s(r, "time"),
        "left": i(r, "game_seconds_remaining"),
        # Seconds elapsed since kickoff — the one timebase everything downstream
        # runs on. `game_seconds_remaining` looks like it would do, but it is
        # *not* monotonic: it counts 3600 down to 0 through regulation and then
        # restarts at 600 for overtime, so a replay driven by it would jump back
        # an hour at the end of a tied game.
        "t": elapsed(r),
        "desc": LEADING_CLOCK.sub("", s(r, "desc") or "").strip(),
        "hs": i(r, "total_home_score"),
        "as": i(r, "total_away_score"),
        # Timeouts left, per team rather than per side, so the scoreboard does
        # not have to work out which is which.
        "hto": i(r, "home_timeouts_remaining"),
        "ato": i(r, "away_timeouts_remaining"),
    }

    # Administrative rows: real events worth showing in the strip, but they have
    # no ball. `kind` lets the replay hold the previous frame instead of
    # inventing a position.
    if nfl in ADMIN_NFL or y100 is None or pos is None:
        play["kind"] = "note"
        play["note"] = {
            "GAME_START": "start", "END_QUARTER": "quarter", "END_GAME": "final",
            "TIMEOUT": "timeout",
        }.get(nfl, "other")
        if s(r, "timeout_team"):
            play["team"] = s(r, "timeout_team")
        return play

    d = 1 if pos == home else -1
    x0 = round(100.0 - y100 if pos == home else y100, 1)
    if (bad := check_x(r, x0, home)) is not None:
        notes.append(bad)

    gain = i(r, "yards_gained")
    goal_att = 100.0 if d > 0 else 0.0     # the goal line pos is attacking
    goal_own = 0.0 if d > 0 else 100.0     # pos's own goal line

    # ── Where the ball finished ──────────────────────────────────────────────
    x1: float | None
    if flag(r, "touchdown"):
        # A defensive return touchdown ends in the *possessing* team's own end
        # zone. Reading `td_team` rather than assuming the offence scored is the
        # difference between a pick-six drawn correctly and drawn backwards.
        x1 = goal_own if s(r, "td_team") == dfn else goal_att
    elif ptype in ("field_goal", "extra_point"):
        # A blocked kick never got there, and where the ball went from the
        # blocker's hands is not recorded anywhere — not in a column, and in the
        # description only as the fact of the block. So the end spot is
        # genuinely unknown and stays unknown: see the contract above, and
        # HANDOFF §4. Every other placekick is drawn to the goal line it was
        # aimed at, and the replay carries the good ones on through the posts.
        blocked = "blocked" in (s(r, "field_goal_result") or s(r, "extra_point_result") or "")
        x1 = None if blocked else goal_att
    elif flag(r, "interception"):
        # `yards_gained` is 0 on an interception, which would leave the ball on
        # the line of scrimmage — where it emphatically did not end up. The two
        # legs are both recorded: the throw travels `air_yards` downfield, and
        # the defence runs `return_yards` back the other way. Checked against
        # the stated interception spot on every pick in the season before this
        # was written; it agreed every time.
        air, ret = f(r, "air_yards"), f(r, "return_yards")
        x1 = x0 + d * air - d * ret if air is not None and ret is not None else x0
    elif ptype in SCRIMMAGE or nfl == "SACK":
        # `yards_gained` is the yardage *credited* to the play, so on a fumble
        # this is where the carrier was hit, not where the ball came to rest.
        # The recovery spot is only in the description — `fumble_recovery_1_yards`
        # is the return after recovery and does not give it. So the ball is drawn
        # to the credited spot and the re-spot is marked; the bounce is not
        # invented. See the `respot` pass in build_game.
        x1 = x0 + d * gain if gain is not None else None
    elif ptype == "no_play":
        x1 = x0            # by definition nothing happened; the penalty re-spots
    elif ptype in ("punt", "kickoff"):
        x1 = None          # filled in by the kick block below
    else:
        x1 = None

    # ── Kicks: the ball flies, then someone runs it back ────────────────────
    # posteam is the kicking team on a punt and the *receiving* team on a
    # kickoff, so direction is taken from whoever actually kicked it.
    if ptype in ("punt", "kickoff"):
        kicking_dir = d if ptype == "punt" else -d
        dist = f(r, "kick_distance")
        ret = f(r, "return_yards")
        if dist is not None:
            # A kick can come down *in* the end zone, and four in the season
            # do — "kicks 66 yards from ARI 35 to LAC -1". Clamping the landing
            # spot to the goal line before taking the return off it threw that
            # yard away and left the return spot a yard short of where the
            # league says it ended. The field is drawn from -10 to 110, so the
            # landing spot is free to say where the ball actually came down;
            # only the spot the next play is snapped from has to be on it.
            land = max(-10.0, min(110.0, x0 + kicking_dir * dist))
            play["kick"] = {"land": round(land, 1), "dist": round(dist, 1)}
            if ret:
                play["kick"]["ret"] = round(ret, 1)
            # The return runs the other way — the receiving team's direction.
            x1 = round(max(0.0, min(100.0, land - kicking_dir * (ret or 0.0))), 1)
        if flag(r, "touchback"):
            play["kick"] = play.get("kick", {}) | {"touchback": True}

    # A placekick has a distance too, and it is the number anybody quotes about
    # one. There is no landing spot to derive — the ball goes through the
    # uprights, which is where x1 already puts it.
    if ptype in ("field_goal", "extra_point") and (dist := f(r, "kick_distance")) is not None:
        play["kick"] = {"dist": round(dist, 1)}

    if x1 is not None:
        x1 = round(max(0.0, min(100.0, x1)), 1)

    play |= {
        "kind": "play",
        "unit": unit_of(r),
        "pos": pos,
        "def": dfn,
        "dir": d,
        "x0": x0,
        "x1": x1,
        "drive": i(r, "fixed_drive"),
        "series": i(r, "series"),
        "type": ptype or nfl.lower(),
        "epa": f(r, "epa", 3),
        # Home win probability, so the strip does not flip its meaning every
        # time the ball changes hands. `wp` in the source is posteam-relative.
        "hwp": f(r, "home_wp", 4),
    }

    down = i(r, "down")
    if down is not None:
        play |= {"down": down, "togo": i(r, "ydstogo")}
        if flag(r, "goal_to_go"):
            play["goal"] = True
        else:
            # The line to gain, in the same coordinate as the ball. Past the
            # goal line it is not a line at all, hence the goal_to_go branch.
            play["xfd"] = round(max(0.0, min(100.0, x0 + d * (i(r, "ydstogo") or 0))), 1)
    if gain is not None:
        play["gain"] = gain
    # Air yards and yards after catch, which between them say where a pass was
    # caught rather than only where it finished. Present on every completion,
    # incompletion and interception; absent on sacks, which never left the hand.
    if (air := f(r, "air_yards")) is not None:
        play["air"] = air
        if (yac := f(r, "yards_after_catch")) is not None:
            play["yac"] = yac
    if (tags := play_tags(r)):
        play["tags"] = tags
    if flag(r, "sp"):
        play["score"] = True
    if (actors := build_actors(r, play["desc"])):
        play["act"] = actors

    # The flag: who it was on, what for, and how far it cost. All four fields
    # are complete on all 237 penalties of the season, and the infraction is
    # written into the description verbatim — which verify.py checks, because a
    # card that names the wrong offence is worse than no card.
    # Where the quarterback lined up. Recorded on every charted scrimmage play,
    # and the only fact about a snap that any of this data holds.
    #
    # Scrimmage downs only. One missed 54-yard field goal in the season is
    # charted as "shotgun", which a holder is not; taking it would put a
    # quarterback on a play that had none.
    if chart and ptype in (SCRIMMAGE | {"no_play"}):
        if (loc := s(chart, "qb_location")) in QB_LOCATION:
            play["qb"] = loc

    if flag(r, "penalty") and s(r, "penalty_team"):
        play["pen"] = {
            "team": s(r, "penalty_team"),
            "type": s(r, "penalty_type"),
            "yards": i(r, "penalty_yards"),
            "who": s(r, "penalty_player_name"),
        }
    return play


# ── Drives ───────────────────────────────────────────────────────────────────

def build_drives(rows: list[dict], plays: list[dict], home: str) -> list[dict]:
    """nflverse repeats every drive-level field on every play of the drive, so
    a drive is read off any play in it — but only one that has a possessing
    team. The opening kickoff shares drive 1 with the receiving team's first
    series and the GAME row shares it too, with every drive field blank."""
    order: list[int] = []
    grouped: dict[int, list[dict]] = collections.defaultdict(list)
    for r in rows:
        n = i(r, "fixed_drive")
        if n is None:
            continue
        if n not in grouped:
            order.append(n)
        grouped[n].append(r)

    index = collections.defaultdict(list)
    for k, p in enumerate(plays):
        if p.get("drive") is not None:
            index[p["drive"]].append(k)

    out = []
    for n in order:
        rs = grouped[n]
        # The drive's own summary fields identify who the drive belongs to —
        # `posteam` on the leading row does not. A drive that opens with a
        # kickoff has the *receiving* team as posteam on that row, and when the
        # return is fumbled away (NYJ at TEN, week 1) the drive belongs to the
        # other team entirely. nflverse leaves the summary columns blank on the
        # kickoff row precisely in that case, so the first row that carries them
        # is the right one to read.
        lead = next((r for r in rs if s(r, "posteam") and s(r, "drive_start_yard_line")), None)
        lead = lead or next((r for r in rs if s(r, "posteam")), None)
        if lead is None:
            continue
        idx = index.get(n, [])
        if not idx:
            # Only administrative rows — nflverse gives the END GAME row a drive
            # number of its own. There is no drive here to show.
            continue
        start_x = side_to_x(s(lead, "drive_start_yard_line"), home)
        end_x = side_to_x(s(lead, "drive_end_yard_line"), home)
        out.append({
            "n": n,
            "pos": s(lead, "posteam"),
            "result": s(lead, "fixed_drive_result"),
            "start": s(lead, "drive_start_yard_line"),
            "end": s(lead, "drive_end_yard_line"),
            "startx": start_x,
            "endx": end_x,
            "start_via": s(lead, "drive_start_transition"),
            "end_via": s(lead, "drive_end_transition"),
            "plays": i(lead, "drive_play_count"),
            # ydsnet is the drive's net yardage, repeated on every row.
            "yards": i(lead, "ydsnet"),
            "top": s(lead, "drive_time_of_possession"),
            "firsts": i(lead, "drive_first_downs"),
            "q0": i(lead, "drive_quarter_start"),
            "q1": i(lead, "drive_quarter_end"),
            "clock0": s(lead, "drive_game_clock_start"),
            "clock1": s(lead, "drive_game_clock_end"),
            # Half-open range into `plays`, so a page can slice without search.
            "from": idx[0],
            "to": idx[-1] + 1,
        })
    return out


# ── Box score ────────────────────────────────────────────────────────────────

def mmss(seconds: int) -> str:
    return f"{seconds // 60}:{seconds % 60:02d}"


def top_seconds(text: str | None) -> int:
    if not text or ":" not in text:
        return 0
    m, sec = text.split(":")
    try:
        return int(m) * 60 + int(sec)
    except ValueError:
        return 0


def build_box(rows: list[dict], drives: list[dict], home: str, away: str) -> dict:
    """Team totals from the plays themselves rather than a summary feed, so
    every number on the page can be traced to the rows that produced it."""
    z = lambda: {
        "first_downs": 0, "first_rush": 0, "first_pass": 0, "first_pen": 0,
        "plays": 0, "yards": 0, "pass_yards": 0, "rush_yards": 0,
        "rush_att": 0, "pass_att": 0, "completions": 0,
        "sacks": 0, "sack_yards": 0,
        "third_att": 0, "third_made": 0, "fourth_att": 0, "fourth_made": 0,
        "turnovers": 0, "interceptions": 0, "fumbles_lost": 0,
        "penalties": 0, "penalty_yards": 0, "top": 0,
    }
    team = {home: z(), away: z()}

    for r in rows:
        pos = s(r, "posteam")
        # Penalties are charged to the team that committed them, which is often
        # the defence — so this is counted outside the possession branch.
        if flag(r, "penalty") and (pt := s(r, "penalty_team")) in team:
            team[pt]["penalties"] += 1
            team[pt]["penalty_yards"] += i(r, "penalty_yards") or 0
        if pos not in team:
            continue
        t = team[pos]
        t["first_rush"] += 1 if flag(r, "first_down_rush") else 0
        t["first_pass"] += 1 if flag(r, "first_down_pass") else 0
        t["first_pen"] += 1 if flag(r, "first_down_penalty") else 0
        if flag(r, "third_down_converted") or flag(r, "third_down_failed"):
            t["third_att"] += 1
            t["third_made"] += 1 if flag(r, "third_down_converted") else 0
        if flag(r, "fourth_down_converted") or flag(r, "fourth_down_failed"):
            t["fourth_att"] += 1
            t["fourth_made"] += 1 if flag(r, "fourth_down_converted") else 0
        if flag(r, "interception"):
            t["interceptions"] += 1
        if flag(r, "fumble_lost"):
            t["fumbles_lost"] += 1
        if flag(r, "sack"):
            t["sacks"] += 1
            t["sack_yards"] += -(i(r, "yards_gained") or 0)
        if flag(r, "rush_attempt") and not flag(r, "two_point_attempt"):
            t["rush_att"] += 1
            t["rush_yards"] += i(r, "rushing_yards") or 0
        # nflverse sets pass_attempt on a sack — it marks a dropback, not an
        # official attempt — and a sack is not a pass attempt on any box score
        # the NFL prints. Counting it as one inflated every team's attempts by
        # its sacks taken: 150 of them across the first two weeks. Completions
        # and passing yards were never affected, because a sack is neither.
        if flag(r, "pass_attempt") and not flag(r, "sack") and not flag(r, "two_point_attempt"):
            t["pass_att"] += 1
            t["completions"] += 1 if flag(r, "complete_pass") else 0
            t["pass_yards"] += i(r, "passing_yards") or 0
        if s(r, "play_type") in SCRIMMAGE or flag(r, "sack"):
            t["plays"] += 1

    for d in drives:
        if d["pos"] in team:
            team[d["pos"]]["top"] += top_seconds(d["top"])

    for t in team.values():
        t["first_downs"] = t["first_rush"] + t["first_pass"] + t["first_pen"]
        # Net yards: sacks come out of passing yardage, as on a real box score.
        t["yards"] = t["pass_yards"] + t["rush_yards"] - t["sack_yards"]
        t["turnovers"] = t["interceptions"] + t["fumbles_lost"]
        t["top_text"] = mmss(t["top"])

    return team


def build_players(rows: list[dict]) -> dict[str, list[dict]]:
    """Passing, rushing and receiving lines. Two-point plays are excluded from
    the attempt counts for the same reason the NFL excludes them: they are not
    scrimmage downs and no box score has ever counted them.

    Each line carries the player's gsis id as well as his name, so a box score
    can link to the man rather than just print "G.Smith". The id is what the
    play-by-play gives for every role it names — passer, rusher, receiver — and
    it is the same id the roster and the stats files use."""
    passing: dict[tuple, dict] = {}
    rushing: dict[tuple, dict] = {}
    receiving: dict[tuple, dict] = {}

    for r in rows:
        if flag(r, "two_point_attempt"):
            continue
        pos = s(r, "posteam")
        if pos is None:
            continue

        # A sack is not an attempt — see build_box. The sack is counted on its
        # own, immediately below.
        if (p := s(r, "passer_player_name")) and flag(r, "pass_attempt") and not flag(r, "sack"):
            e = passing.setdefault((pos, p), {"team": pos, "name": p, "att": 0, "cmp": 0,
                                              "yards": 0, "td": 0, "int": 0, "sacks": 0})
            e.setdefault("id", s(r, "passer_player_id"))
            e["att"] += 1
            e["cmp"] += 1 if flag(r, "complete_pass") else 0
            e["yards"] += i(r, "passing_yards") or 0
            e["td"] += 1 if flag(r, "pass_touchdown") else 0
            e["int"] += 1 if flag(r, "interception") else 0
        if (p := s(r, "passer_player_name")) and flag(r, "sack"):
            e = passing.setdefault((pos, p), {"team": pos, "name": p, "att": 0, "cmp": 0,
                                              "yards": 0, "td": 0, "int": 0, "sacks": 0})
            e.setdefault("id", s(r, "passer_player_id"))
            e["sacks"] += 1

        if (p := s(r, "rusher_player_name")) and flag(r, "rush_attempt"):
            e = rushing.setdefault((pos, p), {"team": pos, "name": p, "att": 0,
                                              "yards": 0, "td": 0})
            e.setdefault("id", s(r, "rusher_player_id"))
            e["att"] += 1
            e["yards"] += i(r, "rushing_yards") or 0
            e["td"] += 1 if flag(r, "rush_touchdown") else 0

        if (p := s(r, "receiver_player_name")) and flag(r, "pass_attempt"):
            e = receiving.setdefault((pos, p), {"team": pos, "name": p, "tgt": 0, "rec": 0,
                                                "yards": 0, "td": 0})
            e.setdefault("id", s(r, "receiver_player_id"))
            e["tgt"] += 1
            if flag(r, "complete_pass"):
                e["rec"] += 1
                e["yards"] += i(r, "receiving_yards") or 0
                e["td"] += 1 if flag(r, "pass_touchdown") else 0

    by_yards = lambda d: sorted(d.values(), key=lambda e: (-e["yards"], e["name"]))
    return {"passing": by_yards(passing), "rushing": by_yards(rushing),
            "receiving": by_yards(receiving)}


# ── One game ─────────────────────────────────────────────────────────────────

KICKS = {"kickoff", "punt", "field_goal", "extra_point"}


def mark_respots(plays: list[dict], notes: list[str]) -> None:
    """Where a play ends and the next one is snapped rarely agree, and the
    reasons are the interesting part of a football game.

    Rather than tween the ball across the difference — which would draw a
    smooth run that nobody made — each play records how its snap spot came to
    differ from the previous whistle:

        penalty    the officials re-spotted it, by a stated number of yards
        loose      a fumble; the bounce and the recovery are in the description
                   and nowhere in the structured data
        change     the ball changed hands
        restart    play restarted from a fixed spot — a conversion after a
                   touchdown, a kickoff, the start of a drive

    Anything the data cannot explain is left as a note and shown on the page,
    because a gap drawn over is worse than a gap admitted."""
    prev: dict | None = None
    for p in plays:
        if p.get("kind") != "play":
            continue
        if prev is not None and prev.get("x1") is not None and abs(prev["x1"] - p["x0"]) > 0.01:
            prev_tags, tags = prev.get("tags", []), p.get("tags", [])
            if "penalty" in prev_tags or "penalty" in tags:
                why = "penalty"
            elif "fumble" in prev_tags or "aborted" in prev_tags:
                why = "loose"
            elif prev["pos"] != p["pos"]:
                why = "change"
            elif prev["drive"] != p["drive"] or prev["type"] in KICKS or prev.get("score"):
                # Same team, new spot: the conversion after its own touchdown,
                # or the ball placed to start something. Calling this a change
                # of possession would be plainly wrong on the page.
                why = "restart"
            else:
                why = None
                notes.append(
                    f"play {prev['id']} ends at x={prev['x1']:g} but play {p['id']} is "
                    f"snapped at x={p['x0']:g}, and the data does not say why")
            p["respot"] = {"from": prev["x1"], "why": why}
        prev = p


WEATHER = re.compile(r"^(?P<sky>.*?)\s*Temp:\s*(?P<temp>[-\d]+)°?\s*F", re.I)


def build_game(g: dict, rows: list[dict], chart: dict) -> dict:
    home, away = s(g, "home_team"), s(g, "away_team")
    notes: list[str] = []
    gid = s(g, "game_id")

    rows = [r for r in rows if not flag(r, "play_deleted")]
    plays = [build_play(r, home, away, notes, chart.get((gid, s(r, "play_id"))))
             for r in rows]
    drives = build_drives(rows, plays, home)

    mark_respots(plays, notes)

    scoring = [
        {"i": k, "q": p["q"], "clock": p["clock"], "pos": p.get("pos"),
         "desc": p["desc"], "hs": p["hs"], "as": p["as"], "tags": p.get("tags", [])}
        for k, p in enumerate(plays) if p.get("score")
    ]

    final_home, final_away = i(g, "home_score"), i(g, "away_score")
    seen_home = next((p["hs"] for p in reversed(plays) if p.get("hs") is not None), None)
    seen_away = next((p["as"] for p in reversed(plays) if p.get("as") is not None), None)
    if (seen_home, seen_away) != (final_home, final_away):
        # The check HANDOFF §4 asks for: a game whose plays do not add up to the
        # published score is wrong, and this costs nothing to run.
        sys.exit(f"{s(g, 'game_id')}: plays end {seen_away}-{seen_home}, "
                 f"schedule says {final_away}-{final_home}")

    sky = None
    if (w := s(r0(rows), "weather")) and (m := WEATHER.match(w)):
        sky = m.group("sky").strip() or None

    return {
        "id": s(g, "game_id"),
        "season": i(g, "season"),
        "week": i(g, "week"),
        "date": s(g, "gameday"),
        "weekday": s(g, "weekday"),
        "kickoff": s(g, "gametime"),
        "home": home,
        "away": away,
        "home_score": final_home,
        "away_score": final_away,
        "ot": flag(g, "overtime"),
        "neutral": s(g, "location") == "Neutral",
        "div": flag(g, "div_game"),
        "venue": {
            "stadium": s(g, "stadium"), "roof": s(g, "roof"),
            "surface": s(g, "surface"), "temp": i(g, "temp"), "wind": i(g, "wind"),
            "sky": sky, "weather": s(r0(rows), "weather"),
        },
        "officials": {"referee": s(g, "referee")},
        "coaches": {"home": s(g, "home_coach"), "away": s(g, "away_coach")},
        "starters": {"home_qb": s(g, "home_qb_name"), "away_qb": s(g, "away_qb_name")},
        "line": {"spread": f(g, "spread_line", 1), "total": f(g, "total_line", 1),
                 "home_ml": i(g, "home_moneyline"), "away_ml": i(g, "away_moneyline")},
        "rest": {"home": i(g, "home_rest"), "away": i(g, "away_rest")},
        "opening_kickoff": home if flag(r0(rows), "home_opening_kickoff") else away,
        "drives": drives,
        "plays": plays,
        "scoring": scoring,
        "box": build_box(rows, drives, home, away),
        "players": build_players(rows),
        # Shown on the page. An empty list is the claim that nothing is missing.
        "notes": notes,
    }


def r0(rows: list[dict]) -> dict:
    return rows[0] if rows else {}


# ── People ───────────────────────────────────────────────────────────────────
#
# Two outputs, shaped like the two the games already have: one index of
# everybody, and one file per person with the detail in it.
#
# The numbers are nflverse's own aggregation of the play-by-play rather than
# this pipeline's. They could be summed here — every one of them is derivable
# from the plays — but a receiving yard would then mean whatever this file
# decided it meant, and it should mean what it means everywhere else. The
# aggregation is checked against the game files in verify.py instead.

# Which columns make up each group, as (emitted key, nflverse column, rounding).
# `int` rounds to a whole number; a digit count keeps that many decimals.
#
# The explosive-play counts (passing_10/16/20/40 and their rushing and
# receiving twins) are deliberately absent. They are almost certainly "plays of
# N+ yards", but nflverse does not say so where this pipeline can read it, and
# a column whose definition has been guessed at is not something to publish.
PLAYER_STATS: dict[str, list[tuple[str, str, object]]] = {
    "passing": [
        ("cmp", "completions", int), ("att", "attempts", int),
        ("yards", "passing_yards", int), ("td", "passing_tds", int),
        ("int", "passing_interceptions", int), ("sacked", "sacks_suffered", int),
        ("sack_yards", "sack_yards_lost", int), ("air", "passing_air_yards", int),
        ("yac", "passing_yards_after_catch", int), ("first", "passing_first_downs", int),
        ("epa", "passing_epa", 2), ("cpoe", "passing_cpoe", 1),
    ],
    "rushing": [
        ("att", "carries", int), ("yards", "rushing_yards", int),
        ("td", "rushing_tds", int), ("first", "rushing_first_downs", int),
        ("lost", "rushing_fumbles_lost", int), ("epa", "rushing_epa", 2),
    ],
    "receiving": [
        ("rec", "receptions", int), ("tgt", "targets", int),
        ("yards", "receiving_yards", int), ("td", "receiving_tds", int),
        ("first", "receiving_first_downs", int), ("air", "receiving_air_yards", int),
        ("yac", "receiving_yards_after_catch", int),
        ("share", "target_share", 3), ("epa", "receiving_epa", 2),
    ],
    "defence": [
        ("solo", "def_tackles_solo", int), ("assist", "def_tackle_assists", int),
        ("tfl", "def_tackles_for_loss", int), ("sacks", "def_sacks", 1),
        ("qb_hits", "def_qb_hits", int), ("int", "def_interceptions", int),
        ("pd", "def_pass_defended", int), ("ff", "def_fumbles_forced", int),
        ("td", "def_tds", int),
    ],
    "kicking": [
        ("fgm", "fg_made", int), ("fga", "fg_att", int), ("long", "fg_long", int),
        ("patm", "pat_made", int), ("pata", "pat_att", int),
    ],
    "punting": [
        ("att", "pt_att", int), ("yards", "pt_yards", int), ("net", "pt_net_yards", int),
        ("in20", "pt_inside_20", int), ("long", "pt_long", int),
    ],
    "returns": [
        ("pr", "punt_returns", int), ("pr_yards", "punt_return_yards", int),
        ("kr", "kickoff_returns", int), ("kr_yards", "kickoff_return_yards", int),
    ],
    "penalty": [("n", "penalties", int), ("yards", "penalty_yards", int)],
}

# A group is shown only when the player did that thing. Without this every
# quarterback would carry nine zeroed tackling fields and every page would have
# to know to hide them.
def stat_group(row: dict, spec: list[tuple[str, str, object]]) -> dict | None:
    out: dict = {}
    live = False
    for key, col, nd in spec:
        v = i(row, col) if nd is int else f(row, col, nd)  # type: ignore[arg-type]
        if v is None:
            continue
        out[key] = v
        # EPA is signed and a bad day is a real number, so it cannot be what
        # decides a group is empty — only the counting stats can.
        if v and key not in ("epa", "cpoe"):
            live = True
    return out if live else None


def all_groups(row: dict) -> dict[str, dict]:
    got = {}
    for name, spec in PLAYER_STATS.items():
        g = stat_group(row, spec)
        if g is not None:
            got[name] = g
    return got


def snap_index(season: int, roster: list[dict]) -> dict[tuple[str, str], dict]:
    """Snaps per player per game, keyed (gsis_id, game_id).

    snap_counts is the only file that counts the offensive line, who play every
    down and record almost nothing. It is also the only one keyed on Pro
    Football Reference's player id rather than the league's, so it has to be
    joined: `pfr_id` where the roster has one (80.6% of rows), and otherwise on
    name and club, which resolves a further 18.1% with no ambiguity at all —
    no (name, club) pair in the roster maps to two players. The ~1.3% that
    resolve to neither are name variants ("Paris Johnson" against "Paris
    Johnson Jr.") and are reported, not guessed at."""
    path = CACHE / f"snap_counts_{season}.csv"
    if not path.exists():
        return {}
    by_pfr = {r["pfr_id"]: r["gsis_id"] for r in roster if s(r, "pfr_id")}
    by_name: dict[tuple[str, str], set[str]] = collections.defaultdict(set)
    for r in roster:
        name, team = s(r, "full_name"), s(r, "team")
        if name and team:
            by_name[(name.lower(), team)].add(r["gsis_id"])

    out: dict[tuple[str, str], dict] = {}
    lost = 0
    for r in read_csv(path):
        pid = by_pfr.get(s(r, "pfr_player_id") or "")
        if not pid:
            hit = by_name.get(((s(r, "player") or "").lower(), s(r, "team") or ""), set())
            pid = next(iter(hit)) if len(hit) == 1 else None
        if not pid:
            lost += 1
            continue
        gid = s(r, "game_id")
        if not gid:
            continue
        snaps = {}
        for key, col in (("off", "offense_snaps"), ("def", "defense_snaps"), ("st", "st_snaps")):
            n = i(r, col)
            if n:
                snaps[key] = n
        for key, col in (("off_pct", "offense_pct"), ("def_pct", "defense_pct"), ("st_pct", "st_pct")):
            v = f(r, col, 2)
            if v:
                snaps[key] = v
        if snaps:
            out[(pid, gid)] = snaps
    if lost:
        print(f"  {lost} snap-count row(s) matched no player")
    return out


def emit_faces(ids: set[str]) -> int:
    """The cached portraits, for the people the site actually has a page for.

    Copied rather than linked, for the reason the club marks are: the site has
    to build from the repository alone. They are 96px WebP because the CDN was
    asked for that size — see fetch.py. These are photographs of players and
    are the league's; the credits page says so, as it does for the marks."""
    src = CACHE / "faces"
    if not src.exists():
        return 0
    out = ROOT / "site" / "public" / "faces"
    out.mkdir(parents=True, exist_ok=True)
    keep = set()
    written = 0
    for pid in sorted(ids):
        f_in = src / f"{pid}.webp"
        if not f_in.exists():
            continue
        keep.add(f"{pid}.webp")
        dest = out / f"{pid}.webp"
        blob = f_in.read_bytes()
        if not dest.exists() or dest.read_bytes() != blob:
            dest.write_bytes(blob)
            written += 1
    # A player who leaves the league should not leave his portrait behind.
    for stale in out.glob("*.webp"):
        if stale.name not in keep:
            stale.unlink()
            written += 1
    return written


def emit_people(season: int, live: set[str], games: list[dict]) -> tuple[int, int]:
    """Everyone on a roster, plus everyone who has played.

    The union matters. A player who appeared in week 1 and is now on injured
    reserve is no longer on an active roster, but his name is in a game page
    that is already published, and a site that drops him leaves that name
    pointing at nothing. Fifty-one players are in that position two weeks into
    this season, and the number only goes up."""
    roster = read_csv(CACHE / f"roster_{season}.csv")
    weeks = read_csv(CACHE / f"stats_player_week_{season}.csv")
    totals = read_csv(CACHE / f"stats_player_reg_{season}.csv")

    by_id = {r["gsis_id"]: r for r in roster if r.get("gsis_id")}
    played = {r["player_id"] for r in weeks if r.get("player_id")}
    active = {p for p, r in by_id.items() if s(r, "status") == "ACT"}
    wanted = (active | played) & set(by_id)

    total_by_id = {r["player_id"]: r for r in totals}
    weeks_by_id: dict[str, list[dict]] = collections.defaultdict(list)
    for r in weeks:
        weeks_by_id[r["player_id"]].append(r)
    snaps = snap_index(season, roster)
    game_by_id = {g["id"]: g for g in games}
    faces = CACHE / "faces"

    index: dict[str, dict] = {}
    written = 0
    for pid in sorted(wanted):
        r = by_id[pid]
        team = s(r, "team")
        if team not in live:
            continue
        stats_row = total_by_id.get(pid)
        season_stats = all_groups(stats_row) if stats_row else {}
        log = sorted(weeks_by_id.get(pid, []), key=lambda w: i(w, "week") or 0)

        # The index carries what a list of players has to show; the detail file
        # carries the rest. Same split as schedule.json against games/.
        index[pid] = {
            "id": pid,
            "name": s(r, "full_name"),
            "first": s(r, "first_name"),
            "last": s(r, "last_name"),
            "team": team,
            # Two positions, deliberately. `pos` is the roster's own coarse
            # grouping and has exactly eleven values, which is what a squad
            # list groups by. `depth_pos` is the club's depth-chart
            # designation — cornerback rather than defensive back — which is
            # what a reader wants to see written down.
            "pos": s(r, "position"),
            "depth_pos": s(r, "depth_chart_position"),
            "group": s(stats_row, "position_group") if stats_row else None,
            "no": i(r, "jersey_number"),
            "status": s(r, "status"),
            "exp": i(r, "years_exp"),
            "games": len(log),
            "face": (faces / f"{pid}.webp").exists(),
            "stats": season_stats,
        }

        draft_club, draft_no = s(r, "draft_club"), i(r, "draft_number")
        detail = {
            "id": pid,
            "season": season,
            "name": s(r, "full_name"),
            "team": team,
            "pos": s(r, "position"),
            "depth_pos": s(r, "depth_chart_position"),
            "no": i(r, "jersey_number"),
            "status": s(r, "status"),
            "bio": {
                "born": s(r, "birth_date"),
                # Published in inches and pounds, and left that way: this is an
                # American league and a reader who wants centimetres is better
                # served by a number that matches every other source than by
                # one this site converted.
                "height_in": i(r, "height"),
                "weight_lb": i(r, "weight"),
                "college": s(r, "college"),
                "exp": i(r, "years_exp"),
                "rookie": i(r, "rookie_year"),
                # No draft club is not a gap. 1,230 of these players were not
                # drafted at all, which is a fact about them worth stating.
                "draft": {"club": draft_club, "pick": draft_no} if draft_club else None,
            },
            "stats": season_stats,
            "log": [],
        }
        for w in log:
            gid = s(w, "game_id")
            g = game_by_id.get(gid or "")
            row = {
                "week": i(w, "week"),
                "game": gid,
                "team": s(w, "team"),
                "opp": s(w, "opponent_team"),
                "stats": all_groups(w),
            }
            if g:
                own = g["home"] if g["home"] == s(w, "team") else g["away"]
                row["home"] = g["home"] == own
                if g["played"]:
                    hs, aws = g.get("home_score"), g.get("away_score")
                    if hs is not None and aws is not None:
                        mine, theirs = (hs, aws) if row["home"] else (aws, hs)
                        row["pf"], row["pa"] = mine, theirs
                        row["result"] = "W" if mine > theirs else "L" if mine < theirs else "T"
            sn = snaps.get((pid, gid or ""))
            if sn:
                row["snaps"] = sn
            detail["log"].append(row)

        written += write_json(OUT / "players" / f"{pid}.json", detail)

    # Anyone who has gone: a player cut in week 3 stops being emitted, and his
    # file has to stop existing too or the site keeps serving a stale page.
    kept = {f"{pid}.json" for pid in index}
    for stale in (OUT / "players").glob("*.json"):
        if stale.name not in kept:
            stale.unlink()
            written += 1

    written += write_json(OUT / "players.json", {
        "season": season,
        "players": index,
        "counts": {
            "all": len(index),
            "active": sum(1 for p in index.values() if p["status"] == "ACT"),
            "played": sum(1 for p in index.values() if p["games"]),
            "faces": sum(1 for p in index.values() if p["face"]),
        },
    })
    return written, len(index)


def emit_team_stats(season: int, live: set[str]) -> int:
    """Each club's season to date, and its week by week, on both sides of the
    ball. The defensive half is the opponents' offence: nflverse publishes one
    row per club per game of what that club's offence did, so what was done to
    them is read off their opponents' rows rather than out of a column."""
    reg = read_csv(CACHE / f"stats_team_reg_{season}.csv")
    wk = read_csv(CACHE / f"stats_team_week_{season}.csv")

    weeks_by_team: dict[str, list[dict]] = collections.defaultdict(list)
    for r in wk:
        t = s(r, "team")
        if t in live:
            weeks_by_team[t].append(r)

    out: dict[str, dict] = {}
    for team in sorted(live):
        rows = sorted(weeks_by_team.get(team, []), key=lambda r: i(r, "week") or 0)
        season_row = next((r for r in reg if s(r, "team") == team), None)
        # What the opposition did against this club, week by week.
        against = [r for t, rs in weeks_by_team.items() if t != team
                   for r in rs if s(r, "opponent_team") == team]
        out[team] = {
            "team": team,
            "for": all_groups(season_row) if season_row else {},
            "against": sum_groups(against),
            "weeks": [{
                "week": i(r, "week"),
                "game": s(r, "game_id"),
                "opp": s(r, "opponent_team"),
                "stats": all_groups(r),
            } for r in rows],
        }
    return write_json(OUT / "team-stats.json", {"season": season, "teams": out})


def sum_groups(rows: list[dict]) -> dict[str, dict]:
    """Add up a set of weekly rows into one set of groups.

    Only used for the defensive half, where there is no season-total row to
    read — nflverse totals a club's own offence, not its opponents'."""
    out: dict[str, dict] = {}
    for name, spec in PLAYER_STATS.items():
        acc: dict[str, float] = {}
        live = False
        for r in rows:
            for key, col, nd in spec:
                v = i(r, col) if nd is int else f(r, col, nd)  # type: ignore[arg-type]
                if v is None:
                    continue
                acc[key] = acc.get(key, 0) + v
                if v and key not in ("epa", "cpoe"):
                    live = True
        if not live:
            continue
        # "Longest" does not add up, and neither does a share.
        for key, col, nd in spec:
            if key in acc and (key in ("long", "share") or col.endswith("_pct")):
                acc[key] = max((i(r, col) or 0) if nd is int else (f(r, col, nd) or 0) for r in rows)
            elif key in acc and nd is int:
                acc[key] = int(round(acc[key]))
            elif key in acc:
                acc[key] = round(acc[key], nd)  # type: ignore[arg-type]
        out[name] = acc
    return out


# ── Comparison payloads ──────────────────────────────────────────────────────
#
# These are the only files this pipeline writes for a browser rather than for
# the build. Everything else in site/data/ is read by Astro while the pages are
# being made; these are fetched by a page that has already been served.
#
# They exist because comparison cannot be pre-rendered. Thirty-two clubs make
# 496 pairs, which would be a reasonable number of pages — but 1,743 players
# make 1.5 million, and restricting it to matching positions still leaves about
# 198,000. So a comparison is one page that reads two names out of its query
# string, and the numbers have to reach it at run time.
#
# Split in two because the club page never needs the player payload: clubs are
# 13 KB over the wire and players 69 KB, and a reader comparing two defences
# should not be made to download seventeen hundred people to do it.

PUBLIC = ROOT / "site" / "public" / "data"


def emit_compare(season: int, teams: dict, games: list[dict], index: dict) -> int:
    written = 0

    # Clubs, with the record and the points that live in the schedule rather
    # than in the stats files, so the page needs only this one fetch.
    rec = {a: {"w": 0, "l": 0, "t": 0, "pf": 0, "pa": 0, "games": 0} for a in teams}
    for g in games:
        if not g["played"] or g.get("home_score") is None:
            continue
        h, a = g["home"], g["away"]
        hs, as_ = g["home_score"], g["away_score"]
        for side, own, other in ((h, hs, as_), (a, as_, hs)):
            if side not in rec:
                continue
            r = rec[side]
            r["games"] += 1
            r["pf"] += own
            r["pa"] += other
            r["w" if own > other else "l" if own < other else "t"] += 1

    ts = json.loads((OUT / "team-stats.json").read_text("utf-8"))["teams"]
    clubs = {}
    for abbr, t in sorted(teams.items()):
        clubs[abbr] = {
            "abbr": abbr, "name": t["name"], "nick": t["nick"],
            "conf": t["conf"], "div": t["div"],
            "color": t["color"], "color2": t["color2"],
            **rec.get(abbr, {}),
            "for": ts.get(abbr, {}).get("for", {}),
            "against": ts.get(abbr, {}).get("against", {}),
        }
    written += write_json(PUBLIC / "compare-teams.json", {"season": season, "teams": clubs})

    # People. The same entries the index carries, minus the fields a
    # comparison has no use for — there is no reason to send 1,743 years of
    # experience across the wire to draw two bar charts.
    people = {
        pid: {
            "id": pid, "name": p["name"], "team": p["team"],
            "pos": p["depth_pos"] or p["pos"], "unit": p["pos"],
            "no": p["no"], "face": p["face"], "games": p["games"],
            "status": p["status"], "stats": p["stats"],
        }
        for pid, p in sorted(index.items())
    }
    written += write_json(PUBLIC / "compare-players.json", {"season": season, "players": people})
    return written


# ── Main ─────────────────────────────────────────────────────────────────────

def main() -> int:
    season = int(sys.argv[1]) if len(sys.argv) > 1 else 2026

    schedule_rows = [r for r in read_csv(CACHE / "games.csv") if i(r, "season") == season]
    if not schedule_rows:
        sys.exit(f"no {season} games in games.csv")
    pbp_rows = read_csv(CACHE / f"pbp_{season}.csv")
    chart = charting(season)
    team_rows = read_csv(CACHE / "teams_colors_logos.csv")

    live = {s(g, "home_team") for g in schedule_rows} | {s(g, "away_team") for g in schedule_rows}
    teams = emit_teams(team_rows, live)
    logos = emit_logos(live)

    by_game: dict[str, list[dict]] = collections.defaultdict(list)
    for r in pbp_rows:
        by_game[s(r, "game_id")].append(r)
    # order_sequence is the league's own play ordering and is the only field
    # guaranteed to sort a game correctly; play_id is close but not promised.
    for gid in by_game:
        by_game[gid].sort(key=lambda r: (i(r, "order_sequence") or 0, i(r, "play_id") or 0))

    schedule_rows.sort(key=lambda g: (i(g, "week") or 0, s(g, "gameday") or "",
                                      s(g, "gametime") or "", s(g, "game_id") or ""))

    written = 0
    games = []
    for g in schedule_rows:
        gid = s(g, "game_id")
        row = game_row(g)
        rows = by_game.get(gid, [])

        if row["played"] and not rows:
            # A played game with no play-by-play is a real state — nflverse
            # lands the schedule before the plays. It is reported, not hidden.
            row["detail"] = False
            print(f"  {gid}: final score but no play-by-play yet")
        elif rows:
            detail = build_game(g, rows, chart)
            written += write_json(OUT / "games" / f"{gid}.json", detail)
            row["detail"] = True
            row["plays"] = sum(1 for p in detail["plays"] if p["kind"] == "play")
            row["drives"] = len(detail["drives"])
            if detail["notes"]:
                row["notes"] = len(detail["notes"])
        else:
            row["detail"] = False
        games.append(row)

    played = [g for g in games if g["played"]]
    weeks = sorted({g["week"] for g in games})
    schedule = {
        "season": season,
        "games": games,
        "weeks": weeks,
        "counts": {"games": len(games), "played": len(played), "weeks": len(weeks),
                   "teams": len(teams)},
        # The season's own edge, not the wall clock: the last date on which a
        # game has a final score. Written this way the output has no timestamp
        # and an unchanged rebuild stays byte-identical.
        "through": max((g["date"] for g in played), default=None),
        "first": min((g["date"] for g in games), default=None),
        "last": max((g["date"] for g in games), default=None),
        "source": {
            "name": "nflverse-data",
            "url": "https://github.com/nflverse/nflverse-data",
            "licence": "CC BY 4.0",
        },
    }
    written += write_json(OUT / "schedule.json", schedule)
    written += write_json(OUT / "teams.json", teams)

    written += emit_team_stats(season, live)
    people, heads = emit_people(season, live, games)
    written += people
    index = json.loads((OUT / "players.json").read_text("utf-8"))["players"]
    written += emit_faces(set(index))
    written += emit_compare(season, teams, games, index)

    print(f"{len(games)} games, {len(played)} played, {len(teams)} teams, {heads} players")
    if logos:
        print(f"{logos} club mark(s) copied to site/public/logos")
    print(f"{written} file(s) changed in {OUT.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
