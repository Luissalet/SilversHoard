---
name: Silver's Hoard
description: Slate and silver game menus with gold selection and cyan/coral battle corners.
colors:
  accent: "#f3cd69"
  accent-strong: "#ffe4a1"
  accent-ink: "#171e24"
  accent-soft: "#f3cd691a"
  deep: "#101922"
  sunken: "#0b121b"
  surface: "#192631"
  elevated: "#243541"
  border: "#415360"
  border-hover: "#7893a2"
  text: "#f0f4ed"
  text-muted: "#bacbd1"
  text-dim: "#a3b7c0"
  corner-blue: "#6cd6ec"
  corner-red: "#fa8b81"
  danger: "#c4463a"
typography:
  display:
    fontFamily: "Barlow Condensed, Arial Narrow, sans-serif"
    fontSize: "clamp(2rem, 3.5vw, 3.3rem)"
    fontWeight: 800
    lineHeight: 1
    letterSpacing: "0.005em"
  title:
    fontFamily: "Source Sans 3, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Noto Sans, Liberation Sans, Arial, sans-serif"
    fontSize: "15px"
    fontWeight: 750
    letterSpacing: "-0.005em"
  body:
    fontFamily: "Source Sans 3, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Noto Sans, Liberation Sans, Arial, sans-serif"
    fontSize: "13.5px"
    lineHeight: 1.5
  label:
    fontFamily: "Source Sans 3, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Noto Sans, Liberation Sans, Arial, sans-serif"
    fontSize: "12px"
    fontWeight: 600
rounded:
  sm: "3px"
  default: "5px"
  lg: "8px"
  control: "4px"
spacing:
  grid-gap: "10px"
  card-padding: "12px"
  panel-padding: "12px 14px"
  control-padding: "4px 12px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accent-ink}"
    rounded: "{rounded.control}"
    padding: "{spacing.control-padding}"
  button-primary-hover:
    backgroundColor: "{colors.accent-strong}"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.text}"
    rounded: "{rounded.control}"
    padding: "{spacing.control-padding}"
  field:
    backgroundColor: "{colors.sunken}"
    textColor: "{colors.text}"
    rounded: "{rounded.control}"
    padding: "5px 9px"
  navigation-active:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accent-ink}"
    rounded: "{rounded.control}"
  chip:
    backgroundColor: "{colors.elevated}"
    textColor: "{colors.text-muted}"
    rounded: "{rounded.sm}"
    padding: "1px 8px"
  panel:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.lg}"
    padding: "{spacing.panel-padding}"
---

# Design System: Silver's Hoard

## Overview

**Creative North Star: "Handheld fighting cabinet"**

Slate metal surfaces, silver text and warm gold selections frame the existing Silver emblem, trainer portraits and supplied Pokémon sprites. Condensed italic display lettering gives menus and battle names weight; compact sans-serif controls keep the dense tools readable. Cyan and coral identify the two battle corners.

This is a descriptive record of the current implementation, reconciled with the reference-led direction in `.impeccable/surfaces/client-src-app-jsx.md`. The authoritative presentation layer is `client/src/arcade.css`, over the shared theme, `index.css`, `app.css` and existing battle styles. `App.jsx`, `Inicio.jsx`, `Combatir.jsx` and the ordinary real-time show renderer demonstrate its use; captures in `.impeccable/review/` record desktop, mobile, home, classic and real-time surfaces. No separate approved comp or quality-bar card is claimed.

**Key Characteristics:**
- Slate layers and silver text with warm gold active states.
- Self-hosted condensed italic display lettering beside compact sans-serif controls.
- Existing emblem, trainer portraits and pixel sprites as the visual identity.
- Cyan/coral battle corners, bevelled controls and restrained selection lifts.
- Bounded body acting and readable damage bursts in ordinary real-time combat.

## Colors

### Primary

Warm gold `accent` marks primary actions, selected navigation, selected segmented controls, links and focus. `accent-strong` brightens hover; `accent-ink` supplies the dark foreground. `accent-soft` supports quieter selected surfaces. The frontmatter records the current values rather than the former brown/crimson palette.

### Secondary

Cyan `corner-blue` and coral `corner-red` identify side A and side B respectively in matchup panels and battle HUDs. Their borders and tinted backgrounds connect setup with combat without replacing Pokémon type colors or semantic status colors.

### Neutral

Deep slate `deep` frames the shell, `sunken` recesses fields, `surface` holds panels and `elevated` strengthens hover layers. `border` and `border-hover` separate controls. Silver `text`, `text-muted` and `text-dim` establish the reading hierarchy. The main canvas and home panels use closely related slate shades already in the presentation stylesheet.

The inherited danger token remains available for destructive actions and errors. Type markers, HP, status colors, battle effects and the Faustus launcher keep their established semantic roles.

**The Corner Continuity Rule.** Carry cyan and coral consistently from the two setup seats into battle information; retain text names and labels alongside color.

## Typography

**Display Font:** Barlow Condensed, with Arial Narrow and sans-serif fallbacks. The extra-bold italic face is self-hosted from `client/src/assets/BarlowCondensed-ExtraBoldItalic.ttf` with font-display swap.

**Body Font:** Source Sans 3 with the existing system sans-serif fallbacks. Body, labels, fields and ordinary buttons retain this stack.

**Label/Mono Font:** Labels use the body family; code and team-paste text retain JetBrains Mono and monospace fallbacks.

Page headings use the display token, italic and uppercase. The home title expands to `clamp(2.5rem, 5vw, 4.75rem)` and becomes (38px) below (768px). Brand, shortcut titles, seat labels, trainer names, score figures and the real-time timer reuse the condensed display character at their local scales. Section headings remain sans-serif; help text is (12.5px), ordinary buttons (13px) and small buttons (12.5px). Timers and numeric controls use tabular figures where already implemented.

**The Display Separation Rule.** Use condensed italic lettering for the established display roles; keep instructions, fields and dense working controls in the existing sans-serif family.

## Layout

The ordinary shell retains a (220px) desktop sidebar at (768px) and above. Below that breakpoint, the sticky header carries horizontally scrolling navigation. All existing destinations, labels, language controls and badges remain accessible. Main content uses (16px) horizontal padding on mobile and (28px) on desktop. The bare video route retains its dedicated stage without ordinary shell chrome.

Home keeps its emblem/title block, counts, shortcuts and live/recent activity. Shortcuts use an auto-fit grid bounded by `min(230px, 100%)`, with (12px) gaps; their sprite and text occupy two columns. Mobile count summaries use three columns.

Battle setup keeps the existing tabs, trainer selectors, AI/human controls, rules, mode and start actions. Two seats sit side by side from (1024px), with (22px) separation and a decorative VS at the center; smaller layouts stack them. Each seat contains a substantial portrait, wrapping trainer name and team strip above the existing picker. Mobile portraits fit a (110px by 125px) box. Long names wrap, and the preview follows the selected team rather than decorative substitutes.

Library cards retain auto-fill grids and wrapping team strips. The native trainer picker stays in flow with search and labelled filters, scrollable results and existing keyboard disclosure behavior. Team analysis retains its local horizontal matrix scroll; type practice retains four desktop/two mobile answer columns and its existing focus clearance.

Music retains playlist controls above the library and ordered queue, wrapping row actions, and its persistent bottom dock. The queue follows the library at (1000px) and below; the dock spans the mobile viewport below (768px). Existing content clearance beneath the dock and beside the Faustus launcher remains necessary. It inherits the new slate/gold palette through the shared variables without changing import, playback or queue behavior.

## Elevation & Depth

Depth comes from slate tonal layers, thin lighter borders and compact bottom bevels rather than broad floating cards. Primary controls have a darker gold bottom edge; pressing moves ordinary buttons down (2px). Trainer, gym, league and stage links lift (2px) on hover; home shortcuts lift (3px). Source sprites carry small dark drop shadows where already used. Battle cards use near-opaque dark surfaces and crisp cyan/coral edges; the classic cards remove backdrop blur.

Shared overlays retain the existing ambient shadow (`0 8px 28px rgba(0, 0, 0, 0.38)`). Selection and navigation do not add a general glow system.

## Shapes

The shared radius scale is small (3px), default (5px) and large (8px); ordinary controls use (4px). Small squared corners, straight dividers and bottom bevels establish the cabinet character. Home shortcuts and real-time pads use (6px) corners. HP bars are thin rectangular tracks with (2px) corners. The existing pill forms for type/status metadata and round semantic markers remain appropriate in their established roles.

Portraits contain their source art without cropping. Large setup portraits have transparent, square-edged presentation. Pixel sprites retain pixel rendering; existing artwork classification continues to allow smooth rendering for non-pixel artwork. Supplied raster provenance remains with its asset metadata and credits.

## Components

### Buttons

Ordinary buttons have a (36px) minimum height, the shared control padding and a thicker bottom border; small buttons have a (30px) minimum height and (2px 9px) padding. Gold primary buttons use dark labels, brighter gold hover and a dark gold bottom edge. Secondary buttons remain transparent at rest and use the elevated surface and stronger border on hover. Disabled buttons retain the existing (.42) opacity. Keyboard focus retains a (2px) accent outline with (1px) offset.

State transitions last (160ms). Pressed buttons move down (2px). The shared reduced-motion treatment removes transitions and animation. Existing local button variants, including music and type practice treatments, continue to use their scoped styles; do not propagate a local override as the global default.

### Inputs / Fields

Fields and native selects use the sunken surface, a thin border, (4px) corners, (36px) minimum height and (5px 9px) padding. Focus changes the border to gold and adds a one-pixel accent ring. Visible labels, native selects, range inputs, checkboxes and disclosure semantics remain intact.

### Navigation and Chips

Navigation uses compact sans-serif labels with supplied menu sprites where available and existing SVG icons otherwise. Active routes are filled gold with dark text; hover uses elevated slate and a border. Sprites lift (2px) and rotate slightly on hover. Desktop links have a (39px) minimum height; mobile links have a (42px) minimum height and remain horizontally scrollable. Badges remain readable inside the active route. Metadata chips retain elevated surfaces, muted labels, small corners and explicit text.

### Cards and Trainer Selection

Panels use the shared surface, border, large radius and panel padding. Trainer library links retain names, optional titles, portraits, chips and team strips. The picker retains its native disclosure, filter labels, saved/catalog choices and actionable retry states. Selected choices use a subdued gold tint and the portrait lift; selection does not conceal other options.

### Home Shortcuts

Each shortcut pairs an enlarged supplied sprite with a condensed uppercase label and sans-serif help. The first action uses gold; the remaining actions use slate. Hover raises the tile and gently rotates/scales its sprite. The emblem and sprite shadows give the art separation without changing the source pixels.

### Battle Presentation and Motion

Classic and ordinary real-time combat inherit the sharper slate/gold controls and cyan/coral side information. Existing HUD content, move typing, settings, keyboard controls, log, replay inspection and modes remain available. Existing atlases, source rectangles, material scales and reduced-motion still frames remain authoritative; this visual pass does not change simulation geometry, damage, RNG or saved replay rules.

The ordinary real-time show renderer adds target-anchored elliptical contact rings beneath the sprites. Positive damage on the first hit triggers a type-colored ring; critical, super-effective and KO hits use a larger ring with short radial marks. Normal rings last (320ms); strong rings (480ms). The Show clock advances their age only during playback, so paused playback does not accumulate motion. Reduced motion uses a fixed ring shape and omits the radial burst. Existing camera and impact-frame settings keep their prior behavior. This accent layer belongs to ordinary real-time Show presentation; it is not a new mass-battle or classic effect implementation.

Ordinary real-time fighters brace during anticipation, impulse on release and recover through a single decelerating recoil. Melee releases reach farther than ranged releases; protection braces, genuine misses give the aimed defender a sidestep, and healing gives a small lift. Fog misses do not imply a dodge. Four fixed reaction slots cover singles and doubles, merging simultaneous hits into the strongest bounded impulse. A hit recoils away from an identifiable releasing unit; ambiguous same-move releases in doubles compress in place without inventing a lateral direction. Release, block and dodge acting last (280ms), hit recovery (360ms) and healing (550ms).

Body transforms wrap PMD, imported walking and static fallback art. Static fallbacks share the cached white hit silhouette. Direction maps to the portrait camera while sprites and figures remain upright. Ground rings, HP bars, reticles, collision and targeting retain their physical anchors. Dig, Fly, Bounce, Rollout, Ice Ball and Seismic Toss retain their special choreography without the added ordinary anticipation/release lean. Recall, switch and replay reset clear the relevant acting; party-slot identity prevents a replacement inheriting it, and fainted fighters retain their existing fade.

Damage figures use the bundled condensed italic face, a brief scale accent, short rise and late fade over their (1.1s) lifetime. A same-tick multihit burst for the same move, unit and party slot becomes one total with a count, such as `−13% ×5`, retaining the strongest emphasis and the existing percentage/HP preference. Later attacks remain separate. Body acting, particles and figures follow replay speed and hit-stop through the renderer delta; Show overlays retain their real-seconds delta. Pause freezes both clocks, and seek constructs a fresh effect owner. Reduced motion removes the added displacement, rotation, squash and damage-number travel/scale while keeping hit flashes, damage figures and outcome labels visible. This refinement creates no new raster assets or provenance records.

Menu entry uses a small (7px) upward arrival over (280ms). Hover lifts remain brief. Reduced-motion CSS removes the added menu animation and transitions; the existing battle renderer continues its own reduced-motion policy.

**The Presentation Clock Rule.** Advance ordinary RT body acting, particles and damage figures with the renderer's pause- and replay-speed-aware delta; keep Show overlays on their existing real-seconds delta, and reset transient owners on replay seek.

**The Existing Material Rule.** Preserve atlas geometry, transparent source pixels, provenance, declared display scales and visible still frames; add presentation around the supplied art without rewriting combat rules.

Portable battle pages include the presentation stylesheet and available assets when newly generated; recorded ordinary RT replays use the same reaction renderer. Previously exported standalone HTML is a snapshot and requires re-export to receive this appearance. Existing portable fallbacks, ordinary/mass/classic material coverage and export limitations remain documented in the corresponding files under `docs/`; the new rings and body acting do not broaden that coverage or change classic/mass choreography.

## Do's and Don'ts

### Do:
- **Do** use slate surfaces, silver text and gold selected states from the current presentation layer.
- **Do** keep cyan/coral corners, readable trainer names and accurate team previews together.
- **Do** preserve existing routes, controls, language support, music behavior and gameplay while refining presentation.
- **Do** retain keyboard focus, reduced motion and the shared presentation clock.
- **Do** preserve supplied-sprite provenance and pixel geometry.

### Don't:
- **Don't** restore the stale brown/crimson palette or Cinzel page headings as the current global identity.
- **Don't** use display lettering for dense instructions or replace semantic type/status colors with corner colors.
- **Don't** imply that ordinary real-time rings and body acting also add a new mass-battle or classic effect layer.
- **Don't** claim that already exported HTML updates without re-exporting it.


Dynamax and Z presentation carries the same cabinet direction through energy gathering, a short command cut-in, source-sprite growth, storm clouds and type-shaped releases/confirmed impacts. The pink storm belongs to Dynamax state; Z energy reads the actual move type. Reduced motion and plain presentation keep state feedback. See `docs/VISUAL_PRESENTATION.md` for timing, owner and replay boundaries.

Move-specific special choreography uses the credited pixel-effect atlases: Max/G-Max and Z recipes distinguish material, direction and aftermath. Dynamax follows collection, ball throw and giant reveal; Ultra Necrozma adds starlight gathering and spectral columns. Shared primitives preserve replay/portrait/reduced-motion behavior.

Ultra Burst is a form-change focal moment: converging spectral rays, faceted light envelope, split facets and resolved PMD reveal. The control names Ultra Burst separately from Mega/Z; no gauge cost or fake giant scaling. Preserve stationary reduced-motion feedback and independent form assets.

Transformation spectacle uses anticipation, opaque concealment, one rupture and a clear PMD reveal. Ultra is spectral gold, Mega is a pink/violet double helix, Dynamax a red storm and heavy landing. Fragments are shell geometry, never distorted Pokémon limbs. One dark impact panel punctuates the reveal; Z/Max fractures require a confirmed hit. Keep names/HUD readable above the panel, uniform body proportions and stationary reduced-motion feedback.
