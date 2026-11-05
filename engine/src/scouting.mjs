// A deterministic draft from public species observations and popular sets. Type coverage is not a battle prediction.
import {Dex} from '@pkmn/sim';
import {buildFormatId, effectiveness} from './core.mjs';

/** Lines already folded to the spectator view, never the flattened omniscient view. */
export function publicSpecies(lines) {
  const out = {version: 1, source: 'public_log', p1: [], p2: []};
  for (const line of lines) {
    const fields = line.split('|');
    if (!['poke', 'switch', 'drag', 'replace', 'detailschange', '-formechange'].includes(fields[1])) continue;
    const side = (fields[2] || '').slice(0, 2), species = (fields[3] || '').split(',')[0].trim();
    if (out[side] && species && !out[side].includes(species)) out[side].push(species);
  }
  return out;
}

export function scoutTeam(candidates, observations, {format = 'gen9customgame', rules = [], size = 6} = {}) {
  const dex = Dex.forFormat(buildFormatId(format, rules));
  const seen = [...new Set(observations)].map(name => dex.species.get(name)).filter(sp => sp.exists && sp.gen <= dex.gen);
  if (!seen.length) return {choices: [], team: [], observed: []};
  const prepared = candidates.map(row => {
    const sp = dex.species.get(row.set.species);
    const attacks = [...new Set((row.set.moves || []).map(name => dex.moves.get(name))
      .filter(m => m.exists && m.gen <= dex.gen && m.category !== 'Status' && m.basePower > 0).map(m => m.type))].sort();
    const effects = seen.map(target => {
      const ranked = attacks.map(type => ({type, value: effectiveness(type, target.types, dex.gen)}))
        .sort((a, b) => b.value - a.value || a.type.localeCompare(b.type));
      return ranked[0] || {type: '', value: 0};
    });
    const resists = seen.filter(target => Math.max(...target.types.map(type => effectiveness(type, sp.types, dex.gen))) < 1).map(sp => sp.name);
    return {row, sp, effects, resists};
  }).filter(x => x.sp.exists && x.sp.gen <= dex.gen);
  const best = seen.map(() => 1), used = new Set(), choices = [], team = [];
  while (choices.length < Math.min(6, size)) {
    const rank = prepared.filter(x => !used.has(x.sp.baseSpecies)).map(x => ({...x, score: [
      x.effects.filter((e, i) => e.value > 1 && best[i] <= 1).length,
      x.effects.reduce((sum, e, i) => sum + Math.max(0, e.value - best[i]), 0),
      x.resists.length, Number(x.row.usage) || 0,
    ]})).sort((a, b) => {
      for (let i = 0; i < a.score.length; i++) if (a.score[i] !== b.score[i]) return b.score[i] - a.score[i];
      return a.sp.name.localeCompare(b.sp.name);
    });
    if (!rank.length) break;
    const pick = rank[0];
    used.add(pick.sp.baseSpecies);
    choices.push({species: pick.sp.name, source: pick.row.source, coverage: pick.effects.flatMap((e, i) => e.value > 1
      ? [{species: seen[i].name, move_type: e.type, multiplier: e.value}] : []), resists: pick.resists});
    team.push(pick.row.set);
    pick.effects.forEach((e, i) => { best[i] = Math.max(best[i], e.value); });
  }
  return {choices, team, observed: seen.map(sp => sp.name)};
}
