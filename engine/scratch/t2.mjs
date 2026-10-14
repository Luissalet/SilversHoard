import {Battle, Teams, TeamValidator, Dex, toID, PRNG, extractChannelMessages} from '@pkmn/sim';
import {Sets, Teams as Teams2} from "@pkmn/sets";
import {TeamGenerators} from '@pkmn/randoms';
Teams.setGeneratorFactory(TeamGenerators);
// custom rules
for (const f of ['gen9customgame@@@Adjust Level = 50', 'gen9ou', 'gen9customgame@@@!Team Preview,Adjust Level = 50', 'gen3customgame', 'gen9doublescustomgame', 'gen9nationaldex']) {
  try { const v = Dex.formats.validate(f); const fmt = Dex.formats.get(v, true); console.log(f,'->', v, fmt.name, fmt.gameType, fmt.exists); } catch(e) { console.log(f, 'ERR', e.message); }
}
const paste = `Garchomp @ Choice Scarf
Ability: Rough Skin
Tera Type: Ground
EVs: 252 Atk / 4 SpD / 252 Spe
Jolly Nature
- Earthquake
- Outrage
- Stone Edge
- Fire Fang

Rotom-Wash @ Leftovers
Ability: Levitate
EVs: 252 HP / 252 Def / 4 SpD
Bold Nature
- Hydro Pump
- Volt Switch
- Will-O-Wisp
- Pain Split
`;
const team = Teams2.importTeam(paste);
console.log(JSON.stringify(team.team[0]));
const packed = Teams.pack(team.team);
console.log(packed);
const val = new TeamValidator('gen9ou');
console.log('validate', val.validateTeam(team.team));
const bad = Teams2.importTeam(`Pikachu\n- Surf\n- Fly\n`);
console.log('bad', new TeamValidator('gen9ou').validateTeam(bad.team));
console.log(Sets.exportSet(team.team[0]));
const t2 = Teams.generate('gen9randombattle');
const fid = Dex.formats.validate('gen9customgame@@@Adjust Level = 50');
const b = new Battle({formatid: fid, seed: PRNG.generateSeed(), p1:{name:'A', team: packed}, p2:{name:'B', team: Teams.pack(t2)}});
b.makeChoices('team 12','team 1');
console.log(b.log.slice(-12).join('\n'));
const chunk = b.log.join('\n');
const ch = extractChannelMessages(chunk, [-1,0,1,2]);
console.log(Object.keys(ch), ch[0].slice(-3), ch[1].slice(-3));
console.log(JSON.stringify(b.sides[0].activeRequest).slice(0,1500));
console.log('seed example', PRNG.generateSeed());
