/** A practice game: the downs, the clock, the score, who has the ball.
 *
 *  The user's club against the computer's. The user calls every snap for
 *  their own side, offence and defence; the computer calls the other side
 *  before the snap, from ai.ts, and lines up so the user can see its shape —
 *  formation on offence, one deep safety or two on defence — but not its
 *  play. Kicks are decided by whoever has the ball and resolved here.
 *
 *  Not modelled (Docs/PRACTICE.md §14): penalties, injuries, timeouts,
 *  two-point tries, onside kicks, overtime. A tied game ends tied. */
import { HASH } from './kb';
import { resolve, sampleQ, seeded, type Rand, type Result } from './engine';
import { defCall, fgMake, fourthCall, offCall, type FourthChoice } from './ai';
import type { Card, DefCall, League, League2026, OffCall, Situation, TeamDoc } from './types';

export type Side = 'user' | 'cpu';
/** Which way a side attacks on screen in a quarter: the user goes right in
 *  the first and third, left in the second and fourth. */
export const dirOf = (side: Side, quarter: number): 1 | -1 => ((side === 'user') === (quarter % 2 === 1) ? 1 : -1);
const other = (s: Side): Side => (s === 'user' ? 'cpu' : 'user');
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export interface Line { id: string; name: string; short: string; side: Side; pos: string;
  att?: number; cmp?: number; pyds?: number; ptd?: number; int?: number; sacked?: number;
  car?: number; ryds?: number; rtd?: number; rec?: number; tgt?: number; yds?: number; td?: number;
  tkl?: number; sk?: number; pick?: number; pd?: number; fgm?: number; fga?: number; xpm?: number; punts?: number; }

export interface Box { plays: number; yards: number; pass: number; rush: number; firsts: number; turnovers: number; sacks: number; third: [number, number]; top: number; }

export interface Logged {
  quarter: number; clock: number; side: Side; down: number; togo: number; los: number;
  text: string; kind: string; gain: number; score?: string;
}

/** What the screen should say happened, beyond the play itself. */
export type Event =
  /** Kicks carry where they were kicked from, in the kicking side's frame,
   *  and the quarter they were kicked in — the game has moved on by the time
   *  they are drawn, and both decide where on the screen they go. */
  | { kind: 'kickoff'; by: Side; start: number; from: number; q: number }
  | { kind: 'td'; side: Side; xp: boolean; q: number }
  | { kind: 'fg'; side: Side; dist: number; good: boolean; from: number; q: number }
  | { kind: 'punt'; side: Side; net: number; touchback: boolean; from: number; ret: number; q: number }
  | { kind: 'safety'; side: Side }
  | { kind: 'turnover'; side: Side; how: 'int' | 'fumble' | 'downs' }
  | { kind: 'first'; side: Side }
  | { kind: 'quarter'; quarter: number }
  | { kind: 'half' }
  | { kind: 'over' };

export interface Options { quarterLen?: number; seed?: number; userReceives?: boolean; }

export class Game {
  readonly rand: Rand;
  readonly quarterLen: number;
  quarter = 1;
  clock: number;
  score = { user: 0, cpu: 0 };
  poss: Side;
  down = 1; togo = 10; los = 25; hashY = 0;
  phase: 'snap' | 'fourth' | 'over' = 'snap';
  readonly firstReceiver: Side;
  /** The computer's call for the coming snap, made before the user's. */
  cpuCall: OffCall | DefCall | null = null;
  log: Logged[] = [];
  lines = new Map<string, Line>();
  box: Record<Side, Box> = { user: emptyBox(), cpu: emptyBox() };
  last: Result | null = null;

  constructor(readonly user: TeamDoc, readonly cpu: TeamDoc, readonly L: League, readonly lg26: League2026, opts: Options = {}) {
    this.rand = seeded(opts.seed ?? Date.now());
    this.quarterLen = opts.quarterLen ?? 300;
    this.clock = this.quarterLen;
    this.firstReceiver = opts.userReceives === false ? 'cpu' : 'user';
    this.poss = this.firstReceiver;
  }

  team(s: Side) { return s === 'user' ? this.user : this.cpu; }
  get offence() { return this.team(this.poss); }
  get defence() { return this.team(other(this.poss)); }
  get userOnOffence() { return this.poss === 'user'; }

  /** Which way the side with the ball is attacking on screen: the user
   *  goes right in the first and third quarters, left in the others. */
  get dir(): 1 | -1 { return dirOf(this.poss, this.quarter); }

  situation(): Situation {
    return { down: this.down, togo: this.togo, los: this.los, hashY: this.hashY, quarter: this.quarter, clock: this.clock,
             scoreDiff: this.score[this.poss] - this.score[other(this.poss)] };
  }

  /** Start the game: the opening kickoff, and the first snap readied. */
  start(): Event[] {
    const ev = this.kickoff(other(this.poss));
    this.ready();
    return ev;
  }

  /** The computer makes its call for the coming snap, or its fourth-down
   *  decision if that is what is due. */
  ready() {
    const sit = this.situation();
    this.cpuCall = this.phase !== 'snap' ? null
      : this.poss === 'cpu' ? offCall(sit, this.L, this.cpu, this.quarterLen, this.rand)
      : defCall(sit, this.L, this.lg26, this.cpu, this.rand);
  }

  /** Can the side with the ball kick a field goal now, on a down before
   *  fourth? Only to beat the clock at the end of a half. */
  get canKickEarly() {
    return (this.quarter === 2 || this.quarter === 4) && this.clock <= 20 && 100 - this.los + 17 <= 60;
  }

  /** Snap the ball. The user's call for their side; the computer's is the one
   *  readied before. */
  snap(userCall: OffCall | DefCall): { result: Result; events: Event[] } {
    const oc = (this.poss === 'user' ? userCall : this.cpuCall) as OffCall;
    const dc = (this.poss === 'user' ? this.cpuCall : userCall) as DefCall;
    const sit = this.situation();
    const result = resolve(sit, oc, dc, { league: this.L, lg26: this.lg26, off: this.offence, def: this.defence, rand: this.rand });
    this.last = result;
    const events = this.apply(sit, result);
    this.ready();
    return { result, events };
  }

  /** Fourth down. The user says for their side; the computer decides for its
   *  own through `cpuFourth`. 'go' simply readies the snap. */
  fourth(choice: FourthChoice): Event[] {
    if (choice === 'go') { this.phase = 'snap'; this.ready(); return []; }
    const ev = choice === 'fg' ? this.fieldGoal() : this.punt();
    this.ready();
    return ev;
  }
  cpuFourth(): FourthChoice { return fourthCall(this.situation(), this.L, this.quarterLen, this.rand); }

  // ── What a snap does to the game.

  private apply(sit: Situation, r: Result): Event[] {
    const ev: Event[] = [];
    const side = this.poss;
    const b = this.box[side], bd = this.box[other(side)];
    b.plays++;
    b.yards += r.gain;
    if (r.kind === 'run' || r.kind === 'scramble') b.rush += r.gain; else b.pass += r.gain;
    if (r.kind === 'sack') bd.sacks++;
    if (sit.down === 3) b.third[1]++;
    this.credit(r, side);
    this.logPlay(sit, r, side);

    const spot = sit.los + r.gain;
    const used = this.secondsFor(r, sit);
    b.top += used;

    if (r.turnover) {
      b.turnovers++;
      if (r.kind === 'int') {
        const at = sit.los + (r.end.x ?? 0);
        if (at <= 0) { this.score[other(side)] += 6; ev.push({ kind: 'turnover', side, how: 'int' }); ev.push(...this.touchdown(other(side))); }
        else { ev.push({ kind: 'turnover', side, how: 'int' }); this.change(at >= 100 ? 20 : 100 - at, r.end.y); }
      } else {
        ev.push({ kind: 'turnover', side, how: 'fumble' });
        this.change(clamp(100 - spot, 1, 99), r.end.y);
      }
    } else if (r.td) {
      b.firsts++;
      if (sit.down === 3) b.third[0]++;
      this.score[side] += 6;
      ev.push(...this.touchdown(side));
    } else if (r.safety) {
      this.score[other(side)] += 2;
      ev.push({ kind: 'safety', side: other(side) });
      // The free kick from the twenty: the other side starts around its own
      // forty.
      ev.push(...this.kickoff(side, 20));
    } else if (r.gain >= sit.togo) {
      b.firsts++;
      if (sit.down === 3) b.third[0]++;
      ev.push({ kind: 'first', side });
      this.firstDown(spot, this.nextHash(r));
    } else if (sit.down === 4) {
      ev.push({ kind: 'turnover', side, how: 'downs' });
      this.change(100 - spot, r.end.y);
    } else {
      this.down++;
      this.togo = sit.togo - r.gain;
      this.los = spot;
      this.hashY = this.nextHash(r);
    }
    ev.push(...this.tick(used));
    if (this.phase !== 'over') this.phase = this.down === 4 ? 'fourth' : 'snap';
    return ev;
  }

  private nextHash(r: Result) {
    return r.kind === 'incomplete' || r.kind === 'throwaway' ? this.hashY : clamp(Math.round(r.end.y * 2) / 2, -HASH, HASH);
  }

  private firstDown(los: number, hashY: number) {
    this.los = clamp(Math.round(los), 1, 99);
    this.down = 1;
    this.togo = Math.min(10, 100 - this.los);
    this.hashY = hashY;
  }

  /** The ball changes hands at `los`, in the new offence's frame. */
  private change(los: number, y = 0) {
    this.poss = other(this.poss);
    this.firstDown(los, clamp(-y, -HASH, HASH));
  }

  /** Seconds a play took. The measured medians, with a hurry-up for the side
   *  behind at the end of a half and a slow-down for the side ahead. */
  private secondsFor(r: Result, sit: Situation): number {
    // The measured medians run a little long against the mean, which has the
    // sideline throws and the timeouts in it; this has neither, so trims.
    let s = this.L.clock[r.clock] * 0.94 + (this.rand() - 0.5) * 8;
    const endOfHalf = (sit.quarter === 2 || sit.quarter === 4) && sit.clock <= 120;
    if (endOfHalf && sit.scoreDiff <= 0 && r.clock !== 'incomplete') s = Math.min(s, 16 + this.rand() * 6);
    else if (sit.quarter === 4 && sit.scoreDiff > 0 && r.clock === 'run') s = Math.max(s, 40);
    return Math.max(3, Math.round(s));
  }

  /** Run the clock, and end the quarter, the half or the game. */
  private tick(seconds: number): Event[] {
    this.clock -= seconds;
    if (this.clock > 0) return [];
    const ev: Event[] = [];
    if (this.quarter === 4) { this.clock = 0; this.phase = 'over'; ev.push({ kind: 'over' }); return ev; }
    this.quarter++;
    this.clock = this.quarterLen;
    if (this.quarter === 3) {
      ev.push({ kind: 'half' });
      this.poss = other(this.firstReceiver);
      ev.push(...this.kickoff(this.firstReceiver));
    } else ev.push({ kind: 'quarter', quarter: this.quarter });
    return ev;
  }

  // ── Kicks.

  private kickoff(by: Side, from = 35): Event[] {
    const q = this.quarter;
    this.poss = other(by);
    const start = Math.round(clamp(sampleQ(this.lg26.kickoff.start, this.rand()) + (from < 35 ? 8 : 0), 1, 99));
    this.firstDown(start, 0);
    this.phase = 'snap';
    this.clock = Math.max(1, this.clock - 5);
    return [{ kind: 'kickoff', by, start, from, q }];
  }

  private touchdown(side: Side): Event[] {
    const k = this.team(side).kicker;
    const kp = k ? this.team(side).players[k.id]?.k : undefined;
    const xpRate = kp && kp.xpa ? (kp.xpm + 20 * this.L.xp) / (kp.xpa + 20) : this.L.xp;
    const xp = this.rand() < xpRate;
    if (xp) this.score[side] += 1;
    if (k) { const l = this.line(k, side); l.xpm = (l.xpm ?? 0) + (xp ? 1 : 0); }
    const ev: Event[] = [{ kind: 'td', side, xp, q: this.quarter }];
    if (this.clock > 0 || this.quarter < 4) ev.push(...this.kickoff(side));
    return ev;
  }

  private fieldGoal(): Event[] {
    const side = this.poss, sit = this.situation();
    const dist = 100 - this.los + 17;
    const good = this.rand() < fgMake(dist, this.L, this.offence);
    const k = this.offence.kicker;
    if (k) { const l = this.line(k, side); l.fga = (l.fga ?? 0) + 1; l.fgm = (l.fgm ?? 0) + (good ? 1 : 0); }
    this.log.push({ quarter: sit.quarter, clock: sit.clock, side, down: sit.down, togo: sit.togo, los: sit.los, kind: 'fg', gain: 0,
                    text: `${k?.short ?? this.offence.nick} ${dist}-yard field goal is ${good ? 'GOOD' : 'no good'}` });
    const ev: Event[] = [{ kind: 'fg', side, dist, good, from: this.los, q: this.quarter }];
    if (good) { this.score[side] += 3; ev.push(...this.kickoff(side)); }
    else this.change(Math.max(20, 100 - (this.los - 7)));
    ev.push(...this.tick(5));
    if (this.phase !== 'over') this.phase = 'snap';
    return ev;
  }

  private punt(): Event[] {
    const side = this.poss, sit = this.situation();
    const y100 = 100 - this.los;
    const band = y100 >= 70 ? 'deep' : y100 >= 50 ? 'mid' : 'plus';
    const p = this.offence.punter;
    const ps = p ? this.offence.players[p.id]?.p : undefined;
    const lean = ps && ps.n >= 5 ? clamp((ps.net - 42) * 0.5, -4, 4) : 0;
    let net = Math.round(sampleQ(this.L.punt[band].net, 0.04 + 0.96 * this.rand()) + lean);
    const touchback = this.los + net >= 100 || this.rand() < this.L.punt[band].touchback * 0.5;
    if (touchback) net = Math.max(0, 80 - this.los);
    if (p) { const l = this.line(p, side); l.punts = (l.punts ?? 0) + 1; }
    this.log.push({ quarter: sit.quarter, clock: sit.clock, side, down: 4, togo: sit.togo, los: sit.los, kind: 'punt', gain: 0,
                    text: `${p?.short ?? this.offence.nick} punts${touchback ? ' — touchback' : `, ${net} yards net`}` });
    // The return, for the picture: a fair catch about a third of the time,
    // otherwise a few yards, never more than the punt's own length.
    const ret = touchback || this.rand() < 0.35 ? 0 : Math.round(Math.min(net * 0.4, -Math.log(1 - this.rand() * 0.95) * 7));
    const from = this.los, q = this.quarter;
    this.change(touchback ? 20 : clamp(100 - (this.los + net), 1, 99));
    const ev: Event[] = [{ kind: 'punt', side, net, touchback, from, ret, q }];
    ev.push(...this.tick(8));
    if (this.phase !== 'over') this.phase = 'snap';
    return ev;
  }

  // ── The record.

  private line(c: Card, side: Side): Line {
    let l = this.lines.get(c.id);
    if (!l) { l = { id: c.id, name: c.name, short: c.short, side, pos: c.pos }; this.lines.set(c.id, l); }
    return l;
  }

  private credit(r: Result, side: Side) {
    const O = r.stage.off.cards, D = r.stage.def.cards;
    const add = (c: Card | undefined, s: Side, f: Partial<Line>) => {
      if (!c) return;
      const l = this.line(c, s) as unknown as Record<string, number>;
      for (const [k, v] of Object.entries(f)) l[k] = (l[k] ?? 0) + (v as number);
    };
    const qb = O.QB, d = other(side);
    const tgt = r.target ? O[r.target] : undefined;
    const by = r.credit.by ? D[r.credit.by] : undefined;
    switch (r.kind) {
      case 'complete':
        add(qb, side, { att: 1, cmp: 1, pyds: r.gain, ptd: r.td ? 1 : 0 });
        add(tgt, side, { tgt: 1, rec: 1, yds: r.gain, td: r.td ? 1 : 0 });
        break;
      case 'incomplete':
        add(qb, side, { att: 1 }); add(tgt, side, { tgt: 1 });
        if (r.credit.what === 'pd') add(by, d, { pd: 1 });
        break;
      case 'throwaway': add(qb, side, { att: 1 }); break;
      case 'int': add(qb, side, { att: 1, int: 1 }); add(tgt, side, { tgt: 1 }); add(by, d, { pick: 1, pd: 1 }); break;
      case 'sack': add(qb, side, { sacked: 1 }); add(by, d, { sk: 1, tkl: 1 }); break;
      case 'scramble': add(qb, side, { car: 1, ryds: r.gain, rtd: r.td ? 1 : 0 }); break;
      case 'run': add(r.ballCarrier === 'QB' ? qb : O.RB ?? O.FB, side, { car: 1, ryds: r.gain, rtd: r.td ? 1 : 0 }); break;
    }
    if (r.credit.what === 'tackle') add(by, d, { tkl: 1 });
  }

  private logPlay(sit: Situation, r: Result, side: Side) {
    this.log.push({ quarter: sit.quarter, clock: sit.clock, side, down: sit.down, togo: sit.togo, los: sit.los,
                    kind: r.kind, gain: r.gain, text: describe(r) });
  }

  /** "KC 30", "BUF 45", "50" — where the ball is, the way a broadcast says it. */
  spot(los = this.los, side = this.poss): string {
    if (los === 50) return '50';
    return los < 50 ? `${this.team(side).team} ${los}` : `${this.team(other(side)).team} ${100 - los}`;
  }
}

function emptyBox(): Box { return { plays: 0, yards: 0, pass: 0, rush: 0, firsts: 0, turnovers: 0, sacks: 0, third: [0, 0], top: 0 }; }

const DIR = (y: number) => (y > 8 ? 'left' : y < -8 ? 'right' : 'middle');

/** The play, in a line, the way the play-by-play writes it. */
export function describe(r: Result): string {
  const O = r.stage.off.cards, D = r.stage.def.cards;
  const qb = O.QB?.short ?? 'QB';
  const by = r.credit.by ? D[r.credit.by]?.short : undefined;
  const tgt = r.target ? O[r.target]?.short ?? r.target : '';
  const tail = (yds: number) => `${yds === 0 ? 'no gain' : yds > 0 ? `${yds} yard${yds === 1 ? '' : 's'}` : `a loss of ${-yds}`}`;
  const deep = (r.air ?? 0) >= 15 ? 'deep' : 'short';
  // A pass is described by where it was thrown — the receiver's side of the
  // field — which an incompletion's end spot, back at the ball, does not say.
  const aimed = r.target ? r.stage.off.at[r.target]?.y : undefined;
  const where = DIR((aimed ?? r.end.y) - r.stage.hashY);
  switch (r.kind) {
    case 'complete': return `${qb} pass ${deep} ${where} to ${tgt} for ${tail(r.gain)}${r.td ? ', TOUCHDOWN' : by ? ` (${by})` : ''}`;
    case 'incomplete': {
      const why = r.how === 'batted' && by ? `, batted down by ${by}` : r.how === 'pbu' && by ? `, broken up by ${by}`
        : r.how === 'drop' ? `, dropped` : r.how === 'miss' ? `, off target` : by ? `, broken up by ${by}` : '';
      return `${qb} pass incomplete ${deep} ${where} ${r.how === 'miss' ? 'intended for' : 'to'} ${tgt}${why}`;
    }
    case 'int': return `${qb} pass ${deep} ${where} intended for ${tgt} INTERCEPTED by ${by ?? 'the defence'}`;
    case 'sack': return `${qb} sacked${by ? ` by ${by}` : ''} for ${tail(r.gain)}`;
    case 'scramble': return `${qb} scrambles ${where} for ${tail(r.gain)}${r.td ? ', TOUCHDOWN' : ''}`;
    case 'throwaway': return `${qb} throws it away`;
    case 'run': {
      const who = r.ballCarrier === 'QB' ? qb : (O.RB ?? O.FB)?.short ?? 'RB';
      return `${who} runs ${r.gap ?? 'up the middle'} for ${tail(r.gain)}${r.td ? ', TOUCHDOWN' : r.turnover ? ', FUMBLES, recovered by the defence' : by ? ` (${by})` : ''}`;
    }
  }
}
