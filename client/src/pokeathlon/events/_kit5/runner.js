// The loop every event of this folder shares: a fixed 30 Hz simulation step fed from the framework's input, a latch so that a
// click shorter than one step is not lost, the "go" and "time up" banners and the single call to ctx.finish().
// The simulations never see the framework: they get a StepInput and nothing else, so a CPU-only run needs no browser.
import { STEP, clamp, easeOutBack, safe } from "./util.js";
import { text } from "./hud.js";

/**
 * The touch screen as the DS code reads it: touchNew on the first step of a press, touching while it lasts, touchFrames counting the
 * steps it has been down and lastTouchFrames the length of the previous touch (a tap is lastTouchFrames <= 5 in Disc Catch).
 * A press that starts and ends between two steps still shows for one step.
 */
export class DsTouch {
  constructor() {
    this.rawDown = false;
    this.x = 0; this.y = 0;            // where the pointer is now (also while it is up: a hover)
    this.latchPress = false; this.latchX = 0; this.latchY = 0;
    this.touching = false; this.touchNew = false; this.released = false;
    this.touchX = 0; this.touchY = 0;  // last position while it was down
    this.startX = 0; this.startY = 0;  // where this touch began
    this.touchFrames = 0; this.lastTouchFrames = 0;
  }

  feed(pointer) {
    if (!pointer) return;
    if (pointer.pressed) { this.latchPress = true; this.latchX = pointer.x; this.latchY = pointer.y; }
    this.rawDown = !!pointer.down;
    this.x = pointer.x || 0; this.y = pointer.y || 0;
  }

  step() {
    const down = this.rawDown || this.latchPress;
    this.touchNew = false;
    this.released = false;
    if (down) {
      const x = this.rawDown ? this.x : this.latchX;
      const y = this.rawDown ? this.y : this.latchY;
      if (!this.touching) {
        this.touching = true; this.touchNew = true; this.touchFrames = 0;
        this.startX = this.latchPress ? this.latchX : x; this.startY = this.latchPress ? this.latchY : y;
      }
      this.touchFrames++;
      this.touchX = x; this.touchY = y;
    } else {
      if (this.touching) { this.released = true; this.lastTouchFrames = this.touchFrames; }
      this.touching = false;
      this.touchFrames = 0;
    }
    this.latchPress = false;
  }
}

const deadzone = (v) => (Math.abs(v) < 0.28 ? 0 : v);

/** What a simulation step gets: the touch, the keys and the pad with their presses since the previous step. */
class StepInput {
  constructor(run) { this.run = run; this.touch = run.touch; }
  held(...codes) { return codes.some((c) => this.run.keys.has(c)); }
  pressed(...codes) { return codes.some((c) => this.run.keyLatch.has(c)); }
  padHeld(...b) { return b.some((i) => this.run.pad.held.has(i)); }
  padPressed(...b) { return b.some((i) => this.run.padLatch.has(i)); }
  /** left stick */
  get stick() { const p = this.run.pad; return { x: deadzone(p.lx || 0), y: deadzone(p.ly || 0) }; }
  get stick2() { const p = this.run.pad; return { x: deadzone(p.rx || 0), y: deadzone(p.ry || 0) }; }
  /** WASD / arrows / D-pad / left stick as a direction with each axis in -1..1 */
  get dir() {
    const r = this.run;
    let x = 0, y = 0;
    if (r.keys.has("KeyA") || r.keys.has("ArrowLeft") || r.pad.held.has(14)) x -= 1;
    if (r.keys.has("KeyD") || r.keys.has("ArrowRight") || r.pad.held.has(15)) x += 1;
    if (r.keys.has("KeyW") || r.keys.has("ArrowUp") || r.pad.held.has(12)) y -= 1;
    if (r.keys.has("KeyS") || r.keys.has("ArrowDown") || r.pad.held.has(13)) y += 1;
    const s = this.stick;
    if (s.x || s.y) { x = s.x; y = s.y; }
    return { x, y };
  }
}

export class EventRunner {
  /**
   * @param ctx    the framework's ctx
   * @param o.step(inp)       one 1/30 s step of the simulation (only while it is not over)
   * @param o.render(g, a)    draw; a (0..1) is how far the next step is, to smooth motion between two steps
   * @param o.visual(dt)      optional: animation that follows real time (sprites, particles)
   * @param o.isOver()        the clock ran out
   * @param o.result()        { raw: [4], detail: [4] }
   * @param o.endSteps        steps between the end of the clock and finish() (the "time up" banner)
   */
  constructor(ctx, o) {
    this.ctx = ctx;
    this.o = o;
    this.touch = new DsTouch();
    this.keys = new Set(); this.keyLatch = new Set();
    this.pad = { lx: 0, ly: 0, rx: 0, ry: 0, held: new Set(), pressed: new Set() };
    this.padLatch = new Set();
    this.acc = 0;
    this.alpha = 0;
    this.stepNo = 0;
    this.endNo = 0;
    this.finished = false;
    this.time = 0;                      // real seconds, for visuals only
    this.shakeLeft = 0; this.shakeMag = 0;
    this.startSteps = o.startSteps ?? 0;       // the page counts 3-2-1 and says "go" and "finish" itself: no banners of our own unless asked
    this.endSteps = o.endSteps ?? 8;
    this.inp = new StepInput(this);
  }

  sfx(name) { safe(this.ctx.sfx, name); }
  shake(mag, steps) { if (mag >= this.shakeMag || this.shakeLeft <= 0) { this.shakeMag = mag; this.shakeLeft = Math.max(this.shakeLeft, steps); } }
  get over() { return !!this.o.isOver(); }

  update(dt) {
    dt = clamp(Number.isFinite(dt) ? dt : STEP, 0, 1 / 20);
    const inp = this.ctx.input;
    if (inp) {
      this.touch.feed(inp.pointer);
      this.keys = inp.keys || this.keys;
      for (const c of inp.pressed || []) this.keyLatch.add(c);
      if (inp.pad) {
        this.pad = inp.pad;
        for (const b of inp.pad.pressed || []) this.padLatch.add(b);
      }
    }
    this.time += dt;
    this.acc += dt;
    let n = 0;
    while (this.acc >= STEP - 1e-6 && n < 4) {
      this.acc -= STEP;
      n++;
      this.tick();
    }
    if (n >= 4) this.acc = 0;
    this.alpha = clamp(this.acc / STEP, 0, 1);
    safe(this.o.visual, dt, this);
  }

  tick() {
    this.touch.step();
    if (this.shakeLeft > 0) this.shakeLeft--;
    if (!this.over) {
      this.stepNo++;
      this.o.step(this.inp, this);
    } else if (!this.finished) {
      this.endNo++;
      safe(this.o.idle, this);
      if (this.endNo >= this.endSteps) {
        this.finished = true;
        this.ctx.finish(this.o.result());
      }
    }
    this.keyLatch.clear();
    this.padLatch.clear();
  }

  render(g) {
    g.save();
    if (this.shakeLeft > 0) {
      const m = this.shakeMag * Math.min(1, this.shakeLeft / 6);
      g.translate(Math.sin(this.time * 91) * m, Math.cos(this.time * 77) * m);
    }
    this.o.render(g, this.alpha, this);
    g.restore();
    this.drawBanner(g);
  }

  drawBanner(g) {
    const t = this.ctx.t ? this.ctx.t.bind(this.ctx) : (es) => es;
    if (this.startSteps > 0 && this.stepNo > 0 && this.stepNo <= this.startSteps && !this.over) {
      const k = this.stepNo / this.startSteps;
      g.save();
      g.globalAlpha = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
      const s = 0.6 + 0.5 * easeOutBack(Math.min(1, k * 2.2));
      g.translate(480, 250); g.scale(s, s);
      text(g, t("¡YA!", "GO!"), 0, 0, { size: 96, weight: 900, color: "#ffe45c", align: "center", base: "middle", stroke: "#1a1230", strokeW: 10 });
      g.restore();
    }
    if (this.o.endBanner && this.over && !this.finished) {
      const k = Math.min(1, this.endNo / 12);
      g.save();
      g.fillStyle = `rgba(10,8,24,${0.35 * k})`;
      g.fillRect(0, 0, 960, 540);
      const s = 0.5 + 0.5 * easeOutBack(k);
      g.translate(480, 262); g.scale(s, s);
      text(g, t(this.o.endText?.es || "¡TIEMPO!", this.o.endText?.en || "TIME!"), 0, 0,
        { size: 104, weight: 900, color: "#ffffff", align: "center", base: "middle", stroke: "#e23a5a", strokeW: 12 });
      g.restore();
    }
  }

  destroy() { this.finished = true; }
}
