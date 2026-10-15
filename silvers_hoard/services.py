"""Everything the app does, wired once: settings, the database, the battle engine, background work, sprites and sharing.

The UI, the REST agent route and the MCP bridge all call these methods through ``agent_tools.py``."""

from __future__ import annotations

import base64
import contextlib
import gzip
import hashlib
import io
import json
import logging
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any, Callable, Optional

from . import APP_ID, __version__
from . import sharing
from .config import AI_LEVELS, AI_STYLES, REPO_ROOT, Config, Settings, find_node
from .engine import Engine
from .errors import SilverError
from .hoard_link import family
from .hoard_link.tokens import read_or_create_token
from .pmd import PmdSprites
from .sprites import Sprites, _http_get
from .store import Store

log = logging.getLogger("silver")

PRESETS_DIR = Path(__file__).resolve().parent / "presets"
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
    "Battleship": "Acorazado",
}
STATIC_DIR = Path(__file__).resolve().parent / "static"
PLAY_TEMPLATE = STATIC_DIR / "play" / "play.html"
DIALOGUE_KEYS = ("intro", "win", "lose", "last")
TYPE_COLORS = {"Normal": "#a8a77a", "Fire": "#ee8130", "Water": "#6390f0", "Electric": "#f7d02c", "Grass": "#7ac74c", "Ice": "#96d9d6",
               "Fighting": "#c22e28", "Poison": "#a33ea1", "Ground": "#e2bf65", "Flying": "#a98ff3", "Psychic": "#f95587", "Bug": "#a6b91a",
               "Rock": "#b6a136", "Ghost": "#735797", "Dragon": "#6f35fc", "Dark": "#705746", "Steel": "#b7b7ce", "Fairy": "#d685ad"}


def _now() -> float:
    return time.time()


class Services:
    def __init__(self, config: Config, *, engine: Optional[Engine] = None, http_get: Any = None):
        self.config = config
        config.paths.ensure()
        for folder in (config.avatars_dir, config.sprites_dir, config.exports_dir):
            folder.mkdir(parents=True, exist_ok=True)
        self.token = read_or_create_token(config.token_path)
        self.settings = Settings(config.settings_path)
        self.store = Store(config.db_path)
        self.engine = engine or Engine(lambda: find_node(self.settings.get("node_path", "")), config.engine_dir, REPO_ROOT)
        self.sprites = Sprites(config.sprites_dir, config.avatars_dir, self.settings, http_get=http_get)
        self.pmd = PmdSprites(config.sprites_dir.parent / "pmd", self.settings, http_get or _http_get)
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
        self.pool.shutdown(wait=False, cancel_futures=True)
        self.engine.stop()
        self.store.close()

    def emit(self, kind: str, data: dict[str, Any]) -> None:
        self.events.append({"t": _now(), "type": kind, **data})
        del self.events[:-200]
        try:
            family.emit(f"silver.{kind}", data)
        except Exception:  # noqa: BLE001 - the family bus is optional
            pass

    def health(self) -> dict[str, Any]:
        return {"engine": self.engine.status(), "counts": self.store.counts()}

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

    def dex_search(self, kind: str, query: str = "", gen: int = 9, limit: int = 30, species: str = "") -> list[dict[str, Any]]:
        return self.engine.call("dex_search", {"kind": kind, "query": query, "gen": gen, "limit": limit, "species": species})["results"]

    def species(self, name: str, gen: int = 9) -> dict[str, Any]:
        return self.engine.call("species", {"name": name, "gen": gen})

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

    def trainers_list(self, query: str = "", origin: str = "", deleted: bool = False) -> list[dict[str, Any]]:
        return [self.trainer_view(t) for t in self.store.trainers(query=query, origin=origin, deleted=deleted)]

    def trainer_get(self, id_: str) -> dict[str, Any]:
        t = self.store.trainer(id_)
        view = self.trainer_view(t, summary=True)
        view["paste"] = self.export_team(t["team"]) if t["team"] else ""
        view["battles"] = [self.battle_card(b) for b in self.store.battles(trainer_id=id_, limit=15)]
        view["badges"] = self.store.badges(challenger_trainer_id=id_)
        return view

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
        return {k: str((d or {}).get(k) or "").strip()[:280] for k in DIALOGUE_KEYS if (d or {}).get(k)}

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
                  "Return JSON with keys intro (said before the battle), win (when the trainer wins), lose (when the trainer loses) and last "
                  "(when sending the last Pokémon). One or two short sentences each, in character, no emojis, no quotes.")
        res = family.chat([{"role": "user", "content": prompt}],
                          json={"type": "object", "properties": {k: {"type": "string"} for k in DIALOGUE_KEYS}, "required": list(DIALOGUE_KEYS)},
                          effort="low", max_tokens=600, timeout=180)
        if not res.get("ok"):
            raise SilverError("unavailable", f"No language model answered: {res.get('detail') or res.get('error')}",
                              hint="Start Hoard Hub and a model (Faustus, the Sparks or Ollama), or write the lines by hand.")
        lines = res.get("json") if isinstance(res.get("json"), dict) else {}
        if not lines:
            try:
                lines = json.loads(res.get("text") or "{}")
            except ValueError:
                lines = {}
        dialogue = self._clean_dialogue(lines)
        if not dialogue:
            raise SilverError("unavailable", "The model did not return the lines.")
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

    def canon_install_league(self, key: str) -> dict[str, Any]:
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
            data["by_key"] = {c["key"]: c for c in data["characters"]}
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

    def characters_list(self, query: str = "", gen: int = 0, game: str = "") -> dict[str, Any]:
        data = self.characters()
        q = query.strip().lower()
        made: dict[str, int] = {}
        for t in self.store.trainers_by_canon_prefix("char:"):
            k = t["canon_key"].split(":")[1]
            made[k] = made.get(k, 0) + 1
        out = []
        for c in data["characters"]:
            variants = [v for v in c["variants"] if (not gen or v["gen"] == gen) and (not game or v["game"].lower() == game.lower())]
            if not variants:
                continue
            if q:
                hay = f"{c['name']} {c['name_es']} {c['key']} " + " ".join(f"{v['game_name']} {v['game_name_es']} {' '.join(x['species'] for x in v['sets'])}" for v in variants)
                if q not in hay.lower():
                    continue
            ace = next((v for v in reversed(variants) if not v.get("side")), variants[-1])
            out.append({"key": c["key"], "name": c["name"], "name_es": c["name_es"], "avatar_url": self.avatar_url(f"sd:{c['base_sprite']}") if c["base_sprite"] else "",
                        "teams": len(variants), "sprites": len(c["sprites"]), "games": list(dict.fromkeys(v["game"] for v in variants)),
                        "gens": sorted({v["gen"] for v in variants}), "species": [x["species"] for x in ace["sets"]],
                        "installed": made.get(c["key"], 0)})
        return {"characters": out, "total": len(data["characters"]), "source": data.get("source", "")}

    def character_get(self, key: str) -> dict[str, Any]:
        c = self._character(key)
        sprites = [{**sp, "avatar": f"sd:{sp['id']}", "url": self.avatar_url(f"sd:{sp['id']}")} for sp in c["sprites"]]
        variants = []
        for v in c["variants"]:
            variants.append({**v, "trainer_class_es": _CLASS_ES.get(v["trainer_class"], v["trainer_class"]), "label": self._variant_label(v, "en"), "label_es": self._variant_label(v, "es"), "sprite_url": self.avatar_url(f"sd:{v['sprite']}") if v["sprite"] else "",
                             "species": [x["species"] for x in v["sets"]], "levels": [x["level"] for x in v["sets"]], "max_level": max(x["level"] for x in v["sets"])})
        installed = [self.trainer_view(t) for t in self.store.trainers_by_canon_prefix(f"char:{c['key']}:")]
        return {"key": c["key"], "name": c["name"], "name_es": c["name_es"], "base_sprite": c["base_sprite"], "avatar_url": self.avatar_url(f"sd:{c['base_sprite']}") if c["base_sprite"] else "",
                "sprites": sprites, "variants": variants, "installed": installed,
                "bulbapedia": "https://bulbapedia.bulbagarden.net/wiki/" + c["name"].replace(" ", "_"), "source": self.characters().get("source", "")}

    def character_install(self, key: str, *, variant: str = "", sprite: str = "", name: str = "", custom: bool = False,
                          ai_level: str = "", ai_style: str = "", lang: str = "es") -> dict[str, Any]:
        """A trainer from a character: one of its game teams (or an empty team of your own when custom), with the sprite you choose."""
        c = self._character(key)
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
        canon_key = f"char:{c['key']}:{v['id'] if v and not custom else 'own'}:{sprite}"
        if not custom and not name:
            existing = self.store.trainer_by_canon(canon_key)
            if existing:
                return {**self.trainer_view(existing), "existing": True}
        lang_es = lang != "en"
        display = c["name_es"] if lang_es else c["name"]
        if custom:
            title = "Equipo propio" if lang_es else "Own team"
            default_name = f"{display} ({title.lower()})"
        else:
            title = f"{_CLASS_ES.get(v['trainer_class'], v['trainer_class']) if lang_es else v['trainer_class']} · {v['game_name_es'] if lang_es else v['game_name']}".strip(" ·")
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
            if v.get("bag"):
                notes.append("Objetos en la bolsa: " + ", ".join(f"{b['count']}× {b['item_es']}" + (" por Pokémon" if b["per_pokemon"] else "") for b in v["bag"]))
            if v.get("note"):
                notes.append(f"Bulbapedia: {v['note']}")
        notes.append("Equipo de Bulbapedia (CC BY-NC-SA); sprite de Pokémon Showdown." if v else "Sprite de Pokémon Showdown.")
        sets = [{k: x for k, x in s.items() if k != "level_range"} for s in (v["sets"] if v else [])] if (v and not custom) or (v and custom and variant) else []
        fmt = v["format"] if v else self.settings["default_format"]
        level, style = self._clean_ai(ai_level or "hard", ai_style or "balanced")
        tags = [c["name"], *([v["game_name_es"], f"Gen {v['gen']}"] if v else [])]
        id_ = self.store.add_trainer({
            "name": (name or default_name).strip()[:60], "title": title[:60], "owner": self.settings["player_name"] if custom else "",
            "origin": "own" if custom else "canon", "format": fmt, "team": sets, "ai_level": level, "ai_style": style, "avatar": self._check_avatar(f"sd:{sprite}") if sprite else "",
            "dialogue": {}, "notes": "\n".join(notes)[:4000], "tags": [str(x)[:30] for x in tags][:20], "canon_key": canon_key,
        })
        self.emit("trainer.created", {"id": id_, "name": name or default_name, "character": c["key"]})
        return self.trainer_view(self.store.trainer(id_))

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
        if full:
            out["gym_trainers"] = [self.trainer_view(t) for t in self.store.trainers(ids=g.get("trainers") or [])]
            out["gym_trainers"].sort(key=lambda t: (g.get("trainers") or []).index(t["id"]))
            out["badges"] = self.store.badges(gym_id=g["id"])
        return out

    def gyms_list(self, query: str = "", deleted: bool = False) -> list[dict[str, Any]]:
        return [self.gym_view(g) for g in self.store.gyms(query=query, deleted=deleted)]

    def gym_get(self, id_: str) -> dict[str, Any]:
        return self.gym_view(self.store.gym(id_), full=True)

    def gym_save(self, id_: str = "", **v: Any) -> dict[str, Any]:
        values: dict[str, Any] = {}
        for key in ("name", "city", "type", "badge", "badge_color", "description"):
            if v.get(key) is not None:
                values[key] = str(v[key]).strip()[:2000 if key == "description" else 60]
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

    def leagues_list(self, deleted: bool = False) -> list[dict[str, Any]]:
        return [self.league_view(lg) for lg in self.store.leagues(deleted=deleted)]

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
        if not sets:
            raise SilverError("empty_team", f"{name} has no team.")
        level, style = self._clean_ai(level, style)
        return {"trainer_id": spec.get("trainer_id") or "", "name": name, "avatar": avatar, "avatar_url": self.avatar_url(avatar), "human": human,
                "ai": None if human else {"level": level, "style": style}, "sets": sets, "dialogue": dialogue, "format": fmt}

    @staticmethod
    def _public_seat(seat: dict[str, Any]) -> dict[str, Any]:
        return {k: v for k, v in seat.items() if k != "sets"}

    def battle_card(self, b: dict[str, Any]) -> dict[str, Any]:
        return {"id": b["id"], "kind": b["kind"], "status": b["status"], "mode": b.get("mode") or "classic", "format": b["format"], "title": b.get("title") or "",
                "p1": self._public_seat(b.get("p1") or {}), "p2": self._public_seat(b.get("p2") or {}), "winner_side": b.get("winner_side") or "",
                "winner_name": b.get("winner_name") or "", "turns": b.get("turns") or 0, "run_id": b.get("run_id") or "", "job_id": b.get("job_id") or "",
                "created_at": b["created_at"], "updated_at": b["updated_at"]}

    def battle_start(self, *, p1: dict[str, Any], p2: dict[str, Any], format_: str = "", rules: Optional[list[str]] = None,
                     level_rules: Optional[dict[str, Any]] = None, kind: str = "", run_id: str = "", title: str = "", seed: Any = None,
                     mode: str = "classic", time_limit: int = 0) -> dict[str, Any]:
        if mode == "realtime":
            return self._rt_start(p1=p1, p2=p2, format_=format_, level_rules=level_rules, kind=kind, run_id=run_id, title=title, seed=seed,
                                  time_limit=time_limit)
        if mode not in ("classic", ""):
            raise SilverError("invalid", "mode is classic or realtime")
        s1, s2 = self._seat(p1, "Jugador 1"), self._seat(p2, "Jugador 2")
        fmt = format_ or s1["format"] or s2["format"] or self.settings["default_format"]
        rules = rules or []
        level_rules = level_rules or {}
        info = self.format_info(fmt, rules)
        if info.get("random"):
            fmt = f"gen{info['gen']}customgame"
        spec = {"format": fmt, "rules": rules, "level_rules": level_rules, "max_turns": self.settings["max_turns"],
                "p1": {"name": s1["name"], "sets": s1["sets"], "ai": s1["ai"]}, "p2": {"name": s2["name"], "sets": s2["sets"], "ai": s2["ai"]}}
        if seed:
            spec["seed"] = seed
        watch = not s1["human"] and not s2["human"]
        kind = kind or ("watch" if watch else "play")
        bid = self.store.add_battle({"kind": kind, "status": "running" if watch else "live", "format": fmt, "rules": rules, "level_rules": level_rules,
                                     "p1": s1, "p2": s2, "run_id": run_id, "title": title, "seed": json.dumps(seed) if seed else ""})
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
            if state.get("ended"):
                self._finish(bid)
        self.emit("battle.started", {"id": bid, "kind": kind})
        return self.battle_get(bid, since=0)

    def _submit_watch(self, bid: str, spec: dict[str, Any]) -> None:
        def work() -> None:
            try:
                r = self.engine.run_job("play_out", {"spec": spec}, timeout=1800)
                self.store.update_battle(bid, {"status": "ended", "log_text": "\n".join(r.get("lines") or []), "summary": r.get("summary") or {},
                                               "winner_side": (r.get("summary") or {}).get("winner_side", ""),
                                               "winner_name": (r.get("summary") or {}).get("winner", ""), "turns": r.get("turns") or 0,
                                               "seed": str(r.get("seed") or "")})
                self._after_end(bid)
            except Exception as exc:  # noqa: BLE001 - the battle row says what happened
                log.exception("watch battle %s", bid)
                self.store.update_battle(bid, {"status": "failed", "summary": {"error": str(getattr(exc, "message", exc))[:300]}})

        self.pool.submit(work)

    def _ensure_loaded(self, b: dict[str, Any]) -> None:
        if self.engine.call("match_loaded", {"id": b["id"]}).get("loaded"):
            return
        if not b.get("snapshot"):
            raise SilverError("conflict", "This battle cannot be resumed (no saved state).")
        spec = {"id": b["id"], "format": b["format"], "rules": b.get("rules") or [], "level_rules": b.get("level_rules") or {},
                "max_turns": self.settings["max_turns"],
                "p1": {"name": b["p1"]["name"], "sets": b["p1"].get("sets") or [], "ai": b["p1"].get("ai")},
                "p2": {"name": b["p2"]["name"], "sets": b["p2"].get("sets") or [], "ai": b["p2"].get("ai")}, "seed": b.get("seed") or None}
        self.engine.call("match_start", {"spec": spec, "snapshot": json.loads(b["snapshot"]), "view": "host"}, timeout=60)
        self.engine.call("match_state", {"id": b["id"], "since": 10**9})

    def battle_get(self, id_: str, since: int = 0, view: str = "host") -> dict[str, Any]:
        b = self.store.battle(id_)
        out = self.battle_card(b)
        out.update({"rules": b.get("rules") or [], "level_rules": b.get("level_rules") or {}, "summary": b.get("summary") or {}})
        if (b.get("mode") or "classic") == "realtime":
            return self._rt_view(b, out, since)
        if b["status"] == "live":
            with self._lock_for(id_):
                self._ensure_loaded(b)
                state = self.engine.call("match_state", {"id": id_, "since": since, "view": view})
            out.update({k: state[k] for k in ("lines", "log_length", "requests", "turn", "errors")})
            out["format_info"] = state.get("format")
            if state.get("ended"):
                self._finish(id_)
                return self.battle_get(id_, since=since, view=view)
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
        return out

    def battle_choose(self, id_: str, side: str, choice: str, since: int = 0) -> dict[str, Any]:
        b = self.store.battle(id_)
        if b["status"] != "live":
            raise SilverError("ended", "This battle is over.")
        if b.get("mode") == "realtime":
            raise SilverError("invalid", "A real-time battle is played on its screen (or watched with two AI seats); it has no turns to choose.",
                              hint="Open it in the app, or start it with two AI seats and read it with battle_get.")
        if side not in ("p1", "p2"):
            raise SilverError("invalid", "side is p1 or p2")
        with self._lock_for(id_):
            self._ensure_loaded(b)
            state = self.engine.call("match_choose", {"id": id_, "side": side, "choice": choice, "since": since, "view": "host"}, timeout=120)
            self.store.update_battle(id_, {"snapshot": state.pop("snapshot", "") or "", "turns": state.get("turn") or 0})
            if state.get("ended"):
                self._finish(id_)
        return self._with_state(id_, state)

    def battle_forfeit(self, id_: str, side: str, since: int = 0) -> dict[str, Any]:
        b = self.store.battle(id_)
        if b["status"] != "live":
            raise SilverError("ended", "This battle is over.")
        if b.get("mode") == "realtime":
            replay = b.get("replay") or {}
            return self.rt_finish(id_, inputs=replay.get("inputs") or [], tick=int(replay.get("tick") or 0), forfeit=side)
        with self._lock_for(id_):
            self._ensure_loaded(b)
            state = self.engine.call("match_forfeit", {"id": id_, "side": side, "since": since, "view": "host"})
            state.pop("snapshot", None)
            self._finish(id_)
        return self._with_state(id_, state)

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
        return out

    def _finish(self, id_: str) -> None:
        b = self.store.battle(id_)
        if b["status"] != "live":
            return
        log_ = self.engine.call("match_log", {"id": id_, "view": "omniscient"})
        summary = log_.get("summary") or {}
        self.store.update_battle(id_, {"status": "ended", "log_text": "\n".join(log_.get("lines") or []), "summary": summary,
                                       "winner_side": summary.get("winner_side", ""), "winner_name": summary.get("winner", ""),
                                       "turns": summary.get("turns", 0), "snapshot": ""})
        try:
            self.engine.call("match_close", {"id": id_})
        except SilverError:
            pass
        self._after_end(id_)

    def _after_end(self, id_: str) -> None:
        b = self.store.battle(id_)
        w = b.get("winner_side") or ""
        for side in ("p1", "p2"):
            tid = (b.get(side) or {}).get("trainer_id")
            if tid and b["kind"] not in ("series", "tournament"):
                self.store.record_result(tid, "tie" if not w else "win" if w == side else "loss")
        self.emit("battle.ended", {"id": id_, "winner": b.get("winner_name"), "kind": b["kind"]})
        if b.get("run_id"):
            self._advance_run(b["run_id"], b)

    # ------------------------------------------------------------ real-time battles (Legends: Z-A rules)
    def _rt_spec(self, b: dict[str, Any]) -> dict[str, Any]:
        """The spec that rebuilds a real-time battle: the screen runs it, the engine replays it."""
        replay = b.get("replay") or {}
        seat = lambda s: {"name": s.get("name", ""), "sets": s.get("sets") or [], "ai": s.get("ai")}  # noqa: E731
        return {"id": b["id"], "seed": b.get("seed") or b["id"], "format": b["format"], "level_rules": b.get("level_rules") or {},
                "time_limit": int(replay.get("time_limit") or self.settings.get("rt_time_limit") or 300), "p1": seat(b.get("p1") or {}),
                "p2": seat(b.get("p2") or {})}

    def _rt_start(self, *, p1: dict[str, Any], p2: dict[str, Any], format_: str = "", level_rules: Optional[dict[str, Any]] = None,
                  kind: str = "", run_id: str = "", title: str = "", seed: Any = None, time_limit: int = 0) -> dict[str, Any]:
        s1, s2 = self._seat(p1, "Jugador 1"), self._seat(p2, "Jugador 2")
        fmt = format_ or s1["format"] or s2["format"] or self.settings["default_format"]
        info = self.format_info(fmt, [])
        if info.get("random") or info.get("game_type") != "singles":
            fmt = f"gen{info['gen']}customgame"
        level_rules = level_rules or {}
        limit = max(30, min(int(time_limit or self.settings.get("rt_time_limit") or 300), 1800))
        watch = not s1["human"] and not s2["human"]
        kind = kind or ("watch" if watch else "play")
        seed_text = str(seed) if seed else ""
        bid = self.store.add_battle({"kind": kind, "mode": "realtime", "status": "running" if watch else "live", "format": fmt, "rules": [],
                                     "level_rules": level_rules, "p1": s1, "p2": s2, "run_id": run_id, "title": title, "seed": seed_text,
                                     "replay": {"time_limit": limit, "inputs": [], "tick": 0}})
        if not seed_text:
            self.store.update_battle(bid, {"seed": bid})
        spec = self._rt_spec(self.store.battle(bid))
        try:
            check = self.engine.call("rt_check", {"spec": spec}, timeout=60)
        except SilverError:
            self.store.update_battle(bid, {"status": "failed"})
            raise
        if self.settings.get("pmd_sprites", True) and self.config.background:
            self.pool.submit(self.pmd.prefetch, [m for side in (check.get("view") or {}).get("sides", []) for m in side.get("mons", [])])
        if watch:
            def work() -> None:
                try:
                    r = self.engine.run_job("rt_play_out", {"spec": spec}, timeout=1800)
                    self._rt_store_result(bid, r)
                except Exception as exc:  # noqa: BLE001 - the battle row says what happened
                    log.exception("real-time battle %s", bid)
                    self.store.update_battle(bid, {"status": "failed", "summary": {"error": str(getattr(exc, "message", exc))[:300]}})

            self.pool.submit(work)
        self.emit("battle.started", {"id": bid, "kind": kind, "mode": "realtime"})
        return self.battle_get(bid)

    def _rt_store_result(self, bid: str, r: dict[str, Any]) -> None:
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
                           "time_limit": self._rt_spec(b)["time_limit"], "human": [bool((b.get(s) or {}).get("human")) for s in ("p1", "p2")]}})
        try:
            out["format_info"] = self.format_info(b["format"], [])
        except SilverError:
            pass
        if b.get("run_id"):
            try:
                out["run"] = self.run_view(self.store.run(b["run_id"]), light=True)
            except SilverError:
                pass
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
                "One Pokémon per trainer on a 28 x 17 m arena seen from above; the screen runs at 30 ticks per second.",
                "No PP and no turns: every move has a base cooldown of 3-60 s. Moves Legends: Z-A has keep its value (337 moves); the rest get one from PP, power and kind fitted to that table (mean error 1.3 s).",
                "Speed shortens cooldowns: final = max(3, base - 3 * max(0, Speed * modifier - 25) / 100). Priority moves always take 3 s. Choice Scarf, Tailwind and weather abilities count as Speed modifiers; stat stages do not.",
                "Every move has a wind-up (none for priority moves, long for charging moves) during which the user stands still; a flinch cancels it and the move goes on cooldown.",
                "Shapes: strikes in front, dashes, projectiles, beams, cones, bursts around the user and blasts that land where the target stood. There is no accuracy or evasion: a move hits if it reaches. Rolling (short invulnerable dash) dodges.",
                "Damage, types, STAB, critical hits, abilities and items use the turn-based formula of the format's generation. Multi-hit moves hit a fixed number of times, as in Z-A.",
                "Stat changes are one stage at most (x1.5 or x2/3) and last 20 s. The Speed stage changes walking speed.",
                "Burn, poison and paralysis last until cured (paralysis halves walking speed); sleep is drowsiness for 10 s (cooldowns at half speed); freeze holds the Pokémon for 3 s; confusion makes walking erratic for 6 s. Residual damage and healing happen every 4 s.",
                "Three switches per trainer, refilled after every knockout; pivot moves and fainting do not spend them.",
                "Time limit (300 s by default): more Pokémon standing wins, then more HP left in total.",
            ],
            "not_covered": ["doubles (doubles formats play as singles)", "Mega Evolution, Z-Moves, Dynamax and Terastallization", "Plus moves and Alpha Pokémon of Z-A",
                            "Trick Room, Transform, Baton Pass-style copying and other moves listed as no_effect in rt_cooldowns"],
            "controls": {"move": "WASD or arrows; gamepad left stick", "moves": "1-4 or J K L ; ; gamepad A B X Y", "roll": "Space or Shift; gamepad RB",
                         "switch": "Q then 1-6; gamepad D-pad left/right + up", "pause": "Esc (only against the AI)"},
        }

    def battles_list(self, kind: str = "", status: str = "", trainer_id: str = "", limit: int = 50, offset: int = 0) -> list[dict[str, Any]]:
        return [self.battle_card(b) for b in self.store.battles(kind=kind, status=status, trainer_id=trainer_id, limit=limit, offset=offset)]

    def battles_delete(self, ids: list[str]) -> dict[str, Any]:
        return {"deleted": self.store.delete_battles(ids)}

    # ------------------------------------------------------------ gym and league challenges
    def run_view(self, r: dict[str, Any], *, light: bool = False) -> dict[str, Any]:
        out = {k: v for k, v in r.items() if k != "challenger"}
        out["challenger_name"] = (r.get("challenger") or {}).get("name", "")
        out["challenger_avatar_url"] = self.avatar_url((r.get("challenger") or {}).get("avatar", ""))
        stages = []
        for st in r.get("stages") or []:
            try:
                t = self.store.trainer(st["trainer_id"], deleted=True)
                stages.append({**st, "name": t["name"], "title": t["title"], "avatar_url": self.avatar_url(t["avatar"])})
            except SilverError:
                stages.append({**st, "name": st.get("name", "?")})
        out["stages"] = stages
        out["current"] = stages[r["step"]] if r["status"] == "active" and r["step"] < len(stages) else None
        return out

    def run_start(self, *, kind: str, target_id: str, challenger_id: str, auto: bool = False, ignore_badges: bool = False,
                  format_override: str = "", mode: str = "classic", level: int = 0) -> dict[str, Any]:
        if mode not in ("classic", "realtime"):
            raise SilverError("invalid", "mode is classic or realtime")
        if level not in (0, 50, 100) and not 1 <= int(level) <= 100:
            raise SilverError("invalid", "level is 0 (as they are) or 1-100 (usually 50 or 100)")
        challenger = self.store.trainer(challenger_id)
        if format_override:
            self.format_info(format_override)
        if kind == "gym":
            g = self.store.gym(target_id)
            stage_ids = [*(g.get("trainers") or []), g["leader_id"]]
            target_name = g["name"]
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
            raise SilverError("invalid", "kind is gym or league")
        stage_ids = [s for s in stage_ids if s]
        if not stage_ids:
            raise SilverError("invalid", "There is nobody to fight here.")
        rid = self.store.add_run({"kind": kind, "target_id": target_id, "target_name": target_name, "challenger_id": challenger_id,
                                  "challenger": {"name": challenger["name"], "avatar": challenger["avatar"], "team": challenger["team"], "auto": auto,
                                                 "format_override": format_override, "level": int(level or 0)},
                                  "stages": [{"trainer_id": s, "battle_id": "", "result": ""} for s in stage_ids], "step": 0, "status": "active",
                                  "mode": mode})
        self.emit("run.started", {"id": rid, "kind": kind, "target": target_name})
        self._run_battle(rid)
        return self.run_view(self.store.run(rid))

    def _run_rules(self, r: dict[str, Any]) -> tuple[str, list[str], dict[str, Any]]:
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
        if r["status"] != "active" or r["step"] >= len(r["stages"]):
            return None
        stage = r["stages"][r["step"]]
        fmt, rules, level_rules = self._run_rules(r)
        auto = bool((r.get("challenger") or {}).get("auto"))
        opponent = self.store.trainer(stage["trainer_id"], deleted=True)
        b = self.battle_start(p1={"trainer_id": r["challenger_id"], "human": not auto}, p2={"trainer_id": stage["trainer_id"], "human": False},
                              format_=fmt, rules=rules, level_rules=level_rules, kind=r["kind"], run_id=rid,
                              title=f"{r['target_name']} · {opponent['name']}", mode=r.get("mode") or "classic")
        r = self.store.run(rid)
        stages = r["stages"]
        stages[r["step"]]["battle_id"] = b["id"]
        self.store.update_run(rid, {"stages": stages})
        return b["id"]

    def _advance_run(self, rid: str, b: dict[str, Any]) -> None:
        r = self.store.run(rid)
        if r["status"] != "active":
            return
        stages = r["stages"]
        step = r["step"]
        if step >= len(stages) or stages[step].get("battle_id") != b["id"]:
            return
        won = b.get("winner_side") == "p1"
        stages[step]["result"] = "won" if won else "lost"
        if not won:
            self.store.update_run(rid, {"stages": stages, "status": "lost"})
            self.emit("run.lost", {"id": rid})
            return
        step += 1
        if step >= len(stages):
            self.store.update_run(rid, {"stages": stages, "step": step, "status": "won"})
            ch = r.get("challenger") or {}
            if r["kind"] == "gym":
                g = self.store.gym(r["target_id"], deleted=True)
                self.store.add_badge({"gym_id": g["id"], "gym_name": g["name"], "badge": g["badge"], "badge_color": g["badge_color"],
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

    def run_next(self, rid: str) -> dict[str, Any]:
        r = self.store.run(rid)
        if r["status"] != "active":
            raise SilverError("ended", "This challenge is over.")
        cur = r["stages"][r["step"]]
        if cur.get("battle_id"):
            b = self.store.battle(cur["battle_id"])
            if b["status"] in ("live", "running"):
                return self.run_view(r)
        self._run_battle(rid)
        return self.run_view(self.store.run(rid))

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
        info = self.format_info(fmt, [])
        return f"gen{info['gen']}customgame" if info.get("random") or info.get("game_type") != "singles" else fmt

    def series_start(self, *, p1: dict[str, Any], p2: dict[str, Any], count: int = 0, format_: str = "", rules: Optional[list[str]] = None,
                     level_rules: Optional[dict[str, Any]] = None, mode: str = "classic", time_limit: int = 0) -> dict[str, Any]:
        s1, s2 = self._seat({**p1, "human": False}, "A"), self._seat({**p2, "human": False}, "B")
        fmt = format_ or s1["format"] or s2["format"] or self.settings["default_format"]
        count = max(1, min(int(count or self.settings["series_default"]), 1000))
        rt = mode == "realtime"
        limit = max(30, min(int(time_limit or self.settings["rt_time_limit"]), 1800))
        if rt:
            fmt, rules = self._rt_format(fmt), []
        spec = {"format": fmt, "rules": rules or [], "level_rules": level_rules or {}, "max_turns": self.settings["max_turns"],
                "p1": {"name": s1["name"], "sets": s1["sets"], "ai": s1["ai"]}, "p2": {"name": s2["name"], "sets": s2["sets"], "ai": s2["ai"]}}
        if rt:
            spec.update({"mode": "realtime", "time_limit": limit})

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
                                             "replay": {"time_limit": limit, "inputs": []} if rt else {}})
                samples[outcome] = bid
            res["samples"] = samples
            res["p1"], res["p2"] = self._public_seat(s1), self._public_seat(s2)
            return res

        return self._job("series", f"{s1['name']} vs {s2['name']} ×{count}{' · tiempo real' if rt else ''}",
                         {"p1": p1, "p2": p2, "count": count, "format": fmt, "mode": "realtime" if rt else "classic"}, work)

    def tournament_start(self, *, trainer_ids: list[str], kind: str = "bracket", best_of: int = 1, format_: str = "", rules: Optional[list[str]] = None,
                         level_rules: Optional[dict[str, Any]] = None, title: str = "", ai_level: str = "", mode: str = "classic",
                         time_limit: int = 0) -> dict[str, Any]:
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
        limit = max(30, min(int(time_limit or self.settings["rt_time_limit"]), 1800))
        if rt:
            fmt, rules = self._rt_format(fmt), []
        best_of = max(1, int(best_of) | 1)
        name = title or f"Torneo de {len(ids)}"

        def work(jid: str, progress: Callable[[float], None], cancelled: Callable[[], bool]) -> dict[str, Any]:
            res = self.engine.run_job("tournament", {"format": fmt, "rules": rules or [], "level_rules": level_rules or {}, "entrants": entrants,
                                                     "kind": kind, "best_of": best_of, "mode": "realtime" if rt else "classic", "time_limit": limit},
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
                                                           "mode": "realtime" if rt else "classic", "replay": {"time_limit": limit, "inputs": []} if rt else {}})
                    g.pop("summary", None)
            res["entrants"] = [{"id": e["id"], "name": e["name"], "avatar_url": self.avatar_url(e["avatar"])} for e in entrants]
            res["title"] = name
            if res.get("champion"):
                self.emit("tournament.won", {"job": jid, "champion": by_id[res["champion"]]["name"]})
            return res

        return self._job("tournament", name, {"trainer_ids": ids, "kind": kind, "best_of": best_of, "format": fmt, "mode": "realtime" if rt else "classic"}, work)

    # ------------------------------------------------------------ sharing
    def _avatar_payload(self, avatar: str) -> dict[str, Any]:
        if avatar.startswith("sd:"):
            return {"kind": "showdown", "name": avatar[3:]}
        if avatar.startswith("file:"):
            try:
                data = self.sprites.avatar_path(avatar[5:]).read_bytes()
                return {"kind": "image", "mime": "image/png", "data": base64.b64encode(data).decode("ascii")}
            except SilverError:
                return {}
        return {}

    def _trainer_payload(self, t: dict[str, Any], *, with_picture: bool = True) -> dict[str, Any]:
        return {"name": t["name"], "title": t["title"], "owner": t["owner"] or self.settings["player_name"], "format": t["format"], "team": t["team"],
                "ai": {"level": t["ai_level"], "style": t["ai_style"]}, "dialogue": t.get("dialogue") or {}, "notes": t.get("notes") or "",
                "avatar": self._avatar_payload(t["avatar"]) if with_picture else ({"kind": "showdown", "name": t["avatar"][3:]} if t["avatar"].startswith("sd:") else {}),
                "source_id": t["id"]}

    def _gym_payload(self, g: dict[str, Any]) -> dict[str, Any]:
        return {"name": g["name"], "city": g["city"], "type": g["type"], "badge": g["badge"], "badge_color": g["badge_color"],
                "description": g["description"], "format": g["format"], "rules": g.get("rules") or [], "level_rules": g.get("level_rules") or {},
                "leader": self._trainer_payload(self.store.trainer(g["leader_id"], deleted=True)),
                "trainers": [self._trainer_payload(t) for t in self.store.trainers(ids=g.get("trainers") or [])], "source_id": g["id"]}

    def _league_payload(self, lg: dict[str, Any]) -> dict[str, Any]:
        return {"name": lg["name"], "description": lg["description"], "format": lg["format"], "rules": lg.get("rules") or [],
                "level_rules": lg.get("level_rules") or {}, "badges_required": lg.get("badges_required") or 0,
                "gyms": [self._gym_payload(g) for g in self.store.gyms(ids=lg.get("gyms") or [])],
                "elite_four": [self._trainer_payload(t) for t in self.store.trainers(ids=lg.get("elite_four") or [])],
                "champion": self._trainer_payload(self.store.trainer(lg["champion_id"], deleted=True)), "source_id": lg["id"]}

    def export(self, kind: str, id_: str, *, fmt: str = "file") -> dict[str, Any]:
        """``fmt``: file (a .hoardtrainer/.hoardgym/.hoardleague JSON), code (a share code, trainers only, without uploaded pictures), page
        (a playable HTML, gyms and trainers), paste (the team as Showdown text, trainers only)."""
        if kind == "trainer":
            obj = self.store.trainer(id_)
            payload = self._trainer_payload(obj, with_picture=fmt != "code")
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
                    "sprite_set": self.settings["sprite_set"]}
            html = sharing.playable_page(PLAY_TEMPLATE, data)
            filename = sharing.safe_filename(f"{name} - Silver", "html")
            (exports / filename).write_text(html, encoding="utf-8", newline="\n")
            return {"file": filename, "bytes": len(html.encode("utf-8")), "url": f"/api/exports/{filename}", "name": name}
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
                return "file:" + self.sprites.save_avatar(base64.b64decode(av["data"]), stem=stem)
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

    def _import_gym(self, p: dict[str, Any], origin: str = "friend") -> str:
        leader = self._import_trainer(p["leader"], origin)
        trainers = [self._import_trainer(t, origin) for t in p.get("trainers") or []]
        return self.store.add_gym({"name": str(p.get("name") or "Gimnasio")[:60], "city": str(p.get("city") or "")[:60], "type": str(p.get("type") or "")[:20],
                                   "badge": str(p.get("badge") or "")[:60], "badge_color": str(p.get("badge_color") or "")[:20],
                                   "description": str(p.get("description") or "")[:2000], "format": p.get("format") or self.settings["default_format"],
                                   "rules": [str(r)[:80] for r in p.get("rules") or []][:20], "level_rules": p.get("level_rules") or {},
                                   "leader_id": leader, "trainers": trainers, "origin": origin, "owner": str(p.get("owner") or "")[:60]})

    def import_any(self, content: Any, *, name: str = "", format_: str = "") -> dict[str, Any]:
        """Import a share code, a result code, a .hoardtrainer/.hoardgym/.hoardleague file, a playable page or Showdown team text."""
        kind, payload = sharing.parse_any(content)
        if kind == "result":
            return {"kind": "result", **self.import_result(payload)}
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
        """A friend's result from a playable page: records the badge (when they won) and the battle with its log."""
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
                badge = self.store.add_badge({"gym_id": g["id"], "gym_name": g["name"], "badge": g["badge"], "badge_color": g["badge_color"],
                                              "challenger_name": challenger, "source": "friend", "battle_id": bid,
                                              "proof": {k: r.get(k) for k in ("turns", "date", "team_paste", "stages")}})
            self.emit("friend.result", {"gym": g["name"], "challenger": challenger, "won": won})
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
            return {"trainer": self.trainer_view(t), "won": won, "battle_id": bid, "challenger": challenger}
        raise SilverError("invalid", "Unknown result.")

    def export_file(self, filename: str) -> Path:
        if not sharing.re.match(r"^[\w\- ]+\.(html|hoardtrainer|hoardgym|hoardleague)$", filename, flags=sharing.re.UNICODE):
            raise SilverError("invalid", "Not an export file.")
        path = self.config.exports_dir / filename
        if not path.exists():
            raise SilverError("not_found", f"Export not found: {filename}")
        return path

    # ------------------------------------------------------------ avatars from photos (here, or drawn by Prospero's Hoard)
    def avatar_from_photo(self, data: bytes, *, trainer_id: str = "", mode: str = "pixel", remove_background: bool = True) -> dict[str, Any]:
        stem = trainer_id or "photo"
        if mode == "pixel":
            name = self.sprites.save_avatar(data, stem=stem, pixelate=True, remove_background=remove_background)
            if trainer_id:
                self.store.update_trainer(trainer_id, {"avatar": f"file:{name}"})
            return {"file": name, "url": f"/api/avatars/{name}", "avatar": f"file:{name}"}
        if mode == "upload":
            name = self.sprites.save_avatar(data, stem=stem, pixelate=False, remove_background=False)
            if trainer_id:
                self.store.update_trainer(trainer_id, {"avatar": f"file:{name}"})
            return {"file": name, "url": f"/api/avatars/{name}", "avatar": f"file:{name}"}
        if mode != "prospero":
            raise SilverError("invalid", "mode is pixel, upload or prospero")
        return self.avatar_draw([data], trainer_id=trainer_id)

    MAX_REFERENCE_PHOTOS = 4

    def avatar_draw(self, photos: list[bytes], *, description: str = "", trainer_id: str = "", count: int = 2, style: bool = True) -> dict[str, Any]:
        """A trainer sprite drawn by Prospero's Hoard from up to four photos of the same person and/or a description (a job).
        Each result comes back twice: the pixel-art sprite (96 px) and the drawing itself, background removed."""
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
        styles = self.style_reference_paths() if style else []
        title = f"Sprite dibujado ({description[:40] or f'{len(paths)} foto(s)'})"
        return self._job("avatar", title, {"trainer_id": trainer_id, "photos": len(paths), "description": description, "styles": len(styles)},
                         lambda jid, progress, cancelled: self._prospero_sprite(paths, description, trainer_id, count, progress, cancelled,
                                                                                styles=styles, silver_job=jid))

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
        return {"images": images, "sprites": names, "used": used, "max": self.MAX_STYLE_REFS,
                "sprite_urls": {n: f"/api/sprites/trainers/{n}.png" for n in names}}

    def avatar_style_set(self, *, sprites: Optional[str] = None, add: Optional[list[tuple[str, bytes]]] = None,
                         remove: Optional[list[str]] = None) -> dict[str, Any]:
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
        return self.avatar_style_get()

    def style_reference_paths(self) -> list[str]:
        """The style pictures ready for Prospero: on white, small sprites enlarged without smoothing so the line work shows."""
        from PIL import Image
        info = self.avatar_style_get()
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

    def prospero_prompt(self, *, photos: int, description: str, styles: int = 0) -> str:
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
        parts.append(str(self.settings["prospero_prompt"]))
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
                         cancelled: Callable[[], bool], *, styles: Optional[list[str]] = None, silver_job: str = "") -> dict[str, Any]:
        progress(0.02)
        projects = self._prospero_call("studio_projects", {"query": "Silver's Hoard", "limit": 20}) or {}
        items = (projects.get("items") if isinstance(projects, dict) else None) or []
        project = next((p["id"] for p in items if p.get("name") == "Silver's Hoard"), "")
        if not project:
            created = self._prospero_call("studio_create_project", {"name": "Silver's Hoard",
                                                                    "brief": "Trainer sprites made from photos for the battle simulator."}, write=True) or {}
            project = created.get("id") or (created.get("project") or {}).get("id")
        if not project:
            raise SilverError("unavailable", "Prospero did not create the project for the sprites.")
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
        args: dict[str, Any] = {"project": project, "prompt": self.prospero_prompt(photos=len(refs), description=description, styles=len(style_ids)),
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
            drawing = self.sprites.save_avatar(data, stem=f"{stem}-drawing", pixelate=False, remove_background=not matted, max_side=512)
            files.append({"file": name, "url": f"/api/avatars/{name}", "avatar": f"file:{name}", "prospero_asset": aid, "cutout": matted,
                          "drawing": {"file": drawing, "url": f"/api/avatars/{drawing}", "avatar": f"file:{drawing}"}})
            progress(0.8 + 0.2 * (n + 1) / len(ids))
        if not files:
            raise SilverError("unavailable", "Prospero finished without pictures.")
        if trainer_id:
            self.store.update_trainer(trainer_id, {"avatar": files[0]["avatar"]})
        progress(1.0)
        return {"candidates": files, "project": project, "prospero_job": job_id, "prompt": args["prompt"]}

    # ------------------------------------------------------------ settings
    def settings_set(self, changes: dict[str, Any]) -> dict[str, Any]:
        return self.settings.update(changes)
