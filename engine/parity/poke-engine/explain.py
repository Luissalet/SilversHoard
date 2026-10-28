"""What poke-engine does in one case of the corpus: the likeliest branches of the turn with their instructions.

    python engine/parity/poke-engine/explain.py <inputs.jsonl> <case id> [<case id> ...]
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))


def main(argv: list[str]) -> int:
    if len(argv) < 3:
        print(__doc__)
        return 2
    import poke_engine as pe
    from silvers_hoard.master_ai import build_state
    rows = {r["id"]: r["input"] for r in (json.loads(l) for l in Path(argv[1]).read_text(encoding="utf-8").splitlines() if l.strip())}
    for cid in argv[2:]:
        case = rows[cid]
        state = build_state(pe, case["state"])
        a, b = (s.pokemon[int(str(s.active_index))] for s in (state.side_one, state.side_two))
        print(f"== {cid} {case['name']}: p1 {a.id} {tuple(a.types)} hp {a.hp} {a.ability} {a.item} {a.status} speed {a.speed} -> {case['a']}"
              f" | p2 {b.id} {tuple(b.types)} hp {b.hp} {b.ability} {b.item} {b.status} speed {b.speed} -> {case['b']}")
        try:
            branches = pe.generate_instructions(state, case["a"], case["b"])
        except BaseException as exc:  # noqa: BLE001 - poke-engine panics on what it cannot read
            print(f"   error: {type(exc).__name__}: {exc}")
            continue
        for br in sorted(branches, key=lambda x: -x.percentage)[:4]:
            print(f"   {br.percentage:6.2f}%  " + "; ".join(str(i) for i in br.instruction_list))
        side = [(m.id, m.hp) for m in state.side_one.pokemon if str(m.id).lower() != "none"]
        print(f"   p1 team {side}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
