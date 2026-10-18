import test from 'node:test';
import assert from 'node:assert/strict';
import {rtMove} from '../src/realtime/moves.mjs';
import {effectProfile} from '../../client/src/battle/rt/supplied-moves.js';
import {SuppliedEffects} from '../../client/src/battle/rt/supplied-fx.js';
import art from '../../silvers_hoard/presets/supplied_sprites.json' with {type:'json'};
import catalog from '../../silvers_hoard/presets/rt_move_effects.json' with {type:'json'};
const moves={bite:'bite',crunch:'crunch',knockoff:'knock-off',pursuit:'pursuit',torment:'torment'};

test('Dark profiles select the new material while keeping actual move geometry and availability',()=>{
  for(const[id,name]of Object.entries(moves)){
    const move=rtMove(id),p=effectProfile(move);
    assert.deepEqual(p,catalog.profiles[id]);assert.equal(p.shape,move.shape);assert.equal(p.available,!move.noEffect);
    assert.equal(p[id==='torment'?'area':'contact'],'fx-pmd-dark-'+name);
    assert.ok(art.sprites['fx-pmd-dark-'+name].frames>1);
  }
});
test('each Dark motif draws, freezes, uses its representative reduced-motion frame and expires',()=>{
  const previous=globalThis.Image;globalThis.Image=class{complete=true;naturalWidth=128;};
  const draws=[],ctx={globalAlpha:1,save(){},restore(){},translate(){},rotate(){},drawImage(im,...a){draws.push([im.src,...a]);}};
  const r={scale:30,time:0,px:x=>x*30,py:y=>y*30};
  const view={seconds:.1,sides:[{x:2,y:3,fx:1,fy:0,active:0},{x:6,y:3,fx:-1,fy:0,active:0}],projectiles:[]};
  try{
    for(const[id,name]of Object.entries(moves)){
      const fx=new SuppliedEffects(r),s=art.sprites['fx-pmd-dark-'+name];draws.length=0;
      if(id==='torment')fx.area(id,'Dark',3,3,2,-1,1,0);else fx.contact(id,'Dark',2,3,1,0);
      fx.update(0,view);fx.draw(ctx,view);assert.ok(draws.some(d=>d[0]===s.image),id);
      const frozen=structuredClone(draws);draws.length=0;fx.update(0,view);fx.draw(ctx,view);assert.deepEqual(draws,frozen);
      draws.length=0;fx.draw(ctx,view,true);assert.ok(draws.length);
      for(const d of draws){assert.equal(d[1],s.still_frame%s.columns*s.frame_width);assert.equal(d[2],Math.floor(s.still_frame/s.columns)*s.frame_height);}
      draws.length=0;fx.update(0,{...view,seconds:100});fx.draw(ctx,{...view,seconds:100});assert.equal(draws.length,0);
    }
  }finally{globalThis.Image=previous;}
});
