// A type-chart game over the installed historical Dex. No battles or saved records.
import {Dex} from '@pkmn/sim';
import {EngineError, TYPES} from './core.mjs';
import {makeRng} from './ai.mjs';

const fail = message => { throw new EngineError('invalid', message); };
const shuffle = (items, rng) => {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
};

/** Each defensive type's contribution, including historical immunities. */
export function typeFactors(gen, attack, defending) {
  const dex = Dex.mod(`gen${gen}`);
  return defending.map(type => ({type,
    multiplier: dex.getImmunity(attack, [type]) ? 2 ** dex.getEffectiveness(attack, [type]) : 0}));
}
const product = factors => factors.reduce((n, f) => n * f.multiplier, 1);

export function typeChallenge(a = {}) {
  const gen = a.gen ?? 9, mode = a.mode ?? 'dual', seed = a.seed ?? 'silver-types', goal = a.goal ?? 'attack';
  if (!Number.isInteger(gen) || gen < 1 || gen > 9) fail('Choose a generation from 1 to 9.');
  if (!['single', 'dual'].includes(mode)) fail('Choose single or dual defensive types.');
  if (!['attack', 'defend'].includes(goal)) fail('Choose attack or defend practice.');
  if (typeof seed !== 'string' || !seed.trim() || seed.length > 100) fail('Use a nonempty seed up to 100 characters.');
  if (a.version !== undefined && a.version !== 1) fail('Unsupported type challenge version.');
  const dex = Dex.mod(`gen${gen}`), types = TYPES.filter(t => !dex.types.get(t).isNonstandard);
  const rng = makeRng(`silver-types-v1|${gen}|${mode}|${seed}`);
  const pool = dex.species.all().filter(s => s.exists && s.num > 0 && s.gen <= gen && !s.forme && !s.isNonstandard
    && s.types.length === (mode === 'dual' ? 2 : 1)).sort((a, b) => a.num - b.num);
  const questions = [];
  if (goal === 'defend') {
    const defenceRng = makeRng(`silver-types-defense-v1|${gen}|${mode}|${seed}`);
    for (const attack of shuffle(types, defenceRng)) {
      const values = pool.map(mon => ({species: mon.name, types: [...mon.types],
        multiplier: product(typeFactors(gen, attack, mon.types))}));
      const lowest = Math.min(...values.map(v => v.multiplier));
      const worse = values.filter(v => v.multiplier > lowest);
      if (worse.length < 3) continue;
      const winner = shuffle(values.filter(v => v.multiplier === lowest), defenceRng)[0];
      const options = shuffle([winner, ...shuffle(worse, defenceRng).slice(0, 3)], defenceRng)
        .map(({species, types}) => ({species, types}));
      questions.push({round: questions.length + 1, attack, options});
      if (questions.length === 10) break;
    }
  } else for (const mon of shuffle(pool, rng)) {
    const values = types.map(type => ({type, multiplier: product(typeFactors(gen, type, mon.types))}));
    const best = Math.max(...values.map(v => v.multiplier));
    const lower = values.filter(v => v.multiplier < best);
    if (lower.length < 3) continue;
    const winner = shuffle(values.filter(v => v.multiplier === best), rng)[0];
    const options = shuffle([winner, ...shuffle(lower, rng).slice(0, 3)], rng).map(v => v.type);
    questions.push({round: questions.length + 1, species: mon.name, types: [...mon.types], options});
    if (questions.length === 10) break;
  }
  if (questions.length !== 10) fail('This generation has too few suitable defenders.');
  return {spec: {version: 1, gen, mode, seed, ...(goal === 'defend' ? {goal} : {})}, questions,
    basis: {types_only: true, abilities: false, items: false, stab: false, power: false, weather: false, tera: false}};
}

/** Evaluate a sequential prefix, regenerating questions instead of trusting a supplied deck. */
export function scoreTypeChallenge(a = {}) {
  const deck = typeChallenge(a), answers = a.answers;
  if (!Array.isArray(answers) || answers.length > 10) fail('Supply zero to ten answers in question order.');
  let correct = 0, streak = 0, best_streak = 0;
  const feedback = answers.map((selected, i) => {
    const question = deck.questions[i], defensive = deck.spec.goal === 'defend';
    const optionKey = option => defensive ? option.species : option.type;
    const allowed = defensive ? question.options.map(o => o.species) : question.options;
    if (!allowed.includes(selected)) fail(`Answer ${i + 1} is not one of its four options.`);
    const values = question.options.map(option => {
      const factors = typeFactors(deck.spec.gen, defensive ? question.attack : option, defensive ? option.types : question.types);
      return {...(defensive ? option : {type: option}), multiplier: product(factors), factors};
    });
    const best = values.reduce((a, b) => (defensive ? a.multiplier < b.multiplier : a.multiplier > b.multiplier) ? a : b);
    const chosen = values.find(v => optionKey(v) === selected), right = optionKey(chosen) === optionKey(best);
    correct += Number(right); streak = right ? streak + 1 : 0; best_streak = Math.max(best_streak, streak);
    return {round: i + 1, ...(defensive ? {attack: question.attack} : {species: question.species}), correct: right, chosen, best};
  });
  return {spec: deck.spec, total: 10, answered: answers.length, correct, streak, best_streak,
    complete: answers.length === 10, feedback};
}
