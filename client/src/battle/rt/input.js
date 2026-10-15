// Keyboard and gamepad for the real-time arena, laid out as in Pokémon Legends: Z-A by default.
// One person: move with WASD or the arrows (left stick); hold Shift (ZL) to focus on the opponent; the four moves sit in a
// diamond like the X A B Y buttons: I top, L right, K bottom, J left (with ZL held on a gamepad; 1-4 always work); Space rolls
// (Y on a gamepad when not focusing); Q / E pick a Pokémon of the party and R sends it out (D-pad ◀ ▶ and ▲); Esc pauses (+).
// F arms a Plus move for the next move (ZL + + on a gamepad) and M Mega Evolves (R). Not focusing, the Pokémon faces where it
// walks and its moves go that way; focusing, it faces the foe and its moves aim at it.
// The "simple" layout keeps the earlier one: always locked on, A B X Y fire moves 1-4, RB rolls, L Mega Evolves, - arms Plus.
// Two people share the keyboard: the first WASD, 1-4, Space, left Shift, F / G, Q/E/R; the second the arrows, U I O P, Enter,
// right Shift, K / L, Backspace / [ ] \.
// Taps between two ticks are queued so none is lost.

const SCHEMES = {
  solo: {
    up: ["KeyW", "ArrowUp"], down: ["KeyS", "ArrowDown"], left: ["KeyA", "ArrowLeft"], right: ["KeyD", "ArrowRight"],
    // diamond order: slot 0 top (X), 1 right (A), 2 bottom (B), 3 left (Y)
    moves: [["Digit1", "KeyI", "Numpad8"], ["Digit2", "KeyL", "Numpad6"], ["Digit3", "KeyK", "Numpad2"], ["Digit4", "KeyJ", "Numpad4"]],
    focus: ["ShiftLeft", "ShiftRight"], roll: ["Space"], plus: ["KeyF"], mega: ["KeyM"],
    prev: ["KeyQ"], next: ["KeyE"], send: ["KeyR"], party: ["Tab"],
    slots: ["Digit1", "Digit2", "Digit3", "Digit4", "Digit5", "Digit6"],
  },
  p1: {
    up: ["KeyW"], down: ["KeyS"], left: ["KeyA"], right: ["KeyD"],
    moves: [["Digit1"], ["Digit2"], ["Digit3"], ["Digit4"]], focus: ["ShiftLeft"], roll: ["Space"], plus: ["KeyF"], mega: ["KeyG"],
    prev: ["KeyQ"], next: ["KeyE"], send: ["KeyR"], party: [],
    slots: ["Digit1", "Digit2", "Digit3", "Digit4", "Digit5", "Digit6"],
  },
  p2: {
    up: ["ArrowUp"], down: ["ArrowDown"], left: ["ArrowLeft"], right: ["ArrowRight"],
    moves: [["KeyU"], ["KeyI"], ["KeyO"], ["KeyP"]], focus: ["ShiftRight"], roll: ["Enter", "NumpadEnter"], plus: ["KeyK"], mega: ["KeyL"],
    prev: ["BracketLeft"], next: ["BracketRight"], send: ["Backslash", "Backspace"], party: [],
    slots: ["KeyU", "KeyI", "KeyO", "KeyP", "BracketLeft", "BracketRight"],
  },
};

// Standard gamepad mapping: 0 bottom (B on a Switch pad), 1 right (A), 2 left (Y), 3 top (X), 4 L, 5 R, 6 ZL, 7 ZR, 8 -, 9 +,
// 12-15 D-pad.
const FACE_TO_SLOT = { 3: 0, 1: 1, 0: 2, 2: 3 };   // X A B Y around the diamond

export const CONTROL_LAYOUTS = ["za", "simple"];

export class SeatInput {
  constructor(scheme, gamepadIndex = -1, layout = "za") {
    this.scheme = scheme;
    this.keys = SCHEMES[scheme];
    this.pad = gamepadIndex;
    this.layout = CONTROL_LAYOUTS.includes(layout) ? layout : "za";
    this.queue = { use: -1, dodge: false, sw: -1, mega: false };
    this.plusArmed = false;  // F / ZL + +: the next move goes out as a Plus move (the screen disarms it once the battle used it)
    this.partyOpen = false;
    this.padPrev = {};
    this.partyCursor = 0;
    this.focus = false;      // ZL / Shift held: the screen draws the lock-on and lights the moves
    this.onParty = null;     // (open, cursor) -> the screen shows the party bar
    this.onPause = null;
    this.onPlus = null;      // (armed) -> the screen lights the diamond
  }

  setPlus(armed) {
    this.plusArmed = !!armed;
    this.onPlus?.(this.plusArmed);
  }

  openParty(cursor) {
    if (cursor !== undefined) this.partyCursor = cursor;
    this.partyOpen = true;
    this.onParty?.(true, this.partyCursor);
  }

  closeParty() {
    this.partyOpen = false;
    this.onParty?.(false, this.partyCursor);
  }

  key(code, down, held, partySize = 6) {
    const k = this.keys;
    if (!down) return false;
    if (k.party.includes(code)) { if (this.partyOpen) this.closeParty(); else this.openParty(); return true; }
    if (k.prev.includes(code)) { this.openParty((this.partyCursor + partySize - 1) % partySize); return true; }
    if (k.next.includes(code)) { this.openParty((this.partyCursor + 1) % partySize); return true; }
    if (k.send.includes(code)) { if (this.partyOpen) { this.queue.sw = this.partyCursor; this.closeParty(); } else this.openParty(); return true; }
    if (this.partyOpen) {
      const slot = k.slots.indexOf(code);
      if (slot >= 0) { this.queue.sw = slot; this.closeParty(); return true; }
      if (code === "Escape") { this.closeParty(); return true; }
    }
    const move = k.moves.findIndex((list) => list.includes(code));
    if (move >= 0) { this.queue.use = move; return true; }
    if (k.roll.includes(code)) { this.queue.dodge = true; return true; }
    if (k.plus.includes(code)) { this.setPlus(!this.plusArmed); return true; }
    if (k.mega.includes(code)) { this.queue.mega = true; return true; }
    return [...k.up, ...k.down, ...k.left, ...k.right, ...k.focus].includes(code) || held === undefined;
  }

  /** The input for the next tick: held direction + queued taps (then cleared). */
  take(held, partySize = 6) {
    const k = this.keys;
    const on = (list) => list.some((c) => held.has(c));
    let mx = (on(k.right) ? 1 : 0) - (on(k.left) ? 1 : 0);
    let my = (on(k.down) ? 1 : 0) - (on(k.up) ? 1 : 0);
    let focus = on(k.focus);
    const pad = this.readPad(partySize);
    if (pad) {
      if (Math.abs(pad.x) > 0.2 || Math.abs(pad.y) > 0.2) { mx = pad.x; my = pad.y; }
      focus = focus || pad.focus;
    }
    this.focus = focus;
    const l = Math.sqrt(mx * mx + my * my);
    if (l > 1) { mx /= l; my /= l; }
    // the simple layout is always locked on (the old feel); the Z-A one locks on while the focus key is held
    const out = { mx: Math.round(mx * 100) / 100, my: Math.round(my * 100) / 100, ...this.queue, focus: this.layout === "simple" || focus,
      plus: this.plusArmed && this.queue.use >= 0 };
    this.queue = { use: -1, dodge: false, sw: -1, mega: false };
    return out;
  }

  readPad(partySize) {
    if (this.pad < 0 || typeof navigator === "undefined" || !navigator.getGamepads) return null;
    const gp = navigator.getGamepads()[this.pad];
    if (!gp) return null;
    const b = (i) => !!gp.buttons[i]?.pressed;
    const edge = (i) => { const now = b(i); const was = this.padPrev[i]; this.padPrev[i] = now; return now && !was; };
    const focus = b(6);
    const hit = {};
    for (const i of [0, 1, 2, 3, 4, 5, 7, 8, 9, 12, 13, 14, 15]) hit[i] = edge(i);
    if (this.layout === "za") {
      // ZL + X A B Y: the move in that corner of the diamond; without ZL, Y rolls (and B, the dash: there is no running here)
      for (const [btn, slot] of Object.entries(FACE_TO_SLOT)) {
        if (!hit[btn]) continue;
        if (focus) this.queue.use = slot;
        else if (btn === "2" || btn === "0") this.queue.dodge = true;
      }
      // R Mega Evolves; + with ZL held arms a Plus move (+ alone pauses)
      if (hit[5]) this.queue.mega = true;
      if (hit[9] && focus) this.setPlus(!this.plusArmed);
    } else {
      // simple: A B X Y (Xbox positions 0 1 2 3) -> moves 1-4 without focusing; RB / ZR roll; L Mega Evolves; - arms Plus
      for (let i = 0; i < 4; i++) if (hit[i]) this.queue.use = i;
      if (hit[5] || hit[7]) this.queue.dodge = true;
      if (hit[4]) this.queue.mega = true;
      if (hit[8]) this.setPlus(!this.plusArmed);
    }
    if (hit[14]) this.openParty((this.partyCursor + partySize - 1) % partySize);
    if (hit[15]) this.openParty((this.partyCursor + 1) % partySize);
    if (hit[12]) { if (this.partyOpen) { this.queue.sw = this.partyCursor; this.closeParty(); } else this.openParty(); }
    if (hit[13] && this.partyOpen) this.closeParty();
    if (hit[9] && !(this.layout === "za" && focus)) this.onPause?.();
    return { x: gp.axes[0] || 0, y: gp.axes[1] || 0, focus };
  }
}

/** The input objects for a battle's people: one person -> keyboard + first gamepad; two -> p1 on the left of the keyboard (or
 * gamepad 0 if there are two pads), p2 on the right (or a gamepad). */
export function makeInputs(humans, layout = "za") {
  const pads = typeof navigator !== "undefined" && navigator.getGamepads ? [...navigator.getGamepads()].filter(Boolean).map((g) => g.index) : [];
  const out = [null, null];
  const people = [0, 1].filter((i) => humans[i]);
  if (people.length === 1) out[people[0]] = new SeatInput("solo", pads[0] ?? 0, layout);
  if (people.length === 2) {
    out[0] = new SeatInput("p1", pads.length >= 2 ? pads[0] : -1, layout);
    out[1] = new SeatInput("p2", pads.length >= 2 ? pads[1] : pads[0] ?? -1, layout);
  }
  return out;
}
