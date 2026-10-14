// What real time needs from core.mjs (format id and generation, completing and levelling sets), without core's random-team
// generator: the real-time screen loads in the app's bundle, and @pkmn/randoms would add megabytes to it for nothing.
import {Dex, toID} from '@pkmn/sim';

export class RtError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

/** A Showdown format id for real time: custom rules do not apply here, so only the base format matters. */
export function rtFormatId(format) {
  const id = toID(String(format || 'gen9customgame').split('@@@')[0]) || 'gen9customgame';
  const fmt = Dex.formats.get(id, true);
  if (!fmt.exists) throw new RtError('invalid_format', `Unknown format: ${format}`);
  return fmt.id;
}

export const rtGen = (formatId) => Dex.formats.get(formatId, true).gen || Number(String(formatId).match(/^gen(\d)/)?.[1] || 9);

const STATS = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];

function table(t, fill) {
  const out = {};
  for (const k of STATS) {
    const v = t && t[k] !== undefined && t[k] !== null && t[k] !== '' ? Number(t[k]) : fill;
    out[k] = Number.isFinite(v) ? v : fill;
  }
  return out;
}

/** Sets with what a battle needs filled in (ability, level 1-100, EVs and IVs) and the level rules applied
 * ({level} fixes, {level_cap} lowers, {level_min} raises), as core.mjs does for the turn-based battles. */
export function rtSets(sets, formatId, rules = {}) {
  const dex = Dex.forGen(rtGen(formatId));
  const fixed = Number(rules?.level) || 0;
  const cap = Number(rules?.level_cap) || 0;
  const min = Number(rules?.level_min) || 0;
  return (sets || []).map((raw) => {
    const s = raw || {};
    const species = String(s.species || s.name || '').trim();
    if (!species) throw new RtError('invalid_team', 'A Pokémon without species.');
    const sp = dex.species.get(species);
    if (!sp.exists) throw new RtError('unknown_species', `Unknown Pokémon: ${species}`, {species});
    const moves = (s.moves || []).map((m) => String(m).trim()).filter(Boolean).slice(0, 4);
    if (!moves.length) throw new RtError('invalid_team', `${species} has no moves.`, {species});
    let level = Math.round(Number(s.level)) || 100;
    level = Math.min(100, Math.max(1, level));
    if (fixed) level = fixed;
    if (cap && level > cap) level = cap;
    if (min && level < min) level = min;
    return {
      name: String(s.name && s.name !== species ? s.name : '').trim(), species, item: String(s.item || '').trim(),
      ability: String(s.ability || '').trim() || (dex.gen >= 3 ? sp.abilities?.['0'] || '' : ''), moves, nature: String(s.nature || '').trim(),
      gender: String(s.gender || '').trim().toUpperCase().slice(0, 1), evs: table(s.evs, 0), ivs: table(s.ivs, 31), level, shiny: !!s.shiny,
    };
  });
}
