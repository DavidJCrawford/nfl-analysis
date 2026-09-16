const MONTHS = ['January','February','March','April','May','June',
                'July','August','September','October','November','December'];

/** Dates are rendered from the stored string, never parsed through a local
 *  timezone — that is how a schedule becomes subtly wrong. */
export function longDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

export const shortDate = (iso: string): string => {
  const [y, m, d] = iso.split('-').map(Number);
  return y && m && d ? `${d} ${MONTHS[m - 1]!.slice(0, 3)} ${y}` : iso;
};

export const km = (v: number | null): string => (v == null ? '—' : `${v.toFixed(3)} km`);
export const int = (v: number | null): string => (v == null ? '—' : v.toLocaleString('en-GB'));
export const pts = (v: number | null): string =>
  v == null ? '—' : Number.isInteger(v) ? String(v) : v.toFixed(1);

/** An em dash, not a zero. A missing value is not the number nought. */
export const dash = <T>(v: T | null | undefined, f: (x: T) => string): string =>
  v == null ? '—' : f(v);

/** F1DB ships these as raw enums — ANTI_CLOCKWISE, RACE — which are storage
 *  values, not display values. */
export const sentence = (v: string | null | undefined): string =>
  v ? v.toLowerCase().replace(/_/g, '-').replace(/^./, (c) => c.toUpperCase()) : '—';

/** "Race" alone reads oddly beside "Street" and "Road"; the conventional term
 *  for a purpose-built circuit is permanent. */
const CIRCUIT_TYPE: Record<string, string> = {
  RACE: 'Permanent', STREET: 'Street', ROAD: 'Road',
};
export const circuitType = (v: string | null | undefined): string =>
  (v && CIRCUIT_TYPE[v]) ?? sentence(v);

/** A circuit that has held one season should not read "2026–2026". */
export const yearSpan = (a: number | null, b: number | null): string =>
  a == null || b == null ? '—' : a === b ? String(a) : `${a}–${b}`;
