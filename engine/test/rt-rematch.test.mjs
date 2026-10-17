import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

// Execute the screen's real handler with its API/navigation boundary replaced.
const source = readFileSync(new URL('../../client/src/pages/CombateRt.jsx', import.meta.url), 'utf8');
const body = source.match(/const again = async \(\) => \{([\s\S]*?)\n  \};\n  const runActive/)[1];
const again = new (Object.getPrototypeOf(async function() {}).constructor)('battle', 'api', 'go', 'lang', body);
async function request(battle) {
  let sent, route;
  await again(battle, {call:async (name,args) => {assert.equal(name,'battle_start'); sent=args; return {id:'new-battle'};}}, x => {route=x;}, 'es');
  assert.equal(route,'#/combate/new-battle');
  return sent;
}
const team1 = [{species:'Pikachu',moves:['Thunderbolt'],level:42}];
const team2 = [{species:'Snorlax',moves:['Splash'],level:73}];
function fixture() {
  return {id:'old-battle',status:'ended',format:'gen9customgame',level_rules:{level:50},
    p1:{trainer_id:'',name:'Jugador Ñ',human:true,ai:null},
    p2:{trainer_id:'',name:'Rival',human:false,ai:{level:'hard',style:'aggressive',hidden:true}},
    rt:{time_limit:120,arena:'open',tick:90,forfeit:'p1',spec:{p1:{sets:team1},p2:{sets:team2}}}};
}

for (const reason of ['forfeit','ko']) test(`rematch after ${reason} retains direct teams and their order without changing the saved battle`, async () => {
  const battle=fixture(); battle.summary={reason};
  const before=JSON.stringify(battle), sent=await request(battle);
  assert.deepEqual(sent.p1.team,team1);
  assert.deepEqual(sent.p2.team,team2);
  assert.equal(sent.p1.name,'Jugador Ñ');
  assert.equal(sent.p1.human,true);
  assert.equal(sent.p2.human,false);
  assert.equal(sent.p2.ai_level,'hard');
  assert.equal(sent.p2.ai_style,'aggressive');
  assert.equal(sent.p2.ai_hidden,true);
  assert.equal(sent.format,'gen9customgame');
  assert.deepEqual(sent.level_rules,{level:50});
  assert.equal(sent.time_limit,120);
  assert.equal(sent.rt_arena,'open');
  assert.equal(sent.mode,'realtime');
  assert.equal(sent.lang,'es');
  assert.equal(JSON.stringify(battle),before);
  assert.equal('seed' in sent,false,'A rematch receives its own seed');
  assert.equal('inputs' in sent,false,'A rematch does not replay the old controls');
});

test('saved trainers retain their identity and AI choices in a mixed rematch', async () => {
  const battle=fixture(); battle.p2.trainer_id='trainer-saved';
  const sent=await request(battle);
  assert.equal(sent.p2.trainer_id,'trainer-saved');
  assert.equal('team' in sent.p2,false);
  assert.equal(sent.p2.ai_level,'hard');
  assert.equal(sent.p2.ai_style,'aggressive');
  assert.deepEqual(sent.p1.team,team1);
});

test('older views with direct sets keep their existing teams', async () => {
  const battle=fixture(); battle.p1.sets=team2;
  assert.deepEqual((await request(battle)).p1.team,team2);
});

test('a saved custom field is forwarded intact instead of looking up its edited or deleted original', async () => {
  const battle=fixture();
  battle.rt.arena={id:'old-arena',name:'Pasillo Ñ',floor:'ice',rocks:[{x:14,y:8,r:1}]};
  const before=JSON.stringify(battle);
  assert.deepEqual((await request(battle)).rt_arena,battle.rt.arena);
  assert.equal(JSON.stringify(battle),before);
});
