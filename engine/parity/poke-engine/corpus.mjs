// The corpus of the poke-engine parity kit: one case per turn. Random battles of the 9th generation (seeded teams, seeded decisions,
// terastallization and switches included) plus the hand-written edge cases (edges.mjs).
//
//   node engine/parity/poke-engine/corpus.mjs <out.jsonl> [--battles 220] [--seed 1] [--turns 6]
//
// Every case holds what the two engines need: `state` and the decisions `a`/`b` for poke-engine (exactly what the master AI builds from
// the live battle, engine/src/master.mjs), and `format`, `seed`, `teams`, `history`, `choice` and `crit` to replay the turn in the simulator.
import {createWriteStream, writeFileSync} from 'node:fs';
import {importTeam, packTeam, randomTeam} from '../../src/core.mjs';
import {masterState} from '../../src/master.mjs';
import {HISTORY_ROLL, category, engineMove, modal, options, pick, replay, rngFrom} from './lib.mjs';
import {EDGES, edgeTeams} from './edges.mjs';

function flags(state, c1, c2, a, b) {
  if (!a || !b || !/^move /.test(c1) || !/^move /.test(c2)) return {order: false, damage_p1: false, damage_p2: false};
  const dmg1 = category(a.replace(/-tera$/, '')) !== 'Status';
  const dmg2 = category(b.replace(/-tera$/, '')) !== 'Status';
  return {order: dmg1 && dmg2, damage_p1: dmg1, damage_p2: dmg2};
}

function makeCase(id, family, name, spec, b, history, c1, c2, crit) {
  const state = masterState(b, 'p1');
  const a = engineMove(state, 'side_one', c1);
  const d = engineMove(state, 'side_two', c2);
  return {id, family, name, format: spec.format, seed: spec.seed, teams: spec.teams, modal: !!spec.modal, history: history.map((h) => [...h]), choice: [c1, c2], crit,
    a, b: d, ends: false, flags: flags(state, c1, c2, a, d), state};
}

/** Random battles: each is played with seeded random legal decisions and every ordinary turn is recorded. */
export function randomCases({battles = 220, seed = 1, turns = 6} = {}) {
  const out = [];
  for (let k = 0; k < battles; k++) {
    const t1 = randomTeam('gen9randombattle', `pe-${seed}-${k}-a`);
    const t2 = randomTeam('gen9randombattle', `pe-${seed}-${k}-b`);
    const spec = {format: 'gen9customgame', seed: [1 + k, 7 + seed, 31 + k * 3, 101 + seed * 5], teams: {p1: packTeam(t1.sets), p2: packTeam(t2.sets)}};
    const rng = rngFrom([seed, k]);
    const b = replay({...spec, history: []});
    const history = [];
    let recorded = 0;
    for (let step = 0; step < 60 && recorded < turns && !b.ended; step++) {
      const o1 = options(b, 'p1');
      const o2 = options(b, 'p2');
      if (o1.kind === 'none' && o2.kind === 'none') break;
      if (o1.kind === 'turn' && o2.kind === 'turn') {
        const c1 = pick(b, 'p1', rng);
        const c2 = pick(b, 'p2', rng);
        if (/^default$/.test(c1) || /^default$/.test(c2)) break;
        recorded++;
        out.push(makeCase(`r${String(k).padStart(3, '0')}t${recorded}`, 'random', `battle ${k} turn ${recorded}`, spec, b, history, c1, c2, 'none'));
        b.makeChoices(c1, c2);
        history.push([c1, c2]);
        out[out.length - 1].ends = b.ended;     // a turn that ends the battle skips the end-of-turn effects poke-engine plays
      } else {
        const c1 = o1.kind === 'switch' ? pick(b, 'p1', rng) : '';
        const c2 = o2.kind === 'switch' ? pick(b, 'p2', rng) : '';
        b.makeChoices(c1, c2);
        history.push([c1, c2]);
      }
    }
  }
  return out;
}

/** The edge cases: one case per scripted turn. */
export function edgeCases() {
  const out = [];
  EDGES.forEach((edge, n) => {
    const spec = {format: 'gen9customgame', seed: [11 + n, 22, 33, 44], modal: true, teams: edgeTeams(edge, importTeam, packTeam)};
    const b = replay({...spec, history: []});
    const history = [];
    edge.turns.forEach(([c1, c2, crit], i) => {
      if (b.ended || options(b, 'p1').kind !== 'turn' || options(b, 'p2').kind !== 'turn') return;
      out.push(makeCase(`e${String(n).padStart(3, '0')}t${i + 1}`, 'edge', `${edge.name} turn ${i + 1}`, spec, b, history, c1, c2, crit));
      try {
        b.prng = modal(b, HISTORY_ROLL, crit);
        b.makeChoices(c1, c2);
      } catch (e) {
        throw new Error(`edge "${edge.name}" turn ${i + 1}: ${e.message}; p1 ${JSON.stringify(b.sides[0].activeRequest?.active?.[0]?.moves?.map((m) => m.id))} `
          + `choice "${c1}", p2 ${JSON.stringify(b.sides[1].activeRequest?.active?.[0]?.moves?.map((m) => m.id))} choice "${c2}"`);
      }
      history.push([c1, c2, crit]);
      out[out.length - 1].ends = b.ended;
    });
  });
  return out;
}

export function buildCorpus(opts = {}) {
  return [...edgeCases(), ...randomCases(opts)];
}

function main() {
  const args = process.argv.slice(2);
  const out = args.find((a) => !a.startsWith('--'));
  const flag = (name, d) => { const i = args.indexOf(`--${name}`); return i >= 0 ? Number(args[i + 1]) : d; };
  if (!out) { console.error('usage: node corpus.mjs <out.jsonl> [--battles N] [--seed N] [--turns N]'); process.exit(2); }
  const cases = buildCorpus({battles: flag('battles', 220), seed: flag('seed', 1), turns: flag('turns', 6)});
  const stream = createWriteStream(out);
  for (const c of cases) stream.write(JSON.stringify({id: c.id, input: c}) + '\n');
  stream.end(() => console.log(`${cases.length} cases (${cases.filter((c) => c.family === 'edge').length} edge) -> ${out}`));
}

if (import.meta.url === new URL(`file:///${process.argv[1].replace(/\\/g, '/')}`).href || process.argv[1]?.endsWith('corpus.mjs')) main();
