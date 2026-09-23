// @ts-check
import { defineConfig, fontProviders } from 'astro/config';
import { fileURLToPath } from 'node:url';

/** Absolute path to the emitted data, injected at build time. `import.meta.url`
 *  cannot be used inside src/lib: after bundling it points at the output chunk,
 *  not the source file. */
const DATA_DIR = fileURLToPath(new URL('./data/', import.meta.url));

/**
 * Project site served from https://<user>.github.io/nfl-analysis/, so `base`
 * must be set. If a custom domain is configured later, set BASE_PATH=/ — the
 * GitHub Actions workflow passes the value that actions/configure-pages
 * reports, so this is not hand-maintained.
 */
const base = process.env.BASE_PATH ?? '/nfl-analysis';

export default defineConfig({
  site: 'https://davidjcrawford.github.io',
  base,
  trailingSlash: 'always',
  /* Astro's HTML compression deletes a newline between running text and an
     inline element outright, rather than collapsing it to the space HTML says
     it is — so "comes from\n<a>nflverse-data</a>" was published as "comes
     fromnflverse-data". The bug is invisible in the source and only appears in
     the build, which is no way to run a site that is mostly prose. Keeping the
     whitespace costs 33K gzipped across all 308 pages, around 107 bytes each. */
  compressHTML: false,
  build: { format: 'directory' },

  /* The dev server takes whatever port it is handed. Astro reads `--port` and
     this config but not the PORT environment variable, so a harness that
     assigns a free port has no way to say so without it — and the launch
     config was pinned to 4331 instead, which collides with any dev server
     still running from an earlier session. One did: six days old, and exactly
     the stale-serving process HANDOFF §4 is about. */
  server: { port: Number(process.env.PORT) || 4331 },
  prefetch: { prefetchAll: true, defaultStrategy: 'hover' },
  devToolbar: { enabled: false },

  vite: { define: { __DATA_DIR__: JSON.stringify(DATA_DIR) } },

  // Self-hosted, subset and preloaded. No third-party font request, no FOUT.
  fonts: [
    {
      provider: fontProviders.google(),
      name: 'Albert Sans',
      cssVariable: '--ks-font',
      weights: [400, 500, 600, 700],
      styles: ['normal'],
      subsets: ['latin'],
      fallbacks: ['Avenir Next', 'Helvetica Neue', 'Arial', 'system-ui', 'sans-serif'],
    },
    {
      provider: fontProviders.google(),
      name: 'Alumni Sans',
      cssVariable: '--ks-font-display',
      weights: [200, 300],
      styles: ['normal'],
      subsets: ['latin'],
      fallbacks: ['Albert Sans', 'Arial', 'sans-serif'],
    },
    {
      provider: fontProviders.google(),
      name: 'JetBrains Mono',
      cssVariable: '--ks-mono',
      weights: [400, 500],
      styles: ['normal'],
      subsets: ['latin'],
      fallbacks: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
    },
  ],
});
