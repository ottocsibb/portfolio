import type { AssembleController } from '../assemble';
import { req } from '../lib/dom';
import { prefersReducedMotion } from '../lib/motion';
import { MARKETS, MarketSim, mmss, type Status, type Task, type LogEntry } from './sim';

const PRIMA_MS = 5000;
const TICK_MS = 100;
const STEP_EVERY = 8; // un passo della simulazione ogni 800ms
const VISIBLE_RATIO = 0.35;

const CAPTIONS = {
  prima: 'Prima: ogni mercato con i suoi strumenti e nessuno stato condiviso. Per sapere cosa stava girando bisognava chiedere in giro.',
  dopo: 'Dopo: quattro mercati in un’unica vista. Sessioni, code, esecuzioni ed eventi in tempo reale, filtrabili per mercato.',
};

type View = 'prima' | 'dopo';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function tag(mkt: string): HTMLSpanElement {
  return el('span', 'mkt-tag', mkt);
}

/** Riusa i nodi già presenti (per id) e crea solo quelli nuovi, così le animazioni d'ingresso partono solo sui nuovi. */
function reconcile<T extends { id: number }>(
  box: HTMLElement, items: T[], create: (item: T) => HTMLElement, update: (node: HTMLElement, item: T) => void,
): void {
  const old = new Map<string, HTMLElement>();
  for (const c of Array.from(box.children) as HTMLElement[]) if (c.dataset.id) old.set(c.dataset.id, c);
  let prev: HTMLElement | null = null;
  for (const item of items) {
    const id = String(item.id);
    let node = old.get(id);
    if (node) old.delete(id);
    else {
      node = create(item);
      node.dataset.id = id;
    }
    update(node, item);
    const next: ChildNode | null = prev ? prev.nextSibling : box.firstChild;
    if (next !== node) box.insertBefore(node, next);
    prev = node;
  }
  for (const n of old.values()) n.remove();
}

export function initCase(assemble: AssembleController): void {
  const section = req('#caso');
  const board = req('[data-case-board]', section);
  const prima = req('[data-case-prima]', section);
  const dopo = req('[data-case-dopo]', section);
  const state = req('[data-case-state]', section);
  const caption = req('[data-case-caption]', section);
  const progress = req('[data-case-progress]', section);
  const progressBar = req('[data-case-progress-bar]', section);
  const toggles = Array.from(section.querySelectorAll<HTMLButtonElement>('[data-case-view]'));
  const reduce = prefersReducedMotion();

  const sim = new MarketSim();
  let view: View = 'prima';
  let auto = true;
  let autoSwitched = false;
  let filter = 'all';
  let primaMs = 0;
  let boardIn = false;
  let boardVisible = false;
  let ticks = 0;
  let timer = 0;

  // ---- Vista "Dopo": costruita una volta, aggiornata a ogni passo ----
  const cards = MARKETS.map((m) => {
    const b = el('button', 'mkt');
    b.type = 'button';
    const top = el('span', 'mkt__top');
    top.append(el('span', 'mkt__id', m.id));
    const pill = el('span', 'mkt__pill');
    top.append(pill);
    const timerEl = el('span', 'mkt__timer');
    const bar = el('span', 'mkt__bar');
    bar.setAttribute('aria-hidden', 'true');
    const fill = el('span', 'mkt__fill');
    bar.append(fill);
    const doneEl = el('span', 'mkt__done');
    const doneN = el('b');
    doneEl.append(doneN, document.createTextNode(' task eseguiti oggi'));
    b.append(top, el('span', 'mkt__name', m.name), timerEl, bar, doneEl);
    b.addEventListener('click', () => {
      filter = filter === m.id ? 'all' : m.id;
      renderDopo();
    });
    return { m, b, pill, timerEl, fill, doneN };
  });
  const mktGrid = el('div', 'mkts');
  cards.forEach((c, i) => {
    c.b.style.setProperty('--d', `${i * 80}ms`);
    mktGrid.append(c.b);
  });

  const tasksPanel = el('div', 'panel panel--tasks');
  const tasksHead = el('div', 'panel__head');
  const tasksTitle = el('span', 'panel__title');
  const showAll = el('button', 'chip-btn', 'Mostra tutti i mercati');
  showAll.type = 'button';
  showAll.addEventListener('click', () => {
    filter = 'all';
    renderDopo();
  });
  tasksHead.append(tasksTitle, showAll);
  const cols = el('div', 'cols');
  const mkCol = (title: string, mod: string) => {
    const col = el('div', `col col--${mod}`);
    // Spazio riservato per il numero massimo di task della colonna: l'altezza non cambia a ogni passo.
    const body = el('div', 'col__body');
    const list = el('div', 'col__list');
    const empty = el('div', 'col__empty', 'Nessun task');
    body.append(list, empty);
    col.append(el('div', 'col__title', title), body);
    cols.append(col);
    return { list, empty };
  };
  const qCol = mkCol('In coda', 'queue');
  const rCol = mkCol('In esecuzione', 'run');
  const dCol = mkCol('Eseguiti', 'done');
  tasksPanel.append(tasksHead, cols);

  const side = el('div', 'dopo__side');
  const logPanel = el('div', 'panel');
  const logList = el('div', 'log');
  logPanel.append(el('div', 'panel__label', 'Eventi'), logList);
  const chartPanel = el('div', 'panel');
  const chart = el('div', 'chart');
  chart.setAttribute('aria-hidden', 'true');
  const bars = Array.from({ length: 14 }, () => chart.appendChild(el('div', 'chart__bar')));
  chartPanel.append(el('div', 'panel__label', 'Task completati nel tempo'), chart);
  side.append(logPanel, chartPanel);

  const row = el('div', 'dopo__row');
  row.append(tasksPanel, side);
  dopo.append(mktGrid, row);

  const live = el('div', 'board__live');
  const liveDot = el('span', 'live-dot');
  liveDot.setAttribute('aria-hidden', 'true');
  const liveText = el('span');
  live.append(liveDot, liveText);
  const noView = el('div', 'board__state', 'Nessuna vista d’insieme');
  state.replaceWith(noView);
  noView.after(live);

  const PILL: Record<Status, string> = { 'In chiusura': 'is-closing', Aperto: 'is-open', 'Esiti in arrivo': 'is-results' };

  function renderTasks(): void {
    const keep = (t: Task) => filter === 'all' || t.mkt === filter;
    const q = sim.queue.filter(keep).slice(0, 4);
    const r = sim.run.filter(keep);
    const d = sim.done.filter(keep).slice(0, 4);
    reconcile(qCol.list, q, (t) => {
      const n = el('div', 'task task--queue rise');
      n.append(tag(t.mkt), el('span', 'task__name', t.name));
      return n;
    }, () => {});
    reconcile(rCol.list, r, (t) => {
      const n = el('div', 'task task--run');
      const line = el('span', 'task__line');
      line.append(tag(t.mkt), el('span', 'task__name', t.name));
      const bar = el('div', 'task__bar');
      bar.setAttribute('aria-hidden', 'true');
      bar.append(el('div', 'task__fill'));
      n.append(line, bar);
      return n;
    }, (n, t) => {
      (n.querySelector('.task__fill') as HTMLElement).style.transform = `scaleX(${Math.round(t.p) / 100})`;
    });
    reconcile(dCol.list, d, (t) => {
      const n = el('div', 'task task--done');
      n.append(tag(t.mkt), el('span', 'task__name', `✓ ${t.name}`));
      return n;
    }, (n, t) => n.classList.toggle('is-fresh', t.fresh > 0));
    qCol.empty.hidden = q.length > 0;
    rCol.empty.hidden = r.length > 0;
    dCol.empty.hidden = d.length > 0;
  }

  function renderDopo(): void {
    for (const c of cards) {
      const ms = sim.status(c.m);
      c.pill.textContent = ms.status;
      c.pill.className = `mkt__pill ${PILL[ms.status]}`;
      c.timerEl.textContent = `${ms.label} ${mmss(ms.rem)}`;
      c.fill.style.transform = `scaleX(${Math.round(ms.sess * 100) / 100})`;
      c.fill.classList.toggle('is-closing', ms.status === 'In chiusura');
      c.doneN.textContent = String(sim.doneBy[c.m.id]);
      const on = filter === c.m.id;
      c.b.setAttribute('aria-pressed', String(on));
      c.b.classList.toggle('is-selected', on);
    }
    tasksTitle.textContent = `Task · ${filter === 'all' ? 'tutti i mercati' : filter}`;
    // Nascosto con visibility: tiene il suo spazio (l'intestazione non cambia altezza) ed esce da Tab e screen reader.
    showAll.classList.toggle('is-off', filter === 'all');
    renderTasks();
    reconcile(logList, sim.log, (e: LogEntry) => {
      const n = el('div', 'log__row');
      n.append(el('span', 'log__time', e.time), tag(e.mkt), el('span', 'log__text', e.text));
      return n;
    }, (n, e) => n.classList.toggle('is-fresh', e.fresh > 0));
    sim.bars.forEach((v, i) => {
      bars[i].style.transform = `scaleY(${Math.round((v / 12) * 100) / 100})`;
      bars[i].classList.toggle('is-last', i === sim.bars.length - 1);
    });
    liveText.textContent = `LIVE · 4 mercati · ${sim.clock()}`;
  }

  /** Fa ripartire le animazioni d'ingresso ("rise") quando una vista ricompare. */
  function replayEntrance(box: HTMLElement): void {
    box.classList.remove('is-entering');
    void box.offsetWidth;
    box.classList.add('is-entering');
  }

  function setView(v: View): void {
    const changed = v !== view;
    view = v;
    const isDopo = v === 'dopo';
    for (const t of toggles) t.setAttribute('aria-pressed', String(t.dataset.caseView === v));
    prima.hidden = isDopo;
    dopo.hidden = !isDopo;
    noView.hidden = isDopo;
    live.hidden = !isDopo;
    caption.textContent = CAPTIONS[v];
    if (isDopo) renderDopo();
    if (changed && !reduce) replayEntrance(isDopo ? dopo : prima);
    renderProgress();
  }

  function renderProgress(): void {
    const on = view === 'prima' && auto && primaMs > 0;
    progress.classList.toggle('is-visible', on);
    progressBar.style.transform = `scaleX(${primaMs / PRIMA_MS})`;
  }

  toggles.forEach((t) => {
    t.addEventListener('click', () => {
      // Clic sull'interruttore: da qui comanda l'utente, niente più passaggi automatici.
      auto = false;
      autoSwitched = false;
      setView(t.dataset.caseView === 'dopo' ? 'dopo' : 'prima');
    });
  });

  // "Riduci movimento": vista "Dopo" con dati fermi, interruttore solo manuale.
  if (reduce) {
    auto = false;
    setView('dopo');
    return;
  }

  function tick(): void {
    // "Effettiva visibilità": almeno il 35% della dashboard, già composta, con la scheda attiva.
    if (auto && view === 'prima' && boardVisible && assemble.isComposed('caseBoard')) {
      primaMs += TICK_MS;
      if (primaMs >= PRIMA_MS) {
        primaMs = 0;
        autoSwitched = true;
        setView('dopo');
      }
      renderProgress();
    }
    ticks++;
    if (ticks % STEP_EVERY === 0 && view === 'dopo') {
      sim.step();
      renderDopo();
    }
  }

  /** Timer e animazioni CSS del caso studio girano solo con la dashboard sullo schermo e la scheda attiva. */
  function updateRunning(): void {
    const run = boardIn && !document.hidden;
    section.classList.toggle('is-paused', !run);
    if (run && !timer) timer = window.setInterval(tick, TICK_MS);
    if (!run && timer) {
      window.clearInterval(timer);
      timer = 0;
    }
  }

  // Quando la dashboard cambia altezza (Prima ↔ Dopo, filtro) il contenuto sotto si sposta senza scroll.
  // Se la dashboard è interamente sopra lo schermo (ritorno automatico a "Prima" scorrendo via),
  // lo scroll compensa la differenza: ciò che l'utente sta guardando resta fermo. Il browser a volte
  // lo fa già da sé (scroll anchoring): si compensa solo la parte che manca, mai due volte.
  // In ogni caso i blocchi a cubi vengono rivalutati, così nessuno resta invisibile.
  let lastScrollY = window.scrollY;
  window.addEventListener('scroll', () => { lastScrollY = window.scrollY; }, { passive: true });
  // Con un resize o una rotazione si ridispone tutta la pagina, non solo la dashboard: lì non si
  // compensa e si lascia fare al browser. Il segnale resta acceso fino ai callback del frame dopo.
  let viewportChanged = false;
  let vw = window.innerWidth, vh = window.innerHeight;
  window.addEventListener('resize', () => {
    viewportChanged = true;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      viewportChanged = false;
      vw = window.innerWidth;
      vh = window.innerHeight;
    }));
  });
  let boardH = board.offsetHeight;
  new ResizeObserver(() => {
    const h = board.offsetHeight;
    const delta = h - boardH;
    boardH = h;
    if (delta === 0) return;
    const r = board.getBoundingClientRect();
    const anchored = window.scrollY - lastScrollY;
    // Dov'era il fondo della dashboard prima del cambio, rispetto allo schermo.
    const oldBottom = r.top + anchored + (h - delta);
    const resized = viewportChanged || window.innerWidth !== vw || window.innerHeight !== vh;
    if (!resized && oldBottom <= 0) {
      const missing = delta - anchored;
      if (Math.abs(missing) >= 1) window.scrollBy({ top: missing, behavior: 'instant' });
    }
    lastScrollY = window.scrollY;
    assemble.refresh();
  }).observe(board);

  new IntersectionObserver((entries) => {
    const e = entries[entries.length - 1];
    boardIn = e.isIntersecting;
    boardVisible = e.isIntersecting && e.intersectionRatio >= VISIBLE_RATIO - 0.001;
    if (!boardIn) {
      // Dashboard interamente fuori schermo: il conto si azzera; dopo un passaggio automatico si riparte da "Prima".
      if (auto && view === 'prima') primaMs = 0;
      if (autoSwitched) {
        autoSwitched = false;
        primaMs = 0;
        filter = 'all';
        setView('prima');
      }
      renderProgress();
    }
    updateRunning();
  }, { threshold: [0, VISIBLE_RATIO] }).observe(board);

  document.addEventListener('visibilitychange', updateRunning);
  setView('prima');
  updateRunning();
}
