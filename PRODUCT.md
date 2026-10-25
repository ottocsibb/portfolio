# Product

<!-- impeccable:product-schema 1 -->

> Ricavato da `CLAUDE.md` e da `design/prototype.dc.html`, approvati da Mariano. Non è stata fatta un'intervista separata: le righe marcate **[Supposizione]** sono deduzioni da confermare. `CLAUDE.md` resta la fonte che prevale.

## Platform

web

## Stack

Vite + TypeScript, senza framework (deciso in `CLAUDE.md`). Pubblicazione su Vercel, collegato al repository GitHub: ogni push su `main` va in produzione, ogni PR ha un link di anteprima. Indirizzo del sito: `https://mariano-demagistris-portfolio.vercel.app`. In Vite `base: '/'`. Su Vercel non attivare Web Analytics né Speed Insights. Font in locale, nessun cookie, nessun tracciamento.

## Users

- Aziende che valutano Mariano per un ruolo (team leader, analista funzionale, developer).
- Persone o realtà con un progetto privato da realizzare.
- **[Supposizione]** Arrivano dal CV o da un link condiviso (LinkedIn, WhatsApp), spesso da telefono, e restano pochi minuti.

## Product Purpose

Sito portfolio personale, una sola pagina, in italiano. Affianca il CV classico. Successo: chi lo visita capisce come lavora Mariano e lo contatta (email) o scarica il CV.

## Positioning

"Dal problema alla soluzione." Mariano si presenta prima di tutto come **team leader**, poi analista funzionale e developer. Il suo punto di forza è prendere un problema grande e confuso, scomporlo in task, coordinare chi ci lavora e portarlo a chiusura. Le animazioni raccontano proprio questo passaggio (caos → ordine → chiuso).

## Capabilities and Constraints

- Sezioni: Header, Hero `#top`, Caso studio `#caso`, Percorso `#percorso`, Altri progetti `#progetti`, Servizi `#servizi`, Contatti `#contatti` e footer.
- Testi ripresi parola per parola dal prototipo.
- Terminologia del caso studio: "fabbisogno", mai "sbilanciamenti".
- Nel caso studio niente risultati misurabili: non ce ne sono. Etichetta obbligatoria "demo, dati simulati".
- Ancora da definire (non inventare): URL di LinkedIn e GitHub, PDF del CV senza dati personali, foto sì/no, versione inglese, dominio ed email personalizzati, "Servizi" come quinto mattoncino nell'header.

## Brand Commitments

- Nome: Mariano De Magistris. Ruoli: "Team leader · Analista funzionale · Developer".
- Il design approvato è `design/prototype.dc.html`: non si cambia di iniziativa, ogni scostamento va proposto e confermato.

## Evidence on Hand

- Un caso studio reale (mercati energetici), presentato come demo con dati simulati.
- Percorso professionale 2020–oggi e quattro progetti, con i testi del prototipo.
- Nessuna testimonianza, nessun numero di risultato: non vanno inventati.

## Product Principles

1. Mostrare il metodo, non raccontarlo: il caos che diventa ordine è il messaggio.
2. L'arancione significa sempre "fatto / soluzione".
3. Onestà: niente metriche o affermazioni non documentate.
4. Privacy: niente indirizzo, telefono, data di nascita; nessun cookie.

## Accessibility & Inclusion

- `prefers-reduced-motion`: tutto già composto, nessuna animazione e nessun suono automatico.
- Contrasti AA; sull'arancione testo sempre blu notte; grigi da `#7D889C` in su (più chiari) mai per testo piccolo.
- Pulsanti e link veri, focus visibile, decorazioni `aria-hidden`, un solo `h1`, `lang="it"`.
