// The pixelfx animation style: plays the vendored pixel-art effects (./fx, from patch-gg/pixelfx, MIT) over the real-time arena and the
// turn-based stage. One layer per painter (rt/vfx.js owns it, loaded on demand). It only reads the public events and views and draws:
// it never writes simulation state, so the style cannot change a result. Every effect is seeded from the battle, the tick and the
// event, so a replay or a video plays the same pixels.
//
// Where an effect plays comes from its role (mapping.js): a projectile follows the shot, a beam or a cone starts at the user and points at
// its target, a hit lands on the target (a melee blow is placed so its own target point falls on the Pokemon hit), an area or a drop sits
// on the area, a self effect on the user, a screen effect (weather, terrain) over the whole field. Effects that play on a body (frozen,
// burning, a halo) get the Pokemon's own pixels, read from the canvas the first frame after they start (captureActor); where nothing
// can be read (the turn-based screen) they play their fallback instead.
import { createFrame, clearFrame, createFx, composite } from "./core/index.js";
import { EFFECTS, effectInfo } from "./registry.js";
import { pickEffect, hitEffects, statusEffect, conditionEffect, eventEffect, fieldEffect, typeRamp, ramp, fxSeed, ROLE_INFO, setPins } from "./mapping.js";

const Q0 = 16;          // effect pixels per meter: the stock 24 px character is a Pokemon of 1.5 m
const MAX_LIVE = 18;
const STEP = 1 / 120;
const SCREEN_FPS = 12;  // weather and terrain repaint at this rate (they drift slowly; the field keeps its full frame rate)
const WAIT_BODY = 0.35; // seconds an on-body effect waits for the Pokemon's pixels before it is dropped

const hasPixels = (f) => { const c = f.color, l = f.light; for (let i = 0; i < c.length; i++) if (c[i] | l[i]) return true; return false; };
const INFO = new Map();
const info = (id) => { let i = INFO.get(id); if (!i) { i = effectInfo(id); INFO.set(id, i); } return i; };

function frameFor(meta, rotates) {
  const [w, h] = meta.size || [128, 128];
  const [ox, oy] = meta.origin || [w / 2, h / 2];
  if (!rotates) return createFrame(w, h, -ox, -oy);
  const s = 2 * Math.ceil(Math.hypot(Math.max(ox, w - ox), Math.max(oy, h - oy)));
  return createFrame(s, s, -s / 2, -s / 2);
}

export function paletteOf(plan, type) {
  if (!plan.tint) return undefined;
  return plan.color ? ramp(plan.color) : typeRamp(plan.type || type);
}

/** The pixels of an effect after `seconds`, as a 32-bit checksum: the same id, seed and options always give the same number. */
export function effectChecksum(id, { seed = 1, seconds = 0.5, palette, flip = false, angle = 0 } = {}) {
  const mod = EFFECTS[id];
  if (!mod) throw new Error(`unknown pixelfx effect ${id}`);
  const frame = frameFor(mod.meta, flip || angle !== 0);
  const o = { x: 0, y: 0, seed, flip, angle };
  if (palette) o.palette = palette;
  const fx = createFx(mod, o);
  for (let t = 0; t < seconds - 1e-9; t += STEP * 2) fx.update(STEP * 2);
  clearFrame(frame);
  fx.draw(frame, "back"); fx.draw(frame, "front");
  let h = 0x811c9dc5;
  for (const a of [frame.color, frame.light]) for (let i = 0; i < a.length; i++) { h ^= a[i]; h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

/** An actor for the effects that play on a body, from RGBA pixels (w x h) whose top-left sits at (x, y) from the feet. */
export function actorFromPixels(rgba, w, h, x, y) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) if (rgba[(j * w + i) * 4 + 3] > 96) { if (i < x0) x0 = i; if (i > x1) x1 = i; if (j < y0) y0 = j; if (j > y1) y1 = j; }
  if (x1 < 0) return null;
  const W = x1 - x0 + 1, H = y1 - y0 + 1, data = new Uint8Array(W * H), pixels = new Uint32Array(W * H);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const k = ((j + y0) * w + i + x0) * 4;
    if (rgba[k + 3] > 96) { data[j * W + i] = 1; pixels[j * W + i] = ((255 << 24) | (rgba[k + 2] << 16) | (rgba[k + 1] << 8) | rgba[k]) >>> 0; }
  }
  const ax = Math.round(x + x0), ay = Math.round(y + y0);
  return { mask: { w: W, h: H, data }, pixels, x: ax, y: ay, w: W, h: H, k: 2, head: [ax + W / 2, ay], chest: [ax + W / 2, ay + Math.round(H * 0.4)] };
}

const unitOf = (battle, s, u = 0) => (battle?.doubles ? battle.sides?.[s]?.units?.[u || 0] : battle?.sides?.[s]) || null;
const keyOf = (s, u) => `${s}:${u || 0}`;

export class PixelfxLayer {
  constructor(renderer) {
    this.r = renderer;
    this.list = [];
    this.pending = [];         // on-body effects waiting for the Pokemon's pixels
    this.want = new Set();     // "side:unit" whose pixels the next frame should read
    this.actors = new Map();   // "side:unit" -> {actor, scale}
    this.canCapture = false;   // the painter hands this layer its Pokemon (captureActor): only the real-time arena does
    this.uses = new Map();     // "side:move" -> {category, shape, type}, from the last use event
    this.drops = new Map();    // "side:unit" -> move of a drop whose wind-up has started
    this.screens = { weather: null, terrain: null };
    this.serial = 0;
    this.battleSeed = "";
    this.battle = null;
    this.area = null;          // the field's size in meters (the turn-based screen sets a smaller one)
    this.reduced = () => false;
  }

  busy() { return this.list.length > 0 || this.pending.length > 0; }
  owns(id) { return id !== undefined && this.list.some((e) => e.follow === id); }
  clear() { this.list.length = 0; this.pending.length = 0; this.drops.clear(); this.screens = { weather: null, terrain: null }; }
  dispose() { this.clear(); this.uses.clear(); this.actors.clear(); this.disposed = true; }
  /** Effects pinned by hand to moves (the explorer): they win over the automatic mapping. */
  setPins(pins) { setPins(pins); }

  // ------------------------------------------------------------ spawning
  spawn(plan, { type, x, y, angle = 0, flip = false, scale = 1, follow = null, seedParts = [], rotates = false, unit = null, hold } = {}) {
    if (!plan || this.disposed) return null;
    let mod = EFFECTS[plan.id];
    if (!mod) return null;
    if (this.reduced() && ["beam", "area", "drop", "projectile", "screen"].includes(plan.role)) return null;
    const meta = info(plan.id);
    // on-body effects: with the Pokemon's pixels (real time) or their fallback (or nothing) where they cannot be read
    if (meta.on_body) {
      if (!this.canCapture || !unit) {
        const fb = plan.fallback || plan.flat;
        if (!fb) return null;
        return this.spawn({ ...plan, ...fb, fallback: null, flat: null }, { type, x, y, angle, flip, scale, follow, seedParts, rotates, unit: null, hold });
      }
      const seed = fxSeed(this.battleSeed, plan.id, this.serial++, ...seedParts);
      this.want.add(unit);
      this.pending.push({ plan, args: { type, x, y, flip, scale, unit, hold }, seed, age: 0 });
      return { pending: true };
    }
    return this.make(plan, mod, meta, { type, x, y, angle, flip, scale, follow, rotates, unit, hold }, fxSeed(this.battleSeed, plan.id, this.serial++, ...seedParts));
  }

  make(plan, mod, meta, { type, x, y, angle = 0, flip = false, scale = 1, follow = null, rotates = false, unit = null, hold, actor = null }, seed) {
    const rot = rotates || angle !== 0;
    const o = { x: 0, y: 0, seed, flip, angle };
    const palette = paletteOf(plan, type);
    if (palette) o.palette = palette;
    if (actor) o.actor = actor;
    let fx;
    try { fx = createFx(mod, o); } catch { return null; }
    while (this.list.length >= MAX_LIVE) {
      const i = this.list.findIndex((e) => e.role !== "projectile" && e.role !== "screen");
      if (i < 0) break;
      this.list.splice(i, 1);
    }
    // one-shots short enough play through; longer ones (and loops) are stopped after the role's time and fade out
    const whole = !meta.loop && meta.seconds <= 3.5 ? Math.min(meta.seconds, 2.2) : 0;
    const e = { id: plan.id, role: plan.role, fx, frame: frameFor(mod.meta, rot || flip), x, y, z: plan.z ?? ROLE_INFO[plan.role]?.z ?? 0, scale,
      follow, unit, age: 0, hold: hold ?? Math.max(plan.hold ?? 1, plan.role === "projectile" || plan.role === "screen" ? 0 : whole), stopped: false, seen: false, canvas: null };
    this.list.push(e);
    return e;
  }

  /** Where the screen's pixels point from (x, y) to (x + dx, y + dy), for effects that face right. */
  angleOf(x, y, dx, dy) {
    const r = this.r;
    return Math.atan2(r.py(y + dy) - r.py(y), r.px(x + dx) - r.px(x));
  }

  /** Where a blow lands: melee effects (and other effects that face right) are placed so their own target point falls on the Pokemon hit. */
  landing(plan, d, att, scale) {
    const i = info(plan.id);
    const reach = i.reach || (i.directional && !["impacts", "explosions"].includes(i.category) ? (i.size[0] - i.origin[0]) * 0.5 : 0);
    if (!reach || !att) return { x: d.x, y: d.y, flip: !!att && d.x < att.x };
    const dx = d.x - att.x, dy = d.y - att.y, len = Math.hypot(dx, dy) || 1, m = (reach / Q0) * scale;
    return { x: d.x - (dx / len) * Math.min(m, len), y: d.y - (dy / len) * Math.min(m, len), flip: dx < 0 };
  }

  planOf(e) {
    const used = this.uses.get(`${e.s}:${e.move}`) || {};
    return pickEffect({ type: e.type || used.type, category: e.category || used.category, shape: e.shape || used.shape, move: e.move });
  }

  // ------------------------------------------------------------ events (a hit returns what the painter's own effect should skip)
  event(e, battle) {
    if (this.disposed) return null;
    if (battle) this.battle = battle;
    if (e.t !== undefined && battle?.seed !== undefined) this.battleSeed = String(battle.seed);
    const sp = [e.t, e.s, e.u || 0, e.move || e.k];
    switch (e.k) {
      case "use": {
        this.uses.set(`${e.s}:${e.move}`, { category: e.category, shape: e.shape, type: e.type });
        if (this.uses.size > 64) this.uses.delete(this.uses.keys().next().value);
        const a = unitOf(battle, e.s, e.u);
        if (!a) return null;
        const plan = this.planOf(e);
        if (plan.role === "self") {
          const made = this.spawn(plan, { type: e.type, x: a.x, y: a.y, scale: 0.9, seedParts: sp, unit: keyOf(e.s, e.u) });
          return made && e.shape === "self" ? { aura: true } : null;
        }
        return e.shape === "strike" || e.shape === "dash" ? { melee: true } : null;
      }
      case "windup":
        if (e.shape === "drop") this.drops.set(keyOf(e.s, e.u), e.move);
        return null;
      case "shot": {
        let plan = this.planOf(e);
        const used = this.uses.get(`${e.s}:${e.move}`) || {};
        if (plan.role !== "beam" && plan.role !== "projectile") plan = pickEffect({ type: e.type, category: used.category, shape: e.shape || used.shape || "shot" });
        const ang = this.angleOf(e.x, e.y, e.vx || 1, e.vy || 0);
        const made = plan.role === "beam"
          ? this.spawn({ ...plan, hold: 5 }, { type: e.type, x: e.x, y: e.y, angle: ang, follow: e.id, scale: 1, seedParts: sp, rotates: true })
          : this.spawn({ ...plan, role: "projectile", hold: 6, z: ROLE_INFO.projectile.z }, { type: e.type, x: e.x, y: e.y, angle: ang, follow: e.id, scale: 0.85, seedParts: sp, rotates: true });
        return made ? { ray: true, ball: true } : null;
      }
      case "impact": case "fizzle":
        for (const f of this.list) if (f.follow === e.id) f.end = true;
        return null;
      case "hit": {
        const d = unitOf(battle, e.s, e.u);
        if (!d) return null;
        const first = e.hit === 0 || e.hit === undefined;
        const from = e.from === 0 || e.from === 1 ? e.from : null;
        const att = from === null ? null : unitOf(battle, from, e.fu || 0);
        const used = this.uses.get(`${from}:${e.move}`) || {};
        const plans = first ? hitEffects({ type: e.type, crit: e.crit, eff: e.eff, move: e.move, category: used.category, shape: used.shape })
          : [{ id: "impacts/hit-spark", tint: true, role: "impact", hold: 0.6, z: ROLE_INFO.impact.z }];
        for (const p of plans) {
          const at = this.landing(p, d, att, 0.8);
          this.spawn(p, { type: e.type, x: at.x, y: at.y, flip: at.flip, scale: 0.8, seedParts: sp, unit: keyOf(e.s, e.u) });
        }
        return { burst: true };
      }
      case "area": {
        const key = keyOf(e.s, e.u);
        const drop = this.drops.get(key) === e.move;
        if (drop) this.drops.delete(key);
        const shape = e.arc > -1 && !drop ? "cone" : drop ? "drop" : "burst";
        let plan = this.planOf({ ...e, shape: this.uses.get(`${e.s}:${e.move}`)?.shape || shape });
        if (!["beam", "area", "drop"].includes(plan.role)) plan = pickEffect({ type: e.type, shape });
        const k = Math.max(0.6, Math.min(1.5, (e.r || 3) / 3.4));
        let made;
        if (plan.role === "beam") {
          made = this.spawn(plan, { type: e.type, x: e.x, y: e.y, angle: this.angleOf(e.x, e.y, e.fx || 1, e.fy || 0), scale: 1, seedParts: sp, rotates: true });
        } else if (shape === "cone") {
          // a cone played as an area: in front of the user, half way along it
          const len = Math.hypot(e.fx || 1, e.fy || 0) || 1, reach = (e.r || 3) * 0.55;
          made = this.spawn(plan, { type: e.type, x: e.x + ((e.fx || 1) / len) * reach, y: e.y + ((e.fy || 0) / len) * reach, scale: k, seedParts: sp });
        } else {
          made = this.spawn(plan, { type: e.type, x: e.x, y: e.y, scale: k, seedParts: sp });
        }
        return made ? { area: true } : null;
      }
      case "boost": {
        if (e.same) return null;
        const d = unitOf(battle, e.s, e.u);
        if (d) this.spawn(eventEffect("boost", e.stage > 0), { x: d.x, y: d.y, scale: 0.8, seedParts: sp });
        return null;
      }
      case "heal": {
        const d = unitOf(battle, e.s, e.u);
        if (d) this.spawn(eventEffect("heal"), { x: d.x, y: d.y, scale: 0.8, seedParts: sp });
        return null;
      }
      case "status": {
        const plan = statusEffect(e.status), d = unitOf(battle, e.s, e.u);
        if (!plan || !d) return null;
        const flat = { id: plan.id, tint: plan.tint, ...(plan.color ? { color: plan.color } : {}) };
        this.spawn({ ...plan, ...plan.body, role: "self", hold: 1.6, flat }, { type: plan.type, x: d.x, y: d.y, scale: 0.9, seedParts: sp, unit: keyOf(e.s, e.u) });
        return { burst: true };
      }
      case "confused": case "flinch": case "vol": case "substitute": {
        const plan = conditionEffect(e.k === "vol" ? e.id : e.k), d = unitOf(battle, e.s, e.u);
        if (plan && d) this.spawn(plan, { x: d.x, y: d.y, scale: 0.9, seedParts: sp, unit: keyOf(e.s, e.u) });
        return null;
      }
      case "trickroom": case "gravity": {
        const plan = conditionEffect(e.k), A = this.field();
        if (plan) this.spawn({ ...plan, role: "area", hold: 2 }, { x: A.w / 2, y: A.h / 2, scale: 1.4, seedParts: sp });
        return null;
      }
      case "faint": {
        const d = unitOf(battle, e.s, e.u);
        if (d) this.spawn(eventEffect("faint"), { x: d.x, y: d.y, scale: 0.7, seedParts: sp });
        return null;
      }
      default: return null;
    }
  }

  // The helpers of the screens without a real-time battle (the mass battle) and of the turn-based stage; each says whether it drew.
  contact() { return true; }
  impact(move, type, x, y, { strong = false } = {}) {
    for (const p of hitEffects({ type, crit: strong, move })) this.spawn(p, { type, x, y, scale: 0.8, seedParts: [move, x, y] });
    return true;
  }
  area(move, type, x, y, r, arc, fx, fy, drop) {
    const shape = arc > -1 && !drop ? "cone" : drop ? "drop" : "burst";
    let plan = pickEffect({ type, shape, move });
    if (!["beam", "area", "drop"].includes(plan.role)) plan = pickEffect({ type, shape });
    const made = plan.role === "beam"
      ? this.spawn(plan, { type, x, y, angle: this.angleOf(x, y, fx || 1, fy || 0), seedParts: [move, x, y], rotates: true })
      : this.spawn(plan, { type, x, y, scale: Math.max(0.6, Math.min(1.5, (r || 3) / 3.4)), seedParts: [move, x, y] });
    return !!made;
  }
  beam(move, type, x0, y0, x1, y1) {
    let plan = pickEffect({ type, shape: "beam", move });
    if (plan.role !== "beam") plan = pickEffect({ type, shape: "beam" });
    return !!this.spawn({ ...plan, hold: 0.9 }, { type, x: x0, y: y0, angle: this.angleOf(x0, y0, x1 - x0, y1 - y0), seedParts: [move, x0, y0], rotates: true });
  }

  // ------------------------------------------------------------ weather and terrain
  field() { return this.area || { w: 28, h: 17 }; }
  /** Keeps the looping weather and terrain effects in step with the view ({weather: {id}, terrain: {id}}). */
  ambient(view) {
    for (const kind of ["weather", "terrain"]) {
      // the engine names some weathers as the move data does ("RainDance", "SunnyDay"), others in lower case ("snow")
      const id = String(view?.[kind]?.id || "").toLowerCase() || null;
      const cur = this.screens[kind];
      if ((cur?.key || null) === id) continue;
      if (cur?.e) { cur.e.end = true; }
      const plan = id ? fieldEffect(kind, id) : null;
      const e = plan ? this.spawn(plan, { x: 0, y: 0, seedParts: [kind, id] }) : null;
      this.screens[kind] = id ? { key: id, e } : null;
    }
  }
  /** True while a pixelfx weather plays (the painter then skips its own weather particles). */
  hasWeather() { return !!this.screens.weather?.e; }

  // ------------------------------------------------------------ the Pokemon's pixels for on-body effects
  /** Called by the painter right after it draws a Pokemon (ctx as it drew it, the sprite's box and a function drawing it again). */
  captureActor(s, u, ctx, bounds, draw) {
    this.canCapture = true;
    const key = keyOf(s, u);
    if (!this.want.has(key) || typeof document === "undefined" || !this.base || !ctx?.getTransform) return;
    this.want.delete(key);
    try {
      const m = this.base.inverse().multiply(ctx.getTransform());
      const pts = [[bounds.x, bounds.y], [bounds.x + bounds.w, bounds.y], [bounds.x, bounds.y + bounds.h], [bounds.x + bounds.w, bounds.y + bounds.h]]
        .map(([x, y]) => [m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f]);
      const minX = Math.min(...pts.map((p) => p[0])), maxX = Math.max(...pts.map((p) => p[0]));
      const minY = Math.min(...pts.map((p) => p[1])), maxY = Math.max(...pts.map((p) => p[1]));
      const scale = 0.9, q = (this.r.scale / Q0) * scale;
      const W = Math.min(160, Math.ceil((maxX - minX) / q) + 2), H = Math.min(160, Math.ceil((maxY - minY) / q) + 2);
      if (!(W > 2 && H > 2)) return;
      this.capCanvas ||= document.createElement("canvas");
      this.capCanvas.width = W; this.capCanvas.height = H;
      const c = this.capCanvas.getContext("2d", { willReadFrequently: true });
      c.setTransform(1 / q, 0, 0, 1 / q, -minX / q, -minY / q);
      c.transform(m.a, m.b, m.c, m.d, m.e, m.f);
      c.imageSmoothingEnabled = false;
      draw(c);
      const data = c.getImageData(0, 0, W, H).data;
      const unit = unitOf(this.battle, s, u);
      const fx0 = unit ? this.r.px(unit.x) : (minX + maxX) / 2, fy0 = unit ? this.r.py(unit.y) : maxY;
      const actor = actorFromPixels(data, W, H, (minX - fx0) / q, (minY - fy0) / q);
      if (actor) this.actors.set(key, { actor, at: Date.now() });
    } catch {
      /* unreadable art: the waiting effect falls back */
    }
  }

  // ------------------------------------------------------------ per frame
  update(dt, view) {
    if (!(dt > 0) || !Number.isFinite(dt)) return;
    if (view && ("weather" in view || "terrain" in view)) this.ambient(view);
    // on-body effects whose Pokemon has been read start now; the others wait a little, then play their fallback
    if (this.pending.length) {
      const still = [];
      for (const p of this.pending) {
        p.age += dt;
        const got = this.actors.get(p.args.unit);
        if (got) {
          const mod = EFFECTS[p.plan.id];
          this.make(p.plan, mod, info(p.plan.id), { ...p.args, actor: got.actor }, p.seed);
        } else if (p.age < WAIT_BODY) still.push(p);
        else {
          const fb = p.plan.fallback || p.plan.flat;
          if (fb) { const mod = EFFECTS[fb.id]; if (mod) this.make({ ...p.plan, ...fb }, mod, info(fb.id), { ...p.args, unit: null }, p.seed); }
        }
      }
      this.pending = still;
      if (!still.length) this.actors.clear();
    }
    const live = new Map((view?.projectiles || []).map((p) => [p.id, p]));
    for (const e of this.list) {
      e.age += dt;
      if (e.follow !== null) {
        const p = live.get(e.follow);
        if (p) {
          e.seen = true;
          if (e.role === "projectile") { e.x = p.x; e.y = p.y; }
          e.fx.options.angle = this.angleOf(p.x, p.y, p.vx || 1, p.vy || 0);
          if (e.role === "beam") e.fx.options.angle = this.angleOf(e.x, e.y, p.x - e.x, p.y - e.y);
        } else if (e.seen) e.end = true;
      } else if (e.unit && e.role === "self" && this.battle) {
        // effects on a Pokemon move with it
        const [s, u] = e.unit.split(":").map(Number);
        const d = unitOf(this.battle, s, u);
        if (d && Number.isFinite(d.x)) { e.x = d.x; e.y = d.y; }
      }
      if (!e.stopped && (e.end || e.age >= e.hold)) { e.fx.stop(); e.stopped = true; }
      e.fx.update(dt);
    }
    this.list = this.list.filter((e) => !e.fx.done());
  }

  draw(ctx, layer) {
    if (typeof document === "undefined") return;
    if (layer === "back" && ctx.getTransform) { try { this.base = ctx.getTransform(); } catch { /* old canvas */ } }
    if (!this.list.length) return;
    const s = this.r.scale;
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    for (const e of this.list) {
      const f = e.frame;
      if (e.role === "screen") {
        // the weather over the whole field, behind the Pokemon, repainted a few times a second
        if (layer !== "back") continue;
        if (!e.canvas || e.age - (e.painted ?? -1) >= 1 / SCREEN_FPS) {
          clearFrame(f);
          e.fx.draw(f, "back"); e.fx.draw(f, "front");
          this.paint(e, f);
          e.painted = e.age;
        }
        const A = this.field();
        ctx.globalAlpha = 0.65;
        ctx.drawImage(e.canvas, this.r.px(0), this.r.py(0), this.r.px(A.w) - this.r.px(0), this.r.py(A.h) - this.r.py(0));
        ctx.globalAlpha = 1;
        continue;
      }
      clearFrame(f);
      e.fx.draw(f, layer);
      if (!hasPixels(f)) continue;
      this.paint(e, f);
      const q = (s / Q0) * e.scale;
      ctx.drawImage(e.canvas, this.r.px(e.x) + f.ox * q, this.r.py(e.y) - e.z * s + f.oy * q, f.w * q, f.h * q);
    }
    ctx.restore();
  }

  paint(e, f) {
    if (!e.canvas) {
      e.canvas = document.createElement("canvas");
      e.canvas.width = f.w; e.canvas.height = f.h;
      e.sctx = e.canvas.getContext("2d");
      e.img = e.sctx.createImageData(f.w, f.h);
    }
    composite(f, e.img.data, null);
    e.sctx.putImageData(e.img, 0, 0);
  }
}
