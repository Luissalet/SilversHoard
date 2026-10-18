import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';

// A play() promise can reject when playback is paused while the media loads.
// Exercise the actual recorder hook across that retry, without a browser shim.
const source=readFileSync(new URL('../../client/src/video/tap.js',import.meta.url),'utf8')
  .replace(/^import .*;$/m,'').replace('export function installTap','function installTap');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function harness() {
 const edges=[],timers=[],contexts=[];
 class Node {
  constructor(context,kind){this.context=context;this.kind=kind;}
  connect(target){edges.push({from:this,to:target});return target;}
 }
 class Destination extends Node {}
 class Context {
  constructor(){contexts.push(this);this.destination=new Destination(this,'speakers');}
  createMediaStreamDestination(){const n=new Node(this,'recording');n.stream={getAudioTracks:()=>[{kind:'audio'}]};return n;}
  createMediaStreamSource(stream){const n=new Node(this,'captured');n.stream=stream;return n;}
  createGain(){const n=new Node(this,'gain');n.gain={value:1};return n;}
  resume(){return Promise.resolve();}
 }
 class Media {
  constructor(){this.attempt=0;this.captures=0;this.hasTracks=true;this.rejectFirst=false;this.throwCapture=false;}
  play(){this.attempt++;return this.rejectFirst&&this.attempt===1?Promise.reject(new Error('Playback interrupted by pause')):Promise.resolve();}
  captureStream(){this.captures++;if(this.throwCapture)throw new Error('Not ready');return {getAudioTracks:()=>this.hasTracks?[{kind:'audio'}]:[]};}
 }
 const install=new Function('window','AudioNode','AudioDestinationNode','HTMLMediaElement','setTimeout','getSettings',`${source};return installTap;`)
  ({AudioContext:Context},Node,Destination,Media,fn=>timers.push(fn),()=>({mute:false,master:.8,music:.5}));
 const stream=install();
 return {Media,Node,Context,edges,timers,contexts,install,stream,captured:()=>edges.filter(e=>e.from.kind==='captured')};
}

test('music is captured after an interrupted first play succeeds on retry',async()=>{
 const h=harness(),el=new h.Media();el.rejectFirst=true;
 await assert.rejects(el.play(),/interrupted/);await flush();
 assert.equal(h.captured().length,0);
 await el.play();await flush();
 assert.equal(h.captured().length,1,'Rejected playback must not permanently mark the element captured');
});

test('concurrent successful plays attach a music element only once',async()=>{
 const h=harness(),el=new h.Media();
 await Promise.all([el.play(),el.play()]);await flush();
 assert.equal(h.captured().length,1,'Two settled play promises must not double the recorded music');
 await el.play();await flush();assert.equal(h.captured().length,1);
});

test('an unavailable stream can be captured on a later successful play',async()=>{
 const h=harness(),el=new h.Media();el.throwCapture=true;
 await el.play();await flush();assert.equal(h.captured().length,0);
 el.throwCapture=false;await el.play();await flush();assert.equal(h.captured().length,1);
});

test('deferred tracks, repeated installation and effects retain one recorder graph',async()=>{
 const h=harness(),el=new h.Media();el.hasTracks=false;
 await el.play();await flush();assert.equal(h.captured().length,0);
 el.hasTracks=true;h.timers.shift()();await flush();assert.equal(h.captured().length,1);
 assert.equal(h.install(),h.stream);
 const effects=new h.Context(),out=new h.Node(effects,'effect');out.connect(effects.destination);
 assert.equal(h.edges.filter(e=>e.from===out).length,2,'Effects still go to speakers and recorder');
 assert.equal(h.captured().length,2,'One music source plus one effects source');
 assert.equal(h.edges.find(e=>e.from.kind==='gain').from.gain.value,.8*.5*.55);
});
