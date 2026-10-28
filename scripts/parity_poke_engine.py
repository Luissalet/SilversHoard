"""Run the differential test of poke-engine (the master AI's engine) against the simulator and write the report.

    python scripts/parity_poke_engine.py                 # 220 random battles + the edge battles, report in engine/parity/poke-engine/REPORT.md (+ REPORT.json)
    python scripts/parity_poke_engine.py --battles 30    # a quick pass
    python scripts/parity_poke_engine.py --json          # the numbers as JSON on stdout
    python scripts/parity_poke_engine.py --force --fresh # run even if nothing changed, ignore the cached oracle

The differential kit lives in Hoard Link (package hoard_link.parity); this script runs it from that repository, found through
HOARD_LINK_REPO, --hoard-link or the folder next to this one, and never copies it here. The harness is
engine/parity/poke-engine/harness.py. The exit code is 0 when the run completed (divergences are the result, not a failure of the run),
1 with --strict when there are divergences, 2 when the run could not be made (a process failed, the version lock does not hold, empty traces).
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
HERE = ROOT / "engine" / "parity" / "poke-engine"
NAME = "poke-engine-vs-sim"


def find_hoard_link(explicit: str | None) -> Path:
    for cand in (explicit, os.environ.get("HOARD_LINK_REPO"), str(ROOT.parent / "HoardLink")):
        if cand and (Path(cand) / "hoard_link" / "parity" / "__init__.py").exists():
            return Path(cand)
    raise SystemExit("Hoard Link with hoard_link.parity not found: pass --hoard-link or set HOARD_LINK_REPO")


KIND_NOTES = {
    "order": "the side that hits first differs",
    "damage.first": "the damage of the first direct hit differs by more than rounding",
    "hp": "hit points after the turn fall outside what the simulator can produce (damage, recoil, drain, healing or residual damage)",
    "status": "a major status after the turn differs",
    "item": "a held item after the turn differs (consumed, removed or kept)",
    "tera": "the Terastallized Pokemon differ",
    "active": "the Pokemon in the field after the turn differ",
    "volatile": "the volatile statuses of the active Pokemon differ",
    "boosts": "the stat stages of the active Pokemon differ (a boost or a drop that one engine applies and the other does not)",
    "side": "a side condition differs (hazards, screens, the toxic counter, Sticky Web)",
    "sub": "the substitute's hit points differ",
    "weather": "the weather differs", "weather_turns": "the turns left of the weather differ",
    "terrain": "the terrain differs", "terrain_turns": "the turns left of the terrain differ",
    "trick_room": "Trick Room differs", "trick_room_turns": "the turns left of Trick Room differ",
    "probe_error": "poke-engine refuses or panics on the state or the decision",
}


def kind_of(path: str, event: str | None) -> str:
    """Group a divergence path: the side and the Pokemon's name are dropped (`.ev[3][2].p2.hp.blissey` -> `hp`)."""
    if path.startswith(".err"):
        return "probe_error"
    if event in ("order", "damage.first"):
        return event
    m = re.match(r"^\.ev\[\d+\]\[2\](.*)$", path)
    rest = m.group(1) if m else path
    rest = re.sub(r"^\.p[12]\.", "", rest)
    rest = re.sub(r"^(hp|status|item)\.[^.]+$", r"\1", rest)
    rest = re.sub(r"\[\d+\]", "", rest)
    return rest.lstrip(".") or path


def read_table(path: Path) -> dict:
    return {r["id"]: r for r in (json.loads(l) for l in path.read_text(encoding="utf-8").splitlines() if l.strip())}


def analyse(work: Path) -> dict:
    """Everything the report says, from the three files the kit leaves in its work folder."""
    from hoard_link.parity.compare import survey_traces
    inputs = read_table(work / "inputs.jsonl")
    probe = read_table(work / "probe.jsonl")
    sv = survey_traces(work / "oracle.jsonl", work / "probe.jsonl", keep=10 ** 9)
    kinds: Counter = Counter()
    examples: dict = {}
    per_family: dict = defaultdict(lambda: [0, 0])
    divergent = set()
    for d in sv.divergences:
        k = kind_of(d.path, d.event_name)
        kinds[k] += 1
        divergent.add(d.case_id)
        inp = (inputs.get(d.case_id) or {}).get("input", {})
        examples.setdefault(k, []).append({"case": d.case_id, "name": inp.get("name"), "a": inp.get("a"), "b": inp.get("b"), "crit": inp.get("crit"),
                                           "path": d.path, "expected": d.expected, "got": d.actual})
    for cid, rec in inputs.items():
        fam = rec["input"].get("family", "?")
        per_family[fam][0] += 1
        per_family[fam][1] += 0 if cid in divergent else 1
    errors = Counter(re.sub(r"\d+", "N", r["err"])[:110] for r in probe.values() if "err" in r)
    return {"cases": sv.cases, "matching": sv.matching, "divergent": sv.total_divergent, "kinds": dict(kinds.most_common()),
            "examples": examples, "families": {k: {"cases": v[0], "matching": v[1]} for k, v in per_family.items()}, "probe_errors": dict(errors.most_common(12))}


def show(v) -> str:
    return json.dumps(v, ensure_ascii=False)[:80]


def markdown(report: dict, stats: dict) -> str:
    c = report.get("corpus", {})
    pct = 100.0 * stats["matching"] / max(1, stats["cases"])
    out = [
        "# poke-engine against the simulator", "",
        "Generated by `python scripts/parity_poke_engine.py` (do not edit by hand; the curated reading is in README.md).", "",
        f"- Run: {report.get('finished_at', '')}, {report.get('duration_s', 0)} s; poke-engine and @pkmn/sim as pinned in `lock.json`.",
        f"- Corpus: {c.get('cases', stats['cases'])} turns (sha256 {str(c.get('sha256', ''))[:12]}), "
        + ", ".join(f"{v['cases']} {k}" for k, v in stats["families"].items()) + ".",
        f"- Result: **{stats['matching']} of {stats['cases']} turns match ({pct:.1f}%)**; {stats['divergent']} diverge.", "",
    ]
    for fam, v in stats["families"].items():
        out.append(f"  - {fam}: {v['matching']} of {v['cases']} match")
    div = report.get("divergence")
    if div:
        out += ["", "## First divergence", "", f"`{div['summary']}`", ""]
    out += ["", "## Divergences by kind", "", "| kind | turns | what it means | example (case: expected / got) |", "|---|---:|---|---|"]
    for k, n in stats["kinds"].items():
        ex = stats["examples"][k][0]
        out.append(f"| `{k}` | {n} | {KIND_NOTES.get(k.split('.')[0], KIND_NOTES.get(k, ''))} | "
                   f"{ex['case']} {ex['name'] or ''} ({ex['a']} vs {ex['b']}): {show(ex['expected'])} / {show(ex['got'])} |")
    if stats["probe_errors"]:
        out += ["", "## poke-engine errors", "", "| turns | message |", "|---:|---|"]
        out += [f"| {n} | {msg} |" for msg, n in stats["probe_errors"].items()]
    out += ["", "## Not covered", "", report.get("scope", ""), ""]
    return "\n".join(out)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--battles", type=int, default=220, help="random battles in the corpus (default 220)")
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("--turns", type=int, default=6, help="turns recorded per random battle")
    ap.add_argument("--state-dir", type=Path, default=HERE / ".work", help="where the kit keeps its work (default engine/parity/poke-engine/.work, not versioned)")
    ap.add_argument("--report", type=Path, default=HERE / "REPORT.md", help="where to write the Markdown report")
    ap.add_argument("--hoard-link", help="the Hoard Link repository (default HOARD_LINK_REPO or the folder next to this one)")
    ap.add_argument("--fresh", action="store_true", help="ignore the cached oracle")
    ap.add_argument("--force", action="store_true", help="run even if nothing it depends on changed")
    ap.add_argument("--json", action="store_true", help="print the numbers as JSON")
    ap.add_argument("--strict", action="store_true", help="exit 1 when there are divergences")
    ap.add_argument("--lock", action="store_true", help="pin the versions (node, poke-engine, @pkmn/sim) in lock.json and stop")
    a = ap.parse_args()
    os.environ["PARITY_PE_BATTLES"], os.environ["PARITY_PE_SEED"], os.environ["PARITY_PE_TURNS"] = str(a.battles), str(a.seed), str(a.turns)
    sys.path.insert(0, str(find_hoard_link(a.hoard_link)))
    from hoard_link.parity import load_harness, run_harness, write_lock
    h = load_harness(HERE / "harness.py")
    if a.lock:
        print(f"pinned in {write_lock(h)}")
        return 0
    report = run_harness(h, a.state_dir, fresh=a.fresh, force=a.force or a.battles != 220 or a.seed != 1 or a.turns != 6)
    status = report["status"]
    if status in ("error",):
        print(f"error: {report.get('error')}\n{report.get('log_tail', '')}", file=sys.stderr)
        return 2
    if status == "skipped":
        print(f"skipped: {report['reason']}. Use --force to run it again; the last report is {a.report}")
        return 0
    stats = analyse(a.state_dir / NAME)
    a.report.write_text(markdown(report, stats), encoding="utf-8", newline="\n")
    summary = {"status": status, "finished_at": report.get("finished_at"), "duration_s": report.get("duration_s"),
               "corpus": report.get("corpus"), "divergence": report.get("divergence"), "scope": report.get("scope"),
               **{k: stats[k] for k in ("cases", "matching", "divergent", "kinds", "families", "probe_errors")}}
    a.report.with_suffix(".json").write_text(json.dumps(summary, ensure_ascii=False, indent=1) + "\n", encoding="utf-8", newline="\n")
    if a.json:
        print(json.dumps({"status": status, "report": str(a.report), **{k: stats[k] for k in ("cases", "matching", "divergent", "kinds", "families", "probe_errors")}},
                         ensure_ascii=False, indent=1))
    else:
        print(f"{stats['matching']} of {stats['cases']} turns match; {stats['divergent']} diverge ({status}). Report: {a.report}")
        for k, n in list(stats["kinds"].items())[:10]:
            print(f"  {n:>5}  {k}")
    return 1 if (a.strict and stats["divergent"]) else 0


if __name__ == "__main__":
    sys.exit(main())
