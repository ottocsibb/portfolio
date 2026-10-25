// Suoni sintetizzati con Web Audio, senza file. Spenti di default; la scelta resta nel browser.
// L'AudioContext nasce solo dentro un gesto dell'utente (clic, tocco, tasto): lo scroll non conta.

export type SoundKind = 'tic' | 'click' | 'chord' | 'pop';

const STORAGE_KEY = 'portfolio-audio';
const VOLUME = 0.06;
/** Distanza minima tra due suoni dello stesso tipo: brevi e mai in raffica. */
const MIN_GAP: Record<SoundKind, number> = { tic: 130, click: 140, chord: 0, pop: 120 };

function readPreference(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === 'on';
  } catch {
    return false;
  }
}

function writePreference(on: boolean): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, on ? 'on' : 'off');
  } catch {
    // archiviazione non disponibile (navigazione privata, permessi): la scelta vale solo per questa visita
  }
}

type Ctor = typeof AudioContext;

export class Sound {
  private ctx: AudioContext | null = null;
  private out: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private enabled = readPreference();
  private last: Record<SoundKind, number> = { tic: -1e9, click: -1e9, chord: -1e9, pop: -1e9 };
  private listeners: ((on: boolean) => void)[] = [];

  constructor() {
    // Preferenza già accesa: i suoni partono dal primo gesto (non dallo scroll), senza far ripartire nulla.
    const firstGesture = () => {
      if (this.enabled) void this.ensureContext();
      for (const t of GESTURES) window.removeEventListener(t, firstGesture, true);
    };
    const GESTURES = ['pointerup', 'touchend', 'keydown', 'click'];
    if (this.enabled) for (const t of GESTURES) window.addEventListener(t, firstGesture, true);
    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return;
      if (document.hidden) void this.ctx.suspend();
      else if (this.enabled) void this.ctx.resume();
    });
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  onChange(cb: (on: boolean) => void): void {
    this.listeners.push(cb);
  }

  /**
   * Da chiamare dentro il gestore del clic o del tocco: Safari iOS crea o riprende l'audio solo lì.
   * La promessa si risolve quando il contesto è attivo (per il suono di conferma).
   */
  setEnabled(on: boolean): Promise<void> {
    this.enabled = on;
    writePreference(on);
    for (const cb of this.listeners) cb(on);
    if (on) return this.ensureContext();
    if (this.ctx) void this.ctx.suspend();
    return Promise.resolve();
  }

  private ensureContext(): Promise<void> {
    if (!this.ctx) {
      const C: Ctor | undefined = window.AudioContext ?? (window as unknown as { webkitAudioContext?: Ctor }).webkitAudioContext;
      if (!C) return Promise.resolve();
      this.ctx = new C();
      // volume generale basso, poi un limitatore: nessun suono sovrapposto può diventare forte
      const limiter = this.ctx.createDynamicsCompressor();
      limiter.threshold.value = -10;
      limiter.knee.value = 0;
      limiter.ratio.value = 20;
      limiter.attack.value = 0.003;
      limiter.release.value = 0.1;
      limiter.connect(this.ctx.destination);
      this.out = this.ctx.createGain();
      this.out.gain.value = VOLUME;
      this.out.connect(limiter);
    }
    return this.ctx.state === 'running' ? Promise.resolve() : this.ctx.resume().catch(() => {});
  }

  play(kind: SoundKind): void {
    const ctx = this.ctx;
    if (!this.enabled || !ctx || !this.out || ctx.state !== 'running') return;
    const now = performance.now();
    if (now - this.last[kind] < MIN_GAP[kind]) return; // più eventi nello stesso istante: un solo suono
    this.last[kind] = now;
    const t = ctx.currentTime + 0.005;
    const vary = () => 1 + (Math.random() - 0.5) * 0.1; // ±5% di altezza: le ripetizioni non suonano meccaniche
    if (kind === 'tic') this.tone(t, 220 * vary(), 140, 0.06, 0.9);
    else if (kind === 'pop') this.tone(t, 600, 900, 0.07, 0.8);
    else if (kind === 'click') this.click(t, 2500 * vary());
    else for (const f of [523.25, 659.25, 783.99]) this.tone(t, f, f, 0.6, 1 / 3, 0.01);
  }

  /** Sinusoide con attacco breve e uscita esponenziale (niente clic); i nodi si scollegano a fine suono. */
  private tone(t: number, from: number, to: number, dur: number, peak: number, attack = 0.005): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(from, t);
    if (to !== from) osc.frequency.exponentialRampToValueAtTime(to, t + dur);
    this.envelope(env, t, dur, peak, attack);
    osc.connect(env);
    env.connect(this.out!);
    osc.onended = () => {
      osc.disconnect();
      env.disconnect();
    };
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  private click(t: number, freq: number): void {
    const ctx = this.ctx!;
    if (!this.noise) {
      const len = Math.round(ctx.sampleRate * 0.05);
      this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    }
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = freq;
    band.Q.value = 1.5;
    const env = ctx.createGain();
    this.envelope(env, t, 0.025, 0.9, 0.005);
    src.connect(band);
    band.connect(env);
    env.connect(this.out!);
    src.onended = () => {
      src.disconnect();
      band.disconnect();
      env.disconnect();
    };
    src.start(t);
    src.stop(t + 0.045);
  }

  private envelope(env: GainNode, t: number, dur: number, peak: number, attack: number): void {
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(peak, t + Math.max(0.005, attack));
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  }
}
