// Verifiche finali (Blocco 4): suoni, header, SEO e condivisione, accessibilità, privacy, pagina intera.
// Uso: npm run build && npm run verify:final   (screenshot in .verify/final/)
import { spawn } from 'node:child_process';
import { mkdir, readFile, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';

// Playwright è preinstallato globalmente nell'ambiente, non è una dipendenza del progetto.
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH ?? 'playwright');

const PORT = 4183;
const URL = `http://localhost:${PORT}/`;
const OUT = '.verify/final';
const SITE_URL = (await readFile('site.config.ts', 'utf8')).match(/SITE_URL = '([^']+)'/)[1];
const AXE = require.resolve('axe-core/axe.min.js');

const DESKTOP = { name: 'desktop', width: 1440, height: 900, isMobile: false };
const MOBILE = { name: 'mobile', width: 390, height: 844, isMobile: true };

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

// Errori della pagina: console, eccezioni ed eventi `error` sulla finestra (es. "ResizeObserver loop").
const ERRORS = () => {
  window.__errors = [];
  window.addEventListener('error', (e) => window.__errors.push(e.message || String(e)));
  window.addEventListener('unhandledrejection', (e) => window.__errors.push(String(e.reason)));
  window.__raf = 0;
  window.__t0 = 0;
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) => {
    if (!window.__t0) window.__t0 = performance.now();
    return raf((t) => { window.__raf++; cb(t); });
  };
};

// AudioContext finto: registra ogni suono (tipo, frequenza, istante) e lo stato dei nodi.
const FAKE_AUDIO = () => {
  const A = (window.__audio = { contexts: 0, events: [], nodes: [], resumed: 0, suspended: 0 });
  class Param {
    constructor(v) { this.value = v; this.first = undefined; }
    setValueAtTime(v) { if (this.first === undefined) this.first = v; this.value = v; return this; }
    exponentialRampToValueAtTime(v) { this.value = v; return this; }
    linearRampToValueAtTime(v) { this.value = v; return this; }
  }
  class Node {
    constructor(ctx, kind) { this.ctx = ctx; this.kind = kind; this.outs = 0; this.disconnected = false; A.nodes.push(this); }
    connect(n) { this.outs++; this.disconnected = false; return n; }
    disconnect() { this.outs = 0; this.disconnected = true; }
  }
  class Source extends Node {
    constructor(ctx, kind) { super(ctx, kind); this.onended = null; this.ended = false; }
    start() {
      const f = this.frequency ? (this.frequency.first ?? this.frequency.value) : null;
      A.events.push({ t: performance.now(), node: this.kind, freq: f });
    }
    stop(at) {
      setTimeout(() => { this.ended = true; this.onended?.(); }, Math.max(0, (at - this.ctx.currentTime) * 1000) + 5);
    }
  }
  class Ctx {
    constructor() {
      A.contexts++;
      this.state = 'running';
      this.sampleRate = 44100;
      this.t0 = performance.now();
      this.destination = new Node(this, 'destination');
    }
    get currentTime() { return (performance.now() - this.t0) / 1000; }
    createGain() { const n = new Node(this, 'gain'); n.gain = new Param(1); return n; }
    createOscillator() { const n = new Source(this, 'osc'); n.frequency = new Param(440); n.type = 'sine'; return n; }
    createBufferSource() { const n = new Source(this, 'noise'); n.buffer = null; return n; }
    createBiquadFilter() { const n = new Node(this, 'filter'); n.frequency = new Param(350); n.Q = new Param(1); n.type = 'lowpass'; return n; }
    createDynamicsCompressor() { const n = new Node(this, 'limiter'); for (const k of ['threshold', 'knee', 'ratio', 'attack', 'release']) n[k] = new Param(0); return n; }
    createBuffer(_c, len) { return { getChannelData: () => new Float32Array(len) }; }
    resume() { this.state = 'running'; A.resumed++; return Promise.resolve(); }
    suspend() { this.state = 'suspended'; A.suspended++; return Promise.resolve(); }
  }
  window.AudioContext = Ctx;
  window.webkitAudioContext = Ctx;
};

/** Raggruppa gli avvii in suoni: tre voci nello stesso istante a 523/659/784 Hz sono un accordo. */
function sounds(events) {
  const out = [];
  const byT = new Map();
  for (const e of events) {
    const k = Math.round(e.t);
    if (!byT.has(k)) byT.set(k, []);
    byT.get(k).push(e);
  }
  for (const [t, es] of [...byT.entries()].sort((a, b) => a[0] - b[0])) {
    const chord = es.filter((e) => e.node === 'osc' && [523.25, 659.25, 783.99].includes(e.freq));
    if (chord.length === 3) out.push({ t, kind: 'chord' });
    for (const e of es) {
      if (chord.includes(e)) continue;
      if (e.node === 'noise') out.push({ t, kind: 'click' });
      else if (e.freq >= 205 && e.freq <= 235) out.push({ t, kind: 'tic' });
      else if (e.freq === 600) out.push({ t, kind: 'pop' });
      else out.push({ t, kind: `altro(${e.freq})` });
    }
  }
  return out;
}
const minGap = (list) => list.slice(1).reduce((m, s, i) => Math.min(m, s.t - list[i].t), Infinity);

async function context(browser, vp, opts = {}) {
  const ctx = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: vp.isMobile ? 2 : 1,
    isMobile: vp.isMobile,
    hasTouch: vp.isMobile,
    reducedMotion: opts.reduce ? 'reduce' : 'no-preference',
    javaScriptEnabled: opts.noJs ? false : true,
  });
  if (!opts.noJs) {
    await ctx.addInitScript(ERRORS);
    if (opts.fakeAudio !== false) await ctx.addInitScript(FAKE_AUDIO);
    if (opts.audioOn) await ctx.addInitScript(() => { try { localStorage.setItem('portfolio-audio', 'on'); } catch {} });
  }
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  return { ctx, page, errors };
}
const pageErrors = async (page, errors) => [...errors, ...(await page.evaluate(() => window.__errors ?? []))];
const heroState = (page) => page.getAttribute('#top', 'data-hero-state');
/** Avanza l'orologio finto a piccoli passi, lasciando lavorare il browser (osservatori, disegno). */
async function advance(page, ms, stepMs = 100) {
  for (let t = 0; t < ms; t += stepMs) {
    await page.clock.runFor(stepMs);
    await page.waitForTimeout(5);
  }
}

// ---------------- Suoni ----------------

async function audioScene(browser) {
  console.log('\nsuoni · scena dell\'hero (orologio controllato, desktop)');
  const { ctx, page, errors } = await context(browser, DESKTOP, { audioOn: true });
  await page.clock.install();
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await advance(page, 300, 50);
  check((await page.evaluate(() => window.__audio.contexts)) === 0, 'preferenza accesa al caricamento: nessun AudioContext prima di un gesto');
  await page.mouse.wheel(0, 200);
  await page.mouse.wheel(0, -200);
  await advance(page, 100, 50);
  check((await page.evaluate(() => window.__audio.contexts)) === 0, 'lo scroll non conta come gesto');
  // primo gesto: il contesto nasce, l'hero NON riparte (sarebbe una sorpresa)
  await page.mouse.click(60, 600);
  await advance(page, 100, 50);
  check((await page.evaluate(() => window.__audio.contexts)) === 1, 'al primo clic nasce l\'AudioContext');
  // "alla soluzione." entra a 3400 ms dall'inizio della scena: se il clic l'avesse fatta ripartire, arriverebbe dopo
  const sinceStart = async () => page.evaluate(() => performance.now() - window.__t0);
  while ((await sinceStart()) < 3550) await advance(page, 50, 50);
  const w2 = await page.evaluate(() => document.querySelector('[data-hero-step="w2"]').classList.contains('is-in'));
  check(w2, `il primo gesto non fa ripartire l'hero ("alla soluzione." già entrato a ${Math.round(await sinceStart())} ms dall'inizio)`);
  await advance(page, 6000);
  let ev = sounds(await page.evaluate(() => window.__audio.events));
  const t0 = await page.evaluate(() => window.__t0);
  const tics = ev.filter((s) => s.kind === 'tic');
  const clicks = ev.filter((s) => s.kind === 'click');
  const chords = ev.filter((s) => s.kind === 'chord');
  check(tics.length > 2 && tics.length <= 36 && minGap(tics) >= 129 && tics.every((s) => s.t - t0 < 2700), `tic: ${tics.length} (al massimo uno per pezzo), distanza minima ${Math.round(minGap(tics))} ms, solo durante la cascata`);
  check(clicks.length > 3 && minGap(clicks) >= 139 && clicks.every((s) => s.t - t0 >= 4100 && s.t - t0 < 5600), `clic: ${clicks.length}, distanza minima ${Math.round(minGap(clicks))} ms, solo durante la chiusura dei task`);
  check(chords.length === 1 && Math.abs(chords[0].t - t0 - 6650) < 120, `accordo: ${chords.length}, a ${chords.length ? Math.round(chords[0].t - t0) : '—'} ms (arrivo su "soluzione")`);
  check(ev.every((s) => !s.kind.startsWith('altro')), 'nessun suono sconosciuto');

  // "Rivedi": di nuovo tutto, accordo compreso (uno per esecuzione)
  let n = (await page.evaluate(() => window.__audio.events)).length;
  await page.click('[data-hero-replay]');
  await advance(page, 9500);
  ev = sounds((await page.evaluate(() => window.__audio.events)).slice(n));
  check(ev.filter((s) => s.kind === 'chord').length === 1 && ev.some((s) => s.kind === 'tic') && ev.some((s) => s.kind === 'click'), `"Rivedi": tic, clic e un solo accordo (${ev.filter((s) => s.kind === 'chord').length})`);

  // Hero fuori schermo: nessun suono dell'hero
  await page.click('[data-hero-replay]');
  await advance(page, 300, 50);
  await page.evaluate(() => window.scrollTo(0, document.querySelector('#percorso').offsetTop));
  await page.waitForTimeout(200);
  n = (await page.evaluate(() => window.__audio.events)).length;
  await advance(page, 6000);
  ev = sounds((await page.evaluate(() => window.__audio.events)).slice(n)).filter((s) => s.kind !== 'pop');
  check(ev.length === 0 && (await heroState(page)) === 'paused', `hero fuori schermo: nessun tic, clic o accordo (${ev.length})`);

  // Scheda nascosta: contesto sospeso, nessun suono
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(200);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  n = (await page.evaluate(() => window.__audio.events)).length;
  await advance(page, 3000);
  const hid = await page.evaluate(() => ({ suspended: window.__audio.suspended }));
  ev = sounds((await page.evaluate(() => window.__audio.events)).slice(n));
  check(ev.length === 0 && hid.suspended >= 1, `scheda nascosta: contesto sospeso (${hid.suspended}) e nessun suono (${ev.length})`);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await advance(page, 8000);

  // Più blocchi che finiscono nello stesso frame (dopo una scheda nascosta): un solo pop
  await page.evaluate(() => { const r = document.querySelector('[data-asm="t1"]').getBoundingClientRect(); window.scrollTo(0, scrollY + r.top - innerHeight * 0.8); });
  await page.waitForTimeout(100);
  await advance(page, 60, 20);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await advance(page, 2000);
  n = (await page.evaluate(() => window.__audio.events)).length;
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await advance(page, 200, 20);
  const composed = await page.evaluate(() => ['t1', 't2', 't3', 't4'].filter((k) => document.querySelector(`[data-asm="${k}"]`).dataset.asmState === 'composed').length);
  ev = sounds((await page.evaluate(() => window.__audio.events)).slice(n));
  check(composed === 4 && ev.filter((s) => s.kind === 'pop').length === 1, `dopo una scheda nascosta ${composed} blocchi finiscono insieme: ${ev.filter((s) => s.kind === 'pop').length} pop`);

  // Pop all'apertura del logo
  await page.evaluate(() => window.scrollTo(0, 0));
  n = (await page.evaluate(() => window.__audio.events)).length;
  await page.hover('[data-hdr-trigger]', { position: { x: 12, y: 24 }, force: true });
  await advance(page, 300, 50);
  ev = sounds((await page.evaluate(() => window.__audio.events)).slice(n));
  check(ev.filter((s) => s.kind === 'pop').length === 1, 'pop all\'apertura del logo');

  // A fine suono tutti i nodi sono fermati e scollegati (resta collegata solo la catena principale)
  await page.mouse.move(700, 700);
  await advance(page, 2000);
  const nodes = await page.evaluate(() => {
    const A = window.__audio;
    const sources = A.nodes.filter((x) => x.kind === 'osc' || x.kind === 'noise');
    const perSound = A.nodes.filter((x) => x.kind === 'gain' || x.kind === 'filter');
    return {
      sources: sources.length,
      notEnded: sources.filter((x) => !x.ended).length,
      connected: [...sources, ...perSound].filter((x) => !x.disconnected).length,
    };
  });
  check(nodes.sources > 20 && nodes.notEnded === 0 && nodes.connected === 1, `${nodes.sources} suoni: tutti fermati (${nodes.notEnded} attivi) e scollegati (resta collegato solo il volume generale: ${nodes.connected})`);
  check((await pageErrors(page, errors)).length === 0, `nessun errore${(await pageErrors(page, errors)).join(' | ')}`);
  await ctx.close();
}

async function audioButton(browser) {
  console.log('\nsuoni · pulsante audio');
  // Attivazione con l'hero visibile: pop di conferma e l'hero riparte
  let { ctx, page, errors } = await context(browser, DESKTOP);
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(9500);
  check((await page.getAttribute('[data-audio]', 'aria-pressed')) === 'false' && (await page.evaluate(() => window.__audio.contexts)) === 0, 'spento di default, nessun AudioContext');
  const label = await page.getAttribute('[data-audio]', 'aria-label');
  await page.click('[data-audio]');
  await page.waitForTimeout(150);
  let s = await page.evaluate(() => ({
    pressed: document.querySelector('[data-audio]').getAttribute('aria-pressed'),
    label: document.querySelector('[data-audio]').getAttribute('aria-label'),
    tip: document.querySelector('[data-audio-tip]').textContent,
    pref: localStorage.getItem('portfolio-audio'),
    restarted: !document.querySelector('[data-hero-step="r3"]').classList.contains('is-in'),
  }));
  let ev = sounds(await page.evaluate(() => window.__audio.events));
  check(label === 'Suoni' && s.label === 'Suoni' && s.pressed === 'true' && s.tip === 'Disattiva i suoni', `etichetta fissa "${s.label}" con aria-pressed=${s.pressed}; nuvoletta "${s.tip}"`);
  check(ev[0]?.kind === 'pop', 'all\'attivazione un pop di conferma');
  check(s.restarted && (await heroState(page)) === 'running', 'con l\'hero visibile, l\'hero riparte con il suono');
  check(s.pref === 'on', 'scelta salvata nel browser');
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(300);
  check((await page.getAttribute('[data-audio]', 'aria-pressed')) === 'true' && (await page.evaluate(() => window.__audio.contexts)) === 0, 'dopo la ricarica resta acceso, ma il contesto aspetta un gesto');
  await page.click('[data-audio]');
  check((await page.evaluate(() => localStorage.getItem('portfolio-audio'))) === 'off' && (await page.getAttribute('[data-audio]', 'aria-pressed')) === 'false', 'spento: scelta salvata');
  check((await pageErrors(page, errors)).length === 0, 'nessun errore');
  await ctx.close();

  // Attivazione con l'hero fuori schermo: si accende soltanto
  ({ ctx, page, errors } = await context(browser, DESKTOP));
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(9500);
  await page.evaluate(() => window.scrollTo(0, document.querySelector('#percorso').offsetTop));
  await page.waitForTimeout(300);
  await page.click('[data-audio]');
  await page.waitForTimeout(200);
  s = await page.evaluate(() => ({ r3: document.querySelector('[data-hero-step="r3"]').classList.contains('is-in') }));
  ev = sounds(await page.evaluate(() => window.__audio.events));
  check(s.r3 && (await heroState(page)) !== 'running' && ev.some((e) => e.kind === 'pop'), 'hero fuori schermo: pop di conferma, l\'hero non riparte');
  check((await pageErrors(page, errors)).length === 0, 'nessun errore');
  await ctx.close();

  // Tastiera: Tab, focus visibile, nuvoletta al focus, Esc la chiude
  ({ ctx, page, errors } = await context(browser, DESKTOP));
  await page.goto(URL, { waitUntil: 'networkidle' });
  let found = false;
  for (let i = 0; i < 12 && !found; i++) {
    await page.keyboard.press('Tab');
    found = await page.evaluate(() => document.activeElement?.matches('[data-audio]'));
  }
  await page.waitForTimeout(250);
  const k1 = await page.evaluate(() => {
    const b = document.activeElement;
    return { fv: b.matches(':focus-visible'), outline: getComputedStyle(b).outlineStyle, tip: getComputedStyle(b.querySelector('[data-audio-tip]')).opacity };
  });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);
  const k2 = await page.evaluate(() => getComputedStyle(document.querySelector('[data-audio-tip]')).opacity);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(250);
  const k3 = await page.evaluate(() => ({ pressed: document.activeElement.getAttribute('aria-pressed'), outline: getComputedStyle(document.activeElement).outlineStyle, color: getComputedStyle(document.activeElement).outlineColor }));
  check(found && k1.fv && k1.outline !== 'none' && k1.tip === '1', `raggiungibile con Tab, focus visibile, nuvoletta al focus (opacità ${k1.tip})`);
  check(k2 === '0', `Esc chiude la nuvoletta (opacità ${k2})`);
  check(k3.pressed === 'true' && k3.outline !== 'none', `Invio lo accende e il focus resta visibile anche in blu notte (${k3.outline} ${k3.color})`);
  check((await pageErrors(page, errors)).length === 0, 'nessun errore');
  await ctx.close();
}

async function audioReduced(browser) {
  console.log('\nsuoni · "riduci movimento"');
  const { ctx, page, errors } = await context(browser, DESKTOP, { reduce: true, audioOn: true });
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.mouse.click(60, 600);
  await page.waitForTimeout(3000);
  for (let y = 0; y < 5000; y += 800) {
    await page.evaluate((v) => window.scrollTo(0, v), y);
    await page.waitForTimeout(150);
  }
  let ev = sounds(await page.evaluate(() => window.__audio.events));
  check((await page.evaluate(() => window.__audio.contexts)) === 1 && ev.length === 0, `nessun suono automatico (${ev.length})`);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.hover('[data-hdr-trigger]', { position: { x: 12, y: 24 }, force: true });
  await page.waitForTimeout(300);
  ev = sounds(await page.evaluate(() => window.__audio.events));
  check(ev.length === 1 && ev[0].kind === 'pop', 'pop all\'apertura del logo (gesto diretto)');
  await page.mouse.move(700, 700);
  await page.click('[data-audio]');
  await page.click('[data-audio]');
  await page.waitForTimeout(200);
  ev = sounds(await page.evaluate(() => window.__audio.events));
  check(ev.length === 2 && ev[1].kind === 'pop', 'spento e riacceso: pop di conferma anche con "riduci movimento"');
  check((await pageErrors(page, errors)).length === 0, 'nessun errore');
  await ctx.close();
}

async function audioLateScript(browser) {
  console.log('\nsuoni · script principale arrivato in ritardo (scena già finita)');
  const { ctx, page, errors } = await context(browser, DESKTOP, { audioOn: true });
  await ctx.route(/\/assets\/index-[^/]+\.js$/, async (route) => {
    await new Promise((r) => setTimeout(r, 6000));
    await route.continue();
  });
  await page.goto(URL, { waitUntil: 'commit' });
  await page.waitForFunction(() => document.querySelector('#top.hero--live'), null, { timeout: 15000 });
  await page.mouse.click(60, 600);
  await page.waitForTimeout(3000);
  const ev = sounds(await page.evaluate(() => window.__audio.events));
  check((await page.evaluate(() => window.__audio.contexts)) === 1 && !ev.some((s) => s.kind === 'chord'), `nessun accordo dopo il salto alla scena finita (${ev.map((s) => s.kind).join(', ') || 'nessun suono'})`);
  check((await pageErrors(page, errors)).length === 0, 'nessun errore');
  await ctx.close();
}

// ---------------- Header ----------------

async function headerGeometry(browser) {
  console.log('\nheader · nessuna sovrapposizione tra nome, invito, sezione, mattoncini e pulsante audio');
  const widths = [320, 360, 390, 420, 480, 600, 640, 700, 768, 900, 1024, 1440];
  const bad = [];
  for (const w of widths) {
    const mobile = w < 768;
    const { ctx, page, errors } = await context(browser, { width: w, height: 800, isMobile: mobile });
    await page.goto(URL, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    const measure = () => page.evaluate(() => {
      const clipped = (e) => { for (let a = e; a; a = a.parentElement) { const cs = getComputedStyle(a); if (cs.clipPath === 'inset(50%)' || (cs.overflow === 'hidden' && a.getBoundingClientRect().width <= 1)) return true; } return false; };
      const shown = (e) => e && !e.closest('[hidden]') && getComputedStyle(e).display !== 'none' && getComputedStyle(e).visibility !== 'hidden' && !clipped(e);
      const text = (e) => { if (!shown(e) || !e.textContent.trim()) return null; const rg = document.createRange(); rg.selectNodeContents(e); const x = rg.getBoundingClientRect(); return x.width > 1 ? x : null; };
      const box = (e) => { if (!shown(e)) return null; const x = e.getBoundingClientRect(); return x.width > 1 ? x : null; };
      const items = {
        nome: text(document.querySelector('.lg-name__title')),
        ruoli: text(document.querySelector('.lg-name__roles')),
        'tocca il logo': text(document.querySelector('[data-hdr-hint-sm]')),
        invito: text(document.querySelector('[data-hdr-hint]')),
        sezione: box(document.querySelector('[data-hdr-cur]')),
        audio: box(document.querySelector('[data-audio]')),
      };
      document.querySelectorAll('[data-hdr-slot]').forEach((s, i) => { const x = s.getBoundingClientRect(); if (x.width > 20) items[`mattoncino ${i + 1}`] = x; });
      const hit = (a, b) => a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;
      const keys = Object.keys(items).filter((k) => items[k]);
      const out = [];
      const stacked = new Set(['nome×ruoli', 'nome×tocca il logo']); // righe una sotto l'altra
      for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) {
        const pair = `${keys[i]}×${keys[j]}`;
        if (!stacked.has(pair) && hit(items[keys[i]], items[keys[j]])) out.push(pair);
      }
      const bar = document.querySelector('.site-header__bar').getBoundingClientRect();
      for (const k of keys) if (!k.startsWith('mattoncino') && (items[k].right > bar.right + 0.5 || items[k].left < bar.left - 0.5)) out.push(`${k} fuori dalla barra`);
      return out;
    });
    const states = [];
    states.push(['in cima, logo chiuso', await measure()]);
    await page.focus('[data-hdr-trigger]');
    await page.waitForTimeout(700);
    states.push(['in cima, logo aperto', await measure()]);
    await page.evaluate(() => document.activeElement.blur());
    await page.evaluate(() => document.querySelector('#caso').scrollIntoView());
    await page.waitForTimeout(700);
    states.push(['sezione corrente, logo chiuso', await measure()]);
    await page.focus('[data-hdr-trigger]');
    await page.waitForTimeout(700);
    states.push(['sezione corrente, logo aperto', await measure()]);
    for (const [st, out] of states) if (out.length) bad.push(`${w}px ${st}: ${out.join(', ')}`);
    if ((await pageErrors(page, errors)).length) bad.push(`${w}px: errori ${(await pageErrors(page, errors)).join(' | ')}`);
    if ([320, 390, 900, 1440].includes(w)) await page.screenshot({ path: `${OUT}/header-${w}.png`, clip: { x: 0, y: 0, width: w, height: mobile ? 330 : 100 } });
    await ctx.close();
  }
  check(bad.length === 0, `da 320 a 1440px (${widths.length} larghezze × 4 stati)${bad.length ? ' — ' + bad.join(' | ') : ''}`);
}

/** Su telefono: scelta una voce del menu, il logo torna come prima (segnalazione di Mariano). */
async function headerMenuMobile(browser) {
  console.log('\nheader · su telefono il logo torna chiuso dopo la scelta di una voce');
  const { devices } = require(process.env.PLAYWRIGHT_PATH ?? 'playwright');
  for (const dev of ['Pixel 7', 'iPhone 13']) {
    const ctx = await browser.newContext({ ...devices[dev] });
    await ctx.addInitScript(ERRORS);
    const page = await ctx.newPage();
    const cdp = await ctx.newCDPSession(page);
    await page.goto(URL, { waitUntil: 'networkidle' });
    // Sui telefoni veri, dopo un tocco lo stato :hover resta sull'elemento toccato ("hover appiccicoso"):
    // Playwright non lo fa da solo, lo si forza con il protocollo di Chromium.
    await cdp.send('DOM.enable');
    await cdp.send('CSS.enable');
    const stickyHover = async (sel) => {
      const { root } = await cdp.send('DOM.getDocument');
      const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: sel });
      await cdp.send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: ['hover'] });
      return async () => cdp.send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: [] });
    };
    const state = () => page.evaluate(() => ({
      open: document.querySelector('[data-hdr-zone]').classList.contains('lg-open'),
      expanded: document.querySelector('[data-hdr-trigger]').getAttribute('aria-expanded'),
      focusInLogo: document.querySelector('[data-hdr-zone]').contains(document.activeElement),
      tips: [...document.querySelectorAll('.lg-tip')].filter((t) => getComputedStyle(t).opacity !== '0').length,
      lifted: [...document.querySelectorAll('.lg-brick')].filter((b) => getComputedStyle(b).transform !== 'none' || getComputedStyle(b).boxShadow !== 'none').length,
      cubes: [...document.querySelectorAll('[data-hdr-slot]')].map((s) => Math.round(s.getBoundingClientRect().width)),
    }));
    const results = [];
    for (const brick of ['.lg-brick--path', '.lg-brick--proj', '.lg-brick--mail', '.lg-brick--case']) {
      await page.tap('[data-hdr-trigger]');
      await page.waitForTimeout(700);
      await page.evaluate(() => window.scrollBy(0, 300)); // scorre con il menu aperto
      await page.waitForTimeout(300);
      const box = await page.locator(brick).boundingBox();
      await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
      const release = await stickyHover(brick);
      await page.waitForTimeout(1600);
      results.push([brick, await state()]);
      await release();
    }
    const bad = results.filter(([, s]) => s.open || s.expanded !== 'false' || s.focusInLogo || s.tips > 0 || s.lifted > 0 || s.cubes.some((c) => c > 10));
    check(bad.length === 0, `${dev}: dopo 4 voci scelte, anche con l'hover appiccicoso, il logo torna come prima (cubetti ${results[0][1].cubes.join('/')}px, nessun cubetto sollevato, nessuna nuvoletta, niente focus nel logo)${bad.length ? ' — ' + JSON.stringify(bad.map(([b, s]) => [b, s])) : ''}`);
    // Il browser che restituisce il focus al mattoncino subito dopo la scelta non riapre il logo.
    await page.tap('[data-hdr-trigger]');
    await page.waitForTimeout(700);
    const b2 = await page.locator('.lg-brick--path').boundingBox();
    await page.touchscreen.tap(b2.x + b2.width / 2, b2.y + b2.height / 2);
    await page.evaluate(() => document.querySelector('.lg-brick--path').focus());
    await page.waitForTimeout(1200);
    check(!(await state()).open, `${dev}: il focus restituito al mattoncino subito dopo la scelta non riapre il logo`);
    const errs = await page.evaluate(() => window.__errors);
    check(errs.length === 0, `${dev}: nessun errore`);
    await ctx.close();
  }
  // Da tastiera: la voce scelta porta il focus alla sezione
  const { ctx, page } = await context(browser, DESKTOP);
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.focus('[data-hdr-trigger]');
  await page.waitForTimeout(600);
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1500);
  const k = await page.evaluate(() => ({ id: document.activeElement?.id, open: document.querySelector('[data-hdr-zone]').classList.contains('lg-open') }));
  check(k.id === 'percorso' && !k.open, `da tastiera: logo chiuso e focus sulla sezione scelta (#${k.id})`);
  await ctx.close();
}

// ---------------- Ritocchi dal Blocco 3 ----------------

async function block3Fixes(browser) {
  console.log('\nritocchi dal Blocco 3');
  for (const w of [1024, 1280, 1440]) {
    const { ctx, page, errors } = await context(browser, { width: w, height: 800, isMobile: false });
    await page.goto(URL, { waitUntil: 'networkidle' });
    await page.evaluate(() => { const r = document.querySelector('[data-case-board]').getBoundingClientRect(); window.scrollTo(0, scrollY + r.top - 90); });
    await page.waitForFunction(() => document.querySelector('[data-case-view="dopo"]').getAttribute('aria-pressed') === 'true', null, { timeout: 12000 });
    await page.waitForTimeout(500);
    await page.click('[data-case-view="prima"]');
    await page.waitForTimeout(300);
    await page.click('[data-case-view="dopo"]');
    await page.waitForTimeout(300);
    await page.setViewportSize({ width: w - 200, height: 800 });
    await page.waitForTimeout(300);
    const errs = await pageErrors(page, errors);
    check(errs.length === 0, `${w}px: "Dopo" (automatico, a mano e con resize) senza eventi error né "ResizeObserver loop"${errs.length ? ' — ' + errs.join(' | ') : ''}`);
    await ctx.close();
  }
  const { ctx, page } = await context(browser, MOBILE);
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.evaluate(() => { const r = document.querySelector('[data-case-board]').getBoundingClientRect(); window.scrollTo(0, scrollY + r.top - 90); });
  await page.waitForTimeout(1800);
  await page.evaluate(() => document.querySelector('[data-case-view="dopo"]').click());
  await page.waitForTimeout(400);
  const off = await page.evaluate(() => document.querySelector('.panel__title').getBoundingClientRect().top - document.querySelector('.panel--tasks').getBoundingClientRect().top);
  check(Math.abs(off - 14) <= 1, `390px: "Task · tutti i mercati" a ${off.toFixed(1)}px dal bordo del pannello (prototipo: 14px)`);
  await ctx.close();
}

// ---------------- SEO e condivisione ----------------

async function seo() {
  console.log('\nSEO e condivisione (dalla build)');
  const html = await readFile('dist/index.html', 'utf8');
  const meta = (attr, name) => html.match(new RegExp(`<meta ${attr}="${name}" content="([^"]*)"`))?.[1];
  const title = html.match(/<title>([^<]*)<\/title>/)?.[1];
  const desc = meta('name', 'description');
  check(title === 'Mariano De Magistris · Dal problema alla soluzione', `title: "${title}"`);
  check(desc && desc.length < 155, `description di ${desc?.length} caratteri (< 155)`);
  check(!/%[A-Z_]+%/.test(html), 'nessun segnaposto %…% rimasto');
  const canonical = html.match(/<link rel="canonical" href="([^"]*)"/)?.[1];
  check(canonical === `${SITE_URL}/` && meta('property', 'og:url') === `${SITE_URL}/`, `canonical e og:url = ${SITE_URL}/`);
  const img = meta('property', 'og:image');
  check(img === `${SITE_URL}/og.png` && img.startsWith('https://') && meta('name', 'twitter:image') === img, `og:image assoluto https: ${img}`);
  const need = [['property', 'og:type'], ['property', 'og:title'], ['property', 'og:description'], ['property', 'og:image:width'], ['property', 'og:image:height'], ['property', 'og:image:alt'], ['property', 'og:locale'], ['name', 'twitter:card']];
  const missing = need.filter(([a, n]) => !meta(a, n)).map(([, n]) => n);
  check(missing.length === 0 && meta('name', 'twitter:card') === 'summary_large_image' && meta('property', 'og:locale') === 'it_IT', `tag Open Graph e Twitter completi${missing.length ? ' — mancano ' + missing.join(', ') : ''}`);
  const png = await readFile('dist/og.png');
  const w = png.readUInt32BE(16), h = png.readUInt32BE(20);
  const kb = (await stat('dist/og.png')).size / 1024;
  check(w === 1200 && h === 630 && kb < 300, `og.png ${w}×${h}, ${kb.toFixed(1)} KB (< 300 KB per WhatsApp)`);
  for (const [path, type] of [['/og.png', 'image/png'], ['/favicon.svg', 'image/svg+xml'], ['/favicon-32.png', 'image/png'], ['/apple-touch-icon.png', 'image/png'], ['/robots.txt', 'text/plain']]) {
    const r = await fetch(URL + path.slice(1));
    check(r.ok && (r.headers.get('content-type') ?? '').startsWith(type), `${path} servito (${r.status}, ${r.headers.get('content-type')})`);
  }
  for (const [rel, href] of [['icon', '/favicon.svg'], ['icon', '/favicon-32.png'], ['apple-touch-icon', '/apple-touch-icon.png']]) {
    check(html.includes(`rel="${rel}" href="${href}"`), `<link rel="${rel}" href="${href}">`);
  }
  const fav = await readFile('dist/apple-touch-icon.png');
  check(fav.readUInt32BE(16) === 180 && fav.readUInt32BE(20) === 180, 'apple-touch-icon 180×180');
}

// ---------------- Pagina intera, accessibilità, privacy ----------------

/** Percorre tutta la pagina e si ferma in fondo: lì tutti i blocchi sono composti (risalendo, quelli sotto lo
 *  schermo si azzerano, come previsto). */
async function composeAll(page) {
  const H = await page.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y < H; y += 300) {
    await page.evaluate((v) => window.scrollTo(0, v), y);
    await page.waitForTimeout(120);
  }
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.waitForTimeout(1800);
}

async function axe(page, label) {
  await page.addScriptTag({ path: AXE });
  const res = await page.evaluate(async () => {
    const r = await window.axe.run(document, { resultTypes: ['violations'] });
    return r.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(', ')}`);
  });
  check(res.length === 0, `axe ${label}: ${res.length} violazioni${res.length ? ' — ' + res.join(' | ') : ''}`);
}

async function wholePage(browser) {
  for (const vp of [DESKTOP, MOBILE]) {
    console.log(`\n${vp.name} · pagina intera, accessibilità, privacy`);
    const { ctx, page, errors } = await context(browser, vp, { fakeAudio: false });
    const foreign = [];
    page.on('request', (r) => { if (!r.url().startsWith(URL) && !r.url().startsWith('data:') && !r.url().startsWith('blob:')) foreign.push(r.url()); });
    await page.goto(URL, { waitUntil: 'networkidle' });
    await page.waitForTimeout(9000);
    await composeAll(page);
    await page.screenshot({ path: `${OUT}/${vp.name}-pagina.png`, fullPage: true });
    const basics = await page.evaluate(() => ({ h1: document.querySelectorAll('h1').length, lang: document.documentElement.lang, overflow: document.documentElement.scrollWidth - innerWidth, waiting: document.querySelectorAll('[data-asm-state="waiting"]').length }));
    check(basics.h1 === 1 && basics.lang === 'it' && basics.overflow <= 0, `un solo h1, lang="it", nessuno scroll orizzontale`);
    check(basics.waiting === 0, 'dopo aver percorso la pagina tutti i blocchi sono composti');
    await axe(page, 'pagina intera con "Prima"');
    await page.evaluate(() => document.querySelector('[data-case-view="dopo"]').click());
    await page.waitForTimeout(1200);
    await axe(page, 'con "Dopo"');
    await page.focus('[data-hdr-trigger]');
    await page.waitForTimeout(800);
    await axe(page, 'con il logo aperto');
    await page.evaluate(() => document.activeElement.blur());
    await page.click('[data-audio]');
    await page.waitForTimeout(300);
    const cookies = await ctx.cookies();
    const store = await page.evaluate(() => ({ cookie: document.cookie, keys: Object.keys(localStorage), session: Object.keys(sessionStorage) }));
    check(foreign.length === 0, `nessuna richiesta esterna${foreign.length ? ' — ' + foreign.join(', ') : ''}`);
    check(cookies.length === 0 && store.cookie === '', 'nessun cookie');
    check(store.keys.length === 1 && store.keys[0] === 'portfolio-audio' && store.session.length === 0, `archiviazione del browser: solo ${store.keys.join(', ')}`);
    const errs = await pageErrors(page, errors);
    check(errs.length === 0, `nessun errore in console né eventi error${errs.length ? ' — ' + errs.join(' | ') : ''}`);
    await ctx.close();
  }

  console.log('\nriduci movimento e senza JS');
  let { ctx, page, errors } = await context(browser, DESKTOP, { reduce: true, fakeAudio: false });
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/desktop-riduci-movimento.png`, fullPage: true });
  await axe(page, '"riduci movimento"');
  check((await pageErrors(page, errors)).length === 0, 'nessun errore');
  await ctx.close();
  ({ ctx, page, errors } = await context(browser, MOBILE, { reduce: true, fakeAudio: false }));
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/mobile-riduci-movimento.png`, fullPage: true });
  await ctx.close();
  for (const vp of [DESKTOP, MOBILE]) {
    ({ ctx, page } = await context(browser, vp, { noJs: true }));
    await page.goto(URL, { waitUntil: 'networkidle' });
    await page.screenshot({ path: `${OUT}/${vp.name}-senza-js.png`, fullPage: true });
    const s = await page.evaluate(() => ({ audio: getComputedStyle(document.querySelector('[data-audio]')).display, github: [...document.querySelectorAll('a')].some((a) => /github/i.test(a.textContent + a.href)) }));
    check(s.audio === 'none' && !s.github, `${vp.name} senza JS: pulsante audio nascosto (non farebbe nulla), nessun link GitHub`);
    await ctx.close();
  }
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
  await audioScene(browser);
  await audioButton(browser);
  await audioReduced(browser);
  await audioLateScript(browser);
  await headerGeometry(browser);
  await headerMenuMobile(browser);
  await block3Fixes(browser);
  await seo();
  await wholePage(browser);
  await browser.close();
} finally {
  server.kill();
}

if (failures.length) {
  console.log(`\n${failures.length} controlli falliti`);
  process.exit(1);
}
console.log('\nTutti i controlli superati');
