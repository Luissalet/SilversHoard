// Stat points, the way Pokémon Champions trains Pokémon: 66 points per Pokémon, at most 32 in one stat, each point one more
// stat point at level 50. They are stored as EVs so every format and the engine keep working: the first point of a stat is 4 EVs
// and each further point 8 more (Pokémon HOME's rule), so 32 points are 252 EVs. Browser-safe: the team builder uses it too.
export const SP_TOTAL = 66;
export const SP_MAX = 32;
export const STAT_IDS = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];

/** EVs that give `sp` stat points (0-32). */
export function evFromSp(sp) {
  const s = Math.max(0, Math.min(SP_MAX, Math.floor(Number(sp) || 0)));
  return s ? 4 + 8 * (s - 1) : 0;
}

/** Stat points that `ev` EVs are worth (what HOME gives when a Pokémon moves over). */
export function spFromEv(ev) {
  const e = Math.max(0, Math.floor(Number(ev) || 0));
  return e < 4 ? 0 : Math.min(SP_MAX, 1 + Math.floor((e - 4) / 8));
}

/** {hp, atk, ...} EVs -> {hp, atk, ...} points, plus their total. */
export function pointsFromEvs(evs = {}) {
  const points = {};
  let total = 0;
  for (const k of STAT_IDS) { points[k] = spFromEv(evs[k]); total += points[k]; }
  return {points, total};
}

/** {hp, atk, ...} points -> EVs. Throws when the spread breaks the 66 / 32 limits (unless `clamp`, which trims it). */
export function evsFromPoints(points = {}, {clamp = false} = {}) {
  const out = {};
  let left = SP_TOTAL;
  for (const k of STAT_IDS) {
    let s = Math.max(0, Math.floor(Number(points[k]) || 0));
    if (s > SP_MAX) {
      if (!clamp) throw new RangeError(`${k}: at most ${SP_MAX} points in one stat`);
      s = SP_MAX;
    }
    if (s > left) {
      if (!clamp) throw new RangeError(`at most ${SP_TOTAL} points in all`);
      s = left;
    }
    left -= s;
    out[k] = evFromSp(s);
  }
  return out;
}

/** A stat at `level` with the main-series formula (generation 3 onwards). `nature` is 1.1, 1 or 0.9. */
export function calcStat(stat, base, {level = 50, ev = 0, iv = 31, nature = 1} = {}) {
  const core = Math.floor(((2 * base + iv + Math.floor(ev / 4)) * level) / 100);
  if (stat === 'hp') return base === 1 ? 1 : core + level + 10;
  return Math.floor((core + 5) * nature);
}
