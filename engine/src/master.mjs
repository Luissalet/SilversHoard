// The "master" AI: a Monte Carlo tree search over thousands of possible futures of the turn, run by poke-engine (a Rust battle
// engine, MIT) through a small Python helper (silvers_hoard/master_ai.py). This module only runs in Node: it turns the live
// battle into poke-engine's state (both teams with their real stats, HP, status, boosts, volatiles, hazards, screens, weather,
// terrain and Trick Room), asks the helper with a time budget and maps the answer back to a Showdown choice. The app sets
// SILVER_MASTER_PY and SILVER_MASTER_SCRIPT when the helper can run; without them, or when anything goes wrong, ai.mjs plays
// the turn as the expert. Singles of the 9th generation only (the engine is built for its rules).
import {spawnSync} from 'node:child_process';
import {toID} from '@pkmn/sim';
import {setMasterSearch} from './ai.mjs';

export const MASTER_MS = 900;

const STATUS = {brn: 'burn', par: 'paralyze', slp: 'sleep', frz: 'freeze', psn: 'poison', tox: 'toxic'};
const WEATHER = {sunnyday: 'sun', raindance: 'rain', sandstorm: 'sand', hail: 'hail', snow: 'snow', snowscape: 'snow',
  desolateland: 'harshsun', primordialsea: 'heavyrain'};
const TERRAIN = new Set(['electricterrain', 'grassyterrain', 'mistyterrain', 'psychicterrain']);
const NATURES = new Set(['hardy', 'lonely', 'adamant', 'naughty', 'brave', 'bold', 'docile', 'impish', 'lax', 'relaxed', 'modest', 'mild',
  'bashful', 'rash', 'quiet', 'calm', 'gentle', 'careful', 'quirky', 'sassy', 'timid', 'hasty', 'jolly', 'naive', 'serious']);
// the simulator's volatile ids poke-engine also knows (the rest it would ignore)
const VOLATILES = new Set(['aquaring', 'attract', 'autotomize', 'banefulbunker', 'bounce', 'burningbulwark', 'charge', 'confusion', 'curse',
  'defensecurl', 'destinybond', 'dig', 'disable', 'dive', 'electrify', 'electroshot', 'embargo', 'encore', 'endure', 'flashfire', 'flinch',
  'fly', 'focusenergy', 'followme', 'foresight', 'freezeshock', 'gastroacid', 'geomancy', 'glaiverush', 'grudge', 'healblock', 'helpinghand',
  'iceburn', 'imprison', 'ingrain', 'kingsshield', 'laserfocus', 'leechseed', 'lockedmove', 'magiccoat', 'magnetrise', 'meteorbeam',
  'minimize', 'miracleeye', 'mustrecharge', 'nightmare', 'noretreat', 'octolock', 'partiallytrapped', 'phantomforce', 'powder',
  'powershift', 'powertrick', 'protect', 'rage', 'ragepowder', 'razorwind', 'roost', 'saltcure', 'shadowforce', 'skullbash', 'skyattack',
  'skydrop', 'silktrap', 'slowstart', 'smackdown', 'snatch', 'solarbeam', 'solarblade', 'spikyshield', 'spotlight', 'stockpile',
  'substitute', 'syrupbomb', 'tarshot', 'taunt', 'telekinesis', 'throatchop', 'truant', 'torment', 'typechange', 'unburden', 'uproar', 'yawn']);
const SIDE = {stealthrock: 'stealth_rock', spikes: 'spikes', toxicspikes: 'toxic_spikes', stickyweb: 'sticky_web', tailwind: 'tailwind',
  reflect: 'reflect', lightscreen: 'light_screen', auroraveil: 'aurora_veil', safeguard: 'safeguard', mist: 'mist', luckychant: 'lucky_chant'};
const LAYERED = new Set(['spikes', 'toxicspikes']);
const ONCE = new Set(['stealthrock', 'stickyweb']);

const low = (t) => String(t || '').toLowerCase();

function types(list) {
  const t = (list || []).map(low).filter(Boolean);
  return [t[0] || 'typeless', t[1] || 'typeless'];
}

function pokemon(p) {
  const st = p.storedStats || {};
  const evs = p.set?.evs || {};
  const nature = toID(p.set?.nature || '');
  const status = STATUS[p.status] || 'none';
  const state = p.statusState || {};
  let restTurns = 0;
  let sleepTurns = 0;
  if (status === 'sleep') {
    const total = Number(state.startTime) || 0;
    const left = Number(state.time) || 0;
    if (p.moveSlots.some((m) => m.id === 'rest') && total === 3) restTurns = Math.max(0, left - 1);
    else sleepTurns = Math.max(0, total - left);
  }
  const tera = p.terastallized || p.teraType || '';
  return {
    id: toID(p.species?.name || p.name), level: p.level || 100,
    types: types(p.getTypes ? p.getTypes(false, true) : p.species?.types), base_types: types(p.baseSpecies?.types || p.species?.types),
    hp: Math.max(0, p.fainted ? 0 : p.hp || 0), maxhp: Math.max(1, p.maxhp || 1),
    ability: toID(p.ability) || 'none', base_ability: toID(p.baseAbility) || toID(p.ability) || 'none', item: toID(p.item) || 'none',
    nature: NATURES.has(nature) ? nature : 'serious',
    evs: ['hp', 'atk', 'def', 'spa', 'spd', 'spe'].map((k) => Number(evs[k] ?? 85) || 0),
    attack: st.atk || 1, defense: st.def || 1, special_attack: st.spa || 1, special_defense: st.spd || 1, speed: st.spe || 1,
    status, rest_turns: restTurns, sleep_turns: sleepTurns, weight_kg: Number(p.species?.weightkg) || 0,
    terastallized: !!p.terastallized, tera_type: low(tera) || 'typeless',
    mega_evolved: !!p.species?.isMega,
    moves: p.moveSlots.slice(0, 4).map((m) => ({id: m.id, pp: Math.max(0, m.pp ?? 16), disabled: !!m.disabled})),
  };
}

function side(battle, s, req, {forceSwitch = false} = {}) {
  const active = s.active[0];
  const idx = Math.max(0, s.pokemon.indexOf(active));
  const out = {pokemon: s.pokemon.slice(0, 6).map(pokemon), active_index: String(idx), force_switch: forceSwitch,
    force_trapped: !!(req?.active?.[0]?.trapped), side_conditions: {}, volatile_statuses: [], volatile_status_durations: {},
    boosts: {}, substitute_health: 0, last_used_move: 'move:none', wish: [0, 0], can_tera: !!req?.active?.[0]?.canTerastallize};
  // the request knows best which moves the active Pokémon can pick now (Choice lock, Encore, Taunt, Disable, no PP)
  const reqMoves = req?.active?.[0]?.moves;
  if (reqMoves && out.pokemon[idx]) {
    for (const m of out.pokemon[idx].moves) {
      const r = reqMoves.find((x) => x.id === m.id);
      if (r) m.disabled = !!r.disabled;
    }
  }
  for (const [id, cond] of Object.entries(s.sideConditions || {})) {
    const key = SIDE[id];
    if (!key) continue;
    out.side_conditions[key] = LAYERED.has(id) ? (cond.layers || 1) : ONCE.has(id) ? 1 : (cond.duration || 1);
  }
  if (active && !active.fainted) {
    const b = active.boosts || {};
    out.boosts = {attack: b.atk || 0, defense: b.def || 0, special_attack: b.spa || 0, special_defense: b.spd || 0, speed: b.spe || 0,
      accuracy: b.accuracy || 0, evasion: b.evasion || 0};
    const vols = new Set();
    const durations = {};
    for (const [id, v] of Object.entries(active.volatiles || {})) {
      if (VOLATILES.has(id)) vols.add(id);
      if (id === 'perishsong' && v.duration) vols.add(`perish${Math.min(4, Math.max(1, v.duration))}`);
      if ((id === 'protosynthesis' || id === 'quarkdrive') && v.bestStat) vols.add(`${id}${v.bestStat}`);
      if (id === 'substitute') out.substitute_health = v.hp || 0;
      if (['confusion', 'encore', 'lockedmove', 'slowstart', 'taunt', 'yawn'].includes(id)) durations[id] = v.time ?? v.duration ?? 0;
    }
    if (active.status === 'tox') out.side_conditions.toxic_count = active.statusState?.stage || 0;
    out.volatile_statuses = [...vols];
    out.volatile_status_durations = durations;
    if (!active.activeTurns) out.last_used_move = `switch:${idx}`;
    else if (active.lastMove) {
      const i = active.moveSlots.findIndex((m) => m.id === active.lastMove.id);
      if (i >= 0 && i < 4) out.last_used_move = `move:${i}`;
    }
    const wish = battle.sides.find((x) => x === s)?.slotConditions?.[0]?.wish;
    if (wish) out.wish = [wish.duration || 0, wish.hp || 0];
  }
  return out;
}

/** The battle as poke-engine's state, from `sideId`'s point of view (side_one is the side choosing). */
export function masterState(battle, sideId, {forceSwitch = false} = {}) {
  const me = battle.sides.find((s) => s && s.id === sideId);
  const foe = me.foe;
  const f = battle.field || {};
  const weather = WEATHER[toID(f.weather)] || 'none';
  const terrain = TERRAIN.has(toID(f.terrain)) ? toID(f.terrain) : 'none';
  const tr = f.pseudoWeather?.trickroom;
  const lasting = (state) => (state?.duration > 0 ? state.duration : -1);
  return {
    side_one: side(battle, me, me.activeRequest, {forceSwitch}), side_two: side(battle, foe, foe.activeRequest),
    weather, weather_turns_remaining: weather === 'none' ? 0 : lasting(f.weatherState),
    terrain, terrain_turns_remaining: terrain === 'none' ? 0 : lasting(f.terrainState),
    trick_room: !!tr, trick_room_turns_remaining: tr ? tr.duration || 0 : 0,
  };
}

/** Run the helper: {options: [{kind: move|switch, index, tera, mega, visits, win}], iterations} or throws. */
export function runMaster(state, {ms = MASTER_MS, py = process.env.SILVER_MASTER_PY, script = process.env.SILVER_MASTER_SCRIPT} = {}) {
  if (!py || !script) throw new Error('master AI not available');
  const r = spawnSync(py, [script], {input: JSON.stringify({state, ms}), encoding: 'utf8', timeout: ms + 15000, windowsHide: true,
    maxBuffer: 4 << 20});
  if (r.error) throw r.error;
  const text = String(r.stdout || '').trim().split('\n').pop() || '';
  const out = JSON.parse(text);
  if (!out.ok) throw new Error(out.error || 'master AI failed');
  return out;
}

/** The master's choice for one side right now, or null (ai.mjs then plays as the expert). Fills `trace.search` when tracing. */
export function masterChoice(battle, sideId, req, opts = {}) {
  if (battle.gameType !== 'singles' || battle.gen !== 9 || !req || req.teamPreview || (req.active && req.active.length !== 1)) return null;
  const me = battle.sides.find((s) => s && s.id === sideId);
  const forced = !!req.forceSwitch?.[0];
  if (forced && me.slotConditions?.[0]?.revivalblessing) return null;
  const started = Date.now();
  const out = runMaster(masterState(battle, sideId, {forceSwitch: forced && !me.active[0]?.fainted}), {ms: opts.masterMs || MASTER_MS});
  const active = req.active?.[0];
  const bench = new Set();
  (req.side?.pokemon || []).forEach((p, i) => {
    if (!p.active && !String(p.condition || '').endsWith(' fnt') && !me.pokemon[i]?.fainted) bench.add(i + 1);
  });
  const total = (out.options || []).reduce((a, o) => a + (o.visits || 0), 0) || 1;
  const merged = new Map();
  for (const o of out.options || []) {
    let choice = null;
    if (o.kind === 'switch') {
      const n = o.index + 1;
      if (bench.has(n) && (forced || (active && !active.trapped && !active.maybeTrapped))) choice = `switch ${n}`;
    } else if (!forced && active) {
      const slot = me.active[0]?.moveSlots?.[o.index];
      const m = slot && (active.moves || []).find((x) => x.id === slot.id);
      const i = m ? active.moves.indexOf(m) : -1;
      if (i >= 0 && !m.disabled) {
        choice = `move ${i + 1}`;
        if (o.tera && active.canTerastallize) choice += ' terastallize';
        else if (o.mega && active.canMegaEvo) choice += ' mega';
      }
    }
    if (!choice) continue;
    const prev = merged.get(choice) || {choice, visits: 0, score: 0};
    prev.visits += o.visits || 0;
    prev.score += (o.win || 0) * (o.visits || 0);
    merged.set(choice, prev);
  }
  const ranked = [...merged.values()].map((x) => ({choice: x.choice, share: x.visits / total, win: x.visits ? x.score / x.visits : 0}))
    .sort((a, b) => b.share - a.share);
  if (!ranked.length) return null;
  if (opts.trace) opts.trace.search = {iterations: out.iterations || 0, ms: Date.now() - started, options: ranked.slice(0, 6)};
  return ranked[0].choice;
}

/** Whether the helper can run here (the app sets the variables only when poke-engine is installed). */
export function masterAvailable() {
  return !!(process.env.SILVER_MASTER_PY && process.env.SILVER_MASTER_SCRIPT);
}

if (masterAvailable()) setMasterSearch(masterChoice);
