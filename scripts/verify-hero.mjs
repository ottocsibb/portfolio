// Verifica dell'hero animato con Playwright.
// Uso: npm run build && npm run verify:hero   (screenshot in .verify/hero/)
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';

// Playwright è preinstallato globalmente nell'ambiente, non è una dipendenza del progetto.
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH ?? 'playwright');

const PORT = 4180;
const URL = `http://localhost:${PORT}/portfolio/`;
const OUT = '.verify/hero';
const SHOTS = [1000, 3000, 4500, 6500, 9000];

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900, isMobile: false },
  { name: 'mobile', width: 390, height: 844, isMobile: true },
];

const failures = [];
function check(ok, msg) {
  console.log(`${ok ? '  ✓' : '  ✗'} ${msg}`);
  if (!ok) failures.push(msg);
}

async function waitForServer() {
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(URL)).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('vite preview non risponde');
}

// Conta i frame richiesti dalla pagina e segna l'istante del primo: è l'inizio della timeline dell'hero.
const INSTRUMENT = () => {
  window.__raf = 0;
  window.__t0 = 0;
  const orig = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) => {
    if (!window.__t0) window.__t0 = performance.now();
    return orig((t) => {
      window.__raf++;
      cb(t);
    });
  };
};

const heroTime = (page) => page.evaluate(() => Math.round(performance.now() - window.__t0));
const waitHeroTime = (page, ms) =>
  page.waitForFunction((t) => window.__t0 && performance.now() - window.__t0 >= t, ms, { polling: 10 });
const heroState = (page) => page.getAttribute('#top', 'data-hero-state');
async function framesIn(page, ms) {
  const a = await page.evaluate(() => window.__raf);
  await page.waitForTimeout(ms);
  return (await page.evaluate(() => window.__raf)) - a;
}

/** Analisi dei pixel del canvas: riquadro di ciò che è disegnato, pixel arancioni ed evidenziatore. */
function analyse(page) {
  return page.evaluate(() => {
    const cv = document.querySelector('[data-hero-fx] canvas');
    const g = cv.getContext('2d');
    const { width: w, height: h } = cv;
    const d = g.getImageData(0, 0, w, h).data;
    const k = w / cv.clientWidth;
    let any = [w, h, -1, -1];
    let org = [w, h, -1, -1];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        if (d[i + 3] < 20) continue;
        any = [Math.min(any[0], x), Math.min(any[1], y), Math.max(any[2], x), Math.max(any[3], y)];
        if (d[i] > 220 && d[i + 1] > 90 && d[i + 1] < 125 && d[i + 2] < 50) {
          org = [Math.min(org[0], x), Math.min(org[1], y), Math.max(org[2], x), Math.max(org[3], y)];
        }
      }
    }
    const css = (b) => (b[2] < 0 ? null : b.map((v) => Math.round(v / k)));
    const word = document.querySelector('[data-hero-word]').getBoundingClientRect();
    const stage = document.querySelector('#top').getBoundingClientRect();
    const wr = { x: word.left - stage.left, y: word.top - stage.top, w: word.width, h: word.height };
    // Evidenziatore: angoli esterni vuoti, interno pieno (nessuna tacca o fessura tra i pezzi).
    const alpha = (x, y) => d[(Math.round(y * k) * w + Math.round(x * k)) * 4 + 3];
    const o = css(org) ?? [0, 0, 0, 0];
    const corners = [
      alpha(o[0] + 1.5, o[1] + 1.5), alpha(o[2] - 1.5, o[1] + 1.5),
      alpha(o[0] + 1.5, o[3] - 1.5), alpha(o[2] - 1.5, o[3] - 1.5),
    ];
    // Un solo colore dentro l'evidenziatore: nessuna righina tra un pezzo e l'altro.
    const tones = new Set();
    for (let x = wr.x + 2; x < wr.x + wr.w - 2; x += 0.5) {
      const i = (Math.round((wr.y + wr.h / 2) * k) * w + Math.round(x * k)) * 4;
      tones.add(`${d[i]},${d[i + 1]},${d[i + 2]}`);
    }
    let holes = 0;
    for (let y = wr.y + 2; y < wr.y + wr.h - 2; y += 0.5) {
      for (let x = wr.x + 15; x < wr.x + wr.w - 15; x += 0.5) if (alpha(x, y) < 250) holes++;
    }
    for (let y = wr.y + 15; y < wr.y + wr.h - 15; y += 0.5) {
      for (let x = wr.x + 2; x < wr.x + wr.w - 2; x += 0.5) if (alpha(x, y) < 250) holes++;
    }
    return { size: [cv.clientWidth, cv.clientHeight], any: css(any), orange: css(org), wr, corners, holes, tones: tones.size };
  });
}

async function timeline(browser, vp) {
  console.log(`\n${vp.name}`);
  const ctx = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: vp.isMobile ? 2 : 1,
    isMobile: vp.isMobile,
    hasTouch: vp.isMobile,
  });
  await ctx.addInitScript(INSTRUMENT);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(URL);

  const inBounds = (b, size) => b && b[0] >= 0 && b[1] >= 0 && b[2] <= size[0] && b[3] <= size[1];
  for (const t of SHOTS) {
    await waitHeroTime(page, t);
    const real = await heroTime(page);
    await page.screenshot({ path: `${OUT}/${vp.name}-${String(t / 1000).replace('.', ',')}s.png` });
    const a = await analyse(page);
    check(inBounds(a.any, a.size) && a.any[0] > 0 && a.any[2] < a.size[0] - 1, `${t / 1000}s (reale ${real}ms): pezzi dentro l'hero, riquadro ${a.any?.join(',')} su ${a.size.join('×')}`);
  }

  const end = await analyse(page);
  const near = (a, b) => Math.abs(a - b) <= 2;
  check(
    end.orange && near(end.orange[0], end.wr.x) && near(end.orange[1], end.wr.y) && near(end.orange[2], end.wr.x + end.wr.w) && near(end.orange[3], end.wr.y + end.wr.h),
    `evidenziatore esattamente dietro "soluzione" (arancio ${end.orange?.join(',')} · parola ${[end.wr.x, end.wr.y, end.wr.x + end.wr.w, end.wr.y + end.wr.h].map(Math.round).join(',')})`,
  );
  check(end.corners.every((c) => c < 60), `angoli esterni arrotondati (alpha agli angoli ${end.corners.join(', ')})`);
  check(end.holes === 0 && end.tones === 1, `nessuna tacca o fessura nell'evidenziatore (${end.holes} punti vuoti, ${end.tones} tonalità)`);

  const texts = await page.$$eval('[data-hero-step]', (els) => els.filter((e) => getComputedStyle(e).opacity !== '1').length);
  check(texts === 0, 'a 9 s tutti i testi dell\'hero sono entrati');

  await page.waitForTimeout(800);
  const idleFrames = await framesIn(page, 1000);
  check((await heroState(page)) === 'idle' && idleFrames === 0, `a scena finita il ciclo è fermo (stato ${await heroState(page)}, ${idleFrames} frame in 1 s)`);

  if (!vp.isMobile) {
    const w = end.wr;
    await page.mouse.move(w.x + w.w / 2, w.y + 82 + w.h / 2);
    await page.waitForTimeout(150);
    const pushState = await heroState(page);
    await page.screenshot({ path: `${OUT}/${vp.name}-mouse.png` });
    const pushed = await analyse(page);
    check(pushState === 'running' && pushed.holes > 0, 'il mouse spinge i pezzi anche ad animazione finita');
    await page.mouse.move(5, vp.height - 5);
    await page.mouse.move(5, 5);
    await page.waitForTimeout(2000);
    const back = await analyse(page);
    check((await heroState(page)) === 'idle' && back.holes === 0, 'i pezzi tornano al loro posto e il ciclo si ferma di nuovo');
  }

  // Rivedi: tutto da capo.
  await page.click('[data-hero-replay]');
  await page.waitForTimeout(300);
  const restart = await page.evaluate(() => ({
    w2: document.querySelector('[data-hero-step="w2"]').classList.contains('is-in'),
    r3: document.querySelector('[data-hero-step="r3"]').classList.contains('is-in'),
  }));
  const after = await analyse(page);
  check((await heroState(page)) === 'running' && !restart.w2 && !restart.r3 && !after.orange, '"Rivedi" fa ripartire tutto da capo');

  // Fuori schermo il ciclo si ferma, e la scena riprende da dove era al ritorno.
  await page.waitForTimeout(700);
  await page.evaluate(() => window.scrollTo(0, document.querySelector('#percorso').offsetTop));
  await page.waitForTimeout(300);
  const offFrames = await framesIn(page, 800);
  check((await heroState(page)) === 'paused' && offFrames === 0, `hero fuori schermo: ciclo fermo (${offFrames} frame)`);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);
  check((await heroState(page)) === 'running', 'di nuovo sullo schermo: la scena riprende');

  // Scheda non attiva.
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForTimeout(200);
  const hiddenFrames = await framesIn(page, 800);
  check((await heroState(page)) === 'paused' && hiddenFrames === 0, `scheda non attiva: ciclo fermo (${hiddenFrames} frame)`);

  check(errors.length === 0, `nessun errore in console${errors.length ? ': ' + errors.join(' | ') : ''}`);
  await ctx.close();
}

async function reduced(browser, vp) {
  console.log(`\n${vp.name}-reduce`);
  const ctx = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: vp.isMobile ? 2 : 1,
    isMobile: vp.isMobile,
    hasTouch: vp.isMobile,
    reducedMotion: 'reduce',
  });
  await ctx.addInitScript(INSTRUMENT);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: `${OUT}/${vp.name}-riduci-movimento.png` });
  const s = await page.evaluate(() => {
    const w = getComputedStyle(document.querySelector('[data-hero-word]'));
    return {
      bg: w.backgroundColor,
      radius: w.borderRadius,
      canvas: !!document.querySelector('[data-hero-fx] canvas'),
      hidden: [...document.querySelectorAll('[data-hero-step]')].filter((e) => getComputedStyle(e).opacity !== '1').length,
    };
  });
  check(s.bg === 'rgb(242, 106, 27)' && s.radius === '14px', `evidenziatore arancione dietro "soluzione", angoli 14px (${s.bg}, ${s.radius})`);
  check(!s.canvas && s.hidden === 0, 'tutto già composto: nessun canvas, tutti i testi visibili');
  const frames = await framesIn(page, 1000);
  check(frames === 0, `nessuna animazione (${frames} frame in 1 s)`);
  check(errors.length === 0, 'nessun errore in console');
  await ctx.close();
}

await mkdir(OUT, { recursive: true });
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
try {
  await waitForServer();
  const browser = await chromium.launch();
  for (const vp of VIEWPORTS) {
    await timeline(browser, vp);
    await reduced(browser, vp);
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
