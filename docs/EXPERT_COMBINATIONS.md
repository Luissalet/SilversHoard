# Executed expert doubles pairs

The **Executed expert AI combinations** setting is enabled by default and can be switched off in Settings. It annotates the battle log and Why panel after a doubles turn has resolved. Labels name the trainer, turn, both actors and their recorded moves. They describe execution, not a proof of tactical synergy or a recommendation.

`battle_get` and completed `battle_choose` results expose `expert_combinations` and `expert_combinations_enabled`. The shared `battle_explain` UI/REST/MCP handler returns `combinations` restricted to the selected notes and `combinations_enabled`; its plain text also names the executed pair. Existing decisions, alternatives and advice remain available. The preference is changed through the normal `settings_set(expert_combinations=...)` handler. No new server, engine, model or search is added.

## Evidence required

`expert_combinations.py` reads the saved notes and public protocol only. For a live battle it reads the existing saved snapshot's log, folding a private/public split into one public line; it does not ask the engine to run anything. For a finished battle it reads the saved log. It never rewrites notes, summaries, logs or snapshots.

A pair requires all of the following:

- The protocol identifies a doubles battle, with a resolved turn ending at the next turn marker, win or draw.
- One unambiguous expert turn decision covers slots 0 and 1 of the same side. Identical duplicate notes collapse; conflicting choices do not qualify. Partner-only notes, other AI levels, advice and incomplete traces do not qualify.
- Both original occupants publicly execute the exact named moves recorded in that decision. Actor names and the publicly shown starting species must agree. The pair retains both move-line indices and the later resolved boundary index.
- Neither action has a recorded miss, failure, immunity or protection block. A called or repeated move, a replacement before acting or ambiguous position change is omitted rather than guessed.

This intentionally conservative reader can omit valid tactics where the saved trace or public identities do not match exactly, including renamed move variants or unrevealed disguises. A partial spread-move failure also suppresses a label. It does not infer a choice from two unrelated move names or certify every possible cartridge interaction.

## Replay and presentation

The log is supplemented in memory. An annotation is inserted before the next turn header (or result), and only after the player's applied protocol index has passed that boundary. Pause, step, seek backwards, restart and skip therefore retain the same public ordering without early pair spoilers. The source log and battle outcome are unchanged. The Why panel receives the same index-filtered pairs and does not mark advice or a partner's partial note as an executed pair.

The label inherits Silver's log typography and uses the current language for move names while retaining nicknames. This is an addition to the existing reading surface, without a new panel, modal or artwork. Real-time, singles, triples, legacy records without sufficient notes and standalone playable pages without saved expert annotations retain their current logs.

## Verification

Area tests cover completed pairs, pending boundaries, side/slot identity, conflicting and duplicate notes, missing actors, switches, failed actions, live public split indices, legacy records and persisted preference changes through normal handlers. Two real engine fixtures show the positive live-to-finished equivalence and a negative case where the expert planned two moves but one actor fainted first. Four JavaScript tests verify replay index gating, backward seek, ordering, duplicate suppression and translated labels without mutating source entries. Full suites, native MCP, desktop/mobile browser and standalone battle checks complete delivery verification.
