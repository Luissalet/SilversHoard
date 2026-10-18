// Static team planning over the installed format's Dex. No battles, providers or saved records are changed.
import {Battle, Dex} from '@pkmn/sim';
import {applyLevelRules, buildFormatId, EngineError, importTeam, TYPES} from './core.mjs';
import {prepareTeam} from './match.mjs';

function multiplier(dex, attack, target) {
  return dex.getImmunity(attack, target) ? 2 ** dex.getEffectiveness(attack, target) : 0;
}

/** Type-only defences, ordinary attacking coverage against single types, and unmodified Speed. */
export function teamAnalysis(a = {}) {
  const format = buildFormatId(a.format || 'gen9nationaldexag');
  const dex = Dex.forFormat(Dex.formats.get(format, true));
  const sets = applyLevelRules(importTeam(a.team ?? a.paste), a.level_rules || {});
  if (!sets.length || sets.length > 6) throw new EngineError('invalid_team', 'Analyse between one and six Pokémon.');
  const types = TYPES.filter((name) => !dex.types.get(name).isNonstandard);
  for (const set of sets) {
    const sp = dex.species.get(set.species);
    if (!sp.exists || sp.gen > dex.gen) throw new EngineError('unknown_species', `No ${set.species} in generation ${dex.gen}.`);
    for (const name of set.moves) {
      const move = dex.moves.get(name);
      if (!move.exists || move.gen > dex.gen) throw new EngineError('invalid_team', `No move ${name} in generation ${dex.gen}.`);
    }
  }
  // Only p1 is constructed: no battle start, switch-in effects or opposing team.
  // Pokemon construction applies generation-specific DVs, stats and Champions' stat points.
  const battle = new Battle({formatid: format, seed: [1, 2, 3, 4]});
  battle.send = () => {};
  battle.setPlayer('p1', {team: prepareTeam(sets.map((s) => ({...s, moves: s.moves.length ? s.moves : ['Splash']})), format, {})});
  const members = sets.map((set, index) => {
    const mon = battle.p1.pokemon[index];
    const species = dex.species.get(set.species);
    const attacks = [], excluded_moves = [];
    for (const name of set.moves) {
      const move = dex.moves.get(name);
      if (move.category === 'Status') continue;
      // Fixed damage, type-changing and special-effectiveness attacks do not obey the ordinary type chart.
      const reason = move.damage || move.damageCallback || move.ohko ? 'fixed_damage'
        : move.onEffectiveness || move.ignoreImmunity || move.id === 'struggle' ? 'special_effectiveness'
          : move.onModifyType || move.id === 'hiddenpower' ? 'variable_type' : '';
      if (reason) { excluded_moves.push({id: move.id, name: move.name, reason}); continue; }
      if (!types.includes(move.type)) continue;
      attacks.push({id: move.id, name: move.name, type: move.type, category: move.category,
        stab: species.types.includes(move.type)});
    }
    return {index, species: species.name, name: set.name || species.name, types: species.types,
      level: mon.level, speed: mon.storedStats.spe, attacks, excluded_moves,
      defence: Object.fromEntries(types.map((type) => [type, multiplier(dex, type, species.types)])),
      coverage: Object.fromEntries(types.map((type) => [type, attacks.length
        ? Math.max(...attacks.map((move) => multiplier(dex, move.type, [type]))) : null]))};
  });
  const defence = types.map((type) => ({type,
    weak: members.filter((m) => m.defence[type] > 1).map((m) => m.index),
    resist: members.filter((m) => m.defence[type] > 0 && m.defence[type] < 1).map((m) => m.index),
    immune: members.filter((m) => m.defence[type] === 0).map((m) => m.index)}));
  const coverage = types.map((type) => ({type,
    super_effective: members.filter((m) => m.coverage[type] > 1).map((m) => m.index),
    moves: members.flatMap((m) => m.attacks.filter((move) => multiplier(dex, move.type, [type]) > 1)
      .map((move) => ({member: m.index, ...move})))}));
  return {format, gen: dex.gen, types, members, defence, coverage,
    shared_weaknesses: defence.filter((row) => row.weak.length >= 2),
    uncovered_types: coverage.filter((row) => !row.super_effective.length).map((row) => row.type),
    speed_order: [...members].sort((a, b) => b.speed - a.speed || a.index - b.index).map((m) => m.index),
    basis: {defence: 'species_types_only', coverage: 'ordinary_moves_against_single_types',
      speed: 'unmodified_stat', abilities: false, items: false, tera: false, battle_state: false}};
}
