import test from 'node:test';
import assert from 'node:assert/strict';
import {rtMove} from '../src/realtime/moves.mjs';
import {effectProfile} from '../../client/src/battle/rt/supplied-moves.js';
import {SuppliedEffects} from '../../client/src/battle/rt/supplied-fx.js';
import art from '../../silvers_hoard/presets/supplied_sprites.json' with {type:'json'};
import catalog from '../../silvers_hoard/presets/rt_move_effects.json' with {type:'json'};

const expected={ancientpower:['ancient-power','travel'],rockblast:['rock-blast','travel'],rocktomb:['rock-tomb','area'],rollout:['rollout','contact']};

test('four local Rock motifs reach compatible existing phases without changing move mechanics',()=>{
  for(const [id,[name,phase]] of Object.entries(expected)) {
    const move=rtMove(id),profile=effectProfile(move);
    assert.deepEqual(profile,catalog.profiles[id]);
    assert.equal(profile.shape,move.shape);assert.equal(profile.available,!move.noEffect);
    assert.equal(profile[phase],'fx-pmd-rrt-'+name);assert.equal(profile.selection,'move');
    assert.ok(art.sprites[profile[phase]].frames>1);
  }
  assert.equal(catalog.profiles.splash.available,false);
});

test('Rock motifs use the shared clock, freeze when paused, expose a visible reduced frame and expire',()=>{
  const previous=globalThis.Image;globalThis.Image=class{complete=true;naturalWidth=128;};
  const draws=[],ctx={save(){},restore(){},translate(){},rotate(){},drawImage(im,...args){draws.push([im.src,...args]);}};
  const r={scale:30,time:0,px:x=>x*30,py:y=>y*30};
  const view={seconds:.1,sides:[{x:2,y:3,fx:1,fy:0,active:0},{x:6,y:3,fx:-1,fy:0,active:0}],projectiles:[]};
  try {
    for(const [id,[name,phase]] of Object.entries(expected)) {
      const p=catalog.profiles[id],fx=new SuppliedEffects(r),sprite=art.sprites['fx-pmd-rrt-'+name];
      draws.length=0;view.projectiles=[];
      if(phase==='contact')fx.contact(id,p.type,2,3,1,0);
      else if(phase==='area')fx.area(id,p.type,3,3,2,-1,1,0,p.shape==='drop');
      else view.projectiles=[{id:'rock-qa',move:id,type:p.type,shape:p.shape,x:5,y:3,r:.5}];
      fx.update(0,view);fx.draw(ctx,view);assert.ok(draws.some(d=>d[0]===sprite.image),id);
      assert.ok(Math.max(...draws.filter(d=>d[0]===sprite.image).map(d=>d[7]))>=48,id+' must remain legible at the standard display scale');
      const paused=structuredClone(draws);draws.length=0;fx.update(0,view);fx.draw(ctx,view);assert.deepEqual(draws,paused);
      draws.length=0;fx.draw(ctx,view,true);assert.ok(draws.length);
      for(const d of draws) {assert.equal(d[1],sprite.still_frame%sprite.columns*sprite.frame_width);assert.equal(d[2],Math.floor(sprite.still_frame/sprite.columns)*sprite.frame_height);}
      draws.length=0;const ended={...view,seconds:100,projectiles:[]};fx.update(0,ended);fx.draw(ctx,ended);assert.equal(draws.length,0);
    }
  } finally {globalThis.Image=previous;}
});
