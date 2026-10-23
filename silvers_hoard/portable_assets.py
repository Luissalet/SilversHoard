"""Embed the installed PMD collection and cached presentation files; never fetch or alter the cache."""
from __future__ import annotations

import base64
import mimetypes
import json
from pathlib import Path
from typing import Any
from urllib.parse import quote

from .rebornfx import KINDS
from .sprites import POKEAPI_BASE, POKEAPI_PIXEL, POKEAPI_SETS


def bundle(services: Any) -> dict[str, Any]:
    files: dict[str, str] = {}
    urls: dict[str, str] = {}

    def add(path: Path, key: str, aliases: list[str]) -> None:
        if not path.is_file() or not path.stat().st_size:
            return
        mime = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        files[key] = f"data:{mime};base64," + base64.b64encode(path.read_bytes()).decode("ascii")
        urls.update((alias, key) for alias in aliases)

    server = str(services.settings["sprite_server"]).rstrip("/")
    for path in sorted(services.sprites.cache_dir.rglob("*")):
        if path.suffix.lower() not in (".png", ".gif", ".webp"):
            continue
        rel = path.relative_to(services.sprites.cache_dir).as_posix()
        aliases = [server + "/" + rel]
        parts = rel.split("/")
        if len(parts) >= 3 and parts[0] == "pokeapi":
            source = f"{POKEAPI_BASE}/{POKEAPI_SETS[parts[1]]}" if parts[1] in POKEAPI_SETS else POKEAPI_PIXEL
            aliases.append(source + "/" + "/".join(parts[2:]))
        add(path, "sprites/" + rel, aliases)

    # Walking animation geometry and sheets must travel together. Export only complete cached animations.
    pmd: dict[str, Any] = {"forms": {}, "metas": {}}
    credits = {}
    try:
        credits = json.loads((services.credits.cache_dir / "pmd.json").read_text("utf-8"))
    except (OSError, ValueError):
        pass
    forms = services.pmd.cache_dir / "forms.json"
    if forms.is_file():
        try:
            pmd["forms"] = json.loads(forms.read_text("utf-8"))
        except (OSError, ValueError):
            pass
    for path in sorted(services.pmd.cache_dir.glob("*/meta.json")):
        try:
            meta = json.loads(path.read_text("utf-8"))
        except (OSError, ValueError):
            continue
        animations = {name: geom for name, geom in meta.get("a", {}).items()
                      if (path.parent / f"{name}.png").is_file() and (path.parent / f"{name}.png").stat().st_size}
        if not ("Idle" in animations or "Walk" in animations):
            continue
        key = meta["key"]
        folder = key.replace("-", "/")
        while folder and folder not in credits:
            folder = folder.rsplit("/", 1)[0] if "/" in folder else ""
        pmd["metas"][key] = {**meta, "a": animations, "credit": credits.get(folder, meta.get("credit", []))}
        for name in animations:
            add(path.parent / f"{name}.png", f"pmd/{key}/{name}.png", [f"/api/sprites/pmd-sheet/{key}/{name}.png"])
    for path in sorted((services.pmd.cache_dir / "portrait").glob("*/*.png")):
        folder = path.parent.name.replace("-", "/")
        add(path, f"pmd/portrait/{path.parent.name}/{path.name}",
            [f"https://raw.githubusercontent.com/PMDCollab/SpriteCollab/master/portrait/{folder}/{path.name}"])

    for kind, folder in [("fx", "fx"), ("bg", "sprites/gen6bgs")]:
        for path in sorted((services.fx.cache_dir / kind).glob("*")):
            if path.suffix.lower() not in (".png", ".jpg", ".jpeg", ".gif", ".webp"):
                continue
            add(path, f"fx/{kind}/{path.name}", [f"https://play.pokemonshowdown.com/{folder}/{path.name}",
                f"{services.fx._server()}/{folder}/{path.name}", f"/api/fx/{'bg/' if kind == 'bg' else ''}{path.name}"])

    for kind, names in services.reborn.allowed.items():
        for name in sorted(names):
            ext = KINDS[kind][2]
            path = services.reborn.cache_dir / kind / (name + ext)
            folder = KINDS[kind][1]
            # JavaScript's encodeURIComponent leaves ! ' ( ) * intact; urllib.quote encodes them.
            component = quote(name + ext, safe="!'()*")
            component_name = quote(name, safe="!'()*")
            add(path, f"reborn/{kind}/{name}{ext}", [services.reborn.url(kind, name),
                f"{services.reborn._server()}/{services.reborn.ref}/{folder}/{component}",
                f"https://raw.githubusercontent.com/pagefaultgames/pokerogue-assets/{services.reborn.ref}/{folder}/{component}",
                f"/api/reborn/{kind}/{quote(name, safe='')}", f"/api/reborn/{kind}/{component_name}"])
    library = services.pmd.library.portable()
    files.update(library["files"])
    urls.update(library["urls"])
    pmd["metas"].update(library["metas"])
    if library["entries"]:
        pmd["entries"] = library["entries"]
        pmd["species"] = library["species"]
        pmd["notices"] = library["notices"]
    return {"version": 1, "files": files, "urls": urls, "pmd": pmd, "pmd_chunks": library["chunks"]}
