// Renderer-only timings. The supplied sheet has 22 columns and 32 rows of 64px cells.
// The first three columns are the Poké Ball's rotation views. Never advance battle time here.
const clamp = (n, low, high) => Math.max(low, Math.min(high, n));
export function ballFrame(age, opening = false, reduced = false) {
  if (reduced) return { column: 2, row: 3, opacity: opening ? 0 : 1 };
  const k = clamp(age, 0, 1);
  return opening ? { column: 2, row: 5 + Math.min(9, Math.floor(k * 10)), opacity: 1 - Math.max(0, (k - .75) * 4) }
    : { column: Math.floor(k * 12) % 3, row: [1, 2, 3, 4][Math.floor(k * 16) % 4], opacity: 1 };
}

export function ballFlight(progress, reduced = false) {
  const k = clamp(progress, 0, 1);
  return { x: k, height: reduced ? 0 : 4 * k * (1 - k), rotation: reduced ? 0 : k * Math.PI * 4 };
}
