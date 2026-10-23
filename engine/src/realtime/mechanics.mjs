// Canonical move/item data, adapted to the existing real-time cooldowns and six-second turns.
import {Dex} from '@pkmn/sim';
import {rtMove, TPS} from './moves.mjs';

export const DYNAMAX_SECONDS = 18;
export const DYNAMAX_SCALE = 2.2;
const MAX_MOVES = {Normal: 'maxstrike', Fire: 'maxflare', Water: 'maxgeyser', Electric: 'maxlightning',
  Grass: 'maxovergrowth', Ice: 'maxhailstorm', Fighting: 'maxknuckle', Poison: 'maxooze', Ground: 'maxquake',
  Flying: 'maxairstream', Psychic: 'maxmindstorm', Bug: 'maxflutterby', Rock: 'maxrockfall', Ghost: 'maxphantasm',
  Dragon: 'maxwyrmwind', Dark: 'maxdarkness', Steel: 'maxsteelspike', Fairy: 'maxstarfall'};

export function dynamaxInfo(species, set, gen) {
  if (gen < 8 || species.cannotDynamax || species.isMega || species.isPrimal) return null;
  const dex = Dex.forGen(gen);
  const wantsGmax = !!set.gigantamax || species.forme.endsWith('Gmax');
  const gmax = wantsGmax ? dex.species.get(species.forme.endsWith('Gmax') ? species.name : `${species.name}-Gmax`) : null;
  const base = dex.species.get(species.battleOnly || species.name);
  const level = Math.max(0, Math.min(10, Math.floor(Number(set.dynamaxLevel ?? 10) || 0)));
  return {seconds: DYNAMAX_SECONDS, scale: DYNAMAX_SCALE, hp_factor: (30 + level) / 20,
    gmax_move: gmax?.exists ? base.canGigantamax || '' : '',
    ...(gmax?.exists ? {look: {species: gmax.name, forme: gmax.forme, num: gmax.num, sprite_id: gmax.spriteid}} : {})};
}

export function maxProfile(base, info, gen) {
  if (base.id === 'struggle') return base;
  const dex = Dex.forGen(gen), move = dex.moves.get(base.id);
  const gmax = info?.gmax_move ? dex.moves.get(info.gmax_move) : null;
  const name = base.category === 'Status' ? 'maxguard' : gmax?.type === base.type ? gmax.id : MAX_MOVES[base.type];
  const profile = rtMove(name, gen);
  if (!profile) return base;
  const power = ['gmaxdrumsolo', 'gmaxfireball', 'gmaxhydrosnipe'].includes(profile.id) ? profile.power : move.maxMove?.basePower || base.power;
  return {...profile, category: base.category, power: base.category === 'Status' ? 0 : power,
    cooldown: base.cooldown, windup: base.category === 'Status' ? profile.windup : Math.max(18, profile.windup),
    hits: 1, priority: base.category === 'Status' ? profile.priority : base.priority,
    noEffect: false, isMax: true, baseMove: base.id, za: false,
    ignoreAbility: !!dex.moves.get(profile.id).ignoreAbility};
}

export function zProfile(base, species, itemId, gen) {
  if (gen < 7 || base.isZ || base.isMax) return null;
  const dex = Dex.forGen(gen), item = dex.items.get(itemId), move = dex.moves.get(base.id);
  if (!item.zMove || (item.itemUser && !item.itemUser.includes(species))) return null;
  let target;
  if (item.zMoveFrom) {
    if (move.name !== item.zMoveFrom) return null;
    target = dex.moves.get(item.zMove);
  } else {
    if (base.type !== item.zMoveType) return null;
    if (base.category === 'Status') return {...base, name: `Z-${base.name}`, isZ: true, baseMove: base.id, zBonus: move.zMove || {}};
    if (!move.zMove?.basePower) return null;
    target = dex.moves.all().find(m => m.isZ === item.id && m.type === base.type);
  }
  if (!target?.exists) return null;
  const profile = rtMove(target.id, gen);
  return {...profile, power: item.zMoveFrom ? profile.power : move.zMove.basePower,
    category: item.zMoveFrom ? profile.category : base.category, cooldown: base.cooldown,
    windup: Math.max(Math.round(.65 * TPS), profile.windup), hits: 1,
    noEffect: false, isZ: true, baseMove: base.id, za: false, ignoreAbility:!!target.ignoreAbility};
}
