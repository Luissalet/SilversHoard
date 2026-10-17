# Replay frequencies

History has a collapsible statistics panel. It reads every matching finished battle, independently of the list's pagination, with kind, classic/real-time mode and trainer filters. Selecting a trainer counts only its saved side. The default tables show twelve entries; “Show every row” removes that presentation limit. Wins, streaks and achievements remain in Progress.

`replay_statistics` is a read-only UI/REST/MCP tool with `kind`, `mode`, `trainer_id` and `limit` (zero means all rows). One SQLite read supplies saved rows to `replay_statistics.py`; no battle is simulated, no model is called, and nothing is written or migrated.

- Moves count stored use messages, rather than damage/hit messages. A multi-hit attack contributes one use. Classic logs can include moves invoked by other moves; each recorded `move` message counts.
- Species count presence once per battle, across the selected sides. Classic summaries contain Pokémon that entered play, with switch/drag/replace log fallback. Real-time summaries include the bench, so only Pokémon with switches, uses, fainting or damage taken count.
- Openings count the species shown in the first classic switch for each position before turn one, or real-time switches at zero seconds. Later replacements and switches do not become leads. Starting snapshots resolve real-time nicknames, preserving the starting species if the final summary contains a Mega forme. These are visible opening species, not a reconstruction of concealed identities.

Each table reports complete-record coverage. Incomplete logs still contribute identifiable entries. Ambiguous real-time actor names are omitted when filtering a side; globally a use can still be counted once if the side is immaterial. Ambiguous or unknown opening species are never guessed. Identifiable species from a final summary reflect that summary's final formes; this is not a full transformation timeline. Old logs and duplicate nicknames cannot supply information they never recorded.

Rows sort by descending count, then name for stable ties. Existing results and other statistics are unchanged. The panel loads only when opened, follows history's kind filter, and refreshes after ordinary data changes. All labels are Spanish/English; it introduces no art or new renderer.
