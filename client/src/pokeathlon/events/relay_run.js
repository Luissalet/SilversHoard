// Relay Run (Carrera de relevos): four teams run laps of a looping track for 90 seconds, one Pokémon of each team at a time. Flick yours
// forward with a drag to make it run, steer between lanes, avoid the walls and the slow patches, bump rivals, and swap to the next
// Pokémon before the runner is worn out. The rules and the CPU are in relay_run/sim.js; this file reads the input and draws.
import { Clock, Latch, clamp } from "./_kit/index.js";
import {
  Race, LAP, DURATION, SIZE, TARGET_SCORE, TOUCH_RADIUS, HOLD_MAX, HOLD_TOO_LONG, SWAP_BACK, RADIUS, COND_TIRED, COND_EXHAUSTED,
} from "./relay_run/sim.js";

const S = 2.8; // screen px per ground px
const WX = 14; // left edge of the track window
const WW = 717;
const RUNNER_X = 80; // the person's runner always stands at x = 80 of the 256 px window
const TOP = 70;
const Y_TOP = 16; // ground y at the top of the band
const sxOf = (rel) => WX + (RUNNER_X + rel) * S;
const syOf = (y) => TOP + (y - Y_TOP) * S;
const SWAP_BTN = { x: 755, y: 492, w: 182, h: 40 };
const SWAP_KEYS = ["Space", "Tab", "KeyQ", "KeyE", "ShiftLeft", "ShiftRight"];
const SWAP_PAD = [4, 5, 3];
const K_RIGHT = ["ArrowRight", "KeyD"];
const K_LEFT = ["ArrowLeft", "KeyA"];
const K_UP = ["ArrowUp", "KeyW"];
const K_DOWN = ["ArrowDown", "KeyS"];
const KB_RATE = 7; // drag px added per frame while a key is held
const KB_MAX_X = 120;
const KB_MAX_Y = 90;

const wrap = (d) => ((((d + LAP / 2) % LAP) + LAP) % LAP) - LAP / 2;
const fmtLaps = (score) => (score / LAP).toFixed(1);
const rowOf = (vx, vy) => {
  if (Math.hypot(vx, vy) < 0.3) return 2;
  const theta = Math.atan2(-vy, vx);
  return (((Math.round((theta + Math.PI / 2) / (Math.PI / 4)) % 8) + 8) % 8);
};

export default {
  id: "relay_run",
  names: { es: "Carrera de relevos", en: "Relay Run" },
  stats: ["speed", "stamina", "power", "skill"],
  seconds: 90,
  help: {
    es: "Arrastra desde tu corredor hacia la derecha y suelta en menos de un segundo para lanzarlo: cuanto más largo el arrastre, más velocidad (arriba o abajo para cambiar de carril). Esquiva muros y manchas lentas, y cambia de Pokémon con el botón (o arrastrando hacia la izquierda) antes de que se agote. Con teclado: flechas o WASD cargan el lanzamiento y al soltar sale; Espacio o Tab cambia. Con mando: stick y suelta; L o R cambian.",
    en: "Drag from your runner to the right and let go within a second to fling it: the longer the drag, the more speed (up or down to change lane). Dodge walls and slow patches, and swap Pokémon with the button (or by dragging left) before it wears out. Keyboard: arrows or WASD charge the fling and it goes when you let go; Space or Tab swaps. Gamepad: stick and let go; L or R swap.",
  },

  create(ctx) {
    const focus = ctx.focus;
    const humanTeam = ctx.teams[focus] && ctx.teams[focus].human ? focus : -1;
    const race = new Race({ teams: ctx.teams, rng: ctx.rng, humanTeam });
    const clock = new Clock();
    const latch = new Latch();
    const pops = [];
    const stars = [];
    let ptrActive = false;
    let drag = null; // { x, y, hold } in screen px
    let kbCharge = null; // { dx, dy }
    let kbActive = false;
    let endTimer = 0;
    let finished = false;

    const me = () => race.teams[focus];
    const centerOf = (t) => ({ x: sxOf(0), y: syOf(t.y - 10) });

    const applyInput = (batch) => {
      const t = me();
      let pi = 0;
      let ri = 0;
      while (pi < batch.presses.length || ri < batch.releases.length) {
        if (ptrActive) {
          if (ri >= batch.releases.length) break;
          const r = batch.releases[ri++];
          ptrActive = false;
          race.tooLong = false;
          if (drag) {
            if (drag.hold <= HOLD_MAX) {
              const res = race.drag(humanTeam, (r.x - drag.x) / S, (r.y - drag.y) / S);
              if (res === "flick") ctx.sfx("throw");
              else if (res === "swap") ctx.sfx("whistle");
            }
            drag = null;
          }
        } else if (pi < batch.presses.length) {
          const d = batch.presses[pi++];
          ptrActive = true;
          kbActive = false;
          const inBtn = d.x >= SWAP_BTN.x && d.x < SWAP_BTN.x + SWAP_BTN.w && d.y >= SWAP_BTN.y && d.y < SWAP_BTN.y + SWAP_BTN.h;
          if (inBtn) { if (race.swap(humanTeam)) ctx.sfx("whistle"); drag = null; }
          else {
            const c = centerOf(t);
            if (race.canAct(humanTeam) && Math.hypot(d.x - c.x, d.y - c.y) / S < TOUCH_RADIUS) drag = { x: d.x, y: d.y, hold: 0 };
          }
        } else ri++;
      }
      if (drag && ptrActive) {
        drag.hold++;
        if (drag.hold >= HOLD_TOO_LONG) race.tooLong = true;
      }
      // keyboard and pad: charge a drag, fire on release
      const keys = ctx.input.keys;
      const pad = ctx.input.pad;
      const held = (list) => list.some((k) => keys.has(k));
      const kx = (held(K_RIGHT) ? 1 : 0) - (held(K_LEFT) ? 1 : 0);
      const ky = (held(K_DOWN) ? 1 : 0) - (held(K_UP) ? 1 : 0);
      const stick = Math.hypot(pad.lx, pad.ly) > 0.3;
      if (batch.keys.size || batch.pad.size) kbActive = true;
      if (kx || ky) {
        kbCharge = kbCharge || { dx: 0, dy: 0 };
        kbCharge.dx = clamp(kbCharge.dx + kx * KB_RATE, -KB_MAX_X, KB_MAX_X);
        kbCharge.dy = clamp(kbCharge.dy + ky * KB_RATE * 0.7, -KB_MAX_Y, KB_MAX_Y);
        kbActive = true;
      } else if (stick) {
        kbCharge = { dx: pad.lx * KB_MAX_X, dy: pad.ly * KB_MAX_Y, stick: true };
        kbActive = true;
      } else if (kbCharge) {
        const c = kbCharge;
        kbCharge = null;
        const res = race.drag(humanTeam, c.dx, c.dy);
        if (res === "flick") ctx.sfx("throw");
        else if (res === "swap") ctx.sfx("whistle");
      }
      if (SWAP_KEYS.some((k) => batch.keys.has(k)) || SWAP_PAD.some((b) => batch.pad.has(b))) { if (race.swap(humanTeam)) ctx.sfx("whistle"); }
    };

    const onEvents = (list) => {
      for (const e of list) {
        const mine = e.team === focus;
        if (e.type === "lap" && mine) { ctx.sfx("score"); pops.push({ x: sxOf(0), y: syOf(me().y) - 90, text: ctx.t(`¡Vuelta ${e.laps}!`, `Lap ${e.laps}!`), color: "#ffd166", size: 30, age: 0, life: 1.3 }); }
        else if (e.type === "exhaust" && mine) { ctx.sfx("crash"); pops.push({ x: sxOf(0), y: syOf(me().y) - 80, text: ctx.t("¡Agotado!", "Worn out!"), color: "#ff9d8e", size: 28, age: 0, life: 1.2 }); }
        else if (e.type === "collide") {
          const a = race.teams[e.team];
          const b = race.teams[e.other];
          const rel = wrap((a.x + b.x) / 2 - me().x + (Math.abs(a.x - b.x) > 512 ? 512 : 0));
          stars.push({ x: sxOf(rel), y: syOf((a.y + b.y) / 2 - 8), age: 0 });
          if (e.team === focus || e.other === focus) ctx.sfx("hit");
        } else if (e.type === "bump" && mine) ctx.sfx("hit");
        else if (e.type === "swapMid" && mine) pops.push({ x: sxOf(0), y: syOf(me().y) - 70, text: ctx.t("¡Relevo!", "Swap!"), color: "#9cc4ff", size: 26, age: 0, life: 1.0 });
        else if (e.type === "end") ctx.sfx("end");
      }
    };

    return {
      update(dt) {
        latch.absorb(ctx.input);
        for (const t of race.teams) {
          const a = ctx.animator(t.idx, t.cur);
          if (!a.busy()) {
            const sp = Math.hypot(t.vx, t.vy);
            a.loop(sp > 0.4 && !t.swapping ? "Walk" : "Idle", clamp(0.5 + sp / 5, 0.5, 2.2));
          }
          a.update(dt);
        }
        for (const p of pops) p.age += dt;
        while (pops.length && pops[0].age > (pops[0].life || 0.9)) pops.shift();
        for (const s of stars) s.age += dt;
        while (stars.length && stars[0].age > 0.5) stars.shift();
        if (race.over) {
          latch.take();
          endTimer += dt;
          if (endTimer >= 1.8 && !finished) { finished = true; ctx.finish(race.result()); }
          return;
        }
        clock.advance(dt, () => {
          const batch = latch.take();
          if (humanTeam >= 0) applyInput(batch);
          race.step();
          onEvents(race.drain());
        });
        if (race.over) onEvents(race.drain());
      },

      render(g) {
        const ui = ctx.ui;
        const f = clock.frame;
        const T = race.teams;
        const mt = T[focus];
        const bg = g.createLinearGradient(0, 0, 0, 540);
        bg.addColorStop(0, "#18222f");
        bg.addColorStop(1, "#0c121b");
        g.fillStyle = bg;
        g.fillRect(0, 0, 960, 540);

        // ---- the track window --------------------------------------------------------------------------------------------------
        g.save();
        g.beginPath();
        g.rect(WX, TOP, WW, 480);
        g.clip();
        const floor = g.createLinearGradient(0, TOP, 0, TOP + 460);
        floor.addColorStop(0, "#7a6a55");
        floor.addColorStop(1, "#6a5c49");
        g.fillStyle = floor;
        g.fillRect(WX, TOP, WW, 480);
        const scroll = ((mt.x % 64) + 64) % 64;
        g.strokeStyle = "rgba(255,255,255,.18)";
        g.lineWidth = 3;
        g.setLineDash([22, 18]);
        for (let lane = 1; lane < 4; lane++) {
          const y = syOf(32 + lane * 40 - 8);
          g.lineDashOffset = scroll * S;
          g.beginPath();
          g.moveTo(WX, y);
          g.lineTo(WX + WW, y);
          g.stroke();
        }
        g.setLineDash([]);
        g.lineDashOffset = 0;
        // grain that scrolls with the runner
        g.fillStyle = "rgba(0,0,0,.08)";
        for (let k = -2; k < 14; k++) g.fillRect(WX + ((k * 64 - scroll) * S + WW) % WW, TOP, 4, 460);
        // the start line
        const lineRel = wrap(0 - mt.x);
        if (lineRel > -90 && lineRel < 200) {
          const lx = sxOf(lineRel);
          for (let r = 0; r < 24; r++) for (let c = 0; c < 2; c++) { g.fillStyle = (r + c) & 1 ? "#f4f4f4" : "#1b2233"; g.fillRect(lx + c * 8, syOf(Y_TOP) + r * 20, 8, 20); }
          ui.text(g, ctx.t("META / SALIDA", "START / FINISH"), lx + 8, syOf(Y_TOP) + 480 - 6, { size: 12, color: "#fff", stroke: null, weight: 700, alpha: 0.8 });
        }
        // obstacles
        for (const [k, ox, oy] of race.layout) {
          const rel = wrap(ox - mt.x);
          const size = SIZE[k];
          if (rel < -120 || rel > 220) continue;
          const x = sxOf(rel) - (size * S) / 2;
          const y = syOf(oy + 32) - (size * S) / 2;
          const sz = size * S;
          if (k === 3) {
            g.fillStyle = "rgba(60,40,18,.78)";
            g.fillRect(x, y, sz, sz);
            g.strokeStyle = "rgba(255,230,180,.18)";
            g.lineWidth = 2;
            for (let r = 1; r < 4; r++) { g.beginPath(); g.moveTo(x + 6, y + (sz * r) / 4); g.quadraticCurveTo(x + sz / 2, y + (sz * r) / 4 + 8 * Math.sin(f / 8 + r), x + sz - 6, y + (sz * r) / 4); g.stroke(); }
            g.strokeStyle = "rgba(0,0,0,.4)";
            g.lineWidth = 3;
            g.setLineDash([8, 6]);
            g.strokeRect(x, y, sz, sz);
            g.setLineDash([]);
            ui.text(g, ctx.t("lento", "slow"), x + sz / 2, y + sz / 2 + 6, { size: 18, align: "center", color: "#e6c898", alpha: 0.8, stroke: null });
          } else {
            g.fillStyle = "rgba(0,0,0,.3)";
            g.fillRect(x + 5, y + 7, sz, sz);
            g.fillStyle = "#6f7788";
            g.fillRect(x, y, sz, sz);
            g.fillStyle = "#8f98aa";
            g.fillRect(x, y, sz, sz * 0.14);
            g.fillRect(x, y, sz * 0.1, sz);
            g.fillStyle = "#555c6c";
            g.fillRect(x, y + sz * 0.88, sz, sz * 0.12);
            g.fillRect(x + sz * 0.9, y, sz * 0.1, sz);
            g.strokeStyle = "rgba(30,34,46,.7)";
            g.lineWidth = 2;
            g.strokeRect(x, y, sz, sz);
            g.beginPath();
            g.moveTo(x, y + sz / 2); g.lineTo(x + sz, y + sz / 2);
            g.moveTo(x + sz / 3, y); g.lineTo(x + sz / 3, y + sz / 2);
            g.moveTo(x + (2 * sz) / 3, y + sz / 2); g.lineTo(x + (2 * sz) / 3, y + sz);
            g.stroke();
          }
        }

        // ---- the runners ---------------------------------------------------------------------------------------------------------
        const order = [...T].sort((a, b) => a.y - b.y);
        for (const t of order) {
          const rel = wrap(t.x - mt.x);
          if (rel < -120 || rel > 230) continue;
          const x = sxOf(rel);
          let y = syOf(t.y);
          let alpha = 1;
          let lift = 0;
          if (t.swapping) {
            if (t.phase === 1) { lift = Math.min(t.swapT, 20) * 20 * S; alpha = clamp(1 - t.swapT / 12, 0, 1); }
            else { const tt = t.swapT - 31; lift = Math.max(0, 400 - Math.max(0, tt) * 20) * S * 0.5; alpha = clamp(tt / 8, 0, 1); }
          }
          const team = ctx.teams[t.idx];
          const mem = t.m[t.cur];
          // shadow and ring
          g.fillStyle = "rgba(0,0,0,.32)";
          g.beginPath();
          g.ellipse(x, y + 3, RADIUS * S * 1.05, RADIUS * S * 0.45, 0, 0, Math.PI * 2);
          g.fill();
          if (alpha > 0.05) {
            const grade = t.grade;
            if (!t.swapping && grade >= 2 && Math.hypot(t.vx, t.vy) > 3) {
              g.strokeStyle = grade === 3 ? "rgba(255,214,102,.65)" : "rgba(255,255,255,.4)";
              g.lineWidth = 3;
              for (let s2 = 0; s2 < 4; s2++) {
                const ly = y - 8 - s2 * 11;
                const len = 26 + ((f * 9 + s2 * 17) % 30);
                g.beginPath();
                g.moveTo(x - 24, ly);
                g.lineTo(x - 24 - len, ly);
                g.stroke();
              }
            }
            const wob = t.stun > 0 ? Math.sin(f * 2) * 3 : 0;
            ui.mon(g, t.idx, t.cur, x + wob, y - lift, { row: rowOf(t.vx, t.vy), k: 2.1, r: RADIUS * S * 0.85, alpha, flash: mem.cond === COND_EXHAUSTED ? 0.2 : 0 });
            if (t.idx === focus) {
              g.fillStyle = team.color;
              g.beginPath();
              g.moveTo(x - 8, y - lift - 86);
              g.lineTo(x + 8, y - lift - 86);
              g.lineTo(x, y - lift - 74);
              g.closePath();
              g.fill();
            }
            if (mem.cond === COND_TIRED && !t.swapping) ui.text(g, "~", x + 24, y - 54, { size: 22, color: "#9cd3ff" });
            if (mem.cond === COND_EXHAUSTED && !t.swapping) ui.text(g, "zZ", x + 22, y - 58, { size: 20, color: "#ffd166" });
          }
        }
        for (const s of stars) {
          const k = s.age / 0.5;
          g.save();
          g.translate(s.x, s.y);
          g.globalAlpha = 1 - k;
          ui.text(g, "*", 0, 0, { size: 40 + k * 26, align: "center", color: "#ffe066" });
          g.restore();
        }

        // ---- the person's drag -----------------------------------------------------------------------------------------------------
        if (humanTeam >= 0 && !race.over) {
          const m = mt.m[mt.cur];
          const c = centerOf(mt);
          const arrow = (dx, dy, label) => {
            const k = m.gain;
            const cap = mt.onpatch ? m.patch : m.E <= 40 ? m.tiredSpd : m.limit;
            let vx = mt.vx + dx * k;
            let vy = mt.vy * dy * k >= 0 ? mt.vy + dy * k : dy * k;
            const sp = Math.hypot(vx, vy);
            if (sp > cap) { vx *= cap / sp; vy *= cap / sp; }
            const speed = Math.min(sp, cap);
            const len = speed * 16;
            const ang = Math.atan2(vy, vx);
            const ex = c.x + Math.cos(ang) * len;
            const ey = c.y + Math.sin(ang) * len;
            g.strokeStyle = sp > cap ? "#ffd166" : "#fff";
            g.fillStyle = g.strokeStyle;
            g.lineWidth = 5;
            g.beginPath();
            g.moveTo(c.x, c.y);
            g.lineTo(ex, ey);
            g.stroke();
            g.beginPath();
            g.moveTo(ex, ey);
            g.lineTo(ex - Math.cos(ang - 0.45) * 16, ey - Math.sin(ang - 0.45) * 16);
            g.lineTo(ex - Math.cos(ang + 0.45) * 16, ey - Math.sin(ang + 0.45) * 16);
            g.closePath();
            g.fill();
            ui.text(g, `${speed.toFixed(1)} / ${cap}`, ex + 10, ey - 10, { size: 15, color: sp > cap ? "#ffd166" : "#fff" });
            if (label) ui.text(g, label, c.x, c.y - 110, { size: 18, align: "center", color: "#9cc4ff" });
          };
          if (drag && ptrActive) {
            const p = ctx.input.pointer;
            g.strokeStyle = drag.hold > HOLD_MAX ? "#ff8a7a" : "rgba(255,255,255,.55)";
            g.lineWidth = 3;
            g.setLineDash([5, 6]);
            g.beginPath();
            g.moveTo(drag.x, drag.y);
            g.lineTo(p.x, p.y);
            g.stroke();
            g.setLineDash([]);
            g.lineWidth = 5;
            g.strokeStyle = drag.hold > HOLD_MAX ? "#ff8a7a" : "#ffe29a";
            g.beginPath();
            g.arc(drag.x, drag.y, 14, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * clamp(1 - drag.hold / HOLD_MAX, 0, 1));
            g.stroke();
            const dx = (p.x - drag.x) / S;
            const dy = (p.y - drag.y) / S;
            if (drag.hold > HOLD_MAX) ui.text(g, ctx.t("¡Suelta ya!", "Let go!"), p.x, p.y - 20, { size: 20, align: "center", color: "#ffb4a8" });
            else if (dx < SWAP_BACK) ui.text(g, ctx.t("Soltar: cambiar de Pokémon", "Let go: swap Pokémon"), c.x, c.y - 100, { size: 18, align: "center", color: "#9cc4ff" });
            else if (dx >= 0) arrow(dx, dy);
          } else if (kbCharge) {
            if (kbCharge.dx < SWAP_BACK) ui.text(g, ctx.t("Soltar: cambiar de Pokémon", "Let go: swap Pokémon"), c.x, c.y - 100, { size: 18, align: "center", color: "#9cc4ff" });
            else arrow(Math.max(0, kbCharge.dx), kbCharge.dy);
          } else if (f < 150 && race.canAct(humanTeam) && mt.vx === 0) {
            g.setLineDash([6, 8]);
            g.strokeStyle = "rgba(255,255,255,.3)";
            g.lineWidth = 2;
            g.beginPath();
            g.arc(c.x, c.y, TOUCH_RADIUS * S, 0, Math.PI * 2);
            g.stroke();
            g.setLineDash([]);
            ui.text(g, ctx.t("Arrastra desde aquí hacia la derecha y suelta", "Drag from here to the right and let go"), c.x + 60, c.y - 130, { size: 17, align: "center", color: "#fff", alpha: 0.9 });
          }
        }
        ui.pops(g, pops, { life: 0.9, rise: 34, size: 24 });
        g.restore();
        g.strokeStyle = "rgba(255,255,255,.18)";
        g.lineWidth = 2;
        g.strokeRect(WX, TOP, WW, 480);

        // ---- the top bar: laps and the map -------------------------------------------------------------------------------------------
        ui.panel(g, WX, 8, WW, 54, { r: 12 });
        const myScore = race.scoreOf(focus);
        ui.text(g, ctx.t(`VUELTAS · META ${TARGET_SCORE / LAP}`, `LAPS · GOAL ${TARGET_SCORE / LAP}`), 26, 24, { size: 11, color: "#a9b4c8", stroke: null, weight: 600 });
        ui.text(g, fmtLaps(myScore), 26, 54, { size: 34 });
        const bx = 150;
        const bw = 540;
        g.fillStyle = "rgba(255,255,255,.12)";
        g.fillRect(bx, 33, bw, 8);
        for (const [k, ox] of race.layout) {
          g.fillStyle = k === 3 ? "rgba(190,140,70,.8)" : "rgba(170,180,200,.9)";
          g.fillRect(bx + (ox / LAP) * bw - 2, 29, 4, 16);
        }
        g.fillStyle = "#fff";
        g.fillRect(bx - 2, 24, 4, 26);
        g.fillRect(bx + bw - 2, 24, 4, 26);
        for (const t of T) {
          const x = bx + ((t.x % LAP) / LAP) * bw;
          const team = ctx.teams[t.idx];
          g.beginPath();
          g.arc(x, 37, t.idx === focus ? 9 : 7, 0, Math.PI * 2);
          g.fillStyle = team.color;
          g.fill();
          g.lineWidth = 2;
          g.strokeStyle = "#fff";
          g.stroke();
        }

        // ---- the right panel ---------------------------------------------------------------------------------------------------------
        const left = Math.max(0, DURATION - race.frame) / 30;
        ui.panel(g, 745, 8, 201, 54, { r: 12 });
        ui.text(g, ctx.t("TIEMPO", "TIME"), 845, 24, { size: 11, align: "center", color: "#a9b4c8", stroke: null, weight: 600 });
        ui.text(g, ui.fmtClock(left), 845, 54, { size: 34, align: "center", color: left <= 10 ? "#ffd166" : "#fff" });
        const ranking = [...T].sort((a, b) => race.scoreOf(b.idx) - race.scoreOf(a.idx));
        ranking.forEach((t, i) => {
          const team = ctx.teams[t.idx];
          const y = 70 + i * 46;
          ui.panel(g, 745, y, 201, 40, { fill: hexFill(team.color, team.human ? 0.34 : 0.2), stroke: team.color, lw: team.human ? 2.5 : 1.2, r: 10 });
          ui.text(g, `${i + 1}`, 758, y + 27, { size: 18, color: "#cfd8ea", stroke: null });
          ui.icon(g, t.idx, t.cur, 774, y + 6, 28);
          const nm = team.name.length > 9 ? `${team.name.slice(0, 8)}…` : team.name;
          ui.text(g, nm, 808, y + 25, { size: 12, color: "#eef3ff", stroke: null, weight: 700 });
          ui.text(g, fmtLaps(race.scoreOf(t.idx)), 936, y + 28, { size: 22, align: "right" });
        });
        // my runner
        const cur = mt.m[mt.cur];
        ui.panel(g, 745, 262, 201, 132);
        ui.icon(g, focus, mt.cur, 755, 270, 40, { ring: true });
        ui.text(g, ctx.teams[focus].mons[mt.cur].name, 802, 292, { size: 14, color: "#eef3ff", stroke: null });
        const cond = cur.cond === COND_EXHAUSTED ? ctx.t("Agotado", "Worn out") : cur.cond === COND_TIRED ? ctx.t("Cansado", "Tired") : ctx.t("Fresco", "Fresh");
        ui.text(g, cond, 802, 310, { size: 12, color: cur.cond === COND_EXHAUSTED ? "#ff9d8e" : cur.cond === COND_TIRED ? "#ffd166" : "#8ff0a4", stroke: null, weight: 700 });
        ui.text(g, ctx.t("Energía", "Energy"), 757, 338, { size: 11, color: "#8d99b0", stroke: null, weight: 600 });
        ui.bar(g, 757, 344, 177, 10, cur.E / cur.maxE, cur.cond === COND_EXHAUSTED ? "#ff8a7a" : cur.cond === COND_TIRED ? "#ffd166" : "#7ee081");
        g.fillStyle = "rgba(255,255,255,.7)";
        g.fillRect(757 + (40 / cur.maxE) * 177 - 1, 341, 2, 16);
        const sp = Math.hypot(mt.vx, mt.vy);
        const cap = mt.onpatch ? cur.patch : cur.E <= 40 ? cur.tiredSpd : cur.limit;
        ui.text(g, `${ctx.t("Velocidad", "Speed")} ${sp.toFixed(1)} / ${cap}`, 757, 376, { size: 11, color: "#8d99b0", stroke: null, weight: 600 });
        ui.bar(g, 757, 382, 177, 6, sp / cur.limit, sp >= cur.limit - 1 ? "#ffd166" : "#6aa8ff");
        // the two waiting
        ui.panel(g, 745, 400, 201, 86, { fill: "rgba(10,16,28,.5)" });
        for (let k = 1; k <= 2; k++) {
          const mi = (mt.cur + k) % 3;
          const mm = mt.m[mi];
          const y = 406 + (k - 1) * 40;
          ui.icon(g, focus, mi, 755, y, 32, { ring: k === 1 ? "rgba(255,255,255,.7)" : null });
          ui.bar(g, 796, y + 8, 140, 8, mm.E / mm.maxE, mm.cond === COND_TIRED ? "#ffd166" : "#7ee081");
          ui.text(g, k === 1 ? ctx.t("el siguiente", "next up") : ctx.t("después", "after"), 796, y + 30, { size: 10.5, color: "#aeb9cc", stroke: null, weight: 600 });
        }
        // swap button
        const canSwap = race.canAct(focus) && humanTeam >= 0;
        ui.panel(g, SWAP_BTN.x, SWAP_BTN.y, SWAP_BTN.w, SWAP_BTN.h, { fill: canSwap ? "rgba(70,130,220,.55)" : "rgba(60,70,90,.45)", stroke: canSwap ? "#9cc4ff" : "rgba(255,255,255,.15)", lw: 2.5, r: 12 });
        ui.text(g, ctx.t("Cambio de Pokémon", "Swap Pokémon"), SWAP_BTN.x + SWAP_BTN.w / 2, SWAP_BTN.y + 17, { size: 14, align: "center", color: canSwap ? "#fff" : "#8d99b0" });
        ui.text(g, ctx.t("Espacio · Tab · L / R", "Space · Tab · L / R"), SWAP_BTN.x + SWAP_BTN.w / 2, SWAP_BTN.y + 33, { size: 10.5, align: "center", color: canSwap ? "#cfe3ff" : "#6e7a90", stroke: null, weight: 600 });

        if (race.over) ui.banner(g, ctx.t("¡Tiempo!", "Time!"), ctx.t(`${fmtLaps(myScore)} vueltas`, `${fmtLaps(myScore)} laps`), 220);
      },

      destroy() {},
    };
  },
};

function hexFill(hex, a) {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}
