// Names, types and sprites for the battle screen (shared by the app and the playable page). Moves, abilities, items, natures and
// types read in Spanish when the screen is in Spanish (PokeAPI's Spanish names); Pokémon keep their names.
import NAMES_ES from "./names-es.js";

export const toID = (text) => String(text ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");

export const TYPE_COLORS = {
  Normal: "#a8a77a", Fire: "#ee8130", Water: "#6390f0", Electric: "#f7d02c", Grass: "#7ac74c", Ice: "#96d9d6", Fighting: "#c22e28",
  Poison: "#a33ea1", Ground: "#e2bf65", Flying: "#a98ff3", Psychic: "#f95587", Bug: "#a6b91a", Rock: "#b6a136", Ghost: "#735797",
  Dragon: "#6f35fc", Dark: "#705746", Steel: "#b7b7ce", Fairy: "#d685ad", Stellar: "#44a5d8", "???": "#68a090",
};

const KIND = { move: "moves", moves: "moves", ability: "abilities", abilities: "abilities", item: "items", items: "items", nature: "natures", type: "types" };

/** The name to show for a move, ability, item, nature or type. */
export function nameOf(kind, english, lang) {
  if (!english) return "";
  if (lang !== "es") return english;
  const table = NAMES_ES[KIND[kind] || kind] || {};
  return table[toID(english)] || english;
}

export const typeName = (type, lang) => nameOf("type", type, lang);

// Species whose own name has a hyphen (the rest of the hyphenated names are a species plus a forme).
const HYPHENATED = ["ho-oh", "porygon-z", "jangmo-o", "hakamo-o", "kommo-o", "ting-lu", "chien-pao", "wo-chien", "chi-yu", "nidoran-f", "nidoran-m"];

/** Showdown's sprite id for a species name as the protocol writes it ("Rotom-Wash" -> "rotom-wash", "Mr. Mime" -> "mrmime"). */
export function spriteId(species) {
  const s = String(species || "").trim().toLowerCase();
  if (!s) return "";
  const hyph = HYPHENATED.find((h) => s === h || s.startsWith(`${h}-`));
  if (hyph) {
    const rest = s.slice(hyph.length + 1);
    return toID(hyph) + (rest ? `-${toID(rest)}` : "");
  }
  const i = s.indexOf("-");
  if (i < 0) return toID(s);
  return toID(s.slice(0, i)) + "-" + toID(s.slice(i + 1));
}

/** Where pictures come from: the app's cached sprite routes, or the Showdown sprite server straight (the playable page). */
export function makeSprites({ base = "", server = "", set = "gen5ani" } = {}) {
  const SETS = { gen5: ["gen5", "png"], gen5ani: ["gen5ani", "gif"], ani: ["ani", "gif"], home: ["home", "png"], dex: ["dex", "png"] };
  const pokemon = (species, { back = false, shiny = false, spriteid } = {}) => {
    const id = spriteid || spriteId(species);
    if (!server) return `${base}/api/sprites/pokemon/${id}?back=${back ? 1 : 0}&shiny=${shiny ? 1 : 0}${set ? `&set=${set}` : ""}`;
    const [folder, ext] = SETS[set] || SETS.gen5;
    const dir = folder + (back && !["home", "dex"].includes(set) ? "-back" : "") + (shiny && !["home", "dex"].includes(set) ? "-shiny" : "");
    return `${server}/${dir}/${id}.${ext}`;
  };
  const fallback = (species, { back = false, spriteid } = {}) => {
    const id = spriteid || spriteId(species);
    return server ? `${server}/gen5${back ? "-back" : ""}/${id}.png` : `${base}/api/sprites/pokemon/${id}?back=${back ? 1 : 0}&set=gen5`;
  };
  const trainer = (avatar) => {
    if (!avatar) return "";
    if (typeof avatar === "object") {
      if (avatar.kind === "image" && avatar.data) return `data:${avatar.mime || "image/png"};base64,${avatar.data}`;
      if (avatar.kind === "showdown" && avatar.name) return server ? `${server}/trainers/${avatar.name}.png` : `${base}/api/sprites/trainers/${avatar.name}.png`;
      return "";
    }
    if (avatar.startsWith("sd:")) return server ? `${server}/trainers/${avatar.slice(3)}.png` : `${base}/api/sprites/trainers/${avatar.slice(3)}.png`;
    if (avatar.startsWith("file:")) return `${base}/api/avatars/${avatar.slice(5)}`;
    return avatar;
  };
  const pixelated = set === "gen5" || set === "gen5ani";
  // how much the pictures of each set are enlarged on the field: [own side (back), opposing side (front)]
  const SCALE = { gen5: [1.75, 1.4], gen5ani: [1.75, 1.4], ani: [1.05, 0.9], home: [0.62, 0.5], dex: [1.1, 0.9] };
  return { pokemon, fallback, trainer, pixelated, scale: SCALE[set] || SCALE.gen5 };
}

export const STAT_NAMES = {
  atk: ["Ataque", "Attack"], def: ["Defensa", "Defense"], spa: ["Ataque Especial", "Sp. Atk"], spd: ["Defensa Especial", "Sp. Def"],
  spe: ["Velocidad", "Speed"], accuracy: ["Precisión", "accuracy"], evasion: ["Evasión", "evasiveness"], hp: ["PS", "HP"],
};
export const STAT_SHORT = { hp: ["PS", "HP"], atk: ["Atq", "Atk"], def: ["Def", "Def"], spa: ["AtE", "SpA"], spd: ["DfE", "SpD"], spe: ["Vel", "Spe"],
  accuracy: ["Prec", "Acc"], evasion: ["Eva", "Eva"] };
export const STATUS_NAMES = {
  brn: ["quemadura", "burn"], par: ["parálisis", "paralysis"], psn: ["envenenamiento", "poison"], tox: ["envenenamiento grave", "bad poison"],
  slp: ["sueño", "sleep"], frz: ["congelación", "freeze"],
};
export const STATUS_SHORT = { brn: "QUE", par: "PAR", psn: "ENV", tox: "TOX", slp: "DOR", frz: "CON" };
export const STATUS_SHORT_EN = { brn: "BRN", par: "PAR", psn: "PSN", tox: "TOX", slp: "SLP", frz: "FRZ" };
export const STATUS_COLORS = { brn: "#e8743b", par: "#d9b42b", psn: "#a352c8", tox: "#8a3cb4", slp: "#8c8c9a", frz: "#5ec8e0" };
export const L = (pair, lang) => (Array.isArray(pair) ? pair[lang === "en" ? 1 : 0] : pair);
