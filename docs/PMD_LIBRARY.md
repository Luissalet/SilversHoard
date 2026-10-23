# Installed PMD sprite library

The reviewed collection covers all 1,469 species and form identities in Silver's current engine inventory, including all 1,025 base species, in normal and shiny variants. There are 2,938 resolved requests and no missing identity in that inventory. `pmd_library_status` reports the installed coverage; future or custom identities outside that inventory retain the ordinary fallback.

Reviewed native compositions and pixel corrections can ship as `native-pmd-animation-sheets`. Falinks combines one published Brass and five Troopers with fixed positions, retaining the original pixels, eight headings, four-phase walking clock and separate published normal/shiny palettes. Per-action crops preserve each frame's position relative to its anchor. Pikachu-Gmax combines generated right profiles, explicit left mirrors and user-requested native front/back pixel corrections: twelve authored figures and four mirrors, with Idle, two opposed Walk phases and Attack. Its shiny uses canonical HOME palette transfer while preserving the unchanged visible tail/cloud colours. The importer preserves the recorded actions and checks their PNG dimensions without resampling.

Compact walking sheets keep the first/middle choice when those poses differ. When both are identical, they use different quarter-cycle poses, or the first distinct alternative, preserving the full loop duration. This avoids a static compact Falinks: its opposed native steps are frames 1 and 3, represented by two 14-tick phases.

HTML payloads escape `<` with valid JSON Unicode escapes. Full attribution notices containing HTML comments or closing script text round-trip unchanged and cannot leave an exported page displaying the empty template.

The application and standalone pages resolve PMD art from `presets/pmd/manifest.json` before consulting the existing download cache. `pmd_library_status` exposes its source revision, normal/shiny coverage, unresolved identities, image count and compressed bytes through the ordinary REST/MCP handlers. Its inventory covers the official species, forms and cosmetic forms in Silver's engine, including the Champions data.

The collection does not depend on which teams a user has previously tried. Trainer/gym, daily, weekly and mass HTML exports include the installed collection, alongside the existing cached presentation assets. Re-export old HTML files to acquire the library. Live rooms continue using the application routes.

## Art and attribution

Published sheets are pinned to SpriteCollab revision `341342d7ef2ed3e4427c760e829a417b501be17c`. Every normal/shiny form retains its artists and upstream provenance. The installed `CREDITS.md` and manifest carry those credits and the source/license links. Recolours and visually identical exterior equivalents inherit that attribution rather than being relabelled as generated art.

`art/pmd/registry.json` records reviewed original generated sources, their prompts, tools and any technical tile corrections. The importer aligns complete figures at a common scale and feet anchor; it does not stretch a rectangular source grid into a square. Published art normally has eight headings and its authored animation frames. Generated sources require a sixteen-pose sheet with idle, two walking phases and attack in four headings; four static views are rejected. Actual used directions and poses remain explicit. Existing body choreography and reactions still apply. Excluded bad phases, reordered profiles and mirrored poses are recorded explicitly.

Explicitly imported walking art retains priority. Adding a previously missing library form therefore does not hide a user's imported sheet. Non-official/custom identities outside the engine inventory retain their existing fallback behavior.

Reviewed supplied overworld sheets use a separate adapter: four original locomotion frames in each of four directions, with the source cell registration and vertical bob preserved by one common crop/scale. Normal and shiny remain their separate original files. Their metadata records the archive/member hashes, available Idle/Walk actions and adapter timing; no Attack is invented. The supplied ZIP does not identify its artist or licence, so no attribution or relicensing is invented. This adapter does not relax the sixteen-pose requirement for new generated art.

Existing Jhony-Rex Mega Swampert and CamiLovesO Delphox-line drawings are reused before generating replacements. Their native import format retains original source pixels, exact background keys, separate shiny inputs and cycle timing (eight ticks per slot). Swampert has five authored headings, three mirrored headings and three distinct phases; Delphox has four headings and two phases. Repeated cycle slots do not count as extra drawings. Delphox's source starts with back-facing frames: its legacy front/back mapping is corrected in memory for the known source hash without rewriting user data.

HG-engine indexed overworld sources use eight authored frames, two per cardinal direction, and their own normal/shiny palettes. Hardware palette index zero supplies transparency. Full upstream credits and community conditions travel in the manifest and portable HTML; these are not relabelled as CC BY-NC or generated art. They have no drawn Attack action.

Passing extraction checks is not final visual acceptance. Generated sources remain unreviewed until anatomy and the complete movement loop are inspected at native size and enlarged, including alternating supports, stable rigid structures and canonical limb counts. User-identified defects reopen that review. Coverage remains incomplete while any such source is held.

Technical atlas repairs may add transparent gutters without redrawing or resampling any foreground figure. A targeted generated correction can replace bad individual poses while preserving the other authored figures. The source records distinguish those operations and retain input hashes and correction details.

## Runtime and HTML

Images are deduplicated by content and stored in indexed binary `.pmd` packs. PNG-to-WebP conversion is lossless and verifies decoded RGBA equality when building. Geometry, actual row maps, artists, parent sources, front/back previews and compact variants stay in the manifest. A native sprite request extracts only its requested file into the ordinary cache, without a network request.

Portable HTML stores the binary packs in separate inert base64 script blocks. They do not inflate the share-code JSON. The browser decodes a pack only when one of its images is needed, removes that base64 DOM node, and uses Blob slices/object URLs for individual files. Reinstalling the bundle revokes old object URLs. Metadata lookup does not decode images.

Front/back UI previews come from actual PMD poses, so cold team selectors and HUDs do not depend on cached Showdown pictures or portraits. An existing emotional portrait remains available; the PMD preview supplies its offline fallback. Large armies use compact directional Idle/Walk sheets for ordinary units, preserving apparent body size; bosses retain their full sheets. A single-pose source remains a single pose in that compact representation.

## Rebuilding

`engine/scripts/build_pmd_roster.mjs` derives the roster from the same engine data as the playable page. `scripts/build_pmd_library.py` inventories the pinned tracker, collects published art and aligned shiny palette references, and compiles the installed manifest/packs. Generated art is an explicit reviewed input, never a silent placeholder. A strict compile rejects unresolved normal/shiny requests; `--allow-missing` creates an explicitly partial QA collection whose coverage remains visible.

The staging directory contains downloaded art and encoded image caches, not a checkout or user data. Model servers and generation services are build-time authoring tools; opening an exported HTML does not call them. See [portable assets](PORTABLE_ASSETS.md) for the other embedded material and its existing limits.

Reviewed generated sources can include a separately authored `shiny_file` when automatic palette transfer confuses differently coloured regions. Both variants require their own anatomy, movement and palette review. Normal repacking/component receipts are scoped to `source.normal_parent` for that shiny variant, while its active source hash identifies the selected shiny image. Existing suitable supplied art keeps priority.

The selected shiny variant also carries its actual tool and derivation in the manifest. A canonical palette transfer is distinguished from a separately authored shiny. An imported normal fallback cannot override an available exact shiny library entry; matching imported variants retain their priority.

A reviewed `reference-palette` correction can replace an incorrect published shiny without replacing its normal sheet. Pecharunt's pinned normal and shiny sources contain identical pixels; its corrected shiny uses aligned HOME references for the golden inner body while retaining the magenta shell and original animation geometry. The manifest retains the replaced source folder, revision, correction reason, original artist and palette references. Unreviewed corrections leave the published source in place.

Rebuilds validate in a private temporary output before publishing content-addressed packs and an atomic manifest. A rejected build preserves the installed collection. Existing readers retain their referenced packs, and identical packs are reused when a response has them open. Room sprite responses infer PNG/WebP MIME from the extracted file.

The1317 follow-up visually reviewed69generated identities/138normal-shiny variants across all four headings and full A/B/A locomotion. The only retained correction is an explicitly masked fuchsia/red hand palette for Darmanitan Galar Zen shiny in16poses. Its compiled images are lossless RGBA matches to the independently reviewed candidates; the other2,937variant metadata records are unchanged. See [the review and mechanics follow-up](RT_DYNAMAX_Z.md).
