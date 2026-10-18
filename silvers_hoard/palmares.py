"""Unified palmarés helpers: gym badges stay on Medallas; this module derives Pokéathlon medals,
Frontier Brain emblems and Progress achievements from stores that already exist.

Pure functions only — no DB, HTTP or services. Callers pass already-loaded rows so API/MCP wiring
can wait until services.py / agent_tools are free.
"""

from __future__ import annotations

from typing import Any, Iterable, Optional

from .facilities import FACILITIES

# Battle numbers where a Frontier Brain appears. Used only to label silver/gold prints; a win is
# still required on a stage marked boss — streak length alone never awards an emblem.
# Built from facilities.FACILITIES boss metadata (Anabel 35/70, Palmer 21/49, Argenta 50/170, …)
# so generic 21/49 is never applied to a modality with different award stages.


def _infer_print(label_es: str, label_en: str, index: int, total: int) -> str:
    es = (label_es or "").lower()
    en = (label_en or "").lower()
    if "plata" in es or "silver" in en:
        return "silver"
    if "oro" in es or "gold" in en:
        return "gold"
    if total == 2:
        return "silver" if index == 0 else "gold"
    if index == 0:
        return "silver"
    if index == total - 1:
        return "gold"
    return "unknown"


def _build_print_tables() -> tuple[dict[str, dict[int, str]], dict[str, dict[int, str]]]:
    by_facility: dict[str, dict[int, str]] = {}
    by_character: dict[str, dict[int, str]] = {}
    for fac in FACILITIES:
        bosses = list(fac.get("bosses") or [])
        if not bosses:
            continue
        fmap: dict[int, str] = {}
        for i, boss in enumerate(bosses):
            number = int(boss[0])
            character = str(boss[1] or "").strip()
            print_ = _infer_print(
                boss[3] if len(boss) > 3 else "",
                boss[4] if len(boss) > 4 else "",
                i,
                len(bosses),
            )
            fmap[number] = print_
            if character:
                by_character.setdefault(character, {})[number] = print_
        by_facility[str(fac["id"])] = fmap
    # Legacy frontier.kind values that predate facility ids (do not collide Anabel tower3 with Palmer).
    by_facility.setdefault("tower", {21: "silver", 49: "gold"})
    by_facility.setdefault("factory", {21: "silver", 49: "gold"})
    by_facility.setdefault("arcade", {21: "silver", 49: "gold"})
    by_facility.setdefault("castle", {21: "silver", 49: "gold"})
    by_facility.setdefault("hall", {50: "silver", 170: "gold"})
    return by_facility, by_character


PRINT_AT_FACILITY, PRINT_AT_CHARACTER = _build_print_tables()

# Back-compat for callers that still expect (silver_at, gold_at) pairs.
BRAIN_PRINT_AT: dict[str, tuple[int, int]] = {
    "tower": (21, 49),
    "factory": (21, 49),
    "arcade": (21, 49),
    "castle": (21, 49),
    "hall": (50, 170),
    "tower3": (35, 70),
    "tower4": (21, 49),
}

STAT_BITS = ("speed", "power", "skill", "stamina", "jump")
MEDAL_BITS = {"speed": 1, "power": 2, "skill": 4, "stamina": 8, "jump": 16}


def identity_key(trainer_id: Optional[str]) -> str:
    """Canonical person key: empty string is the Pokéathlon guest; never coerce None into a real id."""
    if trainer_id is None:
        return ""
    return str(trainer_id)


def pokeathlon_medals(
    rows: Iterable[dict[str, Any]],
    trainer_id: Optional[str],
    *,
    everyone: bool = False,
) -> list[dict[str, Any]]:
    """Species medal masks for one trainer (or guest ''). Guest rows stay on ''; never merge into others.

    Each row: {trainer_id, species, bits}. With everyone=True, masks are OR-merged across people (admin view).
    """
    want = identity_key(trainer_id)
    merged: dict[str, int] = {}
    for r in rows:
        tid = identity_key(r.get("trainer_id"))
        if not everyone and tid != want:
            continue
        sp = (r.get("species") or "").strip()
        if not sp:
            continue
        merged[sp] = merged.get(sp, 0) | int(r.get("bits") or 0)
    out = []
    for sp, bits in sorted(merged.items()):
        stats = [k for k in STAT_BITS if bits & MEDAL_BITS[k]]
        out.append({
            "species": sp,
            "mask": bits,
            "stats": stats,
            "complete": bits == 31,
        })
    return out


def _print_for(kind: str, number: int, character: str = "") -> str:
    """Label silver/gold from facility boss metadata; never invent prints for other stages."""
    found = PRINT_AT_FACILITY.get(kind, {}).get(number)
    if found:
        return found
    char = (character or "").strip()
    if char:
        found = PRINT_AT_CHARACTER.get(char, {}).get(number)
        if found:
            return found
    return "unknown"


def _facility_kind(run: dict[str, Any]) -> str:
    """Prefer concrete facility id (tower3) over legacy short frontier.kind (tower)."""
    target = (run.get("target_id") or "").strip()
    if target.startswith("facility:"):
        return target.split(":", 1)[1]
    if target:
        return target
    st = ((run.get("challenger") or {}).get("frontier") or {})
    return (st.get("kind") or "").strip() or "facility"


def frontier_emblems_from_runs(
    runs: Iterable[dict[str, Any]],
    trainer_id: Optional[str] = None,
) -> list[dict[str, Any]]:
    """Emblems earned by recorded public wins against a Frontier Brain (stage.boss and result==won).

    A later loss or abandoned streak does not remove an emblem already earned. Streak length alone
    (21/49/50/170) never awards one. Stages without boss=True are ignored even if special.
    Proof cites stage number, battle_id and character when present.

    When trainer_id is not None, only that challenger's runs are considered (filter before dedup).
    Emblem ids include challenger_id so two trainers beating the same Brain keep distinct entries
    when scanning everyone (trainer_id=None).
    """
    want = None if trainer_id is None else identity_key(trainer_id)
    earned: dict[str, dict[str, Any]] = {}
    for run in runs:
        if run.get("kind") != "facility":
            continue
        cid = identity_key(run.get("challenger_id"))
        if want is not None and cid != want:
            continue
        kind = _facility_kind(run)
        for stage in run.get("stages") or []:
            if not stage.get("boss"):
                continue
            if stage.get("result") != "won":
                continue
            number = int(stage.get("number") or 0)
            character = (stage.get("character") or "").strip()
            name = (stage.get("name") or stage.get("name_en") or "").strip()
            print_ = _print_for(kind, number, character)
            eid = f"{cid}:{kind}:{character or name or 'brain'}:{print_}:{number}"
            if eid in earned:
                continue
            earned[eid] = {
                "id": eid,
                "facility": kind,
                "character": character,
                "name": name,
                "title": stage.get("title") or stage.get("title_en") or "",
                "print": print_,
                "number": number,
                "battle_id": stage.get("battle_id") or "",
                "run_id": run.get("id") or "",
                "challenger_id": cid,
                "challenger_name": run.get("challenger_name") or "",
                "avatar": stage.get("avatar") or "",
            }
    return sorted(earned.values(), key=lambda e: (e["facility"], e["number"], e["id"]))


def achievements_slice(progress: dict[str, Any], *, unlocked_only: bool = False) -> list[dict[str, Any]]:
    """Pass-through of progress_get achievements, optionally only unlocked ones."""
    items = list(progress.get("achievements") or [])
    if unlocked_only:
        items = [a for a in items if a.get("unlocked")]
    return items


def unify(
    *,
    trainer_id: Optional[str],
    badges: Optional[list[dict[str, Any]]] = None,
    pokeathlon_rows: Optional[Iterable[dict[str, Any]]] = None,
    facility_runs: Optional[Iterable[dict[str, Any]]] = None,
    progress: Optional[dict[str, Any]] = None,
) -> dict[str, Any]:
    """One palmarés card for a person (or guest ''). Gym badges are passed through unchanged."""
    tid = identity_key(trainer_id)
    medals = pokeathlon_medals(pokeathlon_rows or (), tid)
    # Guest (''): all challengers' emblems; a real trainer id: that person only (filter before dedup).
    emblems = frontier_emblems_from_runs(
        facility_runs or (),
        trainer_id=None if tid == "" else tid,
    )
    prog = progress or {}
    ach = achievements_slice(prog)
    return {
        "trainer_id": tid,
        "guest": tid == "",
        "badges": list(badges or []),
        "pokeathlon_medals": medals,
        "frontier_emblems": emblems,
        "achievements": ach,
        "unlocked_achievements": sum(1 for a in ach if a.get("unlocked")),
        "counts": {
            "badges": len(badges or []),
            "pokeathlon_medals": len(medals),
            "pokeathlon_complete": sum(1 for m in medals if m["complete"]),
            "frontier_emblems": len(emblems),
            "achievements_unlocked": sum(1 for a in ach if a.get("unlocked")),
            "achievements_total": len(ach),
        },
    }
