"""The master AI's search: reads {"state", "ms"} as JSON on stdin (the battle as engine/src/master.mjs describes it), runs
poke-engine's Monte Carlo tree search for that long and prints {"ok", "options", "iterations"} on stdout, where each option is a
move (by its slot, with Terastallization or Mega Evolution) or a switch (by the team slot) with its visits and its average score.
``--check`` only says whether poke-engine is installed and built with Terastallization (the 9th generation's rules).

poke-engine (pmariglia, MIT) is a Rust battle engine with Python bindings; it is optional. Without it the app never calls this
script and the master level plays as the expert."""
from __future__ import annotations

import json
import os
import sys


def _side(pe, d: dict, pad_tera: bool):
    mons = []
    for p in d["pokemon"][:6]:
        moves = [pe.Move(id=m["id"], pp=int(m["pp"]), disabled=bool(m["disabled"])) for m in p["moves"][:4]]
        while len(moves) < 4:
            moves.append(pe.Move(id="none", pp=0, disabled=True))
        mons.append(pe.Pokemon(
            id=p["id"], level=int(p["level"]), types=tuple(p["types"]), base_types=tuple(p["base_types"]), hp=int(p["hp"]),
            maxhp=int(p["maxhp"]), ability=p["ability"], base_ability=p["base_ability"], item=p["item"], nature=p["nature"],
            evs=tuple(int(x) for x in p["evs"]), attack=int(p["attack"]), defense=int(p["defense"]),
            special_attack=int(p["special_attack"]), special_defense=int(p["special_defense"]), speed=int(p["speed"]),
            status=p["status"], rest_turns=int(p["rest_turns"]), sleep_turns=int(p["sleep_turns"]), weight_kg=float(p["weight_kg"]),
            moves=moves, mega_evolved=bool(p["mega_evolved"]), terastallized=bool(p["terastallized"]), tera_type=p["tera_type"]))
    # a side that may not terastallize (it already did, or the format forbids it): poke-engine offers Terastallization while no
    # Pokémon of the side is terastallized, so an empty slot gets a fainted one that is
    if pad_tera and len(mons) < 6 and not any(m.terastallized for m in mons):
        mons.append(pe.Pokemon(id="none", level=1, hp=0, maxhp=1, terastallized=True, tera_type="typeless",
                               moves=[pe.Move(id="none", pp=0, disabled=True) for _ in range(4)]))
    b = d.get("boosts") or {}
    dur = d.get("volatile_status_durations") or {}
    return pe.Side(
        pokemon=mons, active_index=pe.PokemonIndex(str(d["active_index"])), force_switch=bool(d.get("force_switch")),
        force_trapped=bool(d.get("force_trapped")), side_conditions=pe.SideConditions(**{k: int(v) for k, v in (d.get("side_conditions") or {}).items()}),
        volatile_statuses=set(d.get("volatile_statuses") or []),
        volatile_status_durations=pe.VolatileStatusDurations(**{k: int(v) for k, v in dur.items()}),
        substitute_health=int(d.get("substitute_health") or 0), wish=tuple(int(x) for x in (d.get("wish") or [0, 0])),
        attack_boost=int(b.get("attack", 0)), defense_boost=int(b.get("defense", 0)), special_attack_boost=int(b.get("special_attack", 0)),
        special_defense_boost=int(b.get("special_defense", 0)), speed_boost=int(b.get("speed", 0)),
        accuracy_boost=int(b.get("accuracy", 0)), evasion_boost=int(b.get("evasion", 0)), last_used_move=d.get("last_used_move") or "move:none")


def build_state(pe, s: dict):
    return pe.State(
        side_one=_side(pe, s["side_one"], not s["side_one"].get("can_tera")),
        side_two=_side(pe, s["side_two"], not s["side_two"].get("can_tera")),
        weather=pe.Weather(s.get("weather") or "none"), weather_turns_remaining=int(s.get("weather_turns_remaining") or 0),
        terrain=pe.Terrain(s.get("terrain") or "none"), terrain_turns_remaining=int(s.get("terrain_turns_remaining") or 0),
        trick_room=bool(s.get("trick_room")), trick_room_turns_remaining=int(s.get("trick_room_turns_remaining") or 0))


def options(state, result) -> list[dict]:
    """MCTS answers name moves by their id and switches by the Pokémon's: back to slots of the side's team and active moveset."""
    side = state.side_one
    active = int(str(side.active_index))
    mons = side.pokemon
    move_ids = [str(m.id).lower() for m in mons[active].moves]
    out = []
    for r in result.side_one:
        name = str(r.move_choice).lower().strip()
        visits = int(r.visits)
        win = float(r.total_score) / visits if visits else 0.0
        if name.startswith("switch "):
            name = name[7:].strip()
        tera = name.endswith("-tera")
        mega = name.endswith("-mega")
        base = name[:-5] if tera or mega else name
        if base in move_ids and not name.startswith("switch"):
            out.append({"kind": "move", "index": move_ids.index(base), "tera": tera, "mega": mega, "visits": visits, "win": win})
            continue
        for i, p in enumerate(mons):
            if i != active and p.hp > 0 and str(p.id).lower() == name:
                out.append({"kind": "switch", "index": i, "visits": visits, "win": win})
                break
    return out


def check(pe) -> dict:
    mon = lambda name, t, mv: pe.Pokemon(id=name, level=50, types=(t, "typeless"), hp=150, maxhp=150, tera_type=t,
                                         moves=[pe.Move(id=mv, pp=16)])
    st = pe.State(side_one=pe.Side(pokemon=[mon("pikachu", "electric", "thunderbolt")]),
                  side_two=pe.Side(pokemon=[mon("squirtle", "water", "watergun")]))
    r = pe.monte_carlo_tree_search(st, iterations=200)
    return {"ok": True, "tera": any(str(x.move_choice).endswith("-tera") for x in r.side_one)}


def main() -> None:
    try:
        import poke_engine as pe
    except BaseException as exc:  # noqa: BLE001 - not installed
        print(json.dumps({"ok": False, "error": f"poke-engine is not installed: {exc}"}))
        return
    try:
        if "--check" in sys.argv:
            print(json.dumps(check(pe)))
            return
        req = json.loads(sys.stdin.read())
        state = build_state(pe, req["state"])
        ms = max(100, min(int(req.get("ms") or 900), 10000))
        threads = max(1, min(4, (os.cpu_count() or 2) // 2))
        result = pe.monte_carlo_tree_search(state, duration_ms=ms, threads=threads)
        print(json.dumps({"ok": True, "options": options(state, result), "iterations": int(result.total_visits)}))
    except BaseException as exc:  # noqa: BLE001 - poke-engine panics on a state it cannot read (a PanicException)
        print(json.dumps({"ok": False, "error": f"{type(exc).__name__}: {exc}"[:400]}))


if __name__ == "__main__":
    main()
