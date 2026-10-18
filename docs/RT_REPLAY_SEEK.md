# Local real-time replay inspection

Finished real-time battles have a frame cursor, five-second back/forward controls,
pause/play, restart and the existing playback speeds. Moving the cursor pauses the
replay. The range accepts keyboard arrows, Home and End, and exposes its time to
assistive technology. Positions use the simulator's 30 ticks per second.

Each jump reconstructs the saved specification, seed and inputs from the beginning.
Historical log entries remain visible; old move effects, ability banners and Mega
notices are cleared rather than replayed in a burst. Playback speed is retained.
Long battles can take longer to seek because this does not introduce a second
simulation or cache of mutable battle states. Video capture keeps its existing
progress display and recording controls.

`battle_rt_inspect({id, tick})` exposes the same public simulator view through the
normal local UI/API/MCP tool catalog. It accepts only finished real-time battles,
clamps a position beyond the saved end, and returns a paused `ui_url`. It does not
save a battle, update records, generate commentary, or call an external service.
Recorded forfeits, including tick zero and legacy inferred forfeits, apply at the
saved frame. Legacy records without a positive saved tick use summary duration.

The shared cursor lives in `engine/src/realtime/replay.mjs`; the browser re-exports
it. The simulator, damage rules, RNG and saved input format are unchanged.
