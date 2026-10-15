// How a move of the turn-based games works in real time: its cooldown (instead of PP), its wind-up, its shape on the field
// (a strike in front, a dash, a projectile, a beam, an area) and its range. Moves usable in Legends: Z-A keep that game's
// cooldown; every other move gets one worked out from its PP, power and kind, fitted to Z-A's own table (see `derivedCooldown`).
import {Dex, toID} from '@pkmn/sim';
import {COOLDOWN_MAX, COOLDOWN_MIN, SECONDS_PER_100_SPEED, SPEED_FLOOR, ZA_COOLDOWN, ZA_HITS, ZA_POWER} from './za-data.mjs';

export const TPS = 30; // simulation ticks per second (Legends: Z-A counts cooldowns in 1/30 s frames on the first Switch)

// Contact moves that charge across the field instead of striking in place (Z-A's "dash" moves: Take Down, Volt Tackle...).
const DASH = new Set(['quickattack', 'extremespeed', 'aquajet', 'machpunch', 'bulletpunch', 'takedown', 'doubleedge', 'flareblitz',
  'volttackle', 'wildcharge', 'bravebird', 'headsmash', 'flamecharge', 'flamewheel', 'rollout', 'spark', 'megahorn', 'waterfall',
  'aquastep', 'wavecrash', 'headlongrush', 'gigaimpact', 'dragonrush', 'zenheadbutt', 'skullbash', 'accelerock', 'firstimpression',
  'uturn', 'flipturn', 'fly', 'bounce', 'dig', 'phantomforce', 'shadowforce', 'skyattack', 'glaiverush', 'collisioncourse',
  'electrodrift', 'jetpunch', 'trailblaze', 'lunge', 'gyroball', 'steelroller', 'bodypress', 'heavyslam', 'heatcrash', 'outrage',
  'thrash', 'petaldance', 'rapidspin', 'mortalspin', 'facade', 'return', 'frustration', 'tackle']);
// Non-contact moves that travel as a straight, fast beam rather than a ball.
const BEAM = new Set(['hyperbeam', 'icebeam', 'solarbeam', 'psybeam', 'bubblebeam', 'aurorabeam', 'signalbeam', 'chargebeam', 'flashcannon',
  'hydropump', 'hydrocannon', 'blastburn', 'frenzyplant', 'zapcannon', 'dragonpulse', 'darkpulse', 'waterpulse', 'originpulse',
  'flamethrower', 'thunderbolt', 'dazzlinggleam', 'prismaticlaser', 'photongeyser', 'steelbeam', 'meteorbeam', 'eternabeam',
  'fleurcannon', 'armorcannon', 'dynamaxcannon', 'moongeistbeam', 'hyperspacehole', 'lusterpurge', 'mistball', 'electroball',
  'triattack', 'dracometeor', 'focusblast', 'aurasphere', 'shadowball', 'energyball', 'sludgebomb', 'earthpower', 'psychic',
  'psyshock', 'moonblast', 'airslash', 'hurricane', 'thunder', 'fireblast', 'blizzard', 'leafstorm', 'overheat', 'makeitrain']);
// Moves that hit where the target stands after a short delay (no travel), like Thunder or Psychic in Z-A.
const AT_TARGET = new Set(['thunder', 'psychic', 'earthpower', 'futuresight', 'doomdesire', 'psyshock', 'psystrike', 'hurricane',
  'thunderclap', 'judgment', 'fissure', 'sheercold', 'rockslide', 'stoneedge', 'meteormash', 'spacialrend', 'roaroftime']);

// What the real-time rules cannot do: these status moves have no effect here (they still go on cooldown).
export const NO_EFFECT = new Set(['transform', 'sketch', 'mimic', 'copycat', 'assist', 'mefirst', 'snatch', 'allyswitch', 'instruct',
  'afteryou', 'quash', 'helpinghand', 'followme', 'ragepowder', 'spotlight', 'trickroom', 'magicroom', 'wonderroom', 'gravity',
  'skillswap', 'roleplay', 'entrainment', 'simplebeam', 'worryseed', 'gastroacid', 'trick', 'switcheroo', 'bestow', 'recycle',
  'imprison', 'grudge', 'spite', 'lockon', 'mindreader', 'foresight', 'odorsleuth', 'miracleeye', 'celebrate', 'holdhands',
  'happyhour', 'splash', 'conversion', 'conversion2', 'reflecttype', 'camouflage', 'powertrick', 'powersplit', 'guardsplit',
  'powerswap', 'guardswap', 'speedswap', 'heartswap', 'sleeptalk', 'snore', 'magiccoat', 'electrify', 'iondeluge', 'embargo',
  'fling', 'naturalgift', 'stockpile', 'swallow', 'spitup', 'bide', 'counter', 'mirrorcoat', 'metalburst', 'comeuppance',
  'destinybond', 'perishsong', 'disable', 'encore', 'teatime', 'courtchange', 'corrosivegas', 'lunardance', 'healingwish',
  'memento', 'mistyexplosion', 'doodle', 'revivalblessing', 'shedtail', 'chillyreception', 'luckychant', 'focuspunch']);

const BOOST_KEYS = ['atk', 'def', 'spa', 'spd', 'spe'];

/** A cooldown for a move Legends: Z-A does not have, from its PP, power and effect. Fitted to Z-A's table: moves with lots of
 * PP recharge fast, five-PP moves are slow, setup and recovery moves are slow, priority moves always take 3 s. */
const HEALS = new Set(['rest', 'wish', 'shoreup', 'strengthsap', 'moonlight', 'morningsun', 'synthesis', 'roost', 'recover', 'softboiled',
  'milkdrink', 'slackoff', 'healorder', 'junglehealing', 'lifedew', 'lunarblessing', 'purify']);

export function derivedCooldown(move) {
  const pp = move.pp || 10;
  if (move.category === 'Status') {
    if (move.id === 'endure') return 12;
    if (move.stallingMove || ['protect', 'detect', 'kingsshield', 'spikyshield', 'banefulbunker', 'obstruct', 'silktrap', 'burningbulwark',
      'doubleteam', 'minimize'].includes(move.id)) return 15;
    if (move.priority > 0) return 3;
    if (move.heal || HEALS.has(move.id)) return 15;
    if (move.weather || move.terrain || move.pseudoWeather || ['haze', 'curse', 'perishsong'].includes(move.id)) return 15;
    if (move.target === 'self' || move.target === 'allySide' || move.target === 'adjacentAllyOrSelf' || move.target === 'allies') {
      if (move.boosts) {
        const keys = Object.keys(move.boosts);
        const total = Object.values(move.boosts).reduce((a, b) => a + Math.abs(b), 0);
        if (keys.length >= 2) return 18;
        if (keys[0] === 'atk' || keys[0] === 'spa') return total >= 2 ? 15 : 10;
        return 9;
      }
      if (move.sideCondition) return 12;
      return 10;
    }
    if (move.status) return 10;
    if (move.sideCondition) return 8;
    if (move.boosts) return Object.values(move.boosts).some((v) => v <= -2) ? 10 : 7;
    if (move.volatileStatus === 'confusion') return 8;
    return 10;
  }
  if (move.priority > 0) return 3;
  const power = ZA_POWER[move.id] ?? move.basePower ?? 0;
  if (move.ohko) return 20;
  if (move.self?.volatileStatus === 'lockedmove') return 15;
  if (move.self?.volatileStatus === 'mustrecharge' || move.flags?.recharge) return 20;
  if (move.selfdestruct) return 15;
  if (move.flags?.charge) return 12;
  if (move.multihit) return 6;
  if (move.selfSwitch) return 12;
  if (power >= 140) return 15;
  if (pp >= 35 && power <= 40) return 4;
  if (pp >= 20) return power >= 80 ? 8 : 6;
  if (pp >= 15) return power >= 90 ? 8 : 7;
  if (pp >= 10) return power >= 100 ? 10 : 8;
  return power >= 120 ? 12 : 10;
}

/** Base cooldown in seconds: Z-A's value when the move exists there, otherwise the derived one. */
export function baseCooldown(move) {
  const za = ZA_COOLDOWN[move.id];
  const s = za ?? derivedCooldown(move);
  return Math.min(COOLDOWN_MAX, Math.max(COOLDOWN_MIN, s));
}

/** The cooldown a Pokémon really waits: Speed takes 3 s off per 100 points over 25 (floor 3 s); priority moves stay at 3 s.
 * `mod` multiplies Speed first (Choice Scarf, Tailwind, Swift Swim in rain...). Stat stages do not count, as in Z-A. */
export function finalCooldown(baseSeconds, speed, {priority = 0, mod = 1} = {}) {
  if (priority > 0) return COOLDOWN_MIN;
  const eff = Math.floor(speed * mod);
  return Math.max(COOLDOWN_MIN, baseSeconds - SECONDS_PER_100_SPEED * Math.max(0, eff - SPEED_FLOOR) / 100);
}

function shapeOf(move) {
  const id = move.id;
  if (move.category === 'Status') {
    if (['self', 'allySide', 'allies', 'adjacentAllyOrSelf', 'all', 'allyTeam'].includes(move.target)) return 'self';
    if (move.target === 'foeSide') return 'field';
    return 'wave'; // a status move aimed at the foe travels like a slow projectile (Thunder Wave, Will-O-Wisp, Spore...)
  }
  if (move.selfdestruct) return 'burst';
  if (move.target === 'allAdjacent') return 'burst';       // around the user (Earthquake, Surf, Discharge, Explosion)
  if (move.flags?.contact) return DASH.has(id) ? 'dash' : 'strike';
  if (AT_TARGET.has(id)) return 'drop';
  if (move.target === 'allAdjacentFoes') return 'cone';    // a wide blast in front (Heat Wave, Rock Slide, Icy Wind, Hyper Voice)
  if (BEAM.has(id)) return 'beam';
  return 'shot';
}

// meters; speed in m/s; ticks at TPS
const SHAPES = {
  strike: {reach: 1.9, arc: 0.5, speed: 0, radius: 0},          // arc: cos of the half angle in front that the strike covers
  dash: {reach: 6.5, arc: 0.3, speed: 15, radius: 0.55},
  shot: {reach: 20, arc: 0, speed: 15, radius: 0.45},
  beam: {reach: 22, arc: 0, speed: 32, radius: 0.55},
  wave: {reach: 12, arc: 0, speed: 13, radius: 0.5},
  cone: {reach: 5, arc: 0.55, speed: 0, radius: 0},
  burst: {reach: 3.4, arc: -1, speed: 0, radius: 3.4},
  drop: {reach: 14, arc: 0, speed: 0, radius: 1.3},
  self: {reach: 0, arc: 0, speed: 0, radius: 0},
  field: {reach: 0, arc: 0, speed: 0, radius: 0},
};

function windupTicks(move, shape) {
  if (move.priority > 0) return 0;
  if (move.flags?.charge) return Math.round(1.6 * TPS);         // Solar Beam, Sky Attack, Skull Bash...: long wind-up, no turn off
  if (['fly', 'bounce', 'dig', 'dive', 'phantomforce', 'shadowforce'].includes(move.id)) return Math.round(0.9 * TPS);
  if (move.category === 'Status') return shape === 'self' || shape === 'field' ? 6 : 9;
  if (move.ohko) return Math.round(1.4 * TPS);
  const power = ZA_POWER[move.id] ?? move.basePower ?? 0;
  if (shape === 'drop') return 18;
  if (power >= 140) return 22;
  if (power >= 110) return 16;
  if (shape === 'strike') return 7;
  if (shape === 'dash') return 6;
  return 10;
}

const cache = new Map();

/** Everything the simulator needs about one move in a generation. */
export function rtMove(id, gen = 9) {
  const key = `${gen}:${toID(id)}`;
  if (cache.has(key)) return cache.get(key);
  const dex = Dex.forGen(gen);
  const m = dex.moves.get(id);
  if (!m.exists) return null;
  const shape = shapeOf(m);
  const geom = SHAPES[shape];
  const hits = ZA_HITS[m.id] || (Array.isArray(m.multihit) ? (m.multihit[1] >= 5 ? 5 : m.multihit[1]) : m.multihit || 1);
  const power = ZA_POWER[m.id] ?? m.basePower ?? 0;
  const profile = {
    id: m.id, name: m.name, type: m.type, category: m.category, power, hits, priority: m.priority || 0,
    pp: m.pp || 0, cooldown: baseCooldown(m), za: m.id in ZA_COOLDOWN, shape, reach: geom.reach, arc: geom.arc,
    speed: geom.speed, radius: geom.radius, windup: windupTicks(m, shape), contact: !!m.flags?.contact,
    flags: {punch: !!m.flags?.punch, bite: !!m.flags?.bite, sound: !!m.flags?.sound, pulse: !!m.flags?.pulse,
      slicing: !!m.flags?.slicing, bullet: !!m.flags?.bullet, charge: !!m.flags?.charge, wind: !!m.flags?.wind},
    crit: m.willCrit ? 3 : (m.critRatio || 1) - 1, drain: m.drain || null, recoil: m.recoil || null, heal: m.heal || null,
    status: m.status || '', volatile: m.volatileStatus || '', boosts: m.boosts || null, selfBoosts: m.self?.boosts || m.selfBoost?.boosts || null,
    secondaries: (m.secondaries || (m.secondary ? [m.secondary] : [])).map((s) => ({chance: s.chance || 100, status: s.status || '',
      volatile: s.volatileStatus || '', boosts: s.boosts || null, selfBoosts: s.self?.boosts || null})),
    sideCondition: m.sideCondition || '', weather: m.weather || '', terrain: m.terrain || '', target: m.target,
    selfdestruct: !!m.selfdestruct, forceSwitch: !!m.forceSwitch, selfSwitch: !!m.selfSwitch, ohko: !!m.ohko,
    recharge: !!(m.self?.volatileStatus === 'mustrecharge' || m.flags?.recharge), stalling: !!m.stallingMove,
    damage: m.damage ?? null, noEffect: NO_EFFECT.has(m.id),
    ignoreImmunity: !!m.ignoreImmunity, breaksProtect: !!m.breaksProtect, ignoreDefensive: !!m.ignoreDefensive,
    overrideOffensiveStat: m.overrideOffensiveStat || '', overrideDefensiveStat: m.overrideDefensiveStat || '',
    selfBoostAfter: m.self?.volatileStatus === 'lockedmove' ? 'confusion' : '', thaws: !!m.thawsTarget || m.flags?.defrost === 1,
  };
  if (profile.selfBoosts) for (const k of Object.keys(profile.selfBoosts)) if (!BOOST_KEYS.includes(k)) delete profile.selfBoosts[k];
  cache.set(key, profile);
  return profile;
}

/** How Legends: Z-A's rules read a team's moves: base cooldown, where it comes from, what each Pokémon really waits with
 * its Speed, wind-up and shape. For the trainer page, the assistant and the rules screen. */
export function cooldownTable(moves, {gen = 9, speed = 0} = {}) {
  return moves.map((name) => {
    const p = rtMove(name, gen);
    if (!p) return {move: name, exists: false};
    return {move: p.name, id: p.id, type: p.type, category: p.category, pp: p.pp, power: p.power, hits: p.hits,
      cooldown: p.cooldown, source: p.za ? 'za' : 'derived', final: speed ? Math.round(finalCooldown(p.cooldown, speed, {priority: p.priority}) * 10) / 10 : null,
      windup_s: Math.round((p.windup / TPS) * 100) / 100, shape: p.shape, reach: p.reach, no_effect: p.noEffect};
  });
}
