// node --import ./engine/test/fixtures/rt-lite-register.mjs ...: load @pkmn/sim as the app's real-time chunk has it (no
// learnsets, legality tables or descriptions; engine/scripts/rt_lite.mjs).
import {register} from 'node:module';

register('../../scripts/rt_lite.mjs', import.meta.url);
