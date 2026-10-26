# Drawn battle reactions

These are new raster poses for identities whose published sprite set lacks Pain
or HitGround. Each sheet has two or four frames per heading. HitGround ends in a prone
pose; the battle renderer holds that pose until recall.

`sources/` contains candidate generation outputs and exact prompts. A candidate
is not approved just because it exists. `compiled/<identity>/` contains cropped,
registered pixel art with the installed identity's original palette and binary
alpha. `meta.json` records the source hash, output hashes, frame geometry, prompt
and visual review status.

Four-heading sheets author S/E/N/W and map diagonal headings explicitly through
`row_map`; eight-heading sheets contain all eight rows. Metadata declares any
mirrored direction or native frame used during assembly. It does not count that
frame as a newly drawn pose. Normal and shiny have separate visual acceptance;
a missing or rejected shiny never publishes normal colours as a shiny copy.
Declared native frames retain their exact original RGBA pixels in both palettes,
including after the generated frames receive their shiny palette transfer.
Falinks reuses newly drawn leader/trooper component poses in its six-member
formation. Metadata records that composition and the native formation anchor
for each heading; these are not six independently drawn groups.

Run `python scripts/import_reaction_art.py <candidate-file-stem>` to compile a
candidate. Without explicit names the importer compiles only reviewed records.
It crops and registers drawn poses; it does not manufacture poses by warping a
standing sprite. The original installed library is never edited by this command.
`scripts/build_pmd_reactions.py --stage <published-cache>` includes reviewed
exports in the additive reaction pack, after published originals. The existing
library routes, portable export and status MCP consume that same pack. Use
`--require-raster` to check complete coverage: it fails before writing a pack
while any identity still needs the explicitly marked runtime fallback.

Creation tool: built-in image generation. The inputs use each exact form's
installed sprite art as its identity reference. Published art and its existing
credits remain unchanged.

Task 1503 is in progress. The initial audit found 1,201 normal forms needing at
least one new reaction; shiny palettes must also be derived and checked before
installation. There are reviewed raster exports for 2,328 normal/shiny variants,
with both actions. The pack uses 2,310 new Pain and 2,325 new HitGround sequences;
existing published reactions take priority where already available. Pain still
has 97 variants using the previous runtime fallback, and HitGround has 97.
This directory does not establish complete
roster coverage. Source prompts and per-frame provenance accompany each accepted
export. Rejected candidates remain outside the generated pack.
