"""The room server: the only part of Silver's Hoard a friend on the network reaches (see pvp.py). It serves the playable page in
room mode (to play or to watch), the room's own API and the lobby; everything needs a key or the lobby code from a link."""
from __future__ import annotations

from typing import TYPE_CHECKING, Any

import html as _html

from fastapi import Body, FastAPI, Form, Query, Request, WebSocket
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

    @app.get("/w/{room_id}", response_class=HTMLResponse)
    def watch_page(room_id: str, k: str = Query("")) -> HTMLResponse:
        from .services import PLAY_TEMPLATE

        data = pvp.page_data(room_id, k, watch=True)
        return HTMLResponse(sharing.playable_page(PLAY_TEMPLATE, data), headers={"Cache-Control": "no-store", "Referrer-Policy": "no-referrer"})

    def lang_of(request: Request) -> str:
        return "es" if str(request.headers.get("accept-language") or "es").lower().startswith("es") else "en"

    @app.get("/api/lobby")
    def lobby_api(c: str = Query("")) -> dict[str, Any]:
        return pvp.lobby(c)

    @app.get("/lobby", response_class=HTMLResponse)
    def lobby_page(request: Request, c: str = Query("")) -> HTMLResponse:
        """The lobby for a friend without Silver: the open rooms, each with its link to join or to watch."""
        es = lang_of(request) == "es"
        data = pvp.lobby(c)
        e = _html.escape
        rows = []
        for r in data["rooms"]:
            mode = (("Tiempo real" if es else "Real time") if r["mode"] == "realtime" else ("Por turnos" if es else "Turn by turn"))
            vs = f" vs {e(r['guest'])}" if r.get("guest") else ""
            links = []
            if r.get("join"):
                links.append(f'<a class="go" href="{e(r["join"])}">{"Unirme" if es else "Join"}</a>')
            links.append(f'<a href="{e(r["watch"])}">{"Mirar" if es else "Watch"}</a>')
            state = {"waiting": "Esperando rival" if es else "Waiting for a rival", "ready": "A punto de empezar" if es else "About to start",
                     "live": "En juego" if es else "Playing"}.get(r["status"], r["status"])
            rows.append(f"<li><b>{e(r['host'])}{vs}</b><span>{mode} · {e(r['format'])} · {state}</span><p>{' '.join(links)}</p></li>")
        title = (f"Salas de {e(data['name'])}" if es else f"{e(data['name'])}'s rooms") if data["name"] else ("Salas abiertas" if es else "Open rooms")
        empty = "No hay salas abiertas ahora mismo. Vuelve a mirar en un rato." if es else "No open rooms right now. Look again in a while."
        page_html = f"""<!doctype html><html lang="{'es' if es else 'en'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="10"><title>{title}</title><style>
:root{{color-scheme:dark}}body{{margin:0;font:15px/1.45 system-ui,sans-serif;background:#141016;color:#eee6ea}}main{{max-width:640px;margin:0 auto;padding:24px 16px}}
h1{{font:600 24px Georgia,serif;color:#e8445a;margin:0 0 4px}}ul{{list-style:none;padding:0}}li{{background:#211a22;border:1px solid #3a2e3a;border-radius:10px;padding:12px 14px;margin:10px 0}}
li span{{display:block;color:#b9a9b2;font-size:13px}}li p{{margin:8px 0 0}}a{{display:inline-block;padding:6px 12px;border-radius:8px;border:1px solid #4a3c48;color:#eee6ea;text-decoration:none;margin-right:6px}}
a.go{{background:#e8445a;border-color:#e8445a;color:#fff}}.help{{color:#b9a9b2;font-size:13px}}</style></head>
<body><main><h1>{title}</h1><p class="help">{"Silver's Hoard: combates en directo. La lista se actualiza sola." if es else "Silver's Hoard: live battles. The list refreshes by itself."}</p>
{"<ul>" + "".join(rows) + "</ul>" if rows else f'<p class="help">{empty}</p>'}</main></body></html>"""
        return HTMLResponse(page_html, headers={"Cache-Control": "no-store", "Referrer-Policy": "no-referrer"})

    @app.get("/v/{poll_id}", response_class=HTMLResponse)
    def vote_page(poll_id: str, request: Request, k: str = Query("")) -> HTMLResponse:
        return HTMLResponse(services.friends.vote_page(poll_id, k, lang=lang_of(request)), headers={"Cache-Control": "no-store", "Referrer-Policy": "no-referrer"})

    @app.post("/v/{poll_id}", response_class=HTMLResponse)
    def vote(poll_id: str, request: Request, k: str = Query(""), name: str = Form(""), option: str = Form("")) -> HTMLResponse:
        lang = lang_of(request)
        try:
            services.friends.vote(poll_id, key=k, name=name, option=option)
            msg = "¡Voto guardado! Puedes cambiarlo votando otra vez con el mismo nombre." if lang == "es" else "Vote saved! Vote again with the same name to change it."
        except SilverError as exc:
            if exc.code in ("forbidden", "not_found"):
                raise
            msg = exc.message
        return HTMLResponse(services.friends.vote_page(poll_id, k, lang=lang, message=msg, voted=option), headers={"Cache-Control": "no-store"})

    @app.get("/api/room/{room_id}")
    def state(room_id: str, k: str = Query(""), since: int = Query(0)) -> dict[str, Any]:
        return pvp.guest_state(room_id, k, since)

    @app.get("/api/room/{room_id}/watch")
    def watch_state(room_id: str, k: str = Query(""), since: int = Query(0)) -> dict[str, Any]:
        return pvp.watch_state(room_id, k, since)

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
