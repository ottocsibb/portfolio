// Verifica della pagina con Playwright: desktop, mobile e "riduci movimento".
// Uso: npm run build && npm run verify   (gli screenshot finiscono in .verify/)
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';

// Playwright è preinstallato globalmente nell'ambiente, non è una dipendenza del progetto.
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH ?? 'playwright');

const PORT = 4179;
const URL = `http://localhost:${PORT}/portfolio/`;
const OUT = '.verify';

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900, isMobile: false, hasTouch: false },
  { name: 'mobile', width: 390, height: 844, isMobile: true, hasTouch: true },
];

const failures = [];
function check(ok, msg) {
  console.log(`${ok ? '  ✓' : '  ✗'} ${msg}`);
  if (!ok) failures.push(msg);
}

async function waitForServer() {
  for (let i = 0; i < 50; i++) {
    try {
      const r = await fetch(URL);
      if (r.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('vite preview non risponde');
}

async function checkPage(page, vp, reduce) {
  const tag = `${vp.name}${reduce ? '-reduce' : ''}`;
  console.log(`\n${tag}`);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(reduce ? 300 : 9000);

  const facts = await page.evaluate(() => ({
    h1: document.querySelectorAll('h1').length,
    lang: document.documentElement.lang,
    overflow: document.documentElement.scrollWidth - window.innerWidth,
    font: getComputedStyle(document.querySelector('h1')).fontFamily,
    fontsLoaded: [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family),
    externalFonts: performance.getEntriesByType('resource').filter((r) => /fonts\.(googleapis|gstatic)/.test(r.name)).length,
  }));
  check(facts.h1 === 1, `un solo h1 (${facts.h1})`);
  check(facts.lang === 'it', 'lang="it"');
  check(facts.overflow <= 0, `nessuno scroll orizzontale (eccesso ${facts.overflow}px)`);
  check(facts.fontsLoaded.some((f) => f.includes('Bricolage')) && facts.fontsLoaded.some((f) => f.includes('Inter')), `font locali caricati (${[...new Set(facts.fontsLoaded)].join(', ')})`);
  check(facts.externalFonts === 0, 'nessuna richiesta a Google Fonts');

  await page.screenshot({ path: `${OUT}/${tag}-hero.png` });
  await page.screenshot({ path: `${OUT}/${tag}-full.png`, fullPage: true });

  // Header: apertura del logo
  if (vp.isMobile) {
    await page.tap('[data-hdr-trigger]');
  } else {
    await page.hover('[data-hdr-trigger]', { position: { x: 12, y: 24 }, force: true });
  }
  await page.waitForTimeout(800);
  const expanded = await page.getAttribute('[data-hdr-trigger]', 'aria-expanded');
  check(expanded === 'true', 'il logo si apre (aria-expanded=true)');
  const sizes = await page.$$eval('[data-hdr-slot]', (els) => els.map((e) => Math.round(e.getBoundingClientRect().width)));
  const want = vp.isMobile ? 44 : 40;
  check(sizes.every((s) => s === want), `mattoncini ${want}×${want} (${sizes.join(', ')})`);
  if (!vp.isMobile) {
    await page.hover('.lg-brick--path');
    await page.waitForTimeout(300);
  }
  await page.screenshot({ path: `${OUT}/${tag}-header-open.png`, clip: { x: 0, y: 0, width: vp.width, height: vp.isMobile ? 320 : 160 } });

  // Tastiera: Esc chiude e il focus torna sul logo
  await page.focus('.lg-brick--case');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(100);
  const afterEsc = await page.evaluate(() => ({
    expanded: document.querySelector('[data-hdr-trigger]').getAttribute('aria-expanded'),
    focusOnTrigger: document.activeElement === document.querySelector('[data-hdr-trigger]'),
  }));
  check(afterEsc.expanded === 'false' && afterEsc.focusOnTrigger, 'Esc chiude e riporta il focus sul logo');

  // Navigazione: il mattoncino "Percorso" porta alla sezione e l'header la mostra
  await page.keyboard.press('Enter');
  await page.waitForTimeout(600);
  const reopened = await page.getAttribute('[data-hdr-trigger]', 'aria-expanded');
  check(reopened === 'true', 'Invio sul logo riapre i mattoncini');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  const focused = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'));
  check(focused === 'Percorso', `Tab raggiunge i mattoncini (focus su "${focused}")`);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1500);
  const cur = await page.textContent('[data-hdr-label]');
  check(cur === 'Percorso', `sezione corrente nell'header: "${cur}"`);

  check(errors.length === 0, `nessun errore in console${errors.length ? ': ' + errors.join(' | ') : ''}`);
}

await mkdir(OUT, { recursive: true });
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
try {
  await waitForServer();
  const browser = await chromium.launch();
  for (const vp of VIEWPORTS) {
    for (const reduce of [false, true]) {
      const ctx = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
        deviceScaleFactor: vp.isMobile ? 2 : 1,
        isMobile: vp.isMobile,
        hasTouch: vp.hasTouch,
        reducedMotion: reduce ? 'reduce' : 'no-preference',
      });
      await checkPage(await ctx.newPage(), vp, reduce);
      await ctx.close();
    }
  }
  await browser.close();
} finally {
  server.kill();
}

if (failures.length) {
  console.log(`\n${failures.length} controlli falliti`);
  process.exit(1);
}
console.log('\nTutti i controlli superati');
