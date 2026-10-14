// Keyboard and gamepad for the real-time arena. Each person's seat gets a scheme: the first (or only) person uses WASD/arrows,
// 1-4 (or J K L Ñ), Space/Shift to roll and Q + 1-6 to switch; in a two-person battle the second uses arrows, U I O P, Enter and
// Backspace, or a gamepad. Taps between two ticks are queued so none is lost.

const SCHEMES = {
  solo: {
    up: ["KeyW", "ArrowUp"], down: ["KeyS", "ArrowDown"], left: ["KeyA", "ArrowLeft"], right: ["KeyD", "ArrowRight"],
    moves: [["Digit1", "KeyJ", "Numpad1"], ["Digit2", "KeyK", "Numpad2"], ["Digit3", "KeyL", "Numpad3"], ["Digit4", "Semicolon", "Numpad4"]],
    roll: ["Space", "ShiftLeft", "ShiftRight"], party: ["KeyQ", "Tab"],
    slots: ["Digit1", "Digit2", "Digit3", "Digit4", "Digit5", "Digit6"],
  },
  p1: {
    up: ["KeyW"], down: ["KeyS"], left: ["KeyA"], right: ["KeyD"],
    moves: [["Digit1"], ["Digit2"], ["Digit3"], ["Digit4"]], roll: ["Space", "ShiftLeft"], party: ["KeyQ"],
    slots: ["Digit1", "Digit2", "Digit3", "Digit4", "Digit5", "Digit6"],
  },
  p2: {
    up: ["ArrowUp"], down: ["ArrowDown"], left: ["ArrowLeft"], right: ["ArrowRight"],
    moves: [["KeyU"], ["KeyI"], ["KeyO"], ["KeyP"]], roll: ["Enter", "NumpadEnter", "ShiftRight"], party: ["Backspace"],
    slots: ["KeyU", "KeyI", "KeyO", "KeyP", "BracketLeft", "BracketRight"],
  },
};

export class SeatInput {
  constructor(scheme, gamepadIndex = -1) {
    this.keys = SCHEMES[scheme];
    this.pad = gamepadIndex;
    this.queue = { use: -1, dodge: false, sw: -1 };
    this.partyOpen = false;
    this.padPrev = {};
    this.partyCursor = 0;
    this.onParty = null;   // the screen shows the party menu
  }

  key(code, down, held) {
    const k = this.keys;
    if (!down) return false;
    if (k.party.includes(code)) { this.partyOpen = !this.partyOpen; this.onParty?.(this.partyOpen); return true; }
    if (this.partyOpen) {
      const slot = k.slots.indexOf(code);
      if (slot >= 0) { this.queue.sw = slot; this.partyOpen = false; this.onParty?.(false); return true; }
      if (code === "Escape") { this.partyOpen = false; this.onParty?.(false); return true; }
    }
    const move = k.moves.findIndex((list) => list.includes(code));
    if (move >= 0) { this.queue.use = move; return true; }
    if (k.roll.includes(code)) { this.queue.dodge = true; return true; }
    return [...k.up, ...k.down, ...k.left, ...k.right].includes(code) || held === undefined;
  }

  /** The input for the next tick: held direction + queued taps (then cleared). */
  take(held, partySize = 6) {
    const k = this.keys;
    const on = (list) => list.some((c) => held.has(c));
    let mx = (on(k.right) ? 1 : 0) - (on(k.left) ? 1 : 0);
    let my = (on(k.down) ? 1 : 0) - (on(k.up) ? 1 : 0);
    const pad = this.readPad(partySize);
    if (pad) {
      if (Math.abs(pad.x) > 0.2 || Math.abs(pad.y) > 0.2) { mx = pad.x; my = pad.y; }
    }
    const l = Math.sqrt(mx * mx + my * my);
    if (l > 1) { mx /= l; my /= l; }
    const out = { mx: Math.round(mx * 100) / 100, my: Math.round(my * 100) / 100, ...this.queue };
    this.queue = { use: -1, dodge: false, sw: -1 };
    return out;
  }

  readPad(partySize) {
    if (this.pad < 0 || typeof navigator === "undefined" || !navigator.getGamepads) return null;
    const gp = navigator.getGamepads()[this.pad];
    if (!gp) return null;
    const b = (i) => !!gp.buttons[i]?.pressed;
    const edge = (i) => { const now = b(i); const was = this.padPrev[i]; this.padPrev[i] = now; return now && !was; };
    // A B X Y (Xbox layout: 0 1 2 3) -> moves 1-4; RB (5) roll; D-pad left/right (14/15) pick, up (12) send
    for (let i = 0; i < 4; i++) if (edge(i)) this.queue.use = i;
    if (edge(5) || edge(7)) this.queue.dodge = true;
    if (edge(14)) { this.partyCursor = (this.partyCursor + partySize - 1) % partySize; this.partyOpen = true; this.onParty?.(true, this.partyCursor); }
    if (edge(15)) { this.partyCursor = (this.partyCursor + 1) % partySize; this.partyOpen = true; this.onParty?.(true, this.partyCursor); }
    if (edge(12) && this.partyOpen) { this.queue.sw = this.partyCursor; this.partyOpen = false; this.onParty?.(false); }
    if (edge(13) && this.partyOpen) { this.partyOpen = false; this.onParty?.(false); }
    return { x: gp.axes[0] || 0, y: gp.axes[1] || 0 };
  }
}

/** The input objects for a battle's people: one person -> keyboard + first gamepad; two -> p1 on the left of the keyboard (or
 * gamepad 0 if there are two pads), p2 on the right (or a gamepad). */
export function makeInputs(humans) {
  const pads = typeof navigator !== "undefined" && navigator.getGamepads ? [...navigator.getGamepads()].filter(Boolean).map((g) => g.index) : [];
  const out = [null, null];
  const people = [0, 1].filter((i) => humans[i]);
  if (people.length === 1) out[people[0]] = new SeatInput("solo", pads[0] ?? 0);
  if (people.length === 2) {
    out[0] = new SeatInput("p1", pads.length >= 2 ? pads[0] : -1);
    out[1] = new SeatInput("p2", pads.length >= 2 ? pads[1] : pads[0] ?? -1);
  }
  return out;
}
