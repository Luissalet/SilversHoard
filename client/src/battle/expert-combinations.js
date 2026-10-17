// Supplement the displayed log only after the saved public turn boundary was applied.
export function withCombinations(log, combinations, applied, textOf) {
  const seen = new Set();
  const additions = [];
  for (const pair of combinations || []) {
    if (!Number.isInteger(pair.end_index) || pair.end_index < 0 || pair.end_index >= applied) continue;
    const key = `${pair.turn}:${pair.side}:${pair.end_index}`;
    if (seen.has(key)) continue;
    seen.add(key);
    additions.push({i: pair.end_index - 0.5, kind: 'combo', text: textOf(pair)});
  }
  return additions.length ? [...log, ...additions].sort((a, b) => a.i - b.i) : log;
}

export function combinationValues(pair, names = {}, moveName = (name) => name) {
  return {n: pair.turn, side: names[pair.side] || pair.side,
    moves: pair.actions.map((action) => `${action.actor}: ${moveName(action.move)}`).join(' + ')};
}
