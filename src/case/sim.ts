// Simulazione dei mercati energetici: stessa logica del prototipo (initSim, newTask, addLog, mStatus, stepSim).
// Dati simulati: nessun risultato reale.

export interface Market { id: string; name: string; cycle: number; off: number; tasks: string[] }

export const MARKETS: Market[] = [
  { id: 'MGP', name: 'Mercato del giorno prima', cycle: 3600, off: 2400, tasks: ['Calcolo fabbisogno', 'Previsione dei consumi', 'Invio offerte', 'Acquisizione esiti'] },
  { id: 'MI', name: 'Mercato infragiornaliero', cycle: 1800, off: 300, tasks: ['Ricalcolo fabbisogno', 'Invio offerte', 'Acquisizione esiti'] },
  { id: 'MSD', name: 'Servizi di dispacciamento', cycle: 2700, off: 1500, tasks: ['Offerte di riserva', 'Verifica ordini', 'Acquisizione esiti'] },
  { id: 'GAS', name: 'Gas, giorno prima', cycle: 3000, off: 900, tasks: ['Calcolo fabbisogno gas', 'Nomine', 'Acquisizione prezzi'] },
];

export type Status = 'Aperto' | 'In chiusura' | 'Esiti in arrivo';

export interface Task { id: number; mkt: string; name: string; p: number; fresh: number }
export interface LogEntry { id: number; time: string; mkt: string; text: string; fresh: number }
export interface MarketStatus { status: Status; rem: number; label: string; sess: number }

export class MarketSim {
  simSec = 9 * 3600 + 12 * 60;
  doneBy: Record<string, number> = { MGP: 41, MI: 63, MSD: 27, GAS: 35 };
  queue: Task[] = [];
  run: Task[] = [];
  done: Task[] = [];
  log: LogEntry[] = [];
  bars: number[] = [];
  private uid = 0;
  private logId = 0;
  private mi = 0;
  private ti: Record<string, number> = {};
  private steps = 0;
  private recent = 0;
  private lastStatus: Record<string, Status> = {};

  constructor() {
    for (let a = 0; a < 6; a++) this.queue.push(this.newTask());
    for (let b = 0; b < 3; b++) {
      const t = this.queue.shift()!;
      t.p = 15 + b * 25;
      this.run.push(t);
    }
    for (let c = 0; c < 3; c++) this.done.push(this.newTask());
    this.addLog(this.done[0].mkt, `${this.done[0].name} · completato`);
    this.addLog(this.run[0].mkt, `${this.run[0].name} · avviato`);
    this.addLog(this.run[1].mkt, `${this.run[1].name} · avviato`);
    for (let e = 0; e < 14; e++) this.bars.push(4 + Math.round(Math.random() * 6));
    for (const m of MARKETS) this.lastStatus[m.id] = this.status(m).status;
  }

  private newTask(): Task {
    const m = MARKETS[this.mi % MARKETS.length];
    this.mi++;
    const n = this.ti[m.id] ?? 0;
    this.ti[m.id] = n + 1;
    this.uid++;
    return { id: this.uid, mkt: m.id, name: m.tasks[n % m.tasks.length], p: 0, fresh: 0 };
  }

  private addLog(mkt: string, text: string): void {
    this.logId++;
    this.log.unshift({ id: this.logId, time: this.clock(), mkt, text, fresh: 2 });
    this.log = this.log.slice(0, 7);
  }

  status(m: Market): MarketStatus {
    const ph = (this.simSec + m.off) % m.cycle;
    const closeAt = Math.round(m.cycle * 0.8);
    if (ph < closeAt) {
      const rem = closeAt - ph;
      return { status: rem < 300 ? 'In chiusura' : 'Aperto', rem, label: 'chiude tra', sess: ph / closeAt };
    }
    return { status: 'Esiti in arrivo', rem: m.cycle - ph, label: 'riapre tra', sess: 1 };
  }

  step(): void {
    this.simSec += 13;
    this.steps++;
    for (const l of this.log) if (l.fresh) l.fresh--;
    for (const d of this.done) if (d.fresh) d.fresh--;
    const still: Task[] = [];
    for (const t of this.run) {
      t.p = Math.min(100, t.p + 10 + Math.random() * 20);
      if (t.p >= 100) {
        t.fresh = 2;
        this.done.unshift(t);
        this.doneBy[t.mkt]++;
        this.recent++;
        this.addLog(t.mkt, `${t.name} · completato`);
      } else still.push(t);
    }
    this.run = still;
    this.done = this.done.slice(0, 8);
    while (this.run.length < 3 && this.queue.length) {
      const s = this.queue.shift()!;
      this.run.push(s);
      this.addLog(s.mkt, `${s.name} · avviato`);
    }
    while (this.queue.length < 6) this.queue.push(this.newTask());
    for (const m of MARKETS) {
      const st = this.status(m).status;
      if (st !== this.lastStatus[m.id]) {
        if (st === 'In chiusura') this.addLog(m.id, 'Sessione in chiusura');
        if (st === 'Esiti in arrivo') this.addLog(m.id, 'Sessione chiusa, esiti in arrivo');
        if (st === 'Aperto' && this.lastStatus[m.id] === 'Esiti in arrivo') this.addLog(m.id, 'Nuova sessione aperta');
        this.lastStatus[m.id] = st;
      }
    }
    if (this.steps % 3 === 0) {
      this.bars.push(Math.min(12, 4 + this.recent * 2 + Math.round(Math.random() * 2)));
      this.bars = this.bars.slice(-14);
      this.recent = 0;
    }
  }

  clock(): string {
    const s = this.simSec % 86400;
    const p2 = (n: number) => (n < 10 ? '0' : '') + n;
    return `${p2(Math.floor(s / 3600))}:${p2(Math.floor(s / 60) % 60)}:${p2(s % 60)}`;
  }
}

export function mmss(sec: number): string {
  const m = Math.floor(sec / 60), s = sec % 60;
  return `${m < 10 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s}`;
}
