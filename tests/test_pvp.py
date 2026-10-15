"""Live battles with a friend on another computer (pvp.py): the host's room, the friend's side through the room server only, each
side seeing its own view turn by turn, and the real-time lockstep relay."""
import pytest
from fastapi.testclient import TestClient

from conftest import TEAM, needs_engine
from silvers_hoard.pvp_server import room_app

pytestmark = needs_engine

FRIEND = """Tyranitar @ Leftovers
Ability: Sand Stream
EVs: 252 HP / 252 Atk / 4 SpD
Adamant Nature
- Stone Edge
- Crunch
- Earthquake
- Stealth Rock
"""


@pytest.fixture
def rooms(services):
    with TestClient(room_app(services), base_url="http://192.168.1.20:5240") as c:
        yield c


def test_turn_by_turn_room(call, rooms, services):
    me = call("trainer_create", {"name": "Luis", "paste": TEAM})
    room = call("pvp_open", {"trainer_id": me["id"], "format": "gen9customgame"})
    assert room["status"] == "waiting" and room["links"]["path"].startswith(f"/r/{room['id']}?k=")
    key = room["links"]["path"].split("k=")[1]
    assert key != room["host_key"]
    # the friend's page and API need the link's key; the host's key or none is refused
    assert rooms.get(f"/api/room/{room['id']}", params={"k": "nope"}).status_code == 403
    assert rooms.get("/r/" + room["id"], params={"k": room["host_key"]}).status_code == 403
    page = rooms.get(room["links"]["path"])
    if page.status_code == 200:               # the page template exists once the client is built
        assert '"kind":"room"' in page.text.replace(" ", "") or "silver-data" in page.text
    # the room server only knows rooms: none of the app's routes is there
    assert rooms.post("/api/ui/call", json={"name": "settings_get", "arguments": {}}).status_code == 404
    bad = rooms.post(f"/api/room/{room['id']}/join", json={"k": key, "name": "Ana", "paste": "Missingnoo\n- Tackle\n"})
    assert bad.status_code == 400
    joined = rooms.post(f"/api/room/{room['id']}/join", json={"k": key, "name": "Ana", "paste": FRIEND}).json()
    assert joined["status"] == "ready" and joined["guest"]["species"] == ["Tyranitar"]
    assert call("pvp_get", {"room": room["id"]})["guest"]["name"] == "Ana"
    started = call("pvp_start", {"room": room["id"]})
    bid = started["battle"]["id"]
    assert started["status"] == "live" and started["battle"]["p2"]["remote"] is True and started["battle"]["kind"] == "pvp"
    call("pvp_start", {"room": room["id"]}, status=409)
    # each side sees its own view: the host does not get the friend's request, the friend gets only theirs
    host = call("battle_get", {"id": bid})
    assert "p2" not in host["requests"] and "p1" in host["requests"]
    st = rooms.get(f"/api/room/{room['id']}", params={"k": key}).json()
    req = st["battle"]["request"]
    assert req and req["side"]["id"] == "p2" and req["side"]["pokemon"][0]["details"].startswith("Tyranitar")
    assert not any("Garchomp" in str(p) for p in (req.get("side") or {}).get("pokemon", []))
    # the host cannot play the friend's side
    call("battle_choose", {"id": bid, "side": "p2", "choice": "team 1"}, status=403)
    # team preview, then a turn: the host chooses here, the friend through the room; the turn only runs once both have chosen
    call("battle_choose", {"id": bid, "side": "p1", "choice": "team 12"})
    st = rooms.post(f"/api/room/{room['id']}/choose", json={"k": key, "choice": "team 1", "since": st["battle"]["log_length"]}).json()
    call("battle_choose", {"id": bid, "side": "p1", "choice": "move 1"})
    assert call("battle_get", {"id": bid})["turn"] == 1
    after = rooms.post(f"/api/room/{room['id']}/choose", json={"k": key, "choice": "move 1", "since": st["battle"]["log_length"]}).json()
    assert after["battle"]["turn"] >= 2 or after["battle"]["status"] == "ended"
    assert any("|move|p2a: Tyranitar|" in l for l in after["battle"]["lines"])
    # the friend gives up: the host wins, the room ends
    out = rooms.post(f"/api/room/{room['id']}/forfeit", json={"k": key}).json()
    assert out["battle"]["status"] == "ended" and out["battle"]["winner_side"] == "p1"
    assert call("pvp_get", {"room": room["id"]})["status"] == "ended"
    assert call("trainer_get", {"id": me["id"]})["record"]["wins"] == 1
    assert call("pvp_close", {"room": room["id"]})["closed"] == room["id"]
    call("pvp_get", {"room": room["id"]}, status=404)


def test_real_time_lockstep_relay(call, rooms):
    me = call("trainer_create", {"name": "Luis", "paste": TEAM})
    room = call("pvp_open", {"trainer_id": me["id"], "mode": "realtime", "rt_arena": "open", "time_limit": 60})
    key = room["links"]["path"].split("k=")[1]
    rooms.post(f"/api/room/{room['id']}/join", json={"k": key, "name": "Ana", "paste": FRIEND})
    started = call("pvp_start", {"room": room["id"]})
    assert started["battle"]["rt"]["human"] == [True, True]
    st = rooms.get(f"/api/room/{room['id']}", params={"k": key}).json()
    assert st["battle"]["rt"]["spec"]["seed"] == started["battle"]["rt"]["spec"]["seed"]
    with rooms.websocket_connect(f"/api/room/{room['id']}/ws?k={room['host_key']}") as host, \
            rooms.websocket_connect(f"/api/room/{room['id']}/ws?k={key}") as guest:
        assert host.receive_json()["seat"] == 0
        hello = guest.receive_json()
        assert hello["seat"] == 1 and hello["peer"] is True and hello["delay"] >= 1
        assert host.receive_json() == {"k": "peer", "on": True}
        host.send_json({"k": "in", "from": 1, "frames": [[0.5, 0, -1, 0, -1, 1, 0, 0], [0.5, 0, 0, 0, -1, 1, 0, 0]]})
        got = guest.receive_json()
        assert got == {"k": "in", "from": 1, "frames": [[0.5, 0, -1, 0, -1, 1, 0, 0], [0.5, 0, 0, 0, -1, 1, 0, 0]]}
        # a resend of ticks already in is dropped; the next tick goes through
        host.send_json({"k": "in", "from": 2, "frames": [[0.5, 0, 0, 0, -1, 1, 0, 0], [0, 0, -1, 0, -1, 1, 0, 0]]})
        assert guest.receive_json() == {"k": "in", "from": 3, "frames": [[0, 0, -1, 0, -1, 1, 0, 0]]}
        # both screens report a hash of the battle: a difference is a desync, said to both
        host.send_json({"k": "hash", "t": 30, "h": "aaa"})
        guest.send_json({"k": "hash", "t": 30, "h": "bbb"})
        assert host.receive_json() == {"k": "desync", "t": 30}
        assert guest.receive_json() == {"k": "desync", "t": 30}
        guest.send_json({"k": "ff"})
        assert host.receive_json() == {"k": "ff", "side": "p2"}
    # a screen that reconnects gets every frame sent so far
    with rooms.websocket_connect(f"/api/room/{room['id']}/ws?k={key}") as guest:
        again = guest.receive_json()
        assert len(again["frames"][0]) == 3 and again["frames"][1] == []
    assert call("pvp_get", {"room": room["id"]})["desync"] == 30


def test_room_checks(call):
    me = call("trainer_create", {"name": "Luis", "paste": TEAM})
    call("pvp_open", {"trainer_id": me["id"], "mode": "turns"}, status=400)
    empty = call("trainer_create", {"name": "Nadie"})
    call("pvp_open", {"trainer_id": empty["id"]}, status=400)
    room = call("pvp_open", {"trainer_id": me["id"]})
    call("pvp_start", {"room": room["id"]}, status=409)            # nobody joined
    assert any(r["id"] == room["id"] for r in call("pvp_get", {})["rooms"])
    call("settings_set", {"pvp_public_url": "https://silver.example.net"})
    assert call("pvp_get", {"room": room["id"]})["links"]["public"].startswith("https://silver.example.net/r/")
    call("settings_set", {"pvp_public_url": "not a url"}, status=400)
