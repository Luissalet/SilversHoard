import {randomTeam} from '../src/core.mjs';
import {playOut, series} from '../src/stats.mjs';
const levels = ['random','easy','normal','hard','expert'];
for (const fmt of ['gen9customgame','gen9doublescustomgame','gen3customgame','gen1customgame']) {
  for (const [a,b] of [['random','hard'],['normal','hard'],['hard','expert']]) {
    if (fmt!=='gen9customgame' && b==='expert' && fmt!=='gen3customgame') continue;
    const g = fmt.match(/gen(\d)/)[1];
    const t1 = randomTeam(`gen${g}randombattle`, 'x'+a+fmt).sets, t2 = randomTeam(`gen${g}randombattle`, 'y'+b+fmt).sets;
    const t0 = Date.now();
    let wins={p1:0,p2:0,'':0}, errs=0, turns=0;
    const N = b==='expert'?3:6;
    for (let i=0;i<N;i++){ const r = playOut({format: fmt, seed: [i,2,3,4], p1:{name:'A', sets:t1, ai:{level:a}}, p2:{name:'B', sets:t2, ai:{level:b}}}, {keepLog:false}); wins[r.summary.winner_side]++; errs+=r.errors.length; turns+=r.turns; if (r.errors.length) console.log(r.errors.slice(0,3)); }
    console.log(fmt, a,'vs',b, JSON.stringify(wins), 'errs', errs, 'avg turns', turns/N, 'ms/battle', Math.round((Date.now()-t0)/N));
  }
}
