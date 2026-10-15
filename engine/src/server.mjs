// The engine process the Python app talks to: one JSON request per line on stdin, one JSON answer per line on stdout
// ({id, ok, result} or {id, ok: false, error: {code, message}}). Live battles stay in memory; the app keeps their snapshots,
// so a restarted engine continues any battle with `match_start` + `snapshot`.
import readline from 'node:readline';
import * as core from './core.mjs';
import {Match, compactTrace} from './match.mjs';
import {playOut, series, summarize, tournament} from './stats.mjs';
import {viewLines} from './match.mjs';
import {chooseFor, freeze, makeRng} from './ai.mjs';
import {masterAvailable} from './master.mjs';
import {replayCheck} from './replay.mjs';
import {RtBattle, eventLines, prepareRtTeam, rtRun} from './realtime/sim.mjs';
import {cooldownTable} from './realtime/moves.mjs';
import {damageCalc} from './calc.mjs';

const matches = new Map();
const MAX_OPEN = 64;

function touch(id, m) {
  matches.delete(id);
  matches.set(id, m);
  while (matches.size > MAX_OPEN) matches.delete(matches.keys().next().value);
}

function getMatch(id) {
  const m = matches.get(id);
  if (!m) throw new core.EngineError('match_not_loaded', `Battle ${id} is not loaded in the engine.`);
  touch(id, m);
  return m;
}

const handlers = {
  ping: () => ({pong: true, versions: process.versions.node, open: matches.size, master: masterAvailable()}),
  formats: (a) => ({formats: core.listFormats({gen: a.gen || 0, query: a.query || ''})}),
  format_info: (a) => core.formatInfo(core.buildFormatId(a.format, a.rules)),
  import_team: (a) => {
    const sets = core.importTeam(a.text ?? a.sets);
    return {sets, paste: core.exportTeam(sets)};
  },
  import_teams: (a) => ({teams: core.importTeams(a.text)}),
  export_team: (a) => ({paste: core.exportTeam(a.sets || [])}),
  validate: (a) => {
    const formatId = core.buildFormatId(a.format, a.rules);
    const sets = core.applyLevelRules(core.importTeam(a.sets), a.level_rules || {});
    return {format: formatId, ...core.validateTeam(formatId, sets)};
  },
  random_team: (a) => core.randomTeam(a.format || 'gen9randombattle', a.seed || null),
  summary: (a) => ({pokemon: core.teamSummary(core.importTeam(a.sets), a.format || 'gen9customgame')}),
  stat_points: (a) => {
    let sets;
    try { sets = core.applyStatPoints(core.importTeam(a.sets), a.points || {}); } catch (e) { if (e instanceof RangeError) throw new core.EngineError('invalid', e.message); throw e; }
    return {sets, pokemon: core.teamSummary(sets, a.format || 'gen9customgame')};
  },
  dex_search: (a) => ({results: core.dexSearch(a.kind || 'species', a.query || '', {gen: a.gen || 9, limit: a.limit || 30, species: a.species || ''})}),
  species: (a) => core.speciesInfo(a.name, a.gen || 9),
  damage_calc: (a) => damageCalc(a),
  match_start: (a) => {
    const m = new Match(a.spec, a.snapshot || null);
    if (!a.snapshot) m.advance();
    touch(m.id, m);
    return {...m.state(a.view || 'host', a.since || 0), seed: m.spec.seed, snapshot: a.want_snapshot ? freeze(m.battle) : undefined, notes: m.takeNotes()};
  },
  match_loaded: (a) => ({loaded: matches.has(a.id)}),
  match_choose: (a) => {
    const m = getMatch(a.id);
    m.choose(a.side, a.choice);
    return {...m.state(a.view || 'host', a.since || 0), snapshot: freeze(m.battle), notes: m.takeNotes()};
  },
  match_state: (a) => {
    const m = getMatch(a.id);
    return {...m.state(a.view || 'host', a.since || 0), snapshot: a.want_snapshot ? freeze(m.battle) : undefined};
  },
  match_forfeit: (a) => {
    const m = getMatch(a.id);
    m.forfeit(a.side);
    return {...m.state(a.view || 'host', a.since || 0), snapshot: freeze(m.battle), notes: m.takeNotes()};
  },
  match_log: (a) => {
    const m = getMatch(a.id);
    const lines = viewLines(m.battle.log, 0, a.view || 'omniscient');
    return {lines, summary: summarize(viewLines(m.battle.log, 0, 'omniscient')), input_log: m.inputLog(), notes: m.takeNotes()};
  },
  // what the AI would do now for one side of a live battle (a person's side: advice) and why, without choosing
  match_advice: (a) => {
    const m = getMatch(a.id);
    const b = m.battle;
    const side = b.sides.find((s) => s && s.id === a.side);
    if (!side) throw new core.EngineError('invalid', `No side ${a.side}.`);
    const req = side.activeRequest;
    if (b.ended || !req || req.wait || side.isChoiceDone()) return {turn: b.turn, advice: null};
    const trace = {};
    // a person sees only what the battle has shown of the other team: the advice does too (unless the app says otherwise)
    chooseFor(b, a.side, {level: a.level || 'expert', style: a.style || 'balanced', rng: makeRng(`advice:${b.turn}:${a.side}`), trace,
      hidden: a.hidden !== false, beliefs: a.beliefs || {}});
    return {turn: b.turn, advice: trace.choice ? compactTrace(trace) : null};
  },
  match_close: (a) => ({closed: matches.delete(a.id)}),
  // a friend's turn-based battle from a playable page, played again from its record (replay.mjs)
  replay_check: (a) => replayCheck(a),
  play_out: (a) => playOut(a.spec, {keepLog: true}),
  simulate: (a) => series(a.spec, Math.max(1, Math.min(Number(a.count) || 1, 200))),
  tournament: (a) => tournament(a),
  summarize: (a) => summarize(a.lines || []),
  // real time (Legends: Z-A rules): the screen runs the battle; the engine checks the teams, plays AI-vs-AI battles and
  // replays a battle from its seed and the people's inputs to get the result the app stores
  rt_check: (a) => {
    const b = new RtBattle(a.spec);
    return {seed: b.seed, format: b.formatId, gen: b.gen, view: b.view()};
  },
  rt_team: (a) => ({pokemon: prepareRtTeam(core.importTeam(a.sets), {format: a.format || 'gen9customgame', levelRules: a.level_rules || {}})}),
  rt_cooldowns: (a) => ({moves: cooldownTable(a.moves || [], {gen: a.gen || 9, speed: a.speed || 0})}),
  rt_play_out: (a) => rtResult(rtRun(a.spec), a),
  rt_replay: (a) => rtResult(rtRun(a.spec, {inputs: a.inputs || [], forfeit: a.forfeit || '', tick: a.tick || 0}), a),
};

function rtResult(b, a = {}) {
  return {summary: b.summary(), lines: eventLines(b), seed: b.seed, seconds: b.t / 30, ended: b.ended, winner_side: b.summary().winner_side,
    inputs: b.inputLog, events: a.want_events ? b.events : undefined};
}

export async function handle(req) {
  const fn = handlers[req.cmd];
  if (!fn) return {id: req.id, ok: false, error: {code: 'unknown_command', message: `Unknown command: ${req.cmd}`}};
  try {
    const result = await fn(req.args || {});
    return {id: req.id, ok: true, result};
  } catch (e) {
    return {id: req.id, ok: false, error: {code: e.code || 'engine_error', message: e.message || String(e), details: e.details || {}}};
  }
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop());
if (isMain) {
  const rl = readline.createInterface({input: process.stdin, crlfDelay: Infinity});
  const out = (obj) => process.stdout.write(JSON.stringify(obj) + '\n');
  out({id: 0, ok: true, result: {ready: true, node: process.versions.node}});
  rl.on('line', async (line) => {
    if (!line.trim()) return;
    let req;
    try {
      req = JSON.parse(line);
    } catch (e) {
      out({id: null, ok: false, error: {code: 'bad_json', message: e.message}});
      return;
    }
    out(await handle(req));
  });
  rl.on('close', () => process.exit(0));
}
