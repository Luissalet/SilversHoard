// The twelve Pokémon of a four-team event on screen: SpriteCollab walk sheets through ctx.animator, a team-coloured ring under every
// pair of feet (so the teams read at a glance) and a coloured disc where a sprite has not loaded (or never will).
import { dirRow } from "../../../battle/rt/pmd.js";
import { ellipse, text } from "./hud.js";
import { clamp, inkOn, safe, shade, rgba } from "./util.js";

export class MonGfx {
  constructor(ctx) {
    this.ctx = ctx;
    this.an = new Map();
    this.cur = new Map();
  }

  animator(t, s) {
    const key = t * 3 + s;
    if (!this.an.has(key)) this.an.set(key, safe(this.ctx.animator, t, s) || null);
    return this.an.get(key);
  }

  update(dt) {
    for (const a of this.an.values()) safe(() => a && a.update(dt));
  }

  /** a size factor that keeps a Wailord and an Eevee on the same field: the sprite's own height against a target height */
  norm(t, s) {
    const a = this.animator(t, s);
    const m = a && a.meta && a.meta.a ? a.meta.a.Idle || a.meta.a.Walk : null;
    if (!m || !m.ay) return 1;
    return clamp(32 / m.ay, 0.62, 1.3);
  }

  /** loop an animation (Idle, Walk...) of one Pokémon; only touches the animator when it changes */
  loop(t, s, anim, speed = 1) {
    const key = `${t * 3 + s}`;
    const want = `${anim}|${speed}`;
    if (this.cur.get(key) === want) return;
    const a = this.animator(t, s);
    if (!a) return;
    safe(() => a.loop(anim, speed));
    this.cur.set(key, want);
  }

  /** one-shot animation (Attack, Hurt...), then back to the loop */
  play(t, s, anim, opts) {
    const a = this.animator(t, s);
    if (a) safe(() => a.play(anim, opts));
  }

  /**
   * Draw one Pokémon with its feet at (x, y).
   * o: { fx, fy (facing vector), k (screen px per sprite px), alpha, flash, ring (draw the team ring, default true), shadow, label, scale }
   */
  draw(g, t, s, x, y, o = {}) {
    const team = this.ctx.teams[t] || {};
    const color = team.color || "#888";
    const k0 = o.k || 2;
    const k = k0 * (o.raw ? 1 : this.norm(t, s));
    const alpha = o.alpha ?? 1;
    if (o.shadow !== false) ellipse(g, x, y + 1 * k0, 9 * k0, 3.6 * k0, "rgba(0,0,0,0.30)", alpha);
    if (o.ring !== false) {
      g.save();
      g.globalAlpha *= alpha * 0.95;
      g.beginPath();
      g.ellipse(x, y + 1 * k0, 10.5 * k0, 4.4 * k0, 0, 0, Math.PI * 2);
      g.lineWidth = Math.max(2.5, 1.6 * k0);
      g.strokeStyle = color;
      g.stroke();
      g.lineWidth = 1;
      g.strokeStyle = "rgba(255,255,255,0.55)";
      g.beginPath();
      g.ellipse(x, y + 1 * k0, 10.5 * k0 + 1.6 * k0, 4.4 * k0 + 0.8 * k0, 0, 0, Math.PI * 2);
      g.stroke();
      g.restore();
    }
    const row = o.row != null ? o.row : dirRow(o.fx ?? 0, o.fy ?? 1);
    const a = this.animator(t, s);
    let drawn = false;
    if (a) drawn = !!safe(() => a.draw(g, x, y, row, k, { alpha, flash: o.flash || 0 }));
    if (!drawn) this.fallback(g, t, s, x, y, k0, alpha, o);
    return drawn;
  }

  fallback(g, t, s, x, y, k, alpha, o) {
    const team = this.ctx.teams[t] || {};
    const color = team.color || "#888";
    const r = 9 * k;
    g.save();
    g.globalAlpha *= alpha;
    g.beginPath();
    g.arc(x, y - r - 2 * k, r, 0, Math.PI * 2);
    const gr = g.createRadialGradient(x - r * 0.35, y - r * 1.5, r * 0.1, x, y - r, r * 1.1);
    gr.addColorStop(0, shade(color, 0.45));
    gr.addColorStop(1, shade(color, -0.2));
    g.fillStyle = gr;
    g.fill();
    g.lineWidth = Math.max(2, k);
    g.strokeStyle = "rgba(255,255,255,0.9)";
    g.stroke();
    if (o.flash) { g.fillStyle = rgba("#ffffff", 0.7 * o.flash); g.fill(); }
    const mon = team.mons?.[s] || {};
    text(g, String(mon.name || s + 1).slice(0, 2), x, y - r - 2 * k + 1, { size: Math.max(11, 6.5 * k), weight: 900, color: inkOn(color), align: "center", base: "middle" });
    g.restore();
  }
}

/** The small arrow over the Pokémon the person is steering. */
export function marker(g, x, y, color, time = 0, label = "") {
  const b = Math.sin(time * 8) * 3;
  g.save();
  g.translate(x, y + b);
  g.beginPath();
  g.moveTo(0, 0); g.lineTo(-9, -13); g.lineTo(9, -13); g.closePath();
  g.fillStyle = color; g.fill();
  g.lineWidth = 2.5; g.strokeStyle = "#fff"; g.stroke();
  if (label) text(g, label, 0, -22, { size: 13, weight: 900, color: "#fff", align: "center", base: "middle", stroke: "rgba(0,0,0,0.7)", strokeW: 4 });
  g.restore();
}
