"""The room server: the only part of Silver's Hoard a friend on the network reaches (see pvp.py). It serves the playable page in
room mode and the room's own API; everything needs the room's key from the link."""
from __future__ import annotations

from typing import TYPE_CHECKING, Any

from fastapi import Body, FastAPI, Query, WebSocket
from fastapi.responses import HTMLResponse, JSONResponse, PlainTextResponse, Response

from . import sharing
from .errors import SilverError

if TYPE_CHECKING:  # pragma: no cover
    from .services import Services


def room_app(services: "Services") -> FastAPI:
    app = FastAPI(title="Silver's Hoard rooms", docs_url=None, redoc_url=None, openapi_url=None)
    pvp = services.pvp

    @app.exception_handler(SilverError)
    async def silver_error(_: Any, exc: SilverError):
        return JSONResponse(exc.to_dict(), status_code=exc.status)

    @app.get("/", response_class=PlainTextResponse)
    def home() -> str:
        return "Silver's Hoard: open the room link your friend sent you."

    @app.get("/favicon.ico")
    def favicon() -> Response:
        return Response(status_code=204)

    @app.get("/r/{room_id}", response_class=HTMLResponse)
    def page(room_id: str, k: str = Query("")) -> HTMLResponse:
        from .services import PLAY_TEMPLATE

        data = pvp.page_data(room_id, k)
        html = sharing.playable_page(PLAY_TEMPLATE, data)
        return HTMLResponse(html, headers={"Cache-Control": "no-store", "Referrer-Policy": "no-referrer"})

    @app.get("/api/room/{room_id}")
    def state(room_id: str, k: str = Query(""), since: int = Query(0)) -> dict[str, Any]:
        return pvp.guest_state(room_id, k, since)

    @app.post("/api/room/{room_id}/join")
    def join(room_id: str, body: dict[str, Any] = Body(...)) -> dict[str, Any]:
        return pvp.join(room_id, str(body.get("k") or ""), name=str(body.get("name") or ""), team=body.get("team"),
                        paste=str(body.get("paste") or ""))

    @app.post("/api/room/{room_id}/choose")
    def choose(room_id: str, body: dict[str, Any] = Body(...)) -> dict[str, Any]:
        return pvp.guest_choose(room_id, str(body.get("k") or ""), str(body.get("choice") or ""), int(body.get("since") or 0))

    @app.post("/api/room/{room_id}/forfeit")
    def forfeit(room_id: str, body: dict[str, Any] = Body(...)) -> dict[str, Any]:
        return pvp.guest_forfeit(room_id, str(body.get("k") or ""))

    @app.websocket("/api/room/{room_id}/ws")
    async def ws(websocket: WebSocket, room_id: str, k: str = Query("")) -> None:
        await pvp.relay(websocket, room_id, k)

    return app
