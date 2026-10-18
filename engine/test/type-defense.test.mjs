import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {Dex} from '@pkmn/sim';
import {typeChallenge,scoreTypeChallenge,typeFactors} from '../src/type-challenge.mjs';
const value=(gen,type,types)=>typeFactors(gen,type,types).reduce((n,f)=>n*f.multiplier,1);
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const winning=(deck,q)=>q.options.reduce((a,b)=>value(deck.spec.gen,q.attack,a.types)<value(deck.spec.gen,q.attack,b.types)?a:b).species;

test('legacy attack decks and scores remain byte exact to the frozen shipped baseline',()=>{
  const baseline=JSON.parse(readFileSync(new URL('./fixtures/type-challenge-v1.json',import.meta.url),'utf8'));
  assert.equal(baseline.cases.length,54);
  for(const c of baseline.cases){
    const deck=typeChallenge(c.args),answers=deck.questions.map(q=>q.options[0]);
    assert.equal(hash(deck),c.deck);assert.equal(hash(typeChallenge({...c.args,goal:'attack'})),c.deck);
    assert.equal(hash(scoreTypeChallenge({...c.args,answers})),c.score);
  }
});

test('defensive decks cover all generations with ten distinct threats and one unique lowest factor',()=>{
  const minima=new Set();
  for(let gen=1;gen<=9;gen++)for(const mode of ['single','dual'])for(const seed of ['A','B','C']){
    const deck=typeChallenge({gen,mode,seed,goal:'defend'}),dex=Dex.mod(`gen${gen}`);
    assert.equal(deck.spec.goal,'defend');assert.equal(deck.questions.length,10);
    assert.equal(new Set(deck.questions.map(q=>q.attack)).size,10);
    assert.deepEqual(typeChallenge(deck.spec),deck);
    for(const q of deck.questions){
      assert.ok(!dex.types.get(q.attack).isNonstandard);
      assert.equal(new Set(q.options.map(o=>o.species)).size,4);
      for(const mon of q.options){
        const species=dex.species.get(mon.species);
        assert.ok(species.gen<=gen&&!species.forme&&!species.isNonstandard);
        assert.deepEqual(mon.types,species.types);assert.equal(mon.types.length,mode==='single'?1:2);
        assert.equal('multiplier'in mon,false);
      }
      const factors=q.options.map(mon=>value(gen,q.attack,mon.types)),low=Math.min(...factors);
      assert.equal(factors.filter(n=>n===low).length,1);minima.add(low);
      const pool=dex.species.all().filter(s=>s.exists&&s.num>0&&s.gen<=gen&&!s.forme&&!s.isNonstandard&&s.types.length===(mode==='single'?1:2));
      assert.equal(low,Math.min(...pool.map(s=>value(gen,q.attack,s.types))));
    }
  }
  assert.ok(minima.has(0)&&minima.has(.25)&&minima.has(.5));
});

test('defensive prefixes, mistake review and streaks are regenerated with real per-type factors',()=>{
  const deck=typeChallenge({gen:9,mode:'dual',goal:'defend',seed:'defensive-score'}),answers=deck.questions.map(q=>winning(deck,q));
  answers[2]=deck.questions[2].options.find(o=>o.species!==answers[2]).species;
  const score=scoreTypeChallenge({...deck.spec,answers}),prefix=scoreTypeChallenge({...deck.spec,answers:answers.slice(0,5)});
  assert.equal(score.correct,9);assert.equal(score.streak,7);assert.equal(score.best_streak,7);assert.equal(score.complete,true);
  assert.equal(prefix.complete,false);assert.equal(prefix.correct,4);assert.deepEqual(prefix.feedback,score.feedback.slice(0,5));
  for(const f of score.feedback){
    assert.equal(f.attack,deck.questions[f.round-1].attack);
    for(const c of [f.best,f.chosen])assert.equal(c.multiplier,c.factors.reduce((n,x)=>n*x.multiplier,1));
    assert.ok(f.best.multiplier<=f.chosen.multiplier);
  }
  assert.equal(scoreTypeChallenge({...deck.spec,answers:[]}).answered,0);
});

test('defensive practice rejects invalid goals and forged defenders and avoids global randomness',()=>{
  assert.throws(()=>typeChallenge({goal:'switch-optimally'}));
  const random=Math.random;Math.random=()=>{throw Error('unseeded RNG');};
  try{
    const deck=typeChallenge({goal:'defend',seed:'defence áé😊'});
    assert.notDeepEqual(typeChallenge({...deck.spec,seed:'other'}).questions,deck.questions);
    assert.throws(()=>scoreTypeChallenge({...deck.spec,answers:['Fire']}));
    assert.throws(()=>scoreTypeChallenge({...deck.spec,answers:['Forged'],questions:[{options:[{species:'Forged',types:['Ghost']}]}]}));
    assert.throws(()=>scoreTypeChallenge({...deck.spec,answers:[deck.questions[0].options[0]]}));
  }finally{Math.random=random;}
});
