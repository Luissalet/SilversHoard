// The trainers' brains. Every function reads a live @pkmn/sim Battle (the AI sees both teams, like an in-game trainer that knows
// the game) and returns a Showdown choice string for one side. Damage is measured with the simulator's own formula on a throwaway
// copy of the battle, so every generation's rules, abilities and items count. "expert" also plays each candidate turn out on copies
// of the battle against the opponent's likely answers and keeps the move with the best worst case.
import {Battle, PRNG, toID} from '@pkmn/sim';

export const LEVELS = ['random', 'easy', 'normal', 'hard', 'expert'];
export const STYLES = ['balanced', 'aggressive', 'defensive', 'setup', 'stall'];

const STYLE_WEIGHTS = {
  balanced: {attack: 1, status: 1, setup: 1, hazard: 1, recover: 1, protect: 1, switchCost: 0.18},
  aggressive: {attack: 1.15, status: 0.5, setup: 0.8, hazard: 0.6, recover: 0.6, protect: 0.4, switchCost: 0.35},
  defensive: {attack: 0.9, status: 1.4, setup: 0.7, hazard: 1.3, recover: 1.5, protect: 1.3, switchCost: 0.08},
  setup: {attack: 1, status: 0.8, setup: 1.9, hazard: 0.8, recover: 1, protect: 0.9, switchCost: 0.22},
  stall: {attack: 0.8, status: 1.6, setup: 0.6, hazard: 1.5, recover: 1.8, protect: 1.7, switchCost: 0.1},
};

const ABSORB = {
  waterabsorb: 'Water', stormdrain: 'Water', dryskin: 'Water', voltabsorb: 'Electric', lightningrod: 'Electric', motordrive: 'Electric',
  flashfire: 'Fire', wellbakedbody: 'Fire', sapsipper: 'Grass', eartheater: 'Ground', levitate: 'Ground',
};
const HAZARDS = {stealthrock: 1, spikes: 3, toxicspikes: 2, stickyweb: 1};

export function makeRng(seed) {
  let a = 0;
  for (const ch of String(seed ?? Math.random())) a = (Math.imul(a ^ ch.charCodeAt(0), 2654435761) + 0x9e3779b9) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = (list, rng) => list[Math.floor(rng() * list.length)];

export function sideOf(battle, sideId) {
  return battle.sides.find((s) => s && s.id === sideId);
}

function seedString(rng) {
  return [0, 1, 2, 3].map(() => Math.floor(rng() * 65536)).join(',');
}

// A deep, independent copy: Battle.fromJSON keeps references into the object it reads, so it always reads a fresh parse.
export function freeze(battle) {
  return JSON.stringify(battle.toJSON());
}

function clone(battle, snapshot) {
  const c = Battle.fromJSON(JSON.parse(snapshot || freeze(battle)));
  c.send = () => {};
  return c;
}

// ---------------------------------------------------------------- measuring
function canHit(attacker, defender, move) {
  if (move.category === 'Status') return true;
  const absorbed = ABSORB[toID(defender.ability)];
  if (absorbed && absorbed === move.type && !move.ignoreAbility && !['moldbreaker', 'teravolt', 'turboblaze'].includes(toID(attacker.ability))) {
    if (absorbed === 'Ground' && (defender.battle.field.pseudoWeather?.gravity || toID(defender.item) === 'ironball')) return true;
    return false;
  }
  return true;
}

/** Expected damage of `moveId` from attacker to defender (objects of the same throwaway battle): {dmg, frac, ko, acc}. */
export function estimate(scratch, attacker, defender, moveId) {
  let move;
  try {
    move = scratch.dex.getActiveMove(moveId);
  } catch {
    return {dmg: 0, frac: 0, ko: false, acc: 1};
  }
  const acc = move.accuracy === true ? 1 : Math.max(0.3, Number(move.accuracy || 100) / 100);
  if (move.category === 'Status' || !defender || defender.fainted || !canHit(attacker, defender, move)) return {dmg: 0, frac: 0, ko: false, acc};
  let total = 0;
  let n = 0;
  for (let i = 0; i < 2; i++) {
    try {
      const d = scratch.actions.getDamage(attacker, defender, scratch.dex.getActiveMove(moveId), true);
      total += typeof d === 'number' ? d : 0;
    } catch {
      total += roughDamage(scratch, attacker, defender, move);
    }
    n++;
  }
  let dmg = total / n;
  if (Array.isArray(move.multihit)) dmg *= toID(attacker.ability) === 'skilllink' ? move.multihit[1] : 3.1;
  else if (typeof move.multihit === 'number') dmg *= move.multihit;
  const hp = Math.max(1, defender.hp);
  return {dmg, frac: Math.min(1, dmg / hp), ko: dmg >= hp, acc};
}

function roughDamage(scratch, attacker, defender, move) {
  const power = move.basePower || 0;
  if (!power) return 0;
  const phys = move.category === 'Physical';
  const atk = attacker.getStat(phys ? 'atk' : 'spa');
  const def = defender.getStat(phys ? 'def' : 'spd');
  const stab = attacker.hasType?.(move.type) ? 1.5 : 1;
  let eff = 1;
  try { eff = scratch.dex.getImmunity(move.type, defender.getTypes()) ? 2 ** scratch.dex.getEffectiveness(move.type, defender.getTypes()) : 0; } catch { /* keep 1 */ }
  return (((2 * attacker.level) / 5 + 2) * power * (atk / Math.max(1, def)) / 50 + 2) * stab * eff * 0.925;
}

function usableMoves(pokemon) {
  return (pokemon.moveSlots || []).filter((m) => !m.disabled && (m.pp > 0 || m.maxpp === 0)).map((m) => m.id);
}

/** The best expected fraction of `defender`'s HP that `attacker` takes in one hit (with all its known moves). */
function bestThreat(scratch, attacker, defender) {
  let best = {frac: 0, ko: false, move: ''};
  for (const id of usableMoves(attacker)) {
    const e = estimate(scratch, attacker, defender, id);
    const v = e.frac * e.acc;
    if (v > best.frac) best = {frac: v, ko: e.ko && e.acc >= 0.85, move: id};
  }
  return best;
}

function speedOf(p) {
  try { return p.getActionSpeed ? p.getActionSpeed() : p.getStat('spe'); } catch { return p.storedStats?.spe || 0; }
}

function hpFrac(p) {
  return p && !p.fainted && p.maxhp ? p.hp / p.maxhp : 0;
}

// ---------------------------------------------------------------- scoring one move for one slot
function scoreMove(scratch, me, foe, moveId, w, ctx) {
  const move = scratch.dex.moves.get(moveId);
  const prio = move.priority || 0;
  if (move.category !== 'Status') {
    if (!foe) return 0.01;
    const e = estimate(scratch, me, foe, moveId);
    let v = e.frac * e.acc * w.attack;
    if (e.ko) v = (1.15 + (prio > 0 ? 0.2 : 0)) * e.acc * w.attack;
    if (move.selfdestruct) v = hpFrac(me) < 0.3 ? v : v * 0.25;
    if (move.recoil) v *= 0.93;
    if (move.self?.boosts && Object.values(move.self.boosts).some((b) => b < 0) && !e.ko) v *= 0.9;
    if (move.flags?.charge && !me.volatiles?.twoturnmove && !(me.item === 'powerherb')) v *= 0.55;
    if (toID(moveId) === 'fakeout' && !me.activeTurns) v += 0.25;
    else if (toID(moveId) === 'fakeout') v = 0;
    if (ctx.threatened && prio > 0 && e.ko) v += 0.35;
    return v;
  }
  const id = toID(moveId);
  const myHp = hpFrac(me);
  const safe = ctx.foeThreat < 0.45;
  if (move.boosts && move.target === 'self' || (move.self && move.self.boosts && move.category === 'Status') || ['bellydrum', 'shellsmash', 'geomancy'].includes(id)) {
    const boosts = move.boosts || move.self?.boosts || {};
    const already = Math.max(0, ...Object.keys(boosts).map((k) => me.boosts?.[k] || 0));
    if (already >= 4) return 0.02;
    if (id === 'bellydrum' && myHp < 0.6) return 0.01;
    return (safe && myHp > 0.55 ? 0.55 - already * 0.12 : 0.08) * w.setup;
  }
  if (move.heal || move.flags?.heal || ['rest', 'roost', 'recover', 'softboiled', 'slackoff', 'moonlight', 'morningsun', 'synthesis', 'shoreup', 'milkdrink', 'wish'].includes(id)) {
    const missing = 1 - myHp;
    if (missing < 0.25) return 0.01;
    return missing * 0.9 * w.recover;
  }
  if (HAZARDS[id]) {
    const cond = ctx.foeSide.sideConditions?.[id];
    const layers = cond ? (cond.layers || 1) : 0;
    if (layers >= HAZARDS[id]) return 0;
    const healthyFoes = ctx.foeSide.pokemon.filter((p) => !p.fainted && hpFrac(p) > 0.5).length;
    return (healthyFoes >= 3 ? 0.42 : 0.12) * w.hazard * (layers ? 0.6 : 1);
  }
  if (['defog', 'rapidspin', 'courtchange', 'tidyup', 'mortalspin'].includes(id)) {
    const mine = Object.keys(ctx.mySide.sideConditions || {}).filter((k) => HAZARDS[k]).length;
    return mine ? 0.35 * w.hazard : 0.02;
  }
  if (move.status || move.volatileStatus === 'confusion' || id === 'yawn') {
    if (!foe || foe.status || (move.status && !foe.runStatusImmunity?.(move.status))) return 0;
    if (move.status === 'par' && foe.hasType?.('Electric')) return 0;
    if (move.status === 'brn' && foe.hasType?.('Fire')) return 0;
    if ((move.status === 'psn' || move.status === 'tox') && (foe.hasType?.('Poison') || foe.hasType?.('Steel'))) return 0;
    if (move.type === 'Grass' && move.flags?.powder && foe.hasType?.('Grass')) return 0;
    if (move.ignoreImmunity !== true && move.category === 'Status' && move.type === 'Electric' && foe.hasType?.('Ground')) return 0;
    const base = {slp: 0.5, par: 0.42, brn: 0.4, tox: 0.42, psn: 0.25}[move.status] ?? 0.2;
    const acc = move.accuracy === true ? 1 : move.accuracy / 100;
    return base * acc * w.status * (hpFrac(foe) > 0.5 ? 1 : 0.6);
  }
  if (move.stallingMove || ['protect', 'detect', 'kingsshield', 'spikyshield', 'banefulbunker', 'silktrap', 'burningbulwark'].includes(id)) {
    if (me.volatiles?.stall) return 0.01;
    return 0.12 * w.protect + (ctx.foePoisoned ? 0.12 : 0);
  }
  if (['substitute'].includes(id)) return myHp > 0.5 && !me.volatiles?.substitute ? 0.2 * w.protect : 0;
  if (['leechseed'].includes(id)) return foe && !foe.hasType?.('Grass') && !foe.volatiles?.leechseed ? 0.3 * w.status : 0;
  if (['taunt', 'encore', 'disable'].includes(id)) return 0.12 * w.status;
  if (['uturn', 'voltswitch', 'flipturn', 'partingshot', 'teleport', 'batonpass', 'chillyreception', 'shedtail'].includes(id)) return 0.18;
  if (['trickroom', 'tailwind', 'reflect', 'lightscreen', 'auroraveil', 'raindance', 'sunnyday', 'sandstorm', 'hail', 'snowscape',
    'electricterrain', 'grassyterrain', 'psychicterrain', 'mistyterrain'].includes(id)) {
    if (ctx.mySide.sideConditions?.[id] || scratch.field.pseudoWeather?.[id] || toID(scratch.field.weather) === id || toID(scratch.field.terrain) === id) return 0;
    return 0.25 * w.setup;
  }
  if (move.target === 'normal' && move.boosts && foe) return 0.15 * w.status;
  return 0.05;
}

// ---------------------------------------------------------------- one side's options
function requestOf(side) {
  return side.activeRequest || null;
}

function benchFor(side, req) {
  const out = [];
  const pokemon = req?.side?.pokemon || [];
  for (let i = 0; i < pokemon.length; i++) {
    const p = side.pokemon[i];
    if (!pokemon[i].active && p && !p.fainted && !pokemon[i].condition?.endsWith(' fnt') && !pokemon[i].reviving) out.push(i + 1);
  }
  return out;
}

function targetsFor(scratch, side, slot, moveTarget, gameType) {
  if (gameType === 'singles' || !moveTarget) return [0];
  const foes = side.foe.active.map((p, i) => (p && !p.fainted ? i + 1 : 0)).filter(Boolean);
  if (['normal', 'any', 'adjacentFoe'].includes(moveTarget)) return foes.length ? foes : [1];
  if (moveTarget === 'adjacentAlly') return side.active.map((p, i) => (p && !p.fainted && i !== slot ? -(i + 1) : 0)).filter(Boolean);
  if (moveTarget === 'adjacentAllyOrSelf') return [-(slot + 1)];
  return [0];
}

function gimmickOf(active) {
  if (!active) return '';
  if (active.canTerastallize) return 'terastallize';
  if (active.canMegaEvo) return 'mega';
  if (active.canMegaEvoX) return 'megax';
  if (active.canMegaEvoY) return 'megay';
  if (active.canUltraBurst) return 'ultra';
  if (active.canDynamax) return 'dynamax';
  return '';
}

/** Ranked options of one active slot: [{choice, score, kind}] best first. */
function slotOptions(scratch, side, slot, req, opts, w, {allowSwitch = true} = {}) {
  const active = req.active?.[slot];
  const me = side.active[slot];
  if (!active || !me || me.fainted) return [{choice: 'pass', score: 0, kind: 'pass'}];
  const gameType = scratch.gameType;
  const foes = side.foe.active.filter((p) => p && !p.fainted);
  const mainFoe = foes.slice().sort((a, b) => hpFrac(a) - hpFrac(b))[0] || null;
  const foeThreat = Math.max(0, ...foes.map((f) => bestThreat(scratch, f, me).frac));
  const threatened = foes.some((f) => bestThreat(scratch, f, me).ko);
  const fasterFoe = foes.some((f) => speedOf(f) > speedOf(me));
  const ctx = {foeThreat, threatened, mySide: side, foeSide: side.foe, foePoisoned: foes.some((f) => ['psn', 'tox', 'brn'].includes(f.status))};
  const out = [];
  const gimmick = gimmickOf(active);
  for (let i = 0; i < (active.moves || []).length; i++) {
    const m = active.moves[i];
    if (m.disabled || (m.pp !== undefined && m.pp <= 0 && m.maxpp)) continue;
    // a move the Pokémon is locked into (second turn of Solar Beam, Outrage...) comes without a target and takes none
    const moveTarget = m.target || '';
    for (const t of targetsFor(scratch, side, slot, moveTarget, gameType)) {
      const targetMon = t > 0 ? side.foe.active[t - 1] : mainFoe;
      let score = scoreMove(scratch, me, targetMon, m.id, w, ctx);
      const mv = scratch.dex.moves.get(m.id);
      if (gameType !== 'singles' && ['allAdjacent', 'allAdjacentFoes'].includes(moveTarget) && mv.category !== 'Status') {
        score = foes.reduce((acc, f) => acc + scoreMove(scratch, me, f, m.id, w, ctx) * 0.75, 0);
        if (moveTarget === 'allAdjacent') {
          for (const ally of side.active) if (ally && ally !== me && !ally.fainted) score -= estimate(scratch, me, ally, m.id).frac * 0.9;
        }
      }
      if (threatened && fasterFoe && mv.priority <= 0) score *= 0.35;
      const choice = `move ${i + 1}${t ? ` ${t}` : ''}`;
      out.push({choice, score, kind: mv.category === 'Status' ? 'status' : 'attack', move: m.id});
      if (gimmick && opts.level !== 'easy') {
        let bonus = 0;
        if (gimmick === 'terastallize') {
          const tera = String(active.canTerastallize);
          if (mv.type === tera && mv.category !== 'Status') bonus = 0.12;
          else if (threatened) bonus = 0.05;
          const left = side.pokemon.filter((p) => !p.fainted).length;
          if (left <= 2) bonus += 0.08;
        } else {
          bonus = 0.25;   // mega evolution, ultra burst, dynamax: nearly always worth it
        }
        if (bonus > 0) out.push({choice: `${choice} ${gimmick}`, score: score + bonus, kind: 'gimmick', move: m.id});
      }
    }
  }
  if (!out.length) out.push({choice: 'move 1', score: 0.01, kind: 'struggle'});
  if (allowSwitch && !active.trapped && opts.level !== 'easy') {
    for (const n of benchFor(side, req)) {
      const mon = side.pokemon[n - 1];
      const take = Math.max(0, ...foes.map((f) => bestThreat(scratch, f, mon).frac));
      const give = Math.max(0, ...foes.map((f) => bestThreat(scratch, mon, f).frac));
      const hazard = side.sideConditions?.stealthrock ? 0.12 : 0;
      const score = give - take * 0.9 - w.switchCost - hazard + (threatened ? 0.25 : 0) + hpFrac(mon) * 0.1 - 0.15;
      out.push({choice: `switch ${n}`, score, kind: 'switch', slot: n});
    }
  }
  out.sort((a, b) => b.score - a.score);
  return out;
}

function forcedSwitches(scratch, side, req, opts, w, rng) {
  const used = new Set();
  const parts = [];
  for (let slot = 0; slot < req.forceSwitch.length; slot++) {
    if (!req.forceSwitch[slot]) { parts.push('pass'); continue; }
    const bench = benchFor(side, req).filter((n) => !used.has(n));
    if (!bench.length) { parts.push('pass'); continue; }
    let n;
    if (opts.level === 'random' || opts.level === 'easy') n = pick(bench, rng);
    else {
      const foes = side.foe.active.filter((p) => p && !p.fainted);
      const ranked = bench.map((i) => {
        const mon = side.pokemon[i - 1];
        const give = Math.max(0, ...foes.map((f) => bestThreat(scratch, mon, f).frac));
        const take = Math.max(0, ...foes.map((f) => bestThreat(scratch, f, mon).frac));
        const faster = foes.every((f) => speedOf(mon) >= speedOf(f));
        return [give * (faster ? 1.2 : 1) - take + hpFrac(mon) * 0.2, i];
      }).sort((a, b) => b[0] - a[0]);
      n = ranked[0][1];
    }
    used.add(n);
    parts.push(`switch ${n}`);
  }
  return parts.join(', ');
}

function typeMatchup(dex, mine, theirs) {
  let s = 0;
  for (const t of mine.types) {
    try { if (dex.getImmunity(t, theirs.types)) s += dex.getEffectiveness(t, theirs.types); else s -= 1; } catch { /* ignore */ }
  }
  for (const t of theirs.types) {
    try { if (dex.getImmunity(t, mine.types)) s -= dex.getEffectiveness(t, mine.types); else s += 1; } catch { /* ignore */ }
  }
  return s;
}

function teamPreview(battle, side, req, opts, rng) {
  const size = req.maxChosenTeamSize || side.pokemon.length;
  const idx = side.pokemon.map((_, i) => i + 1);
  if (opts.level === 'random' || opts.level === 'easy') {
    for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
    return `team ${idx.slice(0, size).join('')}`;
  }
  const dex = battle.dex;
  const theirs = side.foe.pokemon.map((p) => dex.species.get(p.species?.name || p.baseSpecies?.name || p.name));
  const scored = side.pokemon.map((p, i) => {
    const sp = dex.species.get(p.species?.name || p.name);
    const m = theirs.reduce((acc, t) => acc + typeMatchup(dex, sp, t), 0) / Math.max(1, theirs.length);
    return [m + (p.storedStats?.spe || 0) / 600 + rng() * 0.05, i + 1];
  }).sort((a, b) => b[0] - a[0]);
  if (opts.level === 'normal') {
    const lead = scored[0][1];
    return `team ${[lead, ...idx.filter((i) => i !== lead)].slice(0, size).join('')}`;
  }
  return `team ${scored.map((s) => s[1]).slice(0, size).join('')}`;
}

// ---------------------------------------------------------------- expert: play the turn out on copies of the battle
function evaluate(b, sideId) {
  let score = 0;
  for (const side of b.sides) {
    if (!side) continue;
    const sign = side.id === sideId ? 1 : -1;
    for (const p of side.pokemon) {
      if (p.fainted || !p.hp) continue;
      let v = 1 + 1.1 * (p.hp / p.maxhp);
      if (p.status) v -= p.status === 'slp' || p.status === 'frz' ? 0.35 : p.status === 'tox' ? 0.3 : 0.2;
      if (p.isActive) {
        const boosts = p.boosts || {};
        const off = Math.max(boosts.atk || 0, boosts.spa || 0);
        v += 0.12 * Math.max(-3, Math.min(4, off)) + 0.06 * Math.max(-3, Math.min(4, boosts.spe || 0)) + 0.04 * ((boosts.def || 0) + (boosts.spd || 0));
        if (p.volatiles?.substitute) v += 0.1;
      }
      score += sign * v;
    }
    for (const [id, cond] of Object.entries(side.sideConditions || {})) {
      if (HAZARDS[id]) score -= sign * 0.15 * (cond.layers || 1) * side.pokemon.filter((p) => !p.fainted && !p.isActive).length / 3;
      if (['reflect', 'lightscreen', 'auroraveil', 'tailwind'].includes(id)) score += sign * 0.15;
    }
  }
  if (b.ended) score += b.winner === sideOf(b, sideId)?.name ? 50 : -50;
  return score;
}

function playOut(snapshot, sideId, mine, foeId, theirs, seed) {
  const c = clone(null, snapshot);
  c.prng = new PRNG(seed);
  try {
    if (!c.choose(sideId, mine)) return null;
    if (theirs && !c.choose(foeId, theirs)) return null;
    if (c.allChoicesDone()) c.commitChoices();
  } catch {
    return null;
  }
  return evaluate(c, sideId);
}

function expertChoice(battle, side, req, opts, w, rng) {
  const scratch = clone(battle);
  const sSide = sideOf(scratch, side.id);
  const mine = slotOptions(scratch, sSide, 0, req, opts, w).slice(0, 9);
  const foeSide = side.foe;
  const foeReq = requestOf(foeSide);
  let theirs = [{choice: null, weight: 1}];
  if (foeReq && !foeReq.wait && foeReq.active) {
    const foeOpts = slotOptions(scratch, sideOf(scratch, foeSide.id), 0, foeReq, {level: 'hard'}, STYLE_WEIGHTS.balanced);
    const top = foeOpts.filter((o) => o.kind !== 'switch').slice(0, 3);
    const sw = foeOpts.filter((o) => o.kind === 'switch').slice(0, 2);
    theirs = [...top, ...sw].map((o, i) => ({choice: o.choice, weight: i === 0 ? 0.45 : 0.55 / Math.max(1, top.length + sw.length - 1)}));
  }
  const snapshot = freeze(battle);
  const seeds = [seedString(rng), seedString(rng)];
  let best = null;
  for (const o of mine) {
    let mean = 0;
    let worst = Infinity;
    let wsum = 0;
    for (const t of theirs) {
      let v = 0;
      let n = 0;
      for (const seed of seeds) {
        const r = playOut(snapshot, side.id, o.choice, foeSide.id, t.choice, seed);
        if (r === null) continue;
        v += r;
        n++;
      }
      if (!n) continue;
      v /= n;
      mean += v * t.weight;
      wsum += t.weight;
      worst = Math.min(worst, v);
    }
    if (!wsum) continue;
    const score = 0.65 * (mean / wsum) + 0.35 * worst + o.score * 0.05 + rng() * 1e-3;
    if (!best || score > best.score) best = {choice: o.choice, score};
  }
  return best ? best.choice : (mine[0]?.choice || 'default');
}

// ---------------------------------------------------------------- entry point
/**
 * The choice of side `sideId` right now, or null when it has nothing to choose.
 * opts: {level: random|easy|normal|hard|expert, style: balanced|aggressive|defensive|setup|stall, rng}
 */
export function chooseFor(battle, sideId, opts = {}) {
  const side = sideOf(battle, sideId);
  const req = side && requestOf(side);
  if (!req || req.wait) return null;
  const level = LEVELS.includes(opts.level) ? opts.level : 'normal';
  const w = STYLE_WEIGHTS[opts.style] || STYLE_WEIGHTS.balanced;
  const rng = opts.rng || makeRng(`${battle.turn}:${sideId}`);
  const o = {...opts, level};
  if (req.teamPreview) return teamPreview(battle, side, req, o, rng);
  const scratch = clone(battle);
  const sSide = sideOf(scratch, sideId);
  if (req.forceSwitch) return forcedSwitches(scratch, sSide, req, o, w, rng);
  if (!req.active) return 'default';
  if (level === 'random') return randomChoice(sSide, req, rng);
  if (level === 'expert' && scratch.gameType === 'singles' && req.active.length === 1) {
    try { return expertChoice(battle, side, req, o, w, rng); } catch { /* fall back to hard */ }
  }
  const parts = [];
  const usedSwitch = new Set();
  let usedGimmick = false;
  for (let slot = 0; slot < req.active.length; slot++) {
    const mon = sSide.active[slot];
    const reqMon = req.side?.pokemon?.[slot];
    if (!mon || mon.fainted || reqMon?.commanding || String(reqMon?.condition || '').endsWith(' fnt')) { parts.push('pass'); continue; }
    let options = slotOptions(scratch, sSide, slot, req, o, w).filter((x) => !(x.kind === 'switch' && usedSwitch.has(x.slot)));
    if (usedGimmick) options = options.filter((x) => x.kind !== 'gimmick');
    let chosen;
    if (level === 'easy') {
      const moves = options.filter((x) => x.kind !== 'switch');
      chosen = rng() < 0.5 ? pick(moves, rng) : moves[0];
    } else if (level === 'normal') {
      const top = options.filter((x) => x.kind !== 'switch' || x.score > (options[0]?.score ?? 0) + 0.25);
      chosen = top.length > 1 && rng() < 0.2 ? top[1] : top[0] || options[0];
    } else {
      chosen = options[0];
    }
    if (!chosen) { parts.push('default'); continue; }
    if (chosen.kind === 'switch') usedSwitch.add(chosen.slot);
    if (chosen.kind === 'gimmick') usedGimmick = true;
    parts.push(chosen.choice);
  }
  return parts.join(', ');
}

function randomChoice(side, req, rng) {
  const parts = [];
  const used = new Set();
  for (let slot = 0; slot < req.active.length; slot++) {
    const active = req.active[slot];
    const reqMon = req.side?.pokemon?.[slot];
    if (String(reqMon?.condition || '').endsWith(' fnt') || reqMon?.commanding) { parts.push('pass'); continue; }
    const moves = (active.moves || []).map((m, i) => ({m, i})).filter(({m}) => !m.disabled);
    const bench = active.trapped ? [] : benchFor(side, req).filter((n) => !used.has(n));
    if (bench.length && rng() < 0.12) {
      const n = pick(bench, rng);
      used.add(n);
      parts.push(`switch ${n}`);
      continue;
    }
    if (!moves.length) { parts.push('move 1'); continue; }
    const {m, i} = pick(moves, rng);
    const tgts = targetsFor(null, side, slot, m.target, side.battle.gameType);
    const t = pick(tgts, rng);
    parts.push(`move ${i + 1}${t ? ` ${t}` : ''}`);
  }
  return parts.join(', ');
}
