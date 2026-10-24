/** Trova un elemento che deve esistere nel markup; se manca è un errore di sviluppo. */
export function req<T extends Element = HTMLElement>(selector: string, root: ParentNode = document): T {
  const el = root.querySelector<T>(selector);
  if (!el) throw new Error(`Elemento mancante: ${selector}`);
  return el;
}
