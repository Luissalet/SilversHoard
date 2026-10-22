import test from 'node:test';
import assert from 'node:assert/strict';
import {makeImpact, IMPACT_VARIANTS} from '../../client/src/battle/impact-sound.js';

const kinds=['hit','super','crit','resisted','block'];
const energy = data => data.reduce((n,x)=>n+x*x,0)/Math.max(1,data.length);
test('impacts have prompt contact, a bounded dry tail and no clipped/DC-displaced samples at device rates',()=>{
  for(const rate of [22050,44100,48000,96000])for(const kind of kinds)for(let v=0;v<IMPACT_VARIANTS;v++){
    const pcm=makeImpact(kind,rate,v);
    assert.ok(pcm.length/rate<=.32);
    assert.ok(pcm[0]===0);assert.ok(pcm.at(-1)===0);
    assert.ok(pcm.every(Number.isFinite));
    assert.ok(Math.max(...pcm.map(Math.abs))<.9);
    const onset=pcm.slice(0,Math.ceil(.008*rate)),body=pcm.slice(0,Math.ceil(.07*rate));
    assert.ok(energy(onset)>.005,`${kind} must start without audible latency`);
    assert.ok(energy(pcm.slice(-Math.ceil(.02*rate)))<energy(body)*.002,`${kind} must finish dry`);
    assert.ok(Math.abs(pcm.reduce((a,b)=>a+b,0)/pcm.length)<.005,'no DC offset');
  }
});

test('four repeatable contact variants differ without using the simulator or global RNG',()=>{
  const saved=Math.random;Math.random=()=>{throw Error('global random used');};
  try{
    for(const kind of kinds){
      const a=makeImpact(kind,48000,0);
      assert.deepEqual(a,makeImpact(kind,48000,0));
      assert.deepEqual(a,makeImpact(kind,48000,IMPACT_VARIANTS));
      for(let v=1;v<IMPACT_VARIANTS;v++)assert.notDeepEqual(a,makeImpact(kind,48000,v));
    }
  }finally{Math.random=saved;}
});

test('strong blows carry more early body than resisted hits without large peak-level jumps',()=>{
  const e=kind=>energy(makeImpact(kind).slice(0,4800));
  assert.ok(e('super')>e('hit'));assert.ok(e('crit')>e('hit'));assert.ok(e('hit')>e('resisted'));
  for(const kind of ['super','crit']){
    const a=Math.max(...makeImpact(kind).map(Math.abs)),b=Math.max(...makeImpact('hit').map(Math.abs));
    assert.ok(20*Math.log10(a/b)<1,'weight must not rely on a big peak jump');
  }
});

test('actual cue playback uses bounded cached PCM through the mixer, with mute, volumes, pitch and gaps intact',async()=>{
  const savedAC=globalThis.AudioContext,savedStorage=globalThis.localStorage;
  const buffers=[],sources=[],gains=[];
  class Node {connect(target){this.target=target;}}
  class Gain extends Node {constructor(){super();this.gain={value:1};gains.push(this);}}
  class Context{
    constructor(){this.sampleRate=48000;this.currentTime=1;this.state='running';this.destination=new Node();Context.last=this;}
    createGain(){return new Gain();}
    createDynamicsCompressor(){return new Node();}
    createBuffer(channels,length,rate){const b={duration:length/rate,copyToChannel(pcm,c){this.pcm=pcm;assert.equal(c,0);}};buffers.push(b);return b;}
    createBufferSource(){const s=new Node();s.playbackRate={value:1};s.start=t=>{s.at=t;sources.push(s);};s.stop=t=>{s.end=t;};return s;}
    createOscillator(){throw Error('impact attempted a pitched reward oscillator');}
  }
  globalThis.AudioContext=Context;
  globalThis.localStorage={getItem:()=>null,setItem(){}};
  try{
    const a=await import('../../client/src/audio.js?impact-test');a.unlock();
    a.setSettings({master:.7,sfx:.4,mute:false});
    assert.equal(gains[0].gain.value,.7);assert.equal(gains[1].gain.value,.4);
    for(const kind of kinds)for(let i=0;i<8;i++){Context.last.currentTime+=.1;a.sfx(kind,{gap:.04,delay:.02,pitch:.9,vol:.5});sources.at(-1).onended();}
    assert.equal(buffers.length,kinds.length*IMPACT_VARIANTS,'repeated hits must not grow the cache');
    assert.ok(buffers.every(b=>b.pcm.some(x=>x!==0)));
    const s=sources.at(-1);assert.equal(s.playbackRate.value,.9);assert.equal(s.target.gain.value,.5);
    assert.ok(s.end>s.at && s.end-s.at<.4);
    const n=sources.length;a.sfx('block',{gap:.2});assert.equal(sources.length,n,'same cue is throttled');
    a.setSettings({mute:true});a.sfx('hit',{gap:0});assert.equal(sources.length,n);
    a.setSettings({mute:false,sfx:0});a.sfx('hit',{gap:0});assert.equal(sources.length,n);
    a.setSettings({sfx:.8,master:0});a.sfx('hit',{gap:0});assert.equal(sources.length,n);
  }finally{globalThis.AudioContext=savedAC;globalThis.localStorage=savedStorage;}
});
