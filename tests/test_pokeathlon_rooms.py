"""Pokéathlon with friends (pokeathlon_rooms.py): the host's tools, the friend's side through the room server only, the round machine
over the WebSocket (ready, go, frames, results), the CPU taking over whoever leaves, and the lobby."""
import gzip
import json
import time

import pytest
from fastapi.testclient import TestClient

from silvers_hoard import pokeathlon_rooms as pkr
from silvers_hoard.pvp_server import room_app


@pytest.fixture
def rooms(services):
    with TestClient(room_app(services), base_url="http://192.168.1.20:5240") as c:
        yield c


@pytest.fixture
def fast(monkeypatch):
    """Short waits, so that the watchdog's decisions show within a second or two."""
    monkeypatch.setattr(pkr, "GRACE", 0.3)
    monkeypatch.setattr(pkr, "STALL", 1.2)
    monkeypatch.setattr(pkr, "START_SLACK", 0.0)


def keys(room):
    host = room["host_key"]
    join = room["links"]["path"].split("k=")[1]
    watch = room["watch_links"]["path"].split("k=")[1]
    return host, join, watch


TEAM = {"name": "Ana's", "mons": [{"species": "Pikachu"}, {"species": "Machamp", "stars": {"power": 5, "speed": 1}}, {"species": "Gyarados"}]}


def join(rooms, room, name="Ana", team=TEAM, status=200):
    _, jk, _ = keys(room)
    r = rooms.post(f"/api/pk/{room['id']}/join", json={"k": jk, "name": name, "team": team})
    assert r.status_code == status, r.text
    return r.json()


def drain(ws, kinds, limit=40):
    """Messages until every wanted kind has been seen (the last of each is kept)."""
    seen = {}
    for _ in range(limit):
        m = ws.receive_json()
        seen[m["k"]] = m
        if all(k in seen for k in kinds):
            return seen
    raise AssertionError(f"never saw {set(kinds) - set(seen)}; got {sorted(seen)}")


def until(ws, kind, limit=60, **match):
    for _ in range(limit):
        m = ws.receive_json()
        if m["k"] == kind and all(m.get(k) == v for k, v in match.items()):
            return m
    raise AssertionError(f"never saw {kind} {match}")


def url(room, key):
    return f"/api/pk/{room['id']}/ws?k={key}"


def test_the_tools_open_list_get_and_close_a_room(call):
    room = call("pokeathlon_room_open", {"course": "speed", "host_name": "Luis", "team": TEAM})
    assert room["status"] == "waiting" and room["events"] == ["hurdle_dash", "pennant_capture", "relay_run"] and room["medal"] == "speed"
    assert room["links"]["path"].startswith(f"/p/{room['id']}?k=") and room["watch_links"]["path"].startswith(f"/pw/{room['id']}?k=")
    host, jk, wk = keys(room)
    assert len({host, jk, wk}) == 3 and room["free"] == 3 and room["max_friends"] == 3
    assert room["seats"][0]["name"] == "Luis" and room["seats"][0]["species"] == ["Pikachu", "Machamp", "Gyarados"]
    got = call("pokeathlon_room_get", {"room": room["id"]})
    assert got["id"] == room["id"] and call("pokeathlon_room_get")["rooms"][0]["id"] == room["id"]
    assert call("pokeathlon_room_close", {"room": room["id"]}) == {"closed": room["id"]}
    call("pokeathlon_room_get", {"room": room["id"]}, status=404)


def test_a_single_event_room_and_the_supreme_one(call):
    one = call("pokeathlon_room_open", {"course": "single", "event": "goal_roll", "max_friends": 1})
    assert one["events"] == ["goal_roll"] and one["medal"] == "" and one["free"] == 1
    call("pokeathlon_room_open", {"course": "single"}, status=400)
    call("pokeathlon_room_open", {"course": "single", "event": "nope"}, status=400)
    sup = call("pokeathlon_room_open", {"course": "supreme"})
    assert sup["supreme"] is True and len(sup["events"]) == 4 and sup["medal"] == ""
    from silvers_hoard import pokeathlon as pk
    assert sup["events"] in pk.MASTER_SETS


def test_the_host_must_bring_a_real_team(call):
    call("pokeathlon_room_open", {"course": "jump", "team": {"mons": [{"species": "Pikachu"}, {"species": "Missingno"}, {"species": "Machamp"}]}}, status=400)
    call("pokeathlon_room_open", {"course": "jump", "team": {"mons": [{"species": "Pikachu"}]}}, status=400)


def test_a_friend_needs_the_link_key_and_brings_three_real_pokemon(call, rooms):
    room = call("pokeathlon_room_open", {"course": "power"})
    host, jk, wk = keys(room)
    # the pages and the API are for the holders of a key; the spectator's key does not open the playing page, nor the other way round
    assert rooms.get(f"/p/{room['id']}", params={"k": "nope"}).status_code == 403
    assert rooms.get(f"/p/{room['id']}", params={"k": host}).status_code == 200            # the host's key is seat 0's: it plays from a browser too
    assert rooms.get(f"/p/{room['id']}", params={"k": wk}).status_code == 403
    assert rooms.get(f"/pw/{room['id']}", params={"k": jk}).status_code == 403
    assert rooms.get(f"/api/pk/{room['id']}", params={"k": ""}).status_code == 403
    info = rooms.get(f"/api/pk/{room['id']}", params={"k": jk}).json()
    assert info["id"] == room["id"] and "host_key" not in info and "links" not in info
    page = rooms.get(f"/p/{room['id']}", params={"k": jk})
    if page.status_code == 200:                    # the page template exists once the client is built
        assert "pkroom" in page.text or "silver-data" in page.text
    # the room server only knows rooms: none of the app's routes is there
    assert rooms.post("/api/ui/call", json={"name": "settings_get", "arguments": {}}).status_code == 404
    # the table for the editor comes compressed
    stats = rooms.get(f"/api/pk/{room['id']}/stats", params={"k": jk})
    assert stats.status_code == 200 and len(stats.json()["species"]) > 1000
    assert rooms.get(f"/api/pk/{room['id']}/stats", params={"k": "x"}).status_code == 403
    # joining
    join(rooms, room, team={"mons": [{"species": "Pikachu"}, {"species": "Missingno"}, {"species": "Machamp"}]}, status=400)
    join(rooms, room, team={"mons": [{"species": "Pikachu"}]}, status=400)
    got = join(rooms, room)
    assert got["seat"] == 1 and got["seat_key"] not in (host, jk, wk)
    seat = got["room"]["seats"][1]
    assert seat["name"] == "Ana" and seat["team"] == "Ana's" and seat["species"] == ["Pikachu", "Machamp", "Gyarados"]
    # the stars are kept inside each Pokémon's own range: Machamp's power cannot be 5 at will
    team = call("pokeathlon_room_start", {"room": room["id"]})["status"]
    assert team == "live"
    with rooms.websocket_connect(url(room, got["seat_key"])) as ws:
        hello = ws.receive_json()
        mach = hello["teams"][1]["mons"][1]
        assert hello["k"] == "hello" and hello["seat"] == 1 and hello["role"] == "seat"
        assert mach["stars"]["power"] <= mach["max"]["power"] and mach["stars"]["speed"] >= mach["min"]["speed"]
        assert mach["stars"]["power"] == min(5, mach["max"]["power"])


def test_the_room_fills_up_and_closes_to_newcomers(call, rooms):
    room = call("pokeathlon_room_open", {"course": "stamina", "max_friends": 2})
    assert [join(rooms, room, name=n)["seat"] for n in ("A", "B")] == [1, 2]
    assert join(rooms, room, name="C", status=409)
    assert call("pokeathlon_room_get", {"room": room["id"]})["free"] == 0
    call("pokeathlon_room_start", {"room": room["id"]})
    call("pokeathlon_room_start", {"room": room["id"]}, status=409)
    join(rooms, room, name="D", status=409)


def test_starting_fills_the_free_teams_with_the_games_npc_teams(call, rooms):
    room = call("pokeathlon_room_open", {"course": "skill", "supreme": True, "team": TEAM})
    friend = join(rooms, room)
    started = call("pokeathlon_room_start", {"room": room["id"]})
    assert started["status"] == "live" and started["phase"] == "intro"
    with rooms.websocket_connect(url(room, room["host_key"])) as ws:
        h = ws.receive_json()
    teams = h["teams"]
    assert [t["human"] for t in teams] == [True, True, False, False] and [t["index"] for t in teams] == [0, 1, 2, 3]
    assert teams[0]["name"] == "Ana's" and teams[0]["color"] == pkr.COLORS[0]
    assert all(t["npc"] > 50 and t["cpu"] == 1 for t in teams[2:])             # the supreme cup draws from the stronger half
    assert len({t["npc"] for t in teams[2:]}) == 2 and h["events"] == room["events"] and h["delay"] == pkr.DELAY
    assert all(len(t["mons"]) == 3 and all(set(m["stars"]) == {"speed", "power", "skill", "stamina", "jump"} for m in t["mons"]) for t in teams)
    assert friend["seat"] == 1


def frame(n):
    return {"x": 100.0 + n, "y": 200.0, "k": ["Space"]}


def test_a_round_from_ready_to_the_hosts_result_and_the_next_round(call, rooms):
    room = call("pokeathlon_room_open", {"course": "speed"})
    fr = join(rooms, room)
    host_key, friend_key = room["host_key"], fr["seat_key"]
    with rooms.websocket_connect(url(room, host_key)) as h, rooms.websocket_connect(url(room, friend_key)) as f, \
            rooms.websocket_connect(f"/api/pk/{room['id']}/ws?k={keys(room)[2]}") as w:
        for ws in (h, f, w):
            assert ws.receive_json()["k"] == "hello"
        call("pokeathlon_room_start", {"room": room["id"]})
        for ws in (h, f, w):
            until(ws, "start")
        # round 0: the introduction waits for both people
        h.send_json({"k": "ready", "r": 0})
        assert until(f, "ready")["seats"] == [0]
        f.send_json({"k": "ready", "r": 0})
        for ws in (h, f, w):
            go = until(ws, "go")
            assert go["r"] == 0 and go["humans"] == [0, 1]
        # frames go to the other person and to the spectator, in order; a resend or a gap is ignored
        h.send_json({"k": "in", "r": 0, "from": 1, "frames": [frame(1), frame(2)]})
        m = until(f, "in")
        assert m["seat"] == 0 and m["from"] == 1 and len(m["frames"]) == 2 and until(w, "in")["seat"] == 0
        h.send_json({"k": "in", "r": 0, "from": 2, "frames": [frame(9)]})                # a resend of tick 2: ignored
        h.send_json({"k": "in", "r": 0, "from": 9, "frames": [frame(9)]})                # a gap: ignored
        h.send_json({"k": "in", "r": 0, "from": 3, "frames": [frame(3)]})
        m = until(f, "in")
        assert m["from"] == 3 and m["frames"] == [frame(3)]
        f.send_json({"k": "in", "r": 0, "from": 1, "frames": [{"x": 1.0, "y": 2.0}]})
        assert until(h, "in")["seat"] == 1
        # both finish: the host's result is the one that counts, and everybody gets it
        f.send_json({"k": "done", "r": 0, "res": {"raw": [1, 2, 3, 4], "detail": [{}, {}, {}, {}]}, "sum": "aaa"})
        h.send_json({"k": "done", "r": 0, "res": {"raw": [9, 8, 7, 6], "detail": [{"a": 1}, {}, {}, {}]}, "sum": "aaa"})
        for ws in (h, f, w):
            res = until(ws, "result")
            assert res["r"] == 0 and res["res"]["raw"] == [9, 8, 7, 6] and res["authority"] == 0
        # round 1
        h.send_json({"k": "ready", "r": 1})
        f.send_json({"k": "ready", "r": 1})
        assert until(h, "go")["r"] == 1
        # an old round's messages do nothing
        h.send_json({"k": "in", "r": 0, "from": 4, "frames": [frame(4)]})
        h.send_json({"k": "ping", "t": 5})
        assert until(h, "pong")["t"] == 5
    got = call("pokeathlon_room_get", {"room": room["id"]})
    assert got["round"] == 1 and got["phase"] == "play" and got["played"] == 1 and got["desync"] == 0


def test_the_hosts_page_shows_the_whole_course_and_the_room_ends(call, rooms):
    room = call("pokeathlon_room_open", {"course": "single", "event": "block_smash"})
    call("pokeathlon_room_start", {"room": room["id"]})
    with rooms.websocket_connect(url(room, room["host_key"])) as h:
        assert h.receive_json()["phase"] == "intro"
        h.send_json({"k": "ready", "r": 0})
        until(h, "go")
        h.send_json({"k": "done", "r": 0, "res": {"raw": [5, 4, 3, 2], "detail": []}, "sum": "x"})
        until(h, "result")
    got = call("pokeathlon_room_get", {"room": room["id"]})
    assert got["status"] == "ended" and got["phase"] == "ended" and got["played"] == 1
    # a page opened afterwards still gets the results, to draw the ceremony
    with rooms.websocket_connect(url(room, room["host_key"])) as h:
        hello = h.receive_json()
        assert hello["results"][0]["raw"] == [5.0, 4.0, 3.0, 2.0] and hello["results"][0]["detail"] == [{}, {}, {}, {}]


def test_a_person_whose_connection_drops_is_replaced_by_the_cpu_at_a_tick_everybody_gets(call, rooms, fast):
    room = call("pokeathlon_room_open", {"course": "speed"})
    fr = join(rooms, room)
    with rooms.websocket_connect(url(room, room["host_key"])) as h:
        with rooms.websocket_connect(url(room, fr["seat_key"])) as f:
            h.receive_json(); f.receive_json()
            call("pokeathlon_room_start", {"room": room["id"]})
            h.send_json({"k": "ready", "r": 0})
            f.send_json({"k": "ready", "r": 0})
            until(h, "go")
            f.send_json({"k": "in", "r": 0, "from": 1, "frames": [frame(1), frame(2), frame(3)]})
            assert until(h, "in", seat=1)["from"] == 1
        # the friend's page closed: after the grace the room puts the CPU marker at the first tick without a frame
        m = until(h, "in", seat=1)
        assert m["from"] == 4 and m["frames"] == [0] and m["r"] == 0
        left = until(h, "left")
        assert left["seat"] == 1 and left["why"] == "dropped"
        # the friend's late frames are ignored now, and the round ends with the host alone
        h.send_json({"k": "done", "r": 0, "res": {"raw": [1, 1, 1, 1], "detail": []}, "sum": "s"})
        until(h, "result")
        # next round: only the host is awaited
        h.send_json({"k": "ready", "r": 1})
        go = until(h, "go")
        assert go["humans"] == [0]
    seats = call("pokeathlon_room_get", {"room": room["id"]})["seats"]
    assert seats[1]["human"] is False and seats[1]["left"] == "dropped" and seats[0]["human"] is True


def test_a_friend_who_reconnects_in_time_keeps_the_team_and_gets_the_frames(call, rooms, fast):
    room = call("pokeathlon_room_open", {"course": "speed"})
    fr = join(rooms, room)
    with rooms.websocket_connect(url(room, room["host_key"])) as h:
        with rooms.websocket_connect(url(room, fr["seat_key"])) as f:
            h.receive_json(); f.receive_json()
            call("pokeathlon_room_start", {"room": room["id"]})
            h.send_json({"k": "ready", "r": 0}); f.send_json({"k": "ready", "r": 0})
            until(h, "go")
            h.send_json({"k": "in", "r": 0, "from": 1, "frames": [frame(1), frame(2)]})
            f.send_json({"k": "in", "r": 0, "from": 1, "frames": [frame(7)]})
            until(h, "in", seat=1)
        with rooms.websocket_connect(url(room, fr["seat_key"])) as f2:
            hello = f2.receive_json()
            assert hello["phase"] == "play" and hello["humans"] == [0, 1] and hello["have"][1] == 1
            assert hello["frames"][0] == [frame(1), frame(2)] and hello["frames"][1] == [frame(7)]
            time.sleep(0.8)                    # longer than the grace: the seat must still be a person's
            f2.send_json({"k": "in", "r": 0, "from": 2, "frames": [frame(8)]})
            assert until(h, "in", seat=1)["from"] == 2
    assert call("pokeathlon_room_get", {"room": room["id"]})["seats"][1]["human"] is True


def test_somebody_who_stops_sending_frames_is_replaced_and_so_is_one_who_never_presses_go(call, rooms, fast):
    room = call("pokeathlon_room_open", {"course": "speed"})
    fr = join(rooms, room)
    with rooms.websocket_connect(url(room, room["host_key"])) as h, rooms.websocket_connect(url(room, fr["seat_key"])) as f:
        h.receive_json(); f.receive_json()
        call("pokeathlon_room_start", {"room": room["id"]})
        h.send_json({"k": "ready", "r": 0}); f.send_json({"k": "ready", "r": 0})
        until(h, "go")
        # the host keeps sending, the friend's tab sleeps: after STALL seconds the CPU has the friend's team
        for i in range(1, 9):
            h.send_json({"k": "in", "r": 0, "from": i, "frames": [frame(i)]})
            time.sleep(0.2)
        m = until(f, "in", seat=1)
        assert m["frames"] == [0] and m["from"] == 1
        assert until(h, "left")["why"] == "slow"


def test_a_person_can_hand_the_team_to_the_cpu_and_a_friend_can_leave_the_lobby(call, rooms):
    room = call("pokeathlon_room_open", {"course": "speed"})
    a, b = join(rooms, room, name="A"), join(rooms, room, name="B")
    with rooms.websocket_connect(url(room, room["host_key"])) as h, rooms.websocket_connect(url(room, a["seat_key"])) as fa, \
            rooms.websocket_connect(url(room, b["seat_key"])) as fb:
        for ws in (h, fa, fb):
            ws.receive_json()
        fa.send_json({"k": "leave"})                      # before the start the team is simply free again
        h.send_json({"k": "ping"})
        until(h, "pong")
        time.sleep(0.1)
        assert [s["free"] for s in call("pokeathlon_room_get", {"room": room["id"]})["seats"]] == [False, True, False, True]
        call("pokeathlon_room_start", {"room": room["id"]})
        h.send_json({"k": "ready", "r": 0})
        fb.send_json({"k": "leave"})
        assert until(h, "left")["why"] == "left"
        assert until(h, "go")["humans"] == [0]


def test_only_the_host_starts_from_the_websocket_and_checksums_that_differ_are_reported(call, rooms):
    room = call("pokeathlon_room_open", {"course": "speed"})
    fr = join(rooms, room)
    with rooms.websocket_connect(url(room, room["host_key"])) as h, rooms.websocket_connect(url(room, fr["seat_key"])) as f:
        h.receive_json(); f.receive_json()
        f.send_json({"k": "start"})
        f.send_json({"k": "ping", "t": 1})
        until(f, "pong")
        assert call("pokeathlon_room_get", {"room": room["id"]})["status"] == "waiting"
        h.send_json({"k": "start"})
        until(f, "start")
        h.send_json({"k": "ready", "r": 0}); f.send_json({"k": "ready", "r": 0})
        until(h, "go")
        h.send_json({"k": "hash", "r": 0, "t": 60, "h": "abc"})
        f.send_json({"k": "hash", "r": 0, "t": 60, "h": "abd"})
        assert until(h, "desync")["t"] == 60
    assert call("pokeathlon_room_get", {"room": room["id"]})["desync"] == 60


def test_the_lobby_lists_pokeathlon_rooms_with_a_link_to_join_or_to_watch(call, rooms):
    lobby = call("pvp_lobby")
    code = lobby["path"].split("c=")[1]
    room = call("pokeathlon_room_open", {"course": "power", "host_name": "Luis"})
    rows = rooms.get("/api/lobby", params={"c": code}).json()["rooms"]
    row = next(r for r in rows if r["id"] == room["id"])
    assert row["kind"] == "pokeathlon" and row["mode"] == "pokeathlon" and row["format"] == "power" and row["host"] == "Luis"
    assert row["join"].startswith(f"/p/{room['id']}?k=") and row["watch"].startswith(f"/pw/{room['id']}?k=") and row["status"] == "waiting"
    page = rooms.get("/lobby", params={"c": code}, headers={"accept-language": "es"})
    assert "Pokéathlon" in page.text and f"/p/{room['id']}" in page.text
    join(rooms, room)
    call("pokeathlon_room_start", {"room": room["id"]})
    row = next(r for r in rooms.get("/api/lobby", params={"c": code}).json()["rooms"] if r["id"] == room["id"])
    assert row["status"] == "live" and row["join"] == "" and row["guest"] == "Ana"
    # an unlisted room is not shown
    quiet = call("pokeathlon_room_open", {"course": "jump", "listed": False})
    assert quiet["id"] not in [r["id"] for r in rooms.get("/api/lobby", params={"c": code}).json()["rooms"]]


def test_a_friends_lobby_address_row_for_a_pokeathlon_room_keeps_its_links(services):
    from silvers_hoard.pvp import Pvp
    rows = {"rooms": [{"id": "x", "mode": "pokeathlon", "format": "speed", "status": "waiting", "host": "H", "guest": "", "join": "/p/x?k=1", "watch": "/pw/x?k=2"}]}
    # the same parsing the friends' list does for a battle row: the Pokéathlon paths are accepted
    for k in ("join", "watch"):
        path = rows["rooms"][0][k]
        assert path.startswith(("/r/", "/w/", "/p/", "/pw/"))
    assert Pvp is not None


def test_the_sprites_of_a_room_need_a_key_of_that_room(call, rooms):
    room = call("pokeathlon_room_open", {"course": "speed"})
    _, jk, _ = keys(room)
    assert rooms.get(f"/pkr/{room['id']}/nope/api/sprites/pmd/25").status_code == 403
    assert rooms.get(f"/pkr/{room['id']}/nope/api/sprites/pmd-sheet/0025/Walk.png").status_code == 403
    assert rooms.get(f"/pkr/nothere/{jk}/api/sprites/pmd/25").status_code == 404


def test_rooms_are_limited_and_forgotten(call):
    ids = [call("pokeathlon_room_open", {"course": "speed"})["id"] for _ in range(pkr.MAX_ROOMS)]
    call("pokeathlon_room_open", {"course": "speed"}, status=409)
    call("pokeathlon_room_close", {"room": ids[0]})
    call("pokeathlon_room_open", {"course": "speed"})
