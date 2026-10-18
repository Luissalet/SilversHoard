// Historical RT log names after a seek: format from events with tracked actives, not the current seat.active.
import test from 'node:test';
import assert from 'node:assert/strict';
import {buildBattleLog, freshActives, logLine} from '../../client/src/battle/rt/rt-log.js';

const tr = (k, vars = {}) => ({
  rt_crit: 'critical hit', rt_super: 'super effective', rt_weak: 'not very effective',
  rt_ult: 'Ultimate', rt_winner: `${vars.name} won`, rt_tie: 'Tie',
}[k] || k);

function battleStub(mons0, mons1, {active0 = 0, active1 = 0} = {}) {
  return {
    doubles: false,
    sides: [
      {name: 'Red', active: active0, mons: mons0},
      {name: 'Blue', active: active1, mons: mons1},
    ],
    dex: {
      moves: {get: (id) => ({exists: true, name: id})},
      items: {get: () => ({exists: false})},
      abilities: {get: (id) => ({exists: true, name: id})},
    },
  };
}

test('seek after a switch keeps earlier windup names (Froslass not Roserade)', () => {
  // battle ended with Roserade / Quagsire active; historical windups were Froslass / Nidoking
  const b = battleStub(
    [{name: 'Froslass', species: 'Froslass'}, {name: 'Roserade', species: 'Roserade'}],
    [{name: 'Nidoking', species: 'Nidoking'}, {name: 'Quagsire', species: 'Quagsire'}],
    {active0: 1, active1: 1},
  );
  const events = [
    {t: 0, k: 'switch', s: 0, slot: 0},
    {t: 0, k: 'switch', s: 1, slot: 0},
    {t: 30, k: 'windup', s: 0, name: 'Triple Axel', move: 'tripleaxel', type: 'Ice'},
    {t: 60, k: 'windup', s: 1, name: 'Earth Power', move: 'earthpower', type: 'Ground'},
    {t: 120, k: 'recall', s: 0, slot: 0, left: 2},
    {t: 121, k: 'switch', s: 0, slot: 1},
    {t: 180, k: 'recall', s: 1, slot: 0, left: 2},
    {t: 181, k: 'switch', s: 1, slot: 1},
    {t: 200, k: 'windup', s: 0, name: 'Sludge Bomb', move: 'sludgebomb', type: 'Poison'},
  ];

  // bug baseline: formatting each event against the *current* actives mislabels history
  const broken = events.map((e) => logLine(e, b, 'en', tr)).filter(Boolean);
  assert.ok(broken.some((l) => l.text.includes("Roserade") && l.text.includes('Triple Axel')),
    'without historical actives, Triple Axel is attributed to the current mon');

  const lines = buildBattleLog(events, b, 'en', tr, freshActives());
  const texts = lines.map((l) => l.text);
  assert.ok(texts.some((t) => t.includes("Red's Froslass used Triple Axel")), texts.join(' | '));
  assert.ok(texts.some((t) => t.includes("Blue's Nidoking used Earth Power")), texts.join(' | '));
  assert.ok(texts.some((t) => t.includes("Red's Roserade used Sludge Bomb")), texts.join(' | '));
  assert.ok(!texts.some((t) => t.includes('Roserade') && t.includes('Triple Axel')));
  assert.ok(!texts.some((t) => t.includes('Quagsire') && t.includes('Earth Power')));
});

test('Spanish seek log keeps the same historical actors', () => {
  const b = battleStub(
    [{name: 'Froslass'}, {name: 'Roserade'}],
    [{name: 'Electabuzz'}, {name: 'Quagsire'}],
    {active0: 1, active1: 1},
  );
  const events = [
    {t: 0, k: 'switch', s: 0, slot: 0},
    {t: 0, k: 'switch', s: 1, slot: 0},
    {t: 45, k: 'windup', s: 1, name: 'Thunderbolt', move: 'thunderbolt', type: 'Electric'},
    {t: 90, k: 'switch', s: 1, slot: 1},
  ];
  const lines = buildBattleLog(events, b, 'es', tr);
  const bolt = lines.find((l) => l.k === 'move');
  assert.equal(bolt?.text.includes('Electabuzz de Blue'), true, JSON.stringify(lines));
  assert.equal(bolt?.text.includes('Quagsire'), false, JSON.stringify(lines));
});
