"""Everything the app does, wired once: settings, the database, the battle engine, background work, sprites and sharing.

The UI, the REST agent route and the MCP bridge all call these methods through ``agent_tools.py``."""

from __future__ import annotations

import base64
import contextlib
import os
import gzip
import hashlib
import io
import json
import logging
import re
import threading
import time
import datetime as _dt
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any, Callable, Optional

from . import APP_ID, __version__
from . import facilities, frontier, frontier_runs, game_leagues, hgss_rom, progress, sharing, unbound_save
from .config import AI_LEVELS, AI_STYLES, REPO_ROOT, Config, Settings, find_node
from .engine import master_status
from .engine import Engine
from .errors import SilverError
from .hoard_link import family
from .hoard_link.atomic import read_json, write_bytes_atomic, write_json_atomic
from .hoard_link.tokens import read_or_create_token
from .credits import Credits
from .arenas import CUSTOM as ARENA_CUSTOM, Arenas, same as arenas_same
from .benchmarks import Benchmarks
from .cups import Cups
from . import gymmap
from .fxcache import FxCache
from .rebornfx import RebornCache
from .neural import NeuralAI
from .pmd import PmdSprites
from .overworld import OverworldSprites
from .official_art import OfficialArt
from .pvp import Pvp
from .mass import Mass
from .friends import Friends
from .smogon import Smogon
from .sounds import Sounds
from .sprites import Sprites, _http_get
from .store import Store
from .training import Training

log = logging.getLogger("silver")

PRESETS_DIR = Path(__file__).resolve().parent / "presets"
# the drawn badge shapes the screens know (client/src/components/badges.js)
BADGE_SHAPES = ("hexagon", "boulder", "drop", "bolt", "leaf", "flame", "heart", "star", "flake", "wing", "gear", "fist", "eye", "moon", "scale", "shell",
                "rainbow", "crown")
_CLASS_ES = {
    "Champion": "Campeón", "Top Champion": "Campeón Supremo", "BB League Champion": "Campeón de la Liga Arándano", "Elite Four": "Alto Mando",
    "Leader": "Líder de gimnasio", "Leaders": "Líderes de gimnasio", "Gym Leader": "Líder de gimnasio", "PKMN Trainer": "Entrenador Pokémon",
    "Pokémon Trainer": "Entrenador Pokémon", "Pokemon Trainer": "Entrenador Pokémon", "Rival": "Rival", "Boss": "Jefe", "Team Rocket Boss": "Jefe del Team Rocket",
    "Rocket Boss": "Jefe del Team Rocket", "Team Rainbow Rocket": "Team Rainbow Rocket", "Captain": "Capitán de prueba", "Island Kahuna": "Kahuna",
    "Pokémon Professor": "Profesor Pokémon", "Marquis": "Marqués", "Marchioness": "Marquesa", "Duke": "Duque", "Duchess": "Duquesa",
    "Grand Duchess": "Gran Duquesa", "Team Plasma": "Equipo Plasma", "Successor": "Sucesor", "Team Skull": "Team Skull", "Team Skull Boss": "Jefe del Team Skull",
    "Magma Leader": "Líder del Equipo Magma", "Aqua Leader": "Líder del Equipo Aqua", "Galactic Boss": "Jefe del Equipo Galaxia",
    "Team Galactic Boss": "Jefe del Equipo Galaxia", "Team Galactic": "Equipo Galaxia", "Team Flare": "Team Flare", "Team Flare Boss": "Jefe del Team Flare",
    "Team Magma": "Equipo Magma", "Team Aqua": "Equipo Aqua", "Passerby": "Transeúnte", "Masked Man": "Hombre enmascarado", "World Police": "Policía Internacional",
    "Aether President": "Presidenta de la Fundación Æther", "Pro Wrestler": "Luchador profesional", "Strange Lady": "Señora extraña", "Sootopolitan": "Arrecípolis",
    "Battleship": "Acorazado", "Frontier Brain": "As del Frente Batalla", "Developer": "Desarrollador",
}
STATIC_DIR = Path(__file__).resolve().parent / "static"
PLAY_TEMPLATE = STATIC_DIR / "play" / "play.html"
# lines a trainer says: at the start, its last Pokémon (and once that one is down to half its HP: last_low), winning, losing, after the
# battle (the result screen), and during the battle when it knocks out, loses a Pokémon, lands a super-effective hit or switches
# (shown in the app and on the playable page)
LINE_KEYS = ("intro", "win", "lose", "last", "last_low", "after", "on_ko", "on_faint", "on_super", "on_switch")
DIALOGUE_KEYS = (*LINE_KEYS, "phase", "phase_when", "phase_level", "phase_style")
PHASE_WHEN = ("half", "last")
# Real-time battles: the rules version stored with every new battle (1 = the first rules, which battles stored without one keep:
# always locked on, no Mega Evolution; 2 = free aim, the Mega Power gauge, Plus moves and Mega Evolution; 3 = doubles formats
# field two Pokémon per trainer, singles play as in 2; 4 = no Plus moves, the gauge only for Mega Evolution; 5 = the ultimate
# gauge) and the arenas.
RT_RULES_VERSION = 11
RT_ARENAS = ("open", "rocks")


def _rt_arena(value: str) -> str:
    arena = (value or "rocks").strip()
    if arena.lower() in RT_ARENAS:
        return arena.lower()
    if ARENA_CUSTOM.match(arena):
        return arena
    raise SilverError("invalid", "rt_arena is open (no obstacles), rocks (3-6 rocks placed from the seed) or custom:<arena id> (arenas_list)")
TYPE_COLORS = {"Normal": "#a8a77a", "Fire": "#ee8130", "Water": "#6390f0", "Electric": "#f7d02c", "Grass": "#7ac74c", "Ice": "#96d9d6",
               "Fighting": "#c22e28", "Poison": "#a33ea1", "Ground": "#e2bf65", "Flying": "#a98ff3", "Psychic": "#f95587", "Bug": "#a6b91a",
               "Rock": "#b6a136", "Ghost": "#735797", "Dragon": "#6f35fc", "Dark": "#705746", "Steel": "#b7b7ce", "Fairy": "#d685ad"}


def _now() -> float:
    return time.time()


WEEK_RE = re.compile(r"^\d{4}-W\d{2}$")   # an ISO week: the week's challenge and its leaderboard


class Services:
    def __init__(self, config: Config, *, engine: Optional[Engine] = None, http_get: Any = None):
        self.config = config
        config.paths.ensure()
        for folder in (config.avatars_dir, config.sprites_dir, config.exports_dir):
            folder.mkdir(parents=True, exist_ok=True)
        self._banter_guard = threading.Lock()
        self._banter_busy: set[str] = set()
        self._banter_queue: dict[str, list[dict[str, Any]]] = {}
        self.token = read_or_create_token(config.token_path)
        self.settings = Settings(config.settings_path)
        self.store = Store(config.db_path)
        self.engine = engine or Engine(lambda: find_node(self.settings.get("node_path", "")), config.engine_dir, REPO_ROOT)
        self.sprites = Sprites(config.sprites_dir, config.avatars_dir, self.settings, http_get=http_get)
        self.sounds = Sounds(config.sprites_dir.parent / "audio", self.settings, http_get=http_get)
        self.pmd = PmdSprites(config.sprites_dir.parent / "pmd", self.settings, http_get or _http_get)
        self.overworld = OverworldSprites(config.data_dir / "overworld")
        self.smogon = Smogon(config.sprites_dir.parent / "smogon", http_get or _http_get, enabled=lambda: bool(self.settings["smogon_data"]))
        self._http_get = http_get or _http_get
        self.credits = Credits(config.sprites_dir.parent / "credits", self.settings, http_get or _http_get, self.pmd._base)
        self.art = OfficialArt(config.sprites_dir.parent / "art")
        self.fx = FxCache(config.sprites_dir.parent / "fx", self.settings, http_get=http_get)
        self.reborn = RebornCache(config.sprites_dir.parent / "reborn", self.settings, http_get=http_get)
        self.cups = Cups(self)
        self.arenas = Arenas(self)
        from .leisure import Leisure
        self.leisure = Leisure(self)
        self.benchmarks = Benchmarks(self)
        self.training = Training(self)
        self.pvp = Pvp(self)
        self.mass = Mass(self)
        self.friends = Friends(self)
        self.neural = NeuralAI(self.settings, config.sprites_dir.parent / "neural", config.data_dir / "logs")
        self._neural_env()
        self.pool = ThreadPoolExecutor(max_workers=2, thread_name_prefix="silver-job")
        self._cancel: dict[str, bool] = {}
        self._battle_locks: dict[str, threading.Lock] = {}
        self._locks_guard = threading.Lock()
        self.events: list[dict[str, Any]] = []
        self._canon: Optional[dict[str, Any]] = None
        self._characters: Optional[dict[str, Any]] = None

    # ------------------------------------------------------------ lifecycle
    def start(self) -> None:
        # work that was running when the app stopped will not finish: say so instead of leaving it "running" forever
        orphans = []
        for job in self.store.jobs(status="running") + self.store.jobs(status="queued"):
            self.store.update_job(job["id"], {"status": "failed", "error": "The app stopped while this was running."})
            if (job.get("args") or {}).get("prospero_job"):
                orphans.append(job["args"]["prospero_job"])
        if orphans:   # a sprite render Prospero is still doing for nobody: stop it, the GPU is better free
            threading.Thread(target=self._cancel_prospero_jobs, args=(orphans,), name="silver-orphans", daemon=True).start()
        for b in self.store.battles(status="running", limit=500):
            self.store.update_battle(b["id"], {"status": "failed"})
        self.cups.recover()   # matches the AI was playing when the app stopped are ready again
        if self.config.background:
            threading.Thread(target=self._warm, name="silver-warm", daemon=True).start()

    def _cancel_prospero_jobs(self, ids: list[str]) -> None:
        for pid in ids:
            try:
                self._prospero_call("studio_cancel_job", {"job_id": pid}, write=True)
                log.info("cancelled the orphaned Prospero render %s", pid)
            except SilverError as exc:
                log.info("could not cancel the Prospero render %s: %s", pid, exc.message)

    def _warm(self) -> None:
        try:
            self.engine.ensure()
        except SilverError as exc:
            log.warning("engine not started: %s", exc.message)

    def stop(self) -> None:
        for k in list(self._cancel):
            self._cancel[k] = True
        self.cups.stopped = True
        self.pool.shutdown(wait=False, cancel_futures=True)
        self.engine.stop()
        self.neural.stop()   # only the server this app started; it frees the GPU
        self.pvp.stop()
        self.store.close()

    def emit(self, kind: str, data: dict[str, Any]) -> None:
        self.events.append({"t": _now(), "type": kind, **data})
        del self.events[:-200]
        try:
            family.emit(f"silver.{kind}", data)
        except Exception:  # noqa: BLE001 - the family bus is optional
            pass

    def health(self) -> dict[str, Any]:
        return {"engine": self.engine.status(), "counts": self.store.counts(), "master_ai": master_status()}

    AI_LEVEL_TEXT = {
        "random": "Picks any legal move.",
        "easy": "Attacks with what it has, often without thinking, and never switches by choice.",
        "normal": "Measures damage with the game's formula, sometimes errs, switches when things look bad.",
        "hard": "Always the best calculated option: damage, status, boosts, hazards, switches and gimmicks.",
        "expert": "Also plays each candidate turn out against the opponent's likely answers (singles and doubles).",
        "master": "Searches thousands of possible futures each turn (Monte Carlo tree search with poke-engine), about a second a turn; "
                  "9th-generation singles. Elsewhere, or without poke-engine, it plays as the expert.",
        "neural": "A reinforcement-learning policy trained on millions of real battles (metamon), run on the GPU; it only sees what "
                  "its side sees. Singles of generations 1-4 and 9; elsewhere, or while its server is not running, it plays as the expert.",
    }

    def ai_levels(self, refresh: bool = False) -> dict[str, Any]:
        """The AI levels, what each does and whether the master's search can run on this computer."""
        return {"levels": [{"level": lv, "about": self.AI_LEVEL_TEXT[lv]} for lv in AI_LEVELS], "styles": list(AI_STYLES),
                "master": master_status(refresh), "neural": self.neural.status()}

    # ------------------------------------------------------------ the neural AI's server
    def _neural_env(self) -> None:
        """The engine finds the neural AI's server through SILVER_NEURAL_URL (it copies this process's environment when it starts)."""
        env = self.neural.engine_env()
        if env:
            os.environ.update(env)
        else:
            os.environ.pop("SILVER_NEURAL_URL", None)

    def neural_ai(self, action: str = "status", wait: float = 0.0) -> dict[str, Any]:
        if action == "start":
            return self.neural.start(wait=wait)
        if action == "stop":
            return self.neural.stop()
        return self.neural.status()

    # ------------------------------------------------------------ overview
    def overview(self) -> dict[str, Any]:
        live = self.store.battles(status="live", limit=20)
        running = self.store.jobs(status="running") + self.store.jobs(status="queued")
        return {
            "counts": self.store.counts(), "engine": self.engine.status(), "settings": self.settings.snapshot(),
            "live_battles": [self.battle_card(b) for b in live], "jobs": running,
            "recent": [self.battle_card(b) for b in self.store.battles(status="ended", limit=8)],
            "active_runs": [self.run_view(r, light=True) for r in self.store.runs(status="active", limit=10)],
            "version": __version__, "type_colors": TYPE_COLORS,
        }

    # ------------------------------------------------------------ formats, teams, dex
    def formats(self, gen: int = 0, query: str = "") -> dict[str, Any]:
        return self.engine.call("formats", {"gen": gen, "query": query})

    def format_info(self, format_: str, rules: Optional[list[str]] = None) -> dict[str, Any]:
        return self.engine.call("format_info", {"format": format_, "rules": rules or []})

    def import_team(self, text: Any) -> dict[str, Any]:
        return self.engine.call("import_team", {"text": text} if isinstance(text, str) else {"sets": text})

    def export_team(self, sets: list[dict[str, Any]]) -> str:
        return self.engine.call("export_team", {"sets": sets})["paste"]

    def validate_team(self, format_: str, sets: Any, rules: Optional[list[str]] = None, level_rules: Optional[dict[str, Any]] = None) -> dict[str, Any]:
        return self.engine.call("validate", {"format": format_, "sets": sets, "rules": rules or [], "level_rules": level_rules or {}})

    def random_team(self, format_: str = "gen9randombattle", seed: Optional[str] = None) -> dict[str, Any]:
        return self.engine.call("random_team", {"format": format_, "seed": seed})

    def team_summary(self, sets: list[dict[str, Any]], format_: str) -> list[dict[str, Any]]:
        return self.engine.call("summary", {"sets": sets, "format": format_})["pokemon"]

    def stat_points(self, *, trainer_id: str = "", team: Any = None, paste: str = "", format_: str = "",
                    points: Optional[dict[str, dict[str, int]]] = None, save: bool = False) -> dict[str, Any]:
        """Stat points as in Pokémon Champions (66 per Pokémon, 32 per stat, read from and written as EVs) and the stats they give."""
        t = self.store.trainer(trainer_id) if trainer_id else None
        sets = t["team"] if t else self._team_from(team, paste)
        if not sets:
            raise SilverError("invalid", "Give trainer_id, team or paste.")
        fmt = format_ or (t["format"] if t else self.settings["default_format"])
        res = self.engine.call("stat_points", {"sets": sets, "points": points or {}, "format": fmt})
        if t and points and save:
            self.store.update_trainer(t["id"], {"team": res["sets"]})
            self.emit("trainer.updated", {"id": t["id"]})
        return {"trainer_id": trainer_id, "saved": bool(t and points and save), "format": fmt, "pokemon": res["pokemon"],
                "sets": res["sets"], "limits": {"total": 66, "per_stat": 32}}

    def dex_search(self, kind: str, query: str = "", gen: int = 9, limit: int = 30, species: str = "",
                   format: str = "") -> list[dict[str, Any]]:
        return self.engine.call("dex_search", {"kind": kind, "query": query, "gen": gen, "limit": limit, "species": species,
                                               "format": format})["results"]

    def species(self, name: str, gen: int = 9, format: str = "") -> dict[str, Any]:
        return self.engine.call("species", {"name": name, "gen": gen, "format": format})

    # ------------------------------------------------------------ trainers
    def _clean_ai(self, level: Optional[str], style: Optional[str]) -> tuple[str, str]:
        level = level or self.settings["default_ai_level"]
        style = style or self.settings["default_ai_style"]
        if level not in AI_LEVELS:
            raise SilverError("invalid", f"AI level must be one of {', '.join(AI_LEVELS)}")
        if style not in AI_STYLES:
            raise SilverError("invalid", f"AI style must be one of {', '.join(AI_STYLES)}")
        return level, style

    def _team_from(self, team: Any, paste: str = "") -> list[dict[str, Any]]:
        if paste:
            return self.import_team(paste)["sets"]
        if isinstance(team, str):
            return self.import_team(team)["sets"]
        if isinstance(team, list) and team:
            return self.import_team(team)["sets"]
        return []

    def check_team(self, sets: list[dict[str, Any]], format_: str) -> None:
        """Every Pokémon and move must exist in the format's generation (anything else breaks the battle later)."""
        summary = self.team_summary(sets, format_)
        bad = [m["species"] for m in summary if not m["exists"]]
        if bad:
            raise SilverError("unknown_species", f"Unknown Pokémon: {', '.join(bad)}", hint="Check the spelling as Showdown writes it (e.g. Rotom-Wash).")
        moves = [f"{m['species']}: {mv['name']}" for m in summary for mv in m["moves"] if not mv["exists"]]
        if moves:
            raise SilverError("invalid_team", f"Unknown moves: {', '.join(moves[:6])}")

    def trainer_view(self, t: dict[str, Any], *, summary: bool = False) -> dict[str, Any]:
        out = {k: v for k, v in t.items() if k not in ("team",)}
        out["team"] = t.get("team") or []
        out["avatar_url"] = self.avatar_url(t.get("avatar", ""))
        out["avatar_credit"] = self.avatar_credit(t.get("avatar", ""))
        out["avatar_kind"] = self.avatar_kind(t.get("avatar", ""))
        out["avatar_poses"] = self.pose_urls(t.get("avatar", ""))
        out["species"] = [s.get("species") for s in out["team"]]
        out["record"] = {"wins": t.get("wins", 0), "losses": t.get("losses", 0), "ties": t.get("ties", 0)}
        if summary and out["team"]:
            try:
                out["summary"] = self.team_summary(out["team"], t["format"])
            except SilverError as exc:
                out["summary_error"] = exc.message
        return out

    def avatar_url(self, avatar: str) -> str:
        if avatar.startswith("sd:"):
            return f"/api/sprites/trainers/{avatar[3:]}.png"
        if avatar.startswith("file:"):
            return f"/api/avatars/{avatar[5:]}"
        return ""

    def trainers_list(self, query: str = "", origin: str = "", deleted: bool = False, game: str = "", region: str = "") -> list[dict[str, Any]]:
        # "own" is everything you made: the random trainers you rolled are yours too (origin "random" alone lists only those)
        origins = ("own", "random") if origin == "own" else origin
        from .trainer_catalog import regions_for

        data = self.characters()
        canon = {t["key"]: t for t in self.canon()["trainers"]}
        out = []
        for trainer in self.store.trainers(origin=origins, deleted=deleted, limit=5000):
            view = self.trainer_view(trainer)
            key = trainer.get("canon_key", "")
            parts = key.split(":")
            character = data["by_key"].get(parts[1]) if key.startswith("char:") and len(parts) > 2 else None
            variant = next((v for v in character["variants"] if v["id"] == parts[2]), None) if character else None
            games = variant["games"] if variant else []
            exact = canon.get(key)
            if exact:
                games = {"Crystal": ["gsc"], "Emerald": ["e"], "FireRed/LeafGreen": ["frlg"]}.get(exact["game"], [])
            view["games"] = games
            view["regions"] = [exact["region"]] if exact else regions_for(games)
            view["character_name"] = character["name"] if character else ""
            view["character_name_es"] = character["name_es"] if character else ""
            view["game_names"] = [g["name"] for g in data["games"] if g["id"] in games]
            view["game_names_es"] = [g["name_es"] for g in data["games"] if g["id"] in games]
            hay = " ".join([view["name"], view["title"], view["character_name"], view["character_name_es"], *view["species"], *view["game_names"], *view["game_names_es"], *view["regions"]])
            if (not game or game in games) and (not region or region in view["regions"]) and (not query or query.casefold() in hay.casefold()):
                out.append(view)
        return out

    def trainer_get(self, id_: str) -> dict[str, Any]:
        t = self.store.trainer(id_)
        view = self.trainer_view(t, summary=True)
        view["paste"] = self.export_team(t["team"]) if t["team"] else ""
        view["battles"] = [self.battle_card(b) for b in self.store.battles(trainer_id=id_, limit=15)]
        view["badges"] = self.store.badges(challenger_trainer_id=id_)
        view["team_pool"] = self._trainer_pool(t)
        remaining = list(range(len(view["team_pool"])))
        view["team_pool_indices"] = []
        for member in t["team"][:6]:
            index = next((i for i in remaining if view["team_pool"][i] == member), None)
            if index is not None:
                view["team_pool_indices"].append(index)
                remaining.remove(index)
        return view

    def _trainer_pool(self, trainer: dict[str, Any]) -> list[dict[str, Any]]:
        """Recover a facility's full pool, including trainers installed before roster selection existed."""
        parts = (trainer.get("canon_key") or "").split(":")
        if len(parts) >= 3 and parts[0] == "char":
            character = self.characters()["by_key"].get(parts[1])
            variant = next((v for v in (character or {}).get("variants", []) if v["id"] == parts[2]), None)
            if variant and variant.get("pool"):
                pool = [{k: value for k, value in s.items() if k != "level_range"} for s in variant["sets"]]
                # Catalog sets omit defaults that saving a team fills in. Compare
                # both through the same normalizer, without inventing edited slots.
                normalized = self._team_from(pool + trainer["team"])
                candidates = normalized[:len(pool)]
                used: set[int] = set()
                for member, clean in zip(trainer["team"], normalized[len(pool):]):
                    index = next((i for i, candidate in enumerate(candidates) if i not in used and candidate == clean), None)
                    if index is None:
                        index = len(pool)
                        pool.append(member)
                        candidates.append(clean)
                    else:
                        # Keep exact stored sets so selected indices survive reads.
                        pool[index] = member
                    used.add(index)
                return pool
        return trainer["team"]

    @staticmethod
    def _pick_six(pool: list[dict[str, Any]], indices: list[int]) -> list[dict[str, Any]]:
        if (len(indices) != min(6, len(pool)) or len(set(indices)) != len(indices)
                or any(type(i) is not int or i < 0 or i >= len(pool) for i in indices)):
            raise SilverError("invalid", "Choose six different pool slots (zero-based), or the whole team if it has fewer than six.")
        return [pool[i] for i in indices]

    def trainer_create(self, *, name: str, team: Any = None, paste: str = "", format_: str = "", title: str = "", owner: str = "",
                       ai_level: str = "", ai_style: str = "", avatar: str = "", dialogue: Optional[dict[str, str]] = None, notes: str = "",
                       tags: Optional[list[str]] = None, origin: str = "own", canon_key: str = "") -> dict[str, Any]:
        sets = self._team_from(team, paste)
        if not name.strip():
            raise SilverError("invalid", "The trainer needs a name.")
        if len(sets) > 24:
            raise SilverError("invalid", "A team has at most 24 Pokémon.")
        level, style = self._clean_ai(ai_level, ai_style)
        fmt = format_ or self.settings["default_format"]
        self.format_info(fmt)
        if sets:
            self.check_team(sets, fmt)
        id_ = self.store.add_trainer({
            "name": name.strip()[:60], "title": title.strip()[:60], "owner": (owner or (self.settings["player_name"] if origin == "own" else "")).strip()[:60],
            "origin": origin, "format": fmt, "team": sets, "ai_level": level, "ai_style": style, "avatar": self._check_avatar(avatar),
            "dialogue": self._clean_dialogue(dialogue), "notes": notes[:4000], "tags": [str(x)[:30] for x in (tags or [])][:20], "canon_key": canon_key,
        })
        self.emit("trainer.created", {"id": id_, "name": name})
        return self.trainer_get(id_)

    def trainer_update(self, id_: str, changes: dict[str, Any]) -> dict[str, Any]:
        t = self.store.trainer(id_)
        values: dict[str, Any] = {}
        for key in ("name", "title", "owner", "notes"):
            if changes.get(key) is not None:
                values[key] = str(changes[key]).strip()[:4000 if key == "notes" else 60]
        if values.get("name") == "":
            raise SilverError("invalid", "The trainer needs a name.")
        if changes.get("format"):
            self.format_info(changes["format"])
            values["format"] = changes["format"]
        if changes.get("paste") or changes.get("team") is not None:
            values["team"] = self._team_from(changes.get("team"), changes.get("paste") or "")
            self.check_team(values["team"], values.get("format") or t["format"])
        if changes.get("ai_level") or changes.get("ai_style"):
            values["ai_level"], values["ai_style"] = self._clean_ai(changes.get("ai_level") or t["ai_level"], changes.get("ai_style") or t["ai_style"])
        if changes.get("avatar") is not None:
            values["avatar"] = self._check_avatar(changes["avatar"])
        if changes.get("dialogue") is not None:
            values["dialogue"] = self._clean_dialogue({**(t.get("dialogue") or {}), **changes["dialogue"]})
        if changes.get("tags") is not None:
            values["tags"] = [str(x)[:30] for x in changes["tags"]][:20]
        if changes.get("favorite") is not None:
            values["favorite"] = 1 if changes["favorite"] else 0
        if t.get("origin") == "random" and any(k in values for k in ("name", "team", "avatar")):
            # a random trainer you rename, re-team or re-draw is your own trainer from then on
            values["origin"] = "own"
            if not (values.get("owner") or t.get("owner")):
                values["owner"] = self.settings["player_name"]
        self.store.update_trainer(id_, values)
        return self.trainer_get(id_)

    def trainer_duplicate(self, id_: str, name: str = "") -> dict[str, Any]:
        t = self.store.trainer(id_)
        return self.trainer_create(name=name or f"{t['name']} (2)", team=t["team"], format_=t["format"], title=t["title"], owner=t["owner"],
                                   ai_level=t["ai_level"], ai_style=t["ai_style"], avatar=t["avatar"], dialogue=t["dialogue"], notes=t["notes"],
                                   tags=t["tags"], origin="own")

    def trainer_random(self, *, name: str = "", format_: str = "", ai_level: str = "", seed: Optional[str] = None) -> dict[str, Any]:
        fmt = format_ or self.settings["default_format"]
        info = self.format_info(fmt)
        team = self.random_team(f"gen{info['gen']}randombattle" if not info.get("random") else fmt, seed)
        names = self._trainer_sprite_names()
        import random

        rnd = random.Random(seed or time.time())
        avatar = rnd.choice([n for n in names if "-" not in n] or names) if names else ""
        return self.trainer_create(name=name or f"Entrenador {rnd.randint(100, 999)}", team=team["sets"], format_=fmt if not info.get("random") else
                                   f"gen{info['gen']}customgame", ai_level=ai_level, avatar=f"sd:{avatar}" if avatar else "", origin="random")

    def _check_avatar(self, avatar: str) -> str:
        avatar = (avatar or "").strip()
        if not avatar:
            return ""
        if avatar.startswith("sd:") and sharing.re.match(r"^[a-z0-9][a-z0-9-]{0,60}$", avatar[3:]):
            return avatar
        if avatar.startswith("file:"):
            self.sprites.avatar_path(avatar[5:])
            return avatar
        raise SilverError("invalid", "avatar must be sd:<trainer sprite name> or file:<uploaded file>")

    def _clean_dialogue(self, d: Optional[dict[str, Any]]) -> dict[str, str]:
        """The trainer's lines, and its change of tactics: phase_when (half: its team's HP falls to half; last: its last Pokémon),
        phase_level and phase_style (what its AI turns into then) and phase (what it says)."""
        out = {k: str((d or {}).get(k) or "").strip()[:280] for k in DIALOGUE_KEYS if (d or {}).get(k)}
        if out.get("phase_when") and out["phase_when"] not in PHASE_WHEN:
            raise SilverError("invalid", "phase_when is half or last")
        if out.get("phase_level") and out["phase_level"] not in AI_LEVELS:
            raise SilverError("invalid", f"phase_level must be one of {', '.join(AI_LEVELS)}")
        if out.get("phase_style") and out["phase_style"] not in AI_STYLES:
            raise SilverError("invalid", f"phase_style must be one of {', '.join(AI_STYLES)}")
        return out

    @staticmethod
    def _phase_of(dialogue: Optional[dict[str, Any]]) -> Optional[dict[str, str]]:
        """The change of tactics the engine plays (match.mjs phaseOf does the same on the playable page)."""
        d = dialogue or {}
        if d.get("phase_when") not in PHASE_WHEN:
            return None
        line = d.get("phase") or (d.get("last") if d["phase_when"] == "last" else "") or ""
        return {"when": d["phase_when"], **({"level": d["phase_level"]} if d.get("phase_level") else {}),
                **({"style": d["phase_style"]} if d.get("phase_style") else {}), **({"line": str(line)[:280]} if line else {})}

    def trainers_trash(self, ids: list[str]) -> dict[str, Any]:
        return {"trashed": self.store.trash_trainers(ids)}

    def trainers_restore(self, ids: list[str]) -> dict[str, Any]:
        return {"restored": self.store.restore_trainers(ids)}

    def trainers_purge(self, ids: list[str]) -> dict[str, Any]:
        return {"purged": self.store.purge_trainers(ids)}

    def _trainer_sprite_names(self) -> list[str]:
        try:
            return json.loads((PRESETS_DIR / "trainer_sprites.json").read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return []

    def credits_get(self, *, species: str = "", sprite: str = "") -> dict[str, Any]:
        """Who drew what: one trainer sprite's artist, one Pokémon's walking-sprite artists (SpriteCollab), or the whole list of
        sources with the artists of both kinds of sprites. Downloads the artist lists the first time (then a month / a week)."""
        if sprite:
            name = sprite.strip().lower().removeprefix("sd:").removesuffix(".png")
            if not re.match(r"^[a-z0-9][a-z0-9._-]{0,60}$", name):
                raise SilverError("invalid", f"Not a trainer sprite: {sprite}")
            return {"sprite": name, "artist": self.credits.trainer(name, wait=True), "url": self.avatar_url(f"sd:{name}"),
                    "note": "" if self.credits.trainer(name) else "No author on Showdown's index: the games' own art (or not credited)."}
        if species:
            info = self.engine.call("species", {"name": species, "gen": 9})
            num = int(info.get("num") or 0)
            if num <= 0:
                raise SilverError("not_found", f"{species} has no Pokédex number.")
            form = info["name"].split("-", 1)[1] if "-" in info["name"] else ""
            folder = self.pmd.folder(num, form)
            return {"species": info["name"], "num": num, "folder": folder, "artists": self.credits.walking(folder, wait=True),
                    "licence": "CC BY-NC 4.0", "source": "PMDCollab SpriteCollab"}
        return self.credits.summary(wait=True)

    def trainer_sprites(self, query: str = "", limit: int = 120) -> list[str]:
        q = query.lower().strip()
        names = self._trainer_sprite_names()
        hits = [n for n in names if q in n] if q else names
        return hits[:limit]

    # ------------------------------------------------------------ dialogue with the family's model
    def trainer_write_dialogue(self, id_: str, *, personality: str = "", lang: str = "es") -> dict[str, Any]:
        t = self.store.trainer(id_)
        team = ", ".join(s.get("species", "") for s in t["team"])
        language = "castellano de España" if lang == "es" else "English"
        prompt = (f"Write the battle lines of a Pokémon trainer for a fan battle simulator, in {language}. Trainer: {t['name']}"
                  f"{' (' + t['title'] + ')' if t['title'] else ''}. Team: {team}. Personality: {personality or 'infer it from the team and title'}. "
                  "Return JSON with keys intro (said before the battle), win (when the trainer wins), lose (when the trainer loses), last "
                  "(when sending the last Pokémon), last_low (when that last Pokémon is down to half its HP), after (what it says on the result "
                  "screen once the battle is over), on_ko (when its Pokémon knocks out a foe), on_faint (when one of its Pokémon faints), "
                  "on_super (when it lands a super-effective hit) and on_switch (when it switches Pokémon). One or two short sentences each "
                  "(on_* only one, short), in character, no emojis, no quotes.")
        res = family.chat([{"role": "user", "content": prompt}],
                          json={"type": "object", "properties": {k: {"type": "string"} for k in LINE_KEYS}, "required": list(LINE_KEYS)},
                          effort="low", max_tokens=800, timeout=180)
        if not res.get("ok"):
            raise SilverError("unavailable", f"No language model answered: {res.get('detail') or res.get('error')}",
                              hint="Start Hoard Hub and a model (Faustus, the Sparks or Ollama), or write the lines by hand.")
        lines = res.get("json") if isinstance(res.get("json"), dict) else {}
        if not lines:
            try:
                lines = json.loads(res.get("text") or "{}")
            except ValueError:
                lines = {}
        dialogue = self._clean_dialogue({k: v for k, v in lines.items() if k in LINE_KEYS})
        if not dialogue:
            raise SilverError("unavailable", "The model did not return the lines.")
        # the change of tactics (phase_*) stays as it was
        dialogue = {**{k: v for k, v in (t.get("dialogue") or {}).items() if k not in LINE_KEYS}, **dialogue}
        self.store.update_trainer(id_, {"dialogue": dialogue})
        return {"dialogue": dialogue, "model": res.get("model")}

    # ------------------------------------------------------------ canon trainers and leagues
    def canon(self) -> dict[str, Any]:
        if self._canon is None:
            self._canon = json.loads((PRESETS_DIR / "canon.json").read_text(encoding="utf-8"))
        return self._canon

    def canon_list(self, query: str = "", region: str = "") -> dict[str, Any]:
        c = self.canon()
        q = query.lower()
        trainers = []
        for t in c["trainers"]:
            if region and t["region"] != region:
                continue
            hay = f"{t['name']} {t['name_es']} {t['game']} {t['region']} {' '.join(s['species'] for s in t['sets'])}".lower()
            if q and q not in hay:
                continue
            installed = self.store.trainer_by_canon(t["key"])
            trainers.append({**{k: v for k, v in t.items() if k != "sets"}, "species": [s["species"] for s in t["sets"]],
                             "levels": [s["level"] for s in t["sets"]], "installed_id": installed["id"] if installed else "",
                             "avatar_url": self.avatar_url(f"sd:{t['avatar']}") if t.get("avatar") else ""})
        leagues = []
        for lg in c["leagues"]:
            installed = self.store.league_by_canon(lg["key"])
            leagues.append({**lg, "installed_id": installed["id"] if installed else ""})
        for lg in game_leagues.LEAGUES:   # leagues of more games, built from the characters' teams
            if region and lg["region"] != region:
                continue
            installed = self.store.league_by_canon(lg["key"])
            leagues.append({"key": lg["key"], "name": lg["name"], "name_es": lg["name_es"], "region": lg["region"], "game": lg["game"],
                            "format": f"gen{lg['gen']}customgame", "source": "characters",
                            "gyms": [{**{k: g[k] for k in ("city", "city_es", "type", "badge", "badge_es")}, "leader": f"char:{g['key']}"} for g in lg["gyms"]],
                            "elite_four": [f"char:{x['key']}" for x in lg["elite_four"]], "champion": f"char:{lg['champion']['key']}",
                            "installed_id": installed["id"] if installed else ""})
        return {"trainers": trainers, "leagues": leagues, "source": c.get("source", "")}

    def canon_install_trainer(self, key: str) -> dict[str, Any]:
        existing = self.store.trainer_by_canon(key)
        if existing:
            return self.trainer_view(existing)
        t = next((x for x in self.canon()["trainers"] if x["key"] == key), None)
        if not t:
            raise SilverError("not_found", f"No in-game trainer {key}")
        title = f"{t['class_es']} · {t['game']}"
        variant = f" ({t.get('variant_es') or t['variant']})" if t.get("variant") else ""
        id_ = self.store.add_trainer({
            "name": t["name_es"] + variant, "title": title, "owner": "", "origin": "canon", "format": t["format"], "team": t["sets"],
            "ai_level": "hard", "ai_style": "balanced", "avatar": f"sd:{t['avatar']}" if t.get("avatar") else "", "dialogue": {},
            "notes": f"{t['name']} — {t['region']}, {t['game']}.", "tags": [t["region"], t["game"], t["class"]], "canon_key": key,
        })
        return self.trainer_view(self.store.trainer(id_))

    def _install_game_league(self, key: str, lang: str = "es") -> dict[str, Any]:
        """A league of game_leagues.py: each member is the character's trainer for that game's team (installed once and reused). ``lang``
        is the language of the lines the cartridge trainers say (the names and titles are made in castellano and shown in the reader's)."""
        lg = game_leagues.BY_KEY[key]
        existing = self.store.league_by_canon(key)
        if existing:
            # installed before the cartridge data: untouched members take the cartridge's teams and the gyms without trainers get theirs
            for tid in (*existing["elite_four"], existing.get("champion_id")):
                self._cartridge_refresh(tid, lang)
            for gid in existing["gyms"]:
                try:
                    gym = self.store.gym(gid)
                except SilverError:
                    continue   # a gym the player removed
                self._cartridge_refresh(gym.get("leader_id"), lang)
                mine = next((m for m in lg["gyms"] if gym.get("canon_key") == f"{key}:{m['key']}"), None)
                if mine:
                    self._cartridge_gym(gid, mine, lang)
            return self.league_get(existing["id"])

        def member(m: dict[str, str]) -> dict[str, Any]:
            t = self.character_install(m["key"], variant=m["variant"], lang=lang)
            return self.store.trainer(t["id"])

        gym_ids = []
        for g in lg["gyms"]:
            gym_key = f"{key}:{g['key']}"
            gym = self.store.gym_by_canon(gym_key)
            if gym:
                gym_ids.append(gym["id"])
                continue
            leader = member(g)
            city = g["city_es"]
            gid = self.store.add_gym({
                "name": g.get("gym_es") or f"Gimnasio de {city}", "city": city, "type": g["type"], "badge": g["badge_es"],
                "badge_color": TYPE_COLORS.get(g["type"], "#c0c0c0"), "description": f"{g['badge']} · {g['city']} · {lg['game']}",
                "format": leader["format"], "rules": [], "level_rules": {"level_cap": max((x.get("level") or 100) for x in leader["team"]) if leader["team"] else 100},
                "leader_id": leader["id"], "trainers": [], "origin": "canon", "canon_key": gym_key,
            })
            gym_ids.append(gid)
            self._cartridge_gym(gid, g, lang)   # HeartGold/SoulSilver: the cartridge's gym trainers and the map
        elite = [member(m)["id"] for m in lg["elite_four"]]
        champ = member(lg["champion"])
        lid = self.store.add_league({
            "name": lg["name_es"], "description": f"{lg['name']} · {lg['game']}", "format": champ["format"], "rules": [],
            "level_rules": {"level_cap": max((x.get("level") or 100) for x in champ["team"]) if champ["team"] else 100},
            "gyms": gym_ids, "elite_four": elite, "champion_id": champ["id"], "badges_required": len(gym_ids), "origin": "canon", "canon_key": key,
        })
        self.emit("league.installed", {"id": lid, "key": key})
        return self.league_get(lid)

    def canon_install_league(self, key: str, lang: str = "es") -> dict[str, Any]:
        if key in game_leagues.BY_KEY:
            return self._install_game_league(key, "en" if lang == "en" else "es")
        lg = next((x for x in self.canon()["leagues"] if x["key"] == key), None)
        if not lg:
            raise SilverError("not_found", f"No league {key}")
        existing = self.store.league_by_canon(key)
        if existing:
            return self.league_get(existing["id"])
        gym_ids = []
        for i, g in enumerate(lg["gyms"]):
            gym_key = f"{key}:{g['leader']}"
            gym = self.store.gym_by_canon(gym_key)
            if not gym:
                leader = self.canon_install_trainer(g["leader"])
                gid = self.store.add_gym({
                    "name": f"Gimnasio de {g['city_es']}", "city": g["city_es"], "type": g["type"], "badge": g["badge_es"],
                    "badge_color": TYPE_COLORS.get(g["type"], "#c0c0c0"), "description": f"{g['badge']} · {g['city']} · {lg['game']}",
                    "format": next(t["format"] for t in self.canon()["trainers"] if t["key"] == g["leader"]), "rules": [],
                    "level_rules": {"level_cap": max(s["level"] for s in leader["team"])},
                    "leader_id": leader["id"], "trainers": [], "origin": "canon", "canon_key": gym_key,
                })
                gym_ids.append(gid)
            else:
                gym_ids.append(gym["id"])
        elite = [self.canon_install_trainer(k)["id"] for k in lg["elite_four"]]
        champ = self.canon_install_trainer(lg["champion"])["id"]
        champ_team = self.store.trainer(champ)["team"]
        lid = self.store.add_league({
            "name": lg["name_es"], "description": f"{lg['name']} · {lg['game']}", "format": lg["format"], "rules": [],
            "level_rules": {"level_cap": max(s["level"] for s in champ_team)},
            "gyms": gym_ids, "elite_four": elite, "champion_id": champ, "badges_required": len(gym_ids), "origin": "canon", "canon_key": key,
        })
        self.emit("league.installed", {"id": lid, "key": key})
        return self.league_get(lid)

    # ------------------------------------------------------------ characters: every team a character used, game by game
    def characters(self) -> dict[str, Any]:
        if self._characters is None:
            data = json.loads(gzip.decompress((PRESETS_DIR / "characters.json.gz").read_bytes()).decode("utf-8"))
            # Pokémon Unbound's Battle Frontier (scripts/build_unbound.mjs): its own game card; characters of the main games gain its teams
            extra = PRESETS_DIR / "unbound.json.gz"
            if extra.exists():
                more = json.loads(gzip.decompress(extra.read_bytes()).decode("utf-8"))
                known = {g["id"] for g in data["games"]}
                data["games"] = [*data["games"], *[g for g in more["games"] if g["id"] not in known]]
                data["characters"] = [*data["characters"], *more["characters"]]
                data["source"] = f"{data.get('source', '')} {more.get('source', '')}".strip()
            # the Frontier Brains missing from Bulbapedia's teams (scripts/build_frontier.py): Argenta and Thorton with their set pools
            brains = PRESETS_DIR / "frontier_brains.json.gz"
            if brains.exists():
                more = json.loads(gzip.decompress(brains.read_bytes()).decode("utf-8"))
                known = {c["key"] for c in data["characters"]}
                data["characters"] = [*data["characters"], *[c for c in more["characters"] if c["key"] not in known]]
            merged: dict[str, dict[str, Any]] = {}
            for c in data["characters"]:
                if c["key"] in merged:   # a character listed twice in the data keeps every team under one key
                    first = merged[c["key"]]
                    first["variants"] = [*first["variants"], *c["variants"]]
                    seen = {sp["id"] for sp in first.get("sprites") or []}
                    first["sprites"] = [*(first.get("sprites") or []), *[sp for sp in c.get("sprites") or [] if sp["id"] not in seen]]
                else:
                    merged[c["key"]] = c
            data["characters"] = list(merged.values())
            data["by_key"] = merged
            hgss_rom.merge(data)   # HeartGold and SoulSilver as the cartridge builds the trainers (exact sets, AI flags), and the cartridge's own characters
            self._characters = data
        return self._characters

    def _character(self, key: str) -> dict[str, Any]:
        c = self.characters()["by_key"].get((key or "").strip().lower())
        if not c:
            raise SilverError("not_found", f"No character {key}", hint="characters_list shows the keys (e.g. lance, cynthia, blue).")
        return c

    def _variant_label(self, v: dict[str, Any], lang: str = "es") -> str:
        labels = v["labels_es"] if lang == "es" else v["labels"]
        parts = [v["game_name_es"] if lang == "es" else v["game_name"], *labels]
        if v.get("with"):
            parts.append(("con " if lang == "es" else "with ") + v["with"])
        return " · ".join(parts)

    def characters_list(self, query: str = "", gen: int = 0, game: str = "", category: str = "") -> dict[str, Any]:
        """Characters with the teams that match; `game` is a game card id (rb, gsc, e, hgss, sv...) or a game code, `category` a role
        (leaders, elite, champions, trials, rivals, villains, facilities, tournaments, others). Also the game cards with their counts."""
        data = self.characters()
        q = query.strip().lower()
        g = game.strip().lower()
        made: dict[str, int] = {}
        for t in self.store.trainers_by_canon_prefix("char:"):
            k = t["canon_key"].split(":")[1]
            made[k] = made.get(k, 0) + 1
        if category and category not in data["categories"]:
            raise SilverError("invalid", f"category must be one of {', '.join(data['categories'])}")
        out = []
        for c in data["characters"]:
            variants = [v for v in c["variants"] if (not gen or v["gen"] == gen) and (not g or g in v["games"] or v["game"].lower() == g)
                        and (not category or v["category"] == category)]
            if not variants:
                continue
            if q:
                hay = f"{c['name']} {c['name_es']} {c['key']} " + " ".join(f"{v['game_name']} {v['game_name_es']} {' '.join(x['species'] for x in v['sets'])}" for v in variants)
                if q not in hay.lower():
                    continue
            ace = next((v for v in reversed(variants) if not v.get("side")), variants[-1])
            cats = list(dict.fromkeys(v["category"] for v in variants))
            sprite = ace.get("sprite") if g else c["base_sprite"]
            out.append({"key": c["key"], "name": c["name"], "name_es": c["name_es"], "avatar_url": self.avatar_url(f"sd:{sprite or c['base_sprite']}") if (sprite or c["base_sprite"]) else "",
                        "teams": len(variants), "sprites": len(c["sprites"]), "games": list(dict.fromkeys(x for v in variants for x in v["games"])),
                        "gens": sorted({v["gen"] for v in variants}), "species": [x["species"] for x in ace["sets"]], "categories": cats,
                        "installed": made.get(c["key"], 0)})
        return {"characters": out, "total": len(data["characters"]), "games": self._character_games(), "categories": data["categories"],
                "source": data.get("source", "")}

    def _character_games(self) -> list[dict[str, Any]]:
        from .trainer_catalog import regions_for
        data = self.characters()
        if "game_cards" not in data:
            order = {"champions": 0, "elite": 1, "leaders": 2, "rivals": 3, "villains": 4}
            cards = []
            for gm in data["games"]:
                who: dict[str, tuple[int, str]] = {}
                teams = 0
                cats: dict[str, set[str]] = {}
                for c in data["characters"]:
                    for v in c["variants"]:
                        if gm["id"] not in v["games"]:
                            continue
                        teams += 1
                        cats.setdefault(v["category"], set()).add(c["key"])
                        rank = order.get(v["category"], 9)
                        if c["key"] not in who or rank < who[c["key"]][0]:
                            who[c["key"]] = (rank, v.get("sprite") or c["base_sprite"])
                if not teams:
                    continue
                faces = [sp for _, sp in sorted(who.values())[:5]]
                cards.append({**gm, "regions": regions_for([gm["id"]]), "characters": len(who), "teams": teams, "categories": {k: len(v) for k, v in cats.items()},
                              "faces": [self.avatar_url(f"sd:{sp}") for sp in faces if sp]})
            data["game_cards"] = cards
        return data["game_cards"]

    def character_get(self, key: str) -> dict[str, Any]:
        c = self._character(key)
        artists = self.credits.trainers()
        sprites = [{**sp, "avatar": f"sd:{sp['id']}", "url": self.avatar_url(f"sd:{sp['id']}"), "artist": artists.get(sp["id"].lower(), "")}
                   for sp in c["sprites"]]
        variants = []
        for v in c["variants"]:
            variants.append({**v, "trainer_class_es": v.get("trainer_class_es") or _CLASS_ES.get(v["trainer_class"], v["trainer_class"]), "label": self._variant_label(v, "en"), "label_es": self._variant_label(v, "es"), "sprite_url": self.avatar_url(f"sd:{v['sprite']}") if v["sprite"] else "",
                             "species": [x["species"] for x in v["sets"]], "levels": [x["level"] for x in v["sets"]], "max_level": max(x["level"] for x in v["sets"])})
        installed = [self.trainer_view(t) for t in self.store.trainers_by_canon_prefix(f"char:{c['key']}:")]
        mine = {x for v in c["variants"] for x in v["games"]}
        cards = [{k: gm[k] for k in ("id", "gen", "name", "name_es", "side")} for gm in self.characters()["games"] if gm["id"] in mine]
        return {"key": c["key"], "name": c["name"], "name_es": c["name_es"], "base_sprite": c["base_sprite"], "avatar_url": self.avatar_url(f"sd:{c['base_sprite']}") if c["base_sprite"] else "",
                "sprites": sprites, "variants": variants, "installed": installed, "games": cards, "categories": self.characters()["categories"],
                # a character made for a romhack has no Bulbapedia page
                "bulbapedia": "https://bulbapedia.bulbagarden.net/wiki/" + c["name"].replace(" ", "_") if any(v["games"] != ["unbound"] for v in c["variants"]) else "",
                "source": self.characters().get("source", "")}

    def character_install(self, key: str, *, variant: str = "", sprite: str = "", name: str = "", custom: bool = False,
                          ai_level: str = "", ai_style: str = "", lang: str = "es", avatar: str = "", art: str = "",
                          team_indices: Optional[list[int]] = None) -> dict[str, Any]:
        """A trainer from a character: one of its game teams (or an empty team of your own when custom), with the sprite you choose,
        or ``avatar`` (file:<name>, a picture of your own such as its official artwork; ``art`` names that artwork)."""
        c = self._character(key)
        if avatar:
            avatar = self._check_avatar(avatar)
            if not avatar.startswith("file:"):
                raise SilverError("invalid", "avatar is file:<name> (a picture of your own); sprite takes the Showdown sprites")
        v = None
        if variant:
            v = next((x for x in c["variants"] if x["id"] == variant), None)
            if not v:
                raise SilverError("not_found", f"{c['name']} has no team {variant}", hint="character_get lists the team ids.")
        elif not custom:
            v = c["variants"][-1]
        if sprite:
            if sprite.startswith("sd:"):
                sprite = sprite[3:]
            if sprite not in {sp["id"] for sp in c["sprites"]} and sprite not in self._trainer_sprite_names():
                raise SilverError("invalid", f"Unknown trainer sprite {sprite}")
        else:
            sprite = (v or {}).get("sprite") or c["base_sprite"]
        canon_key = f"char:{c['key']}:{v['id'] if v and not custom else 'own'}:{('art:' + (art or avatar)[:80]) if avatar else sprite}"
        if team_indices is not None:
            if not v or custom:
                raise SilverError("invalid", "Choose a character team before selecting its pool slots.")
            self._pick_six(v["sets"], team_indices)
            canon_key += ":slots:" + ",".join(str(i) for i in team_indices)
        if not custom and not name:
            existing = self.store.trainer_by_canon(canon_key)
            if existing:
                if v and v.get("cartridge"):
                    existing = self._cartridge_upgrade(existing, v, lang) or existing
                return {**self.trainer_view(existing), "existing": True}
        lang_es = lang != "en"
        cart = bool(v and v.get("cartridge"))   # a HeartGold/SoulSilver team from the cartridge's data
        display = c["name_es"] if lang_es else c["name"]
        if custom:
            title = "Equipo propio" if lang_es else "Own team"
            default_name = f"{display} ({title.lower()})"
        else:
            title = f"{(v.get('trainer_class_es') or _CLASS_ES.get(v['trainer_class'], v['trainer_class'])) if lang_es else v['trainer_class']} · {v['game_name_es'] if lang_es else v['game_name']}".strip(" ·")
            inner = self._variant_label(v, "es" if lang_es else "en")
            labels = (v["labels_es"] if lang_es else v["labels"]) + ([("con " if lang_es else "with ") + v["with"]] if v.get("with") else [])
            short = " · ".join(labels) or (v["game_name_es"] if lang_es else v["game_name"])
            # names hold 60 characters: the game goes in the title when it does not fit
            default_name = next((f"{display} ({x})" for x in (inner, short) if len(display) + len(x) + 3 <= 60), "")
            if not default_name:
                default_name = f"{display} ({short[:60 - len(display) - 4].rsplit(' ', 1)[0]}…)"
        notes = []
        if v:
            notes.append(self._variant_label(v, "es"))
            if v.get("location"):
                notes.append(f"Lugar: {v['location']}")
            if v.get("note") and not cart:
                notes.append(f"Bulbapedia: {v['note']}")
        if cart:
            notes.extend([hgss_rom.note(v), hgss_rom.CREDIT])
        else:
            notes.append((v.get("credit") or "Equipo de Bulbapedia (CC BY-NC-SA); sprite de Pokémon Showdown.") if v else "Sprite de Pokémon Showdown.")
        if avatar:
            notes.append(f"Imagen: {art or 'propia'} ({self.avatar_credit(avatar) or 'imagen propia'}).")
        sets = [{k: x for k, x in s.items() if k != "level_range"} for s in (v["sets"] if v else [])] if (v and not custom) or (v and custom and variant) else []
        if v and v.get("pool"):   # a battle facility's pool: the trainer takes six of them
            sets = self._pick_six(sets, team_indices) if team_indices is not None else sets[:6]
            notes.append(f"Grupo de {v['pool']} Pokémon posibles en la instalación; puedes elegir seis desde Combatir.")
        elif team_indices is not None:
            sets = self._pick_six(sets, team_indices)
        fmt = v["format"] if v else self.settings["default_format"]
        # a team from the cartridge plays with the AI its flags mean (hgss_rom.ai_for) unless the player chose one
        auto = v["ai"] if cart and not custom else {"level": "hard", "style": "balanced"}
        level, style = self._clean_ai(ai_level or auto["level"], ai_style or auto["style"])
        tags = [c["name"], *([v["game_name_es"], f"Gen {v['gen']}"] if v else []), *(["Cartucho" if lang_es else "Cartridge"] if cart else [])]
        id_ = self.store.add_trainer({
            "name": (name or default_name).strip()[:60], "title": title[:60], "owner": self.settings["player_name"] if custom else "",
            "origin": "own" if custom else "canon", "format": fmt, "team": sets, "ai_level": level, "ai_style": style,
            "avatar": avatar or (self._check_avatar(f"sd:{sprite}") if sprite else ""),
            "dialogue": self._clean_dialogue(hgss_rom.lines(v["rom"], lang)) if cart and not custom else {},
            "notes": "\n".join(notes)[:4000], "tags": [str(x)[:30] for x in tags][:20], "canon_key": canon_key,
        })
        self.emit("trainer.created", {"id": id_, "name": name or default_name, "character": c["key"]})
        return self.trainer_view(self.store.trainer(id_))

    def _cartridge_upgrade(self, t: dict[str, Any], v: dict[str, Any], lang: str = "es") -> Optional[dict[str, Any]]:
        """A trainer made from a HeartGold/SoulSilver team before the cartridge data came, and never changed since, takes the cartridge's
        exact team, its AI (when it still has the default one), its lines (when it has none) and its credit. What the player edited is never
        touched. Returns the trainer as it is now, or None when nothing changed."""
        if "pret/pokeheartgold" in (t.get("notes") or "") or abs(t["updated_at"] - t["created_at"]) > 1:
            return None
        changes: dict[str, Any] = {"team": [{k: x for k, x in s.items() if k != "level_range"} for s in v["sets"]]}
        if (t["ai_level"], t["ai_style"]) == ("hard", "balanced"):
            changes.update(ai_level=v["ai"]["level"], ai_style=v["ai"]["style"])
        if not t.get("dialogue"):
            changes["dialogue"] = self._clean_dialogue(hgss_rom.lines(v["rom"], lang))
        kept = [x for x in (t.get("notes") or "").split("\n") if not x.startswith("Bulbapedia:") and "Equipo de Bulbapedia" not in x]
        changes["notes"] = "\n".join([*kept, hgss_rom.note(v), hgss_rom.CREDIT])[:4000]
        changes["tags"] = [*(t.get("tags") or []), *([] if "Cartucho" in (t.get("tags") or []) else ["Cartucho"])][:20]
        self.store.update_trainer(t["id"], changes)
        return self.store.trainer(t["id"])

    def _cartridge_refresh(self, trainer_id: Optional[str], lang: str = "es") -> None:
        """Bring a trainer of an installed league up to date with the cartridge, when it was made from a cartridge team (its canon_key says which)."""
        try:
            t = self.store.trainer(trainer_id) if trainer_id else None
        except SilverError:
            t = None   # a trainer the player removed
        if not t:
            return
        parts = (t.get("canon_key") or "").split(":")
        c = self.characters()["by_key"].get(parts[1]) if len(parts) >= 3 and parts[0] == "char" else None
        v = next((x for x in c["variants"] if x["id"] == parts[2]), None) if c else None
        if v and v.get("cartridge"):
            self._cartridge_upgrade(t, v, lang)

    def _cartridge_trainer(self, index: int, gym: dict[str, Any], lang: str = "es") -> str:
        """The gym trainer of the cartridge with this number, made once and reused (canon_key rom:hgss:<number>). Its class and name are
        castellano (names_i18n shows them in the reader's language); its lines are in ``lang``."""
        key = f"{hgss_rom.CANON_PREFIX}{index}"
        existing = self.store.trainer_by_canon(key)
        if existing:
            return existing["id"]
        row = hgss_rom.trainer_row(index, "es")
        try:
            avatar = self._check_avatar(f"sd:{row['sprite']}")
        except SilverError:
            avatar = ""
        return self.store.add_trainer({
            "name": row["name"], "title": f"{row['class']} · {gym['name']}"[:60], "owner": "", "origin": "canon", "format": gym["format"],
            "team": row["team"], "ai_level": row["ai_level"], "ai_style": row["ai_style"], "avatar": avatar,
            "dialogue": self._clean_dialogue(hgss_rom.lines(index, lang)), "notes": hgss_rom.gym_note(index, row)[:4000],
            "tags": [str(x)[:30] for x in (gym["city"], "HeartGold/SoulSilver", row["class"], "Cartucho")], "canon_key": key,
        })

    def _cartridge_gym(self, gym_id: str, member: dict[str, str], lang: str = "es") -> None:
        """A HeartGold/SoulSilver gym of a league: its gym trainers as the cartridge has them, in the order you meet them, and the gym's
        map. A gym that already has trainers or a map (the player's) is left alone; a map that does not fit leaves the gym without one."""
        rom = hgss_rom.gym(member["key"]) if member["variant"] == "hgssgymbattle" else None
        gym = self.store.gym(gym_id)
        if not rom or gym.get("trainers") or (gym.get("map") or {}).get("w"):
            return
        ids = {index: self._cartridge_trainer(index, gym, lang) for index in hgss_rom.gym_trainer_indexes(rom)}
        values: dict[str, Any] = {"trainers": list(ids.values())}
        try:
            values["map"] = hgss_rom.gym_map(member["key"], ids)
        except SilverError:
            pass   # the gym works without walking it
        self.store.update_gym(gym_id, values)

    # ------------------------------------------------------------ gyms and leagues
    def _check_trainers(self, ids: list[str]) -> list[str]:
        for i in ids:
            self.store.trainer(i)
        return list(dict.fromkeys(ids))

    def gym_view(self, g: dict[str, Any], *, full: bool = False) -> dict[str, Any]:
        out = dict(g)
        try:
            leader = self.store.trainer(g["leader_id"]) if g.get("leader_id") else None
        except SilverError:
            leader = None
        out["leader"] = self.trainer_view(leader) if leader else None
        out["rt_arena_name"] = ""
        if ARENA_CUSTOM.match(g.get("rt_arena") or ""):
            try:
                out["rt_arena_name"] = self.arenas.spec(g["rt_arena"])["name"]
            except SilverError:
                out["rt_arena"] = ""
        if full:
            out["gym_trainers"] = [self.trainer_view(t) for t in self.store.trainers(ids=g.get("trainers") or [])]
            out["gym_trainers"].sort(key=lambda t: (g.get("trainers") or []).index(t["id"]))
            out["badges"] = self.store.badges(gym_id=g["id"])
        return out

    def gyms_list(self, query: str = "", deleted: bool = False) -> list[dict[str, Any]]:
        return [self.gym_view(g) for g in self.store.gyms(query=query, deleted=deleted)]

    def gym_get(self, id_: str) -> dict[str, Any]:
        return self.gym_view(self.store.gym(id_), full=True)

    def _check_badge_image(self, image: str) -> str:
        image = (image or "").strip()
        if not image:
            return ""
        if image.startswith("shape:") and image[6:] in BADGE_SHAPES:
            return image
        if image.startswith("file:"):
            self.sprites.avatar_path(image[5:])
            return image
        raise SilverError("invalid", f"badge_image is shape:<{'|'.join(BADGE_SHAPES)}> or file:<uploaded picture>")

    def badge_upload(self, data: bytes, *, gym_id: str = "", remove_background: bool = False) -> dict[str, Any]:
        """A picture of your own for a gym badge (kept up to 256 px, transparent PNG). With gym_id it goes on that gym at once."""
        name = self.sprites.save_avatar(data, stem=f"badge-{gym_id or 'gym'}", pixelate=False, remove_background=remove_background, max_side=256)
        image = f"file:{name}"
        if gym_id:
            self.store.update_gym(gym_id, {"badge_image": image})
        return {"badge_image": image, "url": f"/api/avatars/{name}", "gym_id": gym_id}

    def badge_draw(self, *, description: str = "", gym_id: str = "", count: int = 2) -> dict[str, Any]:
        """Badges drawn by Prospero's Hoard from a description (a job); the gym's type and badge name fill in what is missing."""
        g = self.store.gym(gym_id) if gym_id else None
        description = " ".join((description or "").split())[:300]
        if not description and g:
            description = " ".join(x for x in (g.get("badge") or "", f"{g['type']} type" if g.get("type") else "") if x)
        if not description:
            raise SilverError("invalid", "Describe the badge (or give a gym with a type or a badge name).")
        count = max(1, min(int(count or 2), 4))
        return self._job("badge", f"Medalla dibujada ({description[:40]})", {"gym_id": gym_id, "description": description},
                         lambda jid, progress, cancelled: self._prospero_badge(description, gym_id, count, progress, cancelled))

    def _prospero_badge(self, description: str, gym_id: str, count: int, progress: Callable[[float], None],
                        cancelled: Callable[[], bool]) -> dict[str, Any]:
        progress(0.02)
        projects = self._prospero_call("studio_projects", {"query": "Silver's Hoard", "limit": 20}) or {}
        items = (projects.get("items") if isinstance(projects, dict) else None) or []
        project = next((p["id"] for p in items if p.get("name") == "Silver's Hoard"), "")
        if not project:
            created = self._prospero_call("studio_create_project", {"name": "Silver's Hoard", "brief": "Pictures for the battle simulator."}, write=True) or {}
            project = created.get("id") or (created.get("project") or {}).get("id")
        if not project:
            raise SilverError("unavailable", "Prospero did not create the project for the badges.")
        prompt = (f"A single collectible gym badge pin for a monster-battling game: {description}. Enamel and polished metal, bold simple "
                  "symbolic shape, centred, front view, plain flat white background, no text, no letters, no hands, no people.")
        args: dict[str, Any] = {"project": project, "prompt": prompt, "count": count, "aspect": "1:1"}
        if self.settings.get("prospero_engine"):
            args["engine"] = self.settings["prospero_engine"]
        gen = self._prospero_call("studio_generate_image", args, timeout=180, write=True) or {}
        job = (gen.get("job") or {}) if isinstance(gen, dict) else {}
        if not job.get("id"):
            raise SilverError("unavailable", "Prospero did not queue the picture.")
        job = self._prospero_wait(job, cancelled, lambda p: progress(0.05 + 0.75 * p))
        base = self._prospero_url()
        files = []
        ids = [a for a in (job.get("asset_ids") or [a.get("id") for a in job.get("assets") or []]) if a][:4]
        for n, aid in enumerate(ids):
            data, matted = self._prospero_cutout(base, aid, cancelled)
            name = self.sprites.save_avatar(data, stem=f"badge-{gym_id or 'gym'}-ai", pixelate=False, remove_background=not matted, max_side=256)
            files.append({"file": name, "url": f"/api/avatars/{name}", "badge_image": f"file:{name}", "prospero_asset": aid})
            progress(0.8 + 0.2 * (n + 1) / len(ids))
        if not files:
            raise SilverError("unavailable", "Prospero finished without pictures.")
        if gym_id:
            self.store.update_gym(gym_id, {"badge_image": files[0]["badge_image"]})
        progress(1.0)
        return {"candidates": files, "prompt": prompt}

    def gym_save(self, id_: str = "", **v: Any) -> dict[str, Any]:
        values: dict[str, Any] = {}
        for key in ("name", "city", "type", "badge", "badge_color", "description"):
            if v.get(key) is not None:
                values[key] = str(v[key]).strip()[:2000 if key == "description" else 60]
        if v.get("badge_image") is not None:
            values["badge_image"] = self._check_badge_image(v["badge_image"])
        if v.get("format"):
            self.format_info(v["format"], v.get("rules"))
            values["format"] = v["format"]
        if v.get("rules") is not None:
            values["rules"] = [str(r).strip()[:80] for r in v["rules"] if str(r).strip()][:20]
        if v.get("level_rules") is not None:
            values["level_rules"] = {k: int(x) for k, x in (v["level_rules"] or {}).items() if k in ("level", "level_cap", "level_min") and x}
        if v.get("leader_id") is not None:
            if v["leader_id"]:
                self.store.trainer(v["leader_id"])
            values["leader_id"] = v["leader_id"]
        if v.get("trainers") is not None:
            values["trainers"] = self._check_trainers(v["trainers"])
        if v.get("rt_arena") is not None:
            values["rt_arena"] = _rt_arena(v["rt_arena"]) if v["rt_arena"] else ""
            if values["rt_arena"]:
                self.arenas.spec(values["rt_arena"])   # it exists
        if v.get("backdrop") is not None:
            values["backdrop"] = self._check_backdrop(v["backdrop"])
        if v.get("map") is not None:
            trainers = values.get("trainers") if "trainers" in values else (self.store.gym(id_).get("trainers") if id_ else [])
            values["map"] = gymmap.clean(v["map"], list(trainers or []))
        elif "trainers" in values and id_:
            old = self.store.gym(id_).get("map") or {}
            if old.get("w"):   # the trainers changed: the map must still hold all of them, else it goes
                try:
                    values["map"] = gymmap.clean(old, values["trainers"])
                except SilverError:
                    values["map"] = {}
        if id_:
            self.store.update_gym(id_, values)
        else:
            if not values.get("name"):
                raise SilverError("invalid", "The gym needs a name.")
            if not values.get("leader_id"):
                raise SilverError("invalid", "The gym needs a leader.", hint="Create the leader trainer first, then choose it.")
            values.setdefault("format", self.store.trainer(values["leader_id"])["format"])
            values.setdefault("owner", self.settings["player_name"])
            id_ = self.store.add_gym(values)
            self.emit("gym.created", {"id": id_, "name": values["name"]})
        return self.gym_get(id_)

    BACKDROP = re.compile(r"^bg-[a-z0-9-]{2,40}\.(png|jpg)$")

    def _check_backdrop(self, value: str) -> str:
        """A gym's turn-based backdrop: one of the battle backdrops by file name (bg-volcanocave.png…), file:<picture of your own>
        (backdrop_upload), or "" for the usual one."""
        v = str(value or "").strip()
        if v.startswith("file:"):
            self.sprites.avatar_path(v[5:])
            return v
        v = v.lower()
        if v and not self.BACKDROP.match(v):
            raise SilverError("invalid", "backdrop is the file name of a battle backdrop, such as bg-icecave.jpg, file:<uploaded picture>, or empty.")
        return v

    def backdrop_upload(self, data: bytes, *, gym_id: str = "") -> dict[str, Any]:
        """A picture of your own as a gym's turn-based backdrop (up to 800 px, small enough to travel). With gym_id it goes on that gym."""
        name = self.sprites.save_backdrop(data, stem=f"backdrop-{gym_id or 'gym'}")
        backdrop = f"file:{name}"
        if gym_id:
            self.store.gym(gym_id)
            self.store.update_gym(gym_id, {"backdrop": backdrop})
        return {"backdrop": backdrop, "url": f"/api/avatars/{name}", "gym_id": gym_id}

    def _backdrop_payload(self, value: str) -> Any:
        """A gym's backdrop as it travels: the file name of a battle backdrop, or the picture itself."""
        if value.startswith("file:"):
            try:
                data = self.sprites.avatar_path(value[5:]).read_bytes()
            except SilverError:
                return ""
            return {"kind": "image", "mime": "image/png", "data": base64.b64encode(data).decode("ascii")}
        return value

    def _import_backdrop(self, payload: Any, stem: str) -> str:
        if isinstance(payload, dict) and payload.get("kind") == "image" and payload.get("data"):
            try:
                return "file:" + self.sprites.save_backdrop(base64.b64decode(payload["data"]), stem=stem)
            except (SilverError, ValueError):
                return ""
        v = str(payload or "").strip().lower()
        return v if self.BACKDROP.match(v) else ""

    def league_view(self, lg: dict[str, Any]) -> dict[str, Any]:
        out = dict(lg)
        out["gym_list"] = [self.gym_view(g) for g in self.store.gyms(ids=lg.get("gyms") or [])]
        out["gym_list"].sort(key=lambda g: (lg.get("gyms") or []).index(g["id"]))
        out["elite_list"] = [self.trainer_view(t) for t in self.store.trainers(ids=lg.get("elite_four") or [])]
        out["elite_list"].sort(key=lambda t: (lg.get("elite_four") or []).index(t["id"]))
        try:
            out["champion"] = self.trainer_view(self.store.trainer(lg["champion_id"])) if lg.get("champion_id") else None
        except SilverError:
            out["champion"] = None
        out["hall"] = self.store.hall(league_id=lg["id"])
        return out

    def leagues_list(self, deleted: bool = False, origin: str = "") -> list[dict[str, Any]]:
        return [self.league_view(lg) for lg in self.store.leagues(deleted=deleted) if not origin or (lg.get("origin") or "own") == origin]

    def leagues_catalog(self) -> list[dict[str, Any]]:
        """Every league of the games, oldest generation first, shaped like league_view: the installed ones are their league
        (id, hall of fame); the rest carry id "" and install with canon_install (league_key = key) the first time they are opened."""
        canon = self.canon()
        canon_trainers = {t["key"]: t for t in canon["trainers"]}

        def canon_person(k: str) -> dict[str, Any]:
            t = canon_trainers.get(k) or {}
            return {"id": k, "name": t.get("name_es") or t.get("name") or k, "avatar_url": self.avatar_url(f"sd:{t['avatar']}") if t.get("avatar") else ""}

        def char_person(m: dict[str, str]) -> dict[str, Any]:
            try:
                c = self._character(m["key"])
            except SilverError:
                return {"id": m["key"], "name": m["key"], "avatar_url": ""}
            v = next((x for x in c["variants"] if x["id"] == m["variant"]), None)
            sprite = (v or {}).get("sprite") or c["base_sprite"]
            return {"id": f"{m['key']}:{m['variant']}", "name": c["name_es"], "avatar_url": self.avatar_url(f"sd:{sprite}") if sprite else ""}

        def gym(key: str, i: int, g: dict[str, Any], leader: dict[str, Any]) -> dict[str, Any]:
            return {"id": f"{key}:{i}", "name": g.get("gym_es") or f"Gimnasio de {g['city_es']}", "city": g["city_es"], "type": g["type"],
                    "badge": g["badge_es"], "badge_color": TYPE_COLORS.get(g["type"], "#c0c0c0"), "badge_image": "", "leader": leader}

        entries = []
        for lg in canon["leagues"]:
            gen = int(re.search(r"gen(\d)", lg["format"]).group(1))
            entries.append((gen, lg["key"], lg["name"], lg["name_es"], lg["region"], lg["game"],
                            [gym(lg["key"], i, g, canon_person(g["leader"])) for i, g in enumerate(lg["gyms"])],
                            [canon_person(k) for k in lg["elite_four"]], canon_person(lg["champion"])))
        for lg in game_leagues.LEAGUES:
            entries.append((lg["gen"], lg["key"], lg["name"], lg["name_es"], lg["region"], lg["game"],
                            [gym(lg["key"], i, g, char_person(g)) for i, g in enumerate(lg["gyms"])],
                            [char_person(m) for m in lg["elite_four"]], char_person(lg["champion"])))
        entries.sort(key=lambda e: e[0])
        out, keys = [], set()
        for gen, key, name, name_es, region, game, gyms, elite, champion in entries:
            keys.add(key)
            meta = {"key": key, "region": region, "game": game, "gen": gen}
            installed = self.store.league_by_canon(key)
            if installed:
                out.append({**self.league_view(installed), **meta, "installed": True})
                continue
            out.append({"id": "", "name": name_es, "description": f"{name} · {game}", "origin": "canon", "canon_key": key, "gym_list": gyms,
                        "elite_list": elite, "champion": champion, "badges_required": len(gyms), "hall": [], "installed": False, **meta})
        # leagues of the games installed from somewhere else (an older catalog) stay listed too
        for lg in self.store.leagues():
            if lg.get("origin") == "canon" and lg.get("canon_key") not in keys:
                out.append({**self.league_view(lg), "key": lg.get("canon_key") or "", "installed": True})
        return out

    def league_get(self, id_: str) -> dict[str, Any]:
        return self.league_view(self.store.league(id_))

    def league_save(self, id_: str = "", **v: Any) -> dict[str, Any]:
        values: dict[str, Any] = {}
        for key in ("name", "description"):
            if v.get(key) is not None:
                values[key] = str(v[key]).strip()[:2000 if key == "description" else 80]
        if v.get("format"):
            self.format_info(v["format"], v.get("rules"))
            values["format"] = v["format"]
        if v.get("rules") is not None:
            values["rules"] = [str(r).strip()[:80] for r in v["rules"] if str(r).strip()][:20]
        if v.get("level_rules") is not None:
            values["level_rules"] = {k: int(x) for k, x in (v["level_rules"] or {}).items() if k in ("level", "level_cap", "level_min") and x}
        if v.get("gyms") is not None:
            for g in v["gyms"]:
                self.store.gym(g)
            values["gyms"] = list(dict.fromkeys(v["gyms"]))
        if v.get("elite_four") is not None:
            values["elite_four"] = self._check_trainers(v["elite_four"])
        if v.get("champion_id") is not None:
            if v["champion_id"]:
                self.store.trainer(v["champion_id"])
            values["champion_id"] = v["champion_id"]
        if v.get("badges_required") is not None:
            values["badges_required"] = max(0, int(v["badges_required"]))
        if id_:
            self.store.update_league(id_, values)
        else:
            if not values.get("name"):
                raise SilverError("invalid", "The league needs a name.")
            if not values.get("champion_id"):
                raise SilverError("invalid", "The league needs a champion.")
            values.setdefault("format", self.store.trainer(values["champion_id"])["format"])
            values.setdefault("badges_required", len(values.get("gyms") or []))
            values.setdefault("owner", self.settings["player_name"])
            id_ = self.store.add_league(values)
        return self.league_get(id_)

    def trash(self, kind: str, ids: list[str], action: str) -> dict[str, Any]:
        fn = {("trainer", "trash"): self.store.trash_trainers, ("trainer", "restore"): self.store.restore_trainers,
              ("trainer", "purge"): self.store.purge_trainers, ("gym", "trash"): self.store.trash_gyms, ("gym", "restore"): self.store.restore_gyms,
              ("gym", "purge"): self.store.purge_gyms, ("league", "trash"): self.store.trash_leagues, ("league", "restore"): self.store.restore_leagues,
              ("league", "purge"): self.store.purge_leagues}.get((kind, action))
        if not fn:
            raise SilverError("invalid", f"Unknown {kind}/{action}")
        return {action: fn(ids)}

    def trash_list(self) -> dict[str, Any]:
        return {"trainers": self.trainers_list(deleted=True), "gyms": self.gyms_list(deleted=True), "leagues": [self.league_view(lg) for lg in self.store.leagues(deleted=True)]}

    # ------------------------------------------------------------ battles
    def _lock_for(self, battle_id: str) -> threading.Lock:
        with self._locks_guard:
            return self._battle_locks.setdefault(battle_id, threading.Lock())

    def _seat(self, spec: dict[str, Any], default_name: str) -> dict[str, Any]:
        """A battle seat from {trainer_id | team/paste + name, human, ai_level, ai_style}."""
        human = bool(spec.get("human"))
        if spec.get("trainer_id"):
            t = self.store.trainer(spec["trainer_id"])
            sets, name, avatar = t["team"], t["name"], t["avatar"]
            level, style = spec.get("ai_level") or t["ai_level"], spec.get("ai_style") or t["ai_style"]
            dialogue = t.get("dialogue") or {}
            fmt = t["format"]
        else:
            sets = self._team_from(spec.get("team"), spec.get("paste") or "")
            name, avatar, dialogue, fmt = spec.get("name") or default_name, spec.get("avatar") or "", {}, ""
            level, style = spec.get("ai_level") or self.settings["default_ai_level"], spec.get("ai_style") or self.settings["default_ai_style"]
        if spec.get("team_size"):
            sets = sets[: int(spec["team_size"])]
        if spec.get("team_indices") is not None:
            pool = self._trainer_pool(t) if spec.get("trainer_id") else sets
            sets = self._pick_six(pool, spec["team_indices"])
        if not sets:
            raise SilverError("empty_team", f"{name} has no team.")
        level, style = self._clean_ai(level, style)
        if level == "neural" and not human:
            self.neural.ensure()   # its server starts in the background; until it answers, the side plays as the expert
        hidden = spec.get("ai_hidden")
        hidden = bool(self.settings["ai_hidden_info"]) if hidden is None else bool(hidden)
        phase = self._phase_of(dialogue)
        ai = {"level": level, "style": style, **({"hidden": True} if hidden else {}), **({"phase": phase} if phase else {})}
        return {"trainer_id": spec.get("trainer_id") or "", "name": name, "avatar": avatar, "avatar_url": self.avatar_url(avatar), "human": human,
                "ai": None if human else ai, "sets": sets, "dialogue": dialogue, "format": fmt,
                **({"remote": True} if human and spec.get("remote") else {}), **self._multi_seat(spec, len(sets))}

    def _multi_seat(self, spec: dict[str, Any], count: int) -> dict[str, Any]:
        """A multi battle's side (the Battle Frontier's multi challenges): whose each Pokémon is (`owners`, 0 or 1 per set: slot 1's
        trainer or slot 2's) and the person's AI partner playing slot 2 (`partner`: name, avatar, ai_level, ai_style)."""
        owners = spec.get("owners")
        if not isinstance(owners, list) or len(owners) != count or not owners:
            return {}
        out: dict[str, Any] = {"owners": [1 if o else 0 for o in owners]}
        mate = spec.get("partner")
        if isinstance(mate, dict):
            level, style = self._clean_ai(mate.get("ai_level") or "hard", mate.get("ai_style") or "balanced")
            out["partner"] = {"name": str(mate.get("name") or "")[:40], "avatar": mate.get("avatar") or "",
                              "avatar_url": self.avatar_url(mate.get("avatar") or ""), "ai": {"level": level, "style": style}}
        return out

    @staticmethod
    def _engine_seat(seat: dict[str, Any]) -> dict[str, Any]:
        """A seat as the engine takes it: name, sets, AI, and a multi battle's owners and partner."""
        out = {"name": seat.get("name", ""), "sets": seat.get("sets") or [], "ai": seat.get("ai")}
        if seat.get("owners"):
            out["owners"] = seat["owners"]
            if seat.get("partner"):
                out["partner"] = {"name": seat["partner"].get("name", ""), "ai": seat["partner"].get("ai")}
        return out

    @staticmethod
    def _host_view(b: dict[str, Any]) -> str:
        """What this app's screen sees of a battle: everything, except in a live battle against a friend on another computer
        (pvp.py), where it sees its own side only."""
        if (b.get("p2") or {}).get("remote"):
            return "p1"
        if (b.get("p1") or {}).get("remote"):
            return "p2"
        return "host"

    def _beliefs(self, sets: list[dict[str, Any]], fmt: str) -> dict[str, Any]:
        """What an AI that does not see the other team guesses about each of its species: the most used moves, item, ability, Tera
        type and spread of the format's usage statistics (data.pkmn.cc, when allowed); empty without them (it then guesses alone)."""
        if not self.settings["smogon_data"]:
            return {}
        out: dict[str, Any] = {}
        for s in sets[:24]:
            species = str(s.get("species") or s.get("name") or "").strip()
            if not species or species in out:
                continue
            try:
                found = self.smogon.sets(species, fmt)
            except SilverError:
                continue
            u = found.get("usage") or {}
            first = lambda key: ((u.get(key) or [[""]])[0] or [""])[0]
            moves = [m for m, _ in (u.get("moves") or []) if m and m != "Nothing"]
            if not moves and found.get("sets"):
                moves = list(found["sets"][0].get("moves") or [])
            if moves or first("items") or first("abilities"):
                out[species] = {"moves": moves[:8], "item": first("items") if first("items") != "Nothing" else "", "ability": first("abilities"),
                                "tera": first("teraTypes") if first("teraTypes") != "Nothing" else "", "spread": first("spreads")}
        return out

    def _hide_from(self, s1: dict[str, Any], s2: dict[str, Any], fmt: str) -> None:
        """Give each AI seat that does not see the other team its guesses about that team's species."""
        for me, other in ((s1, s2), (s2, s1)):
            if me.get("ai") and me["ai"].get("hidden"):
                me["ai"]["beliefs"] = self._beliefs(other.get("sets") or [], fmt)

    def _public_seat(self, seat: dict[str, Any]) -> dict[str, Any]:
        out = {k: v for k, v in seat.items() if k != "sets"}
        if isinstance(out.get("ai"), dict) and "beliefs" in out["ai"]:
            out["ai"] = {k: v for k, v in out["ai"].items() if k != "beliefs"}
        out["avatar_poses"] = self.pose_urls(seat.get("avatar") or "")
        return out

    def battle_card(self, b: dict[str, Any]) -> dict[str, Any]:
        return {"id": b["id"], "kind": b["kind"], "status": b["status"], "mode": b.get("mode") or "classic", "format": b["format"], "title": b.get("title") or "",
                "practice": (b.get("replay") or {}).get("practice"),
                "practice_available": b["status"] == "ended" and b.get("mode") != "realtime" and (b.get("turns") or 0) >= 1 and bool((b.get("replay") or {}).get("input")),
                "ai_notes_count": len((b.get("summary") or {}).get("ai_notes") or []),
                "p1": self._public_seat(b.get("p1") or {}), "p2": self._public_seat(b.get("p2") or {}), "winner_side": b.get("winner_side") or "",
                "winner_name": b.get("winner_name") or "", "turns": b.get("turns") or 0, "run_id": b.get("run_id") or "", "job_id": b.get("job_id") or "",
                "created_at": b["created_at"], "updated_at": b["updated_at"]}

    def battle_start(self, *, p1: dict[str, Any], p2: dict[str, Any], format_: str = "", rules: Optional[list[str]] = None,
                     level_rules: Optional[dict[str, Any]] = None, kind: str = "", run_id: str = "", title: str = "", seed: Any = None,
                     mode: str = "classic", time_limit: int = 0, rt_arena: str = "rocks", start: Optional[dict[str, Any]] = None,
                     silver_special: Optional[bool] = None) -> dict[str, Any]:
        if mode == "realtime":
            return self._rt_start(p1=p1, p2=p2, format_=format_, level_rules=level_rules, kind=kind, run_id=run_id, title=title, seed=seed,
                                  time_limit=time_limit, arena=rt_arena, start=start, silver_special=silver_special)
        if mode not in ("classic", ""):
            raise SilverError("invalid", "mode is classic or realtime")
        s1, s2 = self._seat(p1, "Jugador 1"), self._seat(p2, "Jugador 2")
        fmt = format_ or s1["format"] or s2["format"] or self.settings["default_format"]
        rules = rules or []
        level_rules = level_rules or {}
        info = self.format_info(fmt, rules)
        if info.get("random"):
            fmt = f"gen{info['gen']}customgame"
        self._hide_from(s1, s2, fmt)
        spec = {"format": fmt, "rules": rules, "level_rules": level_rules, "max_turns": self.settings["max_turns"], "trace": True,
                "p1": self._engine_seat(s1), "p2": self._engine_seat(s2)}
        if seed:
            spec["seed"] = seed
        if start:   # HP, status, PP, weather... the battle starts with (engine/src/frontier.mjs)
            spec["start"] = start
        watch = not s1["human"] and not s2["human"]
        kind = kind or ("watch" if watch else "play")
        if self.settings.get("pmd_sprites", True) and self.config.background:
            # the faces the screen shows for lines, knockouts and the result, fetched while the battle starts
            self.pool.submit(self.pmd.prefetch_portraits, [str(x.get("species") or "") for x in s1["sets"] + s2["sets"]])
        bid = self.store.add_battle({"kind": kind, "status": "running" if watch else "live", "format": fmt, "rules": rules, "level_rules": level_rules,
                                     "p1": s1, "p2": s2, "run_id": run_id, "title": title, "seed": json.dumps(seed) if seed else "",
                                     **({"replay": {"start": start}} if start else {})})
        spec["id"] = bid
        if watch:
            self._submit_watch(bid, spec)
            return self.battle_get(bid)
        with self._lock_for(bid):
            try:
                state = self.engine.call("match_start", {"spec": spec, "view": "host", "want_snapshot": True}, timeout=120)
            except SilverError:
                self.store.update_battle(bid, {"status": "failed"})
                raise
            self.store.update_battle(bid, {"snapshot": state.pop("snapshot", "") or "", "seed": str(state.get("seed") or "")})
            self._keep_notes(bid, state.pop("notes", None))
            if state.get("ended"):
                self._finish(bid)
        self.emit("battle.started", {"id": bid, "kind": kind})
        return self.battle_get(bid, since=0)

    def _submit_watch(self, bid: str, spec: dict[str, Any]) -> None:
        def work() -> None:
            try:
                r = self.engine.run_job("play_out", {"spec": spec}, cancelled=lambda: bool(self._cancel.get(bid)), timeout=1800)
                with self._lock_for(bid):
                    if self._cancel.get(bid):
                        return
                    self.store.update_battle(bid, {"status": "ended", "log_text": "\n".join(r.get("lines") or []),
                                               "summary": {**(r.get("summary") or {}), "ai_notes": r.get("notes") or [],
                                                           **({"end": r["end"]} if r.get("end") else {})},
                                               "winner_side": (r.get("summary") or {}).get("winner_side", ""),
                                               "winner_name": (r.get("summary") or {}).get("winner", ""), "turns": r.get("turns") or 0,
                                               "seed": str(r.get("seed") or ""), "replay": {**({"start": spec["start"]} if spec.get("start") else {}),
                                                                                            "input": r.get("input_log") or []}})
                    self._after_end(bid)
                self._banter_later(bid, r.get("notes") or [])
            except Exception as exc:  # noqa: BLE001 - the battle row says what happened
                with self._lock_for(bid):
                    if self._cancel.get(bid):
                        return
                    log.exception("watch battle %s", bid)
                    self.store.update_battle(bid, {"status": "failed", "summary": {"error": str(getattr(exc, "message", exc))[:300]}})

        self.pool.submit(work)

    def _ensure_loaded(self, b: dict[str, Any]) -> None:
        if self.engine.call("match_loaded", {"id": b["id"]}).get("loaded"):
            return
        if not b.get("snapshot"):
            raise SilverError("conflict", "This battle cannot be resumed (no saved state).")
        spec = {"id": b["id"], "format": b["format"], "rules": b.get("rules") or [], "level_rules": b.get("level_rules") or {},
                "max_turns": self.settings["max_turns"], "trace": True,
                "p1": self._engine_seat(b["p1"]), "p2": self._engine_seat(b["p2"]), "seed": b.get("seed") or None,
                "practice": bool((b.get("replay") or {}).get("practice"))}
        self.engine.call("match_start", {"spec": spec, "snapshot": json.loads(b["snapshot"]), "view": "host"}, timeout=60)
        self.engine.call("match_state", {"id": b["id"], "since": 10**9})

    def battle_get(self, id_: str, since: int = 0, view: str = "host") -> dict[str, Any]:
        b = self.store.battle(id_)
        out = self.battle_card(b)
        summary = b.get("summary") or {}
        out.update({"rules": b.get("rules") or [], "level_rules": b.get("level_rules") or {},
                    "summary": {k: v for k, v in summary.items() if k != "ai_notes"}, "ai_notes_count": len(summary.get("ai_notes") or [])})
        banter = self.banter_of(id_)
        if banter or id_ in self._banter_busy:
            out["banter"] = banter
            out["banter_pending"] = id_ in self._banter_busy
        if (b.get("mode") or "classic") == "realtime":
            return self._rt_view(b, out, since)
        if view == "host":
            view = self._host_view(b)
        if b["status"] == "live":
            with self._lock_for(id_):
                b = self.store.battle(id_)
                state = None
                if b["status"] == "live":
                    self._ensure_loaded(b)
                    state = self.engine.call("match_state", {"id": id_, "since": since, "view": view})
                    if state.get("ended"):
                        self._finish(id_)
            if state is None or state.get("ended"):
                return self.battle_get(id_, since=since, view=view)
            out.update({k: state[k] for k in ("lines", "log_length", "requests", "turn", "errors")})
            out["format_info"] = state.get("format")
        else:
            lines = b.get("log_text", "").split("\n") if b.get("log_text") else []
            out.update({"lines": lines[since:] if since else lines, "log_length": len(lines), "requests": {}, "turn": b.get("turns") or 0})
            try:
                out["format_info"] = self.format_info(b["format"], b.get("rules"))
            except SilverError:
                pass
        if b.get("run_id"):
            try:
                out["run"] = self.run_view(self.store.run(b["run_id"]), light=True)
            except SilverError:
                pass
        if (b.get("run_id") or "").startswith("cup_"):
            out["cup"] = self.cups.battle_link(b["run_id"])
        return out

    def battle_choose(self, id_: str, side: str, choice: str, since: int = 0, remote: bool = False) -> dict[str, Any]:
        b = self.store.battle(id_)
        if (b.get(side) or {}).get("remote") and not remote:
            raise SilverError("forbidden", "Your friend plays that side from their own computer.")
        if b["status"] != "live":
            raise SilverError("ended", "This battle is over.")
        if b.get("mode") == "realtime":
            raise SilverError("invalid", "A real-time battle is played on its screen (or watched with two AI seats); it has no turns to choose.",
                              hint="Open it in the app, or start it with two AI seats and read it with battle_get.")
        if side not in ("p1", "p2"):
            raise SilverError("invalid", "side is p1 or p2")
        with self._lock_for(id_):
            b = self.store.battle(id_)
            if b["status"] != "live":
                raise SilverError("ended", "This battle is over.")
            self._ensure_loaded(b)
            state = self.engine.call("match_choose", {"id": id_, "side": side, "choice": choice, "since": since,
                                                      "view": side if remote else self._host_view(b)}, timeout=120)
            self.store.update_battle(id_, {"snapshot": state.pop("snapshot", "") or "", "turns": state.get("turn") or 0})
            self._keep_notes(id_, state.pop("notes", None))
            if state.get("ended"):
                self._finish(id_)
        return self._with_state(id_, state)

    def battle_forfeit(self, id_: str, side: str, since: int = 0, remote: bool = False) -> dict[str, Any]:
        b = self.store.battle(id_)
        if (b.get(side) or {}).get("remote") and not remote:
            raise SilverError("forbidden", "Your friend plays that side from their own computer.")
        if b["status"] != "live":
            raise SilverError("ended", "This battle is over.")
        if b.get("mode") == "realtime":
            replay = b.get("replay") or {}
            return self.rt_finish(id_, inputs=replay.get("inputs") or [], tick=int(replay.get("tick") or 0), forfeit=side)
        with self._lock_for(id_):
            b = self.store.battle(id_)
            if b["status"] != "live":
                raise SilverError("ended", "This battle is over.")
            self._ensure_loaded(b)
            state = self.engine.call("match_forfeit", {"id": id_, "side": side, "since": since, "view": side if remote else self._host_view(b)})
            state.pop("snapshot", None)
            self._keep_notes(id_, state.pop("notes", None))
            self._finish(id_)
        return self._with_state(id_, state)

    def battle_cancel(self, id_: str) -> dict[str, Any]:
        """Stop an unfinished battle without awarding a result or changing trainer records."""
        with self._lock_for(id_):
            b = self.store.battle(id_)
            if b["status"] not in ("live", "running"):
                return self.battle_get(id_)
            self._cancel[id_] = True
            if b.get("mode") != "realtime" and b["status"] == "live":
                self.engine.call("match_close", {"id": id_})
            self.store.update_battle(id_, {"status": "cancelled", "winner_side": "", "winner_name": ""})
            self.emit("battle.cancelled", {"id": id_})
        return self.battle_get(id_)

    def _with_state(self, id_: str, state: dict[str, Any]) -> dict[str, Any]:
        """The battle as stored plus the engine's answer (new log lines counted on the live log, so `since` stays consistent)."""
        b = self.store.battle(id_)
        out = self.battle_card(b)
        out.update({"rules": b.get("rules") or [], "level_rules": b.get("level_rules") or {}, "summary": b.get("summary") or {},
                    "lines": state.get("lines") or [], "log_length": state.get("log_length") or 0, "turn": state.get("turn") or 0,
                    "requests": {} if b["status"] != "live" else state.get("requests") or {}, "format_info": state.get("format"),
                    "errors": state.get("errors") or []})
        if b.get("run_id"):
            try:
                out["run"] = self.run_view(self.store.run(b["run_id"]), light=True)
            except SilverError:
                pass
        if (b.get("run_id") or "").startswith("cup_"):
            out["cup"] = self.cups.battle_link(b["run_id"])
        return out

    def _finish(self, id_: str) -> None:
        b = self.store.battle(id_)
        if b["status"] != "live":
            return
        log_ = self.engine.call("match_log", {"id": id_, "view": "omniscient"})
        summary = log_.get("summary") or {}
        summary["ai_notes"] = [*((b.get("summary") or {}).get("ai_notes") or []), *(log_.get("notes") or [])][-self.MAX_NOTES:]
        if log_.get("end"):   # each Pokémon's HP, PP, status and item at the end (the Battle Castle carries them on)
            summary["end"] = log_["end"]
        self.store.update_battle(id_, {"status": "ended", "log_text": "\n".join(log_.get("lines") or []), "summary": summary,
                                       "replay": {**(b.get("replay") or {}), "input": log_.get("input_log") or []},
                                       "winner_side": summary.get("winner_side", ""), "winner_name": summary.get("winner", ""),
                                       "turns": summary.get("turns", 0), "snapshot": ""})
        try:
            self.engine.call("match_close", {"id": id_})
        except SilverError:
            pass
        self._after_end(id_)

    def practice_suggestions(self, id_: str, **options) -> dict[str, Any]:
        from .practice_suggestions import suggest
        return suggest(self, id_, **options)

    def battle_abilities(self, id_: str) -> dict[str, Any]:
        b = self.store.battle(id_)
        if b.get("mode") == "realtime":
            replay = b.get("replay") or {}
            result = self.engine.run_job("battle_abilities", {"spec":self._rt_spec(b),
                "inputs":replay.get("inputs") or [], "tick":replay.get("tick") or 0}, timeout=600)
        else:
            result = self.engine.call("battle_abilities", {"lines":self.battle_get(id_).get("lines") or []})
        return {"battle_id":id_, **result}

    def battle_practice(self, id_: str, *, turn: int, side: str = "p1") -> dict[str, Any]:
        """Open a separate playable branch before this turn's decisions; the source battle stays untouched."""
        source = self.store.battle(id_)
        record = (source.get("replay") or {}).get("input")
        if source["status"] != "ended" or source.get("mode") == "realtime" or not record:
            raise SilverError("invalid", "This replay has no saved turn decisions for practice.",
                              hint="Finish a new turn-based battle, then open its replay.")
        point = self.engine.call("practice_snapshot", {"input": record, "turn": turn, "side": side})
        seats = {s: {**{k: v for k, v in source[s].items() if k != "remote"}, "trainer_id": "", "human": s == side,
                     "ai": None if s == side else {**(source[s].get("ai") or {"level": "normal", "style": "balanced"}), "hidden": True}}
                 for s in ("p1", "p2")}
        practice = {"source_id": id_, "turn": turn, "side": side}
        bid = self.store.add_battle({"kind": "practice", "status": "live", "format": source["format"],
            "rules": source.get("rules") or [], "level_rules": source.get("level_rules") or {},
            "p1": seats["p1"], "p2": seats["p2"], "seed": point["seed"] if isinstance(point["seed"], str) else ",".join(map(str, point["seed"])),
            "snapshot": json.dumps(point["snapshot"]), "turns": turn, "replay": {"practice": practice}})
        # _ensure_loaded uses the saved snapshot; the opponent has no pending future choice from the source.
        return self.battle_get(bid)

    def battle_compare(self, id_: str) -> dict[str, Any]:
        branch = self.store.battle(id_)
        practice = (branch.get("replay") or {}).get("practice")
        if not practice:
            raise SilverError("invalid", "Choose a practice battle to compare with its original.")
        if practice.get("exercise_id"):
            raise SilverError("invalid", "This is an independent exercise. Use exercise_get to see its goal and attempts.")
        source = self.store.battle(practice["source_id"])
        def result(b):
            return {"id": b["id"], "status": b["status"], "turns": b["turns"], "winner_side": b["winner_side"],
                    "winner_name": b["winner_name"], "sides": (b.get("summary") or {}).get("sides") or {}}
        return {"practice": practice, "original": result(source), "branch": result(branch),
                "complete": branch["status"] == "ended"}

    # ------------------------------------------------------------ why the AI chose (notes kept with the battle)
    MAX_NOTES = 800

    def _keep_notes(self, id_: str, notes: Optional[list[dict[str, Any]]]) -> None:
        if not notes:
            return
        b = self.store.battle(id_)
        summary = dict(b.get("summary") or {})
        summary["ai_notes"] = [*(summary.get("ai_notes") or []), *notes][-self.MAX_NOTES:]
        self.store.update_battle(id_, {"summary": summary})
        self._banter_later(id_, notes)

    # ------------------------------------------------------------ the rival talks (the AI comments its moves in character)
    MAX_BANTER = 80

    def _banter_path(self, id_: str) -> Path:
        return self.config.data_dir / "banter" / f"{re.sub(r'[^A-Za-z0-9_-]', '', id_)[:80]}.json"

    def banter_of(self, id_: str) -> list[dict[str, Any]]:
        try:
            return json.loads(self._banter_path(id_).read_text("utf-8"))
        except (OSError, ValueError):
            return []

    def _banter_later(self, id_: str, notes: list[dict[str, Any]]) -> None:
        """With the ai_banter setting on, the family's language model turns the AI's new decisions into lines of its trainer, in the
        background: the turn never waits for it (battle_get hands out the lines as they come)."""
        if not self.settings.get("ai_banter") or not notes:
            return
        with self._banter_guard:
            if id_ in self._banter_busy:
                self._banter_queue.setdefault(id_, []).extend(notes)
                return
            self._banter_busy.add(id_)
        self.pool.submit(self._banter_run, id_, list(notes))

    def _banter_run(self, id_: str, notes: list[dict[str, Any]]) -> None:
        try:
            while notes:
                try:
                    self._banter(id_, notes)
                except Exception as exc:  # noqa: BLE001 - lines are decoration; the battle goes on without them
                    log.info("banter %s: %s", id_, exc)
                with self._banter_guard:
                    notes = self._banter_queue.pop(id_, [])
        finally:
            with self._banter_guard:
                self._banter_busy.discard(id_)

    def _banter(self, id_: str, notes: list[dict[str, Any]]) -> None:
        b = self.store.battle(id_)
        have = self.banter_of(id_)
        if len(have) >= self.MAX_BANTER:
            return
        done = {(x.get("turn"), x.get("side")) for x in have}
        # one line per trainer and turn: its last decision of that turn, a move or a switch (not the forced replacement after a K.O.)
        picks: dict[tuple[Any, Any], dict[str, Any]] = {}
        for n in notes:
            key = (n.get("turn"), n.get("side"))
            if key in done or n.get("side") not in ("p1", "p2") or n.get("kind") in ("switch_in", "team") or not n.get("turn"):
                continue
            picks[key] = n
        if not picks:
            return
        def seat(side: str) -> str:
            s = b.get(side) or {}
            tr = self.store.trainer(s["trainer_id"], deleted=True) if s.get("trainer_id") else {}
            who = s.get("name") or side
            extra = " ".join(x for x in (tr.get("title") or "", (tr.get("dialogue") or {}).get("intro") or "") if x)
            return f"{who}{' — ' + extra if extra else ''}"
        def what(n: dict[str, Any]) -> str:
            slot = (n.get("slots") or [{}])[0]
            picked = slot.get("picked") or {}
            parts = [f"turn {n.get('turn')}", f"trainer {n.get('side')}: {seat(n['side'])}", f"its Pokémon {slot.get('mon') or '?'}"]
            if picked.get("kind") == "switch" or str(n.get("choice", "")).startswith("switch"):
                parts.append(f"switches to {picked.get('species') or picked.get('name') or 'another Pokémon'}")
            else:
                parts.append(f"uses {picked.get('name') or n.get('choice')}" + (f" on {picked['target']}" if picked.get("target") else ""))
                if picked.get("ko"):
                    parts.append("expecting a knockout")
            threat = slot.get("threat") or {}
            if threat.get("move"):
                parts.append(f"fearing {threat.get('foe')}'s {threat.get('move')}")
            return "; ".join(parts)
        items = list(picks.items())[: self.MAX_BANTER - len(have)][:8]
        prompt = ("You write what Pokémon trainers say in a fan battle simulator, in castellano de España, in character, as they make each move. "
                  "For each decision below write one short line (at most 14 words) the trainer says aloud, no emojis, no quotes, never "
                  "mentioning AI or numbers. Return JSON {\"lines\": [{\"i\": index, \"line\": text}]}.\n"
                  + "\n".join(f"{i}. {what(n)}" for i, (_, n) in enumerate(items)))
        res = family.chat([{"role": "user", "content": prompt}],
                          json={"type": "object", "properties": {"lines": {"type": "array", "items": {"type": "object", "properties": {
                              "i": {"type": "integer"}, "line": {"type": "string"}}, "required": ["i", "line"]}}}, "required": ["lines"]},
                          effort="low", max_tokens=700, timeout=120)
        if not res.get("ok"):
            return
        data = res.get("json") if isinstance(res.get("json"), dict) else {}
        if not data:
            try:
                data = json.loads(res.get("text") or "{}")
            except ValueError:
                data = {}
        fresh = []
        for x in data.get("lines") or []:
            try:
                (turn, side), _ = items[int(x.get("i"))]
            except (TypeError, ValueError, IndexError):
                continue
            line = " ".join(str(x.get("line") or "").split()).strip("\"'«» ")[:160]
            if line:
                fresh.append({"turn": turn, "side": side, "line": line})
        if fresh:
            path = self._banter_path(id_)
            path.parent.mkdir(parents=True, exist_ok=True)
            merged = sorted([*self.banter_of(id_), *fresh], key=lambda x: (x.get("turn") or 0, x.get("side") or ""))[: self.MAX_BANTER]
            write_bytes_atomic(path, json.dumps(merged, ensure_ascii=False).encode("utf-8"), fsync=False)

    def battle_explain(self, id_: str, *, side: str = "", turn: int = 0, from_turn: int = 0, advice: bool = True, limit: int = 6) -> dict[str, Any]:
        """Why the AI seats chose what they chose: one note per decision (the options it weighed with expected damage and KOs, the threat
        on its Pokémon, who was faster and, for the expert, each candidate turn played out), for one turn, from a turn on, or the last
        ones; in a live battle also what the expert would do now on a person's side (advice), without choosing for it."""
        b = self.store.battle(id_)
        if (b.get("mode") or "classic") == "realtime":
            raise SilverError("invalid", "A real-time battle has no turns to explain.")
        if side and side not in ("p1", "p2"):
            raise SilverError("invalid", "side is p1 or p2")
        notes = list((b.get("summary") or {}).get("ai_notes") or [])
        if side:
            notes = [n for n in notes if n.get("side") == side]
        if turn:
            picked = [n for n in notes if n.get("turn") == turn]
        elif from_turn:
            picked = [n for n in notes if (n.get("turn") or 0) >= from_turn]
        else:
            picked = notes[-max(1, min(int(limit or 6), self.MAX_NOTES)):]
        out: dict[str, Any] = {"battle_id": id_, "status": b["status"], "turns": b.get("turns") or 0, "total": len(notes), "notes": picked,
                               "text": [self._note_text(n, b) for n in picked]}
        if advice and b["status"] == "live":
            sides = [side] if side else [s for s in ("p1", "p2") if (b.get(s) or {}).get("human")]
            found = {}
            with self._lock_for(id_):
                b = self.store.battle(id_)
                out["status"] = b["status"]
                if b["status"] == "live":
                    self._ensure_loaded(b)
                    for s in sides:
                        other = b.get("p2" if s == "p1" else "p1") or {}
                        r = self.engine.call("match_advice", {"id": id_, "side": s, "hidden": True,
                                                              "beliefs": self._beliefs(other.get("sets") or [], b["format"])}, timeout=90)
                        if r.get("advice"):
                            found[s] = {**r["advice"], "text": self._note_text(r["advice"], b, advice=True)}
            out["advice"] = found
        if not notes and not out.get("advice"):
            out["hint"] = "No AI decisions are kept for this battle (battles from before this was added, series and tournaments keep none)."
        return out

    @staticmethod
    def _option_text(o: dict[str, Any]) -> str:
        def pct(x: Any) -> str:
            return f"{round((x or 0) * 100)}%"
        if o.get("kind") == "switch":
            text = f"switch to {o.get('species')}"
            if o.get("take") is not None:
                text += f" (takes ~{pct(o.get('take'))}, deals ~{pct(o.get('give'))})"
            return text
        text = str(o.get("name") or o.get("choice") or "?") + (f" with {o['gimmick']}" if o.get("gimmick") else "")
        if o.get("dmg") is not None:
            text += f" ~{pct(o.get('dmg'))}" + (" KO" if o.get("ko") else "")
        return text

    def _note_text(self, n: dict[str, Any], b: dict[str, Any], *, advice: bool = False) -> str:
        """One decision in plain English (names as the simulator writes them), for the copilot and the tools."""
        def pct(x: Any) -> str:
            return f"{round((x or 0) * 100)}%"
        who = (b.get(n.get("side") or "") or {}).get("name") or n.get("side") or "?"
        head = f"Turn {n.get('turn')}, {who}" + (" (advice from the expert AI)" if advice else f" ({n.get('level')} AI, {n.get('style')})")
        if n.get("hidden") and not advice:
            head += " [not seeing the other team]"
        if n.get("kind") == "preview":
            return f"{head}: team order {n.get('choice')}."
        parts = []
        for s in n.get("slots") or []:
            p = s.get("picked") or {}
            if n.get("kind") == "switch_in":
                parts.append(f"sends in {s.get('mon')}.")
                continue
            line = f"{s.get('mon')} ({pct(s.get('hp'))} HP) {'should go for' if advice else 'chose'} {self._option_text(p)}"
            if p.get("target") and p.get("kind") != "switch":
                line += f" on {p['target']}"
            if p.get("acc") is not None and p["acc"] < 1:
                line += f" ({pct(p['acc'])} accuracy)"
            th = s.get("threat") or {}
            if th.get("frac"):
                line += f". Threat: {th.get('foe')}'s {th.get('move')} ~{pct(th['frac'])}" + (", a KO" if th.get("ko") else "")
            if s.get("faster"):
                line += f"; {', '.join(s['faster'])} {'is' if len(s['faster']) == 1 else 'are'} faster"
            alts = [o for o in s.get("options") or [] if o.get("choice") != p.get("choice")][:3]
            if alts:
                line += ". Also weighed: " + ", ".join(self._option_text(o) for o in alts)
            parts.append(line + ".")
        se = n.get("search") or {}
        if se.get("options"):
            parts.append(f"Searched {se.get('iterations') or 0} possible futures (Monte Carlo tree search): "
                         + "; ".join(f"{x.get('label') or x.get('choice')} {pct(x.get('share'))} of the search, wins {pct(x.get('win'))}"
                                     for x in se["options"][:3]) + ".")
        elif n.get("fallback") and n.get("level") == "master":
            parts.append("The search was not available, so it played as the expert.")
        elif n.get("fallback") and n.get("level") == "neural":
            parts.append("The neural network does not play this battle or was not running, so it played as the expert.")
        if n.get("neural"):
            parts.append(f"The neural network chose it in {int(n['neural'].get('ms') or 0)} ms; the ranking above is the expert's view.")
        po = n.get("playouts") or []
        if len(po) > 1:
            parts.append("Turns played out (higher is better, worst case in brackets): "
                         + "; ".join(f"{x.get('label')} {float(x.get('mean') or 0):+.2f} ({float(x.get('worst') or 0):+.2f})" for x in po[:3]) + ".")
        return f"{head}: " + " ".join(parts)

    def _after_end(self, id_: str) -> None:
        b = self.store.battle(id_)
        w = b.get("winner_side") or ""
        for side in ("p1", "p2"):
            tid = (b.get(side) or {}).get("trainer_id")
            if tid and b["kind"] not in ("series", "tournament"):
                self.store.record_result(tid, "tie" if not w else "win" if w == side else "loss")
        self.emit("battle.ended", {"id": id_, "winner": b.get("winner_name"), "kind": b["kind"]})
        if (b.get("run_id") or "").startswith("cup_"):
            self.cups.on_battle_end(b["run_id"], b)
        elif b.get("run_id"):
            self._advance_run(b["run_id"], b)

    # ------------------------------------------------------------ real-time battles (Legends: Z-A rules)
    def _rt_spec(self, b: dict[str, Any]) -> dict[str, Any]:
        """The spec that rebuilds a real-time battle: the screen runs it, the engine replays it."""
        replay = b.get("replay") or {}
        seat = self._engine_seat
        return {"id": b["id"], "seed": b.get("seed") or b["id"], "format": b["format"], "level_rules": b.get("level_rules") or {},
                "time_limit": int(replay.get("time_limit") or self.settings.get("rt_time_limit") or 300), "p1": seat(b.get("p1") or {}),
                "p2": seat(b.get("p2") or {}), "version": int(replay.get("version") or 1),
                "arena": replay.get("arena") if replay.get("arena") in RT_ARENAS or isinstance(replay.get("arena"), dict) else "open",
                **({"silver_special": replay["silver_special"]} if "silver_special" in replay else {}),
                **({"training": replay["training"]} if replay.get("training") else {}),
                **({"start": replay["start"]} if replay.get("start") else {})}

    TRAINING_PATTERNS = ("still", "walk", "dodge", "fight")
    TRAINING_DUMMY = ("Sudowoodo @ Leftovers\nAbility: Sturdy\nLevel: 100\nEVs: 252 HP / 252 Def / 4 SpD\nImpish Nature\n"
                      "- Rock Slide\n- Wood Hammer\n- Sucker Punch\n- Earthquake\n")

    def training_start(self, *, trainer_id: str, pattern: str = "still", dummy_id: str = "", format_: str = "", arena: str = "open",
                       time_limit: int = 300, level_rules: Optional[dict[str, Any]] = None) -> dict[str, Any]:
        """Real-time training: your trainer against a dummy that never faints (a knockout heals it back), standing still, walking in
        circles, rolling away from attacks or fighting back like the easy AI. The dummy is a Sudowoodo or the team of `dummy_id`.
        Nothing is counted: no record, no progress, no medals."""
        if pattern not in self.TRAINING_PATTERNS:
            raise SilverError("invalid", f"pattern is one of {', '.join(self.TRAINING_PATTERNS)}")
        foe = {"trainer_id": dummy_id} if dummy_id else {"paste": self.TRAINING_DUMMY, "name": "Muñeco de entrenamiento"}
        return self._rt_start(p1={"trainer_id": trainer_id, "human": True}, p2=foe, format_=format_, level_rules=level_rules,
                              kind="training", title="Entrenamiento", time_limit=time_limit, arena=arena, training={"pattern": pattern})

    def _rt_start(self, *, p1: dict[str, Any], p2: dict[str, Any], format_: str = "", level_rules: Optional[dict[str, Any]] = None,
                  kind: str = "", run_id: str = "", title: str = "", seed: Any = None, time_limit: int = 0, arena: str = "rocks",
                  training: Optional[dict[str, Any]] = None, start: Optional[dict[str, Any]] = None,
                  silver_special: Optional[bool] = None) -> dict[str, Any]:
        arena = self.arenas.spec(_rt_arena(arena))
        s1, s2 = self._seat(p1, "Jugador 1"), self._seat(p2, "Jugador 2")
        if training:
            # a training battle counts for nobody: the seats keep the names and teams but no trainer ids
            s1["trainer_id"] = s2["trainer_id"] = ""
            s2["human"] = False
            s2["ai"] = {"level": "dummy", "style": "balanced", "pattern": training["pattern"]}
        fmt = self._rt_format(format_ or s1["format"] or s2["format"] or self.settings["default_format"])
        if training and self.format_info(fmt, []).get("game_type") == "doubles":
            raise SilverError("invalid", "Training is for singles.", hint="Pick a singles format.")
        level_rules = level_rules or {}
        limit = max(30, min(int(time_limit or self.settings.get("rt_time_limit") or 300), 1800))
        watch = not s1["human"] and not s2["human"]
        kind = kind or ("watch" if watch else "play")
        seed_text = str(seed) if seed else ""
        bid = self.store.add_battle({"kind": kind, "mode": "realtime", "status": "running" if watch else "live", "format": fmt, "rules": [],
                                     "level_rules": level_rules, "p1": s1, "p2": s2, "run_id": run_id, "title": title, "seed": seed_text,
                                     "replay": {"time_limit": limit, "inputs": [], "tick": 0, "version": RT_RULES_VERSION, "arena": arena,
                                                "silver_special": bool(self.settings.get("rt_silver_special", False)) if silver_special is None else silver_special,
                                                **({"training": training} if training else {}), **({"start": start} if start else {})}})
        if not seed_text:
            self.store.update_battle(bid, {"seed": bid})
        spec = self._rt_spec(self.store.battle(bid))
        try:
            check = self.engine.call("rt_check", {"spec": spec}, timeout=60)
        except SilverError:
            self.store.update_battle(bid, {"status": "failed"})
            raise
        if self.settings.get("pmd_sprites", True) and self.config.background:
            mons = [m for side in (check.get("view") or {}).get("sides", []) for m in side.get("mons", [])]
            megas = [{**m["mega_info"], "shiny": m.get("shiny")} for m in mons if m.get("mega_info")]
            self.pool.submit(self.pmd.prefetch, mons + megas)
            self.pool.submit(self.pmd.prefetch_portraits, [m.get("species") for m in mons] + [m.get("species") for m in megas])
        if watch:
            def work() -> None:
                try:
                    r = self.engine.run_job("rt_play_out", {"spec": spec}, cancelled=lambda: bool(self._cancel.get(bid)), timeout=1800)
                    with self._lock_for(bid):
                        self._rt_store_result(bid, r)
                except Exception as exc:  # noqa: BLE001 - the battle row says what happened
                    with self._lock_for(bid):
                        if self._cancel.get(bid):
                            return
                        log.exception("real-time battle %s", bid)
                        self.store.update_battle(bid, {"status": "failed", "summary": {"error": str(getattr(exc, "message", exc))[:300]}})

            self.pool.submit(work)
        self.emit("battle.started", {"id": bid, "kind": kind, "mode": "realtime"})
        return self.battle_get(bid)

    def _rt_store_result(self, bid: str, r: dict[str, Any]) -> None:
        if self._cancel.get(bid):
            return
        b = self.store.battle(bid)
        summary = r.get("summary") or {}
        replay = {**(b.get("replay") or {}), "inputs": r.get("inputs") or [], "tick": int(round((r.get("seconds") or 0) * 30))}
        self.store.update_battle(bid, {"status": "ended", "log_text": "\n".join(r.get("lines") or []), "summary": summary, "replay": replay,
                                       "winner_side": summary.get("winner_side", ""), "winner_name": summary.get("winner", ""), "turns": 0})
        self._after_end(bid)

    def _rt_view(self, b: dict[str, Any], out: dict[str, Any], since: int = 0) -> dict[str, Any]:
        lines = b.get("log_text", "").split("\n") if b.get("log_text") else []
        replay = b.get("replay") or {}
        out.update({"lines": lines[since:] if since else lines, "log_length": len(lines), "requests": {}, "turn": 0,
                    "rt": {"spec": self._rt_spec(b), "inputs": replay.get("inputs") or [], "tick": replay.get("tick") or 0,
                           "time_limit": self._rt_spec(b)["time_limit"], "arena": self._rt_spec(b)["arena"], "version": self._rt_spec(b)["version"],
                           "human": [bool((b.get(s) or {}).get("human")) for s in ("p1", "p2")]}})
        try:
            out["format_info"] = self.format_info(b["format"], [])
        except SilverError:
            pass
        if b.get("run_id"):
            try:
                out["run"] = self.run_view(self.store.run(b["run_id"]), light=True)
            except SilverError:
                pass
        if (b.get("run_id") or "").startswith("cup_"):
            out["cup"] = self.cups.battle_link(b["run_id"])
        return out

    def rt_save(self, id_: str, *, inputs: list[list[Any]], tick: int) -> dict[str, Any]:
        """The screen keeps the inputs of a live real-time battle here as it goes, so a reload picks the battle up where it was."""
        b = self.store.battle(id_)
        if b.get("mode") != "realtime" or b["status"] != "live":
            raise SilverError("conflict", "Not a live real-time battle.")
        self.store.update_battle(id_, {"replay": {**(b.get("replay") or {}), "inputs": inputs, "tick": int(tick)}})
        return {"saved": True, "tick": int(tick)}

    def rt_finish(self, id_: str, *, inputs: list[list[Any]], tick: int = 0, forfeit: str = "") -> dict[str, Any]:
        """The screen says a real-time battle ended. The engine replays it from its seed and the inputs and the result it gets is
        the one stored (a forfeit stops the replay at `tick`)."""
        b = self.store.battle(id_)
        if b.get("mode") != "realtime":
            raise SilverError("invalid", "Not a real-time battle.")
        if b["status"] != "live":
            return self.battle_get(id_)
        if forfeit and forfeit not in ("p1", "p2"):
            raise SilverError("invalid", "forfeit is p1 or p2")
        spec = self._rt_spec(b)
        with self._lock_for(id_):
            if self.store.battle(id_)["status"] != "live":
                return self.battle_get(id_)
            r = self.engine.run_job("rt_replay", {"spec": spec, "inputs": inputs, "forfeit": forfeit, "tick": int(tick)}, timeout=600)
            if not r.get("ended"):
                raise SilverError("conflict", "The inputs do not finish this battle.", hint="Send the whole input log, or forfeit.")
            self._rt_store_result(id_, r)
        return self.battle_get(id_)

    def rt_cooldowns(self, *, trainer_id: str = "", team: Any = None, paste: str = "", format_: str = "", level_rules: Optional[dict[str, Any]] = None) -> dict[str, Any]:
        """How a team's moves work in real time: base cooldown (Legends: Z-A's or derived from PP), the cooldown each Pokémon really
        waits with its Speed, wind-up and shape."""
        if trainer_id:
            t = self.store.trainer(trainer_id)
            sets, fmt = t["team"], format_ or t["format"]
        else:
            sets, fmt = self._team_from(team, paste), format_ or self.settings["default_format"]
        return self.engine.call("rt_team", {"sets": sets, "format": fmt, "level_rules": level_rules or {}})

    @staticmethod
    def rt_rules() -> dict[str, Any]:
        return {
            "source": "Pokémon Legends: Z-A (Bulbapedia: Pokémon battle (Legends: Z-A), Cooldown; Serebii: usable attacks).",
            "rules": [
                "One Pokémon per trainer on a 28 x 17 m arena seen from above in singles formats, two in doubles formats; the screen runs at 30 ticks per second.",
                "No PP and no turns: every move has a base cooldown of 3-60 s. Moves Legends: Z-A has keep its value (337 moves); the rest get one from PP, power and kind fitted to that table (mean error 1.3 s).",
                "Speed shortens cooldowns: final = max(3, base - 3 * max(0, Speed * modifier - 25) / 100). Priority moves always take 3 s. Choice Scarf, Tailwind and weather abilities count as Speed modifiers; stat stages do not.",
                "Every move has a wind-up (none for priority moves, long for charging moves) during which the user stands still; a flinch cancels it and the move goes on cooldown.",
                "Rules version 8: each Pokemon recovers for one second after finishing a move before starting another, including its ultimate. Individual move cooldowns still apply; doubles partners recover independently, and movement and dodging remain available. Saved versions 1-7 retain their timing.",
                "Shapes: strikes in front, dashes, projectiles, beams, cones, bursts around the user and blasts that land where the target stood. There is no accuracy or evasion: a move hits if it reaches. Rolling (short invulnerable dash) dodges.",
                "Damage, types, STAB, critical hits, abilities and items use the turn-based formula of the format's generation. Multi-hit moves hit a fixed number of times, as in Z-A.",
                "Stat changes are one stage at most (x1.5 or x2/3) and last 20 s. The Speed stage changes walking speed.",
                "Burn, poison and paralysis last until cured (paralysis halves walking speed); sleep is drowsiness for 10 s (cooldowns at half speed); freeze holds the Pokémon for 3 s; confusion makes walking erratic for 6 s. Residual damage and healing happen every 4 s.",
                "Three switches per trainer, refilled after every knockout; pivot moves and fainting do not spend them.",
                "Time limit (300 s by default): more Pokémon standing wins, then more HP left in total.",
                "Lock-on: holding focus (Shift / ZL) keeps the Pokémon facing the foe, so walking strafes and moves aim at the foe (and a move out of range walks up to it first). Without focus the Pokémon faces where it walks; moves go along that facing, snapping to the foe only within 30 degrees of it, so projectiles, beams and cones can miss and strikes and dashes lunge forward and only land if they reach. The AI always locks on; the simple control layout always sends focus.",
                "Arena (rt_arena): open, or rocks (the default for new battles): 3 to 6 round rocks placed from the battle's seed, mirrored left to right, away from the spawn points and the centre line. They block walking, rolls and dashes, and stop projectiles and beams (and cones behind them); blasts that fall from the sky and quakes ignore them. The AI walks around them and avoids firing into them.",
                "Mega Power gauge: three segments per trainer, filling one every 8 s and faster when dealing damage (a whole HP bar dealt = 0.8 of a segment); battles stored with rules version 2 fill one every 15 s (0.4 for a whole HP bar).",
                "Silver special (introduced in rules version 5): an optional extra 150-power attack, separate from the four moves. Rules version 11 disables it by default; enable rt_silver_special in Settings for new battles and exports. Each battle saves the choice; rules versions 5-10 keep it enabled. When enabled, its gauge fills from damage dealt (a whole HP bar = half the gauge), taken (0.3) and knockouts (a quarter). Full, F (ZL + + on a gamepad) unleashes an attack of the Pokémon's first type, using its better attacking stat, falling on the foe 0.9 s later in a 2.6 m circle. It can be dodged; it uses no move slot or cooldown and empties the gauge. Mega Evolution is independent of this option.",
                "No Plus moves (rules version 4): the gauge is only for Mega Evolution. Battles stored with rules versions 2 and 3 keep theirs (a full segment armed a Plus move: x1.2 damage, x1.3 if super effective, more side effects and healing, larger areas, a quarter of the damage through protection; every move of a Mega Evolved Pokémon was one).",
                "Mega Evolution: with a full gauge, a Pokémon holding its Mega Stone (or Rayquaza with Dragon Ascent) can Mega Evolve once per battle, from generation 6 formats on: the Mega forme's stats, types and ability, HP kept in proportion; it stays Mega while the gauge drains a segment every 8 s; when it empties (or the Pokémon leaves or faints) it goes back to its usual forme.",
                "Doubles (doubles formats, rules version 3): each trainer has two Pokémon on the field at once, slot a above the centre line and slot b below it. A person moves one of them (the controlled one: moves 1-4 and roll are its own) and swaps which with Tab / C (gamepad L, or the left stick click in the simple layout); the partner is driven by the AI: it stays within reach, dodges, keeps 4 m from its partner, and attacks the person's locked foe unless the other foe is clearly better. X (the right stick click) switches the foe it locks on, shown with a reticle. The AI trainers play both of their Pokémon the same way and pick targets by the damage they can deal and by who threatens them.",
                "Doubles: spread moves (target allAdjacent or allAdjacentFoes, such as Earthquake, Surf, Discharge, Rock Slide, Heat Wave, Hyper Voice) hit every Pokémon in their area: the foes, and the partner too for those that hit everything around the user (Earthquake, Surf, Discharge, Explosion). With more than one Pokémon hit, each takes x0.75 damage. Single-target moves hit the first foe they reach (the locked one first). Pokémon do not walk through each other.",
                "Doubles support moves: Helping Hand (the partner's next damaging move within 5 s has x1.5 power; 10 s cooldown); Follow Me and Rage Powder (for 3 s the foes' single-target moves turn to the user and projectiles in flight bend to it; Rage Powder does not draw Grass types, Overcoat or Safety Goggles; 12 s cooldown). In singles they still have no effect.",
                "Doubles switching: three switches per trainer (shared by both slots), back after every knockout; a fainted Pokémon's slot is refilled from the bench (a person picks from the party bar, or the first one comes out after 6 s; the AI picks at once); with nobody left on the bench the slot stays empty and the trainer plays on with one. A trainer loses when no Pokémon can come out. The Mega Power gauge is the trainer's: one Mega Evolution per battle, Plus moves for the controlled Pokémon.",
                "Battles stored before lock-on, rocks and Mega Evolution existed keep their rules (always locked on, open arena, no gauge), and battles stored before doubles (rules version 2) play doubles formats as singles, so their replays give the same result.",
                "Rules version 10: walking is 35% slower, AI sidesteps retain their partial speed, rolls move at 8 m/s with 2 s recovery, and AI dodging waits for its difficulty's reaction delay with one chance per continuous danger. Older saved battles retain their original movement and dodging rules.",
                "Rules version 9 (the HeartGold/SoulSilver Battle Frontier): a battle can start with HP, statuses, PP, a weather, Trick Room or fog. Trick Room lasts 6 s per turn of the games (the Arcade's 5 turns: 30 s) and turns Speed around: walking goes as base Speed 200 minus the Pokémon's, and cooldowns take the Speed mirrored around a base-80 Pokémon of its level. Fog makes each hit of a move with an accuracy land 3 times in 5, until another weather replaces it (Cloud Nine and Air Lock suppress it). Starting PP (the Castle) count down one per use; a move with none left cannot be used, and the PP left go back to the streak.",
                "Multi battles (rules version 9, the Frontier's multi challenges): each side is two trainers, one Pokémon each on the field (slot a and slot b); a slot only sends out its own trainer's Pokémon and stays empty when they are gone. A person with an AI partner always moves slot a; the partner drives slot b and sends out its own next Pokémon.",
            ],
            "not_covered": ["triples (played as singles)", "Z-Moves, Dynamax and Terastallization", "Alpha Pokémon of Z-A",
                            "Trick Room as a move, Transform, Baton Pass-style copying and other moves listed as no_effect in rt_cooldowns (the Arcade's Trick Room panel works from rules version 9)",
                            "in doubles: Wide Guard, Quick Guard, Ally Switch, After You, Instruct, Spotlight and other ally-targeting moves have no effect; healing moves for allies (Life Dew, Jungle Healing...) heal the user only"],
            "controls": {"move": "WASD or arrows; gamepad left stick", "focus": "hold Shift; gamepad hold ZL",
                         "moves": "I L K J in a diamond (or 1-4); gamepad ZL + X A B Y (simple layout: A B X Y)",
                         "roll": "Space; gamepad Y without ZL (simple layout: RB)",
                         "mega": "M; gamepad R (simple layout: L)", "switch": "Q / E pick, R sends out; gamepad D-pad left/right + up",
                         "doubles_swap": "Tab or C swaps the Pokémon you control; gamepad L (simple layout: left stick click)",
                         "doubles_target": "X switches the locked foe; gamepad right stick click",
                         "pause": "Esc; gamepad plus without ZL (only against the AI)",
                         "two_people": "player 1: WASD, 1-4, Space, left Shift, G, Q / E / R, C / X in doubles; player 2: arrows, U I O P, Enter, right Shift, L, [ ] \\, ; / ' in doubles"},
        }

    def battles_list(self, kind: str = "", status: str = "", trainer_id: str = "", limit: int = 50, offset: int = 0) -> list[dict[str, Any]]:
        return [self.battle_card(b) for b in self.store.battles(kind=kind, status=status, trainer_id=trainer_id, limit=limit, offset=offset)]

    def battles_delete(self, ids: list[str]) -> dict[str, Any]:
        return {"deleted": self.store.delete_battles(ids)}

    # ------------------------------------------------------------ gym and league challenges
    def run_view(self, r: dict[str, Any], *, light: bool = False) -> dict[str, Any]:
        out = {k: v for k, v in r.items() if k != "challenger"}
        out["challenger_name"] = (r.get("challenger") or {}).get("name", "")
        out["map"] = bool((r.get("challenger") or {}).get("map"))
        if r.get("kind") == "gym":   # the backdrop the gym's turn-based battles show
            with contextlib.suppress(SilverError):
                gym = self.store.gym(r["target_id"], deleted=True)
                out["backdrop"] = gym.get("backdrop") or ""
                out["type"] = gym.get("type") or ""   # the music of its battles can follow it
        if out.get("mode") == "realtime":
            out["rt_arena"] = (r.get("challenger") or {}).get("rt_arena") or "rocks"
        out["challenger_avatar_url"] = self.avatar_url((r.get("challenger") or {}).get("avatar", ""))
        stages = []
        for st in r.get("stages") or []:
            try:
                t = self.store.trainer(st["trainer_id"], deleted=True)
                stages.append({**st, "name": t["name"], "title": t["title"], "avatar_url": self.avatar_url(t["avatar"])})
            except SilverError:
                stages.append({**st, "name": st.get("name", "?"), "avatar_url": self.avatar_url(st.get("avatar", ""))})
        out["stages"] = stages
        if r["kind"] == "facility":
            out["streak"] = sum(1 for st in stages if st.get("result") == "won")
            f = facilities.get(r["target_id"]) or {}
            nxt = r["step"] + 1
            out["round"] = (nxt - 1) // facilities.ROUND + 1
            out["round_battle"] = (nxt - 1) % facilities.ROUND + 1
            out["next_boss"] = next(({"at": b[0], "key": b[1], "label_es": b[3], "label": b[4]} for b in f.get("bosses", []) if b[0] >= nxt), None)
            if frontier.kind_of(r["target_id"]):
                fv = frontier_runs.view(self, r)
                out["frontier"] = fv
                out["round"], out["round_battle"] = fv["round"], fv["round_battle"]
                stages = [frontier_runs.public_stage(st) for st in stages]   # the rival stays hidden until its battle
                out["stages"] = stages
            if f.get("rental"):
                ch = r.get("challenger") or {}
                out["factory"] = {"phase": ch.get("phase", ""), "size": f.get("size", 3), "rentals": ch.get("rentals") or [],
                                  "team": ch.get("team") or [], "offer": ch.get("offer") or []}
            if light and len(stages) > 12:
                out["stages"] = stages[-12:]
                out["stages_offset"] = len(stages) - 12
        out["current"] = stages[r["step"]] if r["status"] == "active" and r["step"] < len(stages) else None
        return out

    def run_start(self, *, kind: str, target_id: str, challenger_id: str, auto: bool = False, ignore_badges: bool = False,
                  format_override: str = "", mode: str = "classic", level: int = 0, rt_arena: str = "rocks", stop_at: int = 0,
                  walk_map: bool = True, picks: Optional[list[int]] = None, partner: str = "") -> dict[str, Any]:
        walk = False
        if mode not in ("classic", "realtime"):
            raise SilverError("invalid", "mode is classic or realtime")
        rt_arena = _rt_arena(rt_arena)
        if level not in (0, 50, 100) and not 1 <= int(level) <= 100:
            raise SilverError("invalid", "level is 0 (as they are) or 1-100 (usually 50 or 100)")
        challenger = self.store.trainer(challenger_id)
        if format_override:
            self.format_info(format_override)
        if kind == "gym":
            g = self.store.gym(target_id)
            stage_ids = [*(g.get("trainers") or []), g["leader_id"]]
            target_name = g["name"]
            if g.get("rt_arena"):   # the gym fights on its own arena
                rt_arena = _rt_arena(g["rt_arena"])
            walk = bool((g.get("map") or {}).get("w")) and not auto and walk_map
        elif kind == "facility":
            f = facilities.get(target_id)
            if not f:
                raise SilverError("not_found", f"No facility {target_id}", hint="facilities_list shows them.")
            if not f.get("rental") and not frontier.kind_of(target_id) and len(challenger["team"]) < f["size"]:
                raise SilverError("invalid", f"{challenger['name']} needs {f['size']} Pokémon for {f['name']}.")
            open_run = next((x for x in self.store.runs(status="active", kind="facility", challenger_id=challenger_id, limit=200)
                             if x["target_id"] == target_id), None)
            if open_run:
                raise SilverError("conflict", f"{challenger['name']} already has a streak going at {f['name']}.",
                                  hint="challenge_next continues it; challenge_abandon ends it.", run_id=open_run["id"])
            if frontier.kind_of(target_id):   # the HeartGold/SoulSilver Hall, Arcade and Castle (frontier_runs.py)
                rid = frontier_runs.start(self, f=f, challenger=challenger, challenger_id=challenger_id, auto=auto, mode=mode, level=level,
                                          picks=picks, format_override=format_override, stop_at=stop_at, rt_arena=rt_arena, partner=partner)
                return self.run_view(self.store.run(rid))
            rid = self.store.add_run({"kind": "facility", "target_id": target_id, "target_name": f["name_es"], "challenger_id": challenger_id,
                                      "challenger": {"name": challenger["name"], "avatar": challenger["avatar"], "team": challenger["team"],
                                                     "auto": auto, "format_override": format_override, "level": int(level or 50),
                                                     "stop_at": int(stop_at or 0), "rt_arena": rt_arena},
                                      "stages": [], "step": 0, "status": "active", "mode": mode})
            self.emit("run.started", {"id": rid, "kind": "facility", "target": f["name_es"]})
            if f.get("rental"):
                self._factory_round(rid)
            else:
                self._run_battle(rid)
            return self.run_view(self.store.run(rid))
        elif kind == "league":
            lg = self.store.league(target_id)
            have = {b["gym_id"] for b in self.store.badges(challenger_trainer_id=challenger_id)}
            missing = [gid for gid in lg.get("gyms") or [] if gid not in have]
            if not ignore_badges and len(lg.get("gyms") or []) - len(missing) < (lg.get("badges_required") or 0):
                names = ", ".join(g["name"] for g in self.store.gyms(ids=missing)[:8])
                raise SilverError("conflict", f"{challenger['name']} needs {lg['badges_required']} badges of this league.",
                                  hint=f"Missing: {names}. Or pass ignore_badges=true.", missing=missing)
            stage_ids = [*(lg.get("elite_four") or []), lg["champion_id"]]
            target_name = lg["name"]
        else:
            raise SilverError("invalid", "kind is gym, league or facility")
        stage_ids = [s for s in stage_ids if s]
        if not stage_ids:
            raise SilverError("invalid", "There is nobody to fight here.")
        rid = self.store.add_run({"kind": kind, "target_id": target_id, "target_name": target_name, "challenger_id": challenger_id,
                                  "challenger": {"name": challenger["name"], "avatar": challenger["avatar"], "team": challenger["team"], "auto": auto,
                                                 "format_override": format_override, "level": int(level or 0), "rt_arena": rt_arena,
                                                 **({"map": True} if walk else {})},
                                  "stages": [{"trainer_id": s, "battle_id": "", "result": ""} for s in stage_ids], "step": 0, "status": "active",
                                  "mode": mode})
        self.emit("run.started", {"id": rid, "kind": kind, "target": target_name})
        if not walk:   # on a map the first battle starts when somebody sees you
            self._run_battle(rid)
        return self.run_view(self.store.run(rid))

    def _facility_rules(self, r: dict[str, Any]) -> tuple[str, list[str], dict[str, Any]]:
        f = facilities.get(r["target_id"]) or {}
        ch = r.get("challenger") or {}
        if f.get("rental"):   # rental teams of three against teams of three, in the sets' own generation
            return f"gen{f['gen']}customgame", [], {"level": int(ch.get("level") or 50)}
        fmt = ch.get("format_override") or ""
        if not fmt:
            try:
                fmt = self.store.trainer(r["challenger_id"], deleted=True)["format"] or self.settings["default_format"]
            except SilverError:
                fmt = self.settings["default_format"]
        info = self.format_info(fmt)
        if f.get("gametype") == "doubles" and info.get("game_type", "singles") != "doubles":
            fmt = f"gen{info.get('gen') or 9}doublescustomgame"
            info = self.format_info(fmt)
        elif info.get("random"):
            fmt = f"gen{info.get('gen') or 9}customgame"
            info = self.format_info(fmt)
        picked = f"Picked Team Size = {f.get('size', 3)}"
        rules = [picked] if info.get("team_preview") else ["Team Preview", picked]
        level = int(ch.get("level") or 50)
        return fmt, rules, {"level": level}

    def _facility_stage(self, r: dict[str, Any]) -> dict[str, Any]:
        """The next rival of a streak: the facility's boss on its battle, now and then one of its special trainers, else a trainer of
        the era with random sets of that generation. Seeded by the run and the battle number, so a streak replays the same rivals."""
        f = facilities.get(r["target_id"])
        if not f:
            raise SilverError("not_found", f"No facility {r['target_id']}")
        number = r["step"] + 1
        rng = facilities.rng(f"{r['id']}:{number}")
        boss = facilities.boss_at(f, number)
        special = None
        if not boss and f.get("specials") and number > facilities.ROUND and rng.random() < 0.2:
            special = rng.choice(f["specials"])
        if boss and (made := frontier_runs.brain_stage(boss, number, r["id"])):   # Thorton: sets from the decompiled game
            return made
        if boss or special:
            key, vid = (boss[1], boss[2]) if boss else special
            try:
                c = self._character(key)
                v = next(x for x in c["variants"] if x["id"] == vid)
                sets = facilities.pick_sets(v["sets"], f["size"], rng)
                title = (v.get("trainer_class") or "") if not boss else boss[3]
                return {"trainer_id": "", "battle_id": "", "result": "", "number": number, "boss": bool(boss), "name": c.get("name_es") or c["name"],
                        "title": title, "avatar": f"sd:{v.get('sprite') or c.get('base_sprite') or key}", "character": key,
                        "seat": {"team": sets, "ai_level": "expert", "ai_style": rng.choice(["balanced", "aggressive", "setup"])}}
            except (SilverError, StopIteration):
                pass   # the data has no such team: a generated rival takes the slot
        t = facilities.filler_trainer(f, rng)
        team = self.random_team(facilities.random_format(f), f"{r['id']}:{number}")["sets"]
        return {"trainer_id": "", "battle_id": "", "result": "", "number": number, "boss": False, "name": t["name"], "title": t["title"],
                "avatar": t["avatar"], "seat": {"team": team[: f["size"]], "ai_level": facilities.ai_level_for(number),
                                                "ai_style": rng.choice(["balanced", "aggressive", "defensive", "setup"])}}

    def facilities_list(self, trainer_id: str = "") -> dict[str, Any]:
        """The facilities with their rules and bosses, and each one's record (longest streak) and open streak, for one trainer or all."""
        runs = self.store.runs(kind="facility", challenger_id=trainer_id, limit=5000)
        out = []
        for f in facilities.FACILITIES:
            mine = [r for r in runs if r["target_id"] == f["id"]]
            wins = [sum(1 for st in r.get("stages") or [] if st.get("result") == "won") for r in mine]
            best_i = max(range(len(mine)), key=lambda i: wins[i]) if mine else None
            active = next((r for r in mine if r["status"] == "active"), None)
            bosses = []
            for at, key, _vid, label_es, label in f["bosses"]:
                try:
                    c = self._character(key)
                    bosses.append({"at": at, "key": key, "name": c.get("name_es") or c["name"], "label_es": label_es, "label": label,
                                   "avatar_url": self.avatar_url(f"sd:{c.get('base_sprite') or key}")})
                except SilverError:
                    continue
            out.append({"id": f["id"], "name": f["name"], "name_es": f["name_es"], "gen": f["gen"], "game": f["game"], "gametype": f["gametype"],
                        "size": f["size"], "round": facilities.ROUND, "bosses": bosses,
                        "record": wins[best_i] if best_i is not None else 0,
                        "record_holder": (mine[best_i].get("challenger") or {}).get("name", "") if best_i is not None else "",
                        "streaks": len(mine), "active_run_id": active["id"] if active else "", "rental": bool(f.get("rental")),
                        "active_phase": ((active.get("challenger") or {}).get("frontier") or {}).get("phase", "")
                        or (active.get("challenger") or {}).get("phase", "") if active else "", **frontier_runs.list_extra(f, mine, self),
                        "active_streak": sum(1 for st in (active or {}).get("stages") or [] if st.get("result") == "won")})
        return {"facilities": out, "trainer_id": trainer_id}

    def _run_rules(self, r: dict[str, Any]) -> tuple[str, list[str], dict[str, Any]]:
        if r["kind"] == "facility":
            return self._facility_rules(r)
        level = int((r.get("challenger") or {}).get("level") or 0)
        if level:
            fmt, rules, _ = self._run_rules({**r, "challenger": {**(r.get("challenger") or {}), "level": 0}})
            return fmt, rules, {"level": level}
        override = (r.get("challenger") or {}).get("format_override") or ""
        if override:
            base = self._run_rules({**r, "challenger": {}})
            return override, base[1], base[2]
        if r["kind"] == "gym":
            g = self.store.gym(r["target_id"], deleted=True)
            return g["format"], g.get("rules") or [], g.get("level_rules") or {}
        lg = self.store.league(r["target_id"], deleted=True)
        return lg["format"], lg.get("rules") or [], lg.get("level_rules") or {}

    def _run_battle(self, rid: str) -> Optional[str]:
        r = self.store.run(rid)
        if r["kind"] == "facility" and r["status"] == "active" and r["step"] >= len(r["stages"]) and not frontier.kind_of(r["target_id"]):
            self.store.update_run(rid, {"stages": [*r["stages"], self._facility_stage(r)]})
            r = self.store.run(rid)
        if r["status"] != "active" or r["step"] >= len(r["stages"]):
            return None
        if r["kind"] == "facility":
            return self._facility_battle(r)
        stage = r["stages"][r["step"]]
        fmt, rules, level_rules = self._run_rules(r)
        auto = bool((r.get("challenger") or {}).get("auto"))
        opponent = self.store.trainer(stage["trainer_id"], deleted=True)
        b = self.battle_start(p1={"trainer_id": r["challenger_id"], "human": not auto}, p2={"trainer_id": stage["trainer_id"], "human": False},
                              format_=fmt, rules=rules, level_rules=level_rules, kind=r["kind"], run_id=rid,
                              title=f"{r['target_name']} · {opponent['name']}", mode=r.get("mode") or "classic", rt_arena=(r.get("challenger") or {}).get("rt_arena") or "rocks")
        r = self.store.run(rid)
        stages = r["stages"]
        stages[r["step"]]["battle_id"] = b["id"]
        self.store.update_run(rid, {"stages": stages})
        return b["id"]

    def _facility_battle(self, r: dict[str, Any]) -> str:
        stage = r["stages"][r["step"]]
        if frontier.kind_of(r["target_id"]):   # both teams, format and start state as the Frontier facility makes them
            parts = frontier_runs.battle_parts(self, r)
            ch = r.get("challenger") or {}
            b = self.battle_start(p1=parts["p1"], p2=parts["p2"], format_=parts["format"], rules=parts["rules"], level_rules=parts["level_rules"],
                                  kind="facility", run_id=r["id"], title=f"{r['target_name']} · {stage['number']} · {stage['name']}",
                                  mode=r.get("mode") or "classic", rt_arena=ch.get("rt_arena") or "rocks", start=parts["start"])
            r = self.store.run(r["id"])
            stages = r["stages"]
            stages[r["step"]]["battle_id"] = b["id"]
            self.store.update_run(r["id"], {"stages": stages})
            return b["id"]
        fmt, rules, level_rules = self._run_rules(r)
        auto = bool((r.get("challenger") or {}).get("auto"))
        seat = {**(stage.get("seat") or {}), "name": stage["name"], "avatar": stage.get("avatar", ""), "human": False}
        ch = r.get("challenger") or {}
        if (facilities.get(r["target_id"]) or {}).get("rental"):
            p1 = {"team": ch.get("team") or [], "name": ch.get("name", ""), "avatar": ch.get("avatar", ""), "human": not auto}
        else:
            p1 = {"trainer_id": r["challenger_id"], "human": not auto}
        if (r.get("mode") or "classic") == "realtime" and "trainer_id" in p1:   # no team preview in real time: the first Pokémon of the team, as many as the rival's
            p1["team_size"] = (facilities.get(r["target_id"]) or {}).get("size", 3)
        b = self.battle_start(p1=p1, p2=seat, format_=fmt, rules=rules, level_rules=level_rules,
                              kind="facility", run_id=r["id"], title=f"{r['target_name']} · {stage['number']} · {stage['name']}",
                              mode=r.get("mode") or "classic", rt_arena=ch.get("rt_arena") or "rocks")
        r = self.store.run(r["id"])
        stages = r["stages"]
        stages[r["step"]]["battle_id"] = b["id"]
        self.store.update_run(r["id"], {"stages": stages})
        return b["id"]

    def _advance_run(self, rid: str, b: dict[str, Any]) -> None:
        r = self.store.run(rid)
        if r["status"] != "active":
            return
        stages = r["stages"]
        step = r["step"]
        if step >= len(stages) or stages[step].get("battle_id") != b["id"]:
            return
        if frontier.kind_of(r["target_id"]) and r["kind"] == "facility":
            frontier_runs.after_battle(self, r, b)
            return
        won = b.get("winner_side") == "p1"
        stages[step]["result"] = "won" if won else "lost"
        if not won:
            self.store.update_run(rid, {"stages": stages, "status": "lost"})
            self.emit("run.lost", {"id": rid})
            return
        step += 1
        if r["kind"] == "facility":
            self.store.update_run(rid, {"stages": stages, "step": step})
            self.emit("run.streak", {"id": rid, "streak": step})
            ch = r.get("challenger") or {}
            stop = int(ch.get("stop_at") or 0)
            go_on = bool(ch.get("auto")) and (not stop or step < stop)
            if (facilities.get(r["target_id"]) or {}).get("rental"):
                if step % facilities.ROUND == 0:   # a round of seven is over: six new rentals
                    self._factory_round(rid, auto_pick=go_on)
                else:
                    offer = (stages[step - 1].get("seat") or {}).get("team") or []
                    self.store.update_run(rid, {"challenger": {**ch, "phase": "swap", "offer": offer}})
                    if go_on:
                        self.factory_swap(rid)
                return
            if go_on:
                self._run_battle(rid)
            return
        if step >= len(stages):
            self.store.update_run(rid, {"stages": stages, "step": step, "status": "won"})
            ch = r.get("challenger") or {}
            if r["kind"] == "gym":
                g = self.store.gym(r["target_id"], deleted=True)
                self.store.add_badge({"gym_id": g["id"], "gym_name": g["name"], "badge": g["badge"], "badge_color": g["badge_color"], "badge_image": g.get("badge_image") or "",
                                      "challenger_name": ch.get("name", ""), "challenger_trainer_id": r["challenger_id"], "source": "local",
                                      "battle_id": b["id"], "run_id": rid})
            else:
                lg = self.store.league(r["target_id"], deleted=True)
                self.store.add_hall({"league_id": lg["id"], "league_name": lg["name"], "champion_name": ch.get("name", ""),
                                     "trainer_id": r["challenger_id"], "team": ch.get("team") or [], "run_id": rid})
            self.emit("run.won", {"id": rid, "kind": r["kind"]})
            return
        self.store.update_run(rid, {"stages": stages, "step": step})
        if (r.get("challenger") or {}).get("auto"):
            self._run_battle(rid)

    # ------------------------------------------------------------ Battle Factory: rentals
    def _factory_round(self, rid: str, auto_pick: Optional[bool] = None) -> None:
        """Six new rental Pokémon for the next round; with auto the AI takes the first three and plays on."""
        r = self.store.run(rid)
        f = facilities.get(r["target_id"]) or {}
        ch = r.get("challenger") or {}
        number = r["step"] // facilities.ROUND + 1
        rentals = self.random_team(facilities.random_format(f), f"{rid}:rentals:{number}")["sets"][: facilities.RENTALS]
        self.store.update_run(rid, {"challenger": {**ch, "phase": "pick", "rentals": rentals, "offer": [], "team": []}})
        if ch.get("auto") if auto_pick is None else auto_pick:
            self.factory_pick(rid, list(range(f.get("size", 3))))

    def _factory_run(self, rid: str, phase: str) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
        r = self.store.run(rid)
        f = facilities.get(r["target_id"]) or {}
        if r["kind"] != "facility" or not f.get("rental"):
            raise SilverError("invalid", "This is not a Battle Factory streak.")
        if r["status"] != "active":
            raise SilverError("ended", "This streak is over.")
        ch = r.get("challenger") or {}
        if ch.get("phase") != phase:
            raise SilverError("conflict", f"The streak is not waiting for that now (it is at: {ch.get('phase') or 'battle'}).")
        return r, f, ch

    def factory_pick(self, rid: str, picks: list[int]) -> dict[str, Any]:
        """Take three of the six rentals (their indexes, in battle order) and start the round's next battle."""
        r, f, ch = self._factory_run(rid, "pick")
        rentals = ch.get("rentals") or []
        size = f.get("size", 3)
        if len(picks) != size or len(set(picks)) != size or any(not 0 <= i < len(rentals) for i in picks):
            raise SilverError("invalid", f"Pick {size} different rentals (indexes 0-{len(rentals) - 1}).")
        self.store.update_run(rid, {"challenger": {**ch, "phase": "battle", "team": [rentals[i] for i in picks]}})
        self._run_battle(rid)
        return self.run_view(self.store.run(rid))

    def factory_swap(self, rid: str, give: int = -1, take: int = -1) -> dict[str, Any]:
        """After a win: swap one of your rentals (give) for one of the beaten rival's (take), or keep the team (-1), and battle on."""
        r, f, ch = self._factory_run(rid, "swap")
        team = list(ch.get("team") or [])
        offer = ch.get("offer") or []
        if give >= 0 or take >= 0:
            if not (0 <= give < len(team) and 0 <= take < len(offer)):
                raise SilverError("invalid", f"give is 0-{len(team) - 1} and take is 0-{len(offer) - 1}, or both -1 to keep the team.")
            team[give] = offer[take]
        self.store.update_run(rid, {"challenger": {**ch, "phase": "battle", "team": team, "offer": []}})
        self._run_battle(rid)
        return self.run_view(self.store.run(rid))

    def run_next(self, rid: str, stage: str = "") -> dict[str, Any]:
        r = self.store.run(rid)
        if r["status"] != "active":
            raise SilverError("ended", "This challenge is over.")
        if (r.get("challenger") or {}).get("map"):
            self._map_stage(r, stage)
            r = self.store.run(rid)
        if r["kind"] == "facility" and frontier.kind_of(r["target_id"]):
            done = frontier_runs.next_step(self, r)
            if done is not None:
                return done
            r = self.store.run(rid)
        phase = (r.get("challenger") or {}).get("phase") if r["kind"] == "facility" else ""
        if phase == "pick":
            raise SilverError("conflict", "Pick the rental Pokémon first.", hint="factory_pick with the indexes of three of the six rentals.")
        if phase == "swap":   # keep the team as it is
            return self.factory_swap(rid)
        cur = r["stages"][r["step"]] if r["step"] < len(r["stages"]) else {}
        if cur.get("battle_id"):
            b = self.store.battle(cur["battle_id"])
            if b["status"] in ("live", "running"):
                return self.run_view(r)
        self._run_battle(rid)
        return self.run_view(self.store.run(rid))

    def _map_stage(self, r: dict[str, Any], stage: str) -> None:
        """A challenge on a gym map: the battle is with whoever you met (a trainer id, or "leader"), so that stage moves to the current
        step. The leader only fights once every trainer is beaten."""
        stages, step = r["stages"], r["step"]
        cur = stages[step] if step < len(stages) else {}
        if cur.get("battle_id"):
            with contextlib.suppress(SilverError):
                if self.store.battle(cur["battle_id"])["status"] in ("live", "running"):
                    return   # that battle is still on
        if not stage:
            raise SilverError("invalid", "On a gym map, say who you met: stage is a trainer id or leader.", hint="challenge_get shows the map.")
        last = len(stages) - 1
        if stage == "leader":
            if step < last:
                raise SilverError("conflict", "The leader waits until every trainer of the gym is beaten.")
            return
        j = next((i for i in range(step, last) if stages[i]["trainer_id"] == stage), None)
        if j is None:
            raise SilverError("conflict", "That trainer was already beaten, or is not in this gym.")
        if j != step:
            stages[step], stages[j] = stages[j], stages[step]
            self.store.update_run(r["id"], {"stages": stages})

    # ------------------------------------------------------------ the HeartGold/SoulSilver Battle Frontier (frontier_runs.py)
    def frontier_hall_pick(self, rid: str, cell: Any) -> dict[str, Any]:
        return frontier_runs.hall_pick(self, rid, cell)

    def frontier_arcade_stop(self, rid: str, panel: int = -1, frames: int = -1) -> dict[str, Any]:
        return frontier_runs.arcade_stop(self, rid, panel, frames)

    def frontier_castle(self, rid: str, service: str, mon: int = -1, item: str = "") -> dict[str, Any]:
        return frontier_runs.castle_service(self, rid, service, mon, item)

    def frontier_get(self, rid: str) -> dict[str, Any]:
        r = self.store.run(rid)
        if not frontier_runs.kind_of(r):
            raise SilverError("invalid", "This is not a Battle Hall, Battle Arcade or Battle Castle streak.", hint="facilities_list shows them.")
        return self.run_view(r)

    def run_get(self, rid: str) -> dict[str, Any]:
        """One challenge with its stages; on a gym map also the map and the people on it (for walking it)."""
        r = self.store.run(rid)
        out = self.run_view(r)
        if (r.get("challenger") or {}).get("map") and r["kind"] == "gym":
            g = self.store.gym(r["target_id"], deleted=True)
            out["map"] = g.get("map") or {}
            out["gym"] = {"id": g["id"], "name": g["name"], "type": g["type"], "badge_color": g.get("badge_color") or ""}
            people = {}
            for st in r["stages"]:
                with contextlib.suppress(SilverError):
                    t = self.store.trainer(st["trainer_id"], deleted=True)
                    people["leader" if st["trainer_id"] == g["leader_id"] else st["trainer_id"]] = {"name": t["name"], "avatar_url": self.avatar_url(t["avatar"])}
            out["people"] = people
            out["player"] = {"name": (r.get("challenger") or {}).get("name", ""), "avatar_url": self.avatar_url((r.get("challenger") or {}).get("avatar", ""))}
            out["beaten"] = [st["trainer_id"] for st in r["stages"] if st.get("result") == "won"]
        return out

    def run_abandon(self, rid: str) -> dict[str, Any]:
        r = self.store.run(rid)
        if r["status"] == "active":
            self.store.update_run(rid, {"status": "abandoned"})
        return self.run_view(self.store.run(rid))

    def runs_list(self, status: str = "", kind: str = "") -> list[dict[str, Any]]:
        return [self.run_view(r, light=True) for r in self.store.runs(status=status, kind=kind)]

    def badges_list(self, trainer_id: str = "", gym_id: str = "") -> list[dict[str, Any]]:
        return self.store.badges(challenger_trainer_id=trainer_id, gym_id=gym_id)

    def hall_list(self, league_id: str = "") -> list[dict[str, Any]]:
        return self.store.hall(league_id=league_id)

    # ------------------------------------------------------------ progress: record, streaks, achievements, Pokédex
    def progress_get(self, trainer_id: str) -> dict[str, Any]:
        """One trainer's progress from its stored battles, challenges, facility streaks, badges and hall of fame entries."""
        t = self.store.trainer(trainer_id)
        battles = self.store.battles(trainer_id=trainer_id, status="ended", limit=100_000)
        runs = self.store.runs(challenger_id=trainer_id, limit=100_000)
        badges = self.store.badges(challenger_trainer_id=trainer_id)
        hall = [h for h in self.store.hall() if h.get("trainer_id") == trainer_id]
        rental = frozenset(f["id"] for f in facilities.FACILITIES if f.get("rental"))
        out = progress.compute(t, battles, runs, badges, hall, rental_ids=rental)
        out["avatar_url"] = self.avatar_url(t.get("avatar") or "")
        return out

    def progress_list(self) -> dict[str, Any]:
        """Every trainer that is not an in-game one, ranked by wins: record, best streak, facility record, achievements unlocked."""
        rows = []
        for t in self.store.trainers(limit=5000):
            if t.get("origin") == "canon":
                continue
            p = self.progress_get(t["id"])
            rows.append({"trainer_id": t["id"], "name": t["name"], "avatar_url": p["avatar_url"], "record": p["record"], "win_rate": p["win_rate"],
                         "best_streak": p["streaks"]["best"], "facility_best": p["facilities"]["best"], "badges": p["challenges"]["badges"],
                         "unlocked": p["unlocked"], "achievements": len(p["achievements"]), "used": len(p["pokedex"]["used"])})
        rows.sort(key=lambda r: (-r["record"]["wins"], -r["unlocked"], r["name"]))
        return {"trainers": rows}

    # ------------------------------------------------------------ background work: series and tournaments
    def _job(self, kind: str, title: str, args: dict[str, Any], work: Callable[[str, Callable[[float], None], Callable[[], bool]], dict[str, Any]]) -> dict[str, Any]:
        jid = self.store.add_job({"kind": kind, "title": title[:120], "status": "queued", "args": args})
        self._cancel[jid] = False

        def run() -> None:
            if self._cancel.get(jid):   # cancelled while it was waiting for a free worker: it never starts
                self._cancel.pop(jid, None)
                return
            self.store.update_job(jid, {"status": "running"})
            last = [0.0]

            def progress(p: float) -> None:
                if p - last[0] >= 0.02 or p >= 1:
                    last[0] = p
                    self.store.update_job(jid, {"progress": round(min(1.0, max(0.0, p)), 3)})

            try:
                result = work(jid, progress, lambda: self._cancel.get(jid, False))
                self.store.update_job(jid, {"status": "done", "progress": 1.0, "result": result})
                self.emit("job.done", {"id": jid, "kind": kind})
            except SilverError as exc:
                self.store.update_job(jid, {"status": "cancelled" if exc.code == "cancelled" else "failed", "error": exc.message})
            except Exception as exc:  # noqa: BLE001 - recorded on the job
                log.exception("job %s", jid)
                self.store.update_job(jid, {"status": "failed", "error": str(exc)[:500]})
            finally:
                self._cancel.pop(jid, None)

        self.pool.submit(run)
        return self.store.job(jid)

    def job_get(self, id_: str) -> dict[str, Any]:
        j = self.store.job(id_)
        j["battles"] = [self.battle_card(b) for b in self.store.battles(job_id=id_, limit=500)]
        return j

    def jobs_list(self, kind: str = "", status: str = "") -> list[dict[str, Any]]:
        return self.store.jobs(kind=kind, status=status)

    def job_cancel(self, id_: str) -> dict[str, Any]:
        if id_ in self._cancel:
            self._cancel[id_] = True
            if self.store.job(id_).get("status") == "queued":
                self.store.update_job(id_, {"status": "cancelled", "error": "Cancelled before it started."})
        return self.store.job(id_)

    def jobs_delete(self, ids: list[str]) -> dict[str, Any]:
        return {"deleted": self.store.delete_jobs(ids)}

    def _rt_format(self, fmt: str) -> str:
        """The format a real-time battle keeps: singles and doubles formats stay (doubles field two Pokémon per trainer); random
        formats become the custom game of their generation and kind (the teams are already given); other kinds play as singles."""
        info = self.format_info(fmt, [])
        kind = info.get("game_type")
        if kind == "doubles" and int(info.get("gen") or 9) < 3:
            kind = "singles"
        if info.get("random") or kind not in ("singles", "doubles"):
            return f"gen{info['gen']}{'doubles' if kind == 'doubles' else ''}customgame"
        return fmt

    def series_start(self, *, p1: dict[str, Any], p2: dict[str, Any], count: int = 0, format_: str = "", rules: Optional[list[str]] = None,
                     level_rules: Optional[dict[str, Any]] = None, mode: str = "classic", time_limit: int = 0, rt_arena: str = "rocks") -> dict[str, Any]:
        arena = self.arenas.spec(_rt_arena(rt_arena))
        s1, s2 = self._seat({**p1, "human": False}, "A"), self._seat({**p2, "human": False}, "B")
        fmt = format_ or s1["format"] or s2["format"] or self.settings["default_format"]
        count = max(1, min(int(count or self.settings["series_default"]), 1000))
        rt = mode == "realtime"
        silver_special = bool(self.settings.get("rt_silver_special", False))
        limit = max(30, min(int(time_limit or self.settings["rt_time_limit"]), 1800))
        if rt:
            fmt, rules = self._rt_format(fmt), []
        spec = {"format": fmt, "rules": rules or [], "level_rules": level_rules or {}, "max_turns": self.settings["max_turns"],
                "p1": {"name": s1["name"], "sets": s1["sets"], "ai": s1["ai"]}, "p2": {"name": s2["name"], "sets": s2["sets"], "ai": s2["ai"]}}
        if rt:
            spec.update({"mode": "realtime", "time_limit": limit, "arena": arena, "version": RT_RULES_VERSION, "silver_special": silver_special})

        def work(jid: str, progress: Callable[[float], None], cancelled: Callable[[], bool]) -> dict[str, Any]:
            res = self.engine.run_job("simulate", {"spec": spec, "count": count}, progress=progress, cancelled=cancelled, timeout=6 * 3600)
            samples = {}
            for outcome, sample in (res.pop("samples", {}) or {}).items():
                summary = sample.get("summary") or {}
                bid = self.store.add_battle({"kind": "series", "status": "ended", "format": fmt, "rules": rules or [], "level_rules": level_rules or {},
                                             "p1": s1, "p2": s2, "winner_side": summary.get("winner_side", ""), "winner_name": summary.get("winner", ""),
                                             "turns": summary.get("turns", 0), "log_text": "\n".join(sample.get("lines") or []), "summary": summary,
                                             "seed": str(sample.get("seed")) if rt else json.dumps(sample.get("seed")), "job_id": jid,
                                             "title": f"{s1['name']} vs {s2['name']}", "mode": "realtime" if rt else "classic",
                                             "replay": {"time_limit": limit, "inputs": [], "version": RT_RULES_VERSION, "arena": arena, "silver_special": silver_special} if rt else {}})
                samples[outcome] = bid
            res["samples"] = samples
            res["p1"], res["p2"] = self._public_seat(s1), self._public_seat(s2)
            return res

        return self._job("series", f"{s1['name']} vs {s2['name']} ×{count}{' · tiempo real' if rt else ''}",
                         {"p1": p1, "p2": p2, "count": count, "format": fmt, "mode": "realtime" if rt else "classic", **({"rt_arena": arena} if rt else {})}, work)

    def tournament_start(self, *, trainer_ids: list[str], kind: str = "bracket", best_of: int = 1, format_: str = "", rules: Optional[list[str]] = None,
                         level_rules: Optional[dict[str, Any]] = None, title: str = "", ai_level: str = "", mode: str = "classic",
                         time_limit: int = 0, rt_arena: str = "rocks") -> dict[str, Any]:
        arena = self.arenas.spec(_rt_arena(rt_arena))
        ids = list(dict.fromkeys(trainer_ids))
        if len(ids) < 2:
            raise SilverError("invalid", "A tournament needs at least two trainers.")
        if len(ids) > 64:
            raise SilverError("invalid", "At most 64 trainers.")
        if kind not in ("bracket", "league"):
            raise SilverError("invalid", "kind is bracket or league")
        entrants = []
        for tid in ids:
            seat = self._seat({"trainer_id": tid, "ai_level": ai_level or None}, tid)
            entrants.append({"id": tid, "name": seat["name"], "sets": seat["sets"], "ai": seat["ai"], "avatar": seat["avatar"]})
        fmt = format_ or self.settings["default_format"]
        self.format_info(fmt, rules)
        rt = mode == "realtime"
        silver_special = bool(self.settings.get("rt_silver_special", False))
        limit = max(30, min(int(time_limit or self.settings["rt_time_limit"]), 1800))
        if rt:
            fmt, rules = self._rt_format(fmt), []
        best_of = max(1, int(best_of) | 1)
        name = title or f"Torneo de {len(ids)}"

        def work(jid: str, progress: Callable[[float], None], cancelled: Callable[[], bool]) -> dict[str, Any]:
            res = self.engine.run_job("tournament", {"format": fmt, "rules": rules or [], "level_rules": level_rules or {}, "entrants": entrants,
                                                     "max_turns": self.settings["max_turns"],
                                                     "kind": kind, "best_of": best_of, "mode": "realtime" if rt else "classic", "time_limit": limit,
                                                     "arena": arena, "version": RT_RULES_VERSION, "silver_special": silver_special},
                                     progress=progress, cancelled=cancelled, timeout=12 * 3600)
            by_id = {e["id"]: e for e in entrants}
            for m in res.get("matches") or []:
                for g in m.get("games") or []:
                    a, b_ = by_id[m["a"]], by_id[m["b"]]
                    summary = g.get("summary") or {}
                    seat = lambda e: {"trainer_id": e["id"], "name": e["name"], "avatar": e["avatar"], "avatar_url": self.avatar_url(e["avatar"]),  # noqa: E731
                                      "human": False, "ai": e["ai"], "sets": e["sets"]}
                    g["battle_id"] = self.store.add_battle({"kind": "tournament", "status": "ended", "format": fmt, "rules": rules or [],
                                                           "level_rules": level_rules or {}, "p1": seat(a), "p2": seat(b_),
                                                           "winner_side": summary.get("winner_side", ""), "winner_name": summary.get("winner", ""),
                                                           "turns": summary.get("turns", 0), "log_text": "\n".join(g.pop("lines", None) or []),
                                                           "summary": summary, "seed": str(g.get("seed")) if rt else json.dumps(g.get("seed")),
                                                           "job_id": jid, "title": f"{name} · {a['name']} vs {b_['name']}",
                                                           "mode": "realtime" if rt else "classic",
                                                           "replay": {"time_limit": limit, "inputs": [], "version": RT_RULES_VERSION, "arena": arena, "silver_special": silver_special} if rt else {}})
                    g.pop("summary", None)
            res["entrants"] = [{"id": e["id"], "name": e["name"], "avatar_url": self.avatar_url(e["avatar"])} for e in entrants]
            res["title"] = name
            if res.get("champion"):
                self.emit("tournament.won", {"job": jid, "champion": by_id[res["champion"]]["name"]})
            return res

        return self._job("tournament", name, {"trainer_ids": ids, "kind": kind, "best_of": best_of, "format": fmt, "mode": "realtime" if rt else "classic",
                                              **({"rt_arena": arena} if rt else {})}, work)

    # ------------------------------------------------------------ sharing
    def _avatar_payload(self, avatar: str, *, max_bytes: int = 0) -> dict[str, Any]:
        """A picture as it travels to a friend. ``max_bytes`` shrinks big drawings (share codes are pasted into chats)."""
        if avatar.startswith("sd:"):
            return {"kind": "showdown", "name": avatar[3:]}
        if avatar.startswith("file:"):
            try:
                data = self.sprites.avatar_path(avatar[5:]).read_bytes()
                if max_bytes and len(data) > max_bytes:
                    from PIL import Image
                    img = Image.open(io.BytesIO(data)).convert("RGBA")
                    for side in (1024, 768, 640, 512, 384, 288, 192, 144, 112, 96):
                        if side >= max(img.size):
                            continue
                        img.thumbnail((side, side))
                        buf = io.BytesIO()
                        img.save(buf, "PNG", optimize=True)
                        data = buf.getvalue()
                        if len(data) <= max_bytes:
                            break
                known = self._avatar_meta().get(avatar[5:]) or {}
                metadata = {k: known[k] for k in ("credit", "source", "title") if known.get(k)}
                metadata["kind"] = self.avatar_kind(avatar)
                return {"kind": "image", "mime": "image/png", "data": base64.b64encode(data).decode("ascii"),
                        "metadata": metadata}
            except SilverError:
                return {}
        return {}

    CODE_PICTURE_BYTES = 48_000
    FILE_PICTURE_BYTES = 700_000     # a trainer's own picture inside a file or a playable page

    def _trainer_payload(self, t: dict[str, Any], *, with_picture: bool = True, max_picture: int = FILE_PICTURE_BYTES) -> dict[str, Any]:
        return {"name": t["name"], "title": t["title"], "owner": t["owner"] or self.settings["player_name"], "format": t["format"], "team": t["team"],
                "ai": {"level": t["ai_level"], "style": t["ai_style"]}, "dialogue": t.get("dialogue") or {}, "notes": t.get("notes") or "",
                "avatar": self._avatar_payload(t["avatar"], max_bytes=max_picture) if with_picture else ({"kind": "showdown", "name": t["avatar"][3:]} if t["avatar"].startswith("sd:") else {}),
                "source_id": t["id"]}

    def _badge_payload(self, image: str) -> dict[str, Any]:
        if image.startswith("shape:"):
            return {"kind": "shape", "shape": image[6:]}
        if image.startswith("file:"):
            return self._avatar_payload(image)
        return {}

    def _import_badge(self, payload: Any, stem: str) -> str:
        if isinstance(payload, dict) and payload.get("kind") == "shape" and payload.get("shape") in BADGE_SHAPES:
            return f"shape:{payload['shape']}"
        return self._import_avatar(payload, stem) if isinstance(payload, dict) and payload.get("kind") == "image" else ""

    def _gym_payload(self, g: dict[str, Any]) -> dict[str, Any]:
        return {"name": g["name"], "city": g["city"], "type": g["type"], "badge": g["badge"], "badge_color": g["badge_color"],
                "badge_image": self._badge_payload(g.get("badge_image") or ""),
                "description": g["description"], "format": g["format"], "rules": g.get("rules") or [], "level_rules": g.get("level_rules") or {},
                "leader": self._trainer_payload(self.store.trainer(g["leader_id"], deleted=True)),
                "trainers": [self._trainer_payload(t) for t in self._gym_trainers(g)], "source_id": g["id"],
                **({"rt_arena": self.arenas.export_value(g["rt_arena"])} if g.get("rt_arena") else {}),
                **({"backdrop": self._backdrop_payload(g["backdrop"])} if g.get("backdrop") else {}),
                **({"map": self._map_payload(g)} if (g.get("map") or {}).get("w") else {})}

    def _map_payload(self, g: dict[str, Any]) -> dict[str, Any]:
        """A gym map as it travels: the trainers by their place in the gym (0, 1…) instead of this app's ids."""
        m = dict(g["map"])
        order = list(g.get("trainers") or [])
        m["trainers"] = [{**t, "id": order.index(t["id"])} for t in m.get("trainers") or [] if t["id"] in order]
        return m

    def _gym_trainers(self, g: dict[str, Any]) -> list[dict[str, Any]]:
        """The gym's trainers before its leader, in the order the gym lists them (the store hands them back by recency)."""
        order = g.get("trainers") or []
        return sorted(self.store.trainers(ids=order), key=lambda t: order.index(t["id"]))

    def _league_payload(self, lg: dict[str, Any]) -> dict[str, Any]:
        return {"name": lg["name"], "description": lg["description"], "format": lg["format"], "rules": lg.get("rules") or [],
                "level_rules": lg.get("level_rules") or {}, "badges_required": lg.get("badges_required") or 0,
                "gyms": [self._gym_payload(g) for g in self.store.gyms(ids=lg.get("gyms") or [])],
                "elite_four": [self._trainer_payload(t) for t in self.store.trainers(ids=lg.get("elite_four") or [])],
                "champion": self._trainer_payload(self.store.trainer(lg["champion_id"], deleted=True)), "source_id": lg["id"]}

    def export(self, kind: str, id_: str, *, fmt: str = "file", friend_mode: str = "choose", weekly: bool = False) -> dict[str, Any]:
        """``fmt``: file (a .hoardtrainer/.hoardgym/.hoardleague JSON), code (a share code, trainers only; an own picture goes in it,
        shrunk when it is a big drawing), page
        (a playable HTML, gyms and trainers), paste (the team as Showdown text, trainers only).
        ``friend_mode`` (pages): choose (the friend picks turns or real time for each battle), turns or realtime.
        ``weekly`` (pages): the week's challenge: every battle turn by turn with this week's seed and AI luck (``weekly_info``)."""
        if friend_mode not in sharing.FRIEND_MODES:
            raise SilverError("invalid", "friend_mode is choose (the friend picks for each battle), turns or realtime")
        if weekly and (fmt != "page" or kind == "league"):
            raise SilverError("invalid", "The week's challenge is a playable page of a gym or a trainer.")
        if weekly:
            friend_mode = "turns"   # the same luck for everyone needs the same simulator: turn by turn
        if kind == "trainer":
            obj = self.store.trainer(id_)
            payload = self._trainer_payload(obj, max_picture=self.CODE_PICTURE_BYTES if fmt == "code" else self.FILE_PICTURE_BYTES)
            name = obj["name"]
        elif kind == "gym":
            obj = self.store.gym(id_)
            payload = self._gym_payload(obj)
            name = obj["name"]
        elif kind == "league":
            obj = self.store.league(id_)
            payload = self._league_payload(obj)
            name = obj["name"]
        else:
            raise SilverError("invalid", "kind is trainer, gym or league")
        owner = self.settings["player_name"]
        wrapped = sharing.wrap(kind, payload, app_version=__version__, owner=owner)
        if fmt == "code":
            if kind != "trainer":
                raise SilverError("invalid", "Share codes are for trainers; send gyms and leagues as a file or a page.")
            return {"code": sharing.pack_code(sharing.CODE_PREFIX, wrapped), "name": name}
        if fmt == "paste":
            if kind != "trainer":
                raise SilverError("invalid", "Only a trainer's team exports as Showdown text.")
            return {"paste": self.export_team(payload["team"]), "name": name}
        exports = self.config.exports_dir
        if fmt == "page":
            if kind == "league":
                raise SilverError("invalid", "A playable page holds one gym or one trainer.")
            data = {"payload": wrapped, "sprite_server": self.settings["sprite_server"], "from": owner, "kind": kind,
                    "sprite_set": self.settings["sprite_set"], "mode": friend_mode, "ai_version": self.ai_version()}
            if friend_mode != "turns":
                data["rt"] = self._rt_page_info(kind, obj)
                data["overworld"] = self.overworld.export()
            week = ""
            if weekly:
                data["weekly"] = self.weekly_info(kind, obj)
                week = data["weekly"]["week"]
            html = sharing.playable_page(PLAY_TEMPLATE, data)
            filename = sharing.safe_filename(f"{name} - Silver" + (f" - {week}" if week else ""), "html")
            (exports / filename).write_text(html, encoding="utf-8", newline="\n")
            return {"file": filename, "bytes": len(html.encode("utf-8")), "url": f"/api/exports/{filename}", "name": name,
                    **({"week": week} if week else {})}
        ext = {"trainer": "hoardtrainer", "gym": "hoardgym", "league": "hoardleague"}[kind]
        filename = sharing.safe_filename(name, ext)
        text = json.dumps(wrapped, ensure_ascii=False, indent=1)
        (exports / filename).write_text(text, encoding="utf-8", newline="\n")
        return {"file": filename, "bytes": len(text.encode("utf-8")), "url": f"/api/exports/{filename}", "name": name}

    def _import_avatar(self, av: dict[str, Any], stem: str) -> str:
        if not isinstance(av, dict):
            return ""
        if av.get("kind") == "showdown" and av.get("name"):
            return f"sd:{str(av['name']).lower()}"
        if av.get("kind") == "image" and av.get("data"):
            try:
                name = self.sprites.save_avatar(base64.b64decode(av["data"]), stem=stem, max_side=1024)
                metadata = av.get("metadata")
                if isinstance(metadata, dict):
                    fields = {k: metadata[k] for k in ("credit", "source", "title") if isinstance(metadata.get(k), str)}
                    if metadata.get("kind") in ("photo", "art", "image", "sprite", "drawing", "pose"):
                        fields["kind"] = metadata["kind"]
                    self._avatar_meta_set(name, **fields)
                return "file:" + name
            except (SilverError, ValueError):
                return ""
        return ""

    def _import_trainer(self, p: dict[str, Any], origin: str = "friend") -> str:
        ai = p.get("ai") or {}
        level = ai.get("level") if ai.get("level") in AI_LEVELS else "normal"
        style = ai.get("style") if ai.get("style") in AI_STYLES else "balanced"
        sets = self.import_team(p.get("team") or [])["sets"]
        fmt = p.get("format") or self.settings["default_format"]
        try:
            self.format_info(fmt)
        except SilverError:
            fmt = self.settings["default_format"]
        self.check_team(sets, fmt)
        return self.store.add_trainer({"name": str(p.get("name") or "?")[:60], "title": str(p.get("title") or "")[:60], "owner": str(p.get("owner") or "")[:60],
                                      "origin": origin, "format": fmt, "team": sets, "ai_level": level, "ai_style": style,
                                      "avatar": self._import_avatar(p.get("avatar") or {}, str(p.get("name") or "friend")),
                                      "dialogue": self._clean_dialogue(p.get("dialogue")), "notes": str(p.get("notes") or "")[:4000], "tags": ["amigo"]})

    @staticmethod
    def _import_map(m: Any, trainers: list[str]) -> dict[str, Any]:
        if not isinstance(m, dict) or not m.get("w"):
            return {}
        try:
            people = [{**t, "id": trainers[int(t["id"])]} for t in m.get("trainers") or []]
            return gymmap.clean({**m, "trainers": people}, trainers)
        except (SilverError, ValueError, TypeError, IndexError, KeyError):
            return {}   # a map that does not fit is left out; the gym still works without it

    def _import_gym(self, p: dict[str, Any], origin: str = "friend") -> str:
        leader = self._import_trainer(p["leader"], origin)
        trainers = [self._import_trainer(t, origin) for t in p.get("trainers") or []]
        return self.store.add_gym({"name": str(p.get("name") or "Gimnasio")[:60], "city": str(p.get("city") or "")[:60], "type": str(p.get("type") or "")[:20],
                                   "badge": str(p.get("badge") or "")[:60], "badge_color": str(p.get("badge_color") or "")[:20],
                                   "badge_image": self._import_badge(p.get("badge_image"), f"badge-{p.get('name') or 'gym'}"),
                                   "description": str(p.get("description") or "")[:2000], "format": p.get("format") or self.settings["default_format"],
                                   "rules": [str(r)[:80] for r in p.get("rules") or []][:20], "level_rules": p.get("level_rules") or {},
                                   "leader_id": leader, "trainers": trainers, "origin": origin, "owner": str(p.get("owner") or "")[:60],
                                   "rt_arena": self.arenas.import_value(p.get("rt_arena")),
                                   "map": self._import_map(p.get("map"), trainers),
                                   "backdrop": self._import_backdrop(p.get("backdrop"), f"backdrop-{p.get('name') or 'gym'}")})

    # ------------------------------------------------------------ teams by pokepast.es link
    POKEPASTE = re.compile(r"^\s*(?:https?://)?(?:www\.)?pokepast\.es/([0-9a-fA-F]{6,32})(?:/(?:json|raw))?/?\s*$")

    def import_pokepaste(self, url: str, *, name: str = "", format_: str = "") -> dict[str, Any]:
        """A team from a pokepast.es link, as a new trainer (its title as the name; the format named in its notes when the app
        knows it)."""
        m = self.POKEPASTE.match(url or "")
        if not m:
            raise SilverError("invalid", "Not a pokepast.es link.")
        pid = m.group(1).lower()
        try:
            status, body, _ = self._http_get(f"https://pokepast.es/{pid}/json")
        except Exception as exc:  # noqa: BLE001 - offline or blocked
            raise SilverError("unavailable", f"pokepast.es did not answer: {exc}") from None
        if status == 404:
            raise SilverError("not_found", "That paste does not exist on pokepast.es.")
        if status != 200:
            raise SilverError("unavailable", f"pokepast.es answered {status}.")
        data = json.loads(body.decode("utf-8"))
        fmt = format_
        found = re.search(r"Format:\s*([A-Za-z0-9]+)", str(data.get("notes") or ""))
        if not fmt and found:
            try:
                self.format_info(found.group(1).lower())
                fmt = found.group(1).lower()
            except SilverError:
                fmt = ""
        title = " ".join(str(data.get("title") or "").split())[:60]
        t = self.trainer_create(name=name or title or f"pokepast.es {pid[:6]}", paste=str(data.get("paste") or ""), format_=fmt, origin="own")
        return {"kind": "trainer", "trainer": t, "source": f"https://pokepast.es/{pid}", "author": str(data.get("author") or "")[:60]}

    def _pokepaste_post(self, fields: dict[str, str]) -> str:
        """POST /create on pokepast.es; the answer redirects to the new paste."""
        import httpx
        with httpx.Client(timeout=20.0, follow_redirects=False, headers={"User-Agent": "SilversHoard/0.1 (local battle simulator)"}) as client:
            r = client.post("https://pokepast.es/create", data=fields)
        location = r.headers.get("location") or ""
        if r.status_code not in (301, 302, 303, 307, 308) or not location:
            raise SilverError("unavailable", f"pokepast.es did not create the paste ({r.status_code}).")
        return location

    def pokepaste_export(self, trainer_id: str) -> dict[str, Any]:
        """Publish a trainer's team on pokepast.es (public: anyone with the link can read it) and give its link."""
        t = self.store.trainer(trainer_id)
        if not t.get("team"):
            raise SilverError("empty_team", f"{t['name']} has no team.")
        fields = {"paste": self.export_team(t["team"]), "title": str(t["name"])[:100],
                  "author": str(self.settings["player_name"] or "")[:60], "notes": f"Format: {t['format']}"}
        try:
            location = self._pokepaste_post(fields)
        except SilverError:
            raise
        except Exception as exc:  # noqa: BLE001 - offline or blocked
            raise SilverError("unavailable", f"pokepast.es did not answer: {exc}") from None
        pid = location.rstrip("/").rsplit("/", 1)[-1]
        url = location if location.startswith("http") else f"https://pokepast.es/{pid}"
        self.emit("trainer.pokepaste", {"id": trainer_id, "url": url})
        return {"url": url, "name": t["name"]}

    def unbound_save_import(self, data: bytes, *, name: str = "", format_: str = "") -> dict[str, Any]:
        """The party of a Pokémon Unbound save file (.sav / .srm) as a new trainer: species and formes, held items, the ability each
        one really has (Unbound's own, hidden ones included), moves, levels, natures, EVs, IVs, nicknames and shininess, played as
        generation 8 custom games like the Unbound Battle Frontier trainers. Eggs and anything Showdown does not know are left out and
        listed in ``skipped``."""
        try:
            party = unbound_save.read_party(data)
        except unbound_save.NotASave as exc:
            raise SilverError("invalid", str(exc), hint="Pick the .sav (or .srm) file your emulator writes for Pokémon Unbound 2.1.") from None
        if not party["sets"]:
            raise SilverError("empty_team", "The save has no Pokémon in the party.")
        t = self.trainer_create(name=name or party["player"] or "Mi partida de Unbound", paste=unbound_save.showdown(party["sets"]),
                                format_=format_ or "gen8customgame", origin="own",
                                notes="Equipo importado de una partida de Pokémon Unbound." + (f" No se pudo traer: {', '.join(party['skipped'])}." if party["skipped"] else ""))
        self.emit("trainer.unbound_import", {"id": t["id"], "count": len(party["sets"])})
        return {"kind": "trainer", "trainer": t, "player": party["player"], "skipped": party["skipped"]}

    def import_any(self, content: Any, *, name: str = "", format_: str = "") -> dict[str, Any]:
        """Import a share code, a result code, a .hoardtrainer/.hoardgym/.hoardleague file, a playable page, Showdown team text, a
        pokepast.es link or a Pokémon Unbound save file (its party)."""
        if isinstance(content, (bytes, bytearray)) and unbound_save.looks_like_save(bytes(content)):
            return self.unbound_save_import(bytes(content), name=name, format_=format_)
        if isinstance(content, str) and self.POKEPASTE.match(content):
            return self.import_pokepaste(content, name=name, format_=format_)
        try:
            candidate = json.loads(content) if isinstance(content, (str, bytes, bytearray)) else content
        except ValueError:
            candidate = None
        if isinstance(candidate, dict) and candidate.get("kind") == "silvers-hoard/exercise":
            return {"kind": "exercise", "exercise": self.training.import_(json.dumps(candidate))}
        kind, payload = sharing.parse_any(content)
        if kind == "result":
            return {"kind": "result", **self.import_result(payload)}
        if kind == "mass_result":
            return {"kind": "mass_result", **self.mass.import_result(payload)}
        if kind == "mass_page":
            return {"kind": "mass", "mass": self.mass.import_page(payload)}
        if kind == "paste":
            t = self.trainer_create(name=name or "Equipo importado", paste=payload, format_=format_, origin="own")
            return {"kind": "trainer", "trainer": t}
        if kind == "team":
            t = self.trainer_create(name=name or payload.get("name") or "Equipo importado", team=payload.get("team") or payload.get("sets"),
                                    format_=format_ or payload.get("format") or "", origin="own")
            return {"kind": "trainer", "trainer": t}
        if kind == "trainer":
            return {"kind": "trainer", "trainer": self.trainer_get(self._import_trainer(payload))}
        if kind == "gym":
            return {"kind": "gym", "gym": self.gym_get(self._import_gym(payload))}
        if kind == "league":
            gyms = [self._import_gym(g) for g in payload.get("gyms") or []]
            elite = [self._import_trainer(t) for t in payload.get("elite_four") or []]
            champ = self._import_trainer(payload["champion"])
            lid = self.store.add_league({"name": str(payload.get("name") or "Liga")[:80], "description": str(payload.get("description") or "")[:2000],
                                         "format": payload.get("format") or self.settings["default_format"], "rules": payload.get("rules") or [],
                                         "level_rules": payload.get("level_rules") or {}, "gyms": gyms, "elite_four": elite, "champion_id": champ,
                                         "badges_required": int(payload.get("badges_required") or len(gyms)), "origin": "friend"})
            return {"kind": "league", "league": self.league_get(lid)}
        raise SilverError("invalid", "Nothing importable found.")

    def import_result(self, r: dict[str, Any]) -> dict[str, Any]:
        """A friend's result from a playable page: records the badge (when they won) and the battle with its log. Battles the friend
        played in real time come with their replay: they are replayed here and what the replay says is what counts."""
        stages_in = r.get("stages") if isinstance(r.get("stages"), list) else []
        fp = self._result_fingerprint(r)
        self._check_new_result(fp)
        if r.get("v") in (2, 3) or r.get("weekly") or any(isinstance(x, dict) and (x.get("rt") or x.get("input")) for x in stages_in):
            return self._import_rt_result(r)
        kind = r.get("kind")
        target = r.get("gym_id") or r.get("trainer_id") or ""
        challenger = str(r.get("challenger") or "Amigo")[:60]
        won = bool(r.get("won"))
        lines = r.get("log") or []
        p_friend = {"trainer_id": "", "name": challenger, "avatar": "", "avatar_url": "", "human": True, "ai": None, "sets": r.get("team") or []}
        if kind == "gym":
            gyms = [g for g in self.store.gyms() if g["id"] == target] or [g for g in self.store.gyms() if g["name"] == r.get("gym_name")]
            if not gyms:
                raise SilverError("not_found", f"This result is for a gym you do not have here: {r.get('gym_name')}")
            g = gyms[0]
            leader = self.store.trainer(g["leader_id"], deleted=True)
            bid = self.store.add_battle({"kind": "friend", "status": "ended", "format": g["format"], "rules": g.get("rules") or [], "p1": p_friend,
                                         "p2": {"trainer_id": leader["id"], "name": leader["name"], "avatar": leader["avatar"],
                                                "avatar_url": self.avatar_url(leader["avatar"]), "human": False, "ai": {"level": leader["ai_level"], "style": leader["ai_style"]}},
                                         "winner_side": "p1" if won else "p2", "winner_name": challenger if won else leader["name"],
                                         "turns": int(r.get("turns") or 0), "log_text": "\n".join(str(x) for x in lines[:20000]),
                                         "summary": {"from_friend": True, "stages": r.get("stages") or []}, "title": f"{g['name']} · {challenger}"})
            badge = None
            if won:
                badge = self.store.add_badge({"gym_id": g["id"], "gym_name": g["name"], "badge": g["badge"], "badge_color": g["badge_color"], "badge_image": g.get("badge_image") or "",
                                              "challenger_name": challenger, "source": "friend", "battle_id": bid,
                                              "proof": {k: r.get(k) for k in ("turns", "date", "team_paste", "stages")}})
            self.emit("friend.result", {"gym": g["name"], "challenger": challenger, "won": won})
            self._record_friend_result(r, "gym", g, challenger=challenger, won=won, battle_id=bid, badge_id=badge or "", fp=fp)
            return {"gym": self.gym_view(g), "won": won, "battle_id": bid, "badge_id": badge, "challenger": challenger}
        if kind == "trainer":
            try:
                t = self.store.trainer(target)
            except SilverError:
                found = [x for x in self.store.trainers(query=r.get("trainer_name") or "") if x["name"] == r.get("trainer_name")]
                if not found:
                    raise SilverError("not_found", f"This result is for a trainer you do not have here: {r.get('trainer_name')}") from None
                t = found[0]
            bid = self.store.add_battle({"kind": "friend", "status": "ended", "format": t["format"], "p1": p_friend,
                                         "p2": {"trainer_id": t["id"], "name": t["name"], "avatar": t["avatar"], "avatar_url": self.avatar_url(t["avatar"]),
                                                "human": False, "ai": {"level": t["ai_level"], "style": t["ai_style"]}},
                                         "winner_side": "p1" if won else "p2", "winner_name": challenger if won else t["name"], "turns": int(r.get("turns") or 0),
                                         "log_text": "\n".join(str(x) for x in lines[:20000]), "summary": {"from_friend": True}, "title": f"{t['name']} · {challenger}"})
            self.store.record_result(t["id"], "loss" if won else "win")
            self._record_friend_result(r, "trainer", t, challenger=challenger, won=won, battle_id=bid, fp=fp)
            return {"trainer": self.trainer_view(t), "won": won, "battle_id": bid, "challenger": challenger}
        raise SilverError("invalid", "Unknown result.")

    # ------------------------------------------------------------ real time on the friends' pages
    def _stage_trainers(self, kind: str, obj: dict[str, Any]) -> list[dict[str, Any]]:
        """Who a friend fights on a playable page, in order: a gym's trainers and then its leader, or the trainer alone."""
        if kind == "gym":
            return [*self._gym_trainers(obj), self.store.trainer(obj["leader_id"], deleted=True)]
        return [obj]

    def _rt_key(self, trainer: dict[str, Any], rt_format: str, level_rules: dict[str, Any]) -> str:
        """What a real-time result must have been played against: the trainer's team and AI, the format and the level rules."""
        return sharing.fingerprint({"team": trainer["team"], "ai": [trainer["ai_level"], trainer["ai_style"]], "format": rt_format,
                                    "level_rules": level_rules or {}})

    def _rt_page_info(self, kind: str, obj: dict[str, Any]) -> dict[str, Any]:
        """The real-time data of a playable page: the format the arena plays (singles), the arena, the time limit, the rules version
        and a key per opponent that the result code repeats, so the replay is checked against the same teams."""
        level_rules = (obj.get("level_rules") or {}) if kind == "gym" else {}
        rt_fmt = self._rt_format(obj["format"])
        limit = max(30, min(int(self.settings.get("rt_time_limit") or 300), 1800))
        arena = self.arenas.spec(obj["rt_arena"]) if kind == "gym" and obj.get("rt_arena") else "rocks"
        if isinstance(arena, dict):
            arena = {k: arena[k] for k in ("name", "floor", "rocks")}
        return {"format": rt_fmt, "arena": arena, "time_limit": limit, "version": RT_RULES_VERSION,
                "silver_special": bool(self.settings.get("rt_silver_special", False)),
                "keys": {t["id"]: self._rt_key(t, rt_fmt, level_rules) for t in self._stage_trainers(kind, obj)}}

    def _import_rt_result(self, r: dict[str, Any]) -> dict[str, Any]:
        """A result with real-time battles. Each of them is replayed with the real-time simulator from its seed and input log against
        the opponent as this app has it; the badge or the win is only recorded when every replay agrees with the code."""
        kind = r.get("kind")
        challenger = str(r.get("challenger") or "Amigo")[:60]
        team, stages = r.get("team"), r.get("stages")
        if not isinstance(team, list) or not 1 <= len(team) <= 6 or not all(isinstance(x, dict) for x in team):
            raise SilverError("invalid", "The result has no valid team.")
        if not isinstance(stages, list) or not 1 <= len(stages) <= 40 or not all(isinstance(x, dict) for x in stages):
            raise SilverError("invalid", "The result has no battles.")
        target = r.get("gym_id") or r.get("trainer_id") or ""
        if kind == "gym":
            gyms = [g for g in self.store.gyms() if g["id"] == target] or [g for g in self.store.gyms() if g["name"] == r.get("gym_name")]
            if not gyms:
                raise SilverError("not_found", f"This result is for a gym you do not have here: {r.get('gym_name')}")
            obj = gyms[0]
            fmt, rules, level_rules, label = obj["format"], obj.get("rules") or [], obj.get("level_rules") or {}, obj["name"]
        elif kind == "trainer":
            try:
                obj = self.store.trainer(target)
            except SilverError:
                found = [x for x in self.store.trainers(query=r.get("trainer_name") or "") if x["name"] == r.get("trainer_name")]
                if not found:
                    raise SilverError("not_found", f"This result is for a trainer you do not have here: {r.get('trainer_name')}") from None
                obj = found[0]
            fmt, rules, level_rules, label = obj["format"], [], {}, obj["name"]
        else:
            raise SilverError("invalid", "Unknown result.")
        order = self._stage_trainers(kind, obj)
        walked = r.get("order")   # a gym map: the battles came in the order the friend met the trainers, the leader last
        if kind == "gym" and isinstance(walked, list) and walked:
            by_id = {t["id"]: t for t in order}
            if sorted(map(str, walked)) != sorted(by_id) or walked[-1] != order[-1]["id"]:
                raise SilverError("invalid", "The order of the battles in this result is damaged.")
            order = [by_id[i] for i in walked]
        fp = self._result_fingerprint(r)
        self._check_new_result(fp)
        week = str(r.get("weekly") or "")
        if week and not WEEK_RE.match(week):
            raise SilverError("invalid", "The week of this challenge is damaged.")
        weekly = self.weekly_info(kind, obj, week) if week else None
        if weekly and any(x.get("rt") is not None or x.get("input") is None for x in stages):
            raise SilverError("invalid", "A week's challenge is played turn by turn and every battle carries its record.")
        if len(stages) > len(order):
            raise SilverError("conflict", f"The result has more battles than {label} has opponents: it was made from another version.")
        if any(not x.get("won") for x in stages[:-1]):
            raise SilverError("invalid", "The result has battles after a lost one.")
        won = len(stages) == len(order) and all(bool(x.get("won")) for x in stages)
        if bool(r.get("won")) != won:
            raise SilverError("invalid", "The result does not match its battles: the code was altered.")
        info = self.format_info(fmt, rules)
        if not info.get("random"):
            verdict = self.validate_team(fmt, team, rules, level_rules)
            if not verdict.get("ok"):
                raise SilverError("invalid", "The friend's team does not follow the rules of this challenge: " + "; ".join(verdict.get("problems") or [])[:300])
        if weekly and weekly.get("rule"):
            self._check_week_rule(weekly["rule"], fmt, team, rules, level_rules)
        rt_fmt = self._rt_format(fmt)
        p_friend = {"trainer_id": "", "name": challenger, "avatar": "", "avatar_url": "", "human": True, "ai": None, "sets": team}
        replays: dict[int, dict[str, Any]] = {}
        turn_replays: dict[int, dict[str, Any]] = {}
        for i, stage in enumerate(stages):
            rt = stage.get("rt")
            if rt is None:
                # a battle played turn by turn: replayed from its record when the page sent it (older pages did not)
                if stage.get("input") is not None:
                    turn_replays[i] = self._check_turn_stage(stage, order[i], fmt, rules, level_rules, team, str(r.get("ai_version") or ""),
                                                             expect_seed=f"{weekly['seed']}-{i}" if weekly else "")
                continue
            opp = order[i]
            if not isinstance(rt, dict):
                raise SilverError("invalid", "The real-time replay inside the code is damaged.")
            if rt.get("trainer") != opp["id"] or rt.get("key") != self._rt_key(opp, rt_fmt, level_rules):
                raise SilverError("conflict", f"This result was played against another version of {opp['name']}: {label} changed after the page was exported.",
                                  hint="Export the page again and ask your friend to play it again.")
            version, arena, seed, limit = rt.get("v"), rt.get("arena"), rt.get("seed"), rt.get("limit")
            special = {"silver_special": rt.get("silver_special")} if type(version) is int and version >= 11 else {}
            forfeit, tick = rt.get("forfeit") or "", rt.get("tick") or 0
            if isinstance(arena, dict):   # a gym's own arena: it must be the one the gym has here
                own = self.arenas.spec(obj["rt_arena"]) if kind == "gym" and ARENA_CUSTOM.match(obj.get("rt_arena") or "") else None
                if not own or not arenas_same(own, arena):
                    raise SilverError("conflict", f"This result was played on another arena: {label} changed after the page was exported.",
                                      hint="Export the page again and ask your friend to play it again.")
                arena = own
            if (type(version) is not int or not 1 <= version <= RT_RULES_VERSION or not (arena in RT_ARENAS or isinstance(arena, dict))
                    or type(limit) is not int or not 30 <= limit <= 1800
                    or not isinstance(seed, str) or not 1 <= len(seed) <= 64 or forfeit not in ("", "p1") or type(tick) is not int or not 0 <= tick <= 1800 * 30 + 150):
                raise SilverError("invalid", "The real-time replay inside the code is damaged.")
            if special and type(special["silver_special"]) is not bool:
                raise SilverError("invalid", "The real-time replay is missing its Silver special option.")
            inputs = sharing.decode_rt_inputs(rt.get("inputs"))
            spec = {"id": f"friend-{seed}"[:80], "seed": seed, "format": rt_fmt, "level_rules": level_rules, "time_limit": limit, "version": version, "arena": arena,
                    **special, "p1": {"name": challenger, "sets": team, "ai": None},
                    "p2": {"name": opp["name"], "sets": opp["team"], "ai": {"level": opp["ai_level"], "style": opp["ai_style"]}}}
            res = self.engine.run_job("rt_replay", {"spec": spec, "inputs": inputs, "forfeit": forfeit, "tick": tick}, timeout=600)
            replayed_win = (res.get("summary") or {}).get("winner_side") == "p1"
            if not res.get("ended") or replayed_win != bool(stage.get("won")):
                raise SilverError("invalid", f"The replay of the battle against {opp['name']} does not end as the code says: the code was altered or is damaged.",
                                  hint="Ask your friend to send the result again, as a file if the code is long.")
            replays[i] = {"res": res, "opp": opp, "limit": limit, "version": version, "arena": arena, "seed": seed, **special}
        # everything checked: now it is recorded
        battle_ids: dict[int, str] = {}
        for i, tp in turn_replays.items():
            opp, res = tp["opp"], tp["res"]
            p_opp = {"trainer_id": opp["id"], "name": opp["name"], "avatar": opp["avatar"], "avatar_url": self.avatar_url(opp["avatar"]), "human": False,
                     "ai": {"level": opp["ai_level"], "style": opp["ai_style"]}, "sets": opp["team"]}
            battle_ids[i] = self.store.add_battle({
                "kind": "friend", "status": "ended", "format": fmt, "rules": rules, "level_rules": level_rules, "p1": p_friend, "p2": p_opp,
                "winner_side": res.get("winner_side") or "", "winner_name": challenger if res.get("winner_side") == "p1" else opp["name"] if res.get("winner_side") else "",
                "turns": int(res.get("turns") or 0), "log_text": "\n".join(res.get("lines") or []),
                "summary": {"from_friend": True, "replayed": True, "ai_checked": tp["ai_checked"], "ai_decisions": res.get("ai_decisions", 0)},
                "title": f"{label} · {challenger}" if len(order) == 1 else f"{label} · {opp['name']} · {challenger}"})
        for i, rp in replays.items():
            opp, res = rp["opp"], rp["res"]
            summary = res.get("summary") or {}
            p_opp = {"trainer_id": opp["id"], "name": opp["name"], "avatar": opp["avatar"], "avatar_url": self.avatar_url(opp["avatar"]), "human": False,
                     "ai": {"level": opp["ai_level"], "style": opp["ai_style"]}, "sets": opp["team"]}
            battle_ids[i] = self.store.add_battle({
                "kind": "friend", "mode": "realtime", "status": "ended", "format": rt_fmt, "rules": [], "level_rules": level_rules, "seed": rp["seed"],
                "p1": p_friend, "p2": p_opp, "winner_side": summary.get("winner_side", ""), "winner_name": summary.get("winner", ""), "turns": 0,
                "log_text": "\n".join(res.get("lines") or []), "summary": {**summary, "from_friend": True},
                "replay": {"time_limit": rp["limit"], "inputs": res.get("inputs") or [], "tick": int(round((res.get("seconds") or 0) * 30)),
                           "version": rp["version"], "arena": rp["arena"],
                           **({"silver_special": rp["silver_special"]} if "silver_special" in rp else {})},
                "title": f"{label} · {challenger}" if len(order) == 1 else f"{label} · {opp['name']} · {challenger}"})
        stage_info = [{"name": x.get("name") or order[i]["name"], "won": bool(x.get("won")), "turns": int(x.get("turns") or 0),
                       "mode": "realtime" if i in replays else "classic", **({"battle_id": battle_ids[i]} if i in battle_ids else {}),
                       **({"replayed": True} if i in replays or i in turn_replays else {})} for i, x in enumerate(stages)]
        if len(replays) + len(turn_replays) == len(stages):
            bid = battle_ids[len(stages) - 1]   # everything in real time: the last battle is the record
        else:
            lines = r.get("log") or []
            leader = order[len(stages) - 1]
            bid = self.store.add_battle({"kind": "friend", "status": "ended", "format": fmt, "rules": rules, "p1": p_friend,
                                         "p2": {"trainer_id": leader["id"], "name": leader["name"], "avatar": leader["avatar"], "avatar_url": self.avatar_url(leader["avatar"]),
                                                "human": False, "ai": {"level": leader["ai_level"], "style": leader["ai_style"]}},
                                         "winner_side": "p1" if won else "p2", "winner_name": challenger if won else leader["name"], "turns": int(r.get("turns") or 0),
                                         "log_text": "\n".join(str(x) for x in lines[:20000]), "summary": {"from_friend": True, "stages": stage_info},
                                         "title": f"{label} · {challenger}"})
        proof = {k: r.get(k) for k in ("turns", "date", "team_paste")}
        proof.update({"stages": stage_info, "verified_real_time": len(replays), "verified_turns": len(turn_replays),
                      "verified": len(replays) + len(turn_replays) == len(stages),
                      "ai_checked": all(tp["ai_checked"] for tp in turn_replays.values()), **({"week": week} if week else {})})
        last = turn_replays.get(len(stages) - 1)
        extra = {"verified": proof["verified"], "week": week, "mode": "realtime" if replays else "classic",
                 "hp_left": float((last or {}).get("res", {}).get("hp_left") or 0),
                 "turns": sum(int(turn_replays[i]["res"].get("turns") or 0) if i in turn_replays else int(x.get("turns") or 0) for i, x in enumerate(stages))}
        if kind == "gym":
            badge = None
            if won:
                badge = self.store.add_badge({"gym_id": obj["id"], "gym_name": obj["name"], "badge": obj["badge"], "badge_color": obj["badge_color"],
                                              "badge_image": obj.get("badge_image") or "", "challenger_name": challenger, "source": "friend", "battle_id": bid,
                                              "proof": proof})
            self.emit("friend.result", {"gym": obj["name"], "challenger": challenger, "won": won})
            self._record_friend_result(r, "gym", obj, challenger=challenger, won=won, battle_id=bid, badge_id=badge or "", fp=fp, battles=len(order), **extra)
            return {"gym": self.gym_view(obj), "won": won, "battle_id": bid, "badge_id": badge, "challenger": challenger, "verified_real_time": len(replays),
                    "verified_turns": len(turn_replays), "verified": proof["verified"], **({"week": week} if week else {})}
        self.store.record_result(obj["id"], "loss" if won else "win")
        self._record_friend_result(r, "trainer", obj, challenger=challenger, won=won, battle_id=bid, fp=fp, battles=len(order), **extra)
        return {"trainer": self.trainer_view(obj), "won": won, "battle_id": bid, "challenger": challenger, "verified_real_time": len(replays),
                "verified_turns": len(turn_replays), "verified": proof["verified"], **({"week": week} if week else {})}

    # ------------------------------------------------------------ friends' leaderboard and the week's challenge
    @staticmethod
    def current_week(today: Optional[_dt.date] = None) -> str:
        """The ISO week, as 2026-W42."""
        y, w, _ = (today or _dt.date.today()).isocalendar()
        return f"{y}-W{w:02d}"

    def weekly_info(self, kind: str, obj: dict[str, Any], week: str = "") -> dict[str, Any]:
        """The week's challenge of a gym or a trainer: everyone who plays its page that week fights with the same seed and the same AI
        luck (battle i of the page uses ``seed-i`` for both), so results compare fairly; the replay checks it."""
        week = week or self.current_week()
        out = {"week": week, "seed": hashlib.sha1(f"silver-weekly:{kind}:{obj['id']}:{week}".encode()).hexdigest()[:16]}
        # the rule friends voted for that week (friends.py): a Pokémon the team must include, or a team-building rule
        rule = self.friends.week_rule(week)
        if rule:
            out["rule"] = {"kind": rule["kind"], "value": rule["value"]}
        return out

    def _check_week_rule(self, rule: dict[str, Any], fmt: str, team: list[dict[str, Any]], rules: list[str], level_rules: dict[str, Any]) -> None:
        """The week's voted rule, checked on the team a friend's result brings back."""
        if rule["kind"] == "pokemon":
            want = re.sub(r"[^a-z0-9]", "", str(rule["value"]).lower())
            have = {re.sub(r"[^a-z0-9]", "", str(x.get("species") or "").lower()) for x in team}
            base = {h.split("mega")[0] for h in have}
            if want not in have and want not in base:
                raise SilverError("invalid", f"The week's challenge asks for {rule['value']} in the team, and this one does not have it.")
        else:
            verdict = self.validate_team(fmt, team, [*rules, rule["value"]], level_rules)
            if not verdict.get("ok"):
                raise SilverError("invalid", f"The team does not follow the week's rule ({rule['value']}): " + "; ".join(verdict.get("problems") or [])[:300])

    @staticmethod
    def _result_fingerprint(r: dict[str, Any]) -> str:
        return sharing.fingerprint({k: v for k, v in r.items() if k != "log"})

    def _check_new_result(self, fp: str) -> None:
        seen = self.store.friend_result_by_fingerprint(fp)
        if seen:
            raise SilverError("conflict", f"This result was already imported: {seen['challenger']} against {seen['target_name']}.",
                              hint="Each result code counts once in the friends' leaderboard.")

    def _record_friend_result(self, r: dict[str, Any], kind: str, obj: dict[str, Any], *, challenger: str, won: bool, battle_id: str, fp: str,
                              badge_id: str = "", battles: int = 0, verified: bool = False, week: str = "", mode: str = "classic",
                              hp_left: float = 0.0, turns: Optional[int] = None) -> str:
        stages = [x for x in (r.get("stages") or []) if isinstance(x, dict)]
        return self.store.add_friend_result({
            "kind": kind, "target_id": obj["id"], "target_name": obj["name"], "challenger": challenger, "won": int(won),
            "battles": battles or max(len(stages), 1), "battles_won": sum(1 for x in stages if x.get("won")) if stages else int(won),
            "turns": int(r.get("turns") or 0) if turns is None else turns, "hp_left": round(float(hp_left), 1), "verified": int(verified),
            "week": week, "mode": mode, "battle_id": battle_id or "", "badge_id": badge_id or "", "fingerprint": fp,
            "played_at": str(r.get("date") or "")[:40]})

    @staticmethod
    def _rank_key(x: dict[str, Any]) -> tuple:
        # a full win first, then checked by replaying, then the furthest battle, the fewest turns, the most HP left, the earliest
        return (x["won"], x["verified"], x["battles_won"], -x["turns"], x["hp_left"], -x["created_at"])

    def leaderboard(self, kind: str = "", target_id: str = "", week: str = "") -> dict[str, Any]:
        """Friends' results per gym or trainer with the best result of each friend. ``week``: empty for every result, ``current`` for
        this week's challenge, or a week like 2026-W42."""
        current = self.current_week()
        if week == "current":
            week = current
        if week and not WEEK_RE.match(week):
            raise SilverError("invalid", "week is empty, current or like 2026-W42")
        rows = self.store.friend_results(kind=kind, target_id=target_id, week=week)
        gyms = {g["id"]: g for g in self.store.gyms()}
        groups: dict[tuple[str, str], list[dict[str, Any]]] = {}
        for x in rows:
            groups.setdefault((x["kind"], x["target_id"]), []).append(x)
        boards = []
        for (k, tid), items in groups.items():
            best: dict[str, dict[str, Any]] = {}
            tries: dict[str, list[str]] = {}
            for x in items:
                who = x["challenger"].strip().lower()
                tries.setdefault(who, []).append(x["id"])
                if who not in best or self._rank_key(x) > self._rank_key(best[who]):
                    best[who] = x
            ranked = sorted(best.values(), key=self._rank_key, reverse=True)
            g = gyms.get(tid) if k == "gym" else None
            boards.append({"kind": k, "target_id": tid, "target_name": (g or {}).get("name") or items[0]["target_name"], "results": len(items),
                           **({"badge": g.get("badge", ""), "badge_color": g.get("badge_color", ""), "badge_image": g.get("badge_image", "")} if g else {}),
                           "entries": [{"rank": i + 1, "id": x["id"], "ids": tries[x["challenger"].strip().lower()], "challenger": x["challenger"],
                                        "won": bool(x["won"]), "verified": bool(x["verified"]), "battles": x["battles"], "battles_won": x["battles_won"],
                                        "turns": x["turns"], "hp_left": x["hp_left"], "week": x["week"], "mode": x["mode"], "battle_id": x["battle_id"],
                                        "played_at": x["played_at"], "attempts": len(tries[x["challenger"].strip().lower()])}
                                       for i, x in enumerate(ranked)]})
        boards.sort(key=lambda b: (-b["results"], b["target_name"].lower()))
        return {"week": week, "current_week": current, "weeks": self.store.friend_weeks(), "boards": boards, "total": len(rows)}

    def leaderboard_remove(self, ids: list[str]) -> dict[str, Any]:
        """Take results off the friends' leaderboard (their battles and badges stay)."""
        return {"removed": self.store.delete_friend_results(ids)}

    def ai_version(self) -> str:
        """A fingerprint of the trainers' AI as playable pages carry it (its code and the simulator's version): a result whose page has
        the same one must show exactly the choices the AI makes again."""
        h = hashlib.sha1()
        src = self.config.engine_dir / "src"
        for name in ("ai.mjs", "belief.mjs", "match.mjs", "core.mjs"):
            with contextlib.suppress(OSError):
                h.update((src / name).read_bytes())
        with contextlib.suppress(OSError):
            h.update((REPO_ROOT / "node_modules" / "@pkmn" / "sim" / "package.json").read_bytes())
        return h.hexdigest()[:12]

    def _check_turn_stage(self, stage: dict[str, Any], opp: dict[str, Any], fmt: str, rules: list[str], level_rules: dict[str, Any],
                          team: list[dict[str, Any]], ai_version: str, expect_seed: str = "") -> dict[str, Any]:
        """Replay one turn-based battle of a friend's result from the page's record: the teams must be the expected ones, every choice
        legal and the end the one the code says; with the same AI version, the opponent's choices must be the AI's own."""
        record, rng, forfeit = stage.get("input"), str(stage.get("rng") or "")[:80], stage.get("forfeit") or ""
        if (not isinstance(record, list) or not 3 <= len(record) <= 20000 or not all(isinstance(x, str) and len(x) <= 20000 for x in record)
                or forfeit not in ("", "p1")):
            raise SilverError("invalid", f"The record of the battle against {opp['name']} inside the code is damaged.")
        res = self.engine.run_job("replay_check", {"input": record, "format": fmt, "rules": rules, "level_rules": level_rules, "p1_sets": team,
                                                   "p2_sets": opp["team"], "ai": {"level": opp["ai_level"], "style": opp["ai_style"],
                                                   **({"phase": self._phase_of(opp.get("dialogue"))} if self._phase_of(opp.get("dialogue")) else {})}, "rng_id": rng,
                                                   "forfeit": forfeit, **({"expect_seed": expect_seed} if expect_seed else {})}, timeout=900)
        if res.get("problems"):
            raise SilverError("invalid", f"The battle against {opp['name']} does not replay: {'; '.join(res['problems'])[:300]}.",
                              hint="If the page is older than a change to the challenge, export it again.")
        if not res.get("ended") or (res.get("winner_side") == "p1") != bool(stage.get("won")):
            raise SilverError("invalid", f"The replay of the battle against {opp['name']} does not end as the code says: the code was altered or is damaged.")
        same = bool(ai_version) and ai_version == self.ai_version()
        if same and res.get("ai_mismatches"):
            raise SilverError("invalid", f"In the battle against {opp['name']} the opponent's choices are not the ones its AI makes: the code was altered.")
        return {"res": res, "opp": opp, "ai_checked": same}

    def export_file(self, filename: str) -> Path:
        if not sharing.re.match(r"^[\w\- ]+\.(html|hoardtrainer|hoardgym|hoardleague|silverexercise|mp4|webm)$", filename, flags=sharing.re.UNICODE):
            raise SilverError("invalid", "Not an export file.")
        path = self.config.exports_dir / filename
        if not path.exists():
            raise SilverError("not_found", f"Export not found: {filename}")
        return path

    # ------------------------------------------------------------ popular sets and usage (data.pkmn.cc)
    def _sets_format(self, format_: str) -> str:
        return format_ or str(self.settings["default_format"])

    def sets_popular(self, species: str, format_: str = "") -> dict[str, Any]:
        """Smogon's sets of a species for a format (or the nearest one with data: National Dex for National Dex AG, the
        generation's OU for custom games, Pokémon Champions last) and its usage on Showdown's ladder: items, abilities, moves,
        Tera types, teammates. The name may be written as a person writes it ("Mega Delphox", "Shaymin Forma Cielo"); a Mega
        Evolution gets its base species' sets that hold its stone."""
        fmt = self._sets_format(format_)
        try:
            sp = self.resolve_species(species, self._format_gen(fmt))
        except SilverError:
            return self.smogon.sets(species, fmt)
        base, stone = self._mega_base(sp)
        out = self.smogon.sets(base or sp["name"], fmt)
        if stone:
            want = re.sub(r"[^a-z0-9]", "", stone.lower())
            out["sets"] = [{**x, "item": stone} for x in out["sets"] if want in {re.sub(r"[^a-z0-9]", "", str(i).lower()) for i in x["item_options"] or [x["item"]]}]
            if not out["sets"]:
                found = self.smogon.popular_set(sp["name"], fmt, base=base, item=stone)
                if found:
                    out.update({"sets": [found["set"]], "format": found["format"], "set_source": found["source"]})
        out.update({"asked": species, "species": sp["name"], "team_species": base or sp["name"], "item_required": stone})
        return out

    # ------------------------------------------------------------ names and teams of popular sets
    def _format_gen(self, fmt: str) -> int:
        try:
            return int(self.format_info(fmt).get("gen") or 9)
        except SilverError:
            m = re.match(r"gen(\d)", fmt or "")
            return int(m.group(1)) if m else 9

    def resolve_species(self, name: str, gen: int = 9) -> dict[str, Any]:
        """A Pokémon written the way a person writes it ("Mega Delphox", "Shaymin Forma Cielo", "Raichu alola", "Alolan
        Raichu") as Showdown's Pokédex knows it: name, base species, the item a Mega Evolution or Primal Reversion needs."""
        from .species_names import candidates as name_candidates

        names = name_candidates(name)
        found = self.engine.call("species_resolve", {"names": names, "gen": gen})["species"] if names else None
        if not found:
            word = max(re.findall(r"[^\W\d_]{3,}", str(name or "")) or [str(name or "")], key=len)
            near: list[str] = []
            # a typo ("Glaceonn") matches nothing whole: shorter and shorter beginnings of the word until something does
            for n in dict.fromkeys((len(word), len(word) - 1, 6, 5, 4, 3)):
                if n < 3 or n > len(word):
                    continue
                try:
                    near = [x["name"] for x in self.dex_search("species", word[:n], gen=gen, limit=6)]
                except SilverError:
                    near = []
                if near:
                    break
            raise SilverError("unknown_species", f"Unknown Pokémon: {name}", hint=("Did you mean: " + ", ".join(near)) if near else "")
        return found

    @staticmethod
    def _mega_base(sp: dict[str, Any]) -> tuple[str, str]:
        """(base species, stone) for a Mega Evolution or Primal Reversion, which a team holds as its base species with the item;
        ("", "") for anything else."""
        if (sp.get("mega") or sp.get("primal")) and sp.get("required_item") and sp.get("base_species") != sp.get("name"):
            return str(sp["base_species"]), str(sp["required_item"])
        return "", ""

    def team_popular_sets(self, species: list[str], *, trainer_id: str = "", format_: str = "", append: bool = False,
                          save: bool = True) -> dict[str, Any]:
        """A team of the given Pokémon, each with its most popular set (Smogon's written sets, Champions for the Mega
        Evolutions of Legends Z-A, or the ladder's most used build when there is no written one). With a trainer it becomes
        that trainer's team (or is added to it), unless a name is not a Pokémon: then nothing is saved and the names come
        back with suggestions."""
        names = [str(x).strip() for x in species or [] if str(x).strip()]
        if not names:
            raise SilverError("invalid", "Give at least one Pokémon.")
        if len(names) > 24:
            raise SilverError("invalid", "A team has at most 24 Pokémon.")
        if not self.settings["smogon_data"]:
            raise SilverError("invalid", "Popular sets are switched off (Settings, smogon_data).")
        t = self.store.trainer(trainer_id) if trainer_id else None
        fmt = format_ or (t["format"] if t else str(self.settings["default_format"]))
        gen = self._format_gen(fmt)
        team, members, problems = [], [], []
        for asked in names:
            try:
                sp = self.resolve_species(asked, gen)
            except SilverError as exc:
                problems.append({"asked": asked, "error": exc.message, "hint": exc.hint})
                continue
            base, stone = self._mega_base(sp)
            found = self.smogon.popular_set(sp["name"], fmt, base=base, item=stone)
            if not found or not found["set"].get("moves"):
                problems.append({"asked": asked, "species": sp["name"], "error": "No popular set or usage data for it.", "hint": ""})
                continue
            s = found["set"]
            member = {"species": base or sp["name"], "name": "", "moves": s["moves"], "item": s["item"],
                      "ability": s["ability"] or (sp["abilities"][0] if sp.get("abilities") else ""), "nature": s["nature"],
                      "evs": s["evs"], "ivs": s["ivs"], "teraType": s["teraType"]}
            if s.get("level"):
                member["level"] = s["level"]
            team.append(member)
            members.append({"asked": asked, "species": sp["name"], "team_species": member["species"], "set_name": s["name"],
                            "item": member["item"], "source": found["source"], "source_format": found["format"]})
        out: dict[str, Any] = {"trainer_id": trainer_id, "format": fmt, "members": members, "unresolved": problems, "saved": False,
                               "source": "Smogon sets and Showdown usage statistics via data.pkmn.cc"}
        if not team:
            out["team"] = []
            return out
        sets = self.import_team(team)["sets"]
        self.check_team(sets, fmt)
        out["team"] = sets
        out["paste"] = self.export_team(sets)
        if t and save and not problems:
            new_team = [*(t.get("team") or []), *sets] if append else sets
            if len(new_team) > 24:
                raise SilverError("invalid", "A team has at most 24 Pokémon.")
            view = self.trainer_update(t["id"], {"team": new_team})
            self.emit("trainer.updated", {"id": t["id"]})
            out.update({"saved": True, "trainer": {"id": view["id"], "name": view["name"], "species": view["species"]}})
        return out

    def usage_top(self, format_: str = "", limit: int = 30) -> dict[str, Any]:
        return self.smogon.top(self._sets_format(format_), limit)

    def sample_team(self, format_: str = "") -> dict[str, Any]:
        return self.smogon.sample_team(self._sets_format(format_))

    # ------------------------------------------------------------ a battle's replay as a video clip
    VIDEO_SPEEDS = {"slow": 1300, "normal": 900, "fast": 550}
    VIDEO_SIZES = {"720p": (1280, 720), "1080p": (1920, 1080)}

    @staticmethod
    def video_browser() -> str:
        """Chrome or Edge on this computer (the recorder drives the installed browser; nothing is downloaded)."""
        import os
        import shutil
        configured = os.environ.get("SILVER_BROWSER_EXECUTABLE", "").strip()
        if configured:
            return configured
        for name in ("chrome", "google-chrome", "chromium", "chromium-browser", "msedge"):
            found = shutil.which(name)
            if found:
                return found
        if os.name == "nt":
            for key in ("PROGRAMFILES", "PROGRAMFILES(X86)", "LOCALAPPDATA"):
                for rel in ("Google/Chrome/Application/chrome.exe", "Microsoft/Edge/Application/msedge.exe"):
                    path = Path(os.environ.get(key, "")) / rel
                    if path.is_file():
                        return str(path)
        return ""

    @staticmethod
    def _cmdline(proc: Any) -> list[str]:
        try:
            return proc.cmdline()
        except Exception:  # noqa: BLE001 - a process that is gone or not ours to read
            return []

    @staticmethod
    def _end_tree(roots: list[Any]) -> None:
        import psutil
        procs = []
        for root in roots:
            with contextlib.suppress(psutil.Error):
                procs += root.children(recursive=True) + [root]
        for proc in procs:
            with contextlib.suppress(psutil.Error):
                proc.kill()
        psutil.wait_procs(procs, timeout=5)

    def video_status(self) -> dict[str, Any]:
        import importlib.util
        import shutil
        return {"playwright": importlib.util.find_spec("playwright") is not None, "browser": self.video_browser(),
                "ffmpeg": shutil.which("ffmpeg") or "", "hint": "pip install -r requirements-video.txt, with Chrome or Edge installed; "
                "ffmpeg turns the recording into an MP4 (without it the clip stays WebM)."}

    def battle_video(self, id_: str, *, speed: str = "normal", size: str = "720p", lang: str = "", lumiere: bool = False) -> dict[str, Any]:
        """Record a finished battle's replay as a video clip (a job): the app's own replay page, alone on a 16:9 stage, played by a
        headless Chrome or Edge that captures the tab's picture and the page's sound (effects, cries, music) as it plays. The clip
        lands in the exports folder as MP4 (WebM without ffmpeg); lumiere=True also hands it to Lumiere's Hoard, the video editor."""
        b = self.store.battle(id_)
        if b["status"] != "ended" or not b.get("log_text"):
            raise SilverError("conflict", "Only a finished battle with its replay can be recorded.", hint="Wait for the battle to end.")
        if speed not in self.VIDEO_SPEEDS:
            raise SilverError("invalid", f"speed is one of {', '.join(self.VIDEO_SPEEDS)}")
        if size not in self.VIDEO_SIZES:
            raise SilverError("invalid", f"size is one of {', '.join(self.VIDEO_SIZES)}")
        status = self.video_status()
        if not status["playwright"] or not status["browser"]:
            raise SilverError("unavailable", "Recording needs Playwright and Chrome or Edge on this computer.", hint=status["hint"])
        lang = lang if lang in ("es", "en") else str(self.settings.get("language") or "es")[:2]
        title = f"Vídeo: {b.get('title') or (b['p1'].get('name', '') + ' vs ' + b['p2'].get('name', ''))}"
        return self._job("video", title, {"battle_id": id_, "speed": speed, "size": size, "lumiere": lumiere},
                         lambda jid, progress, cancelled: self._record_video(b, speed, size, lang, lumiere, status, progress, cancelled))

    def _record_video(self, b: dict[str, Any], speed: str, size: str, lang: str, lumiere: bool, status: dict[str, Any],
                      progress: Callable[[float], None], cancelled: Callable[[], bool], *, url_path: str = "", stem: str = "",
                      seconds: Optional[float] = None) -> dict[str, Any]:
        """``url_path`` (after #/), ``stem`` and ``seconds`` (how long the clip plays) record another page than a battle's replay
        (mass.py: a mass battle)."""
        import base64
        import subprocess
        import threading
        from playwright.sync_api import sync_playwright
        width, height = self.VIDEO_SIZES[size]
        exports = self.config.exports_dir
        exports.mkdir(parents=True, exist_ok=True)
        if not stem:
            stem = re.sub(r"[^\w\- ]+", "", f"{b['p1'].get('name', 'p1')} vs {b['p2'].get('name', 'p2')}", flags=re.UNICODE).strip()[:60] or "battle"
            stem = f"{stem} {b['id'][-6:]}"
        webm = exports / f"{stem}.webm"
        done = threading.Event()
        capture_requested = threading.Event()
        state: dict[str, Any] = {"error": "", "info": {}}
        lines = len(str(b.get("log_text") or "").split("\n"))
        # a generous ceiling: the clip's length when the caller knows it; every line at the slowest pause (a real-time battle: its
        # length at the replay's speed); plus the start and the end
        if seconds is not None:
            deadline = time.monotonic() + min(3600.0, 90 + seconds * 1.5)
        elif (b.get("mode") or "classic") == "realtime":
            seconds = float((b.get("summary") or {}).get("seconds") or 0) or (b.get("replay") or {}).get("tick", 0) / 30 or 600
            deadline = time.monotonic() + min(3600.0, 90 + seconds * 1.5 / (2 if self.VIDEO_SPEEDS[speed] < 700 else 1))
        else:
            deadline = time.monotonic() + min(3600.0, 60 + lines * 1.6 * self.VIDEO_SPEEDS[speed] / 1000)
        progress(0.02)
        import psutil
        me = psutil.Process()
        before = {p.pid for p in me.children()}
        runtime = sync_playwright().start()
        # this recording's Playwright driver: ending its process tree is how the recording ends (see below)
        driver = [p for p in me.children() if p.pid not in before and "run-driver" in " ".join(self._cmdline(p))]
        try:
            with open(webm, "wb") as sink:
                browser = runtime.chromium.launch(headless=True, executable_path=status["browser"], args=[
                    "--auto-accept-this-tab-capture", "--autoplay-policy=no-user-gesture-required", "--disable-renderer-backgrounding",
                    "--disable-background-timer-throttling", "--disable-backgrounding-occluded-windows", "--hide-scrollbars",
                    "--force-device-scale-factor=1", f"--window-size={width},{height}",
                    f"--screen-info={{{width * 2}x{height * 2}}}"])
                page = browser.new_page(viewport={"width": width, "height": height}, device_scale_factor=1,
                                        locale="es-ES" if lang == "es" else "en-US")
                # Tab capture records the real content area, not Playwright's emulated viewport.
                window = page.context.new_cdp_session(page)
                window_id = window.send("Browser.getWindowForTarget")["windowId"]
                window.send("Browser.setContentsSize", {"windowId": window_id, "width": width, "height": height})
                # Capture adds browser chrome after permission is granted; fit the content again before recording starts.
                page.expose_function("__videoCaptureRequested", capture_requested.set)
                page.expose_function("__videoChunk", lambda data: sink.write(base64.b64decode(data)))
                page.expose_function("__videoProgress", lambda x: progress(0.05 + 0.85 * max(0.0, min(1.0, float(x or 0)))))
                page.expose_function("__videoDone", lambda info: (state.update(info=info or {}), done.set()))
                page.expose_function("__videoError", lambda msg: (state.update(error=str(msg)[:300]), done.set()))
                path = url_path or f"video/{b['id']}?speed={self.VIDEO_SPEEDS[speed]}"
                url = f"http://127.0.0.1:{self.config.port}/?lang={lang}#/{path}&record=1&lang={lang}"
                page.goto(url, wait_until="load")
                page.evaluate("""() => {
                    window.__videoCaptureReady = () => new Promise(resolve => {
                        window.__videoCaptureResolve = resolve;
                        window.__videoCaptureRequested();
                    });
                }""")
                page.wait_for_function("window.__videoReady === true", timeout=60_000)
                page.evaluate("window.videoRecord()")
                while not done.is_set():
                    if capture_requested.is_set():
                        capture_requested.clear()
                        window.send("Browser.setContentsSize", {"windowId": window_id, "width": width, "height": height})
                        page.evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))")
                        page.evaluate("window.__videoCaptureResolve()")
                    if cancelled():
                        raise SilverError("cancelled", "Cancelled.")
                    if time.monotonic() > deadline:
                        raise SilverError("timeout", "The replay did not finish in time.")
                    page.wait_for_timeout(500)    # keeps the browser's callbacks (chunks, progress) flowing in this thread
        finally:
            # a browser that has captured its own tab takes a minute or more to close, and the driver waits for it: the file is
            # complete by now, so the driver and the browser it started are ended, then the runtime lets go at once
            started = time.monotonic()
            self._end_tree(driver)
            with contextlib.suppress(Exception):
                runtime.stop()
            log.info("video %s: browser ended in %.1f s", b["id"], time.monotonic() - started)
        if state["error"]:
            raise SilverError("unavailable", f"The recording failed: {state['error']}")
        progress(0.92)
        out = webm
        if status["ffmpeg"] and webm.stat().st_size > 0:
            mp4 = exports / f"{stem}.mp4"
            cmd = [status["ffmpeg"], "-y", "-hide_banner", "-loglevel", "error", "-i", str(webm), "-r", "30", "-c:v", "libx264", "-preset", "veryfast",
                   "-crf", "20", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", str(mp4)]
            r = subprocess.run(cmd, capture_output=True, text=True, timeout=1800,
                               creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
            if r.returncode == 0 and mp4.exists() and mp4.stat().st_size > 0:
                webm.unlink(missing_ok=True)
                out = mp4
            else:
                log.warning("ffmpeg could not convert %s: %s", webm.name, (r.stderr or "")[-300:])
        result: dict[str, Any] = {"file": out.name, "url": f"/api/exports/{out.name}", "bytes": out.stat().st_size, "path": str(out.resolve()),
                                  "seconds": round(float(state["info"].get("seconds") or 0), 1), "width": width, "height": height,
                                  "sound": bool(state["info"].get("sound")), "battle_id": b["id"]}
        if lumiere:
            sent = family.call("lumiere", "media_receive", {"path": str(out.resolve())}, timeout=120)
            result["lumiere"] = sent.get("result") if sent.get("ok") else {"error": sent.get("error") or sent.get("status")}
        self.emit("battle.video", {"id": b["id"], "file": out.name, "lumiere": lumiere})
        progress(1.0)
        return result

    # ------------------------------------------------------------ avatars from photos (here, or drawn by Prospero's Hoard)
    def avatar_from_photo(self, data: bytes, *, trainer_id: str = "", mode: str = "pixel", remove_background: bool = True,
                          cut_background: bool = False, kind: str = "", credit: str = "", source: str = "", title: str = "") -> dict[str, Any]:
        """A picture of your own as a trainer's avatar. pixel: background removed and shrunk to a 96 px sprite here; upload: the
        picture as it is (up to 1024 px, background kept unless ``cut_background``); prospero: drawn by Prospero's Hoard (a job).
        ``kind`` (photo, art, image), ``credit``, ``source`` and ``title`` are kept with the picture (official art says whose it is)."""
        if trainer_id:
            self.store.trainer(trainer_id)
        stem = trainer_id or "photo"
        if mode == "pixel":
            name = self.sprites.save_avatar(data, stem=stem, pixelate=True, remove_background=remove_background)
            self._avatar_meta_set(name, kind="sprite", source=source, title=title)
        elif mode == "upload":
            name = self.sprites.save_avatar(data, stem=stem if kind != "art" else f"{stem}-art", pixelate=False,
                                            remove_background=cut_background, max_side=1024)
            self._avatar_meta_set(name, kind=kind if kind in ("photo", "art", "image") else "image", credit=credit, source=source, title=title)
        elif mode == "prospero":
            return self.avatar_draw([data], trainer_id=trainer_id)
        else:
            raise SilverError("invalid", "mode is pixel, upload or prospero")
        if trainer_id:
            self.store.update_trainer(trainer_id, {"avatar": f"file:{name}"})
            self.emit("trainer.updated", {"id": trainer_id})
        return {"file": name, "url": f"/api/avatars/{name}", "avatar": f"file:{name}", "credit": credit}

    MAX_URL_PICTURE = 12 * 1024 * 1024

    def avatar_from_url(self, url: str, *, trainer_id: str = "", kind: str = "image", credit: str = "", title: str = "",
                        cut_background: bool = False) -> dict[str, Any]:
        """A picture on the internet as a trainer's avatar, downloaded here (some image servers, like the Pokémon Wiki's, answer
        browsers only: the app's picture dialog fetches those itself)."""
        url = (url or "").strip()
        if not re.match(r"^https?://[^\s/]+/\S+$", url):
            raise SilverError("invalid", "Give the address of a picture (http:// or https://).")
        try:
            status, data, ctype = self._http_get(url)
        except Exception as exc:  # noqa: BLE001
            raise SilverError("unavailable", f"The picture did not download: {exc}") from None
        if status in (401, 403, 429, 503) or (status == 200 and "text/html" in (ctype or "")):
            raise SilverError("unavailable", f"{url.split('/')[2]} turns away downloads that are not from a browser (it answered {status}).",
                              hint="Open the trainer's picture dialog in the app and paste the address there: the page fetches it.")
        if status != 200 or not data:
            raise SilverError("unavailable", f"The picture did not download (HTTP {status}).")
        if len(data) > self.MAX_URL_PICTURE:
            raise SilverError("too_large", "The picture is larger than 12 MB.")
        return self.avatar_from_photo(data, trainer_id=trainer_id, mode="upload", kind=kind, credit=credit, source=url, title=title,
                                      cut_background=cut_background)

    # what is known of each own picture (data/avatar_meta.json): kind (photo, art, image, sprite, drawing, pose), credit, source
    _meta_cache: tuple[float, dict[str, Any]] = (-1.0, {})

    def _avatar_meta(self) -> dict[str, Any]:
        path = self.config.data_dir / "avatar_meta.json"
        try:
            mtime = path.stat().st_mtime
        except OSError:
            return {}
        if self._meta_cache[0] != mtime:
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                data = {}
            self._meta_cache = (mtime, data if isinstance(data, dict) else {})
        return self._meta_cache[1]

    def _avatar_meta_set(self, name: str, **fields: Any) -> None:
        fields = {k: str(v)[:300] for k, v in fields.items() if v}
        if not fields:
            return
        index = dict(self._avatar_meta())
        index[name] = {**(index.get(name) or {}), **fields}
        path = self.config.data_dir / "avatar_meta.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        write_json_atomic(path, index)
        self._meta_cache = (-1.0, {})

    def avatar_credit(self, avatar: str) -> str:
        avatar = str(avatar or "")
        if avatar.startswith("sd:"):
            return self.credits.trainer(avatar[3:])
        if avatar.startswith("file:"):
            return str((self._avatar_meta().get(avatar[5:]) or {}).get("credit") or "")
        return ""

    def avatar_kind(self, avatar: str) -> str:
        """sprite (Showdown's), or what an own picture is: photo, art, image, sprite, drawing, pose."""
        avatar = str(avatar or "")
        if avatar.startswith("sd:"):
            return "sprite"
        if not avatar.startswith("file:"):
            return ""
        name = avatar[5:]
        return str((self._avatar_meta().get(name) or {}).get("kind") or next((k for rx, k in self._KIND_BY_NAME if rx.search(name)), "image"))

    _KIND_BY_NAME = ((re.compile(r"-ref\d+-"), "photo"), (re.compile(r"-drawing-"), "drawing"), (re.compile(r"-(back|win)-"), "pose"),
                     (re.compile(r"-art-"), "art"), (re.compile(r"(^|-)ai-|^prospero-ai-"), "sprite"))
    _img_sizes: dict[str, tuple[float, tuple[int, int]]] = {}
    _digests: dict[str, tuple[float, str]] = {}

    def avatar_images(self, *, query: str = "", kind: str = "", limit: int = 120) -> dict[str, Any]:
        """Your own pictures (uploaded, photos given to Prospero, drawn sprites and drawings, poses, official art you chose), the same
        picture once, newest first, with the trainers that use them. ``query`` matches a trainer's name, the kind or the title."""
        from PIL import Image
        meta = self._avatar_meta()
        trainers = self.store.trainers()
        by_id = {t["id"]: t["name"] for t in trainers}
        using: dict[str, list[str]] = {}
        for t in trainers:
            if str(t.get("avatar") or "").startswith("file:"):
                using.setdefault(t["avatar"][5:], []).append(t["name"])
        q = " ".join((query or "").lower().split())
        groups: dict[str, list[dict[str, Any]]] = {}
        for item in self.sprites.avatars():
            name = item["file"]
            if name.startswith(("badge-", "backdrop-")):
                continue
            path = self.config.avatars_dir / name
            known = self._digests.get(str(path))
            if not known or known[0] != item["modified"]:
                try:
                    known = (item["modified"], hashlib.sha1(path.read_bytes()).hexdigest())
                except OSError:
                    continue
                self._digests[str(path)] = known
            digest = known[1]
            info = meta.get(name) or {}
            k = info.get("kind") or next((kk for rx, kk in self._KIND_BY_NAME if rx.search(name)), "image")
            owner = by_id.get(name.split("-", 1)[0], "")
            groups.setdefault(digest, []).append({"file": name, "kind": k, "info": info, "owner": owner, "modified": item["modified"],
                                                  "in_use": using.get(name, [])})
        out = []
        for same in groups.values():
            # the same picture saved several times (a photo given to Prospero again…): one entry, the copy in use or best described
            best = max(same, key=lambda x: (bool(x["in_use"]), bool(x["info"]), x["kind"] != "image", x["modified"]))
            names = sorted({n for x in same for n in x["in_use"]} | {x["owner"] for x in same if x["owner"]})
            info, k, name = best["info"], best["kind"], best["file"]
            if kind and k != kind:
                continue
            hay = " ".join([*names, k, info.get("title", ""), info.get("credit", ""), name]).lower()
            if q and not all(w in hay for w in q.split()):
                continue
            modified = max(x["modified"] for x in same)
            cached = self._img_sizes.get(str(self.config.avatars_dir / name))
            if not cached or cached[0] != best["modified"]:
                try:
                    with Image.open(self.config.avatars_dir / name) as im:
                        cached = (best["modified"], im.size)
                except OSError:
                    cached = (best["modified"], (0, 0))
                self._img_sizes[str(self.config.avatars_dir / name)] = cached
            w, h = cached[1]
            out.append({"file": name, "avatar": f"file:{name}", "url": f"/api/avatars/{name}", "kind": k, "width": w, "height": h,
                        "trainers": names, "in_use": sorted({n for x in same for n in x["in_use"]}), "title": info.get("title", ""),
                        "credit": info.get("credit", ""), "copies": len(same), "modified": modified})
        out.sort(key=lambda x: -x["modified"])
        out = out[: max(1, min(int(limit or 120), 400))]
        return {"images": out, "query": query}

    def official_art_search(self, *, query: str = "", page: str = "", limit: int = 40, refresh: bool = False) -> dict[str, Any]:
        """Official artwork of a character or trainer class from the Pokémon Wiki: the pictures of its page (game by game)."""
        return self.art.search(query, page=page, limit=limit, refresh=refresh)

    MAX_REFERENCE_PHOTOS = 4

    LOOKS = ("sprite", "art")

    def avatar_draw(self, photos: list[bytes], *, description: str = "", trainer_id: str = "", count: int = 2, style: bool = True,
                    look: str = "sprite") -> dict[str, Any]:
        """A trainer drawn by Prospero's Hoard from up to four photos of the same person and/or a description (a job).
        Each result comes back twice: the pixel-art sprite (96 px) and the drawing itself, background removed. ``look`` sprite
        uses the sprite as the trainer's picture; art asks for the games' official artwork style, keeps the drawing (up to 1024 px,
        no pixels) and uses it; its style references are only your own pictures (no pixel sprites)."""
        if look not in self.LOOKS:
            raise SilverError("invalid", "look is sprite (pixel art) or art (the games' official artwork style, not pixelated)")
        photos = [p for p in photos if p][: self.MAX_REFERENCE_PHOTOS]
        description = " ".join((description or "").split())[:300]
        if not photos and not description:
            raise SilverError("invalid", "Give at least one photo or a description of the trainer.")
        if trainer_id:
            self.store.trainer(trainer_id)
        stem = trainer_id or "drawn"
        paths = []
        for i, data in enumerate(photos):
            name = self.sprites.save_avatar(data, stem=f"{stem}-ref{i + 1}", pixelate=False, max_side=1024)
            paths.append(str((self.config.avatars_dir / name).resolve()))
        count = max(1, min(int(count or 2), 4))
        styles = self.style_reference_paths(own_only=look == "art") if style else []
        what = "Arte dibujado" if look == "art" else "Sprite dibujado"
        title = f"{what} ({description[:40] or f'{len(paths)} foto(s)'})"
        return self._job("avatar", title, {"trainer_id": trainer_id, "photos": len(paths), "description": description, "styles": len(styles),
                                           "look": look},
                         lambda jid, progress, cancelled: self._prospero_sprite(paths, description, trainer_id, count, progress, cancelled,
                                                                                styles=styles, silver_job=jid, look=look))

    # ------------------------------------------------------------ art-style references for drawn sprites
    MAX_STYLE_REFS = 3
    STYLE_EXTS = (".png", ".jpg", ".jpeg", ".webp")

    def avatar_style_get(self) -> dict[str, Any]:
        """The art-style references Prospero gets with every drawn sprite: your own pictures first, then trainer sprites by name."""
        folder = self.config.style_refs_dir
        images = []
        if folder.exists():
            for p in sorted(folder.iterdir(), key=lambda x: x.stat().st_mtime):
                if p.is_file() and p.suffix.lower() in self.STYLE_EXTS:
                    images.append({"file": p.name, "url": f"/api/style-refs/{p.name}", "bytes": p.stat().st_size})
        names = [n for n in str(self.settings["prospero_style_sprites"]).split(",") if n]
        used = [*(i["file"] for i in images), *names][: self.MAX_STYLE_REFS]
        selection = read_json(folder / "selection.json", None)
        if isinstance(selection, list):
            available = {i["file"] for i in images} | set(names)
            used = [ref for ref in selection if ref in available][: self.MAX_STYLE_REFS]
        return {"images": images, "sprites": names, "used": used, "max": self.MAX_STYLE_REFS,
                "sprite_urls": {n: f"/api/sprites/trainers/{n}.png" for n in names}}

    def avatar_style_set(self, *, sprites: Optional[str] = None, add: Optional[list[tuple[str, bytes]]] = None,
                         remove: Optional[list[str]] = None, selected: Optional[list[str]] = None) -> dict[str, Any]:
        """Change the style references: the trainer sprite names (comma separated, "" for none), pictures to add, files to remove."""
        if sprites is not None:
            self.settings.update({"prospero_style_sprites": sprites})
        folder = self.config.style_refs_dir
        for name in remove or []:
            p = folder / Path(name).name
            if p.is_file() and p.suffix.lower() in self.STYLE_EXTS:
                p.unlink()
        for filename, data in add or []:
            from PIL import Image
            try:
                img = Image.open(io.BytesIO(data))
                img.load()
            except Exception as exc:  # noqa: BLE001 - any decoder error means not a picture
                raise SilverError("invalid", f"Not a picture this app can read: {exc}") from None
            img.thumbnail((1536, 1536))
            stem = re.sub(r"[^A-Za-z0-9_-]+", "-", Path(filename or "style").stem)[:40].strip("-") or "style"
            folder.mkdir(parents=True, exist_ok=True)
            out = folder / f"{stem}-{int(time.time() * 1000) % 10**9}.png"
            img.convert("RGBA").save(out, "PNG")
        if selected is not None:
            info = self.avatar_style_get()
            available = {i["file"] for i in info["images"]} | set(info["sprites"])
            if len(selected) > self.MAX_STYLE_REFS or len(set(selected)) != len(selected) or any(ref not in available for ref in selected):
                raise SilverError("invalid", "Choose up to three different references from avatar_style_get.")
            folder.mkdir(parents=True, exist_ok=True)
            write_json_atomic(folder / "selection.json", selected)
        return self.avatar_style_get()

    def style_reference_paths(self, own_only: bool = False) -> list[str]:
        """The style pictures ready for Prospero: on white, small sprites enlarged without smoothing so the line work shows.
        ``own_only``: only your own pictures (official art, anime stills), never the pixel sprites (drawings that must not look pixelated)."""
        from PIL import Image
        info = self.avatar_style_get()
        if own_only:
            own = {i["file"] for i in info["images"]}
            used = [r for r in info["used"] if r in own]
            if not (self.config.style_refs_dir / "selection.json").exists():
                used = used or [i["file"] for i in info["images"]][: self.MAX_STYLE_REFS]
            info = {**info, "used": used}
        out_dir = self.config.data_dir / "cache" / "style_prepared"
        out_dir.mkdir(parents=True, exist_ok=True)
        paths = []
        for ref in info["used"]:
            try:
                src = self.config.style_refs_dir / ref if ref in {i["file"] for i in info["images"]} else self.sprites.trainer(ref)
                img = Image.open(src).convert("RGBA")
            except (SilverError, OSError) as exc:
                log.info("style reference %s skipped: %s", ref, exc)
                continue
            if max(img.size) < 400:
                k = max(1, 512 // max(img.size))
                img = img.resize((img.width * k, img.height * k), Image.Resampling.NEAREST)
            else:
                img.thumbnail((1024, 1024))
            flat = Image.new("RGB", img.size, "white")
            flat.paste(img, (0, 0), img)
            dest = out_dir / f"{Path(ref).stem}.png"
            flat.save(dest, "PNG")
            paths.append(str(dest.resolve()))
        if len(paths) < 2:
            return paths
        # several pictures given apart make the model copy the line-up (three figures) or one outfit: one sheet with all of them
        # reads as "a style", not as people to draw
        tiles = [Image.open(p) for p in paths]
        h = max(t.height for t in tiles)
        tiles = [t.resize((max(1, round(t.width * h / t.height)), h), Image.Resampling.NEAREST) for t in tiles]
        gap = h // 8
        sheet = Image.new("RGB", (sum(t.width for t in tiles) + gap * (len(tiles) + 1), h + 2 * gap), "white")
        x = gap
        for t in tiles:
            sheet.paste(t, (x, gap))
            x += t.width + gap
        sheet.thumbnail((1536, 1536))
        dest = out_dir / ("sheet-" + hashlib.sha1("|".join(info["used"]).encode()).hexdigest()[:10] + ".png")
        sheet.save(dest, "PNG")
        return [str(dest.resolve())]

    def prospero_prompt(self, *, photos: int, description: str, styles: int = 0, look: str = "sprite") -> str:
        """The image prompt. Prospero numbers the reference pictures in the order they are given (image 1 first): the photos of the
        person, then the style references."""
        def span(first: int, n: int) -> str:
            return f"image {first}" if n == 1 else f"images {first} to {first + n - 1}"

        parts = []
        if photos:
            who = f" ({description})" if description else ""
            parts.append(f"Draw the person shown in {span(1, photos)}{who} as an original monster-trainer character: {self.LIKENESS}. "
                         "Turn their clothes into a trainer outfit in the game's fashion that keeps the main garments and colours of the photos.")
        else:
            parts.append(f"Draw {description} as an original monster-trainer character.")
        if styles:
            parts.append(f"{span(photos + 1, styles).capitalize()} {'is' if styles == 1 else 'are'} only a style reference with unrelated "
                         "characters: copy only the drawing style (proportions, eyes, line work, shading, palette); never draw those "
                         "characters or their clothes, hair, poses or props.")
        parts.append("Exactly one character, alone, full body.")
        parts.append(str(self.settings["prospero_prompt_art" if look == "art" else "prospero_prompt"]))
        return " ".join(parts)


    # naming a feature ("beard") makes the model draw it on people who do not have it: ask for the photo's face as it is
    LIKENESS = ("same face shape, hairstyle, hair colour, skin tone and build as in the photos, facial hair exactly as in the photos "
                "and none if the photos show a clean-shaven face")

    PROSPERO_REASON = "Silver's Hoard: a trainer sprite drawn from the user's photo"

    def _prospero_call(self, tool: str, args: dict[str, Any], timeout: float = 120.0, write: bool = False) -> Any:
        if write:
            args = {**args, "reason": self.PROSPERO_REASON}
        res = family.call("prospero", tool, args, timeout=timeout)
        if not res.get("ok"):
            raise SilverError("unavailable", f"Prospero's Hoard did not answer {tool}: {res.get('error') or res.get('status')}",
                              hint="Start Hoard Hub and Prospero's Hoard (with ComfyUI), or use the pixel-art filter.")
        return res.get("result")

    @staticmethod
    def _prospero_url() -> str:
        """Where Prospero listens, as the hub knows it (its port can be adapted at launch)."""
        import urllib.request
        try:
            with urllib.request.urlopen(family._hub().rstrip("/") + "/api/apps/prospero", timeout=10) as r:
                url = str(json.loads(r.read()).get("url") or "")
        except Exception:  # noqa: BLE001 - fall back to the default port
            url = ""
        return (url or "http://127.0.0.1:8815").rstrip("/")

    @staticmethod
    def _prospero_file(base: str, asset_id: str) -> bytes:
        """The picture itself, by asset id (tool results are capped in size, so pictures are not read through the hub)."""
        import urllib.parse
        import urllib.request
        with urllib.request.urlopen(f"{base}/api/assets/{urllib.parse.quote(asset_id, safe='')}/file", timeout=60) as r:
            data = r.read(30_000_000)
        if not data:
            raise SilverError("unavailable", "Prospero sent an empty picture.")
        return data

    PROSPERO_RETRY_S = 5.0   # pause before asking Prospero again after it (or the hub) did not answer

    def _prospero_wait(self, job: dict[str, Any], cancelled: Callable[[], bool], progress: Callable[[float], None]) -> dict[str, Any]:
        """Poll one Prospero job until it ends; cancelling here cancels it there."""
        job_id = job.get("id")
        deadline = time.monotonic() + 3600
        misses = 0
        while job.get("state") not in ("done", "failed", "cancelled"):
            if cancelled():
                try:
                    self._prospero_call("studio_cancel_job", {"job_id": job_id}, write=True)
                finally:
                    raise SilverError("cancelled", "Cancelled.")
            if time.monotonic() > deadline:
                raise SilverError("timeout", "Prospero took more than an hour.")
            try:
                job = self._prospero_call("studio_job", {"job_id": job_id, "wait_s": 30}, timeout=90) or {}
                misses = 0
            except SilverError:
                # the hub or Prospero did not answer once (a restart, a busy moment): the render goes on there, ask again
                misses += 1
                if misses >= 6:
                    raise
                time.sleep(self.PROSPERO_RETRY_S)
                job = {"id": job_id, "state": "unknown"}
                continue
            p = job.get("progress")
            if isinstance(p, (int, float)):
                progress(min(1.0, p if p <= 1 else p / 100))
        if job.get("state") != "done":
            raise SilverError("unavailable", f"Prospero's render ended as {job.get('state')}: {job.get('error') or job.get('message') or ''}".strip())
        return job

    def _prospero_cutout(self, base: str, asset_id: str, cancelled: Callable[[], bool]) -> tuple[bytes, bool]:
        """The picture with its background removed by Prospero (BiRefNet matting) and True; when Prospero cannot (model missing,
        an error), the picture as drawn and False, so the local corner fill cuts it instead."""
        try:
            res = self._prospero_call("studio_edit_image", {"asset_id": asset_id, "operation": "remove_background"}, write=True) or {}
            job = self._prospero_wait((res.get("job") or {}) if isinstance(res, dict) else {}, cancelled, lambda p: None)
            cut = (job.get("asset_ids") or [])[:1]
            if cut:
                return self._prospero_file(base, cut[0]), True
        except SilverError as exc:
            if exc.code == "cancelled":
                raise
            log.info("Prospero could not remove the background of %s: %s", asset_id, exc.message)
        return self._prospero_file(base, asset_id), False

    def _prospero_style_assets(self, project: str, styles: list[str]) -> list[str]:
        """Prospero asset ids of the style pictures, imported once per picture content and project (kept in data/style_assets.json)."""
        index_path = self.config.data_dir / "style_assets.json"
        try:
            index = json.loads(index_path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            index = {}
        ids = []
        for path in styles:
            key = f"{project}:{hashlib.sha1(Path(path).read_bytes()).hexdigest()[:16]}"
            if key not in index:
                imported = self._prospero_call("studio_import", {"project": project, "path": path, "kind": "image"}, write=True) or {}
                asset = imported.get("id") or (imported.get("asset") or {}).get("id")
                if not asset:
                    raise SilverError("unavailable", "Prospero did not import a style picture.")
                index[key] = asset
            if index[key] not in ids:          # the same picture twice is one reference
                ids.append(index[key])
        index_path.write_text(json.dumps(index), encoding="utf-8")
        return ids

    def _forget_style_assets(self) -> None:
        try:
            (self.config.data_dir / "style_assets.json").unlink()
        except OSError:
            pass

    def _prospero_sprite(self, photos: list[str], description: str, trainer_id: str, count: int, progress: Callable[[float], None],
                         cancelled: Callable[[], bool], *, styles: Optional[list[str]] = None, silver_job: str = "",
                         look: str = "sprite") -> dict[str, Any]:
        progress(0.02)
        project = self._prospero_project()
        refs = []
        for photo in photos:
            imported = self._prospero_call("studio_import", {"project": project, "path": str(Path(photo).resolve()), "kind": "image"}, write=True) or {}
            asset = imported.get("id") or (imported.get("asset") or {}).get("id")
            if not asset:
                raise SilverError("unavailable", "Prospero did not import the photo.")
            refs.append(asset)
        styles = styles or []
        style_ids = self._prospero_style_assets(project, styles) if styles else []
        progress(0.1)
        args: dict[str, Any] = {"project": project, "prompt": self.prospero_prompt(photos=len(refs), description=description, styles=len(style_ids),
                                                                         look=look),
                                "count": count, "aspect": "2:3"}
        if refs or style_ids:
            args["reference_asset_ids"] = refs + style_ids
        if self.settings.get("prospero_engine"):
            args["engine"] = self.settings["prospero_engine"]
        try:
            gen = self._prospero_call("studio_generate_image", args, timeout=180, write=True) or {}
        except SilverError:
            if not style_ids:
                raise
            # a style picture deleted on Prospero's side: import them again once
            self._forget_style_assets()
            style_ids = self._prospero_style_assets(project, styles)
            args["reference_asset_ids"] = refs + style_ids
            gen = self._prospero_call("studio_generate_image", args, timeout=180, write=True) or {}
        job = (gen.get("job") or {}) if isinstance(gen, dict) else {}
        job_id = job.get("id")
        if not job_id:
            raise SilverError("unavailable", "Prospero did not queue the picture.")
        if silver_job:   # so a restart of this app can cancel the render it leaves behind
            with contextlib.suppress(Exception):
                self.store.update_job(silver_job, {"args": {**self.store.job(silver_job).get("args", {}), "prospero_job": job_id}})
        job = self._prospero_wait(job, cancelled, lambda p: progress(0.1 + 0.7 * p))
        base = self._prospero_url()
        files = []
        ids = [a for a in (job.get("asset_ids") or [a.get("id") for a in job.get("assets") or []]) if a][:4]
        for n, aid in enumerate(ids):
            data, matted = self._prospero_cutout(base, aid, cancelled)
            stem = f"{trainer_id or 'prospero'}-ai"
            name = self.sprites.save_avatar(data, stem=stem, pixelate=True, remove_background=not matted)
            drawing = self.sprites.save_avatar(data, stem=f"{stem}-drawing", pixelate=False, remove_background=not matted,
                                               max_side=1024 if look == "art" else 512)
            self._avatar_meta_set(name, kind="sprite", title=description[:120])
            self._avatar_meta_set(drawing, kind="drawing", title=description[:120])
            files.append({"file": name, "url": f"/api/avatars/{name}", "avatar": f"file:{name}", "prospero_asset": aid, "cutout": matted,
                          "drawing": {"file": drawing, "url": f"/api/avatars/{drawing}", "avatar": f"file:{drawing}"}})
            progress(0.8 + 0.2 * (n + 1) / len(ids))
        if not files:
            raise SilverError("unavailable", "Prospero finished without pictures.")
        if trainer_id:
            self.store.update_trainer(trainer_id, {"avatar": files[0]["drawing"]["avatar"] if look == "art" else files[0]["avatar"]})
        progress(1.0)
        return {"candidates": files, "project": project, "prospero_job": job_id, "prompt": args["prompt"], "look": look}

    def _prospero_project(self) -> str:
        projects = self._prospero_call("studio_projects", {"query": "Silver's Hoard", "limit": 20}) or {}
        items = (projects.get("items") if isinstance(projects, dict) else None) or []
        project = next((p["id"] for p in items if p.get("name") == "Silver's Hoard"), "")
        if not project:
            created = self._prospero_call("studio_create_project", {"name": "Silver's Hoard",
                                                                    "brief": "Trainer sprites made from photos for the battle simulator."}, write=True) or {}
            project = created.get("id") or (created.get("project") or {}).get("id")
        if not project:
            raise SilverError("unavailable", "Prospero did not create the project for the sprites.")
        return project

    # ------------------------------------------------------------ more poses of a trainer's own sprite (back view, victory)
    POSES: dict[str, str] = {
        "back": ("Draw the same character as image 1 seen from behind, a back view as the player's own trainer appears at the bottom of "
                 "the battle screen: the back of the head, hairstyle, hair colour, outfit and colours exactly as in image 1, the face not "
                 "visible, standing, full body."),
        "win": ("Draw the same character as image 1 in a victory pose, celebrating with one fist raised and a big smile, facing the viewer: "
                "same face, hairstyle, hair colour, facial hair, outfit and colours exactly as in image 1, full body."),
    }
    _poses_cache: tuple[float, dict[str, Any]] = (-1.0, {})

    def _poses_path(self) -> Path:
        return self.config.data_dir / "avatar_poses.json"

    def _poses_index(self) -> dict[str, Any]:
        """{avatar: {pose: "file:<name>"}}: the poses follow the avatar, so a trainer that changes its sprite drops them."""
        path = self._poses_path()
        try:
            mtime = path.stat().st_mtime
        except OSError:
            return {}
        if self._poses_cache[0] != mtime:
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                data = {}
            self._poses_cache = (mtime, data if isinstance(data, dict) else {})
        return self._poses_cache[1]

    def _poses_write(self, index: dict[str, Any]) -> None:
        path = self._poses_path()
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(index, ensure_ascii=False, indent=1), encoding="utf-8")
        self._poses_cache = (-1.0, {})

    def pose_urls(self, avatar: str) -> dict[str, str]:
        if not avatar or not avatar.startswith("file:"):
            return {}
        entry = self._poses_index().get(avatar) or {}
        return {k: self.avatar_url(v) for k, v in entry.items() if k in self.POSES and isinstance(v, str) and v.startswith("file:")}

    def avatar_poses_get(self, *, trainer_id: str = "", avatar: str = "") -> dict[str, Any]:
        if trainer_id:
            avatar = avatar or self.store.trainer(trainer_id)["avatar"]
        return {"avatar": avatar, "avatar_url": self.avatar_url(avatar), "poses": self.pose_urls(avatar), "available": list(self.POSES),
                "can_draw": avatar.startswith("file:")}

    def avatar_pose_set(self, *, avatar: str, pose: str, file: str = "") -> dict[str, Any]:
        """Use another drawn picture for one pose of an avatar (a file in the avatars folder), or "" to drop that pose."""
        if pose not in self.POSES:
            raise SilverError("invalid", f"pose is one of {', '.join(self.POSES)}")
        if not avatar.startswith("file:"):
            raise SilverError("invalid", "Poses belong to your own sprites (file:<name>).")
        self.sprites.avatar_path(avatar[5:])
        index = dict(self._poses_index())
        entry = dict(index.get(avatar) or {})
        if file:
            name = file[5:] if file.startswith("file:") else file
            self.sprites.avatar_path(name)
            entry[pose] = f"file:{name}"
        else:
            entry.pop(pose, None)
        if entry:
            index[avatar] = entry
        else:
            index.pop(avatar, None)
        self._poses_write(index)
        return self.avatar_poses_get(avatar=avatar)

    def _pose_reference(self, avatar: str) -> tuple[str, bool]:
        """The avatar as Prospero's reference picture (on white, a small sprite enlarged without smoothing; a drawn sprite's own
        drawing when it is still there, it carries more detail than 96 px) and whether the poses come back as drawings."""
        from PIL import Image
        name = avatar[5:]
        src = self.sprites.avatar_path(name)
        img = Image.open(src).convert("RGBA")
        drawing = max(img.size) > 160
        m = re.match(r"(.+)-\d+\.png$", name)
        if not drawing and m:   # a drawn sprite and its drawing are saved in the same second
            near = sorted(self.config.avatars_dir.glob(f"{m.group(1)}-drawing-*.png"), key=lambda q: abs(q.stat().st_mtime - src.stat().st_mtime))
            if near and abs(near[0].stat().st_mtime - src.stat().st_mtime) < 30:
                img = Image.open(near[0]).convert("RGBA")
        if max(img.size) < 400:
            k = max(1, 512 // max(img.size))
            img = img.resize((img.width * k, img.height * k), Image.Resampling.NEAREST)
        else:
            img.thumbnail((1024, 1024))
        flat = Image.new("RGB", img.size, "white")
        flat.paste(img, (0, 0), img)
        out_dir = self.config.data_dir / "cache" / "pose_refs"
        out_dir.mkdir(parents=True, exist_ok=True)
        dest = out_dir / f"{Path(name).stem}.png"
        flat.save(dest, "PNG")
        return str(dest.resolve()), drawing

    def pose_prompt(self, pose: str, *, styles: int = 0) -> str:
        parts = [self.POSES[pose]]
        if styles:
            span = "image 2" if styles == 1 else f"images 2 to {styles + 1}"
            parts.append(f"{span.capitalize()} {'is' if styles == 1 else 'are'} only a style reference with unrelated characters: copy only "
                         "the drawing style (proportions, line work, shading, palette); never draw those characters or their clothes.")
        parts.append("Exactly one character, alone, full body.")
        parts.append(str(self.settings["prospero_prompt"]).replace("standing, facing the viewer, ", ""))
        return " ".join(parts)

    def avatar_poses_draw(self, *, trainer_id: str = "", avatar: str = "", poses: Optional[list[str]] = None, count: int = 1,
                          style: bool = True) -> dict[str, Any]:
        """Prospero's Hoard draws the trainer's own sprite again from behind (the player's side of the battle) and in a victory pose (the
        end of a battle won), with the sprite as the reference (a job). The first picture of each pose is used; the rest are candidates."""
        if trainer_id:
            avatar = avatar or self.store.trainer(trainer_id)["avatar"]
        if not avatar:
            raise SilverError("invalid", "Give a trainer with a sprite or the sprite itself (file:<name>).")
        if not avatar.startswith("file:"):
            raise SilverError("invalid", "Poses are drawn only for your own sprites (from a photo or drawn), not for the games' trainer sprites.",
                              hint="Give the trainer a sprite of its own first (avatar_draw or avatar_from_photo).")
        poses = [x for x in dict.fromkeys(poses or list(self.POSES)) if x in self.POSES]
        if not poses:
            raise SilverError("invalid", f"poses are {', '.join(self.POSES)}")
        ref, drawing = self._pose_reference(avatar)
        count = max(1, min(int(count or 1), 4))
        styles = self.style_reference_paths() if style else []
        title = f"Poses del sprite ({', '.join({'back': 'de espaldas', 'win': 'victoria'}[x] for x in poses)})"
        return self._job("avatar", title, {"trainer_id": trainer_id, "avatar": avatar, "poses": poses, "count": count},
                         lambda jid, progress, cancelled: self._prospero_poses(avatar, ref, drawing, poses, count, progress, cancelled,
                                                                               styles=styles, silver_job=jid))

    def _prospero_poses(self, avatar: str, ref: str, drawing: bool, poses: list[str], count: int, progress: Callable[[float], None],
                        cancelled: Callable[[], bool], *, styles: list[str], silver_job: str = "") -> dict[str, Any]:
        progress(0.02)
        project = self._prospero_project()
        imported = self._prospero_call("studio_import", {"project": project, "path": ref, "kind": "image"}, write=True) or {}
        ref_id = imported.get("id") or (imported.get("asset") or {}).get("id")
        if not ref_id:
            raise SilverError("unavailable", "Prospero did not import the sprite.")
        style_ids = self._prospero_style_assets(project, styles) if styles else []
        base = self._prospero_url()
        stem = re.sub(r"[^A-Za-z0-9_-]", "", Path(avatar[5:]).stem)[:40] or "pose"
        results: dict[str, list[dict[str, Any]]] = {}
        step = 0.95 / len(poses)
        for i, pose in enumerate(poses):
            if cancelled():
                raise SilverError("cancelled", "Cancelled.")
            at = 0.05 + step * i
            args: dict[str, Any] = {"project": project, "prompt": self.pose_prompt(pose, styles=len(style_ids)), "count": count, "aspect": "2:3",
                                    "reference_asset_ids": [ref_id, *style_ids]}
            if self.settings.get("prospero_engine"):
                args["engine"] = self.settings["prospero_engine"]
            gen = self._prospero_call("studio_generate_image", args, timeout=180, write=True) or {}
            job = (gen.get("job") or {}) if isinstance(gen, dict) else {}
            if not job.get("id"):
                raise SilverError("unavailable", "Prospero did not queue the picture.")
            if silver_job:
                with contextlib.suppress(Exception):
                    self.store.update_job(silver_job, {"args": {**self.store.job(silver_job).get("args", {}), "prospero_job": job["id"]}})
            job = self._prospero_wait(job, cancelled, lambda p, at=at: progress(at + step * 0.8 * p))
            ids = [a for a in (job.get("asset_ids") or [a.get("id") for a in job.get("assets") or []]) if a][:4]
            found = []
            for aid in ids:
                data, matted = self._prospero_cutout(base, aid, cancelled)
                name = self.sprites.save_avatar(data, stem=f"{stem}-{pose}", pixelate=not drawing, remove_background=not matted,
                                                max_side=1024 if drawing else 512)
                found.append({"pose": pose, "file": name, "url": f"/api/avatars/{name}", "avatar": f"file:{name}", "prospero_asset": aid,
                              "cutout": matted})
            results[pose] = found
            progress(at + step)
        if not any(results.values()):
            raise SilverError("unavailable", "Prospero finished without pictures.")
        index = dict(self._poses_index())
        entry = dict(index.get(avatar) or {})
        for pose, found in results.items():
            if found:
                entry[pose] = found[0]["avatar"]
        index[avatar] = entry
        self._poses_write(index)
        progress(1.0)
        self.emit("avatar.poses", {"avatar": avatar, "poses": list(entry)})
        return {"avatar": avatar, "candidates": results, "poses": self.pose_urls(avatar)}

    # ------------------------------------------------------------ settings
    def settings_set(self, changes: dict[str, Any]) -> dict[str, Any]:
        before = self.neural.engine_env()
        out = self.settings.update(changes)
        if any(k.startswith("neural_ai_") for k in changes or {}):
            self._neural_env()
            if self.neural.engine_env() != before:   # the engine reads the address when it starts: the next call starts it again
                with contextlib.suppress(Exception):
                    self.engine.stop()
            if not self.neural.enabled():
                self.neural.stop()
        return out
