// The real-time screen's lighter @pkmn/sim. Real time only reads species, moves, items, abilities, natures, the type chart and
// the formats list through `Dex`, but @pkmn/sim's Dex statically imports every generation's learnsets, the event legality
// tables, the Pokémon GO data and the English descriptions, which only the team validator and the description fields use. In
// the app's bundle those modules are replaced by empty tables (the plugin below), and `engine/test/rt-lite.test.mjs` loads the
// same replacement in Node (the loader hooks below) to prove that every species, move, item, ability and format real time can
// read, and every battle, is the same with and without them. Build-time and test-time only: never imported by browser code.
import {fileURLToPath} from 'node:url';

const SIM_DIR = '/@pkmn/sim/build/esm/';
const MODS = ['gen2', 'gen6', 'gen8', 'gen8bdsp', 'gen8legends'];

/** Module path inside @pkmn/sim/build/esm -> the source that replaces it. */
export const RT_LITE_STUBS = {
  'data/learnsets.mjs': 'export const Learnsets = {};',
  'data/legality.mjs': 'export const Legality = {};',
  'data/pokemongo.mjs': 'export const PokemonGoData = {};',
  'data/text/abilities.mjs': 'export const AbilitiesText = {};',
  'data/text/items.mjs': 'export const ItemsText = {};',
  'data/text/moves.mjs': 'export const MovesText = {};',
  'data/text/default.mjs': 'export const DefaultText = {};',
  ...Object.fromEntries(MODS.flatMap((m) => [
    [`data/mods/${m}/learnsets.mjs`, 'export const Learnsets = {};'],
    [`data/mods/${m}/legality.mjs`, 'export const Legality = {};'],
  ])),
};

/** The stub for a resolved module path or file URL, or null when the module is kept. */
export function rtLiteStub(file) {
  const path = String(file).replace(/\\/g, '/').split('?')[0];
  const at = path.lastIndexOf(SIM_DIR);
  if (at < 0) return null;
  return RT_LITE_STUBS[path.slice(at + SIM_DIR.length)] ?? null;
}

/** Vite/Rollup plugin for the app build. Only the real-time chunk may carry @pkmn/sim in the app: if another chunk ever does,
 * the build fails instead of shipping a Dex without learnsets or descriptions to a screen that may need them. */
export function rtLitePlugin({chunk = 'CombateRt'} = {}) {
  return {
    name: 'silver-rt-lite',
    enforce: 'pre',
    load(id) {
      return rtLiteStub(id);
    },
    generateBundle(_, bundle) {
      for (const [name, out] of Object.entries(bundle)) {
        if (out.type !== 'chunk' || name.includes(chunk)) continue;
        if (Object.keys(out.modules).some((id) => id.includes(SIM_DIR))) {
          this.error(`${name} bundles @pkmn/sim with the real-time stubs (no learnsets, no descriptions); only ${chunk} may.`);
        }
      }
    },
  };
}

/** Node module hooks (module.register) that load the same stubs, for tests. */
export async function resolve(specifier, context, next) {
  const result = await next(specifier, context);
  if (result.url.startsWith('file:') && rtLiteStub(fileURLToPath(result.url))) {
    return {url: `data:text/javascript,${encodeURIComponent(rtLiteStub(fileURLToPath(result.url)))}`, shortCircuit: true};
  }
  return result;
}
