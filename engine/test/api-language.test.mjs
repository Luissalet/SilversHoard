import test from 'node:test';
import assert from 'node:assert/strict';
import { api } from '../../client/src/api.js';

test('new battle calls capture the selected UI language even without storage', async () => {
  const oldWindow = globalThis.window;
  const oldFetch = globalThis.fetch;
  const bodies = [];
  globalThis.window = {location: {origin: 'http://127.0.0.1:5230'}};
  globalThis.fetch = async (url, options) => {
    bodies.push(JSON.parse(options.body));
    return {status: 200, ok: true, text: async () => '{}'};
  };
  try {
    api.setLanguage('es');
    for (const name of ['battle_start', 'challenge_start', 'battle_practice', 'exercise_start']) {
      await api.call(name, {id: 'fixture'});
      assert.equal(bodies.at(-1).arguments.lang, 'es');
    }
    await api.call('battle_start', {lang: 'en'});
    assert.equal(bodies.at(-1).arguments.lang, 'en', 'explicit caller choice wins');
    api.setLanguage('en');
    await api.call('battle_start', {});
    assert.equal(bodies.at(-1).arguments.lang, 'en');
    await api.call('trainer_get', {id: 'fixture'});
    assert.deepEqual(bodies.at(-1).arguments, {id: 'fixture'}, 'other calls keep their arguments');
  } finally {
    globalThis.window = oldWindow;
    globalThis.fetch = oldFetch;
  }
});
