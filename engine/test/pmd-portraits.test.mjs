import test from 'node:test';
import assert from 'node:assert/strict';
import {makeSprites} from '../../client/src/battle/dex.js';
import {installPortableAssets,portablePortrait} from '../../client/src/portable-assets.js';

test('installed portrait selection keeps form, emotion, shiny and lazy binary offsets offline',async()=>{
  const create=URL.createObjectURL,revoke=URL.revokeObjectURL,blobs=[],revoked=[],reads=[];
  URL.createObjectURL=blob=>{blobs.push(blob);return 'blob:portrait-'+blobs.length;};URL.revokeObjectURL=url=>revoked.push(url);
  try {
    installPortableAssets({files:{normal:{pmd:1,offset:1,size:2,mime:'image/png'},shiny:{pmd:1,offset:3,size:2,mime:'image/png'}},
      portraits:{entries:{'charizardmegay|0':{Normal:'normal',Happy:'normal'},'charizardmegay|1':{Normal:'shiny',Angry:'shiny'}},fallbacks:{Joyous:['Happy']}}},
      {readChunk:id=>{reads.push(id);return btoa(String.fromCharCode(0,11,12,21,22));}});
    assert.equal(blobs.length,0);
    const sprites=makeSprites({server:'https://not-used.invalid',dexNum:()=>6});
    const normal=sprites.portrait('Charizard-Mega-Y','Happy'),shiny=sprites.portrait('Charizard-Mega-Y','Angry',{shiny:true});
    assert.equal(normal,'blob:portrait-1');assert.equal(shiny,'blob:portrait-2');assert.deepEqual(reads,[1]);
    assert.deepEqual([...new Uint8Array(await blobs[0].arrayBuffer())],[11,12]);
    assert.deepEqual([...new Uint8Array(await blobs[1].arrayBuffer())],[21,22]);
    assert.equal(portablePortrait('Charizard-Mega-Y','Joyous'),normal);
    assert.equal(portablePortrait('Charizard','Normal'),'');
    installPortableAssets(null);assert.deepEqual(revoked,[normal,shiny]);
    assert.equal(makeSprites().portrait('Mew','Pain',{shiny:true}),'/api/sprites/portrait?species=Mew&emotion=Pain&shiny=1');
  }finally{installPortableAssets(null);URL.createObjectURL=create;URL.revokeObjectURL=revoke;}
});

test('a missing exact portable portrait cannot borrow a cached base normal portrait',()=>{
  const cached='data:image/png;base64,Y2FjaGVkLWJhc2Utbm9ybWFs';
  const base='https://raw.githubusercontent.com/PMDCollab/SpriteCollab/master/portrait/0006/Normal.png';
  installPortableAssets({files:{cached},urls:{[base]:'cached'},portraits:{entries:{}}});
  try {
    const sprites=makeSprites({server:'https://not-used.invalid',dexNum:()=>6});
    for (const shiny of [false,true]) {
      const source=sprites.portrait('Charizard-Mega-Y','Normal',{shiny});
      assert.notEqual(source,cached);
      assert.ok(source.startsWith('data:image/svg+xml,'));
    }
  } finally {installPortableAssets(null);}
  assert.equal(makeSprites().portrait('Mew','Pain',{shiny:true}),'/api/sprites/portrait?species=Mew&emotion=Pain&shiny=1');
});
