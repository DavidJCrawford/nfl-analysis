/** Docs/PRACTICE.md §12: the computer plays itself, every club against every
 *  other, full-length quarters, and the totals are set beside the league's.
 *
 *    make calibrate          the report
 *    make calibrate ARGS=fit  also refit the quarterback's habits
 *                             (engine.ts READ_BIAS and NOBODY) and print them
 *
 *  The engine is not finished while the report disagrees with the league. */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Game } from '../src/lib/practice/game';
import { defCall, offCall } from '../src/lib/practice/ai';
import { FIT, MOTION, sampleQ } from '../src/lib/practice/engine';
import { choreograph, FPS } from '../src/lib/practice/choreo';
import type { Coverage, RouteId } from '../src/lib/practice/kb';
import type { League, League2026, TeamDoc } from '../src/lib/practice/types';

const MANC = new Set<string>(['COVER_0', 'COVER_1', '2_MAN']);

const dir = join(process.cwd(), 'public/data/practice');
const L = JSON.parse(readFileSync(join(dir, 'league.json'), 'utf8')) as League;
const lg26 = JSON.parse(readFileSync(join(dir, 'league2026.json'), 'utf8')) as League2026;
const teams = readdirSync(dir).filter((f) => /^[A-Z]{2,3}\.json$/.test(f))
  .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')) as TeamDoc);

const boxes: Record<string, [number, number]> = {};
const byPlay: Record<string, [number, number]> = {};
const pic = { n: 0, top: 0, over: 0 };
/** What the world showed, for the Next Gen Stats rows (Docs/PRACTICE-MOTION.md §2). */
const ngs = { sepWR: [] as number[], sepTE: [] as number[], sepAll: [] as number[], cmpBySep: [] as [number, boolean][],
  cushion: [] as number[], ttt: [] as number[], travel: [] as number[], tLos: [] as number[], att: 0, batted: 0,
  air: {} as Record<string, number[]>, tttR: {} as Record<string, number[]>, yac: {} as Record<string, number[]>, broken: 0, tackles: 0,
  onTarget: 0, offTarget: 0, contested: 0, contestedOn: 0, drops: 0, conWon: 0, openCaught: 0, open: 0,
  band: {} as Record<string, [number, number, number]>,        // throws, on target, contested
  pressAcc: [0, 0, 0, 0] as number[],                          // clean throws, on target; pressured, on target
  mz: { man: [0, 0], zone: [0, 0] } as Record<string, [number, number]>,
  /** Against man and zone: attempts, on target, complete, air yards, behind the line. */
  mzx: { man: [0, 0, 0, 0, 0], zone: [0, 0, 0, 0, 0] } as Record<string, number[]>,
  /** By depth and man or zone: throws, contested. */
  bmz: {} as Record<string, [number, number]>,
  byCov: {} as Record<string, [number, number, number]>,       // attempts, completions, picks
  reads: {} as Record<string, number> };
function simulate(games: number, seed0 = 1000) {
  pic.n = 0; pic.top = 0; pic.over = 0;
  for (const k of Object.keys(ngs) as (keyof typeof ngs)[]) { const v = ngs[k]; if (Array.isArray(v)) v.length = 0; }
  ngs.att = 0; ngs.batted = 0; ngs.air = {}; ngs.tttR = {}; ngs.yac = {}; ngs.broken = 0; ngs.tackles = 0;
  ngs.onTarget = 0; ngs.offTarget = 0; ngs.contested = 0; ngs.contestedOn = 0; ngs.drops = 0; ngs.conWon = 0; ngs.openCaught = 0; ngs.open = 0;
  ngs.band = {}; ngs.pressAcc = [0, 0, 0, 0]; ngs.mz = { man: [0, 0], zone: [0, 0] }; ngs.mzx = { man: [0, 0, 0, 0, 0], zone: [0, 0, 0, 0, 0] }; ngs.bmz = {}; ngs.byCov = {}; ngs.reads = {};
  const t = { drop: 0, att: 0, cmp: 0, yds: 0, int: 0, sack: 0, scr: 0, away: 0, press: 0, runs: 0, ryds: 0, stuffed: 0,
    pts: 0, plays: 0, drives: 0, punts: 0, fga: 0, fgm: 0, td: 0, third: 0, thirdConv: 0, fourthGo: 0, fourthConv: 0,
    explosive: 0, bigPass: 0, games: 0, P: 0, C: 0, nobodyP: 0, nobodyC: 0 };
  const cov: Record<string, number> = {};
  const outcome: Record<string, number> = {};
  const shares: Record<string, number> = {};
  const tgtRoute: Record<string, [number, number]> = {};
  const sharesMan: Record<string, number> = {};
  for (const k of Object.keys(boxes)) delete boxes[k];
  for (const k of Object.keys(byPlay)) delete byPlay[k];
  for (let g = 0; g < games; g++) {
    const a = teams[g % teams.length]!, b = teams[(g * 7 + 3 + Math.floor(g / teams.length)) % teams.length]!;
    if (a.team === b.team) continue;
    t.games++;
    const game = new Game(a, b, L, lg26, { quarterLen: 900, seed: seed0 + g });
    game.start();
    let lastPoss = game.poss; t.drives++;
    for (let guard = 0; guard < 400 && game.phase !== 'over'; guard++) {
      if (game.poss !== lastPoss) { t.drives++; lastPoss = game.poss; }
      if (game.phase === 'fourth') {
        const c = game.cpuFourth();
        if (c === 'punt') t.punts++;
        if (c === 'fg') t.fga++;
        if (c === 'go') t.fourthGo++;
        const ev = game.fourth(c);
        if (c === 'fg' && ev.some((e) => e.kind === 'fg' && e.good)) t.fgm++;
        continue;
      }
      const sit = game.situation();
      const user = game.userOnOffence ? offCall(sit, L, game.user, 900, game.rand) : defCall(sit, L, lg26, game.user, game.rand);
      const { result: r } = game.snap(user);
      t.plays++;
      // The picture of the play, for the first games only: nobody in it may
      // move faster than a man can run (Docs/PRACTICE.md §12).
      // What the world showed.
      const tr = r.trace;
      if (tr && r.target && tr.tThrow !== null && tr.catchAt && ['complete', 'incomplete', 'int'].includes(r.kind)) {
        ngs.att++; if (r.batted) ngs.batted++;
        const bl = r.ball;
        if (bl && !r.batted) {
          if (bl.onTarget) ngs.onTarget++; else ngs.offTarget++;
          if (bl.contested) { ngs.contested++; if (bl.onTarget) { ngs.contestedOn++; if (r.kind === 'complete') ngs.conWon++; } }
          else if (bl.onTarget) { ngs.open++; if (r.kind === 'complete') ngs.openCaught++; }
          if (r.how === 'drop') ngs.drops++;
          const a2 = r.air ?? 0, bn = a2 <= 0 ? 'behind' : a2 < 10 ? 'short' : a2 < 20 ? 'mid' : 'deep';
          const e = (ngs.band[bn] ??= [0, 0, 0]); e[0]++; if (bl.onTarget) e[1]++; if (bl.contested) e[2]++;
          const pi = r.pressured ? 2 : 0; ngs.pressAcc[pi]!++; if (bl.onTarget) ngs.pressAcc[pi + 1]!++;
          const mz = ['COVER_0', 'COVER_1', '2_MAN'].includes(r.coverage) ? 'man' : 'zone';
          ngs.mz[mz]![0]++; if (bl.contested) ngs.mz[mz]![1]++;
          { const e2 = (ngs.bmz[`${bn} ${mz}`] ??= [0, 0]); e2[0]++; if (bl.contested) e2[1]++; }
          { const x = ngs.mzx[mz]!; x[0]!++; if (bl.onTarget) x[1]!++; if (r.kind === 'complete') x[2]!++; x[3]! += a2; if (a2 <= 0) x[4]!++; }
          const c2 = (ngs.byCov[r.coverage] ??= [0, 0, 0]); c2[0]++; if (r.kind === 'complete') c2[1]++; if (r.kind === 'int') c2[2]++;
          const rk = r.readNo < 0 ? 'late/forced' : r.readNo === 0 ? 'first' : r.readNo === 1 ? 'second' : r.readNo === 2 ? 'checkdown' : 'third+';
          ngs.reads[rk] = (ngs.reads[rk] ?? 0) + 1;
        }
        if (!r.batted) {
          const pos = r.stage.off.cards[r.target]?.pos;
          if (pos === 'WR') ngs.sepWR.push(tr.sep); if (pos === 'TE') ngs.sepTE.push(tr.sep);
          ngs.sepAll.push(tr.sep); ngs.cmpBySep.push([tr.sep, r.kind === 'complete']);
          ngs.ttt.push(tr.tThrow);
          if (r.route) (ngs.tttR[r.route] ??= []).push(tr.tThrow);
          const fT = Math.round(tr.tThrow * FPS);
          ngs.travel.push(Math.hypot(tr.catchAt.x - tr.ball[fT * 3]!, tr.catchAt.y - tr.ball[fT * 3 + 1]!));
          (ngs.air[r.route!] ??= []).push(r.air ?? 0);
          if (r.kind === 'complete') { (ngs.yac[r.route!] ??= []).push(r.yac ?? 0); ngs.broken += r.broken ?? 0; ngs.tackles += (r.broken ?? 0) + (r.credit.by ? 1 : 0); }
        }
      }
      if (tr) for (const sl of ['X', 'Z', 'SL'] as const) {
        if (r.stage.off.cards[sl]?.pos !== 'WR' || !tr.off[sl]) continue;
        let n = 99; for (const a of Object.values(tr.def)) n = Math.min(n, Math.hypot(a![0]! - tr.off[sl]![0]!, a![1]! - tr.off[sl]![1]!));
        ngs.cushion.push(n);
      }
      if (g < 40) {
        const m = choreograph(r);
        if (r.kind === 'run' && r.ballCarrier !== 'QB') {
          const xy = m.off.RB ?? m.off.FB;
          if (xy) for (let f = 0; f < m.frames; f++) if (xy[f * 2]! >= 0) { ngs.tLos.push(f / FPS); break; }
        }
        for (const xy of [...Object.values(m.off), ...Object.values(m.def)]) for (let f = 1; f < m.frames; f++) {
          const v = Math.hypot(xy![f * 2]! - xy![f * 2 - 2]!, xy![f * 2 + 1]! - xy![f * 2 - 1]!) * FPS;
          if (v > pic.top) pic.top = v;
          if (v > 10) { pic.over++; break; }
        }
        pic.n++;
      }
      if (sit.down === 3) { t.third++; if (r.gain >= sit.togo || r.td) t.thirdConv++; }
      if (sit.down === 4 && (r.gain >= sit.togo || r.td)) t.fourthConv++;
      if (r.td) t.td++;
      if (r.gain >= 20) t.explosive++;
      cov[r.coverage] = (cov[r.coverage] ?? 0) + 1;
      if (r.kind === 'run') { const b = (boxes[r.box] ??= [0, 0]); b[0]++; b[1] += r.gain; const pl = (byPlay[r.stage.call.playId] ??= [0, 0]); pl[0]++; pl[1] += r.gain; }
      if (r.kind === 'run') { t.runs++; t.ryds += r.gain; if (r.gain <= 0) t.stuffed++; continue; }
      t.drop++;
      if (r.pressured) { t.press++; t.P++; if (r.readNo < 0) t.nobodyP++; } else { t.C++; if (r.readNo < 0) t.nobodyC++; }
      const k = `${r.pressured ? 'P' : 'C'}:${r.kind}`; outcome[k] = (outcome[k] ?? 0) + 1;
      if (r.route) shares[r.route] = (shares[r.route] ?? 0) + 1;
      if (r.route && MANC.has(r.coverage)) sharesMan[r.route] = (sharesMan[r.route] ?? 0) + 1;
      if (r.kind === 'sack') { t.sack++; continue; }
      if (r.kind === 'scramble') { t.scr++; continue; }
      t.att++;
      if (r.kind === 'throwaway') { t.away++; continue; }
      if (r.kind === 'complete') { t.cmp++; t.yds += r.gain; if (r.gain >= 20) t.bigPass++; }
      if (r.kind === 'int') t.int++;
      if (r.route) { const x = (tgtRoute[r.route] ??= [0, 0]); x[0]++; if (r.kind === 'complete') x[1]++; }
    }
    t.pts += game.score.user + game.score.cpu;
  }
  return { t, cov, outcome, shares, sharesMan, tgtRoute };
}

// ── Fitting the quarterback's habits.

const TARGET = {
  pressured: { sack: L.pressure.sackGivenPressure, scramble: L.pressure.scrambleGivenPressure, away: L.pressure.awayPressured },
  clean: { sack: 0.004, scramble: L.pressure.scrambleClean, away: L.pressure.awayClean },
};
const pct2 = (x: number, d = 0) => `${(x * 100).toFixed(d)}%`;
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
const share = (a: number[], under: number) => a.filter((x) => x < under).length / Math.max(1, a.length);
/** The league's yards after the catch per completion, from the 2025 tables:
 *  each route's distribution's mean, weighted by how often it is completed. */
const qMean = (q: number[]) => { let m = 0; const N = 400; for (let i = 0; i < N; i++) m += sampleQ(q, (i + 0.5) / N); return m / N; };
const LEAGUE_YAC = (() => {
  let n = 0, w = 0;
  for (const v of Object.values(L.routes)) { const k = v.share * v.cmp; n += k * qMean(v.yac); w += k; }
  return n / w;
})();
const r3 = (x: number) => Math.round(x * 1000) / 1000;
/** The middle of a sample, smoothly: the mean of its middle fifth. (The plain
 *  median of whole-yard air yards jumps a yard at a time, and the leads it was
 *  fitted to went round in a three-round cycle; §20.) */
const mid = (a: number[]) => { const s = [...a].sort((x, y) => x - y), lo = Math.floor(s.length * 0.4), hi = Math.max(lo + 1, Math.ceil(s.length * 0.6)); return s.slice(lo, hi).reduce((x, y) => x + y, 0) / (hi - lo); };
/** The bounds of the fitted scalars, to say which ended on one. */
const LIMITS: Record<string, [number, number]> = {
  thr: [-1.5, 1.5], cthr: [0.3, 3], intU: [0.2, 4], accP: [0.5, 1.3], conF: [0.4, 1.6], firstB: [-0.5, 1.5], chkB: [-1, 2],
  recog: [0, 0.95], zgap: [0.5, 3.5], rob: [0, 0.95], hands: [0.9, 1.1], bat: [0.02, 0.9], react: [0.1, 0.5], open: [0, 0.4],
  accMan: [0.75, 1.25], accZone: [0.75, 1.25], beat: [0.2, 1.2],
};
const lim = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

// `fit=path`: start from (or report on) the numbers in that file rather
// than the ones bundled in.
{
  const fp = process.argv.find((a) => a.startsWith('fit='))?.slice(4);
  if (fp) {
    const f = JSON.parse(readFileSync(fp, 'utf8')) as typeof FIT;
    for (const k of Object.keys(FIT) as (keyof typeof FIT)[]) delete FIT[k];
    Object.assign(FIT, f);
    Object.assign(MOTION, f.motion ?? {});
  }
}
if (process.argv.includes('fit')) {
  // The defaults are the steady settings of §20: fourteen rounds of six
  // hundred games, a fixed step of 0.4, the same games every round, the
  // second half averaged.
  const rounds = Number(process.argv.find((a) => a.startsWith('rounds='))?.slice(7) ?? 14);
  // `games=` per round and `step=` override them. (At 240 games a round and a
  // falling step, as before, the fit's own noise moved yards an attempt by
  // about three tenths.)
  const perRound = Number(process.argv.find((a) => a.startsWith('games='))?.slice(6) ?? 600);
  const fixedStep = process.argv.find((a) => a.startsWith('step='))?.slice(5);
  // Steadier (Docs/PRACTICE-MOTION.md §20): every round replays the same
  // games (`seed=` sets which; `nocrn` draws fresh ones each round, as before),
  // so that what a round's numbers change is the fit's doing and not the
  // draw's; and what is written is the average of the second half of the
  // rounds, not wherever the last one left it.
  const seed0 = Number(process.argv.find((a) => a.startsWith('seed='))?.slice(5) ?? 5000);
  const crn = !process.argv.includes('nocrn');
  const kept: string[] = [];
  for (let it = 0; it < rounds; it++) {
    const step = Number(fixedStep ?? 0.4);
    const { t, shares, sharesMan, tgtRoute, outcome } = simulate(perRound, crn ? seed0 : seed0 + it * 1000);
    // Each route's share of the targets against man, relative to its share
    // overall: the league's against man from its targets by coverage.
    {
      const mb = (FIT.manBias ??= {});
      const ks = Object.keys(L.routes) as RouteId[];
      const lgMan = (r: RouteId) => [...MANC].reduce((n, c) => n + (L.vs[r][c as Coverage]?.n ?? 0), 0);
      const lgTot = ks.reduce((n, r) => n + lgMan(r), 0), gotTot = ks.reduce((n, r) => n + (sharesMan[r] ?? 0), 0);
      for (const r of ks) {
        if (lgMan(r) < 40) continue;
        const want = lgMan(r) / lgTot, got = Math.max(1, sharesMan[r] ?? 0) / Math.max(1, gotTot);
        mb[r] = r3(lim((mb[r] ?? 0) + 0.3 * step * Math.log(want / got), -1.5, 1.5));
      }
      const m0 = ks.reduce((n, r) => n + (mb[r] ?? 0) * lgMan(r), 0) / lgTot;
      for (const r of ks) mb[r] = r3((mb[r] ?? 0) - m0);
    }
    // Each route's share of targets.
    const tot = Object.values(shares).reduce((a, b) => a + b, 0);
    let worst = 0;
    for (const r of Object.keys(L.routes) as RouteId[]) {
      const got = Math.max(1, shares[r] ?? 0) / tot, want = L.routes[r].share;
      // A called screen is thrown — its share is how often it is called.
      if (r === 'SCREEN') { FIT.screenCall = r3(lim((FIT.screenCall ?? 1) * (want / got) ** step, 0.1, 3)); FIT.readBias[r] = 0; }
      else FIT.readBias[r] = r3(lim((FIT.readBias[r] ?? 0) + 0.3 * step * Math.log(want / got), -2.5, 2.5));
      worst = Math.max(worst, Math.abs(Math.log(want / got)));
    }
    // The biases are relative: shifted all together they change nothing the
    // threshold could not, and left free they drifted down together and
    // dragged the threshold to its floor. Held to a target-weighted mean of
    // nought, the threshold carries the level.
    {
      const ks = Object.keys(L.routes) as RouteId[];
      const m0 = ks.reduce((n, r) => n + (FIT.readBias[r] ?? 0) * L.routes[r].share, 0) / ks.reduce((n, r) => n + L.routes[r].share, 0);
      for (const r of ks) FIT.readBias[r] = r3((FIT.readBias[r] ?? 0) - m0);
    }
    // With nobody open: each outcome toward its measured share of all
    // pressured (or clean) dropbacks.
    for (const [side, p] of [['pressured', 'P'], ['clean', 'C']] as const) {
      const all = side === 'pressured' ? t.P : t.C;
      const nb = FIT.nobody[side];
      for (const k of ['sack', 'scramble', 'away'] as const) {
        const got = Math.max(1, outcome[`${p}:${k === 'away' ? 'throwaway' : k}`] ?? 0) / all;
        // (Damped, §20: at twice this the forced throw and the scramble
        // swapped a tenth of their share every round.)
        nb[k] = r3(lim(nb[k] * (TARGET[side][k] / got) ** (0.5 * step), 0.005, 0.9));
      }
      nb.throw = r3(Math.max(0.02, 1 - nb.sack - nb.scramble - nb.away));
    }
    // The world's numbers (Docs/PRACTICE-MOTION.md): reaction delays toward
    // the league's separation at the catch; the passer's threshold toward
    // how often the league's find nobody open; batted balls toward their
    // share of attempts.
    const mo = (FIT.motion ??= {}) as Record<string, number>;
    const sepGot = mean(ngs.sepWR), sepWant = 2.86;
    // The reaction delays are not fitted. Fitted to Next Gen Stats' average
    // separation — which the world's screens and swings, wide open behind the
    // line, pull up — they went to their floors and made every corner drive
    // on every hitch at once. They are set at human values (MOTION), and the
    // coverage is fitted to FTN's contested shares instead (below).
    void sepWant;
    const nobC = t.nobodyC / t.C;
    mo.thr = r3(lim((mo.thr ?? MOTION.thr) + 0.25 * step * (0.12 - nobC) / 0.12, -1.5, 1.5));
    // The catch (Docs/PRACTICE-MOTION.md §9): each route's accuracy toward
    // its completion rate; how close is contested toward FTN's share of
    // contested balls; interceptions toward the league's rate; drops toward
    // FTN's.
    const accs = ((mo as Record<string, unknown>).acc ??= {}) as Record<string, number>;
    for (const r of Object.keys(L.routes) as RouteId[]) {
      const x = tgtRoute[r];
      if (!x || x[0] < 30) continue;
      accs[r] = r3(lim((accs[r] ?? 1) * (L.routes[r].cmp / Math.max(0.05, x[1] / x[0])) ** step, 0.4, 1.8));
    }
    const conGot = ngs.contested / Math.max(1, ngs.onTarget + ngs.offTarget);
    mo.cthr = r3(lim((mo.cthr ?? MOTION.cthr) * (L.catch.contestedAll / Math.max(0.01, conGot)) ** (0.5 * step), 0.3, 3));
    mo.intU = r3(lim((mo.intU ?? MOTION.intU) * (lg26.int / Math.max(0.002, t.int / Math.max(1, t.att))) ** step, 0.2, 4));
    const pa = ngs.pressAcc;
    mo.accP = r3(lim((mo.accP ?? MOTION.accP) * ((0.60 / 0.78) / Math.max(0.3, (pa[3]! / Math.max(1, pa[2]!)) / Math.max(0.01, pa[1]! / Math.max(1, pa[0]!)))) ** step, 0.5, 1.3));
    mo.conF = r3(lim((mo.conF ?? MOTION.conF) * (L.catch.cmpContested / Math.max(0.05, ngs.conWon / Math.max(1, ngs.contestedOn))) ** step, 0.4, 1.6));
    // (Completion against separation is reported, not fitted: forced through
    // the accuracy of tight windows, it gutted the hitch — whose windows are
    // still too tight in the world — and every route's accuracy hit its
    // ceiling making up for it.)
    const rt = Object.values(ngs.reads).reduce((a, b) => a + b, 0) || 1;
    // (Bounded at half a point until §31, and on it in every fit since §20:
    // the passer went through his reads looking for the most open man more
    // than the league's go to their first, and threw to wider windows than
    // theirs.)
    mo.firstB = r3(lim((mo.firstB ?? MOTION.firstB) + 0.6 * step * (0.68 - (ngs.reads.first ?? 0) / rt), -0.5, 1.5));
    mo.chkB = r3(lim((mo.chkB ?? MOTION.chkB) + 0.6 * step * (0.14 - ((ngs.reads.checkdown ?? 0) + (ngs.reads['third+'] ?? 0)) / rt), -1, 2));
    // Coverage (Docs/PRACTICE-MOTION.md §10): man tightness toward FTN's
    // contested share against man; the underneath zones' depth toward its
    // contested share of short throws; deep defenders robbing toward its
    // contested share of intermediate ones.
    const share2 = (b: string) => { const e = ngs.band[b] ?? [0, 0, 0]; return e[2] / Math.max(1, e[0]); };
    const manCon = ngs.mz.man![1] / Math.max(1, ngs.mz.man![0]);
    // How often a man defender reads his man's route (§11), toward FTN's
    // contested share against man. How far over the top he plays is not
    // fitted alongside it: two ways of playing tighter, one number to fit them
    // to, and the over-the-top depth went to its floor and had every corner
    // trailing in the stem. It is held as Cover 1 is taught (manT 1).
    // Each toward its own share (§12): reading the route toward FTN's
    // contested intermediate balls against man — the digs and outs, where
    // the read is what gets a corner there — and how tight a corner runs in
    // phase on a go toward its contested deep ones. (Fitted to man coverage
    // as a whole, recognition went to nought once the deep balls were
    // contested, and the digs were open again.)
    const bm = (k: string) => { const e = ngs.bmz[k] ?? [0, 0]; return e[1] / Math.max(1, e[0]); };
    mo.recog = r3(lim((mo.recog ?? MOTION.recog) + 1.5 * step * (L.catch.byMZ.man.contested.mid - bm('mid man')), 0, 0.95));
    // (How far over the top on a go was fitted here; it went to its
    // ceiling, three yards, and the receiver still ran into him.)
    mo.phase = 0.3;
    // The turn is held at a hip flip's length, three tenths of a second. Fitted
    // to the contested deep balls against man, it went to its ceiling, twice
    // that, and they hardly moved: they are the posts and corners, led short
    // (§13), not the go.
    mo.flip = 0.3;
    // The release (§16). The computer does not press: at the rate that makes
    // the cushion at the snap Next Gen Stats' (6.31 yards, 39% of man snaps),
    // the offence lost half a yard an attempt that the deep balls did not
    // account for — a release lost costs a receiver more than one won gains
    // him, against what the league's numbers allow. `press` fits it anyway,
    // with how long a corner beaten at the line is left lunging (`beat`)
    // toward FTN's contested deep balls against man; a user who presses gets
    // the values that fit found (0.6 of releases won, 0.79 s).
    if (process.argv.includes('press')) {
      FIT.press = r3(lim((FIT.press ?? 0.3) + 0.3 * step * (mean(ngs.cushion) - 6.31), 0, 0.9));
      mo.beat = r3(lim((mo.beat ?? 0.4) + 0.5 * step * (bm('deep man') - L.catch.byMZ.man.contested.deep), 0.2, 1.2));
      mo.open = 0.4;
    } else {
      FIT.press = 0;
      // Who is faster in each man matchup (§17) is held at a spread of 0.4
      // yards a second, about what separates a 4.35 forty from a 4.6. Fitted
      // to the contested deep balls against man, it went to its ceiling, three
      // times that, before the forced throw was found to be the cause.
      // Throwing a beaten man open is fitted to them.
      mo.spd = 0.4;
      mo.open = r3(lim((mo.open ?? 0.1) + 0.4 * step * (bm('deep man') - L.catch.byMZ.man.contested.deep), 0, 0.4));
    }
    mo.relWin = 0.6;
    // Accuracy against man and against zone, each toward FTN's on-target
    // rate for it (§18).
    {
      const on = (k: string) => ngs.mzx[k]![1]! / Math.max(1, ngs.mzx[k]![0]!);
      mo.accMan = r3(lim((mo.accMan ?? 1) * (L.catch.byMZ.man.catchable / Math.max(0.3, on('man'))) ** step, 0.75, 1.25));
      mo.accZone = r3(lim((mo.accZone ?? 1) * (L.catch.byMZ.zone.catchable / Math.max(0.3, on('zone'))) ** step, 0.75, 1.25));
    }
    // Underneath zones (§14): how far on the passer's side of his man a
    // defender sits, toward FTN's contested short balls against zone.
    // (The gap was fitted to the contested short balls against zone; they do
    // not answer to it — from 1.8 yards to 3.2 they stayed at 11 to 15% — and
    // it climbed every round of every fit toward its ceiling, taking the
    // separation at the catch with it. Held, §20.)
    mo.zgap = 1.5;
    // (How deep the underneath zones sink was fitted here too, toward the
    // contested intermediate balls against zone. It went to its ceiling and
    // the gap to its floor: sunk under the digs, the same defenders were no
    // longer near the hitches, and separation went back up half a yard.)
    mo.manT = 1;
    // (How much a tight window costs a throw's accuracy is not fitted. Fitted
    // to the ten-point gap in FTN's on-target rate between man and zone, it
    // went to its ceiling, closed less than half the gap and took a tenth off
    // every route's accuracy: the engine's windows against man are not
    // tighter enough for that to be where the gap comes from.)
    // (The underneath zones' depth is not fitted: fitted to short contested
    // balls — which are man coverage's, not zone's — it sank the hook and curl
    // defenders to twenty yards, behind the digs they sit under.)
    mo.rob = r3(lim((mo.rob ?? MOTION.rob) + 1.5 * step * (L.catch.contested.mid - share2('mid')), 0, 0.95));
    const dropGot = ngs.drops / Math.max(1, ngs.onTarget);
    mo.hands = r3(lim((mo.hands ?? 1) * ((1 - L.catch.drop) / Math.max(0.5, 1 - dropGot)) ** step, 0.9, 1.1));
    mo.bat = r3(lim((mo.bat ?? MOTION.bat) * (0.013 / Math.max(0.001, ngs.batted / Math.max(1, ngs.att))) ** step, 0.02, 0.9));
    // How far each route is led: toward its median air yards in 2025.
    // (Led in stride instead, at a sprint, with each deepening route's speed
    // fitted to its air yards, the run after the catch went to seven yards
    // and the fit stopped settling; §13.)
    const lead = ((mo as Record<string, unknown>).lead ??= {}) as Record<string, number>;
    for (const r of Object.keys(L.routes) as RouteId[]) {
      const a = ngs.air[r];
      if (!a || a.length < 20) continue;
      const got = mid(a), want = L.routes[r].air[10]!;
      lead[r] = r3(lim((lead[r] ?? 1) + 0.04 * step * (want - got), 0.2, 1.1));
    }
    // (The go was held in stride for a while, with the pace every route is
    // run at fitted to its air yards instead. The pace went to its floor —
    // receivers jogging at five and a half yards a second — and the deep
    // safeties were never near a deep ball. The league's median go is not
    // caught in stride: it includes the back-shoulder throws and the balls
    // the receiver has to wait for; §15.)
    // When each route is thrown: toward its median time to throw in 2025.
    // Thrown late, a route was led short to keep its air yards, and its
    // receiver pulled up under the ball with his man running past him.
    const tOff = ((mo as Record<string, unknown>).tOff ??= {}) as Record<string, number>;
    for (const r of Object.keys(L.routes) as RouteId[]) {
      const a = ngs.tttR[r];
      if (!a || a.length < 20) continue;
      const got = mid(a), want = L.routes[r].ttt[1]!;
      // (Damped, §20: a route's median time to throw jumps between an early
      // and a late cluster, and at three times this the post's timing swung
      // a quarter of a second each way every round.)
      tOff[r] = r3(lim((tOff[r] ?? 0) + 0.2 * step * (want - got), -1.2, 1));
    }
    // After the catch, toward the league's yards after the catch: how long
    // a defender not already on the receiver takes to see the catch and turn
    // to run it down (§14). Tackling is held at 0.88, about one tackle in
    // nine broken; fitted to the yards after the catch, it sat at its
    // ceiling, every pursuer reacting to the catch at once and taking a
    // perfect angle.
    const yacGot = mean(Object.values(ngs.yac).flat());
    mo.gather = 0.5;
    mo.tackle = 0.88;
    mo.react = r3(lim((mo.react ?? 0.3) + 0.05 * step * (LEAGUE_YAC - yacGot), 0.1, 0.5));
    Object.assign(MOTION, mo);
    console.log(`   contested: man ${(manCon * 100).toFixed(0)}% (20), short ${(share2('short') * 100).toFixed(0)}% (13), mid ${(share2('mid') * 100).toFixed(0)}% (21), deep ${(share2('deep') * 100).toFixed(0)}% (24); recog ${mo.recog} zgap ${mo.zgap} open ${mo.open} cushion ${mean(ngs.cushion).toFixed(2)} rob ${mo.rob}; by depth against man ${['behind', 'short', 'mid', 'deep'].map((b) => (bm(b + ' man') * 100).toFixed(0)).join('/')} (4/20/26/28), zone ${['behind', 'short', 'mid', 'deep'].map((b) => (bm(b + ' zone') * 100).toFixed(0)).join('/')} (2/10/18/22) on target man ${(ngs.mzx.man![1]! / Math.max(1, ngs.mzx.man![0]!) * 100).toFixed(0)}% zone ${(ngs.mzx.zone![1]! / Math.max(1, ngs.mzx.zone![0]!) * 100).toFixed(0)}%`);
    console.log(`   separation WR ${sepGot.toFixed(2)} (2.86), tight windows ${(share(ngs.sepAll, 1) * 100).toFixed(1)}% (14.6), nobody open clean ${(nobC * 100).toFixed(0)}% (12), intended air ${mean(Object.values(ngs.air).flat()).toFixed(1)} (7.9), time to throw ${mean(ngs.ttt).toFixed(2)} (2.81)`);
    console.log(`fit ${it + 1}: worst route share off by ×${Math.exp(worst).toFixed(2)}; nobody open ${(t.nobodyP / t.P * 100).toFixed(0)}% pressured, ${(t.nobodyC / t.C * 100).toFixed(0)}% clean`);
    if (it >= Math.floor(rounds / 2)) kept.push(JSON.stringify(FIT));
    const tracePath = process.argv.find((a) => a.startsWith('trace='))?.slice(6);
    if (tracePath) writeFileSync(tracePath, JSON.stringify(FIT) + '\n', { flag: it === 0 ? 'w' : 'a' });
  }
  // The average of the second half of the rounds.
  if (kept.length > 1 && !process.argv.includes('noavg')) {
    const all = kept.map((k) => JSON.parse(k));
    const avg = (vals: unknown[]): unknown => {
      const v0 = vals[0];
      if (typeof v0 === 'number') return r3((vals as number[]).reduce((a, b) => a + b, 0) / vals.length);
      if (v0 && typeof v0 === 'object') return Object.fromEntries(Object.keys(v0).map((k) => [k, avg(vals.map((v) => (v as Record<string, unknown>)?.[k] ?? (v0 as Record<string, unknown>)[k]))]));
      return v0;
    };
    const a = avg(all) as typeof FIT;
    for (const k of Object.keys(FIT) as (keyof typeof FIT)[]) delete FIT[k];
    Object.assign(FIT, a);
    Object.assign(MOTION, FIT.motion ?? {});
  }
  // Fitted numbers at a bound are not fitted: say so.
  const bound: string[] = [];
  for (const [k, v] of Object.entries(FIT.motion ?? {})) if (typeof v === 'number' && LIMITS[k] && (Math.abs(v - LIMITS[k]![0]) < 1e-3 || Math.abs(v - LIMITS[k]![1]) < 1e-3)) bound.push(`${k} ${v}`);
  if (bound.length) console.log('at a bound:', bound.join(', '));
  const out = process.argv.find((a) => a.startsWith('out='))?.slice(4) ?? 'src/lib/practice/fit.json';
  writeFileSync(join(process.cwd(), out), JSON.stringify(FIT, null, 1) + '\n');
  console.log(`wrote ${out}\n`);
}

// ── The report.

const games = Number(process.argv.find((a) => /^\d+$/.test(a)) ?? 400);
const { t, cov, outcome, shares, tgtRoute } = simulate(games);
const flag = (got: number, want: number) => (Math.abs(got - want) / Math.max(1e-9, Math.abs(want)) > 0.1 ? '◀' : '');
const row = (name: string, got: number, want: number, fmt = (x: number) => x.toFixed(3)) =>
  console.log(`${name.padEnd(28)} ${fmt(got).padStart(8)} ${fmt(want).padStart(8)}   ${flag(got, want)}`);
const tg = t.games * 2;
console.log(`${t.games} games, ${t.plays} snaps\n${'measure'.padEnd(28)} ${'engine'.padStart(8)} ${'league'.padStart(8)}`);
row('completion %', t.cmp / t.att, lg26.cmp);
row('yards / attempt', t.yds / t.att, lg26.ypa, (x) => x.toFixed(2));
row('interception %', t.int / t.att, lg26.int);
row('sack % of dropbacks', t.sack / t.drop, lg26.sack);
row('scramble % of dropbacks', t.scr / t.drop, lg26.scramble);
row('pressure % of dropbacks', t.press / t.drop, 0.29);
row('throwaway % of dropbacks', t.away / t.drop, 0.29 * L.pressure.awayPressured + 0.71 * L.pressure.awayClean);
row('20+ completions % of att', t.bigPass / t.att, 0.085);
row('yards / carry', t.ryds / t.runs, lg26.ypc, (x) => x.toFixed(2));
row('stuffed % of runs', t.stuffed / t.runs, lg26.stuff);
row('dropback % of snaps', t.drop / t.plays, 0.6);
row('snaps / team-game', t.plays / tg, 62, (x) => x.toFixed(1));
row('points / team-game', t.pts / tg, 22.8, (x) => x.toFixed(1));
row('points / drive', t.pts / t.drives, 2.0, (x) => x.toFixed(2));
row('third-down conversion', t.thirdConv / t.third, 0.39);
row('fourth-down conversion', t.fourthConv / Math.max(1, t.fourthGo), 0.55);
row('punts / team-game', t.punts / tg, 3.9, (x) => x.toFixed(1));
row('FG attempts / team-game', t.fga / tg, 1.7, (x) => x.toFixed(1));
row('FG made %', t.fgm / Math.max(1, t.fga), 0.85);
row('20+ yard plays / team-game', t.explosive / tg, 4.0, (x) => x.toFixed(1));
const pct = (o: Record<string, number>, p: string) => {
  const n = Object.entries(o).filter(([k]) => k[0] === p).reduce((s, [, v]) => s + v, 0);
  return Object.entries(o).filter(([k]) => k[0] === p).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k.slice(2)} ${(v / n * 100).toFixed(1)}%`).join(', ');
};
console.log(`\npressured: ${pct(outcome, 'P')}\n  league: sack ${L.pressure.sackGivenPressure}, scramble ${L.pressure.scrambleGivenPressure}, away ${L.pressure.awayPressured}, cmp/att ${L.pressure.cmpPressured}`);
console.log(`clean:     ${pct(outcome, 'C')}\n  league: scramble ${L.pressure.scrambleClean}, away ${L.pressure.awayClean}, cmp/att ${L.pressure.cmpClean}`);
console.log('coverages faced:', Object.entries(cov).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${(v / t.plays * 100).toFixed(0)}%`).join(', '));
const tot = Object.values(shares).reduce((a, b) => a + b, 0);
console.log('targets, engine/league %:', Object.entries(shares).sort((a, b) => b[1] - a[1])
  .map(([k, v]) => `${k} ${(v / tot * 100).toFixed(0)}/${(L.routes[k as RouteId].share * 100).toFixed(0)}`).join(', '));
console.log('completion by route, engine/league %:', Object.entries(tgtRoute).sort((a, b) => b[1][0] - a[1][0])
  .map(([k, [n, c]]) => `${k} ${(c / n * 100).toFixed(0)}/${(L.routes[k as RouteId].cmp * 100).toFixed(0)}`).join(', '));
console.log('runs by box (share, ypc):', Object.entries(boxes).map(([k, [n, y]]) => `${k}: ${(n / t.runs * 100).toFixed(0)}% ${(y / n).toFixed(2)}`).join(', '), '| league', Object.entries(L.run.box).map(([k, v]) => `${k}: ${(v.n / L.run.n * 100).toFixed(0)}%`).join(', '));
console.log('runs by play:', Object.entries(byPlay).map(([k, [n, y]]) => `${k} ${(n / t.runs * 100).toFixed(0)}% ${(y / n).toFixed(2)}`).join(', '));
// Against Next Gen Stats (2023): the world's geometry.
console.log(`\n${'world, against Next Gen Stats 2023'.padEnd(28)} ${'engine'.padStart(8)} ${'NGS'.padStart(8)}`);
row('separation at catch, WR', mean(ngs.sepWR), 2.86, (x) => x.toFixed(2));
row('separation at catch, TE', mean(ngs.sepTE), 3.37, (x) => x.toFixed(2));
row('tight windows (<1 yd)', share(ngs.sepAll, 1), 0.146);
row('cushion at the snap, WR', mean(ngs.cushion), 6.31, (x) => x.toFixed(2));
row('time to throw', mean(ngs.ttt), 2.81, (x) => x.toFixed(2));
row('ball travel distance', mean(ngs.travel), 21.2, (x) => x.toFixed(1));
row('intended air yards', mean(Object.values(ngs.air).flat()), 7.85, (x) => x.toFixed(2));
row("a back's time to the line", mean(ngs.tLos), 2.78, (x) => x.toFixed(2));
row('batted % of attempts', ngs.batted / Math.max(1, ngs.att), 0.013);
row('yards after catch / completion', mean(Object.values(ngs.yac).flat()), LEAGUE_YAC, (x) => x.toFixed(2));
// Against FTN's charting of 2025: the catch.
{
  const C = L.catch, all = ngs.onTarget + ngs.offTarget;
  console.log(`\n${'the catch, against FTN 2025'.padEnd(28)} ${'engine'.padStart(8)} ${'FTN'.padStart(8)}`);
  row('on target (catchable)', ngs.onTarget / Math.max(1, all), C.catchableAll);
  row('  clean', ngs.pressAcc[1]! / Math.max(1, ngs.pressAcc[0]!), 0.78);
  row('  pressured', ngs.pressAcc[3]! / Math.max(1, ngs.pressAcc[2]!), 0.60);
  row('contested', ngs.contested / Math.max(1, all), C.contestedAll);
  row('  against man', ngs.mz.man![1] / Math.max(1, ngs.mz.man![0]), C.contestedMan);
  row('  against zone', ngs.mz.zone![1] / Math.max(1, ngs.mz.zone![0]), C.contestedZone);
  for (const k of ['man', 'zone'] as const) {
    const x = ngs.mzx[k]!, n = Math.max(1, x[0]!), f = C.byMZ[k];
    row(`against ${k}: on target`, x[1]! / n, f.catchable);
    row(`  completion`, x[2]! / n, f.cmp);
    row(`  air yards`, x[3]! / n, f.adot, (v) => v.toFixed(1));
    row(`  behind the line`, x[4]! / n, f.behind);
  }
  row('contested & catchable, caught', ngs.conWon / Math.max(1, ngs.contestedOn), C.cmpContested);
  row('open and on target, caught', ngs.openCaught / Math.max(1, ngs.open), C.cmpUncontested);
  row('dropped, of catchable', ngs.drops / Math.max(1, ngs.onTarget), C.drop);
  console.log('by depth, on target / contested, engine vs FTN:', (['behind', 'short', 'mid', 'deep'] as const).map((b) => {
    const e = ngs.band[b] ?? [0, 0, 0], f = C.catchable[b];
    const ftnOn = (f.clean * 0.78 + f.pressured * 0.22) / (0.78 + 0.22);
    return `${b} ${pct2(e[1] / Math.max(1, e[0]))}/${pct2(ftnOn)} ${pct2(e[2] / Math.max(1, e[0]))}/${pct2(C.contested[b])}`;
  }).join(', '));
  console.log('by coverage, completion / interception, engine vs FTN:', Object.keys(C.byCoverage).map((k) => {
    const e = ngs.byCov[k] ?? [0, 0, 0], f = C.byCoverage[k]!;
    return `${k} ${pct2(e[1] / Math.max(1, e[0]))}/${pct2(f.cmp)} ${pct2(e[2] / Math.max(1, e[0]), 1)}/${pct2(f.int, 1)}`;
  }).join(', '));
  const rt = Object.values(ngs.reads).reduce((a, b) => a + b, 0);
  console.log('read thrown to, engine:', Object.entries(ngs.reads).map(([k, v]) => `${k} ${pct2(v / rt)}`).join(', '),
    `| FTN: first ${pct2(C.reads['1'])}, designed ${pct2(C.reads.DES)}, second ${pct2(C.reads['2'])}, checkdown ${pct2(C.reads.CHK)}, scramble drill ${pct2(C.reads.SD)}`);
}
console.log(`tackles broken after the catch: ${(ngs.broken / Math.max(1, ngs.tackles) * 100).toFixed(1)}% of tackle attempts`);
{
  // Completion against separation: the league's slope across receivers is
  // about five points a yard (season level, which understates it per throw).
  const xs = ngs.cmpBySep.map(([x]) => Math.min(x, 8)), ys = ngs.cmpBySep.map(([, c]) => (c ? 100 : 0));
  const mx = mean(xs), my = mean(ys);
  const b = xs.reduce((n, x, i) => n + (x - mx) * (ys[i]! - my), 0) / Math.max(1e-9, xs.reduce((n, x) => n + (x - mx) ** 2, 0));
  console.log(`completion against separation: ${b.toFixed(1)} points a yard (NGS, season level: 5.1)`);
  const bands: [number, number][] = [[0, 1], [1, 2], [2, 3], [3, 4], [4, 6], [6, 99]];
  console.log('  ' + bands.map(([lo, hi]) => { const s2 = ngs.cmpBySep.filter(([x]) => x >= lo && x < hi); return `${lo}-${hi === 99 ? '+' : hi} yd ${(s2.filter(([, c]) => c).length / Math.max(1, s2.length) * 100).toFixed(0)}% (${(s2.length / Math.max(1, ngs.cmpBySep.length) * 100).toFixed(0)}% of throws)`; }).join(', '));
}
console.log('time to throw, median engine/league:', (Object.keys(L.routes) as RouteId[]).filter((k) => ngs.tttR[k]?.length)
  .map((k) => { const a = [...ngs.tttR[k]!].sort((x, y) => x - y); return `${k} ${a[a.length >> 1]!.toFixed(1)}/${L.routes[k].ttt[1]}`; }).join(', '));
console.log('air yards, median engine/league:', (Object.keys(L.routes) as RouteId[]).filter((k) => ngs.air[k]?.length)
  .map((k) => { const a = [...ngs.air[k]!].sort((x, y) => x - y); return `${k} ${a[a.length >> 1]}/${L.routes[k].air[10]}`; }).join(', '));
console.log('yards after catch, median engine/league:', (Object.keys(L.routes) as RouteId[]).filter((k) => ngs.yac[k]?.length)
  .map((k) => { const a = [...ngs.yac[k]!].sort((x, y) => x - y); return `${k} ${a[a.length >> 1]}/${L.routes[k].yac[10]}`; }).join(', '));
console.log(`picture: ${pic.n} plays drawn; fastest anyone moves ${pic.top.toFixed(1)} yd/s; plays with anyone over 10 yd/s: ${pic.over}${pic.over ? '  ◀' : ''}`);
