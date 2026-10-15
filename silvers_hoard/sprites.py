"""Pictures: Pokémon and trainer sprites from the Showdown sprite server, kept in ``data/cache/sprites`` after the first download
(nothing of that art ships with the app), and the trainers' own avatars in ``data/avatars`` (uploaded, made from a photo here
with a pixel-art filter, or drawn by Prospero's Hoard from a photo)."""

from __future__ import annotations

import io
import logging
import re
import threading
import time
from pathlib import Path
from typing import Any, Callable, Optional

from .errors import SilverError
from .hoard_link.atomic import write_bytes_atomic

log = logging.getLogger("silver.sprites")

SPRITE_ID = re.compile(r"^[a-z0-9][a-z0-9-]{0,60}$")
TRAINER_NAME = re.compile(r"^[a-z0-9][a-z0-9-]{0,60}$")
AVATAR_FILE = re.compile(r"^[A-Za-z0-9_-]{1,80}\.png$")
# sprite sets: folder, extension, and whether back and shiny folders exist
SETS = {
    "gen5": ("gen5", "png"),
    "gen5ani": ("gen5ani", "gif"),
    "ani": ("ani", "gif"),
    "home": ("home", "png"),
    "dex": ("dex", "png"),
}
NEGATIVE_TTL_S = 7 * 24 * 3600
MAX_IMAGE_BYTES = 12 * 1024 * 1024


class Sprites:
    def __init__(self, cache_dir: Path, avatars_dir: Path, settings: Any, http_get: Optional[Callable[[str], tuple[int, bytes, str]]] = None):
        self.cache_dir = Path(cache_dir)
        self.avatars_dir = Path(avatars_dir)
        self.settings = settings
        self._http_get = http_get or _http_get
        self._locks: dict[str, threading.Lock] = {}
        self._locks_guard = threading.Lock()
        self.downloads = 0
        self.misses = 0

    # ------------------------------------------------------------ remote sprites
    def _lock(self, key: str) -> threading.Lock:
        with self._locks_guard:
            return self._locks.setdefault(key, threading.Lock())

    def fetch(self, rel: str) -> Optional[Path]:
        """The cached file for ``rel`` (a path under the sprite server, e.g. ``gen5/pikachu.png``), downloading it once. None when the
        server has no such picture (remembered for a week) or downloads are off and it is not cached."""
        if ".." in rel or rel.startswith("/") or not re.match(r"^[a-z0-9-]+(/[a-z0-9-]+)*\.(png|gif)$", rel):
            raise SilverError("invalid", f"Not a sprite path: {rel}")
        path = self.cache_dir / rel
        if path.exists() and path.stat().st_size > 0:
            return path
        miss = path.with_suffix(path.suffix + ".404")
        if miss.exists() and time.time() - miss.stat().st_mtime < NEGATIVE_TTL_S:
            return None
        if not self.settings.get("sprite_downloads", True):
            return None
        with self._lock(rel):
            if path.exists() and path.stat().st_size > 0:
                return path
            url = f"{str(self.settings.get('sprite_server')).rstrip('/')}/{rel}"
            try:
                status, body, ctype = self._http_get(url)
            except Exception as exc:  # noqa: BLE001 - offline: no picture, the UI shows its placeholder
                log.info("sprite %s: %s", rel, exc)
                return None
            if status == 200 and body and len(body) < MAX_IMAGE_BYTES and (ctype.startswith("image/") or body[:4] in (b"\x89PNG", b"GIF8")):
                path.parent.mkdir(parents=True, exist_ok=True)
                write_bytes_atomic(path, body, fsync=False)
                self.downloads += 1
                return path
            if status in (404, 403, 410):
                miss.parent.mkdir(parents=True, exist_ok=True)
                miss.write_text(str(status))
            self.misses += 1
            return None

    def pokemon(self, sprite_id: str, *, set_: str = "", back: bool = False, shiny: bool = False) -> Path:
        """The best picture of a Pokémon in the chosen set, falling back to the gen 5 pixel art (which covers every species)."""
        sid = sprite_id.lower()
        if not SPRITE_ID.match(sid):
            raise SilverError("invalid", f"Not a sprite id: {sprite_id}")
        chosen = set_ if set_ in SETS else self.settings.get("sprite_set", "gen5ani")
        candidates = []
        for s in [chosen, "gen5"]:
            folder, ext = SETS[s]
            if s in ("home", "dex"):
                candidates.append(f"{folder}/{sid}.{ext}")
                continue
            variant = folder + ("-back" if back else "") + ("-shiny" if shiny else "")
            candidates.append(f"{variant}/{sid}.{ext}")
            if shiny:
                candidates.append(f"{folder}{'-back' if back else ''}/{sid}.{ext}")
        base = sid.split("-")[0]
        if base != sid:
            candidates += [f"gen5{'-back' if back else ''}/{base}.png"]
        for rel in dict.fromkeys(candidates):
            path = self.fetch(rel)
            if path:
                return path
        raise SilverError("not_found", f"No sprite for {sprite_id}")

    def trainer(self, name: str) -> Path:
        n = name.lower()
        if not TRAINER_NAME.match(n):
            raise SilverError("invalid", f"Not a trainer sprite: {name}")
        path = self.fetch(f"trainers/{n}.png")
        if not path:
            raise SilverError("not_found", f"No trainer sprite {name}")
        return path

    def item_icon(self, item_id: str) -> Path:
        n = item_id.lower()
        if not SPRITE_ID.match(n):
            raise SilverError("invalid", f"Not an item: {item_id}")
        path = self.fetch(f"itemicons/{n}.png")
        if not path:
            raise SilverError("not_found", f"No icon for {item_id}")
        return path

    def stats(self) -> dict[str, Any]:
        files = [p for p in self.cache_dir.rglob("*") if p.is_file() and p.suffix in (".png", ".gif")] if self.cache_dir.exists() else []
        return {"cached": len(files), "bytes": sum(p.stat().st_size for p in files), "downloads": self.downloads, "misses": self.misses,
                "downloads_on": bool(self.settings.get("sprite_downloads", True))}

    # ------------------------------------------------------------ avatars
    def avatar_path(self, filename: str) -> Path:
        if not AVATAR_FILE.match(filename):
            raise SilverError("invalid", f"Not an avatar file: {filename}")
        path = self.avatars_dir / filename
        if not path.exists():
            raise SilverError("not_found", f"Avatar not found: {filename}")
        return path

    def save_avatar(self, data: bytes, *, stem: str, pixelate: bool = False, remove_background: bool = False, size: int = 96,
                    max_side: int = 256) -> str:
        """Store an uploaded picture as a PNG avatar (optionally turned into pixel art). Returns the file name."""
        if not data:
            raise SilverError("invalid", "The picture is empty.")
        if len(data) > MAX_IMAGE_BYTES:
            raise SilverError("too_large", "The picture is larger than 12 MB.")
        img = _open_image(data)
        if remove_background:
            img = cut_background(img)
        img = to_sprite(img, size=size) if pixelate else _fit(img, max_side)
        buf = io.BytesIO()
        img.save(buf, "PNG", optimize=True)
        name = f"{re.sub(r'[^A-Za-z0-9_-]', '', stem)[:60] or 'avatar'}-{int(time.time() * 1000) % 10**10}.png"
        self.avatars_dir.mkdir(parents=True, exist_ok=True)
        write_bytes_atomic(self.avatars_dir / name, buf.getvalue(), fsync=False)
        return name

    BACKDROP_BYTES = 400_000

    def save_backdrop(self, data: bytes, *, stem: str) -> str:
        """Store a picture of your own as a battle backdrop: up to 800 px wide, no transparency, colours reduced until the PNG is
        small enough to travel inside a gym file or a playable page (BACKDROP_BYTES). Returns the file name (with the avatars)."""
        if not data:
            raise SilverError("invalid", "The picture is empty.")
        if len(data) > MAX_IMAGE_BYTES:
            raise SilverError("too_large", "The picture is larger than 12 MB.")
        img = _open_image(data).convert("RGB")
        img.thumbnail((800, 600))
        out = b""
        for side, colors in ((800, 256), (800, 128), (640, 128), (640, 64), (480, 64), (400, 48)):
            pic = img.copy()
            pic.thumbnail((side, side))
            buf = io.BytesIO()
            pic.quantize(colors=colors).save(buf, "PNG", optimize=True)
            out = buf.getvalue()
            if len(out) <= self.BACKDROP_BYTES:
                break
        name = f"{re.sub(r'[^A-Za-z0-9_-]', '', stem)[:60] or 'backdrop'}-{int(time.time() * 1000) % 10**10}.png"
        self.avatars_dir.mkdir(parents=True, exist_ok=True)
        write_bytes_atomic(self.avatars_dir / name, out, fsync=False)
        return name

    def avatars(self) -> list[dict[str, Any]]:
        if not self.avatars_dir.exists():
            return []
        out = [{"file": p.name, "bytes": p.stat().st_size, "modified": p.stat().st_mtime} for p in self.avatars_dir.glob("*.png") if p.is_file()]
        return sorted(out, key=lambda x: -x["modified"])


def _http_get(url: str) -> tuple[int, bytes, str]:
    import httpx

    with httpx.Client(timeout=15.0, follow_redirects=True, headers={"User-Agent": "SilversHoard/0.1 (local battle simulator)"}) as client:
        r = client.get(url)
        return r.status_code, r.content, r.headers.get("content-type", "")


def _open_image(data: bytes):
    from PIL import Image, ImageOps

    try:
        img = Image.open(io.BytesIO(data))
        img.load()
    except Exception as exc:  # noqa: BLE001 - any decoder error is a bad picture
        raise SilverError("invalid", f"Not a picture this app can read: {exc}") from None
    img = ImageOps.exif_transpose(img)
    return img.convert("RGBA")


def _fit(img, size: int):
    img = img.copy()
    img.thumbnail((size, size))
    return img


def cut_background(img, tolerance: int = 34):
    """Make the plain background transparent: flood from the edges (every few pixels along the four sides, wherever the edge
    has the background colour, taken from the corners) over pixels close to that colour."""
    from PIL import ImageDraw

    img = img.convert("RGBA")
    w, h = img.size
    mask_img = img.copy()
    marker = (255, 0, 255, 0)
    corners = [img.getpixel(xy)[:3] for xy in ((0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1))]
    bg = max(set(corners), key=corners.count)

    def close(c) -> bool:
        return all(abs(int(a) - int(b)) <= tolerance for a, b in zip(c[:3], bg))

    step = max(1, min(w, h) // 64)
    seeds = [(x, y) for x in range(0, w, step) for y in (0, h - 1)] + [(x, y) for y in range(0, h, step) for x in (0, w - 1)]
    for xy in seeds:
        px = mask_img.getpixel(xy)
        if px == marker or not close(px):
            continue
        try:
            ImageDraw.floodfill(mask_img, xy, marker, thresh=tolerance)
        except Exception:  # noqa: BLE001 - a seed that cannot be filled is left as it is
            continue
    px_src = img.load()
    px_mask = mask_img.load()
    for y in range(h):
        for x in range(w):
            if px_mask[x, y] == marker:
                r, g, b, _ = px_src[x, y]
                px_src[x, y] = (r, g, b, 0)
    return img


def to_sprite(img, size: int = 96, colors: int = 32):
    """Pixel art in the style of handheld-game trainer sprites: crop to the subject, shrink to ``size`` px with few colours,
    1-pixel dark outline around the opaque part."""
    from PIL import Image

    img = img.convert("RGBA")
    bbox = img.getchannel("A").getbbox()
    if bbox:
        img = img.crop(bbox)
    w, h = img.size
    scale = (size - 4) / max(w, h)
    # premultiplied resize: the colour of transparent pixels (often the white background) must not bleed into the edges
    small = img.convert("RGBa").resize((max(1, round(w * scale)), max(1, round(h * scale))), Image.Resampling.BOX).convert("RGBA")
    alpha = small.getchannel("A").point(lambda a: 255 if a >= 128 else 0)
    # averaging a big drawing down to ~90 px blurs eyes and outlines: a light unsharp mask brings back the edges a
    # hand-made sprite has
    from PIL import ImageFilter
    rgb = small.convert("RGB").filter(ImageFilter.UnsharpMask(radius=1, percent=120, threshold=2))
    # the palette comes from the visible pixels only: counting the transparent ones spends colours on the background and
    # pulls skin and clothes towards grey
    opaque = [px for px, a in zip(rgb.getdata(), alpha.getdata()) if a]
    if opaque:
        sample = Image.new("RGB", (len(opaque), 1))
        sample.putdata(opaque)
        palette = sample.quantize(colors=colors, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
        rgb = rgb.quantize(palette=palette, dither=Image.Dither.NONE).convert("RGB")
    sprite = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    ox = (size - small.width) // 2
    oy = size - small.height - 2
    tile = rgb.convert("RGBA")
    tile.putalpha(alpha)
    sprite.paste(tile, (ox, oy), tile)
    px = sprite.load()
    outline = []
    for y in range(size):
        for x in range(size):
            if px[x, y][3] == 0 and any(0 <= x + dx < size and 0 <= y + dy < size and px[x + dx, y + dy][3] == 255
                                        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))):
                outline.append((x, y))
    for x, y in outline:
        px[x, y] = (24, 20, 28, 255)
    return sprite
