# Drawn battle reactions

These are new raster poses for identities whose published sprite set lacks Pain
or HitGround. Each sheet has four frames per heading. HitGround ends in a prone
pose; the battle renderer holds that pose until recall.

`sources/` contains candidate generation outputs and exact prompts. A candidate
is not approved just because it exists. `compiled/<identity>/` contains cropped,
registered pixel art with the installed identity's original palette and binary
alpha. `meta.json` records the source hash, output hashes, frame geometry, prompt
and visual review status.

Run `python scripts/import_reaction_art.py <candidate-file-stem>` to compile a
candidate. Without explicit names the importer compiles only reviewed records.
It crops and registers drawn poses; it does not manufacture poses by warping a
standing sprite. The original installed library is never edited by this command.

Creation tool: built-in image generation. The inputs use each exact form's
installed sprite art as its identity reference. Published art and its existing
credits remain unchanged.

Task 1503 is in progress. The initial audit found 1,201 normal forms needing at
least one new reaction; shiny palettes must also be derived and checked before
installation. Approved pilot art is not yet installed in the product, which
continues to use the previous fallback for missing authored sequences. This
directory does not establish complete roster coverage.
