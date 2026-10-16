// Lamp Jump (Botaluces). Rules: lamp_jump/sim.js (SPEC event 5). Drawing: lamp_jump/view.js. This file glues them to the framework: stars
// to raw stats, the person's mouse / touch / keys / pad to the sim's commands, the formula scores of the other teams, the call to finish().
import { makeRand, clamp } from "./_kit5/util.js";
import { EventRunner } from "./_kit5/runner.js";
import { LampJumpSim, cpuTeamScore, FRAMES, FLICK_MAX } from "./lamp_jump/sim.js";
import { LampJumpView, toField } from "./lamp_jump/view.js";

const raw = (stars) => clamp(Math.round((stars ?? 1) - 1), 0, 4);
const CHARGE_STEPS = 36;      // holding Down (or the button) this long charges the full 112 px

/** the staircase a CPU team's displayed score climbs by: n blips that add up to the final score */
function blips(final, rand) {
  const n = Math.max(1, Math.round(final / 7));
  const out = [];
  let left = final;
  for (let k = 0; k < n; k++) {
    const at = Math.floor(FRAMES * ((k + 0.5 + (rand.float() - 0.5) * 0.8) / n));
    const add = k === n - 1 ? left : Math.min(left, Math.max(1, Math.round(final / n + (rand.float() - 0.5) * 3)));
    left -= add;
    out.push({ at, add });
  }
  out.sort((a, b) => a.at - b.at);
  return out;
}

export default {
  id: "lamp_jump",
  names: { es: "Botaluces", en: "Lamp Jump" },
  stats: ["jump", "stamina", "skill"],
  seconds: 60,
  help: {
    es: "Arrastra un Pokémon hacia abajo y suéltalo: se hunde en la lona y sale disparado hacia el lado contrario al arrastre, apagando bombillas (cada una de la misma cadena vale más). Teclado: 1-3 o izquierda/derecha eligen, Abajo o Espacio cargan y al soltar salta, A/D apuntan. Mando: palanca hacia atrás y soltar, L/R eligen.",
    en: "Drag a Pokémon down and let go: it sinks into the cloth and shoots off to the side opposite the drag, putting out lamps (each one in the same chain is worth more). Keyboard: 1-3 or left/right choose, Down or Space charge and releasing jumps, A/D aim. Pad: pull the stick back and release, L/R choose.",
  },

  create(ctx) {
    const rand = makeRand(ctx.rng);
    const human = ctx.teams.findIndex((t) => t.human);
    const team = human >= 0 ? human : 0;
    const statsOf = (t) => ctx.teams[t].mons.map((m) => ({ jump: raw(m.stars?.jump), stamina: raw(m.stars?.stamina), skill: raw(m.stars?.skill) }));
    const sim = new LampJumpSim({ stats: statsOf(team), rand });
    // the teams the game does not play: a formula, decided once (and a staircase to show while the clock runs)
    const cpu = [];
    for (let t = 0; t < 4; t++) {
      if (t === human) { cpu.push(null); continue; }
      const c = cpuTeamScore(statsOf(t), rand);
      c.blips = blips(c.total, rand);
      cpu.push(c);
    }
    const st = { you: human, team, sel: 1, charge: 0, aimX: 0, keys: false, touching: false, touchPos: [0, 0], shown: [0, 0, 0, 0] };
    const view = new LampJumpView(ctx, sim, st);
    let charging = false;
    let autoWait = 24;

    const step = (inp, run) => {
      const cmd = {};
      if (human >= 0) {
        const t = run.touch;
        if (t.touchNew) st.keys = false;
        const [gx, gy] = toField(t.touchX, t.touchY);
        cmd.touch = { touchNew: t.touchNew, touching: t.touching, x: Math.round(gx), y: Math.round(gy) };
        st.touching = t.touching;
        st.touchPos = [Math.round(gx), Math.round(gy)];
        // keyboard and pad: choose, charge, aim, release
        const pick = (n) => { st.sel = ((n % 3) + 3) % 3; st.keys = true; };
        if (inp.pressed("Digit1", "Numpad1")) pick(0);
        if (inp.pressed("Digit2", "Numpad2")) pick(1);
        if (inp.pressed("Digit3", "Numpad3")) pick(2);
        if (inp.pressed("ArrowLeft", "KeyQ") || inp.padPressed(4, 14)) pick(st.sel - 1);
        if (inp.pressed("ArrowRight", "KeyE", "Tab") || inp.padPressed(5, 15)) pick(st.sel + 1);
        const stick = inp.stick;
        const pull = stick.y > 0.3 ? stick.y : 0;
        const held = inp.held("ArrowDown", "KeyS", "Space") || inp.padHeld(0, 1);
        const side = (inp.held("KeyD") ? 1 : 0) - (inp.held("KeyA") ? 1 : 0);
        if (held || pull || side) st.keys = true;
        if (Math.abs(stick.x) > 0.3) st.aimX = stick.x * 40;
        else if (side) st.aimX = clamp(st.aimX + side * 2.5, -40, 40);
        else st.aimX += Math.sign(-st.aimX) * Math.min(Math.abs(st.aimX), 1.5);
        const active = held || pull > 0;
        if (held) st.charge = Math.min(1, st.charge + 1 / CHARGE_STEPS);
        else if (pull) st.charge = Math.max(st.charge, pull);
        if (charging && !active) {
          if (st.charge > 0.05) cmd.launch = { slot: st.sel, fx: -st.aimX, fy: Math.max(8, st.charge * FLICK_MAX) };
          st.charge = 0;
        }
        charging = active;
      } else if (--autoWait <= 0) {
        // nobody plays: the Pokémon of team 0 bounce about for the show (their score does not count)
        autoWait = 14 + rand.int(26);
        const free = sim.mons.filter((m) => !m.jumping && !m.stunned);
        if (free.length) {
          const m = free[rand.int(free.length)];
          cmd.launch = { slot: m.i, fx: rand.int(61) - 30, fy: 50 + rand.int(63) };
        }
      }
      sim.step(cmd);
      // what the other teams' scoreboards show so far
      for (let t = 0; t < 4; t++) {
        if (!cpu[t]) { st.shown[t] = sim.total; continue; }
        let v = 0;
        for (const b of cpu[t].blips) if (b.at <= sim.steps) v += b.add;
        st.shown[t] = v;
      }
      view.onEvents(sim.events, run);
    };

    const result = () => {
      const detail = [0, 1, 2, 3].map((t) => {
        if (t === human) {
          const mons = sim.result();
          return { mons, points: sim.total, lamps: mons.reduce((s, m) => s + m.points, 0), clashes: mons.reduce((s, m) => s + m.hit, 0) / 2 };
        }
        const c = cpu[t];
        return {
          points: c.total, formula: true,
          mons: c.mons.map((m) => ({ failed: m.noise, jumped: 0, points: Math.round(m.score / 3), hit: m.noise, fell: 0, dashed: 0, switched: 0, selfImpeded: 0, score: m.score })),
        };
      });
      return { raw: detail.map((d) => d.points), detail };
    };

    const runner = new EventRunner(ctx, {
      step,
      render: (g, a) => view.render(g, a),
      visual: (dt) => view.update(dt),
      isOver: () => sim.over,
      idle: (run) => { if (run.endNo === 1) run.sfx("end"); },
      result,
    });
    return { update: (dt) => runner.update(dt), render: (g) => runner.render(g), destroy: () => runner.destroy(), sim };
  },
};
