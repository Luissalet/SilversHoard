// Which pixelfx effect a move (or a status, a boost, a heal, the weather, a terrain) plays. Pure data and functions: no DOM, no effect
// code, no randomness, so the plain node tests, the REST/MCP catalog and the painter all read the same table. The effect ids are the
// keys of ./registry.js. The painter draws; nothing here (or in layer.js) writes simulation state.
//
// Order of choice for a move: an effect pinned by hand in the explorer (setPins, kept on the server), then the move's own row in
// MOVE_TABLE, then its type's row in TYPE_TABLE by role (from its shape, or from its category when it has none).

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

// A cell: "[role:]category/name[~[#rrggbb]][ | hit cell]". A trailing "~" recolours the effect with the type's ramp ("~#rrggbb" with
// that colour's); without it the effect keeps its own colours (fire is already fire). The role prefix says where it plays (see ROLE_INFO)
// when it is not the move's own; "| ..." is a second effect on the target when the move hits.
const HEX = /^#[0-9a-f]{6}$/i;
/** A cell of the tables as {id, tint, color?, role?, hit?}. */
export function parseCell(cell) {
  const [main, hit] = String(cell).split("|").map((s) => s.trim());
  let text = main, role;
  const m = /^([a-z]+):(.+)$/.exec(text);
  if (m && ROLES.includes(m[1])) { role = m[1]; text = m[2]; }
  const at = text.indexOf("~");
  const id = at < 0 ? text : text.slice(0, at);
  const color = at < 0 ? "" : text.slice(at + 1);
  const out = { id, tint: at >= 0 };
  if (HEX.test(color)) out.color = color.toLowerCase();
  if (role) out.role = role;
  if (hit) out.hit = parseCell(hit.replace(/^[a-z]+:/, ""));
  return out;
}
const split = (cell) => { const c = parseCell(cell); return { id: c.id, tint: c.tint, ...(c.color ? { color: c.color } : {}) }; };

// Order: projectile, impact on the target, beam (and cone), burst around a point, drop from the sky, effect on the user.
const row = (projectile, impact, beam, area, drop, self) => ({ projectile, impact, beam, area, drop, self });
export const TYPE_TABLE = Object.freeze({
  Normal: row("projectiles/energy-disc~", "impacts/blunt-hit", "arcane/arcane-beam~", "explosions/cartoon-pow", "impacts/ground-slam", "arcane/rune-circle~"),
  Fire: row("fire/fireball", "explosions/small-explosion", "fire/flamethrower", "fire/fire-ring", "fire/meteor", "fire/spirit-flame~"),
  Water: row("water/water-orb", "water/splash", "water/water-jet", "water/wave-crash", "water/geyser", "water/bubbles"),
  Electric: row("lightning/ball-lightning", "lightning/zap-hit", "lightning/chain-lightning", "explosions/plasma-explosion~", "lightning/lightning-strike", "arcane/spell-charge~"),
  Grass: row("projectiles/magic-missile~", "nature/thorns", "nature/vine-whip", "nature/spore-burst", "nature/earth-spike~", "nature/healing-bloom"),
  Ice: row("ice/ice-lance", "ice/ice-shatter", "ice/frost-breath", "ice/frost-nova", "ice/icicle-fall", "ice/ice-crystal"),
  Fighting: row("projectiles/plasma-shot~", "impacts/crit-hit~", "arcane/arcane-beam~", "impacts/ground-slam", "impacts/ground-slam", "arcane/mana-burst~"),
  Poison: row("projectiles/plasma-shot~", "nature/acid-splash~", "water/water-jet~", "nature/poison-cloud", "nature/toxic-puddle", "nature/poison-cloud"),
  Ground: row("nature/boulder", "explosions/dirt-explosion", "water/water-jet~", "nature/quake", "nature/earth-spike", "impacts/heavy-landing"),
  Flying: row("nature/tornado~", "impacts/hit-spark~", "water/water-jet~", "nature/tornado~", "holy/feather-burst", "holy/feather-burst"),
  Psychic: row("arcane/arcane-orb~", "arcane/mana-burst~", "arcane/arcane-beam~", "arcane/magic-circle-cast~", "arcane/star-fall~", "arcane/rune-circle~"),
  Bug: row("projectiles/magic-missile~", "impacts/hit-spark~", "nature/vine-whip~", "nature/spore-burst~", "nature/spore-burst~", "nature/spore-burst~"),
  Rock: row("nature/boulder", "explosions/dirt-explosion", "arcane/arcane-beam~", "nature/quake", "nature/earth-spike", "impacts/ground-slam"),
  Ghost: row("shadow/void-orb", "shadow/shadow-tendrils", "shadow/soul-drain", "shadow/dark-explosion~", "shadow/grasping-hands", "shadow/shadow-flames~"),
  Dragon: row("arcane/arcane-orb~", "explosions/plasma-explosion~", "arcane/arcane-beam~", "explosions/plasma-explosion~", "fire/meteor~", "arcane/mana-burst~"),
  Dark: row("shadow/void-orb", "shadow/dark-explosion", "shadow/soul-drain", "shadow/black-hole", "shadow/grasping-hands", "shadow/shadow-flames"),
  Steel: row("projectiles/energy-disc~", "impacts/parry", "arcane/arcane-beam~", "impacts/ground-slam", "impacts/ground-slam", "scifi/force-field~"),
  Fairy: row("arcane/arcane-orb~", "holy/feather-burst~", "arcane/arcane-beam~", "holy/heal-aoe~", "holy/smite~", "holy/heal-aoe~"),
});

// The moves with an effect of their own: picked by name and shape (Flamethrower is a flamethrower, Thunder a lightning strike,
// Earthquake a quake, Hydro Pump a water jet, the claws claw, the drains drain). Every other move falls back to its type's row.
export const MOVE_TABLE = Object.freeze({
  // Fire
  flamethrower: "fire/flamethrower", fireblast: "projectile:fire/fireball | explosions/small-explosion", blastburn: "projectile:fire/fireball | explosions/big-explosion",
  overheat: "fire/flamethrower | explosions/small-explosion", armorcannon: "beam:projectiles/cannonball | explosions/small-explosion",
  firespin: "projectile:fire/fireball | fire/fire-tornado", magmastorm: "projectile:fire/fireball | fire/fire-tornado", inferno: "projectile:fire/fireball | fire/fire-tornado",
  heatwave: "fire/fire-breath", incinerate: "fire/fire-breath", burningjealousy: "fire/fire-breath", eruption: "area:fire/flame-pillar", shelltrap: "area:explosions/small-explosion",
  lavaplume: "fire/fire-ring", searingshot: "fire/fire-ring", mindblown: "explosions/big-explosion", sunnyday: "self:holy/sunburst",
  willowisp: "projectile:fire/spirit-flame", blueflare: "projectile:fire/fireball~#4aa8ff | fire/flame-pillar~#4aa8ff", fusionflare: "projectile:fire/fireball | fire/flame-pillar",
  sacredfire: "projectile:fire/fireball | fire/flame-pillar", burnup: "projectile:fire/fireball | fire/flame-pillar", pyroball: "projectile:fire/fireball | explosions/small-explosion",
  firepunch: "explosions/small-explosion", firefang: "melee/claw-swipe", flamecharge: "fire/fire-ring", flamewheel: "fire/fire-tornado", flareblitz: "fire/flame-pillar",
  blazekick: "explosions/small-explosion", firelash: "melee/whip-crack~", heatcrash: "fire/meteor", vcreate: "fire/flame-pillar", bitterblade: "melee/sword-slash~",
  temperflare: "explosions/small-explosion", burningbulwark: "self:scifi/force-field~", ragingfury: "fire/fire-tornado", sizzlyslide: "fire/fire-ring",
  // Water
  hydropump: "water/water-jet", hydrocannon: "water/water-jet | water/geyser", waterpulse: "projectile:water/water-orb | water/splash",
  bubblebeam: "projectile:water/water-orb~#bfe8ff | water/bubbles", bubble: "beam:water/water-jet~#bfe8ff", surf: "water/wave-crash", muddywater: "water/wave-crash~#8a6b35",
  sparklingaria: "water/splash", watergun: "beam:water/water-jet", snipeshot: "beam:water/water-jet", whirlpool: "projectile:water/water-orb | water/whirlpool",
  waterspout: "area:water/geyser", originpulse: "water/wave-crash", steameruption: "projectile:water/water-orb | water/geyser", soak: "projectile:water/water-orb | water/splash",
  wavecrash: "water/wave-crash", aquatail: "melee/whip-crack~", razorshell: "melee/sword-slash~", crabhammer: "melee/hammer-smash~", fishiousrend: "melee/claw-swipe~",
  surgingstrikes: "melee/dagger-flurry~", dive: "water/geyser", raindance: "self:water/rain-splash", aquaring: "self:water/ripples", watersport: "self:water/fountain",
  withdraw: "self:scifi/force-field~", lifedew: "self:holy/heal-aoe~", watershuriken: "projectiles/energy-disc~", aquacutter: "projectiles/energy-disc~",
  // Electric
  thunderbolt: "lightning/chain-lightning", chargebeam: "lightning/chain-lightning", thunder: "lightning/lightning-strike", thunderclap: "lightning/lightning-strike",
  zapcannon: "projectile:lightning/ball-lightning | explosions/plasma-explosion~", electroball: "projectile:lightning/ball-lightning", discharge: "lightning/thunderclap",
  paraboliccharge: "lightning/thunderclap", thunderwave: "projectile:lightning/ball-lightning", eerieimpulse: "projectile:lightning/ball-lightning",
  thunderpunch: "lightning/zap-hit", thunderfang: "melee/claw-swipe~", spark: "lightning/zap-hit", wildcharge: "explosions/plasma-explosion~", volttackle: "lightning/thunderclap",
  charge: "self:lightning/charge-up", nuzzle: "lightning/zap-hit", zingzap: "lightning/zap-hit", boltstrike: "lightning/lightning-strike", boltbeak: "melee/thrust~",
  plasmafists: "explosions/plasma-explosion~", supercellslam: "lightning/thunderclap", doubleshock: "lightning/thunderclap", electrodrift: "lightning/zap-hit",
  electroweb: "lightning/chain-lightning", overdrive: "lightning/chain-lightning", electroshot: "beam:arcane/arcane-beam~", magnetrise: "self:scifi/jetpack",
  thundershock: "projectile:lightning/ball-lightning | lightning/zap-hit",
  // Grass
  solarbeam: "arcane/arcane-beam~#f4e36a | holy/holy-pillar~#f4e36a", solarblade: "melee/heavy-cleave~#f4e36a", leafstorm: "projectile:nature/tornado~#7ac74c | nature/leaf-storm",
  frenzyplant: "impact:nature/root-snare", energyball: "projectile:arcane/arcane-orb~#7ac74c | nature/spore-burst", gigadrain: "beam:shadow/soul-drain~#7ac74c",
  megadrain: "beam:shadow/soul-drain~#7ac74c", absorb: "beam:shadow/soul-drain~#7ac74c", leechseed: "projectile:projectiles/magic-missile~ | nature/root-snare",
  ingrain: "self:nature/root-snare", vinewhip: "nature/vine-whip", powerwhip: "nature/vine-whip", razorleaf: "melee/dagger-flurry~", magicalleaf: "projectiles/magic-missile~",
  leafage: "projectiles/magic-missile~", leaftornado: "projectile:nature/tornado~", petalblizzard: "nature/leaf-storm~#ff9ac8", petaldance: "nature/leaf-storm~#ff9ac8",
  bulletseed: "projectiles/bullet-tracer~#b5e06a", seedbomb: "projectile:projectiles/magic-missile~ | nature/spore-burst", junglehealing: "self:holy/heal-aoe~",
  woodhammer: "melee/hammer-smash~#8a5a32", grassknot: "nature/root-snare", hornleech: "shadow/life-steal~", needlearm: "melee/thrust~", leafblade: "melee/sword-slash~",
  snaptrap: "nature/thorns", trailblaze: "nature/thorns", spikyshield: "self:scifi/force-field~", cottonguard: "self:holy/divine-shield~#ffffff",
  seedflare: "projectile:holy/sunburst~#ffffff | holy/holy-pillar", chloroblast: "beam:arcane/arcane-beam~", strengthsap: "projectile:projectiles/magic-missile~ | shadow/life-steal~",
  // Ice
  icebeam: "arcane/arcane-beam~#96d9d6 | ice/ice-shatter", aurorabeam: "arcane/arcane-beam~#9ef0c8", blizzard: "area:ice/blizzard-vortex", glaciate: "ice/ice-spikes",
  glaciallance: "ice/ice-spikes", sheercold: "ice/frost-nova", iciclecrash: "projectile:ice/ice-lance | ice/icicle-fall", icepunch: "ice/ice-shatter", icefang: "melee/claw-swipe~",
  icehammer: "melee/hammer-smash~", avalanche: "ice/icicle-fall", tripleaxel: "melee/spin-slash~", icespinner: "melee/spin-slash~", iceball: "ice/ice-shatter",
  frostbreath: "beam:ice/frost-breath", freezedry: "projectile:ice/ice-lance | ice/ice-crystal", iceburn: "projectile:ice/ice-lance | ice/frost-nova",
  haze: "self:nature/poison-cloud~#d8dce8", mist: "self:nature/poison-cloud~#e8f4ff", hail: "self:ice/snowflake-burst", snowscape: "self:ice/snowflake-burst",
  chillyreception: "self:ice/snowflake-burst", auroraveil: "self:holy/divine-shield~#9ef0c8", mountaingale: "projectile:ice/ice-lance | ice/ice-shatter",
  // Ground
  earthquake: "nature/quake", magnitude: "nature/quake", bulldoze: "nature/quake", fissure: "nature/quake", earthpower: "nature/earth-spike",
  precipiceblades: "ice/ice-spikes~#c22e28", landswrath: "nature/thorns~#b8954a", thousandwaves: "area:nature/quake", thousandarrows: "area:arcane/star-fall~#e2bf65",
  mudshot: "projectile:water/water-orb~#8a6b35 | explosions/dirt-explosion", mudslap: "projectile:water/water-orb~#8a6b35 | explosions/dirt-explosion",
  mudbomb: "projectile:water/water-orb~#8a6b35 | explosions/dirt-explosion", dig: "explosions/dirt-explosion", drillrun: "melee/thrust~", highhorsepower: "impacts/ground-slam",
  stompingtantrum: "impacts/ground-slam", headlongrush: "impacts/ground-slam", boneclub: "projectiles/energy-disc~#e8e0c8", bonemerang: "projectiles/energy-disc~#e8e0c8",
  bonerush: "projectiles/energy-disc~#e8e0c8", sandattack: "projectile:nature/poison-cloud~", sandtomb: "projectile:nature/boulder | nature/tornado~",
  spikes: "nature/thorns~#9a9ab0", shoreup: "self:holy/heal~", mudsport: "self:water/splash~#8a6b35", rototiller: "self:nature/healing-bloom", sandsearstorm: "area:nature/tornado~",
  // Rock
  rockslide: "fire/meteor~#b6a136", stoneedge: "nature/earth-spike", powergem: "projectile:pickups/gem-spin | pickups/collect-burst", ancientpower: "projectiles/magic-missile~",
  meteorbeam: "arcane/arcane-beam~", headsmash: "impacts/crit-hit~", stealthrock: "pickups/crystal-shard~", sandstorm: "self:nature/tornado~#e2bf65",
  wideguard: "self:scifi/force-field~", diamondstorm: "ice/ice-spikes~#e0f0ff", saltcure: "projectile:pickups/crystal-shard~#ffffff | ice/ice-crystal~#ffffff",
  stoneaxe: "melee/heavy-cleave~", mightycleave: "melee/heavy-cleave~", rockpolish: "self:pickups/power-star~",
  // Flying
  hurricane: "nature/tornado", gust: "projectile:nature/tornado~", aeroblast: "beam:arcane/arcane-beam~#e0e8ff", airslash: "projectile:projectiles/energy-disc~#e0e8ff",
  aircutter: "melee/dagger-flurry~#e0e8ff", bravebird: "holy/feather-burst | impacts/crit-hit~", drillpeck: "melee/thrust~", peck: "melee/thrust~", pluck: "melee/thrust~",
  wingattack: "melee/double-slash~", dualwingbeat: "melee/double-slash~", fly: "impacts/heavy-landing", bounce: "impacts/heavy-landing",
  skyattack: "projectile:arcane/arcane-orb~#ffffff | impacts/crit-hit~", acrobatics: "melee/dagger-flurry~", aerialace: "melee/sword-slash~#e0e8ff",
  tailwind: "self:nature/tornado~#e0e8ff", featherdance: "self:holy/feather-burst", defog: "self:nature/tornado~#e0e8ff", oblivionwing: "beam:shadow/soul-drain~#e0405a",
  bleakwindstorm: "area:nature/tornado~#a0b8ff",
  // Psychic
  psychic: "arcane/magic-circle-cast~", psyshock: "arcane/magic-circle-cast~", psystrike: "arcane/magic-circle-cast~", futuresight: "arcane/star-fall~",
  psybeam: "arcane/arcane-beam~", photongeyser: "arcane/arcane-beam~#ffffff | holy/holy-pillar", prismaticlaser: "arcane/arcane-beam~#ffffff",
  lusterpurge: "projectile:arcane/arcane-orb~", mistball: "projectile:arcane/arcane-orb~", hyperspacehole: "impact:arcane/portal~", dreameater: "beam:shadow/soul-drain~",
  agility: "self:status/haste", reflect: "self:scifi/force-field~", lightscreen: "self:scifi/force-field~#ffe27a", barrier: "self:scifi/force-field~",
  magiccoat: "self:holy/divine-shield~", teleport: "self:arcane/blink-out", allyswitch: "self:arcane/blink-in", trickroom: "self:arcane/time-stop~",
  wonderroom: "self:arcane/time-stop~", magicroom: "self:arcane/time-stop~", gravity: "self:explosions/implosion~", rest: "self:status/sleep",
  healingwish: "self:holy/heal-aoe~", lunardance: "self:holy/heal-aoe~", zenheadbutt: "arcane/mana-burst~", psychocut: "projectiles/energy-disc~",
  psyblade: "melee/sword-slash~", psychicfangs: "melee/claw-swipe~", psyshieldbash: "impacts/shield-block~", storedpower: "beam:arcane/arcane-missiles~",
  expandingforce: "arcane/mana-burst~", psychoboost: "projectile:arcane/arcane-orb~ | arcane/mana-burst~", imprison: "self:shadow/hex-sigil~",
  cosmicpower: "self:arcane/star-fall~", twinbeam: "beam:arcane/arcane-beam~", healblock: "projectile:arcane/arcane-orb~ | shadow/hex-sigil~",
  // Fighting
  aurasphere: "projectile:arcane/arcane-orb~#4c8cff | arcane/mana-burst~#4c8cff", focusblast: "projectile:arcane/arcane-orb~#ffb15c | explosions/plasma-explosion~#ffb15c",
  closecombat: "melee/dagger-flurry~", superpower: "impacts/crit-hit~", brickbreak: "explosions/cartoon-pow~", karatechop: "melee/sword-slash~", crosschop: "melee/double-slash~",
  skyuppercut: "melee/uppercut~", machpunch: "impacts/hit-spark~", dynamicpunch: "explosions/cartoon-pow~", drainpunch: "shadow/life-steal~", focuspunch: "impacts/crit-hit~",
  hammerarm: "melee/hammer-smash~", lowsweep: "melee/spear-sweep~", axekick: "melee/heavy-cleave~", triplekick: "melee/dagger-flurry~", seismictoss: "impacts/heavy-landing",
  circlethrow: "impacts/heavy-landing", stormthrow: "impacts/heavy-landing", vitalthrow: "impacts/heavy-landing", submission: "impacts/heavy-landing",
  vacuumwave: "projectiles/energy-disc~", bulkup: "self:status/rage", noretreat: "self:status/rage", detect: "self:holy/divine-shield~", quickguard: "self:scifi/force-field~",
  matblock: "self:scifi/force-field~", bodypress: "impacts/heavy-landing", collisioncourse: "explosions/plasma-explosion~", sacredsword: "melee/sword-slash~",
  secretsword: "impact:melee/sword-slash~", triplearrows: "projectiles/arrow~", meteorassault: "impact:impacts/ground-slam", finalgambit: "explosions/big-explosion",
  armthrust: "melee/thrust~", rocksmash: "explosions/dirt-explosion",
  // Poison
  sludgebomb: "projectile:projectiles/plasma-shot~ | nature/acid-splash", sludgewave: "water/wave-crash~", gunkshot: "projectile:projectiles/plasma-shot~ | nature/toxic-puddle",
  smog: "projectile:nature/poison-cloud", clearsmog: "projectile:nature/poison-cloud~#d8dce8", acidspray: "projectile:projectiles/plasma-shot~ | nature/acid-splash",
  acid: "water/water-jet~#a3e040", toxic: "projectile:projectiles/plasma-shot~ | nature/toxic-puddle", poisongas: "self:nature/poison-cloud",
  toxicspikes: "nature/toxic-puddle", poisonjab: "melee/thrust~", crosspoison: "melee/double-slash~", poisonfang: "melee/claw-swipe~", poisontail: "melee/whip-crack~",
  direclaw: "melee/claw-swipe~", mortalspin: "melee/spin-slash~", acidarmor: "self:nature/acid-splash", banefulbunker: "self:scifi/force-field~", venomdrench: "projectile:projectiles/plasma-shot~ | nature/acid-splash",
  // Bug
  xscissor: "melee/double-slash~", furycutter: "melee/sword-slash~", bugbite: "melee/claw-swipe~", leechlife: "shadow/life-steal~", megahorn: "melee/thrust~",
  pinmissile: "projectiles/arrow~", twineedle: "projectiles/arrow~", signalbeam: "arcane/arcane-beam~#ff60c0", silverwind: "projectile:nature/tornado~#d6d6e6",
  quiverdance: "self:critters/butterfly", tailglow: "self:fire/spirit-flame~#f7f080", defendorder: "self:scifi/force-field~", healorder: "self:holy/heal-aoe~",
  ragepowder: "self:nature/spore-burst~", firstimpression: "explosions/cartoon-pow~", lunge: "impacts/crit-hit~",
  // Ghost
  shadowball: "projectile:shadow/void-orb", moongeistbeam: "arcane/arcane-beam~", shadowclaw: "melee/claw-swipe~", shadowpunch: "impacts/blunt-hit~",
  shadowsneak: "shadow/grasping-hands", phantomforce: "shadow/shadow-tendrils", shadowforce: "shadow/shadow-tendrils", poltergeist: "projectile:shadow/void-orb | shadow/necro-skulls",
  spiritshackle: "projectiles/arrow~ | shadow/hex-sigil", hex: "projectile:shadow/void-orb | shadow/hex-sigil", nightshade: "projectile:shadow/void-orb | shadow/shadow-tendrils",
  ominouswind: "projectile:nature/tornado~", infernalparade: "projectile:fire/spirit-flame~#9b6bff", curse: "self:shadow/curse", destinybond: "self:shadow/hex-sigil",
  grudge: "self:shadow/hex-sigil", spite: "self:shadow/curse", confuseray: "projectile:fire/spirit-flame~#ffe27a", trickortreat: "self:critters/ghost",
  lick: "impacts/blunt-hit~", astonish: "explosions/cartoon-pow~", ragefist: "impacts/crit-hit~", astralbarrage: "area:shadow/dark-explosion~",
  // Dark
  darkpulse: "beam:arcane/arcane-beam~#3a2a4a | shadow/dark-explosion", crunch: "melee/claw-swipe~", bite: "melee/claw-swipe~", jawlock: "melee/claw-swipe~",
  nightslash: "melee/sword-slash~", ceaselessedge: "melee/heavy-cleave~", kowtowcleave: "melee/heavy-cleave~", throatchop: "melee/sword-slash~",
  falsesurrender: "melee/sword-slash~", knockoff: "impacts/crit-hit~", suckerpunch: "impacts/hit-spark~", foulplay: "shadow/grasping-hands", darkestlariat: "melee/spin-slash~",
  wickedblow: "impacts/crit-hit~", nastyplot: "self:shadow/hex-sigil", honeclaws: "self:melee/claw-swipe~", obstruct: "self:scifi/force-field~",
  fierywrath: "area:shadow/dark-explosion", darkvoid: "projectile:shadow/void-orb | shadow/black-hole", memento: "self:spawn/soul-rise", partingshot: "self:arcane/blink-out",
  ruination: "projectile:shadow/void-orb | shadow/black-hole", brutalswing: "melee/spin-slash~", beatup: "explosions/cartoon-pow~", thief: "pickups/collect-burst",
  covet: "pickups/collect-burst",
  // Steel
  flashcannon: "beam:arcane/arcane-beam~#e0e8ff", steelbeam: "beam:arcane/arcane-beam~#e0e8ff | explosions/plasma-explosion~", ironhead: "impacts/crit-hit~",
  irontail: "melee/whip-crack~", meteormash: "impacts/ground-slam", bulletpunch: "impacts/hit-spark~", metalclaw: "melee/claw-swipe~", gyroball: "melee/spin-slash~",
  heavyslam: "impacts/heavy-landing", smartstrike: "melee/thrust~", sunsteelstrike: "holy/smite", behemothblade: "melee/heavy-cleave~", behemothbash: "impacts/ground-slam",
  gigatonhammer: "impact:melee/hammer-smash~", doubleironbash: "melee/double-slash~", steelroller: "impacts/ground-slam", spinout: "melee/spin-slash~",
  hardpress: "impacts/heavy-landing", steelwing: "melee/double-slash~", shiftgear: "self:scifi/energy-core", gearup: "self:scifi/energy-core",
  autotomize: "self:status/haste", kingsshield: "self:holy/divine-shield~#e0e0ff", shelter: "self:scifi/force-field~", makeitrain: "area:spawn/coin-drop",
  doomdesire: "holy/holy-pillar~#ffffff", mirrorshot: "beam:arcane/arcane-beam~#ffffff", metalburst: "explosions/plasma-explosion~",
  // Fairy
  moonblast: "projectile:arcane/arcane-orb~#ffd1ea | arcane/mana-burst~#ffd1ea", dazzlinggleam: "area:holy/sunburst~#ffd1ea", playrough: "explosions/cartoon-pow~",
  spiritbreak: "impacts/crit-hit~", drainingkiss: "shadow/life-steal~#ff8fbf", charm: "projectile:pickups/heart-pickup", babydolleyes: "projectile:pickups/heart-pickup",
  sweetkiss: "projectile:pickups/heart-pickup", fairywind: "projectile:nature/tornado~#ffd1ea", moonlight: "self:holy/blessing~#e0e0ff",
  floralhealing: "projectile:projectiles/magic-missile~ | nature/healing-bloom", geomancy: "self:arcane/magic-circle-cast~", craftyshield: "self:scifi/force-field~",
  flowershield: "self:scifi/force-field~", decorate: "self:ui/confetti", aromaticmist: "self:nature/poison-cloud~#ffd1ea", strangesteam: "projectile:nature/poison-cloud~#ffd1ea",
  fleurcannon: "arcane/arcane-beam~#ff8fbf", mistyexplosion: "explosions/plasma-explosion~#ffd1ea", springtidestorm: "area:nature/tornado~#ff9ac8",
  lightofruin: "beam:arcane/arcane-beam~#ffd1ea | explosions/plasma-explosion~#ffd1ea",
  // Dragon
  dracometeor: "impact:fire/meteor~", dragonpulse: "arcane/arcane-beam~", dragonbreath: "beam:fire/fire-breath~", dragonrage: "projectile:fire/fireball~",
  outrage: "explosions/plasma-explosion~", dragonclaw: "melee/claw-swipe~", dragontail: "melee/whip-crack~", dragonrush: "impacts/crit-hit~",
  dragonhammer: "melee/hammer-smash~", dualchop: "melee/double-slash~", breakingswipe: "melee/spin-slash~", dragondance: "self:fire/fire-tornado~",
  clangoroussoul: "self:status/rage", twister: "area:nature/tornado~", coreenforcer: "arcane/arcane-beam~#7ac74c", spacialrend: "melee/double-slash~#f0a0ff",
  roaroftime: "arcane/time-stop~#6f9cff", dynamaxcannon: "arcane/arcane-beam~#e0405a", eternabeam: "arcane/arcane-beam~#e0405a",
  scaleshot: "projectiles/energy-disc~", dragondarts: "projectiles/arrow~",
  // Normal
  hyperbeam: "arcane/arcane-beam~#ffe7a0 | explosions/plasma-explosion~#ffe7a0", gigaimpact: "explosions/big-explosion", explosion: "explosions/big-explosion",
  selfdestruct: "explosions/small-explosion", swift: "area:arcane/star-fall~#ffe27a", triattack: "projectile:arcane/arcane-orb~", slash: "melee/sword-slash~",
  cut: "melee/sword-slash~", scratch: "melee/claw-swipe~", furyswipes: "melee/dagger-flurry~", crushclaw: "melee/claw-swipe~", bodyslam: "impacts/heavy-landing",
  doubleedge: "impacts/crit-hit~", hornattack: "melee/thrust~", horndrill: "melee/thrust~", furyattack: "melee/thrust~", megapunch: "explosions/cartoon-pow~",
  stomp: "impacts/ground-slam", extremespeed: "melee/spin-slash~", quickattack: "impacts/hit-spark~", fakeout: "explosions/cartoon-pow~", swordsdance: "self:melee/spin-slash~",
  protect: "self:holy/divine-shield", substitute: "self:spawn/poof", recover: "self:holy/heal", softboiled: "self:holy/heal", milkdrink: "self:holy/heal",
  slackoff: "self:holy/heal", morningsun: "self:holy/heal", healbell: "self:holy/heal-aoe~", wish: "self:arcane/star-fall~#ffe27a", harden: "self:scifi/force-field~",
  defensecurl: "self:scifi/force-field~", growth: "self:nature/healing-bloom", howl: "self:arcane/mana-burst~", workup: "self:arcane/mana-burst~",
  focusenergy: "self:lightning/charge-up~#ffb15c", bellydrum: "self:status/rage", shellsmash: "self:ice/ice-shatter~", stockpile: "self:arcane/spell-charge~",
  celebrate: "self:ui/confetti", splash: "self:water/splash", happyhour: "self:ui/coin-collect", payday: "projectile:pickups/coin-spin | spawn/coin-drop",
  present: "projectile:pickups/chest-open | explosions/firework-burst", whirlwind: "self:nature/tornado~", transform: "self:scifi/glitch", conversion: "self:scifi/glitch",
  conversion2: "self:scifi/glitch", perishsong: "self:shadow/necro-skulls", revivalblessing: "self:holy/resurrection", judgment: "holy/holy-pillar~",
  technoblast: "beam:arcane/arcane-beam~", struggle: "impacts/blunt-hit", shedtail: "self:spawn/poof", spikecannon: "projectiles/arrow~",
  eggbomb: "projectile:projectiles/energy-disc~ | explosions/small-explosion", sonicboom: "projectiles/energy-disc~", razorwind: "melee/dagger-flurry~",
  bind: "nature/root-snare~", wrap: "nature/root-snare~", constrict: "nature/root-snare~", guillotine: "melee/double-slash~", visegrip: "melee/double-slash~",
  rapidspin: "melee/spin-slash~", smokescreen: "self:explosions/smoke-bomb", flash: "self:holy/sunburst", hyperdrill: "melee/thrust~", populationbomb: "melee/dagger-flurry~",
  doubleslap: "impacts/hit-spark~", cometpunch: "impacts/blunt-hit~", megakick: "impacts/crit-hit~", headbutt: "impacts/blunt-hit~", takedown: "impacts/blunt-hit~",
  endure: "self:status/rage",
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

// Effects pinned by hand (the explorer, REST /api/pixelfx/pins, MCP pixelfx_pin): move id -> {effect, tint, color?, role?}. They win.
let PINS = new Map();
const moveId = (m) => String(m ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
/** Replace the pinned effects (an object or a list of {move, effect, tint, color, role}). */
export function setPins(pins) {
  const next = new Map();
  const list = Array.isArray(pins) ? pins : Object.entries(pins || {}).map(([move, p]) => ({ move, ...(typeof p === "string" ? { effect: p } : p) }));
  for (const p of list) {
    const id = moveId(p.move);
    if (!id || !p.effect) continue;
    next.set(id, { id: String(p.effect), tint: !!p.tint, ...(HEX.test(p.color || "") ? { color: p.color.toLowerCase() } : {}), ...(ROLES.includes(p.role) ? { role: p.role } : {}) });
  }
  PINS = next;
}
export const pinnedMoves = () => Object.fromEntries(PINS);

const withRole = (cell, role) => {
  const info = ROLE_INFO[role];
  const out = { role, id: cell.id, tint: cell.tint, hold: info.hold, z: info.z };
  if (cell.color) out.color = cell.color;
  return out;
};

/** The effect for a move: {role, id, tint, color?, hold, z, source, hit?}. Every type, category and shape gives one; unknown types play
 * Normal's. With `move`, a pinned effect or the move's own row come first. */
export function pickEffect({ type, category, shape, move } = {}) {
  const base = roleOf(category, shape);
  const id = moveId(move);
  const pin = id && PINS.get(id);
  if (pin) return { ...withRole(pin, pin.role || MOVE_ROLE(id) || base), source: "pin" };
  const own = id && MOVE_TABLE[id];
  if (own) {
    const c = parseCell(own);
    const plan = { ...withRole(c, c.role || base), source: "move" };
    if (c.hit) plan.hit = { ...withRole(c.hit, "impact") };
    return plan;
  }
  const t = TYPE_TABLE[type] || TYPE_TABLE.Normal;
  return { ...withRole(split(t[base]), base), source: "type" };
}
function MOVE_ROLE(id) {
  const own = MOVE_TABLE[id];
  return own ? parseCell(own).role : undefined;
}

/** The effect of a hit on the target (a second, bigger one rides on critical and super effective hits). A move whose own effect plays on
 * the target (strikes, or a "| hit" cell) plays it instead of the type's. */
export function hitEffects({ type, crit = false, eff = 1, move, category, shape } = {}) {
  const t = TYPE_TABLE[type] || TYPE_TABLE.Normal;
  let first = { ...split(t.impact), role: "impact", hold: ROLE_INFO.impact.hold, z: ROLE_INFO.impact.z, source: "type" };
  if (move) {
    const plan = pickEffect({ type, category, shape, move });
    if (plan.source !== "type" && plan.role === "impact") first = plan;
    else if (plan.hit) first = { ...plan.hit, source: plan.source };
  }
  const list = [first];
  if (crit || eff > 1) list.push({ id: "impacts/crit-hit", tint: false, role: "impact", hold: 0.9, z: ROLE_INFO.impact.z });
  return list;
}

// Status conditions: `effect` plays where the Pokemon's pixels cannot be read (the turn-based screen), `body` on the Pokemon itself
// (frozen paints its own sprite icy, burning sets it alight) in real time.
export const STATUS_TABLE = Object.freeze({
  brn: "fire/torch", par: "lightning/spark-arc", psn: "nature/toxic-puddle~", tox: "nature/toxic-puddle~", frz: "ice/ice-crystal", slp: "arcane/rune-circle~",
});
export const STATUS_BODY = Object.freeze({
  brn: "status/burning", par: "lightning/electrified", psn: "status/poisoned", tox: "status/poisoned~#a33ea1", frz: "status/frozen", slp: "status/sleep",
});
const STATUS_TYPE = Object.freeze({ brn: "Fire", par: "Electric", psn: "Poison", tox: "Poison", frz: "Ice", slp: "Psychic" });

/** The effect of a status condition falling on a Pokemon, or null for a status that has none. */
export function statusEffect(status) {
  const cell = STATUS_TABLE[status];
  if (!cell) return null;
  return { ...split(cell), type: STATUS_TYPE[status], role: "self", hold: 1.2, z: 0, body: split(STATUS_BODY[status]) };
}

// Volatile conditions and battle events with a look of their own (all on the Pokemon, with a fallback where its pixels cannot be read).
export const EVENT_TABLE = Object.freeze({
  confused: "status/confused", flinch: "status/stunned", taunt: "status/rage", torment: "status/rage", yawn: "status/sleep", curse: "status/cursed",
  healblock: "shadow/hex-sigil~#a33ea1", leechseed: "nature/root-snare", ingrain: "nature/root-snare", aquaring: "water/ripples", magnetrise: "scifi/jetpack",
  focusenergy: "lightning/charge-up~#ffb15c", substitute: "spawn/poof", attract: "status/charmed", trickroom: "arcane/time-stop~#f95587",
  gravity: "explosions/implosion~#a98ff3",
});
const EVENT_FALLBACK = Object.freeze({ "status/confused": "arcane/rune-circle~#ffe27a", "status/stunned": "impacts/hit-spark~#ffe27a", "status/rage": "arcane/mana-burst~#e0405a",
  "status/sleep": "arcane/rune-circle~#f95587", "status/cursed": "shadow/hex-sigil", "status/charmed": "pickups/heart-pickup", "lightning/charge-up": "arcane/spell-charge~#ffb15c" });
/** The effect of a volatile condition or a battle event ("confused", "flinch", a vol id...), or null. */
export function conditionEffect(kind) {
  const cell = EVENT_TABLE[kind];
  if (!cell) return null;
  const c = split(cell), fb = EVENT_FALLBACK[c.id];
  return { ...c, role: "self", hold: 1.4, z: 0, ...(fb ? { fallback: split(fb) } : {}) };
}

/** Stat boost (up) or drop (down), heal and faint. */
export function eventEffect(kind, up = true) {
  if (kind === "boost") return up ? { id: "arcane/mana-burst", tint: true, color: "#ffb15c", role: "self", hold: 1.0, z: 0 }
    : { id: "ice/snowflake-burst", tint: false, role: "self", hold: 1.0, z: 0 };
  if (kind === "heal") return { id: "holy/heal-aoe", tint: false, role: "self", hold: 1.2, z: 0 };
  if (kind === "faint") return { id: "explosions/smoke-bomb", tint: false, role: "self", hold: 0.9, z: 0 };
  return null;
}

// Weather and terrains: a looping screen-wide effect over the field while they last (recoloured where a colour follows "~").
export const WEATHER_TABLE = Object.freeze({
  raindance: "weather/rain", primordialsea: "weather/storm", snow: "weather/snow", snowscape: "weather/snow", hail: "weather/blizzard",
  sandstorm: "weather/blizzard~#e2bf65", sunnyday: "weather/god-rays", desolateland: "weather/god-rays~#ff8a3c", deltastream: "weather/clouds",
});
export const TERRAIN_TABLE = Object.freeze({
  electricterrain: "weather/fireflies~#f7d02c", grassyterrain: "weather/falling-leaves~#7ac74c", mistyterrain: "weather/fog~#f4b6d6",
  psychicterrain: "weather/aurora~#f95587",
});
/** The looping effect of a weather or terrain id, or null. */
export function fieldEffect(kind, id) {
  const cell = (kind === "terrain" ? TERRAIN_TABLE : WEATHER_TABLE)[id];
  return cell ? { ...split(cell), role: "screen", hold: Infinity, z: 0 } : null;
}

/** Every effect id the mapping can ask for (the registry must have them all). */
export function mappedIds() {
  const ids = new Set();
  const add = (cell) => { if (!cell) return; const c = parseCell(cell); ids.add(c.id); if (c.hit) ids.add(c.hit.id); };
  for (const t of Object.values(TYPE_TABLE)) for (const c of Object.values(t)) add(c);
  for (const c of Object.values(MOVE_TABLE)) add(c);
  for (const c of [...Object.values(STATUS_TABLE), ...Object.values(STATUS_BODY), ...Object.values(EVENT_TABLE), ...Object.values(EVENT_FALLBACK)]) add(c);
  for (const c of [...Object.values(WEATHER_TABLE), ...Object.values(TERRAIN_TABLE)]) add(c);
  for (const k of [["boost", true], ["boost", false], ["heal"], ["faint"]]) ids.add(eventEffect(...k).id);
  ids.add("impacts/crit-hit");
  ids.add("impacts/hit-spark");
  return [...ids].sort();
}

/** The moves with an effect of their own (MOVE_TABLE), by id. */
export const ownMoves = () => Object.keys(MOVE_TABLE).filter((k) => MOVE_TABLE[k]).sort();

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
