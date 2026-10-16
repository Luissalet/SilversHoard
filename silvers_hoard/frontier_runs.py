"""Streaks at the Gen 4 Battle Frontier facilities with their own rules (frontier.py): the Battle Hall (one Pokémon against rivals
of the type you pick on a board), the Battle Arcade (three Pokémon, a roulette before each battle) and the Battle Castle (three
Pokémon, Castle Points, HP and PP carried from battle to battle), each in singles, doubles and multi with an AI partner, turn by
turn or in real time.

A streak is a run of kind ``facility`` like the others: challenger["frontier"] keeps the facility's state (its phase: type, board,
castle, battle; its challenge type `mode`; in multi the `partner` and its Pokémon) and each stage is a rival, made before its
battle. In a multi battle each side's Pokémon are interleaved (yours, the partner's, yours...; the first rival's, the second's...)
with `owners` telling the engine whose each one is. services.py calls these functions with itself."""

from __future__ import annotations

import math
import re
import secrets
from typing import Any, Optional

from . import facilities, frontier
from .errors import SilverError

FORMAT = "gen4customgame"
TYPES_ES = {"normal": "Normal", "fuego": "Fire", "agua": "Water", "electrico": "Electric", "eléctrico": "Electric", "planta": "Grass",
            "hielo": "Ice", "lucha": "Fighting", "veneno": "Poison", "tierra": "Ground", "volador": "Flying", "psiquico": "Psychic",
            "psíquico": "Psychic", "bicho": "Bug", "roca": "Rock", "fantasma": "Ghost", "dragon": "Dragon", "dragón": "Dragon",
            "siniestro": "Dark", "acero": "Steel"}


def kind_of(r: dict[str, Any]) -> str:
    return frontier.kind_of(r.get("target_id", "")) if r.get("kind") == "facility" else ""


RT_TURN_SECONDS = 6   # a turn of the games in real time (engine/src/realtime/sim.mjs TRICK_ROOM_TURN): the Arcade counts turns by it


def battle_format(svc: Any, ch: dict[str, Any], mode: str = "") -> str:
    """Generation 4 rules (gen4customgame; gen4doublescustomgame for doubles and multi), or the custom game of the generation of the
    format the person chose instead."""
    mode = mode or (ch.get("frontier") or {}).get("mode") or "single"
    doubles = "doubles" if mode != "single" else ""
    override = ch.get("format_override") or ""
    if not override:
        return f"gen4{doubles}customgame"
    gen = svc.format_info(override).get("gen") or int((re.match(r"gen(\d)", override) or [0, 9])[1])
    return f"gen{gen}{doubles}customgame"


def _party_info(svc: Any, sets: list[dict[str, Any]], fmt: str) -> list[dict[str, Any]]:
    return svc.engine.call("frontier_party", {"sets": sets, "format": fmt})["pokemon"]


def _party_mon(s: dict[str, Any], x: dict[str, Any]) -> dict[str, Any]:
    return {"set": s, "species": x["species"], "num": x["num"], "types": x["types"], "ability": x["ability"], "level": s["level"],
            "maxhp": x["maxhp"], "hp": x["maxhp"], "status": "", "item": s.get("item") or "", "nature": x.get("nature") or "",
            "moves": [m["name"] for m in x["moves"]], "pp": [m["pp"] for m in x["moves"]], "maxpp": [m["pp"] for m in x["moves"]]}


def _copy_for(kind: str, s: dict[str, Any], level: int) -> dict[str, Any]:
    """A Pokémon as a facility takes it: the Hall keeps it as it is (held item too) at the party level; the Arcade and the Castle
    copy it at level 50 at most and without its held item."""
    s = {k: v for k, v in s.items() if k != "level_range"}
    if kind == "hall":
        s["level"] = max(1, min(100, int(level or 50)))
    else:
        s["level"] = min(int(s.get("level") or 100), frontier.LEVEL_CAP)
        s.pop("item", None)
    return s


def _later(info: list[dict[str, Any]]) -> list[str]:
    return [x["species"] for x in info if x.get("gen", 0) > 4] + [m["name"] for x in info for m in x["moves"] if m.get("gen", 0) > 4]


def partner_choices() -> list[dict[str, Any]]:
    """The facility's partner trainers a multi streak can take (`partner` = their id)."""
    return [{"id": str(tid), **frontier.partner_card(tid)} for tid in frontier.PARTNERS]


def _partner(svc: Any, f: dict[str, Any], kind: str, partner: str, challenger_id: str, party: list[dict[str, Any]], level: int,
             fmt: str, check_gen: bool) -> dict[str, Any]:
    """The AI partner of a multi streak: one of the facility's partner trainers (300-304: Cheryl, Mira, Riley, Marley, Buck; their
    Pokémon drawn from their Frontier sets) or one of your own trainers (the first Pokémon of its team, taken as yours are)."""
    n = frontier.party_size(kind, "multi")
    pid = str(partner or "300").strip()
    if pid.isdigit() and int(pid) in frontier.PARTNERS:
        tid = int(pid)
        sets = frontier.partner_sets(tid, kind, level, frontier.lc("partner", secrets.token_hex(8)), [s["species"] for s in party])
        out = {"kind": "frontier", "id": pid, **frontier.partner_card(tid), "ai_level": frontier.ai_level(7), "ai_style": "balanced"}
    else:
        if pid == challenger_id:
            raise SilverError("invalid", "The partner is another trainer: pick one of the facility's partners or another of your trainers.")
        t = svc.store.trainer(pid)
        team = t.get("team") or []
        if len(team) < n:
            raise SilverError("invalid", f"{t['name']} needs {n} Pokémon to be the partner at {f['name']}.")
        sets = [_copy_for(kind, s, level) for s in team[:n]]
        out = {"kind": "trainer", "id": pid, "trainer_id": pid, "name": t["name"], "name_en": t["name"], "avatar": t.get("avatar") or "",
               "ai_level": t.get("ai_level") or "hard", "ai_style": t.get("ai_style") or "balanced"}
    info = _party_info(svc, sets, fmt)
    if check_gen and _later(info):
        raise SilverError("invalid", f"{f['name']} plays by Generation 4 rules and the partner's {', '.join(dict.fromkeys(_later(info)[:6]))} came later.",
                          hint="Pick another partner, or pass format (e.g. gen9customgame) to keep them with later rules.")
    out["party"] = [_party_mon(s, x) for s, x in zip(sets, info)]
    return out


def start(svc: Any, *, f: dict[str, Any], challenger: dict[str, Any], challenger_id: str, auto: bool, mode: str, level: int,
          picks: Optional[list[int]], format_override: str, stop_at: int, rt_arena: str, partner: str = "") -> str:
    """A new streak: the challenger's Pokémon for it (`picks` are team indexes, the first ones by default: Hall 1, 2 in doubles;
    Arcade and Castle 3, 2 in multi), at the party level (Hall: `level`, 50 if 0) or capped at 50 without held items (Arcade and
    Castle); in multi, the AI partner (`partner`: a facility partner's id, 300 by default, or one of your trainer ids)."""
    kind = frontier.kind_of(f["id"])
    fmode = frontier.mode_of(f["id"])
    if mode == "realtime" and "realtime" not in f.get("modes", ["classic"]):
        raise SilverError("invalid", f"{f['name']} is turn-based only.", hint="Use mode=classic.")
    if partner and fmode != "multi":
        raise SilverError("invalid", "partner is for the multi challenges (hall4_multi, arcade4_multi, castle4_multi).")
    n = frontier.party_size(kind, fmode)
    team = challenger.get("team") or []
    if len(team) < n:
        raise SilverError("invalid", f"{challenger['name']} needs {n} Pokémon for {f['name']}.")
    picks = list(range(n)) if not picks else [int(i) for i in picks]
    if len(picks) != n or len(set(picks)) != n or any(not 0 <= i < len(team) for i in picks):
        raise SilverError("invalid", f"picks: {n} different indexes of {challenger['name']}'s team (0-{len(team) - 1}).")
    fmt = battle_format(svc, {"format_override": format_override}, fmode)
    party = [_copy_for(kind, team[i], level) for i in picks]
    info = _party_info(svc, party, fmt)
    if not format_override and _later(info):
        raise SilverError("invalid", f"{f['name']} plays by Generation 4 rules and {', '.join(dict.fromkeys(_later(info)[:6]))} came later.",
                          hint="Pick other Pokémon, or pass format (e.g. gen9customgame) to keep them with later rules.")
    mate = _partner(svc, f, kind, partner, challenger_id, party, int(level or 50), fmt, not format_override) if fmode == "multi" else None
    if kind == "hall":
        st = frontier.hall_new(info[0], party[0]["level"])
    elif kind == "arcade":
        st = {"kind": "arcade", "phase": "board", "speed": frontier.arcade_speed_start(0), "random_next": False, "bp_gain": 0, "bp": 0, "rounds": 0}
    else:
        st = frontier.castle_new()
    st["mode"] = fmode
    if mate:
        st["partner"] = mate
    st["party"] = [_party_mon(s, x) for s, x in zip(party, info)]
    rid = svc.store.add_run({"kind": "facility", "target_id": f["id"], "target_name": f["name_es"], "challenger_id": challenger_id,
                             "challenger": {"name": challenger["name"], "avatar": challenger["avatar"], "team": challenger["team"], "auto": auto,
                                            "format_override": format_override, "level": int(level or 50), "stop_at": int(stop_at or 0),
                                            "rt_arena": rt_arena, "picks": picks, "frontier": st},
                             "stages": [], "step": 0, "status": "active", "mode": mode})
    svc.emit("run.started", {"id": rid, "kind": "facility", "target": f["name_es"]})
    begin(svc, rid)
    if auto:
        act(svc, rid)
    return rid


def _sprites() -> frozenset:
    return facilities._sprite_names()


def _multi(st: dict[str, Any]) -> bool:
    return (st.get("mode") or "single") == "multi" and bool(st.get("partner"))


def side_party(st: dict[str, Any]) -> list[dict[str, Any]]:
    """The challenger's side as the battle has it: the party, interleaved with the partner's in multi."""
    return frontier.interleave(st["party"], st["partner"]["party"]) if _multi(st) else list(st["party"])


def _whose(st: dict[str, Any], index: int) -> tuple[Optional[dict[str, Any]], bool]:
    """The party Pokémon behind a position of the challenger's side in battle, and whether it is the partner's."""
    if _multi(st):
        lst = st["partner"]["party"] if index % 2 else st["party"]
        k = index // 2
        return (lst[k] if 0 <= k < len(lst) else None), bool(index % 2)
    return (st["party"][index] if 0 <= index < len(st["party"]) else None), False


def begin(svc: Any, rid: str) -> None:
    """Get the next battle ready: the Hall waits for a type; the Arcade makes the rival and its roulette; the Castle makes the rival
    and opens its services."""
    r = svc.store.run(rid)
    ch = r.get("challenger") or {}
    st = ch["frontier"]
    kind = st["kind"]
    number = r["step"] + 1
    stages = list(r["stages"])
    if kind == "hall":
        st["reset"] = frontier.hall_reset_if_maxed(st)
        st["phase"] = "type"
    else:
        rival = frontier.facility_rival(kind, st, number, rid, _sprites())
        rival.update({"trainer_id": "", "battle_id": "", "result": ""})
        rival["info"] = _party_info(svc, rival["seat"]["team"], battle_format(svc, ch))
        if kind == "arcade":
            st["board"] = frontier.arcade_board((number - 1) // 7, (number - 1) % 7, int(st.get("bp_gain") or 0), int(st["speed"]),
                                                bool(st.get("random_next")), frontier.lc(rid, "board", number))
            st["random_next"] = False   # random motion lasts one board
            st["last_event"] = st.pop("event", None)   # what the last roulette did (a skipped battle shows it on the next board)
            st["phase"] = "board"
        else:
            rival["castle"] = {"levels": [0] * len(rival["seat"]["team"]), "seen": [{} for _ in rival["seat"]["team"]]}
            st["phase"] = "castle"
        stages.append(rival)
    svc.store.update_run(rid, {"stages": stages, "challenger": {**ch, "frontier": st}})


def _need(svc: Any, rid: str, kind: str, phase: str) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
    r = svc.store.run(rid)
    k = kind_of(r)
    if k != kind:
        names = {"hall": "a Battle Hall", "arcade": "a Battle Arcade", "castle": "a Battle Castle"}
        raise SilverError("invalid", f"This is not {names[kind]} streak.")
    if r["status"] != "active":
        raise SilverError("ended", "This streak is over.")
    ch = r.get("challenger") or {}
    st = ch["frontier"]
    if st.get("phase") != phase:
        raise SilverError("conflict", f"The streak is not waiting for that now (it is at: {st.get('phase')}).",
                          hint="challenge_get shows the streak; open the battle if one is on.")
    return r, ch, st


def _save(svc: Any, r: dict[str, Any], ch: dict[str, Any], st: dict[str, Any], **values: Any) -> None:
    svc.store.update_run(r["id"], {**values, "challenger": {**ch, "frontier": st}})


def hall_cell(value: Any) -> int:
    """A cell of the Hall board from its index (0-16) or its type in English or Spanish."""
    if isinstance(value, int) or (isinstance(value, str) and value.strip().lstrip("-").isdigit()):
        return int(value)
    name = str(value or "").strip().lower()
    name = TYPES_ES.get(name, name).lower()
    types = [t.lower() for t in frontier.hall_types()]
    return types.index(name) if name in types else -1


def hall_pick(svc: Any, rid: str, cell: Any) -> dict[str, Any]:
    """Pick the type of the next rival on the Hall board and start the battle."""
    r, ch, st = _need(svc, rid, "hall", "type")
    c = hall_cell(cell)
    if not 0 <= c <= 16:
        raise SilverError("invalid", "cell is 0-16 or a type (Normal, Fire, Water, ... Steel).")
    if st["ranks"][c] >= 10:
        raise SilverError("conflict", f"{frontier.hall_types()[c]} is at rank 10: pick another type.")
    rival = frontier.hall_rival(st, r["step"] + 1, c, rid, _sprites())
    rival.update({"trainer_id": "", "battle_id": "", "result": ""})
    st["phase"] = "battle"
    st["cell"] = c
    _save(svc, r, ch, st, stages=[*r["stages"], rival])
    svc._run_battle(rid)
    return svc.run_view(svc.store.run(rid))


def arcade_stop(svc: Any, rid: str, panel: int = -1, frames: int = -1) -> dict[str, Any]:
    """Stop the roulette: on `panel` (0-15, where the cursor stopped on the screen), or after `frames` frames of motion, or (neither)
    at a random moment of the 15 seconds before it stops by itself. Its event applies to the next battle, which then starts
    (or is skipped)."""
    r, ch, st = _need(svc, rid, "arcade", "board")
    board = st["board"]
    number = r["step"] + 1
    if 0 <= int(panel) < 16:
        p = int(panel)
    elif int(frames) >= 0:
        p = frontier.arcade_panel_at(board, int(frames))
    else:
        p = frontier.arcade_panel_at(board, frontier.arcade_auto_frames(board, frontier.lc(rid, "stop", number)))
    stages = list(r["stages"])
    rival = stages[r["step"]]
    ev = frontier.arcade_apply(board["panels"][p], board, side_party(st), rival.get("info") or [], frontier.lc(rid, "event", number))
    ev["panel"] = p
    if ev.get("speed"):
        st["speed"] = max(0, min(7, int(st["speed"]) + ev["speed"]))
    if ev.get("random_next"):
        st["random_next"] = True
    if ev.get("bp"):
        st["bp"] = int(st.get("bp") or 0) + ev["bp"]
    st["event"] = ev
    rival["arcade"] = {k: v for k, v in ev.items() if k != "start"}
    if ev.get("skip"):   # counts as a win without a battle; the next board keeps the last score
        rival.update(result="won", skipped=True)
        stages[r["step"]] = rival
        after = {"bp": 0}
        _round_end(st, "arcade", r["step"] + 1, after)
        rival["after"] = after
        _advance(svc, r, ch, st, stages)
        return svc.run_view(svc.store.run(rid))
    st["phase"] = "battle"
    stages[r["step"]] = rival
    _save(svc, r, ch, st, stages=stages)
    svc._run_battle(rid)
    return svc.run_view(svc.store.run(rid))


def castle_service(svc: Any, rid: str, service: str, mon: int = -1, item: str = "") -> dict[str, Any]:
    """A Castle service between battles (heal, rental, rank ups, scouting the rival, its level) or skip (50 CP)."""
    if service == "go":
        return castle_go(svc, rid)
    r, ch, st = _need(svc, rid, "castle", "castle")
    stages = list(r["stages"])
    rival = stages[r["step"]]
    number = r["step"] + 1
    if service == "skip":
        if not frontier.castle_skip_ok(number, st.get("mode") or "single"):
            raise SilverError("conflict", "Skipping is offered from the 4th round on and never before the Castle Valet's battle.")
        if st["cp"] < 50:
            raise SilverError("conflict", f"Not enough CP ({st['cp']} of 50).")
        st["cp"] -= 50
        for m in st["party"]:
            m["status"] = ""
        rival.update(result="won", skipped=True)
        after = {"bp": 0, "cp_spent": 50}
        _round_end(st, "castle", number, after)
        rival["after"] = after
        stages[r["step"]] = rival
        _advance(svc, r, ch, st, stages)
        return svc.run_view(svc.store.run(rid))
    try:
        done = frontier.castle_do(st, rival, service, int(mon), item)
    except frontier.Refusal as e:
        raise SilverError("conflict" if e.code in ("cp", "rank", "max", "no_benefit", "holding", "check_first") else "invalid", e.message,
                          refusal=e.code) from None
    stages[r["step"]] = rival
    st["last"] = done
    _save(svc, r, ch, st, stages=stages)
    return {**svc.run_view(svc.store.run(rid)), "done": done}


def castle_go(svc: Any, rid: str) -> dict[str, Any]:
    r, ch, st = _need(svc, rid, "castle", "castle")
    st["phase"] = "battle"
    _save(svc, r, ch, st)
    svc._run_battle(rid)
    return svc.run_view(svc.store.run(rid))


def next_step(svc: Any, r: dict[str, Any]) -> Optional[dict[str, Any]]:
    """challenge_next on a Frontier streak: the Castle goes to battle as it is, the Arcade's roulette stops at a random moment, the
    Hall needs a type. None when a battle is due (services starts it)."""
    phase = ((r.get("challenger") or {}).get("frontier") or {}).get("phase")
    if phase == "type":
        raise SilverError("conflict", "Pick the next rival's type on the Hall board first.", hint="frontier_hall_pick with a type or cell 0-16.")
    if phase == "board":
        return arcade_stop(svc, r["id"])
    if phase == "castle":
        return castle_go(svc, r["id"])
    return None


def _set_of(m: dict[str, Any]) -> dict[str, Any]:
    s = {k: v for k, v in m["set"].items() if k != "item"}
    if m.get("item"):
        s["item"] = m["item"]
    return s


def battle_parts(svc: Any, r: dict[str, Any]) -> dict[str, Any]:
    """The battle of the current stage: both teams as the facility makes them (a multi side interleaved, with its owners and the
    person's AI partner), the format and the start state."""
    ch = r.get("challenger") or {}
    st = ch["frontier"]
    kind = st["kind"]
    multi = _multi(st)
    stage = r["stages"][r["step"]]
    fmt = battle_format(svc, ch)
    mine = [_set_of(m) for m in side_party(st)]
    own = len(st["party"])
    theirs = [dict(x) for x in stage["seat"]["team"]]
    owners1 = frontier.owners_of(own, len(st["partner"]["party"])) if multi else None
    owners2 = list(stage["seat"].get("owners") or []) or None
    start: Optional[dict[str, Any]] = None
    if kind == "hall" or multi:   # no team preview: the Hall's one or two Pokémon, a multi battle's leads are each trainer's first
        rules: list[str] = []
    else:
        info = svc.format_info(fmt)
        picked = f"Picked Team Size = {len(mine)}"
        rules = [picked] if info.get("team_preview") else ["Team Preview", picked]
    if kind == "castle":
        levels = (stage.get("castle") or {}).get("levels") or []
        for i, x in enumerate(theirs):
            x["level"] = 50 + (levels[i] if i < len(levels) else 0)
        carried = [{"hp": m["hp"], "maxhp": m["maxhp"], "pp": m["pp"], "maxpp": m["maxpp"], **({"status": m["status"]} if m.get("status") else {})}
                   for m in st["party"]]
        # the partner comes healed to every battle [UNVERIFIED: the Castle's services only reach your own Pokémon]
        start = {"p1": frontier.interleave(carried, [{} for _ in st["partner"]["party"]]) if multi else carried}
    elif kind == "arcade":
        ev = st.get("event") or {}
        give, up = ev.get("give_item"), ev.get("level_up")
        if give:
            for x in mine if give["side"] == "p1" else theirs:
                x["item"] = give["item"]
        if up:
            for x in mine if up["side"] == "p1" else theirs:
                x["level"] = min(100, int(x.get("level") or 50) + int(up["levels"]))
        start = ev.get("start")
        if ev.get("swap"):   # the person plays the rival's party (level 50, no items) and the AI the person's
            mine, theirs = [{k: v for k, v in x.items() if k != "item"} for x in theirs], mine
            owners1, owners2 = owners2, owners1
    auto = bool(ch.get("auto"))
    name = ch.get("name", "")
    p1: dict[str, Any] = {"team": mine, "name": name, "avatar": ch.get("avatar", ""), "human": not auto}
    if multi:
        mate = st["partner"]
        p1.update(name=f"{name} & {mate['name']}"[:40], owners=owners1,
                  partner={"name": mate["name"], "avatar": mate.get("avatar", ""), "ai_level": mate.get("ai_level") or "expert",
                           "ai_style": mate.get("ai_style") or "balanced"})
    p2 = {**stage["seat"], "team": theirs, "name": stage.get("seat_name") or stage["name"], "avatar": stage.get("avatar", ""), "human": False}
    if owners2:
        p2["owners"] = owners2
    return {"p1": p1, "p2": p2, "format": fmt, "rules": rules, "level_rules": {}, "start": start}


def end_state(b: dict[str, Any]) -> dict[str, Any]:
    """Each side's Pokémon as a battle left them, in the order of the sets ({turns, p1: [{index, hp, maxhp, fainted, status, item,
    pp, maxpp}], p2}): the engine's end state of a turn-based battle, or the real-time summary (a turn counted every 6 s)."""
    summary = b.get("summary") or {}
    if summary.get("end"):
        return summary["end"]
    if summary.get("mode") != "realtime" and b.get("mode") != "realtime":
        return {}
    out: dict[str, Any] = {"turns": max(1, math.ceil(float(summary.get("seconds") or 0) / RT_TURN_SECONDS))}
    for sid, side in (summary.get("sides") or {}).items():
        rows = []
        for i, p in enumerate(side.get("pokemon") or []):
            fainted = bool(p.get("fainted"))
            rows.append({"index": i, "species": p.get("species") or "", "hp": 0 if fainted else int(round(float(p.get("hp") or 0))),
                         "maxhp": int(p.get("maxhp") or 0), "fainted": fainted, "status": "" if fainted else p.get("status") or "",
                         "item": p.get("item") or "", **({"pp": list(p["pp"]), "maxpp": list(p.get("maxpp") or p["pp"])} if p.get("pp") else {})})
        out[sid] = rows
    return out


def _round_end(st: dict[str, Any], kind: str, streak: int, after: dict[str, Any]) -> None:
    if streak % frontier.ROUND[kind] == 0:
        st["rounds"] = int(st.get("rounds") or 0) + 1
        after["bp"] = frontier.round_bp(kind, st["rounds"], streak, st.get("mode") or "single")
        st["bp"] = int(st.get("bp") or 0) + after["bp"]


def after_battle(svc: Any, r: dict[str, Any], b: dict[str, Any]) -> None:
    """A Frontier battle ended: a loss ends the streak; a win updates the facility (Hall rank, Arcade score and kept items, Castle
    Points and the party as it ended), pays Battle Points at the end of a round and gets the next battle ready."""
    stages = list(r["stages"])
    step = r["step"]
    ch = r.get("challenger") or {}
    st = ch["frontier"]
    won = b.get("winner_side") == "p1"
    stages[step]["result"] = "won" if won else "lost"
    if not won:
        st["phase"] = "over"
        svc.store.update_run(r["id"], {"stages": stages, "status": "lost", "challenger": {**ch, "frontier": st}})
        svc.emit("run.lost", {"id": r["id"]})
        return
    end = end_state(b)
    turns = int(end.get("turns") or b.get("turns") or 0)
    streak = step + 1
    kind = st["kind"]
    if kind == "hall":
        after = frontier.hall_after_win(st, stages[step], streak)
    elif kind == "castle":   # Castle Points and the carried HP and PP are your own Pokémon's (your half in multi)
        mine = [e for e in end.get("p1") or [] if not _whose(st, e.get("index", -1))[1]]
        if _multi(st):
            mine = [{**e, "index": e["index"] // 2} for e in mine]
        after = frontier.castle_after_win(st, stages[step], mine, streak)
    else:
        ev = st.get("event") or {}
        st["bp_gain"] = frontier.arcade_score(end.get("p1") or [], turns)   # both halves count in multi
        for e in end.get("p2" if ev.get("swap") else "p1") or []:   # a given item not used stays held
            m, _ = _whose(st, e.get("index", -1))
            if m is not None:
                m["item"] = e.get("item") or ""
        after = {"bp_gain": st["bp_gain"], "bp": 0}
        _round_end(st, "arcade", streak, after)
    stages[step]["after"] = after
    _advance(svc, r, ch, st, stages)


def _advance(svc: Any, r: dict[str, Any], ch: dict[str, Any], st: dict[str, Any], stages: list[dict[str, Any]]) -> None:
    streak = r["step"] + 1
    _save(svc, r, ch, st, stages=stages, step=streak)
    svc.emit("run.streak", {"id": r["id"], "streak": streak})
    begin(svc, r["id"])
    stop = int(ch.get("stop_at") or 0)
    if ch.get("auto") and (not stop or streak < stop):
        act(svc, r["id"])


def act(svc: Any, rid: str) -> None:
    """The AI's turn between battles (auto): the Hall's lowest-rank type, the roulette stopped at a random moment, the Castle's heals."""
    r = svc.store.run(rid)
    if r["status"] != "active":
        return
    st = (r.get("challenger") or {}).get("frontier") or {}
    number = r["step"] + 1
    if st.get("phase") == "type":
        hall_pick(svc, rid, frontier.hall_auto_cell(st, frontier.lc(rid, "auto", number)))
    elif st.get("phase") == "board":
        arcade_stop(svc, rid)
    elif st.get("phase") == "castle":
        ch = r["challenger"]
        stages = list(r["stages"])
        st["last_auto"] = frontier.castle_auto(st, stages[r["step"]])
        _save(svc, r, ch, st, stages=stages)
        castle_go(svc, rid)


def brain_stage(boss: tuple, number: int, run_id: str) -> Optional[dict[str, Any]]:
    """A Frontier Brain of an existing facility whose team the decompiled game gives (Thorton at the Platinum Battle Factory)."""
    if not str(boss[2]).startswith("frontier:"):
        return None
    t = frontier.thorton_team(number, run_id)
    if not t:
        return None
    card = frontier.trainer_card(t["trainer"])
    return {"trainer_id": "", "battle_id": "", "result": "", "number": number, "boss": True, "name": card["name"], "title": boss[3],
            "avatar": card["avatar"], "character": card.get("brain", ""), "set_ids": t["set_ids"],
            "seat": {"team": t["team"], "ai_level": t["ai_level"], "ai_style": "balanced"}}


def public_stage(stage: dict[str, Any]) -> dict[str, Any]:
    """A stage as the streak shows it: the rival's team and what the app knows of it stay hidden until its battle."""
    if stage.get("result") or stage.get("battle_id"):
        return {k: v for k, v in stage.items() if k != "info"}
    return {k: v for k, v in stage.items() if k not in ("seat", "info", "set_id", "set_ids", "trainers_rolled", "castle")}


def _mon_view(m: dict[str, Any]) -> dict[str, Any]:
    return {k: m.get(k) for k in ("species", "level", "item", "hp", "maxhp", "status", "moves", "pp", "maxpp", "types", "ability")}


def view(svc: Any, r: dict[str, Any]) -> dict[str, Any]:
    """What the between-battles page and the tools show of a Frontier streak."""
    ch = r.get("challenger") or {}
    st = ch.get("frontier") or {}
    kind = st.get("kind", "")
    rl = frontier.ROUND.get(kind, 7)
    number = r["step"] + 1
    stage = r["stages"][r["step"]] if r["step"] < len(r["stages"]) else None
    mode = st.get("mode") or "single"
    out: dict[str, Any] = {"kind": kind, "mode": mode, "phase": st.get("phase", ""), "number": number, "round": (number - 1) // rl + 1,
                           "round_battle": (number - 1) % rl + 1, "round_length": rl, "bp": int(st.get("bp") or 0),
                           "party": [_mon_view(m) for m in st.get("party") or []], "auto": bool(ch.get("auto")),
                           "brain_next": frontier.brain_number(kind, number) is not None if kind and mode == "single" else False}
    if _multi(st):
        mate = st["partner"]
        out["partner"] = {**{k: mate.get(k) for k in ("kind", "id", "name", "name_en", "avatar", "ai_level")},
                          "avatar_url": svc.avatar_url(mate.get("avatar", "")), "party": [_mon_view(m) for m in mate.get("party") or []]}
    if stage and not stage.get("result"):
        out["rival"] = {k: stage.get(k) for k in ("name", "name_en", "title", "title_en", "avatar", "boss", "number")}
        out["rival"]["avatar_url"] = svc.avatar_url(stage.get("avatar", ""))
        if stage.get("pair"):
            out["rival"]["pair"] = {**stage["pair"], "avatar_url": svc.avatar_url(stage["pair"].get("avatar", ""))}
    if kind == "hall":
        types = frontier.hall_types()
        out.update(level=st.get("level"), reset=bool(st.get("reset")), cell=st.get("cell", -1), matron_rank=st["ranks"][17],
                   board=[{"cell": c, "type": types[c], "rank": st["ranks"][c], "open": st["ranks"][c] < 10} for c in range(17)])
        if stage and not stage.get("result"):
            out["rival"].update(type=stage.get("type"), rank=stage.get("rank"), level=stage.get("level"))
    elif kind == "arcade":
        b = st.get("board") or {}
        out.update(speed=st.get("speed"), bp_gain=int(st.get("bp_gain") or 0), random_next=bool(st.get("random_next")),
                   board={k: b.get(k) for k in ("panels", "start", "speed", "delay", "frames_per_step", "random_motion", "jumps", "odds_row",
                                                 "odds", "stop_frames", "round", "position")},
                   colours=[frontier.arcade_event(e)["colour"] for e in b.get("panels") or []],
                   event={k: v for k, v in (st.get("event") or {}).items() if k != "start"} or None,
                   last_event={k: v for k, v in (st.get("last_event") or {}).items() if k != "start"} or None)
        if st.get("event"):
            out["event"]["targets"] = _event_targets(st, stage, st["event"])
        elif st.get("last_event"):
            prev = r["stages"][r["step"] - 1] if r["step"] >= 1 else None
            out["last_event"]["targets"] = _event_targets(st, prev, st["last_event"])
    elif kind == "castle":
        out.update(cp=int(st.get("cp") or 0), ranks=st.get("ranks"), last=st.get("last"), last_auto=st.get("last_auto"),
                   skip=bool(frontier.castle_skip_ok(number, mode)), skip_cost=50,
                   services=[{"id": s["id"], "cost": s["cost"], "rank": s.get("rank")} for s in frontier.data()["castle"]["services"]],
                   rank_up={k: (frontier.RANK_UP[k][st["ranks"][k]] if st["ranks"][k] < frontier.RANK_MAX[k] else None) for k in frontier.RANK_UP},
                   rank_max=frontier.RANK_MAX,
                   berries=frontier.castle_rentals("berry", st["ranks"]["rental"]), items=frontier.castle_rentals("item", st["ranks"]["rental"]))
        if stage and not stage.get("result"):
            out["scout"] = _scout(stage)
    return out


def _event_targets(st: dict[str, Any], stage: Optional[dict[str, Any]], ev: dict[str, Any]) -> list[str]:
    side = ev.get("side")
    names = [m["species"] for m in side_party(st)] if side == "player" else [x["species"] for x in (stage or {}).get("info") or []]
    return [names[i] for i in ev.get("hit") or [] if i < len(names)]


def _scout(stage: dict[str, Any]) -> list[dict[str, Any]]:
    """What the Castle's scouting has revealed of the rival's Pokémon (and the levels bought)."""
    c = stage.get("castle") or {}
    team = (stage.get("seat") or {}).get("team") or []
    info = stage.get("info") or []
    out = []
    for i, s in enumerate(team):
        seen = (c.get("seen") or [{}] * len(team))[i] if i < len(c.get("seen") or []) else {}
        x = info[i] if i < len(info) else {}
        row: dict[str, Any] = {"index": i, "level": 50 + ((c.get("levels") or [0] * len(team))[i]), "seen": seen}
        if seen.get("species"):
            row.update(species=s["species"], types=x.get("types"))
        if seen.get("stats"):
            row.update(item=s.get("item", ""), nature=s.get("nature", ""), ability=s.get("ability", ""), stats=x.get("stats"))
        if seen.get("moves"):
            row["moves"] = [{"name": m["name"], "pp": m["pp"]} for m in x.get("moves") or []]
        out.append(row)
    return out


def list_extra(f: dict[str, Any], mine: list[dict[str, Any]], svc: Any = None) -> dict[str, Any]:
    """facilities_list's extra fields for a Frontier facility: its kind, challenge type (single, double, multi), modes, Pokémon to
    bring, round length, Battle Points won and, in multi, the facility's partner trainers."""
    kind = frontier.kind_of(f["id"])
    if not kind:
        return {}
    fmode = frontier.mode_of(f["id"])
    bp = sum(int(((r.get("challenger") or {}).get("frontier") or {}).get("bp") or 0) for r in mine)
    out = {"frontier": kind, "frontier_mode": fmode, "modes": f.get("modes", ["classic"]), "picks": frontier.party_size(kind, fmode),
           "round": frontier.ROUND[kind], "bp": bp}
    if fmode == "multi":
        out["partners"] = [{**p, "avatar_url": svc.avatar_url(p["avatar"]) if svc else ""} for p in partner_choices()]
    return out
