/** Drawing the practice field.
 *
 *  The replay's field — the same turf, lines, numbers and crests in the end
 *  zones — seen closer, because here there are twenty-two people on it rather
 *  than one ball. The field is as tall as the screen allows, which sets the
 *  scale; how much of its length is visible follows from that, and the camera
 *  keeps the line of scrimmage a little behind the middle so the play has room
 *  to go forward into.
 *
 *  Positions arrive in the offence's frame (engine.ts) and are turned onto
 *  the screen here, so nothing upstream needs to know which way anybody is
 *  going. */
import { HALF_WIDTH, HASH, LANDMARK, type Zone } from './kb';
import type { Spot } from './engine';

const FIELD_W = HALF_WIDTH * 2;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export interface Crest { img: HTMLImageElement; ink: [number, number, number, number]; }

export interface View {
  w: number; h: number;
  /** Pixels per yard. */
  scale: number;
  /** The field yard (0 = left goal line, 100 = right) at the middle of the
   *  screen. */
  cx: number;
  top: number;
  /** Which way the offence is going on screen, and where its line is. */
  dir: 1 | -1; losAbs: number;
}

/** A view of the field: scale from the height, camera from the line. */
/** `beyond` lets the camera go that many yards past the end lines — for a
 *  kick at the posts, so the ball is seen to clear them and land. */
export function view(w: number, h: number, los: number, dir: 1 | -1, focus?: number, beyond = 0): View {
  const pad = clamp(h * 0.04, 6, 22);
  const scale = Math.min((h - pad * 2) / FIELD_W, w / 60);
  const losAbs = dir === 1 ? los : 100 - los;
  const visible = w / scale;
  const want = focus ?? losAbs + dir * Math.min(12, visible * 0.18);
  const lo = -10 - beyond + visible / 2, hi = 110 + beyond - visible / 2;
  const cx = lo >= hi ? 50 : clamp(want, lo, hi);
  const top = (h - FIELD_W * scale) / 2;
  return { w, h, scale, cx, top, dir, losAbs };
}

/** The offence's frame onto the screen. */
export const toScreen = (v: View, p: Spot): { x: number; y: number } => ({
  x: v.w / 2 + (v.losAbs + v.dir * p.x - v.cx) * v.scale,
  y: v.top + (HALF_WIDTH - v.dir * p.y) * v.scale,
});
export const fromScreen = (v: View, sx: number, sy: number): Spot => ({
  x: ((sx - v.w / 2) / v.scale + v.cx - v.losAbs) * v.dir,
  y: (HALF_WIDTH - (sy - v.top) / v.scale) * v.dir,
});
/** A field yard (absolute) to a screen x. */
const ax = (v: View, X: number) => v.w / 2 + (X - v.cx) * v.scale;

export interface Look {
  turf: string; turfEnd: string; ground: string; mono: string; sans: string;
  /** The crest painted in each end zone, by which side of the screen. */
  left?: Crest; right?: Crest;
  /** A kick at the posts is in the air: draw them bright. */
  posts?: boolean;
}

export function drawField(g: CanvasRenderingContext2D, v: View, look: Look): void {
  const { w, h, scale, top } = v;
  g.fillStyle = look.ground;
  g.fillRect(0, 0, w, h);
  const fh = FIELD_W * scale;
  g.fillStyle = look.turf;
  g.fillRect(ax(v, 0), top, 100 * scale, fh);
  g.fillStyle = look.turfEnd;
  g.fillRect(ax(v, -10), top, 10 * scale, fh);
  g.fillRect(ax(v, 100), top, 10 * scale, fh);

  for (let y = 0; y <= 100; y += 5) {
    const x = Math.round(ax(v, y)) + 0.5;
    if (x < -2 || x > w + 2) continue;
    g.strokeStyle = y === 0 || y === 100 ? 'oklch(100% 0 0 / 0.5)' : y % 10 === 0 ? 'oklch(100% 0 0 / 0.26)' : 'oklch(100% 0 0 / 0.13)';
    g.lineWidth = y === 0 || y === 100 ? 2 : 1;
    g.beginPath(); g.moveTo(x, top); g.lineTo(x, top + fh); g.stroke();
  }
  // Hash marks, one a yard, at the real distance in from each sideline; and
  // the short ticks along the sidelines a real field has too.
  const tick = Math.max(3, scale * 0.6);
  g.strokeStyle = 'oklch(100% 0 0 / 0.22)';
  g.lineWidth = 1;
  g.beginPath();
  for (let y = 1; y < 100; y++) {
    if (y % 5 === 0) continue;
    const x = Math.round(ax(v, y)) + 0.5;
    if (x < 0 || x > w) continue;
    for (const hy of [HASH, -HASH]) {
      const sy = top + (HALF_WIDTH - hy) * scale;
      g.moveTo(x, sy - tick / 2); g.lineTo(x, sy + tick / 2);
    }
    g.moveTo(x, top + 1); g.lineTo(x, top + 1 + tick);
    g.moveTo(x, top + fh - 1); g.lineTo(x, top + fh - 1 - tick);
  }
  g.stroke();
  g.strokeStyle = 'oklch(100% 0 0 / 0.3)';
  g.strokeRect(Math.round(ax(v, -10)) + 0.5, Math.round(top) + 0.5, Math.round(120 * scale) - 1, Math.round(fh) - 1);

  // Numbers, nine yards in from each sideline as a real field's are — upright,
  // as the replay has them, because this is read from one side only.
  const size = clamp(scale * 2, 10, 34);
  g.font = `500 ${size}px ${look.mono}, monospace`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = 'oklch(100% 0 0 / 0.28)';
  for (let y = 10; y <= 90; y += 10) {
    const x = ax(v, y);
    if (x < -40 || x > w + 40) continue;
    const label = String(y <= 50 ? y : 100 - y);
    g.fillText(label, x, top + 9 * scale);
    g.fillText(label, x, top + fh - 9 * scale);
  }

  // The goal posts, seen from above: the crossbar on each end line, as
  // wide as the hashes are apart, with the two uprights at its ends.
  for (const X of [-10, 110]) {
    const x = ax(v, X);
    if (x < -10 || x > w + 10) continue;
    const y1 = top + (HALF_WIDTH - HASH) * scale, y2 = top + (HALF_WIDTH + HASH) * scale;
    g.strokeStyle = look.posts ? 'oklch(88% 0.17 95)' : 'oklch(80% 0.12 95 / 0.55)';
    g.lineWidth = look.posts ? 3 : 2;
    g.beginPath(); g.moveTo(x, y1); g.lineTo(x, y2); g.stroke();
    g.fillStyle = g.strokeStyle;
    for (const y of [y1, y2]) { g.beginPath(); g.arc(x, y, look.posts ? 3 : 2, 0, Math.PI * 2); g.fill(); }
  }

  for (const [c, at] of [[look.left, -5], [look.right, 105]] as const) {
    if (!c) continue;
    const ex = ax(v, at);
    if (ex < -10 * scale || ex > w + 10 * scale) continue;
    const [ix, iy, iw, ih] = c.ink;
    let across = 10 * scale * 0.68, along = across * (iw / ih);
    if (along > fh * 0.5) { along = fh * 0.5; across = along * (ih / iw); }
    g.save();
    g.globalAlpha = 0.38;
    g.translate(ex, top + fh / 2);
    g.rotate(at < 50 ? -Math.PI / 2 : Math.PI / 2);
    g.drawImage(c.img, ix, iy, iw, ih, -along / 2, -across / 2, along, across);
    g.restore();
  }
}

/** The line of scrimmage, and the line to gain where there is one short of
 *  the goal line. */
export function drawLines(g: CanvasRenderingContext2D, v: View, togo: number, los: number, gold: string): void {
  drawLinesAt(g, v, v.losAbs, los + togo < 100 ? v.losAbs + v.dir * togo : null, gold);
}
/** The two lines at field yards of their own — for the moment between plays
 *  when they are on the move — the line to gain as faint as `fdAlpha` says
 *  while it comes or goes. */
export function drawLinesAt(g: CanvasRenderingContext2D, v: View, losX: number, fdX: number | null, gold: string, fdAlpha = 1): void {
  const fh = FIELD_W * v.scale;
  const x = ax(v, losX);
  g.strokeStyle = 'oklch(72% 0.12 245 / 0.85)';
  g.lineWidth = 2;
  g.beginPath(); g.moveTo(x, v.top); g.lineTo(x, v.top + fh); g.stroke();
  if (fdX !== null && fdAlpha > 0) {
    const fx = ax(v, fdX);
    g.strokeStyle = gold;
    g.globalAlpha = 0.85 * fdAlpha;
    g.beginPath(); g.moveTo(fx, v.top); g.lineTo(fx, v.top + fh); g.stroke();
    g.globalAlpha = 1;
  }
}

export interface Dot {
  at: Spot; no: number | string; pos: string;
  /** Which side he is on, which decides where his position is written: behind
   *  him, away from the line, where there is room — under him, on the line,
   *  is where the next man is. */
  side: 'off' | 'def';
  fill: string; ink: string; edge: string;
  selected?: boolean; dim?: boolean; down?: boolean; hover?: boolean;
}

/** The radius of a player's dot, in pixels — a yard and a bit across at
 *  most, so the line's five men, a yard and a half apart, stay five. */
export const dotR = (v: View) => clamp(v.scale * 0.72, 8, 17);

export function drawDot(g: CanvasRenderingContext2D, v: View, d: Dot, look: Look): void {
  const p = toScreen(v, d.at);
  const r = dotR(v);
  g.save();
  if (d.dim) g.globalAlpha = 0.45;
  if (d.down) {
    // On the ground: the dot laid flat.
    g.translate(p.x, p.y); g.scale(1.25, 0.72); g.translate(-p.x, -p.y);
  }
  g.beginPath(); g.arc(p.x, p.y, r, 0, Math.PI * 2);
  g.fillStyle = d.fill; g.fill();
  g.lineWidth = d.selected ? 2.5 : 1.5;
  g.strokeStyle = d.selected ? 'oklch(84% 0.19 80.46)' : d.edge;
  g.stroke();
  if (d.hover && !d.selected) {
    g.beginPath(); g.arc(p.x, p.y, r + 3, 0, Math.PI * 2);
    g.strokeStyle = 'oklch(100% 0 0 / 0.5)'; g.lineWidth = 1; g.stroke();
  }
  g.fillStyle = d.ink;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  const n = String(d.no);
  g.font = `700 ${Math.round(r * (n.length > 1 ? 0.92 : 1.05))}px ${look.sans}, sans-serif`;
  g.fillText(n, p.x, p.y + r * 0.04);
  g.restore();
  if (!d.down) {
    g.save();
    if (d.dim) g.globalAlpha = 0.45;
    g.font = `600 ${Math.round(clamp(r * 0.7, 8, 11))}px ${look.sans}, sans-serif`;
    const back = (d.side === 'off' ? -1 : 1) * v.dir;     // screen direction away from the line
    g.textAlign = back < 0 ? 'right' : 'left'; g.textBaseline = 'middle';
    g.fillStyle = 'oklch(100% 0 0 / 0.72)';
    g.fillText(d.pos, p.x + back * (r + 3), p.y + 0.5);
    g.restore();
  }
}

export function drawBall(g: CanvasRenderingContext2D, v: View, at: Spot, height: number): void {
  const p = toScreen(v, at);
  const r = clamp(v.scale * 0.32, 3.5, 7);
  if (height > 0.2) {
    g.fillStyle = 'oklch(0% 0 0 / 0.35)';
    g.beginPath(); g.ellipse(p.x, p.y, r, r * 0.6, 0, 0, Math.PI * 2); g.fill();
  }
  const lift = height * v.scale * 0.55;
  const s = 1 + Math.min(0.6, height * 0.06);
  g.save();
  g.translate(p.x, p.y - lift);
  g.rotate(v.dir === 1 ? 0 : Math.PI);
  g.fillStyle = 'oklch(52% 0.11 50)';
  g.strokeStyle = 'oklch(96% 0 0)';
  g.lineWidth = 1;
  g.beginPath(); g.ellipse(0, 0, r * 1.5 * s, r * s, 0, 0, Math.PI * 2); g.fill(); g.stroke();
  g.beginPath(); g.moveTo(-r * 0.5 * s, 0); g.lineTo(r * 0.5 * s, 0); g.stroke();
  g.restore();
}

/** A route as it will be run, with its arrowhead, and the read number at
 *  its end when it has one. */
export function drawRoute(g: CanvasRenderingContext2D, v: View, pts: Spot[], colour: string, read: number | null, look: Look, faint = false): void {
  if (pts.length < 2) return;
  const sp = pts.map((p) => toScreen(v, p));
  g.save();
  g.strokeStyle = colour;
  g.globalAlpha = faint ? 0.4 : 0.92;
  g.lineWidth = faint ? 1.5 : 2.5;
  g.lineJoin = 'round'; g.lineCap = 'round';
  g.beginPath();
  sp.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
  g.stroke();
  // The head points along the route's last real stretch: the last point
  // far enough back from the end to give a direction. Taken from the last
  // two points, a route that settles (a hitch, a screen) has two the same,
  // and the arrow pointed anywhere.
  const b = sp[sp.length - 1]!;
  let a = sp[0]!;
  for (let i = sp.length - 2; i >= 0; i--) if (Math.hypot(sp[i]!.x - b.x, sp[i]!.y - b.y) >= 6) { a = sp[i]!; break; }
  const ang = Math.atan2(b.y - a.y, b.x - a.x), ah = clamp(v.scale * 0.7, 6, 11);
  g.fillStyle = colour;
  g.beginPath();
  g.moveTo(b.x, b.y);
  g.lineTo(b.x - ah * Math.cos(ang - 0.45), b.y - ah * Math.sin(ang - 0.45));
  g.lineTo(b.x - ah * Math.cos(ang + 0.45), b.y - ah * Math.sin(ang + 0.45));
  g.closePath(); g.fill();
  if (read !== null) {
    const r = clamp(v.scale * 0.55, 7, 11);
    const c = { x: b.x + Math.cos(ang) * (r + 4), y: b.y + Math.sin(ang) * (r + 4) };
    g.globalAlpha = 1;
    g.fillStyle = 'oklch(84% 0.19 80.46)';
    g.beginPath(); g.arc(c.x, c.y, r, 0, Math.PI * 2); g.fill();
    g.fillStyle = 'oklch(20% 0 0)';
    g.font = `700 ${Math.round(r * 1.2)}px ${look.sans}, sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(String(read), c.x, c.y + 0.5);
  }
  g.restore();
}

/** A blocker's job: a short bar in front of him. */
export function drawBlock(g: CanvasRenderingContext2D, v: View, at: Spot, colour: string): void {
  const p = toScreen(v, at), q = toScreen(v, { x: at.x + 1.4, y: at.y });
  const r = dotR(v);
  const dx = q.x - p.x, dy = q.y - p.y, len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len;
  const s = { x: p.x + ux * (r + 3), y: p.y + uy * (r + 3) };
  const e = { x: p.x + ux * (r + 10), y: p.y + uy * (r + 10) };
  g.save();
  g.strokeStyle = colour; g.globalAlpha = 0.8; g.lineWidth = 2.5; g.lineCap = 'round';
  g.beginPath(); g.moveTo(s.x, s.y); g.lineTo(e.x, e.y);
  g.moveTo(e.x - uy * 6, e.y + ux * 6); g.lineTo(e.x + uy * 6, e.y - ux * 6);
  g.stroke();
  g.restore();
}

/** A run's path: the back to the hole and on. */
export function drawRunPath(g: CanvasRenderingContext2D, v: View, pts: Spot[], colour: string, look: Look): void {
  drawRoute(g, v, pts, colour, null, look);
}

export function drawZone(g: CanvasRenderingContext2D, v: View, from: Spot, zone: Zone, centre: Spot, fill: string, line: string, look: Look): void {
  const c = toScreen(v, centre), p = toScreen(v, from);
  const r = LANDMARK[zone].r * v.scale * 0.8;
  g.save();
  g.fillStyle = fill; g.globalAlpha = 0.14;
  g.beginPath(); g.ellipse(c.x, c.y, r, r * 0.8, 0, 0, Math.PI * 2); g.fill();
  g.globalAlpha = 0.8; g.strokeStyle = line; g.lineWidth = 1.4;
  g.setLineDash([5, 4]); g.stroke();
  g.beginPath(); g.moveTo(p.x, p.y); g.lineTo(c.x, c.y); g.stroke();
  g.setLineDash([]);
  g.globalAlpha = 0.85; g.fillStyle = 'oklch(100% 0 0 / 0.85)';
  g.font = `600 ${Math.round(clamp(v.scale * 0.6, 9, 12))}px ${look.sans}, sans-serif`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  // Written at the zone's far edge, clear of whoever is standing in it.
  g.fillText(LANDMARK[zone].label, c.x, c.y - r * 0.8 + 9);
  g.restore();
}

export function drawMan(g: CanvasRenderingContext2D, v: View, from: Spot, to: Spot, colour: string): void {
  const p = toScreen(v, from), q = toScreen(v, to);
  g.save();
  g.strokeStyle = colour; g.globalAlpha = 0.75; g.lineWidth = 1.6;
  g.setLineDash([3, 4]);
  g.beginPath(); g.moveTo(p.x, p.y); g.lineTo(q.x, q.y); g.stroke();
  g.restore();
}

export function drawRush(g: CanvasRenderingContext2D, v: View, from: Spot, to: Spot, colour: string): void {
  const p = toScreen(v, from), q0 = toScreen(v, to);
  const d = Math.hypot(q0.x - p.x, q0.y - p.y) || 1;
  const stop = Math.max(0, d - dotR(v) * 1.6);
  const q = { x: p.x + (q0.x - p.x) * (stop / d), y: p.y + (q0.y - p.y) * (stop / d) };
  const ang = Math.atan2(q.y - p.y, q.x - p.x);
  g.save();
  g.strokeStyle = colour; g.fillStyle = colour; g.globalAlpha = 0.8; g.lineWidth = 2;
  g.beginPath(); g.moveTo(p.x, p.y); g.lineTo(q.x, q.y); g.stroke();
  g.beginPath(); g.moveTo(q.x, q.y);
  g.lineTo(q.x - 8 * Math.cos(ang - 0.5), q.y - 8 * Math.sin(ang - 0.5));
  g.lineTo(q.x - 8 * Math.cos(ang + 0.5), q.y - 8 * Math.sin(ang + 0.5));
  g.closePath(); g.fill();
  g.restore();
}

/** The part of a crest's image that has a mark on it — as the replay does,
 *  so a tall crest and a wide one come out the same size. */
export function inkOf(img: HTMLImageElement): [number, number, number, number] {
  const w = img.naturalWidth, h = img.naturalHeight;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true });
  if (!g) return [0, 0, w, h];
  g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, w, h).data;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (d[(y * w + x) * 4 + 3]! > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  return x1 < 0 ? [0, 0, w, h] : [x0, y0, x1 - x0 + 1, y1 - y0 + 1];
}
