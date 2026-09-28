/** How the ground and the weather are written down, in one place, because
 *  the game page and the replay both say them. */
import type { Venue } from './types';

/** Turf names are brands and are spelt as their makers spell them. */
const SURFACE: Record<string, string> = {
  grass: 'Grass', fieldturf: 'FieldTurf', matrixturf: 'MatrixTurf',
  astroturf: 'AstroTurf', sportturf: 'SportTurf', a_turf: 'A-Turf', dessograss: 'DessoGrass',
};
export const surface = (v: Venue): string | null =>
  v.surface ? (SURFACE[v.surface] ?? v.surface[0]!.toUpperCase() + v.surface.slice(1)) : null;

export const roof = (v: Venue): string =>
  v.roof === 'dome' ? 'Dome' : v.roof === 'closed' ? 'Roof closed'
    : v.roof === 'open' ? 'Roof open' : 'Open air';

/** "7 mph from the SE", or "Calm". "From", always: a weather report names a
 *  wind by where it comes from, and a bare "SE" beside a number is read as
 *  often one way as the other. */
export const wind = (v: Venue): string | null => {
  if (v.wind == null) return null;
  if (v.wind === 0) return 'Calm';
  return v.wind_from ? `${v.wind} mph from the ${v.wind_from}` : `${v.wind} mph`;
};

const ORD = ['', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth'];
export const ordinal = (n: number): string => ORD[n] ?? `${n}${[, 'st', 'nd', 'rd'][n % 100 > 10 && n % 100 < 14 ? 0 : n % 10] ?? 'th'}`;
const WORDS = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
export const counted = (n: number): string => WORDS[n] ?? String(n);
