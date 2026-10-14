import {randomTeam} from '../src/core.mjs';
import {Match} from '../src/match.mjs';
const t1 = randomTeam('gen9randombattle','a').sets, t2=randomTeam('gen9randombattle','b').sets;
for (let i=0;i<8;i++){
const m = new Match({format:'gen9doublescustomgame', seed:[i,1,1,1], p1:{name:'A',sets:t1,ai:{level:'random'}}, p2:{name:'B',sets:t2,ai:{level:'hard'}}});
m.advance(100000);
if (m.errors.length) { console.log(m.errors); }
}
