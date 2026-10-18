// Shared replay cursor: presentation and read-only native inspection rebuild the same saved inputs.
import {inputFrame, RtBattle, TPS} from './sim.mjs';

function finishReplay(battle, replay) {
  if (!battle.ended && replay.forfeit && battle.t >= replay.tick) battle.forfeit(replay.forfeit);
}

export function stepReplay(battle, replay) {
  finishReplay(battle, replay);
  if (!battle.ended) battle.step(inputFrame(battle, replay.byTick.get(battle.t + 1) || [], replay.held));
  finishReplay(battle, replay);
}

export function createReplay(battle, record, untilTick = 0) {
  const byTick = new Map();
  for (const row of record.inputs || []) {
    if (!byTick.has(row[0])) byTick.set(row[0], []);
    byTick.get(row[0]).push(row);
  }
  const replay = {byTick, held: [null, null], tick: record.tick || 0,
    forfeit: ['p1', 'p2'].includes(record.forfeit) ? record.forfeit : ''};
  while (!battle.ended && battle.t < untilTick) stepReplay(battle, replay);
  finishReplay(battle, replay);
  return replay;
}

export function replayEndTick(record, seconds = 0) {
  if (record.tick > 0 || record.forfeit) return Math.max(0, Math.floor(record.tick || 0));
  return Math.max(0, Math.round(seconds * TPS));
}

export function inspectReplay(spec, record, tick = 0, seconds = 0) {
  const end = replayEndTick(record, seconds);
  const battle = new RtBattle(spec);
  createReplay(battle, record, Math.max(0, Math.min(end, Math.floor(tick))));
  return {tick: battle.t, seconds: battle.t / TPS, end_tick: end, view: battle.view()};
}
