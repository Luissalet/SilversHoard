# Pokémon spectators

Real-time arenas choose up to twelve spectators from the generation's base-species catalog instead of repeating a short list for each floor. Species do not repeat within one audience. Some seats stay empty, as before.

The selection uses the battle seed, battle ID and floor. Replaying or recording the same battle preserves its audience; a new battle can have different spectators even when it reuses the simulation seed. Selection never consumes the simulation's random stream or changes combat state.

Walking sprites still come from the existing SpriteCollab cache and keep their artist credits. While they load, or when walking art is unavailable, the usual static battle sprite fills the seat at a bounded size. No new artwork ships with this change. Requests are made once when setting up the audience, not on each frame. Existing crowd/show settings and the exported page's offline behavior remain unchanged.

`engine/test/rt-crowd.test.mjs` checks replay stability, variation, unique valid species in generations 1, 4 and 9, unchanged simulation outcomes, missing walking-art fallback and the absence of per-frame requests. Browser checks cover the arena at desktop and mobile sizes and the native MP4 export.
