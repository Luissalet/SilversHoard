import test from 'node:test';
import assert from 'node:assert/strict';
import {makeSprites} from '../../client/src/battle/dex.js';
import {installPortableAssets,portablePortrait} from '../../client/src/portable-assets.js';
import {ArenaRenderer} from '../../client/src/battle/rt/render.js';
import {image} from '../../client/src/battle/rt/pmd.js';

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
    assert.equal(makeSprites().portrait('Mew','Pain',{shiny:true}),'/api/sprites/portrait?species=Mew&emotion=Pain&shiny=1&portrait_version=2');
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
  assert.equal(makeSprites().portrait('Mew','Pain',{shiny:true}),'/api/sprites/portrait?species=Mew&emotion=Pain&shiny=1&portrait_version=2');
});

function introFixture(tag) {
  const pictures=new Map(),calls=[];
  const mons=[{num:201,forme:'H',species:'Unown-H',shiny:true},{num:201,forme:'J',species:'Unown-J',shiny:false}];
  const renderer={sides:mons.map(mon=>({mons:[mon]})),fallbacks:[],megaFallbacks:[],anims:[[null],[null]],megaAnims:[[null],[null]],
    credits:new Set(),importedCredits:new Map(),offline:true,sprites:{portrait(species,emotion,options){
      calls.push({species,emotion,options});return `portrait:${tag}:${species}:${options.shiny}`;
    }}};
  class Picture {
    set src(url){this.url=url;pictures.set(url,this);}
    decode(){return new Promise(resolve=>{this.finishDecode=resolve;});}
  }
  return {renderer,pictures,calls,Picture};
}

test('an uncached offline trainer cannot hide the exact PMD portrait behind a transparent placeholder',()=>{
  const portrait='data:image/png;base64,portrait';
  const trainer='data:image/png;base64,trainer';
  installPortableAssets({files:{face:portrait,trainer},urls:{'/trainers/cached.png':'trainer'},
    portraits:{entries:{'unownn|0':{Determined:'face'}}}});
  try {
    const sprites=makeSprites({server:'https://play.pokemonshowdown.com/sprites'});
    assert.equal(sprites.trainer('sd:uncached'),'','the VS card must use its PMD fallback when no trainer was embedded');
    assert.equal(sprites.portrait('Unown-N','Determined'),portrait);
    const local=makeSprites();
    assert.equal(local.trainer('/trainers/cached.png'),trainer,'an embedded trainer retains its own image');
    assert.equal(local.trainer({kind:'image',mime:'image/png',data:'custom'}),'data:image/png;base64,custom');
  } finally {installPortableAssets(null);}
});

test('the VS intro waits for both exact portraits to finish decoding',async()=>{
  const old=globalThis.Image,fixture=introFixture('decode');let done=false;
  globalThis.Image=fixture.Picture;
  installPortableAssets({files:{},urls:{},pmd:{entries:{},metas:{}}});
  const pending=ArenaRenderer.prototype.preload.call(fixture.renderer).then(()=>{done=true;});
  try {
    await new Promise(setImmediate);
    assert.equal(done,false,'the intro must not start while its portraits are undecoded');
    assert.deepEqual(fixture.calls,[
      {species:'Unown-H',emotion:'Determined',options:{num:201,shiny:true}},
      {species:'Unown-J',emotion:'Determined',options:{num:201,shiny:false}},
    ]);
    const [left,right]=fixture.pictures.values();left.onload();right.onload();
    await new Promise(setImmediate);
    assert.equal(done,false,'onload alone does not finish pixel decoding');
    left.finishDecode();await new Promise(setImmediate);
    assert.equal(done,false,'the second card must finish too');
    right.finishDecode();await pending;
    assert.ok(image(left.url).ready&&image(right.url).ready);
  } finally {
    if(!done)for(const picture of fixture.pictures.values())picture.onerror();
    await pending;installPortableAssets(null);globalThis.Image=old;
  }
});

test('a failed intro portrait settles without blocking the existing fallback',async()=>{
  const old=globalThis.Image,fixture=introFixture('failed');let done=false;
  globalThis.Image=fixture.Picture;
  installPortableAssets({files:{},urls:{},pmd:{entries:{},metas:{}}});
  const pending=ArenaRenderer.prototype.preload.call(fixture.renderer).then(()=>{done=true;});
  try {
    await new Promise(setImmediate);
    assert.equal(fixture.pictures.size,2,'prepare both cards before the intro');
    const [left,right]=fixture.pictures.values();left.onload();left.finishDecode();right.onerror();
    await pending;
    assert.ok(image(left.url).ready);
    assert.equal(image(right.url).ready,false);assert.ok(image(right.url).failed);
    assert.equal(done,true);
  } finally {
    if(!done)for(const picture of fixture.pictures.values())picture.onerror();
    await pending;installPortableAssets(null);globalThis.Image=old;
  }
});
