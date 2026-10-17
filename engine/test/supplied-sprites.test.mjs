import test from 'node:test';
import assert from 'node:assert/strict';
import {frameFor, drawSuppliedProjectiles,queueSuppliedImpact,clearSuppliedImpacts} from '../../client/src/battle/rt/supplied-fx.js';
import {moveCardFor,queueMoveCard,drawMoveCard,clearMoveCards,moveCardActive} from '../../client/src/battle/move-cards.js';

test('pixel projectile frames use the presentation clock and freeze under reduced motion', () => {
  const p = Object.freeze({type:'Ice',shape:'shot',move:'iceshard'});
  assert.equal(frameFor(p,0),'fx-gba-ice-shatter');
  assert.equal(frameFor(p,0.1),'fx-gba-ice-shatter');
  assert.equal(frameFor(p,4,true),'fx-gba-ice-shatter');
  assert.equal(frameFor({...p,move:'otherice'},0),'fx-sky-ice');
  assert.equal(frameFor({...p,type:'Normal',move:'tackle'},1),null);
  assert.equal(frameFor({...p,shape:'beam'},1),null);
  assert.equal(frameFor({...p,type:'Normal',move:'swift'},1),'fx-sky-normal');
  assert.doesNotThrow(() => drawSuppliedProjectiles({}, {}, {projectiles:[p]}));
});

test('Z titles select the actual move, language and Sun/Moon variant with Ultra fallback',()=>{
  assert.equal(moveCardFor('Gigavolt Havoc','es','sm'),'z-sm-es-gigavolthavoc');
  assert.equal(moveCardFor('10,000,000 Volt Thunderbolt','en'),'z-usum-en-10000000voltthunderbolt');
  assert.equal(moveCardFor('Light That Burns the Sky','es','sm'),'z-usum-es-lightthatburnsthesky');
  assert.equal(moveCardFor('Tackle','en'),null);
  assert.equal(moveCardFor('Z-Growl','es'),null);
});

test('Z title presentation freezes on its clock, preserves aspect and clears on expiry/rewind',()=>{
  const oldImage=globalThis.Image;
  globalThis.Image=class {complete=true;naturalWidth=512;};
  try {
    const renderer={},draws=[];
    const ctx={globalAlpha:1,save(){},restore(){this.globalAlpha=1;},drawImage(...args){draws.push(args);}};
    assert.equal(queueMoveCard(renderer,'Gigavolt Havoc','es',4),true);
    drawMoveCard(ctx,renderer,4.5,800,400);
    assert.equal(draws.length,1);
    assert.ok(draws[0][3]<=560 && draws[0][4]<=88);
    const first=draws[0];
    draws.length=0;drawMoveCard(ctx,renderer,4.5,800,400,true);
    assert.deepEqual(draws[0],first);
    assert.equal(moveCardActive(renderer,5.3),false);
    queueMoveCard(renderer,'Catastropika','en',10);
    assert.equal(moveCardActive(renderer,9),false);
    queueMoveCard(renderer,'Catastropika','en',10);clearMoveCards(renderer);
    assert.equal(moveCardActive(renderer,10),false);
    // Retimed classic runners advance their effect clock faster than real time.
    queueMoveCard(renderer,'Catastropika','en',10,3.75);
    assert.equal(moveCardActive(renderer,12),true);
    assert.equal(moveCardActive(renderer,13.8),false);
  } finally {globalThis.Image=oldImage;}
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
