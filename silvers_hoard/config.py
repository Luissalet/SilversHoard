"""Process configuration (environment) and the editable settings (``<data>/settings.json``)."""

from __future__ import annotations

import copy
import re
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

AI_LEVELS = ("random", "easy", "normal", "hard", "expert", "master", "neural")
AI_STYLES = ("balanced", "aggressive", "defensive", "setup", "stall")
SPRITE_SETS = ("gen5", "gen5ani", "ani", "home", "dex", "champions", "za", "sv")

DEFAULT_SETTINGS: dict[str, Any] = {
    "player_name": "",            # the name your own trainers carry when you send them to friends
    "default_format": "gen9nationaldexag",   # anything goes: every Pokémon, item and move, Mega, Z and Terastal, no tier bans
    "default_ai_level": "normal",
    "default_ai_style": "balanced",
    "sprite_set": "gen5ani",      # gen5 (pixel art), gen5ani (animated pixel art, gen5 for newer species), ani (3D), home, dex
    "playback_ms": 900,           # pause between two events when a battle is watched
    "max_turns": 300,             # a battle that reaches this many turns ends in a tie
    "node_path": "",              # empty: `node` from PATH
    "sprite_downloads": True,     # fetch missing sprites from the Showdown sprite server and keep them in data/cache/sprites
    "sprite_server": "https://play.pokemonshowdown.com/sprites",
    "smogon_data": True,
    "ai_banter": False,           # the AI trainers comment their moves in character, written by the family's language model as the battle goes
    "ai_hidden_info": False,       # the AI sees only what the battle has shown of the opponent's team (guessing the rest)           # popular sets and usage stats from data.pkmn.cc, fetched when asked for, kept in data/cache/smogon
    "sound_downloads": True,      # fetch Pokémon cries and battle music from the Showdown audio server and keep them in data/cache/audio
    "audio_server": "https://play.pokemonshowdown.com/audio",
    "music_source": "showdown",   # battle music: showdown (its trainer and rival themes) or pokerogue (its community's original tracks)
    "pokerogue_audio": "https://raw.githubusercontent.com/pagefaultgames/pokerogue-assets/beta/audio/bgm",
    "prospero_prompt": ("anime-style full-body trainer illustration in the art style of a 2010s handheld monster-catching role-playing "
                        "game, standing, facing the viewer, cel shading with two or three tones, clean dark outlines, limited palette, "
                        "flat plain white background, no text, no frame"),
    # the same for a drawing that stays a drawing (avatar_draw look="art"): the games' official artwork, not pixel art
    "prospero_prompt_art": ("official character artwork of a monster-catching role-playing game, in the style of its official "
                            "illustrations of the 2010s: full body, standing, facing the viewer, clean thin dark outlines, cel shading "
                            "with two or three tones, soft highlights on the hair, bright saturated colours, large expressive eyes, "
                            "flat plain white background, no pixel art, no text, no frame"),
    # Showdown trainer sprites (names) Prospero gets as art-style references; generic Black/White trainer classes
    "prospero_style_sprites": "backpacker,acetrainer,pilot",
    "prospero_engine": "",        # image engine Prospero uses for sprites ("" = the project's default; qwen21, flux, sdxl)
    "series_default": 20,         # battles in a series when none is given
    "default_mode": "classic",    # classic (turns, Showdown's engine) or realtime (Legends: Z-A rules: cooldowns, a 2D arena)
    "default_level": 0,           # 0: every Pokémon at its own level; 50 or 100: new battles equalize both teams to that level
    "rt_time_limit": 300,         # seconds of a real-time battle; then more Pokémon standing wins, then more HP left
    "pmd_sprites": True,          # real-time arena: walking sprites from PMDCollab's SpriteCollab, downloaded once and cached
    "pmd_server": "https://raw.githubusercontent.com/PMDCollab/SpriteCollab/master",
    # the neural AI level (silvers_hoard/neural.py): the python of an environment with PyTorch and metamon ("" = off), its model,
    # the GPU (as nvidia-smi numbers them; "" = the first) and the port of its local server
    "neural_ai_python": "",
    "neural_ai_model": "Kakuna",
    "neural_ai_gpu": "",
    "neural_ai_port": 8857,
    # live battles with a friend on another computer (pvp.py): the port of the room server Silver opens on the network while a
    # room is open, and the address friends outside your network reach it at ("" = only links on your network are given)
    "pvp_port": 5240,
    "pvp_public_url": "",
    # the code in your lobby address (/lobby?c=…), which lists your open rooms to the friends you gave it; "" = made on first use
    "pvp_lobby_code": "",
}
MODES = ("classic", "realtime")


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
    def style_refs_dir(self) -> Path:
        """Pictures the user adds as art-style references for drawn sprites (official art, anime stills, sprites)."""
        return self.data_dir / "style_refs"

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


# earlier defaults: a stored value equal to one of these is an old default, not a choice, and gives way to the new one
PREVIOUS_DEFAULTS = {
    "default_format": ["gen9customgame"],
    "prospero_prompt": ["pixel art sprite of the person in the reference photo as a monster-trainer character from a 2000s handheld "
                        "role-playing game, full body, standing, facing the viewer, limited palette, crisp 1-pixel outlines, flat "
                        "plain white background, no text"],
}


class Settings:
    """Thread-safe JSON settings with defaults; ``update`` validates and writes atomically."""

    def __init__(self, path: Path):
        self.path = path
        self._lock = threading.RLock()
        stored = read_json(path, default={}) or {}
        stored = {k: v for k, v in stored.items() if k in DEFAULT_SETTINGS and v not in PREVIOUS_DEFAULTS.get(k, [])}
        self._data = {**copy.deepcopy(DEFAULT_SETTINGS), **stored}

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
            if key == "music_source" and value not in ("showdown", "pokerogue"):
                raise SilverError("invalid", "music_source is showdown or pokerogue")
            if key == "sprite_set" and value not in SPRITE_SETS:
                raise SilverError("invalid", f"sprite_set must be one of {', '.join(SPRITE_SETS)}")
            if key == "playback_ms":
                value = max(0, min(int(value), 5000))
            if key == "max_turns":
                value = max(20, min(int(value), 2000))
            if key == "series_default":
                value = max(1, min(int(value), 1000))
            if key == "default_mode" and value not in MODES:
                raise SilverError("invalid", "default_mode is classic or realtime")
            if key == "default_level" and value not in (0, 50, 100):
                raise SilverError("invalid", "default_level is 0, 50 or 100")
            if key == "rt_time_limit":
                value = max(30, min(int(value), 1800))
            if key == "pvp_port":
                value = max(1024, min(int(value), 65535))
            if key == "pvp_lobby_code" and value and not re.match(r"^[A-Za-z0-9]{8,40}$", value):
                raise SilverError("invalid", "pvp_lobby_code is 8 to 40 letters and digits (or empty for a new one)")
            if key == "pvp_public_url" and value and not re.match(r"^https?://[^\s/]+(/[^\s]*)?$", value):
                raise SilverError("invalid", "pvp_public_url is an http:// or https:// address (or empty)")
            if key == "neural_ai_port":
                value = max(1024, min(int(value), 65535))
            if key == "neural_ai_model" and not re.match(r"^[A-Za-z][A-Za-z0-9_]{1,60}$", value):
                raise SilverError("invalid", "neural_ai_model is the name of a pretrained model, such as Kakuna")
            if key == "neural_ai_gpu" and value and not re.match(r"^\d{1,2}$", value):
                raise SilverError("invalid", "neural_ai_gpu is a GPU index (0, 1…) or empty")
            if key == "pmd_server" and not value.startswith("https://"):
                raise SilverError("invalid", "pmd_server must be an https:// address")
            if key == "prospero_style_sprites":
                names = [n.strip().lower() for n in value.split(",") if n.strip()]
                if len(names) > 3 or any(not re.match(r"^[a-z0-9][a-z0-9-]{0,60}$", n) for n in names):
                    raise SilverError("invalid", "prospero_style_sprites: up to 3 trainer sprite names separated by commas")
                value = ",".join(names)
            if key == "audio_server" and not value.startswith("https://"):
                raise SilverError("invalid", "audio_server must be an https:// address")
            if key == "sprite_server" and not value.startswith("https://"):
                raise SilverError("invalid", "sprite_server must be an https:// address")
            clean[key] = value
        with self._lock:
            self._data.update(clean)
            # only what differs from the defaults is stored, so a better default reaches everybody who did not change it
            write_json_atomic(self.path, {k: v for k, v in self._data.items() if v != DEFAULT_SETTINGS.get(k)})
            return copy.deepcopy(self._data)
