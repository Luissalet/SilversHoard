// Snow Throw (Nieve cruzada). Rules: snow_throw/sim.js (SPEC event 8). Drawing: snow_throw/view.js. This file glues them to the framework:
// stars to raw stats, the person's mouse / touch / keys / pad to the sim's commands, the single call to finish().
import { makeRand, clamp, norm } from "./_kit5/util.js";
import { EventRunner } from "./_kit5/runner.js";
import { SnowThrowSim, GRAB_RADIUS } from "./snow_throw/sim.js";
import { SnowThrowView, geom } from "./snow_throw/view.js";

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
    const humans = ctx.humans();
    const human = humans.includes(ctx.focus) ? ctx.focus : -1;   // the person at this screen (-1: a spectator, or nobody plays)
    const stats = ctx.teams.map((t) => t.mons.map((m) => ({ power: raw(m.stars?.power), skill: raw(m.stars?.skill), stamina: raw(m.stars?.stamina) })));
    const sim = new SnowThrowSim({ stats, rand, humans });
    const st = { you: human, rot: Math.max(0, human), sel: 1, keys: false, aim: [0, -1], hover: -1, touching: false, pointer: [0, 0], lock: -1 };
    const view = new SnowThrowView(ctx, sim, st);
    st.aim = view.dirToField(0, -1);          // straight up the screen

    // every person's screen is turned by their team index; their pointer and aim are read in that turn
    const ctls = new Map(humans.map((t) => {
      const geo = geom(t);
      return [t, { team: t, geo, sel: 1, keys: false, aim: geo.dirToField(0, -1), hover: -1, touching: false, pointer: [0, 0], lock: -1 }];
    }));

    // the opponents around the chosen Pokémon, in the order of the angle they are seen under on the screen
    const targetsOf = (c, sel) => {
      const me = sim.mons[c.team * 3 + sel];
      const [mx, my] = c.geo.toScreen(me.home[0], me.home[1]);
      return sim.mons.filter((m) => m.team !== c.team).map((m) => {
        const [x, y] = c.geo.toScreen(m.home[0], m.home[1]);
        return { m, a: Math.atan2(y - my, x - mx) };
      }).sort((p, q) => p.a - q.a);
    };

    const commandOf = (inp, c) => {
      const cmd = {};
      const team = c.team;
      const geo = c.geo;
      const t = inp.touch;
      const [fx, fz] = geo.toField(t.touchX, t.touchY);
      cmd.touch = { down: t.touching, x: fx, z: fz };
      c.touching = t.touching;
      c.pointer = [fx, fz];
      if (t.touchNew) c.keys = false;
      // which of my Pokémon a press would pick (hover)
      c.hover = -1;
      if (!t.touching && !c.keys) {
        const [hx, hz] = geo.toField(t.x, t.y);
        for (let k = 0; k < 3; k++) {
          const m = sim.mons[team * 3 + k];
          if (Math.hypot(m.home[0] - hx, m.home[1] - hz) <= GRAB_RADIUS) c.hover = k;
        }
      }
      // keyboard and pad
      const keys = [];
      const pick = (n) => { c.sel = ((n % 3) + 3) % 3; c.keys = true; c.lock = -1; };
      if (inp.pressed("Digit1", "Numpad1")) pick(0);
      if (inp.pressed("Digit2", "Numpad2")) pick(1);
      if (inp.pressed("Digit3", "Numpad3")) pick(2);
      if (inp.pressed("KeyQ") || inp.padPressed(4)) pick(c.sel - 1);
      if (inp.pressed("KeyE") || inp.padPressed(5)) pick(c.sel + 1);
      const turn = (inp.held("KeyD", "ArrowRight") ? 1 : 0) - (inp.held("KeyA", "ArrowLeft") ? 1 : 0);
      const stick = inp.stick;
      if (turn) {
        c.keys = true; c.lock = -1;
        let [dx, dy] = geo.dirToScreen(c.aim[0], c.aim[1]);
        const cs = Math.cos(turn * TURN), sn = Math.sin(turn * TURN);
        [dx, dy] = [dx * cs - dy * sn, dx * sn + dy * cs];
        c.aim = norm(...geo.dirToField(dx, dy));
      } else if (Math.hypot(stick.x, stick.y) > 0.45) {
        c.keys = true; c.lock = -1;
        c.aim = norm(...geo.dirToField(stick.x, stick.y));
      }
      // Tab / W / S: lock on the next (or previous) opponent
      const next = inp.pressed("Tab", "KeyW", "ArrowUp") ? 1 : inp.pressed("KeyS", "ArrowDown") ? -1 : 0;
      if (next) {
        c.keys = true;
        const list = targetsOf(c, c.sel);
        const me = sim.mons[team * 3 + c.sel];
        const [adx, ady] = geo.dirToScreen(c.aim[0], c.aim[1]);
        const cur = Math.atan2(ady, adx);
        // the opponent after (or before) the current aim in the angle order
        let idx = list.findIndex((q) => q.a > cur + 1e-3);
        if (idx < 0) idx = 0;
        if (next < 0) idx = (idx - 2 + list.length * 2) % list.length;
        const tgt = list[idx].m;
        c.lock = tgt.i;
        c.aim = norm(tgt.home[0] - me.home[0], tgt.home[1] - me.home[1]);
      }
      const tap = inp.pressed("Space") || inp.padPressed(0);
      const fire = inp.pressed("Enter", "KeyF") || inp.padPressed(1, 2, 7);
      if (tap) { c.keys = true; keys.push({ type: "tap", mon: c.sel }); }
      if (fire) { c.keys = true; keys.push({ type: "throw", mon: c.sel, dir: c.aim, hold: 0 }); }
      if (keys.length) cmd.keys = keys;
      return cmd;
    };

    const step = (inp, run, seats) => {
      const cmds = {};
      for (const [team, c] of ctls) cmds[team] = commandOf(seats ? seats.get(team) : inp, c);
      const mine = ctls.get(human);
      if (mine) { st.sel = mine.sel; st.keys = mine.keys; st.aim = mine.aim; st.hover = mine.hover; st.touching = mine.touching; st.pointer = mine.pointer; st.lock = mine.lock; }
      sim.step({}, cmds);
      view.onEvents(sim.events, run);
    };

    const runner = new EventRunner(ctx, {
      humans,
      step,
      render: (g, a, run) => view.render(g, a, run),
      visual: (dt) => view.update(dt),
      isOver: () => sim.over,
      idle: (run) => { if (run.endNo === 1) run.sfx("end"); },
      result: () => { const detail = sim.result(); return { raw: detail.map((d) => d.points), detail }; },
    });
    return {
      update: (dt) => runner.update(dt),
      render: (g) => runner.render(g),
      takeOver(team) { ctls.delete(team); runner.dropSeat(team); sim.takeOver(team); },
      destroy: () => runner.destroy(),
      sim,
    };
  },
};
