import assert from 'node:assert/strict';
import test from 'node:test';
import {installPortableAssets, portablePmd, portableAsset,portablePmdPreview} from '../../client/src/portable-assets.js';
import {makeSprites} from '../../client/src/battle/dex.js';
import {Animator,image,sheetUrl} from '../../client/src/battle/rt/pmd.js';
import {ArenaRenderer} from '../../client/src/battle/rt/render.js';
import {OverworldAnimator} from '../../client/src/battle/rt/overworld.js';

test('a never-seen form resolves from the installed index and decodes only its binary chunk', async () => {
  const bytes = Uint8Array.of(5,6,137,80,78,71,7), encoded = Buffer.from(bytes).toString('base64');
  let reads = 0;
  const meta = {key:'lib-generated', a:{Idle:{}}, source:{kind:'generated'}};
  installPortableAssets({pmd:{entries:{'514||0':meta.key},metas:{[meta.key]:meta}},
    files:{image:{pmd:0,offset:2,size:4,mime:'image/png'}},urls:{'/api/idle':'image'}},
    {readChunk:i => { assert.equal(i,0); reads++; return encoded; }});
  try {
    assert.equal(reads,0);
    assert.equal(portablePmd(514).form_exact,true);
    assert.equal(reads,0,'metadata must not decode a PNG chunk');
    const first=portableAsset('/api/idle');
    assert.match(first,/^blob:/);
    assert.deepEqual(new Uint8Array(await (await fetch(first)).arrayBuffer()),bytes.slice(2,6));
    assert.equal(portableAsset('/api/idle'),first);
    assert.equal(reads,1,'reused sheets share their decoded chunk and object URL');
    installPortableAssets(null);
    await assert.rejects(fetch(first),'replacing the document releases old object URLs');
  } finally { installPortableAssets(null); }
});

test('generated cardinal views crop the actual row and compact art preserves its screen size', async () => {
  const old=globalThis.Image;
  globalThis.Image=class {set src(value){queueMicrotask(()=>this.onload());}};
  const meta={key:'fixture-cardinals',display_scale:2,a:{Idle:{w:16,h:32,n:1,r:4,d:[30],ax:8,ay:24,row_map:[0,1,1,2,2,3,3,0]}}};
  installPortableAssets({files:{fixture:'data:image/png;base64,cardinal-fixture'},urls:{'/api/sprites/pmd-sheet/fixture-cardinals/Idle.png':'fixture'}});
  try {
    await image(sheetUrl(meta,'Idle')).loaded;
    const animator=new Animator(meta), draws=[];
    const ctx={globalAlpha:1,drawImage:(...args)=>draws.push(args.slice(1))};
    assert.equal(animator.height(1.5),72);
    for(let direction=0;direction<8;direction++) assert.equal(animator.draw(ctx,100,200,direction,1.5),true);
    assert.deepEqual(draws.map(d=>d[1]),[0,32,32,64,64,96,96,0]);
    assert.deepEqual(draws[4],[0,64,16,32,76,128,48,96]);
  } finally { installPortableAssets(null); globalThis.Image=old; }
});

test('a newly bundled exact form preserves the explicitly imported walking sprite', async () => {
  const old=globalThis.Image;
  globalThis.Image=class {set src(value){queueMicrotask(()=>this.onload());}};
  const meta={key:'lib-import-priority',a:{Idle:{w:32,h:32,n:1,r:4,d:[20],ax:16,ay:28}}};
  installPortableAssets({pmd:{entries:{'260|mega|0':meta.key},metas:{[meta.key]:meta}}});
  const imported={url:'sheet:user-import-priority',source:'User import',credit:['Original artist'],
    frames:Array.from({length:4},()=>Array.from({length:4},()=>[0,0,32,32]))};
  const renderer={sides:[{mons:[{num:260,forme:'Mega',sprite_id:'swampert-mega'}]}],
    fallbacks:[],megaFallbacks:[],anims:[[null]],megaAnims:[[null]],credits:new Set(),importedCredits:new Map(),
    offline:true,sprites:{walking:async id=>id==='swampert-mega'?imported:null}};
  try {
    await ArenaRenderer.prototype.preload.call(renderer);
    assert.ok(renderer.anims[0][0] instanceof OverworldAnimator);
    assert.equal(renderer.anims[0][0].meta.url,imported.url);
    assert.deepEqual([...renderer.importedCredits.values()],[{source:imported.source,credit:imported.credit}]);
  } finally {installPortableAssets(null);globalThis.Image=old;}
});

test('a cold standalone HUD uses exact PMD front/back previews instead of letter placeholders', () => {
  const front='data:image/png;base64,front',back='data:image/png;base64,back';
  const meta={key:'preview',previews:{PreviewFront:'front',PreviewBack:'back'}};
  installPortableAssets({files:{front,back},urls:{},pmd:{species:{charizardmegay:{num:6,form:'Mega-Y'}},
    entries:{'6|megay|0':'preview'},metas:{preview:meta}}});
  try {
    const sprites=makeSprites({server:'https://example.invalid'});
    assert.equal(portablePmdPreview('Charizard-Mega-Y'),front);
    assert.equal(sprites.pokemon('Charizard-Mega-Y'),front);
    assert.equal(sprites.pokemon('Charizard-Mega-Y',{back:true}),back);
    assert.equal(sprites.portrait('Charizard-Mega-Y','Angry'),front);
    assert.equal(portablePmdPreview('Charizard-Mega-X'),'','never claim a distinct missing form');
  } finally {installPortableAssets(null);}
});

test('an imported normal fallback cannot hide an exact bundled shiny', async () => {
  const old=globalThis.Image;
  globalThis.Image=class {set src(value){queueMicrotask(()=>this.onload());}};
  const meta={key:'lib-shiny-import-priority',shiny:true,a:{Idle:{w:32,h:32,n:1,r:4,d:[20],ax:16,ay:28}}};
  try {
    for (const [importedShiny,bundled,expectedImported] of [[false,true,false],[true,true,true],[false,false,true]]) {
      installPortableAssets({pmd:{entries:bundled?{'260|mega|1':meta.key}:{},metas:bundled?{[meta.key]:meta}:{}}});
      const imported={url:`sheet:shiny-import-${importedShiny}-${bundled}`,shiny:importedShiny,source:'User import',
        frames:Array.from({length:4},()=>Array.from({length:4},()=>[0,0,32,32]))};
      const renderer={sides:[{mons:[{num:260,forme:'Mega',sprite_id:'swampert-mega',shiny:true}]}],
        fallbacks:[],megaFallbacks:[],anims:[[null]],megaAnims:[[null]],credits:new Set(),importedCredits:new Map(),
        offline:true,sprites:{walking:async()=>imported}};
      await ArenaRenderer.prototype.preload.call(renderer);
      assert.equal(renderer.anims[0][0] instanceof OverworldAnimator,expectedImported);
      assert.equal(renderer.anims[0][0].meta[expectedImported?'url':'key'],expectedImported?imported.url:meta.key);
      assert.equal(renderer.importedCredits.size,expectedImported?1:0);
    }
  } finally {installPortableAssets(null);globalThis.Image=old;}
});
