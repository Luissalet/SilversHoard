# Printable battle newspaper

Finished classic and real-time replays offer **Create battle newspaper**, then **Open and print** or **Download HTML**. The portable HTML has no external resources and prints through the browser, including Save as PDF when the browser offers it. This is not a video or a generated illustration.

The `battle_journal` UI/REST/MCP handler takes `id` and `lang` (`en` or `es`) and writes one deterministic HTML file under the existing exports directory. It returns the file URL and a structured report. It reads saved battle rows only, without engine calls, replay execution, model requests, database writes or new servers. Its write annotation refers to the requested export file.

The headline uses the saved winning side. A draw requires an explicit tie line; a missing outcome is labelled unknown. The date is the saved end/update/create timestamp, shown in UTC when stored as an epoch. Names and the original log remain as saved, even when the report labels are translated.

## Figures and MVP

Figures come from the engine's existing `summary.sides.<side>.pokemon` records. The original log is reproduced as a source appendix with its SHA-256, not parsed again with a competing attribution algorithm. The classic engine calculated its summary from the omniscient protocol; real-time recorded counters during the battle. These are the existing engine's attribution rules, not newly simulated damage or an independent proof of attribution.

- Classic damage is `damage * 100`: cumulative opposing HP bars as a percentage. Healing and multiple opponents can produce values above 100%. The existing engine summary rounds the underlying fraction to two decimals.
- Real-time damage is `dealt`, in raw HP. Its normalized `damage` field is deliberately not substituted. Legacy records without `dealt` show a missing value.
- KOs and move uses are saved `kos` and `moves`. Missing, negative or non-finite values show a dash, never an invented zero.
- MVP means highest positive recorded damage, with KOs breaking ties. Every remaining tied Pokémon is a joint MVP. Without positive damage there is no MVP. Unused bench members may remain in a saved summary's table, with their recorded zero counters.

The HTML states whether the log retains recognized opening and ending markers; partial or missing logs get a coverage notice. That check does not independently validate the summary or certify every event was retained. Saved summaries can still be shown for old partial records, clearly sourced. Reports without individual summaries show an explicit empty state. Active battles are rejected.

## Presentation

The replay action inherits Silver's existing buttons and bilingual labels. The report is a reading surface: light paper for printing, serif headline, restrained red print action and a semantic table with numeric alignment. At narrow widths the table can scroll within its own region. Print CSS repeats the header, wraps long names, avoids split rows and removes the action. Printing opens the original-log appendix so it is included. Text is HTML escaped throughout. No trainer artwork, private team builds, model image request or new font download is added.

## Verification

`tests/test_battle_journal.py` covers classic/real-time units, shared MVPs, tie handling, missing metrics and summaries, incomplete logs, escaping, native export URLs, stable output and preservation of battle/settings rows. Full app and engine suites, a frozen build, native MCP calls with actual engine battles and desktop/mobile browser checks complete acceptance.
