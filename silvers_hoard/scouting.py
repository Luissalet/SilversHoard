"""A rival's observations from finished encounters, without a second memory database."""

from __future__ import annotations

from copy import deepcopy
from typing import Any

from .errors import SilverError


def public_species(lines: list[str]) -> dict[str, Any]:
    """Keep species named in public protocol details; split blocks always use the public line."""
    out: dict[str, Any] = {"version": 1, "source": "public_log", "p1": [], "p2": []}
    i = 0
    while i < len(lines):
        line = lines[i]
        if line.startswith("|split|"):
            if i + 2 >= len(lines):
                break
            line = lines[i + 2]
            i += 2
        i += 1
        fields = line.split("|")
        if len(fields) < 4 or fields[1] not in ("poke", "switch", "drag", "replace", "detailschange", "-formechange"):
            continue
        side = fields[2][:2]
        species = fields[3].split(",", 1)[0].strip()
        if side in ("p1", "p2") and species and species not in out[side]:
            out[side].append(species)
    return out


def encounter_species(battle: dict[str, Any], side: str) -> dict[str, Any]:
    """Legacy classic omniscient switch lines cannot recover an Illusion's public disguise."""
    saved = (battle.get("replay") or {}).get("scouting") or {}
    if saved.get("version") == 1 and saved.get("source") == "public_log":
        return {"species": list(saved.get(side) or []), "source": "public_log", "coverage": "partial"}
    if battle.get("mode") == "realtime":
        mons = (((battle.get("summary") or {}).get("sides") or {}).get(side) or {}).get("pokemon") or []
        species = list(dict.fromkeys(m["species"] for m in mons if m.get("species") and (m.get("switches") or 0) > 0))
        return {"species": species, "source": "rt_deployments", "coverage": "partial" if species else "none"}
    lines = (battle.get("log_text") or "").splitlines()
    preview = any(line == "|teampreview|" or line.startswith("|teampreview|") for line in lines)
    observed = public_species([line for line in lines if line.startswith("|poke|")]) if preview else {}
    species = observed.get(side) or []
    return {"species": species, "source": "legacy_preview" if species else "unavailable", "coverage": "partial" if species else "none"}


def scouting_history(store, battle_id: str, rival_side: str, *, encounters: list[dict[str, str]] | None = None) -> dict[str, Any]:
    if rival_side not in ("p1", "p2"):
        raise SilverError("invalid", "rival_side must be p1 or p2.")
    anchor = store.battle(battle_id)
    if anchor.get("status") != "ended":
        raise SilverError("conflict", "Scouting needs a finished battle.")
    other = "p2" if rival_side == "p1" else "p1"
    rival_id = (anchor.get(rival_side) or {}).get("trainer_id") or ""
    opponent_id = (anchor.get(other) or {}).get("trainer_id") or ""
    paired = bool(rival_id and opponent_id and rival_id != opponent_id)
    selected = [(anchor, rival_side)]
    if paired:
        for b in store.battles(status="ended", limit=-1, light=False):
            if b["id"] == battle_id or b.get("status") != "ended":
                continue
            ids = [(b.get(s) or {}).get("trainer_id") or "" for s in ("p1", "p2")]
            if ids == [rival_id, opponent_id]:
                selected.append((b, "p1"))
            elif ids == [opponent_id, rival_id]:
                selected.append((b, "p2"))
    for row in encounters or []:
        side = row.get("rival_side")
        if side not in ("p1", "p2"):
            raise SilverError("invalid", "Each encounter's rival_side must be p1 or p2.")
        b = store.battle(row["id"])
        if b.get("status") != "ended":
            raise SilverError("conflict", "Every scouting encounter must be finished.")
        opposite = "p2" if side == "p1" else "p1"
        if paired and ((b.get(side) or {}).get("trainer_id") != rival_id or (b.get(opposite) or {}).get("trainer_id") != opponent_id):
            raise SilverError("invalid", "An encounter does not match both trainers of this rivalry.")
        previous = next((s for candidate, s in selected if candidate["id"] == b["id"]), None)
        if previous and previous != side:
            raise SilverError("invalid", "The same encounter cannot identify two different rival sides.")
        if not previous:
            selected.append((b, side))
    observations, species = [], []
    for b, side in selected:
        observed_side = "p2" if side == "p1" else "p1"
        found = encounter_species(b, observed_side)
        observations.append({"id": b["id"], "rival_side": side, "observed_side": observed_side, **found})
        species.extend(x for x in found["species"] if x not in species)
    return {"battle_id": battle_id, "rival_side": rival_side, "rival_id": rival_id, "opponent_id": opponent_id,
            "identity": "trainer_pair" if paired else "explicit_encounters", "species": species, "encounters": observations,
            "coverage": "partial" if species else "none"}


def start(svc, battle_id: str, rival_side: str, *, encounters: list[dict[str, str]] | None = None, size: int = 0) -> dict[str, Any]:
    history = scouting_history(svc.store, battle_id, rival_side, encounters=encounters)
    anchor = svc.store.battle(battle_id)
    seat = anchor.get(rival_side) or {}
    original = svc.store.trainer(history["rival_id"])["team"] if history["rival_id"] else seat.get("sets") or []
    fmt, rules, levels = anchor["format"], anchor.get("rules") or [], anchor.get("level_rules") or {}
    info = svc.format_info(fmt, rules)
    count = min(size or len(original) or 6, info.get("max_team") or 6, 6)
    original = deepcopy(original)
    rematch_seats = {}
    for side in ("p1", "p2"):
        previous = anchor.get(side) or {}
        ai = previous.get("ai") or {}
        options = {"human": bool(previous.get("human")), "ai_level": ai.get("level"), "ai_style": ai.get("style"),
                   "ai_hidden": bool(ai.get("hidden"))}
        rematch_seats[side] = ({"trainer_id": previous["trainer_id"], **options} if previous.get("trainer_id") else
                              {"team": deepcopy(previous.get("sets") or []), "name": previous.get("name") or "", **options})

    def work(jid, progress, cancelled):
        def check_cancelled():
            if cancelled():
                raise SilverError("cancelled", "Rival scouting cancelled.")

        out = {**history, "job_id": jid, "format": fmt, "rules": rules, "level_rules": levels,
               "requested_size": count, "original_team": original, "rematch_seats": rematch_seats,
               "team": [], "choices": [], "saved": False,
               "method": "damaging_move_type_coverage", "status": "unavailable", "missing": [],
               "limits": ["partial_public_species_only", "type_chart_not_win_prediction", "abilities_items_and_battle_state_not_scored"]}
        check_cancelled()
        if not history["species"]:
            return {**out, "reason": "no_public_observations"}
        if not svc.settings["smogon_data"]:
            return {**out, "reason": "popular_sets_disabled"}
        top = svc.smogon.top(fmt, 60)
        candidates = []
        rows = top.get("species") or []
        for i, row in enumerate(rows):
            check_cancelled()
            try:
                found = svc.team_popular_sets([row["species"]], format_=fmt, save=False)
                if found.get("team") and not found.get("unresolved"):
                    candidates.append({"set": found["team"][0], "usage": row["usage"], "source": found["members"][0]})
                else:
                    out["missing"].append({"species": row["species"], "problems": found.get("unresolved") or []})
            except SilverError as exc:
                out["missing"].append({"species": row["species"], "error": exc.message})
            progress(0.9 * (i + 1) / max(1, len(rows)))
        check_cancelled()
        ranked = svc.engine.call("scouting_team", {"candidates": candidates, "observed": history["species"],
                                                   "format": fmt, "rules": rules, "size": count})
        team = ranked["team"]
        out.update(usage_format=top.get("format"), source="Smogon sets and Showdown usage statistics via data.pkmn.cc",
                   candidates=len(candidates), usable_observations=ranked["observed"])
        if len(team) < count:
            return {**out, "reason": "insufficient_candidates"}
        validation = svc.validate_team(fmt, team, rules, levels)
        if not validation["ok"]:
            return {**out, "reason": "invalid_proposal", "problems": validation.get("problems") or []}
        out.update(status="ready", team=team, paste=svc.export_team(team),
                   choices=ranked["choices"])
        check_cancelled()
        progress(1)
        return out

    return svc._job("rival_scout", "Rival scouting", {"battle_id": battle_id, "rival_side": rival_side, "size": count}, work)
