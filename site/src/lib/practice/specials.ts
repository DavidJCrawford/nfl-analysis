/** Kicks, drawn: kickoffs, punts, field goals and extra points.
 *
 *  Nobody calls these — the game decides them (game.ts) — but they are shown
 *  like every other snap, so the field never jumps from one spot to another
 *  without the ball having gone there. As with choreo.ts, the picture may not
 *  contradict the result: the kickoff's returner goes down where the game
 *  says the drive starts, the punt is caught where its net and return add up
 *  to, and a kick goes through or wide as the game decided.
 *
 *  The alignments are the real ones. Kickoffs follow the rules in force since
 *  2025: the kicking team's ten at the receiving 40, nine of the receiving
 *  team in the setup zone between its 30 and 35, two returners deep, and
 *  nobody but the kicker and the returners moving until the ball is caught.
 *
 *  Everything is in the kicking side's frame: x downfield from the spot of
 *  the kick, y across, as in engine.ts. One picture format — the Reel — is
 *  shared with scrimmage plays, so the page draws them all the same way. */
import { HASH } from './kb';
import { seeded, type Result, type Spot } from './engine';
import { DT, FPS, clampY, dist, lerp, step, type Beat, type Movie } from './choreo';
import type { Card, TeamDoc } from './types';

export interface Actor { card: Card; team: 'kick' | 'recv'; xy: Float32Array; }
export interface Reel {
  frames: number; whistle: number;
  actors: Actor[];
  /** x, y, height per frame. */
  ball: Float32Array;
  beats: Beat[];
  /** The actor on the ground at the end, by index. */
  downed?: number;
  /** The line the picture is drawn from, in the kicking (or offence) side's
   *  frame, and the line to gain if there is one. */
  los: number; togo: number | null;
  /** Goal posts are drawn bright for a kick at them. */
  posts?: boolean;
}

/** A scrimmage play's movie as a reel. */
export function playReel(r: Result, m: Movie, los: number, togo: number): Reel {
  const actors: Actor[] = [];
  let downed: number | undefined;
  for (const [s, c] of Object.entries(r.stage.def.cards) as [string, Card][]) {
    const xy = (m.def as Record<string, Float32Array | undefined>)[s];
    if (!xy) continue;
    if (m.downed?.side === 'def' && m.downed.slot === s) downed = actors.length;
    actors.push({ card: c, team: 'recv', xy });
  }
  for (const [s, c] of Object.entries(r.stage.off.cards) as [string, Card][]) {
    const xy = (m.off as Record<string, Float32Array | undefined>)[s];
    if (!xy) continue;
    if (m.downed?.side === 'off' && m.downed.slot === s) downed = actors.length;
    actors.push({ card: c, team: 'kick', xy });
  }
  return { frames: m.frames, whistle: m.whistle, actors, ball: m.ball, beats: m.beats, downed, los, togo };
}

// ── Who is on the field for a kick.

const nobody = (pos: string, no = 0): Card => ({ id: `-${pos}-${no}`, name: pos, short: pos, no, pos, face: false });
const take = (pool: Card[], n: number, test: (c: Card) => boolean, used: Set<string>) => {
  const out: Card[] = [];
  for (const c of pool) { if (out.length >= n) break; if (!used.has(c.id) && test(c)) { out.push(c); used.add(c.id); } }
  return out;
};
const DB = new Set(['CB', 'DB', 'FS', 'SS', 'S']);
const LB = new Set(['OLB', 'ILB', 'MLB', 'LB']);
/** Special-teams units are mostly linebackers, backs and safeties; the
 *  club's own lists are of starters, so they are drawn from in that order. */
function unit(t: TeamDoc, n: number, used: Set<string>): Card[] {
  const pool = [...t.defence, ...t.offence];
  const out = [
    ...take(pool, n, (c) => LB.has(c.pos) || DB.has(c.pos), used),
  ];
  out.push(...take(pool, n - out.length, (c) => c.pos === 'TE' || c.pos === 'WR' || c.pos === 'RB', used));
  out.push(...take(pool, n - out.length, () => true, used));
  while (out.length < n) out.push(nobody('ST', out.length));
  return out;
}
function returner(t: TeamDoc, used: Set<string>): Card {
  const pool = t.offence;
  const c = take(pool, 1, (c) => c.pos === 'WR', used)[0] ?? take(pool, 1, (c) => c.pos === 'RB', used)[0] ?? nobody('KR');
  return c;
}

// ── A small integrator, as choreo.ts has.

class Stage {
  pos: Spot[] = []; tracks: Float32Array[] = [];
  constructor(readonly frames: number) {}
  add(at: Spot): number { this.pos.push({ ...at }); this.tracks.push(new Float32Array(this.frames * 2)); return this.pos.length - 1; }
  rec(f: number) { this.pos.forEach((p, i) => { this.tracks[i]![f * 2] = p.x; this.tracks[i]![f * 2 + 1] = clampY(p.y); }); }
}
/** Top speed, as in choreo.ts. */
const VMAX = 9.3;
const sprint = (p: Spot, to: Spot, left: number, floor: number) =>
  step(p, to, Math.min(VMAX, Math.max(floor, dist(p, to) / Math.max(DT, left))));
const arc = (from: Spot, to: Spot, u: number, peak: number): [number, number, number] => {
  const p = lerp(from, to, u);
  return [p.x, p.y, Math.sin(Math.PI * Math.min(1, u)) * peak];
};

// ── Kickoff.

/** From the kicking side's `from` (its own 35, or its 20 after a safety);
 *  the receiving side starts its drive at its own `start`. */
export function kickoffReel(kick: TeamDoc, recv: TeamDoc, from: number, start: number): Reel {
  const rand = seeded(from * 131 + start * 7 + 1);
  const touchback = start === 35 && rand() < 0.75;
  const toX = (ownYard: number) => 100 - ownYard - from;      // a receiving-side yard line in the kicking frame
  const ret = touchback ? 0 : 10 + rand() * 16;
  const catchYard = touchback ? -4 : Math.max(-3, start - ret);
  const C: Spot = { x: toX(catchYard), y: (rand() - 0.5) * 18 };
  const E: Spot = { x: toX(start), y: clampY(C.y + (rand() - 0.5) * 22) };
  const tKick = 0.75, tCatch = tKick + 3.9;
  // Coverage five yards short of the receiving 40 — at it, for a kick from
  // the 35 — and the setup zone five to ten yards beyond them. Nobody moves
  // until the catch, so where the coverage is then is known now: the man
  // who makes the tackle is the one nearest the spot, and the return lasts
  // long enough for him to get there at a hard run.
  const coverAt = (k: number): Spot => ({ x: 25, y: -22 + k * (44 / 9) });
  let tk = 0;
  for (let k = 1; k < 10; k++) if (dist(coverAt(k), E) < dist(coverAt(tk), E)) tk = k;
  const tEnd = touchback ? tCatch + 0.8
    : tCatch + Math.max(0.6, dist(C, E) / 7, Math.min(dist(coverAt(tk), E) / 8.2, dist(C, E) / 4.2));
  const frames = Math.round((tEnd + 1.2) * FPS), whistle = Math.round(tEnd * FPS);
  const st = new Stage(frames);
  const usedK = new Set<string>(), usedR = new Set<string>();
  const kicker = kick.kicker ?? nobody('K');
  const cover = unit(kick, 10, usedK);
  const ret0 = returner(recv, usedR), ret1 = returner(recv, usedR);
  const front = unit(recv, 9, usedR);

  const actors: Actor[] = [];
  const iK = st.add({ x: -7, y: 1.5 }); actors.push({ card: kicker, team: 'kick', xy: st.tracks[iK]! });
  const iCover = cover.map((c, k) => { const i = st.add(coverAt(k)); actors.push({ card: c, team: 'kick', xy: st.tracks[i]! }); return i; });
  const iFront = front.map((c, k) => { const i = st.add({ x: k < 7 ? 30 : 34, y: k < 7 ? -18 + k * 6 : (k === 7 ? -8 : 8) }); actors.push({ card: c, team: 'recv', xy: st.tracks[i]! }); return i; });
  const iRet = st.add({ x: toX(3), y: -7 }); actors.push({ card: ret0, team: 'recv', xy: st.tracks[iRet]! });
  const iRet2 = st.add({ x: toX(3), y: 7 }); actors.push({ card: ret1, team: 'recv', xy: st.tracks[iRet2]! });
  // The returner is whichever of the two the ball is kicked toward.
  const [iR, iOther] = C.y < 0 ? [iRet, iRet2] : [iRet2, iRet];
  const tackler = iCover[tk]!;
  let carryFrom: Spot | null = null;
  const ball = new Float32Array(frames * 3);

  for (let f = 0; f < frames; f++) {
    const t = f * DT;
    const live = t < tEnd;
    const P = st.pos;
    // The run-up at an even pace: eased, it peaked at thirteen yards a second.
    if (t < tKick) P[iK] = lerp({ x: -6, y: 1.3 }, { x: -0.4, y: 0.3 }, t / tKick);
    else if (live) P[iK] = step(P[iK]!, { x: C.x * 0.4, y: C.y * 0.3 }, t > tCatch ? 5 : 0.0001);
    // Returners drift under it; after the catch, the man with it runs.
    if (t < tCatch) {
      P[iR] = sprint(P[iR]!, C, tCatch - t, 2);
      P[iOther] = step(P[iOther]!, { x: C.x - 4, y: C.y + (iOther === iRet ? -5 : 5) }, 3);
    } else if (live && !touchback) {
      carryFrom ??= { ...P[iR]! };
      P[iR] = lerp(carryFrom, E, (t - tCatch) / Math.max(0.05, tEnd - tCatch));
      P[iOther] = step(P[iOther]!, { x: P[iR]!.x - 2, y: P[iR]!.y + 2 }, 6);
    }
    if (t >= tCatch && live && !touchback) {
      const carrier = P[iR]!;
      for (const i of iCover) {
        if (i === tackler) P[i] = sprint(P[i]!, { x: E.x - 0.7, y: E.y + 0.5 }, tEnd - t, 6.8);
        else if (dist(P[i]!, carrier) > 1.4) P[i] = step(P[i]!, carrier, 6.8);
      }
      // The front line turns and blocks: each toward the coverage man in
      // his lane, between him and the ball.
      iFront.forEach((i, k) => {
        const m = P[iCover[k % iCover.length]!]!;
        const to = { x: m.x + (carrier.x - m.x) * 0.25 + 0.8, y: m.y + (carrier.y - m.y) * 0.25 };
        if (dist(P[i]!, m) > 1.2) P[i] = step(P[i]!, to, 5.6);
      });
    }
    st.rec(f);
    // The ball: on the tee, in the air, then with the returner.
    let b: [number, number, number];
    if (t < tKick) b = [0, 0, 0.2];
    else if (t < tCatch) { const u = (t - tKick) / (tCatch - tKick); b = arc({ x: 0, y: 0 }, touchback ? C : lerp(C, P[iR]!, u), u, 16); }
    else if (touchback) { const p = P[iR]!; b = [Math.max(C.x, p.x), C.y, 0.3]; }
    else { const p = P[iR]!; b = [p.x, p.y, 0.4]; }
    ball.set(b, f * 3);
  }
  const beats: Beat[] = [{ t: tKick, text: 'Kickoff', tone: 'plain' }];
  beats.push(touchback ? { t: tCatch, text: 'Touchback', tone: 'plain' } : { t: tCatch, text: 'Fielded', tone: 'plain' });
  const downed = touchback ? undefined : actors.findIndex((a) => a.xy === st.tracks[iR]);
  return { frames, whistle, actors, ball, beats, downed, los: from, togo: null };
}

// ── Punt.

export function puntReel(kick: TeamDoc, recv: TeamDoc, from: number, net: number, ret: number, touchback: boolean): Reel {
  const rand = seeded(from * 17 + net * 3 + ret);
  const toGoal = 100 - from;
  const gross = touchback ? Math.min(toGoal + 4, toGoal + 9) : net + ret;
  const C: Spot = { x: gross, y: (rand() - 0.5) * 16 };
  const E: Spot = { x: touchback ? toGoal + 8 : net, y: clampY(C.y + (ret ? (rand() - 0.5) * 12 : 0)) };
  const tSnap = 0.75, tKick = 1.9, tCatch = tKick + 4.3;
  const tEnd = touchback ? tCatch + 1.0 : ret === 0 ? tCatch + 0.5 : tCatch + Math.max(0.5, dist(C, E) / 6.5);
  const frames = Math.round((tEnd + 1.2) * FPS), whistle = Math.round(tEnd * FPS);
  const st = new Stage(frames);
  const usedK = new Set<string>(), usedR = new Set<string>();
  const actors: Actor[] = [];
  const add = (c: Card, team: 'kick' | 'recv', at: Spot) => { const i = st.add(at); actors.push({ card: c, team, xy: st.tracks[i]! }); return i; };

  // The punt team: a snapper and six on the line, a personal protector, two
  // gunners split wide, and the punter fifteen yards back.
  const line = [...kick.offence.filter((c) => ['C', 'G', 'T'].includes(c.pos)), ...kick.offence.filter((c) => c.pos === 'TE')];
  line.forEach((c) => usedK.add(c.id));
  while (line.length < 7) line.push(...unit(kick, 1, usedK));
  const iLine = line.slice(0, 7).map((c, k) => add(c, 'kick', { x: -0.6, y: [0, 1.7, -1.7, 3.4, -3.4, 5.1, -5.1][k]! }));
  const [g1, g2, pp] = unit(kick, 3, usedK);
  const iG = [add(g1!, 'kick', { x: -0.8, y: 20 }), add(g2!, 'kick', { x: -0.8, y: -20 })];
  const iPP = add(pp!, 'kick', { x: -5.5, y: 0.5 });
  const iP = add(kick.punter ?? nobody('P'), 'kick', { x: -14, y: 0 });
  // The return team: six at the line, two on the gunners, one in the middle,
  // and the returner where the ball is going.
  const rr = returner(recv, usedR);
  const rs = unit(recv, 9, usedR);
  const iRush = rs.slice(0, 6).map((c, k) => add(c, 'recv', { x: 1.3, y: [-1, 1, -3.5, 3.5, -6, 6][k]! }));
  const iJam = [add(rs[6]!, 'recv', { x: 1.5, y: 19 }), add(rs[7]!, 'recv', { x: 1.5, y: -19 })];
  const iMid = add(rs[8]!, 'recv', { x: 9, y: 0 });
  const iR = add(rr, 'recv', { x: Math.min(gross + 3, toGoal + 3), y: C.y * 0.5 });
  let tackler = iG[0]!, best = Infinity;
  const ball = new Float32Array(frames * 3);
  let carryFrom: Spot | null = null, tackleFrom: Spot | null = null;
  const P = st.pos;

  for (let f = 0; f < frames; f++) {
    const t = f * DT;
    const live = t < tEnd;
    if (live) {
      // Gunners straight down the sideline, the jammers on them; everyone
      // else releases once the ball is away.
      // The tackler is chosen as the ball comes down, and from then on moves
      // only as the tackler — moved by both, he covered sixteen yards a
      // second for a frame.
      if (!touchback && ret > 0 && t >= tCatch && !tackleFrom) {
        for (const i of [...iG, ...iLine, iPP]) { const d = dist(P[i]!, E); if (d < best) { best = d; tackler = i; } }
        tackleFrom = { ...P[tackler]! };
      }
      const free = (i: number) => !tackleFrom || i !== tackler;
      iG.forEach((i, k) => {
        if (!free(i)) { const j = iJam[k]!; P[j] = step(P[j]!, { x: P[i]!.x + 1.2, y: P[i]!.y + (k ? 0.8 : -0.8) }, 6.4); return; }
        const target = t < tCatch ? { x: C.x - 1.5, y: C.y + (k ? -3 : 3) } : P[iR]!;
        if (dist(P[i]!, target) > 1.4) P[i] = step(P[i]!, t < 2.5 ? { x: P[i]!.x + 10, y: P[i]!.y } : target, t < 1.2 ? 5 : 6.6);
        const j = iJam[k]!;
        P[j] = step(P[j]!, { x: P[i]!.x + 1.2, y: P[i]!.y + (k ? 0.8 : -0.8) }, 6.4);
      });
      for (const i of [...iLine, iPP]) {
        if (!free(i)) continue;
        if (t < tKick + 0.2) P[i] = step(P[i]!, { x: -1.4, y: P[i]!.y }, 1.5);
        else if (t < tCatch) P[i] = step(P[i]!, { x: C.x - 6, y: C.y + (P[i]!.y - C.y) * 0.6 }, 6);
        else if (!touchback && dist(P[i]!, P[iR]!) > 1.4) P[i] = step(P[i]!, P[iR]!, 6.3);
      }
      iRush.forEach((i, k) => {
        if (t < tKick + 0.3) P[i] = step(P[i]!, { x: -1.0, y: P[i]!.y }, 2.5);
        else P[i] = step(P[i]!, { x: C.x - 9 + (k % 2) * 2, y: C.y + (k - 2.5) * 3 }, 5.4);
      });
      P[iMid] = step(P[iMid]!, { x: C.x - 6, y: C.y }, t < tKick ? 0.5 : 5.5);
      // The punter: the snap, two steps, the kick, then he stays home.
      if (t > tSnap && t < tKick) P[iP] = step(P[iP]!, { x: -12, y: 0 }, 2);
      // The returner settles under it.
      if (t < tCatch) P[iR] = touchback ? step(P[iR]!, { x: Math.min(C.x - 6, toGoal - 3), y: C.y }, 3) : sprint(P[iR]!, C, tCatch - t, 1.5);
      else if (!touchback && ret > 0) { carryFrom ??= { ...P[iR]! }; P[iR] = lerp(carryFrom, E, (t - tCatch) / Math.max(0.05, tEnd - tCatch)); }
    }
    // The tackle: whoever is nearest the spot when the ball comes down, at
    // a sprint timed for the whistle and no faster than a man can run.
    if (tackleFrom) {
      if (live) P[tackler] = sprint(P[tackler]!, { x: E.x + 0.7, y: E.y + 0.4 }, tEnd - t, 6.3);
    }
    st.rec(f);
    let b: [number, number, number];
    if (t < tSnap) { const u = t / tSnap; b = [-0.6 - u * 11.4, 0, 0.6 * Math.sin(Math.PI * u)]; }
    else if (t < tKick) { const p = P[iP]!; b = [p.x + 0.3, p.y, 0.6]; }
    else if (t < tCatch) { const u = (t - tKick) / (tCatch - tKick); b = arc({ x: -11, y: 0 }, touchback ? C : lerp(C, P[iR]!, u), u, 20); }
    else if (touchback) { const u = Math.min(1, (t - tCatch) / 0.8); b = [C.x + u * 4, C.y, Math.abs(Math.sin(u * Math.PI * 2)) * 1.2 * (1 - u)]; }
    else { const p = P[iR]!; b = [p.x, p.y, 0.4]; }
    ball.set(b, f * 3);
  }
  const beats: Beat[] = [{ t: tKick, text: 'Punt', tone: 'plain' },
    { t: tCatch, text: touchback ? 'Touchback' : ret === 0 ? 'Fair catch' : 'Fielded', tone: 'plain' }];
  return { frames, whistle, actors, ball, beats, downed: !touchback && ret > 0 ? actors.findIndex((a) => a.xy === st.tracks[iR]) : undefined, los: from, togo: null };
}

// ── Field goals and extra points.

/** A place kick from `from` (the line of scrimmage, kicking frame), good or
 *  not. The posts are at the back of the end zone, eighteen and a half feet
 *  apart — the same width, it happens, as the hash marks. */
export function placeKickReel(kick: TeamDoc, block: TeamDoc, from: number, good: boolean, pat: boolean): Reel {
  const rand = seeded(from * 29 + (good ? 1 : 2));
  const posts = 100 - from + 10;
  const tSnap = 0.4, tKick = 1.3;
  const length = posts + 7;
  const tFly = tKick + 0.5 + length / 26;
  const wide = good ? 0 : (rand() < 0.5 ? 1 : -1) * (HASH + 0.8 + rand() * 2.5);
  const short = !good && length > 50 && rand() < 0.4;
  const T: Spot = short ? { x: posts - 4 - rand() * 4, y: (rand() - 0.5) * 3 } : { x: posts + 1, y: good ? (rand() - 0.5) * HASH * 1.2 : wide };
  const tEnd = tFly + 0.3;
  const frames = Math.round((tEnd + 1.3) * FPS), whistle = Math.round(tEnd * FPS);
  const st = new Stage(frames);
  const usedK = new Set<string>();
  const actors: Actor[] = [];
  const add = (c: Card, team: 'kick' | 'recv', at: Spot) => { const i = st.add(at); actors.push({ card: c, team, xy: st.tracks[i]! }); return i; };
  const line = [...kick.offence.filter((c) => ['C', 'G', 'T'].includes(c.pos)), ...kick.offence.filter((c) => c.pos === 'TE')];
  line.forEach((c) => usedK.add(c.id));
  while (line.length < 7) line.push(...unit(kick, 1, usedK));
  line.slice(0, 7).forEach((c, k) => add(c, 'kick', { x: -0.6, y: [0, 1.7, -1.7, 3.4, -3.4, 5.1, -5.1][k]! }));
  const wings = unit(kick, 2, usedK);
  add(wings[0]!, 'kick', { x: -1.3, y: 6.4 }); add(wings[1]!, 'kick', { x: -1.3, y: -6.4 });
  const iH = add(kick.punter ?? nobody('H'), 'kick', { x: -7, y: 0 });
  const iK = add(kick.kicker ?? nobody('K'), 'kick', { x: -9.6, y: 2.6 });
  const blockers = [...block.defence];
  while (blockers.length < 11) blockers.push(nobody('ST', blockers.length));
  const iB = blockers.slice(0, 10).map((c, k) => add(c, 'recv', { x: 1.3, y: -7.5 + k * (15 / 9) }));
  add(blockers[10]!, 'recv', { x: Math.min(12, posts - 2), y: 0 });
  const ball = new Float32Array(frames * 3);
  const P = st.pos;
  for (let f = 0; f < frames; f++) {
    const t = f * DT;
    if (t < tEnd) {
      if (t > 0.5 && t < tKick) P[iK] = step(P[iK]!, { x: -7.6, y: 0.6 }, 4);
      for (const i of iB) if (t > 0.1 && t < tKick + 0.4) P[i] = step(P[i]!, { x: -0.6, y: P[i]!.y * 0.92 }, 1.6);
    }
    st.rec(f);
    let b: [number, number, number];
    if (t < tSnap) { const u = t / tSnap; b = [-0.6 - u * 6.4, 0, 0.3]; }
    else if (t < tKick) b = [-7, 0, 0.1];
    else if (t < tFly) {
      const u = (t - tKick) / (tFly - tKick);
      const p = lerp({ x: -7, y: 0 }, T, u);
      // Rising all the way to the posts, as a kick does, then dropping
      // beyond them.
      b = [p.x, p.y, short ? Math.sin(Math.PI * u) * 8 : Math.sin(Math.PI * u * 0.62) * 11];
    } else { const u = Math.min(1, (t - tFly) / 0.5); b = [T.x + u * (short ? 1 : 4), T.y, short ? 0 : (1 - u) * 7]; }
    ball.set(b, f * 3);
  }
  void iH;
  const word = pat ? (good ? 'Extra point good' : 'Extra point no good') : good ? 'Field goal good' : short ? 'Short' : 'Wide';
  return { frames, whistle, actors, ball, beats: [{ t: tFly, text: word, tone: good ? 'good' : 'bad' }], los: from, togo: null, posts: true };
}

