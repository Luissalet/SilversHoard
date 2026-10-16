// Snow Throw on screen: the 64 x 64 snow field seen from above, turned so the person's team is at the bottom (the original turns the view by
// team * 90 degrees); the Pokémon on the four sides with an energy bar each, snowballs with a shadow, the aim cone of a drag.
import { CENTER, GRAB_RADIUS, FRAMES, HOLD_MAX, BALL } from "./sim.js";
import { MonGfx, marker } from "../_kit5/mons.js";
import { Pops, Sparks, ellipse, sidePanels, text, rrect } from "../_kit5/hud.js";
import { clamp, lerp, rgba } from "../_kit5/util.js";

export const K = 7.2;
const CX = 480, CY = 273;
const SPAN = 33;                                       // the field is drawn from 0 to 66 around (33, 33)

const energyColor = (m) => (m.stunned ? "#9aa3d6" : m.energy <= 60 ? "#ff5a6e" : m.energy <= 100 ? "#ffd166" : "#7be08b");

/**
 * The turn of the view as pure functions: a person's screen is turned `rot` quarter turns (their team index), and what they do with the
 * pointer or the keys is read in that turn by every computer of a room, so all of them get the same throw.
 */
export function geom(rot) {
  return {
    toScreen(x, z) {
      let dx = x - CENTER, dz = z - CENTER;
      for (let i = 0; i < rot; i++) [dx, dz] = [-dz, dx];
      return [CX + dx * K, CY + dz * K];
    },
    toField(px, py) {
      let dx = (px - CX) / K, dz = (py - CY) / K;
      for (let i = 0; i < rot; i++) [dx, dz] = [dz, -dx];
      return [CENTER + dx, CENTER + dz];
    },
    dirToScreen(dx, dz) {
      for (let i = 0; i < rot; i++) [dx, dz] = [-dz, dx];
      return [dx, dz];
    },
    dirToField(dx, dz) {
      for (let i = 0; i < rot; i++) [dx, dz] = [dz, -dx];
      return [dx, dz];
    },
  };
}

export class SnowThrowView {
  constructor(ctx, sim, st) {
    this.ctx = ctx;
    this.sim = sim;
    this.st = st;                     // { you, rot, sel, keys, aim:[x,z], hover, touching, pointer:[x,z] }
    this.rot = st.rot || 0;
    this.geo = geom(this.rot);
    this.gfx = new MonGfx(ctx);
    this.pops = new Pops();
    this.sparks = new Sparks();
    this.time = 0;
    this.flash = [0, 0, 0, 0];
    this.puffs = [];
    this.starT = 0;
    this.shown = new Array(12).fill(0);
  }

  // ------------------------------------------------------------------------------------------------------------------ geometry
  /** a field point to the screen (the view is turned by `rot` quarter turns clockwise) */
  toScreen(x, z) { return this.geo.toScreen(x, z); }
  toField(px, py) { return this.geo.toField(px, py); }
  dirToScreen(dx, dz) { return this.geo.dirToScreen(dx, dz); }
  dirToField(dx, dz) { return this.geo.dirToField(dx, dz); }

  // ------------------------------------------------------------------------------------------------------------------ events
  onEvents(events, runner) {
    const { sim } = this;
    for (const e of events) {
      if (e.type === "hit") {
        const [sx, sy] = this.toScreen(e.x, e.z);
        const col = this.ctx.teams[sim.mons[e.from].team]?.color || "#fff";
        this.sparks.burst(sx, sy - 22, "#ffffff", 10 + e.size * 4, 170, 0.5);
        this.sparks.burst(sx, sy - 22, col, 6, 130, 0.45);
        this.pops.add(sx, sy - 70, "+1", col, { size: 24 + e.size * 4, max: 0.9 });
        if (e.stunned) this.pops.add(sx, sy - 92, this.ctx.t("¡Aturdido!", "Stunned!"), "#ffffff", { size: 17, max: 1.1 });
        this.flash[sim.mons[e.from].team] = 1;
        this.gfx.play(sim.mons[e.to].team, sim.mons[e.to].slot, "Hurt");
        if (sim.mons[e.to].team === this.st.you) runner.shake(2 + e.size, 10);
        runner.sfx(e.size >= 2 ? "crash" : "hit");
      } else if (e.type === "splash") {
        const [sx, sy] = this.toScreen(e.x, e.z);
        this.puffs.push({ x: sx, y: sy - 10, t: 0 });
        this.sparks.burst(sx, sy - 10, "#ffffff", 6, 100, 0.35);
      } else if (e.type === "throw") {
        const m = sim.mons[e.mon];
        this.gfx.play(m.team, m.slot, "Attack");
        if (m.team === this.st.you) runner.sfx("throw");
      } else if (e.type === "tap") {
        const m = sim.mons[e.mon];
        const [sx, sy] = this.toScreen(m.home[0], m.home[1]);
        if (m.team === this.st.you) { runner.sfx("jump"); this.pops.add(sx, sy - 80, `${e.taps}/4`, "#fff", { size: 14, max: 0.6, vy: -20 }); }
      }
    }
  }

  update(dt) {
    this.time += dt;
    this.starT += dt;
    this.gfx.update(dt);
    this.pops.update(dt);
    this.sparks.update(dt);
    for (let i = 0; i < 4; i++) this.flash[i] = Math.max(0, this.flash[i] - dt * 2.5);
    for (const p of this.puffs) p.t += dt;
    this.puffs = this.puffs.filter((p) => p.t < 0.4);
    for (const m of this.sim.mons) {
      const holding = m.ball.state === BALL.HELD && m.ball.taps > 0;
      this.gfx.loop(m.team, m.slot, m.stunned ? "Hurt" : holding ? "Charge" : "Idle", 1);
    }
  }

  // ------------------------------------------------------------------------------------------------------------------ render
  render(g, a) {
    this.ground(g);
    this.pads(g);
    this.aimOverlay(g);
    this.mons(g);
    this.balls(g, a);
    this.fx(g);
    this.hud(g);
  }

  ground(g) {
    let gr = g.createLinearGradient(0, 0, 0, 540);
    gr.addColorStop(0, "#1e2a5a");
    gr.addColorStop(1, "#0e1434");
    g.fillStyle = gr;
    g.fillRect(0, 0, 960, 540);
    // pines in the margins
    for (let i = 0; i < 9; i++) {
      for (const side of [0, 1]) {
        const x = side ? 770 + ((i * 37) % 24) : 190 - ((i * 37) % 24);
        const y = 60 + i * 52 + (side ? 14 : 0);
        this.pine(g, x, y, 30 + (i % 3) * 6);
      }
    }
    const [x0, y0] = this.toScreen(0, 0), [x1, y1] = this.toScreen(66, 66);
    const left = Math.min(x0, x1), top = Math.min(y0, y1), w = Math.abs(x1 - x0), h = Math.abs(y1 - y0);
    // wooden rail
    rrect(g, left - 12, top - 12, w + 24, h + 24, 22);
    g.fillStyle = "#6b4a2f"; g.fill();
    rrect(g, left - 7, top - 7, w + 14, h + 14, 18);
    g.fillStyle = "#8a6240"; g.fill();
    // snow
    rrect(g, left, top, w, h, 14);
    gr = g.createRadialGradient(CX, CY, 20, CX, CY, w * 0.75);
    gr.addColorStop(0, "#ffffff");
    gr.addColorStop(1, "#c9dcf3");
    g.fillStyle = gr; g.fill();
    g.save();
    rrect(g, left, top, w, h, 14); g.clip();
    // drifts
    g.strokeStyle = "rgba(150,180,220,0.28)"; g.lineWidth = 3;
    for (let i = 0; i < 9; i++) {
      g.beginPath();
      g.moveTo(left, top + (i + 0.5) * (h / 9));
      for (let x = 0; x <= w; x += 30) g.lineTo(left + x, top + (i + 0.5) * (h / 9) + Math.sin(x * 0.03 + i * 1.7) * 5);
      g.stroke();
    }
    // the middle
    g.beginPath(); g.arc(CX, CY, 4 * K, 0, Math.PI * 2);
    g.strokeStyle = "rgba(120,150,200,0.45)"; g.lineWidth = 3; g.setLineDash([8, 8]); g.stroke(); g.setLineDash([]);
    g.restore();
  }

  pine(g, x, y, s) {
    g.fillStyle = "#4b3322";
    g.fillRect(x - 3, y + s * 0.5, 6, s * 0.35);
    for (let k = 0; k < 3; k++) {
      const w = s * (0.95 - k * 0.22), yy = y + s * 0.5 - k * s * 0.34;
      g.beginPath(); g.moveTo(x, yy - s * 0.5); g.lineTo(x - w / 2, yy); g.lineTo(x + w / 2, yy); g.closePath();
      g.fillStyle = k % 2 ? "#245a46" : "#1d4c3b"; g.fill();
      g.beginPath(); g.moveTo(x, yy - s * 0.5); g.lineTo(x - w * 0.22, yy - s * 0.27); g.lineTo(x + w * 0.22, yy - s * 0.27); g.closePath();
      g.fillStyle = "rgba(255,255,255,0.85)"; g.fill();
    }
  }

  /** the team pad under each Pokémon: the person's own show their grab circle (4 units) */
  pads(g) {
    for (const m of this.sim.mons) {
      const [sx, sy] = this.toScreen(m.home[0], m.home[1]);
      const col = this.ctx.teams[m.team]?.color || "#999";
      const own = m.team === this.st.you;
      g.beginPath(); g.ellipse(sx, sy, GRAB_RADIUS * K * 0.86, GRAB_RADIUS * K * 0.86, 0, 0, Math.PI * 2);
      g.fillStyle = rgba(col, own ? 0.20 : 0.28); g.fill();
      g.lineWidth = own ? 3 : 2.5; g.strokeStyle = col;
      if (own) g.setLineDash([7, 6]);
      g.stroke(); g.setLineDash([]);
    }
  }

  aimOverlay(g) {
    const { sim, st } = this;
    if (st.you < 0) return;
    let mon = null, dir = null, hold = 0;
    if (sim.tOf(st.you).held >= 0 && st.touching) {
      mon = sim.mons[sim.tOf(st.you).held];
      const dx = st.pointer[0] - sim.tOf(st.you).start[0], dz = st.pointer[1] - sim.tOf(st.you).start[1];
      const far = Math.hypot(mon.home[0] - st.pointer[0], mon.home[1] - st.pointer[1]) > GRAB_RADIUS;
      if (far && (dx || dz)) dir = [dx, dz];
      hold = sim.tOf(st.you).holdFrames;
    } else if (st.keys && st.sel >= 0) {
      mon = sim.mons[st.you * 3 + st.sel];
      dir = st.aim;
    }
    if (!mon || mon.stun) return;
    const [sx, sy] = this.toScreen(mon.home[0], mon.home[1]);
    if (hold > 0 || (st.keys && !st.touching)) {
      const k = clamp(hold / HOLD_MAX, 0, 1);
      g.beginPath(); g.arc(sx, sy - 18, 36, -Math.PI / 2, -Math.PI / 2 + (1 - k) * Math.PI * 2);
      g.lineWidth = 5; g.strokeStyle = k > 0.6 ? "#ff8fa8" : k > 0.3 ? "#ffd166" : "#7be08b"; g.stroke();
    }
    if (!dir) return;
    const [dx, dy] = this.dirToScreen(dir[0], dir[1]);
    const n = Math.hypot(dx, dy) || 1;
    const ux = dx / n, uy = dy / n;
    const ang = Math.atan2(uy, ux);
    const sp = (mon.spread || 0) * Math.PI / 180;
    const len = 30 * K;
    // the spread: the cone the ball may stray into
    if (sp > 0) {
      g.beginPath(); g.moveTo(sx, sy - 14);
      g.arc(sx, sy - 14, len, ang - sp, ang + sp);
      g.closePath();
      g.fillStyle = "rgba(255,120,150,0.22)"; g.fill();
    }
    g.setLineDash([6, 8]); g.lineDashOffset = -this.time * 40;
    g.beginPath(); g.moveTo(sx + ux * 26, sy - 14 + uy * 26); g.lineTo(sx + ux * len, sy - 14 + uy * len);
    g.strokeStyle = "rgba(60,90,160,0.85)"; g.lineWidth = 3.5; g.stroke();
    g.setLineDash([]);
    g.beginPath();
    const ex = sx + ux * len, ey = sy - 14 + uy * len;
    g.moveTo(ex, ey); g.lineTo(ex - ux * 14 - uy * 8, ey - uy * 14 + ux * 8); g.lineTo(ex - ux * 14 + uy * 8, ey - uy * 14 - ux * 8); g.closePath();
    g.fillStyle = "rgba(60,90,160,0.9)"; g.fill();
  }

  mons(g) {
    const { sim, st } = this;
    const order = sim.mons.map((m) => ({ m, y: this.toScreen(m.home[0], m.home[1])[1] })).sort((a, b) => a.y - b.y);
    const mid = [CX, CY];
    for (const { m } of order) {
      const [sx, sy] = this.toScreen(m.home[0], m.home[1]);
      const col = this.ctx.teams[m.team]?.color || "#fff";
      const fx = mid[0] - sx, fy = mid[1] - sy;
      const k = 1.55;
      this.gfx.draw(g, m.team, m.slot, sx, sy + 8, { fx, fy, k, shadow: true, ring: false, alpha: m.stunned ? 0.9 : 1 });
      // energy bar
      const bw = 46, bx = sx - bw / 2, by = sy + 18;
      rrect(g, bx - 2, by - 2, bw + 4, 9, 4.5); g.fillStyle = "rgba(8,10,30,0.72)"; g.fill();
      rrect(g, bx, by, Math.max(0, bw * clamp(m.energy / 120, 0, 1)), 5, 2.5); g.fillStyle = energyColor(m); g.fill();
      if (m.stunned) {
        for (let q = 0; q < 3; q++) {
          const ang = this.starT * 6 + (q * Math.PI * 2) / 3;
          this.star(g, sx + Math.cos(ang) * 18, sy - 52 + Math.sin(ang) * 5, 6);
        }
      }
      // the person's selection
      if (m.team === st.you) {
        const own = (st.you * 3 + st.sel === m.i && st.keys) || sim.tOf(st.you).held === m.i;
        if (own) marker(g, sx, sy - 64, col, this.time);
        else if (st.hover === m.slot && !st.keys) {
          g.beginPath(); g.arc(sx, sy - 20, 34, 0, Math.PI * 2); g.lineWidth = 3; g.strokeStyle = "rgba(255,255,255,0.8)"; g.stroke();
        }
        text(g, String(m.slot + 1), sx - 34, sy + 22, { size: 13, weight: 900, color: "#fff", align: "center", stroke: "rgba(0,0,0,0.7)", strokeW: 4 });
      }
    }
  }

  star(g, x, y, r) {
    g.save();
    g.translate(x, y);
    g.beginPath();
    for (let i = 0; i < 10; i++) {
      const rr = i % 2 ? r * 0.45 : r;
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    g.closePath();
    g.fillStyle = "#ffe45c"; g.fill();
    g.lineWidth = 1.5; g.strokeStyle = "#fff"; g.stroke();
    g.restore();
  }

  ball(g, x, y, size, lift, alpha = 1) {
    const r = 8.5 * (1 + size / 3);
    ellipse(g, x, y + 2, r * 0.95, r * 0.4, "rgba(40,60,110,0.35)", alpha);
    g.save();
    g.globalAlpha *= alpha;
    const gr = g.createRadialGradient(x - r * 0.35, y - lift - r * 0.35, 1, x, y - lift, r);
    gr.addColorStop(0, "#ffffff"); gr.addColorStop(0.7, "#e7f0ff"); gr.addColorStop(1, "#a9bfe6");
    g.beginPath(); g.arc(x, y - lift, r, 0, Math.PI * 2);
    g.fillStyle = gr; g.fill();
    g.lineWidth = 1.5; g.strokeStyle = "rgba(90,120,180,0.8)"; g.stroke();
    g.restore();
  }

  balls(g, a) {
    const { sim } = this;
    for (const m of sim.mons) {
      const b = m.ball;
      const col = this.ctx.teams[m.team]?.color || "#fff";
      if (b.state === BALL.HELD) {
        // in front of the Pokémon, towards the middle of the field
        const [sx, sy] = this.toScreen(m.home[0], m.home[1]);
        const dx = CX - sx, dy = CY - sy, n = Math.hypot(dx, dy) || 1;
        const bx = sx + (dx / n) * 24, by = sy + (dy / n) * 24;
        this.ball(g, bx, by, b.size, 16 + Math.sin(this.time * 5 + m.i) * 1.5);
        for (let k = 0; k < b.taps; k++) {
          g.beginPath(); g.arc(bx - (b.taps - 1) * 4 + k * 8, by - 16 - 8.5 * (1 + b.size / 3) - 8, 2.6, 0, Math.PI * 2);
          g.fillStyle = col; g.fill();
        }
      } else if (b.state === BALL.FLYING) {
        const px = lerp(b.pos[0] - b.vel[0], b.pos[0], a), pz = lerp(b.pos[1] - b.vel[1], b.pos[1], a);
        const [sx, sy] = this.toScreen(px, pz);
        // a faint tail
        const [tx, ty] = this.toScreen(px - b.vel[0] * 3, pz - b.vel[1] * 3);
        g.strokeStyle = rgba(col, 0.4); g.lineWidth = 6 + b.size * 2; g.lineCap = "round";
        g.beginPath(); g.moveTo(tx, ty - 14); g.lineTo(sx, sy - 14); g.stroke();
        g.lineCap = "butt";
        this.ball(g, sx, sy, b.size, 14);
        g.beginPath(); g.arc(sx, sy - 14, 8.5 * (1 + b.size / 3) + 2.5, 0, Math.PI * 2);
        g.lineWidth = 2.5; g.strokeStyle = rgba(col, 0.9); g.stroke();
      }
    }
  }

  fx(g) {
    for (const p of this.puffs) {
      const k = p.t / 0.4;
      g.beginPath(); g.arc(p.x, p.y, 8 + k * 22, 0, Math.PI * 2);
      g.strokeStyle = `rgba(255,255,255,${0.9 * (1 - k)})`; g.lineWidth = 4; g.stroke();
    }
    this.sparks.draw(g);
    this.pops.draw(g);
  }

  hud(g) {
    const { ctx, sim, st } = this;
    const cards = [0, 1, 2, 3].map((t) => ({
      score: sim.teamScore(t), scoreLabel: ctx.t("aciertos", "hits"), flash: this.flash[t],
      mons: [0, 1, 2].map((k) => {
        const m = sim.mons[t * 3 + k];
        return {
          bar: clamp(m.energy / 120, 0, 1), barColor: energyColor(m), dim: false,
          active: t === st.you && ((st.keys && st.sel === k) || sim.tOf(st.you).held === m.i),
          tag: m.hits ? String(m.hits) : "", tagColor: "#ffd166",
        };
      }),
    }));
    sidePanels(g, ctx, {
      secondsLeft: sim.timer / 30, total: FRAMES / 30, time: this.time, title: ctx.t("Nieve cruzada", "Snow Throw"), cards, you: st.you,
      hints: st.you >= 0 ? [
        ctx.t("Toca tu Pokémon para hacer crecer la bola; arrastra desde él y suelta para lanzar. Rápido pega más fuerte.", "Tap your Pokémon to grow the ball; drag from it and let go to throw. A quick flick is stronger."),
        ctx.t("Teclas: 1-3, Espacio, A/D, Enter.", "Keys: 1-3, Space, A/D, Enter."),
      ] : [],
    });
  }
}
