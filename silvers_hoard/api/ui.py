"""Routes for the bundled web UI and for programs that only read.

Everything that changes data goes through ``POST /api/ui/call`` with ``{name, arguments}`` (the same tool handlers the assistant
uses, uncapped). Pictures and files travel on their own routes: sprites (downloaded once from the sprite server and cached),
avatars, exported files, and the uploads (photos, files to import)."""

from __future__ import annotations

import mimetypes
import time
from pathlib import Path
from typing import Any

from fastapi import APIRouter, File, Form, Request, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from ..agent_tools import TOOLS_BY_NAME, tool_catalog
from ..errors import SilverError
from ..hoard_link import family
from .deps import services, tool

router = APIRouter(prefix="/api")
MAX_UPLOAD = 20 * 1024 * 1024
CACHE = {"Cache-Control": "public, max-age=604800"}


class CallBody(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    arguments: dict[str, Any] | None = None


@router.get("/overview")
def overview(request: Request):
    return services(request).overview()


@router.get("/ui/tools")
def ui_tools():
    return {"tools": [t["name"] for t in tool_catalog()]}


@router.post("/ui/call")
def ui_call(request: Request, body: CallBody):
    if body.name not in TOOLS_BY_NAME:
        raise SilverError("not_found", f"Unknown tool: {body.name}")
    t0 = time.monotonic()
    ok, error = False, ""
    try:
        result = tool(request, body.name, body.arguments)
        ok = True
        return result
    except Exception as exc:  # noqa: BLE001 - re-raised: the app's handlers shape the response
        error = str(exc)[:200]
        raise
    finally:
        family.record_call(body.name, ok, int((time.monotonic() - t0) * 1000), caller="ui", error=error)


def _file(path, *, cache: bool = True, download: str = ""):
    ctype = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
    headers = dict(CACHE) if cache else {"Cache-Control": "no-store"}
    headers["X-Content-Type-Options"] = "nosniff"
    if download:
        return FileResponse(path, media_type=ctype, headers=headers, filename=download)
    return FileResponse(path, media_type=ctype, headers=headers)


@router.get("/sprites/pokemon/{sprite_id}")
def pokemon_sprite(request: Request, sprite_id: str, set: str = "", back: bool = False, shiny: bool = False):
    return _file(services(request).sprites.pokemon(sprite_id.removesuffix(".png").removesuffix(".gif"), set_=set, back=back, shiny=shiny))


@router.get("/sprites/trainers/{name}")
def trainer_sprite(request: Request, name: str):
    return _file(services(request).sprites.trainer(name.removesuffix(".png")))


@router.get("/sprites/items/{item_id}")
def item_sprite(request: Request, item_id: str):
    return _file(services(request).sprites.item_icon(item_id.removesuffix(".png")))


@router.get("/sprites/pmd/{dex}")
def pmd_meta(request: Request, dex: int, form: str = "", shiny: bool = False):
    """Geometry of a Pokémon's walking sprites for the real-time arena (downloads its sheets the first time)."""
    s = services(request)
    meta = s.pmd.meta(dex, form=form, shiny=shiny)
    return {**meta, "credit": s.credits.walking(str(meta.get("key") or ""))}


@router.get("/sprites/pmd-sheet/{key}/{anim}")
def pmd_sheet(request: Request, key: str, anim: str):
    return _file(services(request).pmd.sheet(key, anim.removesuffix(".png")))


@router.get("/cries/{cry_id}")
def pokemon_cry(request: Request, cry_id: str):
    """A Pokémon's cry (species or form id), downloaded once and cached; 404 when there is none (the client stays silent)."""
    return _file(services(request).sounds.cry(cry_id))


@router.get("/music/{track}")
def battle_music(request: Request, track: str):
    """One of the whitelisted battle tracks, downloaded once and cached."""
    return _file(services(request).sounds.music(track))


@router.get("/fx/stats")
def fx_stats(request: Request):
    return services(request).fx.stats()


@router.get("/fx/bg/{name}")
def fx_backdrop(request: Request, name: str):
    """A battle backdrop some move animations flash behind the field (Showdown's gen6bgs), downloaded once and cached."""
    return _file(services(request).fx.get(name, "bg"))


@router.get("/fx/{name}")
def fx_picture(request: Request, name: str):
    """An effect picture of Showdown's move animations (fx/wisp.png…), downloaded once and cached; 404 when there is none."""
    return _file(services(request).fx.get(name, "fx"))


@router.get("/sound/stats")
def sound_stats(request: Request):
    return services(request).sounds.stats()


@router.get("/sprites/stats")
def sprite_stats(request: Request):
    return services(request).sprites.stats()


@router.get("/avatars/{filename}")
def avatar(request: Request, filename: str):
    return _file(services(request).sprites.avatar_path(filename), cache=False)


@router.get("/avatars")
def avatars(request: Request):
    return {"avatars": services(request).sprites.avatars()}


@router.post("/avatars/upload")
async def avatar_upload(request: Request, file: UploadFile = File(...), trainer_id: str = Form(""), mode: str = Form("pixel"),
                        remove_background: bool = Form(True)):
    data = await file.read(MAX_UPLOAD + 1)
    if len(data) > MAX_UPLOAD:
        raise SilverError("too_large", "The picture is larger than 20 MB.")
    return services(request).avatar_from_photo(data, trainer_id=trainer_id, mode=mode, remove_background=remove_background)


@router.post("/badges/upload")
async def badge_upload(request: Request, file: UploadFile = File(...), gym_id: str = Form(""), remove_background: bool = Form(False)):
    data = await file.read(MAX_UPLOAD + 1)
    if len(data) > MAX_UPLOAD:
        raise SilverError("too_large", "The picture is larger than 20 MB.")
    return services(request).badge_upload(data, gym_id=gym_id, remove_background=remove_background)


@router.post("/avatars/draw")
async def avatar_draw(request: Request, files: list[UploadFile] = File(default=[]), description: str = Form(""), trainer_id: str = Form(""),
                      count: int = Form(2), style: bool = Form(True)):
    photos = []
    for f in files[:4]:
        data = await f.read(MAX_UPLOAD + 1)
        if len(data) > MAX_UPLOAD:
            raise SilverError("too_large", "A picture is larger than 20 MB.")
        photos.append(data)
    return services(request).avatar_draw(photos, description=description, trainer_id=trainer_id, count=count, style=style)


@router.get("/style-refs/{filename}")
def style_ref(request: Request, filename: str):
    s = services(request)
    path = s.config.style_refs_dir / Path(filename).name
    if not path.is_file() or path.suffix.lower() not in s.STYLE_EXTS:
        raise SilverError("not_found", "No such style picture.")
    return _file(path, cache=False)


@router.post("/style-refs")
async def style_refs_upload(request: Request, files: list[UploadFile] = File(...)):
    add = []
    for f in files[:3]:
        data = await f.read(MAX_UPLOAD + 1)
        if len(data) > MAX_UPLOAD:
            raise SilverError("too_large", "A picture is larger than 20 MB.")
        add.append((f.filename or "style.png", data))
    return services(request).avatar_style_set(add=add)


@router.post("/import/upload")
async def import_upload(request: Request, file: UploadFile = File(...), name: str = Form(""), format: str = Form("")):
    data = await file.read(MAX_UPLOAD + 1)
    if len(data) > MAX_UPLOAD:
        raise SilverError("too_large", "The file is larger than 20 MB.")
    return services(request).import_any(data, name=name, format_=format)


@router.get("/exports/{filename}")
def export_file(request: Request, filename: str, download: bool = True):
    path = services(request).export_file(filename)
    return _file(path, cache=False, download=filename if download else "")


@router.get("/events")
def events(request: Request, after: float = 0.0):
    return {"events": [e for e in services(request).events if e["t"] > after], "now": time.time()}
