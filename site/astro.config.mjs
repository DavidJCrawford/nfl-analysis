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
  build: { format: 'directory' },
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
