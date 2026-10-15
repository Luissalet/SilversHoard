// What real time reads from @pkmn/sim and what its battles come to, as digests. engine/test/rt-lite.test.mjs runs it twice:
// in its own process (the full @pkmn/sim) and in a child process with the app's real-time stubs (rt-lite-register.mjs), and
// the two must match. Run directly, it reads the battle specs as JSON on stdin and prints the result as JSON.
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {Dex} from '@pkmn/sim';
import {rtMove} from '../../src/realtime/moves.mjs';
import {rtFormatId, rtGen} from '../../src/realtime/team.mjs';
import {prepareRtTeam, rtRun} from '../../src/realtime/sim.mjs';
// the Pokémon Champions formats: the screen loads them before a battle in one of those formats (RtScreen), the engine at start
import '../../src/champions.mjs';

const hash = (v) => createHash('sha256').update(typeof v === 'string' ? v : JSON.stringify(v)).digest('hex');
// The descriptions are the one thing the stubs take out of the data objects (functions never reach JSON).
const noText = (k, v) => (k === 'desc' || k === 'shortDesc' ? undefined : v);

/** A digest of every entry of every table real time reads, per generation, in Dex order (Metronome draws from moves.all()). */
export function dexDigests() {
  const out = {};
  for (let gen = 1; gen <= 9; gen++) {
    const dex = Dex.forGen(gen);
    for (const table of ['species', 'moves', 'items', 'abilities', 'natures', 'types']) {
      const all = dex[table].all();
      out[`gen${gen}.${table}`] = `${all.length}:${hash(JSON.stringify(all, noText))}`;
    }
    out[`gen${gen}.rtMove`] = hash(dex.moves.all().map((m) => rtMove(m.id, gen)));
    const chart = [];
    for (const a of dex.types.names()) for (const b of dex.types.names()) chart.push(dex.getEffectiveness(a, b), dex.getImmunity(a, b));
    out[`gen${gen}.typechart`] = hash(chart);
  }
  out.formats = hash(Dex.formats.all().map((f) => {
    let id = '';
    try { id = rtFormatId(f.id); } catch (e) { id = `!${e.code}`; }
    return [f.id, f.exists, f.gen, f.gameType, id, id.startsWith('!') ? 0 : rtGen(id)];
  }));
  return out;
}

/** Each battle to the end: its summary, length and a digest of its events, and the teams as the screen gets them. */
export function battleDigests(specs) {
  return specs.map(({name, spec, inputs = []}) => {
    const b = rtRun(spec, {inputs});
    return {name, summary: b.summary(), ticks: b.t, events: b.events.length, digest: hash(b.events),
      teams: hash(['p1', 'p2'].map((p) => prepareRtTeam(spec[p].sets, {format: spec.format, levelRules: spec.level_rules})))};
  });
}

/** Whether this process loaded the stubbed @pkmn/sim (no learnsets, no descriptions). */
export const isLite = () => !Dex.moves.get('tackle').shortDesc && !Dex.species.getLearnsetData('pikachu').learnset;

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  let input = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) input += chunk;
  process.stdout.write(JSON.stringify({lite: isLite(), dex: dexDigests(), battles: battleDigests(JSON.parse(input))}));
}
