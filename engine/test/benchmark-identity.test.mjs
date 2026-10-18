import assert from 'node:assert/strict';
import test from 'node:test';
import {teamBenchmark} from '../src/benchmark.mjs';

const weak={species:'Magikarp',level:1,moves:['Splash']};
const strong={species:'Mewtwo',level:100,moves:['Psychic']};
const bench=(name)=>({format:'gen9customgame',seed:'benchmark-identity820',games:2,max_turns:5,
 variants:[{id:'same',name,sets:[weak]},{id:'control',name:'Control',sets:[weak]}],
 rivals:[{id:'strong',name,sets:[strong]}]});

test('equal public labels do not credit a losing variant with its opponents wins',()=>{
 const result=teamBenchmark(bench('Same'));
 for(const row of result.variants)assert.deepEqual([row.wins,row.losses,row.ties],[0,2,0]);
 assert.equal(result.variants[0].name,'Same');
 assert.equal(result.rivals[0].name,'Same');
 assert.deepEqual(result.variants[0].by_rival[0].seeds,result.variants[1].by_rival[0].seeds);
});

test('renaming equal labels leaves scores, seeds and variant deltas unchanged',()=>{
 const spec=bench('Entrenador repetido');
 const before=structuredClone(spec);
 const original=teamBenchmark(spec);
 const renamed=teamBenchmark({...spec,variants:spec.variants.map((v,i)=>({...v,name:'Variant '+i})),rivals:spec.rivals.map((r,i)=>({...r,name:'Rival '+i}))});
 const outcomes=r=>r.variants.map(v=>({wins:v.wins,losses:v.losses,ties:v.ties,delta:v.delta,seeds:v.by_rival.map(b=>b.seeds)}));
 assert.deepEqual(outcomes(original),outcomes(renamed));
 assert.deepEqual(spec,before);
});

test('a winning candidate keeps its victory when both players share a label',()=>{
 const spec=bench('Same');
 spec.variants=spec.variants.map(v=>({...v,sets:[strong]}));
 spec.rivals=spec.rivals.map(v=>({...v,sets:[weak]}));
 for(const row of teamBenchmark(spec).variants)assert.deepEqual([row.wins,row.losses,row.ties],[2,0,0]);
});