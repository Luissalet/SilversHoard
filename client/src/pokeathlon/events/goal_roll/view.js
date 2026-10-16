// Goal Roll on screen: the DS touch screen (256 x 192) at 2.4: a pitch with a goal in each corner (the team's colour), eight goal posts,
// the four teams' Pokémon with a power bar each and the balls (a halo in the colour of the team that touched it last, so everybody sees
// who a goal would count for).
import { POSTS, SPAWN, MODE, STATE, FRAMES, DASH_HOLD } from "./sim.js";
import { MonGfx, marker } from "../_kit5/mons.js";
import { Pops, Sparks, ellipse, sidePanels, text, rrect, wrap, FONT } from "../_kit5/hud.js";
import { clamp, lerp, rgba, easeOutBack, dist } from "../_kit5/util.js";

export const S = 2.4;
export const FX0 = 173;
export const FY0 = 62;
export const toScreen = (x, y) => [FX0 + x * S, FY0 + y * S];
export const toField = (px, py) => [(px - FX0) / S, (py - FY0) / S];

const GOALS = [
  [[0, 0], [80, 0], [0, 80]],
  [[176, 0], [256, 0], [256, 80]],
  [[0, 128], [0, 192], [64, 192]],
  [[192, 192], [256, 192], [256, 128]],
];
const powerColor = (m) => (m.mode === MODE.STUNNED ? "#9aa3d6" : m.power < 30 ? "#ff5a6e" : m.power < m.maxPower * 0.6 ? "#ffd166" : "#7be08b");

export class GoalRollView {
  constructor(ctx, sim, st) {
    this.ctx = ctx;
    this.sim = sim;
    this.st = st;                     // { you, sel, keys, touching, touchPos, hover }
    this.gfx = new MonGfx(ctx);
    this.pops = new Pops();
    this.sparks = new Sparks();
    this.time = 0;
    this.flash = [0, 0, 0, 0];
    this.goalFlash = [0, 0, 0, 0];
    this.starT = 0;
    this.banner = 0;
    this.bannerText = "";
    this.trail = new Map();
  }

  onEvents(events, runner) {
    const { sim } = this;
    for (const e of events) {
      if (e.type === "goal") {
        const [sx, sy] = toScreen(e.x, e.y);
        const col = this.ctx.teams[e.team]?.color || "#fff";
        this.goalFlash[e.goal] = 1;
        this.sparks.burst(sx, sy, e.own ? "#ff8fa8" : col, 26, 260, 0.8);
        this.sparks.burst(sx, sy, "#ffffff", 14, 200, 0.6);
        if (e.own) this.pops.add(sx, sy - 20, "-1", "#ff8fa8", { size: 34, max: 1.2 });
        else this.pops.add(sx, sy - 20, `+${e.pts}`, col, { size: 28 + e.pts * 8, max: 1.2 });
        this.pops.add(sx, sy - 60, e.own ? this.ctx.t("¡Autogol!", "Own goal!") : this.ctx.t("¡GOL!", "GOAL!"), "#ffffff", { size: 30, max: 1.1 });
        this.flash[e.team] = 1;
        if (!e.own && e.goal !== e.team) this.flash[e.goal] = Math.max(this.flash[e.goal], 0.5);
        runner.shake(5, 12);
        runner.sfx(e.own ? "fall" : "score");
        if (e.team === this.st.you || e.goal === this.st.you) runner.sfx("cheer");
      } else if (e.type === "kick") {
        const [sx, sy] = toScreen(e.x, e.y);
        this.sparks.burst(sx, sy, "#ffffff", 8, 150, 0.3);
        this.gfx.play(sim.mons[e.mon].team, sim.mons[e.mon].slot, "Attack");
        runner.sfx("throw");
      } else if (e.type === "stun") {
        const [sx, sy] = toScreen(e.x, e.y + 10);
        this.pops.add(sx, sy - 70, this.ctx.t("¡Aturdido!", "Stunned!"), "#ffd166", { size: 18, max: 1.1 });
        runner.sfx("hit");
        if (sim.mons[e.mon].team === this.st.you) runner.shake(3, 8);
      } else if (e.type === "post" || e.type === "wall") {
        const [sx, sy] = toScreen(e.x, e.y);
        this.sparks.burst(sx, sy, "#ffffff", 4, 90, 0.25);
      } else if (e.type === "clash") {
        const [sx, sy] = toScreen(e.x, e.y);
        this.sparks.burst(sx, sy, "#ffe45c", 10, 160, 0.35);
        runner.sfx("crash");
      } else if (e.type === "second") {
        this.banner = 2.4;
        this.bannerText = this.ctx.t("¡Segundo balón!", "Second ball!");
        runner.sfx("whistle");
      } else if (e.type === "dash") {
        if (sim.mons[e.mon].team === this.st.you) runner.sfx("jump");
      }
    }
  }

  update(dt) {
    this.time += dt;
    this.starT += dt;
    this.gfx.update(dt);
    this.pops.update(dt);
    this.sparks.update(dt);
    this.banner = Math.max(0, this.banner - dt);
    for (let i = 0; i < 4; i++) { this.flash[i] = Math.max(0, this.flash[i] - dt * 2.5); this.goalFlash[i] = Math.max(0, this.goalFlash[i] - dt * 1.6); }
    for (const m of this.sim.mons) {
      let anim = "Idle";
      if (m.mode === MODE.STUNNED) anim = "Hurt";
      else if (m.mode === MODE.DASH) anim = "Attack";
      else if (m.dir[0] !== 0 || m.dir[1] !== 0) anim = "Walk";
      this.gfx.loop(m.team, m.slot, anim, m.mode === MODE.DASH ? 1.4 : 1);
    }
  }

  // ------------------------------------------------------------------------------------------------------------------ render
  render(g, a) {
    this.pitch(g);
    this.goals(g);
    this.posts(g);
    this.guides(g);
    this.ballsAndMons(g, a);
    this.sparks.draw(g);
    this.pops.draw(g);
    this.hud(g);
  }

  pitch(g) {
    let gr = g.createLinearGradient(0, 0, 0, 540);
    gr.addColorStop(0, "#142a3a");
    gr.addColorStop(1, "#0b1a26");
    g.fillStyle = gr;
    g.fillRect(0, 0, 960, 540);
    const [x0, y0] = toScreen(0, 0), [x1, y1] = toScreen(256, 192);
    // the grass: stripes
    g.save();
    rrect(g, x0, y0, x1 - x0, y1 - y0, 16); g.clip();
    for (let i = 0; i < 16; i++) {
      g.fillStyle = i % 2 ? "#2f8f4e" : "#37a057";
      g.fillRect(x0 + (i * (x1 - x0)) / 16, y0, (x1 - x0) / 16 + 1, y1 - y0);
    }
    // lines
    g.strokeStyle = "rgba(255,255,255,0.55)"; g.lineWidth = 3;
    const [cx, cy] = toScreen(128, 104);
    g.beginPath(); g.moveTo(cx, y0); g.lineTo(cx, y1); g.stroke();
    g.beginPath(); g.arc(cx, cy, 30 * S, 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.arc(cx, cy, 3.5, 0, Math.PI * 2); g.fillStyle = "rgba(255,255,255,0.7)"; g.fill();
    // the ball respawn spots
    for (const [sx, sy] of SPAWN) {
      const [px, py] = toScreen(sx, sy);
      g.beginPath(); g.arc(px, py, 2.5, 0, Math.PI * 2); g.fillStyle = "rgba(255,255,255,0.25)"; g.fill();
    }
    g.restore();
    // the boards: the playable area is x 8..247, y 16..183
    const [bx0, by0] = toScreen(8, 16), [bx1, by1] = toScreen(247, 183);
    g.lineWidth = 6; g.strokeStyle = "#e8ebff"; g.lineJoin = "round";
    g.strokeRect(bx0, by0, bx1 - bx0, by1 - by0);
    g.lineWidth = 2; g.strokeStyle = "#ff8fa8";
    g.strokeRect(bx0, by0, bx1 - bx0, by1 - by0);
    // outside the boards: dark margin so the boards read as a wall
    g.save();
    g.beginPath(); g.rect(x0, y0, x1 - x0, y1 - y0); g.rect(bx0 - 3, by0 - 3, bx1 - bx0 + 6, by1 - by0 + 6);
    g.fillStyle = "rgba(10,20,40,0.55)"; g.fill("evenodd");
    g.restore();
    g.lineWidth = 3; g.strokeStyle = "rgba(143,155,232,0.4)";
    rrect(g, x0, y0, x1 - x0, y1 - y0, 16); g.stroke();
  }

  goals(g) {
    const [bx0, by0] = toScreen(8, 16), [bx1, by1] = toScreen(247, 183);
    for (let i = 0; i < 4; i++) {
      const col = this.ctx.teams[i]?.color || "#999";
      const f = this.goalFlash[i];
      g.save();
      g.beginPath(); g.rect(bx0, by0, bx1 - bx0, by1 - by0); g.clip();
      g.beginPath();
      GOALS[i].forEach(([x, y], k) => { const [sx, sy] = toScreen(x, y); if (k) g.lineTo(sx, sy); else g.moveTo(sx, sy); });
      g.closePath();
      g.fillStyle = rgba(col, 0.38 + 0.4 * f); g.fill();
      g.clip();
      // the net
      g.strokeStyle = rgba("#ffffff", 0.28 + 0.4 * f); g.lineWidth = 1.5;
      for (let k = -200; k < 600; k += 14) {
        g.beginPath(); g.moveTo(bx0 + k, by0 - 20); g.lineTo(bx0 + k + 400, by0 + 380); g.stroke();
        g.beginPath(); g.moveTo(bx0 + k + 400, by0 - 20); g.lineTo(bx0 + k, by0 + 380); g.stroke();
      }
      g.restore();
      // the goal line
      const lines = [[[64, 16], [8, 72]], [[192, 16], [247, 71]], [[8, 128], [63, 183]], [[192, 183], [247, 128]]][i];
      const [ax, ay] = toScreen(...lines[0]), [bx, by] = toScreen(...lines[1]);
      g.beginPath(); g.moveTo(ax, ay); g.lineTo(bx, by);
      g.lineWidth = 5; g.strokeStyle = col; g.stroke();
      g.lineWidth = 2; g.strokeStyle = "rgba(255,255,255,0.85)"; g.stroke();
      // the team name on the goal
      // (in at most two lines, so that "Equipo azul" and "Equipo amarillo" can still be told apart)
      const [gx, gy] = toScreen(...[[26, 34], [230, 34], [26, 166], [230, 166]][i]);
      g.font = `900 12px ${FONT}`;
      const label = wrap(g, String(this.ctx.teams[i]?.name || ""), 80).slice(0, 2);
      label.forEach((ln, n) => text(g, ln, gx, gy + (n - (label.length - 1) / 2) * 14, { size: 12, weight: 900, maxW: 84, color: "rgba(255,255,255,0.92)", align: "center", base: "middle", stroke: "rgba(0,0,0,0.5)", strokeW: 3 }));
    }
  }

  posts(g) {
    for (const [x, y] of POSTS) {
      const [sx, sy] = toScreen(x, y);
      ellipse(g, sx, sy + 5, 9, 4, "rgba(0,0,0,0.3)");
      const gr = g.createRadialGradient(sx - 3, sy - 4, 1, sx, sy, 10);
      gr.addColorStop(0, "#ffffff"); gr.addColorStop(1, "#c33a52");
      g.beginPath(); g.arc(sx, sy, 8, 0, Math.PI * 2); g.fillStyle = gr; g.fill();
      g.lineWidth = 2; g.strokeStyle = "#ffffff"; g.stroke();
    }
  }

  /** the person's finger and the target their Pokémon is walking to */
  guides(g) {
    const { sim, st } = this;
    if (st.you < 0) return;
    for (let k = 0; k < 3; k++) {
      const m = sim.mons[st.you * 3 + k];
      if (m.mode === MODE.STUNNED || (m.target[0] === m.pos[0] && m.target[1] === m.pos[1])) continue;
      const [tx, ty] = toScreen(m.target[0], m.target[1] + 10);
      const [mx, my] = toScreen(m.pos[0], m.pos[1] + 10);
      g.setLineDash([4, 6]);
      g.beginPath(); g.moveTo(mx, my); g.lineTo(tx, ty);
      g.strokeStyle = m.mode === MODE.DASH ? "rgba(255,240,160,0.9)" : "rgba(255,255,255,0.5)"; g.lineWidth = 2.5; g.stroke();
      g.setLineDash([]);
      g.beginPath(); g.arc(tx, ty, 5, 0, Math.PI * 2); g.fillStyle = m.mode === MODE.DASH ? "#ffe45c" : "rgba(255,255,255,0.8)"; g.fill();
    }
  }

  ballsAndMons(g, a) {
    const { sim } = this;
    const items = [];
    for (const m of sim.mons) items.push({ y: lerp(m.ppos[1], m.pos[1], a) + 10, kind: "mon", m });
    for (const b of sim.balls) if (b.kind) items.push({ y: lerp(b.ppos[1], b.pos[1], a) + 8, kind: "ball", b });
    items.sort((p, q) => p.y - q.y);
    for (const it of items) {
      if (it.kind === "mon") this.drawMon(g, it.m, a);
      else this.drawBall(g, it.b, a);
    }
  }

  drawMon(g, m, a) {
    const { st, sim } = this;
    const col = this.ctx.teams[m.team]?.color || "#fff";
    let px = m.pos[0], py = m.pos[1];
    if (dist(m.ppos[0], m.ppos[1], px, py) < 30) { px = lerp(m.ppos[0], px, a); py = lerp(m.ppos[1], py, a); }
    const [sx, sy] = toScreen(px, py + 10);
    const stunned = m.mode === MODE.STUNNED, tired = m.mode === MODE.TIRED;
    // dash trail
    if (m.mode === MODE.DASH) {
      g.save();
      for (let k = 1; k <= 4; k++) {
        g.globalAlpha = 0.3 - k * 0.055;
        g.strokeStyle = "#ffffff"; g.lineWidth = 8 - k;
        g.beginPath(); g.moveTo(sx - m.facing[0] * k * 12, sy - 14 - m.facing[1] * k * 8); g.lineTo(sx - m.facing[0] * (k * 12 + 14), sy - 14 - m.facing[1] * (k * 8 + 8)); g.stroke();
      }
      g.restore();
    }
    const shiver = m.motion === 3 && m.mw > 0 ? Math.sin(this.time * 70) * 2.5 : 0;
    const frozen = m.motion === 3 && m.mw > 0 && !stunned;
    g.save();
    if (frozen) g.globalAlpha = 0.8;
    // the team ring and shadow
    ellipse(g, sx, sy + 2, 17, 6, "rgba(0,0,0,0.30)");
    g.beginPath(); g.ellipse(sx, sy + 2, 21, 7.5, 0, 0, Math.PI * 2);
    g.lineWidth = 3.5; g.strokeStyle = col; g.stroke();
    g.lineWidth = 1; g.strokeStyle = "rgba(255,255,255,0.6)"; g.stroke();
    this.gfx.draw(g, m.team, m.slot, sx + shiver, sy, { fx: m.facing[0], fy: m.facing[1], k: S * 0.76, shadow: false, ring: false, flash: frozen ? 0.35 : 0 });
    g.restore();
    // stun stars or the tired drop
    if (stunned) {
      for (let k = 0; k < 3; k++) {
        const ang = this.starT * 6 + (k * Math.PI * 2) / 3;
        this.star(g, sx + Math.cos(ang) * 20, sy - 68 + Math.sin(ang) * 6, 6.5);
      }
    } else if (tired) {
      g.beginPath(); g.ellipse(sx + 18, sy - 58 + Math.sin(this.time * 6) * 2, 4, 6, 0, 0, Math.PI * 2);
      g.fillStyle = "#8fd3ff"; g.fill();
    }
    // power bar
    const bw = 46, bx = sx - bw / 2, by = sy - 74;
    rrect(g, bx - 2, by - 2, bw + 4, 9, 4.5); g.fillStyle = "rgba(8,10,30,0.72)"; g.fill();
    rrect(g, bx, by, Math.max(0, bw * clamp(m.power / m.maxPower, 0, 1)), 5, 2.5); g.fillStyle = powerColor(m); g.fill();
    if (m.team === st.you) {
      const selected = sim.held === m.i || (st.keys && st.you * 3 + st.sel === m.i);
      if (selected) {
        marker(g, sx, by - 6, col, this.time);
        if (sim.held === m.i && sim.holdFrames <= DASH_HOLD && st.touching) {
          const k = clamp(sim.holdFrames / DASH_HOLD, 0, 1);
          g.beginPath(); g.arc(sx, sy - 24, 40, -Math.PI / 2, -Math.PI / 2 + (1 - k) * Math.PI * 2);
          g.lineWidth = 5; g.strokeStyle = "#ffe45c"; g.stroke();
        }
      } else if (st.hover === m.slot && !st.keys && !st.touching) {
        g.beginPath(); g.arc(sx, sy - 24, 36, 0, Math.PI * 2); g.lineWidth = 3; g.strokeStyle = "rgba(255,255,255,0.8)"; g.stroke();
      }
      text(g, String(m.slot + 1), sx - 27, sy + 4, { size: 13, weight: 900, color: "#fff", align: "center", stroke: "rgba(0,0,0,0.7)", strokeW: 4 });
    }
  }

  star(g, x, y, r) {
    g.save();
    g.translate(x, y);
    g.beginPath();
    for (let i = 0; i < 10; i++) {
      const rr = i % 2 ? r * 0.45 : r;
      const an = -Math.PI / 2 + (i * Math.PI) / 5;
      g.lineTo(Math.cos(an) * rr, Math.sin(an) * rr);
    }
    g.closePath();
    g.fillStyle = "#ffe45c"; g.fill();
    g.lineWidth = 1.5; g.strokeStyle = "#fff"; g.stroke();
    g.restore();
  }

  drawBall(g, b, a) {
    const px = lerp(b.ppos[0], b.pos[0], a), py = lerp(b.ppos[1], b.pos[1], a);
    const [sx, sy] = toScreen(px, py + 8);
    const r = b.radius * S;
    const lastCol = b.last < 12 ? this.ctx.teams[Math.floor(b.last / 3)]?.color : null;
    const big = b.kind === 2;
    let bounce = 0, alpha = 1;
    if (b.state === STATE.WAITING) { bounce = Math.abs(Math.sin(b.wait * 0.7)) * 10; alpha = 0.6 + 0.4 * (b.wait % 2); }
    if (b.state === STATE.SCORED) alpha = clamp(b.timer / 10, 0, 1);
    g.save();
    g.globalAlpha = alpha;
    ellipse(g, sx, sy + 2, r * 0.95, r * 0.38, "rgba(0,0,0,0.32)");
    // a streak behind a kicked ball
    if (b.state === STATE.KICKED && (b.vel[0] || b.vel[1])) {
      const n = Math.hypot(b.vel[0], b.vel[1]) || 1;
      g.strokeStyle = rgba(lastCol || "#ffffff", 0.45); g.lineWidth = r * 1.3; g.lineCap = "round";
      g.beginPath(); g.moveTo(sx - (b.vel[0] / n) * r * 2.6, sy - r - (b.vel[1] / n) * r * 2.6 * 0.8); g.lineTo(sx, sy - r); g.stroke();
      g.lineCap = "butt";
    }
    const cy = sy - r - bounce;
    if (lastCol) {
      g.beginPath(); g.arc(sx, cy, r + 4.5, 0, Math.PI * 2);
      g.lineWidth = 4; g.strokeStyle = lastCol; g.stroke();
    }
    const gr = g.createRadialGradient(sx - r * 0.35, cy - r * 0.35, 1, sx, cy, r);
    if (big) { gr.addColorStop(0, "#fff7c4"); gr.addColorStop(0.6, "#ffd24a"); gr.addColorStop(1, "#c98a10"); }
    else { gr.addColorStop(0, "#ffffff"); gr.addColorStop(0.7, "#eef0fa"); gr.addColorStop(1, "#a9b0d4"); }
    g.beginPath(); g.arc(sx, cy, r, 0, Math.PI * 2); g.fillStyle = gr; g.fill();
    g.lineWidth = 2; g.strokeStyle = big ? "#8a5a06" : "#4a5080"; g.stroke();
    // the panels of the ball, turning with the distance it rolled
    g.save();
    g.translate(sx, cy); g.rotate(b.roll / (b.radius * 1.2));
    g.fillStyle = big ? "rgba(120,70,0,0.55)" : "rgba(40,46,90,0.7)";
    for (let k = 0; k < 5; k++) {
      const an = (k * Math.PI * 2) / 5;
      g.beginPath(); g.arc(Math.cos(an) * r * 0.62, Math.sin(an) * r * 0.62, r * 0.2, 0, Math.PI * 2); g.fill();
    }
    g.beginPath(); g.arc(0, 0, r * 0.26, 0, Math.PI * 2); g.fill();
    g.restore();
    if (big) text(g, "×2", sx, cy + 1, { size: Math.max(12, r * 0.7), weight: 900, color: "#ffffff", align: "center", base: "middle", stroke: "rgba(120,70,0,0.8)", strokeW: 3 });
    g.restore();
  }

  hud(g) {
    const { ctx, sim, st } = this;
    const cards = [0, 1, 2, 3].map((t) => ({
      score: sim.scores[t], scoreLabel: ctx.t("goles", "goals"), flash: this.flash[t],
      mons: [0, 1, 2].map((k) => {
        const m = sim.mons[t * 3 + k];
        return {
          bar: clamp(m.power / m.maxPower, 0, 1), barColor: powerColor(m),
          active: t === st.you && ((st.keys && st.sel === k) || sim.held === m.i),
          tag: m.c.points ? String(m.c.points) : "", tagColor: "#ffd166",
        };
      }),
    }));
    sidePanels(g, ctx, {
      secondsLeft: sim.timer / 30, total: FRAMES / 30, time: this.time, title: ctx.t("Metegoles", "Goal Roll"), cards, you: st.you,
      hints: st.you >= 0 ? [
        ctx.t("Arrastra para llevar a un Pokémon; un gesto rápido que cruce el balón lo patea. Gol en contra: -1.", "Drag to steer a Pokémon; a quick swipe through the ball kicks it. A goal against: -1."),
        ctx.t("Teclas: 1-3, WASD, Espacio.", "Keys: 1-3, WASD, Space."),
      ] : [],
    });
    if (this.banner > 0) {
      const k = Math.min(1, (2.4 - this.banner) / 0.25);
      g.save();
      g.globalAlpha = Math.min(1, this.banner / 0.4);
      g.translate(480, 92); const s = 0.6 + 0.4 * easeOutBack(k); g.scale(s, s);
      text(g, this.bannerText, 0, 0, { size: 40, weight: 900, color: "#ffe45c", align: "center", base: "middle", stroke: "#1a1230", strokeW: 8 });
      g.restore();
    }
  }
}
