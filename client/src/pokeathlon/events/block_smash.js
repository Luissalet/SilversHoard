// Block Smash (Rompelosas): a stack of ten blocks per team; tap the top one to break it, hit its small weak spot for a big blow and a
// charged gauge, and swap your tired Pokémon before it runs out of energy. 30 seconds, the most blocks wins. The rules and the CPU
// teams are in block_smash/sim.js; this file reads the input, plays the sounds and draws the stack in big (the original's was tiny).
import { Clock, Latch, clamp } from "./_kit/index.js";
import {
  Match, STACK, BLOCK_X, BASE_Y, TOUCH_OFFSETS, SPOT_BOXES, TOTAL_FRAMES, TARGET_SCORE, READY, HIT, EXHAUSTED, SWITCHING, NEW_STACK,
} from "./block_smash/sim.js";

const S = 6; // screen pixels per DS pixel
const CX = 470;
const CY = 404;
const sx = (dx) => CX + (dx - BLOCK_X) * S;
const sy = (dy) => CY + (dy - BASE_Y) * S;
const dsx = (x) => BLOCK_X + (x - CX) / S;
const dsy = (y) => BASE_Y + (y - CY) / S;
const SWITCH_BTN = { x: 700, y: 452, w: 236, h: 56 };
const SWIPE_PX = 100;
const RETICLE_SPEED = 2;
const TAP_KEYS = ["Space", "Enter", "NumpadEnter"];
const SWITCH_KEYS = ["Tab", "ShiftLeft", "ShiftRight", "KeyQ", "KeyE", "KeyC"];
const TAP_PAD = [0];
const SWITCH_PAD = [1, 4, 5];
const MOVE_KEYS = { left: ["ArrowLeft", "KeyA"], right: ["ArrowRight", "KeyD"], up: ["ArrowUp", "KeyW"], down: ["ArrowDown", "KeyS"] };
const PAD_DIR = { 12: [0, -1], 13: [0, 1], 14: [-1, 0], 15: [1, 0] };
const TONES = ["#d9a066", "#c98f4f", "#e3b278", "#bf8444", "#d39a5a"];

const mkLcg = (seed) => {
  let a = seed >>> 0;
  return () => { a = (Math.imul(a, 1664525) + 1013904223) >>> 0; return a / 4294967296; };
};

export default {
  id: "block_smash",
  names: { es: "Rompelosas", en: "Block Smash" },
  stats: ["power", "stamina", "skill"],
  seconds: 30,
  help: {
    es: "Toca el bloque de arriba lo más rápido que puedas: cada golpe le quita al bloque la fuerza de tu Pokémon. Si aciertas en su pequeño punto débil pegas mucho más y llenas el medidor, que da golpes fuertes durante unos segundos. Golpear a ráfagas gasta energía: cambia de Pokémon con el botón, Tab, clic derecho, la rueda o deslizando hacia arriba antes de que se canse. Con teclado o mando: flechas o stick mueven la mira, Espacio o A golpea, Tab o B cambia de Pokémon.",
    en: "Tap the top block as fast as you can: each hit takes your Pokémon's power off the block. Hitting its small weak spot does far more damage and charges the gauge, which gives strong hits for a few seconds. Hitting in bursts drains energy: swap Pokémon with the button, Tab, right click, the wheel or an upward swipe before it tires out. With keyboard or gamepad: arrows or stick move the aim, Space or A hits, Tab or B swaps Pokémon.",
  },

  create(ctx) {
    const focus = ctx.focus;
    const humans = ctx.humans();
    const humanTeam = humans.includes(focus) ? focus : -1;   // the person at this screen (-1: a spectator, or nobody plays)
    const match = new Match({ teams: ctx.teams, rng: ctx.rng, humanTeams: humans });
    const clock = new Clock();
    const lcg = mkLcg(0x9e3779b1 ^ (ctx.seed || 1));
    const pops = [];
    const bits = [];
    const ripples = [];
    let shake = 0;
    let flash = 0;
    let endTimer = 0;
    let finished = false;
    let prevMember = 0;

    const topY = (side) => BASE_Y - 4 * Math.max(0, side.board.count - 1);

    // what each person is doing: swipes, pointer, keyboard reticle (a room with friends has one per person)
    const makeCtl = (team) => {
      const input = ctx.inputs[team];
      const mine = team === focus;
      const c = { team, latch: new Latch(), swipe: null, ptrActive: false, kb: false, reticle: { x: BLOCK_X + 4, y: BASE_Y - 4 * (STACK - 1) - 3 } };
      const doTap = (x, y) => !!match.sides[team].tap(x, y, 1);

      c.apply = (batch) => {
        const human = match.sides[team];
        // pointer: the first press of the step is the tap (one touch per frame, as on the DS); swipes up switch Pokémon
        let tapped = false;
        let pi = 0;
        let ri = 0;
        while (pi < batch.presses.length || ri < batch.releases.length) {
          if (c.ptrActive) {
            if (ri >= batch.releases.length) break;
            const r = batch.releases[ri++];
            c.ptrActive = false;
            if (c.swipe && clock.frame - c.swipe.f <= 9 && c.swipe.y - r.y >= SWIPE_PX) human.switchNow();
            c.swipe = null;
          } else if (pi < batch.presses.length) {
            const d = batch.presses[pi++];
            c.ptrActive = true;
            c.kb = false;
            if (mine) ripples.push({ x: d.x, y: d.y, age: 0 });
            const inBtn = d.x >= SWITCH_BTN.x && d.x < SWITCH_BTN.x + SWITCH_BTN.w && d.y >= SWITCH_BTN.y && d.y < SWITCH_BTN.y + SWITCH_BTN.h;
            if (inBtn) { human.switchNow(); c.swipe = null; }
            else {
              if (!tapped) tapped = doTap(dsx(d.x), dsy(d.y)) || tapped;
              c.swipe = d.x > 250 && d.x < 700 ? { y: d.y, f: clock.frame } : null;
            }
          } else ri++;
        }
        if (c.swipe && clock.frame - c.swipe.f >= 10) c.swipe = null;
        if (batch.right || batch.wheel) human.switchNow();
        // keyboard and pad: a reticle over the block, one key to hit, one to swap
        const keys = input.keys;
        const pad = input.pad;
        let mx = 0;
        let my = 0;
        if (MOVE_KEYS.left.some((k) => keys.has(k))) mx -= 1;
        if (MOVE_KEYS.right.some((k) => keys.has(k))) mx += 1;
        if (MOVE_KEYS.up.some((k) => keys.has(k))) my -= 1;
        if (MOVE_KEYS.down.some((k) => keys.has(k))) my += 1;
        if (Math.hypot(pad.lx, pad.ly) > 0.3) { mx += pad.lx; my += pad.ly; }
        if (Math.hypot(pad.rx, pad.ry) > 0.3) { mx += pad.rx; my += pad.ry; }
        for (const b of pad.held) if (PAD_DIR[b]) { mx += PAD_DIR[b][0]; my += PAD_DIR[b][1]; }
        const l = Math.hypot(mx, my);
        const keyedHit = TAP_KEYS.some((k) => batch.keys.has(k)) || TAP_PAD.some((b) => batch.pad.has(b));
        const keyedSwitch = SWITCH_KEYS.some((k) => batch.keys.has(k)) || SWITCH_PAD.some((b) => batch.pad.has(b));
        if (l > 0.05 || keyedHit || keyedSwitch) c.kb = true;
        if (l > 0.05) {
          const f = RETICLE_SPEED / Math.max(1, l);
          c.reticle = { x: clamp(c.reticle.x + mx * f, BLOCK_X - 34, BLOCK_X + 34), y: clamp(c.reticle.y + my * f, topY(human) - 20, topY(human) + 14) };
        }
        if (keyedSwitch) human.switchNow();
        if (keyedHit && !tapped) { doTap(c.reticle.x, c.reticle.y); if (mine) ripples.push({ x: sx(c.reticle.x), y: sy(c.reticle.y), age: 0 }); }
      };
      return c;
    };
    const ctls = new Map(humans.map((t) => [t, makeCtl(t)]));
    const NOBODY = { kb: false, reticle: { x: BLOCK_X + 4, y: BASE_Y - 4 * (STACK - 1) - 3 } };
    const fc = () => ctls.get(humanTeam) || NOBODY;
    const human = humanTeam >= 0 ? match.sides[humanTeam] : null;

    const onEvents = (list) => {
      for (const e of list) {
        const mine = e.team === focus;
        if (!mine) continue;
        if (e.type === "hit") {
          const p = { x: sx(BLOCK_X) + (lcg() - 0.5) * 60, y: sy(topY(match.sides[focus]) - 8) - 30, age: 0 };
          if (e.spot || e.strong) {
            ctx.sfx(e.broken ? "break" : "score");
            pops.push({ ...p, text: `-${e.power}`, color: e.strong ? "#ffd166" : "#ff8a5c", size: 34, life: 1.0 });
            if (e.spot && !e.strong) pops.push({ x: p.x, y: p.y - 34, text: ctx.t("¡Punto débil!", "Weak spot!"), color: "#fff", size: 18, age: 0, life: 0.9 });
          } else {
            ctx.sfx(e.broken ? "break" : "hit");
            pops.push({ ...p, text: `-${e.power}`, color: "#fff", size: 24, life: 0.8 });
          }
          if (e.broken) {
            shake = 6;
            const n = 8 * e.broken;
            for (let i = 0; i < n; i++) bits.push({ x: sx(BLOCK_X), y: sy(topY(match.sides[focus])) , vx: (lcg() - 0.5) * 16, vy: -4 - lcg() * 9, r: 4 + lcg() * 8, rot: lcg() * 6, vr: (lcg() - 0.5) * 0.4, c: TONES[i % TONES.length], age: 0 });
            pops.push({ x: sx(BLOCK_X) + 150, y: sy(topY(match.sides[focus])) - 40, text: `+${e.broken}`, color: "#8ff0a4", size: 34, age: 0, life: 0.9 });
          }
          if (human && !e.exhausted) {
            const a = ctx.animator(focus, match.sides[focus].member);
            if (a.has("Attack")) a.play("Attack");
          }
        } else if (e.type === "exhaust") {
          ctx.sfx("crash");
          pops.push({ x: 818, y: 150, text: ctx.t("¡Agotado!", "Worn out!"), color: "#ff9d8e", size: 28, age: 0, life: 1.1 });
        } else if (e.type === "full") {
          ctx.sfx("cheer");
          flash = 8;
          pops.push({ x: sx(BLOCK_X), y: 100, text: ctx.t("¡Golpes fuertes!", "Strong hits!"), color: "#ffd166", size: 36, age: 0, life: 1.3 });
        } else if (e.type === "switch") {
          ctx.sfx("throw");
        }
      }
    };

    const quad = (g, x, y, tone, health, top) => {
      const pts = TOUCH_OFFSETS.map(([ox, oy]) => [x + ox * S, y + oy * S]);
      g.beginPath();
      g.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < 4; i++) g.lineTo(pts[i][0], pts[i][1]);
      g.closePath();
      g.fillStyle = tone;
      g.fill();
      g.lineWidth = 3;
      g.strokeStyle = "#5a3b1c";
      g.lineJoin = "round";
      g.stroke();
      // highlight along the upper-left edge
      g.beginPath();
      g.moveTo(pts[0][0] + 6, pts[0][1] - 6);
      g.lineTo(pts[1][0] + 5, pts[1][1] + 6);
      g.lineTo(pts[2][0] - 8, pts[2][1] + 6);
      g.strokeStyle = "rgba(255,255,255,.35)";
      g.lineWidth = 3;
      g.stroke();
      if (top && health <= 60) {
        g.strokeStyle = "rgba(60,36,16,.8)";
        g.lineWidth = 3;
        g.beginPath();
        g.moveTo(x - 6 * S, y - 18 * S + 6);
        g.lineTo(x - 2 * S, y - 8 * S);
        g.lineTo(x - 5 * S, y - 1 * S);
        g.lineTo(x + 1 * S, y + 7 * S);
        g.stroke();
        if (health <= 20) {
          g.beginPath();
          g.moveTo(x + 10 * S, y - 18 * S + 6);
          g.lineTo(x + 6 * S, y - 7 * S);
          g.lineTo(x + 12 * S, y + 2 * S);
          g.moveTo(x - 2 * S, y - 8 * S);
          g.lineTo(x + 5 * S, y - 6 * S);
          g.stroke();
        }
      }
    };

    return {
      update(dt) {
        for (const c of ctls.values()) c.latch.absorb(ctx.inputs[c.team]);
        const side = match.sides[focus];
        for (let m = 0; m < 3; m++) {
          const a = ctx.animator(focus, m);
          if (!a.busy()) {
            const st = side.members[m].st / side.members[m].max;
            a.loop("Idle", m === side.member && st <= 0.4 ? 0.6 : 1);
          }
          a.update(dt);
        }
        for (const p of pops) p.age += dt;
        while (pops.length && pops[0].age > (pops[0].life || 0.9)) pops.shift();
        for (const b of bits) { b.age += dt; b.x += b.vx; b.y += b.vy; b.vy += 0.7; b.rot += b.vr; }
        while (bits.length && bits[0].age > 0.9) bits.shift();
        for (const r of ripples) r.age += dt;
        while (ripples.length && ripples[0].age > 0.35) ripples.shift();
        if (shake > 0) shake -= dt * 30;
        if (flash > 0) flash -= dt * 30;
        if (match.over) {
          for (const c of ctls.values()) c.latch.take();
          endTimer += dt;
          if (endTimer >= 1.8 && !finished) { finished = true; ctx.finish(match.result()); }
          return;
        }
        clock.advance(dt, () => {
          const batches = [...ctls.values()].map((c) => [c, c.latch.take()]);
          const before = side.member;
          match.step(batches.length ? () => { for (const [c, batch] of batches) c.apply(batch); } : null);
          if (side.member !== before) prevMember = before;
          onEvents(match.drain());
        });
        if (match.over) onEvents(match.drain());
      },

      /** A person left a room: the CPU plays their team from here on. */
      takeOver(team) { ctls.delete(team); match.takeOver(team); },

      render(g) {
        const ui = ctx.ui;
        const f = clock.frame;
        const side = match.sides[focus];
        const bg = g.createLinearGradient(0, 0, 0, 540);
        bg.addColorStop(0, "#1d2740");
        bg.addColorStop(1, "#0d131f");
        g.fillStyle = bg;
        g.fillRect(0, 0, 960, 540);
        if (flash > 0) { g.fillStyle = `rgba(255,214,102,${0.18 * (flash / 8)})`; g.fillRect(0, 0, 960, 540); }
        // floor
        g.fillStyle = "#2a3550";
        g.beginPath();
        g.ellipse(CX + 10, CY + 86, 250, 62, 0, 0, Math.PI * 2);
        g.fill();
        g.strokeStyle = "rgba(255,255,255,.1)";
        g.lineWidth = 2;
        g.stroke();

        // ---- the stack ----------------------------------------------------------------------------------------------------------
        const b = side.board;
        g.save();
        if (shake > 0) g.translate((Math.sin(f * 7) * shake) * 0.8, 0);
        for (let i = 0; i < STACK; i++) {
          const alive = b.state === "ready" ? i < b.count : b.state === "dropping" && b.landed[i] ? true : b.state === "dropping" && b.t >= 3 * i;
          if (!alive) continue;
          const y = b.state === "dropping" ? b.y[i] : BASE_Y - 4 * i;
          const isTop = b.state === "ready" && i === b.count - 1;
          quad(g, sx(BLOCK_X), sy(y), TONES[i % TONES.length], b.health[i] ?? 100, isTop);
          if (isTop && side.gaugeFull) {
            g.save();
            g.globalAlpha = 0.35 + 0.25 * Math.sin(f / 2);
            g.fillStyle = "#ffd166";
            g.beginPath();
            const pts = TOUCH_OFFSETS.map(([ox, oy]) => [sx(BLOCK_X) + ox * S, sy(y) + oy * S]);
            g.moveTo(pts[0][0], pts[0][1]);
            for (let k = 1; k < 4; k++) g.lineTo(pts[k][0], pts[k][1]);
            g.closePath();
            g.fill();
            g.restore();
          }
        }
        // the weak spot of the top block
        const sp = b.state === "ready" ? b.spotPos() : null;
        if (sp) {
          const kind = side.cur.kind;
          const pulse = 0.55 + 0.45 * Math.sin(f / 3);
          g.save();
          g.fillStyle = `rgba(255,70,70,${0.55 + 0.3 * pulse})`;
          g.strokeStyle = "#fff";
          g.lineWidth = 2;
          for (const [l, t, r, bt] of SPOT_BOXES[kind]) {
            g.fillRect(sx(sp.x + l), sy(sp.y + t), (r - l) * S, (bt - t) * S);
          }
          g.beginPath();
          g.arc(sx(sp.x), sy(sp.y), 5, 0, Math.PI * 2);
          g.fillStyle = "#fff";
          g.fill();
          for (const [l, t, r, bt] of SPOT_BOXES[kind]) g.strokeRect(sx(sp.x + l), sy(sp.y + t), (r - l) * S, (bt - t) * S);
          g.restore();
        }
        g.restore();
        for (const bt of bits) {
          g.save();
          g.globalAlpha = clamp(1 - bt.age / 0.9, 0, 1);
          g.translate(bt.x, bt.y);
          g.rotate(bt.rot);
          g.fillStyle = bt.c;
          g.fillRect(-bt.r / 2, -bt.r / 2, bt.r, bt.r);
          g.restore();
        }
        if (b.state === "dropping" && b.count === 0 && b.t < 0) ui.text(g, ctx.t("¡Otra pila!", "New stack!"), CX, 260, { size: 34, align: "center", color: "#8ff0a4", alpha: 0.9 });
        // a reticle when playing with keys or the pad
        if (fc().kb && human && b.hittable) {
          const x = sx(fc().reticle.x);
          const y = sy(fc().reticle.y);
          g.strokeStyle = "#fff";
          g.lineWidth = 3;
          g.beginPath();
          g.arc(x, y, 14, 0, Math.PI * 2);
          g.moveTo(x - 22, y); g.lineTo(x - 8, y);
          g.moveTo(x + 8, y); g.lineTo(x + 22, y);
          g.moveTo(x, y - 22); g.lineTo(x, y - 8);
          g.moveTo(x, y + 8); g.lineTo(x, y + 22);
          g.stroke();
        }
        for (const r of ripples) {
          g.strokeStyle = `rgba(255,255,255,${0.7 * (1 - r.age / 0.35)})`;
          g.lineWidth = 3;
          g.beginPath();
          g.arc(r.x, r.y, 6 + r.age * 70, 0, Math.PI * 2);
          g.stroke();
        }
        ui.pops(g, pops, { life: 0.9, rise: 44, size: 26 });

        // ---- top: clock and score ---------------------------------------------------------------------------------------------------
        const left = Math.max(0, TOTAL_FRAMES - match.frame) / 30;
        ui.clock(g, left, CX, 8, { label: ctx.t("TIEMPO", "TIME"), warn: 5 });
        ui.text(g, side.score, 300, 56, { size: 48, align: "center" });
        ui.text(g, ctx.t("BLOQUES", "BLOCKS"), 300, 18, { size: 11, align: "center", color: "#a9b4c8", stroke: null, weight: 600 });
        ui.text(g, ctx.t(`Objetivo ${TARGET_SCORE}`, `Goal ${TARGET_SCORE}`), 640, 50, { size: 15, align: "center", color: "#cfd8ea", stroke: null });

        // ---- left: the other teams ----------------------------------------------------------------------------------------------
        let row = 0;
        for (let t = 0; t < 4; t++) {
          if (t === focus) continue;
          const s = match.sides[t];
          const team = ctx.teams[t];
          const y = 14 + row * 170;
          row++;
          ui.panel(g, 14, y, 244, 160, { fill: "rgba(10,16,28,.6)", stroke: team.color });
          const nm = team.name.length > 17 ? `${team.name.slice(0, 16)}…` : team.name;
          ui.text(g, nm, 26, y + 24, { size: 15, color: "#eef3ff", stroke: null });
          ui.text(g, s.score, 246, y + 56, { size: 40, align: "right" });
          // twenty bars: one per five blocks
          for (let i = 0; i < 20; i++) {
            g.fillStyle = s.score >= (i + 1) * 5 ? team.color : "rgba(255,255,255,.14)";
            g.fillRect(26 + i * 10.6, y + 72, 8, 12);
          }
          g.fillStyle = "rgba(255,255,255,.5)";
          g.fillRect(26 + (TARGET_SCORE / 5) * 10.6 - 2, y + 68, 2, 20);
          ui.icon(g, t, s.member, 26, y + 96, 44, { ring: team.color });
          ui.bar(g, 78, y + 104, 160, 8, s.cur.st / s.cur.max, s.mode === EXHAUSTED ? "#ff8a7a" : "#7ee081");
          ui.bar(g, 78, y + 120, 160, 6, s.gaugeFull ? 1 : s.gauge / 100, s.gaugeFull ? "#ffd166" : "#6aa8ff");
          const status = s.mode === EXHAUSTED ? ctx.t("agotado", "worn out") : s.mode === SWITCHING ? ctx.t("cambiando", "swapping") : s.mode === NEW_STACK ? ctx.t("nueva pila", "new stack") : s.gaugeFull ? ctx.t("golpes fuertes", "strong hits") : "";
          ui.text(g, status, 78, y + 148, { size: 12, color: s.mode === EXHAUSTED ? "#ff9d8e" : "#ffd166", stroke: null, weight: 600 });
        }

        // ---- right: the active Pokémon ----------------------------------------------------------------------------------------------
        ui.panel(g, 690, 14, 256, 300, { fill: "rgba(10,16,28,.6)", stroke: ctx.teams[focus].color });
        const cur = side.cur;
        const mon = ctx.teams[focus].mons[side.member];
        ui.text(g, mon.name, 706, 40, { size: 18, color: "#eef3ff", stroke: null });
        const swapping = side.mode === SWITCHING;
        const mt = swapping ? side.modeFrames : 0;
        const showMember = swapping && mt < 13 ? prevMember : side.member;
        const alpha = swapping ? (mt < 13 ? 1 - mt / 13 : (mt - 13) / 13) : 1;
        g.save();
        g.globalAlpha = clamp(alpha, 0, 1);
        ui.mon(g, focus, showMember, 818, 232, { row: 6, k: 4, r: 40, alpha: clamp(alpha, 0.05, 1) });
        g.restore();
        ui.text(g, ctx.t("Energía", "Energy"), 706, 262, { size: 12, color: "#8d99b0", stroke: null, weight: 600 });
        ui.text(g, `${cur.st}/${cur.max}`, 930, 262, { size: 12, align: "right", color: "#eef3ff", stroke: null, weight: 600 });
        ui.bar(g, 706, 268, 224, 10, cur.st / cur.max, side.mode === EXHAUSTED ? "#ff8a7a" : cur.st / cur.max <= 0.4 ? "#ffd166" : "#7ee081");
        ui.text(g, side.gaugeFull ? ctx.t("¡Golpes fuertes!", "Strong hits!") : ctx.t("Medidor", "Gauge"), 706, 296, { size: 12, color: side.gaugeFull ? "#ffd166" : "#8d99b0", stroke: null, weight: 600 });
        ui.bar(g, 706, 302, 224, 8, side.gaugeFull ? 1 - side.gaugeT / 90 : side.gauge / 100, side.gaugeFull ? "#ffd166" : "#6aa8ff");
        ui.text(g, ctx.t(`Daño ${cur.power}`, `Damage ${cur.power}`), 930, 40, { size: 13, align: "right", color: "#ffe29a", stroke: null });
        if (side.mode === EXHAUSTED) ui.text(g, ctx.t("¡Agotado!", "Worn out!"), 818, 120, { size: 24, align: "center", color: "#ff9d8e" });

        // the two waiting Pokémon
        ui.panel(g, 690, 322, 256, 120, { fill: "rgba(10,16,28,.5)" });
        ui.text(g, ctx.t("En el banquillo", "Waiting"), 706, 344, { size: 12, color: "#8d99b0", stroke: null, weight: 600 });
        for (let k = 1; k <= 2; k++) {
          const m = (side.member + k) % 3;
          const mm = side.members[m];
          const y = 350 + (k - 1) * 44;
          ui.icon(g, focus, m, 704, y, 36, { ring: k === 1 ? "rgba(255,255,255,.7)" : null });
          ui.bar(g, 750, y + 8, 160, 8, mm.st / mm.max, mm.st / mm.max <= 0.4 ? "#ffd166" : "#7ee081");
          ui.text(g, `${mm.st}/${mm.max}`, 910, y + 34, { size: 11, align: "right", color: "#aeb9cc", stroke: null, weight: 600 });
          if (k === 1) ui.text(g, ctx.t("el siguiente", "next"), 750, y + 34, { size: 11, color: "#aeb9cc", stroke: null, weight: 600 });
        }

        // the swap button
        const can = side.mode === READY || side.mode === HIT;
        ui.panel(g, SWITCH_BTN.x, SWITCH_BTN.y, SWITCH_BTN.w, SWITCH_BTN.h, { fill: can ? "rgba(70,130,220,.55)" : "rgba(60,70,90,.45)", stroke: can ? "#9cc4ff" : "rgba(255,255,255,.15)", lw: 2.5, r: 14 });
        ui.text(g, ctx.t("Cambiar de Pokémon", "Swap Pokémon"), SWITCH_BTN.x + SWITCH_BTN.w / 2, SWITCH_BTN.y + 26, { size: 18, align: "center", color: can ? "#fff" : "#8d99b0" });
        ui.text(g, ctx.t("Tab · clic derecho · rueda · deslizar arriba", "Tab · right click · wheel · swipe up"), SWITCH_BTN.x + SWITCH_BTN.w / 2, SWITCH_BTN.y + 46, { size: 11, align: "center", color: can ? "#cfe3ff" : "#6e7a90", stroke: null, weight: 600 });
        ui.text(g, ctx.t("Golpes rápidos cansan: 1 cada 10 fotogramas es gratis", "Fast taps tire it: one every 10 frames is free"), 480, 530, { size: 12, align: "center", color: "#8d99b0", stroke: null, weight: 600 });

        if (match.over) ui.banner(g, ctx.t("¡Tiempo!", "Time!"), ctx.t(`${side.score} bloques`, `${side.score} blocks`), 220);
      },

      destroy() {},
    };
  },
};
