// The pixelfx animation style: plays the vendored pixel-art effects (./fx, from patch-gg/pixelfx, MIT) over the real-time arena and the
// turn-based stage. One layer per painter (rt/vfx.js owns it, loaded on demand). It only reads the public events and views and draws:
// it never writes simulation state, so the style cannot change a result. Every effect is seeded from the battle, the tick and the
// event, so a replay or a video plays the same pixels.
import { createFrame, clearFrame, createFx, composite } from "./core/index.js";
import { EFFECTS } from "./registry.js";
import { pickEffect, hitEffects, statusEffect, eventEffect, typeRamp, ramp, fxSeed, ROLE_INFO } from "./mapping.js";

const Q0 = 16;          // effect pixels per meter: the stock 24 px character is a Pokemon of 1.5 m
const MAX_LIVE = 18;
const STEP = 1 / 120;

const hasPixels = (f) => { const c = f.color, l = f.light; for (let i = 0; i < c.length; i++) if (c[i] | l[i]) return true; return false; };

function frameFor(meta, rotates) {
  const [w, h] = meta.size || [128, 128];
  const [ox, oy] = meta.origin || [w / 2, h / 2];
  if (!rotates) return createFrame(w, h, -ox, -oy);
  const s = 2 * Math.ceil(Math.hypot(Math.max(ox, w - ox), Math.max(oy, h - oy)));
  return createFrame(s, s, -s / 2, -s / 2);
}

function paletteOf(plan, type) {
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

const unitOf = (battle, s, u = 0) => (battle?.doubles ? battle.sides?.[s]?.units?.[u || 0] : battle?.sides?.[s]) || null;

export class PixelfxLayer {
  constructor(renderer) {
    this.r = renderer;
    this.list = [];
    this.uses = new Map();     // "side:move" -> {category, shape}, from the last use event
    this.drops = new Map();    // "side:unit" -> move of a drop whose wind-up has started
    this.serial = 0;
    this.battleSeed = "";
    this.reduced = () => false;
  }

  busy() { return this.list.length > 0; }
  owns(id) { return id !== undefined && this.list.some((e) => e.follow === id); }
  clear() { this.list.length = 0; this.drops.clear(); }
  dispose() { this.clear(); this.uses.clear(); this.disposed = true; }

  // ------------------------------------------------------------ spawning
  spawn(plan, { type, x, y, angle = 0, flip = false, scale = 1, follow = null, seedParts = [], rotates = false } = {}) {
    const mod = EFFECTS[plan.id];
    if (!mod || this.disposed) return null;
    if (this.reduced() && ["beam", "area", "drop", "projectile"].includes(plan.role)) return null;
    const rot = rotates || angle !== 0;
    const o = { x: 0, y: 0, seed: fxSeed(this.battleSeed, plan.id, this.serial++, ...seedParts), flip, angle };
    const palette = paletteOf(plan, type);
    if (palette) o.palette = palette;
    let fx;
    try { fx = createFx(mod, o); } catch { return null; }
    while (this.list.length >= MAX_LIVE) {
      const i = this.list.findIndex((e) => e.role !== "projectile");
      this.list.splice(i < 0 ? 0 : i, 1);
    }
    const e = { id: plan.id, role: plan.role, fx, frame: frameFor(mod.meta, rot || flip), x, y, z: plan.z ?? ROLE_INFO[plan.role].z, scale,
      follow, age: 0, hold: plan.hold, stopped: false, seen: false, canvas: null };
    this.list.push(e);
    return e;
  }

  /** Where the screen's pixels point from (x, y) to (x + dx, y + dy), for effects that face right. */
  angleOf(x, y, dx, dy) {
    const r = this.r;
    return Math.atan2(r.py(y + dy) - r.py(y), r.px(x + dx) - r.px(x));
  }

  // ------------------------------------------------------------ events (a hit returns what the painter's own effect should skip)
  event(e, battle) {
    if (this.disposed) return null;
    if (e.t !== undefined && battle?.seed !== undefined) this.battleSeed = String(battle.seed);
    const sp = [e.t, e.s, e.u || 0, e.move || e.k];
    switch (e.k) {
      case "use": {
        this.uses.set(`${e.s}:${e.move}`, { category: e.category, shape: e.shape });
        if (this.uses.size > 64) this.uses.delete(this.uses.keys().next().value);
        const a = unitOf(battle, e.s, e.u);
        if (!a) return null;
        if (e.shape === "self") {
          const made = this.spawn(pickEffect({ type: e.type, category: e.category, shape: "self" }), { type: e.type, x: a.x, y: a.y, scale: 0.9, seedParts: sp });
          return made ? { aura: true } : null;
        }
        return e.shape === "strike" || e.shape === "dash" ? { melee: true } : null;
      }
      case "windup":
        if (e.shape === "drop") this.drops.set(`${e.s}:${e.u || 0}`, e.move);
        return null;
      case "shot": {
        const used = this.uses.get(`${e.s}:${e.move}`) || {};
        const plan = pickEffect({ type: e.type, category: used.category, shape: e.shape || used.shape || "shot" });
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
        const att = from === null ? null : unitOf(battle, from, 0);
        const flip = !!att && d.x < att.x;
        const plans = first ? hitEffects({ type: e.type, crit: e.crit, eff: e.eff }) : [{ id: "impacts/hit-spark", tint: true, role: "impact", hold: 0.6, z: ROLE_INFO.impact.z }];
        for (const p of plans) this.spawn(p, { type: e.type, x: d.x, y: d.y, flip, scale: 0.8, seedParts: sp });
        return { burst: true };
      }
      case "area": {
        const key = `${e.s}:${e.u || 0}`;
        const drop = this.drops.get(key) === e.move;
        if (drop) this.drops.delete(key);
        const used = this.uses.get(`${e.s}:${e.move}`) || {};
        let made;
        if (e.arc > -1 && !drop) {
          // a cone: a breath or a spray towards (fx, fy)
          const plan = pickEffect({ type: e.type, category: used.category, shape: "cone" });
          made = this.spawn(plan, { type: e.type, x: e.x, y: e.y, angle: this.angleOf(e.x, e.y, e.fx || 1, e.fy || 0), scale: 1, seedParts: sp, rotates: true });
        } else {
          const plan = pickEffect({ type: e.type, category: used.category, shape: drop ? "drop" : "burst" });
          const k = Math.max(0.6, Math.min(1.5, (e.r || 3) / 3.4));
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
        this.spawn(plan, { type: plan.type, x: d.x, y: d.y, scale: 0.9, seedParts: sp });
        return { burst: true };
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
    for (const p of hitEffects({ type, crit: strong })) this.spawn(p, { type, x, y, scale: 0.8, seedParts: [move, x, y] });
    return true;
  }
  area(move, type, x, y, r, arc, fx, fy, drop) {
    const made = arc > -1 && !drop
      ? this.spawn(pickEffect({ type, shape: "cone" }), { type, x, y, angle: this.angleOf(x, y, fx || 1, fy || 0), seedParts: [move, x, y], rotates: true })
      : this.spawn(pickEffect({ type, shape: drop ? "drop" : "burst" }), { type, x, y, scale: Math.max(0.6, Math.min(1.5, (r || 3) / 3.4)), seedParts: [move, x, y] });
    return !!made;
  }
  beam(move, type, x0, y0, x1, y1) {
    const plan = pickEffect({ type, shape: "beam" });
    return !!this.spawn({ ...plan, hold: 0.9 }, { type, x: x0, y: y0, angle: this.angleOf(x0, y0, x1 - x0, y1 - y0), seedParts: [move, x0, y0], rotates: true });
  }

  // ------------------------------------------------------------ per frame
  update(dt, view) {
    if (!(dt > 0) || !Number.isFinite(dt)) return;
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
      }
      if (!e.stopped && (e.end || e.age >= e.hold)) { e.fx.stop(); e.stopped = true; }
      e.fx.update(dt);
    }
    this.list = this.list.filter((e) => !e.fx.done());
  }

  draw(ctx, layer) {
    if (!this.list.length || typeof document === "undefined") return;
    const s = this.r.scale;
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    for (const e of this.list) {
      const f = e.frame;
      clearFrame(f);
      e.fx.draw(f, layer);
      if (!hasPixels(f)) continue;
      if (!e.canvas) {
        e.canvas = document.createElement("canvas");
        e.canvas.width = f.w; e.canvas.height = f.h;
        e.sctx = e.canvas.getContext("2d");
        e.img = e.sctx.createImageData(f.w, f.h);
      }
      composite(f, e.img.data, null);
      e.sctx.putImageData(e.img, 0, 0);
      const q = (s / Q0) * e.scale;
      ctx.drawImage(e.canvas, this.r.px(e.x) + f.ox * q, this.r.py(e.y) - e.z * s + f.oy * q, f.w * q, f.h * q);
    }
    ctx.restore();
  }
}
