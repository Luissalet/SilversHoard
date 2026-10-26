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
An independently reviewed shiny can also publish without a generated normal.
Only accepted variants enter the pack; an unreviewed normal candidate from the
same source stays excluded. A separate shiny record may target an already
approved normal identity while preserving its original exports byte for byte.
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

Pose creation tool: built-in image generation. The inputs use each exact form's
installed sprite art as its identity reference. Published art and its existing
credits remain unchanged.

Task 1503 is in progress. The initial audit found 1,201 normal forms needing at
least one new reaction; shiny palettes must also be derived and checked before
installation. There are reviewed raster exports for 2,413 normal/shiny variants,
with both actions (1,195 normal and 1,218 shiny). The pack uses 2,395 additional Pain and 2,410 additional HitGround sequences;
existing published reactions take priority where already available. Pain still
has 12 variants using the previous runtime fallback, and HitGround has 12.
This directory does not establish complete
roster coverage. Source prompts and per-frame provenance accompany each accepted
export. Rejected candidates remain outside the generated pack.

Compact sources can contain one newly drawn wince and one newly drawn prone
pose per direction. Pain enters from exact native Idle; HitGround transitions
from the drawn wince to the drawn prone pose. Shared poses and native entries
are declared explicitly. Equivalent Mimikyu/Totem forms reuse the drawn atlas
only after every native normal/shiny animation crop is verified identical;
this is recorded derivation, not independent generation for each form.

Records with `recolor` use the existing authored Pain/HitGround PNGs and an
explicit native RGB map. The importer verifies each source SHA, rejects runtime
acting and unmapped colours, then preserves alpha, dimensions, frame geometry,
timing and ground-frame selection exactly. Only the reviewed target variant is
published. Raichu and Pikachu Libre shiny reuse their own published normal
reactions. Hoenn and Pop-Star normal use the inverse palette of their accepted
shiny exports. Libre retains the red/black costume through declared overrides
because native RGB correspondence is ambiguous across body and costume regions.
These recolors add no independently drawn poses or camera angles.
