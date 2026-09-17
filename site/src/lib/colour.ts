/** Club colours, and the two questions the interface keeps asking about them.
 *
 *  Both are here rather than in whichever component asked first: the scorebug,
 *  the jersey numbers on the replay's badges and the penalty card all need the
 *  same answers, and they should not be answered three times. */

/** Relative luminance, 0 (black) to 1 (white). */
export function luminance(hex: string): number {
  const h = hex.replace('#', '');
  if (h.length !== 6) return 1;
  const lin = (v: number) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const [r, g, b] = [0, 2, 4].map((i) => lin(parseInt(h.slice(i, i + 2), 16) / 255));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

/** Whether a club colour needs black or white on top of it.
 *
 *  Half the league's primaries are near-black and a couple are bright gold, so
 *  one fixed choice would make some jersey numbers unreadable. */
export const readableOn = (hex: string): string =>
  (luminance(hex) > 0.42 ? '#12100e' : '#fff');

/** The club colour that will actually show as a band on a dark panel.
 *
 *  A good part of the league's primaries are near-black — New England and
 *  Seattle are both #002244 — and on the instrument panel they read as a seam
 *  rather than a colour. Where the primary is too dark to see, the club's own
 *  secondary is used instead; both belong to the club, so nothing is invented. */
export const bandColour = (primary: string, secondary: string): string =>
  (luminance(primary) > 0.045 ? primary : secondary || primary);
