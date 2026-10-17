"""Mass battles ("batalla campal"): dozens to hundreds of Pokémon on one field, every one driven by its own AI.

Three ways to fight: everybody against everybody (a battle royale where the last Pokémon standing wins), teams (two armies, or
the nine generations at once) and many against a few (one or more giants, much bigger and tougher, against a crowd). Who fights
comes from rosters: whole generations of the National Dex, the strongest of each generation, the starters, the legendaries, a
list of names, or the team of any of your trainers. Each Pokémon gets a set worked out from what it can learn
(engine/src/realtime/mass-roster.mjs) unless its trainer's team says otherwise.

The engine runs the whole battle (engine/src/realtime/mass.mjs: deterministic, a few seconds at most) and the app keeps it as a
small file in ``data/mass/<id>.json`` (the spec and the result); the screen replays it from the spec, unit by unit, and checks
that it ends the same way. Ready-made battles (``PRESETS``) follow the battle royale videos that inspired the mode.

A person can play one Pokémon of a battle (the screen records an input log; ``play`` replays it in the engine and keeps the result
with the battle), here or on a playable page sent to a friend (``export_page``; the page gives a ``SILVERMASS1-`` code that
``import_result`` replays the same way). Any battle or played battle records as a video clip (``video``, through the app's
recorder).
"""
from __future__ import annotations

import json
import logging
import re
import threading
import time
from typing import TYPE_CHECKING, Any, Optional

from . import sharing
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
VIDEO_RATES = {"slow": 1, "normal": 2, "fast": 4}   # how many times faster than the battle a clip plays

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
        spec = None
        if again:
            old = self._load(again)
            kw = {k: v for k, v in (old.get("args") or {}).items() if k != "seed"}
            title = title or old.get("title", "")
            if not kw:
                # a battle that came from a friend's page: the same Pokémon with their sets, another seed
                spec = {**old["spec"], "seed": new_id("m")[2:], "id": None}
                spec.pop("id")
        preset = kw.get("preset") or ""
        spec = spec or self.compose(**kw)
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

    def import_page(self, m: dict[str, Any]) -> dict[str, Any]:
        """A mass battle that came inside a friend's playable page: kept here as a battle of its own (run again in this engine, so its
        result and fingerprint are this app's)."""
        spec = m.get("spec") if isinstance(m, dict) else None
        if not isinstance(spec, dict) or not isinstance(spec.get("teams"), list) or not spec["teams"]:
            raise SilverError("invalid", "This page has no mass battle inside.")
        n = sum(len(t.get("units") or []) for t in spec["teams"] if isinstance(t, dict))
        if not 2 <= n <= MAX_UNITS:
            raise SilverError("invalid", f"A mass battle has from 2 to {MAX_UNITS} Pokémon.")
        res = self.s.engine.call("mass_run", {"spec": spec}, timeout=180.0)
        doc = {"id": new_id("mass"), "title": " ".join(str(m.get("title") or "Batalla campal").split())[:120], "preset": "", "args": {},
               "created_at": time.time(), "mode": res["summary"]["mode"], "floor": spec.get("floor", "grass"), "units": res["summary"]["units"],
               "spec": spec, "summary": res["summary"], "hash": res["hash"], "from": " ".join(str(m.get("from") or "").split())[:60]}
        with self._lock:
            self._save(doc)
        self.s.emit("mass.finished", {"id": doc["id"], "title": doc["title"], "mode": doc["mode"], "winner": res["summary"].get("winner_name", ""),
                                      "units": doc["units"]})
        return self.card(doc, full=True)

    # ------------------------------------------------------------ playing one of the Pokémon
    @staticmethod
    def _play_card(p: dict[str, Any]) -> dict[str, Any]:
        card = {k: v for k, v in p.items() if k != "inputs"}
        if p.get("challenger_default") is True:
            friend = p.get("source") == "friend"
            card["i18n"] = {"es": {"challenger": "Amigo" if friend else "Tú"},
                            "en": {"challenger": "Friend" if friend else "You"}}
        return card

    def play(self, id_: str, *, unit: int, inputs: Any, hash_: str = "", challenger: str = "", source: str = "app") -> dict[str, Any]:
        """A battle played by a person (``unit``: the Pokémon they played, by its place in the battle; ``inputs``: the screen's log).
        The engine replays it; when ``hash_`` is given the replay must end on it. The result is kept with the battle."""
        doc = self._load(id_)
        rows = sharing.check_mass_rows(inputs)
        n = sum(len(t["units"]) for t in doc["spec"]["teams"])
        if not isinstance(unit, int) or isinstance(unit, bool) or not 0 <= unit < n:
            raise SilverError("invalid", f"unit is the played Pokémon's place in the battle, from 0 to {n - 1}.")
        res = self.s.engine.call("mass_run", {"spec": {**doc["spec"], "player": {"unit": unit}}, "inputs": rows}, timeout=180.0)
        if hash_ and hash_ != res["hash"]:
            raise SilverError("conflict", "Replayed here, this played battle does not end the way it says: it was altered or made with another version.")
        sm = res["summary"]
        me = sm.get("player") or {}
        who = " ".join(str(challenger or "").split())[:60]
        if not who and source != "friend":
            who = self.s.settings.get("player_name") or ""
        default_name = not who
        who = who or ("Friend" if source == "friend" else "You")
        for old in doc.get("plays") or []:
            if old.get("hash") == res["hash"] and old.get("unit") == unit and old.get("challenger") == who:
                raise SilverError("conflict", "This played battle is already recorded.")
        play = {"id": new_id("play"), "challenger": who, "source": "friend" if source == "friend" else "app", "unit": unit,
                "name": me.get("name", ""), "species": me.get("species", ""), "team_name": me.get("team_name", ""), "place": me.get("place", 0),
                "of": sm["units"], "kos": me.get("kos", 0), "dealt": me.get("dealt", 0), "alive": bool(me.get("alive")),
                "team_won": bool(me.get("team_won")), "winner_name": sm.get("winner_name", ""), "reason": sm.get("reason", ""),
                "seconds": sm.get("seconds", 0), "hash": res["hash"], "created_at": time.time(), "inputs": sharing.encode_mass_inputs(rows)}
        if default_name:
            play["challenger_default"] = True
        with self._lock:
            doc = self._load(id_)
            doc.setdefault("plays", []).append(play)
            self._save(doc)
        self.s.emit("mass.played", {"id": id_, "title": doc["title"], "challenger": who, "pokemon": play["name"], "place": play["place"],
                                    "of": play["of"], "kos": play["kos"], "source": play["source"]})
        return {**self._play_card(play), "summary": sm}

    def plays(self, doc: dict[str, Any]) -> list[dict[str, Any]]:
        """The battle's played runs, best first: a better place, then more knockouts, then more damage."""
        return sorted((self._play_card(p) for p in doc.get("plays") or []), key=lambda p: (p["place"], -p["kos"], -p["dealt"], p["created_at"]))

    def play_get(self, id_: str, play_id: str) -> dict[str, Any]:
        """One played run with its input log (rows of [tick, mx, my, slot, ax, ay, roll]), to watch it again."""
        doc = self._load(id_)
        p = next((x for x in doc.get("plays") or [] if x.get("id") == play_id), None)
        if not p:
            raise SilverError("not_found", "That played battle does not exist.")
        return {**self._play_card(p), "inputs": sharing.decode_mass_inputs(p.get("inputs") or "")}

    def play_delete(self, id_: str, play_id: str) -> dict[str, Any]:
        with self._lock:
            doc = self._load(id_)
            left = [p for p in doc.get("plays") or [] if p.get("id") != play_id]
            if len(left) == len(doc.get("plays") or []):
                raise SilverError("not_found", "That played battle does not exist.")
            doc["plays"] = left
            self._save(doc)
        return {"deleted": play_id}

    # ------------------------------------------------------------ friends
    def export_page(self, id_: str) -> dict[str, Any]:
        """A playable page with this battle inside: a friend opens it in any browser, watches the battle or plays one of its Pokémon,
        and sends back the code the page gives (``SILVERMASS1-``)."""
        from .services import PLAY_TEMPLATE
        from . import names_i18n
        doc = self._load(id_)
        owner = self.s.settings["player_name"]
        data = {"kind": "mass", "from": owner, "sprite_server": self.s.settings["sprite_server"], "sprite_set": self.s.settings["sprite_set"],
                "mass": {"id": doc["id"], "title": doc["title"], "preset": doc.get("preset", ""), "mode": doc["mode"], "floor": doc.get("floor", "grass"), "units": doc.get("units", 0),
                         "spec": doc["spec"], "hash": doc.get("hash", ""), "from": owner, "plays": self.plays(doc)[:10]}}
        names_i18n.annotate(data, self.s)
        html = sharing.playable_page(PLAY_TEMPLATE, data)
        # a new file every time: an earlier page (already sent, maybe) is never overwritten by another battle with the same title
        filename = sharing.safe_filename(f"{doc['title'][:40]} - Silver {new_id('x')[-8:]}", "html")
        (self.s.config.exports_dir / filename).write_text(html, encoding="utf-8", newline="\n")
        return {"file": filename, "bytes": len(html.encode("utf-8")), "url": f"/api/exports/{filename}", "name": doc["title"],
                "battle_id": doc["id"], "hash": doc.get("hash", "")}

    def import_result(self, r: dict[str, Any]) -> dict[str, Any]:
        """A friend's ``SILVERMASS1-`` code: which battle, who played, which Pokémon, the input log and where it ended. Replayed here;
        only what the replay says is kept."""
        if not isinstance(r, dict) or r.get("kind") != "mass":
            raise SilverError("invalid", "This is not the code of a played mass battle.")
        mid = str(r.get("mass_id") or "")
        try:
            self._load(mid)
        except SilverError:
            raise SilverError("not_found", f"This code is for a mass battle you do not have here: {str(r.get('title') or mid)[:120]}") from None
        unit = r.get("unit")
        play = self.play(mid, unit=unit if type(unit) is int else -1, inputs=sharing.decode_mass_inputs(r.get("inputs") or ""),
                         hash_=str(r.get("hash") or ""), challenger=str(r.get("challenger") or ""), source="friend")
        return {"mass_id": mid, "play": play}

    # ------------------------------------------------------------ video
    def video(self, id_: str, *, play_id: str = "", speed: str = "normal", size: str = "720p", lang: str = "", lumiere: bool = False,
              aspect: str = "landscape") -> dict[str, Any]:
        """Record a battle (or one played run of it) as a video clip, a job: the app's own screen of the battle, alone on a 16:9
        stage with the camera following the action, played by the app's recorder (services.battle_video's). speed: slow (as it
        happened), normal (twice as fast) or fast (four times)."""
        doc = self._load(id_)
        seconds = float((doc.get("summary") or {}).get("seconds") or 0)
        who = ""
        if play_id:
            p = self.play_get(id_, play_id)
            seconds = float(p.get("seconds") or seconds)
            who = p["challenger"]
        if speed not in VIDEO_RATES:
            raise SilverError("invalid", f"speed is one of {', '.join(VIDEO_RATES)}")
        s = self.s
        if size not in s.VIDEO_SIZES:
            raise SilverError("invalid", f"size is one of {', '.join(s.VIDEO_SIZES)}")
        from .video_format import video_dimensions
        video_dimensions(size, aspect)
        status = s.video_status()
        if not status["playwright"] or not status["browser"]:
            raise SilverError("unavailable", "Recording needs Playwright and Chrome or Edge on this computer.", hint=status["hint"])
        lang = lang if lang in ("es", "en") else str(s.settings.get("language") or "en")[:2]
        rate = VIDEO_RATES[speed]
        path = f"video/{id_}?mspeed={rate}" + (f"&play={play_id}" if play_id else "")
        clean = lambda text, n: re.sub(r"[^\w\- ]+", "", text, flags=re.UNICODE).strip()[:n]  # noqa: E731
        stem = clean(doc["title"], 50) or "mass"
        if who:
            stem += " - " + clean(who, 20)
        stem = f"{stem} {(play_id or id_)[-6:]}"
        title = f"Vídeo: {doc['title']}" + (f" ({who})" if who else "")
        return s._job("video", title, {"mass_id": id_, "play_id": play_id, "speed": speed, "size": size, "aspect": aspect, "lumiere": lumiere},
                      lambda jid, progress, cancelled: s._record_video({"id": id_}, speed, size, lang, lumiere, status, progress, cancelled,
                                                                       url_path=path, stem=stem, seconds=seconds / rate,
                                                                       **({"aspect": aspect} if aspect != "landscape" else {})))

    def card(self, doc: dict[str, Any], *, full: bool = False) -> dict[str, Any]:
        s = doc.get("summary") or {}
        out = {"id": doc["id"], "title": doc["title"], "preset": doc.get("preset", ""), "created_at": doc["created_at"], "mode": doc["mode"],
               "floor": doc.get("floor", "grass"), "units": doc.get("units", 0), "winner_name": s.get("winner_name", ""), "reason": s.get("reason", ""),
               "seconds": s.get("seconds", 0), "teams": [{"name": t["name"], "color": t["color"], "size": t["size"], "alive": t["alive"]} for t in s.get("teams", [])][:16],
               "mvp": (s.get("mvp") or {}).get("name", ""), "played": len(doc.get("plays") or []), "from": doc.get("from", "")}
        if full:
            out.update({"spec": doc["spec"], "summary": s, "hash": doc.get("hash", ""), "plays": self.plays(doc)})
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
