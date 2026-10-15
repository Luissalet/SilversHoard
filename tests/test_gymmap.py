"""Gym maps: the room you walk through to the leader, checked when saved, carried by exports, and walked in a challenge where whoever
sees you is the next battle and the leader waits for every trainer."""

import json

from conftest import TEAM, needs_engine

from silvers_hoard import gymmap
from silvers_hoard.errors import SilverError


def _err(m, ids):
    try:
        gymmap.clean(m, ids)
    except SilverError as e:
        return e.message
    raise AssertionError("no error")


def test_the_automatic_map_is_valid_and_the_checks_say_what_is_wrong():
    for n in range(0, 21):
        m = gymmap.generate([f"t{i}" for i in range(n)], seed="x")
        assert len(m["trainers"]) == n and len(m["tiles"]) == m["w"] * m["h"]
    m = gymmap.generate(["a", "b"], seed="y")
    assert "not on the map" in _err(m, ["a", "b", "c"])
    walled = {**m, "tiles": m["tiles"][: m["w"]] + "#" * m["w"] * (m["h"] - 2) + m["tiles"][-m["w"]:]}
    assert "stands on a wall" in _err(walled, ["a", "b"])
    lx, ly = m["leader"]["x"], m["leader"]["y"]
    tiles = list(m["tiles"])
    for dx, dy in ((0, 1), (0, -1), (1, 0), (-1, 0)):
        tiles[(ly + dy) * m["w"] + lx + dx] = "~"
    assert "no way from the entrance to the leader" in _err({**m, "tiles": "".join(tiles)}, ["a", "b"])
    assert "outside" in _err({**m, "start": [99, 1]}, ["a", "b"])
    assert gymmap.clean({}, ["a"]) == {}


def test_a_gym_keeps_its_map_and_takes_it_along(call, client):
    leader = call("trainer_create", {"name": "Erika", "paste": TEAM})
    t1 = call("trainer_create", {"name": "Uno", "paste": TEAM})
    t2 = call("trainer_create", {"name": "Dos", "paste": TEAM})
    m = call("gym_map_generate", {"trainer_ids": [t1["id"], t2["id"]], "seed": "1"})["map"]
    g = call("gym_save", {"name": "Gimnasio Azulona", "leader_id": leader["id"], "trainers": [t1["id"], t2["id"]], "map": m})
    assert g["map"]["w"] == m["w"] and {x["id"] for x in g["map"]["trainers"]} == {t1["id"], t2["id"]}
    bad = {**m, "trainers": m["trainers"][:1]}
    assert "not on the map" in call("gym_save", {"id": g["id"], "map": bad}, status=400)["error"]
    f = call("export", {"kind": "gym", "id": g["id"], "fmt": "file"})
    raw = client.get(f["url"]).content
    assert {x["id"] for x in json.loads(raw)["gym"]["map"]["trainers"]} == {0, 1}
    back = client.post("/api/import/upload", files={"file": (f["file"], raw, "application/json")}).json()["gym"]
    assert back["map"]["w"] == m["w"] and {x["id"] for x in back["map"]["trainers"]} == set(back["trainers"])
    # a gym trainer more: the old map no longer holds everybody, so it goes
    t3 = call("trainer_create", {"name": "Tres", "paste": TEAM})
    assert call("gym_save", {"id": g["id"], "trainers": [t1["id"], t2["id"], t3["id"]]})["map"] == {}


@needs_engine
def test_walking_the_map_fights_whoever_you_meet_and_the_leader_last(call):
    me = call("trainer_create", {"name": "Luis", "paste": TEAM})
    leader = call("trainer_create", {"name": "Erika", "paste": TEAM, "ai_level": "easy"})
    t1 = call("trainer_create", {"name": "Uno", "paste": TEAM, "ai_level": "easy"})
    t2 = call("trainer_create", {"name": "Dos", "paste": TEAM, "ai_level": "easy"})
    m = call("gym_map_generate", {"trainer_ids": [t1["id"], t2["id"]], "seed": "2"})["map"]
    g = call("gym_save", {"name": "Gimnasio Azulona", "leader_id": leader["id"], "trainers": [t1["id"], t2["id"]], "map": m})
    r = call("challenge_start", {"kind": "gym", "target_id": g["id"], "challenger_id": me["id"]})
    assert r["map"] is True and not any(s["battle_id"] for s in r["stages"])
    walk = call("challenge_get", {"id": r["id"]})
    assert walk["map"]["w"] == m["w"] and set(walk["people"]) == {t1["id"], t2["id"], "leader"} and walk["beaten"] == []
    assert call("challenge_next", {"id": r["id"]}, status=400)
    assert "every trainer" in call("challenge_next", {"id": r["id"], "stage": "leader"}, status=409)["error"]

    def win(stage):
        out = call("challenge_next", {"id": r["id"], "stage": stage})
        bid = out["current"]["battle_id"]
        assert out["current"]["trainer_id"] == (leader["id"] if stage == "leader" else stage)
        call("battle_forfeit", {"id": bid, "side": "p2"})
        return bid

    win(t2["id"])                      # the second trainer saw you first
    assert call("challenge_get", {"id": r["id"]})["beaten"] == [t2["id"]]
    assert call("challenge_next", {"id": r["id"], "stage": t2["id"]}, status=409)
    assert call("challenge_next", {"id": r["id"], "stage": "leader"}, status=409)
    win(t1["id"])
    win("leader")
    done = call("challenge_get", {"id": r["id"]})
    assert done["status"] == "won" and [s["trainer_id"] for s in done["stages"]] == [t2["id"], t1["id"], leader["id"]]
    assert call("badges_list", {"trainer_id": me["id"]})["badges"][0]["gym_id"] == g["id"]
    # without the map the battles come one after another as before
    r2 = call("challenge_start", {"kind": "gym", "target_id": g["id"], "challenger_id": me["id"], "walk_map": False})
    assert r2["map"] is False and r2["stages"][0]["battle_id"]


def test_a_friend_result_may_come_in_the_order_the_map_was_walked(call, services):
    from silvers_hoard import sharing

    leader = call("trainer_create", {"name": "Erika", "paste": TEAM})
    t1 = call("trainer_create", {"name": "Uno", "paste": TEAM})
    t2 = call("trainer_create", {"name": "Dos", "paste": TEAM})
    g = call("gym_save", {"name": "Gimnasio Azulona", "leader_id": leader["id"], "trainers": [t1["id"], t2["id"]]})
    base = {"kind": "gym", "gym_id": g["id"], "gym_name": g["name"], "challenger": "Ana", "v": 3, "won": False,
            "team": [{"species": "Pikachu", "moves": ["thunderbolt"]}], "stages": [{"name": "Dos", "won": False, "turns": 1}]}
    for bad in ([t1["id"], leader["id"], t2["id"]], [t1["id"], t1["id"], leader["id"]], ["x", t2["id"], leader["id"]]):
        code = sharing.pack_code(sharing.RESULT_PREFIX, {**base, "order": bad})
        assert "order of the battles" in call("import", {"content": code}, status=400)["error"]
    # the right order passes that check (and goes on to the battles, which this code does not carry)
    good = sharing.pack_code(sharing.RESULT_PREFIX, {**base, "order": [t2["id"], t1["id"], leader["id"]]})
    try:
        services.import_any(good)
    except SilverError as e:
        assert "order of the battles" not in e.message
