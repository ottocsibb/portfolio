# Portfolio · Mariano De Magistris

Sito portfolio personale, una sola pagina, in italiano. Affianca il CV classico e serve a proporsi sia ad aziende sia per progetti privati.

Messaggio centrale: **"Dal problema alla soluzione."** Mariano si presenta prima di tutto come **team leader**, poi analista funzionale e developer. Il suo punto di forza è prendere un problema grande e confuso, scomporlo in task, coordinare chi ci lavora e portarlo a chiusura.

## Fonte del design

Il design approvato è in `design/prototype.dc.html`. È un file di Claude Design: markup HTML con stili inline, più una classe JavaScript `Component` in fondo che contiene tutta la logica delle animazioni.

- Usalo come **specifica**: testi, colori, misure, struttura delle sezioni, tempi e comportamento delle animazioni.
- **Non** copiarlo così com'è. Dipende da un runtime (`support.js`, sintassi `{{...}}`, `<sc-for>`, `<sc-if>`) che non esiste fuori da Claude Design.
- Testi e contenuti vanno ripresi **parola per parola**, salvo dove questo file dice diversamente.

## Stack e pubblicazione

- Sito statico: **Vite + TypeScript**, senza framework. Le animazioni sono imperative e non servono componenti.
- Pubblicazione su **GitHub Pages** tramite GitHub Actions, dal branch `main`.
- Il repository si chiama `portfolio`, quindi il sito vive su `https://ottocsibb.github.io/portfolio/`. In Vite va impostato `base: '/portfolio/'`.
- Font **in locale**, con `@fontsource` o file `woff2` nel repo, **non** da Google Fonts: in UE è una questione di privacy.
- Nessun cookie, nessun tracciamento. Se in futuro serviranno statistiche, solo strumenti senza cookie.

## Design system

Colori:
| Ruolo | Valore |
|---|---|
| Sfondo pagina | `#EEF1F6` |
| Blu notte (testo principale, sezioni scure) | `#14213D` |
| Blu (in esecuzione, strutture) | `#2C3E66` |
| Blu chiaro su scuro (card su blu notte) | `#1F2E50` |
| Testo secondario | `#4A5672` |
| "Dal problema" nel titolo | `#6B7894` |
| Testo chiaro su blu notte | `#C3CBDA` |
| Grigi "caos" | `#C5CCD8` `#A3ADBF` `#8E99AD` `#7D889C` `#5B6880` |
| Bordi e tracce | `#C5CCD8` `#DDE2EC` `#F4F6FA` |
| **Accento (la soluzione)** | `#F26A1B` |
| Accento scuro, per testo piccolo | `#B4470C` |
| Accento chiaro (evidenziazioni) | `#FDE9DC` |

Regole:
- L'arancione significa sempre **"fatto / soluzione"**: è l'arco cromatico della pagina, grigio (caos) → blu (problema analizzato) → arancione (chiuso).
- Sull'arancione il testo è **sempre blu notte**. Il bianco non passa il contrasto (3,1:1).
- I grigi `#7D889C` e più chiari non vanno usati per testo piccolo.

Tipografia: **Bricolage Grotesque** (500, 700, 800) per titoli e numeri, **Inter** (400–700) per il testo.

## Struttura della pagina

1. **Header**, fisso in alto
2. **Hero** `#top`
3. **Caso studio** `#caso`
4. **Percorso** `#percorso`
5. **Altri progetti** `#progetti`
6. **Servizi** `#servizi`
7. **Contatti** `#contatti` e footer

## Animazioni (la parte più importante)

### Hero, circa 8 s, parte da sola al caricamento
Timeline in millisecondi, come `this.T` nel prototipo:
- **0–2600 · cascata.** 36 frammenti grigi di forme diverse cadono dall'alto con gravità e piccoli rimbalzi e si ammucchiano in disordine sul fondo. A 900 ms compare **"Dal problema"** (riga intera, dissolvenza + leggero sollevamento).
- **2600–3400 · pausa** sul mucchio disordinato. Niente blocco compatto: il problema resta caos.
- **3400 · ordine.** I pezzi si alzano direttamente nelle tre corsie orizzontali tratteggiate e compare **"alla soluzione."**.
- **4100 · chiusura.** I task passano uno alla volta (ogni 45 ms) nella corsia dei completati, diventando arancioni.
- **5500 ·** le corsie spariscono e i pezzi formano un grande rettangolo arancione.
- **6300 ·** il rettangolo va a posizionarsi esattamente dietro la parola "soluzione" e ne diventa l'evidenziatore. Solo i 4 pezzi d'angolo hanno l'angolo **esterno** arrotondato (14px), quindi niente tacche interne.
- **6900–7900 ·** entrano in sequenza nome e ruoli, la sottofrase, "Per aziende e progetti privati", i pulsanti e "Scorri ↓".

Comportamento:
- Il mouse "spinge" i pezzi entro circa 120px, e i pezzi tornano al loro posto.
- C'è un pulsante "↺ Rivedi".
- Misura la parola "soluzione" solo dopo `document.fonts.ready` e di nuovo al resize.

### Sezioni che si compongono a cubi
Quando un blocco (card, titolo, pannello) entra nello schermo, circa all'88% dell'altezza:
- dal basso e dai lati arrivano blocchetti grigi sparsi e ruotati, che si incastrano a mosaico nella forma del blocco prendendone il colore;
- poi i blocchetti si fondono e compare il contenuto vero.

Dettagli:
- Durata circa 1,2 s, **automatica**: parte con lo scroll ma va sempre fino in fondo, anche se l'utente smette di scorrere.
- I blocchi della stessa riga partono sfalsati.
- Se il blocco esce dal basso si resetta e si ricompone al ritorno; se lo si supera verso l'alto resta composto.

### Caso studio · mercati energetici (dashboard simulata)
Interruttore **Prima / Dopo**:
- **Si vede sempre prima il "Prima".** Il passaggio automatico a "Dopo" avviene dopo 5 s di **effettiva visibilità** della dashboard, con una barretta che mostra quanto manca.
- Se l'utente scorre via e torna, riparte da "Prima". Se clicca l'interruttore, comanda lui.

Contenuti:
- **Prima:** quattro mercati scollegati (MGP, MI, MSD, GAS), ognuno con il suo strumento (script notturni, file condivisi, portale esterno, foglio Excel). I task hanno un "?" lampeggiante e compaiono fumetti con domande.
- **Dopo:** card per mercato con stato della sessione (Aperto / In chiusura / Esiti in arrivo), conto alla rovescia e task eseguiti. Cliccando una card si filtra per mercato. C'è una board unica In coda / In esecuzione / Eseguiti con l'etichetta del mercato su ogni task, più un log degli eventi e un grafico.
- I task usano **"fabbisogno"**, mai "sbilanciamenti".
- Etichetta obbligatoria "demo, dati simulati". **Non** aggiungere risultati misurabili: non ce ne sono.

### Header: logo che si scompone
- A riposo: logo di 4 cubetti 9×9 in griglia 2×2 (grigio `#A3ADBF`, blu `#2C3E66`, blu notte `#14213D`, arancione), con accanto nome e ruoli.
- Al passaggio del mouse, o con il focus da tastiera, i cubetti escono e crescono **restando quadrati** fino a 40×40, in fila, con un leggero rimbalzo; le icone compaiono quando sono arrivati. Il nome scivola a destra per fare spazio.
- Quattro pulsanti: **Caso studio** (grigio, icona grafico), **Percorso** (blu, icona percorso), **Progetti** (blu notte, icona livelli), **Scrivimi** (arancione, icona busta).
- Al passaggio su un mattoncino compare una nuvoletta con titolo e descrizione, ancorata al bordo sinistro del mattoncino. Esc chiude.
- Mobile: tocco sul logo; i mattoncini da 44×44 scendono in colonna con l'etichetta accanto.
- A destra c'è l'invito "← Passa sul logo per esplorare" e poi la sezione corrente, con un quadratino del suo colore.

### Suoni (prima versione)
- Pulsante audio **spento di default** nell'header; il browser ricorda la scelta. Quando lo si attiva, l'hero riparte con il suono.
- Suoni **sintetizzati con Web Audio**, senza file: tic grave per i pezzi che cadono, clic per i task chiusi, piccolo accordo quando il rettangolo arriva su "soluzione", pop per i mattoncini del logo e per i blocchi che si compongono.
- Brevi, a volume basso, mai sovrapposti in raffica: limitarne la frequenza.

## Requisiti trasversali

- **Riduci movimento** (`prefers-reduced-motion`): tutto già composto, nessuna animazione e nessun suono automatico.
- **Prestazioni:**
  - animare solo `transform` e `opacity`;
  - mettere in pausa animazioni e simulazione quando la sezione è fuori schermo o la scheda del browser non è attiva;
  - per i frammenti valuta un canvas o pochi elementi DOM riutilizzati.
- **Mobile:** l'hero usa `min-height: 100svh` invece di 780px fissi. Niente scroll orizzontale; le griglie a card usano colonne uguali, così l'ultima card non si allarga.
- **Accessibilità:**
  - pulsanti e link veri, focus visibile;
  - contrasti AA;
  - elementi decorativi `aria-hidden`;
  - un solo `h1`;
  - `lang="it"`.
- **SEO e condivisione:** title, description, immagine di anteprima (Open Graph) per LinkedIn e WhatsApp, favicon basata sul logo a 4 cubetti.
- **Privacy:**
  - nel sito **non** vanno indirizzo, telefono e data di nascita, che sono presenti nel CV;
  - email: `mariano_demagistris@hotmail.it`.

## Ancora da definire (non inventare: chiedi a Mariano)

- URL di LinkedIn e GitHub.
- PDF del CV per il sito, in una versione senza dati personali.
- Foto sì/no, versione inglese, dominio ed email personalizzati.
- Se aggiungere "Servizi" come quinto mattoncino nell'header.

Finché mancano, lascia link segnaposto evidenti e raccoglili nella descrizione della PR.

## Come lavorare con Mariano

- Prima di scrivere codice proponi un **piano breve** e aspetta conferma. Lo stesso vale per ogni scelta che si discosta dal prototipo.
- Niente supposizioni generiche: se un dettaglio non è nel prototipo o in questo file, chiedi.
- Lavora su un branch e apri una **pull request** con: cosa è stato fatto, come provarlo e cosa manca.
- Prima di chiudere verifica la pagina su desktop e su mobile (Playwright), incluso "riduci movimento".
