// Why the AI chose: traces of its decisions (options with expected damage and KOs, the threat on it, the expert's play-outs),
// notes kept per battle, advice for a person's side, and tracing never changing a choice.
import test from 'node:test';
import assert from 'node:assert/strict';
import {Battle} from '@pkmn/sim';
import {importTeam, packTeam} from '../src/core.mjs';
import {chooseFor, makeRng} from '../src/ai.mjs';
import {Match} from '../src/match.mjs';
import {playOut} from '../src/stats.mjs';
import {handle} from '../src/server.mjs';

const MINE = 'Garchomp\nAbility: Rough Skin\nEVs: 252 Atk / 252 Spe\nJolly Nature\n- Earthquake\n- Dragon Claw\n- Swords Dance\n- Stone Edge\n\n'
  + 'Lucario\nEVs: 252 SpA\n- Aura Sphere\n- Flash Cannon';
const THEIRS = 'Heatran\nEVs: 4 HP\n- Flamethrower\n- Earth Power\n\nBlissey\n- Seismic Toss';

function battle() {
  const b = new Battle({formatid: 'gen9customgame', seed: [1, 2, 3, 4]});
  b.setPlayer('p1', {name: 'A', team: packTeam(importTeam(MINE))});
  b.setPlayer('p2', {name: 'B', team: packTeam(importTeam(THEIRS))});
  b.makeChoices('default', 'default');
  return b;
}

test('a trace says what each option does and never changes the choice', () => {
  for (const level of ['normal', 'hard', 'expert']) {
    const plain = chooseFor(battle(), 'p1', {level, rng: makeRng(7)});
    const trace = {};
    const traced = chooseFor(battle(), 'p1', {level, rng: makeRng(7), trace});
    assert.equal(traced, plain, level);
    assert.equal(trace.choice, plain);
    assert.equal(trace.kind, 'turn');
    const slot = trace.slots[0];
    assert.equal(slot.mon, 'Garchomp');
    const eq = slot.options.find((o) => o.name === 'Earthquake');
    assert.ok(eq && eq.target === 'Heatran' && eq.ko && eq.dmg === 1, JSON.stringify(eq));
    assert.ok(slot.options.some((o) => o.kind === 'switch' && o.species === 'Lucario' && typeof o.take === 'number'));
    assert.equal(slot.threat.foe, 'Heatran');
    assert.ok(slot.picked.name, JSON.stringify(slot.picked));
    if (level === 'expert') {
      assert.ok(trace.playouts.length >= 2);
      assert.ok(trace.playouts[0].label && typeof trace.playouts[0].worst === 'number');
    }
  }
});

test('a traced match keeps one note per AI decision and hands each out once', () => {
  const m = new Match({format: 'gen9customgame', seed: '1,2,3,4', trace: true,
    p1: {name: 'A', sets: importTeam(MINE), ai: {level: 'hard'}}, p2: {name: 'B', sets: importTeam(THEIRS), ai: {level: 'expert'}}});
  m.advance(1);   // team preview
  const first = m.takeNotes();
  assert.ok(first.length >= 2);
  assert.deepEqual(m.takeNotes(), []);
  m.advance();
  const rest = m.takeNotes();
  assert.ok(rest.length > 0);
  const all = [...first, ...rest];
  assert.ok(all.every((n) => ['turn', 'switch_in', 'preview'].includes(n.kind) && n.choice));
  assert.ok(all.some((n) => n.side === 'p2' && n.level === 'expert' && n.playouts.length));
  const plain = playOut({format: 'gen9customgame', seed: '1,2,3,4', p1: {name: 'A', sets: importTeam(MINE), ai: {level: 'hard'}},
    p2: {name: 'B', sets: importTeam(THEIRS), ai: {level: 'expert'}}});
  const traced = playOut({format: 'gen9customgame', seed: '1,2,3,4', trace: true, p1: {name: 'A', sets: importTeam(MINE), ai: {level: 'hard'}},
    p2: {name: 'B', sets: importTeam(THEIRS), ai: {level: 'expert'}}});
  assert.equal(plain.notes, undefined);
  const moves = (r) => r.lines.filter((l) => !l.startsWith('|t:|'));
  assert.deepEqual(moves(traced), moves(plain));       // the same battle, move by move
  assert.ok(traced.notes.length >= all.length - 1);
});

test('advice for a person\'s side of a live battle', async () => {
  const spec = {id: 'adv1', format: 'gen9customgame', seed: '1,2,3,4', trace: true,
    p1: {name: 'Me', sets: importTeam(MINE), ai: null}, p2: {name: 'B', sets: importTeam(THEIRS), ai: {level: 'hard'}}};
  const start = await handle({id: 1, cmd: 'match_start', args: {spec}});
  assert.ok(start.ok, JSON.stringify(start.error));
  const preview = await handle({id: 9, cmd: 'match_advice', args: {id: 'adv1', side: 'p1'}});
  assert.equal(preview.result.advice.kind, 'preview');
  assert.ok((await handle({id: 10, cmd: 'match_choose', args: {id: 'adv1', side: 'p1', choice: 'default'}})).ok);
  const adv = await handle({id: 2, cmd: 'match_advice', args: {id: 'adv1', side: 'p1'}});
  assert.ok(adv.ok, JSON.stringify(adv.error));
  assert.equal(adv.result.advice.side, 'p1');
  assert.equal(adv.result.advice.level, 'expert');
  assert.ok(adv.result.advice.slots[0].options.length > 1);
  const choose = await handle({id: 3, cmd: 'match_choose', args: {id: 'adv1', side: 'p1', choice: 'move 1'}});
  assert.ok(choose.ok, JSON.stringify(choose.error));
  assert.ok(Array.isArray(choose.result.notes));
});
