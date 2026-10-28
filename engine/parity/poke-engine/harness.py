"""Harness of the differential kit (hoard_link.parity) for poke-engine against the simulator.

    python scripts/parity_poke_engine.py            # the usual way: runs this harness and writes the report
    python -m hoard_link.parity run engine/parity/poke-engine/harness.py --state-dir .parity

The oracle is the simulator (@pkmn/sim, through engine/src/master.mjs for the state); the probe is poke-engine (through
silvers_hoard/master_ai.py, the code the master AI itself uses). A divergence is a place where the master AI's engine believes something
different from what the simulator then does. Settings through the environment: PARITY_PE_BATTLES (random battles, 220), PARITY_PE_SEED (1),
PARITY_PE_TURNS (turns recorded per battle, 6), SILVER_MASTER_PY (the Python with poke-engine; the app's venv by default).
"""
from __future__ import annotations

import os
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]

SCOPE = (
    "Singles of the 9th generation, one turn at a time, from states of seeded random sets (up to 6 turns of each of PARITY_PE_BATTLES "
    "battles, switches and Terastallization included) and about 40 scripted edge battles (weather, statuses, priority, multi-hit, fixed "
    "critical hits, hazards, screens, terrain, items, abilities). Compared: who hit first, the damage of that hit, and after the turn "
    "the hit points, statuses, items, Terastallization, boosts, side conditions, volatile statuses, substitute, weather, terrain and Trick Room. "
    "Not covered: doubles and other generations; pivot moves (U-turn and the like stop the turn half way in the simulator) and anything "
    "that needs a choice in the middle of a turn; Mega Evolution; PP; the turn after a forced switch; the end-of-turn effects of a turn that ends the battle (only hit points are compared there); "
    "the unlikely branch of a chance (the simulator is played with the likeliest result of every chance, a duration at its longest, and "
    "poke-engine's likeliest branch is compared) except the critical hits the edge cases force; the simulator's damage roll is covered as "
    "an interval or as its mean; items poke-engine has no name for are treated as inert; abilities are not compared by name, "
    "only through what they do; the move choice of the AI itself (the search) is not compared, only the rules it searches over."
)


def _python() -> str:
    env = os.environ.get("SILVER_MASTER_PY")
    if env and Path(env).exists():
        return env
    for rel in ("venv/Scripts/python.exe", "venv/bin/python"):
        if (ROOT / rel).exists():
            return str(ROOT / rel)
    return sys.executable


def harness():
    from hoard_link.parity import Command, Harness, read_jsonl

    def corpus():
        out = Path(tempfile.mkdtemp(prefix="pe-corpus-")) / "corpus.jsonl"
        subprocess.run(["node", str(HERE / "corpus.mjs"), str(out), "--battles", os.environ.get("PARITY_PE_BATTLES", "220"),
                        "--seed", os.environ.get("PARITY_PE_SEED", "1"), "--turns", os.environ.get("PARITY_PE_TURNS", "6")],
                       cwd=ROOT, check=True, capture_output=True)
        return list(read_jsonl(out))

    py = _python()
    return Harness(
        name="poke-engine-vs-sim", root=ROOT, corpus=corpus,
        oracle=Command(["node", str(HERE / "oracle.mjs")], cwd=str(ROOT), timeout=3000),
        probe=Command([py, str(HERE / "probe.py")], cwd=str(ROOT), timeout=1200),
        scope=SCOPE, survey=True,
        description="poke-engine 0.0.48 (the master AI's engine) against @pkmn/sim: the same states, the same decisions, the first divergence",
        depends_on=["engine/parity/poke-engine/*.mjs", "engine/parity/poke-engine/*.py", "engine/src/master.mjs", "engine/src/core.mjs",
                    "silvers_hoard/master_ai.py", "node_modules/@pkmn/sim/package.json"],
        oracle_depends_on=["engine/parity/poke-engine/lib.mjs", "engine/parity/poke-engine/edges.mjs", "engine/parity/poke-engine/corpus.mjs",
                           "engine/parity/poke-engine/oracle.mjs", "engine/src/master.mjs", "engine/src/core.mjs",
                           "node_modules/@pkmn/sim/package.json"],
        lock="engine/parity/poke-engine/lock.json",
        lock_artifacts={"pkmn-sim": "node_modules/@pkmn/sim/package.json"},
        lock_tools={"node": ["node", "--version"],
                    "poke-engine": [py, "-c", "import importlib.metadata as m; print(m.version('poke-engine'))"]},
    )
