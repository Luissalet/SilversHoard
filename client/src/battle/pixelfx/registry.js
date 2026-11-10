// Every vendored pixelfx effect Silver can play, by id (category/name): the whole upstream catalog (fx/index.js, unchanged from pixelfx
// 0.3.1). The explorer (pages/EfectosPixel.jsx) lists them all; mapping.js picks which ones moves, statuses, weather and terrains play.
import { effects, categories } from "./fx/index.js";

export const EFFECTS = effects;
export const EFFECT_IDS = Object.freeze(Object.keys(effects).sort());
export const CATEGORY_LIST = Object.freeze(categories.map((c) => c.id));

/** Upstream category -> Spanish name (the explorer's filter). */
export const CATEGORY_ES = Object.freeze({
  moves: "Ataques completos", fire: "Fuego", explosions: "Explosiones", water: "Agua", ice: "Hielo", lightning: "Rayo", scifi: "Ciencia ficción",
  melee: "Cuerpo a cuerpo", impacts: "Impactos", projectiles: "Proyectiles", spawn: "Aparición y derrota", arcane: "Arcano", holy: "Luz",
  shadow: "Sombra", status: "Estados", nature: "Naturaleza", weather: "Clima", ui: "Interfaz", pickups: "Objetos", transitions: "Transiciones",
  critters: "Criaturas",
});

/** What an effect is, from its meta: for the explorer, the REST/MCP catalog and the painter (on-body effects need the Pokemon's pixels). */
export function effectInfo(id) {
  const mod = EFFECTS[id];
  if (!mod) return null;
  const m = mod.meta || {};
  const [category, name] = id.split("/");
  const tags = m.tags || [];
  const size = m.size || [128, 128];
  return {
    id, category, name, title: m.name || name, desc: m.desc || "", tags,
    loop: !!m.loop, seconds: m.duration ?? 1, size, origin: m.origin || [size[0] / 2, size[1] / 2],
    // the effect reads the character it plays on (frozen, poisoned, a halo over the head): Silver hands it the Pokemon's own pixels
    on_body: !!mod.act?.onBody || typeof mod.actorAlpha === "function",
    // the act's target, in effect pixels in front of the caster (melee, chained moves): where the blow lands
    reach: mod.act?.target?.x ?? (Array.isArray(mod.act?.targets) ? mod.act.targets[0]?.x ?? 0 : 0),
    directional: tags.includes("directional"),
    screen: size[0] >= 320 && size[1] >= 180,
    palette: Array.isArray(m.options?.palette) ? [...m.options.palette] : null,
    options: Object.keys(m.options || {}),
  };
}
