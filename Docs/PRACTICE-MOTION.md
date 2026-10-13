# Practice mode: movement, timing and sight

An analysis of how fast everything moves in practice mode, how that relates
to the simulation engine, and a design for making the engine itself
kinematic — so that speeds, positions and what each player can see decide the
outcome, rather than being drawn after it.

Companion to [PRACTICE.md](PRACTICE.md) (the knowledge base) and
[PRACTICE-TABLES.md](PRACTICE-TABLES.md) (the measured 2025 tables).

## 1. How it works today

Two separate models meet at a few fixed points.

**The engine** (`site/src/lib/practice/engine.ts`) decides the result from
the measured tables. For a pass:

- each receiver's route "breaks" at the route's median time to throw;
- each gets a value: the route's expected points against the coverage, plus
  a random term — the receiver's *openness* — plus a geometric term;
- the quarterback works his reads in order and throws to the first value
  over a threshold;
- completion probability is the route-against-coverage rate, moved by the
  clubs' and players' rates and by `exp(0.45 × openness + 0.09 × geometry)`;
- air yards and yards after the catch are drawn from the route's
  distributions.

The geometric term compares the nearest defender to the receiver against the
same comparison for a textbook alignment, using defenders standing still on
their zone landmarks or a fixed 1.6 yards behind their man. It is zero unless
the user edits a job or moves a receiver.

**The picture** (`choreo.ts`, `specials.ts`) then moves twenty-two dots so
that the engine's fixed points come true: the throw time, the catch spot, the
spot the carrier goes down, who made the tackle. Speeds are constants:

| who | doing what | speed (yd/s) |
|---|---|--:|
| receiver | any route, any point of it | 7.0, constant, no acceleration, no cost to cut |
| cornerback in man | trailing his man | 7.3 |
| zone defender | dropping and sitting | 5.6 |
| any coverage defender | after the throw, toward the catch point | 6.6, after 0.25 s |
| pursuit | toward the ball-carrier | 6.4 |
| defensive lineman | engaged | 2.5 |
| blitzer | to the line | 5.0 |
| back | to the hole, then to the spot | 7.2, then 6.3 |
| anyone | ceiling since the last fix | 9.3 |

## 2. Measured against the league

Next Gen Stats — the league's tracking-derived aggregates, published by
nflverse up to 2023 — give the quantities the two models have to agree on.
`.cache/research/ngs/` holds the 2023 files and `ngs_targets.txt` the
figures below. 19,356 simulated snaps, eight clubs:

| | ours | NFL (NGS 2023) |
|---|--:|--:|
| time to throw | 2.88 s | 2.81 s |
| ball travel distance (release to catch) | 21.6 yd | 21.2 yd |
| cushion at the snap, WR | 6.8 yd | 6.3 yd |
| separation at the catch, WR | 2.1 yd | 2.9 yd |
| separation at the catch, TE | 1.5 yd | 3.4 yd |
| throws into a window under a yard | **64%** | **14.6%** |
| a back's time to the line of scrimmage | **1.6 s** | **2.8 s** |

And the internal consistency — whether the picture agrees with the result:

| | completions | incompletions | interceptions |
|---|--:|--:|--:|
| median separation at the catch | 0.8 yd | 0.7 yd | **1.6 yd** |
| share with a defender inside a yard | 61% | 72% | 46% |
| share with nobody within four yards | 17% | **10%** | 30% |

Completion rate by the separation the picture shows rises only from 67% (under
a yard) to 79% (over six). Across NFL receiver-weeks, a yard of separation is
worth about five points of catch rate even after controlling for depth:

    catch% = 60.9 + 5.06 × separation − 1.09 × intended air yards

— and that is a season-average relationship, which understates the
throw-by-throw one.

Finally, where the engine's air yards put the catch against where the route
actually is at that moment: 4.5 yards apart at the median, 14 at the 90th
percentile. The picture bends the route to make the catch.

## 3. What that means

The timing and the distances are right; the *geometry* is not. Three
separate faults, one cause.

1. **Everyone converges on the ball.** Every coverage defender breaks on the
   catch point a quarter of a second after the throw, at the same speed, and
   man defenders trail their man at a yard. So nearly every catch is
   contested in the picture, when in the league one in seven is.
2. **Openness is a dice roll, not a place.** The engine's openness is a
   random number per receiver. It is calibrated — completion rates by route,
   coverage, pressure and depth match the league — but it is not *located*:
   nothing on the field is open or covered because of where anybody is, so
   the picture cannot show it, and the user's choices can only move the result
   through the small geometric term.
3. **Depth and route are drawn separately.** Air yards come from the route's
   distribution regardless of when the ball is thrown and where the receiver
   is then.

The cause is the architecture: the result is decided first, by tables, and
the movement is drawn afterwards to fit. Making the drawing faithful would
mean deciding the result *from* the movement.

## 4. A kinematic engine

The proposal: one time-stepped simulation that both decides and draws the
play. The measured tables stop being what the result is sampled from and
become what the simulation is fitted to — as the quarterback's habits already
are (`fit.json`, PRACTICE.md §12). Nothing measured is lost; it moves from the
output to the calibration.

### 4.1 Bodies

Every player gets a top speed and an acceleration by position, and a cost to
change direction:

| | top speed (yd/s) | acceleration (yd/s²) |
|---|--:|--:|
| WR, CB, S, RB | 9.0–9.5 | 4.0 |
| TE, LB | 8.3–8.8 | 3.6 |
| QB | 8.0 | 3.4 |
| DL edge | 8.3 | 3.4 |
| DL interior, OL | 7.0 | 3.0 |

These are representative of NGS in-game maxima (the fastest ball-carriers
reach 21–22 mph, about 10 yd/s; linemen 15–18 mph) and are the parameters the
calibration will refine. A cut costs speed in proportion to its angle — a
90° break sheds about a third, a 180° comeback nearly all of it — which is
where routes win: the receiver knows when he will cut and the defender
does not.

### 4.2 Routes against coverage

A receiver runs his route as a path, accelerating and cutting. A man defender
plays leverage — inside or outside, over the top or underneath, given by the
coverage — and reacts to each cut after a **reaction delay**. Separation at
the break is the receiver's speed over that delay, less what the defender's
cushion and leverage give back. Zone defenders drop to their landmarks at
backpedal speed and take the receiver who enters their area.

This is where the route-against-coverage table comes back in: the reaction
delays, leverage depths and cut costs are fitted so that each route's
completion rate and air yards against each coverage come out as measured,
and so that separation at the catch averages 2.9 yards for a receiver and
3.4 for a tight end, with one throw in seven into a window under a yard.

### 4.3 Lines of sight

What each player can see is a large part of the passing game, and it can be
modelled directly:

- **The quarterback looks at one read at a time.** He faces it; moving his
  eyes to the next takes a few tenths of a second (today's 0.3 s, now with
  something to see). He throws when the man he is looking at has a window —
  measured, not rolled — and the ball would get there before it closes.
- **Zone defenders watch the quarterback.** They drift toward where he is
  looking, and break on the throw after a short delay. This is eye
  manipulation: a quarterback who looks the safety off opens the other side,
  and the progression order the user sets begins to matter for real.
- **Man defenders watch their man.** With their backs to the ball they react
  to the throw late — when the receiver's hands go up — which is why man
  coverage allows tight completions and gets fewer interceptions than zone
  defenders breaking downhill. That is measurable in the tables (interception
  rate by coverage) and is what the delay is fitted to.
- **Throwing lanes.** For a candidate throw, the ball's path from the release
  point to the catch point is checked against every defender near it: an
  underneath defender in the lane forces a higher, slower throw or a pass
  breakup; a lineman near the release point bats it down (about one pass in
  sixty-five league-wide).
- **The receiver's view of the ball.** A ball over the shoulder on a vertical
  route is harder to catch than one thrown at the chest on a hitch — a catch
  difficulty term, fitted to completion by depth.

### 4.4 The ball

A projectile, launched at the passer's release speed (about 50–55 mph,
24 yd/s, for a league-average arm), at the angle that gets it to the catch
point — higher for touch over a defender, flatter for a bullet. The quarterback
throws to where the receiver *will* be (he leads him), the flight time comes
from the trajectory, and the catch point falls on the route. Depth stops being
drawn from a distribution; it emerges from when the throw is made, and is
fitted back to the route's air-yard distribution.

### 4.5 The catch

At the moment the ball arrives:

    P(catch) = logistic(base(route, coverage) + a × separation + b × skill
                        − c × difficulty − d × pressure)

with the defender's position relative to the ball deciding what an
incompletion is — a breakup if he is between, an interception if he is between
and facing it, a drop or an overthrow otherwise. `a` is fitted to the NGS
slope and the tight-window share; the base to the route-against-coverage
completion table, as now.

### 4.6 After the catch, and the run

Yards after the catch become a pursuit: the carrier runs away from the nearest
defenders; each who reaches him tackles with a probability fitted to missed
tackles and to the route's YAC distribution (and to NGS expected YAC, about
3.9 yards for a receiver). The tackler is whoever actually gets there — the
credit problem fixed in the last round disappears.

The running game keeps its measured gap distributions for now — blocking is
the least observable part of the game — but its timing follows the NGS
figure: 2.8 seconds to the line, not 1.6.

### 4.7 The rush

Each rusher against his blocker gets a time to win, drawn from the measured
pressure rates by rushers and the clubs' sack rates; an unblocked rusher has
none. The rusher's path to the quarterback is then physical, so pressure
arrives where he is, the pocket moves, and a sack happens when a rusher
reaches the quarterback with the ball still in his hand.

## 5. What it would take, and what it would not change

- **Calibration does the heavy lifting.** `make calibrate ARGS=fit` grows from
  four sets of numbers to perhaps a dozen: reaction delays by coverage,
  leverage, cut costs, the catch model's coefficients, missed-tackle rates,
  rush win times. The targets are the tables already measured plus the NGS
  figures above. The report gains the separation and timing rows in §2.
- **The club and player numbers keep their place.** A receiver's catch rate
  and yards after the catch, a quarterback's completion and interception
  rates, a defence's completion and sack rates all still enter — as skill
  terms in the catch and tackle models, as the passer's release speed and
  accuracy, as rush win times — rather than as multipliers on a sampled
  outcome.
- **The user's calls gain real consequences.** A flood against Cover 3 opens
  the flat because three receivers are in two defenders' areas, not because a
  table says so; a receiver moved in tight runs a rub; a blitz leaves a man
  open and the hot read finds him.
- **Speed.** A play is about 150 steps of 22 bodies; the harness plays 47,000
  snaps for calibration, which is seconds either way.
- **Risk.** It is a rewrite of the passing engine. Built behind the existing
  interface (`resolve()` returns the same `Result`), with the current engine
  kept until the new one matches the league as well on every row of the
  calibration report.
- **Data limits.** No play-level tracking for 2025 or 2026 is public; NGS
  aggregates stop at 2023. The league's Big Data Bowl releases tracking for
  selected past weeks under Kaggle's terms, which would pin the reaction delays
  and speeds precisely, but its licence would need checking before it is used.

## 6. Order of work

1. Bodies and the ball — speeds, acceleration, cuts, the projectile — and the
   running game's timing. Calibrated to the NGS timing figures.
2. Coverage behaviour and lines of sight — leverage, reaction delays, eyes on
   the quarterback or on the man, throwing lanes.
3. The catch model and the quarterback's decision moved onto the geometry;
   the fit extended; the old pass engine retired when the report matches.
4. Pursuit and tackling after the catch; then the rush as matchups.

Each step is checked by the calibration report before the next begins.

## 7. Steps 1 and 2: done, and where they stand

Built in `site/src/lib/practice/world.ts`; the engine runs every pass play
there before deciding it (`engine.ts` `resolve`), and the picture draws the
world's own frames up to the catch (`choreo.ts`).

**What the world does now**

- Bodies with top speed and an acceleration that falls off with speed — two
  and a half times as hard from a standing start as at full speed — and
  braking that is stronger than starting, so a defender can plant and drive.
  A receiver's ten-yard split is 1.7 s, his forty 5.4 s at route pace.
- Routes run at a fitted share of top speed (0.8), each cut costing speed in
  proportion to its angle; outs stop at the sideline, verticals run up it.
- Man coverage: off the ball the defender gives ground for a second, then
  turns and runs; he reacts to the receiver's cut after a delay; leverage by
  coverage (over the top and inside in Cover 1 and 0, trailing underneath in
  2-Man). After the throw he plays the man, a yard and a bit off him.
- Zone coverage: defenders drop to their landmarks, lean toward where the
  quarterback is looking (eye manipulation), take one receiver each — the
  closest pairs first, so two never sit on one man — and wall him through
  their area rather than follow him out of it. Deep defenders stay over the
  deepest man. After the throw they break to make the play from a yard off.
- The quarterback looks at one read at a time, in the called order, from
  when it is ready (the receiver out of his break, and not before the
  league's rhythm for the route); he sees the window — where a ball thrown now
  meets the man, and how close each defender can get by then given what his
  eyes let him react to — and throws when it is worth it; a route whose
  window in time has passed is no longer the throw.
- The ball is a projectile at 24 yd/s, led to where the receiver will be by a
  fitted share of its flight (per route, fitted to the league's air yards);
  the receiver adjusts to it. Throwing lanes are checked while the ball is
  low enough to reach, and a lineman whose hands are in its path at the line
  bats it down.
- The catch: the measured route-against-coverage rates, moved by the
  separation at arrival (and anyone in the lane) — five points a yard, as Next
  Gen Stats has it — with the nearest defender the man who breaks it up or
  picks it off. The run game's timing follows NGS: 2.8 s to the line.

**Against the league** (`make calibrate`, 400 games; NGS is 2023):

| | engine | league |
|---|--:|--:|
| separation at the catch, WR | 3.48 | 2.86 |
| separation at the catch, TE | 2.97 | 3.37 |
| throws into windows under a yard | 21.9% | 14.6% |
| cushion at the snap, WR | 6.85 | 6.31 |
| time to throw | 2.63 s | 2.81 s |
| ball travel distance | 20.3 | 21.2 |
| intended air yards | 7.55 | 7.85 |
| a back's time to the line | 2.80 s | 2.78 s |
| batted passes | 1.3% | 1.3% |
| completion against separation | 5.0 pts/yd | 5.1 |
| air yards by route, median | within a yard on 11 of 13 | — |
| pressured: sack / scramble / away | 21.6 / 6.9 / 13.8% | 21.9 / 7.0 / 13.4% |
| interception % | 2.3 | 2.2 |
| points a drive | 1.99 | 2.00 |
| yards an attempt | 6.57 | 7.16 |

Where it started this round: 64% of throws into windows under a yard,
completions no more open than incompletions, receivers four and a half yards
off their routes at the catch, backs at the line in 1.6 s.

**What is still off, and why**

- *Separation is a little high on average and too often under a yard* — the
  distribution is too wide: zone coverage still leaves some throws (drags,
  screens, the Cover 2 hole) far more open than the league's, and the
  defenders who do arrive arrive tight. The reaction delays the fit uses sit
  at their physical floors (0.12 s; a zone defender reading the windup, 0),
  so what remains is zone behaviour — pattern-matching rules in step 2's
  successor, or in step 3's catch model.
- *Yards an attempt* is 0.6 short: completion is fitted to the 2025
  participation tables, which put a pressured or thrown-away attempt in the
  denominator the 2026 club totals partly do not; and yards after the catch
  are still drawn from the tables (step 4 makes them a pursuit).
- *Sacks* run at 6.7% of dropbacks against 2026's 5.8%; the 2025 tables
  imply 6.4%.

## 8. After the catch, and the end of the field

**Yards after the catch are a pursuit now** (world.ts `afterCatch`) — what
was step 4. Drawn from the route's table, a receiver could be given thirty
yards with three defenders round him, and the picture ran him through them.
Now the carrier runs for the goal line, turned away from the defenders in
front of him and off the sideline; every defender takes a pursuit angle to
where he is going; teammates near him block the nearest pursuer. Every
contact, at arm's length, is a tackle attempt, made with a fitted probability
moved by the receiver's own yards after the catch and the defence's; a missed
tackle costs the carrier speed and leaves the defender beaten for a moment.
Making the catch costs the receiver half his speed — without that, a deep
ball was a footrace he always won. The tackler credited is the man who made
the tackle in the world.

| | engine | league |
|---|--:|--:|
| yards after the catch, a completion | 5.74 | 5.17 (2025 tables) |
| yards an attempt | 7.20 | 7.16 |
| points a drive | 2.03 | 2.00 |

Still to do: the distribution is too binary — most catches are tackled at
once (route medians of 0–1 yards against the league's 2–3) and the rest run
long — and broken tackles are 2% of attempts against a league figure nearer
ten. Forward progress on contact and a less perfect carrier would both help.

**The end of the field.** Routes are cut off at the back of the end zone —
a post becomes a skinny in along it, a go a fade that stops there — and
nobody, in the world or the picture, goes past it; the pre-snap drawing uses
the same rule. Near the goal line the defence compresses: alignment depths,
the corner's backpedal and every zone drop shrink with the field left in front
of the end line. Across 390 goal-to-go passes nobody leaves the field.

Inside the ten the engine scores on 36% of goal-to-go passes (league 39%) but
completes 63% (league 52%): separation there is no tighter than in the open
field (3.6 yards), when it surely is in the league — but Next Gen Stats does
not publish separation by field zone, so there is no figure to fit it to.

## 9. Step 3: the catch, on the geometry

The catch is no longer the route-against-coverage completion rate nudged by
separation. It is decided the way a catch is, in three stages, each from what
the world shows and each fitted to FTN's charting of 2025's passes
(pipeline/practice.py writes the figures as `league.json` → `catch`):

1. **On target?** At the release. The league's rate for the depth and the
   pressure (FTN: 86% of balls behind the line catchable from a clean pocket,
   47% of those thrown twenty yards and more; 71% and 41% under pressure),
   moved by the passer's accuracy, his team's, the defence's, the window he is
   throwing into, and a fitted figure for each route. A throw off target is
   thrown off target: long more often than short, sometimes wide, and the ball
   goes there while the receiver works to where it should have gone.
2. **Contested?** At the arrival, and pure geometry: a defender within a
   fitted distance of the ball — 0.7 yards — counted whether the ball was on
   target or not, as FTN counts it.
3. **Who wins?** Contested and catchable: the receiver's hands against the
   defender's position, at FTN's 69.5% moved by the receiver's catch rate,
   the defence's, and how close the defender is; lost, it is broken up, now
   and then picked. Open and on target: caught at FTN's 92.7%, the rest
   dropped. Off target: picked off if a defender is where it came down —
   which is how nine interceptions in ten happen — and caught anyway one time
   in seventy-five.

The picture shows which: a breakup knocked away from the defender who got a
hand to it, an overthrow landing clear of the receiver, a drop falling at his
feet. The panel says it in words, with the arithmetic.

The quarterback's progression is first read, second read, then the checkdown
(the called order's last), then anyone else; the first read and the
checkdown carry fitted bonuses, toward FTN's shares of throws by read.

The table engine's last pieces are gone: the constant-speed route function,
the picture's own catch-point solver, and the fitted completion corrections
it needed (`cmpFix`, `cmpClean`, `cmpPressured`, the separation
coefficients).

**Against FTN 2025 and the league** (400 games):

| | engine | FTN / league |
|---|--:|--:|
| on target | 74.7% | 74.1% |
| on target, clean / pressured | 78.4 / 59.4% | 78.0 / 60.0% |
| on target by depth: behind / 1–9 / 10–19 / 20+ | 88 / 84 / 67 / 45% | 83 / 81 / 65 / 45% |
| contested | 13.8% | 13.8% |
| contested and catchable, caught | 71.6% | 69.5% |
| open and on target, caught | 93.3% | 92.7% |
| dropped, of catchable | 5.6% | 5.6% |
| completion by route | every route within 3 points | |
| completion / interception | 62.7 / 2.0% | 64.6 / 2.2% |
| yards after the catch | 5.12 | 5.17 |
| points a drive | 1.97 | 2.00 |

**Still off, and why** — all of it the shape of the coverage, not the catch:

- *Contested by depth*: 24% of short throws against FTN's 13%, 4% of
  intermediate ones against 21%. Short routes — the hitch above all — still
  have a defender sitting on them, and the Cover 2 hole and the dig are still
  too open.
- *Man against zone*: 15% of balls against man contested (FTN 20%), 14%
  against zone (11%); and man coverages complete 64–69% where the league's
  complete 58–64%, zone 64–69% against 67–73%. Man defenders trail a little
  loose and zone defenders squeeze a little tight.
- *Reads*: the second read gets 20% of throws against FTN's 11%, the first
  54% against 58% (68% with designed throws).
- *Completion against separation* is 1.5 points a yard against NGS's 5.1:
  with the catch now decided by contest or not, separation beyond the
  contest radius matters little. NGS's figure is season-level and so not a
  clean target; and fitted through the accuracy of tight windows, it gutted
  the hitch. It is reported, not fitted.

These point to the next round: pattern-matching zone rules and man leverage,
fitted to FTN's contested shares by depth and by man and zone.

## 10. Zone pattern-matching and man leverage

Fitted, each, to FTN's contested shares — by depth (behind the line 3%,
1–9 yards 13%, 10–19 21%, 20+ 24%) and against man (20%) and zone (11%).

**What was done**

- *Man defenders run with their man.* They used to steer to a spot and brake
  to stop on it; with the spot moving with the receiver, a corner stood still
  at nine yards while his man ran past him, and trailed every route that
  broke after it. Now he matches his man's velocity and closes on his
  leverage spot (`pursue`). On a go route he runs stride for stride, a yard
  off.
- *He reads speed at once and direction late.* A receiver sinking his hips is
  visible straight away; where he is going next only after the reaction
  delay. Receivers slow into sharp cuts to the speed they come out at.
- *Cushion.* Off the ball a corner backpedals for the first second, keeps a
  cushion the receiver eats up (three yards shrinking to one by two seconds)
  against where the man will be, and comes off it as the receiver sinks into
  his break; in 2-Man there is none — he trails underneath.
- *Inside leverage is held*; how far over the top is fitted (`manT`).
- *Safeties rob*: with no vertical threat in his area, a deep defender comes
  down on the route seven yards and more in front of him (`rob`, fitted).
- *Screens are read*: an underneath zone defender drives on a receiver in
  front of him who stays behind the line.
- *Braking* is 9.5 yd/s² for a back, the top of what tracking shows.
- *Reaction delays are set, not fitted*: 0.28 s to a cut, 0.15 s for a zone
  defender reading the windup, 0.35 s for a man defender with his back to the
  ball. Fitted to NGS's average separation — which the world's screens and
  swings pull up — they went to their floors and made every corner drive on
  every hitch at once.
- *The read biases are held to a mean of nought*: shifted together they
  change nothing the threshold could not, and left free they dragged it to
  its floor and the passer found nobody open twice as often as the league's.
- Tried and withdrawn: fitting the underneath zones' depth to short
  contested balls — those are man coverage's, and it sank the hook and curl
  defenders to twenty yards.

**Where it stands** (400 games)

| contested | before | now | FTN |
|---|--:|--:|--:|
| behind the line | 1% | 4% | 3% |
| 1–9 yards | 24% | 18% | 13% |
| 10–19 yards | 4% | 8% | 21% |
| 20+ yards | 19% | 27% | 24% |
| against man | 14.5% | 9.1% | 19.9% |
| against zone | 13.5% | 15.3% | 11.1% |

Completion by coverage, engine against FTN: 2-Man 67/61%, Cover 0 67/58%,
Cover 1 68/60%, Cover 2 66/73%, Cover 3 66/71%, Cover 4 64/68%, Cover 6
67/67%. The league is twelve points easier to complete against in zone
than in man; the engine has the two level, as it did before this round.

Everything else holds: on target 73.6%, contested 13.5%, contested and
catchable caught 69.4%, completion 62.0%, interceptions 2.4%, yards an attempt
7.30, points a drive 2.01; nobody faster than 9.3 yd/s.

**Why man coverage is still too easy**

On every route that breaks — the dig most of all, never contested — a man
defender is carried past the break. Over the top by design in Cover 1, a
reaction late on the direction, at full speed: he arrives a yard or two
behind where a real corner is, and a real corner contests the dig a fifth of
the time. The fitted over-the-top depth went to its floor and the robbing
safety to its ceiling without closing it. What is missing is the thing a
corner actually does — he reads the route from the stem and the formation,
and is moving to the break before it comes. That is route recognition, and
it is the next piece: each route's break, recognised from the receiver's stem
with a probability that is fitted, and played early when it is.

## 11. Route recognition

The piece §10 ended on. A man defender now reads his man's route from the
stem, and plays the break before it comes.

**What was done**

- *Route recognition.* Each man defender gets a draw at the snap; under the
  fitted chance (`recog`), he reads the route. From 0.35 s before the break
  (`jump`) he plays the route itself — where his man is going a moment
  ahead — rather than where he was a reaction ago, and closes to half a
  yard inside and less than half a yard over the top. A go has no break to
  read, and a route broken at the line gives him nothing.
- *Turning.* Speeding up along the way a player is going is the slow part of
  moving, and tapers toward top speed; slowing down and changing direction are
  what a planted foot does, up to the braking limit, together. Turning used
  to come out of the speeding-up budget, so a corner at full speed could
  hardly turn: even reading the dig perfectly, he ran two or three yards past
  it. This applies to everyone, and it took a yard and a half off yards after
  the catch until tackling was refitted (0.98 → 0.87).
- *In phase on a go.* Past the stem, a corner on a go runs hip to hip rather
  than over the top.
- *Over-the-top depth is held as taught* (`manT` 1). Fitted alongside
  recognition — two ways of playing tighter, one number to fit them to — it
  went to its floor and had every corner trailing in the stem.
- *Where the passer throws against man.* Against man the league throws
  deeper (8.9 yards in the air against 7.4) and seldom behind the line (16%
  against 23%). The read biases had one value a route; there is now a second
  for man coverage (`manBias`), fitted to each route's share of the league's
  targets against man, and held to a mean of nought.
- *Tried and withdrawn:* fitting how much a tight window costs a throw's
  accuracy (`kwin`) to FTN's ten-point gap in on-target rate between man and
  zone. It went to its ceiling, closed less than half the gap and took a tenth
  off every route's accuracy — the engine's windows against man are not
  tighter enough for the gap to come from there.

**Where it stands** (400 games)

| | §10 | now | league |
|---|--:|--:|--:|
| contested against man | 9.1% | 18.6% | 19.9% |
| contested against zone | 15.3% | 11.7% | 11.1% |
| completion against man | ~67% | 61.4% | 59.4% |
| completion against zone | ~66% | 69.9% | 70.9% |
| on target against man | — | 68.8% | 67.7% |
| on target against zone | — | 76.6% | 77.4% |
| air yards against man | — | 9.3 | 8.9 |
| air yards against zone | — | 7.0 | 7.4 |
| contested, 10–19 yards | 8% | 12% | 21% |
| contested, 20+ yards | 27% | 11% | 24% |

Man coverage is now the harder to complete against, by eight and a half
points to the league's eleven and a half. Completion 63.0%, yards an attempt
6.81 (7.16), points a drive 1.95 (2.00), yards after the catch 5.15 (5.17);
nobody faster than 9.7 yd/s.

**Still open**

- The fitted chance of reading a route is at its ceiling, 0.95: even with
  nearly every route read, man coverage is only just contested often enough.
  A read corner is still a yard or two off on the dig, because the receiver
  comes out of the break at full speed and the corner has to turn and
  accelerate after him.
- Intermediate and deep balls are contested half as often as FTN has them —
  and deep ones less than in §10, now that corners on a go are no longer
  trailing (contested deep balls before were trailing corners). Most of what
  is missing is zone's: deep defenders playing over the top, a yard and a
  half off at the catch.
- Behind the line the engine throws a third less often than the league
  against both man and zone, and separation at the catch is 4.1 yards (2.86).

## 12. The deep zone round — and what the ball in the air was hiding

FTN's contested shares, split by depth and by man or zone, are now in the
tables (`catch.byMZ`), and they showed the problem was not only the deep
zones:

| contested | man, engine (§11) | man, FTN | zone, engine (§11) | zone, FTN |
|---|--:|--:|--:|--:|
| behind the line | 32% | 4% | 2% | 2% |
| 1–9 yards | 25% | 20% | 14% | 10% |
| 10–19 yards | 10% | 26% | 14% | 18% |
| 20+ yards | 10% | 28% | 14% | 22% |

Traced throw by throw, a man defender was within a yard of his man at the
throw on go routes, posts, slants and corners — and four to seven yards off
at the catch. The coverage was right; the ball in the air was wrong.

**Fixed**

- *The receiver under the ball moved without legs.* His velocity was set
  outright to arrive with the ball: under a ball led short he went from full
  speed to half in a frame, and his man ran three yards past him. He now
  steers within the same limits as everyone, and stays inside the sideline
  (carried past a ball thrown to the boundary, he had run out of bounds and
  been snapped back in by the picture — the 49 yd/s spikes).
- *The man defender couldn't see him leave his route.* Until he turned for the
  ball he followed the route as planned, while his man pulled up under it. He
  now sees his man as he actually goes, with the same delays as before the
  throw, and after it runs with him (velocity-matched) instead of steering at
  where he is and braking to stop on it.
- *In the stem a corner matched only part of his man's speed* — at a second
  and a half he was moving at a quarter of it and was run past before every
  break. He now matches it and keeps his cushion by where he stands.
- *Robbing fired on go routes*: a deep defender came down on any receiver
  seven to fourteen yards in front of him, including one still running at him
  at full speed. Only a route that has broken off is robbed now.
- *Deep defenders take the deepest threat in their area first*, not the
  nearest man, and run with him on top rather than steering at a spot.
- *Route recognition* plays where the man will be half a second on, and is
  only for routes that break seven yards or more downfield — a hitch, a quick
  out, a slant are on a corner before the stem has told him anything.
- *Screens.* A called screen is a designed throw: it goes when it is set up
  unless a defender is already on it, and a screen to a receiver on the line
  goes as soon as he turns (the league's screen time is the back's, who waits
  for the rush). Blockers now take the defenders nearest the man it is thrown
  to. Receiver screens had been thrown at 3.2 seconds for no yards. Once
  called a screen is thrown, so how often the computer calls one is now
  fitted (`screenCall`, 0.45) to the league's share of screen targets.
- *When each route is thrown* is fitted, route by route (`tOff`), to its
  median time to throw in 2025. All but two now match: the go (2.9 s against
  2.6) and the post (3.7 against 2.7).
- *Recognition and the go each have their own target*: recognition toward
  FTN's contested intermediate balls against man (26%), how far over the top
  a corner runs in phase on a go (`phase`) toward its deep ones (28%).
- *Tackling* is fitted within one tackle in four broken and one in thirty.

**Tried and withdrawn**

- *Planting to reverse* — braking before turning when a player wants to go
  back the way he came. It cured a deep third swinging round in a five-yard
  arc, but the cause of that was the robbing rule; and in the run after the
  catch it took a yard and a half off yards after the catch, until the fit
  had two tackles in five broken to make it up.
- *Fitting the speed a receiver keeps through the catch* to yards after the
  catch: it went to its floor, a quarter of his speed.

**Where it stands** (400 games)

| | §11 | now | league |
|---|--:|--:|--:|
| contested, behind the line | — | 2% | 3% |
| contested, 1–9 yards | 18% | 13% | 13% |
| contested, 10–19 yards | 12% | 18% | 21% |
| contested, 20+ yards | 11% | 33% | 24% |
| contested against man | 18.6% | 24.2% | 19.9% |
| contested against zone | 11.7% | 11.3% | 11.1% |
| completion against man | 61.4% | 62.0% | 59.4% |
| completion against zone | 69.9% | 66.7% | 70.9% |
| intended air yards | 7.83 | 8.27 | 7.85 |
| separation at the catch, WR | 4.09 | 4.58 | 2.86 |
| yards an attempt | 6.81 | 6.73 | 7.16 |
| points a drive | 1.95 | 1.92 | 2.00 |
| yards after the catch | 5.15 | 5.12 | 5.17 |

**Still open**

- *Deep balls are over-contested*, a third against a quarter, and nearly all
  of it is man coverage (46% against 28%) — with the corner on a go already
  three yards over the top, the fitted ceiling. The posts and corners are led
  a third of the way (`lead` 0.34, 0.40): thrown late, and caught at the
  league's depth only by leading them short, so the receiver pulls up under
  the ball and his man arrives with it. Slants, quick outs and swings are at
  the floor too. The routes reach their depth faster than the league's timing
  and air yards say they should: the next piece is route speed — a stem run
  at the pace receivers actually run it — so the ball can be led in stride.
- *The gap between man and zone narrowed* to under five points (the league's
  eleven and a half): zone is now too hard to complete against, on target
  74% against 77%.
- *Separation at the catch is wider than §11*, 4.6 yards against 2.9; tight
  windows 10% against 15%.
- *Screens still gain too little after the catch* (a median of 3 yards to
  the league's 8): a receiver screen to a man alone on his side has nobody
  near enough to block for him.
- *Tackles broken*: 5% of attempts, toward the low end of believable.

## 13. The route-speed round — and what it showed instead

The idea (§12): posts and corners are led a third of the way because they
are run too fast for the league's timing; run them at the speed the timing
and air yards imply, lead them in stride, and the receiver no longer pulls up
under the ball for his man to arrive with it.

**What was tried, in order**

1. *Each deepening route's speed fitted* (go, post, corner, slant, wheel,
   swing, angle) to its air yards, with the ball led in stride. The routes
   came out at 60–75% of the common pace — the post at four and a half
   yards a second — and deep balls against man went from 46% contested to
   **83%**. The short leads had not been causing the over-contest; they had
   been hiding it. A man defender matches any speed his receiver runs, at
   once and for as long as he likes, and nothing in the world costs him
   anything to do it. Slower routes only made that easier.
2. *The ball in the air is a sprint*: the passer leads the receiver to where
   he will be flat out along his route, and he runs that fast under it. Deep
   balls against man: 77%. Yards after the catch rose to 6.7, the receiver
   now arriving at full speed.
3. *Over the top only against a man going up the field* — kept (below).
4. *The turn* — kept (below). Fitted to the contested deep balls against man,
   its length went to its ceiling, 0.6 s, and they came down only to 66%.
5. *The speed a receiver keeps through the catch*, fitted with tackling held:
   it went to its floor, a fifth of his speed, and the fit stopped settling —
   the go's share of targets swung between 3% and 11% from one run to the
   next.

Steps 1, 2 and 5 are withdrawn: the ball is led as in §12, a fitted share of
its flight, and routes are run at the common pace.

**Kept**

- *Over the top is against a vertical route.* A corner's over-the-top
  leverage is scaled by how much of his man's running is up the field;
  against a man running across it — the dig, the out — he plays level with
  him, on his inside. (Held over the top after the break, he had stayed three
  yards above every dig.)
- *The turn.* An off corner (three yards or more off at the snap) faces the
  quarterback; when his man is going up the field and has eaten the cushion
  — or at 1.6 s — he has to turn and run, and for the turn (0.3 s, a hip
  flip's length; not fitted, for the reason in 4) he cannot drive.

**Where it stands** (400 games)

| | §12 | now | league |
|---|--:|--:|--:|
| contested, behind the line | 2% | 1% | 3% |
| contested, 1–9 yards | 13% | 12% | 13% |
| contested, 10–19 yards | 18% | 19% | 21% |
| contested, 20+ yards | 33% | 33% | 24% |
| contested against man | 24.2% | 26.6% | 19.9% |
| contested against zone | 11.3% | 9.4% | 11.1% |
| completion against man | 62.0% | 62.3% | 59.4% |
| completion against zone | 66.7% | 67.5% | 70.9% |
| separation at the catch, WR | 4.58 | 4.68 | 2.86 |
| yards an attempt | 6.73 | 6.44 | 7.16 |
| points a drive | 1.92 | 1.86 | 2.00 |
| yards after the catch | 5.12 | 5.16 | 5.17 |

Much the same as §12. The fit itself now moves yards an attempt by about
three tenths from one run to the next.

**What it showed**

The engine's coverage is wrong in two opposite ways at once, and fitting
one number at a time pushes the error from one to the other:

- *Downfield against man it is too tight.* A man defender running with his
  man loses nothing: no hip turn worth the name, no stumble, no mismatch in
  speed — the receiver's only edge is the reaction delay on a cut. Real
  receivers win deep by speed and by the release; the engine has neither.
  The next piece would be a defender's speed relative to the man he covers
  (from the clubs' players, not one profile for every corner), and press —
  a won or lost release at the line.
- *Everywhere else it is too loose.* Separation at the catch is 4.7 yards to
  the league's 2.9, and windows under a yard are 10% of throws to its 15%.
  The contested threshold (`cthr`, 1.06 yards) is fitted to make the overall
  contested share right, so it hides how wide the spread is: too many
  receivers wide open, too few tight. Most of that is zone — the underneath
  defenders, who sit on their spots — and is the larger gap of the two.

## 14. The underneath zones

Separation at the catch was 4.7 yards to the league's 2.9. Against zone,
quick outs were caught with the nearest defender 7 yards off, drags 6.8,
slants 4.6; on hitches the nearest was 3.5 yards off at the throw and still
3.4 at the catch.

**Fixed**

- *Zones by where the defenders line up.* Zones were handed out by roster
  slot: the nickel took the right flat wherever he stood, and was still
  crossing the field when the ball went to the left one. Now the underneath
  zones go to the underneath droppers left to right by alignment, and the
  deep ones to the deep droppers; when the blitz has taken some of the
  droppers, those left spread across the field — a Cover 3 that sent both
  outside linebackers had left one side with nobody under it. (The play
  screen shows the same assignments.)
- *Cover 3 is four under, curl–hook–hook–curl*, the curl players taking the
  flat when their man goes there (their area is half again as wide). It had
  had a flat on one side and none on the other.
- *The screen trigger is for the defender's own area.* Driving on any
  receiver behind the line within fourteen yards across the field, the flat
  defender left the flat for a swing on the far side of the formation.
- *How close an underneath defender sits* to the man in his area, on the
  passer's side, is fitted (`zgap`, 0.77 yards; it was 2.6) to FTN's
  contested short balls against zone.
- *Reversing.* A player going back the way he came — more than 120 degrees
  — plants and stops first; below that, slowing and turning share the grip.
  (§12 withdrew planting on every turn back; it is now only for reversals.)
  An underneath defender backpedalling at the throw had swung round in a
  two-yard arc the wrong way.
- *After the catch, defenders react to it.* One not already on the receiver
  was playing the ball or his own man; he carries on for a moment before he
  turns to run the catch down — fitted (`react`, 0.37 s) to the league's yards
  after the catch. Tackling is held at 0.88, about one tackle in nine broken.
  Every pursuer had reacted to the catch at once with a perfect angle, so
  that tighter coverage took the yards after the catch to three, and the fit
  had tackling at its ceiling to get them back.

**Tried and withdrawn**

- *Fitting how deep the underneath zones sink* toward FTN's contested
  intermediate balls against zone. It went to its ceiling and the gap to its
  floor — the same defenders sunk under the digs were no longer near the
  hitches — and separation went back up half a yard.

**Where it stands** (400 games)

| | §13 | now | league |
|---|--:|--:|--:|
| separation at the catch, WR | 4.68 | 3.86 | 2.86 |
| separation at the catch, TE | — | 3.59 | 3.37 |
| tight windows (under a yard) | 10.1% | 13.9% | 14.6% |
| contested against zone | 9.4% | 8.3% | 11.1% |
| contested against man | 26.6% | 23.9% | 19.9% |
| completion against zone | 67.5% | 69.6% | 70.9% |
| completion against man | 62.3% | 63.9% | 59.4% |
| contested by depth | 1/12/19/33% | 0/10/16/41% | 3/13/21/24% |
| yards after the catch | 5.16 | 5.33 | 5.17 |
| tackles broken | 3% | 11.8% | — |
| intended air yards | 7.58 | 6.95 | 7.85 |
| yards an attempt | 6.44 | 6.54 | 7.16 |
| points a drive | 1.86 | 1.94 | 2.00 |

**Still open**

- *Zone is still contested too seldom* — 8% to 11% — though its windows are
  now about the league's size: the fitted gap is under a yard, an underneath
  defender close to playing his man. What is missing is the defender between
  two receivers: the throw into a window, with a defender breaking on it from
  the side.
- *The deep ball against man*, as §13 left it: contested 64% to FTN's 28%,
  so the passer throws short — intended air yards 6.95, twenty-yard plays 2.7
  a game to the league's 4.0 — and yards an attempt stay low.
- *Man coverage is easier to complete against than it should be* (64% to
  59%), the gap to zone 5.7 points to the league's 11.5.

## 15. The deep ball against man

At §14, deep balls against man were contested 64% of the time to FTN's 28%,
and nearly all of it was the go: 84% contested over two hundred throws, the
posts (24%) and corners (36%) near enough. On a go the corner was *trailing*
when the ball went — 1.9 yards off, 1.4 under him — and caught him in the
air: the go was led the same share of the flight whatever the leverage, short
of where the receiver was going, and he pulled up under it at the pace he ran
the route at (7.4 yards a second) while the corner ran him down at full speed.

**Fixed**

- *Thrown by the leverage.* A man going up the field is led further for each
  yard his nearest defender trails him and shorter for each yard the
  defender is on top — thrown open out in front, or to the back shoulder —
  fitted (`open`, 0.4 of the flight a yard, its ceiling) to FTN's contested
  deep balls against man.
- *Led at a sprint.* On the routes that finish going up the field (go, post,
  corner, wheel) the lead is a share of the ground he covers flat out from
  the speed he is running, not of where his route pace would take him, and
  he runs that fast under it. (§13 tried this for every route, before
  defenders had a reaction to the catch, and the yards after the catch went
  to seven; now they hold.)

**Tried and withdrawn**

- *The go led in stride, and the pace every route is run at fitted to its
  air yards.* The pace went to its floor — receivers at five and a half yards
  a second — and the go was still caught two yards too deep; deep balls
  against zone went to 6% contested, the safeties never near one. The
  league's median go is not an in-stride catch: it has the back-shoulder
  throws and the balls a receiver waits for in it.

**Where it stands** (400 games)

| | §14 | now | league |
|---|--:|--:|--:|
| contested, 20+ yards | 41% | 32% | 24% |
| contested, 10–19 yards | 16% | 18% | 21% |
| contested against man | 23.9% | 24.3% | 19.9% |
| contested against zone | 8.3% | 10.7% | 11.1% |
| completion against man | 63.9% | 64.3% | 59.4% |
| completion against zone | 69.6% | 68.3% | 70.9% |
| separation at the catch, WR | 3.86 | 3.73 | 2.86 |
| tight windows | 13.9% | 13.5% | 14.6% |
| intended air yards | 6.95 | 7.98 | 7.85 |
| twenty-yard plays a game | 2.7 | 3.0 | 4.0 |
| yards after the catch | 5.33 | 5.20 | 5.17 |
| yards an attempt | 6.54 | 6.90 | 7.16 |
| points a drive | 1.94 | 2.03 | 2.00 |

**Still open**

- *The deep leads underneath it.* To keep each deep route's air yards, its
  fitted share of the sprint is small — 0.3 for the go, the 0.2 floor for the
  post, the corner and the wheel — so most of the lead comes from the
  leverage; with a defender level with him, a deep receiver is thrown well
  short and waits for it. That is the same thing §13 found from the other
  side: at the league's time to throw, the engine's receivers are two yards
  deeper than the league's catch depths say, because nothing slows them off
  the line. A release — the first second, against press or off — is the
  piece that would let the leads come up.
- *Deep balls against man are still contested twice as often as FTN has
  them* (59% to 28%), though deep balls overall are close (32% to 24%).
- *Man coverage is still too easy to complete against* (64% to 59%), and the
  gap to zone is four points to the league's eleven and a half.
- *Twenty-yard plays*, 3.0 a game to the league's 4.0.

## 16. The release

Nobody pressed: corners lined up six yards off, and the cushion at the snap
was 6.78 yards to Next Gen Stats' 6.31. The one rule there was — a receiver
with a man defender within 2.2 yards was slowed off the line — meant that a
pressed receiver always lost.

**Added**

- *Press.* In man coverage the call can press: the corners and the nickel
  come up to a yard off their men, shaded inside. It is part of the call, so
  the picture before the snap is the one played. On defence the user has an
  *Alignment* dropdown (off / press) whenever the coverage is a man one.
- *The release is a contest.* A pressed receiver wins it 60% of the time:
  clean off the line, with the man pressing him left lunging for 0.79 s
  (fitted, with press on, to FTN's contested deep balls against man). Lost,
  he is jammed for half a second at three and a half yards a second and the
  man is on him.
- *A finer fit.* `games=` and `step=` on `make calibrate` run more games a
  round with smaller steps. At 240 games a round the fit's own noise moves
  yards an attempt by about three tenths, which is the size of most of the
  differences being judged; the comparison below was settled at 600 a round.

**The computer does not press**

Settled the same way, with the computer pressing at the rate that makes the
cushion right (39% of man snaps) and without:

| | press | no press | league |
|---|--:|--:|--:|
| cushion at the snap, WR | 6.31 | 6.77 | 6.31 |
| yards an attempt | 6.63 | 7.02 | 7.16 |
| points a drive | 1.89 | 2.01 | 2.00 |
| contested, 20+ yards | 27% | 31% | 24% |
| contested deep against man | 44% | 42% | 28% |

Press costs the offence four tenths of a yard an attempt and does nothing
for the deep balls against man: a release lost costs a receiver more than one
won gains him, by more than the league's numbers allow. Until that is right
the computer plays off (`press` on `make calibrate` fits it anyway), and a
user who presses has the stronger hand.

**Where it stands** (400 games, no press)

| | §15 | now | league |
|---|--:|--:|--:|
| yards an attempt | 6.90 | 7.02 | 7.16 |
| points a drive | 2.03 | 2.01 | 2.00 |
| completion | 62.9% | 61.5% | 64.6% |
| intended air yards | 7.98 | 8.51 | 7.85 |
| contested by depth | 1/13/18/32% | 1/13/17/31% | 3/13/21/24% |
| contested against man / zone | 24.3 / 10.7% | 24.1 / 10.6% | 19.9 / 11.1% |
| completion against man / zone | 64.3 / 68.3% | 62.5 / 67.0% | 59.4 / 70.9% |
| separation at the catch, WR | 3.73 | 3.86 | 2.86 |
| yards after the catch | 5.20 | 5.24 | 5.17 |

**What this round showed**

The deep ball against man does not come from the line: winning nine
releases in ten, at one point, hardly moved it. It comes after — a receiver
who has won still runs his route at four fifths of his speed while the man
covering him runs at all of his, and any yard the receiver gains, the
defender can take back before the ball arrives.

## 17. Defender pace — and the forced throw

§16 ended thinking the deep ball against man came from pace: a receiver who
had beaten his man ran at four fifths of his speed and the man ran at all of
his. Three ways of giving the receiver the edge were tried, and each ran its
fitted number to its bound without moving the deep balls:

1. *The vertical legs at full speed* — the go, and the post, corner and
   wheel after their last cut. The fitted speed went to its ceiling, flat
   out; deep balls against man rose to 65% contested. The man covering him ran
   flat out too.
2. *A man defender with his back to the ball* — playing his man, as late as
   ever on what the man does, until the last part of the ball's flight. The
   window went to its floor, a quarter of a second, and they stayed at 50%;
   the short throws against man were contested more, and route recognition
   went to its ceiling to make up for it.
3. *Who is faster.* Every corner and every receiver had the same top speed.
   A difference drawn for each man matchup, its spread fitted, went to 1.2
   yards a second — three times what separates a 4.35 forty from a 4.6 — and
   they stayed at 50%, with players over ten yards a second on screen.

1 and 2 are withdrawn; 3 is kept at a spread of 0.4 yards a second.

**What it was**

Split by how the throw was made, the 231 deep go balls against man in 200
games: 125 thrown on a read, **30% contested** — FTN's 28% — and 105 *forced*,
the passer having found nobody open, 66% contested. Forced, he threw to the
read worth most, and a go is worth a lot however well it is covered. Now a
forced throw goes to whoever is least covered — the window first, what the
read is worth only between windows alike.

That moved what nothing else had, and it let the leads come up: the go is now
led 0.85 of its sprint (it was 0.3 to 0.4), the receiver no longer pulling up
under nearly every deep ball.

**Where it stands** (400 games, settled at 600 a round)

| | §16 | now | league |
|---|--:|--:|--:|
| contested, deep against man | 42% | 26%* | 28% |
| contested, 20+ yards | 31% | 27% | 24% |
| contested by depth | 1/13/17/31% | 1/13/18/27% | 3/13/21/24% |
| contested against man / zone | 24.1 / 10.6% | 22.5 / 10.8% | 19.9 / 11.1% |
| intended air yards | 8.51 | 7.99 | 7.85 |
| twenty-yard completions, of attempts | 7.5% | 6.8% | 8.5% |
| completion | 61.5% | 61.5% | 64.6% |
| completion against man / zone | 62.5 / 67.0% | 63.0 / 66.8% | 59.4 / 70.9% |
| separation at the catch, WR | 3.86 | 4.05 | 2.86 |
| yards after the catch | 5.24 | 5.20 | 5.17 |
| yards an attempt | 7.02 | 6.62 | 7.16 |
| points a drive | 2.01 | 1.91 | 2.00 |

\* in the fit's last round; the 400-game report does not split depth by man
and zone.

**Still open**

- *Yards an attempt fell four tenths.* §16's were partly the forced go balls:
  two in three contested, but caught long when caught, and the air yards were
  too long for it (8.5 to the league's 7.9). With the air yards now right, the
  gap is completion — 61.5% to 64.6% — and most of that is zone: the engine's
  zone is four points too hard to complete against and on target 74% to 77%.
- *Man is still too easy* (63% to 59%), and the gap between man and zone is
  under four points to the league's eleven and a half.
- *The forced throw itself.* 13% of throws are made with nobody open; FTN has
  no such category to check it against.

## 18. Completion against zone

At §17 the engine's zone was four points too hard to complete against (66.8%
to 70.9%) and its man three too easy (63.0% to 59.4%), and nearly all of it
was accuracy: on target 73.6% against zone to FTN's 77.4%, 71.4% against man
to 67.7%. The engine's accuracy hardly depended on the coverage; the league's
is ten points apart.

**Fixed**

- *Accuracy against man and against zone*, each a factor fitted to FTN's
  on-target rate for it (`accMan` 0.95, `accZone` 1.07). A ball into man
  coverage has to go where only he can get it, with a body on him; into zone,
  to a spot. §11 tried to get this from the window — how tight the throw is —
  and the window cost went to its ceiling and took a tenth off every route's
  accuracy without closing half the gap: the engine's windows against man are
  not tight enough, compared with zone, for the difference to come from them.
  Each route's accuracy is still fitted to its completion rate; the two factors
  move only man against zone.

**Where it stands** (400 games, settled at 600 a round)

| | §17 | now | league |
|---|--:|--:|--:|
| on target against man / zone | 71.4 / 73.6% | 68.0 / 77.2% | 67.7 / 77.4% |
| completion against man / zone | 63.0 / 66.8% | 60.7 / 70.2% | 59.4 / 70.9% |
| completion by coverage, man | 60–64% | 58–64% | 58–61% |
| completion by coverage, zone | 66–68% | 69–70% | 67–73% |
| completion | 61.5% | 63.0% | 64.6% |
| contested against man / zone | 22.5 / 10.8% | 21.0 / 11.9% | 19.9 / 11.1% |
| contested by depth | 1/13/18/27% | 0/13/19/29% | 3/13/21/24% |
| intended air yards | 7.99 | 7.76 | 7.85 |
| yards after the catch | 5.20 | 5.05 | 5.17 |
| yards an attempt | 6.62 | 6.68 | 7.16 |
| points a drive | 1.91 | 1.93 | 2.00 |

The gap between man and zone is nine and a half points, to the league's
eleven and a half; it was under four.

**Still open**

- *The big play.* Twenty-yard completions are 6.6% of attempts to the
  league's 8.5%, and twenty-yard plays 2.9 a game to its 4.0 — the most of
  what yards an attempt are still short. The yards after the catch are right
  on average but short in the tail: the median on a screen is 4 yards to the
  league's 8, on a go 2 to 3, on a wheel 1 to 4.
- *Behind the line* against zone, 16% of throws to the league's 23%.
- *Separation at the catch* is 4.2 yards to 2.9, windows under a yard 10% to
  15%: the underneath zone defenders have moved back off their men (the fitted
  gap is 2.4 yards, from 1.8) as the accuracy against zone came up.

## 19. The big plays — withdrawn

Twenty-yard completions were 6.6% of attempts to the league's 8.5%, twenty-yard
plays 2.9 a game to its 4.0. The yards after the catch were right on average
(5.05 to 5.17) and wrong in shape, the two ends cancelling:

| after the catch, q50 / q75 / q90 | engine | league |
|---|--:|--:|
| go | 2 / 27 / 45 | 3 / 6 / 11 |
| post | 1 / 2 / 27 | 2 / 7 / 14 |
| screen | 4 / 5 / 6 | 8 / 12 / 18 |
| quick out | 2 / 5 / 11 | 3 / 7 / 12 |
| drag | 3 / 7 / 9 | 4 / 8 / 13 |
| slant | 3 / 6 / 8 | 3 / 6 / 11 |

The deep balls ran away — of the go and post balls with twenty yards after
the catch, nine in ten were touchdowns, caught with nobody behind the receiver
— and the short ones never did. With the reaction to the catch fitted to the
average, the deep tail held the short ones down.

**Tried, each in turn**

1. *Safeties deeper than the deepest*: every man going up the field in the
   area, not only the one matched, and deeper than where each would be in a
   moment, splitting two in a half. The long runs then had two defenders
   behind the receiver at the catch, and were still touchdowns; and the
   passer stopped throwing deep — intended air yards fell to six — and the fit
   came apart. Restricted to a safety whose own man is going deep, the digs
   were robbed again, but the deep ball was still too well covered.
2. *Pursuit at an angle*: each pursuer runs to where he can meet the carrier,
   solving for it, rather than to a point a fixed moment ahead — a safety level
   with a receiver had run beside him three yards off to the end zone — and
   drives straight at him inside three yards. With *contact at a yard and a
   half* (the reach and the lunge) rather than a yard and a fifth.
3. *The catch by how the ball came*: a third of his speed kept over the
   shoulder, most of it across the body in stride. The go's tail came in; the
   digs', caught across the field, went out to three times the league's.

None gave a settled fit better than §18's: at best twenty-yard completions
right with yards an attempt down two tenths, and the underneath zone gap
drifting to its ceiling with separation half a yard wider. The code and the
fit are §18's.

**What it showed**

- *The deep breakaway is the safeties'* — they are beaten, or level and not
  closing — and fixing their depth fixes it only by taking the deep ball away.
  What is missing is a safety who is deep *and* comes down on the ball: a
  read of the throw from depth, which §10's robbing does for the dig but
  nothing does for the go.
- *The short tail is the tackling.* A short catch is made among defenders
  already breaking on the ball, and the first tackle is made; the league's
  slant, drag and screen go ten and more one time in ten — a missed tackle, a
  block, a seam. Broken tackles are held at one in nine overall; what the
  engine lacks is the one broken tackle that becomes twenty yards: open field
  after it, and blockers downfield.
- *The fit is now the limit.* Thirty-odd numbers fitted together, at 600 games
  a round, still drift: the underneath zone gap wandered from 1.8 to 3.2
  yards between settles of the same code. Further rounds need the fit made
  steadier first — fewer numbers fitted at once, or each to a target only it
  moves.

## 20. A steadier fit

§19 ended with the fit as the limit: the same code, settled twice, gave
answers far enough apart to hide the changes being judged. It was measured
before anything was changed — two settles of the same code from different
games, compared number by number and report by report.

**What it was**

Not noise. Settles from different games agreed to a third of a percent on
the median fitted number. What moved was:

1. *A number its target does not answer to.* The gap an underneath zone
   defender keeps from his man climbed every round of every fit — 1.8 yards to
   3.2 — while the contested short balls against zone it was fitted to stayed
   at 11 to 15%. It is held at 1.5 yards.
2. *Numbers that overshoot.* Each route's time-to-throw offset and the
   nobody-open outcomes swapped back and forth every round (the post's timing a
   quarter of a second each way, the forced throw and the scramble a tenth of
   their shares). Their steps are cut to a third and a half.
3. *Medians in whole yards.* The air yards are whole yards; their median
   jumps a yard at a time, and the leads fitted to them went round in a
   three-round cycle. The fit now uses the mean of the middle fifth.
4. *A cliff in the engine.* Two settles that agreed on their numbers gave
   reports 0.8 yards apart in intended air. Swapping the numbers group by group,
   then route by route, found it: a change of six thousandths of a second in
   the wheel's timing took the post from 8% of targets to 4%. Every play of a
   concept was timed to the frame, so a whole concept's plays came out of a
   read together or not at all. No two dropbacks are timed alike now: when
   each read comes up varies by about an eighth of a second from snap to
   snap. Either side of where the cliff was, intended air is 8.15 and 8.14.

And in how it runs: every round replays the same games (common random
numbers) rather than drawing new ones, and what is written is the average of
the second half of the rounds. The defaults of `make calibrate ARGS=fit` are
now these: fourteen rounds of six hundred games at a step of 0.4. `seed=`,
`out=`, `fit=` (start from or report on a file), `trace=` (every round's
numbers, for looking at how they move), `nocrn` and `noavg` (as before) are
there for checking it.

**How steady** — two settles from different games:

| | before | after |
|---|--:|--:|
| round-to-round movement, last six rounds | 1.6% | 0.8% |
| intended air yards, round by round | 7.3–8.2, a cycle | 7.8–8.0 |
| intended air yards, the two reports | 7.98 / 7.22 | 7.91 / 7.91 |
| points a drive, the two reports | 1.99 / 1.92 | 2.01 / 1.99 |
| contested 20+ yards, the two reports | 27% / 17% | 26% / 25% |

Where the two settles still differ it is in the least-thrown routes — the
wheel, 1% of targets — which the games barely pin down. Three numbers are at
a bound and so are not being fitted: the first-read bias (0.5), robbing
(0.95) and throwing a beaten man open (0.4).

**Where it stands** (400 games; the average of the two settles)

| | §18 | now | league |
|---|--:|--:|--:|
| completion | 63.0% | 63.2% | 64.6% |
| yards an attempt | 6.68 | 6.74 | 7.16 |
| points a drive | 1.93 | 1.99 | 2.00 |
| intended air yards | 7.76 | 7.86 | 7.85 |
| contested by depth | 0/13/19/29% | 1/13/18/24% | 3/13/21/24% |
| contested against man / zone | 21.0 / 11.9% | 19.3 / 11.8% | 19.9 / 11.1% |
| on target against man / zone | 68.0 / 77.2% | 67.6 / 77.4% | 67.7 / 77.4% |
| completion against man / zone | 60.7 / 70.2% | 60.4 / 70.3% | 59.4 / 70.9% |
| separation at the catch, WR | 4.18 | 4.03 | 2.86 |
| yards after the catch | 5.05 | 5.07 | 5.17 |
| twenty-yard plays a game | 2.9 | 2.8 | 4.0 |

Still open, as §19 left it: the big plays, and separation at the catch.

## 21. The big plays, again

With the fit steady (§20) each change could be judged on its own. §19's
picture held: the yards after the catch right on average and wrong in shape —
the deep balls running away, the short ones never breaking.

**Where the deep runs came from**

Of the go and post balls caught in 200 games, a third were caught with nobody
deeper than the receiver, and those were two thirds of the ones with twenty
yards and more after the catch. In every coverage the deep defender nearest
him was *directly under him*, two to three and a half yards behind: not out of
position, outrun at the last.

**Fixed**

- *A zone defender breaking on the ball arrives with it.* He used to steer to
  where it was coming down and brake to stand on the spot, so he was slowing
  as the ball arrived and the receiver went past him at full speed. Now he runs
  at the speed that gets him there as it does — flat out when he is late.
  Caught with a defender within two yards, the deep balls that went for twenty
  after the catch fell from 18% to 2%.
- *Pursuit at an angle.* After the catch each pursuer runs to where he can
  meet the carrier — the earliest point the carrier's path and his own top
  speed cross — and drives straight at him inside three yards, rather than at a
  point a fixed moment ahead of him (a safety level with a receiver had run
  beside him three yards off to the end zone). §19 tried this while the fit
  still drifted and could not tell; with the defender arriving with the ball it
  brought the go in to the league's at the 75th percentile.
- *The deep rotation.* When the blitz takes a safety, those left rotate: one
  plays the deep middle, two the halves. The one safety left in a Cover 2 had
  kept his half and nobody had the other. (Rare — 3% of Cover 2 snaps — but
  every one of them a go up an empty half.)

**Tried and withdrawn**

- *A deep defender keeping his cushion against where his man will be* (0.4 and
  0.8 seconds of his speed ahead). It brought the go's tail in a little, cost
  a tenth to a seventh of a yard an attempt, and did nothing the fixes above
  did not.
- *Contact at a yard and a half* instead of a yard and a fifth. With the
  pursuit at an angle it is not needed.

**Where it stands** (400 games; the average of two settles from different games)

| | §20 | now | league |
|---|--:|--:|--:|
| twenty-yard completions, of attempts | 6.4% | 7.3% | 8.5% |
| twenty-yard plays a game | 2.8 | 3.1 | 4.0 |
| yards after the catch | 5.07 | 5.02 | 5.17 |
| the go after the catch, q50 / q75 / q90 | 2 / 27 / 44 | 1 / 11 / 41 | 3 / 6 / 11 |
| separation at the catch, WR | 4.03 | 3.88 | 2.86 |
| tight windows | 11.6% | 13.8% | 14.6% |
| contested by depth | 1/13/18/24% | 1/13/19/27% | 3/13/21/24% |
| completion against man / zone | 60.4 / 70.3% | 61.6 / 70.2% | 59.4 / 70.9% |
| yards an attempt | 6.74 | 6.68 | 7.16 |
| points a drive | 1.99 | 1.94 | 2.00 |

**Still open**

- *The top tail of every deep route* — the 90th percentile after the catch
  is 31 to 42 yards on the dig, post, go and corner to the league's 10 to 14.
  These are catches with nobody within four yards: coverage beaten outright.
  The league has them too, and still runs them down; the engine's pursuers
  from the side do not close in time.
- *The short tail* is untouched: a screen's 90th percentile is 6 yards to the
  league's 18, a drag's 9 to 13.
- *Route recognition is drifting* — 0.30 to 0.37 over the last settle — toward
  a target, the contested intermediate balls against man (26%), that has sat at
  19 to 20% throughout: the signature §20 found in the underneath gap, a
  number its target does not answer to.

## 22. The short tail: screens

Screens were the worst of it — two yards after the catch at the median to the
league's eight, six at the 90th percentile to its eighteen — and they were
being caught with the nearest defender six and a half yards away and nobody
within five, and tackled a second later. Not smothered: caught standing
still, behind the line, with nobody in front of him, by a defender closing at
eight yards a second.

**Fixed**

- *The linemen release.* On a screen they let the rush through (a back's) or
  go at once (a receiver's), and set a wall across the field two yards in front
  of where the man it is for will be; any defender who comes within a yard and
  a third of one of them is held up — under half his speed — as a defender a
  blocker has reached already was after the catch, and now is before it too.
  (Released to chase the coverage instead, at a lineman's speed they never got
  there.)
- *A back's screen goes out, not back.* Run the receiver's way from the
  backfield, it was caught eight yards behind the line among the rushers. Now
  it goes out to the side and a step up and is caught two yards behind it,
  with the wall in front of him.
- *The receiver screen goes to the slot* — the man outside him blocking the
  corner, the line releasing in front of him: a jailbreak — and the computer
  calls it only with a slot split eight yards or more. Thrown to the split end,
  often alone on his side, it had nobody near enough to block for it; with the
  line kept in to protect (a plain bubble), the rushers ran the slot down from
  behind, two yards after the catch.

**Where it stands** (400 games; the average of two settles)

| | §21 | now | league |
|---|--:|--:|--:|
| screen after the catch, q50 / q75 / q90 | 2 / 4 / 6 | 5 / 8 / 11 | 8 / 12 / 18 |
| — the back's | 4 / 5 / 6 | 7 / 10 / 12 | |
| — the receiver's | 1 / 3 / 5 | 4 / 5 / 7 | |
| yards after the catch | 5.02 | 5.18 | 5.17 |
| yards an attempt | 6.68 | 6.82 | 7.16 |
| points a drive | 1.94 | 1.97 | 2.00 |
| twenty-yard completions, of attempts | 7.3% | 6.7% | 8.5% |
| twenty-yard plays a game | 3.1 | 2.8 | 4.0 |
| separation at the catch, WR | 3.88 | 3.95 | 2.86 |
| tight windows | 13.8% | 14.0% | 14.6% |

**Still open**

- *The rest of the short tail.* The slant (8 at the 90th percentile to 11),
  the drag (9 to 13) and the hitch (6 to 8) still never break; the engine's
  short catches are tackled by the first man there. With the screens' yards
  after the catch up, the fitted reaction to the catch has come back up to 0.27
  seconds, which is what held them down; what they need is the broken tackle
  that turns into a run.
- *Twenty-yard plays* have not moved: the deep tails are as §21 left them, and
  the short routes do not yet supply the rest.
- *Route recognition* is still climbing (0.47 now), its target — the
  contested intermediate balls against man — at 24% to 26%.

## 23. The broken tackle — withdrawn, and where the big plays are not

**The broken tackle.** On the short routes — hitch, quick out, slant, drag —
a tenth of the catches had a tackle broken, and those went five yards after
the catch at the median and sixteen at the 90th percentile, to one and eight
without one. How much of his speed a carrier keeps through a broken tackle
(0.65) was fitted to the short routes' 90th percentile; it climbed every round
of the fit, 0.68 to 0.97, while that 90th percentile did not move — slant 9,
drag 9, hitch 6. A number its target does not answer to (§20). Withdrawn.

**Where the big plays are not.** Split, the twenty-yard completions were 0.84
a game caught twenty yards downfield and 1.44 made so by the run after the
catch. The league's twenty-yard completions (8.5% of attempts) are about 2.9 a
game; with its deep balls 11.7% of attempts and 38% completed, about 1.5 of
those are caught twenty yards downfield. The engine's deep balls are 10.0% of
its attempts and 32% completed:

| | engine | league |
|---|--:|--:|
| behind the line | 16.0% of attempts, 82% completed | 21.3%, 79% |
| 1–9 yards | 47.8%, 74% | 45.8%, 74% |
| 10–19 yards | 26.2%, 57% | 21.3%, 56% |
| 20+ yards | 10.0%, 32% | 11.7%, 38% |

The missing big plays are deep completions — too few deep balls, too few of
them caught — not runs after the catch, which are about the league's.

**Tried and withdrawn: accuracy on the deep ball.** A factor on the accuracy of
throws twenty yards and more, fitted to FTN's on-target rate for them (45%).
It got there (44%) and went to its ceiling, 1.4, while the go's own accuracy —
fitted to the go's completion rate as a whole — fell from about 0.95 to 0.68 to
keep the go's completions where they were. The two traded accuracy between the
go's long throws and its short ones; the twenty-yard completions stayed at
7.0%. Two numbers fitted to targets only one of them can move.

The code and the fit are §22's.

**What it points to**

The engine throws too few balls twenty yards and more, and too many ten to
nineteen — a tenth of the deep ones arrive short: the go is led four tenths
of its sprint (§15), and against a defender on top of him it is the back
shoulder, caught at twelve to eighteen yards. And it throws behind the line a
quarter less often than the league, the checkdowns to the back in the flat
that the league throws there and the engine does not have a route for. Both
are the passer's choices and the routes' shapes, not the run after the catch.

## 24. How deep each route is run

§23 found the big plays missing as deep completions, and the throws behind the
line short by a quarter. Route by route, against the league's air yards for
each, the reason was plain: every route was run at one depth.

| air yards, q10 / q50 / q90 | engine (§23) | league |
|---|---|---|
| hitch/curl | 3 / 4 / 5 | 2 / 5 / 12 |
| quick out | 3 / 4 / 5 | −1 / 3 / 6 |
| drag | 2 / 2 / 6 | −2 / 3 / 7 |
| dig | 11 / 13 / 17 | 5 / 13 / 20 |
| deep out | 10 / 12 / 15 | 7 / 13 / 20 |

The league's hitch/curl is a five-yard hitch one snap and a twelve-yard curl
the next; its quick out is a flat at the line one time in five; its digs and
deep outs go past twenty one in ten. One depth to each, the engine had neither
end — not the throws behind the line, nor the ones downfield.

**Fixed**

- *Each route whose catch is made where it breaks* — the hitch/curl, the quick
  out, the dig, the deep out, the drag — *is run at a depth drawn, each snap,
  from the league's air yards for it*: its break moved up or down by the
  difference between the draw and the league's median, never more than a yard
  behind where he starts. The routes whose depth comes from when the ball is
  thrown (the go, post, corner, slant, wheel) and the screens and swings keep
  their shape; the angle, run from the backfield, too (moved, it was behind the
  line half the time). The route the play screen draws before the snap is the
  route's own; the one run is the drawn depth.
- *One path for each route*, shared by running it and timing it (`pathOf`): the
  back's screen of §22 had been run on its own path but timed on the
  receiver's.

**Where it stands** (400 games; the average of two settles)

| share of attempts / completion | §23 | now | league |
|---|--:|--:|--:|
| behind the line | 16.0% / 82% | 21.3% / 82% | 21.3% / 79% |
| 1–9 yards | 47.8% / 74% | 45.3% / 77% | 45.8% / 74% |
| 10–19 yards | 26.2% / 57% | 22.1% / 54% | 21.3% / 56% |
| 20+ yards | 10.0% / 32% | 11.4% / 31% | 11.7% / 38% |

| | §22 | now | league |
|---|--:|--:|--:|
| twenty-yard completions, of attempts | 6.7% | 7.1% | 8.5% |
| twenty-yard plays a game | 2.8 | 3.0 | 4.0 |
| yards an attempt | 6.82 | 6.63 | 7.16 |
| points a drive | 1.97 | 1.92 | 2.00 |
| tight windows | 14.0% | 16.1% | 14.6% |
| contested against man / zone | 19.5 / 11.5% | 16.3 / 12.6% | 19.9 / 11.1% |
| completion against man / zone | 60.0 / 70.4% | 60.4 / 69.1% | 59.4 / 70.9% |

Where the passes go is now the league's. What it costs is two tenths of a yard
an attempt: the engine now throws as many deep balls as the league, and still
completes them less often.

**Still open**

- *Deep completion*, 31% to 38%, on target 36% to 45%. Each route's
  completion is fitted to the league's as a whole and matches it (the go 37% to
  36%), so the gap is inside the routes: the engine's completion falls with
  depth too steeply within a route — the base accuracy steps down at ten yards
  and again at twenty (FTN's bands), so a go caught at fifteen is completed too
  often and one at thirty too seldom. The accuracy should fall smoothly with
  depth. (§23's single factor for twenty yards and more could not do it: the
  route accuracy undid it.)
- *Tight windows* are now 16% to 15%, and man coverage contested 16% to 20%.

## 25. Accuracy that falls smoothly with depth

§24 left the deep ball completed too seldom (31% to 38%), on target 36% to 45%,
and blamed the base accuracy, which came from FTN's four bands and stepped
down at ten yards and again at twenty.

**Done**

- *The base accuracy is now FTN's, in five-yard steps* (`catch.catchableByAir`
  in the tables: on target, clean and pressured, by how far it was thrown),
  interpolated between them and held at the ends. Clean, it falls from 87% at
  the line to 54% at 23 yards and then flattens — 42% at 28, 39% at 35, 37% at
  45 — where the bands had had everything past twenty at 47%.

**What it did not do**

Deep accuracy did not move (36 to 38% on target): each route's accuracy is
fitted to the route's completion as a whole, and re-fitted around the new
curve. Split by route and depth against the 2025 play-by-play, the deep
completions are missing from three routes, not all of them:

| completion, thrown 20+ | engine | league |
|---|--:|--:|
| go | 30% | 33% |
| post | 46% | 43% |
| corner | 23% | 39% |
| dig | 17% | 50% |
| deep out | 25% | 36% |

The go and the post are about the league's. The corner, the dig and the deep
out are not — and their shorter throws are about right (the corner's too
easy: 61% at ten to nineteen, to 48%). The deep digs and deep outs are the
ones §24 began running at the league's depths; at twenty yards and more a dig
crosses the deep middle and an out runs under a deep third, and the engine's
deep defenders take them away far more often than the league's do. That is
coverage at those depths, not accuracy.

**Where it stands** (400 games; the average of two settles)

| | §24 | now | league |
|---|--:|--:|--:|
| yards an attempt | 6.63 | 6.54 | 7.16 |
| points a drive | 1.92 | 1.88 | 2.00 |
| twenty-yard completions, of attempts | 7.1% | 6.9% | 8.5% |
| twenty-yard plays a game | 3.0 | 2.9 | 4.0 |
| on target, 20+ yards | 36% | 37% | 45% |

A shade below §24 — within what two settles of the same code differ by
(6.65 and 6.62 on their own) and what averaging their numbers moves.

**Next**

The deep dig, deep out and deep corner against the deep defenders: why the
engine's take them away three times in four when the league's take them away
half the time.

## 26. The deep dig and the deep out — and two bugs in how players move

§25 thought the deep digs, outs and corners were being covered too well. Split
by what happened to them, they were not: thrown twenty yards and more they
were caught 85 to 90% of the time when on target — only 22 to 30% of them
were on target. And the reason was the shorter ones: thrown ten to nineteen
yards a dig was contested one time in a hundred (the league's intermediate
balls, one in five), the nearest defender four and a half yards off, 93% of
the on-target ones caught. So open that each route's accuracy, fitted to its
completion, came down to three quarters — which is what the deep ones were
thrown with.

Traced, a hook defender three and a half yards in front of a dig at the throw
had covered a yard of it when the ball arrived. Two bugs:

**Fixed**

- *Breaking on the ball.* §21 had a zone defender run at the speed that gets
  him to the ball as it arrives — if he were already at it. From a standstill
  he was always late and never ran flat out. Now he goes flat out unless he
  would be there early with room to spare.
- *Pushing off from a jog.* Below a third of a yard a second a player
  accelerated whichever way he wanted; above it, the push was split into along
  and across the way he was drifting, and turning shared the grip with
  speeding up. A zone defender shuffling at a yard a second who wanted to go
  the other way spent nearly all of it turning. Now, up to two and a half
  yards a second, he pushes off whichever way he wants at the rate he can
  speed up.

**Where it stands** (400 games; the average of two settles)

| | §25 | now | league |
|---|--:|--:|--:|
| separation at the catch, WR | 3.98 | 3.81 | 2.86 |
| contested against man / zone | 16.2 / 12.2% | 19.6 / 12.1% | 19.9 / 11.1% |
| contested by depth | 5/12/20/21% | 5/11/24/26% | 3/13/21/24% |
| completion against man / zone | 60.4 / 69.5% | 61.6 / 69.3% | 59.4 / 70.9% |
| yards after the catch | 5.06 | 5.17 | 5.17 |
| yards an attempt | 6.54 | 6.68 | 7.16 |
| points a drive | 1.88 | 1.94 | 2.00 |
| twenty-yard plays a game | 2.9 | 3.0 | 4.0 |

And two numbers that had been running away have stopped: route recognition,
which had climbed every settle since §20 toward its ceiling, came down to
0.30 and stayed; robbing came off its ceiling (0.95) to 0.74.

**Still open**

- *The digs.* Thrown ten to nineteen yards, still contested one time in fifty;
  the dig's fitted accuracy is still three quarters, and its deep throws with
  it. The defender's break is quicker now; what is left is that the passer
  finds digs open — the hook and curl defenders are not where a dig crosses
  when it is thrown.
- *The deep ball's accuracy*, on target 36% to 45% — as the digs are.
- *Tight windows* 16.7% to 14.6%, man coverage 61.6% to 59.4% completed.

## 27. The hook and curl defenders

Digs thrown ten to nineteen yards against zone, at the moment of the throw:
the nearest underneath defender was eight and a half yards from where the dig
would be caught, seven of them to the side. The zones on the field said why —
Cover 2 against a nickel had both flats, both curls and the *right* hook; Cover
4 had both flats and a curl. No middle.

**Fixed**

- *The middle zone.* §14's sharing-out of zones by alignment counted the
  shell's zones for every defender it names — the base defence's third
  linebacker included, against a nickel that has no third linebacker. A zone
  too many, and spreading the defenders evenly across them left out the middle
  one: Cover 2's middle linebacker and Cover 4's hook defender were missing on
  most snaps. It now counts the zones of the defenders on the field, dropping
  and blitzing.

**Tried and withdrawn**

- *Underneath defenders sink no deeper than three yards past their landmark.*
  Traced, a curl defender carried up the field by the dig's stem was running
  the wrong way when it broke in; but his target had not been too deep, and
  the cap changed nothing.
- *Underneath defenders matched by where a receiver will be in half a second*,
  so that a crosser is handed on to the defender he is running toward. The curl
  defender came inside sooner; in the games digs were contested no more often,
  and deep outs less.
- *Following the quarterback's eyes twice as much.* Nothing: he looks at the
  dig late.

**Where it stands** (400 games; the average of two settles)

| | §26 | now | league |
|---|--:|--:|--:|
| tight windows | 16.7% | 15.2% | 14.6% |
| contested against man / zone | 19.6 / 12.1% | 18.9 / 11.1% | 19.9 / 11.1% |
| contested by depth | 5/11/24/26% | 5/10/21/26% | 3/13/21/24% |
| completion against man / zone | 61.6 / 69.3% | 60.8 / 70.0% | 59.4 / 70.9% |
| separation at the catch, WR | 3.81 | 4.07 | 2.86 |
| yards after the catch | 5.17 | 5.40 | 5.17 |
| twenty-yard completions, of attempts | 7.0% | 7.3% | 8.5% |
| yards an attempt | 6.68 | 6.86 | 7.16 |
| points a drive | 1.94 | 1.99 | 2.00 |

**Still open**

- *The digs*, still contested one time in a hundred at ten to nineteen yards.
  With the middle back, the defenders are there; what is left is that the
  passer throws digs when they are open, and the engine's hook and curl
  defenders leave them open more than the league's do — sitting at their
  landmarks under a dig that crosses three yards above them, and breaking on
  it from there.
- *Separation at the catch* came back up a quarter of a yard, and yards after
  the catch with it.

## 28. The digs — withdrawn, and what they showed

FTN has digs thrown ten to nineteen yards contested 22% of the time (20%
against zone), deep outs 17%, corners 25%; the engine had them at 1%, 8% and
41%.

**Tried and withdrawn**

- *An underneath defender with nobody of his own takes the nearest man in his
  area*, though a neighbour has him — first by distance from his spot, then
  by a lane across the field and the ground above it. Traced, the hook
  defender picked the dig up only when it was already on him.
- *The hook and curl drops at the league's depths* — eleven and twelve and a
  half, from nine and eleven. Nothing for the digs; separation at the catch up
  a fifth of a yard.

**What it showed**

For every dig thrown ten to nineteen yards against zone and on target, the
defender best placed to get to where it would be caught was, at the moment
it was thrown, 6.3 to 6.6 yards from it at the median, and would have needed
about 1.4 seconds flat out for a ball in the air 0.8: one dig in a hundred was
reachable at all. It is not how the defenders move after the throw — §26 and
§27 fixed that — and it is not where their zones are: it is where they are
when a dig is thrown, which is wherever the dig is open, because the passer
throws a dig when it is open. The league's passers throw digs into windows a
defender can contest one time in five; the engine's coverage leaves a dig wide
open often enough that its passer seldom has to.

That is the separation at the catch — 4.1 yards to the league's 2.9 — that has
stood behind every round since §14: the underneath defenders, matched to the
nearest receivers and drawn after them, leave the routes they are not on more
open than the league's do. The code and the fit are §27's.

## 29. Zone defenders — where the open receivers are

Separation at the catch, wide receivers, split by route and coverage — the
mean is 4.0 yards to the league's 2.9, but the windows under a yard are the
league's (15%), so the excess is a tail of men wide open:

| against zone | mean separation | share of all of it |
|---|--:|--:|
| quick out | 7.1 | 17% |
| drag | 6.2 | 12% |
| screen | 9.8 | 10% |
| dig | 4.9 | 6% |
| deep out | 4.5 | 6% |

The same quick outs against man are 2.1 yards, the drags 3.1. A third of all
the separation is the flat and the underneath crossers against zone.

**What the quick out showed**

Caught near the sideline — twenty-two yards from the middle of the field — with
the nearest zone defender eight and a half to eleven yards away when it was
thrown, nearly all of it across the field. Traced, the slant–flat against Cover
2: the corner, the flat defender, went inside with the outside receiver's slant
because it was the nearest man, and the slot's quick out ran into the flat he
had left. And the quick out is thrown late: no earlier than the route's
*rhythm*, which is meant (world.ts says so) to be the league's quarter-way time
to throw for it and was the median less a fifth of a second — 2.3 seconds
for a quick out, by which time the receiver had run fifteen yards across to the
sideline.

**Tried and withdrawn**

- *Underneath defenders matched by where a receiver is going* (0.6 s ahead):
  nothing.
- *The flat defender keeps to the flat* — never matched to a man going four
  yards and more inside it. Nothing: the quick outs stayed seven yards open.
- *The rhythm at the quarter-way time to throw*, as intended. Before the fit,
  quick outs against zone came in to six yards; the fit then moves each route's
  timing back to the league's median time to throw (its `tOff`), and they went
  back to seven. Settled, yards an attempt fell from 6.86 to 6.7, and the zone
  accuracy went to its ceiling.

The code and the fit are §27's.

**What it points to**

The quick out is thrown at the league's median time — and by then the engine's
receiver has run on to the sideline. The league's quick out at that time is a
man who broke at five yards and *settled*, or turned up the field, near the
numbers: the engine's route is the wrong shape after its break, not thrown at
the wrong time. Likewise the drag runs on across the whole field. Routes that
settle after the break — the out to the numbers, the drag into the window
between the hook defenders — would put the catch where the flat and hook
defenders are.

## 30. Route shapes: routes that settle

§29 found a third of the separation at the catch in the quick outs and drags
against zone, and the reason in their shape: by the league's time to throw
them, the engine's quick out had run on to the sideline and its drag across the
field, away from the flat and hook defenders.

**Changed**

- *Routes can settle.* A route definition can now say it sits down at the end
  of its path — stops in the window facing the passer — rather than running on
  (routes that come back, the hitch, always did).
- *The quick out* breaks at four or five yards, runs six yards out and settles,
  near the numbers.
- *The drag* crosses thirteen yards and settles, where it had run thirty.

The play screen draws the new shapes.

**Where it stands** (400 games; the average of two settles)

| | §27 | now | league |
|---|--:|--:|--:|
| separation at the catch, WR | 4.07 | 3.85 | 2.86 |
| — quick outs against zone | 7.1 | 5.7 | |
| tight windows | 15.2% | 16.8% | 14.6% |
| contested against man / zone | 18.9 / 11.1% | 18.4 / 11.6% | 19.9 / 11.1% |
| completion against man / zone | 60.8 / 70.0% | 61.3 / 70.4% | 59.4 / 70.9% |
| intended air yards | 7.79 | 7.63 | 7.85 |
| yards after the catch | 5.40 | 5.14 | 5.17 |
| yards an attempt | 6.86 | 6.65 | 7.16 |
| points a drive | 1.99 | 2.00 | 2.00 |

Each route's completion is still the league's; the quick out and the drag are
still caught at the league's depths (a fifth of each behind the line).

**What it cost, and what is left**

The separation came in a fifth of a yard, and the windows under a yard went
past the league's — 17% to 15%. Yards an attempt fell two tenths: the quick out
and the drag, sitting down where the defenders are, give up less after the
catch. The drags are still six yards from anyone against zone: settled two or
three yards deep, they sit under hook defenders who are seven or eight yards
above them, in the space a real hook defender would come down into.

## 31. The hook defenders and the drags

Drags thrown against zone and on target: at the throw, the defender best
placed to get to where it would be caught was six yards from it, mostly to the
side; the ball is in the air a third of a second, and none of them could be
reached. To contest a drag, a defender has to be on it when it is thrown.

**Tried and withdrawn**

- *An underneath defender with nobody of his own walls the man crossing in
  front of him* — a crosser up to eight yards shallower than his spot, within
  his width. The drags went from 6.0 yards of separation to 5.9: the passer
  throws a drag when it is open, and walled, it is not thrown.

**Fixed**

- *How often the passer throws to his first read* was bounded at half a point
  of value and had sat on that bound in every fit since §20. The bound is now a
  point and a half. The passer now goes to his first read 58% of the time —
  FTN's 58% (with its designed throws, which the engine counts as first reads,
  68%; the bias is still climbing toward that, 0.87 at the end of the settle).

**Where it stands** (400 games; the average of two settles)

| | §30 | now | league |
|---|--:|--:|--:|
| first read | 52% | 58% | 58% (68% with designed) |
| second read | 19% | 18% | 11% |
| contested against man / zone | 18.4 / 11.6% | 19.8 / 11.0% | 19.9 / 11.1% |
| separation at the catch, WR | 3.85 | 3.84 | 2.86 |
| twenty-yard completions, of attempts | 7.0% | 7.4% | 8.5% |
| yards an attempt | 6.65 | 6.77 | 7.16 |
| points a drive | 2.00 | 1.98 | 2.00 |

**What it showed**

Going to the first read more did not tighten the windows: separation at the
catch hardly moved. The wide-open receivers are not the passer looking past
his first read for them; they are open on the first read too. And the
underneath defenders cannot take them away by moving to them, because the
passer then throws elsewhere. Across the last four rounds the engine's
coverage has come to match the league on every count FTN has — contested
balls by depth, by man and zone, completion by coverage, accuracy — while the
separation at the catch has stayed a yard wider than Next Gen Stats'. That may
be partly a difference of measure: Next Gen Stats' separation is the distance
to the nearest defender when the ball arrives, tracked; the engine's is the
same, but from a defender who has run a straight, perfect line to it. Where the
league's charting can be matched, it now is.

## 32. After an interception

An interception changed who had the ball and nothing else: the receivers ran
out their routes, the line held its pass sets, no one was sent to make the
tackle (the choreography named a tackler for every carry but a pick), and the
rest of the defence chased its own man. The returner ran to the engine's spot
and stopped there with nobody near him. Across 60 picks from simulated games
the nearest offensive player at the whistle was 7.9 yards from him on average
(20.8 at worst), and the offence had moved 1.1 yards each after the catch.

Now the offence turns when the ball does (choreo.ts): every man chases the
returner, the linemen at 4.4 yards a second; the one nearest the spot where
he goes down is timed to arrive there and make the tackle; and the defence
peels off to block, each defender taking the nearest chaser and leaving the
tackler to his tackle. On a return all the way nobody is picked to catch him.
Over the same 60: the tackler 0.6 yards from the returner at the whistle (1.0
at worst), three of the offence within six yards, each man 8.3 yards on from
where he was at the catch, and nobody faster than a man can run. Drawn only:
where the returner goes down is the engine's, as before.
