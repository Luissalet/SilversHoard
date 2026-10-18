// Native API and renderer use the same deterministic material rules.
import {writeFileSync} from 'node:fs';
import {Dex} from '@pkmn/sim';
import '../engine/src/core.mjs'; // Registers the same additional move data as the app.
import {rtMove} from '../engine/src/realtime/moves.mjs';
import {effectProfile,STATUS_EFFECTS} from '../client/src/battle/rt/supplied-moves.js';
const profiles = Object.fromEntries(Dex.moves.all().filter(m=>m.exists).map(m=>[m.id,effectProfile(rtMove(m.id))]));
writeFileSync(new URL('../silvers_hoard/presets/rt_move_effects.json',import.meta.url),JSON.stringify({schema:1,default_enabled:true,profiles,statuses:STATUS_EFFECTS}));
console.log(`${Object.keys(profiles).length} move effect profiles`);
