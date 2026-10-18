# Local Rock move motifs

Four motifs select 29 clearly delimited interior frames from Luis's supplied
Pokémon Mystery Dungeon: Red Rescue Team Rock-Type Moves sheet, ripped by
redblueyellow. They cover Ancient Power (6), Rock Blast (7), Rock Tomb (9) and
Rollout (7). These are composed visual motifs in Silver's existing renderer,
not the cartridge's complete emitter programs or every tile on the sheet.

`scripts/build_rock_sprites.py <original-folder>` checks the existing inventory's
SHA256 before reading pixels. Red separators, labels and ambiguous unbounded
tiles are excluded by inspected source rectangles. The flat teal key becomes
transparent, including internal holes; all remaining pixels are preserved.
Square padding and per-frame offsets retain geometry without stretching or
rescaling. Empty/clipped selections or separators fail before writing the
manifest. The most populated source frame is used for reduced motion.

The four move-specific profiles use their existing travel, impact, contact or
area phase in RT, mass battles, HTML and video. The public simulation clock,
pause and seek behavior remain shared. Move shapes, availability, damage,
RNG, replay versions and rules do not change. Runtime needs no source sheet,
download, API, package or online service. Earlier sprite/source records and
original inventory hashes are preserved; matching duplicate inventory inputs
are marked connected to the single new source.
