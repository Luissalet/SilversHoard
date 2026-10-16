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
