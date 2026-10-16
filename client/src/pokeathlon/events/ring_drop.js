// Ring Drop (Fuera del ring). Rules: ring_drop/sim.js (SPEC event 7). Drawing: ring_drop/view.js. This file glues them to the framework:
// stars to raw stats, the person's mouse / touch / keys / pad to the sim's commands, the single call to finish().
import { makeRand, clamp, norm } from "./_kit5/util.js";
import { EventRunner } from "./_kit5/runner.js";
import { RingDropSim } from "./ring_drop/sim.js";
import { RingDropView, toField } from "./ring_drop/view.js";

const raw = (stars) => clamp(Math.round((stars ?? 1) - 1), 0, 4);

export default {
  id: "ring_drop",
  names: { es: "Fuera del ring", en: "Ring Drop" },
  stats: ["stamina", "power", "speed", "jump"],
  seconds: 60,
  help: {
    es: "Mantén pulsado tu Pokémon y arrastra para que ande; un toque rápido lo hace saltar (cae como un martillo: +2) y un gesto rápido sobre él lo lanza a embestir (+1). Tirar a alguien fuera del ring da +10. Pulsa RELEVO con el Pokémon en tu esquina para cambiarlo. Teclado: WASD o flechas, Espacio salta, Shift o J embiste, Tab o Q relevo. Mando: palanca, A salta, B embiste, L/R relevo.",
    en: "Hold your Pokémon and drag to walk it; a quick tap makes it jump (it lands like a hammer: +2) and a quick flick on it sends it into a dash (+1). Knocking someone out of the ring gives +10. Press SWAP with the Pokémon in your corner to change it. Keyboard: WASD or arrows, Space jumps, Shift or J dashes, Tab or Q swaps. Pad: stick, A jumps, B dashes, L/R swap.",
  },

  create(ctx) {
    const rand = makeRand(ctx.rng);
    const human = ctx.teams.findIndex((t) => t.human);
    const stats = ctx.teams.map((t) => t.mons.map((m) => ({
      power: raw(m.stars?.power), speed: raw(m.stars?.speed), jump: raw(m.stars?.jump), stamina: raw(m.stars?.stamina),
    })));
    const sim = new RingDropSim({ stats, rand, human });
    const st = { you: human, keys: false, touching: false, touchPos: [0, 0], face: [1, 0] };
    const view = new RingDropView(ctx, sim, st);
    let walking = false;        // keys moved the Pokémon in the previous step (one more step to stop it)

    const step = (inp, run) => {
      const cmd = {};
      if (human >= 0) {
        const p = sim.parts[human];
        const t = run.touch;
        const [fx, fy] = toField(t.touchX, t.touchY);
        cmd.touch = { down: t.touching, x: Math.round(clamp(fx, 0, 255)), y: Math.round(clamp(fy, 0, 191)) };
        st.touching = t.touching;
        st.touchPos = [cmd.touch.x, cmd.touch.y];
        if (t.touchNew) st.keys = false;
        // keyboard and pad: walk, jump, dash, swap
        const d = inp.dir;
        const jump = inp.pressed("Space", "Enter", "KeyF") || inp.padPressed(0);
        const dash = inp.pressed("ShiftLeft", "ShiftRight", "KeyJ") || inp.padPressed(1, 2, 3);
        const swap = inp.pressed("Tab", "KeyQ") || inp.padPressed(4, 5, 6, 7);
        if (d.x || d.y || jump || dash || swap) st.keys = true;
        if (st.keys || walking) {
          const act = {};
          if (d.x || d.y) {
            const [nx, ny] = norm(d.x, d.y);
            st.face = [nx, ny];
            act.dest = [p.pos[0] + nx * 14, p.pos[1] + ny * 14];
            walking = true;
          } else if (walking) {
            act.dest = [p.pos[0], p.pos[1]];
            walking = false;
          }
          if (jump) act.jump = true;
          if (dash) {
            // towards where the person points (or faces); an opponent close to that line gets the dash aimed at it
            let [ax, ay] = d.x || d.y ? norm(d.x, d.y) : st.face;
            let best = null, bestCos = 0.82;
            for (const o of sim.parts) {
              if (o === p || o.state === 3 || o.switching) continue;
              const dx = o.pos[0] - p.pos[0], dy = o.pos[1] - p.pos[1];
              const dd = Math.hypot(dx, dy);
              if (dd < 1 || dd > 90) continue;
              const cos = (dx * ax + dy * ay) / dd;
              if (cos > bestCos) { bestCos = cos; best = o; }
            }
            act.dash = best ? [best.pos[0], best.pos[1]] : [p.pos[0] + ax * 50, p.pos[1] + ay * 50];
          }
          if (swap) act.swap = true;
          cmd.act = act;
        }
      }
      sim.step(cmd);
      view.onEvents(sim.events, run);
    };

    const result = () => {
      const detail = sim.parts.map((p) => ({ points: p.score, mons: p.members.map((m) => ({ ...m.c })) }));
      return { raw: sim.parts.map((p) => p.score), detail };
    };

    const runner = new EventRunner(ctx, {
      step,
      render: (g, a, run) => view.render(g, a, run),
      visual: (dt) => view.update(dt),
      isOver: () => sim.over,
      idle: (run) => { if (run.endNo === 1) run.sfx("end"); },
      result,
    });
    return { update: (dt) => runner.update(dt), render: (g) => runner.render(g), destroy: () => runner.destroy(), sim };
  },
};
