// What one side knows about the other, for an AI that does not see the opponent's team (a seat with `ai.hidden`). The battle log
// says which of the opponent's Pokémon have been seen (team preview or sent in) and which moves, items, abilities and Tera types
// they have shown; everything else is a guess: the format's usage statistics when the app sends them (`beliefs`, per species:
// moves, item, ability, Tera type and spread, most used first) or, without them, the species' first ability, no item, an even
// spread and the strongest moves of its own types it can learn. `believe` returns a copy of the battle where the opponent's
// Pokémon look like that, so the AI's measuring, play-outs and searches run on what it could know. Pure JavaScript (no Node).
import {Battle, toID} from '@pkmn/sim';

const POS = /^(p[1-4])[a-d]?: (.*)$/;
// moves that only work in some situations: never a guess
const CONDITIONAL = new Set(['steelroller', 'belch', 'lastresort', 'dreameater', 'synchronoise', 'focuspunch', 'futuresight', 'doomdesire',
  'fling', 'naturalgift', 'spitup', 'skydrop', 'shelltrap', 'beakblast', 'firstimpression', 'fakeout', 'poltergeist', 'burnup',
  'doubleshock', 'hyperspacefury', 'darkvoid', 'aurawheel', 'ivycudgel', 'ragingbull', 'teratype', 'terablast']);

/** {preview, seen: {name: {species, moves: Set, item, ability, tera}}} for the side `foeId` from the battle log's public lines. */
export function revealed(battle, foeId) {
  const out = {preview: false, seen: {}};
  const log = battle.log || [];
  const who = (ident) => {
    const m = POS.exec(String(ident || '').trim());
    if (!m || m[1] !== foeId) return null;
    return (out.seen[m[2]] ||= {species: '', moves: new Set(), item: undefined, ability: '', tera: ''});
  };
  for (let i = 0; i < log.length; i++) {
    let line = log[i];
    if (line.startsWith('|split|')) { i++; line = log[++i] || ''; }   // the public line of a split pair (secret first)
    const parts = line.split('|');
    const cmd = parts[1];
    if (cmd === 'poke' && parts[2] === foeId) { out.preview = true; continue; }
    const of = parts.find((p) => p.startsWith('[of] '));
    const from = parts.find((p) => p.startsWith('[from] '));
    if (['switch', 'drag', 'replace', 'detailschange'].includes(cmd)) {
      const w = who(parts[2]);
      if (w) w.species = String(parts[3] || '').split(',')[0].trim();
    } else if (cmd === 'move') {
      const w = who(parts[2]);
      if (w && !from) w.moves.add(toID(parts[3]));
    } else if (cmd === '-item' || cmd === '-enditem') {
      const w = who(parts[2]);
      if (w && !(from && /move: (Trick|Switcheroo|Thief|Covet|Bestow)/i.test(from))) w.item = toID(parts[3]);
    } else if (cmd === '-ability') {
      const w = who(parts[2]);
      if (w) w.ability = toID(parts[3]);
    } else if (cmd === '-terastallize') {
      const w = who(parts[2]);
      if (w) w.tera = String(parts[3] || '');
    } else if (cmd === '-mega' || cmd === '-primal') {
      const w = who(parts[2]);
      if (w && parts[4]) w.item = toID(parts[4]);
    }
    // "[from] item: Leftovers" / "[from] ability: Intimidate" belong to the [of] Pokémon when there is one, else to the first
    if (from) {
      const w = who(of ? of.slice(5) : parts[2]);
      const m = /^\[from\] (item|ability): (.+)$/.exec(from);
      if (w && m) {
        if (m[1] === 'item') w.item = toID(m[2]);
        else w.ability = toID(m[2]);
      }
    }
  }
  return out;
}

function copyOf(battle) {
  const c = Battle.fromJSON(JSON.parse(JSON.stringify(battle.toJSON())));
  c.send = () => {};
  return c;
}

/** The strongest moves of its own types (then any) that a species can learn: the guess when there are no usage statistics. */
function stabGuess(dex, species, have, n) {
  const out = [];
  // the forme's own learnset, its base species' and its pre-evolutions' (Rotom-Wash only lists Hydro Pump itself)
  const learn = {};
  const seenIds = new Set();
  let cur = species;
  for (let guard = 0; cur?.exists && guard < 6; guard++) {
    for (const id of [cur.id, toID(cur.changesFrom || ''), toID(cur.baseSpecies || '')]) {
      if (!id || seenIds.has(id)) continue;
      seenIds.add(id);
      Object.assign(learn, dex.data.Learnsets?.[id]?.learnset || {});
    }
    cur = cur.prevo ? dex.species.get(cur.prevo) : null;
  }
  if (!Object.keys(learn).length) return out;
  // plain attacks: no recharge, charging turn, self-KO, HP cost, Z or Max moves
  const moves = Object.keys(learn).map((id) => dex.moves.get(id)).filter((m) => m.exists && m.category !== 'Status' && m.basePower > 0
    && !m.isZ && !m.isMax && !have.has(m.id) && !m.flags?.charge && !m.flags?.recharge && !m.selfdestruct && !m.mindBlownRecoil
    && m.self?.volatileStatus !== 'mustrecharge' && !m.isNonstandard && m.basePower < 250);
  const bs = species.baseStats;
  const side = (m) => (m.category === 'Special' ? bs.spa : bs.atk) / Math.max(bs.atk, bs.spa);
  const score = (m) => (CONDITIONAL.has(m.id) ? 0 : m.basePower) * (species.types.includes(m.type) ? 1.5 : 1)
    * ((m.accuracy === true ? 100 : m.accuracy) / 100) * side(m) ** 2;
  moves.sort((a, b) => score(b) - score(a));
  const types = new Set();
  for (const m of moves) {
    if (out.length >= n) break;
    if (types.has(m.type) && out.length < n - 1) continue;   // one move per type first
    types.add(m.type);
    out.push(m.id);
  }
  return out;
}

function spreadOf(text) {
  // "Jolly:0/252/0/0/4/252"
  const m = /^([A-Za-z]+):(\d+)\/(\d+)\/(\d+)\/(\d+)\/(\d+)\/(\d+)$/.exec(String(text || ''));
  if (!m) return null;
  const [hp, atk, def, spa, spd, spe] = m.slice(2).map(Number);
  return {nature: m[1], evs: {hp, atk, def, spa, spd, spe}};
}

function slotFor(dex, id) {
  const mv = dex.moves.get(id);
  const pp = mv.noPPBoosts ? mv.pp : Math.floor(mv.pp * 8 / 5);
  return {move: mv.name, id: mv.id, pp, maxpp: pp, target: mv.target, disabled: false, disabledSource: '', used: false};
}

/**
 * A copy of the battle as side `sideId` could know it: each of the opponent's Pokémon keeps what the log showed and guesses the
 * rest (moves, item, ability, Tera type, spread). beliefs: {[species]: {moves: [ids], item, ability, tera, spread}}.
 * The opponent's pending request is rebuilt from the guessed moves. Returns {battle, unseen: Set of the opponent's team slots
 * (1-based) the side has never seen}.
 */
export function believe(battle, sideId, beliefs = {}) {
  const b = copyOf(battle);
  const me = b.sides.find((s) => s && s.id === sideId);
  const foe = me.foe;
  const info = revealed(battle, foe.id);
  const dex = b.dex;
  const unseen = new Set();
  foe.pokemon.forEach((p, i) => {
    const seen = info.seen[p.name] || null;
    if (!seen && !info.preview) unseen.add(i + 1);
    const guess = beliefs[p.species.name] || beliefs[p.baseSpecies?.name] || beliefs[toID(p.species.name)] || {};
    // moves: the ones shown, then the most used ones (or the strongest of its types), as many as it really has
    const shown = new Set(p.moveSlots.filter((m) => seen?.moves.has(m.id)).map((m) => m.id));
    const n = Math.max(p.moveSlots.length, Math.min(4, (guess.moves || []).length || 4));
    const picks = [...shown];
    for (const id of (guess.moves || []).map(toID)) {
      if (picks.length >= n) break;
      if (!picks.includes(id) && dex.moves.get(id).exists) picks.push(id);
    }
    if (picks.length < n) picks.push(...stabGuess(dex, p.species, new Set(picks), n - picks.length));
    if (picks.length) {
      const old = new Map(p.moveSlots.map((m) => [m.id, m]));
      p.moveSlots = picks.slice(0, Math.max(1, n)).map((id) => (old.has(id) ? old.get(id) : slotFor(dex, id)));
      p.baseMoveSlots = p.moveSlots.map((m) => ({...m}));
    }
    // item and ability: shown, else guessed (a guessed item it may have lost already stays lost)
    if (seen?.item === undefined && p.item) {
      const item = toID(guess.item || '');
      p.item = item && dex.items.get(item).exists ? item : '';
      p.itemState = {id: p.item, target: p};
    }
    if (!seen?.ability) {
      const ability = toID(guess.ability || p.species.abilities?.[0] || '');
      if (ability && dex.abilities.get(ability).exists) {
        p.baseAbility = ability;
        if (!p.isActive || !p.volatiles?.gastroacid) p.ability = ability;
        p.abilityState = {id: ability, target: p};
      }
    }
    if (!p.terastallized) {
      const tera = seen?.tera || guess.tera || p.species.types[0];
      p.teraType = tera;
      if (p.canTerastallize) p.canTerastallize = tera;
    }
    // stats from the guessed spread (an even one without statistics); HP keeps its share
    const spread = spreadOf(guess.spread) || {nature: 'Serious', evs: {hp: 84, atk: 84, def: 84, spa: 84, spd: 84, spe: 84}};
    if (!p.transformed) {
      const share = p.maxhp ? p.hp / p.maxhp : 1;
      p.set.evs = spread.evs;
      p.set.ivs = {hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31};
      p.set.nature = spread.nature;
      const stats = b.spreadModify(p.species.baseStats, p.set);
      p.baseStoredStats = {atk: stats.atk, def: stats.def, spa: stats.spa, spd: stats.spd, spe: stats.spe};
      p.storedStats = {...p.baseStoredStats};
      if (p.species.maxHP) p.maxhp = p.species.maxHP;
      else p.maxhp = stats.hp;
      p.baseMaxhp = p.maxhp;
      if (!p.fainted) p.hp = Math.max(1, Math.round(p.maxhp * share));
    }
  });
  // the opponent's pending request, with the guessed moves
  try {
    const reqs = b.getRequests(b.requestState);
    const i = b.sides.indexOf(foe);
    if (foe.activeRequest && reqs?.[i]) foe.activeRequest = reqs[i];
  } catch { /* keep the old one */ }
  return {battle: b, unseen};
}
