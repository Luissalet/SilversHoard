// The random-source trace of real-time battles: every call of the arena, battle and AI streams in order, with the tick it happened in.
// The recorded fixtures (engine/test/fixtures/rt-*.json) carry its digest per chunk of 128 calls, so a change that rolls the dice in
// another order is caught at the first chunk that differs, and `trace` writes the full calls for the differential kit to compare
// two engine versions call by call.
//
//   node engine/parity/rt-prng.mjs add-fixtures                      adds `prng` to every battle of the fixtures (results must not move)
//   node engine/parity/rt-prng.mjs trace <fixture.json> <out.jsonl>  full traces, one case per battle, in the kit's trace format
//   node engine/parity/rt-prng.mjs window <fixture.json> <battle> <chunk>   the calls of one chunk
import {createHash} from 'node:crypto';
import {readFileSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {RtBattle, rtRun, tapRng} from '../src/realtime/sim.mjs';

export const CHUNK = 128;
export const FIXTURES = ['rt-legacy-v1.json', 'rt-v2.json', 'rt-v9.json'];
const sha = (text) => createHash('sha256').update(text).digest('hex');

/** Replay a recorded battle and return the calls of its random sources: [[stream, tick, value], ...]. */
export function recordCalls(rec) {
  const calls = [];
  const before = tapRng((stream, value, battle) => calls.push([stream, battle ? battle.t : 0, value]));
  let battle;
  try {
    battle = rtRun(rec.spec, {inputs: rec.inputs});
  } finally {
    tapRng(before);
  }
  return {calls, battle};
}

/** The digest record stored in a fixture: totals per stream, a digest of everything and one per chunk of CHUNK calls. */
export function digestCalls(calls) {
  const streams = {};
  for (const [stream] of calls) streams[stream] = (streams[stream] || 0) + 1;
  const line = ([stream, , value]) => `${stream} ${value}\n`;
  const chunks = [];
  for (let i = 0; i < calls.length; i += CHUNK) chunks.push(sha(calls.slice(i, i + CHUNK).map(line).join('')).slice(0, 16));
  return {calls: calls.length, streams, digest: sha(calls.map(line).join('')).slice(0, 32), chunk: CHUNK, chunks};
}

/** Where a stored digest and a fresh one first differ, as a sentence, or '' when they are the same. */
export function firstDifference(stored, fresh, calls) {
  if (stored.digest === fresh.digest && stored.calls === fresh.calls) return '';
  const n = Math.min(stored.chunks.length, fresh.chunks.length);
  let k = 0;
  while (k < n && stored.chunks[k] === fresh.chunks[k]) k++;
  const from = k * CHUNK;
  const win = calls.slice(from, from + CHUNK);
  const ticks = win.length ? `ticks ${win[0][1]}..${win[win.length - 1][1]}` : 'after the last call';
  return `random calls ${from}..${from + CHUNK - 1} differ (${ticks}); recorded ${stored.calls} calls, now ${fresh.calls}`;
}

export function fixturePath(name) {
  return fileURLToPath(new URL(`../test/fixtures/${name}`, import.meta.url));
}

/** Add `prng` to every battle record of every fixture. The fixture is rewritten as it was (same serialisation) apart from the new field. */
export function addToFixtures() {
  const out = [];
  for (const name of FIXTURES) {
    const path = fixturePath(name);
    const raw = readFileSync(path, 'utf8');
    const fix = JSON.parse(raw);
    for (const rec of fix.battles) {
      const {calls, battle} = recordCalls(rec);
      const same = JSON.stringify(battle.summary()) === JSON.stringify(rec.summary) && battle.t === rec.ticks &&
        sha(JSON.stringify(battle.events)) === rec.digest;
      if (!same) throw new Error(`${name}: "${rec.name}" no longer replays to its recorded events; the trace would describe other results`);
      rec.prng = digestCalls(calls);
      out.push(`${name} · ${rec.name}: ${calls.length} calls ${JSON.stringify(rec.prng.streams)}`);
    }
    writeFileSync(path, JSON.stringify(fix) + (raw.endsWith('\n') ? '\n' : ''));
  }
  return out;
}

/** Full traces of a fixture in the kit's format: {"id", "ev": [["prng", "stream@tick", value], ...], "out": {"calls", "ticks"}}. */
export function traceLines(fixtureName) {
  const fix = JSON.parse(readFileSync(fixturePath(fixtureName), 'utf8'));
  return fix.battles.map((rec, i) => {
    const {calls, battle} = recordCalls(rec);
    return JSON.stringify({id: `${fixtureName.replace('.json', '')}#${i}`, ev: calls.map(([stream, tick, value]) => ['prng', `${stream}@${tick}`, value]),
      out: {calls: calls.length, ticks: battle.t, events: battle.events.length}}) + '\n';
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [cmd, a, b, c] = process.argv.slice(2);
  if (cmd === 'add-fixtures') {
    for (const line of addToFixtures()) console.log(line);
  } else if (cmd === 'trace') {
    writeFileSync(b, traceLines(a.replace(/^.*[\\/]/, '')).join(''));
    console.log(`wrote ${b}`);
  } else if (cmd === 'window') {
    const fix = JSON.parse(readFileSync(a, 'utf8'));
    const {calls} = recordCalls(fix.battles[Number(b)]);
    const from = Number(c) * CHUNK;
    calls.slice(from, from + CHUNK).forEach((x, i) => console.log(from + i, ...x));
  } else {
    console.error('usage: rt-prng.mjs add-fixtures | trace <fixture> <out.jsonl> | window <fixture> <battle> <chunk>');
    process.exit(2);
  }
}
