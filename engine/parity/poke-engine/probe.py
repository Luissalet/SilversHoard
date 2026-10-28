"""The probe of the poke-engine parity kit: plays each case's turn in poke-engine (the engine of the master AI) and writes the trace.

    python engine/parity/poke-engine/probe.py <inputs.jsonl> <trace.jsonl>

The state is built with silvers_hoard.master_ai.build_state, the function the master AI itself uses, from the state the corpus holds
(engine/src/master.mjs). poke-engine returns every outcome of the turn with its probability: the probe takes the likeliest branch (the
oracle takes the likeliest result of every chance in the simulator), or, in a case that fixes critical hits, the branch where they land.
Events: the same as the oracle's (see oracle.mjs): who hit first and how hard (the engine's own damage calculation), and the summary read
from poke-engine's state after the branch.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))

SIDE_KEYS = ["stealth_rock", "spikes", "toxic_spikes", "sticky_web", "tailwind", "reflect", "light_screen", "aurora_veil", "safeguard",
             "mist", "lucky_chant", "toxic_count"]
BOOSTS = {"attack": "attack_boost", "defense": "defense_boost", "special_attack": "special_attack_boost",
          "special_defense": "special_defense_boost", "speed": "speed_boost", "accuracy": "accuracy_boost", "evasion": "evasion_boost"}
DAMAGE = re.compile(r"^Damage Side(One|Two): (\d+)$")
STATUS_NAMES = {"burn": "burn", "paralyze": "paralyze", "paralysis": "paralyze", "sleep": "sleep", "freeze": "freeze", "poison": "poison",
                "toxic": "toxic"}


def side_summary(side) -> dict:
    mons = [p for p in side.pokemon if str(p.id).lower() != "none"]
    ids = [str(p.id).lower() for p in mons]
    out: dict = {"active": None, "hp": {}, "status": {}, "item": {}, "tera": []}
    active = int(str(side.active_index))
    if 0 <= active < len(side.pokemon):
        out["active"] = str(side.pokemon[active].id).lower()
    for p, pid in zip(mons, ids):
        out["hp"][pid] = int(p.hp)
        status = str(p.status).lower()
        # the simulator forgets the status and the Terastallization of a Pokémon that faints; poke-engine keeps them
        if status != "none" and p.hp > 0:
            out["status"][pid] = STATUS_NAMES.get(status, status)
        out["item"][pid] = str(p.item).lower()
        if p.terastallized and p.hp > 0:
            out["tera"].append(pid)
    out["tera"].sort()
    fainted = 0 <= active < len(side.pokemon) and side.pokemon[active].hp <= 0
    out["boosts"] = {k: 0 if fainted else int(getattr(side, attr)) for k, attr in BOOSTS.items()}
    conds = side.side_conditions
    out["side"] = {k: int(getattr(conds, k)) for k in SIDE_KEYS if int(getattr(conds, k, 0))}
    out["volatile"] = [] if fainted else sorted(str(v).lower() for v in side.volatile_statuses)
    out["sub"] = 0 if fainted else int(side.substitute_health)
    return out


def summary(state, raw: dict | None = None) -> dict:
    """The shape the oracle writes. poke-engine turns an item it has no name for into `unknownitem`; the battle's own item is kept for
    those, so only the items it does know can differ."""
    out = _summary(state)
    if raw:
        for key, side in (("p1", "side_one"), ("p2", "side_two")):
            for mon in raw[side]["pokemon"]:
                got = out[key]["item"].get(mon["id"])
                if got == "unknownitem":
                    out[key]["item"][mon["id"]] = mon["item"]
    return out


def _summary(state) -> dict:
    return {
        "weather": str(state.weather).lower(), "weather_turns": int(state.weather_turns_remaining),
        "terrain": str(state.terrain).lower(), "terrain_turns": int(state.terrain_turns_remaining),
        "trick_room": bool(state.trick_room), "trick_room_turns": int(state.trick_room_turns_remaining),
        "p1": side_summary(state.side_one), "p2": side_summary(state.side_two),
    }


def first_damage(instructions: list[str]) -> dict:
    """The first Damage instruction against each side, and who was damaged first (any damage, whatever its source)."""
    hit: dict = {"One": None, "Two": None}
    first = None
    for text in instructions:
        m = DAMAGE.match(text)
        if m:
            if hit[m.group(1)] is None:
                hit[m.group(1)] = int(m.group(2))
            if first is None:
                first = m.group(1)
    return {"p1_damaged": hit["One"], "p2_damaged": hit["Two"], "first_hit": first}


def direct_hits(instructions: list[str], calc, hp: dict) -> list[tuple[str, int]]:
    """The moves that did direct damage, in order, as (side, amount). poke-engine does not say where a Damage instruction comes from;
    one that is about the size of the move's own damage (between the lowest roll and the highest, or whatever was left of the target) is
    the move's, anything else (a trap, a status, hazards, recoil, a rough skin) is not."""
    left = dict(hp)
    out: list[tuple[str, int]] = []
    for text in instructions:
        m = DAMAGE.match(text)
        if not m:
            continue
        target, amount = m.group(1), int(m.group(2))
        attacker = "p2" if target == "One" else "p1"
        rolls = calc[1 if attacker == "p2" else 0]
        high = max(rolls)
        low = rolls[0]
        if attacker not in [side for side, _ in out] and high > 0 and amount <= high + 1 and (amount >= 0.85 * low - 1 or amount >= left[target]):
            out.append((attacker, amount))
        left[target] = max(0, left[target] - amount)
    return out


def choose(branches, crit: str):
    """The likeliest branch; with fixed critical hits, the one where the forced side's move hits hardest and the other side's does not crit."""
    def key(b):
        d = first_damage([str(i) for i in b.instruction_list])
        d1, d2 = d["p1_damaged"] or 0, d["p2_damaged"] or 0
        pct = -b.percentage
        if crit == "p1":
            return (-d2, d1, pct)
        if crit == "p2":
            return (-d1, d2, pct)
        if crit == "both":
            return (-d1, -d2, pct)
        return (pct,)
    return min(branches, key=key)


def merged_calc(pe, state, a: str, b: str):
    """The damage rolls of both moves; of each side, those of the order in which its move does damage."""
    first = pe.calculate_damage(state, a, b, True)
    second = pe.calculate_damage(state, a, b, False)
    return tuple(max(x, y, key=lambda rolls: max(rolls)) for x, y in zip(first, second))


def calc_view(pe, build_state, raw: dict, a: str, b: str, state):
    """The state and the plain moves for pe.calculate_damage: a `-tera` decision becomes a Terastallized attacker."""
    if not (a.endswith("-tera") or b.endswith("-tera")):
        return state, a, b
    raw2 = json.loads(json.dumps(raw))
    for key, move in (("side_one", a), ("side_two", b)):
        if move.endswith("-tera"):
            side = raw2[key]
            side["pokemon"][int(side["active_index"])]["terastallized"] = True
    return build_state(pe, raw2), a.removesuffix("-tera"), b.removesuffix("-tera")


def play(pe, build_state, case: dict) -> dict:
    flags = case["flags"]
    if case["a"] is None or case["b"] is None:
        raise ValueError("a decision the engine has no name for")
    raw = case["state"]
    state = build_state(pe, raw)
    branches = pe.generate_instructions(state, case["a"], case["b"])
    crit = case.get("crit", "none")
    branch = choose(branches, crit)
    texts = [str(i) for i in branch.instruction_list]
    hp = {"One": raw["side_one"]["pokemon"][int(raw["side_one"]["active_index"])]["hp"],
          "Two": raw["side_two"]["pokemon"][int(raw["side_two"]["active_index"])]["hp"]}
    # the engine's own damage of each move at the highest roll and with a critical hit, whether or not the move gets to land; its damage
    # calculator takes plain moves, so a Terastallization is put into the state first
    calc_state, a, b = calc_view(pe, build_state, raw, case["a"], case["b"], state)
    # (its last argument is whether the first side moves first, which a move that needs to go first, as Sucker Punch does, depends on:
    # each side's damage is read from the order in which its move can work)
    calc = merged_calc(pe, calc_state, a, b)
    hits = direct_hits(texts, calc, hp)
    after = state.apply_instructions(branch)
    ev = []
    if flags["order"]:
        # who hit first, and how hard: the damage of the branch poke-engine plays (the average roll, with whatever happened earlier in the turn)
        first, amount = hits[0] if hits else (None, 0)
        ev.append(["state", "order", first])
        ev.append(["state", "damage.first", amount if amount > 0 else None])
    shown = summary(after, raw)
    if case.get("ends"):
        # the turn ends the battle: the simulator stops before the end-of-turn effects, only the hit points are comparable
        shown = {"p1": {"hp": shown["p1"]["hp"]}, "p2": {"hp": shown["p2"]["hp"]}}
    ev.append(["state", "after", shown])
    return {"ev": ev, "out": {"turn": len(case["history"]) + 1}}


def main(argv: list[str]) -> int:
    if len(argv) != 3:
        print("usage: probe.py <inputs.jsonl> <trace.jsonl>", file=sys.stderr)
        return 2
    import poke_engine as pe
    from silvers_hoard.master_ai import build_state
    lines = []
    for raw in Path(argv[1]).read_text(encoding="utf-8").splitlines():
        if not raw.strip():
            continue
        rec = json.loads(raw)
        try:
            body = play(pe, build_state, rec["input"])
            lines.append(json.dumps({"id": rec["id"], **body}, separators=(",", ":"), sort_keys=True, ensure_ascii=False))
        except BaseException as exc:  # noqa: BLE001 - poke-engine panics (PanicException) on a move or state it cannot read
            if isinstance(exc, KeyboardInterrupt):
                raise
            lines.append(json.dumps({"id": rec["id"], "ev": [], "err": f"{type(exc).__name__}: {exc}"[:200]},
                                    separators=(",", ":"), sort_keys=True, ensure_ascii=False))
    Path(argv[2]).write_text("\n".join(lines) + "\n", encoding="utf-8", newline="\n")
    print(f"{len(lines)} cases -> {argv[2]}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
