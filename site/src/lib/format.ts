const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
                'July', 'August', 'September', 'October', 'November', 'December'];

const parse = (iso: string): [number, number, number] | null => {
  const [y, m, d] = iso.split('-').map(Number);
  return y && m && d ? [y, m, d] : null;
};

/** Dates are rendered from the stored string, never parsed through a local
 *  timezone — that is how a schedule becomes subtly wrong. A Sunday 13:00
 *  kickoff on the American east coast is Sunday evening in Britain, and a
 *  Date() round trip would quietly move half the season's games a day. */
export function longDate(iso: string): string {
  const p = parse(iso);
  return p ? `${p[2]} ${MONTHS[p[1] - 1]} ${p[0]}` : iso;
}

export const shortDate = (iso: string): string => {
  const p = parse(iso);
  return p ? `${p[2]} ${MONTHS[p[1] - 1]!.slice(0, 3)}` : iso;
};

/** A season crosses the new year — week 18 is January — so the year belongs on
 *  a range that spans it and nowhere else. */
export const dateRange = (a: string, b: string): string => {
  const pa = parse(a), pb = parse(b);
  if (!pa || !pb) return a;
  if (a === b) return shortDate(a);
  if (pa[1] === pb[1]) return `${pa[2]}–${pb[2]} ${MONTHS[pa[1] - 1]!.slice(0, 3)}`;
  return `${shortDate(a)} – ${shortDate(b)}`;
};

export const int = (v: number | null | undefined): string =>
  v == null ? '—' : v.toLocaleString('en-GB');

/** An em dash, not a zero. A missing value is not the number nought. */
export const dash = <T>(v: T | null | undefined, f: (x: T) => string): string =>
  v == null ? '—' : f(v);

/** nflverse ships these as storage values — 'fieldturf', 'no_good'. */
export const sentence = (v: string | null | undefined): string =>
  v ? v.toLowerCase().replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()) : '—';

/** Signed, with a true minus sign rather than a hyphen, and an explicit plus.
 *  Used for margins, EPA and point spreads, where the sign is the whole point. */
export const signed = (v: number | null | undefined, digits = 0): string => {
  if (v == null) return '—';
  if (v === 0) return digits ? (0).toFixed(digits) : '0';
  return `${v > 0 ? '+' : '−'}${Math.abs(v).toFixed(digits)}`;
};

/** A clock as the scoreboard shows it: leading zeros dropped above a minute. */
export const clock = (v: string | null | undefined): string =>
  v ? v.replace(/^0(\d:)/, '$1') : '—';

/** 24-hour kickoff times as published by nflverse, which are US Eastern.
 *  Labelled where shown; not converted, for the same reason as the dates. */
export const kickoff = (v: string | null | undefined): string => v ?? '—';

/** Won–lost, with ties only when there are any. */
export const record = (r: { w: number; l: number; t: number }): string =>
  r.t ? `${r.w}–${r.l}–${r.t}` : `${r.w}–${r.l}`;
