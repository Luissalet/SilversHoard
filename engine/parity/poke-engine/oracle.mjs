// The oracle of the poke-engine parity kit: plays each case's turn in the simulator (@pkmn/sim) and writes the trace.
//
//   node engine/parity/poke-engine/oracle.mjs <inputs.jsonl> <trace.jsonl>
//
// The turn is played ROLLS (16) times, once per damage roll, from the replayed battle, with every other chance taking its likelier
// result (hits, no secondary effects, no critical hit unless the case forces one). What differs between the runs is written as
// {"$oneof": [...]} (several legal results) or {"$range": [lo, hi]} (a number): poke-engine must land inside what the simulator can do.
//
// Events per case, in this order: `order` and `damage.first` (who dealt the first direct damage and how much; only when both sides
// attacked) and `after` (the summary of the battle after the turn, see lib.mjs).
import {readFileSync, writeFileSync} from 'node:fs';
import {ROLLS, idsOf, modal, replay, summarize} from './lib.mjs';
import {masterState} from '../../src/master.mjs';

const HP_TOLERANCE = 1.5;                // the two engines round residual damage and healing in different steps; one point apart is the same

/** The lines of the protocol log after `from`, secret versions only (a `|split|` line is followed by the secret and the public line). */
function lines(battle, from) {
  const out = [];
  for (let i = from; i < battle.log.length; i++) {
    const line = battle.log[i];
    if (line.startsWith('|split|')) { out.push(battle.log[i + 1]); i += 2; continue; }
    out.push(line);
  }
  return out;
}

const hpOf = (text) => {
  if (/^0( |$)/.test(text || '')) return 0;
  const m = /^(\d+)\/(\d+)/.exec(text || '');
  return m ? Number(m[1]) : null;
};

/** First direct damage of each side's move in the turn: {order: 'p1'|'p2'|null, damage: {p1, p2}}. */
export function observe(battle, from, hp0) {
  const hp = new Map(hp0);
  const damage = {p1: null, p2: null};
  let mover = null;
  let order = null;
  for (const line of lines(battle, from)) {
    const parts = line.split('|');
    const kind = parts[1];
    if (kind === 'move') mover = parts[2].slice(0, 2);
    else if (kind === 'switch' || kind === 'drag') {
      hp.set(parts[2].slice(0, 2), hpOf(parts[4]));
    } else if (kind === '-damage' || kind === '-heal' || kind === '-sethp') {
      const ident = parts[2].slice(0, 2);
      const now = hpOf(parts[3]);
      const before = hp.get(ident);
      const fromEffect = parts.slice(4).some((p) => p.startsWith('[from]'));
      // every hit of the move counts (a multi-hit move is one Damage instruction for poke-engine); the first one decides who hit first
      if (kind === '-damage' && !fromEffect && mover && mover !== ident && before != null && now != null && before > now) {
        damage[mover] = (damage[mover] ?? 0) + (before - now);
        if (order === null) order = mover;
      }
      if (now != null) hp.set(ident, now);
    }
  }
  return {order, damage};
}

/** JSON with sorted keys and no spaces, the way the probe writes it: equal traces are equal bytes. */
export function canon(value) {
  if (Array.isArray(value)) return `[${value.map(canon).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canon(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Merge the results of the runs: equal -> the value, numbers -> $range, objects key by key, anything else -> $oneof. */
/** Whether the values (one per damage roll) move in a straight line: no knock-out or other threshold is crossed between the rolls. */
function linear(values) {
  const steps = values.slice(1).map((v, i) => v - values[i]);
  const mean = steps.reduce((a, b) => a + b, 0) / steps.length;
  return steps.every((d) => Math.abs(d - mean) <= 3);
}

export function merge(values, key = '') {
  const first = values[0];
  const plain = (v) => v && typeof v === 'object' && !Array.isArray(v);
  if (plain(first) && values.every(plain)) {
    const keys = [...new Set(values.flatMap((v) => Object.keys(v)))].sort();
    return Object.fromEntries(keys.map((k) => [k, merge(values.map((v) => (k in v ? v[k] : null)), key === 'hp' ? 'hp' : k)]));
  }
  if (values.every((v) => same(v, first))) return key === 'hp' && typeof first === 'number' ? {$approx: [first, HP_TOLERANCE]} : first;
  if (values.every((v) => typeof v === 'number')) {
    const lo = Math.min(...values);
    const hi = Math.max(...values);
    // a hit point count that depends on the damage roll: poke-engine plays the average roll, so the mean of the rolls; when something
    // happens at a threshold (a knock-out, an item) the mean is meaningless and the whole interval is accepted
    if (key === 'hp' && lo >= 0 && linear(values)) return {$approx: [values.reduce((a, b) => a + b, 0) / values.length, 3 + 0.003 * hi]};
    return {$range: [lo, hi]};
  }
  const seen = [];
  for (const v of values) if (!seen.some((x) => same(x, v))) seen.push(v);
  return {$oneof: seen.sort((x, y) => (typeof x === 'number' && typeof y === 'number' ? x - y : 0))};
}

/** The first place where two JSON values differ, as a path (or '' when they are the same). */
export function firstDiff(a, b, path = '') {
  if (same(a, b)) return '';
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const d = firstDiff(a[k], b[k], `${path}.${k}`);
      if (d) return d;
    }
  }
  return `${path} (${JSON.stringify(a)} vs ${JSON.stringify(b)})`.slice(0, 160);
}

export function playCase(input) {
  const runs = [];
  for (let roll = 0; roll < ROLLS; roll++) {
    const b = replay(input);
    if (roll === 0) {
      // the replayed battle must be the one the corpus describes, or the probe and the oracle would be playing different turns
      const moved = firstDiff(JSON.parse(JSON.stringify(masterState(b, 'p1'))), input.state);
      if (moved) throw new Error(`the battle does not replay to the corpus state at ${moved}`);
    }
    const ids = idsOf(b);
    const hp0 = [];
    for (const s of b.sides) for (const p of s.active) if (p) hp0.push([`${s.id}`, p.hp]);
    b.prng = modal(b, roll, input.crit);
    const from = b.log.length;
    b.makeChoices(input.choice[0], input.choice[1]);
    const seen = observe(b, from, hp0);
    runs.push({seen, after: summarize(masterState(b, 'p1'), ids, b, !!input.ends)});
  }
  const ev = [];
  if (input.flags.order) {
    // both sides attacked: who hit first and how hard (the damage depends on the roll like any other number: its mean when it moves in a
    // straight line, its interval when a knock-out or another threshold is crossed)
    ev.push(['state', 'order', merge(runs.map((r) => r.seen.order))]);
    ev.push(['state', 'damage.first', merge(runs.map((r) => (r.seen.order ? r.seen.damage[r.seen.order] : null)), 'hp')]);
  }
  ev.push(['state', 'after', merge(runs.map((r) => r.after))]);
  return {id: input.id, ev, out: {turn: input.history.length + 1}};
}

function main() {
  const [inputs, out] = process.argv.slice(2);
  if (!inputs || !out) { console.error('usage: node oracle.mjs <inputs.jsonl> <trace.jsonl>'); process.exit(2); }
  const lines_ = [];
  for (const raw of readFileSync(inputs, 'utf8').split('\n')) {
    if (!raw.trim()) continue;
    const {id, input} = JSON.parse(raw);
    try {
      lines_.push(canon(playCase(input)));
    } catch (e) {
      lines_.push(canon({id, ev: [], err: `${e?.name || 'Error'}: ${String(e?.message || e).slice(0, 200)}`}));
    }
  }
  writeFileSync(out, lines_.join('\n') + '\n');
  console.log(`${lines_.length} cases -> ${out}`);
}

if (process.argv[1]?.endsWith('oracle.mjs')) main();
