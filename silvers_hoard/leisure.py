"""Silver's contests and secret bases. Original rules and layouts, with persistent normal API/MCP workflows."""
from __future__ import annotations

import copy
import random
import time
from typing import TYPE_CHECKING, Any

from .errors import SilverError
from .hoard_link.ids import new_id
from .hoard_link.sqlkit import dumps, loads

if TYPE_CHECKING:
    from .services import Services

SCHEMA = """
CREATE TABLE silver_contests (id TEXT PRIMARY KEY, state_json TEXT NOT NULL, created_at REAL NOT NULL, updated_at REAL NOT NULL);
CREATE TABLE secret_bases (id TEXT PRIMARY KEY, state_json TEXT NOT NULL, created_at REAL NOT NULL, updated_at REAL NOT NULL);
"""
CATEGORIES = ("Cool", "Beautiful", "Cute", "Clever", "Tough")
RANKS = ("normal", "great", "ultra", "master")
ACCESSORIES = [
    {"id": "ribbon", "category": "Cute", "theme": "party"},
    {"id": "crown", "category": "Cool", "theme": "party"},
    {"id": "flower", "category": "Beautiful", "theme": "garden"},
    {"id": "leaf", "category": "Clever", "theme": "garden"},
    {"id": "shell", "category": "Beautiful", "theme": "sea"},
    {"id": "anchor", "category": "Tough", "theme": "sea"},
    {"id": "star", "category": "Cool", "theme": "night"},
    {"id": "moon", "category": "Clever", "theme": "night"},
    {"id": "heart", "category": "Cute", "theme": "party"},
    {"id": "stone", "category": "Tough", "theme": "garden"},
]
DECORATIONS = {"desk": True, "chair": True, "plant": True, "bed": True, "shelf": True,
               "cushion": False, "rug": False, "poster": False, "doll": True, "lamp": True}


class Leisure:
    def __init__(self, services: "Services"):
        self.svc = services

    def _get(self, table: str, id_: str) -> dict[str, Any]:
        row = self.svc.store.db.one(f"SELECT state_json FROM {table} WHERE id = ?", (id_,))
        if not row:
            raise SilverError("not_found", f"Not found: {id_}")
        return loads(row["state_json"])

    def _list(self, table: str) -> list[dict[str, Any]]:
        return [loads(r["state_json"]) for r in self.svc.store.db.query(f"SELECT state_json FROM {table} ORDER BY updated_at DESC")]

    def _save(self, table: str, state: dict[str, Any], *, create: bool = False) -> dict[str, Any]:
        now = time.time()
        if create:
            self.svc.store.db.insert(table, {"id": state["id"], "state_json": dumps(state), "created_at": now, "updated_at": now})
        else:
            self.svc.store.db.execute(f"UPDATE {table} SET state_json = ?, updated_at = ? WHERE id = ?", (dumps(state), now, state["id"]))
        return copy.deepcopy(state)

    def catalog(self) -> dict[str, Any]:
        return {"categories": CATEGORIES, "ranks": RANKS, "accessories": ACCESSORIES,
                "decorations": [{"id": k, "solid": v} for k, v in DECORATIONS.items()], "base_size": 8,
                "contest_rules": "silver-super-v1"}

    def contests(self) -> list[dict[str, Any]]:
        return self._list("silver_contests")

    def contest_get(self, id_: str) -> dict[str, Any]:
        return self._get("silver_contests", id_)

    def contest_start(self, trainer_id: str, pokemon: int = 0, category: str = "Cool", rank: str = "normal", seed: str = "", condition: int = 0) -> dict[str, Any]:
        trainer = self.svc.store.trainer(trainer_id)
        if category not in CATEGORIES or rank not in RANKS or not 0 <= pokemon < len(trainer["team"]):
            raise SilverError("invalid", "Choose a Pokémon, contest category and rank from leisure_catalog.")
        seed = seed or new_id("seed")
        rng = random.Random(seed)
        own = copy.deepcopy(trainer["team"][pokemon])
        # Move categories come from the installed game dex; battle power never becomes contest appeal.
        def moves(mon):
            out = []
            for name in mon.get("moves") or ["Tackle"]:
                found = self.svc.dex_search("moves", str(name), gen=9, limit=20)
                row = next((m for m in found if m["name"].lower().replace(" ", "") == str(name).lower().replace(" ", "")), None)
                out.append({"name": str(name), "category": (row or {}).get("contest_type") or "Cool"})
            return out[:4]
        entrants = [{"name": trainer["name"], "species": own["species"], "moves": moves(own), "scores": [0, 0, 0], "last_move": -1}]
        rivals = [("Luna", "Clefairy", ["Sing", "Moonlight", "Metronome", "Encore"]),
                  ("Teo", "Pikachu", ["Thunderbolt", "Quick Attack", "Agility", "Growl"]),
                  ("Iris", "Milotic", ["Surf", "Recover", "Attract", "Aqua Ring"])]
        for name, species, names in rivals:
            entrants.append({"name": name, "species": species, "moves": moves({"moves": names}),
                             "scores": [rng.randint(12, 22) + RANKS.index(rank) * 3, 0, 0], "last_move": -1})
        state = {"id": new_id("contest"), "trainer_id": trainer_id, "pokemon": pokemon, "category": category, "rank": rank,
                 "seed": seed, "condition": condition, "theme": rng.choice(["party", "garden", "sea", "night"]), "phase": "dress",
                 "round": 0, "revision": 0, "voltage": [0, 0, 0], "entrants": entrants, "accessories": [], "events": [],
                 "dance": [rng.randrange(4) for _ in range(8)], "status": "active", "rules": "silver-super-v1"}
        return self._save("silver_contests", state, create=True)

    def contest_choose(self, id_: str, revision: int, *, accessories: list[str] | None = None, steps: list[int] | None = None,
                       timing: list[int] | None = None, move: int = 0, judge: int = 0) -> dict[str, Any]:
        with self.svc._lock_for("contest:" + id_):
            state = self.contest_get(id_)
            if state["status"] != "active" or revision != state["revision"]:
                raise SilverError("stale", "This contest has moved on; reload contest_get before choosing.")
            entrants = state["entrants"]
            rng = random.Random(f"{state['seed']}:{state['revision']}")
            if state["phase"] == "dress":
                ids = accessories or []
                catalog = {a["id"]: a for a in ACCESSORIES}
                if len(ids) > 3 or len(set(ids)) != len(ids) or any(i not in catalog for i in ids):
                    raise SilverError("invalid", "Choose at most three different accessories from leisure_catalog.")
                state["accessories"] = ids
                points = 8 + state["condition"] // 32 + sum(3 * (catalog[i]["category"] == state["category"]) + 4 * (catalog[i]["theme"] == state["theme"]) for i in ids)
                entrants[0]["scores"][0] = points
                state["events"].append({"phase": "dress", "points": points})
                state["phase"] = "dance"
            elif state["phase"] == "dance":
                if steps is None or timing is None or len(steps) != 8 or len(timing) != 8 or any(x not in range(4) for x in steps) or any(type(t) is not int or not -2000 <= t <= 2000 for t in timing):
                    raise SilverError("invalid", "Dance needs eight directions (0-3) and eight timing offsets in milliseconds (-2000..2000).")
                hits = [max(0, 4 - abs(t) // 100) if step == expected else 0 for step, expected, t in zip(steps, state["dance"], timing)]
                entrants[0]["scores"][1] = sum(hits)
                for rival in entrants[1:]:
                    rival["scores"][1] = rng.randint(12, 22) + RANKS.index(state["rank"]) * 2
                state["events"].append({"phase": "dance", "points": sum(hits), "hits": hits})
                state["phase"] = "acting"
            else:
                if not 0 <= move < len(entrants[0]["moves"]) or not 0 <= judge < 3:
                    raise SilverError("invalid", "Choose one of your moves and a judge (0-2).")
                choices = [(move, judge)]
                for rival in entrants[1:]:
                    best = [i for i, m in enumerate(rival["moves"]) if m["category"] == state["category"] and i != rival["last_move"]]
                    choices.append((rng.choice(best or list(range(len(rival["moves"])))), rng.randrange(3)))
                # Shared judges: attracting an uncrowded judge rewards planning; repeated moves lose appeal.
                for i, (slot, target) in enumerate(choices):
                    entrant = entrants[i]
                    chosen = entrant["moves"][slot]
                    matching = chosen["category"] == state["category"]
                    repeated = slot == entrant["last_move"]
                    same_judge = sum(j == target for _, j in choices)
                    points = max(0, 3 + 2 * matching + (3 if same_judge == 1 else 1 if same_judge == 2 else 0) - 3 * repeated)
                    if matching:
                        state["voltage"][target] += 1
                        if state["voltage"][target] >= 5:
                            points += 5
                            state["voltage"][target] = 0
                    entrant["scores"][2] += points
                    entrant["last_move"] = slot
                    state["events"].append({"phase": "acting", "round": state["round"], "entrant": i, "move": chosen["name"], "judge": target, "points": points, "repeated": repeated})
                state["round"] += 1
                if state["round"] == 4:
                    state["status"] = "done"
                    state["phase"] = "result"
                    totals = [sum(e["scores"]) for e in entrants]
                    state["place"] = 1 + sum(total > totals[0] for total in totals[1:])
                    state["ribbon"] = state["place"] == 1
            state["revision"] += 1
            return self._save("silver_contests", state)

    def bases(self, archived: bool = False) -> list[dict[str, Any]]:
        return [b for b in self._list("secret_bases") if bool(b.get("archived")) == archived]

    def base_get(self, id_: str) -> dict[str, Any]:
        return self._get("secret_bases", id_)

    def base_save(self, id_: str = "", *, name: str, trainer_id: str = "", style: str = "tree", decorations: list[dict[str, Any]] | None = None,
                  message: str = "", archived: bool = False) -> dict[str, Any]:
        if not name.strip() or style not in ("tree", "cave", "shrub"):
            raise SilverError("invalid", "A secret base needs a name and style tree, cave or shrub.")
        old = self.base_get(id_) if id_ else None
        host = self.svc.store.trainer(trainer_id) if trainer_id else None
        placements = decorations or []
        if not isinstance(placements, list) or len(placements) > 16:
            raise SilverError("invalid", "Place at most sixteen decorations.")
        seen = set()
        clean = []
        for item in placements:
            if not isinstance(item, dict):
                raise SilverError("invalid", "Each decoration is an object with kind, x and y.")
            kind, x, y = item.get("kind"), item.get("x"), item.get("y")
            if kind not in DECORATIONS or type(x) is not int or type(y) is not int or not 0 <= x < 8 or not 0 <= y < 8 or (x, y) in seen or (x, y) in ((3, 7), (3, 1)):
                raise SilverError("invalid", "Place known decorations on different cells of the 8×8 room, leaving the entrance and host free.")
            seen.add((x, y))
            species = str(item.get("species") or "Pikachu")[:60] if kind == "doll" else ""
            if species:
                self.svc.engine.call("species", {"name": species, "gen": 9})
            clean.append({"kind": kind, "x": x, "y": y, **({"species": species} if species else {})})
        blocked = {(p["x"], p["y"]) for p in clean if DECORATIONS[p["kind"]]}
        reachable, todo = {(3, 7)}, [(3, 7)]
        while todo:
            x, y = todo.pop()
            for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
                if 0 <= nx < 8 and 0 <= ny < 8 and (nx, ny) not in blocked | reachable:
                    reachable.add((nx, ny)); todo.append((nx, ny))
        if (3, 1) not in reachable:
            raise SilverError("invalid", "Leave a walkable path between the entrance and the host.")
        base = {"id": id_ or new_id("base"), "name": name.strip()[:60], "trainer_id": trainer_id, "style": style, "decorations": clean,
                "message": message[:500], "archived": archived, "owner_name": host["name"] if host else (old or {}).get("owner_name", ""),
                "team": copy.deepcopy(host["team"]) if host else (old or {}).get("team", []), "format": host["format"] if host else (old or {}).get("format", "gen9customgame")}
        return self._save("secret_bases", base, create=not id_)

    def base_export(self, id_: str) -> dict[str, Any]:
        base = self.base_get(id_)
        return {"schema": "silver-secret-base-1", "base": {k: v for k, v in base.items() if k not in ("id", "trainer_id", "archived")}}

    def base_import(self, payload: dict[str, Any]) -> dict[str, Any]:
        if payload.get("schema") != "silver-secret-base-1" or not isinstance(payload.get("base"), dict):
            raise SilverError("invalid", "Expected a Silver secret-base export.")
        b = payload["base"]
        team = self.svc._team_from(b.get("team") or [], "")
        fmt = str(b.get("format") or "gen9customgame")
        self.svc.format_info(fmt)
        if team:
            self.svc.check_team(team, fmt)
        base = self.base_save(name=str(b.get("name") or ""), style=b.get("style", "tree"), decorations=b.get("decorations"), message=str(b.get("message") or ""))
        base.update(team=team, format=fmt, owner_name=str(b.get("owner_name") or "")[:60])
        return self._save("secret_bases", base)

    def base_battle(self, id_: str, trainer_id: str, mode: str = "classic") -> dict[str, Any]:
        base = self.base_get(id_)
        rival = {"trainer_id": base["trainer_id"]} if base.get("trainer_id") else {"team": base["team"], "name": base["owner_name"] or base["name"]}
        return self.svc.battle_start(p1={"trainer_id": trainer_id, "human": True}, p2=rival, format_=base["format"], mode=mode)
