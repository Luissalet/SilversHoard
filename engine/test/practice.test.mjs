import test from 'node:test';
import assert from 'node:assert/strict';
import {Match} from '../src/match.mjs';
import {practiceSnapshot} from '../src/practice.mjs';
import {freeze} from '../src/ai.mjs';

const spec = {id:'record',seed:'practice-source',format:'gen9customgame',
  p1:{name:'A',sets:[{species:'Mew',moves:['Splash','Psychic']}]},
  p2:{name:'B',sets:[{species:'Chansey',moves:['Splash','Tackle']}]}};
const battleLog = log => log.filter(line => !line.startsWith('|t:|'));

test('forks before both decisions, keeps past state, and can choose a different move', () => {
  const original = new Match(structuredClone(spec));
  original.choose('p1','team 1'); original.choose('p2','team 1');
  original.choose('p1','move 1'); original.choose('p2','move 1');
  const before = freeze(original.battle);
  original.choose('p1','move 2'); original.choose('p2','move 2');
  const saved = freeze(original.battle);
  const point = practiceSnapshot(original.inputLog(),2,'p1');
  const fork = new Match({...structuredClone(spec),practice:true},point.snapshot);
  assert.equal(fork.battle.turn,2);
  assert.deepEqual(battleLog(fork.battle.log),battleLog(JSON.parse(before).log));
  assert.equal(fork.battle.p2.isChoiceDone(),false);
  assert.equal(fork.battle.p1.isChoiceDone(),false);
  fork.choose('p1','move 1'); fork.choose('p2','move 1');
  assert.equal(freeze(original.battle),saved);
  assert.notDeepEqual(battleLog(fork.battle.log),battleLog(original.battle.log));
  assert.throws(()=>practiceSnapshot(original.inputLog(),99,'p1'),/no move decision/);
  assert.throws(()=>practiceSnapshot([],1,'p1'),/incomplete/);
});

test('practice AI picks the same continuation after loading its snapshot', () => {
  const source = new Match(structuredClone(spec));
  source.choose('p1','team 1'); source.choose('p2','team 1');
  source.choose('p1','move 1'); source.choose('p2','move 1');
  const point = practiceSnapshot(source.inputLog(),1,'p1');
  const aiSpec = {...structuredClone(spec),practice:true,p2:{...spec.p2,ai:{level:'random',hidden:true}}};
  const a = new Match(aiSpec,structuredClone(point.snapshot));
  const b = new Match(aiSpec,structuredClone(point.snapshot));
  a.choose('p1','move 1'); b.choose('p1','move 1');
  assert.deepEqual(battleLog(a.battle.log),battleLog(b.battle.log));
  const resumed = new Match(aiSpec,JSON.parse(freeze(b.battle)));
  a.choose('p1','move 1'); resumed.choose('p1','move 1');
  assert.deepEqual(battleLog(a.battle.log),battleLog(resumed.battle.log));
});

test('the other side and doubles keep their actual teams and pending choices', () => {
  const doubles = {...structuredClone(spec),format:'gen9doublescustomgame'};
  for (const s of ['p1','p2']) doubles[s].sets.push({species:'Pikachu',moves:['Splash']});
  const m = new Match(doubles);
  while (m.battle.turn < 2) {
    for (const s of m.battle.sides) if (s.activeRequest && !s.activeRequest.wait && !s.isChoiceDone()) m.battle.choose(s.id,'default');
  }
  const fork = new Match(doubles,practiceSnapshot(m.inputLog(),1,'p2').snapshot);
  assert.equal(fork.battle.gameType,'doubles');
  assert.equal(fork.state('p2').requests.p2.active.length,2);
  assert.equal(fork.battle.p1.isChoiceDone(),false);
  assert.deepEqual(fork.battle.p2.pokemon.map(p=>p.species.name),['Chansey','Pikachu']);
  assert.throws(()=>practiceSnapshot(m.inputLog(),0,'p2'),/Choose a turn/);
  assert.throws(()=>practiceSnapshot(m.inputLog(),1,'p3'),/Choose a turn/);
});
