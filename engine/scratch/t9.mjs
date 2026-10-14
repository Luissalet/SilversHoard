import {randomTeam} from '../src/core.mjs';
import {playOut} from '../src/stats.mjs';
const [A,B,N,fmt] = [process.argv[2]||'hard', process.argv[3]||'expert', Number(process.argv[4]||6), process.argv[5]||'gen9customgame'];
let score={[A]:0,[B]:0,tie:0}; const t0=Date.now();
for (let i=0;i<N;i++){
  const t1=randomTeam('gen9randombattle','t1'+i).sets, t2=randomTeam('gen9randombattle','t2'+i).sets;
  for (const swap of [false,true]){
    const p1={name:'X',sets:t1,ai:{level: swap?B:A}}, p2={name:'Y',sets:t2,ai:{level: swap?A:B}};
    const r=playOut({format:fmt, seed:[i,swap?1:0,3,4], p1, p2},{keepLog:false});
    const w=r.summary.winner_side; if(!w) score.tie++; else score[(w==='p1')===!swap?A:B]++;
  }
}
console.log(score, Math.round((Date.now()-t0)/1000)+'s');
