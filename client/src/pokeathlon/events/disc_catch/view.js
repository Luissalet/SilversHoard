// Disc Catch on screen: a sandy island in a lake with the discs coming down from the horizon. The field is the DS touch screen
// (256 x 192) at 2.2x; the part of the discs' flight that the DS shows on the top screen is a strip of sky above it.
import { ST, DISC, FIELD_W, FIELD_H, CATCH_REACH, MON_RADIUS, FALL_FRAMES, discX, catchPoints, TOUCH_RADIUS } from "./sim.js";
import { MonGfx, marker } from "../_kit5/mons.js";
import { Pops, Sparks, backdrop, ellipse, sidePanels, text, rrect, FONT } from "../_kit5/hud.js";
import { clamp, dist, lerp, rgba, shade } from "../_kit5/util.js";

export const S = 2.2;
export const FX0 = 198;
export const FY0 = 112;
export const toScreen = (x, y) => [FX0 + x * S, FY0 + y * S];
export const toField = (px, py) => [(px - FX0) / S, (py - FY0) / S];

const BAND_COLORS = ["#f3dd9a", "#efd085", "#e8c070", "#e0ae5c"];
const BANDS = [[0, 72, 1], [72, 120, 2], [120, 160, 3], [160, 192, 5]];

export class DiscCatchView {
  constructor(ctx, sim, state) {
    this.ctx = ctx;
    this.sim = sim;
    this.st = state;          // { sel, you } shared with the controls
    this.gfx = new MonGfx(ctx);
    this.pops = new Pops();
    this.sparks = new Sparks();
    this.time = 0;
    this.flash = [0, 0, 0, 0];
    this.ripples = [];
    this.shown = [0, 0, 0, 0];
    this.prevState = new Array(12).fill(ST.ON_FIELD);
    this.lastJumpLoop = new Array(12).fill(0);
  }

  /** the step's events: effects and sounds */
  onEvents(events, runner) {
    const you = this.st.you;
    for (const e of events) {
      if (e.type === "catch") {
        const [sx, sy] = toScreen(e.x, e.y);
        const col = this.ctx.teams[e.team]?.color || "#fff";
        this.pops.add(sx, sy - 70, `+${e.points}`, col === "#000" ? "#fff" : shade(col, 0.35), { size: 20 + e.points * 4, max: 1.1 });
        this.sparks.burst(sx, sy - 40, col, 12, 170, 0.55);
        this.flash[e.team] = 1;
        if (e.team === you) runner.sfx("catch");
      } else if (e.type === "jump") {
        if (Math.floor(e.mon / 3) === you) runner.sfx("jump");
        const t = Math.floor(e.mon / 3), s = e.mon % 3;
        this.gfx.play(t, s, "Attack", { speed: 1.6 });
      } else if (e.type === "fall") {
        const [sx, sy] = toScreen(clamp(e.x, 4, FIELD_W - 4), clamp(e.y, 4, FIELD_H - 4));
        this.ripples.push({ x: sx, y: sy, t: 0 });
        if (Math.floor(e.mon / 3) === you) { runner.sfx("fall"); runner.shake(3, 6); }
      } else if (e.type === "bump") {
        const [sx, sy] = toScreen(e.x, e.y);
        this.sparks.burst(sx, sy - 20, "#ffffff", 7, 110, 0.3);
        const ia = Math.floor(e.a / 3), ib = Math.floor(e.b / 3);
        if (ia === you || ib === you) runner.sfx("hit");
      } else if (e.type === "launch") {
        // nothing: the disc appears at the horizon by itself
      }
    }
  }

  update(dt) {
    this.time += dt;
    this.gfx.update(dt);
    this.pops.update(dt);
    this.sparks.update(dt);
    for (let i = 0; i < 4; i++) this.flash[i] = Math.max(0, this.flash[i] - dt * 2.5);
    for (const r of this.ripples) r.t += dt;
    this.ripples = this.ripples.filter((r) => r.t < 1.2);
    // sprite animation per Pokémon
    for (const m of this.sim.mons) {
      const moving = m.state === ST.ON_FIELD || m.state === ST.JUMPING ? Math.abs(m.x - m.px) + Math.abs(m.y - m.py) > 0.05 : false;
      if (m.knocked) this.gfx.loop(m.team, m.slot, "Hurt");
      else this.gfx.loop(m.team, m.slot, moving ? "Walk" : "Idle", moving ? Math.min(1.8, 0.7 + m.speed / 5) : 1);
    }
  }

  // ------------------------------------------------------------------------------------------------------------------ render
  render(g, a, runner) {
    const { ctx, sim } = this;
    const t = (es, en) => ctx.t(es, en);
    backdrop(g);
    this.scene(g);
    this.discGround(g, a);
    this.drawMons(g, a);
    this.drawDiscs(g, a);
    this.sparks.draw(g);
    this.pops.draw(g);
    this.hud(g, runner);
  }

  scene(g) {
    const time = this.time;
    // sky and lake across the middle column
    const x0 = 170, w = 620;
    let gr = g.createLinearGradient(0, 0, 0, 112);
    gr.addColorStop(0, "#7ec8ff");
    gr.addColorStop(1, "#cfeaff");
    g.fillStyle = gr;
    g.fillRect(x0, 0, w, 112);
    // a few clouds
    g.fillStyle = "rgba(255,255,255,0.8)";
    for (let i = 0; i < 4; i++) {
      const cx = x0 + ((i * 190 + time * (6 + i * 2)) % (w + 120)) - 60;
      const cy = 22 + (i % 2) * 26;
      ellipse(g, cx, cy, 34, 9, "rgba(255,255,255,0.75)");
      ellipse(g, cx + 20, cy - 5, 22, 8, "rgba(255,255,255,0.75)");
    }
    gr = g.createLinearGradient(0, 112, 0, 540);
    gr.addColorStop(0, "#3aa7e6");
    gr.addColorStop(1, "#1c6fb8");
    g.fillStyle = gr;
    g.fillRect(x0, 112, w, 428);
    // horizon
    g.fillStyle = "rgba(255,255,255,0.55)";
    g.fillRect(x0, 110, w, 3);
    // waves
    g.strokeStyle = "rgba(255,255,255,0.16)";
    g.lineWidth = 2;
    for (let r = 0; r < 14; r++) {
      const y = 126 + r * 30 + Math.sin(time * 1.4 + r) * 3;
      g.beginPath();
      for (let x = x0; x <= x0 + w; x += 12) g.lineTo(x, y + Math.sin(x * 0.04 + time * 2 + r * 1.7) * 3);
      g.stroke();
    }
    // island
    const [ix0, iy0] = toScreen(8, 8), [ix1, iy1] = toScreen(248, 180);
    rrect(g, ix0 - 8, iy0 - 8, ix1 - ix0 + 16, iy1 - iy0 + 16, 26);
    g.fillStyle = "#f6ecc9";   // the wet rim of the sand
    g.fill();
    g.save();
    rrect(g, ix0, iy0, ix1 - ix0, iy1 - iy0, 20);
    g.clip();
    BANDS.forEach(([ya, yb], i) => {
      const [, sy0] = toScreen(0, ya), [, sy1] = toScreen(0, Math.min(yb, 192));
      g.fillStyle = BAND_COLORS[i];
      g.fillRect(ix0, sy0, ix1 - ix0, sy1 - sy0);
    });
    // corner bonus zones: the three tile rows next to a band's far edge, outside a middle that narrows toward the edge
    g.fillStyle = "rgba(255,255,255,0.34)";
    for (const end of [9, 15, 20]) {
      [[1, 8, 23], [2, 5, 26], [3, 2, 29]].forEach(([k, lo, hi]) => {
        const [, ya] = toScreen(0, (end - k) * 8), [, yb] = toScreen(0, (end - k) * 8 + 8);
        const [xl] = toScreen(lo * 8, 0), [xr] = toScreen((hi + 1) * 8, 0);
        g.fillRect(ix0, ya, Math.max(0, xl - ix0), yb - ya);
        g.fillRect(xr, ya, Math.max(0, ix1 - xr), yb - ya);
      });
    }
    // band lines
    g.strokeStyle = "rgba(120,80,20,0.35)";
    g.lineWidth = 2;
    g.setLineDash([10, 8]);
    for (const y of [72, 120, 160]) {
      const [, sy] = toScreen(0, y);
      g.beginPath(); g.moveTo(ix0, sy); g.lineTo(ix1, sy); g.stroke();
    }
    g.setLineDash([]);
    g.restore();
    BANDS.forEach(([ya, yb, pts]) => {
      const [, sy] = toScreen(0, (ya + Math.min(yb, 180)) / 2);
      text(g, String(pts), ix0 + 14, sy, { size: 26, weight: 900, color: "rgba(120,80,20,0.55)", align: "center", base: "middle" });
      text(g, String(pts), ix1 - 14, sy, { size: 26, weight: 900, color: "rgba(120,80,20,0.55)", align: "center", base: "middle" });
    });
    rrect(g, ix0, iy0, ix1 - ix0, iy1 - iy0, 20);
    g.lineWidth = 3; g.strokeStyle = "rgba(255,255,255,0.8)"; g.stroke();
    // start spots
    for (let tm = 0; tm < 4; tm++) {
      for (let s = 0; s < 3; s++) {
        const m = this.sim.mons[tm * 3 + s];
        const [hx, hy] = toScreen(m.homeX, m.homeY);
        g.beginPath(); g.ellipse(hx, hy + 2, 15, 6, 0, 0, Math.PI * 2);
        g.strokeStyle = rgba(this.ctx.teams[tm]?.color || "#888", 0.45); g.lineWidth = 2; g.setLineDash([4, 4]); g.stroke(); g.setLineDash([]);
      }
    }
    for (const r of this.ripples) {
      g.beginPath(); g.ellipse(r.x, r.y, 10 + r.t * 70, 4 + r.t * 28, 0, 0, Math.PI * 2);
      g.strokeStyle = `rgba(255,255,255,${0.8 * (1 - r.t / 1.2)})`; g.lineWidth = 3; g.stroke();
    }
  }

  // discs on the ground plane: ring where the disc will be caught, the path ahead
  discGround(g) {
    for (const d of this.sim.discs) {
      if (!d.active || d.state !== DISC.FLYING || d.progress < 280) continue;
      // path ahead
      g.fillStyle = "rgba(60,40,10,0.28)";
      for (let p = Math.max(288, d.progress); p <= 480; p += 14) {
        const [sx, sy] = toScreen(discX(p, d.path), p - 288);
        g.beginPath(); g.arc(sx, sy, 2.2, 0, Math.PI * 2); g.fill();
      }
      if (d.progress >= 288) {
        const [sx, sy] = toScreen(d.x, d.progress - 288);
        g.beginPath(); g.ellipse(sx, sy, CATCH_REACH * S, CATCH_REACH * S * 0.55, 0, 0, Math.PI * 2);
        g.strokeStyle = "rgba(255,255,255,0.55)"; g.lineWidth = 2.5; g.setLineDash([7, 6]); g.stroke(); g.setLineDash([]);
        ellipse(g, sx, sy, 13, 5, "rgba(60,40,10,0.35)");
      }
    }
  }

  drawMons(g, a) {
    const { sim } = this;
    const order = sim.mons.slice().sort((p, q) => p.y - q.y);
    const you = this.st.you;
    const col = (m) => this.ctx.teams[m.team]?.color || "#fff";
    for (const m of order) {
      if (m.state === ST.FALLEN) {
        const since = FALL_FRAMES - m.fallT;
        if (since < 22) {
          // it goes down into the water where it fell
          const [sx, sy] = toScreen(clamp(m.fallX, 6, FIELD_W - 6), clamp(m.fallY, 6, FIELD_H - 6));
          const k = since / 22;
          g.save();
          g.beginPath(); g.rect(0, 0, 960, sy + 4 + 28 * (1 - k)); g.clip();
          this.gfx.draw(g, m.team, m.slot, sx, sy + 22 * k, { fx: m.fx, fy: m.fy, k: S * 0.78, shadow: false, ring: false, alpha: 1 - k * 0.6 });
          g.restore();
        }
        // its start spot shows how long until it is back
        const [hx, hy] = toScreen(m.homeX, m.homeY);
        const k = m.fallT / FALL_FRAMES;
        g.beginPath(); g.arc(hx, hy - 8, 15, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (1 - k));
        g.strokeStyle = col(m); g.lineWidth = 5; g.stroke();
        text(g, String(Math.ceil(m.fallT / 30)), hx, hy - 8, { size: 14, weight: 900, color: "#fff", align: "center", base: "middle", stroke: "rgba(0,0,0,0.6)", strokeW: 4 });
        continue;
      }
      const x = lerp(m.px, m.x, a), y = lerp(m.py, m.y, a);
      const [sx, sy] = toScreen(x, y);
      const lift = m.lift() * S;
      const c = col(m);
      if (m.state === ST.JUMPING) {
        g.beginPath(); g.ellipse(sx, sy, CATCH_REACH * S, CATCH_REACH * S * 0.55, 0, 0, Math.PI * 2);
        g.fillStyle = rgba(c, 0.14); g.fill();
        g.strokeStyle = rgba(c, 0.85); g.lineWidth = 3; g.stroke();
      }
      const sh = 1 - Math.min(0.5, lift / 90);
      ellipse(g, sx, sy + 1, 12 * sh, 4.6 * sh, "rgba(0,0,0,0.3)");
      g.beginPath(); g.ellipse(sx, sy + 1, 14, 5.4, 0, 0, Math.PI * 2);
      g.lineWidth = 3; g.strokeStyle = c; g.stroke();
      g.save();
      g.translate(0, -lift);
      this.gfx.draw(g, m.team, m.slot, sx, sy, { fx: m.fx, fy: m.fy, k: S * 0.78, shadow: false, ring: false });
      g.restore();
      if (m.team === you) {
        const mine = this.st.held === m.slot || (this.st.keys && this.st.sel === m.slot);
        if (mine) {
          marker(g, sx, sy - 76 - lift, c, this.time, String(m.slot + 1));
          if (m.dragged && (m.tx !== m.x || m.ty !== m.y)) {
            const [tx, ty] = toScreen(m.tx, m.ty);
            g.setLineDash([5, 6]); g.beginPath(); g.moveTo(sx, sy); g.lineTo(tx, ty);
            g.strokeStyle = rgba(c, 0.7); g.lineWidth = 2; g.stroke(); g.setLineDash([]);
            g.beginPath(); g.arc(tx, ty, 6, 0, Math.PI * 2); g.fillStyle = rgba(c, 0.55); g.fill(); g.strokeStyle = "#fff"; g.lineWidth = 2; g.stroke();
          }
        } else if (this.st.hover === m.slot) {
          g.beginPath(); g.ellipse(sx, sy + 1, 19, 7.5, 0, 0, Math.PI * 2);
          g.strokeStyle = "rgba(255,255,255,0.85)"; g.lineWidth = 2; g.stroke();
        }
      }
    }
  }

  drawDisc(g, x, y, s, spin, alpha = 1) {
    g.save();
    g.globalAlpha *= alpha;
    g.translate(x, y);
    g.scale(s, s);
    g.beginPath(); g.ellipse(0, 3, 15, 6.5, 0, 0, Math.PI * 2); g.fillStyle = "#c2410c"; g.fill();
    g.beginPath(); g.ellipse(0, 0, 15, 6.5, 0, 0, Math.PI * 2);
    const gr = g.createLinearGradient(-15, -6, 15, 6);
    gr.addColorStop(0, "#fff3d6"); gr.addColorStop(0.5, "#ff9f45"); gr.addColorStop(1, "#f06a1e");
    g.fillStyle = gr; g.fill();
    g.lineWidth = 1.6; g.strokeStyle = "#fff"; g.stroke();
    g.beginPath(); g.ellipse(0, -0.5, 8.5, 3.4, 0, 0, Math.PI * 2); g.strokeStyle = "rgba(255,255,255,0.8)"; g.lineWidth = 1.4; g.stroke();
    const sx = Math.cos(spin) * 7;
    g.beginPath(); g.ellipse(sx, -0.5, 2.6, 1.2, 0, 0, Math.PI * 2); g.fillStyle = "#fff"; g.fill();
    g.restore();
  }

  drawDiscs(g, a) {
    for (const d of this.sim.discs) {
      if (!d.active) continue;
      const spin = this.time * 14 + d.i;
      if (d.state === DISC.FLYING) {
        const prog = clamp(d.progress - d.speed * (1 - a), 0, 480);
        if (d.progress < 288) {
          const k = prog / 288;
          const sx = FX0 + discX(Math.round(prog), d.path) * S;
          const sy = lerp(36, FY0 - 6, k * k * 0.6 + k * 0.4);
          this.drawDisc(g, sx, sy, 0.35 + 0.45 * k, spin);
        } else {
          const [sx, sy] = toScreen(discX(Math.round(prog), d.path), prog - 288);
          this.drawDisc(g, sx, sy - 26, 0.9 + 0.35 * ((prog - 288) / 192), spin);
        }
      } else if (d.state === DISC.LANDED) {
        const [sx, sy] = toScreen(d.cx, FIELD_H - 6);
        const k = d.progress / 48;
        this.drawDisc(g, sx, Math.min(535, sy + 8 + k * 30), 1.2, spin, 1 - k);
      } else if (d.state === DISC.CAUGHT) {
        const k = d.timer / 20;
        const [sx, sy] = toScreen(d.cx, d.cy);
        this.drawDisc(g, sx, sy - 56 - k * 26, 1.1 - k * 0.2, spin, 1 - k * 0.8);
      }
    }
  }

  hud(g, runner) {
    const { ctx, sim } = this;
    const you = this.st.you;
    const cards = [0, 1, 2, 3].map((i) => ({
      score: sim.scores[i],
      scoreLabel: ctx.t("puntos", "points"),
      flash: this.flash[i],
      mons: sim.teamMons(i).map((m) => ({
        tag: m.c.points ? `×${m.c.points}` : "",
        dim: m.state === ST.FALLEN,
        active: i === you && (this.st.held === m.slot || (this.st.keys && this.st.sel === m.slot)),
        bar: m.state === ST.FALLEN ? 1 - m.fallT / FALL_FRAMES : null,
        barColor: "#8fb8ff",
      })),
    }));
    sidePanels(g, ctx, {
      secondsLeft: sim.timer / 30, total: 60, time: this.time, title: ctx.t("Atrapadiscos", "Disc Catch"), cards, you,
      hints: you >= 0 ? [ctx.t(this.hintEs(), this.hintEn())] : [],
    });
  }

  hintEs() { return "Toca y arrastra para andar; toque corto: salto. Teclas 1-3, flechas y Espacio."; }
  hintEn() { return "Touch and drag to walk; a short tap jumps. Keys 1-3, arrows and Space."; }
}
