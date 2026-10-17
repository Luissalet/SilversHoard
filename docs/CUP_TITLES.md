# Generated cup titles

New cups without an explicit title store `spec.title_default: true` and an English native title such as `Cup: 2 trainers`. `cup_get`, `cups_list` and the cup link in `battle_get` include `i18n.es.title` and `i18n.en.title`. The app uses the existing `loc` helper for the bracket heading, list and battle strip, so changing the interface language does not rewrite stored data.

An explicit title receives no marker or translated title. Old cups without the marker also stay literal, even when their title resembles the former `Copa de N` default. There is no migration or inference from matching text. Brackets, simulation, saved battle rules and completion state are unchanged. The marker is not an engine rule.

`battleTitle` also reads this cup metadata for the prefix of a cup battle heading, alongside its existing translated trainer and challenge names. Personal cup titles receive no replacement.

The existing native cup tools expose the extra view metadata through the same API/MCP handlers; no separate adapter or new tool is needed. `tests/test_cup_titles.py` covers the generated default, explicit names, old rows and view consistency.
