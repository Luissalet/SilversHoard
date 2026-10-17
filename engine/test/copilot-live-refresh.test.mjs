import test from 'node:test';
import assert from 'node:assert/strict';
import { installCopilot, onCopilotRefresh, mergeDraftFields } from '../../client/src/copilot-context.js';

test('completed tool notifications coalesce, refresh before turn end, and isolate failures', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const host = new EventTarget(); installCopilot(host);
  let refreshes = 0;
  const stopBad = onCopilotRefresh(() => { throw new Error('offline view'); });
  const stop = onCopilotRefresh(() => { refreshes++; });
  host.dispatchEvent(new CustomEvent('hoard:copilot-change', { detail: { type: 'tool_output' } }));
  host.hoardCopilot.onChange({ type: 'tool_output' });
  assert.equal(refreshes, 0);
  t.mock.timers.tick(250); assert.equal(refreshes, 1);
  host.hoardCopilot.onTurnEnd();t.mock.timers.tick(250);assert.equal(refreshes, 2);
  stop();stopBad();host.hoardCopilot.onChange();t.mock.timers.tick(250);assert.equal(refreshes, 2);
});

test('saved updates reach untouched fields while unfinished local fields stay', () => {
  const old = { name: 'Before', notes: '', title: 'Old title' };
  const draft = { ...old, notes: 'Unfinished local note' };
  assert.deepEqual(mergeDraftFields(draft, old, { name: 'After', notes: 'Remote note', title: 'New title' }),
    { name: 'After', notes: 'Unfinished local note', title: 'New title' });
  assert.deepEqual(mergeDraftFields(null, null, old),old);
});

test('new local dialogue fields survive, untouched removed fields follow saved data', () => {
  assert.deepEqual(mergeDraftFields({ intro: 'saved', win: 'typed here' }, { intro: 'saved' }, {}), { win: 'typed here' });
});
