"""The differential test of poke-engine against the simulator (engine/parity/poke-engine, scripts/parity_poke_engine.py)."""
from __future__ import annotations

import importlib.util
import json
import shutil
import subprocess
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

ROOT = Path(__file__).resolve().parent.parent
HERE = ROOT / "engine" / "parity" / "poke-engine"
HOARD_LINK = ROOT.parent / "HoardLink"


def _load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


probe = _load("pe_probe", HERE / "probe.py")
script = _load("parity_poke_engine", ROOT / "scripts" / "parity_poke_engine.py")


def test_first_damage_reads_who_was_damaged_first():
    d = probe.first_damage(["Damage SideTwo: 40", "Heal SideOne: 3", "Damage SideOne: 12", "Damage SideTwo: 5"])
    assert d == {"p1_damaged": 12, "p2_damaged": 40, "first_hit": "Two"}


def test_direct_hits_tells_a_move_from_its_side_effects():
    # rolls of [p1's move, p2's move]; a Damage about the size of the move's own is the move, anything else (recoil, a trap) is not
    calc = ([80, 100], [30, 40])
    hp = {"One": 300, "Two": 300}
    hits = probe.direct_hits(["Damage SideTwo: 90", "Damage SideOne: 36", "Damage SideOne: 18"], calc, hp)
    assert hits == [("p1", 90), ("p2", 36)]
    # a hit much smaller than the lowest roll is hazard or residual damage, not the move
    assert probe.direct_hits(["Damage SideOne: 5", "Damage SideTwo: 90"], calc, hp) == [("p1", 90)]
    # unless the target had that little left
    assert probe.direct_hits(["Damage SideOne: 5"], calc, {"One": 5, "Two": 300}) == [("p2", 5)]
    # a move with no damage calculation (a status move) never counts
    assert probe.direct_hits(["Damage SideTwo: 30"], ([0, 0], [30, 40]), hp) == []


def test_merged_calc_reads_each_side_in_the_order_its_move_works():
    # Sucker Punch (side two) does nothing when it moves second: the engine's answer depends on the flag
    def calculate_damage(state, a, b, first_moves_first):
        return ([126, 189], [0, 0]) if first_moves_first else ([126, 189], [32, 48])
    pe = SimpleNamespace(calculate_damage=calculate_damage)
    assert probe.merged_calc(pe, None, "moonblast", "suckerpunch") == ([126, 189], [32, 48])


def _branch(percentage, *texts):
    return SimpleNamespace(percentage=percentage, instruction_list=list(texts))


def test_choose_takes_the_likeliest_branch_or_the_one_where_the_forced_critical_hit_lands():
    plain, crit = _branch(90.0, "Damage SideTwo: 50"), _branch(10.0, "Damage SideTwo: 75")
    assert probe.choose([plain, crit], "none") is plain
    assert probe.choose([plain, crit], "p1") is crit
    assert probe.choose([plain, crit], "p2") is plain


def test_kind_of_groups_a_divergence_without_the_side_or_the_pokemon():
    kind = script.kind_of
    assert kind(".ev[3][2].p2.hp.blissey", "after") == "hp"
    assert kind(".ev[1][2].p1.volatile[0]", "after") == "volatile"
    assert kind(".ev[0][2].p2.boosts.evasion", "after") == "boosts.evasion"
    assert kind(".ev[0][2].p1.side.toxic_count", "after") == "side.toxic_count"
    assert kind(".ev[0][2]", "order") == "order"
    assert kind(".err", None) == "probe_error"
    assert set(script.KIND_NOTES) >= {"order", "damage.first", "hp", "boosts", "side", "volatile", "probe_error"}


def test_the_harness_declares_its_scope_and_pins_its_versions():
    sys.path.insert(0, str(HOARD_LINK))
    if not (HOARD_LINK / "hoard_link" / "parity" / "__init__.py").exists():
        pytest.skip("Hoard Link with hoard_link.parity is not next to this repository")
    from hoard_link.parity import load_harness
    h = load_harness(HERE / "harness.py")
    assert h.name == "poke-engine-vs-sim" and h.survey
    assert "Not covered" in script.markdown({"scope": h.scope, "corpus": {}}, {"matching": 1, "cases": 1, "divergent": 0, "kinds": {},
                                                                              "families": {}, "probe_errors": {}, "examples": {}})
    assert "doubles" in h.scope and "pivot" in h.scope
    lock = json.loads((HERE / "lock.json").read_text(encoding="utf-8"))
    assert lock["tools"]["poke-engine"] and lock["artifacts"]["pkmn-sim"]["sha256"]


def _can_run() -> str:
    if not shutil.which("node") or not (ROOT / "node_modules" / "@pkmn" / "sim").exists():
        return "Node.js and npm install are needed for the simulator"
    try:
        import poke_engine  # noqa: F401
    except Exception:  # noqa: BLE001
        return "poke-engine is not installed"
    if not (HOARD_LINK / "hoard_link" / "parity" / "__init__.py").exists():
        return "Hoard Link with hoard_link.parity is not next to this repository"
    return ""


@pytest.mark.skipif(bool(_can_run()), reason=_can_run() or "ok")
def test_a_small_run_writes_a_report_and_finds_the_known_divergences(tmp_path):
    report = tmp_path / "REPORT.md"
    r = subprocess.run([sys.executable, str(ROOT / "scripts" / "parity_poke_engine.py"), "--battles", "6", "--force", "--fresh", "--json",
                        "--state-dir", str(tmp_path / "work"), "--report", str(report), "--hoard-link", str(HOARD_LINK)],
                       cwd=ROOT, capture_output=True, text=True, encoding="utf-8", timeout=900)
    assert r.returncode == 0, r.stderr[-800:] + r.stdout[-800:]
    out = json.loads(r.stdout)
    assert out["cases"] > 80 and out["matching"] > out["cases"] * 0.6
    assert set(out["families"]) >= {"edge", "random"}
    text = report.read_text(encoding="utf-8")
    assert "Divergences by kind" in text and "Not covered" in text


@pytest.mark.skipif(not (shutil.which("node") and (ROOT / "node_modules" / "@pkmn" / "sim").exists()), reason="Node.js and npm install are needed")
def test_engine_parity_status_tool_reads_the_last_report(call, monkeypatch, tmp_path):
    from silvers_hoard import agent_tools

    tool = agent_tools.TOOLS_BY_NAME["engine_parity_status"]
    assert tool.annotations.get("readOnlyHint") is True
    assert len(tool.description.splitlines()[0]) <= 110
    monkeypatch.setattr(agent_tools, "_PARITY_DIR", tmp_path)
    empty = call("engine_parity_status", {})
    assert empty["available"] is False and "scripts/parity_poke_engine.py" in empty["how_to_run"]
    (tmp_path / "REPORT.json").write_text(json.dumps({
        "status": "fail", "finished_at": "2026-10-28T20:00:00Z", "cases": 8, "matching": 6, "divergent": 2, "kinds": {"hp": 2},
        "families": {"edge": {"cases": 8, "matching": 6}}, "probe_errors": {}, "scope": "Singles of the 9th generation"}), encoding="utf-8")
    got = call("engine_parity_status", {})
    assert got["available"] is True and got["match_rate"] == 0.75 and got["divergences_by_kind"] == {"hp": 2}
    assert got["scope"].startswith("Singles") and "parity_poke_engine.py" in got["how_to_run"]
