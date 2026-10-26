// Genera una volta le immagini statiche in public/: favicon (SVG, PNG 32×32, apple-touch-icon 180×180)
// e l'immagine di anteprima Open Graph 1200×630. Usa i font locali di node_modules, niente rete.
// Uso: npm run make:assets
import { writeFile, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH ?? 'playwright');

const C = { page: '#EEF1F6', night: '#14213D', blue: '#2C3E66', gray: '#A3ADBF', accent: '#F26A1B', text2: '#4A5672', problem: '#6B7894', accentDark: '#B4470C' };

// Logo a 4 cubetti 2×2, come nell'header: grigio, blu, blu notte, arancione.
const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <rect x="0" y="0" width="14" height="14" rx="3" fill="${C.gray}"/>
  <rect x="18" y="0" width="14" height="14" rx="3" fill="${C.blue}"/>
  <rect x="0" y="18" width="14" height="14" rx="3" fill="${C.night}"/>
  <rect x="18" y="18" width="14" height="14" rx="3" fill="${C.accent}"/>
</svg>
`;

// Font incorporati come dati: una pagina creata con setContent non può leggere file locali.
const font = (pkg, file) => `data:font/woff2;base64,${readFileSync(require.resolve(`@fontsource-variable/${pkg}/files/${file}`)).toString('base64')}`;
const FONTS = `
@font-face { font-family: 'Bricolage'; font-weight: 200 800; src: url(${font('bricolage-grotesque', 'bricolage-grotesque-latin-opsz-normal.woff2')}) format('woff2-variations'); }
@font-face { font-family: 'Inter'; font-weight: 100 900; src: url(${font('inter', 'inter-latin-wght-normal.woff2')}) format('woff2-variations'); }
`;

// Anteprima: stessi testi, colori e proporzioni dell'hero composto.
const OG_HTML = `<!doctype html><html lang="it"><head><meta charset="utf-8"><style>
${FONTS}
* { box-sizing: border-box; margin: 0; }
body { width: 1200px; height: 630px; background: ${C.page}; color: ${C.night}; font-family: Inter, sans-serif;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 26px; text-align: center; }
.who { display: flex; align-items: center; gap: 18px; }
.logo { width: 46px; height: 46px; }
.name { font-family: Bricolage, sans-serif; font-weight: 800; font-size: 30px; letter-spacing: -0.01em; }
.roles { font-size: 20px; font-weight: 500; color: ${C.text2}; }
h1 { font-family: Bricolage, sans-serif; font-size: 112px; line-height: 0.98; letter-spacing: -0.05em; font-weight: 800; }
h1 span { display: block; }
.problem { font-weight: 500; color: ${C.problem}; }
.w { display: inline-block; margin: 0 0.12em; }
.word { display: inline-block; padding: 0.02em 0.16em 0.08em; background: ${C.accent}; border-radius: 16px; }
.pitch { font-size: 26px; }
.for { font-size: 17px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: ${C.accentDark}; }
</style></head><body>
  <div class="who"><img class="logo" src="data:image/svg+xml;base64,${Buffer.from(LOGO_SVG).toString('base64')}" alt=""><span class="name">Mariano De Magistris</span><span class="roles">Team leader · Analista funzionale · Developer</span></div>
  <h1><span class="problem"><span class="w">Dal</span><span class="w">problema</span></span><span><span class="w">alla</span><span style="display:inline-block;white-space:nowrap;margin-left:0.04em"><span class="word">soluzione</span>.</span></span></h1>
  <p class="pitch">Prendo problemi complessi, li scompongo, creo soluzioni.</p>
  <p class="for">Per aziende e progetti privati</p>
</body></html>`;

const iconHtml = (size, bg, pad) => `<!doctype html><html><body style="margin:0;width:${size}px;height:${size}px;background:${bg};display:flex;align-items:center;justify-content:center">
<img src="data:image/svg+xml;base64,${Buffer.from(LOGO_SVG).toString('base64')}" style="width:${size - 2 * pad}px;height:${size - 2 * pad}px"></body></html>`;

await writeFile('public/favicon.svg', LOGO_SVG);
const browser = await chromium.launch();
const shot = async (html, w, h, path, transparent = false) => {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  await page.setContent(html, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  const missing = await page.evaluate(() => [...document.fonts].filter((f) => f.status !== 'loaded').map((f) => f.family));
  if (missing.length) throw new Error(`Font non caricati: ${missing.join(', ')}`);
  await page.screenshot({ path, omitBackground: transparent });
  await page.close();
};
await shot(iconHtml(32, 'transparent', 0), 32, 32, 'public/favicon-32.png', true);
// iOS riempie la trasparenza di nero: l'icona per la schermata Home ha lo sfondo della pagina.
await shot(iconHtml(180, C.page, 36), 180, 180, 'public/apple-touch-icon.png');
await shot(OG_HTML, 1200, 630, 'public/og.png');
await browser.close();

const kb = (await stat('public/og.png')).size / 1024;
console.log(`public/og.png: ${kb.toFixed(1)} KB`);
if (kb >= 300) throw new Error('og.png supera i 300 KB: WhatsApp potrebbe non mostrarla');
