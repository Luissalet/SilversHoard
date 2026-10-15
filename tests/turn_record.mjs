// Test helper: plays a turn-based battle the way the playable page does (a Match without a seed, the AI in the second seat, a
// scripted person in the first that always uses its first usable move, or forfeits) and prints what the page puts in a result
// stage. stdin: {format, level_rules, p1: {name, sets}, p2: {name, sets, ai}, forfeit}. stdout: {input, rng, winner_side, turns}.
import {Match} from '../engine/src/match.mjs';

let text = '';
for await (const chunk of process.stdin) text += chunk;
const a = JSON.parse(text);
const m = new Match({...(a.seed ? {id: a.seed, seed: a.seed} : {}), format: a.format, level_rules: a.level_rules || {}, p1: {name: a.p1.name, sets: a.p1.sets, ai: null},
  p2: {name: a.p2.name, sets: a.p2.sets, ai: a.p2.ai}});
m.advance();
for (let n = 0; n < 600 && !m.battle.ended; n++) {
  if (a.forfeit && n === 1) { m.forfeit('p1'); break; }
  const req = m.battle.sides[0].activeRequest;
  const usable = req?.active?.[0]?.moves?.findIndex((x) => !x.disabled);
  m.choose('p1', req?.active && usable >= 0 ? `move ${usable + 1}` : 'default');
}
const st = m.state();
process.stdout.write(JSON.stringify({input: m.inputLog(), rng: m.id, winner_side: st.winner_side, turns: m.battle.turn}));
