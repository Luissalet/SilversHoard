// Goal Roll (Metegoles). Rules: goal_roll/sim.js (SPEC event 9). Drawing: goal_roll/view.js. This file glues them to the framework: stars to
// raw stats, the person's mouse / touch / keys / pad to the sim's commands, the single call to finish().
import { makeRand, clamp, norm, dist } from "./_kit5/util.js";
import { EventRunner } from "./_kit5/runner.js";
import { GoalRollSim, MODE, TOUCH_RADIUS } from "./goal_roll/sim.js";
import { GoalRollView, toField } from "./goal_roll/view.js";

const raw = (stars) => clamp(Math.round((stars ?? 1) - 1), 0, 4);

export default {
  id: "goal_roll",
  names: { es: "Metegoles", en: "Goal Roll" },
  stats: ["skill", "power", "stamina", "speed"],
  seconds: 90,
  help: {
    es: "Pulsa cerca de uno de tus Pokémon y arrastra para llevarlo; un gesto rápido que termine más allá del balón lo lanza a embestir y patearlo. El gol cuenta para el equipo que tocó el balón el último y quita un punto al dueño de la portería; los autogoles también restan. En los últimos 30 segundos sale un segundo balón. Teclado: 1-3 eligen, WASD o flechas andan, Espacio o Shift embisten, Tab cambia. Mando: palanca, A embiste, L/R cambian.",
    en: "Press near one of your Pokémon and drag to steer it; a quick swipe that ends beyond the ball sends it into a dash and kicks it. A goal counts for the team that touched the ball last and takes a point from the owner of the goal; own goals cost you. A second ball comes out in the last 30 seconds. Keyboard: 1-3 choose, WASD or arrows walk, Space or Shift dash, Tab switches. Pad: stick, A dashes, L/R switch.",
  },

  create(ctx) {
    const rand = makeRand(ctx.rng);
    const humans = ctx.humans();
    const human = humans.includes(ctx.focus) ? ctx.focus : -1;   // the person at this screen (-1: a spectator, or nobody plays)
    const stats = ctx.teams.map((t) => t.mons.map((m) => ({
      power: raw(m.stars?.power), speed: raw(m.stars?.speed), stamina: raw(m.stars?.stamina), skill: raw(m.stars?.skill),
    })));
    const sim = new GoalRollSim({ stats, rand, humans });
    const st = { you: human, sel: 0, keys: false, touching: false, touchPos: [0, 0], hover: -1, auto: true };
    const view = new GoalRollView(ctx, sim, st);
    const ctls = new Map(humans.map((t) => [t, { team: t, sel: 0, keys: false, touching: false, touchPos: [0, 0], hover: -1, auto: true, walking: false }]));

    const nearestBall = (pos) => {
      let best = null, bd = 1e9;
      for (const b of sim.balls) {
        if (!b.inPlay) continue;
        const d = dist(pos, b.pos);
        if (d < bd) { bd = d; best = b; }
      }
      return best;
    };

    const commandOf = (inp, c) => {
      const cmd = {};
      const team = c.team;
      const t = inp.touch;
      const [fx, fy] = toField(t.touchX, t.touchY);
      cmd.touch = { down: t.touching, x: Math.round(fx), y: Math.round(fy) };
      c.touching = t.touching;
      c.touchPos = [cmd.touch.x, cmd.touch.y];
      if (t.touchNew) c.keys = false;
      // which of my Pokémon a press would pick (hover)
      c.hover = -1;
      if (!t.touching && !c.keys) {
        const [hx, hy] = toField(t.x, t.y);
        let bd = TOUCH_RADIUS + 1;
        for (let k = 0; k < 3; k++) {
          const m = sim.mons[team * 3 + k];
          const d = Math.hypot(m.pos[0] - hx, m.pos[1] - hy);
          if (d < bd) { bd = d; c.hover = k; }
        }
      }
      // keyboard and pad
      const pick = (n) => { c.sel = ((n % 3) + 3) % 3; c.keys = true; c.auto = false; };
      if (inp.pressed("Digit1", "Numpad1")) pick(0);
      if (inp.pressed("Digit2", "Numpad2")) pick(1);
      if (inp.pressed("Digit3", "Numpad3")) pick(2);
      if (inp.pressed("KeyQ") || inp.padPressed(4)) pick(c.sel - 1);
      if (inp.pressed("KeyE", "Tab") || inp.padPressed(5)) pick(c.sel + 1);
      const d = inp.dir;
      const dash = inp.pressed("Space", "ShiftLeft", "ShiftRight", "KeyJ") || inp.padPressed(0, 1);
      const moving = d.x || d.y;
      if (moving || dash) c.keys = true;
      const keys = [];
      if (c.keys) {
        // with no explicit choice the Pokémon closest to a ball is the one the keys steer
        if (c.auto && (moving || dash)) {
          let best = c.sel, bd = 1e9;
          for (let k = 0; k < 3; k++) {
            const m = sim.mons[team * 3 + k];
            if (m.mode === MODE.STUNNED) continue;
            const b = nearestBall(m.pos);
            const dd = b ? dist(m.pos, b.pos) : 1e9;
            if (dd < bd) { bd = dd; best = k; }
          }
          c.sel = best;
        }
        const m = sim.mons[team * 3 + c.sel];
        let face = m.facing;
        if (moving) {
          face = norm(d.x, d.y);
          keys.push({ type: "walk", slot: c.sel, target: [m.pos[0] + face[0] * 14, m.pos[1] + face[1] * 14] });
          c.walking = true;
        } else if (c.walking) {
          keys.push({ type: "walk", slot: c.sel, target: [m.pos[0], m.pos[1]] });
          c.walking = false;
        }
        if (dash) {
          // a dash of fixed length: through the ball when one lies ahead, 40 px otherwise
          let target = [m.pos[0] + face[0] * 40, m.pos[1] + face[1] * 40];
          for (const b of sim.balls) {
            if (!b.inPlay) continue;
            const dx = b.pos[0] - m.pos[0], dy = (b.pos[1] - (m.pos[1] + 5));
            const dd = Math.hypot(dx, dy);
            if (dd > 1 && dd < 60 && (dx * face[0] + dy * face[1]) / dd > 0.75) { target = [b.pos[0] + (dx / dd) * 10, b.pos[1] + (dy / dd) * 10]; break; }
          }
          keys.push({ type: "dash", slot: c.sel, target });
        }
      }
      if (keys.length) cmd.keys = keys;
      return cmd;
    };

    const step = (inp, run, seats) => {
      const cmds = {};
      for (const [team, c] of ctls) cmds[team] = commandOf(seats ? seats.get(team) : inp, c);
      const mine = ctls.get(human);
      if (mine) { st.sel = mine.sel; st.keys = mine.keys; st.auto = mine.auto; st.touching = mine.touching; st.touchPos = mine.touchPos; st.hover = mine.hover; }
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
