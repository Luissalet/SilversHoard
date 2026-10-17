"""Read-only frequencies from stored battle summaries and replay logs; never rerun a battle."""
from __future__ import annotations

import re
from collections import Counter
from typing import Any

SIDES = ("p1", "p2")
STAMP = re.compile(r"^\[(\d+(?:\.\d+)?)\] (.*)$")
IDENT = re.compile(r"^(p[12])(?:[a-z])?: ")


def _classic(lines: list[str], selected: set[str]):
    moves = Counter()
    leads = set()
    shown = {side: set() for side in SIDES}
    started = any(line == "|start" or line.startswith("|start|") for line in lines)
    ended = any(line.startswith(("|win|", "|tie")) for line in lines)
    before_turn = True
    positions = set()
    initial_sides = set()
    for line in lines:
        parts = line.split("|")
        if len(parts) < 2:
            continue
        command = parts[1]
        if command == "turn":
            before_turn = False
        if command not in ("move", "switch", "drag", "replace") or len(parts) < 4:
            continue
        match = IDENT.match(parts[2])
        if not match or match[1] not in selected:
            continue
        side = match[1]
        if command == "move":
            if parts[3].strip():
                moves[parts[3].strip()] += 1
        else:
            species = parts[3].split(",")[0].strip()
            if not species:
                continue
            shown[side].add(species)
            position = parts[2].split(":", 1)[0]
            if started and before_turn and command == "switch" and position not in positions:
                leads.add(species)
                positions.add(position)
                initial_sides.add(side)
    return moves, leads, shown, started and ended, started and selected <= initial_sides, 0, started and ended


def _realtime(battle: dict[str, Any], lines: list[str], selected: set[str]):
    moves = Counter()
    leads = set()
    shown = {side: set() for side in SIDES}
    names = {}
    aliases = {}
    summary = (battle.get("summary") or {}).get("sides") or {}
    for side in SIDES:
        seat = battle.get(side) or {}
        names[side] = str(seat.get("name") or (summary.get(side) or {}).get("name") or "")
        aliases[side] = {}
        # Prefer the saved starting set for an opening, even if the summary ends in a Mega forme.
        for mon in seat.get("sets") or seat.get("team") or []:
            species = mon.get("species") or ""
            if species:
                aliases[side].setdefault(mon.get("name") or species, set()).add(species)
        for mon in (summary.get(side) or {}).get("pokemon") or []:
            species = mon.get("species") or ""
            if species:
                aliases[side].setdefault(mon.get("name") or species, {species})
    header = any(line.startswith("|rt|") for line in lines)
    ended = False
    ambiguous = 0
    lead_ambiguous = False
    shown_complete = True
    initial_sides = set()
    for line in lines:
        match = STAMP.match(line)
        if not match:
            continue
        time, text = float(match[1]), match[2]
        if text.endswith(")") and (text.startswith("Tie (") or any(text.startswith(name + " won (") for name in names.values() if name)):
            ended = True
        actor, separator, move = text.rpartition(" used ")
        # A nickname itself can contain " used ", including in a switch message.
        if separator and any(name and actor.startswith(name + "'s ") for name in names.values()):
            candidates = {side for side in SIDES if names[side] and any(actor == names[side] + "'s " + nick for nick in aliases[side])}
            if candidates and candidates <= selected and move:
                moves[move] += 1
            elif candidates & selected or selected == set(SIDES) or any(names[side] and actor.startswith(names[side] + "'s ") for side in selected):
                ambiguous += 1
        candidates = []
        switch_sides = set()
        for side in SIDES:
            prefix = names[side] + " sent out "
            if names[side] and text.startswith(prefix):
                switch_sides.add(side)
                candidates.extend((side, species) for species in aliases[side].get(text[len(prefix):], set()))
        if candidates and all(side in selected for side, _ in candidates):
            species = {species for _, species in candidates}
            if len(species) == 1:
                for side, name in candidates:
                    shown[side].add(name)
                if time == 0:
                    leads.update(species)
                    initial_sides.update(side for side, _ in candidates)
            elif time == 0:
                lead_ambiguous = True
                shown_complete = False
            else:
                shown_complete = False
        elif time == 0 and any(side in selected for side, _ in candidates):
            lead_ambiguous = True
        if switch_sides & selected and (not candidates or not all(side in selected for side, _ in candidates)):
            shown_complete = False
        if time == 0 and switch_sides & selected and not candidates:
            lead_ambiguous = True
    return moves, leads, shown, header and ended and not ambiguous, header and not lead_ambiguous and selected <= initial_sides, ambiguous, header and ended and shown_complete


def compute(battles: list[dict[str, Any]], *, kind: str = "", mode: str = "", trainer_id: str = "", limit: int = 12) -> dict[str, Any]:
    """Count uses and per-battle species/opening presence, restricted to the selected trainer's side when given."""
    totals = {"battles": 0, "move_uses": 0}
    coverage = {"moves": 0, "species": 0, "openings": 0, "ambiguous_move_lines": 0}
    moves, species, openings = Counter(), Counter(), Counter()
    for battle in battles:
        battle_mode = battle.get("mode") or "classic"
        if battle.get("status") != "ended" or kind and battle.get("kind") != kind or mode and battle_mode != mode:
            continue
        selected = {side for side in SIDES if not trainer_id or (battle.get(side) or {}).get("trainer_id") == trainer_id}
        if not selected:
            continue
        totals["battles"] += 1
        lines = str(battle.get("log_text") or "").splitlines()
        parsed = _realtime(battle, lines, selected) if battle_mode == "realtime" else _classic(lines, selected)
        used, leads, shown, moves_complete, leads_complete, ambiguous, shown_complete = parsed
        moves.update(used)
        totals["move_uses"] += sum(used.values())
        coverage["moves"] += int(moves_complete)
        coverage["openings"] += int(leads_complete)
        coverage["ambiguous_move_lines"] += ambiguous
        openings.update(leads)
        participants = set()
        complete = True
        summaries = (battle.get("summary") or {}).get("sides") or {}
        for side in selected:
            mons = (summaries.get(side) or {}).get("pokemon")
            if isinstance(mons, list):
                for mon in mons:
                    if battle_mode == "realtime":
                        activity = ("switches", "moves", "fainted", "taken")
                        if not any(key in mon for key in activity):
                            # Older summaries cannot distinguish an unused bench member.
                            participants.update(shown[side])
                            complete = False
                            continue
                        if not any(mon.get(key) for key in activity):
                            continue
                    if mon.get("species"):
                        participants.add(mon["species"])
                    else:
                        complete = False
            else:
                participants.update(shown[side])
                complete = complete and shown_complete
        coverage["species"] += int(complete)
        species.update(participants)

    def rows(counter):
        ordered = sorted(counter.items(), key=lambda item: (-item[1], item[0].casefold(), item[0]))
        return [{"name": name, "count": count} for name, count in (ordered[:limit] if limit else ordered)]

    return {"filters": {"kind": kind, "mode": mode, "trainer_id": trainer_id}, "totals": totals, "coverage": coverage,
            "moves": rows(moves), "species": rows(species), "openings": rows(openings),
            "distinct": {"moves": len(moves), "species": len(species), "openings": len(openings)}}


def get(store, *, kind: str = "", mode: str = "", trainer_id: str = "", limit: int = 12) -> dict[str, Any]:
    if trainer_id:
        store.trainer(trainer_id, deleted=True)
    # A single SQLite query gives one consistent set of saved rows, without replaying any inputs.
    battles = store.battles(status="ended", kind=kind, trainer_id=trainer_id, limit=-1, light=False)
    return compute(battles, kind=kind, mode=mode, trainer_id=trainer_id, limit=limit)
