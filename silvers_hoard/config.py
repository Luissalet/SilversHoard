"""Process configuration (environment) and the editable settings (``<data>/settings.json``)."""

from __future__ import annotations

import copy
import os
import shutil
import threading
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from . import APP_ID, DEFAULT_PORT
from .hoard_link.appconfig import AppPaths, env_int, env_str
from .hoard_link.atomic import read_json, write_json_atomic
from .hoard_link.guard import parse_allowed_hosts

REPO_ROOT = Path(__file__).resolve().parent.parent
ENGINE_DIR = REPO_ROOT / "engine"

AI_LEVELS = ("random", "easy", "normal", "hard", "expert")
AI_STYLES = ("balanced", "aggressive", "defensive", "setup", "stall")
SPRITE_SETS = ("gen5", "gen5ani", "ani", "home", "dex")

DEFAULT_SETTINGS: dict[str, Any] = {
    "player_name": "",            # the name your own trainers carry when you send them to friends
    "default_format": "gen9customgame",
    "default_ai_level": "normal",
    "default_ai_style": "balanced",
    "sprite_set": "gen5ani",      # gen5 (pixel art), gen5ani (animated pixel art, gen5 for newer species), ani (3D), home, dex
    "playback_ms": 900,           # pause between two events when a battle is watched
    "max_turns": 300,             # a battle that reaches this many turns ends in a tie
    "node_path": "",              # empty: `node` from PATH
    "sprite_downloads": True,     # fetch missing sprites from the Showdown sprite server and keep them in data/cache/sprites
    "sprite_server": "https://play.pokemonshowdown.com/sprites",
    "prospero_prompt": ("pixel art sprite of the person in the reference photo as a monster-trainer character from a 2000s handheld "
                        "role-playing game, full body, standing, facing the viewer, limited palette, crisp 1-pixel outlines, flat "
                        "plain white background, no text"),
    "prospero_engine": "",        # image engine Prospero uses for sprites ("" = the project's default; qwen21, flux, sdxl)
    "series_default": 20,         # battles in a series when none is given
}


@dataclass
class Config:
    data_dir: Path = field(default_factory=lambda: REPO_ROOT / "data")
    port: int = DEFAULT_PORT
    allowed_hosts: tuple[str, ...] = ()
    data_dir_configured: bool = False
    engine_dir: Path = ENGINE_DIR
    background: bool = True         # engine process and job threads; tests can switch the engine to a stub

    @property
    def paths(self) -> AppPaths:
        return AppPaths(APP_ID, REPO_ROOT, self.data_dir, self.data_dir_configured)

    @property
    def token_path(self) -> Path:
        return self.paths.token_path

    @property
    def settings_path(self) -> Path:
        return self.data_dir / "settings.json"

    @property
    def db_path(self) -> Path:
        return self.paths.db_path

    @property
    def sprites_dir(self) -> Path:
        return self.data_dir / "cache" / "sprites"

    @property
    def avatars_dir(self) -> Path:
        return self.data_dir / "avatars"

    @property
    def exports_dir(self) -> Path:
        return self.data_dir / "exports"

    @classmethod
    def from_env(cls) -> "Config":
        data_env = env_str("SILVER_DATA_DIR")
        return cls(
            data_dir=Path(data_env).expanduser() if data_env else REPO_ROOT / "data",
            port=env_int("SILVER_PORT", default=DEFAULT_PORT) or DEFAULT_PORT,
            allowed_hosts=tuple(parse_allowed_hosts(os.environ.get("SILVER_ALLOWED_HOSTS", ""))),
            data_dir_configured=bool(data_env),
        )


def find_node(configured: str = "") -> str:
    """The Node executable: the setting, ``SILVER_NODE``, else ``node`` on PATH (and the usual Windows install folder)."""
    for candidate in (configured, os.environ.get("SILVER_NODE", "")):
        if candidate and Path(candidate).exists():
            return candidate
    found = shutil.which("node")
    if found:
        return found
    for guess in (r"C:\Program Files\nodejs\node.exe", r"C:\Program Files (x86)\nodejs\node.exe"):
        if Path(guess).exists():
            return guess
    return ""


class Settings:
    """Thread-safe JSON settings with defaults; ``update`` validates and writes atomically."""

    def __init__(self, path: Path):
        self.path = path
        self._lock = threading.RLock()
        stored = read_json(path, default={}) or {}
        self._data = {**copy.deepcopy(DEFAULT_SETTINGS), **{k: v for k, v in stored.items() if k in DEFAULT_SETTINGS}}

    def __getitem__(self, key: str) -> Any:
        with self._lock:
            return copy.deepcopy(self._data[key])

    def get(self, key: str, default: Any = None) -> Any:
        with self._lock:
            return copy.deepcopy(self._data.get(key, default))

    def snapshot(self) -> dict[str, Any]:
        with self._lock:
            return copy.deepcopy(self._data)

    def update(self, changes: dict[str, Any]) -> dict[str, Any]:
        from .errors import SilverError

        clean: dict[str, Any] = {}
        for key, value in (changes or {}).items():
            if key not in DEFAULT_SETTINGS:
                raise SilverError("invalid", f"Unknown setting: {key}")
            if value is None:
                continue
            default = DEFAULT_SETTINGS[key]
            if isinstance(default, bool):
                value = bool(value)
            elif isinstance(default, int):
                try:
                    value = int(value)
                except (TypeError, ValueError):
                    raise SilverError("invalid", f"{key} must be a number") from None
            else:
                value = str(value).strip()
            if key == "default_ai_level" and value not in AI_LEVELS:
                raise SilverError("invalid", f"default_ai_level must be one of {', '.join(AI_LEVELS)}")
            if key == "default_ai_style" and value not in AI_STYLES:
                raise SilverError("invalid", f"default_ai_style must be one of {', '.join(AI_STYLES)}")
            if key == "sprite_set" and value not in SPRITE_SETS:
                raise SilverError("invalid", f"sprite_set must be one of {', '.join(SPRITE_SETS)}")
            if key == "playback_ms":
                value = max(0, min(int(value), 5000))
            if key == "max_turns":
                value = max(20, min(int(value), 2000))
            if key == "series_default":
                value = max(1, min(int(value), 1000))
            if key == "sprite_server" and not value.startswith("https://"):
                raise SilverError("invalid", "sprite_server must be an https:// address")
            clean[key] = value
        with self._lock:
            self._data.update(clean)
            write_json_atomic(self.path, self._data)
            return copy.deepcopy(self._data)
