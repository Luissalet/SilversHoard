// Usage-weighted generated rosters, not teams observed together on the ladder.
import {Dex} from '@pkmn/sim';
import {applyLevelRules, buildFormatId, completeSets, formatInfo, toID, validateTeam} from './core.mjs';
import {makeRng} from './ai.mjs';

const lexical = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const rosterKey = (sets) => sets.map((s) => JSON.stringify(s)).sort(lexical).join('\n');

/** Sample distinct rosters with separate pool RNG and full-format validation. */
export function sampleMetagame(corpus, {seed, format, rules = [], level_rules = {}, count = 100} = {}) {
  const formatId = buildFormatId(format, rules);
  const dex = Dex.forFormat(Dex.formats.get(formatId, true));
  const size = Math.min(6, formatInfo(formatId).max_team);
  const rng = makeRng(`${seed}:metagame`);
  const entries = [];
  let invalidSets = 0;
  for (const entry of corpus.entries || []) {
    const weight = Number(entry.usage);
    if (!Number.isFinite(weight) || weight <= 0) continue;
    const seen = new Set();
    const options = [];
    for (const raw of entry.sets || []) {
      try {
        const set = applyLevelRules(completeSets([raw], formatId), level_rules)[0];
        const key = JSON.stringify(set);
        if (!seen.has(key)) { options.push(set); seen.add(key); }
      } catch { invalidSets++; }
    }
    if (options.length) entries.push({weight, options, base: toID(dex.species.get(options[0].species).baseSpecies)});
  }
  // Number of unordered rosters: do not count permutations of the same sets as new teams.
  const groups = new Map();
  for (const e of entries) {
    const group = groups.get(e.base) || new Set();
    for (const s of e.options) group.add(JSON.stringify(s));
    groups.set(e.base, group);
  }
  const combinations = [1n, ...Array(size).fill(0n)];
  for (const options of groups.values()) {
    for (let i = size; i > 0; i--) combinations[i] += combinations[i - 1] * BigInt(options.size);
  }
  const pool = [];
  const checked = new Set();
  let attempts = 0;
  let rejected = 0;
  let duplicates = 0;
  const rejectionExamples = [];
  // A finite search returns an explicitly incomplete sample when the corpus cannot supply enough legal rosters.
  while (pool.length < count && attempts < count * 50 && BigInt(checked.size) < combinations[size]) {
    attempts++;
    let available = entries.slice();
    const sets = [];
    for (let slot = 0; slot < size; slot++) {
      const total = available.reduce((sum, e) => sum + e.weight, 0);
      let roll = rng() * total;
      const entry = available.find((e) => (roll -= e.weight) < 0) || available.at(-1);
      if (!entry) break;
      sets.push(entry.options[Math.floor(rng() * entry.options.length)]);
      available = available.filter((e) => e.base !== entry.base);
    }
    const key = rosterKey(sets);
    if (checked.has(key)) { duplicates++; continue; }
    checked.add(key);
    const validation = validateTeam(formatId, sets);
    if (!validation.ok) {
      rejected++;
      if (rejectionExamples.length < 3) rejectionExamples.push(validation.problems);
      continue;
    }
    const id = `meta-${String(pool.length + 1).padStart(3, '0')}`;
    pool.push({id, name: id, sets: structuredClone(sets)});
  }
  return {
    requested: count, generated: pool.length, complete: pool.length === count,
    reason: pool.length === count ? '' : combinations[size] === 0n ? 'insufficient_species' :
      BigInt(checked.size) >= combinations[size] ? 'corpus_exhausted' : 'sampling_exhausted',
    attempts, rejected, duplicates, invalid_sets: invalidSets, rejection_examples: rejectionExamples,
    format_requested: format, rules, level_rules,
    usage_format: corpus.usage_format || '', source: corpus.source || '',
    source_formats: [...new Set((corpus.entries || []).flatMap((e) => e.source_formats || []))].sort(lexical),
    corpus_sha256: corpus.sha256, corpus: structuredClone(corpus), pool,
    method: 'usage_weighted_without_replacement', pool_seed: `${seed}:metagame`,
    team_size: size,
  };
}

/** Opponent contributions from the existing battle summaries; roster appearances are the denominator. */
export function metagameThreats(observations) {
  const totals = new Map();
  for (const {sets, pokemon} of observations) {
    for (const species of new Set(sets.map((s) => s.species))) {
      const id = toID(species);
      const row = totals.get(id) || {species, appearances: 0, kos: 0, damage: 0};
      row.appearances++;
      totals.set(id, row);
    }
    for (const p of pokemon) {
      const id = toID(p.species || p.name);
      const row = totals.get(id) || totals.get(toID(Dex.species.get(p.species).baseSpecies));
      if (row) { row.kos += p.kos || 0; row.damage += p.damage || 0; }
    }
  }
  return [...totals.values()].filter((p) => p.kos > 0 || p.damage > 0)
    .map((p) => ({...p, damage: Math.round(p.damage * 100) / 100}))
    .sort((a, b) => b.kos - a.kos || b.damage - a.damage || lexical(a.species, b.species)).slice(0, 3);
}
