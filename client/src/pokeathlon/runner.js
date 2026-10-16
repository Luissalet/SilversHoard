// Plays one Pokéathlon event on a canvas: loads the Pokémon's walking sprites, wires mouse / touch / keyboard / gamepad into the event's
// ctx, runs the 3-2-1 countdown, the update loop (dt clamped to 1/20 s), the "Fin" banner, pause and sound. The rules live in the event
// modules and in core.js; this file is the part that needs a browser.
//
// With the `lockstep` option the runner plays a Pokéathlon room (pokeathlon_rooms.py) instead: it only loads the sprites until the room says
// go (begin), then produces one frame of this person's input per tick `delay` ticks ahead, receives everybody else's through feed(), and
// runs a tick (lockstep.js) whenever the frames of everybody still playing are in. A computer that is behind (a spectator who arrives
// late, a page that was reloaded) runs ticks as fast as it can until it has caught up. No pause: the others would wait for it.
import { Animator, image, loadMeta } from "../battle/rt/pmd.js";
import { sfx as playSfx } from "../audio.js";
import { H, Input, STEP, W, makeCtx } from "./core.js";
import { Lockstep } from "./lockstep.js";

// the contract's sound names -> the cues audio.js synthesizes
const SFX = {
  start: ["statUp", {}],
  whistle: ["plus", {}],
  jump: ["switchIn", { vol: 0.45, pitch: 1.25 }],
  hit: ["hit", { vol: 0.8 }],
  crash: ["thud", {}],
  score: ["heal", { vol: 0.8 }],
  catch: ["chip", { vol: 0.9, pitch: 1.4 }],
  break: ["super", { vol: 0.7 }],
  throw: ["move", { vol: 0.7 }],
  fall: ["faint", { vol: 0.5 }],
  cheer: ["win", { vol: 0.9 }],
  end: ["megaEnd", {}],
  tick: ["click", { vol: 3, pitch: 0.7 }],
};

const PRELOAD = ["Idle", "Walk", "Attack", "Hurt", "Shoot", "Hop", "Charge", "Sleep"];
const GAME_KEYS = new Set(["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Tab", "Enter", "Backspace"]);

/** An animator that can be asked for things before its sheets arrive: the loop it was told is applied the moment they load. */
export class LazyAnimator {
  constructor() { this.inner = null; this.loopName = "Idle"; this.loopSpeed = 1; this.meta = null; }
  attach(inner) {
    this.inner = inner;
    this.meta = inner.meta;
    inner.loop(this.loopName, this.loopSpeed);
  }
  get cur() { return this.inner ? this.inner.cur : this.loopName; }
  get done() { return this.inner ? this.inner.done : true; }
  has(a) { return this.inner ? this.inner.has(a) : false; }
  name(a) { return this.inner ? this.inner.name(a) : a; }
  loop(a, s = 1) { this.loopName = a; this.loopSpeed = s; if (this.inner) this.inner.loop(a, s); }
  play(a, o) { if (this.inner) this.inner.play(a, o); }
  busy() { return this.inner ? this.inner.busy() : false; }
  update(dt) { if (this.inner) this.inner.update(dt); }
  draw(g, x, y, row, k, o) { return this.inner ? this.inner.draw(g, x, y, row, k, o) : false; }
  height(k) { return this.inner ? this.inner.height(k) : 30; }
}

const COUNT_SECONDS = 64 / 30;
const FIN_SECONDS = 61 / 30;

export class EventRunner {
  /**
   * canvas, mod (the event module), teams (the four of the contract), seed, lang, mode ("play" | "watch" | "practice"), supreme,
   * base (the app's URL prefix), iconUrl(mon) -> url, onFinish({raw, detail}), onPhase(phase), muted.
   * lockstep: null, or { seat (the team this person steers, -1 for a spectator), delay, send(from, frames), hash(tick, sum), done(result, sum) }.
   */
  constructor({ canvas, mod, teams, seed = 1, lang = "es", mode = "play", supreme = false, base = "", iconUrl = null, onFinish = null, onPhase = null, muted = false, lockstep = null }) {
    this.canvas = canvas;
    this.mod = mod;
    this.teams = teams;
    this.base = base;
    this.iconUrl = iconUrl;
    this.onFinish = onFinish;
    this.onPhase = onPhase;
    this.muted = muted;
    this.lang = lang;
    this.input = new Input();
    this.phase = "load";
    this.paused = false;
    this.dead = false;
    this.countT = 0;
    this.endT = 0;
    this.goT = 0;
    this.lastNum = 0;
    this.last = 0;
    this.raf = 0;
    this.cssW = 0;
    this.scale = 1;
    this.animators = new Map();
    this.icons = new Map();
    this.silent = false;
    // a room: what the events read is one "applied" Input per team, fed from the frames; this.input is only the device
    this.lk = lockstep ? { ...lockstep, ls: null, pending: [[], [], [], []], acc: 0, stalled: 0, live: false, hashed: 0 } : null;
    this.ctx = makeCtx({
      teams, seed, lang, input: this.input, mode, supreme,
      ...(this.lk ? { inputs: [0, 1, 2, 3].map(() => new Input()), focus: this.lk.seat >= 0 ? this.lk.seat : Math.max(0, teams.findIndex((t) => t.human)) } : {}),
      animator: (t, s) => this._animator(t, s),
      icon: (t, s) => this._icon(t, s),
      sfx: (name, opts) => this._sfx(name, opts),
      finish: (r) => this._finished(r),
    });
    this.inst = null;
    this._bind();
  }

  // ---------------------------------------------------------------------------------------------------------- sprites and sounds
  _animator(t, s) {
    const key = t * 3 + s;
    if (!this.animators.has(key)) this.animators.set(key, new LazyAnimator());
    return this.animators.get(key);
  }

  _icon(t, s) {
    const key = t * 3 + s;
    if (this.icons.has(key)) return this.icons.get(key);
    const mon = this.teams[t] && this.teams[t].mons[s];
    let img = null;
    if (mon && this.iconUrl) {
      img = new Image();
      img.src = this.iconUrl(mon);
    }
    this.icons.set(key, img);
    return img;
  }

  _sfx(name, opts) {
    if (this.muted || this.dead || this.silent) return;
    const m = SFX[name];
    if (m) playSfx(m[0], { ...m[1], ...(opts || {}), gap: 0.03 });
  }

  /** Fetch the sheets of all twelve Pokémon (the app downloads them from SpriteCollab the first time) and create the event. */
  async prepare(timeoutMs = 7000) {
    const jobs = [];
    this.teams.forEach((team, ti) => team.mons.forEach((mon, si) => {
      jobs.push(loadMeta(mon.num, { form: mon.form || "", base: this.base }).then((meta) => {
        if (!meta || this.dead) return;
        this._animator(ti, si).attach(new Animator(meta, this.base));
        for (const a of PRELOAD) if (meta.a && meta.a[a]) image(`${this.base}/api/sprites/pmd-sheet/${meta.key}/${a}.png`);
      }).catch(() => {}));
      this._icon(ti, si);
    }));
    await Promise.race([Promise.all(jobs), new Promise((r) => setTimeout(r, timeoutMs))]);
    if (this.dead) return;
    if (this.lk) {                 // a room creates the event at "go", when it is known who is playing
      this._setPhase("ready");
      this.resize();
      return;
    }
    this.inst = this.mod.create(this.ctx);
    this._setPhase("ready");
    this.resize();
    this._startLoop();
  }

  // ------------------------------------------------------------------------------------------------------------------ a room
  /** The room said go: `humans` are the teams people steer. `catchUp`: the round is already under way (skip the countdown). */
  begin(humans, { catchUp = false } = {}) {
    if (!this.lk || this.inst || this.dead) return;
    this.teams.forEach((t, i) => { t.human = humans.includes(i); });
    this.inst = this.mod.create(this.ctx);
    const lk = this.lk;
    lk.ls = new Lockstep(this.ctx, this.inst, humans);
    lk.live = lk.seat >= 0 && humans.includes(lk.seat);
    for (let t = 0; t < 4; t++) if (lk.pending[t].length) lk.ls.feed(t, 1, lk.pending[t]);
    lk.pending = [[], [], [], []];
    this.resize();
    if (catchUp) { this.silent = true; this.goT = 0; this._setPhase("play"); } else { this.countT = 0; this.lastNum = 4; this._setPhase("count"); }
    this._startLoop();
  }

  /** Frames of a team from tick `from` (1-based) on, as the room relays them. */
  feed(team, from, list) {
    const lk = this.lk;
    if (!lk || team < 0 || team > 3) return;
    if (lk.ls) { lk.ls.feed(team, from, list); return; }
    const mine = lk.pending[team];
    (list || []).forEach((f, i) => { if (from + i === mine.length + 1) mine.push(f); });
  }

  /** After a reconnection: send again what the room says it lacks of this person's frames (`have` = how many it holds). */
  resend(have) {
    const lk = this.lk;
    if (!lk || !lk.live || !lk.ls) return;
    const mine = lk.ls.frames[lk.seat];
    if (mine.length > have) lk.send(have + 1, mine.slice(have));
  }

  /** Teams the next tick is waiting for (a person whose frame has not come). */
  waitingFor() { return this.lk && this.lk.ls ? this.lk.ls.waitingFor() : []; }

  _produce() {
    const lk = this.lk;
    const ls = lk.ls;
    if (!lk.live || !ls.active.has(lk.seat)) return;
    const mine = ls.frames[lk.seat];
    const from = mine.length + 1;
    const batch = [];
    while (mine.length - ls.tick < lk.delay) {
      this.input.frame();
      const f = this.input.snapshot();
      ls.feed(lk.seat, mine.length + 1, [f]);
      batch.push(f);
    }
    if (batch.length) lk.send(from, batch);
  }

  _stepLockstep(dt) {
    const lk = this.lk;
    const ls = lk.ls;
    this._readPad();
    this._produce();
    lk.acc = Math.min(lk.acc + dt, STEP * 4);
    const have = Math.min(...[...ls.active].map((t) => ls.frames[t].length - ls.tick), Infinity);
    const fast = Number.isFinite(have) && have > lk.delay + 4;          // far behind the others: run as fast as the machine allows
    this.silent = fast;
    const t0 = performance.now();
    let ran = 0;
    try {
      while (this.phase === "play" && (fast || lk.acc >= STEP) && ls.ready()) {
        if (!fast) lk.acc -= STEP;
        ls.step();
        ran++;
        if (lk.hash && lk.live && ls.tick % 60 === 0 && ls.tick !== lk.hashed) { lk.hashed = ls.tick; lk.hash(ls.tick, this.ctx.rng.sum); }
        if (this.ctx.finished) break;
        this._produce();
        if (fast ? performance.now() - t0 > 10 : ran >= 3) break;
      }
    } catch (e) { this._fail(e); return; }
    if (this.phase === "play" && !ran && !ls.ready()) lk.stalled += dt; else lk.stalled = 0;
    if (this.goT > 0) this.goT -= dt;
  }

  _setPhase(p) {
    this.phase = p;
    if (this.onPhase) this.onPhase(p);
  }

  /** The 3-2-1 and the event. */
  start() {
    if (this.phase !== "ready") return;
    this.countT = 0;
    this.lastNum = 4;
    this._setPhase("count");
  }

  _finished(r) {
    this.result = r;
    this.endT = FIN_SECONDS;
    this.silent = false;
    this._setPhase("end");
    this._sfx("whistle");
    if (this.lk && this.lk.live && this.lk.done) this.lk.done(r, this.ctx.rng.sum);
  }

  // ----------------------------------------------------------------------------------------------------------------- the loop
  _startLoop() {
    if (this.raf) return;
    this.last = performance.now();
    const tick = (ts) => {
      if (this.dead) return;
      this.raf = requestAnimationFrame(tick);
      const dt = Math.min(1 / 20, Math.max(0, (ts - this.last) / 1000));
      this.last = ts;
      this._step(dt);
    };
    this.raf = requestAnimationFrame(tick);
  }

  _readPad() {
    const pads = typeof navigator !== "undefined" && navigator.getGamepads ? navigator.getGamepads() : [];
    const pad = [...pads].find((p) => p && p.connected);
    if (!pad) { this.input.setPad(0, 0, 0, 0, new Set()); return; }
    const dz = (v) => (Math.abs(v) < 0.18 ? 0 : v);
    const held = new Set();
    pad.buttons.forEach((b, i) => { if (b.pressed) held.add(i); });
    this.input.setPad(dz(pad.axes[0] || 0), dz(pad.axes[1] || 0), dz(pad.axes[2] || 0), dz(pad.axes[3] || 0), held);
  }

  _step(dt) {
    if (this.lk && this.phase === "play" && this.lk.ls) {
      this._stepLockstep(dt);
      this._draw();
      return;
    }
    if (!this.lk && document.hidden && !this.paused && (this.phase === "play" || this.phase === "count")) this.pause(true);
    this._readPad();
    this.input.frame();
    if (this.paused) {
      if (this.input.any) this.pause(false);
      this._draw();
      return;
    }
    if (this.phase === "count") {
      this.countT += dt;
      const n = this.countT < 0.7 ? 3 : this.countT < 1.4 ? 2 : 1;
      if (n !== this.lastNum && this.countT < COUNT_SECONDS) { this.lastNum = n; this._sfx("tick", { pitch: 0.7 + (3 - n) * 0.15 }); }
      if (this.countT >= COUNT_SECONDS) { this.goT = 0.7; this._setPhase("play"); this._sfx("start"); }
    } else if (this.phase === "play") {
      if (this.goT > 0) this.goT -= dt;
      try { this.inst.update(dt); } catch (e) { this._fail(e); return; }
    } else if (this.phase === "end") {
      try { this.inst.update(dt); } catch (e) { /* the event is over: a late error in its animation does not matter */ }
      this.endT -= dt;
      if (this.endT <= 0) {
        this._setPhase("done");
        if (this.onFinish) this.onFinish(this.result);
      }
    }
    this._draw();
  }

  _fail(e) {
    // an event that throws must not freeze the course: report what the page can and end it with zeros
    console.error("Pokéathlon event error", e); // eslint-disable-line no-console
    if (!this.ctx.finished) this.ctx.finish({ raw: [0, 0, 0, 0], detail: [{}, {}, {}, {}] });
  }

  _draw() {
    const c = this.canvas;
    const g = c.getContext("2d");
    if (!g || !this.inst) return;
    g.setTransform(this.scale, 0, 0, this.scale, 0, 0);
    g.clearRect(0, 0, W, H);
    try { this.inst.render(g); } catch (e) { console.error("Pokéathlon render error", e); } // eslint-disable-line no-console
    const ui = this.ctx.ui;
    const t = (es, en) => (this.lang === "en" ? en : es);
    if (this.phase === "ready") {
      g.fillStyle = "rgba(6,10,20,.35)";
      g.fillRect(0, 0, W, H);
    } else if (this.phase === "count") {
      const n = this.countT < 0.7 ? 3 : this.countT < 1.4 ? 2 : 1;
      const local = this.countT < 0.7 ? this.countT / 0.7 : this.countT < 1.4 ? (this.countT - 0.7) / 0.7 : (this.countT - 1.4) / 0.74;
      g.save();
      g.globalAlpha = 1 - Math.max(0, local - 0.7) / 0.3;
      const k = 1 + (1 - Math.min(1, local * 2)) * 0.35;
      g.translate(W / 2, H / 2);
      g.scale(k, k);
      ui.text(g, String(n), 0, 70, { size: 220, align: "center", color: "#ffd166", strokeW: 16 });
      g.restore();
    } else if (this.phase === "play" && this.goT > 0) {
      g.save();
      g.globalAlpha = Math.min(1, this.goT / 0.4);
      ui.text(g, t("¡Ya!", "Go!"), W / 2, H / 2 + 50, { size: 150, align: "center", color: "#7ee081", strokeW: 12 });
      g.restore();
    } else if (this.phase === "end" || this.phase === "done") {
      ui.banner(g, t("¡Fin!", "Finish!"), "", H / 2 - 70);
    }
    if (this.lk && this.phase === "play" && this.lk.stalled > 0.4 && this.lk.ls) {
      const names = this.lk.ls.waitingFor().map((i) => this.teams[i].name);
      g.fillStyle = "rgba(4,8,16,.55)";
      g.fillRect(0, H - 70, W, 46);
      ui.text(g, `${t("Esperando a", "Waiting for")} ${names.join(", ")}…`, W / 2, H - 38, { size: 24, align: "center", color: "#ffd166" });
    }
    if (this.paused) {
      g.fillStyle = "rgba(4,8,16,.72)";
      g.fillRect(0, 0, W, H);
      ui.text(g, t("Pausa", "Paused"), W / 2, H / 2, { size: 80, align: "center" });
      ui.text(g, t("Pulsa cualquier tecla o haz clic para seguir", "Press any key or click to go on"), W / 2, H / 2 + 50, { size: 24, align: "center", color: "#b8c4dc" });
    }
  }

  pause(on = !this.paused) {
    if (this.lk) return;                          // the others would be waiting for this person
    if (on === this.paused) return;
    if (on && (this.phase !== "play" && this.phase !== "count")) return;
    this.paused = on;
    this.input.releaseAll();
  }

  // -------------------------------------------------------------------------------------------------------------------- sizing
  /** Size the canvas to a CSS width (16:9); without arguments it uses the width of its parent. */
  resize(cssW) {
    const c = this.canvas;
    const parent = c.parentElement;
    const maxW = cssW || (parent ? parent.clientWidth : W);
    const w = Math.max(320, Math.floor(maxW));
    const h = Math.round((w * H) / W);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const px = Math.min(1920, Math.round(w * dpr));
    c.style.width = `${w}px`;
    c.style.height = `${h}px`;
    if (c.width !== px) {
      c.width = px;
      c.height = Math.round((px * H) / W);
    }
    this.cssW = w;
    this.scale = c.width / W;
  }

  // ---------------------------------------------------------------------------------------------------------------------- input
  _pos(e) {
    const r = this.canvas.getBoundingClientRect();
    return [((e.clientX - r.left) * W) / r.width, ((e.clientY - r.top) * H) / r.height];
  }

  _bind() {
    const c = this.canvas;
    this.h = {
      down: (e) => {
        const [x, y] = this._pos(e);
        if (e.pointerType === "mouse" || e.button === 0 || e.button === 2) {
          try { c.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
        }
        this.input.pointerDown(x, y, e.timeStamp, e.button === 2 ? 2 : 0);
        e.preventDefault();
      },
      move: (e) => { const [x, y] = this._pos(e); this.input.pointerMove(x, y, e.timeStamp); },
      up: (e) => { const [x, y] = this._pos(e); this.input.pointerUp(x, y, e.timeStamp); },
      leave: () => this.input.pointerLeave(),
      menu: (e) => e.preventDefault(),
      wheel: (e) => { this.input.wheel(e.deltaY); e.preventDefault(); },
      keydown: (e) => {
        if (this.dead) return;
        const tag = (e.target && e.target.tagName) || "";
        if (/INPUT|TEXTAREA|SELECT/.test(tag)) return;
        if (e.code === "Escape" || e.code === "KeyP") { if (!e.repeat) this.pause(); e.preventDefault(); return; }
        if (this.phase !== "play" && this.phase !== "count" && this.phase !== "end" && !this.paused) return;
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        if (GAME_KEYS.has(e.code)) e.preventDefault();
        if (!e.repeat) this.input.keyDown(e.code);
      },
      keyup: (e) => this.input.keyUp(e.code),
      blur: () => this.input.releaseAll(),
    };
    c.addEventListener("pointerdown", this.h.down);
    c.addEventListener("pointermove", this.h.move);
    c.addEventListener("pointerup", this.h.up);
    c.addEventListener("pointercancel", this.h.up);
    c.addEventListener("pointerleave", this.h.leave);
    c.addEventListener("contextmenu", this.h.menu);
    c.addEventListener("wheel", this.h.wheel, { passive: false });
    window.addEventListener("keydown", this.h.keydown, true);
    window.addEventListener("keyup", this.h.keyup, true);
    window.addEventListener("blur", this.h.blur);
  }

  destroy() {
    this.dead = true;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    const c = this.canvas;
    if (this.h) {
      c.removeEventListener("pointerdown", this.h.down);
      c.removeEventListener("pointermove", this.h.move);
      c.removeEventListener("pointerup", this.h.up);
      c.removeEventListener("pointercancel", this.h.up);
      c.removeEventListener("pointerleave", this.h.leave);
      c.removeEventListener("contextmenu", this.h.menu);
      c.removeEventListener("wheel", this.h.wheel);
      window.removeEventListener("keydown", this.h.keydown, true);
      window.removeEventListener("keyup", this.h.keyup, true);
      window.removeEventListener("blur", this.h.blur);
    }
    if (this.inst && this.inst.destroy) { try { this.inst.destroy(); } catch { /* gone */ } }
  }
}
