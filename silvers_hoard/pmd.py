"""Walking sprites for the real-time arena: the Mystery Dungeon-style sheets of PMDCollab's SpriteCollab (eight directions per
animation, every generation; CC BY-NC 4.0, credit in the README). Like the Showdown sprites, none of that art ships with the app:
a sheet is downloaded the first time a battle needs it and kept in ``data/cache/pmd``.

Each animation has its own frame size, so the screen lines frames up by a ground anchor worked out from the animation's
``-Shadow.png`` (the method of PokéSurvivor's ``tools/fetch_sprites.py``, MIT). Sheet rows are the eight directions: down,
down-right, right, up-right, up, up-left, left, down-left."""

from __future__ import annotations

import io
import json
import logging
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any, Callable, Optional

from .errors import SilverError
from .hoard_link.atomic import write_bytes_atomic

log = logging.getLogger("silver.pmd")

WANT = ["Idle", "Walk", "Attack", "Shoot", "Charge", "Hurt", "Faint", "Sleep"]
FALLBACK = {
    "Idle": ["Walk"], "Walk": ["Idle"], "Attack": ["Strike", "Swing", "Shoot", "Idle"], "Shoot": ["Attack", "Strike", "Idle"],
    "Charge": ["DeepBreath", "Idle"], "Hurt": ["Cringe", "Idle"], "Faint": ["Hurt", "Idle"], "Sleep": ["Laying", "Idle"],
}
REQUIRED = {"Idle", "Walk"}
TRACKER_TTL_S = 7 * 24 * 3600
NEGATIVE_TTL_S = 3 * 24 * 3600
MAX_BYTES = 8 * 1024 * 1024
FORM_ID = re.compile(r"^[a-z0-9]{0,40}$")


def _toid(text: str) -> str:
    return re.sub(r"[^a-z0-9]", "", str(text or "").lower())


def parse_animdata(xml: str) -> tuple[dict[str, dict[str, Any]], int]:
    anims: dict[str, dict[str, Any]] = {}
    for blk in re.findall(r"<Anim>(.*?)</Anim>", xml, re.S):
        name = re.search(r"<Name>(\w+)</Name>", blk)
        if not name:
            continue
        copy = re.search(r"<CopyOf>(\w+)</CopyOf>", blk)
        if copy:
            anims[name.group(1)] = {"copyOf": copy.group(1)}
            continue
        fw = re.search(r"<FrameWidth>(\d+)</FrameWidth>", blk)
        fh = re.search(r"<FrameHeight>(\d+)</FrameHeight>", blk)
        if not (fw and fh):
            continue
        durs = [int(x) for x in re.findall(r"<Duration>(\d+)</Duration>", blk)]
        anims[name.group(1)] = {"w": int(fw.group(1)), "h": int(fh.group(1)), "n": len(durs), "d": durs}
    shadow = re.search(r"<ShadowSize>(\d+)</ShadowSize>", xml)
    return anims, int(shadow.group(1)) if shadow else 1


def resolve(anims: dict[str, dict[str, Any]], name: str, seen: Optional[set[str]] = None) -> tuple[Optional[str], Optional[dict[str, Any]]]:
    seen = seen or set()
    if name not in anims or name in seen:
        return None, None
    seen.add(name)
    a = anims[name]
    if "copyOf" in a:
        return resolve(anims, a["copyOf"], seen)
    return name, a


def ground_anchor(png: bytes, w: int, h: int) -> Optional[tuple[float, float]]:
    """The centre of the shadow drawn in the first frame: where the feet go."""
    from PIL import Image

    try:
        im = Image.open(io.BytesIO(png)).convert("RGBA")
    except Exception:  # noqa: BLE001 - no anchor, the caller guesses one
        return None
    px = im.crop((0, 0, w, h)).load()
    xs = ys = n = 0
    for y in range(h):
        for x in range(w):
            if px[x, y][3] > 40:
                xs += x
                ys += y
                n += 1
    return (round(xs / n, 1), round(ys / n, 1)) if n else None


class PmdSprites:
    def __init__(self, cache_dir: Path, settings: Any, http_get: Callable[[str], tuple[int, bytes, str]]):
        self.cache_dir = Path(cache_dir)
        self.settings = settings
        self._http_get = http_get
        self._locks: dict[str, threading.Lock] = {}
        self._guard = threading.Lock()
        self._forms: Optional[dict[str, dict[str, str]]] = None

    def _lock(self, key: str) -> threading.Lock:
        with self._guard:
            return self._locks.setdefault(key, threading.Lock())

    def _base(self) -> str:
        return str(self.settings.get("pmd_server") or "https://raw.githubusercontent.com/PMDCollab/SpriteCollab/master").rstrip("/")

    def _get(self, url: str) -> Optional[bytes]:
        try:
            status, body, _ = self._http_get(url)
        except Exception as exc:  # noqa: BLE001 - offline: the arena falls back to the battle sprites
            log.info("pmd %s: %s", url, exc)
            return None
        return body if status == 200 and body and len(body) < 64 * 1024 * 1024 else None

    # ------------------------------------------------------------ forms
    def forms(self) -> dict[str, dict[str, str]]:
        """{dex: {form id (lower, no symbols): folder}} from SpriteCollab's tracker, reduced and cached for a week."""
        if self._forms is not None:
            return self._forms
        path = self.cache_dir / "forms.json"
        if path.exists() and time.time() - path.stat().st_mtime < TRACKER_TTL_S:
            try:
                self._forms = json.loads(path.read_text("utf-8"))
                return self._forms
            except ValueError:
                pass
        with self._lock("tracker"):
            out: dict[str, dict[str, str]] = {}
            raw = self._get(f"{self._base()}/tracker.json") if self.settings.get("pmd_sprites", True) else None
            if raw:
                try:
                    tracker = json.loads(raw.decode("utf-8"))
                    for dex, entry in tracker.items():
                        sub = {}
                        for fid, f in (entry.get("subgroups") or {}).items():
                            name = _toid(f.get("name", ""))
                            if name and fid != "0000" and (f.get("sprite_files") or {}):
                                sub[name] = fid
                        if sub:
                            out[str(int(dex))] = sub
                    self.cache_dir.mkdir(parents=True, exist_ok=True)
                    write_bytes_atomic(path, json.dumps(out, separators=(",", ":")).encode("utf-8"), fsync=False)
                except (ValueError, AttributeError) as exc:
                    log.warning("pmd tracker: %s", exc)
            self._forms = out
            return out

    def folder(self, dex: int, form: str = "", shiny: bool = False) -> str:
        sub = "0000"
        if form:
            sub = self.forms().get(str(dex), {}).get(_toid(form), "0000")
        parts = [f"{dex:04d}"]
        if sub != "0000" or shiny:
            parts.append(sub)
        if shiny:
            parts.append("0001")
        return "/".join(parts)

    # ------------------------------------------------------------ sheets
    def meta(self, dex: int, *, form: str = "", shiny: bool = False) -> dict[str, Any]:
        """Geometry of the animations of a Pokémon (downloading its sheets the first time): {s: shadow size, a: {Anim: {w, h, n, r,
        d (durations in 1/60 s), ax, ay (ground anchor)}}, key}. Falls back to the plain form, then to the non-shiny sprite."""
        if not 1 <= int(dex) <= 2000:
            raise SilverError("invalid", f"Not a Pokédex number: {dex}")
        if not FORM_ID.match(_toid(form)):
            raise SilverError("invalid", f"Not a form: {form}")
        tries = [(form, shiny), ("", shiny), (form, False), ("", False)]
        for f, s in dict.fromkeys(tries):
            got = self._meta_for(self.folder(int(dex), f, s))
            if got:
                return got
        raise SilverError("not_found", f"No walking sprite for #{dex}")

    def _meta_for(self, folder: str) -> Optional[dict[str, Any]]:
        key = folder.replace("/", "-")
        out_dir = self.cache_dir / key
        meta_path = out_dir / "meta.json"
        if meta_path.exists():
            try:
                return json.loads(meta_path.read_text("utf-8"))
            except ValueError:
                pass
        miss = self.cache_dir / f"{key}.404"
        if miss.exists() and time.time() - miss.stat().st_mtime < NEGATIVE_TTL_S:
            return None
        if not self.settings.get("pmd_sprites", True):
            return None
        with self._lock(key):
            if meta_path.exists():
                return json.loads(meta_path.read_text("utf-8"))
            base = f"{self._base()}/sprite/{folder}"
            xml = self._get(f"{base}/AnimData.xml")
            if not xml:
                self.cache_dir.mkdir(parents=True, exist_ok=True)
                miss.write_text("404")
                return None
            anims, shadow = parse_animdata(xml.decode("utf-8", "replace"))
            geometry: dict[str, Any] = {}
            out_dir.mkdir(parents=True, exist_ok=True)

            def one(want: str) -> Optional[tuple[str, dict[str, Any]]]:
                src, geom = None, None
                for cand in [want, *FALLBACK.get(want, [])]:
                    src, geom = resolve(anims, cand)
                    if geom:
                        break
                if not geom or not src:
                    return None
                png = self._get(f"{base}/{src}-Anim.png")
                if not png or len(png) > MAX_BYTES:
                    return None
                from PIL import Image

                try:
                    w, h = Image.open(io.BytesIO(png)).size
                except Exception:  # noqa: BLE001 - a broken sheet is skipped
                    return None
                cols, rows = w // geom["w"], h // geom["h"]
                if cols < 1 or rows < 1:
                    return None
                shadow_png = self._get(f"{base}/{src}-Shadow.png")
                anchor = ground_anchor(shadow_png, geom["w"], geom["h"]) if shadow_png else None
                ax, ay = anchor if anchor else (geom["w"] / 2, geom["h"] * 0.78)
                write_bytes_atomic(out_dir / f"{want}.png", png, fsync=False)
                return want, {"w": geom["w"], "h": geom["h"], "n": min(geom["n"], cols), "r": rows, "d": geom["d"][:cols], "ax": ax, "ay": ay}

            with ThreadPoolExecutor(max_workers=8) as pool:
                for got in pool.map(one, WANT):
                    if got:
                        geometry[got[0]] = got[1]
            if not REQUIRED & set(geometry):
                miss.write_text("incomplete")
                return None
            meta = {"key": key, "s": shadow, "a": geometry}
            write_bytes_atomic(meta_path, json.dumps(meta, separators=(",", ":")).encode("utf-8"), fsync=False)
            return meta

    def prefetch(self, mons: list[dict[str, Any]]) -> None:
        """Download the walking sprites of a battle's Pokémon ahead of the screen asking for them."""
        for m in mons:
            try:
                self.meta(int(m.get("num") or 0), form=m.get("forme") or "", shiny=bool(m.get("shiny")))
            except (SilverError, ValueError):
                continue

    def sheet(self, key: str, anim: str) -> Path:
        if not re.match(r"^\d{4}(-\d{4}){0,2}$", key) or anim not in WANT:
            raise SilverError("invalid", "Not a walking sprite.")
        path = self.cache_dir / key / f"{anim}.png"
        if not path.exists():
            raise SilverError("not_found", f"No {anim} sheet for {key}")
        return path
