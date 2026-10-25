import '@fontsource-variable/bricolage-grotesque/opsz.css';
import '@fontsource-variable/inter/wght.css';
import './styles/tokens.css';
import './styles/base.css';
import './styles/header.css';
import './styles/sections.css';
import './styles/assemble.css';
import './styles/case.css';
import { Sound } from './audio';
import { initHeader } from './header';
import { initHero } from './hero/hero';
import { initAssemble } from './assemble';
import { initCase } from './case/case';
import { req } from './lib/dom';

const sound = new Sound();

initHeader({ onOpen: () => sound.play('pop') });
const hero = initHero({
  onLand: () => sound.play('tic'),
  onClose: () => sound.play('click'),
  onMark: () => sound.play('chord'),
});
initCase(initAssemble({ onComposed: () => sound.play('pop') }));

// ---- Pulsante audio ----
const audioBtn = req<HTMLButtonElement>('[data-audio]');
const audioTip = req('[data-audio-tip]', audioBtn);
const heroEl = req('#top');

function renderAudio(on: boolean): void {
  // Etichetta fissa ("Suoni") con aria-pressed; la nuvoletta dice cosa succede al prossimo clic.
  audioBtn.setAttribute('aria-pressed', String(on));
  audioTip.textContent = on ? 'Disattiva i suoni' : 'Attiva i suoni';
}

/** L'hero riparte con il suono solo se è visibile almeno per metà: altrimenti l'utente non lo vedrebbe. */
function heroMostlyVisible(): boolean {
  const r = heroEl.getBoundingClientRect();
  const visible = Math.max(0, Math.min(r.bottom, window.innerHeight) - Math.max(r.top, 0));
  return r.height > 0 && visible / r.height >= 0.5;
}

audioBtn.addEventListener('click', () => {
  const on = !sound.isEnabled();
  void sound.setEnabled(on).then(() => {
    if (!on) return;
    sound.play('pop'); // conferma, anche con "riduci movimento"
    if (hero && heroMostlyVisible()) hero.replay();
  });
});
audioBtn.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') audioBtn.classList.add('tip-closed');
});
const reopenTip = () => audioBtn.classList.remove('tip-closed');
audioBtn.addEventListener('blur', reopenTip);
audioBtn.addEventListener('pointerleave', reopenTip);
sound.onChange(renderAudio);
renderAudio(sound.isEnabled());
audioBtn.hidden = false;
