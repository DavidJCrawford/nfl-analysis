/** Join a site-root-relative path onto Astro's configured base.
 *  Astro does not prefix <a href> automatically; a project site served from
 *  /f1-analysis/ breaks silently without this. */
const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');
export const u = (path: string): string => `${BASE}/${path.replace(/^\//, '')}`;
