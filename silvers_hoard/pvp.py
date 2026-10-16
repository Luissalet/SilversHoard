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
(in the link), another for the host's screen and a third for spectators. Rooms close when their battle ends and are forgotten after
a few hours.

Spectators: a room's watch link (``/w/<room>?k=<watch key>``) shows the battle to anyone with it, read only: turn by turn the public
view of the log (no team is revealed before it is seen), in real time the same lockstep frames both players send, run by the
spectator's own copy of the simulator.

The lobby: friends who should see your open rooms without being sent each link get your lobby address once
(``/lobby?c=<lobby code>``, setting ``pvp_lobby_code``). It lists the rooms opened as listed (the default): a waiting one with its
join link, a live one with its watch link. Your own Silver keeps your friends' lobby addresses (``pvp_friends.json`` in the data
folder) and gathers their open rooms in one list (pvp_friends_rooms), which the family Hub also shows in its Today view (the
agenda provider below).
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
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
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
WATCH = 2                      # the spectators' seat number in Room.sockets
MAX_FRIENDS = 30
FRIENDS_TTL = 15.0             # seconds the gathered friends' rooms are reused


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
    def __init__(self, *, trainer_id: str, mode: str, format_: str, level_rules: dict[str, Any], rt_arena: str, time_limit: int,
                 listed: bool = True):
        self.id = secrets.token_urlsafe(6).replace("-", "a").replace("_", "b")
        self.guest_key = secrets.token_urlsafe(18)
        self.host_key = secrets.token_urlsafe(18)
        self.watch_key = secrets.token_urlsafe(18)
        self.listed = listed
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
        self.sockets: list[set[Any]] = [set(), set(), set()]     # host, friend, spectators
        self.hashes: dict[int, dict[int, str]] = {}
        self.desync = 0

    def seat_of(self, key: str) -> int:
        if key and secrets.compare_digest(key, self.host_key):
            return 0
        if key and secrets.compare_digest(key, self.guest_key):
            return 1
        if key and secrets.compare_digest(key, self.watch_key):
            return WATCH
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
        self._friends_cache: tuple[float, list[dict[str, Any]]] = (0.0, [])

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

    def watch_links(self, r: Room) -> dict[str, Any]:
        return self.links_for(f"/w/{r.id}?k={r.watch_key}")

    def links_for(self, path: str) -> dict[str, Any]:
        """Where friends reach a path of the room server: this computer's network addresses, and the public address if set."""
        public = str(self.s.settings.get("pvp_public_url") or "").rstrip("/")
        port = self.port or int(self.s.settings.get("pvp_port") or 5240)     # before the first room the server is not up yet
        lan = [f"http://{ip}:{port}{path}" for ip in lan_addresses()]
        return {"lan": lan, "public": f"{public}{path}" if public else "", "local": f"http://127.0.0.1:{port}{path}",
                "port": port, "path": path}

    def view(self, r: Room, *, host: bool = True) -> dict[str, Any]:
        out: dict[str, Any] = {"id": r.id, "mode": r.mode, "format": r.format, "level_rules": r.level_rules, "status": r.status,
                               "rt_arena": r.rt_arena, "time_limit": r.time_limit, "battle_id": r.battle_id,
                               "guest": {"name": r.guest.get("name", ""), "species": [str(x.get("species") or "") for x in r.guest.get("sets") or []]}
                               if r.guest else None}
        if host:
            t = self.s.store.trainer(r.trainer_id)
            out.update({"trainer": {"id": t["id"], "name": t["name"], "avatar_url": self.s.avatar_url(t["avatar"])}, "links": self.links(r),
                        "watch_links": self.watch_links(r), "listed": r.listed, "spectators": len(r.sockets[WATCH]),
                        "host_key": r.host_key, "ws": f"ws://127.0.0.1:{self.port}/api/room/{r.id}/ws?k={r.host_key}", "input_delay": INPUT_DELAY})
        if r.battle_id:
            b = self.s.store.battle(r.battle_id)
            out["battle"] = {"status": b["status"], "winner_side": b.get("winner_side") or "", "winner_name": b.get("winner_name") or ""}
        if r.desync:
            out["desync"] = r.desync
        return out

    def open(self, *, trainer_id: str, mode: str = "classic", format_: str = "", level_rules: Optional[dict[str, Any]] = None,
             rt_arena: str = "rocks", time_limit: int = 0, listed: bool = True) -> dict[str, Any]:
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
                 time_limit=max(30, min(int(time_limit or self.s.settings.get("rt_time_limit") or 300), 1800)), listed=bool(listed))
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
    def _guest(self, room_id: str, key: str, seat: int = 1) -> Room:
        r = self._room(room_id)
        if r.seat_of(key) != seat:
            raise SilverError("forbidden", "This link's key is not valid for the room.")
        r.touched = time.time()
        return r

    def page_data(self, room_id: str, key: str, *, watch: bool = False) -> dict[str, Any]:
        r = self._guest(room_id, key, WATCH if watch else 1)
        t = self.s.store.trainer(r.trainer_id)
        return {"kind": "room", "room": {"id": r.id, "key": key, "mode": r.mode, "format": r.format, "level_rules": r.level_rules,
                                         "host": {"name": t["name"], "avatar": self.s._avatar_payload(t["avatar"], max_bytes=self.s.CODE_PICTURE_BYTES)},
                                         "input_delay": INPUT_DELAY, "role": "watch" if watch else "play"},
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

    def watch_state(self, room_id: str, key: str, since: int = 0) -> dict[str, Any]:
        """What a spectator sees: the room, and once it started the battle's public view (no request, no hidden team)."""
        r = self._guest(room_id, key, WATCH)
        self._sync_status(r)
        out = self.view(r, host=False)
        out["host_name"] = self.s.store.trainer(r.trainer_id)["name"]
        out["spectators"] = len(r.sockets[WATCH])
        if r.battle_id:
            b = self.s.battle_get(r.battle_id, since=since, view="spectator")
            out["battle"] = {k: b.get(k) for k in ("id", "status", "mode", "format", "winner_side", "winner_name", "turn", "lines", "log_length")}
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

    # ------------------------------------------------------------ the lobby: your listed rooms, for friends who have your lobby address
    def lobby_code(self) -> str:
        code = str(self.s.settings.get("pvp_lobby_code") or "")
        if not code:
            code = secrets.token_urlsafe(9).replace("-", "a").replace("_", "b")
            self.s.settings.update({"pvp_lobby_code": code})
        return code

    def lobby_links(self) -> dict[str, Any]:
        """Your lobby address to give friends once (the room server must be running for them to reach it: it starts with a room)."""
        return {**self.links_for(f"/lobby?c={self.lobby_code()}"), "running": bool(self._thread and self._thread.is_alive()) or not self.s.config.background,
                "rooms": [self._lobby_row(r) for r in self._listed()] + self._pokeathlon_rows()}

    def lobby_new_code(self) -> dict[str, Any]:
        """A new lobby code: the old lobby address stops working (give the new one to the friends who should keep it)."""
        self.s.settings.update({"pvp_lobby_code": ""})
        return self.lobby_links()

    def _listed(self) -> list[Room]:
        self._expire()
        for r in self.rooms.values():
            self._sync_status(r)
        return [r for r in self.rooms.values() if r.listed and r.status in ("waiting", "ready", "live")]

    def _pokeathlon_rows(self) -> list[dict[str, Any]]:
        from . import pokeathlon_rooms

        return pokeathlon_rooms.service(self.s).lobby_rows()

    def _lobby_row(self, r: Room) -> dict[str, Any]:
        t = self.s.store.trainer(r.trainer_id)
        return {"id": r.id, "mode": r.mode, "format": r.format, "status": r.status, "level": (r.level_rules or {}).get("level") or 0,
                "host": t["name"], "guest": r.guest.get("name", "") if r.guest else "",
                "join": f"/r/{r.id}?k={r.guest_key}" if r.status == "waiting" else "",
                "watch": f"/w/{r.id}?k={r.watch_key}", "spectators": len(r.sockets[WATCH])}

    def lobby(self, code: str) -> dict[str, Any]:
        """The room server's lobby answer: the listed rooms, for whoever has the lobby code."""
        mine = str(self.s.settings.get("pvp_lobby_code") or "")
        if not mine or not code or not secrets.compare_digest(str(code), mine):
            raise SilverError("forbidden", "This lobby address is not valid (or it was changed).")
        from . import pokeathlon_rooms

        rows = [self._lobby_row(r) for r in self._listed()] + pokeathlon_rooms.service(self.s).lobby_rows()
        return {"name": str(self.s.settings.get("player_name") or ""), "rooms": rows}

    # ------------------------------------------------------------ friends: their lobby addresses and their open rooms
    def _friends_path(self):
        return self.s.config.data_dir / "pvp_friends.json"

    def friends(self) -> list[dict[str, Any]]:
        try:
            data = json.loads(self._friends_path().read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return []
        return [f for f in data if isinstance(f, dict) and f.get("id") and f.get("url")] if isinstance(data, list) else []

    def _save_friends(self, rows: list[dict[str, Any]]) -> None:
        from .hoard_link.atomic import write_bytes_atomic

        write_bytes_atomic(self._friends_path(), json.dumps(rows, ensure_ascii=False, indent=1).encode("utf-8"))
        self._friends_cache = (0.0, [])

    @staticmethod
    def _lobby_api(url: str) -> tuple[str, str]:
        """(base, code) of a friend's lobby address (http(s)://host:port/lobby?c=CODE)."""
        u = urllib.parse.urlsplit(str(url or "").strip())
        code = (urllib.parse.parse_qs(u.query).get("c") or [""])[0]
        if u.scheme not in ("http", "https") or not u.netloc or not u.path.rstrip("/").endswith("/lobby") or not code:
            raise SilverError("invalid", "A friend's lobby address looks like http://192.168.1.20:5240/lobby?c=… (they find it in Combatir › En directo).")
        prefix = u.path.rstrip("/")[: -len("/lobby")]
        return f"{u.scheme}://{u.netloc}{prefix}", code

    def friend_add(self, name: str, url: str) -> dict[str, Any]:
        base, code = self._lobby_api(url)
        name = " ".join(str(name or "").split())[:40]
        rows = self.friends()
        clean = f"{base}/lobby?c={code}"
        for f in rows:
            if f["url"] == clean:
                f["name"] = name or f["name"]
                self._save_friends(rows)
                return {"friend": f, "friends": rows}
        if len(rows) >= MAX_FRIENDS:
            raise SilverError("conflict", f"At most {MAX_FRIENDS} friends' lobbies; remove one first.")
        f = {"id": secrets.token_hex(4), "name": name or urllib.parse.urlsplit(base).hostname or "Amigo", "url": clean}
        rows.append(f)
        self._save_friends(rows)
        return {"friend": f, "friends": rows}

    def friend_remove(self, friend_id: str) -> dict[str, Any]:
        rows = [f for f in self.friends() if f["id"] != friend_id]
        self._save_friends(rows)
        return {"friends": rows}

    def _fetch_lobby(self, f: dict[str, Any]) -> dict[str, Any]:
        base, code = self._lobby_api(f["url"])
        out: dict[str, Any] = {"friend": f, "ok": False, "rooms": [], "error": ""}
        try:
            req = urllib.request.Request(f"{base}/api/lobby?c={urllib.parse.quote(code)}", headers={"User-Agent": "SilversHoard/0.1"})
            with urllib.request.urlopen(req, timeout=3) as resp:
                data = json.loads(resp.read(200_000).decode("utf-8"))
        except urllib.error.HTTPError as e:
            out["error"] = "forbidden" if e.code == 403 else f"HTTP {e.code}"
            return out
        except Exception:  # noqa: BLE001 - their computer is off, or no room open (the room server is not running)
            out["error"] = "offline"
            return out
        out["ok"] = True
        out["name"] = str(data.get("name") or "")[:40]
        for r in (data.get("rooms") or [])[:MAX_ROOMS]:
            if not isinstance(r, dict):
                continue
            row = {k: r.get(k) for k in ("id", "mode", "format", "status", "level", "host", "guest", "spectators")}
            for k in ("join", "watch"):
                path = str(r.get(k) or "")
                row[f"{k}_url"] = f"{base}{path}" if path.startswith(("/r/", "/w/", "/p/", "/pw/")) else ""
            out["rooms"].append(row)
        return out

    def friends_rooms(self, refresh: bool = False) -> dict[str, Any]:
        """Every friend's open rooms, asked in parallel (3 s each); reused for a few seconds."""
        at, cached = self._friends_cache
        if not refresh and cached and time.time() - at < FRIENDS_TTL:
            return {"friends": cached, "cached": True}
        rows = self.friends()
        if not rows:
            return {"friends": []}
        with ThreadPoolExecutor(max_workers=min(8, len(rows))) as pool:
            got = list(pool.map(self._fetch_lobby, rows))
        self._friends_cache = (time.time(), got)
        return {"friends": got}

    def agenda(self, *_: Any) -> list[dict[str, Any]]:
        """The family Hub's Today view: friends' rooms open right now (a waiting one to join, a live one to watch)."""
        try:
            rows = self.friends_rooms().get("friends") or []
        except Exception:  # noqa: BLE001 - the agenda never fails because of a friend
            return []
        now = time.strftime("%Y-%m-%dT%H:%M:%S")
        items = []
        for f in rows:
            who = f.get("name") or f["friend"].get("name") or "?"
            for r in f.get("rooms") or []:
                waiting = r.get("status") == "waiting" and r.get("join_url")
                mode = "Pokéathlon" if r.get("mode") == "pokeathlon" else "tiempo real" if r.get("mode") == "realtime" else "por turnos"
                items.append({"id": f"silver:room:{f['friend']['id']}-{r.get('id')}", "start": now, "kind": "other",
                              "priority": "normal" if waiting else "low",
                              "title": (f"{who} te espera en una sala de combate ({mode})" if waiting
                                        else f"{who}: combate en directo ({mode}), se puede mirar"),
                              "detail": f"{r.get('host') or who}{' contra ' + r['guest'] if r.get('guest') else ''} · {r.get('format') or ''}",
                              "url": (r.get("join_url") if waiting else r.get("watch_url")) or ""})
        return items

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
            peer = bool(r.sockets[0] and r.sockets[1]) if seat == WATCH else bool(r.sockets[1 - seat])
            await ws.send_text(json.dumps({"k": "hello", "seat": seat, "delay": INPUT_DELAY, "frames": r.frames,
                                           "peer": peer, "battle": r.battle_id}))
            if seat == WATCH:
                # a spectator only listens (a ping is answered so its screen knows the room is there)
                while True:
                    msg = json.loads(await ws.receive_text() or "{}")
                    if isinstance(msg, dict) and msg.get("k") == "ping":
                        await ws.send_text(json.dumps({"k": "pong", "t": msg.get("t")}))
            await self._send(r, 1 - seat, {"k": "peer", "on": True})
            await self._send(r, WATCH, {"k": "peer", "on": bool(r.sockets[0] and r.sockets[1])})
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
                        start_at = len(mine) - len(fresh) + 1
                        await self._send(r, 1 - seat, {"k": "in", "from": start_at, "frames": fresh})
                        await self._send(r, WATCH, {"k": "in", "seat": seat, "from": start_at, "frames": fresh})
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
                    await self._send(r, WATCH, {"k": "ff", "side": SEATS[seat]})
                elif k == "ping":
                    await ws.send_text(json.dumps({"k": "pong", "t": msg.get("t")}))
        except Exception:  # noqa: BLE001 - a closed socket ends the loop
            pass
        finally:
            r.sockets[seat].discard(ws)
            if seat != WATCH:
                try:
                    await self._send(r, 1 - seat, {"k": "peer", "on": bool(r.sockets[seat])})
                    await self._send(r, WATCH, {"k": "peer", "on": bool(r.sockets[0] and r.sockets[1])})
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
        if not self._loop or not (r.sockets[0] or r.sockets[1] or r.sockets[WATCH]):
            return
        for seat in (0, 1, WATCH):
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
