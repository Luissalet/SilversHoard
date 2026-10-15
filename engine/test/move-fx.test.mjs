// The move effects of the turn-based screen: the generated move table, the plans built from it and the cues the protocol reader hands out.
import test from 'node:test';
import assert from 'node:assert/strict';
import {render} from '../../scripts/gen_move_fx.mjs';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {fitTiming, moveInfo, planHit, planMove} from '../../client/src/battle/fx/plan.js';
import {applyLine, newState} from '../../client/src/battle/protocol.js';

const me = {x: 2, y: 5};
const foe = {x: 9, y: 3};

test('move table is up to date and knows the shapes', () => {
  const file = fileURLToPath(new URL('../../client/src/battle/fx/move-data.js', import.meta.url));
  // a Windows checkout may turn the file's line ends into CRLF
  assert.equal(fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n'), render(), 'run node scripts/gen_move_fx.mjs');
  assert.deepEqual(moveInfo('flamethrower'), {type: 'Fire', shape: 'beam', heal: false});
  assert.equal(moveInfo('earthquake').shape, 'burst');
  assert.equal(moveInfo('thunder').shape, 'drop');
  assert.equal(moveInfo('swordsdance').shape, 'self');
  assert.equal(moveInfo('raindance').shape, 'global');
  assert.equal(moveInfo('roost').heal, true);
  assert.equal(moveInfo('nosuchmove'), null);
});

test('a beam flies from the user to the target and ends with an impact', () => {
  const p = planMove({move: 'flamethrower', user: me, targets: [foe], foes: [foe], others: [foe]});
  assert.equal(p.shape, 'beam');
  assert.equal(p.flights.length, 1);
  assert.deepEqual(p.flights[0].to, foe);
  const kinds = p.steps.map((s) => s.ev.k);
  assert.deepEqual(kinds, ['windup', 'shot', 'impact']);
  assert.ok(p.dur > 0.5 && p.dur < 1.5);
});

test('a miss flies past the target and fizzles; a self move needs no target', () => {
  const miss = planMove({move: 'shadowball', user: me, targets: [foe], foes: [foe], miss: true});
  assert.equal(miss.steps.at(-1).ev.k, 'fizzle');
  assert.notDeepEqual(miss.flights[0].to, foe);
  const self = planMove({move: 'swordsdance', user: me, targets: [], foes: [foe]});
  assert.equal(self.steps[0].ev.shape, 'self');
  assert.equal(planMove({move: 'roost', user: me}).steps[0].ev.move, 'recover');
});

test('strikes land on every target; spread bursts cover the farthest Pokémon; drops fall on each target', () => {
  const foe2 = {x: 10, y: 4};
  const strike = planMove({move: 'crunch', user: me, targets: [foe, foe2], foes: [foe, foe2]});
  assert.equal(strike.steps.length, 2);
  const burst = planMove({move: 'earthquake', user: me, targets: [foe], foes: [foe, foe2], others: [foe, foe2]});
  assert.equal(burst.steps[0].ev.arc, -1);
  assert.ok(burst.steps[0].ev.r >= Math.hypot(foe2.x - me.x, foe2.y - me.y));
  const drop = planMove({move: 'rockslide', user: me, targets: [foe, foe2], foes: [foe, foe2]});
  assert.equal(drop.steps.filter((s) => s.ev.k === 'area').length, 2);
  const cone = planMove({move: 'heatwave', user: me, targets: [foe], foes: [foe]});
  assert.equal(cone.steps[0].ev.k, 'area');
});

test('hits: bursts by the type of the move, crit flash, smaller for resisted and for damage that is not a move', () => {
  const crit = planHit({move: 'icebeam', crit: true, eff: 2});
  assert.equal(crit.type, 'Ice');
  assert.ok(crit.steps.some((s) => s.flash));
  assert.ok(crit.steps.some((s) => s.ev && s.ev.k === 'hit' && s.ev.crit));
  assert.ok(planHit({move: 'dragonclaw', eff: 0.5}).steps[0].burst.power < 1);
  assert.equal(planHit({source: 'brn'}).type, 'Fire');
  assert.equal(planHit({source: 'sandstorm'}).type, 'Rock');
  assert.equal(planHit({source: 'recoil'}).type, 'Normal');
});

test('timing: fits the pause, is skipped at the fastest speed', () => {
  const normal = fitTiming(0.6, {budgetMs: 900, speedMs: 900});
  assert.ok(normal.ms >= 250 && normal.ms <= 900 && !normal.skip);
  assert.ok(fitTiming(0.6, {budgetMs: 450, speedMs: 450}).ms < normal.ms);
  assert.equal(fitTiming(0.6, {budgetMs: 200, speedMs: 200}).skip, true);
});

test('protocol cues carry the move, the crit and the effectiveness to the damage line', () => {
  const st = newState();
  const run = (l) => applyLine(st, l, {lang: 'en', me: 'p1'});
  run('|switch|p1a: Charizard|Charizard, L100, M|100/100');
  run('|switch|p2a: Blastoise|Blastoise, L100, M|100/100');
  const mv = run('|move|p1a: Charizard|Flamethrower|p2a: Blastoise|[spread] p2a,p2b');
  assert.equal(mv.anim.move, 'flamethrower');
  assert.deepEqual(mv.anim.spread, [{side: 'p2', slot: 0}, {side: 'p2', slot: 1}]);
  run('|-crit|p2a: Blastoise');
  run('|-supereffective|p2a: Blastoise');
  const hit = run('|-damage|p2a: Blastoise|50/100');
  assert.equal(hit.anim.move, 'flamethrower');
  assert.equal(hit.anim.crit, true);
  assert.equal(hit.anim.eff, 2);
  // the next hit starts clean, and poison damage is not the move's
  const next = run('|-damage|p2a: Blastoise|40/100');
  assert.equal(next.anim.crit, false);
  const psn = run('|-damage|p2a: Blastoise|30/100|[from] psn');
  assert.equal(psn.anim.move, '');
  assert.equal(psn.anim.source, 'psn');
  run('|upkeep');
  assert.equal(st.fx.move, '');
});
