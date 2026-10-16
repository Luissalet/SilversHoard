// Disc Catch (Atrapadiscos). Rules: disc_catch/sim.js (SPEC event 4). Drawing: disc_catch/view.js. This file glues them to the
// framework: stars to raw stats, the person's mouse / touch / keys / pad to the sim's commands, the single call to finish().
import { makeRand, clamp, dist } from "./_kit5/util.js";
import { EventRunner } from "./_kit5/runner.js";
import { DiscCatchSim, TOUCH_RADIUS } from "./disc_catch/sim.js";
import { DiscCatchView, toField, toScreen } from "./disc_catch/view.js";

// species whose follower sprite is "too tall": it only matters for the knock-back they take (SPEC event 4)
const LARGE = new Set([208, 249, 250, 321, 382, 383, 384, 483, 484, 486, 487, 493]);
const raw = (stars) => clamp(Math.round((stars ?? 1) - 1), 0, 4);

export default {
  id: "disc_catch",
  names: { es: "Atrapadiscos", en: "Disc Catch" },
  stats: ["jump", "power", "speed"],
  seconds: 60,
  help: {
    es: "Toca un Pokémon y arrástralo para que ande; un toque corto lo hace saltar, y un Pokémon en el aire atrapa el disco que pasa a su altura. Teclado: 1-3 o Q/E para elegir, flechas para andar, Espacio para saltar. Mando: palanca, A para saltar, L/R para elegir.",
    en: "Touch a Pokémon and drag it to walk; a short tap makes it jump, and a Pokémon in the air catches the disc passing by. Keyboard: 1-3 or Q/E to choose, arrows to walk, Space to jump. Pad: stick, A to jump, L/R to choose.",
  },

  create(ctx) {
    const humans = ctx.humans();
    const human = humans.includes(ctx.focus) ? ctx.focus : -1;   // the person at this screen (-1: a spectator, or nobody plays)
    const stats = [], large = [];
    for (const t of ctx.teams) {
      for (const m of t.mons) {
        stats.push({ power: raw(m.stars?.power), speed: raw(m.stars?.speed), jump: raw(m.stars?.jump) });
        large.push(LARGE.has(m.num));
      }
    }
    const sim = new DiscCatchSim({ stats, large, rand: makeRand(ctx.rng), humans });
    // what each person has chosen: the Pokémon they steer with keys, whether keys are in use, and (for the screen) hover and held
    const ctls = new Map(humans.map((t) => [t, { sel: 0, keys: false, walking: false, held: -1, hover: -1 }]));
    const st = { sel: 0, you: human, held: -1, keys: false, hover: -1 };
    const view = new DiscCatchView(ctx, sim, st);

    const commandOf = (team, inp, c) => {
      const cmd = {};
      const t = inp.touch;
      if (t.touchNew) c.keys = false;
      const [fx, fy] = toField(t.touchX, t.touchY);
      cmd.touch = { touchNew: t.touchNew, touching: t.touching, lastTouchFrames: t.lastTouchFrames, touchX: fx, touchY: fy };
      // keyboard / pad: choose, steer, jump
      const pick = (n) => { c.sel = ((n % 3) + 3) % 3; c.keys = true; };
      if (inp.pressed("Digit1", "Numpad1")) pick(0);
      if (inp.pressed("Digit2", "Numpad2")) pick(1);
      if (inp.pressed("Digit3", "Numpad3")) pick(2);
      if (inp.pressed("KeyQ") || inp.padPressed(4)) pick(c.sel - 1);
      if (inp.pressed("KeyE", "Tab") || inp.padPressed(5)) pick(c.sel + 1);
      const d = inp.dir;
      const jump = inp.pressed("Space", "Enter", "KeyF") || inp.padPressed(0, 1);
      if (d.x || d.y || jump) c.keys = true;
      if (c.keys) {
        const m = sim.mons[team * 3 + c.sel];
        let target = null;
        if (d.x || d.y) { target = [m.x + d.x * 40, m.y + d.y * 40]; c.walking = true; }
        else if (c.walking) { target = [m.x, m.y]; c.walking = false; }
        cmd.kbd = { slot: c.sel, target, jump };
      }
      const hold = sim.holdOf(team);
      c.held = hold.holding ? hold.mon : -1;
      // which Pokémon a press would pick up (mouse hover)
      c.hover = -1;
      if (!c.keys && !t.touching && team === human) {
        const [hx, hy] = toField(t.x, t.y);
        c.hover = sim.nearestTouched(team, hx, hy);
      }
      return cmd;
    };

    const step = (inp, run, seats) => {
      const cmds = {};
      for (const [team, c] of ctls) cmds[team] = commandOf(team, seats ? seats.get(team) : inp, c);
      const mine = ctls.get(human);
      if (mine) { st.sel = mine.sel; st.keys = mine.keys; st.held = mine.held; st.hover = mine.hover; }
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
      result: () => sim.result(),
    });

    return {
      update: (dt) => runner.update(dt),
      render: (g) => runner.render(g),
      takeOver(team) { ctls.delete(team); runner.dropSeat(team); sim.takeOver(team); },
      destroy: () => runner.destroy(),
      // for tests and the lab
      sim,
    };
  },
};
