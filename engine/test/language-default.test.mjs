import test from 'node:test';
import assert from 'node:assert/strict';
import {initialLang, makeT} from '../../client/src/i18n.js';

test('English is the default when no valid language was chosen, including blocked storage', () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  try {
    for (const value of [null, '', 'fr']) {
      Object.defineProperty(globalThis, 'localStorage', {configurable: true, value: {getItem: () => value}});
      assert.equal(initialLang(), 'en');
    }
    Object.defineProperty(globalThis, 'localStorage', {configurable: true, get() {throw new Error('blocked');}});
    assert.equal(initialLang(), 'en');
    assert.equal(makeT(initialLang())('choose_trainer'), 'Choose a trainer…');
  } finally {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
    else delete globalThis.localStorage;
  }
});

test('an explicitly selected Spanish or English language survives reopening', () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  try {
    for (const value of ['es', 'en']) {
      Object.defineProperty(globalThis, 'localStorage', {configurable: true, value: {getItem: () => value}});
      assert.equal(initialLang(), value);
    }
  } finally {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
    else delete globalThis.localStorage;
  }
});
