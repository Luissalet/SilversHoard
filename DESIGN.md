---
name: Silver's Hoard
description: Existing visual system for trainer selection and the saved trainer library.
colors:
  accent: "#e2404f"
  accent-strong: "#e76370"
  accent-ink: "#ffffff"
  accent-soft: "rgba(226, 64, 79, 0.14)"
  deep: "#1c1415"
  sunken: "#161011"
  surface: "#241b1c"
  elevated: "#2f2526"
  border: "#433536"
  border-hover: "#6a5859"
  text: "#ece1e2"
  text-muted: "#beb4b5"
  text-dim: "#a69b9c"
  danger: "#c4463a"
typography:
  headline:
    fontFamily: "Cinzel, Iowan Old Style, Charter, Georgia, Liberation Serif, Noto Serif, Times New Roman, serif"
    fontSize: "28px"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "-0.005em"
  title:
    fontFamily: "Source Sans 3, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Noto Sans, Liberation Sans, Arial, sans-serif"
    fontSize: "15px"
    fontWeight: 650
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
  sm: "6px"
  default: "8px"
  lg: "10px"
spacing:
  filter-gap: ".5rem"
  grid-gap: "10px"
  card-padding: "12px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accent-ink}"
    rounded: "{rounded.default}"
    padding: "4px 12px"
  button-primary-hover:
    backgroundColor: "{colors.accent-strong}"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.text}"
    rounded: "{rounded.default}"
    padding: "4px 12px"
  field:
    backgroundColor: "{colors.sunken}"
    textColor: "{colors.text}"
    rounded: "{rounded.default}"
    padding: "5px 9px"
  navigation:
    textColor: "{colors.text-muted}"
    rounded: "{rounded.default}"
    padding: "0 12px"
  chip:
    backgroundColor: "{colors.elevated}"
    textColor: "{colors.text-muted}"
    rounded: "{rounded.sm}"
    padding: "1px 8px"
  trainer-card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.lg}"
    padding: "12px"
  trainer-picker:
    rounded: ".6rem"
---

# Design System: Silver's Hoard

## Overview

**Creative North Star: "Inherited Silver's Hoard visual system"**

This is a descriptive scan of the existing implementation, not a newly approved metaphor or replacement identity. Warm, dark brown surfaces, a crimson accent, serif page headings and compact sans-serif controls frame trainer portraits and Pokémon team strips. The interface uses dense, labelled controls and restrained borders to support selecting and managing trainers.

The documented change is limited to the shared visual trainer picker and saved trainer library. The surrounding shell, theme, assets and other screens remain inherited. Sources are `client/src/hoard-theme.css` (the `silver` palette), `client/src/index.css`, `client/src/app.css`, `client/src/components/silver.jsx` and `client/src/pages/Entrenadores.jsx`; the supplied desktop/mobile captures confirm the incumbent appearance. This scan does not establish new product strategy or claim an approved visual comp.

**Key Characteristics:**
- Warm dark surfaces with a single crimson action accent.
- Serif page headings paired with compact sans-serif labels.
- Trainer portraits and team sprites beside readable names.
- Native disclosure and select controls with wrapping filter rows.

## Colors

### Primary

Crimson `accent` identifies primary actions, links and focus outlines. `accent-strong` is the primary button hover state; `accent-ink` is its foreground. `accent-soft` supplies the fallback portrait background and selected segmented controls.

### Neutral

The warm `deep` canvas supports `surface` cards and `elevated` interaction layers. Fields use `sunken`; `border` separates surfaces and `border-hover` strengthens interactive edges. `text`, `text-muted` and `text-dim` distinguish names, supporting content and quieter metadata. The frontmatter records the actual shared palette values.

### Semantic

The inherited `danger` color supplies error borders and a translucent error banner background. Status colors elsewhere in the application remain inherited and are outside this focused inventory.

## Typography

**Display Font:** Cinzel with the serif fallback stack in the frontmatter.

**Body Font:** Source Sans 3 with system sans-serif fallbacks.

**Label/Mono Font:** Labels use the body family; inherited code and team-paste text use JetBrains Mono with monospace fallbacks.

The serif is concentrated in page headings and the brand. Names, buttons, filters and metadata use compact sans-serif text. Page headings use the headline token and reduce to (23px) below (768px). Section headings use the title token; smaller headings use (13.5px), weight (650). Labels use the label token; help text uses (12.5px). Buttons use (13px), weight (600), and small buttons use (12.5px).

## Layout

The inherited shell has a (220px) sidebar and (64px) desktop brand/header height. At (768px) and above navigation is vertical; below it, navigation flows horizontally with overflow scrolling. Page headers and their actions wrap, with a (280px) flexible heading basis and a (14px) gap in the page stylesheet.

Library cards use an auto-fill grid with (10px) gaps and a minimum width bounded by `min(300px, 100%)`. Cards contain a (72px) portrait beside the name, optional title, team strip and chips.

The shared picker is an in-flow native disclosure. Its summary has a (48px) portrait; saved and catalog choices use (56px) portraits. Filters wrap with a (.5rem) gap and each labelled field has an (8rem) flexible basis. Results scroll within (20rem), contain scroll chaining, and use an auto-fit grid bounded by `min(100%, 11rem)` with (.35rem) gaps. Long picker names wrap. The character team chooser appears above results with a (64px) portrait, exact-team select, sprite strip and primary action.

## Elevation & Depth

The documented cards and picker rely on tonal layers and thin borders. The inherited navigation uses an inset accent indicator for the active route: a vertical (3px) mark on desktop and a bottom (2px) mark on mobile. The shared theme also defines an ambient shadow for inherited overlays; no new overlay or shadow system was introduced by this work.

## Shapes

The inherited radius scale is small (6px), default (8px) and large (10px). Trainer cards and portrait backgrounds use the large radius. Picker disclosure corners use (.6rem); choice buttons use (.4rem). Portraits contain their images without cropping. Pixel sprites retain pixel rendering; the existing artwork classification can preserve smooth rendering for non-pixel artwork.

## Components

### Buttons

Compact bordered controls use the default radius, (32px) minimum height and (4px 12px) padding. Primary actions fill with the accent; secondary actions remain transparent until hover. Small controls use (28px) minimum height and (2px 9px) padding. Disabled buttons reduce opacity to (.42). The shared focus-visible outline is (2px) accent with a (1px) offset. State transitions last (.12s); inherited reduced-motion handling removes transitions and animation.

### Chips

Small metadata labels use the elevated background, muted text, small radius, (11.5px) text and (1px 8px) padding. Trainer cards use these for origin, AI level and optional record.

### Cards / Containers

Library cards are linked, bordered surface containers with (12px) internal padding and a (12px) content gap. Hover strengthens the border. Team sprites wrap within the card. The existing panel primitive uses (12px 14px) padding and the large radius.

### Inputs / Fields

Search fields and native selects share a sunken background, thin border, default radius, (32px) minimum height and (5px 9px) padding. Focus shifts the border to the accent; keyboard focus retains the shared visible outline. Search inputs have accessible names; origin, region and game selects have visible wrapping labels.

### Navigation

The inherited shell uses sans-serif links with muted resting text and elevated hover/active backgrounds. Active navigation adds the inset accent indicator. Desktop links are (38px) tall with (14px) text; mobile links are (34px) tall with (13.5px) text. Icons are hidden below (441px) in the inherited stylesheet.

### Visual Trainer Picker

Native `details`/`summary` supplies disclosure interaction. A CSS chevron rotates with open state. Search and the shared origin/region/game selects precede a scrollable portrait/name grid. Saved choices expose `aria-pressed`; a successful selection closes the disclosure. Catalog characters open an explicit exact-team chooser before installation/selection. Alternate localized character names appear as supporting text where present. The same filter component serves the saved library.

Catalog failures appear as accessible alerts with Retry in both picker and library. The library separately retains its saved-trainer load error and retry action. Saved/generated trainer names remain data; an English interface can therefore display a previously saved Spanish name. English is the default UI language and Spanish remains an explicit option. Spanish-first translation arrays remain a compatibility detail, not a direction to reorder translations. Global translation task #640 and mass Surf/reuse task #641 are outside this implementation.

## Do's and Don'ts

### Do:
- **Do** reuse the inherited Silver palette and shared type stacks.
- **Do** keep trainer portraits, names and team strips together in selection and library views.
- **Do** retain labelled native selects, keyboard disclosure behavior and visible focus.
- **Do** keep catalog failures actionable through an alert and Retry.

### Don't:
- **Don't** infer a translated UI label from a saved trainer's name or overwrite names as part of UI localization.
- **Don't** treat this focused scan as a redesign of inherited screens or completion of tasks #640 and #641.
- **Don't** replace the established pixel portraits or warm dark/crimson identity during narrow refinements.


## Music library extension

This addition records only the implemented Music surface in `client/src/pages/Musica.jsx`, `client/src/music/MusicPlayer.jsx` and `client/src/music/music.css`. It inherits the visual system above. The final code and desktop/mobile captures are the evidence; no new identity, visual comp or raster asset was introduced. Functional behavior and limits are documented in `docs/MUSIC_LIBRARY.md`.

### Colors

Songs and queue entries use the inherited warm canvas, text and dividing border. Selected library/list buttons use `accent-soft`, ordinary text and an accent border. Queue titles and the dock's current-song link use the brighter `accent-strong`; the active queue occurrence also gains weight (650). Music primary buttons locally darken the inherited accent with `color-mix(in srgb, var(--accent) 90%, black)` and use white text; hover darkens it to (85% accent). These scoped variants do not redefine the shared palette or other screens' primary buttons.

**The Music Contrast Rule.** Use the brighter accent for song links and the locally darkened fill for white-labelled primary music actions; retain the inherited palette elsewhere.

### Typography

The page title retains the inherited serif headline and mobile size. Section headings use compact sans-serif text (15px). Song names use bold body text; source/size metadata uses the shared help style. The dock's song link uses weight (650) with one-line ellipsis, while library and queue titles can wrap anywhere. Elapsed/duration text uses the inherited tabular-number class at (.75rem); mode labels use (12px).

### Layout

The page is bounded by (1400px). A wrapping header pairs title/help with the MP3 import control. Playlist creation and wrapping list buttons sit above the working columns. Desktop uses a flexible library and a queue bounded between (250px) and (320px), separated by (1.75rem). At (1000px) and below the queue follows the library in one column. Song rows separate content with a bottom border and (.85rem) vertical padding; their action buttons wrap.

The player is fixed along the bottom of the ordinary app shell, begins after the (220px) desktop sidebar and uses the surface color with a single top border. Its desktop grid contains current song, transport and seek; modes occupy the next row. At (1000px) and below seek spans the player width. Below (768px) the dock spans the viewport with (.6rem 1rem) padding, filter fields fill the available width, and song/transport buttons have (40px) minimum height. The page reserves (12rem) below its content, rising to (15rem) on mobile; when the player exists the main content also reserves (15rem). Seek time and volume retain a (3.5rem) right inset beside the inherited floating Faustus control.

**The Music Flow Rule.** Keep playlist controls above the library and ordered queue, let row actions wrap, and reserve scrolling space for the persistent dock.

### Elevation & Depth

Music uses flat, border-separated rows rather than additional cards. The dock's fixed position and top border distinguish it from scrolling content; no new shadow vocabulary or animated visual effect is added.

### Shapes

Buttons, fields and list selectors reuse the inherited corner radii. Playback uses native range inputs, a checkbox and a select; their browser-rendered slider appearance is not a new Silver color token.

### Components

- **MP3 import:** a primary-styled label contains the native multiple-file input. Keyboard focus produces a (2px) accent outline with a (3px) offset. Dragging files over the page produces a dashed accent outline. Progress, failures and retry remain text/status or alert content.
- **Library and playlist rows:** title and source metadata precede wrapping actions. The library, each saved playlist and archived songs share the same row grammar. Selected view buttons expose `aria-pressed`; list counts remain inline with their names.
- **Ordered queue:** a numbered, wrapping song-title button precedes explicit up/down/remove controls. The current occurrence exposes `aria-current` and a stronger title weight. Repeated songs remain separate occurrences.
- **Persistent player:** the current-song link returns to Music; previous/play-or-pause/next controls accompany native seek, shuffle, repeat and volume fields. It appears only for a nonempty queue and can show an inline error alert. Shared keyboard focus and reduced-motion handling continue to apply.

### Do's and Don'ts

- **Do** keep song metadata and explicit playback/list actions readable together as rows wrap.
- **Do** retain visible focus, accessible names and native range/select/checkbox semantics.
- **Do** preserve the scrolling clearance beneath the fixed dock across ordinary app pages.
- **Don't** promote Music's scoped primary fill or browser-native slider tint into a replacement global palette.

## Team analysis extension

This scoped Operate extension records `client/src/components/TeamAnalysis.jsx`, its placement above the set editors in `TeamBuilder.jsx`, and `client/src/team-analysis.css`. It inherits the warm dark/crimson palette, sans-serif controls and existing panel, button, segmented-control, loading and error primitives. The supplied desktop (1280×720) and mobile (390×700) captures confirm the implemented surface, including a horizontally scrolled mobile matrix. Functional calculation limits belong in `docs/TEAM_ANALYSIS.md`.

### Components

The initially closed native **Team analysis** disclosure keeps the editor in flow. Opening it reveals help and an explicit **Analyse team / Analyse again** action against the current unsaved draft and format, without saving or Internet access. Loading uses the inherited spinner and disables that button. An empty team disables analysis and shows an add-member prompt; failures use the inherited alert with Retry. A changed draft or format hides the previous report and displays a status requesting another analysis. English and Spanish labels, help, states, type/species names and excluded-move reasons follow the existing translation system; custom member names remain data.

Successful results place the generation and type-only calculation scope before two border-separated findings: shared weaknesses and types without super-effective coverage. Existing segmented buttons expose Defence and Attack coverage through `aria-pressed`, with a plain-language multiplier legend. The semantic table has a screen-reader caption, column and row headers, member types beneath names, and a final member-count column. Multipliers remain explicit text, including immunity (0×), resistance (¼× / ½×) and unavailable coverage (—); color supplements the values. Weak cells mix the inherited danger into the surface (18%), strong cells mix the accent (12%), and immune cells use the elevated surface. These are scoped matrix treatments, not new global palette tokens.

The Speed list follows the matrix, pairing each wrapping member name and effective level with a right-aligned tabular statistic. Thin dividers separate rows within a (36rem) maximum width. When present, a second native disclosure lists excluded moves with member names and reasons.

### Layout

The report body uses a (.85rem) grid gap; actions wrap. Findings use two equal columns with a (1.2rem) gap and collapse to one at (640px) and below. At that breakpoint the analysis and segmented buttons have a (44px) minimum height. The matrix alone scrolls horizontally inside a bordered, small-radius, keyboard-focusable named region; its focus outline uses the inherited accent with a (2px) offset. The left type-header column stays fixed while member columns scroll. Cells use (12.5px) tabular text; mobile cells have (.5rem) padding and a (6rem) minimum width. Long member names wrap rather than widening the page.

## Local Dragon and Poison material extension

Eleven local pixel-art motifs add 117 selected frames from the supplied Pokémon Mystery Dungeon: Explorers of Time/Darkness Dragon and Poison sheets, credited to redblueyellow. They reuse the shared real-time effect geometry, phases and presentation clock. Transparent square cells preserve source aspect ratio and anchors; pixel rendering remains unsmoothed. Exact coverage, source provenance and exclusions are recorded in `docs/DRAGON_POISON_SPRITES.md` and the shared material contract in `docs/SUPPLIED_SPRITES.md`. These are composed motifs rather than reconstructed cartridge choreography.

Reduced motion uses the material's declared `still_frame`, selecting a visible stationary source frame; materials without that metadata retain frame zero. Normal animation, pause, speed changes and seek retain the existing renderer clock and queues. The same embedded material layer serves ordinary real-time battles, mass battles, recordings and standalone HTML, without the original sheets or Internet at runtime.

## Portable battle asset extension

Standalone battle exports embed the available presentation cache once, with URL aliases sharing the embedded bytes. The existing battle surfaces and controls retain their visual system; this asset-resolution contract leaves the ordinary app and live rooms unchanged. The export-time snapshot and presentation limits are documented in `docs/PORTABLE_ASSETS.md`.

**The Portable Artwork Rule.** In generated standalone pages, prefer an embedded static Pokémon sprite when animated art is absent; otherwise show a local SVG disc with up to two uppercase label characters (or ?). Keep missing decorative images transparent and missing Reborn animations on Silver's existing fallback.
