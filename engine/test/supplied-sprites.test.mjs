import test from 'node:test';
import assert from 'node:assert/strict';
import {frameFor, drawSuppliedProjectiles,queueSuppliedImpact,clearSuppliedImpacts} from '../../client/src/battle/rt/supplied-fx.js';

test('pixel projectile frames use the presentation clock and freeze under reduced motion', () => {
  const p = Object.freeze({type:'Ice',shape:'shot',move:'iceshard'});
  assert.equal(frameFor(p,0),'fx-sky-ice');
  assert.equal(frameFor(p,0.1),'fx-sky-ice');
  assert.equal(frameFor(p,4,true),'fx-sky-ice');
  assert.equal(frameFor({...p,type:'Normal',move:'tackle'},1),null);
  assert.equal(frameFor({...p,shape:'beam'},1),null);
  assert.equal(frameFor({...p,type:'Normal',move:'swift'},1),'fx-sky-normal');
  assert.doesNotThrow(() => drawSuppliedProjectiles({}, {}, {projectiles:[p]}));
});

test('atlas animation and impact queues draw without mutating the battle view',()=>{
  const oldImage=globalThis.Image;
  globalThis.Image=class {complete=true;naturalWidth=500;};
  try {
    const draws=[];
    const ctx={save(){},restore(){},translate(){},drawImage(...args){draws.push(args);}};
    const renderer={time:.1,scale:30,px:x=>x*30,py:y=>y*30};
    const p=Object.freeze({type:'Fire',shape:'shot',move:'ember',x:2,y:3,r:.4});
    const view=Object.freeze({projectiles:Object.freeze([p])});
    queueSuppliedImpact(renderer,2,3,0);
    drawSuppliedProjectiles(ctx,renderer,view,false);
    assert.equal(draws.length,2);
    assert.equal(draws[0].length,9);
    const animatedSourceX=draws[0][1];
    draws.length=0;
    drawSuppliedProjectiles(ctx,renderer,view,true);
    assert.notEqual(animatedSourceX,draws[0][1]);
    assert.equal(draws[0][1],0);
    clearSuppliedImpacts(renderer);
    draws.length=0;
    drawSuppliedProjectiles(ctx,renderer,view,false);
    assert.equal(draws.length,1);
    assert.deepEqual(p,{type:'Fire',shape:'shot',move:'ember',x:2,y:3,r:.4});
  } finally {globalThis.Image=oldImage;}
});
