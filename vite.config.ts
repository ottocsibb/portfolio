import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import { SITE_URL } from './site.config';

/**
 * Sostituisce %SITE_URL% nell'HTML (Vite lo fa da solo solo per le variabili d'ambiente %VITE_…%)
 * e fa fallire la build se nell'HTML finale resta un segnaposto %…%.
 */
function siteUrl(): Plugin {
  let outDir = 'dist';
  return {
    name: 'site-url',
    configResolved(c) {
      outDir = resolve(c.root, c.build.outDir);
    },
    transformIndexHtml: {
      order: 'pre',
      handler: (html) => html.replaceAll('%SITE_URL%', SITE_URL),
    },
    closeBundle() {
      const html = readFileSync(resolve(outDir, 'index.html'), 'utf8');
      const left = html.match(/%[A-Z_]+%/g);
      if (left) throw new Error(`Segnaposto non sostituiti in index.html: ${[...new Set(left)].join(', ')}`);
    },
  };
}

export default defineConfig({
  base: '/',
  plugins: [siteUrl()],
});
