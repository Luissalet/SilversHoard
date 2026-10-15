// The app's real-time chunk bundles @pkmn/sim without learnsets, legality tables and descriptions (engine/scripts/rt_lite.mjs).
// These tests load that same stubbed @pkmn/sim in a child process and check that real time cannot tell: every species, move,
// item, ability, nature, type matchup and format it can read is the same, and AI-vs-AI battles in every generation, singles and
// doubles, rules versions 1 to 3, plus the recorded replays, end with the same summaries and the same events.
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {importTeam, randomTeam} from '../src/core.mjs';
import {battleDigests, dexDigests, isLite} from './fixtures/rt-lite-runner.mjs';
import {RT_LITE_STUBS, rtLiteStub} from '../scripts/rt_lite.mjs';

const RUNNER = fileURLToPath(new URL('./fixtures/rt-lite-runner.mjs', import.meta.url));
const REGISTER = new URL('./fixtures/rt-lite-register.mjs', import.meta.url).href;

const MEGA = 'Charizard @ Charizardite X\nAbility: Blaze\nEVs: 252 Atk / 252 Spe\nJolly Nature\n- Flare Blitz\n- Dragon Claw\n- Earthquake\n- Swords Dance\n\n' +
  'Lucario @ Lucarionite\nAbility: Justified\n- Aura Sphere\n- Flash Cannon\n- Close Combat\n- Extreme Speed\n\n' +
  'Rayquaza\nAbility: Air Lock\n- Dragon Ascent\n- Extreme Speed\n- Earthquake\n- Dragon Dance\n';
const METRONOME = 'Clefable @ Leftovers\nAbility: Magic Guard\n- Metronome\n- Moonblast\n- Soft-Boiled\n- Thunder Wave\n\n' +
  'Togekiss @ Choice Scarf\nAbility: Serene Grace\n- Metronome\n- Air Slash\n- Follow Me\n- Helping Hand\n';
const OLD_METRONOME = 'Clefable @ Leftovers\n- Metronome\n- Body Slam\n- Soft-Boiled\n- Thunder Wave\n\n' +
  'Chansey @ Leftovers\n- Metronome\n- Seismic Toss\n- Soft-Boiled\n- Ice Beam\n';
const LEVELS = ['random', 'easy', 'normal', 'hard', 'expert'];
const STYLES = ['balanced', 'aggressive', 'defensive'];

function specs() {
  const out = [];
  const ai = (i) => ({level: LEVELS[i % LEVELS.length], style: STYLES[i % STYLES.length]});
  const side = (name, sets, i) => ({name, sets, ai: ai(i)});
  for (let gen = 1; gen <= 9; gen++) {
    const fmt = `gen${gen}randombattle`;
    out.push({name: `gen ${gen} singles`, spec: {seed: `lite-${gen}`, version: 1 + (gen % 3), arena: gen % 2 ? 'rocks' : 'open',
      format: `gen${gen}customgame`, time_limit: 120, p1: side('A', randomTeam(fmt, `la${gen}`).sets, gen),
      p2: side('B', randomTeam(fmt, `lb${gen}`).sets, gen + 2)}});
  }
  for (const gen of [9, 8]) {
    const fmt = `gen${gen}randomdoublesbattle`;
    for (const version of [3, 2]) {
      out.push({name: `gen ${gen} doubles v${version}`, spec: {seed: `lite-d${gen}${version}`, version, arena: 'rocks',
        format: `gen${gen}doublescustomgame`, time_limit: 120, p1: side('A', randomTeam(fmt, `lda${gen}`).sets, gen),
        p2: side('B', randomTeam(fmt, `ldb${gen}`).sets, gen + 1)}});
    }
  }
  out.push({name: 'gen 6 doubles v3 with Megas and Follow Me', spec: {seed: 'lite-d6', version: 3, arena: 'open', format: 'gen6doublescustomgame',
    time_limit: 120, p1: side('M', importTeam(MEGA), 4), p2: side('T', importTeam(METRONOME), 3)}});
  out.push({name: 'gen 7 Megas v2', spec: {seed: 'lite-m7', version: 2, arena: 'rocks', format: 'gen7customgame', time_limit: 120,
    level_rules: {level: 50}, p1: side('M', importTeam(MEGA), 4), p2: side('T', importTeam(METRONOME), 1)}});
  out.push({name: 'gen 4 Metronome v1', spec: {seed: 'lite-m4', version: 1, format: 'gen4customgame', time_limit: 120,
    p1: side('C', importTeam(OLD_METRONOME), 2), p2: side('D', importTeam(METRONOME), 3)}});
  out.push({name: 'gen 1 Metronome v3', spec: {seed: 'lite-m1', version: 3, arena: 'rocks', format: 'gen1customgame', time_limit: 120,
    p1: side('C', importTeam(OLD_METRONOME), 4), p2: side('D', randomTeam('gen1randombattle', 'lm1').sets, 0)}});
  // the recorded replays, people's inputs included
  for (const file of ['rt-legacy-v1.json', 'rt-v2.json']) {
    const fixture = JSON.parse(readFileSync(new URL(`./fixtures/${file}`, import.meta.url), 'utf8'));
    for (const rec of fixture.battles) out.push({name: `${file}: ${rec.name}`, spec: rec.spec, inputs: rec.inputs, recorded: rec});
  }
  return out;
}

function liteRun(list) {
  const res = spawnSync(process.execPath, ['--import', REGISTER, RUNNER], {input: JSON.stringify(list), encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024});
  assert.equal(res.status, 0, res.stderr);
  return JSON.parse(res.stdout);
}

test('rt-lite: the stubs cover only learnsets, legality, Pokémon GO data and descriptions', () => {
  for (const [path, src] of Object.entries(RT_LITE_STUBS)) {
    assert.match(path, /^data\/(mods\/gen\w+\/)?(learnsets|legality|pokemongo|text\/\w+)\.mjs$/);
    assert.match(src, /^export const (Learnsets|Legality|PokemonGoData|\w+Text) = \{\};$/);
  }
  assert.equal(rtLiteStub('/x/node_modules/@pkmn/sim/build/esm/data/learnsets.mjs'), RT_LITE_STUBS['data/learnsets.mjs']);
  assert.equal(rtLiteStub('/x/node_modules/@pkmn/sim/build/esm/data/moves.mjs'), null);
  assert.equal(rtLiteStub('/x/node_modules/@pkmn/sim/build/esm/data/mods/gen8bdsp/moves.mjs'), null);
});

test('rt-lite: real time reads the same data and plays the same battles with and without the stubs', () => {
  const list = specs();
  const lite = liteRun(list);
  assert.equal(isLite(), false, 'this process has the full @pkmn/sim');
  assert.equal(lite.lite, true, 'the child process has the stubbed @pkmn/sim');
  const full = dexDigests();
  assert.deepEqual(Object.keys(lite.dex), Object.keys(full));
  for (const key of Object.keys(full)) assert.equal(lite.dex[key], full[key], `${key}: the same data`);
  const battles = battleDigests(list);
  assert.equal(lite.battles.length, list.length);
  const gens = new Set();
  for (const [i, b] of battles.entries()) {
    const l = lite.battles[i];
    assert.equal(l.name, b.name);
    assert.deepEqual(l.summary, b.summary, `${b.name}: the same summary`);
    assert.equal(l.ticks, b.ticks, `${b.name}: the same length`);
    assert.equal(l.events, b.events, `${b.name}: the same number of events`);
    assert.equal(l.digest, b.digest, `${b.name}: the same events`);
    assert.equal(l.teams, b.teams, `${b.name}: the same teams on the screen`);
    assert.ok(b.events > 20, `${b.name}: a real battle`);
    const rec = list[i].recorded;
    if (rec) assert.equal(b.digest, rec.digest, `${b.name}: the recorded events`);
    gens.add(list[i].spec.format.slice(0, 4));
  }
  assert.equal(gens.size, 9, 'every generation');
});
