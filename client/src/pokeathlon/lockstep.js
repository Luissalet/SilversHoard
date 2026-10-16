// Playing an event with friends on other computers (a Pokéathlon room, silvers_hoard/pokeathlon_rooms.py). Every computer runs the whole
// event itself from the same seed and the same teams, and they only exchange what each person did: one frame of input per 1/30 s tick
// (Input.snapshot). A tick runs once the frames of every person that is still playing are in, so all of them see the same event.
// A person who leaves is replaced by the CPU from a tick everybody agrees on: the room puts a CPU marker (0) in that person's frames.
// Nothing in here touches the DOM, so tests can run several "computers" in one node process.
import { FPS, Input, STEP, makeCtx } from "./core.js";

export { FPS, STEP };

/** The frame a room stores for a person the CPU has taken over from that tick on. */
export const CPU_FRAME = 0;

/** How many ticks an input waits before it runs (the round trip hides behind it); the room sends its own value. */
export const DEFAULT_DELAY = 4;

export class Lockstep {
  /** ctx, inst: the event's ctx and instance on this computer; seats: the teams a person steers (their frames are awaited). */
  constructor(ctx, inst, seats) {
    this.ctx = ctx;
    this.inst = inst;
    this.frames = [[], [], [], []];       // frames[team][tick - 1]
    this.active = new Set(seats);
    this.cpu = new Set();
    this.tick = 0;
    this.tookOver = [];                   // [{ team, tick }] in the order they happened
  }

  /** Frames of `team` for ticks from `from` (1-based) on; ticks already held are ignored (a resend after reconnecting). */
  feed(team, from, list) {
    const mine = this.frames[team];
    (list || []).forEach((f, i) => { if (from + i === mine.length + 1) mine.push(f); });
  }

  /** Every person still playing has a frame for the next tick. */
  ready() {
    for (const t of this.active) if (this.frames[t].length <= this.tick) return false;
    return true;
  }

  /** The teams whose frame the next tick lacks. */
  waitingFor() {
    return [...this.active].filter((t) => this.frames[t].length <= this.tick);
  }

  /** Run one tick; false when a frame is missing. */
  step() {
    if (!this.ready()) return false;
    const t = ++this.tick;
    for (const team of [...this.active]) {
      const f = this.frames[team][t - 1];
      if (f === CPU_FRAME) {
        this.active.delete(team);
        this.cpu.add(team);
        this.ctx.teams[team].human = false;
        this.ctx.inputs[team].apply({}, t);
        if (this.inst.takeOver) this.inst.takeOver(team);
        this.tookOver.push({ team, tick: t });
      } else {
        this.ctx.inputs[team].apply(f, t);
      }
    }
    this.inst.update(STEP);
    return true;
  }
}

/** A fresh Input used as the "applied" input of a team in a lockstep run (what the event reads), not the device. */
export const appliedInputs = () => [0, 1, 2, 3].map(() => new Input());

/**
 * Several computers in one process, for tests and for checking an event: `clients` copies of the event, each with its own ctx, all
 * given the same frames. `scripts[team](tick, input)` presses things on that team's device Input; its snapshot is the frame every
 * copy receives `delay` ticks later. `takeover: { team, tick }` replaces a person with the CPU from that tick on (as the room would).
 * Returns each copy's result, its rng checksum and the number of ticks it ran.
 */
export function runLockstep(mod, { teams, seed = 1, lang = "es", supreme = false, clients = 2, scripts = {}, takeover = null, delay = DEFAULT_DELAY, maxTicks = 30 * 600 } = {}) {
  const humans = teams.map((t, i) => (t.human ? i : -1)).filter((i) => i >= 0);
  const copies = [];
  for (let c = 0; c < clients; c++) {
    // every copy gets its own teams: takeover edits `human` and nothing may be shared between computers
    const own = teams.map((t) => ({ ...t, mons: t.mons.map((m) => ({ ...m })) }));
    const ctx = makeCtx({ teams: own, seed, lang, inputs: appliedInputs(), focus: humans[c % Math.max(1, humans.length)] ?? 0, mode: "play", supreme });
    const inst = mod.create(ctx);
    copies.push({ ctx, inst, ls: new Lockstep(ctx, inst, humans) });
  }
  const devices = teams.map(() => new Input());
  // the first `delay` frames of everybody are empty, as in the room
  for (const t of humans) for (const cp of copies) cp.ls.feed(t, 1, Array.from({ length: delay }, () => ({})));
  const gone = new Set();
  let read = 0;
  let guard = 0;
  while (guard++ < maxTicks * 2) {
    if (copies.every((cp) => cp.ctx.finished)) break;
    // read the frames for the ticks up to `delay` ahead of the one about to run
    while (read < copies[0].ls.tick + delay) {
      read++;
      for (const t of humans) {
        if (gone.has(t)) continue;
        const dev = devices[t];
        if (scripts[t]) scripts[t](read, dev);
        dev.frame();
        let frame = dev.snapshot();
        const at = copies[0].ls.frames[t].length + 1;
        if (takeover && takeover.team === t && at >= takeover.tick) { frame = CPU_FRAME; gone.add(t); }
        for (const cp of copies) cp.ls.feed(t, at, [frame]);
      }
    }
    let progressed = false;
    for (const cp of copies) while (cp.ls.step()) { progressed = true; if (cp.ctx.finished) break; }
    if (!progressed) break;
  }
  return copies.map((cp) => ({
    result: cp.ctx.result, finished: cp.ctx.finished, ticks: cp.ls.tick, rngSum: cp.ctx.rng.sum, rngCalls: cp.ctx.rng.calls, tookOver: cp.ls.tookOver, ctx: cp.ctx, inst: cp.inst,
  }));
}
