---
version: 1
slug: "client-src-app-jsx"
primary_target: "client/src/App.jsx"
related_targets: ["client/src/arcade.css","client/src/pages/Inicio.jsx","client/src/pages/Combatir.jsx","client/src/battle/rt/show.js","client/src/battle/rt/render.js","client/src/battle/rt/RtScreen.jsx","client/src/battle/rt/pmd.js","client/src/battle/rt/visuals/reactions.js","client/src/battle/rt/visuals/choreography.js"]
---

# Menu and combat presentation

25 October 2026 — Damage/defeat refinement #1502: keep this visual world and
original art. Pain requires one hit >35% maximum HP; HitGround ends downed, never
standing back up. The body has its own owner until the red return beam, with a
2.4-second minimum hold, including when a replacement appears sooner. Original
published sequences and explicit identity-preserving runtime acting cover all
2,938 normal/shiny variants. See [behavior and limits](../../BATTLE_REACTIONS.md).

Mode: Operate for menus; Experience for the battle presentation. Preserve all routes, controls, game rules and saved data. This session is built directly in code from Luis's concrete visual references, without storing a new workflow default.

## Direction contract

THESIS: Silver's existing functions presented as a handheld fighting cabinet, with trainers and source sprites carrying the identity.

OWN-WORLD: Slate metal, silver text, warm gold selections, cyan and coral corners, compact bevelled controls and condensed italic display lettering.

STORY: Find the same section, select the same trainer, read the same battle; selection and impact now have weight.

FIRST VIEWPORT: Existing navigation left, large title above the same controls; battle selection shows two substantial trainer portraits, their names and teams. VS separates the corners. Primary actions remain in place.

FORM: Reference-led fighting cabinet, seed key silver-pocket-brawl-1168; no gameplay restructuring. Signature interaction is a sprite lift on menu selection and a target-anchored contact ring in combat.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Ordinary real-time motion refinement (#1169)

Continue the existing cabinet direction and Luis's combat references through anticipation, release, recoil, block, dodge and healing around the supplied sprites. Preserve gameplay, routes, controls, physical anchors, source-art geometry and saved replay inputs. This scope covers ordinary RT singles and doubles, its portrait camera, recording and freshly generated portable pages. Classic and mass choreography retain their existing behavior; old HTML needs re-export. No new raster art or provenance is introduced.

The implemented grammar is recorded in DESIGN.md and `docs/VISUAL_PRESENTATION.md`: four bounded acting slots, static-fallback hit flash, ambiguity-safe doubles, one multihit total with `×N`, and upright portrait feedback. Body acting and figures follow the replay-speed-aware renderer delta; Show overlays keep their real-seconds delta. Pause holds both clocks, seek resets transient owners, and reduced motion retains flashes, figures and outcome labels without the added spatial, squash or number-travel effects.

Evidence: `.impeccable/review/motion1169/desktop-final.png`, `multihit-doubles.png`, `mobile.png` and `portrait.png`. The desktop and directed doubles captures show readable individual and grouped damage; mobile and portrait captures retain the cabinet, controls and upright feedback. Still captures do not establish temporal parity with the references, every species or every reaction state.

Finish review: `D:/LocalAI/research-inbox/silver-motion-20261023/finish-review.md`; fix-list verdict: `D:/LocalAI/research-inbox/silver-motion-20261023/finish-verdict.md`. All three listed findings are resolved: multihit overlap, ambiguous doubles direction and Rollout/Ice Ball exclusion. The disposition is ship at that fix-list scope. It does not claim whole-product approval, independent continuous browser playback, all replay speeds or a green full Python suite.


## Dynamax and Z motion refinement (#1327)

Extend ordinary RT presentation, including portrait and fresh HTML, with event-driven energy gathering, uniform Dynamax growth and storm clouds, Z crystal charge, actual projectile accents and confirmed-hit remates. Preserve mechanics, source sprite pixels, controls, replay inputs and previous presentation settings. No new raster assets or dependencies. `SpecialPresentation` owns bounded transient effects; pause/seek and reduced motion retain their explicit paths. Detector advisories remain the two inherited renderer colors. Current evidence and independent verdict are under `D:/LocalAI/research-inbox/silver-special1327`; this note does not certify every move or competitor parity.

Luis’s further steering rejects a generic enlarged ball/ray. The same1327 now adapts observed Sword/Shield and USUM reference sequences, with87 move recipes and a published-PMD Ultra Necrozma showcase. This extends the motion refinement and does not change gameplay or add Ultra Burst.

23 Oct 2026 — Luis corrected Ultra Necrozma: it must activate in battle, not begin as a standalone team species. Rules 14 uses fused Necrozma + Ultranecrozium Z, separate Ultra Burst and later Z, with exact PMD normal/shiny assets. Original official Dusk/Dawn clips were inspected; new motion follows the prism/reveal sequence while preserving the incumbent UI and reduced-motion contract.
