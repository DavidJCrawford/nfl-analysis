# Practice — the football knowledge base

What the practice game knows about football, where each piece of it came from,
and how the engine turns it into a play. The measured half is in
[PRACTICE-TABLES.md](PRACTICE-TABLES.md), which the pipeline writes; this file
is the half that has to be written by hand, and it points at the tables rather
than repeating them.

## 0. The one thing to understand first

**There is no public tracking data.** Nobody outside the league knows where
all twenty-two players were on a given snap, so a practice play cannot be
replayed from data, and nothing on screen claims to be. What the engine does
instead is two-layered:

1. **Football logic decides the shape of the play** — who is open, when, and
   who the quarterback throws to — from the route each receiver runs, the
   coverage he runs it into, the rush, and the protection.
2. **Measured football decides the result** — whether the throw is complete,
   how far it goes, whether it is picked off — drawn from what that route
   actually did against that coverage across 2025, then bent by what these two
   clubs and these players have actually done in 2026.

The logic is never allowed to override the measurement. A preset coverage
against a preset concept reproduces the league's numbers; the logic only moves
the outcome when a player's choice departs from what the measurement already
contains — a defender pulled out of his zone, a receiver left uncovered, a
route that breaks after the rush has arrived. That is what keeps the game
honest: it cannot invent a better slant than the slant the league throws.

## 1. The field

The engine works in one frame whichever way the ball is going: the offence
always attacks toward **x = 100**. `x` is yards from the offence's own goal
line, `y` is yards from the middle of the field, ±26.67 at the sidelines
(53⅓ yards wide). Hash marks are at ±3.08 (NFL hashes are 18 ft 6 in apart).
The ball is snapped from the hash it was downed on, or the middle after a
score, a touchback or a kickoff. The renderer flips the frame for whichever
end the offence is attacking.

## 2. Personnel and formation

Personnel is named by backs then tight ends: **11** is one back, one tight end,
three receivers; **12** is one back, two ends, two receivers; **21** two backs,
one end; **13**, **10**, **22**. In 2025, 11 personnel was a third of all
snaps and nearly half of passes.

The engine's formations, each a template of eleven alignments relative to the
ball:

| formation | personnel | shape |
|---|---|---|
| Shotgun Trips | 11 | QB 5 yds deep, RB beside him, three receivers to one side |
| Shotgun Doubles | 11 | QB 5 deep, two receivers each side, TE in the slot |
| Singleback | 12 | QB under center, RB 7 deep, TE inline and TE on the wing |
| I-Form | 21 | QB under center, FB 4 deep, RB 7 deep, TE inline |
| Empty | 10 | QB 5 deep, five receivers spread, nobody in the backfield |
| Pistol | 11 | QB 4 deep, RB directly behind him |

The offensive line — tackle, guard, centre, guard, tackle — sits on the line a
yard apart. Receivers line up as **X** (split end, on the line, wide), **Z**
(flanker, off the line, wide), **slot** (inside, off the line), **Y** (tight
end). A formation must keep seven men on the line; the templates do, and a
dragged player is held to it.

## 3. Routes

Thirteen route families, because thirteen is what the participation file
records for the targeted receiver. Each has a shape (a path the receiver runs,
in yards relative to where he lined up, mirrored for his side of the field), a
break — the moment the route is ready to be thrown to — and the measured air
distance and time to throw from the tables.

| route | shape | depth | breaks at |
|---|---|---|---|
| Quick out | 5 yds, sharp to the sideline | 3–5 | 2.3s |
| Hitch / curl | up 6–12, turn back to the quarterback | 5–10 | 2.4s |
| Slant | 2–3 steps, 45° inside | 5–7 | 1.9s |
| Drag / shallow cross | under the linebackers, across the field | 2–4 | 2.7s |
| In / dig | up 12, square inside | 12–14 | 3.0s |
| Deep out | up 12–15, square outside | 12–15 | 2.9s |
| Post | up 10–12, break to the middle at 45° | 15–20 | 2.7s |
| Corner | up 10–12, break to the sideline at 45° | 17–20 | 3.0s |
| Go | straight up the field | 20+ | 2.6s |
| Wheel | out to the flat, then up the sideline | 12–15 | 2.7s |
| Texas / angle | a back's route: out, then sharply back inside | 3–5 | 2.5s |
| Swing | a back's route: flat and wide behind the line | −3 | 2.7s |
| Screen | behind the line, blockers in front | −3 | 1.7s |

A receiver can also **block**, and a back or tight end can **stay in to
protect**, which adds a blocker to the pass rush math in §6.

## 4. Concepts

A concept is a set of routes that work together, and it carries a **read
order**: the receivers the quarterback looks at, in turn. These are the
engine's presets — every one is editable route by route.

| concept | routes | beats | read order |
|---|---|---|---|
| Four Verticals | go, go, seams, checkdown | single-high (C3, C1) — four deep threats on three deep defenders | seams → outside go → checkdown |
| Smash | hitch outside, corner from the slot | two-high (C2) — the corner over the squatting cornerback | corner → hitch → back |
| Flood / Sail | go, deep out, flat to one side | C3 — three levels on two defenders | deep out → flat → go |
| Mesh | two drags crossing, a sit, a back's swing | man (C1, C0) — the crossers rub their defenders off | drags → sit → swing |
| Slant–Flat | slant inside, flat under it | C3 and man — the flat defender cannot take both | slant → flat |
| Curl–Flat | curl outside, flat under it | C3 — the curl-flat defender is wrong whichever he takes | curl → flat |
| Stick | 6-yd stick, flat, go clear-out | zone, short yardage | stick → flat |
| Dagger | dig behind a seam clear-out | C3 and C4 — the seam pulls the safety off the dig | dig → seam → checkdown |
| Y-Cross | deep cross from the tight end, post, checkdown | C3, C1 | cross → post → checkdown |
| Post–Wheel | post from the outside, wheel from the slot | C4, man — the wheel beats a linebacker | wheel → post |
| Slants | slant from every receiver | Cover 0 and the blitz — the ball is out before the rush | first slant open |
| Screen | WR or RB screen, the rest block | the blitz, fast rushers | screen |
| Play-action shot | run fake, then post and go | aggressive single-high | post → go → checkdown |

The "beats" column is football's received wisdom, and the measured table is
the check on it. The data agrees almost everywhere — drags and slants against
Cover 0, the post splitting Cover 2's safeties, corners against Cover 3 and 4.
Where it disagrees the data wins: the corner route, the textbook Cover 2 beater,
measures +0.08 EPA a target against Cover 2 and +0.74 against Cover 3.

## 5. Coverages

Seven shells, because the participation file names seven that matter (Cover 9
is folded into Cover 4). Each is a template of eleven jobs, set against the
offence's formation: who rushes, who has which man, who drops to which zone.

| coverage | deep | underneath | typical rush | weak to |
|---|---|---|---|---|
| **Cover 0** | nobody | man on every eligible receiver | 6–7 | anything quick: slants, drags, screens |
| **Cover 1** | one free safety, middle | man, plus a robber or rat | 4–5 | crossers, rubs, man-beaters |
| **2-Man** | two safeties, halves | man underneath, trailing | 4 | the deep middle, scrambles |
| **Cover 2** | two safeties, halves | five zones: two flats, two curls, the middle hook | 4 | the post between the safeties, the hole shot at 18 yds on the sideline |
| **Cover 3** | three: corners outside, safety middle | four: two curl-flats, two hooks | 4–5 | seams (four verticals), curl–flat, flood |
| **Cover 4** | four quarters | three: two flat-curls, middle hook | 4 | the short game and the flats, crossers |
| **Cover 6** | quarter–quarter–half | as Cover 4 to the quarters side, Cover 2 to the halves side | 4 | as each half |

**Zone landmarks** — where a dropping defender settles, in yards downfield
from the line of scrimmage and across from the ball:

| zone | depth | across |
|---|---|---|
| flat | 4–6 | outside the numbers, ±15 to sideline |
| curl | 10–12 | the numbers, ±12 |
| hook | 8–10 | between the hashes, ±5 |
| middle hook (Tampa) | 10, carrying to 15 | the middle |
| deep third | 15+ | outside thirds ±18, middle 0 |
| deep half | 15+ | ±10 |
| deep quarter | 12+ | ±20, ±7 |

A zone defender drops to his landmark, then drifts toward the nearest receiver
who comes into his area and stays between him and the goal line. A man
defender trails his receiver, a step behind and to the inside or outside as
his leverage says. A rusher goes for the quarterback.

## 6. The pass rush, and the clock it puts on the quarterback

The measured relationship (tables, *The pass rush*): pressure rises from about
26% of dropbacks with four rushers to 38% with five and 46% with six; under
pressure, a dropback ends in a sack 22% of the time, a scramble 7%, and of the
throws that are made 46% are complete against 70% clean, with 13% thrown away.

The engine models pressure as an arrival time. Each dropback draws whether the
rush gets home and, if so, when — earlier the more men rush against the men
blocking. Every route has a break time from the tables: a slant is ready at
1.9s, a dig at 3.0s. **A route that breaks after the pressure arrives is not
there to be thrown**, which is the whole of why a deep concept against a blitz
is a sack waiting to happen and a slant concept is not.

Protection is counted, not assumed: five linemen, plus any back or tight end
told to stay in. Each blocker beyond the rushers lowers the pressure rate, each
rusher beyond the blockers raises it — an unblocked rusher gets home almost
always and almost at once.

## 7. The quarterback's decision

He reads his progression in order. At each read's break time he looks at that
receiver; if the receiver is open enough, he throws. If not, he moves on, and
the next read costs time. When the rush arrives he either throws to the best of
what is there, throws it away, scrambles, or is sacked — in the measured
proportions.

**Open enough** is a value per route: what that route has been worth against
that coverage (the EPA-per-target table), plus a play-to-play spread for the
separation every route either gets or does not, plus the geometry correction
in §0 — a receiver with no defender within reach is open no matter what the
table says, and one with two is not. Against a blitz, the first quick route is
the **hot** read and is thrown early. On third down, a route short of the
sticks is worth less than one past them.

A quarterback's own numbers shape this: a high average depth of target looks
past his first read more often; a high sack rate holds the ball.

## 8. The running game

Seven gaps — left and right end, tackle and guard, and the middle. The tables
give each one its own distribution of yards: the edge is boom-or-bust (17% go
for ten or more, 21% are stuffed), the middle is steady. **Each defender in the
box costs about half a yard** — five in the box is +1.05 yards against the
average, eight is −0.71, nine is −2.05.

The engine draws a run's yards from its gap's measured distribution, shifts it
for the box the defence actually shows, and then for the two clubs: this
offence's yards a carry and this defence's, each as a ratio to the league's,
and the runner's own. A blitzer who rushes through the gap the run goes to
stuffs it more often; one who rushes another gap leaves one fewer man to make
the tackle.

## 9. How the computer calls plays

**On defence** it draws a coverage from the measured mix for the situation —
down, distance and whether it is the red zone (tables, *What defences call*) —
then bends it toward its own club's habit: a club that blitzes more than the
league shifts toward the coverages that blitz. The rush follows the coverage's
own measured spread. The box follows the offence's personnel: more receivers,
fewer men in it.

**On offence** it passes at the measured rate for the situation, bent by its
club's own lean on neutral downs and by the score late on — 81% when trailing
by four or more in the last ten minutes, 34% when leading. A pass picks a
concept whose routes match the measured route mix for that situation; a run
picks a gap from the measured shares, the middle more often on short yardage.

**On fourth down** it goes for it at the measured rate for the distance and
field position, kicks when in range, punts otherwise — and goes more often
when it is behind late.

## 10. Special teams and the clock

Field goals from the measured make rate by distance (98% inside 30, 72% from
50–54, 55% from 60+), bent by the kicker's season. Extra points 95%. Punts from
the measured net by field position. Kickoffs from **2026**, not 2025, because
the kickoff changed between them: a drive begins at the receiving side's 30 at
the median.

Each play takes the measured median off the clock — 39 seconds for a run, 38
for a completion, 5 for an incompletion. Quarters are short by default, because
this is practice.

## 11. Where the clubs' own numbers come in

Every one of these is a ratio to the 2026 league — 1.0 is average — shrunk
toward 1.0 by how little of it there is. Pseudo-counts in brackets.

| number | from | enters as |
|---|---|---|
| Offence's completion rate | attempts (120) | completion odds on every throw |
| Offence's sack rate | dropbacks (150) | pressure rate |
| Offence's yards an attempt | attempts (120) | yards after catch |
| Offence's interception rate | attempts (300) | interception odds |
| Offence's yards a carry | runs (80) | run yards |
| Offence's neutral-down pass rate | neutral plays (80) | the computer's run/pass call |
| The same six for the **defence**, allowed | | the same places, from the other side |
| Defence's blitz rate | charted dropbacks (120) | the computer's coverage and rush |
| Quarterback's completion, interception, sack rates and depth | his attempts | his throws, his reads |
| Receiver's catch rate and yards after catch | his targets | his catches |
| Runner's yards a carry | his carries | his runs |
| Defender's tackles, sacks, interceptions | his season | who is credited on screen |
| Kicker's makes | his kicks | field goal odds |

What every play shows afterwards is the arithmetic it used: the route, the
coverage, the measured rate for the pair, and each club's and player's ratio
applied to it. Nothing is a black box.

## 12. Calibration

*Since the kinematic world (Docs/PRACTICE-MOTION.md §7) the report also
sets the world's geometry beside Next Gen Stats, and the fit includes the
world's reaction delays, lead, threshold and batted-ball rate; the figures
below are the table engine's, before it.*

`make calibrate` plays the computer against itself — every club against
others, full fifteen-minute quarters, about 47,000 snaps — and sets the totals
beside the league's. The engine is not finished while they disagree.

Four sets of numbers in the engine are not measured but *fitted* by the same
script (`make calibrate ARGS=fit`, written to
`site/src/lib/practice/fit.json`), because they describe the quarterback's
habits, which no table records directly:

- **readBias** — how much more or less he looks to each route than its value
  says. Without it the engine threw slants and posts twice as often as the
  league and quick outs a third as often: expected points alone undervalue the
  route that is simply there. Fitted until each route's share of targets
  matches the league's to within a fifth.
- **cmpFix** — choosing among reads by how open they look means a route he
  rarely looks to is thrown only when it is wide open, and completes too
  often. This takes that selection back out, route by route.
- **cmpClean / cmpPressured** — the same, split by whether the rush arrived:
  70% clean, 46% pressured, as measured.
- **nobody** — what he does when the progression finds no one: sack,
  scramble, throwaway or forced throw, fitted so that pressured dropbacks end
  in a sack 22% of the time, a scramble 7%, a throwaway 13%.

Three things the first runs got wrong, and why, since each looked right in
isolation:

- **The tails.** Distributions were stored as twenty-one quantiles with the
  season's minimum and maximum at the ends, and drawn by straight lines
  between them — so every run in the top twentieth averaged forty yards, and
  yards a carry came out at 5.3. The end points are now the *mean* of the
  outermost twentieth, drawn as an exponential tail (pipeline/practice.py
  `quantiles`, engine.ts `sampleQ`).
- **The box.** The one-high strong safety stood inside the box on every
  snap, so eight-man boxes were twice as common as the league's and runs
  lost half a yard. He now walks down only against an under-centre set.
- **Protection.** The pressure-by-rushers table already contains a typical
  protection; counting the five linemen against it again doubled the effect
  of a blitz.

Where it stands (400 games):

| measure | engine | league |
|---|--:|--:|
| completion % | 63.2 | 64.6 |
| yards an attempt | 6.85 | 7.16 |
| interception % | 1.9 | 2.2 |
| sack % of dropbacks | 6.4 | 5.8 (2026) · 6.4 (2025 tables) |
| pressure % | 28.6 | 29 |
| yards a carry | 3.95 | 4.12 |
| points a drive | 2.01 | 2.00 |
| third-down conversion | 39.8 | 39 |
| punts a team-game | 3.9 | 3.9 |

Completion and yards an attempt sit a little under the 2026 figures because
those are club totals and the engine is fitted to the 2025 participation
tables, which define an attempt slightly differently; measured the same way,
clean and pressured completion match to the point.

The report also draws the first forty games' plays (choreo.ts) and checks
that nobody in the picture moves faster than a man can — ten yards a second
is the fastest anyone is timed at in a game, and the picture's top speed is
9.3. It once had defenders crossing the field at thirty yards a second and
more, every one of them doing what the picture had been told to: be the
tackler, at the spot, at the whistle, however far away he started. Two fixes:
the run is now timed so the tackler can get there at a run, and the engine
credits tackles by who could plausibly have been there — the defender's zone,
his man, his rush lane — as well as by his season.

Clubs separate as they should: the club with the best rates beats the club
with the worst about three times in four, by ten points; two mid-table clubs
split about 60–40.

## 13. The screen

`/practice/?team=KC&vs=BUF` — opened from the Practice button on a club's
page, beside Compare, through the same picker. `&q=8` sets the quarter length
in minutes (default 5); `&seed=` replays a game exactly, for testing.

The field and one panel beside it (under it, on a narrow screen). Nothing is
put over the field: it is the thing being watched, so everything the user
reads or chooses is in the panel. The one exception is the break between
quarters — a dialog with the score, a field in miniature with the crests in
the ends each club defends and an arrow the way the user now attacks — since
the ends change every quarter and without it the next snap simply faces the
other way. At the half it comes before the second-half kickoff is drawn.

- **Before the snap** the panel opens with the other side — what it is
  showing (its formation, or its shell: one deep safety or two, the one thing
  a real quarterback can read before the snap) and its season in the numbers
  the engine uses — and then the user's calls, as dropdowns: Formation and
  Play on offence, Coverage and Rushers on defence, each with a line saying
  what the choice is. Each snap they open on the league's most common call
  for the situation — the computer's own draw (§9) with the dice taken out:
  the commonest coverage for the down, distance and red zone and its
  commonest rush; on offence, a pass or a run by the measured pass rate, from
  the gun or under centre by the measured shotgun rate, and the concept that
  looks most like what the league threw there.
- **On offence the defence waits in its huddle** while the user calls the
  play, ten yards off the ball. **Line up** sends it jogging to its spots —
  set against the formation the user has chosen — and only then does it show
  its shell and the button become **Snap**. A shift or an audible after that
  is still allowed, and the defence realigns to it. On defence there is no
  such step: the offence lines up first on a Sunday too.
- **A player** tapped on the field goes into the panel: his season, and, if
  he is the user's, his job — a Route dropdown and "make him the first read"
  for a receiver, a Job dropdown (rush, man on any eligible, any zone) for a
  defender. Dragging a receiver moves him, and the defence realigns to where
  he now stands. Hovering shows a player's season as a label beside him.
- **The snap** is drawn out (choreo.ts), consistent with what the engine
  decided and never adding to it, and the bug holds the score and the down as
  they were at the snap until the play is over.
- **Kicks are drawn too**, though nobody calls them (specials.ts): every
  kickoff — in the 2025 rules' alignment, the coverage at the receiving 40,
  nine in the setup zone, two deep, nobody moving until the catch — every
  punt, field goal and extra point. They queue after the snap that set them
  off: a touchdown, then its extra point, then the kickoff.
- **A place kick is drawn to read true from above.** A ball in the air is
  lifted up the screen by its height and the posts are drawn on the ground,
  so a kick comes down to just over the bar as it reaches them, aimed so it
  is drawn between the uprights when good and clear of them when not, and
  the camera may run past the end line to see it land.
- **Between plays** the picture is not cut, as the replay's is not: the
  line of scrimmage and the line to gain slide to their new spots (the gold
  one fading in or out when there is none, after a kick or goal to go), the
  camera and the ball with them, and the men who stay on walk from where the
  play left them to where they line up. When the units change — after a kick,
  or a change of possession — the men going off run off the top of the screen
  and their replacements run on from it. A new quarter is cut, under the
  break, since the ends change. Off for anyone who asks for less motion.
- **After the play** the panel gives the result, the other side's call, and
  the arithmetic that decided it.
- **Fourth down** offers go, kick or punt, with the league's go-rate and the
  kicker's chance; the computer decides its own.
- It is closed while spoilers are off: every club is played as its season
  says it plays.

## 14. What it does not do

- **Penalties.** None are called. They are 7% of plays and would be the next
  thing to add.
- **Injuries, fatigue, substitutions.** The lineup is the lineup.
- **Timeouts and the two-minute warning.** The clock runs on its medians.
- **Individual coverage skill.** Nothing public measures a cornerback's coverage
  play by play, so a man matchup is decided by the receiver's catch rate and the
  defence's completion rate allowed, not by who is covering him.
- **The 2026 coverage mix of a particular club.** Participation is not yet
  published for 2026, so a club's coverage tendencies are the league's, bent
  only by its measured blitz rate.
