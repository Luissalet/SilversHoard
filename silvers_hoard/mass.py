"""Mass battles ("batalla campal"): dozens to hundreds of Pokémon on one field, every one driven by its own AI.

Three ways to fight: everybody against everybody (a battle royale where the last Pokémon standing wins), teams (two armies, or
the nine generations at once) and many against a few (one or more giants, much bigger and tougher, against a crowd). Who fights
comes from rosters: whole generations of the National Dex, the strongest of each generation, the starters, the legendaries, a
list of names, or the team of any of your trainers. Each Pokémon gets a set worked out from what it can learn
(engine/src/realtime/mass-roster.mjs) unless its trainer's team says otherwise.

The engine runs the whole battle (engine/src/realtime/mass.mjs: deterministic, a few seconds at most) and the app keeps it as a
small file in ``data/mass/<id>.json`` (the spec and the result); the screen replays it from the spec, unit by unit, and checks
that it ends the same way. Ready-made battles (``PRESETS``) follow the battle royale videos that inspired the mode.
"""
from __future__ import annotations

import json
import logging
import re
import threading
import time
from typing import TYPE_CHECKING, Any, Optional

from .errors import SilverError
from .hoard_link.atomic import write_bytes_atomic
from .hoard_link.ids import new_id

if TYPE_CHECKING:  # pragma: no cover
    from .services import Services

log = logging.getLogger("silver.mass")

MODES = ("ffa", "teams", "boss")
KINDS = ("dex", "top", "starters", "legendaries", "random", "species", "trainer")
FLOORS = ("grass", "sand", "ice", "cave", "indoor", "water", "pyre", "summit", "meteor", "champion", "castle")
MAX_UNITS = 1100      # the whole National Dex (1025) fits
MAX_TEAMS = 16

# ready-made battles: (id, Spanish title, English title, the battle's arguments)
PRESETS: list[tuple[str, str, str, dict[str, Any]]] = [
    ("kanto", "La Pokédex de Kanto en battle royale", "Kanto's Pokédex in a battle royale",
     {"mode": "ffa", "floor": "grass", "teams": [{"kind": "dex", "gens": [1]}]}),
    ("national", "Las 1025 Pokémon de la Pokédex Nacional en battle royale", "All 1025 Pokémon of the National Dex in a battle royale",
     {"mode": "ffa", "floor": "grass", "teams": [{"kind": "dex", "gens": list(range(1, 10))}]}),
    ("starters", "Los 27 iniciales en battle royale", "The 27 starters in a battle royale",
     {"mode": "ffa", "floor": "sand", "teams": [{"kind": "starters"}]}),
    ("legends", "Todos los legendarios shiny en battle royale", "Every shiny legendary in a battle royale",
     {"mode": "ffa", "floor": "summit", "teams": [{"kind": "legendaries", "shiny_chance": 1}]}),
    ("gen9", "Paldea en battle royale", "Paldea in a battle royale",
     {"mode": "ffa", "floor": "sand", "teams": [{"kind": "dex", "gens": [9]}]}),
    ("top15", "El top 15 de cada generación, por equipos", "The top 15 of every generation, in teams",
     {"mode": "teams", "floor": "sand", "teams": [{"kind": "top", "gens": [g], "count": 15} for g in range(1, 10)]}),
    ("gen1vs3", "Generación 1 contra generación 3", "Generation 1 against generation 3",
     {"mode": "teams", "floor": "cave", "teams": [{"kind": "dex", "gens": [1]}, {"kind": "dex", "gens": [3]}]}),
    ("johto_hoenn", "Johto contra Hoenn contra Sinnoh", "Johto against Hoenn against Sinnoh",
     {"mode": "teams", "floor": "grass", "teams": [{"kind": "dex", "gens": [2]}, {"kind": "dex", "gens": [3]}, {"kind": "dex", "gens": [4]}]}),
    ("eternamax_kanto", "Eternatus Dinamax Infinito contra la Gen 1 entera", "Eternamax Eternatus against all of Gen 1",
     {"mode": "boss", "floor": "grass", "teams": [{"kind": "species", "species": ["Eternatus-Eternamax"]}, {"kind": "dex", "gens": [1]}]}),
    ("eternamax_trio", "Eternatus Dinamax Infinito contra Necrozma Ultra, Groudon y Kyogre",
     "Eternamax Eternatus against Ultra Necrozma, Groudon and Kyogre",
     {"mode": "boss", "floor": "pyre", "teams": [{"kind": "species", "species": ["Eternatus-Eternamax"]},
                                                 {"kind": "species", "species": ["Necrozma-Ultra", "Groudon", "Kyogre"], "name": "Ultra Necrozma, Groudon y Kyogre"}]}),
    ("mewtwo_starters", "Mewtwo contra los 27 iniciales", "Mewtwo against the 27 starters",
     {"mode": "boss", "floor": "castle", "teams": [{"kind": "species", "species": ["Mewtwo"]}, {"kind": "starters"}]}),
]


def _clean_list(value: Any, limit: int = MAX_UNITS) -> list[str]:
    out = []
    for x in (value or [])[:limit]:
        s = " ".join(str(x or "").split())[:40]
        if s:
            out.append(s)
    return out


class Mass:
    def __init__(self, services: "Services"):
        self.s = services
        self._lock = threading.Lock()

    # ------------------------------------------------------------ storage
    @property
    def dir(self):
        d = self.s.config.data_dir / "mass"
        d.mkdir(parents=True, exist_ok=True)
        return d

    def _path(self, id_: str):
        if not re.match(r"^mass_[0-9A-Za-z]{10,40}$", id_ or ""):
            raise SilverError("not_found", "That mass battle does not exist.")
        return self.dir / f"{id_}.json"

    def _save(self, doc: dict[str, Any]) -> None:
        # every battle stays until it is deleted (mass_delete): nothing goes away behind your back
        write_bytes_atomic(self._path(doc["id"]), json.dumps(doc, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))

    def _load(self, id_: str) -> dict[str, Any]:
        p = self._path(id_)
        try:
            return json.loads(p.read_text(encoding="utf-8"))
        except FileNotFoundError:
            raise SilverError("not_found", "That mass battle does not exist.") from None
        except ValueError:
            raise SilverError("invalid", "That mass battle's file is damaged.") from None

    # ------------------------------------------------------------ building a battle
    def presets(self) -> list[dict[str, Any]]:
        return [{"id": pid, "title": es, "title_en": en, "mode": args["mode"], "floor": args.get("floor", "grass"), "teams": args["teams"]}
                for pid, es, en, args in PRESETS]

    def _team(self, t: dict[str, Any], i: int) -> dict[str, Any]:
        """A team of the arguments as the engine's roster: a trainer's team becomes its sets, the rest pass through checked."""
        kind = str(t.get("kind") or "dex")
        if kind not in KINDS:
            raise SilverError("invalid", f"A team's kind is one of {', '.join(KINDS)}.")
        roster: dict[str, Any] = {"kind": kind}
        name = " ".join(str(t.get("name") or "").split())[:40]
        if kind == "trainer":
            tr = self.s.store.trainer(str(t.get("trainer_id") or ""))
            if not tr.get("team"):
                raise SilverError("empty_team", f"{tr['name']} has no team.")
            roster = {"kind": "sets", "sets": tr["team"]}
            name = name or tr["name"]
        if t.get("gens"):
            gens = sorted({int(g) for g in t["gens"] if str(g).isdigit() and 1 <= int(g) <= 9})
            if not gens:
                raise SilverError("invalid", "gens are generation numbers from 1 to 9.")
            roster["gens"] = gens
        if t.get("count"):
            roster["count"] = max(1, min(MAX_UNITS, int(t["count"])))
        if kind == "species":
            roster["list"] = _clean_list(t.get("species") or t.get("list"))
            if not roster["list"]:
                raise SilverError("invalid", "A team of chosen Pokémon needs their names (list).")
        if t.get("shiny_chance") is not None:
            roster["shiny_chance"] = max(0.0, min(1.0, float(t.get("shiny_chance") or 0)))
        if t.get("fully_evolved"):
            roster["fully_evolved"] = True
        if kind == "random":
            roster["seed"] = str(t.get("seed") or i)
        out: dict[str, Any] = {"roster": roster}
        if name:
            out["name"] = name
        if t.get("color") and re.match(r"^#[0-9a-fA-F]{6}$", str(t["color"])):
            out["color"] = str(t["color"])
        boss = t.get("boss")
        if isinstance(boss, dict) and any(boss.get(k) for k in ("hp", "size", "power")):
            out["boss"] = {"hp": max(0, min(200, float(boss.get("hp") or 0))), "size": max(0, min(5, float(boss.get("size") or 0))),
                           "power": max(0, min(5, float(boss.get("power") or 0)))}
        return out

    def compose(self, *, mode: str = "ffa", teams: Optional[list[dict[str, Any]]] = None, level: int = 50, floor: str = "grass",
                time_limit: int = 0, seed: str = "", preset: str = "", format_: str = "") -> dict[str, Any]:
        """The full spec of a battle (every Pokémon with its set), without running it."""
        if preset:
            p = next((x for x in PRESETS if x[0] == preset), None)
            if not p:
                raise SilverError("not_found", f"No ready-made battle called {preset}.")
            mode, floor = p[3]["mode"], p[3].get("floor", floor)
            teams = teams or p[3]["teams"]
        if mode not in MODES:
            raise SilverError("invalid", f"mode is one of {', '.join(MODES)}.")
        if floor not in FLOORS:
            raise SilverError("invalid", f"floor is one of {', '.join(FLOORS)}.")
        teams = list(teams or [])
        if not teams:
            raise SilverError("invalid", "A mass battle needs at least one team.")
        if len(teams) > MAX_TEAMS:
            raise SilverError("invalid", f"At most {MAX_TEAMS} teams.")
        if mode == "teams" and len(teams) < 2:
            raise SilverError("invalid", "Teams mode needs at least two teams.")
        if mode == "boss" and len(teams) < 2:
            raise SilverError("invalid", "Many against a few needs the giants (first team) and at least one team against them.")
        level = 0 if int(level or 0) == 0 else max(1, min(100, int(level)))
        limit = int(time_limit or 0) or (240 if mode == "boss" else 180)
        args = {"mode": mode, "teams": [self._team(t, i) for i, t in enumerate(teams)], "level": level, "floor": floor,
                "time_limit": max(30, min(1800, limit)), "seed": seed or new_id("m")[2:], "format": format_ or "gen9customgame"}
        spec = self.s.engine.call("mass_compose", args, timeout=60.0)
        n = sum(len(t["units"]) for t in spec["teams"])
        if n > MAX_UNITS:
            raise SilverError("invalid", f"At most {MAX_UNITS} Pokémon in a mass battle (this one has {n}).")
        return spec

    def start(self, *, title: str = "", again: str = "", **kw: Any) -> dict[str, Any]:
        """Build a battle, run it in the engine and keep it: {id, title, summary, ...}. `again`: the same battle as that one with
        another seed (the same Pokémon, a different fight)."""
        if again:
            old = self._load(again)
            kw = {k: v for k, v in (old.get("args") or {}).items() if k != "seed"}
            title = title or old.get("title", "")
            if not kw:
                raise SilverError("invalid", "That battle was made before battles could be repeated.")
        preset = kw.get("preset") or ""
        spec = self.compose(**kw)
        t0 = time.time()
        res = self.s.engine.call("mass_run", {"spec": spec}, timeout=180.0)
        if not title and preset:
            title = next((p[1] for p in PRESETS if p[0] == preset), "")
        if not title:
            names = [t["name"] for t in res["summary"]["teams"]][:4]
            title = {"ffa": "Battle royale", "teams": " contra ".join(names), "boss": f"{names[0]} contra {', '.join(names[1:])}" if names else "Jefe"}[spec["mode"]]
        doc = {"id": new_id("mass"), "title": " ".join(title.split())[:120], "preset": preset, "args": {k: v for k, v in kw.items() if k != "seed"}, "created_at": time.time(), "mode": spec["mode"],
               "floor": spec.get("floor", "grass"), "units": res["summary"]["units"], "spec": spec, "summary": res["summary"], "hash": res["hash"],
               "run_ms": int((time.time() - t0) * 1000)}
        with self._lock:
            self._save(doc)
        self.s.emit("mass.finished", {"id": doc["id"], "title": doc["title"], "mode": doc["mode"], "winner": res["summary"].get("winner_name", ""),
                                      "units": doc["units"]})
        return self.card(doc, full=True)

    def card(self, doc: dict[str, Any], *, full: bool = False) -> dict[str, Any]:
        s = doc.get("summary") or {}
        out = {"id": doc["id"], "title": doc["title"], "preset": doc.get("preset", ""), "created_at": doc["created_at"], "mode": doc["mode"],
               "floor": doc.get("floor", "grass"), "units": doc.get("units", 0), "winner_name": s.get("winner_name", ""), "reason": s.get("reason", ""),
               "seconds": s.get("seconds", 0), "teams": [{"name": t["name"], "color": t["color"], "size": t["size"], "alive": t["alive"]} for t in s.get("teams", [])][:16],
               "mvp": (s.get("mvp") or {}).get("name", "")}
        if full:
            out.update({"spec": doc["spec"], "summary": s, "hash": doc.get("hash", "")})
        return out

    def get(self, id_: str) -> dict[str, Any]:
        return self.card(self._load(id_), full=True)

    def list(self, limit: int = 50) -> list[dict[str, Any]]:
        files = sorted(self.dir.glob("mass_*.json"), key=lambda p: p.stat().st_mtime, reverse=True)[: max(1, min(200, limit))]
        out = []
        for f in files:
            try:
                out.append(self.card(json.loads(f.read_text(encoding="utf-8"))))
            except (OSError, ValueError, KeyError):
                continue
        return out

    def delete(self, id_: str) -> dict[str, Any]:
        p = self._path(id_)
        if not p.exists():
            raise SilverError("not_found", "That mass battle does not exist.")
        p.unlink()
        return {"deleted": id_}

    def check(self, id_: str, hash_: str) -> dict[str, Any]:
        """The screen's own run of a battle ended with this fingerprint: does it match the engine's?"""
        doc = self._load(id_)
        return {"same": bool(hash_) and hash_ == doc.get("hash"), "expected": doc.get("hash", "")}
