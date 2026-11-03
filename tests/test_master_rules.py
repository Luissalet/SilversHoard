"""#1727: the rules where poke-engine (the master AI's search) differed from the simulator, corrected in Silver's build of poke-engine
(engine/poke-engine/patches, built by scripts/build_poke_engine.py). Two kinds of tests:

- concrete states played in poke-engine alone, with the result the simulator gives for the same state (fast, no Node.js);
- the scripted `rule-*` battles of engine/parity/poke-engine/edges.mjs played in BOTH engines (the parity kit's oracle and probe) with no
  divergence allowed.

They skip when poke-engine is missing; the first kind also skips on an unpatched build (it would fail by design)."""
from __future__ import annotations

import importlib.metadata
import importlib.util
import json
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
HOARD_LINK = ROOT.parent / "Hoard Hub"
KIT = ROOT / "engine" / "parity" / "poke-engine"
HAS_PE = importlib.util.find_spec("poke_engine") is not None


def _patched() -> bool:
    try:
        return "+silver" in importlib.metadata.version("poke-engine")
    except importlib.metadata.PackageNotFoundError:
        return False


needs_patched = pytest.mark.skipif(not (HAS_PE and _patched()),
                                   reason="needs Silver's build of poke-engine (python scripts/build_poke_engine.py)")


def mon(name, types=("normal", "typeless"), moves=("splash",), hp=300, maxhp=300, **kw):
    return {"id": name, "level": 100, "types": list(types), "base_types": list(types), "hp": hp, "maxhp": maxhp, "ability": "none",
            "base_ability": "none", "item": "none", "nature": "serious", "evs": [85] * 6, "attack": 250, "defense": 250, "special_attack": 250,
            "special_defense": 250, "speed": 200, "status": "none", "rest_turns": 0, "sleep_turns": 0, "weight_kg": 50.0, "terastallized": False,
            "tera_type": "normal", "mega_evolved": False, "moves": [{"id": m, "pp": 16, "disabled": False} for m in moves], **kw}


def ability(name):
    return {"ability": name, "base_ability": name}


def side(mons, **kw):
    return {"pokemon": mons, "active_index": "0", "side_conditions": {}, "volatile_statuses": [], "volatile_status_durations": {},
            "boosts": {}, "substitute_health": 0, "last_used_move": "move:none", "wish": [0, 0], "can_tera": False, **kw}


def play(one, two, a="splash", b="splash"):
    """The likeliest branch of the turn (a for side one, b for side two) in poke-engine, as the state after it."""
    import poke_engine as pe
    from silvers_hoard.master_ai import build_state
    state = build_state(pe, {"side_one": one, "side_two": two, "weather": "none", "terrain": "none"})
    branches = pe.generate_instructions(state, a, b)
    return state.apply_instructions(max(branches, key=lambda x: x.percentage))


def active(s):
    return s.pokemon[int(str(s.active_index))]


@needs_patched
def test_leftovers_heals_before_burn_damage():
    # simulator: a full Pokémon with Leftovers that is burned ends the turn at -1/16 (Leftovers at residual order 5, burn at 10)
    after = play(side([mon("snorlax", item="leftovers", status="burn")]), side([mon("blissey")]))
    assert active(after.side_one).hp == 300 - 300 // 16


@needs_patched
def test_toxic_damage_rounds_like_the_simulator_and_comes_after_leftovers():
    # simulator: floor(maxhp / 16) * stage = 16 * 3 for maxhp 271 at stage 3 (poke-engine used floor(271 * 3 / 16) = 50), Leftovers first
    after = play(side([mon("blissey", hp=200, maxhp=271, item="leftovers", status="toxic")], side_conditions={"toxic_count": 2}),
                 side([mon("toxapex")]))
    assert active(after.side_one).hp == 200 + 16 - 48
    assert int(after.side_one.side_conditions.toxic_count) == 3


@needs_patched
def test_black_sludge_hurts_a_holder_that_is_not_poison_by_an_eighth():
    after = play(side([mon("garchomp", types=("dragon", "ground"), item="blacksludge")]), side([mon("blissey")]))
    assert active(after.side_one).hp == 300 - 300 // 8
    healed = play(side([mon("toxapex", types=("poison", "water"), hp=200, item="blacksludge")]), side([mon("blissey")]))
    assert active(healed.side_one).hp == 200 + 300 // 16


@needs_patched
def test_heal_block_stops_leftovers():
    after = play(side([mon("blissey", hp=200, item="leftovers")], volatile_statuses=["healblock"]), side([mon("alakazam")]))
    assert active(after.side_one).hp == 200


@needs_patched
def test_defog_lowers_the_target_evasion():
    after = play(side([mon("corviknight", types=("flying", "steel"), moves=("defog",))]), side([mon("blissey")]), a="defog")
    assert int(after.side_two.evasion_boost) == -1
    behind_sub = play(side([mon("corviknight", types=("flying", "steel"), moves=("defog",))]),
                      side([mon("blissey")], volatile_statuses=["substitute"], substitute_health=75), a="defog")
    assert int(behind_sub.side_two.evasion_boost) == 0


@needs_patched
def test_rest_fails_at_full_hp_and_clears_the_toxic_counter():
    full = play(side([mon("snorlax", moves=("rest",))]), side([mon("blissey")]), a="rest")
    assert str(active(full.side_one).status).lower() == "none" and active(full.side_one).hp == 300
    hurt = play(side([mon("snorlax", hp=150, moves=("rest",), status="toxic")], side_conditions={"toxic_count": 3}),
                side([mon("blissey")]), a="rest")
    assert str(active(hurt.side_one).status).lower() == "sleep" and active(hurt.side_one).hp == 300
    assert int(hurt.side_one.side_conditions.toxic_count) == 0
    insomnia = play(side([mon("hypno", hp=150, moves=("rest",), **ability("insomnia"))]), side([mon("blissey")]), a="rest")
    assert str(active(insomnia.side_one).status).lower() == "none" and active(insomnia.side_one).hp == 150


@needs_patched
def test_a_knocked_out_holder_keeps_its_weakness_policy():
    after = play(side([mon("garchomp", types=("dragon", "ground"), moves=("earthquake",))]),
                 side([mon("heatran", types=("fire", "steel"), hp=1, item="weaknesspolicy"), mon("blissey")]), a="earthquake")
    assert active(after.side_two).hp == 0 and str(active(after.side_two).item).lower() == "weaknesspolicy"
    survived = play(side([mon("garchomp", types=("dragon", "ground"), moves=("earthquake",))]),
                    side([mon("heatran", types=("fire", "steel"), hp=300, maxhp=300, item="weaknesspolicy", defense=900)]), a="earthquake")
    assert active(survived.side_two).hp > 0 and str(active(survived.side_two).item).lower() == "none"
    assert int(survived.side_two.attack_boost) == 2


@needs_patched
def test_curse_of_a_ghost_and_of_anyone_else():
    plain = play(side([mon("snorlax", moves=("curse",))]), side([mon("blissey")]), a="curse")
    assert (int(plain.side_one.attack_boost), int(plain.side_one.defense_boost), int(plain.side_one.speed_boost)) == (1, 1, -1)
    assert "curse" not in {str(v).lower() for v in plain.side_one.volatile_statuses}
    ghost = play(side([mon("gengar", types=("ghost", "poison"), moves=("curse",))]), side([mon("slowbro", types=("water", "psychic"))]), a="curse")
    assert int(ghost.side_one.attack_boost) == 0 and active(ghost.side_one).hp == 300 - 150
    assert "curse" in {str(v).lower() for v in ghost.side_two.volatile_statuses}
    assert active(ghost.side_two).hp == 300 - 300 // 4       # the curse's first quarter at the end of the turn


@needs_patched
def test_shed_skin_plays_its_likeliest_outcome():
    # 1/3 chance in the simulator: the likeliest end of turn keeps the status (the engine's end of turn does not branch)
    after = play(side([mon("dragonite", types=("dragon", "flying"), status="poison", **ability("shedskin"))]), side([mon("blissey")]))
    assert str(active(after.side_one).status).lower() == "poison" and active(after.side_one).hp == 300 - 300 // 8


def _both_engines_reason() -> str:
    if not HAS_PE:
        return "poke-engine is not installed"
    if not _patched():
        return "needs Silver's build of poke-engine (python scripts/build_poke_engine.py)"
    if not shutil.which("node") or not (ROOT / "node_modules" / "@pkmn" / "sim").exists():
        return "Node.js and npm install are needed for the simulator"
    if not (HOARD_LINK / "hoard_link" / "parity" / "compare.py").exists():
        return "the parity kit (hoard_link.parity) is not next to this repository"
    return ""


@pytest.mark.skipif(bool(_both_engines_reason()), reason=_both_engines_reason() or "ok")
def test_rule_battles_match_in_both_engines(tmp_path):
    """Every scripted `rule-*` turn: the simulator (oracle.mjs) and poke-engine (probe.py) agree on who hit first, how hard, and the whole
    state after the turn (hit points, statuses, items, boosts, side conditions, volatiles)."""
    inputs, oracle, probe = tmp_path / "inputs.jsonl", tmp_path / "oracle.jsonl", tmp_path / "probe.jsonl"
    run = lambda *argv: subprocess.run(argv, cwd=ROOT, capture_output=True, text=True, encoding="utf-8", timeout=300)
    r = run("node", str(KIT / "corpus.mjs"), str(inputs), "--only", "rule-")
    assert r.returncode == 0, r.stderr[-800:]
    names = {json.loads(l)["input"]["name"].split(" turn ")[0] for l in inputs.read_text("utf-8").splitlines() if l.strip()}
    assert len(names) >= 10, names
    r = run("node", str(KIT / "oracle.mjs"), str(inputs), str(oracle))
    assert r.returncode == 0, r.stderr[-800:]
    r = run(sys.executable, str(KIT / "probe.py"), str(inputs), str(probe))
    assert r.returncode == 0, r.stderr[-800:]
    sys.path.insert(0, str(HOARD_LINK))
    from hoard_link.parity.compare import survey_traces
    sv = survey_traces(oracle, probe, keep=100)
    assert sv.cases >= 20
    assert sv.total_divergent == 0, [d.summary for d in sv.divergences]
