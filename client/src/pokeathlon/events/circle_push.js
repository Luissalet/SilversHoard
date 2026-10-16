// Circle Push (Pisacírculos): twelve Pokémon on one ring. Drag yours with the pointer (they run after it), shove the rest and, at the end
// of each of six rounds, the ones standing in a coloured zone score its points. A Pokémon pushed out of the ring is out until the next
// round; pushing drains its energy. The rules and the CPU are in circle_push/sim.js; this file reads the input, plays the sounds and draws.
import { Clock, Latch, clamp } from "./_kit/index.js";
import { Match, RING, RADIUS, ROUNDS, TILES, LAYOUTS, TARGET_SCORE, ROUND_INTERVAL } from "./circle_push/sim.js";

const K = 2.75;
const OX = 172;
const OY = 72;
const sx = (x) => OX + (x - RING.x0) * K;
const sy = (y) => OY + (y - RING.y0) * K;
const gx = (x) => RING.x0 + (x - OX) / K;
const gy = (y) => RING.y0 + (y - OY) / K;

const ZONE_COLORS = { 1: "#4aa3ff", 2: "#47d18c", 3: "#ffd04a", 4: "#ff6b8a" };
const CURSOR_SPEED = 3.4;
const SELECT_KEYS = [["Digit1", "Numpad1"], ["Digit2", "Numpad2"], ["Digit3", "Numpad3"]];
const BURST_KEYS = ["Space", "Enter", "NumpadEnter"];
const BURST_PAD = [0, 1, 2, 3];
const CYCLE_KEYS = { prev: ["KeyQ"], next: ["KeyE"] };
const CYCLE_PAD = { prev: 4, next: 5 };
const PAD_DIR = { 12: [0, -1], 13: [0, 1], 14: [-1, 0], 15: [1, 0] };
const ARROWS = { left: ["ArrowLeft", "KeyA"], right: ["ArrowRight", "KeyD"], up: ["ArrowUp", "KeyW"], down: ["ArrowDown", "KeyS"] };

const rowOf = (face) => (((Math.round((-face + Math.PI / 2) / (Math.PI / 4)) % 8) + 8) % 8);

export default {
  id: "circle_push",
  names: { es: "Pisacírculos", en: "Circle Push" },
  stats: ["power", "stamina", "speed"],
  seconds: 80,
  help: {
    es: "Mantén pulsado sobre uno de tus Pokémon y arrastra: correrá hacia el puntero. Empuja a los rivales fuera del anillo, pero vigila la energía de empuje (la barrita de cada uno) y no te salgas tú. Al final de cada una de las 6 rondas puntúan los Pokémon que estén dentro de un círculo de color: los pequeños valen más. Tocar varias veces seguidas da pequeños impulsos. Con teclado o mando: 1, 2, 3 (o Q/E, L/R) eligen Pokémon, flechas o stick mueven el cursor y Espacio o A da un impulso.",
    en: "Press and hold one of your Pokémon and drag: it runs after the pointer. Shove the rivals off the ring, but watch the push energy (the little bar of each one) and do not fall off yourself. At the end of each of the 6 rounds the Pokémon standing inside a coloured circle score: the small ones are worth more. Tapping again and again gives small bursts. With keyboard or gamepad: 1, 2, 3 (or Q/E, L/R) choose a Pokémon, arrows or stick move the cursor and Space or A gives a burst.",
  },

  create(ctx) {
    const humans = ctx.humans();
    const focus = ctx.focus;
    const humanTeam = humans.includes(focus) ? focus : -1;   // the person at this screen (-1: a spectator, or nobody plays)
    const match = new Match({ teams: ctx.teams, rng: ctx.rng, humanTeams: humans });
    const clock = new Clock();
    const pops = [];
    const falls = [];
    let endTimer = 0;
    let finished = false;
    let pushSound = 0;
    let banner = null;

    const pushPop = (x, y, text, color, size = 24) => pops.push({ x: sx(x), y: sy(y) - 26, text, color, size, age: 0 });

    // what each person is doing: pointer, keyboard cursor and chosen Pokémon (a room with friends has one per person)
    const makeCtl = (team) => {
      const input = ctx.inputs[team];
      const mine = team === focus;
      const c = { team, latch: new Latch(), ptrActive: false, kb: false, sel: 0, cursor: { x: 128, y: 96 } };
      const mineStart = () => {
        const m = match.mon(team, c.sel);
        if (m) c.cursor = { x: m.x, y: m.y };
      };
      const selectMember = (i) => {
        c.sel = ((i % 3) + 3) % 3;
        mineStart();
      };
      const nextAlive = (dir) => {
        for (let k = 1; k <= 3; k++) {
          const i = (((c.sel + dir * k) % 3) + 3) % 3;
          if (match.mon(team, i).state === 1) return i;
        }
        return c.sel;
      };

      c.apply = (batch) => {
        // the pointer
        const ptr = input.pointer;
        let pi = 0;
        let ri = 0;
        while (pi < batch.presses.length || ri < batch.releases.length) {
          if (c.ptrActive) {
            if (ri >= batch.releases.length) break;
            const r = batch.releases[ri++];
            c.ptrActive = false;
            match.touchMove(team, gx(r.x), gy(r.y));
            match.touchUp(team);
          } else if (pi < batch.presses.length) {
            const d = batch.presses[pi++];
            c.kb = false;
            c.ptrActive = true;
            const got = match.touchDown(team, gx(d.x), gy(d.y));
            if (got >= 0) { c.sel = got; if (mine) ctx.sfx("hit"); }
          } else ri++;
        }
        if (c.ptrActive && ptr.down) match.touchMove(team, gx(ptr.x), gy(ptr.y));
        // the keyboard and the pad
        const keyed = batch.keys.size > 0 || batch.pad.size > 0;
        const keys = input.keys;
        const pad = input.pad;
        let mx = 0;
        let my = 0;
        if (ARROWS.left.some((k) => keys.has(k))) mx -= 1;
        if (ARROWS.right.some((k) => keys.has(k))) mx += 1;
        if (ARROWS.up.some((k) => keys.has(k))) my -= 1;
        if (ARROWS.down.some((k) => keys.has(k))) my += 1;
        if (Math.hypot(pad.lx, pad.ly) > 0.3) { mx += pad.lx; my += pad.ly; }
        for (const b of pad.held) if (PAD_DIR[b]) { mx += PAD_DIR[b][0]; my += PAD_DIR[b][1]; }
        if (keyed || mx || my) {
          if (!c.kb) { c.kb = true; mineStart(); }
        }
        if (!c.kb) return;
        let burst = false;
        for (let i = 0; i < 3; i++) if (SELECT_KEYS[i].some((k) => batch.keys.has(k))) selectMember(i);
        if (CYCLE_KEYS.next.some((k) => batch.keys.has(k)) || batch.pad.has(CYCLE_PAD.next)) selectMember(nextAlive(1));
        if (CYCLE_KEYS.prev.some((k) => batch.keys.has(k)) || batch.pad.has(CYCLE_PAD.prev)) selectMember(nextAlive(-1));
        if (BURST_KEYS.some((k) => batch.keys.has(k)) || BURST_PAD.some((b) => batch.pad.has(b))) burst = true;
        const l = Math.hypot(mx, my);
        if (l > 0.05) {
          const f = CURSOR_SPEED / Math.max(1, l);
          c.cursor = { x: clamp(c.cursor.x + mx * f, 0, 256), y: clamp(c.cursor.y + my * f, 0, 192) };
        }
        if (match.mon(team, c.sel).state !== 1 && match.playing()) selectMember(nextAlive(1));
        match.hold(team, c.sel, c.cursor.x, c.cursor.y);
        if (burst) match.burst(team);
      };
      return c;
    };
    const ctls = new Map(humans.map((t) => [t, makeCtl(t)]));
    const NOBODY = { kb: false, sel: 0, cursor: { x: 128, y: 96 } };
    const fc = () => ctls.get(humanTeam) || NOBODY;

    const onEvents = (list) => {
      for (const e of list) {
        const mine = e.team === humanTeam;
        if (e.type === "out") {
          falls.push({ x: e.x, y: e.y, team: e.team, member: e.member, age: 0 });
          ctx.sfx(mine ? "fall" : "crash");
          pushPop(e.x, e.y, mine ? ctx.t("¡Fuera!", "Out!") : ctx.t("Fuera", "Out"), mine ? "#ff9d8e" : "#cfd8ea", mine ? 24 : 18);
        } else if (e.type === "credit") {
          ctx.sfx(mine ? "score" : "hit");
          pushPop(e.x, e.y, `+${e.pts}`, ctx.teams[e.team].color, 28);
        } else if (e.type === "exhaust") {
          if (mine) { ctx.sfx("hit"); pushPop(match.mon(e.team, e.member).x, match.mon(e.team, e.member).y, ctx.t("¡Sin energía!", "Worn out!"), "#ffd166", 20); }
        } else if (e.type === "roundEnd") {
          ctx.sfx("whistle");
          banner = { text: ctx.t("¡Fin de ronda!", "Round over!"), age: 0, life: 1.4 };
        } else if (e.type === "roundStart") {
          ctx.sfx("start");
          banner = { text: ctx.t(`Ronda ${e.round + 1}`, `Round ${e.round + 1}`), age: 0, life: 1.2 };
        } else if (e.type === "end") ctx.sfx("end");
      }
    };

    return {
      update(dt) {
        for (const c of ctls.values()) c.latch.absorb(ctx.inputs[c.team]);
        for (const m of match.mons) {
          const a = ctx.animator(m.team, m.member);
          if (!a.busy()) {
            const name = m.state !== 1 ? "Idle" : m.pushing ? (a.has("Attack") ? "Attack" : "Walk") : m.moved > 0.2 ? "Walk" : "Idle";
            a.loop(name, name === "Walk" ? clamp(m.moved / 2.4, 0.6, 1.8) : 1);
          }
          a.update(dt);
        }
        for (const q of pops) q.age += dt;
        while (pops.length && pops[0].age > 0.95) pops.shift();
        for (const f of falls) f.age += dt;
        while (falls.length && falls[0].age > 0.7) falls.shift();
        if (banner) { banner.age += dt; if (banner.age > banner.life) banner = null; }
        if (pushSound > 0) pushSound -= dt;
        if (match.over) {
          for (const c of ctls.values()) c.latch.take();
          endTimer += dt;
          if (endTimer >= 2 && !finished) { finished = true; ctx.finish(match.result()); }
          return;
        }
        clock.advance(dt, () => {
          for (const c of ctls.values()) c.apply(c.latch.take());
          match.step();
          if (humanTeam >= 0 && pushSound <= 0 && match.teamMons(humanTeam).some((m) => m.pushing)) { ctx.sfx("hit"); pushSound = 0.3; }
          onEvents(match.drain());
        });
        if (match.over) onEvents(match.drain());
      },

      /** A person left a room: the CPU plays their team from here on. */
      takeOver(team) { ctls.delete(team); match.takeOver(team); },

      render(g) {
        const ui = ctx.ui;
        const f = clock.frame;
        const bg = g.createLinearGradient(0, 0, 0, 540);
        bg.addColorStop(0, "#141c2b");
        bg.addColorStop(1, "#0b111b");
        g.fillStyle = bg;
        g.fillRect(0, 0, 960, 540);

        // ---- the ring ---------------------------------------------------------------------------------------------------------
        const rx = sx(RING.x0);
        const ry = sy(RING.y0);
        const rw = (RING.x1 - RING.x0) * K;
        const rh = (RING.y1 - RING.y0) * K;
        g.fillStyle = "rgba(0,0,0,.4)";
        g.fillRect(rx - 6, ry - 6, rw + 12, rh + 18);
        const fl = g.createLinearGradient(0, ry, 0, ry + rh);
        fl.addColorStop(0, "#c9b79a");
        fl.addColorStop(1, "#b7a285");
        g.fillStyle = fl;
        g.fillRect(rx, ry, rw, rh);
        g.save();
        g.beginPath();
        g.rect(rx, ry, rw, rh);
        g.clip();
        g.strokeStyle = "rgba(90,70,40,.14)";
        g.lineWidth = 2;
        for (let c = 0; c <= 7; c++) { g.beginPath(); g.moveTo(rx + c * 32 * K, ry); g.lineTo(rx + c * 32 * K, ry + rh); g.stroke(); }
        for (let r = 0; r <= 5; r++) { g.beginPath(); g.moveTo(rx, ry + r * 32 * K); g.lineTo(rx + rw, ry + r * 32 * K); g.stroke(); }
        // the zones
        const drawZones = (zones, opts) => {
          for (const z of zones) {
            const col = ZONE_COLORS[z.kind];
            const pulse = 0.5 + 0.5 * Math.sin(f / 6 + z.x);
            g.beginPath();
            g.arc(sx(z.x), sy(z.y), z.r * K, 0, Math.PI * 2);
            g.fillStyle = opts.next ? "rgba(255,255,255,.05)" : `${col}44`;
            g.fill();
            g.lineWidth = opts.next ? 3 : 4;
            g.strokeStyle = col;
            g.globalAlpha = opts.next ? 0.6 : 0.65 + 0.3 * pulse;
            if (opts.next) g.setLineDash([10, 8]);
            g.stroke();
            g.setLineDash([]);
            g.globalAlpha = 1;
            ui.text(g, `${z.pts}`, sx(z.x), sy(z.y) + Math.min(34, z.r * K * 0.3), { size: Math.max(22, Math.min(70, z.r * K * 0.85)), align: "center", color: col, alpha: opts.next ? 0.5 : 0.7, stroke: "rgba(20,24,34,.55)" });
          }
        };
        if (match.phase === "break" && match.next !== null) drawZones(LAYOUTS[match.next], { next: true });
        else drawZones(match.zones, { next: false });
        g.restore();
        g.lineWidth = 8;
        g.strokeStyle = "#3b4256";
        g.strokeRect(rx - 3, ry - 3, rw + 6, rh + 6);
        g.lineWidth = 2;
        g.strokeStyle = "rgba(255,255,255,.3)";
        g.strokeRect(rx - 7, ry - 7, rw + 14, rh + 14);

        // starting spots of the fallen
        if (match.phase === "break") {
          for (const m of match.mons) {
            if (m.state === 2) {
              g.strokeStyle = ctx.teams[m.team].color;
              g.globalAlpha = 0.5;
              g.lineWidth = 2;
              g.setLineDash([5, 5]);
              g.beginPath();
              g.arc(sx(m.x), sy(m.y), RADIUS * K, 0, Math.PI * 2);
              g.stroke();
              g.setLineDash([]);
              g.globalAlpha = 1;
            }
          }
        }

        // ---- Pokémon, back to front --------------------------------------------------------------------------------------------
        const me = humanTeam >= 0 ? humanTeam : -1;
        const alive = match.mons.filter((m) => m.state !== 0).sort((a, b) => a.y - b.y);
        for (const m of alive) {
          const x = sx(m.x);
          const y = sy(m.y);
          const held = me === m.team && (match.held[me] === m.member);
          const ghost = m.state === 2;
          const alpha = ghost ? 0.4 + 0.2 * Math.sin(f / 3) : 1;
          if (held && match.stylus[me]) {
            const st = match.stylus[me];
            g.strokeStyle = "rgba(255,255,255,.55)";
            g.lineWidth = 2;
            g.setLineDash([5, 6]);
            g.beginPath();
            g.moveTo(x, y);
            g.lineTo(sx(st.x), sy(st.y));
            g.stroke();
            g.setLineDash([]);
            g.beginPath();
            g.arc(sx(st.x), sy(st.y), 9, 0, Math.PI * 2);
            g.stroke();
          }
          if (me === m.team && !ghost) {
            g.strokeStyle = held || (fc().kb && fc().sel === m.member) ? "#fff" : "rgba(255,255,255,.35)";
            g.lineWidth = held ? 3 : 2;
            g.beginPath();
            g.ellipse(x, y + 4, RADIUS * K * 1.5, RADIUS * K * 0.75, 0, 0, Math.PI * 2);
            g.stroke();
          }
          const row = rowOf(m.face);
          ui.mon(g, m.team, m.member, x, y + 8, { row, k: 1.7, alpha, flash: m.exhausted ? 0.18 : 0, r: RADIUS * K * 0.95 });
          // energy
          const wBar = 38;
          const frac = m.stamina / m.maxStamina;
          if (!ghost && (frac < 1 || held || m.exhausted)) {
            ui.bar(g, x - wBar / 2, y + 24, wBar, 5, m.exhausted ? m.exhaustTimer / 60 : frac, m.exhausted ? "#ff8a7a" : frac < 0.35 ? "#ffd166" : "#7ee081");
          }
          if (me === m.team) {
            ui.text(g, `${m.member + 1}`, x, y - 36, { size: 14, align: "center", color: held ? "#fff" : "#cfd8ea", stroke: "rgba(8,12,22,.85)" });
          }
          if (m.exhausted) ui.text(g, "zZ", x + 18, y - 30, { size: 15, color: "#ffd166" });
        }
        for (const fa of falls) {
          const k = fa.age / 0.7;
          g.save();
          g.globalAlpha = 1 - k;
          const x = sx(fa.x);
          const y = sy(fa.y) + k * 36;
          g.translate(x, y);
          g.scale(1 - k * 0.6, 1 - k * 0.6);
          ui.mon(g, fa.team, fa.member, 0, 8, { row: 0, k: 1.7, r: RADIUS * K * 0.95, shadow: false, ring: false });
          g.restore();
        }
        // the cursor of the keyboard / pad
        if (fc().kb && me >= 0 && match.playing()) {
          const x = sx(fc().cursor.x);
          const y = sy(fc().cursor.y);
          g.strokeStyle = ctx.teams[me].color;
          g.lineWidth = 3;
          g.beginPath();
          g.arc(x, y, 12, 0, Math.PI * 2);
          g.moveTo(x - 18, y); g.lineTo(x - 6, y);
          g.moveTo(x + 6, y); g.lineTo(x + 18, y);
          g.moveTo(x, y - 18); g.lineTo(x, y - 6);
          g.moveTo(x, y + 6); g.lineTo(x, y + 18);
          g.stroke();
        }
        ui.pops(g, pops, { life: 0.95, rise: 34, size: 24 });

        // ---- the top bar: round and the ring of tiles ---------------------------------------------------------------------------
        const round = Math.min(ROUNDS, match.round + 1);
        ui.text(g, ctx.t(`Ronda ${round}/${ROUNDS}`, `Round ${round}/${ROUNDS}`), 172, 40, { size: 24 });
        const tx0 = 330;
        const tw = 380;
        const cw = tw / TILES;
        for (let i = 0; i < TILES; i++) {
          const done = i < match.timer || match.phase !== "play";
          const warn = i >= TILES - 8;
          g.fillStyle = match.phase !== "play" ? "rgba(255,255,255,.12)" : done ? "rgba(255,255,255,.1)" : warn ? "#ffb04a" : "#7ee081";
          const h = 18;
          g.fillRect(tx0 + i * cw, 30, cw - 2, h);
        }
        const secsLeft = match.phase === "play" ? ((TILES - match.timer) * ROUND_INTERVAL[Math.min(match.round, ROUNDS - 1)] - match.tickT) / 30 : 0;
        ui.text(g, ui.fmtClock(secsLeft), 788, 46, { size: 26, align: "right", color: secsLeft <= 5 && match.phase === "play" ? "#ffd166" : "#fff" });
        const state = match.phase === "play" ? "" : match.phase === "break" && match.next !== null ? ctx.t("Zonas nuevas", "New zones") : match.phase === "score" || match.phase === "end" ? ctx.t("Puntuación", "Scoring") : "";
        if (state) ui.text(g, state, tx0 + tw / 2, 24, { size: 13, align: "center", color: "#cfd8ea", stroke: null, weight: 600 });

        // ---- the four cards, in the corner where each team starts ---------------------------------------------------------------
        const pos = [[14, 72], [800, 72], [14, 312], [800, 312]];
        for (let t = 0; t < 4; t++) {
          const team = ctx.teams[t];
          const [cx, cy] = pos[t];
          ui.panel(g, cx, cy, 146, 200, { fill: `rgba(10,16,28,${team.human ? 0.8 : 0.6})`, stroke: team.color, lw: team.human ? 3 : 1.5 });
          const name = team.name.length > 14 ? `${team.name.slice(0, 13)}…` : team.name;
          ui.text(g, name, cx + 12, cy + 22, { size: 14, color: "#eef3ff", stroke: null });
          ui.text(g, match.scoreOf(t), cx + 73, cy + 68, { size: 44, align: "center" });
          const rp = match.roundPoints.length ? match.roundPoints[match.roundPoints.length - 1][t] : 0;
          if (match.roundPoints.length) ui.text(g, ctx.t(`última ronda +${rp}`, `last round +${rp}`), cx + 73, cy + 88, { size: 11, align: "center", color: "#aeb9cc", stroke: null, weight: 600 });
          for (let s = 0; s < 3; s++) {
            const m = match.mon(t, s);
            const y = cy + 100 + s * 32;
            ui.icon(g, t, s, cx + 10, y, 26, { ring: me === t && (fc().kb ? fc().sel === s : match.held[t] === s) ? "#fff" : null, alpha: m.state === 0 ? 0.35 : 1 });
            const frac = m.stamina / m.maxStamina;
            ui.bar(g, cx + 44, y + 6, 76, 6, m.state === 0 ? 0 : m.exhausted ? m.exhaustTimer / 60 : frac, m.exhausted ? "#ff8a7a" : "#7ee081");
            ui.text(g, m.state === 0 ? ctx.t("fuera", "out") : `${m.score}`, cx + 128, y + 22, { size: 12, align: "right", color: m.state === 0 ? "#ff9d8e" : "#eef3ff", stroke: null, weight: 600 });
            if (me === t) ui.text(g, `${s + 1}`, cx + 44, y + 24, { size: 11, color: "#8d99b0", stroke: null, weight: 600 });
          }
        }
        ui.text(g, ctx.t(`Objetivo: ${TARGET_SCORE}`, `Goal: ${TARGET_SCORE}`), 480, 530, { size: 12, align: "center", color: "#8d99b0", stroke: null, weight: 600 });

        if (banner) {
          const a = clamp(banner.age / 0.25, 0, 1) * clamp((banner.life - banner.age) / 0.3, 0, 1);
          ui.text(g, banner.text, 480, 300, { size: 64, align: "center", color: "#ffd166", alpha: a });
        }
        if (match.over) ui.banner(g, ctx.t("¡Fin!", "Time!"), ctx.t(`${match.scoreOf(me >= 0 ? me : 0)} puntos`, `${match.scoreOf(me >= 0 ? me : 0)} points`), 220);
      },

      destroy() {},
    };
  },
};
