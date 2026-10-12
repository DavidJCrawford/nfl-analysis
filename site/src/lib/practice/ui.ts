/** The practice screen: a game against the computer, one snap at a time.
 *
 *  The loop is a broadcast's, slowed to a coach's pace. Before each snap the
 *  computer has made its call and lined up — its shape on show, its play not —
 *  and the user makes theirs in the panel beside the field: a formation and a
 *  play on offence, a coverage and a rush on defence, then any player's job
 *  changed by tapping him and any receiver moved by dragging him. SNAP
 *  resolves it (engine.ts) and plays it out (choreo.ts), then whatever the
 *  play set off — the extra point, the kickoff — is played out after it
 *  (specials.ts). The panel says what happened and why, in the numbers that
 *  decided it.
 *
 *  Everything on the screen happens in one panel: there are no pop-ups over
 *  the field, which is the thing being watched. Everything the page shows is
 *  drawn from the Game; nothing here decides football. */
import {
  CONCEPTS, COVERAGE_LABEL, ELIGIBLE, FORMATIONS, GAP_Y, LANDMARK, MAN, ROUTE, ROUTES_FOR, RUNS,
  type Coverage, type DefJob, type DefSlot, type Job, type OffSlot, type Zone,
} from './kb';
import { assignments, defAlign, defLineup, formation, offLineup, zoneSpot, type Result, type Spot } from './engine';
import { fgMake, passCall, runCall } from './ai';
import { Game, describe, dirOf, type Event, type Side } from './game';
import { choreograph, routePath, FPS } from './choreo';
import { kickoffReel, placeKickReel, playReel, puntReel, type Reel } from './specials';
import * as R from './render';
import type { Card, DefCall, League, League2026, OffCall, TeamDoc } from './types';
import { u } from '../url';
import { pickColours } from '../compare';
import { readableOn } from '../colour';

const $ = <T extends HTMLElement>(root: ParentNode, sel: string) => root.querySelector<T>(sel)!;
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const ORD = ['', '1st', '2nd', '3rd', '4th'];
const x2 = (r: number) => `×${r.toFixed(2)}`;
const pct = (r: number) => `${Math.round(r * 100)}%`;
const n = (k: number, one: string, many = `${one}s`) => `${k} ${k === 1 ? one : many}`;
const mmss = (s: number) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.max(0, Math.round(s)) % 60).padStart(2, '0')}`;
const other = (s: Side): Side => (s === 'user' ? 'cpu' : 'user');
const ZONE_ORDER: Zone[] = ['FLAT_L', 'CURL_L', 'HOOK_L', 'HOOK_M', 'HOOK_R', 'CURL_R', 'FLAT_R', 'MID_HOOK', 'ROBBER',
  'DEEP_L', 'DEEP_M', 'DEEP_R', 'HALF_L', 'HALF_R', 'QTR_L1', 'QTR_L2', 'QTR_R2', 'QTR_R1'];
const COVER_NOTE: Record<Coverage, string> = {
  COVER_0: 'Man everywhere, nobody deep, everyone else comes.',
  COVER_1: 'Man under, one safety deep, a robber in the middle.',
  '2_MAN': 'Man under, two safeties splitting the deep field.',
  COVER_2: 'Five underneath zones, two deep halves.',
  COVER_3: 'Three deep, four under. The league’s favourite.',
  COVER_4: 'Four deep quarters; strong against the deep ball.',
  COVER_6: 'Quarters to one side, Cover 2 to the other.',
};
const RUSH_LABEL: Record<number, string> = { 3: '3 — drop eight', 4: '4 — the front four', 5: '5 — blitz', 6: '6 — big blitz' };

type Mode = 'loading' | 'intro' | 'call' | 'play' | 'result' | 'fourth' | 'over' | 'error';

/** A reel on the queue, with who was kicking (or had the ball) and in which
 *  quarter — which together say which way it runs across the screen. */
interface Queued { reel: Reel; side: Side; q: number; }

export async function mountPractice(): Promise<void> {
  const root = $<HTMLElement>(document, '[data-practice]');
  const canvas = $<HTMLCanvasElement>(root, '[data-field]');
  const g = canvas.getContext('2d')!;
  const wrap = canvas.parentElement!;
  const panel = $<HTMLElement>(root, '[data-tray]');
  const tip = $<HTMLElement>(root, '[data-tip]');
  const beat = $<HTMLElement>(root, '[data-beat]');
  const close = $<HTMLAnchorElement>(root, '[data-close]');

  const qs = new URLSearchParams(location.search);
  const mine = (qs.get('team') ?? '').toUpperCase();
  const theirs = (qs.get('vs') ?? '').toUpperCase();
  if (mine) close.href = u(`/teams/${mine}/`);

  let mode: Mode = 'loading';
  const fail = (msg: string) => { mode = 'error'; panel.replaceChildren(el('p', 'pr-note', msg)); };
  if (!/^[A-Z]{2,3}$/.test(mine) || !/^[A-Z]{2,3}$/.test(theirs) || mine === theirs) {
    fail('Pick a club to practise against from a club’s page.');
    return;
  }

  // ── Data.
  let L: League, lg26: League2026, user: TeamDoc, cpu: TeamDoc;
  try {
    const get = (p: string) => fetch(u(`/data/practice/${p}`)).then((r) => { if (!r.ok) throw new Error(p); return r.json(); });
    [L, lg26, user, cpu] = await Promise.all([get('league.json'), get('league2026.json'), get(`${mine}.json`), get(`${theirs}.json`)]);
  } catch {
    fail('The practice data could not be loaded.');
    return;
  }
  document.title = `Practice: ${user.nick} against ${cpu.nick}`;
  const team = (s: Side) => (s === 'user' ? user : cpu);
  const nickOf = (s: Side) => team(s).nick;

  // The two clubs' colours, made to read apart on the dark field.
  const [uCol, cCol] = pickColours(user.color, user.color2, cpu.color, cpu.color2);
  const css = (name: string) => getComputedStyle(root).getPropertyValue(name).trim();
  const look: R.Look = {
    turf: css('--nfl-turf') || 'oklch(26% 0.018 145)', turfEnd: css('--nfl-turf-end') || 'oklch(21% 0.024 145)',
    ground: css('--ks-instrument-deep') || '#1a1a1a', mono: css('--ks-mono') || 'monospace', sans: css('--ks-font') || 'sans-serif',
  };
  const gold = css('--ks-kinpaku') || 'oklch(84% 0.19 80.46)';
  const colourOf = (s: Side) => (s === 'user' ? uCol : cCol);

  const crests: Partial<Record<Side, R.Crest>> = {};
  for (const s of ['user', 'cpu'] as const) {
    const img = new Image();
    img.addEventListener('load', () => { crests[s] = { img, ink: R.inkOf(img) }; draw(); });
    img.src = u(`/logos/${team(s).team}.png`);
  }
  /** The field's crests, by which side is attacking which way: a club's mark
   *  is in the end zone it defends. */
  const lookFor = (side: Side, dir: 1 | -1, posts = false): R.Look => {
    const left = dir === 1 ? side : other(side);
    return { ...look, left: crests[left], right: crests[other(left)], posts };
  };

  // ── The bug.
  for (const s of ['user', 'cpu'] as const) {
    const box = $<HTMLElement>(root, `[data-side="${s}"]`);
    $<HTMLImageElement>(box, '.mark').src = u(`/logos/${team(s).team}.png`);
    $<HTMLImageElement>(box, '.mark').alt = team(s).name;
    $<HTMLElement>(box, '.edge').style.background = colourOf(s);
    $<HTMLElement>(box, '.who').textContent = s === 'user' ? 'You' : 'Computer';
  }

  // ── The game, and the user's two calls, kept from snap to snap.
  let game!: Game;
  let quarterMin = clamp(Number(qs.get('q')) || 5, 2, 15);
  let userReceives = true;
  let fid = 'gun-doubles';
  let playId = 'curl-flat';
  let oCall: OffCall = passCall(playId, fid);
  /** Receivers the user has moved, held relative to the ball so they stay
   *  where he put them as the ball moves across the hashes. */
  let movedRel: Partial<Record<OffSlot, Spot>> = {};
  let dCall: DefCall = { coverage: 'COVER_3', rushers: 4 };
  let selected: string | null = null;
  let hover: string | null = null;

  // What is being shown on the field, and what the panel says about it.
  let queue: Queued[] = [];
  let qi = 0;                          // which reel is playing
  let mt = 0;                          // seconds into it
  let shownBeats = 0;
  let camera: number | null = null;
  let speed = 1;
  let onFirstDone: (() => void) | null = null;
  let onAllDone: (() => void) | null = null;
  let result: Result | null = null;
  let resultEvents: Event[] = [];
  let theirCall: OffCall | DefCall | null = null;
  let resultFrom: Side = 'user';
  let playing = '';

  // ── Layout.
  let W = 0, H = 0;
  function layout(): void {
    const r = wrap.getBoundingClientRect();
    W = Math.max(200, Math.floor(r.width)); H = Math.max(160, Math.floor(r.height));
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    canvas.style.width = `${W}px`; canvas.style.height = `${H}px`;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw();
  }
  new ResizeObserver(layout).observe(wrap);

  const presnapView = (): R.View => (game ? R.view(W, H, game.los, game.dir) : R.view(W, H, 25, 1));

  // ── Who is on the field before the snap.
  interface Scene {
    offSide: Side;
    O: { cards: Partial<Record<OffSlot, Card>>; at: Partial<Record<OffSlot, Spot>> };
    D: { cards: Partial<Record<DefSlot, Card>>; at: Partial<Record<DefSlot, Spot>> };
    jobs: Partial<Record<DefSlot, DefJob>> | null;    // shown only for the user's defence
    oc: OffCall | null;                                // shown only for the user's offence
  }

  function userOffCall(): OffCall {
    const moved: OffCall['moved'] = {};
    for (const [s, p] of Object.entries(movedRel) as [OffSlot, Spot][]) moved[s] = { x: p.x, y: p.y + game.hashY };
    return { ...oCall, moved };
  }

  function scene(): Scene {
    const hashY = game.hashY;
    // Between a fourth-down decision and the next snap the computer has not
    // called anything yet; it stands in its base look until it does.
    const cpuCall = game.cpuCall ?? (game.userOnOffence ? { coverage: 'COVER_3', rushers: 4 } as DefCall : passCall('curl-flat', 'gun-doubles'));
    if (game.userOnOffence) {
      const oc = userOffCall();
      const f = formation(oc.formation);
      const O = offLineup(user, f, oc.moved, hashY);
      const cards = defLineup(cpu);
      return { offSide: 'user', O, D: { cards, at: defAlign(cards, (cpuCall as DefCall).coverage, O.at, hashY, f.under, 100 - game.los + 9, (cpuCall as DefCall).press) }, jobs: null, oc };
    }
    const oc = cpuCall as OffCall;
    const f = formation(oc.formation);
    const O = offLineup(cpu, f, oc.moved, hashY);
    const cards = defLineup(user);
    const eligible = ELIGIBLE.filter((s) => O.cards[s]);
    const at = defAlign(cards, dCall.coverage, O.at, hashY, f.under, 100 - game.los + 9, dCall.press);
    return { offSide: 'cpu', O, D: { cards, at }, jobs: assignments(dCall, cards, eligible, true, at), oc: null };
  }

  // ── Drawing.
  function draw(): void {
    if (!W) return;
    const cur = queue[Math.min(qi, queue.length - 1)];
    if (cur && (mode === 'play' || mode === 'result')) { drawReel(cur); return; }
    const v = presnapView();
    R.drawField(g, v, game ? lookFor(game.poss, game.dir) : lookFor('user', 1));
    if (!game || mode === 'intro' || mode === 'loading' || mode === 'error') return;
    R.drawLines(g, v, game.togo, game.los, gold);
    drawPresnap(v, mode === 'call');
  }

  function drawPresnap(v: R.View, plans: boolean): void {
    const sc = scene();
    // The plan is drawn in white, whichever side it is: a club's colour on
    // dark turf disappears — navy, maroon — and white reads on all of them.
    // The zones keep a wash of the club's colour inside the white outline,
    // so it is still plain whose they are.
    const chalk = 'oklch(97% 0 0)', defCol = colourOf(other(sc.offSide));
    const offCol = chalk;
    const hashY = game.hashY;
    if (plans && sc.oc) {
      // The user's play, drawn as a coach draws it.
      const oc = sc.oc;
      if (oc.kind === 'run') {
        const runner: OffSlot = oc.runner === 'QB' ? 'QB' : sc.O.at.RB ? 'RB' : 'FB';
        const s = sc.O.at[runner];
        if (s) {
          const hole = { x: 0.6, y: hashY + GAP_Y[oc.gap ?? 'middle'] };
          R.drawRunPath(g, v, [s, { x: (s.x + hole.x) / 2 - 0.5, y: (s.y + hole.y) / 2 }, hole, { x: 6, y: hole.y + (hole.y - hashY) * 0.3 }], offCol, look);
        }
        for (const sl of ELIGIBLE) if (sl !== runner && sc.O.at[sl]) R.drawBlock(g, v, sc.O.at[sl]!, offCol);
      } else {
        for (const sl of ELIGIBLE) {
          const at = sc.O.at[sl]; const job = oc.jobs[sl];
          if (!at || !job) continue;
          if (job === 'BLOCK') R.drawBlock(g, v, at, offCol);
          else {
            const k = oc.reads.indexOf(sl);
            R.drawRoute(g, v, routePath(at, job, hashY, 100 - game.los + 10), offCol, k >= 0 ? k + 1 : null, look);
          }
        }
      }
    }
    if (plans && sc.jobs) {
      const qb = sc.O.at.QB ?? { x: -5, y: hashY };
      for (const [s, j] of Object.entries(sc.jobs) as [DefSlot, DefJob][]) {
        const at = sc.D.at[s]; if (!at) continue;
        if (j.kind === 'zone') R.drawZone(g, v, at, j.zone, zoneSpot(j.zone, hashY), defCol, chalk, look);
        else if (j.kind === 'man') { const m = sc.O.at[j.on]; if (m) R.drawMan(g, v, at, m, chalk); }
        else R.drawRush(g, v, at, { x: qb.x + 1, y: (qb.y + at.y) / 2 }, chalk);
      }
    }
    for (const [s, c] of Object.entries(sc.D.cards) as [DefSlot, Card][]) {
      const at = sc.D.at[s]; if (at) R.drawDot(g, v, dot(c, at, other(sc.offSide), 'def', `d:${s}`), look);
    }
    for (const [s, c] of Object.entries(sc.O.cards) as [OffSlot, Card][]) {
      const at = sc.O.at[s]; if (at) R.drawDot(g, v, dot(c, at, sc.offSide, 'off', `o:${s}`), look);
    }
    R.drawBall(g, v, { x: 0.3, y: hashY }, 0);
  }

  function dot(c: Card, at: Spot, side: Side, unit: 'off' | 'def', key: string | null, extra: Partial<R.Dot> = {}): R.Dot {
    const fill = colourOf(side);
    return { at, no: c.no || '·', pos: c.pos, side: unit, fill, ink: readableOn(fill), edge: 'oklch(100% 0 0 / 0.55)',
             selected: key !== null && selected === key, hover: key !== null && hover === key, ...extra };
  }

  function drawReel(qd: Queued): void {
    const { reel, side, q } = qd;
    const dir = dirOf(side, q);
    const v = R.view(W, H, reel.los, dir, camera ?? undefined);
    R.drawField(g, v, lookFor(side, dir, !!reel.posts));
    R.drawLines(g, v, reel.togo ?? 100, reel.los, gold);
    const f = clamp(Math.floor(mt * FPS), 0, reel.frames - 1);
    const downed = f >= reel.whistle ? reel.downed : undefined;
    reel.actors.forEach((a, i) => {
      const s = a.team === 'kick' ? side : other(side);
      R.drawDot(g, v, dot(a.card, { x: a.xy[f * 2]!, y: a.xy[f * 2 + 1]! }, s, a.team === 'kick' ? 'off' : 'def', null, { down: downed === i }), look);
    });
    R.drawBall(g, v, { x: reel.ball[f * 3]!, y: reel.ball[f * 3 + 1]! }, reel.ball[f * 3 + 2]!);
  }

  // ── The reels: played in order, the camera following the ball.
  function play(list: Queued[], first: () => void, all: () => void): void {
    queue = list; qi = 0; mt = 0; shownBeats = 0;
    onFirstDone = first; onAllDone = all;
    if (!list.length) { onFirstDone = onAllDone = null; first(); all(); return; }
    camera = startCamera(list[0]!);
    mode = 'play';
    paint();
    last = performance.now();
    requestAnimationFrame(tick);
  }
  /** Where the camera starts on a reel: where the picture before the snap
   *  would have put it. */
  const startCamera = (qd: Queued) => R.view(W, H, qd.reel.los, dirOf(qd.side, qd.q)).cx;

  let last = 0;
  function tick(now: number): void {
    const cur = queue[qi];
    if (!cur || (mode !== 'play' && mode !== 'result')) return;
    // A frame's timestamp is when the frame began, which can be a moment
    // before the snap was pressed: a negative first step would put the
    // picture at frame -1 and the camera at NaN for good.
    const dt = clamp((now - last) / 1000, 0, 0.05);
    last = now;
    mt += dt * speed;
    const reel = cur.reel;
    const f = clamp(Math.floor(mt * FPS), 0, reel.frames - 1);
    const dir = dirOf(cur.side, cur.q);
    const want = (dir === 1 ? reel.los : 100 - reel.los) + dir * (reel.ball[f * 3]! + 4);
    camera = camera === null ? want : camera + (want - camera) * Math.min(1, dt * 2.5);
    while (shownBeats < reel.beats.length && reel.beats[shownBeats]!.t <= mt) {
      const b = reel.beats[shownBeats++]!;
      flash(b.text, b.tone);
    }
    draw();
    if (mt * FPS >= reel.frames - 1) {
      if (qi === 0 && onFirstDone) { const fd = onFirstDone; onFirstDone = null; fd(); }
      if (qi < queue.length - 1) {
        // The next reel is another part of the field, or another direction
        // after a change of ends: the camera goes straight there.
        qi++; mt = 0; shownBeats = 0;
        camera = startCamera(queue[qi]!);
      } else {
        const ad = onAllDone; onAllDone = null;
        ad?.();
        return;
      }
    }
    requestAnimationFrame(tick);
  }
  /** Skip to the end of whatever is playing. */
  function skip(): void {
    if (!queue.length) return;
    qi = queue.length - 1;
    mt = queue[qi]!.reel.frames / FPS;
    camera = null;
    if (onFirstDone) { const fd = onFirstDone; onFirstDone = null; fd(); }
    draw();
  }

  /** The reels a list of events sets off: the extra point after a touchdown,
   *  the kickoff after a score, a punt, a field goal. */
  function kicks(events: Event[]): Queued[] {
    const out: Queued[] = [];
    for (const e of events) {
      if (e.kind === 'td') out.push({ reel: placeKickReel(team(e.side), team(other(e.side)), 85, e.xp, true), side: e.side, q: e.q });
      else if (e.kind === 'fg') out.push({ reel: placeKickReel(team(e.side), team(other(e.side)), e.from, e.good, false), side: e.side, q: e.q });
      else if (e.kind === 'punt') out.push({ reel: puntReel(team(e.side), team(other(e.side)), e.from, e.net, e.ret, e.touchback), side: e.side, q: e.q });
      else if (e.kind === 'kickoff') out.push({ reel: kickoffReel(team(e.by), team(other(e.by)), e.from, e.start), side: e.by, q: e.q });
    }
    return out;
  }

  let flashTimer = 0;
  function flash(text: string, tone: 'good' | 'bad' | 'plain'): void {
    beat.textContent = text;
    beat.dataset.tone = tone;
    beat.classList.remove('show'); void beat.offsetWidth; beat.classList.add('show');
    clearTimeout(flashTimer);
    flashTimer = window.setTimeout(() => beat.classList.remove('show'), 1300);
  }

  // ── The bug.
  /** The bug as it stood at the snap. The game has already moved on when a
   *  play starts to be drawn — the score, the next down — and the bug holds
   *  still until the play is over, so it never tells the ending first. */
  interface BugState { score: Record<Side, number>; poss: Side; down: string; clock: string; }
  let frozen: BugState | null = null;
  const bugNow = (): BugState => {
    const goal = game.los + game.togo >= 100;
    return { score: { ...game.score }, poss: game.poss, down: `${ORD[game.down]} & ${goal ? 'Goal' : game.togo}`,
             clock: `Q${game.quarter} ${mmss(game.clock)} · ${game.spot()}` };
  };
  function paintBug(): void {
    const b = game ? (mode === 'play' && frozen ? frozen : bugNow()) : null;
    for (const s of ['user', 'cpu'] as const) {
      const box = $<HTMLElement>(root, `[data-side="${s}"]`);
      $<HTMLElement>(box, '.pts').textContent = b ? String(b.score[s]) : '0';
      box.classList.toggle('has-ball', !!b && b.poss === s && mode !== 'over');
      box.classList.toggle('lead', !!b && b.score[s] > b.score[other(s)]);
    }
    const dd = $<HTMLElement>(root, '[data-down]');
    const ck = $<HTMLElement>(root, '[data-clock]');
    // Before the kickoff: what is about to happen, so the bug is the same
    // shape it will be for the rest of the game.
    if (!b) { dd.textContent = 'Kickoff'; ck.textContent = `Q1 ${mmss(quarterMin * 60)}`; dd.style.boxShadow = ''; return; }
    if (mode === 'over') { dd.textContent = 'Final'; ck.textContent = ''; return; }
    dd.textContent = b.down;
    dd.style.boxShadow = `inset 0 -3px 0 ${colourOf(b.poss)}`;
    ck.textContent = b.clock;
  }

  // ── The panel's parts.
  interface Opt { value: string; text: string; disabled?: boolean; }
  interface Grp { label?: string; options: Opt[]; }
  /** A labelled dropdown, with a line under it saying what the choice
   *  means. */
  function dropdown(label: string, value: string, groups: Grp[], change: (v: string) => void, hint?: string): HTMLElement {
    const box = el('label', 'pr-ctl');
    box.append(el('span', 'pr-label', label));
    const sel = el('select', 'pr-select');
    for (const gp of groups) {
      let parent: HTMLElement = sel;
      if (gp.label) { const og = el('optgroup'); og.label = gp.label; sel.append(og); parent = og; }
      for (const o of gp.options) {
        const op = el('option', '', o.text);
        op.value = o.value; op.disabled = !!o.disabled;
        parent.append(op);
      }
    }
    sel.value = value;
    sel.addEventListener('change', () => change(sel.value));
    box.append(sel);
    if (hint) box.append(el('span', 'pr-hint', hint));
    return box;
  }
  function button(text: string, act: () => void, cls = 'pr-btn', disabled = false): HTMLButtonElement {
    const b = el('button', cls, text);
    b.type = 'button'; b.disabled = disabled;
    b.addEventListener('click', act);
    return b;
  }
  const section = (cls: string, ...kids: (HTMLElement | null)[]) => {
    const d = el('section', `pr-sec ${cls}`.trim());
    d.append(...kids.filter((k): k is HTMLElement => !!k));
    return d;
  };
  const actions = (...kids: (HTMLElement | null)[]) => {
    const d = el('div', 'pr-actions');
    d.append(...kids.filter((k): k is HTMLElement => !!k));
    return d;
  };

  function speedKeys(): HTMLElement {
    const d = el('div', 'pr-speed');
    d.setAttribute('role', 'group'); d.setAttribute('aria-label', 'Speed');
    for (const s of [0.5, 1, 2]) {
      const b = button(s === 0.5 ? '½×' : `${s}×`, () => { speed = s; for (const x of d.children) x.setAttribute('aria-pressed', String(x === b)); }, 'pr-key');
      b.setAttribute('aria-pressed', String(speed === s));
      d.append(b);
    }
    return d;
  }

  // ── Painting the panel for each mode.
  function paint(): void {
    paintBug();
    const parts: HTMLElement[] = [];
    if (mode === 'intro') parts.push(...introPanel());
    else if (mode === 'call') parts.push(...(game.userOnOffence ? offencePanel() : defencePanel()));
    else if (mode === 'fourth') parts.push(...fourthPanel());
    else if (mode === 'play') parts.push(section('pr-playing', el('p', 'pr-eyebrow', 'In play'), el('p', 'pr-lede', playing)), actions(speedKeys(), button('Skip', skip)));
    else if (mode === 'result') parts.push(...resultPanel());
    else if (mode === 'over') parts.push(...overPanel());
    panel.replaceChildren(...parts);
    const go = panel.querySelector<HTMLButtonElement>('.pr-go');
    if (go && mode !== 'call') go.focus({ preventScroll: true });
  }

  // Offence.
  function offencePanel(): HTMLElement[] {
    const f = formation(fid);
    const hasBack = f.align.some((a) => a.slot === 'RB' || a.slot === 'FB');
    const concept = CONCEPTS.find((c) => c.id === playId), run = RUNS.find((r) => r.id === playId);
    const calls = section('pr-calls',
      dropdown('Formation', fid, [{ options: FORMATIONS.map((x) => ({ value: x.id, text: x.name })) }], setFormation,
        `${f.personnel} personnel, ${f.under ? 'under centre' : 'from the gun'}.`),
      dropdown('Play', playId, [
        { label: 'Pass', options: CONCEPTS.map((c) => ({ value: c.id, text: c.name })) },
        { label: 'Run', options: RUNS.map((r) => ({ value: r.id, text: r.name, disabled: r.runner === 'RB' && !hasBack })) },
      ], setPlay, (concept ?? run)?.note),
    );
    const kick = game.canKickEarly ? section('', button(`Kick a ${100 - game.los + 17}-yard field goal now`, kickNow, 'pr-btn pr-wide')) : null;
    return [scoutOffence(), calls, playerPanel(), ...(kick ? [kick] : []), actions(button('Reset play', resetPlay), button('Snap', doSnap, 'pr-go'))];
  }

  // Defence.
  function defencePanel(): HTMLElement[] {
    const calls = section('pr-calls',
      dropdown('Coverage', dCall.coverage, [{ options: (Object.keys(COVERAGE_LABEL) as Coverage[]).map((c) => ({ value: c, text: COVERAGE_LABEL[c] })) }],
        (v) => { const c = v as Coverage; dCall = { coverage: c, rushers: c === 'COVER_0' ? Math.max(6, dCall.rushers) : dCall.rushers, press: dCall.press }; selected = null; refresh(); },
        COVER_NOTE[dCall.coverage]),
      ...(MAN[dCall.coverage] ? [dropdown('Alignment', dCall.press ? 'press' : 'off', [{ options: [{ value: 'off', text: 'Off — six yards' }, { value: 'press', text: 'Press — at the line' }] }],
        (v) => { dCall = { ...dCall, press: v === 'press' }; refresh(); },
        dCall.press ? 'Up on the line: win the release and he is gone; lose it and his man is jammed.' : 'Off the ball: a cushion to give, and a turn to make when it is gone.')] : []),
      dropdown('Rushers', String(dCall.rushers), [{ options: [3, 4, 5, 6].map((k) => ({ value: String(k), text: RUSH_LABEL[k]! })) }],
        (v) => { dCall = { ...dCall, rushers: Number(v) }; refresh(); },
        `Across the league, ${dCall.rushers} rushing get pressure on ${pct(L.pressure.byRushers[String(dCall.rushers)]?.pressure ?? 0.26)} of dropbacks.`),
    );
    return [scoutDefence(), calls, playerPanel(), actions(button('Reset play', resetPlay), button('Snap', doSnap, 'pr-go'))];
  }

  /** What the user can know before the snap: the other side's season, in
   *  the numbers the engine will use, and what it is showing. */
  function scoutOffence(): HTMLElement {
    const d = cpu.rates.def;
    const dc = (game.cpuCall ?? { coverage: 'COVER_3', rushers: 4 }) as DefCall;
    const twoHigh = ['2_MAN', 'COVER_2', 'COVER_4', 'COVER_6'].includes(dc.coverage);
    return section('pr-scout',
      el('p', 'pr-eyebrow', `${cpu.nick} defence`),
      el('p', 'pr-lede', `They show ${twoHigh ? 'two deep safeties' : dc.coverage === 'COVER_0' ? 'nobody deep' : 'one deep safety'}.`),
      el('p', 'pr-note', `They allow ${x2(d.cmp)} the league’s completion rate, sack ${x2(d.sack)} as often, give up ${x2(d.ypc)} its yards a carry, and blitz ${pct(cpu.rates.blitz)} of the time.`));
  }
  function scoutDefence(): HTMLElement {
    const o = cpu.rates.off;
    const oc = (game.cpuCall ?? passCall('curl-flat', 'gun-doubles')) as OffCall;
    return section('pr-scout',
      el('p', 'pr-eyebrow', `${cpu.nick} offence`),
      el('p', 'pr-lede', `They line up in ${formation(oc.formation).name}.`),
      el('p', 'pr-note', `They pass ${x2(cpu.rates.passLean)} as often as the league on early downs, complete ${x2(o.cmp)} its rate, and run for ${x2(o.ypc)} its yards a carry.`));
  }

  // A player: his season, and his job if he is the user's.
  function seasonLine(t: TeamDoc, c: Card): string {
    const p = t.players[c.id];
    if (!p) return 'No 2026 numbers yet — plays as the league average.';
    const bits: string[] = [];
    if (p.qb) bits.push(`${p.qb.att} attempts; completes ${x2(p.qb.cmp)} the league rate, intercepted ${x2(p.qb.int)}, sacked ${x2(p.qb.sack)}; throws ${p.qb.adot.toFixed(1)} yards downfield on average`);
    if (p.rec) bits.push(`${n(p.rec.tgt, 'target')} (${pct(p.rec.share)} of the team’s), catches ${pct(p.rec.catch)}, ${p.rec.yac.toFixed(1)} yards after the catch`);
    if (p.rush && p.rush.att >= 5) bits.push(`${n(p.rush.att, 'carry', 'carries')} at ${x2(p.rush.ypc)} the league’s yards a carry`);
    if (p.def && !p.k && !p.p) bits.push(`${n(p.def.tkl, 'tackle')}, ${n(p.def.sk, 'sack')}, ${n(p.def.int, 'interception')}, ${n(p.def.pd, 'pass', 'passes')} defended, ${n(p.def.qbh, 'QB hit')}`);
    if (p.k) bits.push(`${p.k.fgm}/${p.k.fga} field goals, long ${p.k.long}`);
    if (p.p) bits.push(`${n(p.p.n, 'punt')}, ${p.p.net.toFixed(1)} net`);
    return bits.join('. ') + '.';
  }
  function who(side: Side, c: Card): HTMLElement {
    const d = el('div', 'pr-who');
    const no = el('span', 'pr-no', String(c.no || '·'));
    no.style.background = colourOf(side); no.style.color = readableOn(colourOf(side));
    const txt = el('div');
    txt.append(el('span', 'pr-name', c.name), el('span', 'pr-sub', `${c.pos} · ${team(side).nick}`));
    d.append(no, txt);
    const box = el('div');
    box.append(d, el('p', 'pr-season', seasonLine(team(side), c)));
    return box;
  }

  interface Hit { key: string; side: Side; card: Card; at: Spot; }
  function playerPanel(): HTMLElement {
    const h = selected ? hits().find((x) => x.key === selected) : undefined;
    if (!h) return section('pr-player pr-empty', el('p', 'pr-note',
      game.userOnOffence ? 'Tap one of your players to change his route or make him the first read. Drag a receiver to move him.'
                         : 'Tap one of your defenders to change his job.'));
    const box = section('pr-player', who(h.side, h.card));
    const slot = h.key.slice(2);
    if (h.side === 'user' && h.key.startsWith('o:')) {
      const s = slot as OffSlot;
      if (oCall.kind === 'run') box.append(el('p', 'pr-note', s === (oCall.runner === 'QB' ? 'QB' : 'RB') ? 'He carries it.' : 'On a run, he blocks.'));
      else if (ELIGIBLE.includes(s)) {
        box.append(dropdown('Route', oCall.jobs[s] ?? 'BLOCK', [
          { options: ROUTES_FOR(s).map((r) => ({ value: r, text: ROUTE[r].label })) },
          { options: [{ value: 'BLOCK', text: 'Stay in and block' }] },
        ], (v) => setJob(s, v as Job)));
        const job = oCall.jobs[s];
        if (job && job !== 'BLOCK') {
          const k = oCall.reads.indexOf(s);
          box.append(k === 0 ? el('p', 'pr-note', 'He is the first read.')
            : button(`Make him the first read (now ${ORD[k + 1] ?? `${k + 1}th`})`, () => { oCall = { ...oCall, reads: [s, ...oCall.reads.filter((x) => x !== s)] }; refresh(); }, 'pr-btn pr-wide'));
        }
      } else box.append(el('p', 'pr-note', s === 'QB' ? 'He reads the routes in the order numbered on them.' : 'He blocks.'));
    } else if (h.side === 'user') {
      const s = slot as DefSlot;
      const sc = scene();
      const cur = sc.jobs?.[s];
      const value = !cur || cur.kind === 'rush' ? 'rush' : cur.kind === 'man' ? `man:${cur.on}` : `zone:${cur.zone}`;
      box.append(dropdown('Job', value, [
        { options: [{ value: 'rush', text: 'Rush the quarterback' }] },
        { label: 'Man on', options: ELIGIBLE.filter((e) => sc.O.cards[e]).map((e) => ({ value: `man:${e}`, text: `${sc.O.cards[e]!.no} ${sc.O.cards[e]!.pos} — ${sc.O.cards[e]!.short}` })) },
        { label: 'Zone', options: ZONE_ORDER.map((z) => ({ value: `zone:${z}`, text: zoneName(z) })) },
      ], (v) => {
        const [k, x] = v.split(':');
        setDefJob(s, k === 'rush' ? { kind: 'rush' } : k === 'man' ? { kind: 'man', on: x as OffSlot } : { kind: 'zone', zone: x as Zone });
      }));
    }
    box.append(button('Done', () => { selected = null; refresh(); }, 'pr-btn pr-quiet'));
    return box;
  }
  /** A zone named by where it is on the screen, which is the only frame the
   *  user has: top and bottom, near and deep. */
  function zoneName(z: Zone): string {
    const y = LANDMARK[z].y * game.dir;
    const side = Math.abs(y) < 2 ? 'middle' : y > 0 ? 'top' : 'bottom';
    return `${LANDMARK[z].label} — ${side}`;
  }

  // Fourth down.
  function fourthPanel(): HTMLElement[] {
    const sit = game.situation();
    const kick = 100 - sit.los + 17;
    const make = fgMake(kick, L, user);
    const band = `${sit.togo <= 3 ? 'short' : sit.togo <= 7 ? 'med' : 'long'}-${100 - sit.los >= 51 ? 'own' : 100 - sit.los >= 35 ? 'mid' : 'fg'}`;
    const p = user.punter ? user.players[user.punter.id]?.p : undefined;
    return [
      section('pr-scout', el('p', 'pr-eyebrow', 'Fourth down'),
        el('p', 'pr-lede', `4th & ${sit.los + sit.togo >= 100 ? 'goal' : sit.togo} at ${game.spot()}.`),
        el('p', 'pr-note', `The league goes for it here ${pct(L.fourth[band]?.go ?? 0.1)} of the time. ` +
          (kick > 60 ? `A ${kick}-yard kick is out of range. ` : `From ${kick} yards ${user.kicker?.short ?? 'your kicker'} makes ${pct(make)}, the league’s rate moved by his season.`) +
          `${p ? ` ${user.punter!.short} nets ${p.net.toFixed(1)} a punt.` : ''}`)),
      section('pr-choices',
        button('Go for it', () => { game.fourth('go'); toCall(); }, 'pr-go pr-wide'),
        button(kick > 60 ? `Field goal — out of range` : `Field goal — ${kick} yards, ${pct(make)}`, kickNow, 'pr-btn pr-wide', kick > 60),
        button('Punt', () => { kickBug = bugNow(); kickAway(game.fourth('punt'), 'user'); }, 'pr-btn pr-wide', sit.los >= 95)),
    ];
  }

  // After a play, or a kick.
  function resultPanel(): HTMLElement[] {
    const out: HTMLElement[] = [];
    const ev = resultEvents.map(eventText).filter(Boolean) as string[];
    const head = el('div', 'pr-result-head');
    const bar = el('span', 'pr-bar'); bar.style.background = colourOf(resultFrom);
    if (result) {
      const r = result;
      const won = !r.turnover && !r.safety && (r.td || r.gain >= Math.min(4, lastTogo));
      const good = (resultFrom === 'user') === won;
      const gain = r.kind === 'incomplete' || r.kind === 'throwaway' || r.kind === 'int' ? '' : `${r.gain > 0 ? '+' : ''}${r.gain}`;
      const title = r.td ? 'Touchdown' : r.kind === 'int' ? 'Intercepted' : r.turnover ? 'Fumble' : r.safety ? 'Safety'
        : r.kind === 'complete' ? 'Complete' : r.kind === 'incomplete' ? 'Incomplete' : r.kind === 'sack' ? 'Sacked'
        : r.kind === 'scramble' ? 'Scramble' : r.kind === 'throwaway' ? 'Thrown away' : 'Run';
      head.append(bar, el('p', 'pr-title', title));
      if (gain) head.append(el('p', `pr-gain ${good ? 'good' : 'bad'}`, gain));
      const sec = section('pr-result', el('p', 'pr-eyebrow', 'The play'), head, el('p', 'pr-lede', describe(r)));
      if (theirCall && 'coverage' in theirCall) sec.append(el('p', 'pr-note', `${cpu.nick} were in ${COVERAGE_LABEL[theirCall.coverage]} with ${r.rushers} rushing.`));
      else if (theirCall) {
        const oc = theirCall as OffCall;
        const name = CONCEPTS.find((c) => c.id === oc.playId)?.name ?? RUNS.find((x) => x.id === oc.playId)?.name ?? oc.playId;
        sec.append(el('p', 'pr-note', `${cpu.nick} ran ${name} from ${formation(oc.formation).name}${oc.playAction ? ', with a play fake' : ''}.`));
      }
      if (ev.length) { const ul = el('ul', 'pr-events'); for (const t of ev) ul.append(el('li', '', t)); sec.append(ul); }
      out.push(sec);
      if (r.explain.length) {
        const ul = el('ul'); for (const t of r.explain) ul.append(el('li', '', t));
        out.push(section('pr-why', el('p', 'pr-eyebrow', 'Why — the numbers behind it'), ul));
      }
    } else {
      // A kick on its own: a punt, a field goal.
      const k = resultEvents.find((e) => e.kind === 'fg' || e.kind === 'punt');
      head.append(bar, el('p', 'pr-title', k?.kind === 'fg' ? (k.good ? 'Field goal' : 'No good') : 'Punt'));
      const sec = section('pr-result', el('p', 'pr-eyebrow', 'Special teams'), head);
      const ul = el('ul', 'pr-events'); for (const t of ev) ul.append(el('li', '', t)); sec.append(ul);
      if (k?.kind === 'fg') {
        const kt = team(k.side), kicker = kt.kicker, ks = kicker ? kt.players[kicker.id]?.k : undefined;
        const bin = L.fg.find((b) => k.dist >= b.lo && k.dist <= b.hi);
        sec.append(el('p', 'pr-note', `From ${k.dist} yards the league made ${pct(bin?.make ?? 0.5)} in 2025${ks ? `; ${kicker!.short} is ${ks.fgm}/${ks.fga} this season` : ''}.`));
      }
      out.push(sec);
    }
    out.push(actions(speedKeys(), button(game.phase === 'over' ? 'Final score' : 'Next snap', next, 'pr-go')));
    return out;
  }

  function overPanel(): HTMLElement[] {
    const won = game.score.user > game.score.cpu, tied = game.score.user === game.score.cpu;
    const head = el('div', 'pr-result-head');
    head.append(el('p', 'pr-title', tied ? 'A tie' : `${nickOf(won ? 'user' : 'cpu')} win`), el('p', 'pr-gain', `${game.score.user}–${game.score.cpu}`));
    const t = el('table', 'pr-box');
    const hr = el('tr'); hr.append(el('th'), el('th', '', user.team), el('th', '', cpu.team)); t.append(hr);
    const B = game.box;
    const rows: [string, (s: Side) => string][] = [
      ['Yards', (s) => String(B[s].yards)], ['Passing', (s) => String(B[s].pass)], ['Rushing', (s) => String(B[s].rush)],
      ['Plays', (s) => String(B[s].plays)], ['First downs', (s) => String(B[s].firsts)],
      ['Third down', (s) => `${B[s].third[0]}/${B[s].third[1]}`], ['Turnovers', (s) => String(B[s].turnovers)], ['Sacks', (s) => String(B[s].sacks)],
    ];
    for (const [k, f] of rows) { const tr = el('tr'); tr.append(el('th', '', k), el('td', '', f('user')), el('td', '', f('cpu'))); t.append(tr); }
    const lines = [...game.lines.values()];
    const lead = (side: Side, f: (l: typeof lines[number]) => number, fmt: (l: typeof lines[number]) => string) => {
      const best = lines.filter((l) => l.side === side && f(l) > 0).sort((a, b) => f(b) - f(a))[0];
      return best ? fmt(best) : null;
    };
    const ul = el('ul', 'pr-events');
    for (const side of ['user', 'cpu'] as const) {
      const bits = [
        lead(side, (l) => l.att ?? 0, (l) => `${l.short} ${l.cmp ?? 0}/${l.att} for ${l.pyds ?? 0}${l.ptd ? `, ${l.ptd} TD` : ''}${l.int ? `, ${l.int} INT` : ''}`),
        lead(side, (l) => l.ryds ?? 0, (l) => `${l.short} ${n(l.car ?? 0, 'carry', 'carries')} for ${l.ryds}`),
        lead(side, (l) => l.yds ?? 0, (l) => `${l.short} ${n(l.rec ?? 0, 'catch', 'catches')} for ${l.yds}`),
        lead(side, (l) => (l.tkl ?? 0) + 2 * (l.sk ?? 0), (l) => `${l.short} ${n(l.tkl ?? 0, 'tackle')}${l.sk ? `, ${n(l.sk, 'sack')}` : ''}`),
      ].filter(Boolean);
      ul.append(el('li', '', `${nickOf(side)}: ${bits.join(' · ')}`));
    }
    const back = el('a', 'pr-btn', 'Back to the club'); back.href = u(`/teams/${user.team}/`);
    return [section('pr-result', el('p', 'pr-eyebrow', 'Final'), head, t, ul), actions(back, button('Play again', intro, 'pr-go'))];
  }

  function introPanel(): HTMLElement[] {
    return [
      section('pr-scout', el('p', 'pr-eyebrow', 'Practice'), el('p', 'pr-title', `${user.nick} against ${cpu.nick}`),
        el('p', 'pr-lede', `You call every snap for the ${user.nick}, on offence and on defence. The computer calls the ${cpu.nick}’ from what the league does in each situation, bent by their own season.`),
        el('p', 'pr-note', 'Each play is decided by the 2025 league’s own numbers for that route against that coverage, that rush against that protection, that run into that box — moved by both clubs’ and their players’ 2026 seasons. After each play this panel shows the arithmetic.')),
      section('pr-calls',
        dropdown('Quarters', String(quarterMin), [{ options: [3, 5, 8, 15].map((m) => ({ value: String(m), text: `${m} minutes` })) }], (v) => { quarterMin = Number(v); paintBug(); }),
        dropdown('Opening kick', userReceives ? 'receive' : 'kick', [{ options: [{ value: 'receive', text: 'You receive' }, { value: 'kick', text: 'You kick off' }] }], (v) => { userReceives = v === 'receive'; })),
      actions(button('Kick off', start, 'pr-go')),
    ];
  }

  // ── Changing the user's call.
  function setFormation(id: string): void {
    fid = id; movedRel = {};
    const f = formation(fid);
    const run = RUNS.find((r) => r.id === playId);
    if (run && run.runner === 'RB' && !f.align.some((a) => a.slot === 'RB' || a.slot === 'FB')) playId = 'curl-flat';
    setPlay(playId);
  }
  function setPlay(id: string): void {
    playId = id;
    const run = RUNS.find((r) => r.id === id);
    oCall = run ? runCall(id, fid) : passCall(id, fid);
    selected = null;
    refresh();
  }
  function resetPlay(): void {
    if (game.userOnOffence) { movedRel = {}; setPlay(playId); }
    else { dCall = { coverage: dCall.coverage, rushers: dCall.rushers, press: dCall.press }; selected = null; refresh(); }
  }
  function refresh(): void { paint(); draw(); }
  function setJob(s: OffSlot, j: Job): void {
    const jobs = { ...oCall.jobs, [s]: j };
    let reads = oCall.reads.filter((x) => jobs[x] && jobs[x] !== 'BLOCK');
    if (j !== 'BLOCK' && !reads.includes(s)) reads = [...reads, s];
    oCall = { ...oCall, jobs, reads };
    refresh();
  }
  function setDefJob(s: DefSlot, j: DefJob): void {
    dCall = { ...dCall, jobs: { ...(dCall.jobs ?? {}), [s]: j } };
    refresh();
  }

  // ── Picking players on the field.
  function hits(): Hit[] {
    if (!game || mode !== 'call') return [];
    const sc = scene();
    const out: Hit[] = [];
    for (const [s, c] of Object.entries(sc.O.cards) as [OffSlot, Card][]) if (sc.O.at[s]) out.push({ key: `o:${s}`, side: sc.offSide, card: c, at: sc.O.at[s]! });
    for (const [s, c] of Object.entries(sc.D.cards) as [DefSlot, Card][]) if (sc.D.at[s]) out.push({ key: `d:${s}`, side: other(sc.offSide), card: c, at: sc.D.at[s]! });
    return out;
  }
  function hitAt(sx: number, sy: number): Hit | null {
    const v = presnapView(), r = R.dotR(v) + 4;
    let best: Hit | null = null, bd = r;
    for (const h of hits()) {
      const p = R.toScreen(v, h.at);
      const d = Math.hypot(p.x - sx, p.y - sy);
      if (d <= bd) { bd = d; best = h; }
    }
    return best;
  }
  const draggable = (h: Hit) => h.side === 'user' && h.key.startsWith('o:') && ELIGIBLE.includes(h.key.slice(2) as OffSlot);

  /** Select a player: his card, and his job if he is the user's, go in the
   *  panel. The computer's players can be selected too — to read their
   *  seasons — but have no job to change. */
  function pick(h: Hit | null): void {
    selected = h?.key ?? null;
    hideTip();
    refresh();
    // On a narrow screen the panel is under the field: bring it into view.
    if (h) panel.querySelector('.pr-player')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  let drag: { slot: OffSlot; x0: number; y0: number; moved: boolean } | null = null;
  canvas.addEventListener('pointerdown', (e) => {
    if (mode !== 'call') return;
    const b = canvas.getBoundingClientRect();
    const h = hitAt(e.clientX - b.left, e.clientY - b.top);
    if (h && draggable(h)) {
      drag = { slot: h.key.slice(2) as OffSlot, x0: e.clientX, y0: e.clientY, moved: false };
      canvas.setPointerCapture(e.pointerId);
    } else pick(h);
  });
  canvas.addEventListener('pointermove', (e) => {
    const b = canvas.getBoundingClientRect();
    const sx = e.clientX - b.left, sy = e.clientY - b.top;
    if (drag) {
      if (!drag.moved && Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 5) return;
      drag.moved = true; hideTip();
      const p = R.fromScreen(presnapView(), sx, sy);
      const hashY = game.hashY;
      // Behind the line, inside the field, and not inside the line itself.
      const x = clamp(p.x, -8, -0.8);
      let y = clamp(p.y, -25.5, 25.5);
      if (Math.abs(y - hashY) < 4.2 && x > -2.5) y = hashY + Math.sign(y - hashY || 1) * 4.2;
      movedRel[drag.slot] = { x: Math.round(x * 2) / 2, y: Math.round((y - hashY) * 2) / 2 };
      draw();
      return;
    }
    const h = mode === 'call' ? hitAt(sx, sy) : null;
    const key = h?.key ?? null;
    canvas.style.cursor = h ? (draggable(h) ? 'grab' : 'pointer') : '';
    if (key !== hover) { hover = key; draw(); }
    if (h && e.pointerType === 'mouse' && h.key !== selected) showTip(h); else hideTip();
  });
  canvas.addEventListener('pointerup', (e) => {
    if (!drag) return;
    const was = drag; drag = null;
    canvas.releasePointerCapture(e.pointerId);
    if (!was.moved) pick(hits().find((x) => x.key === `o:${was.slot}`) ?? null);
    else { paint(); draw(); }
  });
  canvas.addEventListener('pointerleave', () => { if (hover) { hover = null; draw(); } hideTip(); });

  /** On hover, a player's season — a label, not a dialog: it follows the
   *  pointer and asks for nothing. */
  function showTip(h: Hit): void {
    tip.replaceChildren(who(h.side, h.card));
    const v = presnapView();
    const p = R.toScreen(v, h.at);
    tip.hidden = false;
    const bw = tip.offsetWidth, bh = tip.offsetHeight, r = R.dotR(v);
    let left = p.x + r + 10;
    if (left + bw > W - 8) left = p.x - r - 10 - bw;
    tip.style.left = `${clamp(left, 8, W - bw - 8)}px`;
    tip.style.top = `${clamp(p.y - bh / 2, 8, H - bh - 8)}px`;
  }
  function hideTip(): void { tip.hidden = true; }

  // ── The snap.
  let lastTogo = 10;
  function doSnap(): void {
    if (mode !== 'call') return;
    hideTip();
    selected = null;
    const side = game.poss, q = game.quarter, los = game.los;
    lastTogo = game.togo;
    frozen = bugNow();
    theirCall = game.cpuCall;
    const mineCall = game.userOnOffence ? userOffCall() : dCall;
    playing = game.userOnOffence
      ? `${(CONCEPTS.find((c) => c.id === oCall.playId) ?? RUNS.find((r) => r.id === oCall.playId))?.name ?? 'Your play'} from ${formation(oCall.formation).name}.`
      : `${COVERAGE_LABEL[dCall.coverage]}, ${dCall.rushers} rushing.`;
    const { result: r, events } = game.snap(mineCall);
    result = r; resultEvents = events; resultFrom = side;
    const reel = playReel(r, choreograph(r), los, lastTogo);
    play([{ reel, side, q }, ...kicks(events)], () => { mode = 'result'; paint(); }, () => {});
  }

  /** A field goal on fourth down, or to beat the clock. */
  function kickNow(): void { kickBug = bugNow(); kickAway(game.fourth('fg'), 'user'); }
  let kickBug: BugState | null = null;
  function kickAway(events: Event[], by: Side): void {
    // The game has already moved on by the time the kick is drawn.
    frozen = kickBug;
    result = null; theirCall = null; resultEvents = events; resultFrom = by;
    playing = events.some((e) => e.kind === 'punt') ? `${nickOf(by)} punt.` : `${nickOf(by)} line up for the kick.`;
    play(kicks(events), () => { mode = 'result'; paint(); }, () => {});
  }

  function eventText(e: Event): string | null {
    switch (e.kind) {
      case 'first': return 'First down.';
      case 'td': return `Touchdown, ${nickOf(e.side)} — the extra point is ${e.xp ? 'good' : 'no good'}.`;
      case 'fg': return `${nickOf(e.side)}’ ${e.dist}-yard field goal is ${e.good ? 'good' : 'no good'}.`;
      case 'punt': return `${nickOf(e.side)} punt — ${e.touchback ? 'touchback' : `${e.net} yards net${e.ret ? `, ${e.ret} returned` : ', fair catch'}`}.`;
      case 'safety': return `Safety — two points to ${nickOf(e.side)}.`;
      case 'turnover': return e.how === 'downs' ? 'Turnover on downs.' : e.how === 'int' ? `${nickOf(other(e.side))} ball.` : `Fumble — ${nickOf(other(e.side))} recover.`;
      case 'kickoff': return `${nickOf(e.by)} kick off; ${nickOf(other(e.by))} start at their own ${e.start}.`;
      case 'quarter': return `End of the ${ORD[e.quarter - 1]} quarter.`;
      case 'half': return 'Half-time.';
      case 'over': return 'That’s the game.';
    }
  }

  function next(): void {
    queue = []; qi = 0; camera = null; result = null;
    if (game.phase === 'over') { gameOver(); return; }
    if (game.phase === 'fourth') {
      if (game.poss === 'user') { mode = 'fourth'; paint(); draw(); return; }
      const c = game.cpuFourth();
      if (c === 'go') { game.fourth('go'); flash(`${cpu.nick} go for it`, 'plain'); toCall(); return; }
      kickBug = bugNow();
      kickAway(game.fourth(c), 'cpu');
      return;
    }
    toCall();
  }

  function toCall(): void {
    queue = []; qi = 0; camera = null;
    if (game.phase === 'over') { gameOver(); return; }
    // The user's calls carry over from snap to snap, edits and all.
    mode = 'call';
    paint(); draw();
  }

  function gameOver(): void { mode = 'over'; queue = []; paint(); draw(); }

  // ── The start.
  function intro(): void { mode = 'intro'; queue = []; paint(); draw(); }

  function start(): void {
    // `&seed=` replays the same game, snap for snap, given the same calls.
    const seed = Number(qs.get('seed')) || ((Math.random() * 2 ** 31) | 0);
    game = new Game(user, cpu, L, lg26, { quarterLen: quarterMin * 60, seed, userReceives });
    frozen = { score: { user: 0, cpu: 0 }, poss: userReceives ? 'user' : 'cpu', down: 'Kickoff', clock: `Q1 ${mmss(game.clock)}` };
    const ev = game.start();
    playing = eventText(ev.find((e) => e.kind === 'kickoff')!) ?? 'Kickoff.';
    play(kicks(ev), () => {}, () => toCall());
  }

  // ── Keys.
  document.addEventListener('keydown', (e) => {
    const t = e.target;
    if (t instanceof HTMLInputElement || t instanceof HTMLSelectElement) return;
    if (e.key === 'Escape' && selected) { selected = null; refresh(); e.preventDefault(); return; }
    if (e.key !== ' ' && e.key !== 'Enter') return;
    if (t instanceof HTMLButtonElement || t instanceof HTMLAnchorElement) return;
    if (mode === 'call') { doSnap(); e.preventDefault(); }
    else if (mode === 'result') { next(); e.preventDefault(); }
  });

  layout();
  intro();
}
