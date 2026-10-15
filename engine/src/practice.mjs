// Rebuild only the decisions before a turn, never the opponent's later choice or the final result.
import {Battle} from '@pkmn/sim';
import {EngineError} from './core.mjs';

export function practiceSnapshot(input, turn, side) {
  if (!['p1', 'p2'].includes(side) || !Number.isInteger(turn) || turn < 1) {
    throw new EngineError('invalid', 'Choose a turn from 1 onward and side p1 or p2.');
  }
  if (!Array.isArray(input)) throw new EngineError('invalid', 'This replay has no decision record.');
  const read = (prefix) => {
    const line = input.find((l) => typeof l === 'string' && l.startsWith(prefix));
    if (!line) throw new EngineError('invalid', 'The decision record is incomplete.');
    return JSON.parse(line.slice(prefix.length));
  };
  const start = read('>start ');
  const b = new Battle({...start, p1: read('>player p1 '), p2: read('>player p2 ')});
  b.send = () => {};
  const ready = () => {
    const req = b[side].activeRequest;
    return !b.ended && b.turn === turn && req?.active && !req.wait && !b[side].isChoiceDone();
  };
  for (const line of input) {
    if (ready()) break;
    if (!/^>p[12] /.test(line)) continue;
    if (!b.choose(line.slice(1, 3), line.slice(4))) {
      throw new EngineError('invalid', 'A recorded decision cannot be replayed.');
    }
  }
  if (!ready()) throw new EngineError('invalid', 'There is no move decision for that side at this turn.');
  // Recorded inputs are committed in pairs. A side's pending choice must never carry into the exercise.
  for (const s of b.sides) s.clearChoice();
  return {snapshot: JSON.parse(JSON.stringify(b.toJSON())), input: b.inputLog.slice(), seed: start.seed, turn: b.turn,
    format: b.format.id, seats: Object.fromEntries(b.sides.map(s => [s.id, {name:s.name, sets:structuredClone(s.team)}]))};
}
