// Ring Drop on screen: the DS touch screen (256 x 192) scaled 2.4 into the middle of the canvas, the trapezoid ring as a tiled mat with a
// raised rim, a team-coloured corner pad for every team, the four Pokémon in the ring with their stamina bars and the swap button on top.
import { ST, HUMAN_SPOT, SWITCH_BUTTON, GROUND, FRAMES, TAP_FRAMES } from "./sim.js";
import { MonGfx, marker } from "../_kit5/mons.js";
import { Pops, Sparks, ellipse, sidePanels, text, rrect, panel } from "../_kit5/hud.js";
import { clamp, lerp, rgba, easeOutBack, dist } from "../_kit5/util.js";

export const S = 2.4;
export const FX0 = 173;
export const FY0 = 62;
export const toScreen = (x, y) => [FX0 + x * S, FY0 + y * S];
export const toField = (px, py) => [(px - FX0) / S, (py - FY0) / S];

const { STAND, STAGGER, FALL_OUT, RETURN, DASH_START, DASH, DASH_END, JUMP_START, JUMP_RISE, JUMP_TOP, JUMP_FALL, LANDING } = ST;
const CORNERS = [[48, 64], [208, 64], [32, 160], [224, 160]];     // the corner pad of team 0..3 (ground points)
const DIRS = { 1: [0, -1], 2: [0, 1], 3: [-1, 0], 4: [1, 0] };

const staminaColor = (m) => (m.sta <= 0 ? "#ff5a6e" : m.sta < 30 ? "#ffd166" : "#7be08b");

export class RingDropView {
  constructor(ctx, sim, st) {
    this.ctx = ctx;
    this.sim = sim;
    this.st = st;                     // { you, keys, touching, touchPos, canSwitch }
    this.gfx = new MonGfx(ctx);
    this.pops = new Pops();
    this.sparks = new Sparks();
    this.time = 0;
    this.flash = [0, 0, 0, 0];
    this.face = [[1, 0.2], [-1, 0.2], [1, -0.2], [-1, -0.2]];
    this.dust = [];
    this.rings = [];
    this.starT = 0;
    this.lastKo = null;
  }

  onEvents(events, runner) {
    const parts = this.sim.parts;
    for (const e of events) {
      if (e.type === "hit") {
        const [sx, sy] = toScreen(e.x, e.y - 8);
        const by = parts[e.by], to = parts[e.to];
        const col = this.ctx.teams[e.by]?.color || "#fff";
        this.sparks.burst(sx, sy, "#ffffff", e.press ? 22 : 12, e.press ? 260 : 190, e.press ? 0.6 : 0.45);
        this.sparks.burst(sx, sy, col, e.press ? 12 : 7, 150, 0.5);
        this.rings.push({ x: sx, y: sy, t: 0, big: e.press });
        const bx = toScreen(by.pos[0], by.pos[1] + GROUND)[0], byy = toScreen(0, by.pos[1] + GROUND)[1];
        this.pops.add(bx, byy - 92, e.press ? "+2" : "+1", col, { size: e.press ? 28 : 22, max: 0.8 });
        this.flash[e.by] = 1;
        const dx = to.pos[0] - by.pos[0], dy = to.pos[1] - by.pos[1];
        if (dx || dy) this.face[e.by] = [dx, dy];
        runner.shake(e.press ? 5 : 2.2, e.press ? 15 : 10);
        runner.sfx("hit");
      } else if (e.type === "fallout") {
        const [sx, sy] = toScreen(clamp(e.x, 6, 250), clamp(e.y, 10, 186));
        if (e.by >= 0) {
          const col = this.ctx.teams[e.by]?.color || "#fff";
          const [bx] = toScreen(parts[e.by].pos[0], 0), by = toScreen(0, parts[e.by].pos[1] + GROUND)[1];
          this.pops.add(bx, by - 100, "+10", col, { size: 34, max: 1.1 });
          this.flash[e.by] = 1;
          this.sparks.burst(sx, sy, col, 18, 220, 0.7);
        } else {
          this.pops.add(sx, sy - 10, "-10", "#ff8fa8", { size: 26, max: 1.1 });
        }
        this.pops.add(sx, sy - 40, this.ctx.t("¡FUERA!", "OUT!"), "#ffffff", { size: 30, max: 1.0 });
        runner.sfx("fall");
      } else if (e.type === "jump") {
        const p = parts[e.p];
        const [sx, sy] = toScreen(p.pos[0], p.pos[1] + GROUND);
        this.dust.push({ x: sx, y: sy, t: 0 });
        if (e.p === this.st.you) runner.sfx("jump");
      } else if (e.type === "dash") {
        if (e.p === this.st.you) runner.sfx("throw");
      } else if (e.type === "exhausted") {
        const p = parts[e.p];
        const [sx, sy] = toScreen(p.pos[0], p.pos[1] + GROUND);
        this.pops.add(sx, sy - 100, this.ctx.t("¡Agotado!", "Exhausted!"), "#ffd166", { size: 20, max: 1.2 });
      } else if (e.type === "switch") {
        runner.sfx("whistle");
      } else if (e.type === "swapped") {
        const p = parts[e.p];
        const [sx, sy] = toScreen(p.pos[0], p.pos[1] + GROUND);
        this.sparks.burst(sx, sy - 24, this.ctx.teams[e.p]?.color || "#fff", 14, 150, 0.5);
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
    for (const d of this.dust) d.t += dt;
    this.dust = this.dust.filter((d) => d.t < 0.45);
    for (const r of this.rings) r.t += dt;
    this.rings = this.rings.filter((r) => r.t < 0.45);
    const { parts } = this.sim;
    for (let i = 0; i < 4; i++) {
      const p = parts[i];
      // facing follows the walk
      const mx = p.pos[0] - p.ppos[0], my = p.pos[1] - p.ppos[1];
      if (mx * mx + my * my > 0.04 && p.state !== STAGGER) this.face[i] = [mx, my];
      else if (p.state === DASH_START && p.dashDir[0] + p.dashDir[1] !== 0) this.face[i] = p.dashDir.slice();
      this.gfx.loop(i, p.mem, this.animFor(p, mx, my), 1);
    }
  }

  animFor(p, mx, my) {
    if (p.exhausted || p.state === FALL_OUT) return "Hurt";
    if (p.state === STAGGER || (p.pushed && p.state !== DASH && p.state !== JUMP_FALL)) return "Hurt";
    if (p.state === DASH_START || p.state === DASH) return "Attack";
    if (p.state === JUMP_FALL) return "Attack";
    if (p.state === JUMP_START || p.state === JUMP_RISE || p.state === JUMP_TOP) return "Charge";
    if (mx * mx + my * my > 0.04) return "Walk";
    return "Idle";
  }

  // ------------------------------------------------------------------------------------------------------------------ render
  render(g, a) {
    this.floor(g);
    this.ringMat(g);
    this.zones(g);
    this.drawMons(g, a);
    this.fx(g);
    this.finger(g);
    this.button(g);
    this.hud(g);
  }

  floor(g) {
    let gr = g.createLinearGradient(0, 0, 0, 540);
    gr.addColorStop(0, "#201a46");
    gr.addColorStop(1, "#0d1030");
    g.fillStyle = gr;
    g.fillRect(0, 0, 960, 540);
    // the arena floor under the ring: a darker field with a vignette
    const [x0, y0] = toScreen(0, 0), [x1, y1] = toScreen(256, 192);
    gr = g.createRadialGradient(480, 330, 40, 480, 330, 420);
    gr.addColorStop(0, "#2d2a63");
    gr.addColorStop(1, "#14163a");
    g.fillStyle = gr;
    g.fillRect(x0, y0, x1 - x0, y1 - y0);
    // spectator lights along the top
    g.fillStyle = "rgba(255,255,255,0.05)";
    for (let i = 0; i < 18; i++) g.fillRect(x0 + i * (x1 - x0) / 18, y0, 1, y1 - y0);
    g.lineWidth = 3;
    g.strokeStyle = "rgba(143,155,232,0.35)";
    g.strokeRect(x0, y0, x1 - x0, y1 - y0);
  }

  ringMat(g) {
    const edgeL = (y) => 48 - (y - 64) / 6;
    const edgeR = (y) => 208 + (y - 64) / 6;
    const P = (x, y) => toScreen(x, y);
    const [ax, ay] = P(48, 64), [bx, by] = P(208, 64), [cx, cy] = P(224, 160), [dx, dy] = P(32, 160);
    // the thickness of the rim below the front edge
    const depth = 16;
    g.beginPath();
    g.moveTo(dx, dy); g.lineTo(cx, cy); g.lineTo(cx, cy + depth); g.lineTo(dx, dy + depth); g.closePath();
    let gr = g.createLinearGradient(0, dy, 0, dy + depth);
    gr.addColorStop(0, "#bfc5ef"); gr.addColorStop(1, "#555a99");
    g.fillStyle = gr; g.fill();
    g.beginPath();
    g.moveTo(ax, ay); g.lineTo(dx, dy); g.lineTo(dx, dy + depth); g.lineTo(ax - 4, ay + 2); g.closePath();
    g.fillStyle = "#6c72b8"; g.fill();
    g.beginPath();
    g.moveTo(bx, by); g.lineTo(cx, cy); g.lineTo(cx, cy + depth); g.lineTo(bx + 4, by + 2); g.closePath();
    g.fillStyle = "#6c72b8"; g.fill();
    // the mat: a perspective grid of tiles
    const N = 6, M = 10;
    for (let r = 0; r < N; r++) {
      const y0 = 64 + (96 * r) / N, y1 = 64 + (96 * (r + 1)) / N;
      for (let c = 0; c < M; c++) {
        const xa0 = lerp(edgeL(y0), edgeR(y0), c / M), xa1 = lerp(edgeL(y0), edgeR(y0), (c + 1) / M);
        const xb0 = lerp(edgeL(y1), edgeR(y1), c / M), xb1 = lerp(edgeL(y1), edgeR(y1), (c + 1) / M);
        const pa = P(xa0, y0), pb = P(xa1, y0), pc = P(xb1, y1), pd = P(xb0, y1);
        g.beginPath();
        g.moveTo(pa[0], pa[1]); g.lineTo(pb[0], pb[1]); g.lineTo(pc[0], pc[1]); g.lineTo(pd[0], pd[1]); g.closePath();
        const dark = (r + c) % 2;
        g.fillStyle = dark ? "#6e78c4" : "#8791d6";
        g.fill();
      }
    }
    // a soft light in the middle and darker toward the edge
    g.save();
    g.beginPath(); g.moveTo(ax, ay); g.lineTo(bx, by); g.lineTo(cx, cy); g.lineTo(dx, dy); g.closePath(); g.clip();
    const [mx, my] = P(128, 112);
    gr = g.createRadialGradient(mx, my, 10, mx, my, 330);
    gr.addColorStop(0, "rgba(255,255,255,0.22)");
    gr.addColorStop(1, "rgba(10,10,40,0.30)");
    g.fillStyle = gr; g.fillRect(0, 0, 960, 540);
    // the centre circle
    g.beginPath(); g.ellipse(mx, my, 62 * S * 0.9, 30 * S * 0.9, 0, 0, Math.PI * 2);
    g.lineWidth = 3; g.strokeStyle = "rgba(255,255,255,0.35)"; g.stroke();
    g.restore();
    // the rim
    g.beginPath(); g.moveTo(ax, ay); g.lineTo(bx, by); g.lineTo(cx, cy); g.lineTo(dx, dy); g.closePath();
    g.lineJoin = "round";
    g.lineWidth = 9; g.strokeStyle = "#e8ebff"; g.stroke();
    g.lineWidth = 3; g.strokeStyle = "#ff8fa8"; g.stroke();
    // the team pads at the four corners
    for (let i = 0; i < 4; i++) {
      const [px, py] = P(CORNERS[i][0], CORNERS[i][1]);
      const col = this.ctx.teams[i]?.color || "#999";
      g.beginPath(); g.ellipse(px, py, 34, 14, 0, 0, Math.PI * 2);
      g.fillStyle = rgba(col, 0.55); g.fill();
      g.lineWidth = 4; g.strokeStyle = col; g.stroke();
      g.beginPath(); g.ellipse(px, py, 24, 9.5, 0, 0, Math.PI * 2);
      g.lineWidth = 2; g.strokeStyle = "rgba(255,255,255,0.8)"; g.stroke();
    }
  }

  /** the person's swap zone: where the Pokémon has to stand to be swapped */
  zones(g) {
    const you = this.st.you;
    if (you < 0) return;
    const p = this.sim.parts[you];
    const [sx, sy, r] = HUMAN_SPOT[you];
    const [cx, cy] = toScreen(sx, sy + GROUND);
    const can = this.sim.canSwitch(p);
    const col = this.ctx.teams[you]?.color || "#fff";
    g.save();
    const [x0, y0] = toScreen(0, 0), [x1, y1] = toScreen(256, 192);
    g.beginPath(); g.rect(x0, y0, x1 - x0, y1 - y0); g.clip();
    g.beginPath(); g.ellipse(cx, cy, r * S, r * S * 0.62, 0, 0, Math.PI * 2);
    if (can) {
      g.fillStyle = rgba(col, 0.10 + 0.05 * Math.sin(this.time * 6));
      g.fill();
    }
    g.setLineDash([10, 9]);
    g.lineDashOffset = -this.time * 24;
    g.lineWidth = 2.5;
    g.strokeStyle = rgba(col, can ? 0.85 : 0.35);
    g.stroke();
    g.setLineDash([]);
    g.restore();
  }

  drawMons(g, a) {
    const { sim } = this;
    const order = sim.parts.map((p, i) => ({ p, i, y: p.pos[1] })).sort((u, v) => u.y - v.y);
    for (const { p, i } of order) this.drawMon(g, p, i, a);
  }

  drawMon(g, p, i, a) {
    const { sim, st } = this;
    const col = this.ctx.teams[i]?.color || "#fff";
    const teamName = this.ctx.teams[i]?.name || "";
    // where it is between two steps
    let px = p.pos[0], py = p.pos[1];
    if (dist(p.ppos[0], p.ppos[1], p.pos[0], p.pos[1]) < 30) { px = lerp(p.ppos[0], p.pos[0], a); py = lerp(p.ppos[1], p.pos[1], a); }
    const [sx, gy] = toScreen(px, py + GROUND);
    const gsy = gy;
    // scale / alpha by the state
    let scale = 1, alpha = 1, drop = 0;
    if (p.state === FALL_OUT) {
      const t = (60 - p.fallOutF) / 60;
      alpha = 1 - clamp(t * 2.4, 0, 1);
      scale = 1 - 0.4 * clamp(t * 2.4, 0, 1);
      drop = 60 * t * t * 3;
      if (alpha <= 0) return;
    } else if (p.switching) {
      const human = sim.humans.has(i);
      const swapAt = human ? 11 : 19, total = human ? 22 : 38;
      if (p.swT < swapAt) { scale = 1 - p.swT / swapAt; alpha = scale; } else { const k = clamp((p.swT - swapAt) / (total - swapAt), 0, 1); scale = easeOutBack(k); alpha = clamp(k * 2, 0, 1); }
      if (scale <= 0.02) return;
    } else if (p.state === RETURN) {
      alpha = 0.55 + 0.4 * Math.abs(Math.sin(this.time * 9));
    }
    const lift = p.height * S * 1.0;
    const sy = gsy - lift + drop;
    const k0 = S * 0.88 * scale;
    // shadow and team ring on the mat
    const air = clamp(lift / 120, 0, 1);
    ellipse(g, sx, gsy + 2, 17 * (1 - air * 0.4) * scale, 6 * (1 - air * 0.4) * scale, "rgba(0,0,0,0.34)", alpha);
    g.save();
    g.globalAlpha *= alpha;
    g.beginPath(); g.ellipse(sx, gsy + 2, 21 * (1 - air * 0.3) * scale, 7.5 * (1 - air * 0.3) * scale, 0, 0, Math.PI * 2);
    g.lineWidth = 3.5; g.strokeStyle = col; g.stroke();
    g.lineWidth = 1; g.strokeStyle = "rgba(255,255,255,0.6)"; g.stroke();
    g.restore();
    // a dash leaves a streak
    if (p.state === DASH && (p.dashDir[0] || p.dashDir[1])) {
      for (let k = 1; k <= 4; k++) {
        g.save();
        g.globalAlpha = 0.34 - k * 0.06;
        g.strokeStyle = "#ffffff"; g.lineWidth = 7 - k;
        g.beginPath();
        g.moveTo(sx - p.dashDir[0] * k * 16, gsy - 20 - p.dashDir[1] * k * 9);
        g.lineTo(sx - p.dashDir[0] * (k * 16 + 18), gsy - 20 - p.dashDir[1] * (k * 9 + 10));
        g.stroke();
        g.restore();
      }
    }
    // the sprite
    const f = this.face[i];
    const shiver = p.hitF > 0 ? (p.hitF % 2 ? 2.5 : -2.5) : 0;
    g.save();
    g.globalAlpha *= alpha;
    this.gfx.draw(g, i, p.mem, sx + shiver, sy, { fx: f[0], fy: f[1], k: k0, shadow: false, ring: false, flash: p.hitMark > 0 ? p.hitMark / 6 : 0 });
    g.restore();
    if (p.state === FALL_OUT || p.switching) return;
    // exhausted: stars over the head
    if (p.exhausted) {
      for (let k = 0; k < 3; k++) {
        const ang = this.starT * 6 + (k * Math.PI * 2) / 3;
        this.star(g, sx + Math.cos(ang) * 20, sy - 70 + Math.sin(ang) * 6, 6.5);
      }
    }
    // stamina bar and the arrow over the person's Pokémon
    const m = p.m;
    const bw = 46, bx = sx - bw / 2, by = sy - 76;
    rrect(g, bx - 2, by - 2, bw + 4, 9, 4.5); g.fillStyle = "rgba(8,10,30,0.72)"; g.fill();
    rrect(g, bx, by, Math.max(0, bw * clamp(m.sta / m.maxSta, 0, 1)), 5, 2.5); g.fillStyle = staminaColor(m); g.fill();
    if (i === st.you) marker(g, sx, by - 6, col, this.time, this.ctx.t("TÚ", "YOU"));
    else if (teamName && (sim.humans.has(i) || sim.humans.size === 0)) text(g, teamName, sx, by - 6, { size: 11, weight: 800, color: "#fff", align: "center", stroke: "rgba(0,0,0,0.7)", strokeW: 3, maxW: 80 });
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

  fx(g) {
    for (const d of this.dust) {
      const k = d.t / 0.45;
      g.beginPath(); g.ellipse(d.x, d.y, 14 + k * 30, 5 + k * 10, 0, 0, Math.PI * 2);
      g.strokeStyle = `rgba(255,255,255,${0.7 * (1 - k)})`; g.lineWidth = 3; g.stroke();
    }
    for (const r of this.rings) {
      const k = r.t / 0.45;
      g.beginPath(); g.arc(r.x, r.y, 10 + k * (r.big ? 120 : 70), 0, Math.PI * 2);
      g.strokeStyle = `rgba(255,255,255,${0.9 * (1 - k)})`; g.lineWidth = r.big ? 6 : 4; g.stroke();
    }
    this.sparks.draw(g);
    this.pops.draw(g);
  }

  /** the person's finger: the line to where the Pokémon walks, and the short window that makes a tap or a flick */
  finger(g) {
    const { sim, st } = this;
    if (st.you < 0 || !st.touching) return;
    const p = sim.parts[st.you];
    const tc = p.touch;
    if (!tc.onMon) return;
    const [mx, my] = toScreen(p.pos[0], p.pos[1] + GROUND - 14);
    const [fx, fy] = toScreen(st.touchPos[0], st.touchPos[1]);
    g.setLineDash([6, 6]);
    g.beginPath(); g.moveTo(mx, my); g.lineTo(fx, fy);
    g.strokeStyle = "rgba(255,255,255,0.65)"; g.lineWidth = 3; g.stroke();
    g.setLineDash([]);
    g.beginPath(); g.arc(fx, fy, 8, 0, Math.PI * 2); g.fillStyle = "rgba(255,255,255,0.8)"; g.fill();
    if (tc.frames <= TAP_FRAMES) {
      const k = clamp(tc.frames / TAP_FRAMES, 0, 1);
      g.beginPath(); g.arc(mx, my, 40, -Math.PI / 2, -Math.PI / 2 + k * Math.PI * 2);
      g.lineWidth = 5; g.strokeStyle = "#ffe45c"; g.stroke();
    }
  }

  /** the swap button at the top of the field (SPEC: x 104..159, y 0..31) with the three members' stamina */
  button(g) {
    const { sim, st } = this;
    if (st.you < 0) return;
    const p = sim.parts[st.you];
    const col = this.ctx.teams[st.you]?.color || "#fff";
    const [x0, y0] = toScreen(SWITCH_BUTTON.x0, SWITCH_BUTTON.y0);
    const [x1, y1] = toScreen(SWITCH_BUTTON.x1 + 1, SWITCH_BUTTON.y1 + 1);
    const can = sim.canSwitch(p);
    const tired = p.m.sta < 30;
    const fill = can ? (tired ? "rgba(120,92,14,0.92)" : "rgba(20,70,48,0.92)") : "rgba(30,32,64,0.85)";
    panel(g, x0, y0 - 2, x1 - x0, y1 - y0 + 2, { r: 16, fill, stroke: can ? (tired ? "#ffd166" : "#7be08b") : "rgba(150,156,220,0.5)", lineW: can ? 3.5 : 2 });
    text(g, this.ctx.t("RELEVO", "SWAP"), (x0 + x1) / 2, y0 + 20, { size: 17, weight: 900, color: can ? "#ffffff" : "rgba(210,215,255,0.55)", align: "center", base: "middle" });
    // the three members
    const w = (x1 - x0 - 24) / 3;
    p.members.forEach((m, k) => {
      const bx = x0 + 12 + k * w;
      rrect(g, bx + 2, y0 + 38, w - 4, 7, 3.5); g.fillStyle = "rgba(255,255,255,0.14)"; g.fill();
      rrect(g, bx + 2, y0 + 38, Math.max(0, (w - 4) * clamp(m.sta / m.maxSta, 0, 1)), 7, 3.5); g.fillStyle = staminaColor(m); g.fill();
      if (k === p.mem) { rrect(g, bx, y0 + 35, w, 13, 5); g.lineWidth = 2; g.strokeStyle = col; g.stroke(); }
    });
    if (!can && !p.switching) text(g, this.ctx.t("vuelve a tu esquina", "go to your corner"), (x0 + x1) / 2, y1 - 8, { size: 10, weight: 700, color: "rgba(214,220,255,0.7)", align: "center", base: "middle" });
    else if (can) text(g, "Tab / Q", (x0 + x1) / 2, y1 - 8, { size: 10, weight: 700, color: "rgba(214,255,230,0.9)", align: "center", base: "middle" });
  }

  hud(g) {
    const { ctx, sim, st } = this;
    const you = st.you;
    const cards = sim.parts.map((p, i) => ({
      score: p.score, scoreLabel: ctx.t("puntos", "points"), flash: this.flash[i],
      mons: p.members.map((m, k) => ({
        bar: clamp(m.sta / m.maxSta, 0, 1), barColor: staminaColor(m), active: k === p.mem,
        tag: m.c.points ? String(m.c.points) : "",
      })),
    }));
    sidePanels(g, ctx, {
      secondsLeft: sim.timer / 30, total: FRAMES / 30, time: this.time, title: ctx.t("Fuera del ring", "Ring Drop"), cards, you,
      hints: you >= 0 ? [
        ctx.t("Arrastra para andar, toque para saltar, gesto rápido para embestir. Echar a alguien: +10.", "Drag to walk, tap to jump, quick flick to dash. A knock-out: +10."),
        ctx.t("Teclas: WASD, Espacio, Shift, Tab.", "Keys: WASD, Space, Shift, Tab."),
      ] : [],
    });
  }
}
