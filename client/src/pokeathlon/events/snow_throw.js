// Snow Throw (Nieve cruzada). Rules: snow_throw/sim.js (SPEC event 8). Drawing: snow_throw/view.js. This file glues them to the framework:
// stars to raw stats, the person's mouse / touch / keys / pad to the sim's commands, the single call to finish().
import { makeRand, clamp, norm } from "./_kit5/util.js";
import { EventRunner } from "./_kit5/runner.js";
import { SnowThrowSim, GRAB_RADIUS } from "./snow_throw/sim.js";
import { SnowThrowView } from "./snow_throw/view.js";

const raw = (stars) => clamp(Math.round((stars ?? 1) - 1), 0, 4);
const TURN = 0.05;                   // radians per step the aim turns while a key is held

export default {
  id: "snow_throw",
  names: { es: "Nieve cruzada", en: "Snow Throw" },
  stats: ["skill", "power", "stamina"],
  seconds: 60,
  help: {
    es: "Toca tu Pokémon para hacer crecer la bola (hasta 4 toques); arrastra desde él hacia fuera y suelta para lanzarla. Cuanto antes sueltes, más fuerte vuela; las bolas grandes aturden. Teclado: 1-3 eligen Pokémon, Espacio hace crecer la bola, A/D o flechas apuntan, Tab fija el blanco, Enter lanza. Mando: palanca apunta, A crece, B lanza, L/R eligen.",
    en: "Tap your Pokémon to grow the snowball (up to 4 taps); drag out from it and let go to throw. The sooner you let go the faster it flies; big balls stun. Keyboard: 1-3 pick a Pokémon, Space grows the ball, A/D or arrows aim, Tab locks on a target, Enter throws. Pad: stick aims, A grows, B throws, L/R pick.",
  },

  create(ctx) {
    const rand = makeRand(ctx.rng);
    const human = ctx.teams.findIndex((t) => t.human);
    const stats = ctx.teams.map((t) => t.mons.map((m) => ({ power: raw(m.stars?.power), skill: raw(m.stars?.skill), stamina: raw(m.stars?.stamina) })));
    const sim = new SnowThrowSim({ stats, rand, human });
    const st = { you: human, rot: Math.max(0, human), sel: 1, keys: false, aim: [0, -1], hover: -1, touching: false, pointer: [0, 0], lock: -1 };
    const view = new SnowThrowView(ctx, sim, st);
    st.aim = view.dirToField(0, -1);          // straight up the screen

    // the opponents around the chosen Pokémon, in the order of the angle they are seen under on the screen
    const targetsOf = (sel) => {
      const me = sim.mons[human * 3 + sel];
      const [mx, my] = view.toScreen(me.home[0], me.home[1]);
      return sim.mons.filter((m) => m.team !== human).map((m) => {
        const [x, y] = view.toScreen(m.home[0], m.home[1]);
        return { m, a: Math.atan2(y - my, x - mx) };
      }).sort((p, q) => p.a - q.a);
    };

    const step = (inp, run) => {
      const cmd = {};
      if (human >= 0) {
        const t = run.touch;
        const [fx, fz] = view.toField(t.touchX, t.touchY);
        cmd.touch = { down: t.touching, x: fx, z: fz };
        st.touching = t.touching;
        st.pointer = [fx, fz];
        if (t.touchNew) st.keys = false;
        // which of my Pokémon a press would pick (hover)
        st.hover = -1;
        if (!t.touching && !st.keys) {
          const [hx, hz] = view.toField(t.x, t.y);
          for (let k = 0; k < 3; k++) {
            const m = sim.mons[human * 3 + k];
            if (Math.hypot(m.home[0] - hx, m.home[1] - hz) <= GRAB_RADIUS) st.hover = k;
          }
        }
        // keyboard and pad
        const pick = (n) => { st.sel = ((n % 3) + 3) % 3; st.keys = true; st.lock = -1; };
        if (inp.pressed("Digit1", "Numpad1")) pick(0);
        if (inp.pressed("Digit2", "Numpad2")) pick(1);
        if (inp.pressed("Digit3", "Numpad3")) pick(2);
        if (inp.pressed("KeyQ") || inp.padPressed(4)) pick(st.sel - 1);
        if (inp.pressed("KeyE") || inp.padPressed(5)) pick(st.sel + 1);
        const turn = (inp.held("KeyD", "ArrowRight") ? 1 : 0) - (inp.held("KeyA", "ArrowLeft") ? 1 : 0);
        const stick = inp.stick;
        const keys = [];
        if (turn) {
          st.keys = true; st.lock = -1;
          let [dx, dy] = view.dirToScreen(st.aim[0], st.aim[1]);
          const c = Math.cos(turn * TURN), s = Math.sin(turn * TURN);
          [dx, dy] = [dx * c - dy * s, dx * s + dy * c];
          st.aim = norm(...view.dirToField(dx, dy));
        } else if (Math.hypot(stick.x, stick.y) > 0.45) {
          st.keys = true; st.lock = -1;
          st.aim = norm(...view.dirToField(stick.x, stick.y));
        }
        // Tab / W / S: lock on the next (or previous) opponent
        const next = inp.pressed("Tab", "KeyW", "ArrowUp") ? 1 : inp.pressed("KeyS", "ArrowDown") ? -1 : 0;
        if (next) {
          st.keys = true;
          const list = targetsOf(st.sel);
          const me = sim.mons[human * 3 + st.sel];
          const [adx, ady] = view.dirToScreen(st.aim[0], st.aim[1]);
          const cur = Math.atan2(ady, adx);
          // the opponent after (or before) the current aim in the angle order
          let idx = list.findIndex((q) => q.a > cur + 1e-3);
          if (idx < 0) idx = 0;
          if (next < 0) idx = (idx - 2 + list.length * 2) % list.length;
          const tgt = list[idx].m;
          st.lock = tgt.i;
          st.aim = norm(tgt.home[0] - me.home[0], tgt.home[1] - me.home[1]);
        }
        const tap = inp.pressed("Space") || inp.padPressed(0);
        const fire = inp.pressed("Enter", "KeyF") || inp.padPressed(1, 2, 7);
        if (tap) { st.keys = true; keys.push({ type: "tap", mon: st.sel }); }
        if (fire) { st.keys = true; keys.push({ type: "throw", mon: st.sel, dir: st.aim, hold: 0 }); }
        if (keys.length) cmd.keys = keys;
      }
      sim.step(cmd);
      view.onEvents(sim.events, run);
    };

    const runner = new EventRunner(ctx, {
      step,
      render: (g, a, run) => view.render(g, a, run),
      visual: (dt) => view.update(dt),
      isOver: () => sim.over,
      idle: (run) => { if (run.endNo === 1) run.sfx("end"); },
      result: () => { const detail = sim.result(); return { raw: detail.map((d) => d.points), detail }; },
    });
    return { update: (dt) => runner.update(dt), render: (g) => runner.render(g), destroy: () => runner.destroy(), sim };
  },
};
