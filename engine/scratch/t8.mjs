import {randomTeam} from '../src/core.mjs';
import {Match} from '../src/match.mjs';
import * as ai from '../src/ai.mjs';
const t1 = randomTeam('gen9randombattle','a').sets, t2=randomTeam('gen9randombattle','b').sets;
const m = new Match({format:'gen9doublescustomgame', seed:[1,1,1,1], p1:{name:'A',sets:t1,ai:null}, p2:{name:'B',sets:t2,ai:{level:'hard'}}});
m.advance();
for (let k=0;k<40 && !m.battle.ended;k++){
  const s = m.battle.sides[0]; const req = s.activeRequest;
  const c = ai.chooseFor(m.battle,'p1',{level:'random', rng: ai.makeRng(k)});
  const ok = m.battle.choose('p1', c);
  if (!ok) { console.log('BAD', c, s.choice.error, JSON.stringify(req.active.map(a=>a.moves.map(x=>x.id+':'+x.target))), req.side.pokemon.map(p=>p.condition+(p.active?'*':'')).join(' '), s.active.map(p=>p&&p.name+':'+p.fainted)); m.battle.choose('p1','default'); }
  m.advance();
}
