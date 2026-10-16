// A page left open across a rebuild asks for chunk names that are gone: it reloads once instead of going blank, and a second
// failure within a minute (or with storage blocked) is shown as the error it is, so it never loops.
import test from 'node:test';
import assert from 'node:assert/strict';
import {lazyChunk} from '../../client/src/lazy.js';

const factory = (lazy) => lazy._payload._result;   // React.lazy keeps the loader it was given until it is first rendered

test('a missing chunk reloads the page once a minute at most', async () => {
  const store = new Map();
  let reloads = 0;
  globalThis.sessionStorage = {getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v))};
  globalThis.window = {location: {reload: () => { reloads += 1; }}};
  const gone = () => Promise.reject(new TypeError('Failed to fetch dynamically imported module'));
  const pending = factory(lazyChunk(gone))();
  const first = await Promise.race([pending.then(() => 'settled', () => 'settled'), new Promise((r) => setTimeout(() => r('waiting'), 20))]);
  assert.equal(first, 'waiting');   // the page is reloading: nothing renders meanwhile
  assert.equal(reloads, 1);
  await assert.rejects(factory(lazyChunk(gone))(), /dynamically imported/);
  assert.equal(reloads, 1);
  // a module that loads is passed on untouched
  const mod = {default: () => null};
  assert.equal(await factory(lazyChunk(() => Promise.resolve(mod)))(), mod);
  // storage blocked: no reload loop, the error shows
  globalThis.sessionStorage = {getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); }};
  await assert.rejects(factory(lazyChunk(gone))(), /dynamically imported/);
  assert.equal(reloads, 1);
  delete globalThis.sessionStorage;
  delete globalThis.window;
});
