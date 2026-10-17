import test from 'node:test';
import assert from 'node:assert/strict';
import {ArenaRenderer} from '../../client/src/battle/rt/render.js';
import {image} from '../../client/src/battle/rt/pmd.js';

let serial = 0;
function environment({sheets = false, portrait = false} = {}) {
  const previous = {window:globalThis.window, document:globalThis.document, Image:globalThis.Image, fetch:globalThis.fetch};
  const pending = [], draws = [];
  const prefix = `https://sprites795/${++serial}/`;
  const ctx = new Proxy({globalAlpha:1, measureText:s=>({width:String(s).length*10})},
    {get:(o,k)=>o[k] ?? ((...args)=>{if(k==='drawImage')draws.push(args[0].src);})});
  globalThis.window = {devicePixelRatio:1, innerHeight:800};
  globalThis.document = {createElement:()=>({getContext:()=>ctx})};
  globalThis.Image = class {
    set src(src) {
      this.url=src; this.width=this.height=96;
      if(src.startsWith(prefix) || sheets && src.includes('/pmd-sheet/'))pending.push(this);
      else this.onload?.();
    }
    get src(){return this.url;}
  };
  globalThis.fetch=async()=>({ok:true,json:async()=>({key:'0260-0000-0001',a:{Idle:{w:96,h:96,n:1,r:8,d:[6],ax:48,ay:80}}})});
  const member={num:260,species:'Swampert',forme:'',sprite_id:'swampert',shiny:true,
    mega_info:{num:260,species:'Swampert-Mega',forme:'Mega',sprite_id:'swampert-mega'}};
  const r=new ArenaRenderer({style:{},clientWidth:640,getContext:()=>ctx,closest:selector=>portrait&&selector==='.portrait-layout'?{}:null},
    {sides:[{mons:[member]}],base:prefix,sprites:{fallback:(species,options)=>`${prefix}${species}${options?.back?'-back':''}.png`},offline:!sheets});
  const release=filter=>{for(const img of pending)if(!img.finished&&(!filter||filter(img.url))){img.finished=true;img.onload?.();}};
  return {r,member,prefix,pending,draws,release,restore(){release();Object.assign(globalThis,previous);}};
}

test('preload waits for base and Mega fallback pixels, including server-free pages',async()=>{
  const env=environment();
  let ready=false;
  const loading=env.r.preload(()=>{},1000).then(()=>{ready=true;});
  try {
    await new Promise(setImmediate);
    assert.equal(ready,false,'metadata completion alone must not start a sprite-less battle');
    env.release(url=>!url.includes('-Mega'));
    await new Promise(setImmediate);
    assert.equal(ready,false,'the Mega image must be ready before that forme can appear');
    env.release(); await loading;
    assert.equal(env.r.megaFallbacks[0][0].ready,true);
  } finally {env.restore();await loading;}
});

test('PMD preload waits for decoded Idle sheets and keeps a real Mega fallback when the sheet is unavailable',async()=>{
  const env=environment({sheets:true});
  let ready=false;
  const loading=env.r.preload(()=>{},1000).then(()=>{ready=true;});
  try {
    env.release(url=>url.endsWith('.png')&&!url.includes('/pmd-sheet/'));
    await new Promise(setImmediate);
    assert.equal(ready,false,'fetching animation geometry is not loading the actual sheet');
    env.release(); await loading;
    assert.ok(env.r.animOf(0,0,false));
    env.r.show={hides:()=>false};
    env.r.drawMon({version:11},{active:0,mons:[{...env.member,is_mega:true,hp:100,maxhp:100}],
      x:8,y:8,r:1,fx:1,fy:0},0,0);
    assert.ok(env.draws.some(url=>url.endsWith('Swampert-Mega.png')));
  } finally {env.restore();await loading;}
});

test('image readiness waits for decode and settles failed downloads without claiming drawable pixels',async()=>{
  const previous=globalThis.Image;
  let decode;
  globalThis.Image=class {
    set src(url){this.url=url;}
    decode(){return new Promise(resolve=>{decode=resolve;});}
  };
  try {
    const s=image(`https://decode795/${++serial}`);
    s.img.onload();
    assert.equal(s.ready,false);
    decode();
    assert.equal(await s.loaded,true);
    assert.equal(s.ready,true);
    const broken=image(`https://decode795/${++serial}`);
    broken.img.onerror();
    assert.equal(await broken.loaded,false);
    assert.equal(broken.ready,false);
    assert.equal(broken.failed,true);
  } finally {globalThis.Image=previous;}
});

test('metadata deadline still waits for fallback downloads, and failed images do not hang preload',async()=>{
  const env=environment({sheets:true});
  let ready=false;
  const loading=env.r.preload(()=>{},5).then(()=>{ready=true;});
  try {
    await new Promise(resolve=>setTimeout(resolve,20));
    assert.equal(ready,false,'the metadata timeout cannot skip loading a usable fallback');
    for(const img of env.pending)if(img.url.endsWith('.png')&&!img.url.includes('/pmd-sheet/')) {
      img.finished=true;img.onerror();
    }
    await loading;
    assert.equal(ready,true);
    assert.equal(env.r.fallbacks[0][0].failed,true);
  } finally {env.restore();await loading;}
});

test('portrait preload also waits for back sprites and keeps the active Mega when back art fails',async()=>{
  const env=environment({portrait:true});
  let ready=false;
  const loading=env.r.preload(()=>{},5).then(()=>{ready=true;});
  try {
    env.release(url=>!url.includes('-back'));
    await new Promise(setImmediate);
    assert.equal(ready,false);
    for(const img of env.pending)if(!img.finished&&img.url.includes('-back')){img.finished=true;img.onerror();}
    await loading;
    env.r.show={hides:()=>false};
    env.r.drawMon({version:11},{active:0,mons:[{...env.member,is_mega:true,hp:100,maxhp:100}],x:8,y:8,r:1,fx:1,fy:0},0,0);
    assert.ok(env.draws.some(url=>url.endsWith('Swampert-Mega.png')));
    assert.ok(!env.draws.some(url=>url.endsWith('Swampert.png')));
  } finally {env.restore();await loading;}
});
