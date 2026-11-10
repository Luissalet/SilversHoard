"""Routes of the pixelfx animation style: the effect catalog, the move -> effect map, and the effects pinned to moves by hand (the
effects explorer reads and writes them here; the battle screens read the pins when the style loads). They call the same tool handlers
as POST /api/ui/call and the assistant (pixelfx_effects, pixelfx_map, pixelfx_pins, pixelfx_pin, pixelfx_unpin)."""

from __future__ import annotations

from fastapi import APIRouter, Request
from pydantic import BaseModel, Field

from .deps import tool

router = APIRouter(prefix="/api/pixelfx")


class PinBody(BaseModel):
    effect: str = Field(..., min_length=3, max_length=60)
    tint: bool = False
    color: str = Field("", max_length=7)
    role: str = Field("", max_length=12)


@router.get("/effects")
def effects(request: Request, category: str = "", q: str = "", limit: int = 0):
    return tool(request, "pixelfx_effects", {"category": category, "query": q, "limit": limit})


@router.get("/map")
def effect_map(request: Request, move: str = "", type: str = "", category: str = "", shape: str = "", status: str = "",
               weather: str = "", terrain: str = ""):
    return tool(request, "pixelfx_map", {"move": move, "type": type, "category": category, "shape": shape, "status": status,
                                         "weather": weather, "terrain": terrain})


@router.get("/moves")
def moves(request: Request, type: str = "", source: str = "", effect: str = "", q: str = "", limit: int = 0):
    return tool(request, "pixelfx_moves", {"type": type, "source": source, "effect": effect, "query": q, "limit": limit})


@router.get("/pins")
def pins(request: Request):
    return tool(request, "pixelfx_pins", {})


@router.put("/pins/{move}")
def pin(request: Request, move: str, body: PinBody):
    return tool(request, "pixelfx_pin", {"move": move, **body.model_dump()})


@router.delete("/pins/{move}")
def unpin(request: Request, move: str):
    return tool(request, "pixelfx_unpin", {"move": move})
