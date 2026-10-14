import {Battle, Teams, Dex, PRNG} from '@pkmn/sim';
import {TeamGenerators} from '@pkmn/randoms';
Teams.setGeneratorFactory(TeamGenerators);
const t = () => Teams.pack(Teams.generate('gen9randombattle'));
for (const fid of ['gen9customgame@@@Adjust Level = 50', 'gen9customgame@@@adjustlevel=50']) {
  const fmt = Dex.formats.get(fid, true);
  const rt = Dex.formats.getRuleTable(fmt);
  console.log(fid, fmt.customRules, rt.adjustLevel);
  const b = new Battle({formatid: fid, format: fmt, seed: PRNG.generateSeed(), p1:{name:'A', team: t()}, p2:{name:'B', team: t()}});
  console.log(b.ruleTable.adjustLevel, b.sides[0].pokemon.map(p=>p.level).join(','));
  const b2 = new Battle({formatid: fid, seed: PRNG.generateSeed(), p1:{name:'A', team: t()}, p2:{name:'B', team: t()}});
  console.log('noformat', b2.ruleTable.adjustLevel, b2.sides[0].pokemon.map(p=>p.level).join(','));
}
