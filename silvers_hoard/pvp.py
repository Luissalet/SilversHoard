"""Live battles between two people on two computers.

The host opens a room in the app (pvp_open) with one of their trainers and the battle's settings; Silver starts a small second web
server on the network (setting ``pvp_port``, 5240 by default) that serves only the rooms: the friend opens the room's link in any
browser, gets the playable page in "room" mode, brings a team and joins. When the host starts the battle:

- Turn by turn, this app's engine runs the battle (the host plays it on the battle screen, the friend on the page); each side only
  sees its own view of the log and sends its choices, so neither can peek at the other's team.
- In real time, both screens run the same deterministic simulator from the same seed (lockstep): every tick each side sends its
  input through the room's WebSocket and a tick only runs once both inputs for it are in. Inputs apply a few ticks after they
  are read (the input delay hides the round trip). The host's screen stores the result as usual: the app replays every input.

The room server never exposes anything else of the app: no settings, no trainers, no tools. Each room has a key for the friend
(in the link) and another for the host's screen. Rooms close when their battle ends and are forgotten after a few hours.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import secrets
import socket
import threading
import time
from typing import TYPE_CHECKING, Any, Optional

from .errors import SilverError

if TYPE_CHECKING:  # pragma: no cover
    from .services import Services

log = logging.getLogger("silver.pvp")

ROOM_TTL = 6 * 3600            # seconds an idle room is kept
MAX_ROOMS = 8
INPUT_DELAY = 4                # ticks between reading an input and running it (≈130 ms at 30 ticks a second)
MODES = ("classic", "realtime")
SEATS = ("p1", "p2")


def lan_addresses() -> list[str]:
    """This computer's addresses on the local network (no packet is sent: connecting a UDP socket only picks a route)."""
    found: list[str] = []
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("10.255.255.255", 1))
            found.append(s.getsockname()[0])
    except OSError:
        pass
    try:
        for ip in socket.gethostbyname_ex(socket.gethostname())[2]:
            if ip not in found:
                found.append(ip)
    except OSError:
        pass
    return [ip for ip in found if not ip.startswith("127.")]


class Room:
    def __init__(self, *, trainer_id: str, mode: str, format_: str, level_rules: dict[str, Any], rt_arena: str, time_limit: int):
        self.id = secrets.token_urlsafe(6).replace("-", "a").replace("_", "b")
        self.guest_key = secrets.token_urlsafe(18)
        self.host_key = secrets.token_urlsafe(18)
        self.trainer_id = trainer_id
        self.mode = mode
        self.format = format_
        self.level_rules = level_rules
        self.rt_arena = rt_arena
        self.time_limit = time_limit
        self.status = "waiting"          # waiting (no friend yet), ready (friend joined), live, ended, closed
        self.guest: dict[str, Any] = {}
        self.battle_id = ""
        self.created = self.touched = time.time()
        # real time: every frame each seat sent, by tick (frames[seat][tick - 1]); the WebSockets of each seat; hashes to compare
        self.frames: list[list[list[Any]]] = [[], []]
        self.sockets: list[set[Any]] = [set(), set()]
        self.hashes: dict[int, dict[int, str]] = {}
        self.desync = 0

    def seat_of(self, key: str) -> int:
        if key and secrets.compare_digest(key, self.host_key):
            return 0
        if key and secrets.compare_digest(key, self.guest_key):
            return 1
        return -1


class Pvp:
    def __init__(self, services: "Services"):
        self.s = services
        self.rooms: dict[str, Room] = {}
        self._lock = threading.Lock()
        self._server: Any = None
        self._thread: Optional[threading.Thread] = None
        self._loop: Optional[asyncio.AbstractEventLoop] = None
        self.port = 0

    # ------------------------------------------------------------ rooms (host side: the app's own API)
    def _room(self, room_id: str) -> Room:
        self._expire()
        r = self.rooms.get(room_id or "")
        if not r:
            raise SilverError("not_found", "That room does not exist (or it has expired).")
        return r

    def _expire(self) -> None:
        now = time.time()
        with self._lock:
            for rid in [k for k, r in self.rooms.items() if now - r.touched > ROOM_TTL or r.status == "closed"]:
                self.rooms.pop(rid, None)

    def links(self, r: Room) -> dict[str, Any]:
        return self.links_for(f"/r/{r.id}?k={r.guest_key}")

    def links_for(self, path: str) -> dict[str, Any]:
        """Where friends reach a path of the room server: this computer's network addresses, and the public address if set."""
        public = str(self.s.settings.get("pvp_public_url") or "").rstrip("/")
        lan = [f"http://{ip}:{self.port}{path}" for ip in lan_addresses()]
        return {"lan": lan, "public": f"{public}{path}" if public else "", "local": f"http://127.0.0.1:{self.port}{path}",
                "port": self.port, "path": path}

    def view(self, r: Room, *, host: bool = True) -> dict[str, Any]:
        out: dict[str, Any] = {"id": r.id, "mode": r.mode, "format": r.format, "level_rules": r.level_rules, "status": r.status,
                               "rt_arena": r.rt_arena, "time_limit": r.time_limit, "battle_id": r.battle_id,
                               "guest": {"name": r.guest.get("name", ""), "species": [str(x.get("species") or "") for x in r.guest.get("sets") or []]}
                               if r.guest else None}
        if host:
            t = self.s.store.trainer(r.trainer_id)
            out.update({"trainer": {"id": t["id"], "name": t["name"], "avatar_url": self.s.avatar_url(t["avatar"])}, "links": self.links(r),
                        "host_key": r.host_key, "ws": f"ws://127.0.0.1:{self.port}/api/room/{r.id}/ws?k={r.host_key}", "input_delay": INPUT_DELAY})
        if r.battle_id:
            b = self.s.store.battle(r.battle_id)
            out["battle"] = {"status": b["status"], "winner_side": b.get("winner_side") or "", "winner_name": b.get("winner_name") or ""}
        if r.desync:
            out["desync"] = r.desync
        return out

    def open(self, *, trainer_id: str, mode: str = "classic", format_: str = "", level_rules: Optional[dict[str, Any]] = None,
             rt_arena: str = "rocks", time_limit: int = 0) -> dict[str, Any]:
        if mode not in MODES:
            raise SilverError("invalid", "mode is classic or realtime")
        t = self.s.store.trainer(trainer_id)
        if not t.get("team"):
            raise SilverError("empty_team", f"{t['name']} has no team.")
        fmt = format_ or t["format"] or self.s.settings["default_format"]
        if mode == "realtime":
            fmt = self.s._rt_format(fmt)
        info = self.s.format_info(fmt, [])
        if info.get("random"):
            raise SilverError("invalid", "A live battle needs a format with teams (not a random-battle one).")
        self.s.check_team(t["team"], fmt)
        self._expire()
        if len(self.rooms) >= MAX_ROOMS:
            raise SilverError("conflict", "Too many rooms open; close one first (pvp_close).")
        r = Room(trainer_id=trainer_id, mode=mode, format_=fmt, level_rules=level_rules or {}, rt_arena=rt_arena or "rocks",
                 time_limit=max(30, min(int(time_limit or self.s.settings.get("rt_time_limit") or 300), 1800)))
        self.ensure_server()
        with self._lock:
            self.rooms[r.id] = r
        self.s.emit("pvp.opened", {"room": r.id, "mode": mode})
        return self.view(r)

    def get(self, room_id: str) -> dict[str, Any]:
        r = self._room(room_id)
        self._sync_status(r)
        return self.view(r)

    def list(self) -> list[dict[str, Any]]:
        self._expire()
        return [self.view(r) for r in list(self.rooms.values())]

    def close(self, room_id: str) -> dict[str, Any]:
        r = self._room(room_id)
        r.status = "closed"
        self._broadcast(r, {"k": "closed"})
        with self._lock:
            self.rooms.pop(r.id, None)
        return {"closed": r.id}

    def start(self, room_id: str) -> dict[str, Any]:
        """The host starts the battle once the friend has joined."""
        r = self._room(room_id)
        if r.status not in ("ready",):
            raise SilverError("conflict", "The friend has not joined yet." if r.status == "waiting" else "This room's battle has already started.")
        p1 = {"trainer_id": r.trainer_id, "human": True}
        p2 = {"team": r.guest["sets"], "name": r.guest["name"], "human": True, "remote": True}
        title = f"{self.s.store.trainer(r.trainer_id)['name']} vs {r.guest['name']}"
        b = self.s.battle_start(p1=p1, p2=p2, format_=r.format, level_rules=r.level_rules, kind="pvp", title=title, mode=r.mode,
                                time_limit=r.time_limit, rt_arena=r.rt_arena)
        r.battle_id = b["id"]
        r.status = "live"
        r.frames = [[], []]
        r.touched = time.time()
        self._broadcast(r, {"k": "started", "battle": b["id"]})
        self.s.emit("pvp.started", {"room": r.id, "battle": b["id"]})
        return {**self.view(r), "battle": b}

    def _sync_status(self, r: Room) -> None:
        if r.battle_id and r.status == "live":
            b = self.s.store.battle(r.battle_id)
            if b["status"] in ("ended", "failed"):
                r.status = "ended"

    # ------------------------------------------------------------ guest side (the room server)
    def _guest(self, room_id: str, key: str) -> Room:
        r = self._room(room_id)
        if r.seat_of(key) != 1:
            raise SilverError("forbidden", "This link's key is not valid for the room.")
        r.touched = time.time()
        return r

    def page_data(self, room_id: str, key: str) -> dict[str, Any]:
        r = self._guest(room_id, key)
        t = self.s.store.trainer(r.trainer_id)
        return {"kind": "room", "room": {"id": r.id, "key": key, "mode": r.mode, "format": r.format, "level_rules": r.level_rules,
                                         "host": {"name": t["name"], "avatar": self.s._avatar_payload(t["avatar"], max_bytes=self.s.CODE_PICTURE_BYTES)},
                                         "input_delay": INPUT_DELAY},
                "sprite_server": self.s.settings["sprite_server"], "sprite_set": self.s.settings["sprite_set"], "from": self.s.settings["player_name"]}

    def join(self, room_id: str, key: str, *, name: str, team: Any = None, paste: str = "") -> dict[str, Any]:
        r = self._guest(room_id, key)
        if r.status not in ("waiting", "ready"):
            raise SilverError("conflict", "This room's battle has already started.")
        name = " ".join(str(name or "").split())[:40] or "Amigo"
        sets = self.s._team_from(team, paste)
        if not sets:
            raise SilverError("empty_team", "Bring a team: paste it or pick a random one.")
        if len(sets) > 6:
            raise SilverError("invalid", "A team has at most 6 Pokémon.")
        self.s.check_team(sets, r.format)
        r.guest = {"name": name, "sets": sets}
        r.status = "ready"
        self.s.emit("pvp.joined", {"room": r.id, "guest": name})
        return self.guest_state(room_id, key)

    def guest_state(self, room_id: str, key: str, since: int = 0) -> dict[str, Any]:
        r = self._guest(room_id, key)
        self._sync_status(r)
        out = self.view(r, host=False)
        if r.battle_id:
            b = self.s.battle_get(r.battle_id, since=since, view="p2")
            out["battle"] = {k: b.get(k) for k in ("id", "status", "mode", "format", "winner_side", "winner_name", "turn", "lines", "log_length")}
            out["battle"]["request"] = (b.get("requests") or {}).get("p2")
            if b.get("rt"):
                out["battle"]["rt"] = {k: b["rt"][k] for k in ("spec", "time_limit", "arena", "version")}
        return out

    def guest_choose(self, room_id: str, key: str, choice: str, since: int = 0) -> dict[str, Any]:
        r = self._guest(room_id, key)
        if not r.battle_id:
            raise SilverError("conflict", "The battle has not started.")
        self.s.battle_choose(r.battle_id, "p2", choice, since=since, remote=True)
        return self.guest_state(room_id, key, since)

    def guest_forfeit(self, room_id: str, key: str) -> dict[str, Any]:
        r = self._guest(room_id, key)
        if not r.battle_id:
            raise SilverError("conflict", "The battle has not started.")
        b = self.s.store.battle(r.battle_id)
        if b["status"] == "live":
            if b.get("mode") == "realtime":
                self._broadcast(r, {"k": "ff", "side": "p2"})
            else:
                self.s.battle_forfeit(r.battle_id, "p2", remote=True)
        return self.guest_state(room_id, key)

    # ------------------------------------------------------------ real time: the lockstep relay (runs on the room server's loop)
    async def relay(self, ws: Any, room_id: str, key: str) -> None:
        try:
            r = self._room(room_id)
        except SilverError:
            await ws.close(code=4404)
            return
        seat = r.seat_of(key)
        if seat < 0:
            await ws.close(code=4403)
            return
        await ws.accept()
        r.sockets[seat].add(ws)
        try:
            # whoever (re)connects gets every frame both seats sent so far: the screen fast-forwards to where the battle is
            await ws.send_text(json.dumps({"k": "hello", "seat": seat, "delay": INPUT_DELAY, "frames": r.frames,
                                           "peer": bool(r.sockets[1 - seat]), "battle": r.battle_id}))
            await self._send(r, 1 - seat, {"k": "peer", "on": True})
            while True:
                raw = await ws.receive_text()
                r.touched = time.time()
                try:
                    msg = json.loads(raw)
                except ValueError:
                    continue
                k = msg.get("k")
                if k == "in":
                    # frames for ticks from `from` on; a tick already received is ignored (a resend after reconnecting)
                    start = int(msg.get("from") or 0)
                    mine = r.frames[seat]
                    fresh = []
                    for i, f in enumerate(msg.get("frames") or []):
                        tick = start + i
                        if tick == len(mine) + 1 and isinstance(f, list) and len(f) <= 12:
                            mine.append(f)
                            fresh.append(f)
                    if fresh:
                        await self._send(r, 1 - seat, {"k": "in", "from": len(mine) - len(fresh) + 1, "frames": fresh})
                elif k == "hash":
                    tick, h = int(msg.get("t") or 0), str(msg.get("h") or "")[:64]
                    seen = r.hashes.setdefault(tick, {})
                    seen[seat] = h
                    if len(seen) == 2 and seen[0] != seen[1]:
                        r.desync = r.desync or tick
                        await self._send(r, 0, {"k": "desync", "t": tick})
                        await self._send(r, 1, {"k": "desync", "t": tick})
                    for old in [t for t in r.hashes if t < tick - 600]:
                        r.hashes.pop(old, None)
                elif k == "ff":
                    await self._send(r, 1 - seat, {"k": "ff", "side": SEATS[seat]})
                elif k == "ping":
                    await ws.send_text(json.dumps({"k": "pong", "t": msg.get("t")}))
        except Exception:  # noqa: BLE001 - a closed socket ends the loop
            pass
        finally:
            r.sockets[seat].discard(ws)
            try:
                await self._send(r, 1 - seat, {"k": "peer", "on": bool(r.sockets[seat])})
            except Exception:  # noqa: BLE001
                pass

    async def _send(self, r: Room, seat: int, msg: dict[str, Any]) -> None:
        text = json.dumps(msg)
        for w in list(r.sockets[seat]):
            try:
                await w.send_text(text)
            except Exception:  # noqa: BLE001 - a dead socket is dropped
                r.sockets[seat].discard(w)

    def _broadcast(self, r: Room, msg: dict[str, Any]) -> None:
        if not self._loop or not (r.sockets[0] or r.sockets[1]):
            return
        for seat in (0, 1):
            asyncio.run_coroutine_threadsafe(self._send(r, seat, msg), self._loop)

    # ------------------------------------------------------------ the room server
    def ensure_server(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        port = int(self.s.settings.get("pvp_port") or 5240)
        if not self.s.config.background:
            self.port = port   # tests talk to the room app directly (room_app)
            return
        import uvicorn

        from .pvp_server import room_app

        # SILVER_PVP_HOST=127.0.0.1 keeps the rooms on this computer (tests, or trying a room alone)
        config = uvicorn.Config(room_app(self.s), host=os.environ.get("SILVER_PVP_HOST") or "0.0.0.0", port=port, log_level="warning",
                                lifespan="off", ws="auto")
        server = uvicorn.Server(config)
        self._server = server

        def run() -> None:
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            self._loop = loop
            try:
                loop.run_until_complete(server.serve())
            except Exception:  # noqa: BLE001 - the port is taken, or the network refuses
                log.exception("room server on port %s", port)

        self._thread = threading.Thread(target=run, name="silver-rooms", daemon=True)
        self._thread.start()
        for _ in range(50):
            if server.started:
                break
            time.sleep(0.05)
        if not server.started:
            raise SilverError("unavailable", f"The room server could not listen on port {port}.",
                              hint="Another program may use it: change pvp_port in Settings.")
        self.port = port

    def stop(self) -> None:
        if self._server:
            self._server.should_exit = True
