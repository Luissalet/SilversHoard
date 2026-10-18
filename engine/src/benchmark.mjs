// Compare several team variants against the same rivals with shared seeds (no new simulator: playOut / series machinery).
import {EngineError} from './core.mjs';
import {makeRng} from './ai.mjs';
import {playOut} from './stats.mjs';
import {eventLines, rtRun} from './realtime/sim.mjs';

function playAny(spec) {
  if (spec.mode === 'realtime') {
    const b = rtRun({...spec, seed: Array.isArray(spec.seed) ? spec.seed.join(',') : String(spec.seed || Date.now())});
    return {summary: b.summary(), lines: eventLines(b), seed: b.seed, turns: 0, seconds: b.t / 30};
  }
  return playOut(spec, {keepLog: true});
}

/** Resolve a usable master seed once (empty / missing → timestamp) so the result can be replayed. */
export function resolveMasterSeed(seed) {
  if (seed === undefined || seed === null || seed === '') return Date.now();
  return seed;
}

/** Deterministic per-rival game seeds from one master seed so every variant faces the same rolls. */
export function sharedSeeds(masterSeed, rivalCount, games) {
  const rng = makeRng(resolveMasterSeed(masterSeed));
  return Array.from({length: rivalCount}, () =>
    Array.from({length: games}, () => [0, 1, 2, 3].map(() => Math.floor(rng() * 65536))));
}

/**
 * variants: [{id, name, sets, ai}] — first is the reference team.
 * rivals: [{id, name, sets, ai}]
 * games: battles per variant×rival (same seeds across variants).
 */
export function teamBenchmark(args = {}, onProgress = () => {}) {
  const variants = args.variants || [];
  const rivals = args.rivals || [];
  const games = Math.max(1, Math.min(Number(args.games) || 1, 50));
  if (variants.length < 2) throw new EngineError('invalid', 'Pick at least two team variants to compare.');
  if (!rivals.length) throw new EngineError('invalid', 'Pick at least one rival.');
  const format = args.format || 'gen9customgame';
  const rules = args.rules || [];
  const level_rules = args.level_rules || {};
  const mode = args.mode === 'realtime' ? 'realtime' : 'classic';
  const masterSeed = resolveMasterSeed(args.seed);
  const seeds = sharedSeeds(masterSeed, rivals.length, games);
  const total = variants.length * rivals.length * games;
  let done = 0;
  const rows = [];

  for (const variant of variants) {
    const byRival = [];
    let wins = 0;
    let losses = 0;
    let ties = 0;
    const perMon = {};
    for (let ri = 0; ri < rivals.length; ri++) {
      const rival = rivals[ri];
      let rw = 0;
      let rl = 0;
      let rt = 0;
      for (let g = 0; g < games; g++) {
        const seed = seeds[ri][g];
        const spec = {
          format, rules, level_rules, mode, seed,
          max_turns: args.max_turns,
          time_limit: args.time_limit || 0,
          arena: args.arena || '',
          version: args.version || 0,
          silver_special: args.silver_special,
          // Internal seat identities must remain distinct even when public trainer names match.
          p1: {name: 'p1', sets: variant.sets, ai: variant.ai},
          p2: {name: 'p2', sets: rival.sets, ai: rival.ai},
        };
        const r = playAny(spec);
        const w = r.summary.winner_side || 'tie';
        if (w === 'p1') { rw++; wins++; }
        else if (w === 'p2') { rl++; losses++; }
        else { rt++; ties++; }
        for (const p of r.summary.sides.p1.pokemon) {
          const k = p.species || p.name;
          const acc = (perMon[k] ||= {species: k, kos: 0, damage: 0, fainted: 0, battles: 0});
          acc.kos += p.kos;
          acc.damage += p.damage;
          acc.fainted += p.fainted ? 1 : 0;
          acc.battles += 1;
        }
        done += 1;
        onProgress(total ? done / total : 1);
      }
      const played = rw + rl + rt;
      byRival.push({
        rival_id: rival.id,
        rival_name: rival.name,
        wins: rw, losses: rl, ties: rt,
        win_rate: played ? rw / played : 0,
        seeds: seeds[ri],
      });
    }
    const played = wins + losses + ties;
    const mons = Object.values(perMon).map((m) => ({
      ...m,
      damage: Math.round((m.damage / m.battles) * 100) / 100,
      kos_per_battle: Math.round((m.kos / m.battles) * 100) / 100,
      survival: Math.round((1 - m.fainted / m.battles) * 100) / 100,
    })).sort((a, b) => b.kos_per_battle - a.kos_per_battle || b.damage - a.damage);
    rows.push({
      id: variant.id,
      name: variant.name,
      wins, losses, ties,
      win_rate: played ? wins / played : 0,
      by_rival: byRival,
      mvp: mons[0] || null,
      pokemon: mons,
    });
  }

  const ref = rows[0];
  for (const row of rows) {
    row.delta = {
      wins: row.wins - ref.wins,
      losses: row.losses - ref.losses,
      win_rate: Math.round((row.win_rate - ref.win_rate) * 1000) / 1000,
      by_rival: row.by_rival.map((br, i) => ({
        rival_id: br.rival_id,
        wins: br.wins - ref.by_rival[i].wins,
        losses: br.losses - ref.by_rival[i].losses,
        win_rate: Math.round((br.win_rate - ref.by_rival[i].win_rate) * 1000) / 1000,
      })),
    };
  }

  const improved = rows.slice(1).filter((r) => r.delta.wins > 0 || r.delta.win_rate > 0).map((r) => r.id);
  const worsened = rows.slice(1).filter((r) => r.delta.wins < 0 || r.delta.win_rate < 0).map((r) => r.id);

  return {
    seed: masterSeed,
    games,
    format,
    mode,
    reference_id: variants[0].id,
    variants: rows,
    rivals: rivals.map((r) => ({id: r.id, name: r.name})),
    improved,
    worsened,
    hall_of_fame_touched: false,
  };
}
