# Real-time Dynamax and Z-Moves

New battles and exported pages use rules13; saved versions1–12 retain their mechanics. These are real-time adaptations of the generation dex, using existing cooldowns, one-stage stat limits, statuses and physical hit/dodge rules. They do not change turn-based battles.

## Dynamax / Gigantamax

From generation8, once per trainer (shared between doubles slots). The button or B activates18seconds: three of the existing six-second turns. Max HP scales from1.5x to2x with Dynamax level; current HP scales in proportion, and Shedinja remains1HP. The renderer draws at2.2x using a uniform scale anchored at its registered feet. Growth takes220ms; reduced motion shows the full meaningful size immediately. Countdown and HP are visible. Recall, knockout or expiry restore the base look, HP and moves.

Damaging moves convert by type, using native Max base power and original category. Status moves become Max Guard; the original slot keeps its cooldown and any starting PP. A Gigantamax-capable set with gigantamax:true uses its exact Gmax sheet and signature move for the matching type. The other types remain standard Max moves. Max weather/terrain/stat effects and signature G-Max statuses, screens, hazards, healing, trapping and field effects use real-time timers. Effects that last four turns use24seconds; standard screens and gravity use30seconds; attraction/trapping use18seconds. Residual damage follows the existing four-second cadence. These timings are adaptations, not turn-engine parity.

Mega/Primal formes, forbidden species, a held Mega Stone or a Z crystal cannot activate Dynamax. Max Guard blocks Max/Z attacks; ordinary Protect takes a quarter of their damage. Already released special projectiles retain their power after the transformation ends; unfinished Max windups stop and enter cooldown. Flinching and forced switching cannot remove a Dynamax Pokémon.

## Z-Moves

From generation7, a matching held crystal enables a generic or species-specific Z move. Activate Z, then choose a compatible move in the diamond. Incompatible buttons are disabled while armed. The use is spent when windup starts, once per trainer shared by both doubles slots. Out-of-range approach does not spend it. Cancellation, a dodge or a miss after starting does not refund it. Damaging Z uses native power/category (including signatures); status Z applies the native bonus through existing real-time stat limits and then its ordinary effect. The base slot keeps its cooldown and PP cost. The crystal remains held. Dynamax and Z cannot be combined on the same active Pokémon.

## Controls

| Action | Solo keyboard | Two players | Z-A gamepad | Simple gamepad |
|---|---|---|---|---|
| Dynamax | B | B / N | ZR | ZL + ZR |
| Arm/disarm Z | Z | V / H | ZL + minus | ZL + minus |

After arming Z, use the ordinary move keys/buttons. The UI keeps used indicators and the Dynamax countdown; AI trainers use both through the same simulator inputs. Replays, saved battles, online frames and standalone result codes preserve both flags. `rt_rules`, `rt_cooldowns`, `battle_get` and `battle_rt_inspect` expose the same data to API/MCP.

## Generated artwork review

The1317 review checked69generated identities/138normal-shiny variants at native size and2x: Idle, WalkA/B/A and Attack in all four authored headings, using local anatomy/palette references. Fourteen variants with small or hidden supports were additionally captured in the actual Animator. The only HOLD was Darmanitan Galar Zen shiny's orange hands. Its16poses now use explicit fuchsia/red hand masks; alpha and geometry remain exact, and the correction passed independent visual review before compilation. Original supplied/published sources and the other137generated variants remain unchanged. Full evidence and source/sheet hashes: D:/LocalAI/research-inbox/silver-quality1317/review-generated-art1317.md and resolved-matrix.json. This is a finite artistic review, not a mathematical guarantee of perfect anatomy.
