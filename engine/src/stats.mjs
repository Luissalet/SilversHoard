// What a finished battle says in numbers (KOs, damage, survivors), and batches of AI-vs-AI battles (series and tournaments).
import {Match, viewLines} from './match.mjs';
import {makeRng} from './ai.mjs';
import {eventLines, rtRun} from './realtime/sim.mjs';

function nameOf(ident) {
  // "p1a: Garchomp" -> ["p1", "Garchomp"]
  const m = /^(p\d)[a-z]?: (.*)$/.exec(ident || '');
  return m ? [m[1], m[2]] : ['', ident || ''];
}

function hpOf(cond) {
  const m = /^(\d+)\/(\d+)/.exec(cond || '');
  if (!m) return cond && cond.startsWith('0') ? 0 : null;
  return Number(m[1]) / Number(m[2]);
}

/** Per side and per Pokémon: KOs, damage dealt (fraction of a Pokémon's HP), times fainted, turns. From the omniscient log. */
export function summarize(lines) {
  const mons = {};
  const hp = {};
  const species = {};
  let lastMove = null;
  let turns = 0;
  let winner = '';
  const players = {};
  const key = (ident) => { const [side, name] = nameOf(ident); return `${side}:${name}`; };
  const mon = (k) => (mons[k] ||= {side: k.split(':')[0], name: k.split(':').slice(1).join(':'), species: species[k] || '', kos: 0, damage: 0, fainted: false, switches: 0, moves: 0});
  for (const line of lines) {
    const parts = line.split('|');
    const cmd = parts[1];
    if (cmd === 'player' && parts[3]) players[parts[2]] = parts[3];
    else if (cmd === 'switch' || cmd === 'drag' || cmd === 'replace') {
      const k = key(parts[2]);
      species[k] = (parts[3] || '').split(',')[0];
      mon(k).species = species[k];
      mon(k).switches++;
      hp[k] = hpOf(parts[4]) ?? 1;
    } else if (cmd === 'move') {
      lastMove = key(parts[2]);
      mon(lastMove).moves++;
    } else if (cmd === '-damage' || cmd === '-heal' || cmd === '-sethp') {
      const k = key(parts[2]);
      const now = hpOf(parts[3]);
      if (now === null) continue;
      const before = hp[k] ?? 1;
      if (cmd === '-damage' && !parts[4] && lastMove && lastMove.split(':')[0] !== k.split(':')[0]) mon(lastMove).damage += Math.max(0, before - now);
      hp[k] = now;
    } else if (cmd === 'faint') {
      const k = key(parts[2]);
      mon(k).fainted = true;
      if (lastMove && lastMove.split(':')[0] !== k.split(':')[0]) mon(lastMove).kos++;
    } else if (cmd === 'turn') {
      turns = Number(parts[2]) || turns;
      lastMove = null;
    } else if (cmd === 'win') {
      winner = parts[2] || '';
    } else if (cmd === 'tie') {
      winner = '';
    }
  }
  const list = Object.values(mons).map((m) => ({...m, damage: Math.round(m.damage * 100) / 100}));
  const bySide = {};
  for (const side of ['p1', 'p2']) {
    const own = list.filter((m) => m.side === side);
    bySide[side] = {name: players[side] || side, kos: own.reduce((a, m) => a + m.kos, 0), lost: own.filter((m) => m.fainted).length, pokemon: own};
  }
  const winnerSide = Object.entries(players).find(([, n]) => n === winner)?.[0] || '';
  return {turns, winner, winner_side: winnerSide, sides: bySide};
}

/** Play one AI-vs-AI battle to the end. Returns {summary, lines (omniscient), errors, seed}. */
export function playOut(spec, {keepLog = true} = {}) {
  const m = new Match({...spec, p1: {...spec.p1, ai: spec.p1.ai || {level: 'normal'}}, p2: {...spec.p2, ai: spec.p2.ai || {level: 'normal'}}});
  m.advance(100000);
  const lines = viewLines(m.battle.log, 0, 'omniscient');
  return {summary: summarize(lines), lines: keepLog ? lines : null, errors: m.errors, seed: m.spec.seed, turns: m.battle.turn};
}

/** One AI-vs-AI battle in real time (Legends: Z-A rules), in the same shape as `playOut`. */
export function rtPlayOut(spec) {
  const b = rtRun({...spec, seed: Array.isArray(spec.seed) ? spec.seed.join(',') : String(spec.seed || Date.now())});
  return {summary: b.summary(), lines: eventLines(b), errors: [], seed: b.seed, turns: 0, seconds: b.t / 30};
}

const playAny = (spec, opts) => (spec.mode === 'realtime' ? rtPlayOut(spec) : playOut(spec, opts));

/** `count` battles between the same two trainers: win rates, average turns, MVPs; the log of one battle of each outcome. */
export function series(spec, count = 10, onProgress = () => {}) {
  const rng = makeRng(spec.seed || Date.now());
  const results = {p1: 0, p2: 0, tie: 0};
  const perMon = {};
  let turns = 0;
  let seconds = 0;
  const samples = {};
  const battles = [];
  for (let i = 0; i < count; i++) {
    const seed = [0, 1, 2, 3].map(() => Math.floor(rng() * 65536));
    const r = playAny({...spec, seed}, {keepLog: true});
    const w = r.summary.winner_side || 'tie';
    seconds += r.seconds || 0;
    results[w] = (results[w] || 0) + 1;
    turns += r.summary.turns;
    for (const side of ['p1', 'p2']) {
      for (const p of r.summary.sides[side].pokemon) {
        const k = `${side}:${p.species || p.name}`;
        const acc = (perMon[k] ||= {side, species: p.species || p.name, kos: 0, damage: 0, fainted: 0, battles: 0});
        acc.kos += p.kos;
        acc.damage += p.damage;
        acc.fainted += p.fainted ? 1 : 0;
        acc.battles += 1;
      }
    }
    if (!samples[w]) samples[w] = {seed: r.seed, lines: r.lines, summary: r.summary};
    battles.push({seed: r.seed, winner_side: w, turns: r.summary.turns, seconds: r.seconds || 0});
    onProgress((i + 1) / count);
  }
  const mons = Object.values(perMon).map((m) => ({...m, damage: Math.round((m.damage / m.battles) * 100) / 100,
    kos_per_battle: Math.round((m.kos / m.battles) * 100) / 100, survival: Math.round((1 - m.fainted / m.battles) * 100) / 100}));
  mons.sort((a, b) => b.kos_per_battle - a.kos_per_battle || b.damage - a.damage);
  return {count, wins: results, win_rate: {p1: results.p1 / count, p2: results.p2 / count}, avg_turns: Math.round((turns / count) * 10) / 10,
    avg_seconds: Math.round((seconds / count) * 10) / 10, mode: spec.mode === 'realtime' ? 'realtime' : 'classic',
    mvp: {p1: mons.find((m) => m.side === 'p1') || null, p2: mons.find((m) => m.side === 'p2') || null}, pokemon: mons, battles, samples};
}

/**
 * A tournament between trainers, played by the AI: kind "bracket" (single elimination, byes for the best seeds) or "league" (everyone
 * against everyone, 3 points a win, 1 a tie). entrants: [{id, name, sets, ai}]. best_of: battles per pairing (odd).
 */
export function tournament({format, rules, level_rules, entrants, kind = 'bracket', best_of = 1, seed, mode = 'classic', time_limit = 0, arena = '', version = 0}, onProgress = () => {}) {
  const rng = makeRng(seed || Date.now());
  const bo = Math.max(1, Number(best_of) | 0) | 1;
  const matches = [];
  let played = 0;
  const playPair = (a, b, round) => {
    let wa = 0;
    let wb = 0;
    const games = [];
    for (let g = 0; g < bo && wa <= bo / 2 && wb <= bo / 2; g++) {
      const s = [0, 1, 2, 3].map(() => Math.floor(rng() * 65536));
      const r = playAny({format, rules, level_rules, mode, time_limit, arena, version, seed: s, p1: {name: a.name, sets: a.sets, ai: a.ai}, p2: {name: b.name, sets: b.sets, ai: b.ai}});
      const w = r.summary.winner_side;
      if (w === 'p1') wa++; else if (w === 'p2') wb++;
      games.push({seed: mode === 'realtime' ? r.seed : s, winner: w === 'p1' ? a.id : w === 'p2' ? b.id : '', turns: r.summary.turns, seconds: r.seconds || 0, lines: r.lines, summary: r.summary});
      played++;
      onProgress(played);
    }
    const winner = wa > wb ? a : wb > wa ? b : (rng() < 0.5 ? a : b);
    const m = {round, a: a.id, b: b.id, score: [wa, wb], winner: wa === wb ? '' : winner.id, advance: winner.id, games};
    matches.push(m);
    return {m, winner};
  };
  if (kind === 'league') {
    const table = Object.fromEntries(entrants.map((e) => [e.id, {id: e.id, name: e.name, played: 0, won: 0, tied: 0, lost: 0, points: 0}]));
    for (let i = 0; i < entrants.length; i++) {
      for (let j = i + 1; j < entrants.length; j++) {
        const {m} = playPair(entrants[i], entrants[j], 1);
        for (const [id, mine, theirs] of [[m.a, m.score[0], m.score[1]], [m.b, m.score[1], m.score[0]]]) {
          const row = table[id];
          row.played++;
          if (mine > theirs) { row.won++; row.points += 3; } else if (mine === theirs) { row.tied++; row.points += 1; } else row.lost++;
        }
      }
    }
    const standings = Object.values(table).sort((x, y) => y.points - x.points || y.won - x.won);
    return {kind, best_of: bo, standings, champion: standings[0]?.id || '', matches};
  }
  let round = 1;
  let alive = entrants.slice();
  const rounds = [];
  while (alive.length > 1) {
    const size = 2 ** Math.ceil(Math.log2(alive.length));
    const byes = size - alive.length;
    const next = alive.slice(0, byes);
    const playing = alive.slice(byes);
    const pairs = [];
    for (let i = 0; i < playing.length / 2; i++) pairs.push([playing[i], playing[playing.length - 1 - i]]);
    const roundMatches = [];
    for (const [a, b] of pairs) {
      const {m, winner} = playPair(a, b, round);
      roundMatches.push(m);
      next.push(winner);
    }
    rounds.push({round, byes: alive.slice(0, byes).map((e) => e.id), matches: roundMatches.map((m) => matches.indexOf(m))});
    alive = next;
    round++;
  }
  return {kind: 'bracket', best_of: bo, rounds, champion: alive[0]?.id || '', matches};
}

export function tournamentBattles(entrants, kind, bestOf) {
  const n = entrants.length;
  const bo = Math.max(1, Number(bestOf) | 0) | 1;
  return kind === 'league' ? (n * (n - 1)) / 2 * bo : Math.max(0, n - 1) * bo;
}
