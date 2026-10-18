import test from 'node:test';
import assert from 'node:assert/strict';
import {teamBenchmark} from '../src/benchmark.mjs';
import {metagameThreats, sampleMetagame} from '../src/metagame.mjs';
import {validateTeam} from '../src/core.mjs';

const species=['Bulbasaur','Ivysaur','Venusaur','Charmander','Charmeleon','Charizard','Squirtle','Wartortle','Blastoise',
  'Caterpie','Metapod','Butterfree','Weedle','Kakuna','Beedrill','Pidgey','Pidgeotto','Pidgeot','Rattata','Raticate'];
const corpus={format_requested:'gen9customgame',usage_format:'gen9ou',sha256:'fixture728',entries:species.map((name,index)=>({
  species:name,usage:index+1,sets:[{species:name,moves:['Splash']}],source_formats:['gen9ou']}))};

test('a metagame benchmark executes one candidate against one hundred sampled rivals',()=>{
  const result=teamBenchmark({rival_source:'metagame',corpus,seed:'meta728',format:'gen9customgame',games:1,max_turns:1,
    variants:[{id:'candidate',name:'Candidate',sets:[{species:'Magikarp',moves:['Splash']}],ai:{level:'normal'}}]});
  assert.equal(result.rivals.length,100);
  assert.equal(result.variants.length,1);
  const row=result.variants[0];
  assert.equal(row.wins+row.losses+row.ties,100);
  assert.equal(row.by_rival.length,100);
  assert.equal(result.hall_of_fame_touched,false);
  assert.deepEqual(row.threats,[]); // no damage or KOs from Splash: a team loss is not a contribution
});

test('sampling freezes distinct unordered rosters and is stable without mutating the corpus',()=>{
  const before=structuredClone(corpus);
  const options={seed:'sample728',format:'gen9customgame'};
  const first=sampleMetagame(corpus,options);
  assert.deepEqual(sampleMetagame(corpus,options),first);
  assert.notDeepEqual(sampleMetagame(corpus,{...options,seed:'other728'}).pool,first.pool);
  assert.deepEqual(corpus,before);
  assert.equal(first.pool.length,100);
  assert.equal(new Set(first.pool.map((r)=>r.sets.map((s)=>JSON.stringify(s)).sort().join('\n'))).size,100);
  assert.ok(first.pool.every((r)=>r.sets.length===6 && validateTeam(options.format,r.sets).ok));
  first.pool[0].sets[0].moves[0]='Tackle';
  assert.deepEqual(corpus,before);
});

test('six species with one set give one roster rather than a hundred permutations',()=>{
  const sample=sampleMetagame({...corpus,entries:corpus.entries.slice(0,6)},
    {seed:'short728',format:'gen9customgame'});
  assert.equal(sample.pool.length,1);
  assert.equal(sample.complete,false);
  assert.equal(sample.reason,'corpus_exhausted');
  assert.equal(sample.attempts,1);
  const empty=sampleMetagame({...corpus,entries:corpus.entries.slice(0,5)},
    {seed:'short728',format:'gen9customgame'});
  assert.equal(empty.pool.length,0);
  assert.equal(empty.reason,'insufficient_species');
});

test('formats with smaller rosters use their actual team size rather than producing an empty sample',()=>{
  const names=['Pikachu','Raichu','Snorlax','Blastoise','Charizard','Venusaur','Garchomp','Gardevoir','Lucario',
    'Tyranitar','Gengar','Arcanine','Vaporeon','Jolteon','Flareon','Eevee','Leafeon','Glaceon','Espeon','Umbreon','Sylveon'];
  const entries=names.map((species)=>({species,usage:1,sets:[{species,moves:['Rest'],evs:{hp:252}}]}));
  const sample=sampleMetagame({...corpus,entries},{seed:'one-v-one728',format:'gen91v1'});
  assert.equal(sample.generated,100);
  assert.equal(sample.team_size,3);
  assert.ok(sample.pool.every((p)=>p.sets.length===3 && validateTeam('gen91v1',p.sets).ok));
});

test('usage weights affect selection without selecting two forms of one base species',()=>{
  const entries=[...corpus.entries,
    {species:'Charizard-Mega-Y',usage:10000,sets:[{species:'Charizard',item:'Charizardite Y',moves:['Splash']}]}];
  const sample=sampleMetagame({...corpus,entries},{seed:'weighted728',format:'gen9customgame'});
  assert.ok(sample.pool.every((r)=>new Set(r.sets.map((s)=>s.species)).size===6));
  assert.ok(sample.pool.filter((r)=>r.sets.some((s)=>s.item==='Charizardite Y')).length>=95);
});

test('fallback data is validated against the requested OU rules, not its source label',()=>{
  const names=['Snorlax','Tauros','Chansey','Exeggutor','Starmie','Alakazam','Jynx','Mewtwo'];
  const entries=names.map((s)=>({species:s,usage:1,sets:[{species:s,moves:['Rest'],evs:{hp:252}}],source_formats:['gen1ubers']}));
  const sample=sampleMetagame({entries},{seed:'legal728',format:'gen1ou',count:3});
  assert.equal(sample.pool.length,3);
  assert.ok(sample.rejected>0);
  for(const rival of sample.pool) {
    assert.ok(!rival.sets.some((s)=>s.species==='Mewtwo'));
    assert.equal(validateTeam('gen1ou',rival.sets).ok,true);
  }
  assert.deepEqual(sample.source_formats,['gen1ubers']);
});

test('ranked threats sum actual contributions with roster appearances and deterministic ties',()=>{
  const sets=['Raichu','Pikachu','Magikarp','Ditto'].map((species)=>({species}));
  const threats=metagameThreats([
    {sets,pokemon:[{species:'Raichu',kos:1,damage:0.5},{species:'Pikachu',kos:0,damage:2},
      {species:'Ditto',kos:0,damage:2}]},
    {sets,pokemon:[{species:'Raichu',kos:1,damage:0.7}]},
  ]);
  assert.deepEqual(threats,[
    {species:'Raichu',appearances:2,kos:2,damage:1.2},
    {species:'Ditto',appearances:2,kos:0,damage:2},
    {species:'Pikachu',appearances:2,kos:0,damage:2},
  ]);
});

test('an old exact pool can be reused without reloading or sampling a changed corpus',()=>{
  const args={rival_source:'metagame',corpus,seed:'snapshot728',format:'gen9customgame',games:1,max_turns:1,
    variants:[{id:'candidate',name:'Candidate',sets:[{species:'Magikarp',moves:['Splash']}]}]};
  const original=teamBenchmark(args);
  const replay=teamBenchmark({...args,corpus:{entries:[]},sample:original.metagame});
  assert.deepEqual(replay,original);
});

test('threats in a real hundred-battle run are recoverable from each opponent contribution',()=>{
  const attacking={...corpus,entries:corpus.entries.map((e)=>({...e,sets:e.sets.map((s)=>({...s,moves:['Tackle']}))}))};
  const result=teamBenchmark({rival_source:'metagame',corpus:attacking,seed:'damage728',format:'gen9customgame',games:1,max_turns:3,
    variants:[{id:'weak',name:'Weak',sets:[{species:'Magikarp',level:1,moves:['Splash']}]}]});
  const row=result.variants[0];
  assert.equal(row.losses,100);
  assert.equal(row.threats.length,3);
  const observations=row.by_rival.flatMap((br)=>br.observations.map((o)=>({
    sets:result.metagame.pool.find((p)=>p.id===br.rival_id).sets,pokemon:o.pokemon,
  })));
  assert.deepEqual(row.threats,metagameThreats(observations));
  assert.equal(observations.reduce((sum,o)=>sum+o.pokemon.reduce((s,p)=>s+p.kos,0),0),100);
  assert.ok(row.threats.every((t)=>t.kos>0 && t.damage>0 && t.appearances>=t.kos));
  assert.equal(result.damage_unit,'pokemon_hp_bars');
});

test('real-time metagame results preserve their own damage units and game cardinality',()=>{
  const attacking={...corpus,entries:corpus.entries.map((e)=>({...e,sets:e.sets.map((s)=>({...s,moves:['Tackle']}))}))};
  const result=teamBenchmark({rival_source:'metagame',corpus:attacking,seed:'rt-meta728',format:'gen9customgame',
    mode:'realtime',time_limit:30,arena:'open',games:1,
    variants:[{id:'weak',name:'Weak',sets:[{species:'Magikarp',level:1,moves:['Splash']},
      {species:'Snorlax',moves:['Splash']}]}]});
  assert.equal(result.damage_unit,'mean_opposing_pokemon_hp_bars');
  assert.equal(result.variants[0].played,100);
  assert.equal(result.variants[0].by_rival.length,100);
  assert.ok(result.variants[0].threats.length>0);
  // Magikarp Lv1 = 11 HP, Snorlax Lv100 = 461 HP: one reference bar is their mean, 236 HP.
  // Using the team's total (472 HP) would incorrectly halve every reported contribution.
  const contributors=result.variants[0].by_rival.flatMap((br)=>br.observations.flatMap((o)=>o.pokemon)).filter((p)=>p.dealt>0);
  assert.ok(contributors.length>0);
  for(const mon of contributors) assert.equal(mon.damage,Math.round(mon.dealt/236*100)/100);
});
