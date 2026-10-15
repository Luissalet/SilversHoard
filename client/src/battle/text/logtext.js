// The battle log's official wording: the battle simulator's own messages in Spanish (Spain) or English (battle-text.gen.js), filled in
// by its client's text parser (text-parser.gen.js) with our names for moves, abilities and items. protocol.js asks for it on the lines
// where the simulator has a message of its own (the effect of a move, an ability or an item, the field, the weather, why a Pokémon
// can't move…) and keeps its own sentences for the rest and whenever there is no translation.
import { nameOf } from "../dex.js";
import { BattleTextParser } from "./text-parser.gen.js";
import { BattleText } from "./battle-text.gen.js";
import { Dex } from "./dex-shim.js";

/** Lines whose text comes from the official messages when there is one. */
export const OFFICIAL = new Set(["move", "faint", "-boost", "-unboost", "-activate", "-start", "-end", "-fieldstart", "-fieldend", "-fieldactivate", "-sidestart", "-sideend",
  "-swapsideconditions", "-singleturn", "-singlemove", "-item", "-enditem", "-prepare", "cant", "-immune", "-fail", "-block", "-weather",
  "-ability", "-endability", "-transform", "-formechange", "-clearallboost", "-clearboost", "-clearnegativeboost", "-clearpositiveboost",
  "-copyboost", "-invertboost", "-swapboost", "-setboost", "-status", "-curestatus", "-cureteam", "-notarget", "-miss", "-ohko",
  "-hitcount", "-nothing", "-zbroken", "-center", "-combine", "-waiting", "-mustrecharge", "-primal", "-burst", "-mega", "-zpower",
  "-crit", "-supereffective", "-resisted", "-sethp", "detailschange"]);
// damage and healing: the official sentence only when something else caused it (a berry, Leftovers, poison, hazards, weather…)
const ONLY_FROM = new Set(["-damage", "-heal"]);

const TABLE_KIND = { Moves: "move", Items: "item", Abilities: "ability" };

class SilverTextParser extends BattleTextParser {
  /** Only the language asked for: a message with no Spanish translation is left to protocol.js rather than shown in English. */
  textField(table, id, field) {
    const lang = BattleText[this.language] ? this.language : "en";
    const entry = BattleText[lang]?.[table]?.[id];
    let value = entry?.[field];
    for (let i = Dex.gen - 1; i >= this.gen; i--) {
      const g = entry?.[`gen${i}`];
      if (g && typeof g === "object" && g[field]) value = g[field];
    }
    if (!value && lang !== "en" && field === "name") value = BattleText.en?.[table]?.[id]?.name;
    return typeof value === "string" ? value : "";
  }

  /** Moves, abilities and items by the names the rest of the screen uses (PokeAPI's Spanish names). */
  textName(table, name) {
    if (!name) return "";
    const kind = TABLE_KIND[table];
    const own = kind ? nameOf(kind, String(name).trim(), this.language === "en" ? "en" : "es") : "";
    return own || super.textName(table, name);
  }
}

const PARSERS = new WeakMap();

function parserFor(state, lang, me) {
  const language = lang === "en" ? "en" : "es";
  let p = PARSERS.get(state);
  if (!p || p.language !== language || p.perspective !== me) {
    Dex.text.language = language;
    p = new SilverTextParser(me, language);
    p.language = language;
    PARSERS.set(state, p);
  }
  return p;
}

const CAP = /^([¡¿(\[]*)([a-záéíóúñ])/;

/** The parser's output as one line of our log: no markdown, no indent, the first letter capitalized, "de el" / "a el" contracted. */
export function tidy(text, lang) {
  let t = String(text || "").split("\n").map((s) => s.trim()).filter(Boolean).join(" ").replace(/\*\*/g, "");
  if (!t) return "";
  if (lang !== "en") {
    t = t.replace(/\b([aA]) el\b/g, "$1l").replace(/\b([dD])e el\b/g, "$1el");
    // each sentence starts with a capital ("¡el Dragonite rival…" → "¡El Dragonite rival…")
    t = t.split(/(?<=[!.?…\]]\s)/).map((s) => s.replace(CAP, (_, a, b) => a + b.toUpperCase())).join("");
  } else {
    t = t.replace(CAP, (_, a, b) => a + b.toUpperCase());
  }
  return t;
}

/**
 * Feeds one protocol line to the battle's parser (it follows players and generation) and returns the official sentence for it, or ""
 * when that line keeps protocol.js's own text. Never throws: a line it can't read leaves the log as it was.
 */
export function officialText(state, line, { lang = "es", me = "p1" } = {}) {
  if (!line || line[0] !== "|") return "";
  try {
    const p = parserFor(state, lang, me);
    const { args, kwArgs } = BattleTextParser.parseBattleLine(line);
    const cmd = args[0];
    const up = BattleTextParser.upgradeArgs({ args, kwArgs });
    const text = p.parseArgs(up.args, up.kwArgs, true) || "";
    if (cmd === "player" || cmd === "gen" || cmd === "turn") return "";
    if (!(OFFICIAL.has(cmd) || (ONLY_FROM.has(cmd) && kwArgs.from))) return "";
    return tidy(text, lang);
  } catch {
    return "";
  }
}
