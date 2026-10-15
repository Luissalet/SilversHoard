// The neural AI level: each decision goes to the app's neural AI server with the battle's lines as the side saw them since its last
// decision, and the expert plays instead where that server does not play (doubles, generations 5-8) or when it is not answering.
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {importTeam} from '../src/core.mjs';
import {LEVELS, setNeuralSearch} from '../src/ai.mjs';
import {neuralChoice, postSync} from '../src/neural.mjs';
import {playOut} from '../src/stats.mjs';

const A = 'Garchomp @ Choice Scarf\nAbility: Rough Skin\n- Earthquake\n- Outrage\n- Swords Dance\n- Stone Edge\n\n'
  + 'Rotom-Wash @ Leftovers\nAbility: Levitate\n- Hydro Pump\n- Volt Switch\n- Will-O-Wisp\n- Protect';
const B = 'Heatran @ Leftovers\nAbility: Flash Fire\n- Magma Storm\n- Earth Power\n- Flash Cannon\n- Stealth Rock\n\n'
  + 'Corviknight\nAbility: Pressure\n- Brave Bird\n- Roost\n- U-turn\n- Defog';

function startFake() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [fileURLToPath(new URL('./fixtures/fake-neural-server.mjs', import.meta.url))], {stdio: ['ignore', 'pipe', 'inherit']});
    child.stdout.once('data', (d) => resolve({child, url: `http://127.0.0.1:${String(d).trim()}`}));
    child.once('error', reject);
  });
}

const spec = (format, trace = true) => ({format, seed: [5, 6, 7, 8], trace, p1: {name: 'Net', sets: importTeam(A), ai: {level: 'neural'}},
  p2: {name: 'Exp', sets: importTeam(B), ai: {level: 'normal'}}});

test('neural is a level', () => {
  assert.ok(LEVELS.includes('neural'));
});

test('every decision of the neural side goes to the server, with each line once and in order', async () => {
  const {child, url} = await startFake();
  process.env.SILVER_NEURAL_URL = url;
  setNeuralSearch(neuralChoice);
  try {
    const r = playOut(spec('gen9customgame'));
    assert.ok(r.summary.winner_side || r.turns >= 1);
    const notes = r.notes.filter((n) => n.side === 'p1');
    assert.ok(notes.length >= 3 && notes.every((n) => n.level === 'neural' && n.neural && !n.fallback), JSON.stringify(notes[0]));
    const seen = postSync('/seen', {});
    const mine = Object.values(seen);
    assert.equal(mine.length, 1, 'one session for the battle and side');
    assert.equal(mine[0].calls, notes.length);
    assert.equal(mine[0].starts, 1, 'the start of the battle was sent once');
    assert.equal(mine[0].gen, 9);
    // a generation it does not play: the expert, without asking
    const g7 = playOut(spec('gen7customgame'));
    assert.ok(g7.notes.filter((n) => n.side === 'p1' && n.kind !== 'preview').every((n) => n.level === 'neural' && n.fallback === 'expert' && !n.neural));
    assert.equal(Object.keys(postSync('/seen', {})).length, 1);
  } finally {
    child.kill();
  }
});

test('a server that does not answer leaves the choice to the expert', () => {
  process.env.SILVER_NEURAL_URL = 'http://127.0.0.1:9';
  setNeuralSearch(neuralChoice);
  try {
    const r = playOut(spec('gen9customgame'));
    const notes = r.notes.filter((n) => n.side === 'p1');
    assert.ok(notes.length && notes.every((n) => n.neural_error && (n.kind === 'preview' || n.fallback === 'expert')));
  } finally {
    setNeuralSearch(null);
    delete process.env.SILVER_NEURAL_URL;
  }
});
