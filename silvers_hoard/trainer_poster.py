"""Trainer posters reuse the app's badge renderer and recorded artwork; no image model."""
from __future__ import annotations

import base64
import colorsys
import copy
import datetime as dt
import hashlib
import io
import json
import time
from pathlib import Path

from PIL import Image, ImageStat, PngImagePlugin

from .credits import SOURCES
from .errors import SilverError
from .official_art import COPYRIGHT
from .sharing import safe_filename


def _picture(path: Path) -> tuple[str, Image.Image]:
    # A still first frame makes GIF/WebP sprites stable in a PNG poster.
    with Image.open(path) as original:
        original.seek(0)
        image = original.convert("RGBA")
    buffer = io.BytesIO()
    image.save(buffer, "PNG")
    return "data:image/png;base64," + base64.b64encode(buffer.getvalue()).decode("ascii"), image


def _source(services, image: str, known: dict, role: str, title: str) -> dict:
    if image.startswith("sd:"):
        name = image[3:]
        return {"role": role, "category": "sprite", "title": title,
                "credit": services.credits.trainer(name, wait=True),
                "source": str(services.settings["sprite_server"]).rstrip("/") + "/trainers/" + name + ".png"}
    metadata = known.get(image.removeprefix("file:")) or {}
    category = metadata.get("kind") or services.avatar_kind(image) or "image"
    # Drawing/sprite titles store generation input. Only imported-picture titles are public artwork captions.
    public_title = metadata.get("title") if category in ("photo", "art", "image") else ""
    return {"role": role, "category": category, "title": public_title or title,
            "credit": metadata.get("credit") or "", "source": metadata.get("source") or image}


def snapshot(services, trainer: dict, badges: list, styles: dict, known: dict, lang: str) -> dict:
    """Detach visible data and recorded credits. Hidden EVs, moves and prompts never enter the shared poster."""
    data = {"schema": 1, "lang": lang, "created_at": dt.datetime.now(dt.timezone.utc).isoformat(),
            "trainer": {k: trainer.get(k) or "" for k in ("name", "title", "format")},
            "portrait": {"src": "", "category": "none"}, "team": [], "badges": [], "sources": [], "warnings": [], "accent": "#e2404f"}
    avatar = trainer.get("avatar") or ""
    if avatar:
        source = _source(services, avatar, known, "portrait", trainer["name"])
        data["sources"].append(source)
        data["portrait"]["category"] = source["category"]
        try:
            path = services.sprites.trainer(avatar[3:]) if avatar.startswith("sd:") else services.sprites.avatar_path(avatar.removeprefix("file:"))
            data["portrait"]["src"] = _picture(path)[0]
        except (SilverError, OSError, ValueError):
            data["warnings"].append({"role": "portrait", "name": trainer["name"]})

    sprite_source = next(row for row in SOURCES if row["id"] == "showdown-sprites")
    pokemon_art = {"role": "team", "category": "pokemon_sprite", "title": "Pokémon", "credit": sprite_source["by"],
                   "source": str(services.settings["sprite_server"]), "copyright": COPYRIGHT, "assets": []}
    for member in services.team_summary(trainer.get("team") or [], trainer["format"]):
        mon = {"name": member.get("nickname") or member["species"], "species": member["species"],
               "level": member["level"], "shiny": bool(member.get("shiny")), "src": ""}
        sid = member["sprite_id"]
        asset = {"species": mon["species"], "sprite_id": sid, "shiny": mon["shiny"]}
        try:
            path = services.sprites.pokemon(sid, set_="gen5", shiny=mon["shiny"])
            mon["src"] = _picture(path)[0]
            relative = path.relative_to(services.config.sprites_dir).as_posix()
            asset["asset"] = relative
            asset["source"] = (next(row["url"] for row in SOURCES if row["id"] == "pokeapi-sprites")
                               if relative.startswith("pokeapi/") else str(services.settings["sprite_server"]).rstrip("/") + "/" + relative)
            if relative.startswith("pokeapi/"):
                origin = next(row for row in SOURCES if row["id"] == "pokeapi-sprites")
                data["sources"].append({"role": "team", "category": "pokemon_sprite", "title": "PokeAPI",
                                        "credit": origin["by"], "source": origin["url"], "copyright": COPYRIGHT})
        except (SilverError, OSError, ValueError):
            data["warnings"].append({"role": "team", "name": mon["species"]})
            asset["available"] = False
        pokemon_art["assets"].append(asset)
        data["team"].append(mon)
    if data["team"]:
        data["sources"].append(pokemon_art)

    for earned in badges:
        image = earned.get("badge_image") or "shape:hexagon"
        badge = {"name": earned.get("badge") or earned["gym_name"], "gym": earned["gym_name"],
                 "color": earned.get("badge_color") or "#c0c0c0", "image": image, "source": image}
        if image.startswith("file:"):
            data["sources"].append(_source(services, image, known, "badge", badge["name"]))
            try:
                src = _picture(services.sprites.avatar_path(image[5:]))[0]
                badge["image"] = {"kind": "image", "mime": "image/png", "data": src.split(",", 1)[1]}
            except (SilverError, OSError, ValueError):
                badge["image"] = "shape:hexagon"
                data["warnings"].append({"role": "badge", "name": badge["name"]})
        else:
            data["sources"].append({"role": "badge", "category": "shape", "title": "Silver's Hoard",
                                    "credit": "Silver's Hoard", "source": "client/src/components/badges.jsx"})
        data["badges"].append(badge)

    own_refs = {row["file"] for row in styles["images"]}
    colors = []
    for index, ref in enumerate(styles["used"], 1):
        own = ref in own_refs
        label = f"#{index}"
        try:
            path = services.config.style_refs_dir / ref if own else services.sprites.trainer(ref)
            with Image.open(path) as original:
                image = original.convert("RGBA")
            image.thumbnail((64, 64))
            if not image.getchannel("A").getbbox():
                continue
            colors.append(ImageStat.Stat(image.convert("RGB"), mask=image.getchannel("A")).mean)
            # Reference filenames can come from private generation descriptions. Identify the artwork by its bytes.
            source = ({"role": "palette", "category": "style_reference", "title": label, "credit": "",
                       "source": "style-library:sha256:" + hashlib.sha256(path.read_bytes()).hexdigest()}
                      if own else _source(services, "sd:" + ref, known, "palette", ref))
            data["sources"].append(source)
        except (SilverError, OSError, ValueError):
            data["warnings"].append({"role": "palette", "name": label})
    if colors:
        rgb = [sum(row[channel] for row in colors) / len(colors) / 255 for channel in range(3)]
        hue, light, saturation = colorsys.rgb_to_hls(*rgb)
        rgb = colorsys.hls_to_rgb(hue, max(.45, min(.65, light)), saturation)
        data["accent"] = "#" + "".join(f"{round(channel * 255):02x}" for channel in rgb)
    # The same badge drawing can be used for many earned medals; retain one artwork credit.
    unique = {}
    for source in data["sources"]:
        key = tuple(source.get(field) for field in ("role", "category", "title", "credit", "source"))
        unique.setdefault(key, source)
    data["sources"] = list(unique.values())
    return data


def metadata(data: dict) -> dict:
    return {"schema": data["schema"], "lang": data["lang"], "created_at": data["created_at"], "trainer": data["trainer"],
            "portrait_category": data["portrait"]["category"],
            "team": [{k: mon[k] for k in ("name", "species", "level", "shiny")} for mon in data["team"]],
            "badges": [{k: badge[k] for k in ("name", "gym", "color", "source")} for badge in data["badges"]],
            "sources": data["sources"], "accent": data["accent"], "warnings": data["warnings"]}


def render(services, data: dict, browser_path: str, cancelled) -> bytes:
    from playwright.sync_api import sync_playwright, TimeoutError as BrowserTimeout
    with sync_playwright() as runtime:
        browser = runtime.chromium.launch(headless=True, executable_path=browser_path,
                                           args=["--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=1"])
        try:
            page = browser.new_page(viewport={"width": 1080, "height": 900}, device_scale_factor=1,
                                    locale="es-ES" if data["lang"] == "es" else "en-US")
            page.add_init_script("window.__SILVER_POSTER_DATA__ = " + json.dumps(data, ensure_ascii=True) + ";")
            page.goto(f"http://127.0.0.1:{services.config.port}/#/poster-render", wait_until="domcontentloaded", timeout=30000)
            deadline = time.monotonic() + 90
            while True:
                if cancelled():
                    raise SilverError("cancelled", "Cancelled.")
                try:
                    page.locator('[data-poster-ready="true"]').wait_for(timeout=250)
                    break
                except BrowserTimeout:
                    if time.monotonic() >= deadline:
                        raise SilverError("timeout", "The poster did not finish loading.") from None
            return page.locator(".trainer-poster-art").screenshot(type="png", animations="disabled", timeout=30000)
        finally:
            browser.close()


def create(services, id: str, *, lang: str = "en") -> dict:
    trainer = copy.deepcopy(services.store.trainer(id))
    status = services.video_status()
    if not status["playwright"] or not status["browser"]:
        raise SilverError("unavailable", "PNG posters need Playwright and Chrome or Edge, as the video recorder does.", hint=status["hint"])
    badges = copy.deepcopy(services.store.badges(challenger_trainer_id=id))
    styles, known = copy.deepcopy(services.avatar_style_get()), copy.deepcopy(services._avatar_meta())

    def work(jid, progress, cancelled):
        if cancelled():
            raise SilverError("cancelled", "Cancelled.")
        data = snapshot(services, trainer, badges, styles, known, lang)
        if cancelled():
            raise SilverError("cancelled", "Cancelled.")
        progress(.25)
        png = render(services, data, status["browser"], cancelled)
        if cancelled():
            raise SilverError("cancelled", "Cancelled.")
        progress(.9)
        info = metadata(data)
        chunks = PngImagePlugin.PngInfo()
        chunks.add_itxt("Title", trainer["name"])
        chunks.add_itxt("Software", "Silver's Hoard")
        chunks.add_itxt("SilverPoster", json.dumps(info, ensure_ascii=False))
        filename = safe_filename(jid + " - " + trainer["name"] + " - poster", "png")
        folder = services.config.exports_dir
        folder.mkdir(parents=True, exist_ok=True)
        path = folder / filename
        with Image.open(io.BytesIO(png)) as image:
            size = image.size
            image.save(path, "PNG", pnginfo=chunks)
        return {"file": filename, "url": f"/api/exports/{filename}", "bytes": path.stat().st_size,
                "width": size[0], "height": size[1], "name": trainer["name"], "poster": info, "warnings": data["warnings"]}

    return services._job("poster", ("Póster: " if lang == "es" else "Poster: ") + trainer["name"], {"trainer_id": id, "lang": lang}, work)
