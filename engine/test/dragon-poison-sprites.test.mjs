import test from 'node:test';
import assert from 'node:assert/strict';
import {rtMove} from '../src/realtime/moves.mjs';
import {effectProfile} from '../../client/src/battle/rt/supplied-moves.js';
import {SuppliedEffects} from '../../client/src/battle/rt/supplied-fx.js';
import art from '../../silvers_hoard/presets/supplied_sprites.json' with {type:'json'};
import catalog from '../../silvers_hoard/presets/rt_move_effects.json' with {type:'json'};

const EXPECTED = {dragondance:['dragon-dance','area'],dragonpulse:['dragon-pulse','travel'],outrage:['outrage','contact'],
  spacialrend:['spacial-rend','area'],acid:['acid','area'],acidarmor:['acid-armor','area'],gunkshot:['gunk-shot','travel'],
  poisongas:['poison-gas','travel'],poisonfang:['poison-fang','contact'],toxic:['toxic','travel'],toxicspikes:['toxic-spikes','area']};

test('eleven local PMD motifs reach existing compatible RT phases without changing shape or availability', () => {
  for (const [id,[motif,phase]] of Object.entries(EXPECTED)) {
    const move=rtMove(id),p=effectProfile(move);
    assert.deepEqual(p,catalog.profiles[id]);
    assert.equal(p.shape,move.shape);
    assert.equal(p.available,!move.noEffect);
    assert.equal(p.selection,'move');
    assert.equal(p[phase],'fx-pmd-td-'+motif);
    assert.ok(art.sprites[p[phase]].frames>1);
  }
  assert.equal(catalog.profiles.splash.available,false);
});

test('new motifs render on the shared public clock, freeze under pause and clear on seek', () => {
  const old=globalThis.Image;
  globalThis.Image=class {complete=true;naturalWidth=128;};
  const draws=[];
  const ctx={save(){},restore(){},translate(){},rotate(){},drawImage(image,...args){draws.push([image.src,...args]);}};
  const r={scale:30,time:0,px:x=>x*30,py:y=>y*30};
  const view={seconds:.1,sides:[{x:2,y:3,fx:1,fy:0,active:0},{x:6,y:3,fx:-1,fy:0,active:0}],projectiles:[]};
  try {
    for (const [id,[motif,phase]] of Object.entries(EXPECTED)) {
      const p=catalog.profiles[id],fx=new SuppliedEffects(r);
      view.projectiles=[];draws.length=0;
      if(phase==='contact') fx.contact(id,p.type,2,3,1,0);
      else if(p.shape==='self'||p.shape==='field') fx.event({k:'use',s:0,move:id,t:0},{sides:view.sides,t:0});
      else if(phase==='area') fx.area(id,p.type,3,3,2,-1,1,0,p.shape==='drop');
      else view.projectiles=[{id:'pmd',move:id,type:p.type,shape:p.shape,x:5,y:3,r:.5}];
      fx.update(0,view);fx.draw(ctx,view);
      assert.ok(draws.some(row=>row[0]===art.sprites['fx-pmd-td-'+motif].image),id);
      const paused=structuredClone(draws);draws.length=0;
      fx.update(0,view);fx.draw(ctx,view);assert.deepEqual(draws,paused,id+' pause');
      draws.length=0;fx.draw(ctx,view,true);
      for(const row of draws) {
        const sprite=Object.values(art.sprites).find(s=>s.image===row[0]),frame=sprite.still_frame||0;
        assert.equal(row[1],frame%sprite.columns*sprite.frame_width,id+' reduced source x');
        assert.equal(row[2],Math.floor(frame/sprite.columns)*sprite.frame_height,id+' reduced source y');
      }
      fx.update(0,{...view,seconds:100,projectiles:[]});draws.length=0;fx.draw(ctx,{...view,seconds:100,projectiles:[]});
      assert.equal(draws.length,0,id+' no stale impact');
    }
  } finally {globalThis.Image=old;}
});
