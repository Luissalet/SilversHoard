"""Battle effect pictures: the images Pokémon Showdown's move animations draw (``fx/wisp.png``, ``fx/bg-space.jpg``…) and the battle
backdrops, downloaded once from the Showdown client and kept in ``data/cache/fx`` (nothing of that art ships with the app).

The animations themselves are data in ``client/src/battle/fx/ps/anims.gen.js``; this only serves the pictures they name. Same idea as
the sprite and audio caches: download once, remember the 404s for a week, serve from disk, never anything outside the two folders."""

from __future__ import annotations

import logging
import re
import threading
import time
from pathlib import Path
from typing import Any, Callable, Optional

from .errors import SilverError
from .hoard_link.atomic import write_bytes_atomic

log = logging.getLogger("silver.fx")

# fx/<name> on the client (effects, weather and terrain layers, bg-space) and sprites/gen6bgs/<name> (the backdrops)
NAME = re.compile(r"^[a-z0-9][a-z0-9._-]{0,63}\.(png|jpg|jpeg|gif|webp)$")
FOLDERS = {"fx": "fx", "bg": "sprites/gen6bgs"}
NEGATIVE_TTL_S = 7 * 24 * 3600
MAX_BYTES = 4 * 1024 * 1024
DEFAULT_SERVER = "https://play.pokemonshowdown.com"


def looks_like_image(body: bytes) -> bool:
    return (body[:8] == b"\x89PNG\r\n\x1a\n" or body[:3] == b"\xff\xd8\xff" or body[:6] in (b"GIF87a", b"GIF89a")
            or (body[:4] == b"RIFF" and body[8:12] == b"WEBP"))


class FxCache:
    def __init__(self, cache_dir: Path, settings: Any, http_get: Optional[Callable[[str], tuple[int, bytes, str]]] = None):
        from .sprites import _http_get

        self.cache_dir = Path(cache_dir)
        self.settings = settings
        self._http_get = http_get or _http_get
        self._locks: dict[str, threading.Lock] = {}
        self._locks_guard = threading.Lock()
        self.downloads = 0
        self.misses = 0

    def _lock(self, key: str) -> threading.Lock:
        with self._locks_guard:
            return self._locks.setdefault(key, threading.Lock())

    def _server(self) -> str:
        return str(self.settings.get("fx_server") or DEFAULT_SERVER).rstrip("/")

    def get(self, name: str, kind: str = "fx") -> Path:
        """The cached picture ``name`` of ``kind`` (``fx`` or ``bg``), downloading it the first time. SilverError ``invalid`` for a
        name outside the pattern, ``not_found`` when Showdown has no such file, downloads are off, or the network is down."""
        n = name.lower()
        if kind not in FOLDERS or not NAME.match(n):
            raise SilverError("invalid", f"Not an effect picture: {name}")
        rel = f"{kind}/{n}"
        path = self.cache_dir / rel
        if path.exists() and path.stat().st_size > 0:
            return path
        miss = path.with_suffix(path.suffix + ".404")
        if miss.exists() and time.time() - miss.stat().st_mtime < NEGATIVE_TTL_S:
            raise SilverError("not_found", f"No effect picture {name}")
        if not self.settings.get("sprite_downloads", True):
            raise SilverError("not_found", f"Effect picture {name} is not cached and downloads are off")
        with self._lock(rel):
            if path.exists() and path.stat().st_size > 0:
                return path
            url = f"{self._server()}/{FOLDERS[kind]}/{n}"
            try:
                status, body, _ctype = self._http_get(url)
            except Exception as exc:  # noqa: BLE001 - offline: the animation draws without this picture
                log.info("fx %s: %s", rel, exc)
                raise SilverError("not_found", f"Could not download {name}") from None
            if status == 200 and body and len(body) < MAX_BYTES and looks_like_image(body):
                path.parent.mkdir(parents=True, exist_ok=True)
                write_bytes_atomic(path, body, fsync=False)
                self.downloads += 1
                return path
            if status in (404, 403, 410):
                miss.parent.mkdir(parents=True, exist_ok=True)
                miss.write_text(str(status))
            self.misses += 1
            raise SilverError("not_found", f"No effect picture {name}")

    def known(self, anims_js: Optional[Path] = None, backdrop_js: Optional[Path] = None) -> list[tuple[str, str]]:
        """Every (kind, name) the turn-based screen can show: the effect pictures of BattleEffects and the backdrops and weather layers some
        moves flash behind the field (client/src/battle/fx/ps/anims.gen.js), plus the battle backdrops and the weather and terrain
        overlays of client/src/battle/fx/backdrop.js."""
        from .config import REPO_ROOT

        fx_dir = REPO_ROOT / "client" / "src" / "battle" / "fx"
        out: dict[tuple[str, str], None] = {}

        def read(path: Path) -> str:
            try:
                return path.read_text(encoding="utf-8")
            except OSError:
                return ""

        text = read(anims_js or fx_dir / "ps" / "anims.gen.js")
        for m in re.finditer(r'url:\s*"([a-z0-9._-]+\.(?:png|jpg|gif))"', text):
            out[("fx", m.group(1))] = None
        for m in re.finditer(r"/(fx|sprites/gen6bgs)/([a-z0-9._-]+\.(?:png|jpg|gif))", text):
            out[("fx" if m.group(1) == "fx" else "bg", m.group(2))] = None
        text = read(backdrop_js or fx_dir / "backdrop.js")
        gen6 = re.search(r"export const BACKDROPS = \[(.*?)\];", text, re.S)
        gen6_names = set(re.findall(r'"([a-z0-9._-]+)"', gen6.group(1))) if gen6 else set()
        for name in re.findall(r'"((?:bg|weather)-[a-z0-9._-]+\.(?:png|jpg|gif))"', text):
            out[("bg" if name in gen6_names else "fx", name)] = None
        for name in re.findall(r'"fx/(bg-gen[12]\.png)"', text):
            out[("fx", name)] = None
        return [k for k in out if NAME.match(k[1])]

    def prefetch(self, anims_js: Optional[Path] = None, backdrop_js: Optional[Path] = None) -> dict[str, Any]:
        """Downloads every picture the animations and backdrops use (for battles without internet afterwards); returns what failed and
        the stats."""
        failed = []
        names = self.known(anims_js, backdrop_js)
        for kind, name in names:
            try:
                self.get(name, kind)
            except SilverError:
                failed.append(f"{kind}/{name}")
        return {"pictures": len(names), "failed": failed, **self.stats()}

    def stats(self) -> dict[str, Any]:
        files = [p for p in self.cache_dir.rglob("*") if p.is_file() and not p.name.endswith(".404")] if self.cache_dir.exists() else []
        return {"cached": len(files), "bytes": sum(p.stat().st_size for p in files), "downloads": self.downloads, "misses": self.misses,
                "server": self._server()}
