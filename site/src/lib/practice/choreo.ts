/** A resolved play, as twenty-two dots and a ball moving.
 *
 *  The engine decides what happened; this decides how it looked, and it may
 *  not contradict the engine. So the times and places the engine fixed are
 *  fixed here too — when the rush arrived, when and where the ball was
 *  thrown, where it was caught, where the carrier went down and who got him —
 *  and everything else is filled in by simple rules of movement: receivers run
 *  their routes, man defenders trail their man, zone defenders sit in their
 *  zones, everyone breaks on the ball when it is thrown and pursues the man
 *  who has it.
 *
 *  Integrated in fixed steps rather than written as closed-form paths,
 *  because pursuit depends on where the ball-carrier is, and the carrier's
 *  path depends on the play. Frames are kept, so the picture can be scrubbed
 *  and replayed without running it again.
 *
 *  All in the offence's frame (engine.ts): x downfield from the line of
 *  scrimmage, y across, positive to the quarterback's left. */
import { GAP_Y, HALF_WIDTH, LANDMARK, ROUTE, type DefSlot, type OffSlot, type RouteId } from './kb';
import { zoneSpot, type Result, type Spot } from './engine';
import { profile, runRoute } from './world';

export const FPS = 30;
export const DT = 1 / FPS;

export interface Beat { t: number; text: string; tone: 'good' | 'bad' | 'plain'; }

export interface Movie {
  frames: number;
  /** x, y per frame for each player. */
  off: Partial<Record<OffSlot, Float32Array>>;
  def: Partial<Record<DefSlot, Float32Array>>;
  /** x, y, height per frame. */
  ball: Float32Array;
  beats: Beat[];
  /** The frame the play is over on; the movie holds a moment after it. */
  whistle: number;
  /** Who is on the ground at the end, for drawing. */
  downed?: { side: 'off' | 'def'; slot: string };
}

export const dist = (a: Spot, b: Spot) => Math.hypot(a.x - b.x, a.y - b.y);
export const lerp = (a: Spot, b: Spot, f: number): Spot => ({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f });
export const ease = (u: number) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));
export const clampY = (y: number) => Math.max(-HALF_WIDTH + 0.5, Math.min(HALF_WIDTH - 0.5, y));
/** Move from `p` toward `to` by at most `speed * DT`. */
export const step = (p: Spot, to: Spot, speed: number): Spot => {
  const d = dist(p, to), m = speed * DT;
  return d <= m ? { ...to } : { x: p.x + ((to.x - p.x) / d) * m, y: p.y + ((to.y - p.y) / d) * m };
};

export function choreograph(r: Result): Movie {
  const { off, def, jobs, call, hashY, under } = r.stage;
  const O0 = off.at, D0 = def.at;
  const oSlots = Object.keys(O0) as OffSlot[];
  const dSlots = Object.keys(D0) as DefSlot[];
  const pass = call.kind === 'pass';
  const beats: Beat[] = [];

  // ── The fixed points.
  const qb0 = O0.QB!;
  const pocket: Spot = { x: under ? -7 : Math.min(qb0.x, -5) - 1.2, y: qb0.y };
  const tDrop = under ? (call.playAction ? 1.5 : 1.1) : 0.6;
  const tPress = r.tPress;
  let carrier: { side: 'off' | 'def'; slot: string } | null = null;
  let tCarry = Infinity;                 // when the carrier has the ball
  let tEnd: number;                      // when he is down
  const E: Spot = { x: r.end.x, y: clampY(r.end.y) };
  let throwAt: number | null = null, catchAt: Spot | null = null, tCatch = 0;
  let throwFrom: Spot | null = null;
  let handoff: number | null = null;
  let gapPt: Spot | null = null;
  let tGap = 0;
  // A pass was played out in the world (world.ts) before it was decided;
  // those frames are the picture up to the catch, or up to the moment the
  // quarterback gave up on throwing, and everything here carries on from
  // their last one.
  const tr = r.trace;
  const trEnd = tr ? (tr.frames - 1) * DT : 0;
  const endLine = (r.stage.toGoal ?? 100) + 10;
  /** A receiver on his route at time t: as the world ran it, where it did. */
  const onRoute = (slot: OffSlot, start: Spot, _job: RouteId, t: number): Spot => {
    const a = tr?.routes[slot];
    if (!a) return start;
    const i = Math.max(0, Math.min(a.length / 2 - 1, Math.round(t * FPS)));
    return { x: a[i * 2]!, y: a[i * 2 + 1]! };
  };

  if (r.kind === 'run') {
    // The mesh, then a patient press to the hole: a back takes 2.8 seconds
    // to reach the line of scrimmage (Next Gen Stats, 2023), not the 1.6 he
    // took when he simply ran there.
    handoff = r.ballCarrier === 'QB' ? null : under ? 0.95 : 0.85;
    gapPt = { x: 0.6, y: hashY + GAP_Y[r.gap ?? 'middle'] };
    if (r.ballCarrier === 'QB') {
      carrier = { side: 'off', slot: 'QB' }; tCarry = 0.2;
      tEnd = 0.25 + Math.max(0.6, dist(qb0, E) / 2.8);
    } else {
      carrier = { side: 'off', slot: O0.RB ? 'RB' : 'FB' }; tCarry = handoff!;
      // To the hole at a back's pace from where he lines up; a fixed time
      // had a deep back covering eight yards in three-quarters of a second.
      tGap = handoff! + 0.15 + dist(O0[carrier.slot as OffSlot]!, gapPt) / 4.0;
      // Stopped for no gain or a loss, he never reached the hole: he is met
      // on his way to it, where the engine says, so he goes straight there.
      // (Sent to the hole first, he had a fifth of a second to come back six
      // yards.)
      if (E.x < 0.5) { tGap = handoff!; tEnd = handoff! + Math.max(0.5, dist(O0[carrier.slot as OffSlot]!, E) / 6); }
      else tEnd = tGap + Math.max(0.3, dist(gapPt, E) / 6.3);
    }
  } else if (r.kind === 'sack') {
    tEnd = Math.max(tPress ?? 2.7, trEnd) + Math.max(0.4, dist(pocket, E) / 3.5);
  } else if (r.kind === 'scramble') {
    const go = Math.max((tPress ?? 3.3) + 0.15, trEnd + 0.05);
    carrier = { side: 'off', slot: 'QB' }; tCarry = go;
    tEnd = go + Math.max(0.6, dist(pocket, E) / 6);
  } else if (r.kind === 'throwaway') {
    throwAt = Math.max((tPress ?? 3.6) + 0.3, trEnd + 0.05);
    tCatch = throwAt + 0.9;
    catchAt = { x: 6, y: (pocket.y >= 0 ? 1 : -1) * (HALF_WIDTH + 2) };
    tEnd = tCatch + 0.3;
  } else if (tr && tr.tThrow !== null && tr.catchAt && tr.tCatch !== null) {
    // A throw the world made: when, where, and when it got there are its.
    const s = r.target!;
    throwAt = tr.tThrow; catchAt = tr.catchAt; tCatch = tr.tCatch;
    if (r.kind === 'complete') {
      carrier = { side: 'off', slot: s }; tCarry = tCatch;
      // The run after the catch is the world's too, through to the tackle.
      tEnd = tr.post ? trEnd : tCatch + Math.max(0.25, dist(catchAt, E) / 6.6);
    } else if (r.kind === 'int') {
      carrier = { side: 'def', slot: r.credit.by ?? nearestDef(catchAt) }; tCarry = tCatch;
      tEnd = tCatch + Math.max(0.4, dist(catchAt, E) / 6.2);
    } else tEnd = tCatch + 0.7;
  } else {
    // A throw always comes with the world's trace; without one there is
    // nothing to draw beyond the snap.
    tEnd = 1.0;
  }

  function nearestDef(p: Spot): DefSlot {
    let best: DefSlot = dSlots[0]!, d = Infinity;
    for (const s of dSlots) {
      if (jobs[s]?.kind === 'rush') continue;
      const q = D0[s]!; const dd = dist(q, p);
      if (dd < d) { d = dd; best = s; }
    }
    return best;
  }

  /** Top speed. Ten yards a second is the fastest anyone in the league is
   *  timed at in a game; nobody here goes faster than a little under it. */
  const VMAX = 9.3;
  /** Toward `to`, fast enough to be there in `left` seconds if he can, never
   *  faster than top speed and never slower than `floor`. */
  const sprint = (p: Spot, to: Spot, left: number, floor: number) =>
    step(p, to, Math.min(VMAX, Math.max(floor, dist(p, to) / Math.max(DT, left))));

  // An incomplete pass bounces this far, for this long, turned this much
  // off the line it was thrown on — the turn fixed by the play, so a replay
  // of it bounces the same way.
  const BOUNCE_YDS = 5.5, BOUNCE_S = 1.2;
  const bounceTurn = (((Math.abs(Math.sin((r.air ?? 3) * 12.9898 + hashY * 78.233)) * 43758.5453) % 1) * 2 - 1) * 0.9;
  let arrived: Spot | null = null;     // where the ball reached the receiver
  let settle: Spot | null = null;      // where the receiver of an incompletion pulls up
  let whistle = 0, frames = 0;
  let offT: Partial<Record<OffSlot, Float32Array>> = {};
  let defT: Partial<Record<DefSlot, Float32Array>> = {};
  let ball = new Float32Array(0);
  // Measured on a pass, for the next: where the tackler and the carrier
  // were when the ball changed hands.
  let tacklerAt: Spot | null = null, carrierAt: Spot | null = null;
  // After an interception the offence has to make the tackle: whoever is
  // nearest the spot the engine puts the returner down, when he picks it off.
  let intTackler: OffSlot | null = null;

  // The man who makes the tackle, sack or pick: the engine's credit, or else
  // whoever is nearest when it comes to it.
  const tackler = r.credit.by;
  const rushers = dSlots.filter((s) => jobs[s]?.kind === 'rush');
  const presser: DefSlot | undefined = r.kind === 'sack' ? (tackler ?? rushers[0]) : tPress !== null ? rushers[Math.abs(Math.round(hashY * 7)) % Math.max(1, rushers.length)] : undefined;

  function run(): void {
  whistle = Math.round(tEnd! * FPS);
  frames = whistle + Math.round(1.1 * FPS);
  throwFrom = tr && tr.tThrow !== null ? { x: tr.ball[Math.round(tr.tThrow * FPS) * 3]!, y: tr.ball[Math.round(tr.tThrow * FPS) * 3 + 1]! } : null;
  tacklerAt = null; carrierAt = null; arrived = null; settle = null; intTackler = null;
  // ── State.
  const pos: Record<string, Spot> = {};
  for (const s of oSlots) pos[`o${s}`] = { ...O0[s]! };
  for (const s of dSlots) pos[`d${s}`] = { ...D0[s]! };
  offT = {}; defT = {};
  for (const s of oSlots) offT[s] = new Float32Array(frames * 2);
  for (const s of dSlots) defT[s] = new Float32Array(frames * 2);
  ball = new Float32Array(frames * 3);
  let carrierFrom: Spot | null = null;     // where the carrier was when he got it
  const qbAt = () => pos.oQB!;
  const cKey = () => (carrier ? `${carrier.side === 'off' ? 'o' : 'd'}${carrier.slot}` : null);

  for (let f = 0; f < frames; f++) {
    const t = f * DT;
    // The world's frames, as they were.
    if (tr && f < tr.frames) {
      for (const s of oSlots) { const a = tr.off[s]; if (a) pos[`o${s}`] = { x: a[f * 2]!, y: a[f * 2 + 1]! }; }
      for (const s of dSlots) { const a = tr.def[s]; if (a) pos[`d${s}`] = { x: a[f * 2]!, y: a[f * 2 + 1]! }; }
      ball.set([tr.ball[f * 3]!, tr.ball[f * 3 + 1]!, tr.ball[f * 3 + 2]!], f * 3);
      if (throwAt !== null && Math.round(throwAt * FPS) === f) throwFrom = { x: tr.ball[f * 3]!, y: tr.ball[f * 3 + 1]! };
      if (f === tr.catchFrame && tr.catchAt) arrived = { x: tr.ball[f * 3]!, y: tr.ball[f * 3 + 1]! };
      for (const s of oSlots) { offT[s]![f * 2] = pos[`o${s}`]!.x; offT[s]![f * 2 + 1] = pos[`o${s}`]!.y; }
      for (const s of dSlots) { defT[s]![f * 2] = pos[`d${s}`]!.x; defT[s]![f * 2 + 1] = pos[`d${s}`]!.y; }
      continue;
    }
    const done = t >= tEnd!;
    const live = !done;
    const ck = cKey();
    const hasBall = ck && t >= tCarry;

    // ── Offence.
    const turned = r.kind === 'int' && hasBall;
    if (turned && !intTackler && !r.td) {
      let d = Infinity;
      for (const s of oSlots) { const q = dist(pos[`o${s}`]!, E); if (q < d) { d = q; intTackler = s; } }
    }
    for (const s of oSlots) {
      const k = `o${s}`, p0 = O0[s]!;
      let p = pos[k]!;
      if (done) { /* stand */ }
      else if (turned) {
        // The ball has changed hands, and the offence is the defence now:
        // every man turns and goes after the one who has it — the linemen at
        // their pace — and the nearest to where he goes down gets there to
        // bring him down. On a return all the way, nobody catches him.
        const c = pos[ck!]!;
        if (s === intTackler) {
          tacklerAt ??= { ...p };
          const away = dist(p, E) || 1;
          p = sprint(p, { x: E.x + (p.x - E.x) / away * 0.7, y: E.y + (p.y - E.y) / away * 0.7 }, tEnd! - t, 6.4);
        } else if (dist(p, c) > 1.3) p = step(p, c, ['LT', 'LG', 'C', 'RG', 'RT'].includes(s) ? 4.4 : 6.6);
      }
      else if (hasBall && k === ck) {
        // The ball-carrier: from where he got it to where the engine put him down.
        carrierFrom ??= { ...p };
        carrierAt ??= { ...p };
        if (r.kind === 'run' && s !== 'QB' && t < tGap) p = lerp(carrierFrom, gapPt!, (t - tCarry) / Math.max(0.05, tGap - tCarry));
        else if (r.kind === 'run' && s !== 'QB') p = lerp(tGap === tCarry ? carrierFrom : gapPt!, E, (t - tGap) / Math.max(0.05, tEnd! - tGap));
        else p = lerp(carrierFrom, E, (t - tCarry) / Math.max(0.05, tEnd! - tCarry));
      } else if (s === 'QB') {
        if (r.kind === 'run' && r.ballCarrier === 'QB') p = step(p, E, 2.8);
        else if (r.kind === 'run') p = t < handoff! ? step(p, { x: p0.x - 1.5, y: p0.y + 0.6 }, 4) : step(p, { x: -4, y: p0.y - 2.5 }, 3);
        else if (r.kind === 'sack' && t >= (tPress ?? 2.7)) p = sprint(p, E, tEnd! - t, 2);   // driven back to the engine's spot
        else if (call.playAction && t < 0.6) p = step(p, { x: -3, y: p0.y - 1 }, 5);
        else if (t < tDrop) p = step(p, pocket, under ? 7 : 4);
        else if (throwAt === null || t < throwAt) p = step(p, { x: pocket.x + 0.8, y: pocket.y }, 1);
      } else if (['LT', 'LG', 'C', 'RG', 'RT'].includes(s)) {
        p = pass ? step(p, { x: p0.x - 1.3, y: p0.y * 1.12 }, 2.2)
                 : step(p, { x: p0.x + 1.6, y: p0.y + (gapPt ? (gapPt.y - hashY) * 0.12 : 0) }, 2.6);
      } else {
        const job = call.jobs[s];
        if (r.kind === 'run') {
          // Everyone else blocks for the run: the lead back into the hole,
          // the rest a few yards on and engaged.
          if (s === 'FB' && gapPt) p = step(p, { x: gapPt.x + 1.5, y: gapPt.y }, 6);
          else if (s === 'RB') p = step(p, { x: p0.x + 1, y: p0.y }, 3);
          else p = step(p, { x: p0.x + (Math.abs(p0.y - hashY) > 8 ? 5 : 1.5), y: p0.y }, 4);
        } else if (!job || job === 'BLOCK') {
          p = p0.x < -2 ? step(p, { x: pocket.x + 2, y: pocket.y + (p0.y >= hashY ? 2 : -2) }, 4)
                        : step(p, { x: p0.x - 1, y: p0.y }, 2);
        } else {
          const thrown = throwAt !== null && t > throwAt + 0.5;
          const target = s === r.target;
          if (target && catchAt && throwAt !== null && t >= throwAt && t <= tCatch) {
            // Adjusting to the ball once it is in the air: off the route and
            // straight for where it is coming down, at a capped run. (Blended
            // from the route toward the spot, his route speed and the
            // correction added up to fourteen yards a second.)
            p = sprint(p, catchAt, tCatch - t, 6);
          } else if (target && t > tCatch && r.kind !== 'complete') {
            // He pulls up where it got to him, and the ball goes on without him.
            settle ??= { x: p.x + 1.2, y: p.y };
            p = step(p, settle, 2.5);
          }
          else if (!thrown) p = onRoute(s, p0, job, t);
          else p = step(p, onRoute(s, p0, job, t), 3);   // easing off once the ball has gone elsewhere
        }
      }
      p.y = clampY(p.y);
      pos[k] = p;
    }

    // ── Defence.
    const qb = qbAt();
    const ballSpot = hasBall ? pos[ck!]! : null;
    for (const s of dSlots) {
      const k = `d${s}`, p0 = D0[s]!;
      let p = pos[k]!;
      const j = jobs[s];
      const tackling = s === tackler && !!carrier && r.kind !== 'int' && !r.td && t >= tCarry;
      if (done && !tackling) { /* stand */ }
      else if (hasBall && k === ck) {
        carrierFrom ??= { ...p };
        carrierAt ??= { ...p };
        p = lerp(carrierFrom, E, (t - tCarry) / Math.max(0.05, tEnd! - tCarry));
      } else if (tackling) {
        // The man the engine credited, at the spot at the whistle: a sprint
        // timed to get there, never faster than a man can run. If even that
        // is too slow he gets there late, onto a pile somebody else started.
        tacklerAt ??= { ...p };
        const near = { x: E.x + 0.6, y: E.y + (p.y > E.y ? 0.5 : -0.5) };
        p = sprint(p, near, tEnd! - t, 6.4);
      } else if (r.kind === 'sack' && s === presser) {
        const tp = tPress ?? 2.7;
        p = t < tp - 0.9 ? step(p, { x: -1.4, y: p0.y }, 2) : sprint(p, { x: qb.x + 0.7, y: qb.y }, tp - t, 4);
      } else if (ballSpot && r.kind === 'int') {
        // A pick: the rest of the defence turns blocker, each taking the
        // nearest man chasing — between him and the ball — and leaving the
        // one who makes the tackle to make it.
        let mark: Spot | null = null, md = Infinity;
        for (const os of oSlots) {
          if (os === intTackler) continue;
          const q = pos[`o${os}`]!;
          if (dist(q, ballSpot) > 12) continue;
          const d = dist(p, q);
          if (d < md) { md = d; mark = q; }
        }
        if (mark) {
          const toward = dist(mark, ballSpot) || 1;
          p = step(p, { x: mark.x + (ballSpot.x - mark.x) / toward, y: mark.y + (ballSpot.y - mark.y) / toward }, 6.4);
        } else if (dist(p, ballSpot) > 3) p = step(p, ballSpot, 5.5);
      } else if (ballSpot) {
        // Pursuit: everyone at the man with the ball, stopping short of him.
        const d = dist(p, ballSpot);
        if (d > 1.3) p = step(p, ballSpot, j?.kind === 'rush' ? 5 : 6.4);
      } else if (j?.kind === 'rush') {
        const free = s === presser && tPress !== null;
        // Engaged: a blocked rusher is held a body's width in front of the
        // man blocking him, not walked through him.
        const line = r.kind === 'run' ? 0.9 : -0.7;
        if (r.kind === 'run' && t > 0.5) p = step(p, gapPt ?? qb, 2);
        else if (free && t > tPress! - 0.8) p = step(p, { x: qb.x + 0.8, y: qb.y }, 6);
        else p = step(p, { x: Math.max(line, qb.x + 1), y: p0.y + (qb.y - p0.y) * 0.2 }, ['E1', 'E2', 'T1', 'T2'].includes(s) ? 2.5 : 5);
      } else if (r.kind === 'run' && t > 0.4) {
        // A run: read it and fill.
        p = step(p, { x: Math.max(1, gapPt!.x + 2), y: gapPt!.y + (p0.y - gapPt!.y) * 0.3 }, ['LB1', 'LB2', 'LB3'].includes(s) ? 5 : 4.5);
      } else if (throwAt !== null && catchAt && t > throwAt + 0.25) {
        // The ball is in the air: break on it.
        // The man who picks it off breaks hardest, timed to arrive with it.
        const d = dist(p, catchAt);
        if (r.kind === 'int' && carrier?.slot === s && t <= tCatch) p = sprint(p, catchAt, tCatch - t, 6.6);
        else if (d > 0.8) p = step(p, catchAt, 6.6);
      } else if (j?.kind === 'man') {
        const m = pos[`o${j.on}`];
        if (m) p = step(p, { x: m.x + 1.0, y: m.y + (m.y > hashY ? -0.7 : 0.7) }, t < 0.4 ? 4 : 7.3);
      } else if (j?.kind === 'zone') {
        const z = zoneSpot(j.zone, hashY);
        // Sit in the zone, leaning toward a receiver who comes into it.
        let lean: Spot = z;
        let near = Infinity;
        for (const os of oSlots) {
          const job = call.jobs[os];
          if (!job || job === 'BLOCK') continue;
          const q = pos[`o${os}`]!; const d = dist(q, z);
          if (d < LANDMARK[j.zone].r && d < near) { near = d; lean = lerp(z, q, 0.55); }
        }
        p = step(p, lean, 5.6);
      }
      p.y = clampY(p.y);
      pos[k] = p;
    }

    // ── The ball.
    let b: [number, number, number];
    const snapT = under ? 0.12 : 0.35;
    if (t < snapT) {
      const q = qb; const f2 = t / snapT;
      b = [f2 * q.x, hashY + f2 * (q.y - hashY), under ? 0 : 0.6 * Math.sin(Math.PI * f2)];
    } else if (throwAt !== null && catchAt && t >= throwAt) {
      throwFrom ??= { ...qb };
      if (t <= tCatch) {
        const u = (t - throwAt) / Math.max(0.05, tCatch - throwAt);
        // The ball is thrown to wherever the man who catches it — or picks
        // it off — actually is, so the two arrive together however the race
        // to the spot went.
        const to = r.kind === 'int' && carrier ? pos[`d${carrier.slot}`] : r.target && r.kind !== 'throwaway' ? pos[`o${r.target}`] : undefined;
        const aim = to ? lerp(catchAt, to, u) : catchAt;
        const pt = lerp(throwFrom, aim, u);
        b = [pt.x, pt.y, Math.sin(Math.PI * u) * Math.min(9, dist(throwFrom, catchAt) * 0.22)];
        arrived = { x: pt.x, y: pt.y };
      } else if (hasBall) { const c = pos[ck!]!; b = [c.x, c.y, 0.4]; }
      else {
        // Incomplete: off his hands and away from him — up off the contact,
        // on the way it was thrown and knocked a little aside, then two
        // shrinking hops along the turf.
        const from = arrived ?? catchAt;
        let fx = from.x - throwFrom.x, fy = from.y - throwFrom.y;
        // Broken up: knocked away from the man who got a hand to it.
        const breaker = r.how === 'pbu' && r.credit.by ? pos[`d${r.credit.by}`] : undefined;
        if (breaker) { fx = from.x - breaker.x; fy = from.y - breaker.y; }
        const fl = Math.hypot(fx, fy) || 1;
        const turn = breaker ? bounceTurn * 0.4 : bounceTurn;
        const ux = (fx / fl) * Math.cos(turn) - (fy / fl) * Math.sin(turn);
        const uy = (fx / fl) * Math.sin(turn) + (fy / fl) * Math.cos(turn);
        const u = Math.min(1, (t - tCatch) / BOUNCE_S);
        // Off target, it lands and skids on; dropped, it falls close; broken
        // up, it pops up and away.
        const far = r.how === 'miss' ? 1.3 : r.how === 'drop' ? 0.45 : 1;
        const pop = r.how === 'pbu' ? 2.2 : r.how === 'miss' ? 0.6 : r.how === 'drop' ? 0.9 : 1.5;
        const go = BOUNCE_YDS * far * (1 - (1 - u) * (1 - u));      // quick off the hands, slowing as it rolls
        const hop = u < 0.42 ? Math.sin(Math.PI * u / 0.42) * pop
                  : u < 0.72 ? Math.sin(Math.PI * (u - 0.42) / 0.3) * 0.55
                  : u < 0.9 ? Math.sin(Math.PI * (u - 0.72) / 0.18) * 0.18 : 0;
        // Not held to the field: a ball knocked toward the sideline goes out.
        b = [from.x + ux * go, Math.max(-HALF_WIDTH - 3, Math.min(HALF_WIDTH + 3, from.y + uy * go)), hop];
      }
    } else if (hasBall) { const c = pos[ck!]!; b = [c.x, c.y, 0.4]; }
    else b = [qb.x, qb.y, 0.5];
    ball.set(b, f * 3);

    // Nobody past the back of the end zone, whatever he was doing.
    for (const k of Object.keys(pos)) if (pos[k]!.x > endLine - 0.5) pos[k] = { x: endLine - 0.5, y: pos[k]!.y };
    for (const s of oSlots) { offT[s]![f * 2] = pos[`o${s}`]!.x; offT[s]![f * 2 + 1] = pos[`o${s}`]!.y; }
    for (const s of dSlots) { defT[s]![f * 2] = pos[`d${s}`]!.x; defT[s]![f * 2 + 1] = pos[`d${s}`]!.y; }
    void live;
  }
  }

  // Twice if need be. The first pass finds where the tackler and the carrier
  // actually were when the ball changed hands; if the carrier's run as first
  // timed would need either to go faster than a man can, the run is given
  // the time it needs and played again. Only the timing changes — where the
  // ball goes, who gets it and where he goes down are the engine's.
  run();
  if (carrier && tCarry < Infinity && !tr?.post) {
    const from = carrierAt ?? E;
    let want = tEnd!;
    if (r.kind === 'int' || r.kind === 'complete' || r.kind === 'scramble') want = Math.max(want, tCarry + dist(from, E) / 7.5);
    // The tackler at a hard run rather than a flat sprint — but never at the
    // cost of slowing the carrier below a jog.
    if (tacklerAt && !r.td) {
      const isBack = r.kind === 'run' && r.ballCarrier !== 'QB';
      const slowest = (isBack ? tGap : tCarry) + (isBack && tGap > tCarry ? dist(gapPt!, E) : dist(from, E)) / 4.2;
      want = Math.max(want, Math.min(tCarry + dist(tacklerAt, E) / 8.2, slowest));
    }
    if (want > tEnd! + 0.05) { tEnd = want; run(); }
  }


  // ── What the picture says as it goes.
  if (tPress !== null && r.kind !== 'sack') beats.push({ t: tPress, text: 'Pressure', tone: 'plain' });
  if (r.kind === 'run' && handoff !== null) beats.push({ t: handoff, text: 'Handoff', tone: 'plain' });
  if (throwAt !== null && r.kind !== 'throwaway') beats.push({ t: throwAt, text: r.air && r.air >= 15 ? 'Deep shot' : 'Thrown', tone: 'plain' });
  const tE = tEnd!;
  switch (r.kind) {
    case 'complete': beats.push({ t: tCatch, text: 'Caught', tone: 'good' }); break;
    case 'incomplete': beats.push({ t: tCatch, text: 'Incomplete', tone: 'bad' }); break;
    case 'int': beats.push({ t: tCatch, text: 'Intercepted', tone: 'bad' }); break;
    case 'sack': beats.push({ t: tE - 0.3, text: 'Sacked', tone: 'bad' }); break;
    case 'scramble': beats.push({ t: tCarry, text: 'Scramble', tone: 'plain' }); break;
    case 'throwaway': beats.push({ t: throwAt ?? 3, text: 'Thrown away', tone: 'plain' }); break;
  }
  if (r.td) beats.push({ t: tE, text: 'Touchdown', tone: 'good' });
  else if (r.kind === 'run' && r.turnover) beats.push({ t: tE, text: 'Fumble', tone: 'bad' });
  else if (r.safety) beats.push({ t: tE, text: 'Safety', tone: 'bad' });

  const downed = r.td || !carrier ? (r.kind === 'sack' ? { side: 'off' as const, slot: 'QB' } : undefined) : carrier;
  return { frames, off: offT, def: defT, ball, beats, whistle, downed };
}

/** A path to draw for a route before the snap: the route as run, sampled. */
export function routePath(start: Spot, route: RouteId, hashY: number, endLine = Infinity): Spot[] {
  // As the world will run it (world.ts), cut off at the back of the end zone.
  const tr = runRoute(start, route, hashY, profile('WR'), 0, endLine);
  const len = ROUTE[route].path.reduce((acc, [x, y], i, a) => {
    const [px, py] = i ? a[i - 1]! : [0, 0];
    return acc + Math.hypot(x - px, y - py);
  }, 0);
  const T = Math.min(3.4, len / 7 + 0.4);
  const out: Spot[] = [];
  for (let f = 0; f * DT <= T + 1e-6 && f < tr.length / 2; f += 3) {
    const p = { x: tr[f * 2]!, y: tr[f * 2 + 1]! };
    const q = out[out.length - 1];
    // Once he has settled, the path ends where he stands.
    if (q && Math.hypot(p.x - q.x, p.y - q.y) < 0.05) break;
    out.push(p);
  }
  return out;
}
