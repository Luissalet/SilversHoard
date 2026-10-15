// Test helper: plays a real-time battle with a scripted "person" in the first seat, the way the playable page records one, and prints
// what a result code needs: the input log, the tick it ended at, the winner, and the log packed by the page's own packer.
// stdin: {spec, bot: "attack" | "idle", maxSeconds}. stdout: {rows, tick, winner_side, packed}.
import {RtBattle, TPS} from '../engine/src/realtime/sim.mjs';
import {packRtInputs} from '../client/src/play/rtcode.js';

let text = '';
for await (const chunk of process.stdin) text += chunk;
const {spec, bot = 'attack', maxSeconds = 0} = JSON.parse(text);

const b = new RtBattle(spec);
const limit = (maxSeconds || b.timeLimit / TPS + 5) * TPS;
let tick = 0;
while (!b.ended && tick < limit) {
  tick++;
  const me = b.sides[0];
  const foe = b.sides[1];
  let input = {mx: 0, my: 0, use: -1, dodge: false, sw: -1, focus: true};
  if (bot === 'attack') {
    // walk at the foe and use whatever is ready, one move every few ticks; replace a fainted Pokémon
    const dx = foe.x - me.x;
    const dy = foe.y - me.y;
    input = {mx: Math.sign(dx), my: Math.abs(dy) > 1 ? Math.sign(dy) * 0.5 : 0, use: tick % 6 === 0 ? (tick / 6) % 4 : -1, dodge: tick % 200 === 0, sw: -1, focus: true};
    if (me.need) input.sw = me.mons.findIndex((m) => !m.fainted);
  } else if (me.need) {
    input.sw = me.mons.findIndex((m) => !m.fainted);
  }
  b.step({p1: input});
}
process.stdout.write(JSON.stringify({rows: b.inputLog, tick: b.t, winner_side: b.summary().winner_side, ended: b.ended, packed: await packRtInputs(b.inputLog)}));
