// Which pixelfx effect a move (or a status, a boost, a heal) plays. Pure data and functions: no DOM, no effect code, no randomness, so the
// plain node tests, the REST/MCP catalog and the painter all read the same table. The effect ids are the keys of ./registry.js.
// The painter draws; nothing here (or in layer.js) writes simulation state.

export const FX_STYLE_KEY = "silver-fx-style";
export const PIXELFX_STYLE = "pixelfx";

/** True when the "animation style" setting (kept in the browser's storage, JSON) is pixelfx. Safe without a browser. */
export function pixelfxStyleOn() {
  try {
    const raw = localStorage.getItem(FX_STYLE_KEY);
    return raw !== null && JSON.parse(raw) === PIXELFX_STYLE;
  } catch {
    return false;
  }
}

export const TYPES = Object.freeze(["Normal", "Fire", "Water", "Electric", "Grass", "Ice", "Fighting", "Poison", "Ground", "Flying",
  "Psychic", "Bug", "Rock", "Ghost", "Dragon", "Dark", "Steel", "Fairy"]);
export const CATEGORIES = Object.freeze(["Physical", "Special", "Status"]);
export const SHAPES = Object.freeze(["strike", "dash", "shot", "beam", "wave", "cone", "burst", "drop", "self", "field"]);
export const ROLES = Object.freeze(["impact", "projectile", "beam", "area", "drop", "self"]);

export const TYPE_COLORS = Object.freeze({
  Normal: "#c8c7a0", Fire: "#ee8130", Water: "#6390f0", Electric: "#f7d02c", Grass: "#7ac74c", Ice: "#96d9d6", Fighting: "#c22e28",
  Poison: "#a33ea1", Ground: "#e2bf65", Flying: "#a98ff3", Psychic: "#f95587", Bug: "#a6b91a", Rock: "#b6a136", Ghost: "#735797",
  Dragon: "#6f35fc", Dark: "#705746", Steel: "#b7b7ce", Fairy: "#d685ad",
});

const channel = (hex, i) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
const mix = (a, b, k) => "#" + [0, 1, 2].map((i) => Math.round(channel(a, i) * (1 - k) + channel(b, i) * k).toString(16).padStart(2, "0")).join("");

/** A dark-to-bright ramp (6 steps) around a colour: what an effect takes as its `palette` option. */
export function ramp(base) {
  return [mix(base, "#000000", 0.78), mix(base, "#000000", 0.5), mix(base, "#000000", 0.2), base, mix(base, "#ffffff", 0.38), mix(base, "#ffffff", 0.8)];
}
export const typeRamp = (type) => ramp(TYPE_COLORS[type] || TYPE_COLORS.Normal);

// A trailing "~" means "recolour with the type's ramp"; without it the effect keeps its own colours (fire is already fire).
// Order: projectile, impact on the target, beam (and cone), burst around a point, drop from the sky, effect on the user.
const row = (projectile, impact, beam, area, drop, self) => ({ projectile, impact, beam, area, drop, self });
export const TYPE_TABLE = Object.freeze({
  Normal: row("projectiles/energy-disc~", "impacts/blunt-hit", "projectiles/laser-bolt~", "explosions/cartoon-pow", "impacts/ground-slam", "arcane/rune-circle~"),
  Fire: row("fire/fireball", "explosions/small-explosion", "fire/flamethrower", "explosions/big-explosion", "fire/meteor", "fire/spirit-flame"),
  Water: row("water/water-orb", "water/splash", "water/water-jet", "water/wave-crash", "water/geyser", "water/bubbles"),
  Electric: row("lightning/ball-lightning", "lightning/zap-hit", "lightning/spark-arc", "explosions/plasma-explosion~", "lightning/lightning-strike", "lightning/plasma-ball"),
  Grass: row("projectiles/magic-missile~", "nature/thorns", "nature/vine-whip", "nature/spore-burst", "nature/earth-spike", "nature/healing-bloom"),
  Ice: row("ice/ice-lance", "ice/ice-shatter", "ice/frost-breath", "ice/snowflake-burst", "ice/icicle-fall", "ice/ice-crystal"),
  Fighting: row("projectiles/energy-disc~", "impacts/crit-hit~", "projectiles/laser-bolt~", "impacts/ground-slam", "impacts/ground-slam", "arcane/mana-burst~"),
  Poison: row("projectiles/plasma-shot~", "nature/acid-splash~", "water/water-jet~", "nature/poison-cloud", "nature/toxic-puddle", "nature/poison-cloud"),
  Ground: row("nature/boulder", "explosions/dirt-explosion", "projectiles/laser-bolt~", "nature/quake", "nature/earth-spike", "explosions/dirt-explosion"),
  Flying: row("nature/tornado~", "impacts/hit-spark~", "water/water-jet~", "nature/tornado~", "holy/feather-burst", "holy/feather-burst"),
  Psychic: row("arcane/arcane-orb~", "arcane/mana-burst~", "projectiles/laser-bolt~", "arcane/magic-circle-cast~", "arcane/star-fall~", "arcane/rune-circle~"),
  Bug: row("projectiles/magic-missile~", "impacts/hit-spark~", "nature/vine-whip~", "nature/spore-burst~", "nature/spore-burst~", "nature/spore-burst~"),
  Rock: row("nature/boulder", "explosions/dirt-explosion", "projectiles/laser-bolt~", "nature/quake", "nature/earth-spike", "impacts/ground-slam"),
  Ghost: row("shadow/void-orb", "shadow/shadow-tendrils", "shadow/soul-drain", "shadow/dark-explosion~", "shadow/grasping-hands", "shadow/shadow-flames~"),
  Dragon: row("arcane/arcane-orb~", "explosions/plasma-explosion~", "fire/flamethrower~", "explosions/big-explosion~", "fire/meteor~", "arcane/mana-burst~"),
  Dark: row("shadow/void-orb", "shadow/dark-explosion", "shadow/soul-drain", "shadow/black-hole", "shadow/grasping-hands", "shadow/shadow-flames"),
  Steel: row("projectiles/energy-disc~", "impacts/parry", "projectiles/laser-bolt~", "impacts/ground-slam", "impacts/ground-slam", "arcane/rune-circle~"),
  Fairy: row("arcane/arcane-orb~", "holy/feather-burst~", "projectiles/laser-bolt~", "holy/heal-aoe~", "holy/smite~", "holy/heal-aoe~"),
});

/** How long each role stays on screen at most (seconds; a one-shot with a long tail is stopped, so it fades out in 0.3 s), and the height
 * above the ground (meters) of where it is drawn: the Pokemon's middle for hits, its feet for the rest. */
export const ROLE_INFO = Object.freeze({
  impact: { hold: 1.0, z: 0.45 },
  projectile: { hold: 6, z: 0.6 },
  beam: { hold: 0.9, z: 0.6 },
  area: { hold: 1.3, z: 0 },
  drop: { hold: 1.4, z: 0 },
  self: { hold: 1.3, z: 0 },
});

/** What a move does on screen, from its shape when it has one (strike, shot, burst...) and from its category when it does not. */
export function roleOf(category, shape) {
  switch (shape) {
    case "strike": case "dash": return "impact";
    case "shot": case "wave": return "projectile";
    case "beam": case "cone": return "beam";
    case "burst": case "field": return "area";
    case "drop": return "drop";
    case "self": return "self";
    default: break;
  }
  if (category === "Physical") return "impact";
  if (category === "Special") return "projectile";
  return "self";
}

const split = (cell) => ({ id: cell.replace(/~$/, ""), tint: cell.endsWith("~") });

/** The effect for a move: {role, id, tint, hold, z}. Every type, category and shape gives one; unknown types play Normal's. */
export function pickEffect({ type, category, shape } = {}) {
  const role = roleOf(category, shape);
  const t = TYPE_TABLE[type] || TYPE_TABLE.Normal;
  const { id, tint } = split(t[role]);
  const info = ROLE_INFO[role];
  return { role, id, tint, hold: info.hold, z: info.z };
}

/** The effect of a hit on the target (a second, bigger one rides on critical and super effective hits). */
export function hitEffects({ type, crit = false, eff = 1 } = {}) {
  const t = TYPE_TABLE[type] || TYPE_TABLE.Normal;
  const list = [{ ...split(t.impact), role: "impact", hold: ROLE_INFO.impact.hold, z: ROLE_INFO.impact.z }];
  if (crit || eff > 1) list.push({ id: "impacts/crit-hit", tint: false, role: "impact", hold: 0.9, z: ROLE_INFO.impact.z });
  return list;
}

export const STATUS_TABLE = Object.freeze({
  brn: "fire/torch", par: "lightning/spark-arc", psn: "nature/toxic-puddle~", tox: "nature/toxic-puddle~", frz: "ice/ice-crystal", slp: "arcane/rune-circle~",
});
const STATUS_TYPE = Object.freeze({ brn: "Fire", par: "Electric", psn: "Poison", tox: "Poison", frz: "Ice", slp: "Psychic" });

/** The effect of a status condition falling on a Pokemon, or null for a status that has none. */
export function statusEffect(status) {
  const cell = STATUS_TABLE[status];
  if (!cell) return null;
  return { ...split(cell), type: STATUS_TYPE[status], role: "self", hold: 1.2, z: 0 };
}
/** Stat boost (up) or drop (down), heal and faint. */
export function eventEffect(kind, up = true) {
  if (kind === "boost") return up ? { id: "arcane/mana-burst", tint: true, color: "#ffb15c", role: "self", hold: 1.0, z: 0 }
    : { id: "ice/snowflake-burst", tint: false, role: "self", hold: 1.0, z: 0 };
  if (kind === "heal") return { id: "holy/heal-aoe", tint: false, role: "self", hold: 1.2, z: 0 };
  if (kind === "faint") return { id: "explosions/smoke-bomb", tint: false, role: "self", hold: 0.9, z: 0 };
  return null;
}

/** Every effect id the mapping can ask for (the registry must have them all). */
export function mappedIds() {
  const ids = new Set();
  for (const t of Object.values(TYPE_TABLE)) for (const c of Object.values(t)) ids.add(split(c).id);
  for (const c of Object.values(STATUS_TABLE)) ids.add(split(c).id);
  for (const k of [["boost", true], ["boost", false], ["heal"], ["faint"]]) ids.add(eventEffect(...k).id);
  ids.add("impacts/crit-hit");
  return [...ids].sort();
}

/** A 32-bit seed from numbers and strings (FNV-1a): the same battle, event and order give the same effect, in a replay or a video too. */
export function fxSeed(...parts) {
  let h = 0x811c9dc5;
  for (const part of parts) {
    const s = String(part ?? "");
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    h ^= 0x7c; h = Math.imul(h, 0x01000193);
  }
  return h >>> 0 || 1;
}
