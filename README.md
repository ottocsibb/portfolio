# portfolio

Sito portfolio di Mariano De Magistris. Vite + TypeScript, senza framework.

```sh
npm install
npm run dev       # sviluppo su http://localhost:5173/portfolio/
npm run build     # controllo dei tipi + build in dist/
npm run verify    # verifiche Playwright (desktop, mobile, riduci movimento); screenshot in .verify/
npm run verify:hero  # timeline dell'hero, evidenziatore, pausa del ciclo; screenshot in .verify/hero/
```

`npm run verify` usa il Playwright installato nel sistema; se non è risolvibile da `node`, indica il percorso con `PLAYWRIGHT_PATH=/percorso/node_modules/playwright`.

Brief e regole: `CLAUDE.md`. Design approvato: `design/prototype.dc.html`.
