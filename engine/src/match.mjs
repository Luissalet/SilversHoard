// One battle: two trainers (people or AI), the simulator, and the log seen from each seat. Runs in the engine process and in the
// playable page; the AI sides choose by themselves, a person's side waits for `choose`.
import {Battle, PRNG} from '@pkmn/sim';
import {applyLevelRules, buildFormatId, completeSets, EngineError, formatInfo, packTeam, seedArray} from './core.mjs';
import {chooseFor, makeRng} from './ai.mjs';

const KEEP = ['choice', 'kind', 'name', 'target', 'species', 'gimmick', 'score', 'dmg', 'ko', 'acc', 'take', 'give', 'label'];
const round = (x) => (typeof x === 'number' ? Math.round(x * 1000) / 1000 : x);
const compactOption = (o) => o && Object.fromEntries(Object.entries(o).filter(([k]) => KEEP.includes(k)).map(([k, v]) => [k, round(v)]));

/** An AI decision's trace (ai.mjs chooseFor with `trace`) in the small shape kept with the battle. */
export function compactTrace(trace) {
  return {turn: trace.turn, side: trace.side, choice: trace.choice, kind: trace.kind, level: trace.level, style: trace.style,
    slots: (trace.slots || []).map((s) => ({slot: s.slot, mon: s.mon, hp: round(s.hp), faster: s.faster,
      threat: s.threat ? {...s.threat, frac: round(s.threat.frac)} : null, picked: compactOption(s.picked),
      options: (s.options || []).slice(0, 5).map(compactOption)})),
    playouts: (trace.playouts || []).slice(0, 4).map((p) => ({choice: p.choice, label: p.label, kind: p.kind, name: p.name, species: p.species, gimmick: p.gimmick,
      mean: round(p.mean), worst: round(p.worst)})),
    ...(trace.search ? {search: {iterations: trace.search.iterations, options: trace.search.options.slice(0, 4).map((p) => ({choice: p.choice,
      label: p.label, kind: p.kind, name: p.name, species: p.species, gimmick: p.gimmick, share: round(p.share), win: round(p.win)}))}} : {}),
    ...(trace.fallback ? {fallback: trace.fallback} : {}),
    ...(trace.hidden ? {hidden: true} : {}),
    ...(trace.error ? {error: trace.error} : {})};
}

export const MAX_TURNS_DEFAULT = 300;

function seatName(name, fallback) {
  const clean = String(name || '').replace(/[|\n\r]/g, ' ').trim().slice(0, 40);
  return clean || fallback;
}

export function prepareTeam(sets, formatId, levelRules) {
  return packTeam(applyLevelRules(completeSets(sets, formatId), levelRules || {}));
}

/** The lines of `log` from `from` on as one seat sees them: `|split|pN` blocks show the exact line to pN (and to "omniscient")
 * and the public one to everybody else. */
export function viewLines(log, from, view) {
  const out = [];
  for (let i = from; i < log.length; i++) {
    const line = log[i];
    if (line.startsWith('|split|')) {
      const who = line.slice(7);
      const secret = log[i + 1];
      const pub = log[i + 2];
      out.push(view === 'omniscient' || view === who ? secret : pub);
      i += 2;
      continue;
    }
    out.push(line);
  }
  return out;
}

/** The request plus what a screen needs to draw the choices: each move's type, power, category, accuracy and short
 * description, and each team member's sprite id, types and item/ability names. */
export function annotate(battle, side, req) {
  const dex = battle.dex;
  const out = JSON.parse(JSON.stringify(req));
  out.done = side.isChoiceDone();
  for (const active of out.active || []) {
    for (const m of active.moves || []) {
      const mv = dex.moves.get(m.id);
      if (!mv.exists) continue;
      Object.assign(m, {type: mv.type, power: mv.basePower || 0, category: mv.category, accuracy: mv.accuracy === true ? 0 : mv.accuracy,
        priority: mv.priority || 0, desc: mv.shortDesc || mv.desc || ''});
    }
    if (Array.isArray(active.canZMove)) {
      active.canZMove = active.canZMove.map((z) => (z ? {...z, type: dex.moves.get(z.move).type} : z));
    }
  }
  for (let i = 0; i < (out.side?.pokemon || []).length; i++) {
    const info = out.side.pokemon[i];
    const mon = side.pokemon[i];
    if (!mon) continue;
    info.spriteid = mon.species.spriteid;
    info.types = mon.getTypes ? mon.getTypes() : mon.species.types;
    info.species = mon.species.name;
    info.level = mon.level;
    info.item_name = mon.item ? dex.items.get(mon.item).name : '';
    info.ability_name = mon.ability ? dex.abilities.get(mon.ability).name : '';
    info.move_info = (info.moves || []).map((id) => { const mv = dex.moves.get(id); return {id, name: mv.name, type: mv.type, power: mv.basePower || 0, category: mv.category}; });
  }
  return out;
}

export class Match {
  /**
   * spec: {id, format, rules: [showdown custom rules], level_rules: {level, level_cap, level_min}, seed, max_turns,
   *        p1: {name, sets, ai: {level, style} | null}, p2: {...}}
   */
  constructor(spec, snapshot = null) {
    this.spec = {...spec};
    this.id = spec.id || `m${Date.now().toString(36)}`;
    this.formatId = buildFormatId(spec.format, spec.rules);
    this.format = formatInfo(this.formatId);
    this.maxTurns = Number(spec.max_turns) || MAX_TURNS_DEFAULT;
    this.seats = {p1: spec.p1 || {}, p2: spec.p2 || {}};
    this.rngs = {p1: makeRng(`${spec.seed || this.id}:p1`), p2: makeRng(`${spec.seed || this.id}:p2`)};
    this.errors = [];
    this.notes = [];       // with spec.trace: why each AI decision was taken (compactTrace), in order
    this.notesSent = 0;
    if (snapshot) {
      this.battle = Battle.fromJSON(snapshot);
    } else {
      const seed = spec.seed ? [seedArray(spec.seed)].flat().join(',') : PRNG.generateSeed();
      this.spec.seed = seed;
      const options = {formatid: this.formatId, seed};
      for (const id of ['p1', 'p2']) {
        const seat = this.seats[id];
        if (!seat.sets || !seat.sets.length) throw new EngineError('empty_team', `${id} has no team.`);
        options[id] = {name: seatName(seat.name, id === 'p1' ? 'Player 1' : 'Player 2'), team: prepareTeam(seat.sets, this.formatId, spec.level_rules)};
      }
      this.battle = new Battle(options);
    }
    this.battle.send = () => {};
  }

  isAi(side) {
    return !!this.seats[side]?.ai;
  }

  /** Let every AI seat choose until a person has to choose or the battle ends. */
  advance(maxSteps = 4000) {
    const b = this.battle;
    for (let step = 0; step < maxSteps && !b.ended; step++) {
      if (b.turn > this.maxTurns) {
        b.add('message', `Turn limit (${this.maxTurns}) reached.`);
        b.tie();
        break;
      }
      let progressed = false;
      for (const side of b.sides) {
        if (!side || b.ended) continue;
        const req = side.activeRequest;
        if (!req || req.wait || side.isChoiceDone() || !this.isAi(side.id)) continue;
        const ai = this.seats[side.id].ai;
        let choice = null;
        const trace = this.spec.trace ? {} : null;
        try {
          choice = chooseFor(b, side.id, {level: ai.level, style: ai.style, rng: this.rngs[side.id], trace, hidden: !!ai.hidden, beliefs: ai.beliefs});
        } catch (e) {
          this.errors.push(`${side.id} AI: ${e.message}`);
        }
        let ok = false;
        if (choice) {
          try { ok = b.choose(side.id, choice); } catch (e) { ok = false; this.errors.push(`${side.id} ${choice}: ${e.message}`); }
        }
        if (!ok) {
          if (choice) this.errors.push(`${side.id} rejected "${choice}": ${side.choice?.error || ''}`.trim());
          try { b.choose(side.id, 'default'); } catch { /* the battle will tell */ }
        } else if (trace && trace.choice) {
          this.notes.push(compactTrace(trace));
        }
        progressed = true;
      }
      if (!progressed) break;
    }
    return this;
  }

  choose(side, choice) {
    const b = this.battle;
    if (b.ended) throw new EngineError('ended', 'The battle is over.');
    const s = b.sides.find((x) => x && x.id === side);
    if (!s) throw new EngineError('invalid', `No side ${side}.`);
    if (this.isAi(side)) throw new EngineError('invalid', `${side} is played by the AI.`);
    const req = s.activeRequest;
    if (!req || req.wait) throw new EngineError('not_your_turn', 'Nothing to choose right now.');
    const ok = b.choose(side, String(choice || '').trim());
    if (!ok) throw new EngineError('invalid_choice', s.choice?.error || `Invalid choice: ${choice}`);
    this.advance();
    return this;
  }

  forfeit(side) {
    const b = this.battle;
    if (b.ended) return this;
    const s = b.sides.find((x) => x && x.id === side);
    if (!s) throw new EngineError('invalid', `No side ${side}.`);
    b.add('message', `${s.name} forfeited.`);
    b.lose(s);
    return this;
  }

  /** What a seat needs: its new log lines, its pending request, and the result once it is over. */
  state(view = 'omniscient', since = 0) {
    const b = this.battle;
    const requests = {};
    for (const side of b.sides) {
      if (!side) continue;
      const req = side.activeRequest;
      if (!this.isAi(side.id) && req && !req.wait && !b.ended && (view === 'omniscient' || view === side.id || view === 'host')) {
        requests[side.id] = annotate(b, side, req);
      }
    }
    return {
      id: this.id, format: this.format, turn: b.turn, ended: !!b.ended, winner: b.ended ? (b.winner || '') : null,
      winner_side: b.ended ? (b.sides.find((s) => s && s.name === b.winner)?.id || '') : null,
      log_length: b.log.length, lines: viewLines(b.log, Math.max(0, since), view === 'host' ? 'omniscient' : view), requests,
      errors: this.errors.slice(-5),
    };
  }

  snapshot() {
    return this.battle.toJSON();
  }

  inputLog() {
    return this.battle.inputLog.slice();
  }

  /** The notes not handed out yet (the app stores them as they come, so an engine restart loses none). */
  takeNotes() {
    const out = this.notes.slice(this.notesSent);
    this.notesSent = this.notes.length;
    return out;
  }
}
