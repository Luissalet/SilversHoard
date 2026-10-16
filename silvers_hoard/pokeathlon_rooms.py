"""Pokéathlon with friends: up to four people play the same course (or one event) at the same time, each from their own computer.

A host opens a room (``pokeathlon_room_open``, or the "With friends" tab of the Pokéathlon page) for one of the five courses, the Supreme
one or a single event. Silver's room server (pvp.py, setting ``pvp_port``) serves the room: a friend opens the join link in any browser
(the page carries the Pokéathlon events and runtime, Silver is not needed), brings three Pokémon (any species, stars within the range of
that Pokémon) and takes the next free team; the teams nobody takes are filled with the game's NPC teams. Spectators open the watch link.

Every browser runs the whole event itself from the same seed and the same four teams (a deterministic lockstep, see
client/src/pokeathlon/lockstep.js): the room only relays, for each team that a person steers, one small frame of input per 1/30 s tick,
and decides when a round starts and ends. This server never simulates anything.

Round by round:

1. ``intro``: everybody reads the event and presses go once their sprites are loaded (``ready``). When every person still playing is
   ready the room says ``go`` and each browser counts 3-2-1 and plays.
2. ``play``: frames (``in``) are stored and relayed; a tick runs on a browser once the frames of everybody are in. Browsers compare a
   checksum of their random numbers now and then (``hash``): a difference is reported as ``desync``.
3. When the event ends every browser sends its result (``done``); the host's is the one that counts (the first person's if the host left)
   and is broadcast (``result``). The room then waits for the next ``ready``. After the last round the room is ``ended``; the host's page
   shows the ceremony and saves the course through pokeathlon_result_save (the host's team is the one in the records).

A person who leaves, or whose connection stays down for a few seconds, or who stops sending frames, is replaced by the CPU: the room puts
a CPU marker (0) in that team's frames at the first tick it has no frame for, and every browser takes the team over at that same tick.
A team the CPU took over stays CPU for the rest of the course.

Keys: the join link carries a key to take a team (the friend gets a team key back, to come back after a reload), the host has one, and
spectators another. Nothing else of Silver is reachable through the room server.
"""
from __future__ import annotations

import asyncio
import gzip
import json
import logging
import random
import secrets
import threading
import time
from typing import TYPE_CHECKING, Any, Literal, Optional

from pydantic import BaseModel, Field

from . import pokeathlon as pk
from .errors import SilverError

if TYPE_CHECKING:  # pragma: no cover
    from .services import Services

log = logging.getLogger("silver.pkrooms")

COLORS = ["#e5483d", "#3b82e6", "#35b25c", "#f0b429"]    # the four teams, as in client/src/pokeathlon/core.js
DELAY = 4                    # ticks between reading an input and running it (the round trip hides behind it)
GRACE = 6.0                  # seconds a dropped connection has to come back before the CPU takes the team over
STALL = 8.0                  # seconds without a frame from a person every other screen is waiting for
START_SLACK = 15.0           # extra seconds after "go" for a first frame (the countdown and a slow computer)
READY_WAIT = 120.0           # seconds the others wait for someone who has not pressed go once the first did
DONE_WAIT = 20.0             # seconds to wait for the host's result after somebody else's
ROOM_TTL = 4 * 3600
MAX_ROOMS = 6
MAX_WATCH = 30
MAX_FRAME_JSON = 3000        # one frame of input is a few hundred bytes
MAX_FRAMES_PER_MSG = 32
MAX_TICKS = 30 * 60 * 25     # no event lasts that long
WATCH = 4                    # the spectators' slot in PkRoom.sockets (0-3 are the teams)
DEFAULT_MONS = ("pikachu", "machamp", "gyarados")


# ------------------------------------------------------------------------------------------------------------ tool arguments
class SpecMon(BaseModel):
    species: str = Field(..., min_length=1, max_length=60, description="The Pokémon (Showdown spelling, e.g. Rotom-Wash).")
    stars: dict[str, int] = Field(default_factory=dict, description="speed, power, skill, stamina, jump: 1-5 each, kept within the Pokémon's own range; missing = its base.")


class TeamSpec(BaseModel):
    name: str = Field("", max_length=24)
    mons: list[SpecMon] = Field(..., min_length=3, max_length=3)


class RoomOpenArgs(BaseModel):
    course: Literal["speed", "power", "skill", "stamina", "jump", "supreme", "single"] = Field(
        "speed", description="One of the five courses, the Supreme one, or single for one event on its own (then give event).")
    event: str = Field("", max_length=20, description="The event of a single-event room (hurdle_dash, pennant_capture, circle_push, block_smash, disc_catch, lamp_jump, relay_run, ring_drop, snow_throw, goal_roll).")
    supreme: bool = Field(False, description="The stronger NPC teams (always on for the supreme course).")
    host_name: str = Field("", max_length=40, description="Your name in the room (empty: the app's player name).")
    team: Optional[TeamSpec] = Field(None, description="Your three Pokémon (empty: Pikachu, Machamp and Gyarados at their base stars).")
    max_friends: int = Field(3, ge=1, le=3, description="How many friends may take a team (the rest are NPC teams).")
    listed: bool = Field(True, description="Show the room in your lobby to the friends who have your lobby address (pvp_lobby).")


class PkRoomArg(BaseModel):
    room: str = Field(..., min_length=1, max_length=40, description="The room id pokeathlon_room_open returned.")


class PkRoomGetArgs(BaseModel):
    room: str = Field("", max_length=40, description="A room id; empty lists every open Pokéathlon room.")


# ------------------------------------------------------------------------------------------------------------ the room
class Seat:
    def __init__(self, idx: int, name: str, spec: dict[str, Any], key: str):
        self.idx = idx
        self.name = name
        self.spec = spec
        self.key = key
        self.active = True       # a person steers this team (False once the CPU took it over)
        self.left = ""           # why not: left, dropped, slow
        self.dropped_at = 0.0    # when its last connection closed (0 = connected, or never connected)
        self.last_frame = 0.0


class PkRoom:
    def __init__(self, *, course: str, supreme: bool, event: str, events: list[str], seed: int, medal: str, host_name: str,
                 host_spec: dict[str, Any], max_friends: int, listed: bool):
        self.id = secrets.token_urlsafe(6).replace("-", "a").replace("_", "b")
        self.host_key = secrets.token_urlsafe(18)
        self.join_key = secrets.token_urlsafe(18)
        self.watch_key = secrets.token_urlsafe(18)
        self.course = course
        self.supreme = supreme
        self.event = event
        self.events = events
        self.seed = seed
        self.medal = medal
        self.max_friends = max_friends
        self.listed = listed
        self.seats: list[Optional[Seat]] = [Seat(0, host_name, host_spec, self.host_key), None, None, None]
        self.teams: Optional[list[dict[str, Any]]] = None
        self.status = "waiting"              # waiting, live, ended, closed
        self.phase = "lobby"                 # lobby, intro, play, ended
        self.round = 0
        self.ready: set[int] = set()
        self.ready_since = 0.0
        self.humans: list[int] = []          # the teams people steer in the round being played
        self.frames: list[list[Any]] = [[], [], [], []]
        self.dones: dict[int, dict[str, Any]] = {}
        self.first_done = 0.0
        self.results: list[dict[str, Any]] = []
        self.hashes: dict[int, dict[int, str]] = {}
        self.desync = 0
        self.sockets: list[set[Any]] = [set(), set(), set(), set(), set()]
        self.created = self.touched = time.time()
        self.lock = threading.RLock()
        self.outbox: list[tuple[Any, dict[str, Any]]] = []
        self.watcher: Any = None
        self.alock: Any = None

    def role_of(self, key: str) -> tuple[str, int]:
        """(role, slot) of a key: seat (a team), join (the link everybody gets), watch (spectator) or ("", -1)."""
        if not key:
            return "", -1
        for s in self.seats:
            if s and secrets.compare_digest(key, s.key):
                return "seat", s.idx
        if secrets.compare_digest(key, self.join_key):
            return "join", -1
        if secrets.compare_digest(key, self.watch_key):
            return "watch", WATCH
        return "", -1

    def out(self, target: Any, msg: dict[str, Any]) -> None:
        self.outbox.append((target, msg))

    def active(self) -> list[int]:
        return [s.idx for s in self.seats if s and s.active]


def _clean_result(res: Any) -> dict[str, Any]:
    raw = res.get("raw") if isinstance(res, dict) else None
    out_raw = []
    for i in range(4):
        try:
            v = float((raw or [0, 0, 0, 0])[i])
        except (TypeError, ValueError, IndexError):
            v = 0.0
        out_raw.append(v if v == v and abs(v) < 1e9 else 0.0)
    detail = res.get("detail") if isinstance(res, dict) else None
    out_detail = [(d if isinstance(d, dict) else {}) for d in (detail or [])[:4]]
    out_detail += [{}] * (4 - len(out_detail))
    if len(json.dumps(out_detail)) > 200_000:
        out_detail = [{}, {}, {}, {}]
    return {"raw": out_raw, "detail": out_detail}


class PkRooms:
    def __init__(self, services: "Services"):
        self.s = services
        self.rooms: dict[str, PkRoom] = {}
        self._lock = threading.Lock()
        self._stats_gz: Optional[bytes] = None

    # ------------------------------------------------------------ rooms (the host's side: tools and the app)
    def _room(self, room_id: str) -> PkRoom:
        self._expire()
        r = self.rooms.get(room_id or "")
        if not r:
            raise SilverError("not_found", "That Pokéathlon room does not exist (or it has expired).")
        return r

    def _expire(self) -> None:
        now = time.time()
        with self._lock:
            for rid in [k for k, r in self.rooms.items() if now - r.touched > ROOM_TTL or r.status == "closed"]:
                self.rooms.pop(rid, None)

    def _clean_spec(self, raw: Any, fallback: str) -> dict[str, Any]:
        """A team spec ({name, mons: [{species | id, stars}]}) checked against the Pokéathlon table, stars clamped to each Pokémon's range."""
        pkm = pk.service(self.s)
        raw = raw if isinstance(raw, dict) else {}
        name = " ".join(str(raw.get("name") or "").split())[:24] or fallback
        given = raw.get("mons")
        if not given:
            given = [{"species": d} for d in DEFAULT_MONS]
        if not isinstance(given, list) or len(given) != 3:
            raise SilverError("invalid", "A team is exactly three Pokémon.")
        mons = []
        for m in given:
            m = m if isinstance(m, dict) else {"species": m}
            key = m.get("species") or m.get("id") or m.get("name") or ""
            row = pkm.find(str(key))
            if not row:
                raise SilverError("invalid", f"Not a Pokémon of the Pokéathlon table: {key}")
            given_stars = m.get("stars") if isinstance(m.get("stars"), dict) else {}
            stars, base, lo, hi = {}, {}, {}, {}
            for st in pk.STATS:
                b = row["stars"][st]
                base[st], lo[st], hi[st] = b["base"], b["min"], b["max"]
                try:
                    v = int(round(float(given_stars.get(st, b["base"]))))
                except (TypeError, ValueError):
                    v = b["base"]
                stars[st] = max(b["min"], min(b["max"], v))
            mons.append({"species": row["name"], "num": row["num"], "form": row.get("forme") or "", "name": row["name"], "stars": stars,
                         "base": base, "min": lo, "max": hi, "derived": bool(row.get("derived"))})
        return {"name": name, "mons": mons}

    def open(self, a: RoomOpenArgs) -> dict[str, Any]:
        if a.course == pk.SINGLE:
            if a.event not in pk.EVENT_BY_ID:
                raise SilverError("invalid", f"A single-event room needs event: one of {', '.join(pk.EVENT_IDS)}.")
            events = [a.event]
            medal = ""
        else:
            course = pk.COURSE_BY_KEY[a.course]
            seed_for_set = secrets.randbits(32)
            events = list(course["events"]) if course["events"] else list(random.Random(seed_for_set).choice(course["sets"]))
            medal = course["medal"]
        name = " ".join(str(a.host_name or self.s.settings.get("player_name") or "").split())[:40] or "Host"
        spec = self._clean_spec(a.team.model_dump() if a.team else None, name)
        self._expire()
        if len(self.rooms) >= MAX_ROOMS:
            raise SilverError("conflict", "Too many Pokéathlon rooms open; close one first (pokeathlon_room_close).")
        r = PkRoom(course=a.course, supreme=bool(a.supreme or a.course == "supreme"), event=a.event if a.course == pk.SINGLE else "", events=events,
                   seed=secrets.randbits(32), medal=medal, host_name=name, host_spec=spec, max_friends=a.max_friends, listed=bool(a.listed))
        self.s.pvp.ensure_server()
        with self._lock:
            self.rooms[r.id] = r
        self.s.emit("pokeathlon.room_opened", {"room": r.id, "course": r.course})
        return self.view(r, host=True)

    def get(self, room_id: str) -> dict[str, Any]:
        return self.view(self._room(room_id), host=True)

    def list(self) -> list[dict[str, Any]]:
        self._expire()
        return [self.view(r, host=True) for r in list(self.rooms.values())]

    def close(self, room_id: str) -> dict[str, Any]:
        r = self._room(room_id)
        with r.lock:
            r.status = "closed"
            r.out("all", {"k": "closed"})
        self._kick(r)
        with self._lock:
            self.rooms.pop(r.id, None)
        return {"closed": r.id}

    def start(self, room_id: str) -> dict[str, Any]:
        """The host starts the course: the free teams get NPC teams and the first round's introduction opens on every screen."""
        r = self._room(room_id)
        with r.lock:
            self._start(r)
        self._kick(r)
        self.s.emit("pokeathlon.room_started", {"room": r.id})
        return self.view(r, host=True)

    def _start(self, r: PkRoom) -> None:
        if r.status != "waiting":
            raise SilverError("conflict", "This room has already started." if r.status in ("live", "ended") else "This room is closed.")
        pkm = pk.service(self.s)
        pkm._load()
        assert pkm._npc is not None
        rng = random.Random(r.seed ^ 0x5A17)
        free = [i for i in range(4) if r.seats[i] is None]
        course_id = pk.COURSE_BY_KEY[r.course]["id"] if r.course != pk.SINGLE else rng.randrange(5)
        pool = list(range(25, 50)) if course_id >= 10 else list(range(5 * course_id, 5 * course_id + 5))
        picked = []
        for _ in free:
            picked.append(pool.pop(rng.randrange(len(pool))) + (50 if r.supreme else 0) + 1)
        npc = {t["team"]: t for t in pkm._npc}
        teams: list[dict[str, Any]] = []
        for i in range(4):
            seat = r.seats[i]
            cpu = 1 if r.supreme else 0
            if seat:
                teams.append({"index": i, "name": seat.spec["name"], "color": COLORS[i], "human": True, "cpu": cpu, "npc": 0,
                              "mons": [dict(m) for m in seat.spec["mons"]]})
            else:
                t = npc[picked[free.index(i)]]
                mons = [{"species": m["name"], "num": m.get("species") or 0, "form": m.get("form") or "", "name": m["name"], "stars": dict(m["stars"]),
                         "base": dict(m["stars"]), "min": dict(m["stars"]), "max": dict(m["stars"]), "derived": False} for m in t["mons"]]
                teams.append({"index": i, "name": t["name"], "color": COLORS[i], "human": False, "cpu": cpu, "npc": t["team"], "mons": mons})
        r.teams = teams
        r.status = "live"
        r.phase = "intro"
        r.round = 0
        r.ready = set()
        r.touched = time.time()
        r.out("all", {"k": "start", **self._config(r)})
        r.out("all", self._room_msg(r))

    def _config(self, r: PkRoom) -> dict[str, Any]:
        return {"teams": r.teams, "events": r.events, "seed": r.seed, "course": r.course, "supreme": r.supreme, "medal": r.medal,
                "single": r.course == pk.SINGLE, "delay": DELAY}

    # ------------------------------------------------------------ what a room looks like
    def links(self, r: PkRoom) -> dict[str, Any]:
        return self.s.pvp.links_for(f"/p/{r.id}?k={r.join_key}")

    def watch_links(self, r: PkRoom) -> dict[str, Any]:
        return self.s.pvp.links_for(f"/pw/{r.id}?k={r.watch_key}")

    def view(self, r: PkRoom, *, host: bool = False) -> dict[str, Any]:
        seats = []
        for i in range(4):
            st = r.seats[i]
            if st is None:
                seats.append({"seat": i, "free": i > 0 and i <= r.max_friends, "human": False, "name": "", "species": [], "connected": False})
            else:
                seats.append({"seat": i, "free": False, "human": st.active, "name": st.name, "team": st.spec["name"], "host": i == 0,
                              "species": [m["species"] for m in st.spec["mons"]], "connected": bool(r.sockets[i]), "left": st.left})
        out: dict[str, Any] = {
            "id": r.id, "kind": "pokeathlon", "course": r.course, "event": r.event, "events": r.events, "supreme": r.supreme, "medal": r.medal,
            "status": r.status, "phase": r.phase, "round": r.round, "rounds": len(r.events), "seats": seats, "max_friends": r.max_friends,
            "free": sum(1 for i in range(1, r.max_friends + 1) if r.seats[i] is None), "listed": r.listed, "spectators": len(r.sockets[WATCH]),
            "desync": r.desync, "played": len(r.results),
        }
        if host:
            out.update({"links": self.links(r), "watch_links": self.watch_links(r), "host_key": r.host_key, "input_delay": DELAY,
                        "ws_path": f"/api/pk/{r.id}/ws?k={r.host_key}", "port": self.s.pvp.port})
        return out

    def _room_msg(self, r: PkRoom) -> dict[str, Any]:
        return {"k": "room", "room": self.view(r)}

    def lobby_rows(self) -> list[dict[str, Any]]:
        """The rooms the lobby (pvp.py) lists next to the live battles: one to join while there is a free team, one to watch."""
        self._expire()
        rows = []
        for r in list(self.rooms.values()):
            if not r.listed or r.status not in ("waiting", "live"):
                continue
            friends = [s.name for s in r.seats[1:] if s]
            rows.append({"id": r.id, "kind": "pokeathlon", "mode": "pokeathlon", "format": r.event or r.course, "status": r.status if r.status == "live" else "waiting",
                         "level": 0, "host": r.seats[0].name if r.seats[0] else "", "guest": ", ".join(friends),
                         "join": f"/p/{r.id}?k={r.join_key}" if r.status == "waiting" and any(r.seats[i] is None for i in range(1, r.max_friends + 1)) else "",
                         "watch": f"/pw/{r.id}?k={r.watch_key}", "spectators": len(r.sockets[WATCH])})
        return rows

    # ------------------------------------------------------------ the friend's side (the room server)
    def _visitor(self, room_id: str, key: str, *, roles: tuple[str, ...] = ("seat", "join", "watch")) -> tuple[PkRoom, str, int]:
        r = self._room(room_id)
        role, slot = r.role_of(key)
        if role not in roles:
            raise SilverError("forbidden", "This link's key is not valid for the room.")
        r.touched = time.time()
        return r, role, slot

    def page_data(self, room_id: str, key: str, *, watch: bool = False) -> dict[str, Any]:
        r, role, slot = self._visitor(room_id, key, roles=("watch",) if watch else ("join", "seat"))
        s = self.s.settings
        return {"kind": "pkroom", "room": {"id": r.id, "key": key, "role": "watch" if watch else "play", "seat": slot if role == "seat" else -1,
                                           "view": self.view(r), "base": f"/pkr/{r.id}/{key}"},
                "sprite_server": s["sprite_server"], "sprite_set": s["sprite_set"], "from": s["player_name"]}

    def info(self, room_id: str, key: str) -> dict[str, Any]:
        r, _, _ = self._visitor(room_id, key)
        return self.view(r)

    def stats_gz(self, room_id: str, key: str) -> bytes:
        """Every Pokémon with its stars, for the friend's team editor (compressed once)."""
        self._visitor(room_id, key)
        if self._stats_gz is None:
            rows = pk.service(self.s).stats(pk.StatsArgs(limit=0))["species"]
            self._stats_gz = gzip.compress(json.dumps({"species": rows}, separators=(",", ":")).encode("utf-8"), 6)
        return self._stats_gz

    def join(self, room_id: str, key: str, *, name: str, team: Any = None) -> dict[str, Any]:
        r, role, _ = self._visitor(room_id, key, roles=("join",))
        name = " ".join(str(name or "").split())[:40] or "Amigo"
        spec = self._clean_spec(team, name)
        with r.lock:
            if r.status != "waiting":
                raise SilverError("conflict", "This room has already started.")
            idx = next((i for i in range(1, r.max_friends + 1) if r.seats[i] is None), 0)
            if not idx:
                raise SilverError("conflict", "The room is full: every team is taken.")
            seat = Seat(idx, name, spec, secrets.token_urlsafe(18))
            seat.dropped_at = time.time()          # until its WebSocket connects
            r.seats[idx] = seat
            r.out("all", self._room_msg(r))
        self._kick(r)
        self.s.emit("pokeathlon.room_joined", {"room": r.id, "seat": idx, "name": name})
        return {"seat": idx, "seat_key": seat.key, "room": self.view(r)}

    def sprite_meta(self, room_id: str, key: str, dex: int, form: str = "", shiny: bool = False) -> dict[str, Any]:
        self._visitor(room_id, key)
        meta = self.s.pmd.meta(dex, form=form, shiny=shiny)
        return {**meta, "credit": self.s.credits.walking(str(meta.get("key") or ""))}

    def sprite_sheet(self, room_id: str, key: str, sheet_key: str, anim: str):
        self._visitor(room_id, key)
        return self.s.pmd.sheet(sheet_key, anim.removesuffix(".png"))

    # ------------------------------------------------------------ the round machine (all of it under r.lock)
    def _maybe_go(self, r: PkRoom) -> None:
        act = r.active()
        if r.phase != "intro" or not act or not all(i in r.ready for i in act):
            return
        now = time.time()
        r.phase = "play"
        r.humans = act
        r.frames = [[], [], [], []]
        r.dones = {}
        r.first_done = 0.0
        r.hashes = {}
        for i in act:
            r.seats[i].last_frame = now + START_SLACK       # type: ignore[union-attr]
        r.out("all", {"k": "go", "r": r.round, "humans": act})
        r.out("all", self._room_msg(r))

    def _takeover(self, r: PkRoom, idx: int, why: str) -> None:
        seat = r.seats[idx]
        if seat is None or not seat.active:
            return
        seat.active = False
        seat.left = why
        if r.phase == "play" and idx in r.humans and idx not in r.dones:
            tick = len(r.frames[idx]) + 1
            r.frames[idx].append(0)
            r.out("all", {"k": "in", "r": r.round, "seat": idx, "from": tick, "frames": [0]})
        r.ready.discard(idx)
        r.out("all", {"k": "left", "seat": idx, "why": why})
        r.out("all", self._room_msg(r))
        self._maybe_go(r)
        self._maybe_finish(r)
        self.s.emit("pokeathlon.room_left", {"room": r.id, "seat": idx, "why": why})

    def _maybe_finish(self, r: PkRoom, force: bool = False) -> None:
        if r.phase != "play" or not r.dones:
            return
        waiting = [i for i in r.humans if r.seats[i] and r.seats[i].active and i not in r.dones]    # type: ignore[union-attr]
        if waiting and not force:
            return
        auth = 0 if 0 in r.dones else min(r.dones)
        res = r.dones[auth]["res"]
        total = r.dones[auth]["sum"]
        for i, d in r.dones.items():
            if d["sum"] != total:
                r.desync += 1
                r.out(("seat", i), {"k": "desync", "r": r.round, "t": 0})
        done_round = r.round
        r.results.append(res)
        r.out("all", {"k": "result", "r": done_round, "res": res, "humans": r.humans, "authority": auth})
        r.round += 1
        r.ready = set()
        r.ready_since = 0.0
        r.dones = {}
        r.first_done = 0.0
        if r.round >= len(r.events):
            r.status = "ended"
            r.phase = "ended"
            self.s.emit("pokeathlon.room_ended", {"room": r.id})
        else:
            r.phase = "intro"
        r.out("all", self._room_msg(r))

    def _tick(self, r: PkRoom, now: float) -> None:
        """What the watchdog does every half second: drop the connections that did not come back, kick the stalled, wait no longer."""
        for seat in [s for s in r.seats if s]:
            if seat.active and not r.sockets[seat.idx] and seat.dropped_at and now - seat.dropped_at > GRACE:
                if r.status == "waiting":
                    if seat.idx > 0:
                        r.seats[seat.idx] = None
                        r.out("all", self._room_msg(r))
                elif r.status == "live":
                    self._takeover(r, seat.idx, "dropped")
        if r.status != "live":
            return
        if r.phase == "play":
            for i in list(r.humans):
                seat = r.seats[i]
                if seat and seat.active and i not in r.dones and now - seat.last_frame > STALL:
                    self._takeover(r, i, "slow")
            if r.first_done and now - r.first_done > DONE_WAIT:
                self._maybe_finish(r, force=True)
        elif r.phase == "intro" and r.ready and r.ready_since and now - r.ready_since > READY_WAIT:
            for i in r.active():
                if i not in r.ready:
                    self._takeover(r, i, "slow")
            self._maybe_go(r)

    def _on_message(self, r: PkRoom, seat: int, role: str, msg: dict[str, Any], ws: Any) -> None:
        k = msg.get("k")
        now = time.time()
        r.touched = now
        me = r.seats[seat] if 0 <= seat < 4 else None
        if k == "ping":
            r.out(("ws", ws), {"k": "pong", "t": msg.get("t")})
            return
        if k == "start" and role == "seat" and seat == 0:
            try:
                self._start(r)
            except SilverError as e:
                r.out(("ws", ws), {"k": "error", "error": e.message})
            return
        if me is None or not me.active:
            return
        rnd = int(msg.get("r") or 0)
        if k == "ready":
            if rnd == r.round and r.phase == "intro":
                if not r.ready:
                    r.ready_since = now
                r.ready.add(seat)
                r.out("all", {"k": "ready", "r": rnd, "seats": sorted(r.ready)})
                self._maybe_go(r)
        elif k == "in":
            if rnd != r.round or r.phase != "play" or seat not in r.humans or seat in r.dones:
                return
            start = int(msg.get("from") or 0)
            mine = r.frames[seat]
            fresh = []
            for i, f in enumerate(msg.get("frames") or []):
                if i >= MAX_FRAMES_PER_MSG:
                    break
                if start + i == len(mine) + 1 and isinstance(f, dict) and len(json.dumps(f)) <= MAX_FRAME_JSON and len(mine) < MAX_TICKS:
                    mine.append(f)
                    fresh.append(f)
            if fresh:
                me.last_frame = now
                r.out(("except", seat), {"k": "in", "r": rnd, "seat": seat, "from": len(mine) - len(fresh) + 1, "frames": fresh})
        elif k == "done":
            if rnd != r.round or r.phase != "play" or seat not in r.humans or seat in r.dones:
                return
            r.dones[seat] = {"res": _clean_result(msg.get("res")), "sum": str(msg.get("sum") or "")[:40]}
            r.first_done = r.first_done or now
            self._maybe_finish(r)
        elif k == "hash":
            if rnd != r.round or r.phase != "play":
                return
            tick = int(msg.get("t") or 0)
            seen = r.hashes.setdefault(tick, {})
            seen[seat] = str(msg.get("h") or "")[:40]
            if len(seen) >= len([i for i in r.humans if r.seats[i] and r.seats[i].active]) and len(set(seen.values())) > 1:    # type: ignore[union-attr]
                r.desync = r.desync or tick
                r.out("players", {"k": "desync", "r": rnd, "t": tick})
            for old in [t for t in r.hashes if t < tick - 600]:
                r.hashes.pop(old, None)
        elif k == "leave":
            if r.status == "waiting":
                if seat > 0:                       # a friend who changes their mind frees the team; the host stays
                    r.seats[seat] = None
                    r.out("all", self._room_msg(r))
            else:
                self._takeover(r, seat, "left")

    def _hello(self, r: PkRoom, seat: int, role: str) -> dict[str, Any]:
        out: dict[str, Any] = {"k": "hello", "seat": seat, "role": role, "delay": DELAY, "room": self.view(r), "round": r.round, "phase": r.phase,
                               "humans": list(r.humans), "ready": sorted(r.ready), "results": r.results,
                               "frames": r.frames if r.phase == "play" else [[], [], [], []], "have": [len(f) for f in r.frames],
                               "active": r.active()}
        if r.teams:
            out.update(self._config(r))
        return out

    # ------------------------------------------------------------ sending (on the room server's loop)
    def _targets(self, r: PkRoom, target: Any) -> list[Any]:
        with r.lock:
            if target == "all":
                return [w for g in r.sockets for w in g]
            if target == "players":
                return [w for g in r.sockets[:4] for w in g]
            kind, val = target
            if kind == "seat":
                return list(r.sockets[val])
            if kind == "ws":
                return [val]
            if kind == "except":
                return [w for i, g in enumerate(r.sockets) if i != val for w in g]
        return []

    async def _flush(self, r: PkRoom) -> None:
        if r.alock is None:
            r.alock = asyncio.Lock()
        async with r.alock:
            while True:
                with r.lock:
                    batch, r.outbox = r.outbox, []
                if not batch:
                    return
                for target, msg in batch:
                    text = json.dumps(msg, separators=(",", ":"))
                    for w in self._targets(r, target):
                        try:
                            await w.send_text(text)
                        except Exception:  # noqa: BLE001 - a dead socket is dropped by its own loop
                            pass

    def _kick(self, r: PkRoom) -> None:
        """Send what a tool queued without waiting for the watchdog's next round (when the room server's loop runs)."""
        loop = getattr(self.s.pvp, "_loop", None)
        if loop is not None and loop.is_running():
            asyncio.run_coroutine_threadsafe(self._flush(r), loop)

    async def _watch(self, r: PkRoom) -> None:
        while r.status in ("waiting", "live", "ended") and self.rooms.get(r.id) is r:
            await asyncio.sleep(0.4)
            with r.lock:
                self._tick(r, time.time())
            await self._flush(r)
            if r.status == "ended" and not any(r.sockets):
                break
        r.watcher = None

    async def relay(self, ws: Any, room_id: str, key: str) -> None:
        try:
            r = self._room(room_id)
        except SilverError:
            await ws.close(code=4404)
            return
        role, seat = r.role_of(key)
        if role not in ("seat", "watch") or (role == "watch" and len(r.sockets[WATCH]) >= MAX_WATCH):
            await ws.close(code=4403)
            return
        await ws.accept()
        with r.lock:
            r.sockets[seat].add(ws)
            r.touched = time.time()
            if role == "seat" and r.seats[seat]:
                r.seats[seat].dropped_at = 0.0            # type: ignore[union-attr]
            if r.watcher is None:
                r.watcher = asyncio.ensure_future(self._watch(r))
            hello = self._hello(r, seat, role)
            r.out("all", self._room_msg(r))
        try:
            await ws.send_text(json.dumps(hello, separators=(",", ":")))
            await self._flush(r)
            while True:
                raw = await ws.receive_text()
                try:
                    msg = json.loads(raw)
                except ValueError:
                    continue
                if not isinstance(msg, dict):
                    continue
                with r.lock:
                    self._on_message(r, seat, role, msg, ws)
                await self._flush(r)
        except Exception:  # noqa: BLE001 - a closed socket ends the loop
            pass
        finally:
            with r.lock:
                r.sockets[seat].discard(ws)
                if role == "seat" and r.seats[seat] and not r.sockets[seat]:
                    r.seats[seat].dropped_at = time.time()     # type: ignore[union-attr]
                r.out("all", self._room_msg(r))
            try:
                await self._flush(r)
            except Exception:  # noqa: BLE001
                pass


_GUARD = threading.Lock()


def service(services: "Services") -> PkRooms:
    """The Pokéathlon rooms of a ``Services`` (made on first use, so nothing else has to know about them)."""
    got = getattr(services, "pokeathlon_rooms", None)
    if got is None:
        with _GUARD:
            got = getattr(services, "pokeathlon_rooms", None)
            if got is None:
                got = PkRooms(services)
                services.pokeathlon_rooms = got
    return got
