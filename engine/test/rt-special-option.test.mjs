import test from 'node:test';
import assert from 'node:assert/strict';
import {RtBattle, ULT_MAX, ULT_SLOT} from '../src/realtime/sim.mjs';

const spec = (extra = {}) => ({
  id:'special-option', seed:'special-option', version:11, format:'gen9customgame', arena:'open', time_limit:60,
  p1:{name:'A',sets:[{species:'Snorlax',moves:['Tackle']}]},
  p2:{name:'B',sets:[{species:'Blissey',moves:['Tackle']}]}, ...extra,
});

test('new real-time rules have no extra gauge or special attack unless explicitly enabled', () => {
  const battle = new RtBattle(spec()), side=battle.sides[0];
  battle.ultGain(side,ULT_MAX);
  assert.equal(side.ult,0);
  side.ult=ULT_MAX; // Even a full or restored gauge cannot bypass the disabled rule.
  battle.step({p1:{use:ULT_SLOT}});
  assert.equal(battle.ultReady(side),false);
  assert.ok(!battle.events.some(e=>e.k==='ultimate'));
  assert.equal(battle.view().silver_special,false);
  assert.equal(battle.view().sides[0].ult,undefined);
});

test('historical rules keep the special even when an unrelated current option is false', () => {
  const battle=new RtBattle(spec({version:10,silver_special:false})), side=battle.sides[0];
  battle.ultGain(side,ULT_MAX);
  assert.equal(side.ult,ULT_MAX);
  assert.equal(battle.tryUlt(side),true);
  assert.equal(battle.view().silver_special,undefined, 'legacy view shape stays unchanged');
  assert.ok(battle.events.some(e=>e.k==='ultimate'));
});

test('opting in reproduces the previous special attack and its combat effects', () => {
  const current=new RtBattle(spec({silver_special:true})), legacy=new RtBattle(spec({version:10}));
  for(const battle of [current,legacy]) {
    battle.ultGain(battle.sides[0],ULT_MAX);
    assert.equal(battle.tryUlt(battle.sides[0]),true);
    for(let tick=0;tick<90;tick++) battle.step();
  }
  assert.deepEqual(current.events,legacy.events);
  assert.deepEqual(current.sides.map(s=>s.mons.map(m=>m.hp)),legacy.sides.map(s=>s.mons.map(m=>m.hp)));
  assert.equal(current.view().silver_special,true);
});
