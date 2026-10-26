// Verifiche finali (Blocco 4): suoni, header, SEO e condivisione, accessibilità, privacy, pagina intera.
// Uso: npm run build && npm run verify:final   (screenshot in .verify/final/)
import { spawn } from 'node:child_process';
import { mkdir, readFile, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { throttled } from './throttle.mjs';

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

// AudioContext finto: registra ogni suono (tipo, frequenza, istante, tempo della scena) e lo stato dei nodi.
// `mode` simula i browser più difficili: 'normal' (attivo subito), 'second-gesture' (il contesto nasce sospeso e
// riparte solo dal secondo gesto vero: il primo, per esempio Esc, non conta) e 'slow' (resume() lento, 600 ms).
const FAKE_AUDIO = (mode = 'normal') => {
  const A = (window.__audio = { contexts: 0, events: [], nodes: [], resumed: 0, suspended: 0, gestures: 0 });
  // Conta i gesti prima dei listener della pagina (questo script gira per primo).
  for (const t of ['pointerdown', 'keydown']) window.addEventListener(t, () => A.gestures++, true);
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
      const st = document.querySelector('#top')?.dataset.heroT;
      A.events.push({ t: performance.now(), sceneT: st === undefined ? null : Number(st), node: this.kind, freq: f });
    }
    stop(at) {
      setTimeout(() => { this.ended = true; this.onended?.(); }, Math.max(0, (at - this.ctx.currentTime) * 1000) + 5);
    }
  }
  class Ctx {
    get state() { return this._state; }
    set state(v) { this._state = v; A.state = v; }
    constructor() {
      A.contexts++;
      this.state = mode === 'normal' ? 'running' : 'suspended';
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
    resume() {
      A.resumed++;
      if (mode === 'second-gesture') {
        if (A.gestures >= 2) this.state = 'running';
        return Promise.resolve();
      }
      if (mode === 'slow') {
        const asked = A.suspended;
        // Una suspend() chiesta nel frattempo vince, come nei browser (le richieste sono in coda).
        return new Promise((r) => setTimeout(() => { if (A.suspended === asked) this.state = 'running'; r(); }, 600));
      }
      this.state = 'running';
      return Promise.resolve();
    }
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
    const sceneT = es[0].sceneT;
    if (chord.length === 3) out.push({ t, sceneT, kind: 'chord' });
    for (const e of es) {
      if (chord.includes(e)) continue;
      if (e.node === 'noise') out.push({ t, sceneT, kind: 'click' });
      else if (e.freq >= 205 && e.freq <= 235) out.push({ t, sceneT, kind: 'tic' });
      else if (e.freq === 600) out.push({ t, sceneT, kind: 'pop' });
      else out.push({ t, sceneT, kind: `altro(${e.freq})` });
    }
  }
  return out;
}
const minGap = (list) => list.slice(1).reduce((m, s, i) => Math.min(m, s.t - list[i].t), Infinity);

// Timeline dell'hero (src/hero/hero.ts, `T`): i suoni si confrontano con il tempo della scena (`data-hero-t`).
const T = { pile: 2600, close: 4100, rect: 5500, mark: 6300 };
const MARK_ARRIVAL = T.mark + 350;
const FRAMES2 = 34; // tolleranza: due frame da 16-17 ms

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
    if (opts.fakeAudio !== false) await ctx.addInitScript(FAKE_AUDIO, opts.audioMode ?? 'normal');
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
const sceneT = (page) => page.evaluate(() => Number(document.querySelector('#top').dataset.heroT ?? NaN));
/** Avanza l'orologio finto a passi di un frame, lasciando lavorare il browser (osservatori, disegno). */
async function advance(page, ms, stepMs = 16) {
  for (let t = 0; t < ms; t += stepMs) {
    await page.clock.runFor(stepMs);
    await page.waitForTimeout(1);
  }
}
/** Avanza l'orologio finto a passi di 16 ms finché `cond` è vera, con un limite largo (in tempo finto). */
async function advanceUntil(page, cond, arg, limitMs = 30000) {
  for (let t = 0; t < limitMs; t += 16) {
    if (await page.evaluate(cond, arg)) return true;
    await page.clock.runFor(16);
  }
  return page.evaluate(cond, arg);
}
/** Attende (in tempo reale) che la scena dell'hero sia finita, qualunque sia la velocità della macchina. */
const heroIdle = (page) => page.waitForFunction(() => document.querySelector('#top').dataset.heroState === 'idle', null, { timeout: 60000 });
const chordSince = (n) => window.__audio.events.slice(n).some((e) => e.freq === 523.25);
const isIdle = () => document.querySelector('#top').dataset.heroState === 'idle';

// ---------------- Suoni ----------------

async function audioScene(browser) {
  console.log('\nsuoni · scena dell\'hero (orologio controllato, desktop)');
  const { ctx, page, errors } = await context(browser, DESKTOP, { audioOn: true });
  await page.clock.install();
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await advance(page, 300);
  check((await page.evaluate(() => window.__audio.contexts)) === 0, 'preferenza accesa al caricamento: nessun AudioContext prima di un gesto');
  await page.mouse.wheel(0, 200);
  await page.mouse.wheel(0, -200);
  await advance(page, 100);
  check((await page.evaluate(() => window.__audio.contexts)) === 0, 'lo scroll non conta come gesto');
  // Ogni volta che il tempo della scena torna indietro, l'hero è ripartito.
  await page.evaluate(() => {
    window.__restarts = 0;
    const top = document.querySelector('#top');
    new MutationObserver((rs) => rs.forEach((r, i) => {
      const now = i + 1 < rs.length ? rs[i + 1].oldValue : top.dataset.heroT;
      if (r.oldValue !== null && Number(now) < Number(r.oldValue)) window.__restarts++;
    })).observe(top, { attributes: true, attributeFilter: ['data-hero-t'], attributeOldValue: true });
  });
  // primo gesto: il contesto nasce, l'hero NON riparte (sarebbe una sorpresa)
  const atGesture = await sceneT(page);
  await page.mouse.click(60, 600);
  await advance(page, 100);
  check((await page.evaluate(() => window.__audio.contexts)) === 1, 'al primo clic nasce l\'AudioContext');
  await advanceUntil(page, (v) => Number(document.querySelector('#top').dataset.heroT) >= v, T.close - 300);
  const w2 = await page.evaluate(() => document.querySelector('[data-hero-step="w2"]').classList.contains('is-in'));
  const restarts = await page.evaluate(() => window.__restarts);
  check(atGesture > 0 && restarts === 0 && w2, `il primo gesto (a ${atGesture} ms di scena) non fa ripartire l'hero: tempo della scena mai tornato indietro (${restarts}), "alla soluzione." entrato`);
  const done = (await advanceUntil(page, chordSince, 0)) && (await advanceUntil(page, isIdle));
  check(done, 'scena finita (accordo registrato e scena ferma) entro il limite');

  // Momenti dei suoni sul tempo della scena: tic nella cascata, clic nella chiusura dei task, accordo all'arrivo.
  const timing = (ev, label) => {
    const tics = ev.filter((s) => s.kind === 'tic');
    const clicks = ev.filter((s) => s.kind === 'click');
    const chords = ev.filter((s) => s.kind === 'chord');
    const span = (l) => (l.length ? `${l[0].sceneT}–${l[l.length - 1].sceneT}` : '—');
    check(tics.length > 2 && tics.length <= 36 && minGap(tics) >= 129 && tics.every((s) => s.sceneT < T.pile), `${label}tic: ${tics.length} (al massimo uno per pezzo), distanza minima ${Math.round(minGap(tics))} ms, a ${span(tics)} ms di scena (cascata: < ${T.pile})`);
    check(clicks.length > 3 && minGap(clicks) >= 139 && clicks.every((s) => s.sceneT >= T.close && s.sceneT < T.rect + FRAMES2), `${label}clic: ${clicks.length}, distanza minima ${Math.round(minGap(clicks))} ms, a ${span(clicks)} ms di scena (chiusura dei task: ${T.close}–${T.rect})`);
    check(chords.length === 1 && chords[0].sceneT >= MARK_ARRIVAL && chords[0].sceneT < MARK_ARRIVAL + FRAMES2, `${label}accordo: ${chords.length}, a ${chords.length ? chords[0].sceneT : '—'} ms di scena (arrivo su "soluzione": ${MARK_ARRIVAL}, tolleranza due frame)`);
    check(ev.every((s) => !s.kind.startsWith('altro') && s.sceneT !== null), `${label}nessun suono sconosciuto`);
  };
  timing(sounds(await page.evaluate(() => window.__audio.events)), '');

  // "Rivedi": di nuovo tutto, accordo compreso (uno per esecuzione)
  let n = (await page.evaluate(() => window.__audio.events)).length;
  await page.click('[data-hero-replay]');
  const replayed = (await advanceUntil(page, chordSince, n)) && (await advanceUntil(page, isIdle));
  check(replayed && (await page.evaluate(() => window.__restarts)) === 1, '"Rivedi": la scena riparte una volta e arriva in fondo entro il limite');
  timing(sounds((await page.evaluate(() => window.__audio.events)).slice(n)), '"Rivedi" · ');
  let ev;

  // Hero fuori schermo: nessun suono dell'hero
  await page.click('[data-hero-replay]');
  await advance(page, 300);
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
  await advance(page, 300);
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
  await heroIdle(page);
  check((await page.getAttribute('[data-audio]', 'aria-pressed')) === 'false' && (await page.evaluate(() => window.__audio.contexts)) === 0, 'spento di default, nessun AudioContext');
  const label = await page.getAttribute('[data-audio]', 'aria-label');
  await page.click('[data-audio]');
  await page.waitForFunction(() => window.__audio.events.length > 0, null, { timeout: 10000 });
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
  await heroIdle(page);
  await page.evaluate(() => window.scrollTo(0, document.querySelector('#percorso').offsetTop));
  await page.waitForTimeout(300);
  await page.click('[data-audio]');
  await page.waitForFunction(() => window.__audio.events.length > 0, null, { timeout: 10000 });
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

/** Browser difficili: il primo gesto non basta, oppure resume() è lento e nel frattempo l'audio viene spento. */
async function audioRobust(browser) {
  console.log('\nsuoni · contesto che non parte al primo gesto, avvio lento');
  let { ctx, page, errors } = await context(browser, DESKTOP, { audioOn: true, audioMode: 'second-gesture' });
  await page.goto(URL, { waitUntil: 'networkidle' });
  const audio = () => page.evaluate(() => ({ contexts: window.__audio.contexts, resumed: window.__audio.resumed, state: window.__audio.state }));
  await page.keyboard.press('Escape'); // gesto che il browser non conta: il contesto resta sospeso
  await page.waitForTimeout(200);
  const g1 = await audio();
  await page.mouse.click(60, 600);
  await page.waitForTimeout(200);
  const g2 = await audio();
  await page.mouse.click(60, 600);
  await page.keyboard.press('Shift');
  await page.waitForTimeout(200);
  const g3 = await audio();
  check(g1.contexts === 1 && g1.resumed >= 1 && g1.state === 'suspended', `primo gesto inutile: contesto creato ma "${g1.state}" (${g1.resumed} tentativi)`);
  check(g2.resumed > g1.resumed && g2.state === 'running', `i listener restano: il secondo gesto riprova (${g2.resumed} tentativi in tutto) e l'audio è "${g2.state}"`);
  check(g3.resumed === g2.resumed && g3.contexts === 1, `con l'audio attivo i listener si tolgono: altri gesti non riprovano (${g3.resumed})`);
  await page.hover('[data-hdr-trigger]', { position: { x: 12, y: 24 }, force: true });
  await page.waitForFunction(() => window.__audio.events.some((e) => e.freq === 600), null, { timeout: 5000 }).catch(() => {});
  check((await page.evaluate(() => window.__audio.events.some((e) => e.freq === 600))), 'dopo il secondo gesto i suoni funzionano (pop all\'apertura del logo)');
  check((await pageErrors(page, errors)).length === 0, 'nessun errore');
  await ctx.close();

  ({ ctx, page, errors } = await context(browser, DESKTOP, { audioMode: 'slow' }));
  await page.goto(URL, { waitUntil: 'networkidle' });
  await heroIdle(page);
  await page.click('[data-audio]'); // accende: resume() impiega 600 ms
  await page.waitForTimeout(80);
  await page.click('[data-audio]'); // e lo si spegne prima che finisca
  await page.waitForTimeout(1500);
  const s = await page.evaluate(() => ({
    pressed: document.querySelector('[data-audio]').getAttribute('aria-pressed'),
    pref: localStorage.getItem('portfolio-audio'),
    r3: document.querySelector('[data-hero-step="r3"]').classList.contains('is-in'),
    resumed: window.__audio.resumed,
  }));
  const ev = sounds(await page.evaluate(() => window.__audio.events));
  check(s.resumed === 1 && s.pressed === 'false' && s.pref === 'off', `avvio lento e poi spento: resta spento (aria-pressed=${s.pressed}, scelta "${s.pref}")`);
  check(ev.length === 0 && s.r3 && (await heroState(page)) === 'idle', `nessun pop (${ev.length} suoni) e l'hero non riparte`);
  check((await pageErrors(page, errors)).length === 0, 'nessun errore');
  await ctx.close();
}

/** Tab dentro un blocco non ancora composto (i contatti), con l'audio acceso: composto subito e senza pop. */
async function focusCompose(browser) {
  console.log('\nblocchi · composti dal focus, senza pop');
  const { ctx, page, errors } = await context(browser, DESKTOP, { audioOn: true });
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.mouse.click(60, 600); // primo gesto: l'audio è attivo
  await heroIdle(page);
  // Si compone tutto fino ai servizi; i contatti restano sotto la soglia dell'88%, quindi non composti.
  const H = await page.evaluate(() => document.querySelector('#contatti').offsetTop - innerHeight * 0.95);
  for (let y = 0; y <= H; y += 300) {
    await page.evaluate((v) => window.scrollTo(0, v), Math.min(y, H));
    await page.waitForTimeout(150);
  }
  await page.evaluate((v) => window.scrollTo(0, v), H);
  await page.waitForFunction(() => document.querySelectorAll('#servizi [data-asm-state="composed"]').length === document.querySelectorAll('#servizi [data-asm]').length, null, { timeout: 10000 });
  await page.waitForTimeout(400);
  const before = await page.evaluate(() => ({ state: document.querySelector('[data-asm="contBox"]').dataset.asmState, n: window.__audio.events.length, running: window.__audio.contexts === 1 }));
  // Dall'ultimo elemento raggiungibile prima dei contatti, un Tab porta il focus su "Raccontamelo".
  await page.evaluate(() => {
    const c = document.querySelector('#contatti');
    const all = [...document.querySelectorAll('a[href], button')].filter((e) => e.tabIndex >= 0 && e.getClientRects().length && (e.compareDocumentPosition(c) & Node.DOCUMENT_POSITION_FOLLOWING));
    all[all.length - 1].focus({ preventScroll: true });
  });
  await page.evaluate(() => {
    window.__asmStates = [];
    new MutationObserver(() => window.__asmStates.push(document.querySelector('[data-asm="contBox"]').dataset.asmState))
      .observe(document.querySelector('[data-asm="contBox"]'), { attributes: true, attributeFilter: ['data-asm-state'] });
  });
  await page.keyboard.press('Tab');
  await page.waitForTimeout(1800);
  const after = await page.evaluate(() => ({ active: document.activeElement.textContent.trim(), state: document.querySelector('[data-asm="contBox"]').dataset.asmState, states: window.__asmStates }));
  const ev = sounds((await page.evaluate(() => window.__audio.events)).slice(before.n));
  check(before.running && before.state === 'waiting' && after.active === 'Raccontamelo', `Tab nei contatti non composti (stato "${before.state}"): focus su "${after.active}"`);
  check(after.state === 'composed' && !after.states.includes('composing') && ev.filter((x) => x.kind === 'pop').length === 0, `composto subito, senza animazione (${after.states.join(' → ') || 'nessun cambio'}) e senza pop (${ev.filter((x) => x.kind === 'pop').length})`);
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

/** Segna il primo elemento raggiungibile con Tab dopo l'elemento attivo (in ordine di documento, discendenti compresi). */
const markNextTabbable = (page) => page.evaluate(() => {
  const from = document.activeElement;
  document.querySelectorAll('[data-expect-next]').forEach((e) => e.removeAttribute('data-expect-next'));
  const next = [...document.querySelectorAll('a[href], button, input, select, textarea, [tabindex]')].find((e) =>
    e.tabIndex >= 0 && !e.disabled && !e.closest('[hidden], [inert]') && e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden' &&
    (from.compareDocumentPosition(e) & Node.DOCUMENT_POSITION_FOLLOWING));
  next?.setAttribute('data-expect-next', '');
  return next ? (next.getAttribute('aria-label') || next.textContent.trim().slice(0, 30) || next.className) : null;
});
/** Focus sulla sezione dopo la scelta di una voce: id, contorno e il Tab successivo. */
async function sectionFocus(page) {
  const f = await page.evaluate(() => ({ id: document.activeElement?.id, outline: getComputedStyle(document.activeElement).outlineStyle }));
  const next = await markNextTabbable(page);
  await page.keyboard.press('Tab');
  f.next = next;
  f.tabOk = next !== null && (await page.evaluate(() => document.activeElement.hasAttribute('data-expect-next')));
  return f;
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
    const focus = [];
    const targets = { '.lg-brick--path': 'percorso', '.lg-brick--proj': 'progetti', '.lg-brick--mail': 'contatti', '.lg-brick--case': 'caso' };
    for (const brick of Object.keys(targets)) {
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
      focus.push([targets[brick], await sectionFocus(page)]);
    }
    const bad = results.filter(([, s]) => s.open || s.expanded !== 'false' || s.focusInLogo || s.tips > 0 || s.lifted > 0 || s.cubes.some((c) => c > 10));
    check(bad.length === 0, `${dev}: dopo 4 voci scelte, anche con l'hover appiccicoso, il logo torna come prima (cubetti ${results[0][1].cubes.join('/')}px, nessun cubetto sollevato, nessuna nuvoletta, niente focus nel logo)${bad.length ? ' — ' + JSON.stringify(bad.map(([b, s]) => [b, s])) : ''}`);
    const badFocus = focus.filter(([id, f]) => f.id !== id || f.outline !== 'none' || !f.tabOk);
    check(badFocus.length === 0, `${dev}: al tocco il focus va alla sezione scelta, senza contorno, e il Tab successivo arriva al primo elemento dopo (${focus.map(([id, f]) => `#${id} → ${f.next}`).join(', ')})${badFocus.length ? ' — ' + JSON.stringify(badFocus) : ''}`);
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
  // Da tastiera e con il mouse: la voce scelta porta il focus alla sezione, senza contorno
  const { ctx, page, errors } = await context(browser, DESKTOP);
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.focus('[data-hdr-trigger]');
  await page.waitForTimeout(600);
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1500);
  const open = () => page.evaluate(() => document.querySelector('[data-hdr-zone]').classList.contains('lg-open'));
  const k = await sectionFocus(page);
  check(k.id === 'percorso' && !(await open()) && k.outline === 'none' && k.tabOk, `da tastiera: logo chiuso, focus sulla sezione scelta (#${k.id}) senza contorno (${k.outline}), poi Tab su "${k.next}"`);
  await page.mouse.move(700, 500);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);
  await page.hover('[data-hdr-trigger]', { position: { x: 12, y: 24 }, force: true });
  await page.waitForTimeout(700);
  await page.click('.lg-brick--proj');
  await page.mouse.move(700, 500);
  await page.waitForTimeout(1500);
  const m = await sectionFocus(page);
  check(m.id === 'progetti' && !(await open()) && m.outline === 'none' && m.tabOk, `con il mouse: logo chiuso, focus sulla sezione scelta (#${m.id}) senza contorno (${m.outline}), poi Tab su "${m.next}"`);
  check((await pageErrors(page, errors)).length === 0, 'nessun errore');
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
    await heroIdle(page);
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
  const browser = throttled(await chromium.launch());
  await audioScene(browser);
  await audioButton(browser);
  await audioReduced(browser);
  await audioLateScript(browser);
  await audioRobust(browser);
  await focusCompose(browser);
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
