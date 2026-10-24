---
name: Portfolio · Mariano De Magistris
description: Dal problema alla soluzione.
colors:
  page-bg: "#EEF1F6"
  night-blue: "#14213D"
  structure-blue: "#2C3E66"
  card-on-night: "#1F2E50"
  text-secondary: "#4A5672"
  title-problem: "#6B7894"
  text-on-night: "#C3CBDA"
  chaos-1: "#C5CCD8"
  chaos-2: "#A3ADBF"
  chaos-3: "#8E99AD"
  chaos-4: "#7D889C"
  chaos-5: "#5B6880"
  border: "#C5CCD8"
  track: "#DDE2EC"
  surface-soft: "#F4F6FA"
  white: "#FFFFFF"
  accent: "#F26A1B"
  accent-dark: "#B4470C"
  accent-light: "#FDE9DC"
typography:
  display:
    fontFamily: "'Bricolage Grotesque', sans-serif"
    fontSize: "clamp(48px, 7vw, 104px)"
    fontWeight: 800
    lineHeight: 0.98
    letterSpacing: "-0.05em"
  headline:
    fontFamily: "'Bricolage Grotesque', sans-serif"
    fontSize: "clamp(36px, 4.4vw, 60px)"
    fontWeight: 800
    lineHeight: 1.02
    letterSpacing: "-0.03em"
  title:
    fontFamily: "'Bricolage Grotesque', sans-serif"
    fontSize: "22px"
    fontWeight: 700
    lineHeight: 1.15
  body:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "17px"
    fontWeight: 400
    lineHeight: 1.6
  label:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 700
    letterSpacing: "0.08em"
rounded:
  task: "8px"
  logo-brick: "9px"
  panel: "14px"
  chip-tile: "16px"
  card: "20px"
  header: "22px"
  section-box: "28px"
  pill: "999px"
spacing:
  section: "112px"
  gutter: "24px"
  card-pad: "24px"
  grid-gap: "16px"
components:
  button-primary:
    backgroundColor: "{colors.night-blue}"
    textColor: "{colors.white}"
    rounded: "{rounded.pill}"
    padding: "14px 24px"
  button-secondary:
    backgroundColor: "{colors.white}"
    textColor: "{colors.night-blue}"
    rounded: "{rounded.pill}"
    padding: "14px 24px"
  card:
    backgroundColor: "{colors.white}"
    rounded: "{rounded.card}"
    padding: "24px"
  card-highlight:
    backgroundColor: "{colors.night-blue}"
    textColor: "{colors.white}"
    rounded: "{rounded.card}"
    padding: "24px"
  contact-box:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.night-blue}"
    rounded: "{rounded.section-box}"
    padding: "72px 48px"
---

# Design System: Portfolio · Mariano De Magistris

> Documentato dal prototipo approvato `design/prototype.dc.html` e da `CLAUDE.md`. Valori e regole sono **osservati**, non scelti. Le righe marcate **[Supposizione]** sono interpretazioni da confermare.

## Overview

**Creative North Star: "Dal problema alla soluzione"** (il motto del sito; usarlo come metafora del sistema è una **[Supposizione]**).

La pagina è un arco cromatico: grigi spenti per il caos, blu per il problema analizzato e strutturato, arancione per ciò che è chiuso. Le superfici sono piatte e chiare, con card bianche molto arrotondate su un fondo grigio-azzurro. I titoli sono grandi e compatti in Bricolage Grotesque, il testo è in Inter.

**Key Characteristics:**
- Arancione raro e con significato ("fatto / soluzione").
- Blocchi/cubi come linguaggio visivo: logo a 4 cubetti, frammenti dell'hero, composizione a mosaico delle sezioni.
- Movimento come racconto, sempre disattivabile con "riduci movimento".

## Colors

### Primary
- **Accento soluzione** (#F26A1B): tutto ciò che è chiuso, completato, risolto. Box contatti, evidenziatore di "soluzione", task eseguiti.
- **Accento scuro** (#B4470C): la stessa idea, per il testo piccolo (etichette, "Per aziende e progetti privati").
- **Accento chiaro** (#FDE9DC): evidenzia per un attimo eventi e task appena completati.

### Neutral
- **Blu notte** (#14213D): testo principale, sezione caso studio, card in evidenza.
- **Blu struttura** (#2C3E66): task in esecuzione, corsie, strutture.
- **Blu su scuro** (#1F2E50): superfici sopra il blu notte.
- **Testo secondario** (#4A5672) · **"Dal problema"** (#6B7894) · **Testo su blu notte** (#C3CBDA).
- **Grigi caos** (#C5CCD8, #A3ADBF, #8E99AD, #7D889C, #5B6880): frammenti, stato "Prima".
- **Bordi e tracce** (#C5CCD8, #DDE2EC, #F4F6FA). **Fondo** (#EEF1F6).

### Named Rules
**The Orange Means Done Rule.** L'arancione significa sempre "fatto / soluzione". Mai decorativo.
**The Night On Orange Rule.** Sull'arancione il testo è sempre blu notte; il bianco non passa il contrasto (3,1:1).
**The Light Gray Rule.** #7D889C e i grigi più chiari non si usano per testo piccolo.

## Typography

**Display Font:** Bricolage Grotesque (500, 700, 800), con sans-serif come fallback.
**Body Font:** Inter (400–700), con system-ui come fallback.

### Hierarchy
- **Display** (800, clamp(48px, 7vw, 104px), 0.98, -0.05em): solo l'h1 dell'hero. "Dal problema" a peso 500 e in #6B7894.
- **Headline** (800, clamp(36px, 4.4vw, 60px), 1.02, -0.03em): h2 di sezione. Servizi usa clamp(32px, 3.6vw, 48px), Contatti clamp(40px, 5.4vw, 76px).
- **Title** (700, 22px, 1.15): h3 delle card.
- **Body** (400, 17px, 1.6): testo; le card usano 15–16px, le sottofrasi 18–20px.
- **Label** (700, 13–14px, 0.08em, maiuscolo): sopratitoli di sezione in #B4470C o in accento sul blu notte.

## Layout

Contenitore max 1240px, margini laterali 24px, sezioni con 112px di padding verticale. Le griglie a card usano `repeat(auto-fill, minmax(250–260px, 1fr))` con colonne uguali. Header sticky a 14px dall'alto, pillola bianca semitrasparente. L'hero occupa `min-height: 100svh` (nel prototipo 780px fissi; lo cambia `CLAUDE.md`).

## Elevation & Depth

Per lo più piatto. Ombre morbide e solo in pochi punti:
- **Header** (`0 6px 20px rgba(20,33,61,0.08)` + `backdrop-filter: blur(10px)`).
- **Dashboard** (`0 30px 70px rgba(0,0,0,0.3)`).
- **Nuvolette/fumetti** (`0 10px 24px rgba(20,33,61,0.25)`).
- **Mattoncino in hover** (`0 8px 16px rgba(20,33,61,0.2)`).

## Shapes

Angoli generosi e sempre arrotondati: pillole (999px) per pulsanti e chip; 20px per le card; 28px per i box di sezione; 14px per i pannelli della dashboard; 8px per i task; 9px per i mattoncini del logo. Le corsie dell'hero hanno un bordo tratteggiato da 1,5px #C5CCD8.

## Components

- **Pulsanti:** pillole, 14×24px, peso 600. Primario blu notte su testo bianco, secondario bianco.
- **Logo dell'header:** 4 cubetti 9×9 che diventano mattoncini 40×40 (44×44 su mobile), con nuvoletta blu notte.
- **Interruttore Prima/Dopo:** pillola #1F2E50; attivo "Prima" = bianco, attivo "Dopo" = accento con testo blu notte.
- **Chip competenze:** pillole bianche, 14px, peso 600.

## Do's and Don'ts

- **Do** riprendere testi e misure dal prototipo, parola per parola.
- **Do** animare solo `transform` e `opacity`.
- **Don't** usare l'arancione per decorare.
- **Don't** aggiungere metriche, testimonianze o affermazioni non presenti nel prototipo.
- **Don't** cambiare il design approvato senza conferma.
