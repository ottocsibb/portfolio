// Verifica dei cubi allo scroll e del caso studio con Playwright.
// Uso: npm run build && npm run verify:blocks   (screenshot in .verify/blocks/)
import { spawn } from 'node:child_process';
import { mkdir, readFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';

// Playwright è preinstallato globalmente nell'ambiente, non è una dipendenza del progetto.
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH ?? 'playwright');

const PORT = 4181;
const URL = `http://localhost:${PORT}/portfolio/`;
const OUT = '.verify/blocks';

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

// Strumenti nella pagina: frame richiesti, timer attivi, proprietà cambiate sulle tessere.
const INSTRUMENT = () => {
  window.__raf = 0;
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) => raf((t) => { window.__raf++; cb(t); });
  window.__intervals = new Set();
  const si = window.setInterval.bind(window);
  const ci = window.clearInterval.bind(window);
  window.setInterval = (...a) => { const id = si(...a); window.__intervals.add(id); return id; };
  window.clearInterval = (id) => { window.__intervals.delete(id); ci(id); };
  window.__tileProps = new Set();
  const parse = (css) => new Map((css ?? '').split(';').map((d) => d.split(':')).filter((p) => p.length > 1).map(([k, ...v]) => [k.trim(), v.join(':').trim()]));
  document.addEventListener('DOMContentLoaded', () => {
    new MutationObserver((list) => {
      for (const m of list) {
        if (!m.target.classList?.contains('asm-tile') || !m.target.isConnected) continue;
        const a = parse(m.oldValue), b = parse(m.target.getAttribute('style'));
        // conta solo i valori che cambiano, non le proprietà impostate per la prima volta alla creazione
        for (const k of a.keys()) if (b.has(k) && a.get(k) !== b.get(k)) window.__tileProps.add(k);
      }
    }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['style'], attributeOldValue: true });
  });
  // Proprietà animate dalle animazioni e transizioni CSS in corso.
  window.__animProps = new Set();
  window.__sampleAnims = () => {
    for (const a of document.getAnimations()) {
      if (a.transitionProperty) window.__animProps.add(a.transitionProperty);
      else for (const kf of a.effect.getKeyframes()) for (const k of Object.keys(kf)) if (!['offset', 'easing', 'composite', 'computedOffset'].includes(k)) window.__animProps.add(k);
    }
  };
};

const sleep = (page, ms) => page.waitForTimeout(ms);
const frames = async (page, ms) => {
  const a = await page.evaluate(() => window.__raf);
  await sleep(page, ms);
  return (await page.evaluate(() => window.__raf)) - a;
};
const state = (page, key) => page.getAttribute(`[data-asm="${key}"]`, 'data-asm-state');
/** Scorre in modo che il bordo superiore del blocco stia alla frazione indicata dell'altezza dello schermo. */
const placeTop = (page, sel, frac) => page.evaluate(([s, f]) => {
  const r = document.querySelector(s).getBoundingClientRect();
  window.scrollTo(0, scrollY + r.top - innerHeight * f);
}, [sel, frac]);
const blocksSnapshot = (page) => page.evaluate(() => [...document.querySelectorAll('[data-asm]')].map((e) => {
  const r = e.getBoundingClientRect();
  return { key: e.dataset.asm, state: e.dataset.asmState, top: r.top, bottom: r.bottom, opacity: parseFloat(getComputedStyle(e).opacity) };
}));

async function newPage(browser, vp, opts = {}) {
  const ctx = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: vp.isMobile ? 2 : 1,
    isMobile: vp.isMobile,
    hasTouch: vp.isMobile,
    reducedMotion: opts.reduce ? 'reduce' : 'no-preference',
  });
  await ctx.addInitScript(INSTRUMENT);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  return { ctx, page, errors };
}

// ---------------- Cubi ----------------

async function cubes(browser, vp) {
  console.log(`\n${vp.name} · cubi`);
  const { ctx, page, errors } = await newPage(browser, vp);
  await page.goto(URL, { waitUntil: 'networkidle' });
  await sleep(page, 300);

  // Riga delle card del percorso: partenza all'88%, composizione automatica a scroll fermo.
  const docH0 = await page.evaluate(() => document.documentElement.scrollHeight);
  await placeTop(page, '[data-asm="t1"]', 0.8);
  const trace = await page.evaluate(async () => {
    const keys = ['percHead', 't1', 't2', 't3', 't4', 'skills'];
    const t0 = performance.now();
    const out = { first: {}, composing: {}, done: {}, maxTiles: {}, maxDocH: 0, maxOverflow: 0 };
    while (performance.now() - t0 < 2200) {
      await new Promise((r) => requestAnimationFrame(r));
      const t = performance.now() - t0;
      window.__sampleAnims();
      out.maxDocH = Math.max(out.maxDocH, document.documentElement.scrollHeight);
      out.maxOverflow = Math.max(out.maxOverflow, document.documentElement.scrollWidth - innerWidth);
      for (const k of keys) {
        const el = document.querySelector(`[data-asm="${k}"]`);
        if (el.dataset.asmState === 'composing' && out.composing[k] === undefined) out.composing[k] = t;
        if (el.dataset.asmState === 'composed' && out.done[k] === undefined) out.done[k] = t;
      }
      // prima tessera visibile di ciascun blocco della riga
      for (const k of ['t1', 't2', 't3', 't4']) {
        const tiles = [...document.querySelectorAll(`.asm-tile[data-block="${k}"]`)];
        out.maxTiles[k] = Math.max(out.maxTiles[k] ?? 0, tiles.length);
        if (out.first[k] === undefined && tiles.some((tile) => parseFloat(tile.style.opacity) > 0)) out.first[k] = t;
      }
    }
    out.tilesLeft = document.querySelectorAll('.asm-tile').length;
    return out;
  });
  await page.screenshot({ path: `${OUT}/${vp.name}-percorso-composto.png` });
  // Su mobile le card stanno una per riga: all'88% arriva solo la prima.
  const keys = vp.isMobile ? ['t1'] : ['t1', 't2', 't3', 't4'];
  const delays = { t1: 0, t2: 120, t3: 240, t4: 360 };
  check(keys.every((k) => trace.done[k] !== undefined && trace.done[k] <= delays[k] + 1200 + 250), `card del percorso composte a scroll fermo (fine a ${keys.map((k) => Math.round(trace.done[k])).join(' / ')} ms)`);
  if (!vp.isMobile) {
    const starts = keys.map((k) => trace.first[k]);
    const gaps = starts.slice(1).map((s, i) => s - starts[i]);
    check(starts.every((s) => s !== undefined) && gaps.every((g) => g > 60 && g < 200), `partenze sfalsate nella stessa riga (prima tessera a ${starts.map(Math.round).join(' / ')} ms)`);
  } else {
    const lags = keys.filter((k) => trace.first[k] !== undefined && trace.composing[k] !== undefined).map((k) => Math.round(trace.first[k] - trace.composing[k] - delays[k]));
    check(lags.length === keys.length && lags.every((l) => Math.abs(l) < 80), `ritardi del prototipo rispettati (scarto ${lags.join(' / ')} ms)`);
  }
  check(keys.every((k) => trace.maxTiles[k] > 0 && trace.maxTiles[k] <= 24), `al massimo 24 tessere per blocco (${keys.map((k) => trace.maxTiles[k]).join(' / ')})`);
  check(trace.tilesLeft === 0, `nessuna tessera a composizione finita (${trace.tilesLeft})`);
  check(trace.maxDocH === docH0 && trace.maxOverflow <= 0, `durante la composizione altezza del documento invariata (${docH0} → max ${trace.maxDocH}) e nessuno scroll orizzontale`);

  // Mezza composizione per lo screenshot e il conteggio delle tessere per blocco.
  await placeTop(page, '[data-asm="projHead"]', 0.95);
  await sleep(page, 200);
  await placeTop(page, '[data-asm="p1"]', 0.75);
  await sleep(page, 450);
  await page.screenshot({ path: `${OUT}/${vp.name}-progetti-a-meta.png` });
  const composingNow = await page.evaluate(() => document.querySelectorAll('#progetti [data-asm-state="composing"]').length);
  check(composingNow > 0, `screenshot a metà composizione (${composingNow} blocchi in corso)`);
  await sleep(page, 1500);

  // Blocco fermo tra l'88% e il 100%: non si azzera e non lampeggia.
  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(page, 300);
  const stateLog = [];
  await page.exposeFunction('__logState', (s) => stateLog.push(s));
  await page.evaluate(() => {
    const el = document.querySelector('[data-asm="servHead"]');
    new MutationObserver(() => window.__logState(el.dataset.asmState)).observe(el, { attributes: true, attributeFilter: ['data-asm-state'] });
  });
  await placeTop(page, '[data-asm="servHead"]', 0.8);
  await sleep(page, 150);
  await placeTop(page, '[data-asm="servHead"]', 0.95);
  await sleep(page, 1800);
  check(stateLog.join('>') === 'composing>composed', `blocco fermo tra 88% e 100%: nessun reset (${stateLog.join(' > ')})`);

  // Esce dal basso: si azzera; torna: si ricompone.
  await placeTop(page, '[data-asm="servHead"]', 1.2);
  await sleep(page, 200);
  check((await state(page, 'servHead')) === 'waiting', 'uscito dal basso: azzerato');
  await placeTop(page, '[data-asm="servHead"]', 0.7);
  await sleep(page, 1600);
  check((await state(page, 'servHead')) === 'composed', 'al ritorno si ricompone');

  // Superato verso l'alto: resta composto.
  await placeTop(page, '[data-asm="servHead"]', -1.5);
  await sleep(page, 300);
  await placeTop(page, '[data-asm="servHead"]', 0.5);
  await sleep(page, 50);
  check((await state(page, 'servHead')) === 'composed', 'superato verso l\'alto e ripreso: resta composto');

  // Proprietà animate: solo transform e opacity.
  const tileProps = await page.evaluate(() => [...window.__tileProps]);
  const animProps = await page.evaluate(() => { window.__sampleAnims(); return [...window.__animProps]; });
  check(tileProps.length > 0 && tileProps.every((p) => p === 'transform' || p === 'opacity'), `tessere: cambiano solo ${tileProps.join(', ')}`);
  check(animProps.every((p) => p === 'transform' || p === 'opacity'), `animazioni e transizioni CSS solo su transform/opacity (${animProps.join(', ') || 'nessuna'})`);

  // Salto in fondo (Fine) e risalita (Inizio): niente di visibile resta a opacità 0.
  await page.keyboard.press('End');
  await sleep(page, 1800);
  let snap = await blocksSnapshot(page);
  let vh = vp.height;
  let bad = snap.filter((b) => b.top < vh * 0.88 && (b.state !== 'composed' || b.opacity < 1));
  check(bad.length === 0, `dopo "Fine": tutti i blocchi visibili e superati sono composti${bad.length ? ' — ' + bad.map((b) => b.key).join(', ') : ''}`);
  await page.keyboard.press('Home');
  await sleep(page, 1800);
  snap = await blocksSnapshot(page);
  bad = snap.filter((b) => b.top < vh * 0.88 && b.bottom > 0 && b.opacity < 1);
  check(bad.length === 0, 'dopo "Inizio": nessun blocco visibile a opacità 0');
  // Mattoncino "Scrivimi" dell'header.
  if (vp.isMobile) await page.tap('[data-hdr-trigger]');
  else await page.hover('[data-hdr-trigger]', { position: { x: 12, y: 24 }, force: true });
  await sleep(page, 700);
  await page.click('.lg-brick--mail');
  await sleep(page, 2500);
  snap = await blocksSnapshot(page);
  bad = snap.filter((b) => b.top < vh * 0.88 && (b.state !== 'composed' || b.opacity < 1));
  check(bad.length === 0, `dopo il mattoncino "Scrivimi": tutto composto${bad.length ? ' — ' + bad.map((b) => b.key).join(', ') : ''}`);

  // Resize a metà composizione: il mosaico finisce sul blocco giusto.
  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(page, 400);
  await placeTop(page, '[data-asm="p2"]', 0.75);
  await sleep(page, 350);
  await page.setViewportSize({ width: vp.isMobile ? 360 : 1200, height: vp.height });
  await page.waitForFunction(() => {
    const el = document.querySelector('[data-asm="p2"]');
    return el.dataset.asmState !== 'composing' || parseFloat(el.style.opacity || '0') > 0.15;
  }, null, { polling: 'raf', timeout: 3000 });
  const fit = await page.evaluate(() => {
    const el = document.querySelector('[data-asm="p2"]');
    const er = el.getBoundingClientRect();
    const tiles = [...document.querySelectorAll('.asm-tile[data-block="p2"]')].map((t) => t.getBoundingClientRect());
    if (!tiles.length) return null;
    const box = [Math.min(...tiles.map((r) => r.left)), Math.min(...tiles.map((r) => r.top)), Math.max(...tiles.map((r) => r.right)), Math.max(...tiles.map((r) => r.bottom))];
    return { d: Math.max(Math.abs(box[0] - er.left), Math.abs(box[1] - er.top), Math.abs(box[2] - er.right), Math.abs(box[3] - er.bottom)) };
  });
  check(fit && fit.d <= 6, `resize a metà: il mosaico finisce sul blocco (scarto ${fit ? Math.round(fit.d) : '—'}px)`);
  await page.setViewportSize({ width: vp.width, height: vp.height });
  await sleep(page, 1500);

  // Focus da tastiera dentro un blocco non composto.
  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(page, 400);
  check((await state(page, 'contBox')) === 'waiting', 'contatti non ancora composti in cima alla pagina');
  await page.keyboard.press('Shift');
  await page.evaluate(() => document.querySelector('.contact a').focus());
  await sleep(page, 60);
  const focus = await page.evaluate(() => {
    const a = document.activeElement;
    const box = document.querySelector('[data-asm="contBox"]');
    return { state: box.dataset.asmState, opacity: getComputedStyle(box).opacity, visible: a.matches(':focus-visible'), outline: getComputedStyle(a).outlineStyle };
  });
  check(focus.state === 'composed' && focus.opacity === '1' && focus.visible && focus.outline !== 'none', `Tab in un blocco non composto: si compone subito e il focus è visibile (${focus.state}, outline ${focus.outline})`);

  check(errors.length === 0, `nessun errore in console${errors.length ? ': ' + errors.join(' | ') : ''}`);
  await ctx.close();
}

async function anchors(browser, vp) {
  console.log(`\n${vp.name} · apertura a metà pagina`);
  const { ctx, page, errors } = await newPage(browser, vp);
  await page.goto(`${URL}#contatti`, { waitUntil: 'networkidle' });
  await sleep(page, 1700);
  let snap = await blocksSnapshot(page);
  let bad = snap.filter((b) => b.top < vp.height * 0.88 && (b.state !== 'composed' || b.opacity < 1));
  check(bad.length === 0 && (await page.evaluate(() => scrollY)) > 1000, `apertura con #contatti: tutti i blocchi sopra composti${bad.length ? ' — ' + bad.map((b) => b.key).join(', ') : ''}`);
  await page.evaluate(() => document.querySelector('#progetti').scrollIntoView());
  await sleep(page, 1700);
  await page.reload({ waitUntil: 'networkidle' });
  await sleep(page, 1700);
  snap = await blocksSnapshot(page);
  bad = snap.filter((b) => b.top < vp.height * 0.88 && (b.state !== 'composed' || b.opacity < 1));
  check(bad.length === 0 && (await page.evaluate(() => scrollY)) > 500, `ricarica a metà pagina: tutti i blocchi sopra composti${bad.length ? ' — ' + bad.map((b) => b.key).join(', ') : ''}`);
  check(errors.length === 0, 'nessun errore in console');
  await ctx.close();
}

// ---------------- Caso studio ----------------

const caseInfo = (page) => page.evaluate(() => {
  const bar = document.querySelector('[data-case-progress-bar]');
  const m = /scaleX\(([\d.]+)\)/.exec(bar.style.transform || '');
  return {
    view: document.querySelector('[data-case-view="dopo"]').getAttribute('aria-pressed') === 'true' ? 'dopo' : 'prima',
    progress: m ? parseFloat(m[1]) : 0,
    barVisible: document.querySelector('[data-case-progress]').classList.contains('is-visible'),
    clock: document.querySelector('.board__live span:last-child')?.textContent ?? '',
    intervals: window.__intervals.size,
  };
});
const boardTo = (page, frac) => page.evaluate((f) => {
  // f = quota della dashboard visibile dal basso dello schermo (1 = interamente visibile, centrata).
  const b = document.querySelector('[data-case-board]');
  const r = b.getBoundingClientRect();
  const y = f >= 1 ? scrollY + r.top - Math.max(90, (innerHeight - r.height) / 2) : scrollY + r.top - (innerHeight - r.height * f);
  window.scrollTo(0, y);
}, frac);
const awayFromCase = (page) => page.evaluate(() => window.scrollTo(0, document.querySelector('#progetti').offsetTop));

async function caseStudy(browser, vp) {
  console.log(`\n${vp.name} · caso studio`);
  const { ctx, page, errors } = await newPage(browser, vp);
  await page.goto(URL, { waitUntil: 'networkidle' });
  await sleep(page, 300);
  let c = await caseInfo(page);
  check(c.view === 'prima' && (await page.isHidden('[data-case-dopo]')), 'si vede prima il "Prima"');

  // Sotto il 35% di visibilità la barretta non avanza.
  await boardTo(page, 0.2);
  await sleep(page, 1800);
  c = await caseInfo(page);
  check(c.progress === 0, `con il 20% della dashboard visibile la barretta non parte (${c.progress})`);

  // Dashboard interamente visibile: da 0 a pieno in 5 s, poi "Dopo".
  await boardTo(page, 1);
  await page.waitForFunction(() => document.querySelector('[data-asm="caseBoard"]').dataset.asmState === 'composed', null, { timeout: 4000 });
  const t0 = Date.now();
  await sleep(page, 2500);
  const mid = await caseInfo(page);
  await page.screenshot({ path: `${OUT}/${vp.name}-caso-prima.png` });
  await page.waitForFunction(() => document.querySelector('[data-case-view="dopo"]').getAttribute('aria-pressed') === 'true', null, { timeout: 8000 });
  const switchAt = Date.now() - t0;
  check(mid.barVisible && mid.progress > 0.4 && mid.progress < 0.6, `barretta a metà dopo 2,5 s (${mid.progress})`);
  check(switchAt > 4600 && switchAt < 5600, `passaggio automatico a "Dopo" dopo 5 s di visibilità (${switchAt} ms)`);

  // Dopo un passaggio automatico, scorrendo via e tornando si riparte da "Prima".
  await sleep(page, 1000);
  await page.screenshot({ path: `${OUT}/${vp.name}-caso-dopo.png` });
  await awayFromCase(page);
  await sleep(page, 400);
  await boardTo(page, 1);
  await sleep(page, 300);
  c = await caseInfo(page);
  check(c.view === 'prima' && c.progress < 0.1, `scorrendo via e tornando: di nuovo "Prima" (${c.view}, barretta ${c.progress})`);

  // Tra 0 e 35% il conto si ferma, si azzera solo a dashboard fuori schermo.
  await sleep(page, 1500);
  const before = (await caseInfo(page)).progress;
  await boardTo(page, 0.2);
  await sleep(page, 1200);
  const paused = (await caseInfo(page)).progress;
  await awayFromCase(page);
  await sleep(page, 300);
  const gone = (await caseInfo(page)).progress;
  check(before > 0.2 && Math.abs(paused - before) < 0.05 && gone === 0, `sotto il 35% il conto si ferma (${before} → ${paused}), fuori schermo si azzera (${gone})`);

  // Scheda non attiva: il conto non avanza e non ci sono timer.
  await boardTo(page, 1);
  await sleep(page, 1200);
  const vis = (await caseInfo(page)).progress;
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await sleep(page, 1200);
  c = await caseInfo(page);
  check(Math.abs(c.progress - vis) < 0.03 && c.intervals === 0, `scheda non attiva: conto fermo (${vis} → ${c.progress}) e nessun timer (${c.intervals})`);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    document.dispatchEvent(new Event('visibilitychange'));
  });

  // Clic manuale: comanda l'utente anche scorrendo via e tornando.
  await page.click('[data-case-view="dopo"]');
  await awayFromCase(page);
  await sleep(page, 400);
  await boardTo(page, 1);
  await sleep(page, 500);
  c = await caseInfo(page);
  check(c.view === 'dopo' && !c.barVisible, 'dopo un clic su "Dopo", scorrendo via e tornando resta "Dopo"');
  await page.click('[data-case-view="prima"]');
  await awayFromCase(page);
  await sleep(page, 400);
  await boardTo(page, 1);
  await sleep(page, 6000);
  c = await caseInfo(page);
  check(c.view === 'prima' && !c.barVisible, 'dopo un clic su "Prima" resta "Prima", senza passaggio automatico');

  // Filtro per mercato.
  await page.click('[data-case-view="dopo"]');
  await sleep(page, 300);
  const mgp = page.locator('.mkt', { hasText: 'MGP' });
  await mgp.click();
  let f = await page.evaluate(() => ({
    pressed: document.querySelector('.mkt').getAttribute('aria-pressed'),
    title: document.querySelector('.panel__title').textContent,
    tags: [...document.querySelectorAll('.cols .mkt-tag')].map((t) => t.textContent),
    showAll: !document.querySelector('.chip-btn').hidden,
  }));
  await page.evaluate(() => document.querySelector('.mkts').scrollIntoView({ block: 'start' }));
  await page.evaluate(() => window.scrollBy(0, -100));
  await sleep(page, 700);
  await page.screenshot({ path: `${OUT}/${vp.name}-caso-filtro.png` });
  check(f.pressed === 'true' && f.title === 'Task · MGP' && f.tags.length > 0 && f.tags.every((t) => t === 'MGP') && f.showAll, `clic su MGP: solo task MGP (${f.title}, ${f.tags.length} task)`);
  await mgp.click();
  f = await page.evaluate(() => ({ pressed: document.querySelector('.mkt').getAttribute('aria-pressed'), title: document.querySelector('.panel__title').textContent }));
  check(f.pressed === 'false' && f.title === 'Task · tutti i mercati', 'secondo clic sulla stessa card: tutti i mercati');
  await page.locator('.mkt', { hasText: 'MSD' }).click();
  await page.click('.chip-btn');
  f = await page.evaluate(() => ({ title: document.querySelector('.panel__title').textContent, any: [...document.querySelectorAll('.mkt')].some((m) => m.getAttribute('aria-pressed') === 'true') }));
  check(f.title === 'Task · tutti i mercati' && !f.any, '"Mostra tutti i mercati" toglie il filtro');

  // Tastiera.
  await page.focus('[data-case-view="prima"]');
  await page.keyboard.press('Space');
  const k1 = (await caseInfo(page)).view;
  await page.focus('[data-case-view="dopo"]');
  await page.keyboard.press('Enter');
  const k2 = (await caseInfo(page)).view;
  await page.locator('.mkt', { hasText: 'GAS' }).focus();
  await page.keyboard.press('Space');
  const k3 = await page.evaluate(() => document.querySelector('.panel__title').textContent);
  await page.keyboard.press('Enter');
  const k4 = await page.evaluate(() => document.querySelector('.panel__title').textContent);
  check(k1 === 'prima' && k2 === 'dopo' && k3 === 'Task · GAS' && k4 === 'Task · tutti i mercati', 'interruttore e card usabili da tastiera');

  // La simulazione avanza sullo schermo, si ferma fuori schermo, riprende senza raffiche.
  await boardTo(page, 1);
  await sleep(page, 400);
  const clockA = (await caseInfo(page)).clock;
  await sleep(page, 1700);
  const clockB = (await caseInfo(page)).clock;
  const secs = (s) => (/(\d\d):(\d\d):(\d\d)/.exec(s) ?? [0, 0, 0, 0]).slice(1).reduce((a, v) => a * 60 + Number(v), 0);
  check(secs(clockB) > secs(clockA), `sullo schermo la simulazione avanza (${clockA} → ${clockB})`);
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await sleep(page, 2500);
  const off1 = await caseInfo(page);
  const fr = await frames(page, 1000);
  const off2 = await caseInfo(page);
  const caseAnims = await page.evaluate(() => document.getAnimations().filter((a) => a.effect?.target?.closest?.('#caso') && a.playState === 'running').length);
  check(fr === 0 && off2.intervals === 0, `composizioni finite e dashboard fuori schermo: 0 frame in 1 s (${fr}) e nessun timer (${off2.intervals})`);
  check(off1.clock === off2.clock && caseAnims === 0, `fuori schermo orologio fermo (${off1.clock}) e animazioni del caso in pausa (${caseAnims} in corso)`);
  await sleep(page, 2000);
  await boardTo(page, 1);
  await sleep(page, 1000);
  const back = await caseInfo(page);
  check(secs(back.clock) - secs(off2.clock) <= 26, `al ritorno nessuna raffica di passi recuperati (${off2.clock} → ${back.clock})`);

  // 390px: nessuno scroll orizzontale della pagina, card con colonne uguali.
  const lay = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth - innerWidth,
    cards: [...document.querySelectorAll('.mkt')].map((m) => Math.round(m.getBoundingClientRect().width)),
    silos: [...document.querySelectorAll('.silo')].map((m) => Math.round(m.getBoundingClientRect().width)),
  }));
  check(lay.overflow <= 0 && new Set(lay.cards).size === 1, `nessuno scroll orizzontale della pagina, card mercato a colonne uguali (${lay.cards.join(', ')})`);

  check(errors.length === 0, `nessun errore in console${errors.length ? ': ' + errors.join(' | ') : ''}`);
  await ctx.close();
}

// ---------------- Testi del caso studio ----------------

async function texts(browser) {
  console.log('\ntesti del caso studio');
  const proto = await readFile('design/prototype.dc.html', 'utf8');
  const markup = proto.slice(proto.indexOf('<section id="caso"'), proto.indexOf('</section>', proto.indexOf('<section id="caso"')));
  const markupTexts = markup.replace(/\{\{[^}]*\}\}/g, '\n').replace(/<[^>]+>/g, '\n').split('\n').map((s) => s.trim()).filter(Boolean);
  const script = proto.slice(proto.indexOf('class Component'));
  const literals = [...script.matchAll(/'([^'\\]*(?:\\.[^'\\]*)*)'/g)].map((m) => m[1]).filter((s) => /[a-zà-ù]/i.test(s));
  const atoms = (s) => s.split('·').map((x) => x.trim()).filter(Boolean);
  const corpus = new Set([...markupTexts, ...literals].flatMap(atoms));

  const { ctx, page, errors } = await newPage(browser, VIEWPORTS[0]);
  await page.goto(URL, { waitUntil: 'networkidle' });
  const grab = () => page.evaluate(() => {
    const out = [];
    const w = document.createTreeWalker(document.querySelector('#caso'), NodeFilter.SHOW_TEXT);
    while (w.nextNode()) { const t = w.currentNode.textContent.replace(/\s+/g, ' ').trim(); if (t) out.push(t); }
    return out;
  });
  const seen = new Set(await grab());
  await page.evaluate(() => document.querySelector('[data-case-view="dopo"]').click());
  for (let i = 0; i < 6; i++) {
    await sleep(page, 900);
    (await grab()).forEach((t) => seen.add(t));
  }
  await page.locator('.mkt', { hasText: 'MI' }).first().click();
  (await grab()).forEach((t) => seen.add(t));

  const dynamic = [/^\d+$/, /^\d\d:\d\d:\d\d$/, /^4 mercati$/];
  const unknown = [];
  for (const t of seen) {
    for (let a of atoms(t)) {
      if (dynamic.some((r) => r.test(a)) || corpus.has(a)) continue;
      const m = /^(chiude tra|riapre tra) \d\d:\d\d$/.exec(a);
      if (m && corpus.has(m[1])) continue;
      if (a.startsWith('✓ ') && corpus.has(a.slice(2))) continue;
      unknown.push(a);
    }
  }
  check(unknown.length === 0, `ogni testo della sezione viene dal prototipo${unknown.length ? ' — sconosciuti: ' + [...new Set(unknown)].join(' | ') : ''}`);

  const all = await page.evaluate(() => document.querySelector('#caso').textContent.replace(/\s+/g, ' '));
  const required = [
    ...markupTexts.filter((s) => s.length > 2 && !/^[·✓?]/.test(s)),
    ...[...script.matchAll(/name: '([^']+)', src: '([^']+)'/g)].flatMap((m) => [m[1], m[2]]),
    ...[...script.matchAll(/\{ n: '([^']+)'/g)].map((m) => m[1]),
    ...[...script.matchAll(/text: '([^']+)'/g)].map((m) => m[1]),
    ...[...script.matchAll(/name: '([^']+)', cycle/g)].map((m) => m[1]),
    ...[...script.matchAll(/'((?:Prima|Dopo): [^']+)'/g)].map((m) => m[1]),
  ];
  // la didascalia mostra una frase alla volta: l'altra si legge nell'altra vista
  await page.click('[data-case-view="prima"]');
  const all2 = await page.evaluate(() => document.querySelector('#caso').textContent.replace(/\s+/g, ' '));
  const missing = required.filter((r) => !all.includes(r.replace(/\s+/g, ' ')) && !all2.includes(r.replace(/\s+/g, ' ')));
  check(missing.length === 0, `tutti i testi del prototipo sono presenti (${required.length} frasi)${missing.length ? ' — mancano: ' + missing.join(' | ') : ''}`);
  check(all.includes('demo, dati simulati') && all.includes('fabbisogno'), 'etichetta "demo, dati simulati" e "fabbisogno" presenti');

  const html = await page.content();
  const src = [await readFile('index.html', 'utf8')];
  for (const dir of ['src', 'src/case', 'src/hero', 'src/lib', 'src/styles']) {
    for (const f of await readdir(dir)) if (/\.(ts|css)$/.test(f)) src.push(await readFile(`${dir}/${f}`, 'utf8'));
  }
  check(!/sbilanciament/i.test(html) && !src.some((s) => /sbilanciament/i.test(s)), '"sbilanciamenti" non compare né nella pagina né nei sorgenti');
  check(errors.length === 0, 'nessun errore in console');
  await ctx.close();
}

// ---------------- Dashboard che cambia altezza ----------------

const zoneWaiting = (page) => page.evaluate(() => [...document.querySelectorAll('[data-asm]')]
  .filter((e) => { const r = e.getBoundingClientRect(); return r.top < innerHeight * 0.88 && r.bottom > 0 && e.dataset.asmState === 'waiting'; })
  .map((e) => e.dataset.asm));

/** Ritorno automatico a "Prima" con la dashboard sopra lo schermo (390×844): niente salti, niente blocchi invisibili. */
async function autoReturnShift(browser) {
  console.log('\n390×844 · ritorno automatico a "Prima" con la dashboard sopra lo schermo');
  const { ctx, page, errors } = await newPage(browser, VIEWPORTS[1]);
  await page.goto(URL, { waitUntil: 'networkidle' });
  await sleep(page, 300);
  await boardTo(page, 1);
  await page.waitForFunction(() => document.querySelector('[data-case-view="dopo"]').getAttribute('aria-pressed') === 'true', null, { timeout: 9000 });
  await sleep(page, 500);
  // Scorre finché la dashboard esce dall'alto; la posizione di t1 si legge subito, prima che scatti il ritorno.
  const before = await page.evaluate(() => {
    const b = document.querySelector('[data-case-board]');
    scrollTo(0, scrollY + b.getBoundingClientRect().bottom + 10);
    return { h: b.offsetHeight, t1: document.querySelector('[data-asm="t1"]').getBoundingClientRect().top };
  });
  await sleep(page, 600);
  const after = await page.evaluate(() => ({
    view: document.querySelector('[data-case-view="dopo"]').getAttribute('aria-pressed') === 'true' ? 'dopo' : 'prima',
    h: document.querySelector('[data-case-board]').offsetHeight,
    t1: document.querySelector('[data-asm="t1"]').getBoundingClientRect().top,
  }));
  check(after.view === 'prima' && after.h < before.h - 200, `scatta il ritorno a "Prima" (dashboard ${before.h} → ${after.h}px)`);
  check(Math.abs(after.t1 - before.t1) <= 2, `la card t1 resta ferma sullo schermo (${Math.round(before.t1)} → ${Math.round(after.t1)}px)`);
  await sleep(page, 1700);
  const waiting = await zoneWaiting(page);
  check(waiting.length === 0, `nessun blocco nella zona dell'88% resta in attesa, senza altro scroll${waiting.length ? ' — ' + waiting.join(', ') : ''}`);
  await page.screenshot({ path: `${OUT}/mobile-ritorno-prima.png` });
  check(errors.length === 0, 'nessun errore in console');
  await ctx.close();
}

/** Filtro e "Mostra tutti i mercati" con didascalia e percorso subito sotto la dashboard (1280×720). */
async function filterShift(browser) {
  console.log('\n1280×720 · filtro con il percorso subito sotto la dashboard');
  const vp = { name: 'desktop-1280', width: 1280, height: 720, isMobile: false };
  const { ctx, page, errors } = await newPage(browser, vp);
  await page.goto(URL, { waitUntil: 'networkidle' });
  await sleep(page, 300);
  await boardTo(page, 1);
  await sleep(page, 1700);
  await page.evaluate(() => document.querySelector('[data-case-view="dopo"]').click());
  await sleep(page, 900);
  // Didascalia e titolo del percorso appena sotto la linea dell'88%, ancora da comporre.
  await placeTop(page, '[data-asm="percHead"]', 0.95);
  await sleep(page, 300);
  const h0 = await page.evaluate(() => document.querySelector('[data-case-board]').offsetHeight);
  await page.evaluate(() => [...document.querySelectorAll('.mkt')].find((m) => m.textContent.includes('GAS')).click());
  await sleep(page, 300);
  const h1 = await page.evaluate(() => document.querySelector('[data-case-board]').offsetHeight);
  await sleep(page, 1700);
  let waiting = await zoneWaiting(page);
  check(waiting.length === 0, `filtro GAS (dashboard ${h0} → ${h1}px): nessun blocco invisibile nella zona dell'88%${waiting.length ? ' — ' + waiting.join(', ') : ''}`);
  await placeTop(page, '[data-asm="percHead"]', 0.95);
  await sleep(page, 300);
  await page.evaluate(() => document.querySelector('.chip-btn').click());
  await sleep(page, 300);
  const h2 = await page.evaluate(() => document.querySelector('[data-case-board]').offsetHeight);
  await sleep(page, 1700);
  waiting = await zoneWaiting(page);
  check(waiting.length === 0, `"Mostra tutti i mercati" (dashboard ${h1} → ${h2}px): nessun blocco invisibile nella zona dell'88%${waiting.length ? ' — ' + waiting.join(', ') : ''}`);
  // Dashboard che si accorcia (Dopo → Prima): il titolo del percorso sale nella zona dell'88% senza scroll.
  await placeTop(page, '[data-asm="percHead"]', 0.95);
  await sleep(page, 300);
  const p0 = await page.evaluate(() => ({ top: document.querySelector('[data-asm="percHead"]').getBoundingClientRect().top / innerHeight, state: document.querySelector('[data-asm="percHead"]').dataset.asmState, y: scrollY }));
  await page.evaluate(() => document.querySelector('[data-case-view="prima"]').click());
  await sleep(page, 300);
  const p1 = await page.evaluate(() => ({ top: document.querySelector('[data-asm="percHead"]').getBoundingClientRect().top / innerHeight, h: document.querySelector('[data-case-board]').offsetHeight, y: scrollY }));
  await sleep(page, 1700);
  waiting = await zoneWaiting(page);
  const ph = await state(page, 'percHead');
  check(p0.state === 'waiting' && p1.top < 0.88 && p1.y === p0.y, `Dopo → Prima (dashboard ${h2} → ${p1.h}px): il titolo del percorso sale da ${Math.round(p0.top * 100)}% a ${Math.round(p1.top * 100)}% dell'altezza senza scroll`);
  check(ph === 'composed' && waiting.length === 0, `e si compone (${ph})${waiting.length ? ' — in attesa: ' + waiting.join(', ') : ''}`);
  check(errors.length === 0, 'nessun errore in console');
  await ctx.close();
}

/** Prima ↔ Dopo a mano con la dashboard sullo schermo: il contenuto sopra la dashboard non salta. */
async function manualToggleShift(browser, vp) {
  console.log(`\n${vp.name} · Prima ↔ Dopo a mano`);
  const { ctx, page, errors } = await newPage(browser, vp);
  await page.goto(URL, { waitUntil: 'networkidle' });
  await sleep(page, 300);
  await boardTo(page, 1);
  await sleep(page, 1700);
  const pos = () => page.evaluate(() => ({
    head: document.querySelector('.case__head').getBoundingClientRect().top,
    ctrl: document.querySelector('.case__ctrl').getBoundingClientRect().top,
    board: document.querySelector('[data-case-board]').getBoundingClientRect().top,
  }));
  const moves = [];
  for (const v of ['dopo', 'prima', 'dopo']) {
    const a = await pos();
    await page.evaluate((x) => document.querySelector(`[data-case-view="${x}"]`).click(), v);
    await sleep(page, 400);
    const b = await pos();
    moves.push(Math.max(Math.abs(b.head - a.head), Math.abs(b.ctrl - a.ctrl), Math.abs(b.board - a.board)));
  }
  check(moves.every((m) => m <= 2), `nessun salto del contenuto sopra la dashboard (spostamenti ${moves.map((m) => Math.round(m)).join(' / ')}px)`);
  check(errors.length === 0, 'nessun errore in console');
  await ctx.close();
}

// ---------------- Riduci movimento ----------------

async function reduced(browser, vp) {
  console.log(`\n${vp.name} · riduci movimento`);
  const { ctx, page, errors } = await newPage(browser, vp, { reduce: true });
  await page.goto(URL, { waitUntil: 'networkidle' });
  await sleep(page, 300);
  const s = await page.evaluate(() => ({
    asmOn: document.documentElement.classList.contains('asm-on'),
    hidden: [...document.querySelectorAll('[data-asm]')].filter((e) => getComputedStyle(e).opacity !== '1').length,
  }));
  check(!s.asmOn && s.hidden === 0, 'tutti i blocchi già composti');
  await boardTo(page, 1);
  await sleep(page, 400);
  const a = await caseInfo(page);
  await sleep(page, 2000);
  const b = await caseInfo(page);
  const running = await page.evaluate(() => document.getAnimations().filter((x) => x.playState === 'running').length);
  const tiles = await page.evaluate(() => document.querySelectorAll('.asm-tile').length);
  await page.screenshot({ path: `${OUT}/${vp.name}-riduci-movimento-caso.png` });
  check(a.view === 'dopo' && a.clock === b.clock && b.intervals === 0 && !b.barVisible, `"Dopo" con dati fermi (${a.clock}), nessun timer, nessuna barretta`);
  check(tiles === 0 && running === 0 && (await frames(page, 1000)) === 0, 'nessuna tessera, nessuna animazione, nessun frame');
  await page.click('[data-case-view="prima"]');
  check((await caseInfo(page)).view === 'prima', 'l\'interruttore funziona a mano');
  check(errors.length === 0, 'nessun errore in console');
  await ctx.close();
}

await mkdir(OUT, { recursive: true });
if (await fetch(URL).then(() => true, () => false)) {
  console.error(`La porta ${PORT} è già occupata: chiudi il server che la usa e riprova.`);
  process.exit(1);
}
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
try {
  await waitForServer();
  const browser = await chromium.launch();
  for (const vp of VIEWPORTS) {
    await cubes(browser, vp);
    await anchors(browser, vp);
    await caseStudy(browser, vp);
    await reduced(browser, vp);
  }
  await autoReturnShift(browser);
  await filterShift(browser);
  for (const vp of VIEWPORTS) await manualToggleShift(browser, vp);
  await texts(browser);
  await browser.close();
} finally {
  server.kill();
}

if (failures.length) {
  console.log(`\n${failures.length} controlli falliti`);
  process.exit(1);
}
console.log('\nTutti i controlli superati');
