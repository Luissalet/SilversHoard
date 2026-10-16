// Hurdle Dash (Saltaobstáculos): three lanes, one per Pokémon, 4096 px of track with hurdles; tap a lane to jump, a jump timed in the
// last 24 px before a hurdle gives a boost. A team's score is the sum of its three finish times (lower is better). The rules and the CPU
// live in hurdle_dash/sim.js; this file reads the input, plays the sounds and draws.
import { Clock, Latch, clamp, checker, slotOfKey, stat } from "./_kit/index.js";
import { Race, TRACK, Y_MON, hurdleY, jumpFrames, roundTime } from "./hurdle_dash/sim.js";

const TOP = 76;
const BOTTOM = 524;
const BOUNDS = [248, 402.7, 557.3, 712];
const K_Y = 1.06;
const sy = (yh) => TOP + (yh + 8) * K_Y;
const PAD_LANE = { 2: 0, 14: 0, 0: 1, 12: 1, 1: 2, 15: 2 };

const fmt = (frames) => {
  const s = frames / 30;
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, "0")}.${Math.floor((s * 10) % 10)}`;
};

export default {
  id: "hurdle_dash",
  names: { es: "Saltaobstáculos", en: "Hurdle Dash" },
  stats: ["speed", "jump", "skill"],
  seconds: 45,
  help: {
    es: "Toca el carril de cada Pokémon (o pulsa 1, 2, 3 / A, S, D) para que salte la valla justo antes de chocar: un salto muy ajustado da impulso. Con mando: izquierda, abajo y derecha, o Y, B y A. Gana el equipo con la suma de tiempos más baja.",
    en: "Tap each Pokémon's lane (or press 1, 2, 3 / A, S, D) to jump the hurdle just before it hits: a tightly timed jump gives a boost. With a gamepad: left, down and right, or Y, B and A. The lowest sum of times wins.",
  },

  create(ctx) {
    const focus = ctx.focus;
    const humanTeam = ctx.teams[focus] && ctx.teams[focus].human ? focus : -1;
    const race = new Race({ teams: ctx.teams, rng: ctx.rng, humanTeam, focus });
    const clock = new Clock();
    const latch = new Latch();
    const pops = [];
    const ripples = [];
    let endTimer = 0;
    let finished = false;
    let sparks = 0;

    const lanesOf = (batch) => {
      const lanes = new Set();
      for (const p of batch.presses) {
        if (p.y < TOP - 10 || p.y > BOTTOM + 14) continue;
        const i = BOUNDS.findIndex((b, k) => k < 3 && p.x >= b && p.x < BOUNDS[k + 1]);
        if (i >= 0) { lanes.add(i); ripples.push({ x: p.x, y: p.y, age: 0 }); }
      }
      for (const k of batch.keys) { const i = slotOfKey(k); if (i >= 0) lanes.add(i); }
      for (const b of batch.pad) if (PAD_LANE[b] !== undefined) lanes.add(PAD_LANE[b]);
      return [...lanes];
    };

    const onEvents = (list) => {
      for (const e of list) {
        if (e.team !== focus) continue;
        const a = ctx.animator(focus, e.lane);
        const cx = (BOUNDS[e.lane] + BOUNDS[e.lane + 1]) / 2;
        if (e.type === "jump") { ctx.sfx("jump"); if (a.has("Hop")) a.play("Hop"); }
        else if (e.type === "boost") { ctx.sfx("score"); pops.push({ x: cx, y: sy(Y_MON) - 80, text: ctx.t("¡Impulso!", "Boost!"), color: "#ffd166", age: 0 }); sparks = 12; }
        else if (e.type === "trip") { ctx.sfx("crash"); if (a.has("Hurt")) a.play("Hurt"); pops.push({ x: cx, y: sy(Y_MON) - 80, text: ctx.t("¡Tropiezo!", "Trip!"), color: "#ff8a7a", age: 0 }); }
        else if (e.type === "finish") { ctx.sfx("cheer"); pops.push({ x: cx, y: sy(Y_MON) - 90, text: fmt(e.time), color: "#7ee081", size: 30, life: 1.6, age: 0 }); }
      }
    };

    return {
      update(dt) {
        latch.absorb(ctx.input);
        for (let lane = 0; lane < 3; lane++) {
          const r = race.runners[focus][lane];
          const a = ctx.animator(focus, lane);
          if (!a.busy()) a.loop(r.finished ? "Idle" : "Walk", clamp(r.speed / 3.2, 0.5, 2));
          a.update(dt);
        }
        for (const p of pops) p.age += dt;
        for (const r of ripples) r.age += dt;
        while (pops.length && pops[0].age > (pops[0].life || 0.9)) pops.shift();
        while (ripples.length && ripples[0].age > 0.4) ripples.shift();
        if (sparks > 0) sparks -= 1;
        if (race.over) {
          latch.take();
          endTimer += dt;
          if (endTimer >= 1.6 && !finished) { finished = true; ctx.finish(race.result()); }
          return;
        }
        clock.advance(dt, () => {
          const batch = latch.take();
          race.step(humanTeam >= 0 ? lanesOf(batch) : []);
          onEvents(race.drain());
        });
        if (race.over) onEvents(race.drain());
      },

      render(g) {
        const ui = ctx.ui;
        // the backdrop and the side panels
        const bg = g.createLinearGradient(0, 0, 0, 540);
        bg.addColorStop(0, "#16202f");
        bg.addColorStop(1, "#0d1420");
        g.fillStyle = bg;
        g.fillRect(0, 0, 960, 540);

        const mine = race.runners[focus];
        for (let lane = 0; lane < 3; lane++) {
          const r = mine[lane];
          const x0 = BOUNDS[lane];
          const x1 = BOUNDS[lane + 1];
          const cx = (x0 + x1) / 2;
          const d = r.dist + r.speed * clock.alpha;
          g.save();
          g.beginPath();
          g.rect(x0, TOP, x1 - x0, BOTTOM - TOP);
          g.clip();
          g.fillStyle = lane % 2 ? "#8a6a43" : "#94724a";
          g.fillRect(x0, TOP, x1 - x0, BOTTOM - TOP);
          // lines that scroll with this runner's own distance
          g.strokeStyle = "rgba(60,38,18,.35)";
          g.lineWidth = 2;
          const off = d % 64;
          for (let k = -2; k < 9; k++) {
            const y = sy(k * 64 + off);
            g.beginPath();
            g.moveTo(x0, y);
            g.lineTo(x1, y);
            g.stroke();
          }
          // the perfect-jump band: a hurdle whose bottom edge is in it gives a boost if you jump now
          g.fillStyle = "rgba(255,214,102,.10)";
          g.fillRect(x0, sy(Y_MON - 24), x1 - x0, sy(Y_MON) - sy(Y_MON - 24));
          // the finish line
          const yf = d - TRACK + Y_MON;
          if (yf > -10 && yf < 440) checker(g, x0, sy(yf) - 8, x1 - x0, 16, 8);
          // hurdles
          for (const h of r.hurdles) {
            const yh = hurdleY(d, h.flag);
            if (yh < -8 || yh > 430) continue;
            const yb = sy(yh);
            const yt = sy(yh - 16);
            g.save();
            if (h.knocked) {
              g.globalAlpha = 0.55;
              g.translate(cx, (yb + yt) / 2);
              g.rotate(0.35);
              g.translate(-cx, -(yb + yt) / 2);
            }
            g.fillStyle = "#3a2a1b";
            g.fillRect(cx - 38, yt - 3, 6, yb - yt + 8);
            g.fillRect(cx + 32, yt - 3, 6, yb - yt + 8);
            g.fillStyle = "#f4f4f4";
            g.fillRect(cx - 34, yt, 68, yb - yt);
            g.fillStyle = "#e5483d";
            for (let s = 0; s < 4; s++) g.fillRect(cx - 34 + s * 17 + 4, yt, 8, yb - yt);
            g.restore();
          }
          g.restore();
          // lane edge
          g.strokeStyle = "rgba(0,0,0,.45)";
          g.lineWidth = 3;
          g.strokeRect(x0, TOP, x1 - x0, BOTTOM - TOP);

          // the Pokémon
          const ground = sy(Y_MON) + 4;
          const hop = r.jumpStat === 0;
          let h = r.height;
          let k = 2;
          let alpha = 1;
          let row = 4;
          if (r.state === 1) {
            if (hop) {
              const f = jumpFrames(0);
              if (r.phase === 1) k = 2 * (1 - 0.5 * ((r.timer + 1) / f.rise));
              else if (r.phase === 2) alpha = 0;
              else k = 2 * (0.5 + 0.5 * ((r.timer + 1) / f.fall));
              h = 0;
            } else {
              k = (2 * (100 + 2 * h)) / 100;
            }
          } else if (r.state === 2) {
            row = (Math.floor(r.tripTimer / 4) * 3) % 8;
            h = 0;
          } else h = 0;
          g.save();
          g.globalAlpha = 0.35 * (hop && r.phase === 2 ? 0.3 : 1);
          g.fillStyle = "#000";
          g.beginPath();
          g.ellipse(cx, ground, 24 - (h > 0 ? h * 0.3 : 0), 8, 0, 0, Math.PI * 2);
          g.fill();
          g.restore();
          g.save();
          g.lineWidth = 3;
          g.strokeStyle = ctx.teams[focus].color;
          g.beginPath();
          g.ellipse(cx, ground, 27, 10, 0, 0, Math.PI * 2);
          g.stroke();
          g.restore();
          if (r.speed > r.top + 0.5 && !r.finished) {
            g.strokeStyle = "rgba(255,214,102,.55)";
            g.lineWidth = 3;
            for (let s = 0; s < 4; s++) {
              const lx = cx - 30 + s * 20;
              const ly = ground - 20 + ((clock.frame * 9 + s * 23) % 60);
              g.beginPath();
              g.moveTo(lx, ly);
              g.lineTo(lx, ly + 22);
              g.stroke();
            }
          }
          ui.mon(g, focus, lane, cx, ground - Math.max(0, h) * 1.5, { row, k, ring: false, shadow: false, alpha, r: 22 });
          // the key under the lane
          ui.panel(g, cx - 14, BOTTOM + 6, 28, 22, { r: 6, fill: "rgba(255,255,255,.1)" });
          ui.text(g, String(lane + 1), cx, BOTTOM + 23, { size: 15, align: "center", stroke: null });
        }

        // the three runners of the person's team, on the left
        ui.clock(g, race.frame / 30, 125, TOP, { label: ctx.t("TIEMPO", "TIME"), tenths: true, warn: 9999 });
        for (let lane = 0; lane < 3; lane++) {
          const r = mine[lane];
          const y = 160 + lane * 118;
          ui.panel(g, 14, y, 222, 106, { fill: "rgba(10,16,28,.55)" });
          ui.icon(g, focus, lane, 24, y + 10, 44, { ring: true });
          ui.text(g, ctx.teams[focus].mons[lane].name, 78, y + 30, { size: 15, stroke: null, color: "#eef3ff" });
          const pct = Math.min(1, r.dist / TRACK);
          ui.bar(g, 24, y + 62, 202, 12, pct, r.finished ? "#7ee081" : ctx.teams[focus].color);
          ui.text(g, r.finished ? `${ctx.t("Meta", "Finish")} ${fmt(r.time)}` : `${Math.round(pct * 100)}%`, 24, y + 94, { size: 15, stroke: null, color: r.finished ? "#7ee081" : "#cfd8ea" });
          ui.text(g, `[${lane + 1}]`, 226, y + 94, { size: 14, align: "right", stroke: null, color: "#8d99b0" });
        }

        // the rivals' progress, on the right
        let row = 0;
        for (let ti = 0; ti < 4; ti++) {
          if (ti === focus) continue;
          const t = ctx.teams[ti];
          const y = 78 + row * 150;
          row++;
          ui.panel(g, 724, y, 222, 138, { fill: "rgba(10,16,28,.55)", stroke: t.color });
          ui.text(g, t.name.length > 18 ? `${t.name.slice(0, 17)}…` : t.name, 736, y + 24, { size: 15, stroke: null, color: "#eef3ff" });
          race.runners[ti].forEach((r, lane) => {
            const by = y + 44 + lane * 30;
            ui.icon(g, ti, lane, 736, by - 6, 22);
            ui.bar(g, 766, by, 160, 10, Math.min(1, r.dist / TRACK), r.finished ? "#7ee081" : t.color);
            if (r.finished) ui.text(g, fmt(r.time), 926, by + 22, { size: 11, align: "right", stroke: null, color: "#9fe9a8" });
          });
        }

        // the scoreboard: progress, then the sum of times
        const scores = [0, 1, 2, 3].map((ti) => {
          const rs = race.runners[ti];
          if (rs.every((r) => r.finished)) return fmt(rs.reduce((s, r) => s + r.time, 0));
          return `${Math.round((rs.reduce((s, r) => s + Math.min(1, r.dist / TRACK), 0) / 3) * 100)}%`;
        });
        ui.scoreboard(g, scores, { y: 8, h: 46 });

        for (const rp of ripples) {
          g.strokeStyle = `rgba(255,255,255,${0.7 * (1 - rp.age / 0.4)})`;
          g.lineWidth = 3;
          g.beginPath();
          g.arc(rp.x, rp.y, 8 + rp.age * 60, 0, Math.PI * 2);
          g.stroke();
        }
        ui.pops(g, pops, { life: 0.9, rise: 40, size: 26 });

        if (race.over) {
          const total = roundTime(mine.reduce((s, r) => s + (r.finished ? r.time : race.frame), 0));
          ui.panel(g, 280, 440, 400, 64, { fill: "rgba(8,12,22,.82)" });
          ui.text(g, `${ctx.t("Suma de tiempos", "Sum of times")}: ${fmt(total)}`, 480, 482, { size: 26, align: "center" });
        }
      },

      destroy() {},
    };
  },
};
