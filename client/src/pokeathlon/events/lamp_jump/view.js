// Lamp Jump on screen: the two DS screens stacked into one tall stage (256 x 384 at 1.40625), a circus tent behind it, the lamps hanging
// in it and the cloth of the trampoline bending under the Pokémon. The other three teams' scoreboards rise by themselves.
import { COLUMNS, LAMPS, REST_Y, MAX_DENT, MON_RADIUS, LAMP_RADIUS, HOLD_FRAMES, FLICK_MAX } from "./sim.js";
import { MonGfx } from "../_kit5/mons.js";
import { Pops, Sparks, ellipse, sidePanels, text, rrect, panel, keycap, FONT } from "../_kit5/hud.js";
import { clamp, lerp, rgba, shade } from "../_kit5/util.js";

export const S = 540 / 384;
export const FX0 = 300;
export const toScreen = (x, y) => [FX0 + x * S, y * S];
export const toField = (px, py) => [(px - FX0) / S, py / S];

const COMBO_COLORS = ["#ffffff", "#fff3a0", "#ffc94d", "#ff9a3c", "#ff5a7a"];

export class LampJumpView {
  constructor(ctx, sim, st) {
    this.ctx = ctx;
    this.sim = sim;
    this.st = st;                     // { you, sel, charge, aimX, keys, touching, touchPos, demo, shown[] }
    this.gfx = new MonGfx(ctx);
    this.pops = new Pops();
    this.sparks = new Sparks();
    this.time = 0;
    this.flash = [0, 0, 0, 0];
    this.lampFlash = new Array(29).fill(0);
    this.starT = 0;
    this.bulbBlink = new Array(29).fill(0);
    this.ringBurst = [];
    this.mood = [0, 0, 0];            // seconds of the "hop" animation still to show
  }

  onEvents(events, runner) {
    for (const e of events) {
      if (e.type === "lamp") {
        const [sx, sy] = toScreen(e.x, e.y);
        this.lampFlash[e.lamp] = 1;
        const c = COMBO_COLORS[clamp(e.points - 1, 0, 4)];
        this.pops.add(sx, sy - 14, `+${e.points}`, c, { size: 18 + e.points * 4, max: 0.9 });
        this.sparks.burst(sx, sy, c, 8 + e.points * 2, 150, 0.45);
        this.flash[this.st.you >= 0 ? this.st.you : 0] = 1;
        runner.sfx("score");
      } else if (e.type === "takeoff") {
        this.mood[e.mon] = 0.5;
        this.gfx.play(this.st.team, e.mon, "Attack", { speed: 1.3 });
        runner.sfx("jump");
      } else if (e.type === "clash") {
        const [sx, sy] = toScreen(e.x, e.y);
        this.sparks.burst(sx, sy, "#ffffff", 14, 190, 0.5);
        this.ringBurst.push({ x: sx, y: sy, t: 0 });
        this.pops.add(sx, sy - 24, "¡PUM!", "#ff8fa8", { size: 22, max: 0.8 });
        runner.sfx("crash");
        runner.shake(4, 8);
      } else if (e.type === "launch") {
        runner.sfx("whistle");
      } else if (e.type === "land") {
        if (e.speed > 900) runner.sfx("hit");
      } else if (e.type === "relight") {
        this.relitAt = this.time;
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
    for (let i = 0; i < 29; i++) this.lampFlash[i] = Math.max(0, this.lampFlash[i] - dt * 3);
    for (const r of this.ringBurst) r.t += dt;
    this.ringBurst = this.ringBurst.filter((r) => r.t < 0.5);
    for (let i = 0; i < 3; i++) {
      const m = this.sim.mons[i];
      this.mood[i] = Math.max(0, this.mood[i] - dt);
      let anim = "Idle";
      if (m.stunned) anim = "Hurt";
      else if (this.sim.selected === i || (this.st.keys && this.st.sel === i && this.st.charge > 0)) anim = "Charge";
      else if (m.jumping && !m.airborne) anim = "Charge";
      this.gfx.loop(this.st.team, i, anim, 1);
    }
  }

  // ------------------------------------------------------------------------------------------------------------------ render
  render(g, a) {
    this.tent(g);
    this.lamps(g);
    this.cloth(g, a);
    this.drawMons(g, a);
    this.aim(g);
    this.sparks.draw(g);
    for (const r of this.ringBurst) {
      g.beginPath(); g.arc(r.x, r.y, 10 + r.t * 90, 0, Math.PI * 2);
      g.strokeStyle = `rgba(255,255,255,${0.9 * (1 - r.t / 0.5)})`; g.lineWidth = 4; g.stroke();
    }
    this.pops.draw(g);
    this.hud(g);
  }

  tent(g) {
    // the whole canvas: night blue with a red-and-white striped tent canopy at the top and a spotlight on the stage
    let gr = g.createLinearGradient(0, 0, 0, 540);
    gr.addColorStop(0, "#241446");
    gr.addColorStop(0.6, "#1a2058");
    gr.addColorStop(1, "#101636");
    g.fillStyle = gr;
    g.fillRect(0, 0, 960, 540);
    // stripes radiating from the top centre
    g.save();
    for (let i = -12; i <= 12; i++) {
      g.beginPath();
      g.moveTo(480, -40);
      g.lineTo(480 + i * 90 - 45, 560);
      g.lineTo(480 + i * 90 + 45, 560);
      g.closePath();
      g.fillStyle = i % 2 ? "rgba(255,255,255,0.035)" : "rgba(255,60,90,0.045)";
      g.fill();
    }
    g.restore();
    // stage backdrop
    const x0 = FX0 - 8, w = 256 * S + 16;
    rrect(g, x0, 0, w, 540, 0);
    gr = g.createLinearGradient(0, 0, 0, 540);
    gr.addColorStop(0, "#38307a");
    gr.addColorStop(0.55, "#2b3a8c");
    gr.addColorStop(1, "#1d2a66");
    g.fillStyle = gr;
    g.fillRect(x0, 0, w, 540);
    // a soft spotlight cone
    gr = g.createRadialGradient(480, 330, 20, 480, 330, 300);
    gr.addColorStop(0, "rgba(255,240,190,0.22)");
    gr.addColorStop(1, "rgba(255,240,190,0)");
    g.fillStyle = gr;
    g.fillRect(x0, 0, w, 540);
    // drifting stars on the backdrop
    g.fillStyle = "rgba(255,255,255,0.55)";
    for (let i = 0; i < 26; i++) {
      const sx = x0 + ((i * 97.3) % w), sy = ((i * 53.7 + this.time * (3 + (i % 4))) % 520) + 6;
      const r = 1 + (i % 3) * 0.6;
      g.globalAlpha = 0.25 + 0.35 * Math.abs(Math.sin(this.time * 1.5 + i));
      g.beginPath(); g.arc(sx, sy, r, 0, Math.PI * 2); g.fill();
    }
    g.globalAlpha = 1;
    // edges of the stage
    g.fillStyle = "rgba(255,255,255,0.1)";
    g.fillRect(x0 - 3, 0, 3, 540);
    g.fillRect(x0 + w, 0, 3, 540);
  }

  lamps(g) {
    const { sim } = this;
    for (let i = 0; i < 29; i++) {
      const [lx, ly] = LAMPS[i];
      const [sx, sy] = toScreen(lx, ly);
      const lit = sim.lit[i];
      const f = this.lampFlash[i];
      // the string
      g.strokeStyle = "rgba(255,255,255,0.12)";
      g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(sx, 0); g.lineTo(sx, sy - 12); g.stroke();
      const r = LAMP_RADIUS * S * 1.25;
      if (lit) {
        const pulse = 0.85 + 0.15 * Math.sin(this.time * 5 + i);
        const gr = g.createRadialGradient(sx, sy, 2, sx, sy, r * 3 * pulse);
        gr.addColorStop(0, "rgba(255,236,150,0.75)");
        gr.addColorStop(1, "rgba(255,200,80,0)");
        g.fillStyle = gr;
        g.beginPath(); g.arc(sx, sy, r * 3 * pulse, 0, Math.PI * 2); g.fill();
      }
      // cap and bulb
      rrect(g, sx - 5, sy - r - 6, 10, 8, 2);
      g.fillStyle = "#7d7aa8"; g.fill();
      g.beginPath(); g.arc(sx, sy, r, 0, Math.PI * 2);
      if (lit) {
        const gr = g.createRadialGradient(sx - r * 0.3, sy - r * 0.3, 1, sx, sy, r);
        gr.addColorStop(0, "#ffffff"); gr.addColorStop(0.45, "#fff0a0"); gr.addColorStop(1, "#ffb43a");
        g.fillStyle = gr;
      } else {
        g.fillStyle = "rgba(60,64,120,0.85)";
      }
      g.fill();
      g.lineWidth = 2;
      g.strokeStyle = lit ? "#fff7cf" : "rgba(150,156,220,0.55)";
      g.stroke();
      if (f > 0) {
        g.beginPath(); g.arc(sx, sy, r + (1 - f) * 26, 0, Math.PI * 2);
        g.strokeStyle = `rgba(255,255,255,${f})`; g.lineWidth = 3; g.stroke();
      }
    }
  }

  cloth(g, a) {
    const { sim } = this;
    const top = [];
    for (let c = 0; c < COLUMNS; c++) {
      const [sx, sy] = toScreen(c * 2 + 1, REST_Y - sim.surface[c] / 64);
      top.push([sx, sy]);
    }
    const [lx] = toScreen(0, 0), [rx] = toScreen(256, 0);
    // frame legs
    const bottom = 540;
    for (const px of [34, 222]) {
      const [sx] = toScreen(px, 0);
      const [, sy] = toScreen(0, REST_Y + 2);
      const gr = g.createLinearGradient(sx - 8, 0, sx + 8, 0);
      gr.addColorStop(0, "#8a8fb8"); gr.addColorStop(0.5, "#d7dbf5"); gr.addColorStop(1, "#6e739c");
      g.fillStyle = gr;
      g.fillRect(sx - 8, sy, 16, bottom - sy);
    }
    // the cloth: a coloured band under a bright rope line
    g.beginPath();
    g.moveTo(lx, bottom);
    g.lineTo(lx, top[0][1]);
    for (const [x, y] of top) g.lineTo(x, y);
    g.lineTo(rx, top[COLUMNS - 1][1]);
    g.lineTo(rx, bottom);
    g.closePath();
    const gr = g.createLinearGradient(0, top[0][1], 0, bottom);
    gr.addColorStop(0, "#e63f5e");
    gr.addColorStop(0.35, "#b02050");
    gr.addColorStop(1, "#4b1a56");
    g.fillStyle = gr;
    g.fill();
    // stripes following the bend
    g.save();
    g.clip();
    g.strokeStyle = "rgba(255,255,255,0.10)";
    g.lineWidth = 6;
    for (let k = 1; k < 7; k++) {
      g.beginPath();
      top.forEach(([x, y], i) => { const yy = y + k * 22; if (i) g.lineTo(x, yy); else g.moveTo(x, yy); });
      g.stroke();
    }
    g.restore();
    g.beginPath();
    top.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(lx, y)));
    g.lineTo(rx, top[COLUMNS - 1][1]);
    g.lineWidth = 6; g.lineJoin = "round"; g.strokeStyle = "#ffe7ef"; g.stroke();
    g.lineWidth = 2.5; g.strokeStyle = "#ff8fa8"; g.stroke();
  }

  drawMons(g, a) {
    const { sim } = this;
    const you = this.st.you;
    const color = this.ctx.teams[this.st.team]?.color || "#fff";
    for (const i of [0, 1, 2]) {
      const m = sim.mons[i];
      const h = lerp(m.pheight, m.height, a);
      const x = lerp(m.px, m.drawX, a);
      const gy = REST_Y - h / 64;
      const [sx, sy] = toScreen(x, gy);
      // the shadow on the cloth below it
      const clothY = REST_Y - sim.surface[Math.floor(clamp(x, 0, 255) / 2)] / 64;
      const [, cy] = toScreen(x, clothY);
      const air = clamp((cy - sy) / 160, 0, 1);
      ellipse(g, sx, cy + 2, 17 * (1 - air * 0.5), 5 * (1 - air * 0.5), "rgba(0,0,0,0.32)");
      // team ring on the cloth under the Pokémon
      g.beginPath(); g.ellipse(sx, cy + 2, 21 * (1 - air * 0.3), 6.5 * (1 - air * 0.3), 0, 0, Math.PI * 2);
      g.lineWidth = 3.5; g.strokeStyle = rgba(color, 0.9); g.stroke();
      this.gfx.draw(g, this.st.team, i, sx, sy, { row: 0, k: S * 1.15, shadow: false, ring: false });
      // stun stars
      if (m.stunned) {
        for (let k = 0; k < 3; k++) {
          const ang = this.starT * 6 + (k * Math.PI * 2) / 3;
          this.star(g, sx + Math.cos(ang) * 20, sy - 74 + Math.sin(ang) * 6, 6.5);
        }
        const k = m.stunTimer / m.stunFrames;
        rrect(g, sx - 20, sy - 98, 40, 6, 3); g.fillStyle = "rgba(0,0,0,0.5)"; g.fill();
        rrect(g, sx - 20, sy - 98, 40 * k, 6, 3); g.fillStyle = "#ff8fa8"; g.fill();
      }
      // numbers over the heads of the three of the person's Pokémon
      if (you >= 0 && !m.stunned) {
        const selected = sim.selected === i || (this.st.keys && this.st.sel === i);
        const label = String(i + 1);
        const ty = sy - 84;
        g.beginPath(); g.arc(sx, ty, selected ? 11 : 9, 0, Math.PI * 2);
        g.fillStyle = selected ? color : "rgba(10,12,34,0.7)"; g.fill();
        g.lineWidth = 2; g.strokeStyle = selected ? "#fff" : "rgba(255,255,255,0.45)"; g.stroke();
        text(g, label, sx, ty + 1, { size: 12, weight: 900, color: "#fff", align: "center", base: "middle" });
      }
      // combo chain
      if (m.combo > 0 && m.jumping && m.airborne) {
        text(g, `x${m.combo}`, sx + 26, sy - 40, { size: 16, weight: 900, color: COMBO_COLORS[clamp(m.combo - 1, 0, 4)], stroke: "rgba(0,0,0,0.7)", strokeW: 4 });
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

  /** the drag as a slingshot, and the time left before the launch happens by itself */
  aim(g) {
    const { sim, st } = this;
    const you = st.you;
    if (you < 0) return;
    if (sim.selected < 3 && st.touching) {
      const m = sim.mons[sim.selected];
      const [mx, my] = toScreen(m.x, m.gy - 10);
      const [sx, sy] = toScreen(sim.touchStart[0], sim.touchStart[1]);
      const [px, py] = toScreen(st.touchPos[0], st.touchPos[1]);
      const fx = st.touchPos[0] - sim.touchStart[0];
      const fy = Math.min(FLICK_MAX, st.touchPos[1] - sim.touchStart[1]);
      g.setLineDash([6, 6]);
      g.beginPath(); g.moveTo(sx, sy); g.lineTo(px, py);
      g.strokeStyle = "rgba(255,255,255,0.75)"; g.lineWidth = 3; g.stroke();
      g.setLineDash([]);
      g.beginPath(); g.arc(px, py, 7, 0, Math.PI * 2); g.fillStyle = "rgba(255,255,255,0.85)"; g.fill();
      // time ring
      const k = clamp(sim.holdFrames / HOLD_FRAMES, 0, 1);
      g.beginPath(); g.arc(mx, my, 34, -Math.PI / 2, -Math.PI / 2 + k * Math.PI * 2);
      g.lineWidth = 5; g.strokeStyle = k > 0.8 ? "#ff8fa8" : "#ffe45c"; g.stroke();
      if (fy > 0) this.arrow(g, mx, my - 44, fx, fy);
    } else if (st.keys && st.charge > 0) {
      const m = sim.mons[st.sel];
      const [mx, my] = toScreen(m.x, m.gy - 10);
      this.arrow(g, mx, my - 44, -st.aimX, st.charge * FLICK_MAX);
      // charge bar
      rrect(g, mx - 30, my + 40, 60, 8, 4); g.fillStyle = "rgba(0,0,0,0.55)"; g.fill();
      rrect(g, mx - 30, my + 40, 60 * st.charge, 8, 4); g.fillStyle = st.charge > 0.85 ? "#ff8fa8" : "#ffe45c"; g.fill();
    }
  }

  /** where the Pokémon will go: a dotted arrow going up and to the side opposite the drag */
  arrow(g, x, y, fx, fy) {
    const len = 30 + (fy / FLICK_MAX) * 90;
    const dx = clamp(-fx / 40, -1, 1) * 36;
    g.setLineDash([4, 5]);
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + dx, y - len);
    g.strokeStyle = "rgba(255,240,160,0.9)"; g.lineWidth = 3; g.stroke();
    g.setLineDash([]);
    g.beginPath(); g.moveTo(x + dx, y - len - 8); g.lineTo(x + dx - 7, y - len + 4); g.lineTo(x + dx + 7, y - len + 4); g.closePath();
    g.fillStyle = "#fff0a0"; g.fill();
  }

  hud(g) {
    const { ctx, sim, st } = this;
    const you = st.you;
    const cards = [0, 1, 2, 3].map((i) => {
      const own = i === you || (you < 0 && i === 0 && !st.demoFormula);
      if (i === you) {
        return {
          score: sim.total, scoreLabel: ctx.t("puntos", "points"), flash: this.flash[i],
          mons: sim.mons.map((m, k) => ({ tag: String(m.score), dim: m.stunned, active: sim.selected === k || (st.keys && st.sel === k), bar: m.stunned ? 1 - m.stunTimer / m.stunFrames : null, barColor: "#ff8fa8" })),
        };
      }
      return {
        score: st.shown[i] ?? 0, scoreLabel: ctx.t("puntos", "points"), flash: this.flash[i],
        mons: [0, 1, 2].map(() => ({ tag: "" })),
      };
    });
    sidePanels(g, ctx, {
      secondsLeft: sim.timer / 30, total: 60, time: this.time, title: ctx.t("Botaluces", "Lamp Jump"), cards, you,
      hints: you >= 0 ? [ctx.t("Arrastra un Pokémon hacia abajo y suéltalo: sale disparado al lado contrario. Teclas: 1-3, Abajo y A/D.", "Drag a Pokémon down and let go: it flies off to the opposite side. Keys: 1-3, Down and A/D.")] : [],
    });
    // the big score over the stage
    const cx = 480;
    panel(g, cx - 70, 8, 140, 52, { r: 16, fill: "rgba(14,16,38,0.82)", stroke: "rgba(255,230,120,0.8)", lineW: 2.5 });
    text(g, String(you >= 0 ? sim.total : (st.shown[0] ?? 0)), cx, 36, { size: 36, weight: 900, color: "#ffe45c", align: "center", base: "middle", stroke: "rgba(0,0,0,0.55)", strokeW: 6 });
    text(g, ctx.t("PUNTOS", "POINTS"), cx, 54, { size: 10, weight: 800, color: "#aab3ee", align: "center" });
  }
}
