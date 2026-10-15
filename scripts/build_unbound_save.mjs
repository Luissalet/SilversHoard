// Builds silvers_hoard/presets/unbound_save.json.gz: what the save importer needs to read a Pokémon Unbound 2.1.1.1 party and write it
// as Showdown sets. The id tables come from PUSE (github.com/Zannael/PUSE, MIT; read from the game's ROM); the ROM keeps names cut to
// a few characters ("Spect Thief", "Nature's Mad"), so each one is matched here to the Showdown name it stands for.
//   node scripts/build_unbound_save.mjs <PUSE checkout>/backend/data
import { readFileSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Dex } from "@pkmn/sim";

const src = process.argv[2];
if (!src) { console.error("usage: node scripts/build_unbound_save.mjs <PUSE>/backend/data"); process.exit(1); }
const dex = Dex.forGen(9);
const id = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, "");
const table = (file) => {
  const out = {};
  for (const line of readFileSync(join(src, file), "utf8").split(/\r?\n/)) {
    const m = line.match(/^(\d+):(.*)$/);
    if (m && m[2].trim() && m[2].trim() !== "NONE") out[m[1]] = m[2].trim();
  }
  return out;
};

// Names the ROM shortens past recognition, or calls differently.
const MOVE_FIX = {
  "Bad Tantrum": "Stomping Tantrum", "Teary Look": "Tearful Look", "Spect Thief": "Spectral Thief", "Nature's Mad": "Nature's Madness",
  "Revel Dance": "Revelation Dance", "Spirit Lock": "Spirit Shackle", "Sparkle Aria": "Sparkling Aria", "Psychic Fang": "Psychic Fangs",
  SmellingSalt: "Smelling Salts", "Doll Eyes": "Baby-Doll Eyes", "Dazzle Gleam": "Dazzling Gleam", "Disarm Cry": "Disarming Voice",
  "Flower Guard": "Flower Shield", "Petal Storm": "Petal Blizzard", "Space Hole": "Hyperspace Hole", "Space Fury": "Hyperspace Fury",
  "Cliff Blades": "Precipice Blades", "Steam Pump": "Steam Eruption", "Water Star": "Water Shuriken", "Power-Up Hit": "Power-Up Punch",
  "1000 Arrows": "Thousand Arrows", "1000 Waves": "Thousand Waves", "Draco Hammer": "Dragon Hammer", "First Press": "First Impression",
  HiHorsepower: "High Horsepower", "Geist Beam": "Moongeist Beam", "Sunsteel Ram": "Sunsteel Strike", GrassTerrain: "Grassy Terrain",
  "Crafty Guard": "Crafty Shield", TrickoTreat: "Trick-or-Treat", "Woods Curse": "Forest's Curse", "Double Iron": "Double Iron Bash",
  "Giant Blade": "Behemoth Blade", "Giant Bash": "Behemoth Bash", "Weird Steam": "Strange Steam", "False Yield": "False Surrender",
  "Meteor Rush": "Meteor Assault", MistyExplode: "Misty Explosion", "Jealous Burn": "Burning Jealousy", "Corrode Gas": "Corrosive Gas",
  SurgeStrikes: "Surging Strikes", "Freeze Glare": "Freezing Glare", "Astral Storm": "Astral Barrage", PsyshieldRam: "Psyshield Bash",
  InfernalRage: "Infernal Parade", "Endless Edge": "Ceaseless Edge", BleakiceWind: "Bleakwind Storm", WildboltWind: "Wildbolt Storm",
  SandsearWind: "Sandsear Storm", "Spring Wind": "Springtide Storm",
};
const ITEM_FIX = { "Heavy Boots": "Heavy-Duty Boots", "Utility Parasol": "Utility Umbrella", "Safety Googles": "Safety Goggles", "Electirizier": "Electirizer" };
const ABILITY_FIX = { 153: "As One (Glastrier)", 154: "As One (Spectrier)", "Neutralize Gas": "Neutralizing Gas", "Wandering Soul": "Wandering Spirit", "Valiant Shield": "Dauntless Shield" };

function resolver(list, fixes) {
  const all = list.filter((x) => x.exists !== false);
  const byId = new Map(all.map((x) => [id(x.name), x.name]));
  return (raw) => {
    const name = fixes[raw] || raw;
    if (byId.has(id(name))) return byId.get(id(name));
    // a cut name: every word is the start of the full name's word in the same place (Thunder Pnch -> Thunder Punch...), the full
    // name only longer; the shortest such name wins
    const words = name.toLowerCase().split(/[\s-]+/).filter(Boolean);
    const hits = all.filter((x) => {
      const full = x.name.toLowerCase().split(/[\s-]+/);
      if (full.length !== words.length) return false;
      return words.every((w, i) => {
        const f = full[i];
        if (f.startsWith(w.replace(/[^a-z0-9']/g, ""))) return true;
        // abbreviations keeping the first letter and the rest in order (Pnch -> Punch)
        let k = 0;
        for (const ch of w) { k = f.indexOf(ch, k); if (k < 0) return false; k++; }
        return w[0] === f[0];
      });
    });
    hits.sort((a, b) => a.name.length - b.name.length);
    return hits[0]?.name || "";
  };
}

const moveOf = resolver(dex.moves.all(), MOVE_FIX);
const itemOf = resolver(dex.items.all(), ITEM_FIX);
const abilityOf = resolver(dex.abilities.all(), ABILITY_FIX);

const out = { schema: 1, game: "Pokemon Unbound 2.1.1.1", source: "PUSE by Zannael (MIT), tables read from the game's ROM",
  species: {}, moves: {}, items: {}, abilities: {}, species_abilities: {}, missing: { moves: [], items: [], abilities: [], species: [] } };

for (const [k, v] of Object.entries(table("moves.txt"))) {
  const n = moveOf(v);
  if (n) out.moves[k] = n; else out.missing.moves.push(`${k}:${v}`);
}
for (const [k, v] of Object.entries(table("items.txt"))) {
  const n = itemOf(v);
  if (n) out.items[k] = n; else out.missing.items.push(`${k}:${v}`);
}
for (const [k, v] of Object.entries(table("abilities.txt"))) {
  const n = abilityOf(ABILITY_FIX[k] || v);
  if (n) out.abilities[k] = n; else out.missing.abilities.push(`${k}:${v}`);
}

// Species: the ROM constant (SPECIES_RAICHU_A, SPECIES_ROTOM_WASH...) says the forme better than the display name.
const constants = JSON.parse(readFileSync(join(src, "species_constants.json"), "utf8"));
const SUFFIX = { A: "Alola", G: "Galar", H: "Hisui", F: "F", M: "", P: "Pom-Pom", S: "Sensu", Y: "", N: "Midnight", GIGA: "", MEGA: "", PRIMAL: "" };
const SPECIES_FIX = {
  SPECIES_NIDORAN_F: "Nidoran-F", SPECIES_NIDORAN_M: "Nidoran-M", SPECIES_ORICORIO_Y: "Oricorio-Pom-Pom", SPECIES_ORICORIO_P: "Oricorio-Pa'u",
  SPECIES_ORICORIO_S: "Oricorio-Sensu", SPECIES_LYCANROC_N: "Lycanroc-Midnight", SPECIES_WISHIWASHI_S: "Wishiwashi-School", SPECIES_MAGEARNA_P: "Magearna-Original",
  SPECIES_DARMANITAN_G_ZEN: "Darmanitan-Galar-Zen", SPECIES_BASCULEGION_M: "Basculegion", SPECIES_BASCULEGION_F: "Basculegion-F",
  SPECIES_UNFEZANT_F: "Unfezant", SPECIES_FRILLISH_F: "Frillish", SPECIES_JELLICENT_F: "Jellicent", SPECIES_HIPPOPOTAS_F: "Hippopotas", SPECIES_HIPPOWDON_F: "Hippowdon",
  SPECIES_PYROAR_FEMALE: "Pyroar", SPECIES_MEOWSTIC_FEMALE: "Meowstic-F", SPECIES_INDEEDEE_FEMALE: "Indeedee-F", SPECIES_ZYGARDE_10: "Zygarde-10%",
  SPECIES_ZYGARDE_CELL: "Zygarde", SPECIES_ZYGARDE_CORE: "Zygarde", SPECIES_URSHIFU_SINGLE: "Urshifu", SPECIES_URSHIFU_RAPID: "Urshifu-Rapid-Strike",
  SPECIES_NECROZMA_DUSK_MANE: "Necrozma-Dusk-Mane", SPECIES_NECROZMA_DAWN_WINGS: "Necrozma-Dawn-Wings", SPECIES_CALYREX_ICE_RIDER: "Calyrex-Ice",
  SPECIES_CALYREX_SHADOW_RIDER: "Calyrex-Shadow", SPECIES_TOXTRICITY_LOW_KEY: "Toxtricity-Low-Key", SPECIES_SHADOW_WARRIOR: "",
  SPECIES_PIKACHU_POP_STAR: "Pikachu-Pop-Star", SPECIES_PIKACHU_ROCK_STAR: "Pikachu-Rock-Star", SPECIES_PIKACHU_PHD: "Pikachu-PhD",
  SPECIES_FURFROU_LA_REINE: "Furfrou-La-Reine", SPECIES_VIVILLON_HIGH_PLAINS: "Vivillon-High-Plains", SPECIES_VIVILLON_ICY_SNOW: "Vivillon-Icy-Snow",
  SPECIES_ETERNATUS_ETERNAMAX: "Eternatus-Eternamax", SPECIES_ZARUDE_DADA: "Zarude-Dada", SPECIES_MINIOR_SHIELD: "Minior-Meteor",
  SPECIES_TYPE_NULL: "Type: Null", SPECIES_PORYGON_Z: "Porygon-Z", SPECIES_HO_OH: "Ho-Oh", SPECIES_MR_MIME: "Mr. Mime", SPECIES_MIME_JR: "Mime Jr.",
  SPECIES_MR_RIME: "Mr. Rime", SPECIES_MR_MIME_G: "Mr. Mime-Galar", SPECIES_MIME_JR_G: "Mime Jr.", SPECIES_FARFETCHD: "Farfetch’d",
  SPECIES_FARFETCHD_G: "Farfetch’d-Galar", SPECIES_SIRFETCHD: "Sirfetch’d", SPECIES_JANGMO_O: "Jangmo-o", SPECIES_HAKAMO_O: "Hakamo-o", SPECIES_KOMMO_O: "Kommo-o",
  SPECIES_FLABEBE: "Flabébé", SPECIES_BASCULIN_BLUE: "Basculin-Blue-Striped", SPECIES_BASCULIN_H: "Basculin-White-Striped",
  SPECIES_ASHGRENINJA: "Greninja-Ash", SPECIES_ARCEUS_FIGHT: "Arceus-Fighting", SPECIES_SILVALLY_FIGHT: "Silvally-Fighting",
  ...Object.fromEntries(["Original", "Hoenn", "Sinnoh", "Unova", "Kalos", "Alola", "Partner"].map((r) => [`SPECIES_PIKACHU_CAP_${r.toUpperCase()}`, `Pikachu-${r}`])),
};
const speciesById = new Map(dex.species.all().map((s) => [id(s.name), s]));
function speciesOf(constant) {
  if (constant in SPECIES_FIX) return SPECIES_FIX[constant];
  const parts = constant.replace(/^SPECIES_/, "").split("_");
  const tries = [];
  for (let n = parts.length; n >= 1; n--) {
    const base = parts.slice(0, n).join(" ");
    const rest = parts.slice(n).map((p) => (p in SUFFIX ? SUFFIX[p] : p)).filter(Boolean).join(" ");
    tries.push(`${base} ${rest}`, base);
  }
  for (const t of tries) {
    const s = speciesById.get(id(t));
    if (s) return s.name;
  }
  return "";
}
for (const [k, c] of Object.entries(constants)) {
  if (!c || c === "SPECIES_NONE") continue;
  const n = speciesOf(c);
  if (n) out.species[k] = n; else out.missing.species.push(`${k}:${c}`);
}
const abil = JSON.parse(readFileSync(join(src, "species_abilities_meta.json"), "utf8"));
for (const [k, v] of Object.entries(abil)) out.species_abilities[k] = [v.ability_1_id || 0, v.ability_2_id || 0, v.hidden_ability_id || 0];

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dest = process.argv[3] || join(root, "silvers_hoard", "presets", "unbound_save.json.gz");
writeFileSync(dest, gzipSync(JSON.stringify(out)));
console.log(`species ${Object.keys(out.species).length}, moves ${Object.keys(out.moves).length}, items ${Object.keys(out.items).length}, abilities ${Object.keys(out.abilities).length}`);
for (const [k, v] of Object.entries(out.missing)) if (v.length) console.log(`missing ${k} (${v.length}): ${v.join(", ")}`);
