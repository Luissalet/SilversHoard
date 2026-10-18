# Arena weather

The arena editor saves optional sun, rain, snow or fog on any existing floor.
Its preview and the battle selector show the chosen weather. The default keeps
the original floor ambience, including Mt. Pyre's mist and Mt. Silver's snow.
Existing artwork and procedural canvas effects are reused; no new raster assets
or sprite generation are required.

Weather is visual by default. Enable **Also apply combat rules** to start battles
with the engine's existing weather effects: sun boosts Fire and weakens Water,
rain does the reverse, snow raises Ice Pokémon's Defence from generation 9
without hail damage, and fog reduces accuracy-dependent hit chances to 3/5.
Other existing weather-dependent moves and abilities retain their rules. Starting
weather lasts until another weather replaces it or the battle ends; a move or
ability that replaces it uses its normal duration. Cloud Nine and Air Lock keep
their existing suppression behaviour. An explicit Frontier/training starting
weather takes priority over the arena.

The normal `arena_save` UI, REST and MCP handler accepts `weather` (`""`,
`sunnyday`, `raindance`, `snow`, `fog`) and `weather_rules` (boolean). Partial
updates preserve omitted fields. `arena_get` and `arenas_list` return them.
The SQLite version 10 migration adds empty weather and disabled rules without
changing existing columns, including deleted arenas.

Battle snapshots capture the selected weather and rule choice. Later arena edits
do not change saved battles. Gyms carry the same choices through file/code/page
exports and imports; arenas with the same rocks and floor but different weather
or rules remain separate. Arenas without selected weather keep their previous
portable shape.

RT rules version 12 enables these arena properties and starting snow. Versions
1–11 ignore arena weather and keep their recorded combat behaviour. Decorative
weather never consumes simulation randomness or changes damage or accuracy.
Actual battle weather overrides the selected decoration while active. Mechanical
arena weather follows the public battle state after replacement, rather than
reappearing as decoration. Floor lighting and architectural detail remain.

Presentation uses the existing renderer clock; pause and replay seeking retain
their normal behaviour. Reduced motion freezes the ambient movement while
retaining visible weather. Animated overlays do not rebuild the cached floor.
HTML pages and video exports use the same arena snapshot, engine and renderer;
they require no new server, GPU, model or remote asset catalogue.
