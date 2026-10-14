import {Battle, Teams, Dex, PRNG, toID} from '@pkmn/sim';
import {TeamGenerators} from '@pkmn/randoms';
Teams.setGeneratorFactory(TeamGenerators);
const all = Dex.formats.all();
console.log(all.length, all.slice(0,3).map(f=>[f.id,f.section,f.column,f.searchShow,f.challengeShow,f.tournamentShow,f.team,f.gameType,f.effectType]));
console.log(all.filter(f=>f.effectType==='Format' && f.searchShow!==false).slice(0,60).map(f=>f.id+'|'+f.section+'|'+(f.team||'')).join('\n'));
const d = Dex.forGen(9);
console.log(typeof d.species.getLearnsetData, typeof d.species.getMovePool);
const ls = d.species.getLearnsetData ? d.species.getLearnsetData('pikachu') : null;
console.log(ls && Object.keys(ls.learnset||{}).length);
console.log(d.species.getMovePool ? [...d.species.getMovePool('pikachu')].length : 'nomp');
const b = new Battle({formatid:'gen9customgame', seed: PRNG.generateSeed(), p1:{name:'A', team: Teams.pack(Teams.generate('gen9randombattle'))}, p2:{name:'B', team: Teams.pack(Teams.generate('gen9randombattle'))}});
b.makeChoices('team 1','team 1');
const a = b.sides[0].active[0], t = b.sides[1].active[0];
for (const m of a.moveSlots) { const mv = b.dex.getActiveMove(m.id); const dmg = b.actions.getDamage(a, t, mv, true); console.log(a.name, m.id, mv.category, dmg, t.hp, t.maxhp); }
console.log(b.actions.getDamage.length, a.getTypes(), t.getTypes(), b.field.weather, Object.keys(b.sides[1].sideConditions));
