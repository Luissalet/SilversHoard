import test from 'node:test';
import assert from 'node:assert/strict';
import {frameFor, drawSuppliedProjectiles} from '../../client/src/battle/rt/supplied-fx.js';

test('pixel projectile frames use the presentation clock and freeze under reduced motion', () => {
  const p = Object.freeze({type:'Ice',shape:'shot',move:'iceshard'});
  assert.equal(frameFor(p,0),'fx-ice-shards-0');
  assert.equal(frameFor(p,0.1),'fx-ice-shards-1');
  assert.equal(frameFor(p,4,true),'fx-ice-shards-0');
  assert.equal(frameFor({...p,type:'Normal',move:'tackle'},1),null);
  assert.equal(frameFor({...p,shape:'beam'},1),null);
  assert.equal(frameFor({...p,type:'Normal',move:'swift'},1),'fx-swift-0');
  assert.doesNotThrow(() => drawSuppliedProjectiles({}, {}, {projectiles:[p]}));
});
