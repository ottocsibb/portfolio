const query = window.matchMedia('(prefers-reduced-motion: reduce)');

/** "Riduci movimento": tutto già composto, nessuna animazione né suono automatico. */
export function prefersReducedMotion(): boolean {
  return query.matches;
}

export function onReducedMotionChange(cb: (reduce: boolean) => void): void {
  query.addEventListener('change', () => cb(query.matches));
}

export function scrollBehavior(): ScrollBehavior {
  return prefersReducedMotion() ? 'auto' : 'smooth';
}
