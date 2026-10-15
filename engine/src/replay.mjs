// Checking a friend's turn-based battle: the playable page sends the battle's input log (the simulator's own record: the start with
// its seed, both players with their packed teams, and every committed choice). The app plays it again on its own simulator: the
// teams must be the ones it expects (the friend's team from the code, the opponent as the app has it, with the challenge's level
// rules), every choice must be legal, and the result is whatever the replay says. With `ai`, it also asks the AI what it would
// have chosen at each of its decisions (same random numbers as the page's) and counts the choices that differ: with the same AI
// version there should be none, so a code whose opponent was made to play badly is caught. With `expect_seed` (the week's challenge)
// the battle must have been played with exactly that seed and AI key, so everyone that week faced the same luck.
import {Battle} from '@pkmn/sim';
import {buildFormatId, EngineError, seedArray} from './core.mjs';
import {MAX_TURNS_DEFAULT, prepareTeam, viewLines} from './match.mjs';
import {chooseFor, makeRng} from './ai.mjs';

const MAX_LINES = 20000;

function parseLine(line, prefix) {
  return line.startsWith(prefix) ? JSON.parse(line.slice(prefix.length)) : null;
}

/**
 * a: {input: [lines], format, rules, level_rules, p1_sets, p2_sets, ai: {level, style} | null, rng_id, forfeit: '' | 'p1', expect_seed?}
 * Returns {ok, problems, winner_side, turns, ended, ai_decisions, ai_mismatches, hp_left, lines}; hp_left is the friend's team's HP
 * left at the end, in percent of the whole team.
 */
export function replayCheck(a) {
  const input = (Array.isArray(a.input) ? a.input : []).map(String).slice(0, MAX_LINES);
  const problems = [];
  const fid = buildFormatId(a.format, a.rules || []);
  const startLine = input.find((l) => l.startsWith('>start '));
  const p1Line = input.find((l) => l.startsWith('>player p1 '));
  const p2Line = input.find((l) => l.startsWith('>player p2 '));
  if (!startLine || !p1Line || !p2Line) throw new EngineError('invalid', 'The battle record is incomplete.');
  const start = parseLine(startLine, '>start ');
  const p1 = parseLine(p1Line, '>player p1 ');
  const p2 = parseLine(p2Line, '>player p2 ');
  if (start.formatid !== fid) problems.push(`format ${start.formatid} instead of ${fid}`);
  if (p2.team !== prepareTeam(a.p2_sets || [], fid, a.level_rules || {})) problems.push("the opponent's team is not the one this app has");
  if (a.p1_sets && p1.team !== prepareTeam(a.p1_sets, fid, a.level_rules || {})) problems.push("the friend's team is not the one in the code");
  if (a.expect_seed) {
    const same = (x) => [x].flat().join(',');
    if (same(start.seed) !== same(seedArray(String(a.expect_seed)))) problems.push("not played with this week's seed");
    if (String(a.rng_id || '') !== String(a.expect_seed)) problems.push("not played with this week's AI luck");
  }
  const b = new Battle({formatid: start.formatid, seed: start.seed, p1: {name: p1.name, team: p1.team}, p2: {name: p2.name, team: p2.team}});
  b.send = () => {};
  const rng = a.ai ? makeRng(`${a.rng_id}:p2`) : null;
  let decisions = 0;
  let mismatches = 0;
  // the AI's decision at this moment (on the page it chose before the person): normalised the way the record writes choices
  const aiCheck = (recorded) => {
    const s = b.sides[1];
    if (!a.ai || !s.activeRequest || s.activeRequest.wait) return;
    decisions++;
    let mine = null;
    // the page plays the master as the expert (its search needs the app): so does the check
    const level = a.ai.level === 'master' ? 'expert' : a.ai.level;
    try { mine = chooseFor(b, 'p2', {level, style: a.ai.style, rng}); } catch { mine = null; }
    let norm = '';
    try {
      if (mine && s.choose(mine)) norm = s.getChoice();
    } catch { norm = ''; }
    s.clearChoice();
    if (norm !== recorded) mismatches++;
  };
  const pending = (s) => !!(s.activeRequest && !s.activeRequest.wait && !s.isChoiceDone());
  const lines = input.filter((l) => /^>(p[12]|forcewin|forcelose|forcetie|tiebreak)\b/.test(l));
  for (let i = 0; i < lines.length && !b.ended; i++) {
    const line = lines[i];
    if (!/^>p[12] /.test(line)) {
      problems.push(`unexpected ${line.split(' ')[0]}`);   // the simulator's own endings are not something a page sends
      break;
    }
    // a person's line followed by the AI's for the same moment: the AI's goes first
    let order = [line];
    if (line.startsWith('>p1 ') && lines[i + 1]?.startsWith('>p2 ') && pending(b.sides[1])) {
      order = [lines[i + 1], line];
      i++;
    }
    for (const l of order) {
      const side = l.slice(1, 3);
      const choice = l.slice(4);
      if (side === 'p2') aiCheck(choice);
      if (!b.choose(side, choice)) {
        problems.push(`illegal choice for ${side}: ${choice}`);
        break;
      }
    }
    if (problems.length) break;
  }
  if (!b.ended && a.forfeit === 'p1') b.lose(b.sides[0]);
  if (!b.ended && b.turn > MAX_TURNS_DEFAULT) b.tie();
  const winnerSide = b.ended ? (b.sides.find((s) => s && s.name === b.winner)?.id || '') : '';
  const team = b.sides[0].pokemon;
  const hpLeft = team.length ? Math.round(1000 * team.reduce((n, p) => n + (p.fainted || !p.maxhp ? 0 : p.hp / p.maxhp), 0) / team.length) / 10 : 0;
  return {ok: !problems.length && !!b.ended, problems, ended: !!b.ended, winner_side: winnerSide, turns: b.turn,
    ai_decisions: decisions, ai_mismatches: mismatches, hp_left: hpLeft, lines: viewLines(b.log, 0, 'omniscient')};
}
