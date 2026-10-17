import { inputFrame } from "../../../../engine/src/realtime/sim.mjs";

// The terminal event is not a held input: apply it at its saved tick, including tick zero.
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
  const replay = { byTick, held: [null, null], tick: record.tick || 0,
    forfeit: ["p1", "p2"].includes(record.forfeit) ? record.forfeit : "" };
  while (!battle.ended && battle.t < untilTick) stepReplay(battle, replay);
  finishReplay(battle, replay);
  return replay;
}
