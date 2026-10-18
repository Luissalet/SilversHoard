# Daily rental challenge

Facilities offers a dated challenge of seven consecutive classic battles at level 50. Pick three of that date's six rentals; the team starts healed in each battle. No saved trainer is required. Losing or forfeiting ends the attempt. The calendar can prepare another date, and dates with local results provide shortcuts.

The existing rental Factory supplies both rentals and opponents. The calendar date determines the generation-9 seed, opponents and battle seeds (`seed-stage`), with normal opposing AI and its recorded style. The current generation/rules/AI version and team corpus determine a challenge key. The same date and compatible rules produce the same challenge; this does not promise identical outcomes after a generator or rules update.

## Normal app, API and MCP

- `daily_challenge({day})` returns the six rentals, seven opponents, rules, challenge key, local date and that date's board. Empty `day` means the server's local calendar day; explicit dates are canonical `YYYY-MM-DD`.
- `daily_challenge_export({day})` prepares the ordinary self-contained playable HTML. Its gym-shaped payload is virtual; preparing it creates no trainers, gyms or leagues in the database. Every playable opponent carries its canonical AI level and style.
- Facilities opens that same exported page in a focused game dialog. Finishing sends its normal result code to the containing app, which uses ordinary Import. Errors retain the code and expose Retry. A downloaded page can be played separately and its code imported manually.
- Generic Import accepts the existing `SILVERWIN1-` result code with daily metadata. It verifies the chosen three unchanged rentals, date/key and all recorded battles with their expected seed and opposing AI before saving any battles. A complete challenge needs seven verified wins; a shorter attempt must end with a loss. A wrong seed/team/outcome/opposing AI is rejected rather than counted.

There is no new league, matchmaking service, scheduler or model. Records use the existing friend-results leaderboard, grouped by date and player, with a player's best attempt shown. The Friends page links a daily board back to its calendar date. Results preserve replays without awarding trainer badges or trainer win counters. The weekly challenge and its existing rules remain available.

## Verification and scope

The area tests cover canonical dates, deterministic generation across instances, read-only preparation, returned-data isolation, rental/seed/completion tampering, replayed forfeits, deduplication and the common handlers/board. An export regression checks all seven playable opponents against their canonical AI, including non-balanced styles.

Own engine QA found a legal seven-win sequence on 2026-10-18 using Magnezone, Ursaluna and Clawitzer. The existing import pipeline replayed all seven and accepted the result through both the normal UI API and native MCP. The QA driver searched bounded legal choice sequences; this is a completion-path test, not a human difficulty or balance claim. Earlier losing attempts were retained.

Actual browser QA exposed and reproduced an initial missing-AI export: its default-style opponent caused a correctly rejected result. Export now carries the AI configuration for every stage. A new mobile attempt used a real move and forfeit, then imported automatically as a verified shorter streak; the previous incorrect attempt remained absent from the board. EN/ES labels and the existing app/playable-page components are reused. No raster artwork is generated for this feature.

Browser QA also reproduced a stale download after preparing one date and selecting another. Date changes now clear prepared pages, and an in-flight response is ignored if the selected date changed. This does not close an active page merely because the server calendar rolls over at midnight. A standalone page was played with network emulation offline through an actual move and forfeit; its normal result code was retained for verification.
