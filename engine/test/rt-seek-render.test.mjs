import test from 'node:test';
import assert from 'node:assert/strict';
import {ArenaRenderer} from '../../client/src/battle/rt/render.js';

test('a paused fainted snapshot never draws a newly opaque Pokémon after seeking', () => {
  const r=Object.create(ArenaRenderer.prototype);
  r.ctx=new Proxy({}, {get(){throw new Error('a historical fainted Pokémon must not draw');}});
  r.show={hides:()=>false};r.scale=20;r.fade=[{slot:-1,t:0}];
  const side={active:0,mons:[{fainted:true,hp:0,is_mega:false}]};
  r.drawUprightMon({t:900},side,0,0);
  assert.equal(r.fade[0].t,0);
});

test('the actual faint event still starts its ordinary fade', () => {
  const r=Object.create(ArenaRenderer.prototype);
  r.ctx={};r.show={hides:()=>false};r.scale=20;r.fade=[{slot:0,t:0}];
  r.lastActive=['0:0'];
  const side={active:0,mons:[{fainted:true,hp:0,is_mega:false}]};
  r.drawUprightMon({t:900},side,0,1.2);
  assert.equal(r.fade[0].t,1.2);
});
