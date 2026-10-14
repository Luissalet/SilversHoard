// Data from Pokémon Legends: Z-A, the game whose real-time battles this mode follows. Moves there have no PP: each one has a
// cooldown in seconds (3 to 60) that starts when the move ends and that the user's Speed shortens. Values collected from
// Serebii's list of usable moves (serebii.net/legendsz-a/attacks.shtml) and Bulbapedia (Cooldown, List of moves in Legends: Z-A).

/** Base cooldown in seconds of every move usable in Legends: Z-A, by Showdown move id. */
export const ZA_COOLDOWN = {
  absorb:7, acidarmor:9, acidspray:7, aerialace:9, agility:12, airslash:7, amnesia:9, ancientpower:6, aquajet:3, aquaring:10,
  armorcannon:12, aurasphere:8, aurawheel:15, barbbarrage:8, bite:6, bitterblade:9, blastburn:20, blazekick:7, blizzard:12,
  bodyslam:8, bonemerang:7, boomburst:12, bounce:12, bravebird:10, breakingswipe:9, brickbreak:7, brutalswing:6, bubblebeam:6,
  bugbuzz:8, bulkup:18, bulldoze:6, bulletpunch:3, bulletseed:6, calmmind:18, charge:10, chargebeam:6, charm:10,
  chillingwater:7, circlethrow:6, closecombat:12, cometpunch:6, confuseray:6, confusion:6, conversion:15, conversion2:15,
  coreenforcer:15, cottonguard:10, crunch:8, curse:15, darkpulse:8, darkvoid:12, dazzlinggleam:8, detect:13, diamondstorm:10,
  dig:12, disarmingvoice:6, discharge:8, doubleedge:10, doublehit:6, doubleironbash:10, doubleteam:15, dracometeor:10,
  dragonascent:20, dragonbreath:6, dragonclaw:8, dragonpulse:8, dragonrush:12, drainingkiss:7, drainpunch:7, dreameater:7,
  drillrun:8, dualchop:6, dualwingbeat:6, dynamicpunch:12, earthpower:8, earthquake:10, eerieimpulse:10, electroweb:7,
  ember:6, endure:12, energyball:8, explosion:15, extremespeed:3, facade:7, fairywind:6, fakeout:3, faketears:10,
  falseswipe:6, featherdance:10, fireblast:10, firefang:6, firepunch:7, firespin:7, firstimpression:6, fissure:20,
  flamecharge:6, flamethrower:8, flamewheel:6, flareblitz:8, flashcannon:8, fleurcannon:10, flipturn:12, fly:12,
  flyingpress:9, focusblast:12, focusenergy:10, freezedry:9, frenzyplant:20, frostbreath:7, futuresight:10, geomancy:30,
  gigadrain:9, gigaimpact:20, gigatonhammer:30, glaiverush:12, glare:8, growl:6, growth:15, gunkshot:10, gust:6, harden:6,
  haze:15, headbutt:7, headsmash:10, healblock:12, heatcrash:10, heatwave:9, heavyslam:10, hornleech:9, hurricane:10,
  hydrocannon:20, hydropump:12, hyperbeam:20, hyperspacefury:10, hyperspacehole:8, hypervoice:8, hypnosis:10, icebeam:8,
  icefang:6, icehammer:10, icepunch:7, iceshard:3, iciclecrash:8, iciclespear:6, icywind:7, infestation:6, irondefense:9,
  ironhead:8, irontail:10, knockoff:10, lastrespects:8, lavaplume:8, leafage:6, leafblade:8, leafstorm:10, leechlife:9,
  leechseed:12, leer:6, lick:6, lightofruin:15, lightscreen:12, liquidation:8, lowsweep:6, lunge:9, lusterpurge:8,
  machpunch:3, magicalleaf:6, magmastorm:12, magnetbomb:8, makeitrain:10, megahorn:10, metalclaw:6, metalsound:10,
  meteorassault:20, meteorbeam:12, metronome:4, mimic:6, mist:10, mistball:8, moonblast:8, moonlight:15, morningsun:15,
  mortalspin:6, muddywater:8, mudshot:6, mysticalfire:8, nastyplot:15, nightslash:7, nihillight:15, noretreat:60, nuzzle:6,
  oblivionwing:12, octolock:12, ominouswind:6, orderup:8, originpulse:16, outrage:15, overdrive:8, overheat:10,
  paraboliccharge:9, partingshot:12, payday:6, peck:6, perishsong:20, petaldance:10, phantomforce:12, pinmissile:6,
  plasmafists:10, playrough:8, poisonfang:6, poisonjab:8, poisonpowder:10, poisonsting:6, powergem:8, poweruppunch:10,
  powerwhip:12, precipiceblades:16, protect:15, psybeam:6, psychic:8, psychicfangs:8, psychocut:7, psyshock:8, psystrike:9,
  quickattack:3, ragefist:8, razorleaf:6, razorwind:12, recover:15, reflect:12, relicsong:30, roar:6, rockblast:6,
  rockslide:7, rocksmash:6, rockthrow:6, rocktomb:10, rollout:6, sacredsword:8, safeguard:12, saltcure:8, sandtomb:7, scald:7,
  scaleshot:6, scorchingsands:7, screech:10, secretsword:8, seedbomb:7, selfdestruct:15, shadowball:8, shadowbone:7,
  shadowclaw:7, shadowpunch:6, shadowsneak:3, shedtail:12, sheercold:20, shoreup:15, silverwind:6, sing:6, skullbash:12,
  skyattack:10, slash:7, sleeppowder:10, sludgebomb:7, sludgewave:8, smokescreen:10, snarl:9, solarbeam:12, solarblade:12,
  spark:6, spectralthief:15, spicyextract:12, spikes:7, spikyshield:15, splash:4, spore:10, stealthrock:10, steameruption:10,
  steelbeam:20, steelwing:7, stickyweb:7, stoneaxe:10, stoneedge:10, stormthrow:7, stringshot:9, stunspore:10, substitute:10,
  superfang:9, supersonic:6, surf:8, swagger:10, swift:5, swordsdance:15, synthesis:15, tackle:4, tailwhip:7, takedown:8,
  taunt:12, technoblast:12, teleport:7, thousandarrows:10, thousandwaves:10, thunder:10, thunderbolt:8, thunderfang:6,
  thunderpunch:7, thundershock:6, thunderwave:10, topsyturvy:10, torment:12, toxic:10, toxicspikes:7, trailblaze:6,
  triattack:7, trickortreat:10, tripleaxel:10, twister:6, uturn:12, vacuumwave:3, vinewhip:6, voltswitch:12, volttackle:9,
  waterfall:8, watergun:6, waterpulse:6, watershuriken:3, whirlpool:7, whirlwind:7, wildcharge:8, willowisp:10, wingattack:6,
  wish:12, woodhammer:10, workup:15, xscissor:8, zapcannon:15, zenheadbutt:8,
};

/** Moves whose power Legends: Z-A changes for real time (fast moves weaker; multi-hit moves hit a fixed number of times). */
export const ZA_POWER = {
  aquajet: 30, bulletpunch: 30, machpunch: 30, quickattack: 30, extremespeed: 65, iceshard: 40, shadowsneak: 40,
  bonemerang: 55, bulletseed: 15, cometpunch: 30, doublehit: 50, dualchop: 45, dualwingbeat: 45, firespin: 20, frostbreath: 65,
  magnetbomb: 95, nihillight: 200, petaldance: 40, pinmissile: 15, poisonsting: 30, razorwind: 40, rockblast: 15, rollout: 60,
  sandtomb: 20, scaleshot: 15, seedbomb: 35, skullbash: 150, stormthrow: 65, trailblaze: 40, triattack: 40, tripleaxel: 40, whirlpool: 20,
  iciclespear: 25,
};

/** Hits per use in Legends: Z-A (moves that hit 2-5 times in the turn-based games always hit this many times). */
export const ZA_HITS = {
  bulletseed: 5, cometpunch: 5, iciclespear: 5, pinmissile: 5, rockblast: 5, scaleshot: 5, razorwind: 5, seedbomb: 4,
  petaldance: 3, triattack: 3, tripleaxel: 3, bonemerang: 2, doublehit: 2, dualchop: 2, dualwingbeat: 2, doubleironbash: 2,
};

/** Cooldown limits and the Speed rule: final = max(3, base - 3 * max(0, floor(Speed * modifier) - 25) / 100). */
export const COOLDOWN_MIN = 3;
export const COOLDOWN_MAX = 60;
export const SPEED_FLOOR = 25;
export const SECONDS_PER_100_SPEED = 3;
