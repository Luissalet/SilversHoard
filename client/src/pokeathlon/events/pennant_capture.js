// Pennant Capture (Atrapabanderas): fling your Pokémon with a drag to pick up pennants and carry them into the goal slot; the next of
// your three Pokémon comes in after each delivery. A rival that is slower and faces the same way as you can be knocked down from
// behind (it loses up to two pennants to you). The rules and the CPU are in pennant_capture/sim.js; this file reads the input, plays
// the sounds and draws the whole field at once (the original showed a 256 x 192 window that followed the Pokémon).
import { Clock, Latch, clamp } from "./_kit/index.js";
import {
  Match, MAX_CARRY, MAX_SPEED, X0, X1, Y0, Y1, SLOT_X0, SLOT_X1, SLOT_Y, RADIUS, TOTAL_FRAMES, TARGET_SCORE, HOLD_MAX, TOUCH_RADIUS, FRICTION, startOf,
} from "./pennant_capture/sim.js";

const K = 1.52; // screen pixels per field pixel
const OX = 311;
const OY = 30;
const fx = (x) => OX + (x - X0) * K;
const fy = (y) => OY + (y - Y0) * K;
const gx = (sx) => X0 + (sx - OX) / K;
const gy = (sy) => Y0 + (sy - OY) / K;
const SPRITE_K = 1.6;

const AIM_KEYS = { left: ["ArrowLeft", "KeyA"], right: ["ArrowRight", "KeyD"], up: ["ArrowUp", "KeyW"], down: ["ArrowDown", "KeyS"] };
const FIRE_KEYS = ["Space", "Enter", "NumpadEnter", "KeyZ", "KeyX", "KeyJ", "KeyK"];
const FIRE_PAD = [0, 1, 2, 3, 5, 7];
const PAD_DIR = { 12: [0, -1], 13: [0, 1], 14: [-1, 0], 15: [1, 0] };
const KEY_MIN = 22; // the drag length (field px) of a tap on the fire key
const KEY_MAX = 76;
const KEY_CHARGE = 20; // steps to reach the full length

const ROW_OF = (vx, vy, fallback) => {
  if (Math.hypot(vx, vy) < 0.4) return fallback;
  const theta = Math.atan2(-vy, vx);
  return (((Math.round((theta + Math.PI / 2) / (Math.PI / 4)) % 8) + 8) % 8);
};
const FACING_ROW = [2, 0, 6, 4]; // right, down, left, up

function flagShape(g, x, y, s, color, t) {
  // pole and a waving triangle; (x, y) = foot of the pole
  g.save();
  g.lineCap = "round";
  g.strokeStyle = "#4a3320";
  g.lineWidth = Math.max(1.5, s * 0.1);
  g.beginPath();
  g.moveTo(x, y);
  g.lineTo(x, y - s);
  g.stroke();
  const w = s * 0.62;
  const h = s * 0.46;
  const wave = Math.sin(t) * s * 0.07;
  g.beginPath();
  g.moveTo(x, y - s);
  g.quadraticCurveTo(x + w * 0.55, y - s + h * 0.1 + wave, x + w, y - s + h * 0.5 + wave * 1.4);
  g.quadraticCurveTo(x + w * 0.55, y - s + h * 0.85 + wave, x, y - s + h);
  g.closePath();
  g.fillStyle = color;
  g.fill();
  g.lineWidth = 1.2;
  g.strokeStyle = "rgba(60,30,0,.65)";
  g.stroke();
  g.restore();
}

export default {
  id: "pennant_capture",
  names: { es: "Atrapabanderas", en: "Pennant Capture" },
  stats: ["skill", "speed", "power", "stamina"],
  seconds: 60,
  help: {
    es: "Arrastra desde tu Pokémon y suelta en menos de un segundo para lanzarlo: cuanto más largo el arrastre, más rápido va. Recoge banderas (hasta 9) y llévalas a la meta de abajo; después de cada entrega entra el siguiente Pokémon. Si embistes por la espalda a un rival más lento que mire hacia donde vas, lo derribas y le quitas banderas. Con teclado o mando: flechas o stick para apuntar y Espacio o A para lanzar (mantén para más fuerza).",
    en: "Drag from your Pokémon and let go within a second to fling it: the longer the drag, the faster it goes. Pick up flags (up to 9) and carry them into the goal at the bottom; after each delivery your next Pokémon comes in. Ram a slower rival from behind while it faces your way and you knock it down and take its flags. With keyboard or gamepad: arrows or stick to aim, Space or A to fling (hold for more power).",
  },

  create(ctx) {
    const humanTeam = ctx.teams[ctx.focus] && ctx.teams[ctx.focus].human ? ctx.focus : -1;
    const match = new Match({ teams: ctx.teams, rng: ctx.rng, humanTeam });
    const clock = new Clock();
    const latch = new Latch();
    const pops = [];
    const feed = [];
    let ptrActive = false;
    let aim = { x: 0, y: -1 };
    let charging = false;
    let charge = 0;
    let flicked = 0;
    let hintAt = -999;
    let endTimer = 0;
    let finished = false;

    const nm = (team, member) => {
      const m = ctx.teams[team].mons[member];
      return (m && m.name) || "?";
    };
    const say = (text, color) => { feed.unshift({ text, color, age: 0 }); if (feed.length > 6) feed.pop(); };
    const pop = (x, y, text, color, size = 22) => pops.push({ x: fx(x), y: fy(y) - 30, text, color, size, age: 0 });

    const fireHeld = () => FIRE_KEYS.some((k) => ctx.input.keys.has(k)) || FIRE_PAD.some((b) => ctx.input.pad.held.has(b));

    const updateAim = () => {
      let ax = 0;
      let ay = 0;
      const keys = ctx.input.keys;
      if (AIM_KEYS.left.some((k) => keys.has(k))) ax -= 1;
      if (AIM_KEYS.right.some((k) => keys.has(k))) ax += 1;
      if (AIM_KEYS.up.some((k) => keys.has(k))) ay -= 1;
      if (AIM_KEYS.down.some((k) => keys.has(k))) ay += 1;
      const pad = ctx.input.pad;
      if (Math.hypot(pad.lx, pad.ly) > 0.35) { ax += pad.lx; ay += pad.ly; }
      for (const b of pad.held) if (PAD_DIR[b]) { ax += PAD_DIR[b][0]; ay += PAD_DIR[b][1]; }
      const l = Math.hypot(ax, ay);
      if (l > 0.2) aim = { x: ax / l, y: ay / l };
    };

    const applyInput = (batch) => {
      const p = match.players[humanTeam];
      // the pointer: presses and releases alternate, in the order the pointer state allows
      let pi = 0;
      let ri = 0;
      while (pi < batch.presses.length || ri < batch.releases.length) {
        if (ptrActive) {
          if (ri >= batch.releases.length) break;
          const r = batch.releases[ri++];
          ptrActive = false;
          if (p.drag) {
            const slow = p.drag.hold > HOLD_MAX;
            const ok = match.endDrag(humanTeam, gx(r.x), gy(r.y));
            if (ok) { flicked++; ctx.sfx("throw"); }
            else if (slow) pops.push({ x: r.x, y: r.y - 20, text: ctx.t("¡Suelta antes!", "Let go sooner!"), color: "#ffb4a8", size: 20, age: 0 });
          }
        } else if (pi < batch.presses.length) {
          const d = batch.presses[pi++];
          ptrActive = true;
          const ok = match.beginDrag(humanTeam, gx(d.x), gy(d.y));
          if (!ok && match.canAct(p) && clock.frame - hintAt > 60) {
            hintAt = clock.frame;
            pops.push({ x: d.x, y: d.y - 20, text: ctx.t("Empieza sobre tu Pokémon", "Start on your Pokémon"), color: "#ffe29a", size: 18, age: 0, life: 1.4 });
          }
        } else ri++;
      }
      // keyboard and gamepad: aim, then fire (a tap is a short drag, holding makes it longer)
      if (!charging) {
        if (FIRE_KEYS.some((k) => batch.keys.has(k)) || FIRE_PAD.some((b) => batch.pad.has(b))) { charging = true; charge = 0; }
      }
      if (charging) {
        if (fireHeld() && match.canAct(p)) charge = Math.min(KEY_CHARGE, charge + 1);
        else {
          const len = KEY_MIN + (KEY_MAX - KEY_MIN) * Math.min(1, charge / KEY_CHARGE);
          if (match.canAct(p) && match.flick(humanTeam, aim.x * len, aim.y * len)) { flicked++; ctx.sfx("throw"); }
          charging = false;
          charge = 0;
        }
      }
    };

    const onEvents = (list) => {
      for (const e of list) {
        const mine = e.team === humanTeam;
        if (e.type === "pickup" && mine) ctx.sfx("catch");
        else if (e.type === "score") {
          if (mine) { ctx.sfx("score"); pop(e.x, e.y - 6, "+1", "#ffe29a", 24); }
        } else if (e.type === "deposit") {
          const p = match.players[e.team];
          if (mine || p.pointsToAdd >= 4) say(ctx.t(`${ctx.teams[e.team].name} entrega ${p.pointsToAdd} banderas`, `${ctx.teams[e.team].name} delivers ${p.pointsToAdd} flags`), ctx.teams[e.team].color);
        } else if (e.type === "knock") {
          ctx.sfx("crash");
          const v = match.players[e.victim];
          const w = match.players[e.team];
          pop(v.x, v.y - 14, ctx.t("¡Derribado!", "Knocked down!"), "#ff9d8e", 24);
          say(ctx.t(`${nm(e.team, w.member)} derriba a ${nm(e.victim, v.member)}${e.took ? ` y le quita ${e.took}` : ""}`, `${nm(e.team, w.member)} knocks down ${nm(e.victim, v.member)}${e.took ? ` and takes ${e.took}` : ""}`), ctx.teams[e.team].color);
        } else if (e.type === "hit" || e.type === "bump") {
          if (mine) ctx.sfx("hit");
        } else if (e.type === "swap" && mine) {
          say(ctx.t(`Entra ${nm(e.team, e.member)}`, `${nm(e.team, e.member)} comes in`), ctx.teams[e.team].color);
        } else if (e.type === "end") ctx.sfx("end");
      }
    };

    return {
      update(dt) {
        latch.absorb(ctx.input);
        if (humanTeam >= 0) updateAim();
        for (const p of match.players) {
          const a = ctx.animator(p.team, p.member);
          if (!a.busy()) {
            const sp = Math.hypot(p.vx, p.vy);
            if (p.knocked && a.has("Hurt")) a.play("Hurt");
            else a.loop(sp > 0.5 && p.mode === "play" ? "Walk" : "Idle", clamp(0.6 + sp / 8, 0.6, 2));
          }
          a.update(dt);
        }
        for (const q of pops) q.age += dt;
        while (pops.length && pops[0].age > (pops[0].life || 0.9)) pops.shift();
        for (const fe of feed) fe.age += dt;
        while (feed.length && feed[feed.length - 1].age > 7) feed.pop();
        if (match.over) {
          latch.take();
          endTimer += dt;
          if (endTimer >= 1.8 && !finished) { finished = true; ctx.finish(match.result()); }
          return;
        }
        clock.advance(dt, () => {
          const batch = latch.take();
          if (humanTeam >= 0) applyInput(batch);
          match.step();
          onEvents(match.drain());
        });
        if (match.over) onEvents(match.drain());
      },

      render(g) {
        const ui = ctx.ui;
        const f = clock.frame;
        const bg = g.createLinearGradient(0, 0, 0, 540);
        bg.addColorStop(0, "#16202f");
        bg.addColorStop(1, "#0c131d");
        g.fillStyle = bg;
        g.fillRect(0, 0, 960, 540);

        // ---- the arena: floor, goal slot, walls -------------------------------------------------------------------------------
        const poly = () => {
          g.beginPath();
          g.moveTo(fx(X0 - RADIUS), fy(Y0 - RADIUS));
          g.lineTo(fx(X1 + RADIUS), fy(Y0 - RADIUS));
          g.lineTo(fx(X1 + RADIUS), fy(Y1 + RADIUS));
          g.lineTo(fx(SLOT_X1 + RADIUS), fy(Y1 + RADIUS));
          g.lineTo(fx(SLOT_X1 + RADIUS), fy(SLOT_Y + RADIUS));
          g.lineTo(fx(SLOT_X0 - RADIUS), fy(SLOT_Y + RADIUS));
          g.lineTo(fx(SLOT_X0 - RADIUS), fy(Y1 + RADIUS));
          g.lineTo(fx(X0 - RADIUS), fy(Y1 + RADIUS));
          g.closePath();
        };
        g.save();
        poly();
        g.clip();
        for (let r = -1; r < 10; r++) {
          for (let c = -1; c < 8; c++) {
            g.fillStyle = (r + c) & 1 ? "#4f8a4a" : "#5a9753";
            g.fillRect(fx(X0 - RADIUS + c * 30), fy(Y0 - RADIUS + r * 30), 30 * K + 1, 30 * K + 1);
          }
        }
        // the goal slot
        const sl = g.createLinearGradient(0, fy(Y1), 0, fy(SLOT_Y + RADIUS));
        sl.addColorStop(0, "#3d5f7d");
        sl.addColorStop(1, "#2a435c");
        g.fillStyle = sl;
        g.fillRect(fx(SLOT_X0 - RADIUS), fy(Y1 + RADIUS), (SLOT_X1 - SLOT_X0 + 2 * RADIUS) * K, (SLOT_Y - Y1) * K + 1);
        g.strokeStyle = "rgba(255,255,255,.12)";
        g.lineWidth = 2;
        for (let s = 0; s < 8; s++) {
          g.beginPath();
          g.moveTo(fx(SLOT_X0 - RADIUS + s * 16), fy(Y1 + RADIUS));
          g.lineTo(fx(SLOT_X0 - RADIUS + s * 16 - 12), fy(SLOT_Y + RADIUS));
          g.stroke();
        }
        g.restore();
        for (let t = 0; t < 4; t++) {
          const s = startOf(t);
          g.strokeStyle = ctx.teams[t].color;
          g.lineWidth = 2.5;
          g.globalAlpha = 0.65;
          g.beginPath();
          g.ellipse(fx(s.x), fy(s.y + 4), RADIUS * K * 1.15, RADIUS * K * 0.55, 0, 0, Math.PI * 2);
          g.stroke();
          g.globalAlpha = 1;
        }
        poly();
        g.lineWidth = 10;
        g.strokeStyle = "#2b3342";
        g.lineJoin = "round";
        g.stroke();
        poly();
        g.lineWidth = 2;
        g.strokeStyle = "rgba(255,255,255,.25)";
        g.stroke();
        ui.text(g, ctx.t("META", "GOAL"), fx(256), fy(Y1 + 18), { size: 15, align: "center", color: "#cfe3f5", stroke: null, alpha: 0.85 });

        // a person carrying flags: the goal pulses
        const me = humanTeam >= 0 ? match.players[humanTeam] : null;
        if (me && me.pennants > 0 && me.mode === "play") {
          const pulse = 0.5 + 0.5 * Math.sin(f / 4);
          g.strokeStyle = `rgba(255,226,154,${0.35 + 0.4 * pulse})`;
          g.lineWidth = 3;
          g.strokeRect(fx(SLOT_X0 - RADIUS) + 2, fy(Y1 + RADIUS) + 2, (SLOT_X1 - SLOT_X0 + 2 * RADIUS) * K - 4, (SLOT_Y - Y1) * K - 4);
        }

        // ---- floor decoration, obstacles, flags --------------------------------------------------------------------------------
        for (const it of match.items) {
          const x = fx(it.x);
          const y = fy(it.y);
          for (let k = 0; k < 5; k++) {
            const a = (k / 5) * Math.PI * 2;
            g.fillStyle = k % 2 ? "#f6c6d8" : "#ffe9a8";
            g.beginPath();
            g.arc(x + Math.cos(a) * 5, y + Math.sin(a) * 4, 3.2, 0, Math.PI * 2);
            g.fill();
          }
          g.fillStyle = "#e0883a";
          g.beginPath();
          g.arc(x, y, 2.6, 0, Math.PI * 2);
          g.fill();
        }
        for (const r of match.rects) {
          const x = fx(r.cx - 16);
          const y = fy(r.cy - 16);
          const s = 32 * K;
          g.fillStyle = "rgba(0,0,0,.28)";
          g.fillRect(x + 3, y + 5, s, s);
          g.fillStyle = "#79808f";
          g.fillRect(x, y, s, s);
          g.fillStyle = "#9aa1b0";
          g.fillRect(x, y, s, s * 0.22);
          g.fillRect(x, y, s * 0.16, s);
          g.fillStyle = "#5a6070";
          g.fillRect(x, y + s * 0.84, s, s * 0.16);
          g.fillRect(x + s * 0.86, y, s * 0.14, s);
          g.strokeStyle = "rgba(40,44,56,.7)";
          g.lineWidth = 1.5;
          g.strokeRect(x, y, s, s);
          g.beginPath();
          g.moveTo(x + s * 0.3, y + s * 0.45);
          g.lineTo(x + s * 0.5, y + s * 0.6);
          g.lineTo(x + s * 0.44, y + s * 0.8);
          g.stroke();
        }
        for (const pn of match.pennants) {
          const age = Math.min(1, (f - pn.born) / 10);
          const s = 24 * K * (0.4 + 0.6 * age) * 0.9;
          g.fillStyle = "rgba(0,0,0,.28)";
          g.beginPath();
          g.ellipse(fx(pn.x), fy(pn.y) + 3, 7, 3, 0, 0, Math.PI * 2);
          g.fill();
          flagShape(g, fx(pn.x) - 3, fy(pn.y) + 2, s, "#ffcf3f", f / 3 + pn.spot);
        }

        // ---- the Pokémon, back to front ---------------------------------------------------------------------------------------
        const order = [...match.players].sort((a, b) => a.y - b.y);
        for (const p of order) {
          const team = ctx.teams[p.team];
          const sink = p.mode === "out" || p.mode === "in" ? p.offset : 0;
          const alpha = p.mode === "play" || p.mode === "deposit" ? 1 : clamp(1 - sink / 150, 0, 1);
          if (alpha <= 0.02) continue;
          const x = fx(p.x);
          const y = fy(p.y + 6) + sink * 0.35;
          const row = ROW_OF(p.vx, p.vy, FACING_ROW[p.facing]);
          const flash = p.frozen > 0 && !p.knocked ? 0.35 : 0;
          if (p.human && p.mode === "play") {
            g.strokeStyle = team.color;
            g.lineWidth = 2;
            g.globalAlpha = 0.5 + 0.3 * Math.sin(f / 4);
            g.beginPath();
            g.ellipse(x, y, RADIUS * K * 2.0, RADIUS * K * 0.95, 0, 0, Math.PI * 2);
            g.stroke();
            g.globalAlpha = 1;
          }
          ui.mon(g, p.team, p.member, x, y, { row, k: SPRITE_K, alpha, flash, r: RADIUS * K * 1.1 });
          // flags it carries
          const n = p.pennants + p.pointsToAdd;
          if (n > 0) {
            const gapX = 9;
            const shown = Math.min(n, MAX_CARRY);
            const x0 = x - ((shown - 1) * gapX) / 2;
            for (let i = 0; i < shown; i++) flagShape(g, x0 + i * gapX - 3, y - 62 - (i % 2) * 3, 17, "#ffcf3f", f / 3 + i);
            ui.text(g, n, x + 26, y - 56, { size: 15, color: "#ffe29a" });
          }
          if (p.knocked) {
            for (let i = 0; i < 3; i++) {
              const a = f / 3 + (i * Math.PI * 2) / 3;
              ui.text(g, "*", x + Math.cos(a) * 16, y - 42 + Math.sin(a) * 5, { size: 20, color: "#ffe066", align: "center" });
            }
          }
          if (p.human && p.mode === "play") {
            const bob = Math.sin(f / 5) * 2;
            g.fillStyle = team.color;
            g.beginPath();
            g.moveTo(x - 7, y - 82 + bob);
            g.lineTo(x + 7, y - 82 + bob);
            g.lineTo(x, y - 72 + bob);
            g.closePath();
            g.fill();
          }
        }

        // ---- the person's aim -------------------------------------------------------------------------------------------------
        if (me && !match.over) {
          const par = match.params[humanTeam][me.member];
          const ax = fx(me.x);
          const ay = fy(me.y);
          const reach = (vx, vy) => {
            let vx2 = me.vx + vx;
            let vy2 = me.vy + vy;
            let s = Math.hypot(vx2, vy2);
            if (s > par.maxSpeed) { vx2 *= par.maxSpeed / s; vy2 *= par.maxSpeed / s; s = par.maxSpeed; }
            let d = 0;
            let sp = s;
            while (sp > 0) { d += sp; sp -= FRICTION; }
            return s > 0.01 ? { x: me.x + (vx2 / s) * d, y: me.y + (vy2 / s) * d } : { x: me.x, y: me.y };
          };
          const ghost = (pt) => {
            g.strokeStyle = "rgba(255,255,255,.6)";
            g.lineWidth = 2;
            g.setLineDash([6, 6]);
            g.beginPath();
            g.moveTo(ax, ay);
            g.lineTo(fx(pt.x), fy(pt.y));
            g.stroke();
            g.setLineDash([]);
            g.beginPath();
            g.arc(fx(pt.x), fy(pt.y), 8, 0, Math.PI * 2);
            g.stroke();
          };
          if (me.drag) {
            const px = ctx.input.pointer.x;
            const py = ctx.input.pointer.y;
            const sx0 = fx(me.drag.x);
            const sy0 = fy(me.drag.y);
            const slow = me.drag.hold > HOLD_MAX;
            g.strokeStyle = slow ? "#ff8a7a" : "#fff";
            g.lineWidth = 4;
            g.beginPath();
            g.moveTo(sx0, sy0);
            g.lineTo(px, py);
            g.stroke();
            // the time left to let go
            g.lineWidth = 5;
            g.strokeStyle = slow ? "#ff8a7a" : "#ffe29a";
            g.beginPath();
            g.arc(sx0, sy0, 15, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * clamp(1 - me.drag.hold / HOLD_MAX, 0, 1));
            g.stroke();
            if (!slow) ghost(reach(((px - sx0) / K) * par.gain, ((py - sy0) / K) * par.gain));
            else ui.text(g, ctx.t("¡Suelta ya!", "Let go!"), px, py - 18, { size: 20, align: "center", color: "#ffb4a8" });
          } else if (me.mode === "play" && !me.knocked && (charging || ctx.input.keys.size || ctx.input.pad.held.size)) {
            const len = charging ? KEY_MIN + (KEY_MAX - KEY_MIN) * Math.min(1, charge / KEY_CHARGE) : 48;
            ghost(reach(aim.x * len * par.gain, aim.y * len * par.gain));
          }
          if (flicked === 0 && me.mode === "play" && f < 240) {
            g.setLineDash([6, 8]);
            g.strokeStyle = "rgba(255,255,255,.3)";
            g.lineWidth = 2;
            g.beginPath();
            g.arc(ax, ay, TOUCH_RADIUS * K, 0, Math.PI * 2);
            g.stroke();
            g.setLineDash([]);
            ui.text(g, ctx.t("Arrastra desde aquí y suelta", "Drag from here and let go"), ax, ay - TOUCH_RADIUS * K - 8, { size: 16, align: "center", color: "#fff", alpha: 0.85 });
          }
        }
        ui.pops(g, pops, { life: 0.9, rise: 36, size: 22 });

        // ---- the left panel: the four teams -------------------------------------------------------------------------------------
        for (let t = 0; t < 4; t++) {
          const team = ctx.teams[t];
          const p = match.players[t];
          const y = 14 + t * 104;
          ui.panel(g, 14, y, 270, 96, { fill: `rgba(10,16,28,${team.human ? 0.78 : 0.6})`, stroke: team.color, lw: team.human ? 3 : 1.5 });
          const name = team.name.length > 17 ? `${team.name.slice(0, 16)}…` : team.name;
          ui.text(g, name, 26, y + 24, { size: 16, color: "#eef3ff", stroke: null });
          ui.text(g, match.scoreOf(t), 270, y + 40, { size: 38, align: "right" });
          for (let s = 0; s < 3; s++) {
            const on = p.member === s;
            ui.icon(g, t, s, 26 + s * 42, y + 38, 34, { ring: on ? team.color : null, alpha: on ? 1 : 0.5 });
          }
          const carry = p.pennants + p.pointsToAdd;
          for (let i = 0; i < MAX_CARRY; i++) {
            g.fillStyle = i < carry ? "#ffcf3f" : "rgba(255,255,255,.14)";
            g.fillRect(26 + i * 15, y + 82, 11, 5);
          }
          ui.text(g, `${p.score} ${ctx.t("entregadas", "delivered")}`, 26 + 9 * 15 + 6, y + 88, { size: 11, color: "#aeb9cc", stroke: null, weight: 600 });
        }

        // ---- the right panel: clock, goal, active Pokémon, events ------------------------------------------------------------------
        const left = Math.max(0, TOTAL_FRAMES - match.frame) / 30;
        ui.panel(g, 676, 14, 270, 78, { r: 14 });
        ui.text(g, ctx.t("TIEMPO", "TIME"), 811, 34, { size: 11, align: "center", color: "#a9b4c8", stroke: null, weight: 600 });
        ui.text(g, ui.fmtClock(left), 811, 80, { size: 44, align: "center", color: left <= 10 ? "#ffd166" : "#fff" });
        const mineIdx = humanTeam >= 0 ? humanTeam : 0;
        ui.panel(g, 676, 100, 270, 70);
        ui.text(g, ctx.t(`Objetivo: ${TARGET_SCORE} banderas`, `Goal: ${TARGET_SCORE} flags`), 690, 124, { size: 13, color: "#cfd8ea", stroke: null });
        ui.bar(g, 690, 134, 242, 14, match.scoreOf(mineIdx) / TARGET_SCORE, ctx.teams[mineIdx].color);
        ui.text(g, `${match.scoreOf(mineIdx)}`, 932, 162, { size: 13, align: "right", color: "#eef3ff", stroke: null });
        const act = match.players[mineIdx];
        const mon = ctx.teams[mineIdx].mons[act.member];
        ui.panel(g, 676, 178, 270, 112);
        ui.icon(g, mineIdx, act.member, 688, 188, 44, { ring: true });
        ui.text(g, mon.name, 742, 208, { size: 16, color: "#eef3ff", stroke: null });
        const carried = act.pennants + act.pointsToAdd;
        ui.text(g, carried > 0 ? ctx.t(`Lleva ${carried} / ${MAX_CARRY}`, `Carrying ${carried} / ${MAX_CARRY}`) : ctx.t("Sin banderas", "No flags"), 742, 228, { size: 13, color: "#ffe29a", stroke: null });
        const par = match.params[mineIdx][act.member];
        const chips = [
          [ctx.t("Vel. máx.", "Top speed"), par.maxSpeed.toFixed(0)],
          [ctx.t("Lanzamiento", "Fling"), `x${(par.gain * 8).toFixed(2)}`],
          [ctx.t("Empuje", "Shove"), `x${par.knockback.toFixed(1)}`],
          [ctx.t("Caída", "Down"), `${(par.downTime / 30).toFixed(1)} s`],
        ];
        chips.forEach(([k, v], i) => {
          const cx = 688 + (i % 2) * 128;
          const cy = 256 + Math.floor(i / 2) * 18;
          ui.text(g, k, cx, cy, { size: 11, color: "#8d99b0", stroke: null, weight: 600 });
          ui.text(g, v, cx + 118, cy, { size: 12, align: "right", color: "#eef3ff", stroke: null });
        });
        ui.panel(g, 676, 298, 270, 160, { fill: "rgba(10,16,28,.5)" });
        ui.text(g, ctx.t("Jugadas", "Plays"), 690, 320, { size: 12, color: "#8d99b0", stroke: null, weight: 600 });
        feed.forEach((fe, i) => {
          const al = clamp(1 - Math.max(0, fe.age - 5) / 2, 0, 1);
          g.fillStyle = fe.color;
          g.globalAlpha = al;
          g.fillRect(688, 332 + i * 20, 4, 14);
          g.globalAlpha = 1;
          ui.text(g, fe.text.length > 34 ? `${fe.text.slice(0, 33)}…` : fe.text, 698, 344 + i * 20, { size: 12.5, color: "#e3e9f6", stroke: null, alpha: al, weight: 600 });
        });
        ui.panel(g, 676, 466, 270, 60, { fill: "rgba(10,16,28,.45)" });
        ui.text(g, ctx.t("Arrastra y suelta · flechas + Espacio", "Drag and let go · arrows + Space"), 811, 490, { size: 12, align: "center", color: "#aeb9cc", stroke: null, weight: 600 });
        ui.text(g, ctx.t("Embiste por la espalda para derribar", "Ram from behind to knock down"), 811, 510, { size: 12, align: "center", color: "#aeb9cc", stroke: null, weight: 600 });

        // below the cards: how fast it is going
        ui.panel(g, 14, 432, 270, 94, { fill: "rgba(10,16,28,.5)" });
        ui.text(g, ctx.t("Tu velocidad", "Your speed"), 26, 454, { size: 12, color: "#8d99b0", stroke: null, weight: 600 });
        const sp = Math.hypot(act.vx, act.vy);
        ui.bar(g, 26, 462, 246, 12, sp / MAX_SPEED[4], sp > 9 ? "#ffd166" : "#7ee081");
        const status = act.knocked ? ctx.t("¡Derribado! Espera a levantarte", "Knocked down! Wait to get up")
          : act.mode === "deposit" ? ctx.t("Entregando…", "Delivering…")
            : act.mode !== "play" ? ctx.t("Cambio de Pokémon…", "Switching Pokémon…")
              : act.frozen > 0 ? ctx.t("Aturdido un instante", "Stunned for a moment")
                : ctx.t("Listo para lanzar", "Ready to fling");
        ui.text(g, status, 26, 500, { size: 14, color: act.knocked ? "#ff9d8e" : "#eef3ff", stroke: null });

        if (match.over) ui.banner(g, ctx.t("¡Fin!", "Time!"), ctx.t(`${match.scoreOf(mineIdx)} banderas`, `${match.scoreOf(mineIdx)} flags`), 220);
      },

      destroy() {},
    };
  },
};
