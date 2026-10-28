// The pieces of the poke-engine parity kit that need no poke-engine: the scripted random source, the corpus, the replay check, how the
// oracle merges the damage rolls and reads the log. The comparison itself runs in tests/test_parity_poke_engine.py.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {importTeam, packTeam} from '../src/core.mjs';
import {masterState} from '../src/master.mjs';
import {HISTORY_ROLL, PIVOTS, ROLLS, Scripted, engineMove, modal, options, pick, replay, rngFrom} from '../parity/poke-engine/lib.mjs';
import {EDGES, edgeTeams} from '../parity/poke-engine/edges.mjs';
import {buildCorpus, edgeCases, randomCases} from '../parity/poke-engine/corpus.mjs';
import {canon, firstDiff, merge, observe, playCase} from '../parity/poke-engine/oracle.mjs';

test('the scripted source takes the likeliest result, the given damage roll and the longest duration', () => {
  const s = new Scripted({roll: 5});
  assert.equal(s.random(16), 5);
  assert.equal(s.random(100), 50);
  assert.equal(s.random(2, 5), 4);              // sleep and confusion turns: the longest
  assert.equal(s.randomChance(95, 100), true);   // a 95% move hits
  assert.equal(s.randomChance(10, 100), false);  // a 10% secondary effect does not happen
  assert.equal(s.randomChance(1, 24), false);    // no critical hit
  assert.equal(s.randomChance(1, 2), false);     // a tie takes the quiet result
  assert.equal(s.random(), 0.5);
});

function turnLog(edgeName, turnNo, roll, crit) {
  const c = edgeCases().find((x) => x.name.startsWith(`${edgeName} turn ${turnNo}`));
  assert.ok(c, edgeName);
  const b = replay(c);
  const from = b.log.length;
  b.prng = modal(b, roll, crit ?? c.crit);
  b.makeChoices(c.choice[0], c.choice[1]);
  return {c, b, log: b.log.slice(from).join('\n')};
}

test('a forced critical hit lands for the side asked, and only for it', () => {
  assert.match(turnLog('crit-p1', 1, 0).log, /\|-crit\|p2a/);
  assert.doesNotMatch(turnLog('crit-p1', 1, 0).log, /\|-crit\|p1a/);
  assert.match(turnLog('crit-p2', 1, 0).log, /\|-crit\|p1a/);
  const both = turnLog('crit-both', 1, 0).log;
  assert.match(both, /\|-crit\|p1a/);
  assert.match(both, /\|-crit\|p2a/);
  assert.doesNotMatch(turnLog('crit-p1', 1, 0, 'none').log, /\|-crit\|/);
});

test('the highest roll hits harder than the lowest', () => {
  const hi = turnLog('sun-fire-boost', 1, 0);
  const lo = turnLog('sun-fire-boost', 1, ROLLS - 1);
  assert.match(hi.log, /\|move\|p1a: Torkoal\|Flamethrower/);
  const venusaur = (t) => t.b.sides[1].pokemon.find((p) => p.species.id === 'venusaur').hp;
  assert.ok(venusaur(hi) < venusaur(lo), `${venusaur(hi)} < ${venusaur(lo)}`);
});

test('observe reads who hit first and the damage of every hit of a move from the log', () => {
  const t = turnLog('multihit-bullet-seed', 1, 0);
  const hp0 = [['p1', t.b.sides[0].pokemon[0].maxhp], ['p2', t.b.sides[1].pokemon[0].maxhp]];
  const start = 0;
  const seen = observe(t.b, start, hp0);
  assert.ok(seen.order === 'p1' || seen.order === 'p2');
  assert.ok(seen.damage.p1 > 0, JSON.stringify(seen));
});

test('merge: equal runs stay, numbers become an interval or a mean, anything else a list of results', () => {
  assert.deepEqual(merge([3, 3, 3]), 3);
  assert.deepEqual(merge([1, 2, 5]), {$range: [1, 5]});
  assert.deepEqual(merge(['par', null, 'par']), {$oneof: ['par', null]});
  assert.deepEqual(merge([{a: 1, b: 'x'}, {a: 2, b: 'x'}]), {a: {$range: [1, 2]}, b: 'x'});
  assert.deepEqual(merge([{x: 1}, {}]), {x: {$oneof: [1, null]}});
  // a hit point count: constant -> tolerance of one point; straight line -> its mean; a knock-out in between -> the interval
  assert.deepEqual(merge([{hp: 100}, {hp: 100}]).hp, {$approx: [100, 1.5]});
  const line = Array.from({length: 16}, (_, i) => ({hp: 200 - i * 2}));
  const m = merge(line).hp.$approx;
  assert.equal(m[0], 185);
  const kocked = Array.from({length: 16}, (_, i) => ({hp: i < 8 ? 0 : 5 * i}));
  assert.deepEqual(merge(kocked).hp, {$range: [0, 75]});
});

test('canon writes sorted keys without spaces; firstDiff names the first place two values differ', () => {
  assert.equal(canon({b: [1, {z: 1, a: null}], a: 'x'}), '{"a":"x","b":[1,{"a":null,"z":1}]}');
  assert.equal(firstDiff({a: {b: 1}}, {a: {b: 1}}), '');
  assert.match(firstDiff({a: {b: 1}}, {a: {b: 2}}), /^\.a\.b/);
});

test('the corpus is the same every time, holds both families and every case replays to its own state', () => {
  const a = buildCorpus({battles: 6, seed: 3, turns: 4});
  const b = buildCorpus({battles: 6, seed: 3, turns: 4});
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  assert.ok(a.some((c) => c.family === 'edge') && a.some((c) => c.family === 'random'));
  assert.equal(new Set(a.map((c) => c.id)).size, a.length);
  assert.ok(EDGES.length >= 40);
  for (const c of a.filter((x, i) => i % 7 === 0)) {
    assert.equal(firstDiff(JSON.parse(JSON.stringify(masterState(replay(c), 'p1'))), c.state), '', c.id);
    assert.ok(c.a && c.b, `${c.id} names both decisions for poke-engine`);
  }
});

test('random decisions are legal and avoid pivots and phazing', () => {
  const cases = randomCases({battles: 12, seed: 9, turns: 5});
  assert.ok(cases.length >= 30);
  for (const c of cases) {
    for (const move of [c.a, c.b]) assert.ok(!PIVOTS.has(move.replace(/-tera$/, '')), `${c.id} plays ${move}`);
    const b = replay(c);
    for (const [i, side] of [[0, 'p1'], [1, 'p2']]) {
      const o = options(b, side);
      assert.equal(o.kind, 'turn');
      const m = /^(move (\d))/.exec(c.choice[i]);
      if (m) assert.ok(o.moves.some((x) => x.n === Number(m[2])), `${c.id}: ${c.choice[i]} is legal`);
    }
  }
});

test('the oracle plays a case and writes order, damage and the summary after the turn', () => {
  const c = edgeCases().find((x) => x.name.startsWith('sun-fire-boost turn 1'));
  const out = playCase(c);
  assert.deepEqual(out.ev.map((e) => e[1]), ['order', 'damage.first', 'after']);
  assert.ok(out.ev[2][2].p1.hp.torkoal && out.ev[2][2].p2.hp.venusaur);
  assert.equal(canon(out), canon(JSON.parse(canon(out))));
  // a replay that drifts from the corpus state is refused rather than compared
  const drift = {...c, state: {...c.state, weather: 'rain'}};
  assert.throws(() => playCase(drift), /does not replay to the corpus state at \.weather/);
});

test('engineMove names moves, Terastallization and switches the way poke-engine does', () => {
  const c = edgeCases().find((x) => x.name.startsWith('stealth-rock-then-switch turn 2'));
  assert.equal(c.a, 'earthquake');
  assert.equal(c.b, c.state.side_two.pokemon[1].id);
  const t = edgeCases().find((x) => x.name.startsWith('tera-stab turn 1'));
  assert.equal(t.a, 'earthquake-tera');
  assert.equal(engineMove(t.state, 'side_one', 'move 1'), 'outrage');
});

test('the saved edge teams import and the history roll is the middle one', () => {
  for (const e of EDGES) {
    const teams = edgeTeams(e, importTeam, packTeam);
    assert.ok(teams.p1.length > 10 && teams.p2.length > 10, e.name);
  }
  assert.ok(HISTORY_ROLL > 0 && HISTORY_ROLL < ROLLS);
  assert.equal(typeof rngFrom([1, 2])(), 'number');
  assert.equal(typeof pick, 'function');
  assert.ok(readFileSync(new URL('../parity/poke-engine/edges.mjs', import.meta.url), 'utf8').length > 1000);
});
