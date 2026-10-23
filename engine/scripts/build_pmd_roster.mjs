// All official species, battle forms and cosmetics understood by Silver's installed engine.
import fs from 'node:fs';
import {Dex} from '@pkmn/sim';
import '../src/core.mjs';
import {CHAMPIONS_MODS} from '../src/champions.mjs';

const roster = new Map();
for (const dex of [Dex, ...CHAMPIONS_MODS.map(mod => Dex.mod(mod))]) {
  for (const species of dex.species.all()) {
    if (species.num < 1 || species.num > 1025) continue;
    for (const name of [species.name, ...(species.cosmeticFormes || [])]) {
      const mon = dex.species.get(name);
      roster.set(mon.id, {id:mon.id, name:mon.name, num:mon.num, base:mon.baseSpecies,
        form:mon.forme || '', nonstandard:mon.isNonstandard || null, battleOnly:mon.battleOnly || null});
    }
  }
}
const data = [...roster.values()].sort((a,b) => a.num-b.num || a.id.localeCompare(b.id));
const raw = JSON.stringify(data, null, 2) + '\n';
if (process.argv[2]) fs.writeFileSync(process.argv[2], raw); else process.stdout.write(raw);
