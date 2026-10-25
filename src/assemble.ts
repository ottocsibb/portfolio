import { prefersReducedMotion } from './lib/motion';

// Composizione a cubi delle sezioni ("assembly" nel prototipo: asmDef, tileSeed, tick, renderVals).
const DURATION = 1200;
const DELAY_SCALE = 1500;
const START_LINE = 0.88;
const COLS = 6;
const MAX_ROWS = 4;
const TILES_PER_BLOCK = 24;
const GRAY = 'var(--c-chaos-2)';

/** Ordine dei blocchi di `asmDef` nel prototipo: decide quali semi tocca a ciascuno. */
const ORDER = [
  'caseHead', 'caseCtrl', 'caseBoard', 'caseCap',
  'percHead', 't1', 't2', 't3', 't4', 'skills',
  'projHead', 'p1', 'p2', 'p3', 'p4',
  'servHead', 's1', 's2', 's3', 's4',
  'contBox',
];

interface TileSeed { dx: number; dy: number; rot: number; lag: number }

interface Tile { el: HTMLElement; color: HTMLElement; colored: boolean; w: number; h: number }

type BlockState = 'waiting' | 'composing' | 'composed';

interface Block {
  key: string;
  el: HTMLElement;
  overlay: HTMLElement;
  color: string;
  delay: number;
  seeds: TileSeed[];
  state: BlockState;
  start: number;
  tiles: Tile[];
}

export interface AssembleHooks {
  /** Un blocco ha finito di comporsi (punto unico per il suono "pop" del Blocco 4). */
  onComposed?: (key: string) => void;
}

export interface AssembleController {
  isComposed(key: string): boolean;
  onChange(cb: (key: string, state: BlockState) => void): void;
}

/**
 * Semi delle tessere: stesso generatore del prototipo (seme 11). Nel prototipo la sequenza è condivisa
 * con l'hero, che consuma prima 36 × 8 numeri per i frammenti e 27 per il rimescolamento.
 */
function createSeeds(): Map<string, TileSeed[]> {
  let s = 11;
  const rnd = () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
  for (let i = 0; i < 36 * 8 + 27; i++) rnd();
  const out = new Map<string, TileSeed[]>();
  for (const key of ORDER) {
    const ts: TileSeed[] = [];
    for (let i = 0; i < TILES_PER_BLOCK; i++) {
      ts.push({ dx: (rnd() - 0.5) * 640, dy: 180 + rnd() * 320, rot: (rnd() - 0.5) * 70, lag: rnd() });
    }
    out.set(key, ts);
  }
  return out;
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

export function initAssemble(hooks: AssembleHooks = {}): AssembleController {
  const listeners: ((key: string, state: BlockState) => void)[] = [];
  const els = Array.from(document.querySelectorAll<HTMLElement>('[data-asm]'));
  const controller: AssembleController = {
    isComposed: (key) => blocks.find((b) => b.key === key)?.state === 'composed',
    onChange: (cb) => { listeners.push(cb); },
  };
  const blocks: Block[] = [];

  // "Riduci movimento" o JS assente: tutto è già composto, nessuna tessera.
  if (prefersReducedMotion()) {
    controller.isComposed = () => true;
    return controller;
  }

  const seeds = createSeeds();
  for (const el of els) {
    const overlay = el.closest('section')?.querySelector<HTMLElement>('[data-asm-overlay]');
    const key = el.dataset.asm ?? '';
    if (!overlay || !seeds.has(key)) continue;
    blocks.push({
      key, el, overlay,
      color: el.dataset.asmColor ?? GRAY,
      delay: parseFloat(el.dataset.asmDelay ?? '0') * DELAY_SCALE,
      seeds: seeds.get(key)!,
      state: 'waiting', start: 0, tiles: [],
    });
    el.dataset.asmState = 'waiting';
  }
  document.documentElement.classList.add('asm-on');

  let raf = 0;

  function setState(b: Block, state: BlockState): void {
    b.state = state;
    b.el.dataset.asmState = state;
    b.el.classList.toggle('asm-done', state === 'composed');
    if (state !== 'composing') b.el.style.removeProperty('opacity');
    for (const cb of listeners) cb(b.key, state);
  }

  function clearTiles(b: Block): void {
    for (const t of b.tiles) t.el.remove();
    b.tiles = [];
  }

  function compose(b: Block, now: number): void {
    if (b.state !== 'waiting') return;
    b.start = now + b.delay;
    setState(b, 'composing');
    wake();
  }

  function finish(b: Block, silent = false): void {
    clearTiles(b);
    setState(b, 'composed');
    if (!silent) hooks.onComposed?.(b.key);
  }

  function reset(b: Block): void {
    clearTiles(b);
    setState(b, 'waiting');
  }

  /**
   * Regola del prototipo sul bordo superiore del blocco: sopra l'88% dell'altezza parte,
   * sotto il 100% (interamente sotto lo schermo) si azzera, in mezzo non cambia nulla.
   * In più: un blocco interamente sopra lo schermo è subito composto.
   */
  function evaluate(now: number): void {
    const vh = window.innerHeight;
    for (const b of blocks) {
      const r = b.el.getBoundingClientRect();
      if (r.bottom <= 0) {
        if (b.state !== 'composed') finish(b, true);
      } else if (r.top > vh) {
        if (b.state !== 'waiting') reset(b);
      } else if (r.top < vh * START_LINE) {
        compose(b, now);
      }
    }
  }

  function makeTile(b: Block): Tile {
    const el = document.createElement('div');
    el.className = 'asm-tile';
    el.dataset.block = b.key;
    el.style.background = GRAY;
    const color = document.createElement('div');
    color.className = 'asm-tile__color';
    color.style.background = b.color;
    el.appendChild(color);
    b.overlay.appendChild(el);
    return { el, color, colored: false, w: -1, h: -1 };
  }

  /** Una frame della composizione di un blocco; restituisce true quando ha finito. */
  function drawBlock(b: Block, now: number, er: DOMRect, or: DOMRect): boolean {
    const e = clamp01((now - b.start) / DURATION);
    if (e >= 1) return true;
    const reveal = clamp01((e - 0.85) / 0.15);
    b.el.style.opacity = String(Math.round(reveal * 1000) / 1000);
    if (er.width < 2) return false;
    const rows = Math.max(1, Math.min(MAX_ROWS, Math.round(er.height / (er.width / COLS))));
    const n = COLS * rows;
    while (b.tiles.length < n) b.tiles.push(makeTile(b));
    while (b.tiles.length > n) b.tiles.pop()!.el.remove();

    const x0 = er.left - or.left, y0 = er.top - or.top;
    const tw = er.width / COLS, th = er.height / rows;
    const gap = 4 * (1 - reveal);
    const tileOpacity = Math.min(1, e * 5) * (1 - reveal);
    for (let i = 0; i < n; i++) {
      const t = b.tiles[i], sd = b.seeds[i];
      const te = clamp01((e - sd.lag * 0.3) / 0.55);
      const ee = 1 - Math.pow(1 - te, 3);
      const sc = 0.45 + 0.55 * ee;
      if (t.w !== tw || t.h !== th) {
        // Dimensione della cella: cambia solo se cambia il blocco (resize), non durante l'animazione.
        t.el.style.width = `${tw}px`;
        t.el.style.height = `${th}px`;
        t.w = tw;
        t.h = th;
      }
      const cx = x0 + (i % COLS) * tw + tw / 2 + sd.dx * (1 - ee);
      const cy = y0 + Math.floor(i / COLS) * th + th / 2 + sd.dy * (1 - ee);
      const sx = (Math.max(0, tw - gap) * sc) / tw;
      const sy = (Math.max(0, th - gap) * sc) / th;
      t.el.style.transform = `translate(${cx - tw / 2}px, ${cy - th / 2}px) rotate(${sd.rot * (1 - ee)}deg) scale(${sx}, ${sy})`;
      t.el.style.opacity = String(Math.round(tileOpacity * 1000) / 1000);
      // Nel prototipo il colore cambia a te > 0,7 con 400ms di transizione sul fondo:
      // qui è uno strato colorato che compare in dissolvenza (solo opacity).
      const colored = te > 0.7;
      if (colored !== t.colored) {
        t.color.classList.toggle('is-on', colored);
        t.colored = colored;
      }
    }
    return false;
  }

  function frame(now: number): void {
    raf = 0;
    let active = false;
    // Posizioni rilette a ogni frame (un resize o una rotazione a metà non sballano il mosaico):
    // prima tutte le letture, poi tutte le scritture, per non forzare il layout a ogni blocco.
    const running = blocks.filter((b) => b.state === 'composing');
    const rects = running.map((b) => [b.el.getBoundingClientRect(), b.overlay.getBoundingClientRect()] as const);
    running.forEach((b, i) => {
      if (drawBlock(b, now, rects[i][0], rects[i][1])) finish(b);
      else active = true;
    });
    if (active && !document.hidden) raf = requestAnimationFrame(frame);
  }

  function wake(): void {
    if (!raf && !document.hidden && blocks.some((b) => b.state === 'composing')) raf = requestAnimationFrame(frame);
  }

  // Posizione dei blocchi riletta solo quando la pagina scorre o cambia dimensione (una volta per frame).
  let pending = 0;
  const schedule = () => {
    if (pending) return;
    pending = requestAnimationFrame((now) => {
      pending = 0;
      evaluate(now);
    });
  };
  window.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('resize', schedule);
  document.addEventListener('visibilitychange', wake);

  // Tastiera: il focus dentro un blocco non ancora composto lo compone subito.
  document.addEventListener('focusin', (e) => {
    const el = (e.target as Element | null)?.closest<HTMLElement>('[data-asm]');
    const b = el && blocks.find((x) => x.el === el);
    if (b && b.state !== 'composed') finish(b);
  });

  // All'avvio (ricarica a metà pagina, link con #ancora) i blocchi già oltre l'88% sono composti subito,
  // senza animazione: altrimenti sparirebbero e ricomparirebbero sotto gli occhi.
  const vh = window.innerHeight;
  for (const b of blocks) {
    if (b.el.getBoundingClientRect().top < vh * START_LINE) finish(b, true);
  }

  return controller;
}
