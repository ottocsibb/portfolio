# portfolio

Sito portfolio di Mariano De Magistris. Vite + TypeScript, senza framework.

```sh
npm install
npm run dev       # sviluppo su http://localhost:5173/
npm run build     # controllo dei tipi + build in dist/
npm run verify    # verifiche Playwright (desktop, mobile, riduci movimento); screenshot in .verify/
npm run verify:hero  # timeline dell'hero, evidenziatore, pausa del ciclo; screenshot in .verify/hero/
npm run verify:blocks   # cubi allo scroll e caso studio; screenshot in .verify/blocks/
npm run verify:final    # suoni, header, SEO, accessibilità (axe), privacy, pagina intera; screenshot in .verify/final/
npm run make:assets     # rigenera favicon e immagine Open Graph in public/
```

`npm run verify` usa il Playwright installato nel sistema; se non è risolvibile da `node`, indica il percorso con `PLAYWRIGHT_PATH=/percorso/node_modules/playwright`.

Brief e regole: `CLAUDE.md`. Design approvato: `design/prototype.dc.html`.

Controprova con la CPU rallentata (Chromium, `Emulation.setCPUThrottlingRate`): `VERIFY_CPU_THROTTLE=4 npm run verify:final`, e lo stesso per le altre suite. I momenti dei suoni si misurano sul tempo della scena (`data-hero-t` sull'hero), non sull'orologio, quindi le verifiche non dipendono dalla velocità della macchina.
