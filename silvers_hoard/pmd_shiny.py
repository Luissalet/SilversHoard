"""Palette transfers for missing shiny PMD sheets; poses and alpha stay untouched."""

from __future__ import annotations

import io
import json
import re
from collections import Counter, defaultdict
from pathlib import Path
from typing import Callable, Optional

from PIL import Image

from .hoard_link.atomic import write_bytes_atomic

PIXEL = "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon"


def palette_pair(normal: bytes, shiny: bytes) -> dict[tuple[int, ...], tuple[int, ...]]:
    """Learn corresponding colours from aligned regular/shiny reference pixels."""
    a = Image.open(io.BytesIO(normal)).convert("RGBA")
    b = Image.open(io.BytesIO(shiny)).convert("RGBA")
    if a.size != b.size:
        return {}
    pairs = defaultdict(Counter)
    visible = aligned = 0
    for left, right in zip(a.getdata(), b.getdata()):
        if left[3] or right[3]:
            visible += 1
        if left[3] and right[3]:
            aligned += 1
            pairs[left[:3]][right[:3]] += 1
    if not visible or aligned / visible < 0.95:
        return {}
    return {color: targets.most_common(1)[0][0] for color, targets in pairs.items()}


def recolor(png: bytes, palette: dict[tuple[int, ...], tuple[int, ...]]) -> bytes:
    """One colour map for every pose; nearest reference shades transfer their RGB delta."""
    image = Image.open(io.BytesIO(png)).convert("RGBA")
    colors = set(image.getdata())
    lookup = {}
    for rgba in colors:
        rgb = rgba[:3]
        if not rgba[3]:
            lookup[rgba] = rgba
            continue
        nearest = min(palette, key=lambda c: sum((x - y) ** 2 for x, y in zip(rgb, c)))
        target = palette[nearest]
        lookup[rgba] = tuple(max(0, min(255, value + new - old)) for value, old, new in zip(rgb, nearest, target)) + (rgba[3],)
    image.putdata([lookup[p] for p in image.getdata()])
    out = io.BytesIO()
    image.save(out, "PNG")
    return out.getvalue()


def reference_pair(cache: Path, dex: int, form: str, get: Callable[[str], Optional[bytes]], enabled: bool):
    """Canonical reference pair, cached separately from all PMD originals."""
    form_id = re.sub(r"[^a-z0-9]", "", form.lower())
    folder = cache / "shiny-reference" / f"{dex:04d}-{form_id or 'base'}"
    paths = [folder / "normal.png", folder / "shiny.png"]
    info = folder / "source.json"
    if info.exists() and all(p.exists() for p in paths):
        return paths[0].read_bytes(), paths[1].read_bytes(), json.loads(info.read_text("utf-8"))
    if not enabled:
        return None
    pid = dex
    if form_id:
        raw = get(f"https://pokeapi.co/api/v2/pokemon-species/{dex}")
        if not raw:
            return None
        species = json.loads(raw)
        name = species["name"] + "-"
        aliases = {"alolan": "alola", "galarian": "galar", "hisuian": "hisui", "paldean": "paldea"}
        want = aliases.get(form_id, form_id)
        pid = 0
        for variety in species.get("varieties", []):
            pokemon = variety["pokemon"]
            suffix = pokemon["name"].removeprefix(name)
            if pokemon["name"].startswith(name) and re.sub(r"[^a-z0-9]", "", suffix) == want:
                match = re.search(r"/pokemon/(\d+)/?$", pokemon["url"])
                if match:
                    pid = int(match.group(1))
                    break
    # Cosmetic PMD variants (Altcolor, costumes...) need no new silhouette: only the species' shiny palette.
    ids = list(dict.fromkeys([pid, dex])) if pid else [dex]
    found = None
    for candidate in ids:
        for base, ext in [(PIXEL, 'png'), (PIXEL + '/other/home', 'png'),
                          (PIXEL + '/versions/generation-ix/legends-za', 'webp')]:
            urls = [f"{base}/{candidate}.{ext}", f"{base}/shiny/{candidate}.{ext}"]
            pair = [get(url) for url in urls]
            if all(pair) and palette_pair(*pair):
                found = pair, {"kind": "canonical-palette-pair", "urls": urls, "form_exact": candidate == pid}
                break
        if found:
            break
    if not found:
        return None
    pair, provenance = found
    folder.mkdir(parents=True, exist_ok=True)
    for path, png in zip(paths, pair):
        write_bytes_atomic(path, png, fsync=False)
    write_bytes_atomic(info, json.dumps(provenance).encode("utf-8"), fsync=False)
    return *pair, provenance
