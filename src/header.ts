import { req } from './lib/dom';
import { scrollBehavior } from './lib/motion';

const SECTIONS = ['caso', 'percorso', 'progetti', 'servizi', 'contatti'] as const;
type SectionId = (typeof SECTIONS)[number];

const SECTION_NAMES: Record<SectionId, string> = {
  caso: 'Caso studio',
  percorso: 'Percorso',
  progetti: 'Progetti',
  servizi: 'Servizi',
  contatti: 'Contatti',
};

const SECTION_COLORS: Record<SectionId, string> = {
  caso: 'var(--c-chaos-2)',
  percorso: 'var(--c-blue)',
  progetti: 'var(--c-night)',
  servizi: 'var(--c-chaos-1)',
  contatti: 'var(--c-accent)',
};

const ZONE_H = 48;
const GAP = 8;
const LOGO_CELL = 9;
// Sotto i 640px di finestra: mattoncini in colonna e "Tocca il logo" sotto il nome. Soglia fissa sulla
// finestra (nel prototipo era la larghezza della zona del logo, che però cambia con la lunghezza dell'invito).
const NARROW_QUERY = window.matchMedia('(max-width: 639.98px)');
const CLOSE_DELAY = 350;
const REOPEN_GUARD = 450;

export interface HeaderHooks {
  /** Chiamato ogni volta che i mattoncini si aprono (per il suono "pop"). */
  onOpen?: () => void;
}

export function initHeader(hooks: HeaderHooks = {}): void {
  const zone = req('[data-hdr-zone]');
  const trigger = req<HTMLButtonElement>('[data-hdr-trigger]');
  const name = req('[data-hdr-name]');
  const hintSm = req('[data-hdr-hint-sm]');
  const hint = req('[data-hdr-hint]');
  const cur = req('[data-hdr-cur]');
  const dot = req('[data-hdr-dot]');
  const label = req('[data-hdr-label]');

  const slots = Array.from(zone.querySelectorAll<HTMLElement>('[data-hdr-slot]'));
  const bricks = slots.map((s) => s.querySelector<HTMLButtonElement>('.lg-brick')!);
  const icons = bricks.map((b) => b.querySelector<HTMLElement>('.lg-icon')!);

  let open = false;
  let ever = false;
  let narrow = false;
  let active: SectionId | '' = '';
  let openedAt = 0;
  let closeTimer = 0;
  let refocusing = false;
  let holdClosedUntil = 0;

  function render(): void {
    const size = narrow ? 44 : 40;
    const top = (ZONE_H - size) / 2;

    slots.forEach((slot, i) => {
      // Posizione finale: in fila (desktop) o in colonna sotto l'header (mobile).
      const fx = narrow ? 0 : i * (size + GAP);
      const fy = narrow ? 60 + i * (size + GAP) : top;
      // A riposo: cubetto 9×9 nella griglia 2×2 del logo.
      const cx = (i % 2) * 12 + LOGO_CELL / 2;
      const cy = 13.5 + Math.floor(i / 2) * 12 + LOGO_CELL / 2;
      const tx = Math.round((cx - (fx + size / 2)) * 10) / 10;
      const ty = Math.round((cy - (fy + size / 2)) * 10) / 10;
      const s = Math.round((LOGO_CELL / size) * 1000) / 1000;

      slot.style.left = `${fx}px`;
      slot.style.top = `${fy}px`;
      slot.style.width = `${size}px`;
      slot.style.height = `${size}px`;
      slot.style.transform = open ? 'translate(0px, 0px) scale(1)' : `translate(${tx}px, ${ty}px) scale(${s})`;
      slot.style.transitionDelay = `${open ? i * 45 : (3 - i) * 35}ms`;
      icons[i].style.transitionDelay = `${open ? 180 + i * 45 : 0}ms`;

      const brick = bricks[i];
      brick.tabIndex = open ? 0 : -1;
      brick.setAttribute('aria-current', active === brick.dataset.target ? 'location' : 'false');
    });

    const rowW = 4 * 40 + 3 * GAP;
    name.style.transform = `translateX(${open && !narrow ? rowW + 16 - 36 : 0}px)`;
    zone.classList.toggle('lg-open', open);
    zone.classList.toggle('lg-showtips', open && narrow);
    trigger.setAttribute('aria-expanded', String(open));

    hintSm.hidden = ever || !narrow;
    if (active) {
      cur.hidden = false;
      hint.hidden = true;
      dot.style.background = SECTION_COLORS[active];
      label.textContent = SECTION_NAMES[active];
    } else {
      cur.hidden = true;
      hint.hidden = false;
      hint.textContent = ever || narrow ? '' : '← Passa sul logo per esplorare';
    }
  }

  function openBricks(): void {
    window.clearTimeout(closeTimer);
    // Subito dopo la scelta di una voce il logo non si riapre da solo (focus restituito, tocchi emulati).
    if (open || Date.now() < holdClosedUntil) return;
    open = true;
    ever = true;
    openedAt = Date.now();
    render();
    hooks.onOpen?.();
  }

  function closeBricks(): void {
    window.clearTimeout(closeTimer);
    if (!open) return;
    open = false;
    render();
  }

  // L'hover vale solo per il mouse: su touch comanda il tocco sul logo,
  // altrimenti il "leave" sintetico dopo il tocco richiuderebbe subito.
  zone.addEventListener('pointerenter', (e) => {
    if (e.pointerType === 'mouse') openBricks();
  });
  zone.addEventListener('pointerleave', (e) => {
    if (e.pointerType !== 'mouse') return;
    window.clearTimeout(closeTimer);
    closeTimer = window.setTimeout(closeBricks, CLOSE_DELAY);
  });
  // Su touch, un tocco fuori dal logo chiude (come il "leave" del mouse nel prototipo).
  document.addEventListener('pointerdown', (e) => {
    if (open && e.pointerType !== 'mouse' && !zone.contains(e.target as Node)) closeBricks();
  });
  zone.addEventListener('focusin', () => {
    if (!refocusing) openBricks();
  });
  zone.addEventListener('focusout', () => {
    window.setTimeout(() => {
      if (!zone.contains(document.activeElement)) closeBricks();
    }, 0);
  });
  zone.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && open) {
      e.preventDefault();
      closeBricks();
      refocusing = true;
      trigger.focus();
      refocusing = false;
    }
  });
  trigger.addEventListener('click', () => {
    if (!open) openBricks();
    else if (Date.now() - openedAt > REOPEN_GUARD) closeBricks();
  });

  bricks.forEach((brick) => {
    brick.addEventListener('click', () => {
      // Scelta una voce: il logo si richiude e il focus passa alla sezione scelta, da tastiera, al tocco e al clic
      // (anche chi usa uno screen reader sul telefono attiva con un tocco). Così nulla riapre il logo durante lo
      // scorrimento e il Tab successivo continua da lì.
      holdClosedUntil = Date.now() + 800;
      closeBricks();
      const target = document.getElementById(brick.dataset.target ?? '');
      if (target) {
        if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
        target.focus({ preventScroll: true });
      } else {
        brick.blur();
      }
      target?.scrollIntoView({ behavior: scrollBehavior(), block: 'start' });
    });
  });

  function updateNav(): void {
    const nextNarrow = NARROW_QUERY.matches;
    const de = document.documentElement;
    let next: SectionId | '' = '';
    for (const id of SECTIONS) {
      const el = document.getElementById(id);
      if (el && el.getBoundingClientRect().top <= 140) next = id;
    }
    if (window.innerHeight + window.scrollY >= de.scrollHeight - 2) next = 'contatti';
    if (next !== active || nextNarrow !== narrow) {
      const layoutChanged = nextNarrow !== narrow;
      active = next;
      narrow = nextNarrow;
      if (layoutChanged) renderWithoutTransitions();
      else render();
    }
  }

  /** Passaggio fila ↔ colonna (o primo disegno): i cubetti cambiano posto senza animarsi. */
  function renderWithoutTransitions(): void {
    zone.classList.add('lg-no-anim');
    render();
    void zone.offsetWidth;
    requestAnimationFrame(() => zone.classList.remove('lg-no-anim'));
  }

  let navFrame = 0;
  const scheduleNav = () => {
    if (navFrame) return;
    navFrame = requestAnimationFrame(() => {
      navFrame = 0;
      updateNav();
    });
  };
  window.addEventListener('scroll', scheduleNav, { passive: true });
  window.addEventListener('resize', scheduleNav);

  renderWithoutTransitions();
  updateNav();
}
