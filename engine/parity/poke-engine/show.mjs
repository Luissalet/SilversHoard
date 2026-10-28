// What the simulator does in one case of the corpus, as its protocol log (to understand a divergence).
//
//   node engine/parity/poke-engine/show.mjs <inputs.jsonl> <case id> [roll 0..15]
//
// The turn is played exactly as the oracle plays it (likeliest result of every chance, the damage roll given: 0 is the highest).
import {readFileSync} from 'node:fs';
import {modal, replay} from './lib.mjs';

const [file, id, roll = '0'] = process.argv.slice(2);
if (!file || !id) { console.error('usage: node show.mjs <inputs.jsonl> <case id> [roll]'); process.exit(2); }
const row = readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).find((r) => r.id === id);
if (!row) { console.error(`no case ${id} in ${file}`); process.exit(2); }
const c = row.input;
const b = replay(c);
const from = b.log.length;
b.prng = modal(b, Number(roll), c.crit);
b.makeChoices(c.choice[0], c.choice[1]);
console.log(`${id}: ${c.name}; p1 "${c.choice[0]}" (${c.a}) vs p2 "${c.choice[1]}" (${c.b}); crit ${c.crit}; roll ${roll}`);
for (let i = from; i < b.log.length; i++) {
  if (b.log[i].startsWith('|split|')) { console.log(b.log[i + 1]); i += 2; } else console.log(b.log[i]);
}
