import { req } from '../lib/dom';
import { prefersReducedMotion } from '../lib/motion';

// Timeline in millisecondi, come `this.T` nel prototipo.
const T = {
  text1: 900, pile: 2600, lanes: 3400, text2: 3400, close: 4100, step: 45,
  rect: 5500, mark: 6300, r1: 6900, r2: 7150, r3: 7400, r4: 7900,
};
const TEXT_STEPS: Record<string, number> = { w1: T.text1, w2: T.text2, r1: T.r1, r2: T.r2, r3: T.r3, r4: T.r4 };

const N = 36;
const GRAYS = ['#C5CCD8', '#A3ADBF', '#7D889C', '#5B6880', '#8E99AD'];
const BLUE = '#2C3E66';
const ACCENT = '#F26A1B';
const LANE_STROKE = '#C5CCD8';
const CORNER = 14;
const PUSH_RADIUS = 120;
const PUSH_FORCE = 70;

type RGB = [number, number, number];
type Corners = [number, number, number, number];

interface Seed {
  fx: number; w: number; h: number; round: boolean; a: number; spin: number; v0: number; c: string; spawn: number;
}
interface Piece {
  x: number; y: number; w: number; h: number; a: number; r: number;
  rgb: RGB; vy: number; landed: boolean; ox: number; oy: number;
}
interface Target { x: number; y: number; w: number; h: number; a: number; r: number; c: string }
interface Rect { x: number; y: number; w: number; h: number }

function hexToRgb(hex: string): RGB {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Stessa sequenza pseudo-casuale del prototipo (seme 11): i pezzi cadono sempre allo stesso modo. */
function createSeeds(): { seeds: Seed[]; rank: number[] } {
  let s = 11;
  const rnd = () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
  const seeds: Seed[] = [];
  for (let i = 0; i < N; i++) {
    const fx = 0.08 + rnd() * 0.84;
    const w = 14 + rnd() * 50;
    const h = 10 + rnd() * 34;
    const round = rnd() < 0.25;
    const a = (rnd() - 0.5) * 80;
    const spin = (rnd() - 0.5) * 360;
    const v0 = 120 + rnd() * 260;
    const c = GRAYS[Math.floor(rnd() * GRAYS.length)];
    seeds.push({ fx, w, h, round, a, spin, v0, c, spawn: 2000 * Math.sqrt(i / N) });
  }
  // Ordine in cui i 28 task ancora aperti passano nella corsia dei completati.
  const order = Array.from({ length: 28 }, (_, j) => j);
  for (let k = 27; k > 0; k--) {
    const r = Math.floor(rnd() * (k + 1));
    [order[k], order[r]] = [order[r], order[k]];
  }
  const rank: number[] = [];
  order.forEach((piece, pos) => { rank[piece] = pos; });
  return { seeds, rank };
}

export interface HeroController {
  replay(): void;
}

export function initHero(): HeroController | null {
  const stage = req<HTMLElement>('#top');
  const fx = req('[data-hero-fx]', stage);
  const word = req('[data-hero-word]', stage);
  const replayBtn = req<HTMLButtonElement>('[data-hero-replay]', stage);
  const steps = Array.from(stage.querySelectorAll<HTMLElement>('[data-hero-step]'));

  // "Riduci movimento": resta lo stato fermo del CSS, con l'evidenziatore dietro "soluzione".
  if (prefersReducedMotion()) {
    document.documentElement.classList.remove('hero-pending');
    return null;
  }

  const canvas = document.createElement('canvas');
  fx.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    document.documentElement.classList.remove('hero-pending');
    return null;
  }

  // Connessione lenta: se il fallback del <head> ha già mostrato lo stato fermo,
  // l'hero parte dalla scena finita invece di ricominciare.
  const root = document.documentElement;
  const w = window as Window & { __heroFallback?: number };
  window.clearTimeout(w.__heroFallback);
  const skipIntro = root.classList.contains('hero-fallback');

  const { seeds, rank } = createSeeds();
  const pcs: Piece[] = [];
  let W = stage.clientWidth;
  let H = stage.clientHeight;
  let dpr = 1;
  let tt = 0;
  let last = 0;
  let raf = 0;
  let mx = -9999;
  let my = -9999;
  let laneAlpha = 0;
  let wr: Rect | null = null;
  let wordDirty = true;
  let pileKey = '';
  let pileArr: number[] = [];
  let onScreen = true;

  function resetPieces(): void {
    for (let i = 0; i < N; i++) {
      const sd = seeds[i];
      pcs[i] = {
        x: sd.fx * W, y: -80,
        w: sd.w, h: sd.round ? sd.w : sd.h,
        a: 0, r: sd.round ? sd.w / 2 : 3, rgb: hexToRgb(sd.c),
        vy: sd.v0, landed: false, ox: 0, oy: 0,
      };
    }
  }

  /** Altezza a cui ogni pezzo si posa nel mucchio, a colonne larghe 64px. */
  function pile(): number[] {
    const key = `${Math.round(W)}x${Math.round(H)}`;
    if (pileKey === key) return pileArr;
    const floor = H - 36, bw = 64, stack: Record<number, number> = {};
    pileArr = seeds.map((sd) => {
      const h = sd.round ? sd.w : sd.h;
      const b = Math.floor((sd.fx * W) / bw);
      const st = stack[b] ?? 0;
      stack[b] = st + h * 0.8;
      return floor - st - h / 2;
    });
    pileKey = key;
    return pileArr;
  }

  /** Corsie e rettangolo, ridimensionati sulla larghezza dell'hero (formule del prototipo). */
  function layout() {
    const cx = W / 2, cy = H * 0.62;
    let laneW = Math.min(W - 160, 960);
    if (laneW < 200) laneW = W - 40;
    const step = Math.min(48, (laneW - 24) / 16);
    let bigW = Math.min(W - 200, 840);
    if (bigW < 200) bigW = W - 48;
    const tile = bigW / 12;
    return {
      cx, cy, laneW, step, cw: step * 0.8,
      laneLeft: cx - laneW / 2,
      laneY: [cy - 90, cy, cy + 90],
      sub: (laneW - 24) / 18,
      bigW, tile, tileH: Math.min(56, tile),
    };
  }
  type Layout = ReturnType<typeof layout>;

  function lanePos(L: Layout, lane: number, idx: number, c: string): Target {
    return { x: L.laneLeft + 12 + L.step / 2 + idx * L.step, y: L.laneY[lane], w: L.cw, h: 26, a: 0, r: 3, c };
  }

  /** Indice del pezzo nel rettangolo 12×3: prima gli 8 già chiusi, poi gli altri nell'ordine di chiusura. */
  function tileIndex(i: number): number {
    return i >= 28 ? i - 28 : 8 + rank[i];
  }

  function target(i: number, L: Layout): Target {
    const sd = seeds[i];
    if (tt < T.lanes) {
      return { x: sd.fx * W, y: pile()[i], w: sd.w, h: sd.round ? sd.w : sd.h, a: sd.a, r: sd.round ? sd.w / 2 : 3, c: sd.c };
    }
    if (tt < T.close) {
      if (i < 16) return lanePos(L, 0, i, BLUE);
      if (i < 28) return lanePos(L, 1, i - 16, BLUE);
      return lanePos(L, 2, i - 28, ACCENT);
    }
    const k = tileIndex(i);
    if (tt >= T.mark && wr) {
      const tw = wr.w / 12, th = wr.h / 3;
      return { x: wr.x + tw / 2 + (k % 12) * tw, y: wr.y + th / 2 + Math.floor(k / 12) * th, w: tw + 2, h: th + 2, a: 0, r: 0, c: ACCENT };
    }
    if (tt >= T.rect) {
      return {
        x: L.cx - L.bigW / 2 + L.tile / 2 + (k % 12) * L.tile,
        y: L.cy - 1.5 * L.tileH + L.tileH / 2 + Math.floor(k / 12) * L.tileH,
        w: L.tile + 1, h: L.tileH + 1, a: 0, r: 0, c: ACCENT,
      };
    }
    const closed = i >= 28 || tt >= T.close + rank[i] * T.step;
    if (!closed) return i < 16 ? lanePos(L, 0, i, BLUE) : lanePos(L, 1, i - 16, BLUE);
    return {
      x: L.laneLeft + 12 + L.sub / 2 + (k % 18) * L.sub,
      y: L.laneY[2] - 8 + Math.floor(k / 18) * 16,
      w: L.sub - 4, h: 12, a: 0, r: 2, c: ACCENT,
    };
  }

  function measureWord(): void {
    const a = word.getBoundingClientRect();
    const b = stage.getBoundingClientRect();
    if (a.width > 0) wr = { x: a.left - b.left, y: a.top - b.top, w: a.width, h: a.height };
    wordDirty = false;
  }

  function resize(): void {
    W = stage.clientWidth;
    H = stage.clientHeight;
    dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    wordDirty = true;
  }

  /** Avanza la scena di dt secondi; restituisce quanto si è mosso il pezzo più veloce. */
  function step(dt: number): number {
    const L = layout();
    const pl = pile();
    // I fattori del prototipo valgono per frame a 60 fps: li rendo indipendenti dal frame rate.
    const follow = 1 - Math.pow(1 - 0.13, dt * 60);
    const pushF = 1 - Math.pow(1 - 0.2, dt * 60);
    const fade = 1 - Math.exp(-dt / 0.15);
    let moved = 0;

    for (let i = 0; i < N; i++) {
      const p = pcs[i], sd = seeds[i];
      const bx = p.x, by = p.y, box = p.ox, boy = p.oy, bc = p.rgb[0] + p.rgb[1] + p.rgb[2];
      if (tt < T.pile) {
        // Cascata: gravità e piccoli rimbalzi fino al mucchio.
        p.x = sd.fx * W;
        const pdt = Math.min(0.05, dt);
        if (tt >= sd.spawn && !p.landed) {
          p.vy += 2200 * pdt;
          p.y += p.vy * pdt;
          p.a += sd.spin * pdt;
          if (p.y >= pl[i]) {
            p.y = pl[i];
            if (Math.abs(p.vy) < 180) { p.vy = 0; p.landed = true; } else { p.vy = -p.vy * 0.32; }
          }
        }
        if (p.landed) p.a += (sd.a - p.a) * Math.min(1, pdt * 12);
      } else {
        const tg = target(i, L);
        p.x += (tg.x - p.x) * follow;
        p.y += (tg.y - p.y) * follow;
        p.w += (tg.w - p.w) * follow;
        p.h += (tg.h - p.h) * follow;
        p.a += (tg.a - p.a) * follow;
        p.r += (tg.r - p.r) * follow;
        // Cambio di colore morbido, come la transizione di 450ms del prototipo.
        const c = hexToRgb(tg.c);
        for (let ch = 0; ch < 3; ch++) {
          const d = c[ch] - p.rgb[ch];
          p.rgb[ch] = Math.abs(d) < 1 ? c[ch] : p.rgb[ch] + d * fade;
        }
      }
      // Il mouse spinge i pezzi entro 120px; tornano al loro posto quando si allontana.
      const dx = p.x - mx, dy = p.y - my;
      const d = Math.hypot(dx, dy);
      let px = 0, py = 0;
      if (d < PUSH_RADIUS && d > 0.01) {
        const f = (PUSH_RADIUS - d) / PUSH_RADIUS;
        px = (dx / d) * f * PUSH_FORCE;
        py = (dy / d) * f * PUSH_FORCE;
      }
      p.ox += (px - p.ox) * pushF;
      p.oy += (py - p.oy) * pushF;
      const dc = Math.abs(p.rgb[0] + p.rgb[1] + p.rgb[2] - bc);
      moved = Math.max(moved, Math.abs(p.x - bx) + Math.abs(p.y - by) + Math.abs(p.ox - box) + Math.abs(p.oy - boy) + dc);
    }

    // Corsie tratteggiate: visibili da 3400 a 5400 ms, dissolvenza di 600ms.
    const laneTarget = tt > T.lanes && tt < T.rect - 100 ? 1 : 0;
    const la = laneAlpha;
    laneAlpha += Math.sign(laneTarget - laneAlpha) * Math.min(Math.abs(laneTarget - laneAlpha), dt / 0.6);
    moved = Math.max(moved, Math.abs(laneAlpha - la) * 100);
    return moved;
  }

  function pathRoundRect(x: number, y: number, w: number, h: number, rr: Corners): void {
    // Come border-radius: i raggi si riducono solo se due angoli dello stesso lato non ci stanno.
    const f = Math.min(1, w / (rr[0] + rr[1] || 1), w / (rr[3] + rr[2] || 1), h / (rr[0] + rr[3] || 1), h / (rr[1] + rr[2] || 1));
    const [tl, tr, br, bl] = rr.map((r) => Math.max(0, r * f));
    ctx!.beginPath();
    ctx!.moveTo(x + tl, y);
    ctx!.lineTo(x + w - tr, y);
    ctx!.arcTo(x + w, y, x + w, y + tr, tr);
    ctx!.lineTo(x + w, y + h - br);
    ctx!.arcTo(x + w, y + h, x + w - br, y + h, br);
    ctx!.lineTo(x + bl, y + h);
    ctx!.arcTo(x, y + h, x, y + h - bl, bl);
    ctx!.lineTo(x, y + tl);
    ctx!.arcTo(x, y, x + tl, y, tl);
    ctx!.closePath();
  }

  function draw(): void {
    const c = ctx!;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, W, H);

    if (laneAlpha > 0.001) {
      const L = layout();
      c.save();
      c.globalAlpha = laneAlpha;
      c.strokeStyle = LANE_STROKE;
      c.lineWidth = 1.5;
      c.setLineDash([5, 4]);
      for (const y of L.laneY) {
        pathRoundRect(Math.round(L.laneLeft - 4) + 0.75, Math.round(y - 30) + 0.75, Math.round(L.laneW + 8) - 1.5, 58.5, [CORNER, CORNER, CORNER, CORNER]);
        c.stroke();
      }
      c.restore();
    }

    const inMark = tt >= T.mark && !!wr;
    for (let i = 0; i < N; i++) {
      const p = pcs[i];
      let corners: Corners;
      if (inMark) {
        // Evidenziatore: solo l'angolo esterno dei 4 pezzi d'angolo è arrotondato.
        const k = tileIndex(i);
        corners = [k === 0 ? CORNER : 0, k === 11 ? CORNER : 0, k === 35 ? CORNER : 0, k === 24 ? CORNER : 0];
      } else {
        corners = [p.r, p.r, p.r, p.r];
      }
      c.fillStyle = `rgb(${Math.round(p.rgb[0])}, ${Math.round(p.rgb[1])}, ${Math.round(p.rgb[2])})`;
      if (Math.abs(p.a) < 0.01) {
        // Pezzi dritti allineati ai pixel reali (il prototipo arrotonda al pixel): bordi netti,
        // così i pezzi affiancati dell'evidenziatore non lasciano righine.
        const snap = (v: number) => Math.round(v * dpr) / dpr;
        const x0 = snap(p.x + p.ox - p.w / 2), y0 = snap(p.y + p.oy - p.h / 2);
        const x1 = snap(p.x + p.ox + p.w / 2), y1 = snap(p.y + p.oy + p.h / 2);
        pathRoundRect(x0, y0, x1 - x0, y1 - y0, corners);
        c.fill();
        continue;
      }
      c.save();
      c.translate(p.x + p.ox, p.y + p.oy);
      c.rotate((p.a * Math.PI) / 180);
      pathRoundRect(-p.w / 2, -p.h / 2, p.w, p.h, corners);
      c.fill();
      c.restore();
    }
  }

  function updateText(): void {
    for (const el of steps) {
      const at = TEXT_STEPS[el.dataset.heroStep ?? ''];
      el.classList.toggle('is-in', at !== undefined && tt > at);
    }
  }

  function canRun(): boolean {
    return onScreen && !document.hidden;
  }

  function frame(now: number): void {
    raf = 0;
    if (!canRun()) {
      stage.dataset.heroState = 'paused';
      return;
    }
    // Il tempo della scena avanza solo mentre gira: fuori schermo o a scheda nascosta resta fermo.
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    tt += dt * 1000;
    // Si misura quando il titolo è fermo (il sollevamento di "alla soluzione." finisce a 4100 ms).
    if (wordDirty && tt >= T.mark) measureWord();
    const moved = step(dt);
    updateText();
    draw();
    const idle = tt > T.r4 + 500 && moved < 0.05;
    if (idle) {
      stage.dataset.heroState = 'idle';
      return;
    }
    stage.dataset.heroState = 'running';
    raf = requestAnimationFrame(frame);
  }

  function wake(): void {
    if (raf || !canRun()) return;
    last = performance.now();
    raf = requestAnimationFrame(frame);
  }

  function replay(): void {
    tt = 0;
    laneAlpha = 0;
    mx = my = -9999;
    resetPieces();
    updateText();
    wake();
  }

  stage.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse') return;
    const rc = stage.getBoundingClientRect();
    mx = e.clientX - rc.left;
    my = e.clientY - rc.top;
    wake();
  });
  stage.addEventListener('pointerleave', () => {
    mx = my = -9999;
    wake();
  });
  replayBtn.addEventListener('click', replay);

  new ResizeObserver(() => {
    resize();
    wake();
  }).observe(stage);

  new IntersectionObserver((entries) => {
    onScreen = entries[entries.length - 1].isIntersecting;
    wake();
  }).observe(stage);

  document.addEventListener('visibilitychange', wake);

  // "soluzione" si misura solo con i font definitivi, e di nuovo a ogni resize.
  document.fonts.ready.then(() => {
    wordDirty = true;
    wake();
  });

  /** Porta la scena alla fine: testi entrati, pezzi già composti nell'evidenziatore. */
  function jumpToEnd(): void {
    laneAlpha = 0;
    measureWord();
    const L = layout();
    for (let i = 0; i < N; i++) {
      const tg = target(i, L);
      Object.assign(pcs[i], { x: tg.x, y: tg.y, w: tg.w, h: tg.h, a: tg.a, r: tg.r, rgb: hexToRgb(tg.c), landed: true });
    }
  }

  // hero--live e lo stato dei testi cambiano insieme, prima di qualunque lettura del layout:
  // così con skipIntro i testi già visibili non ripartono da opacità 0.
  if (skipIntro) tt = T.r4 + 1000;
  stage.classList.add('hero--live');
  updateText();
  root.classList.remove('hero-pending', 'hero-fallback');

  resize();
  resetPieces();
  if (skipIntro) {
    jumpToEnd();
    // Disegno subito, prima del prossimo frame: l'evidenziatore non scompare nemmeno per un istante.
    draw();
  }
  wake();

  return { replay };
}
