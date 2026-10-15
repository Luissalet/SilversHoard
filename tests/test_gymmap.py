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


def test_a_map_can_be_drawn_in_pixel_art():
    m = gymmap.generate(["a"], seed="z")
    assert "look" not in gymmap.clean(m, ["a"])
    assert gymmap.clean({**m, "look": "colors"}, ["a"]).get("look") is None
    assert gymmap.clean({**m, "look": "pixel"}, ["a"])["look"] == "pixel"
    assert "look is colors" in _err({**m, "look": "neon"}, ["a"])


def test_a_gym_keeps_its_map_and_takes_it_along(call, client):
    leader = call("trainer_create", {"name": "Erika", "paste": TEAM})
    t1 = call("trainer_create", {"name": "Uno", "paste": TEAM})
    t2 = call("trainer_create", {"name": "Dos", "paste": TEAM})
    m = call("gym_map_generate", {"trainer_ids": [t1["id"], t2["id"]], "seed": "1"})["map"]
    g = call("gym_save", {"name": "Gimnasio Azulona", "leader_id": leader["id"], "trainers": [t1["id"], t2["id"]], "map": {**m, "look": "pixel"}})
    assert g["map"]["look"] == "pixel"
    assert g["map"]["w"] == m["w"] and {x["id"] for x in g["map"]["trainers"]} == {t1["id"], t2["id"]}
    bad = {**m, "trainers": m["trainers"][:1]}
    assert "not on the map" in call("gym_save", {"id": g["id"], "map": bad}, status=400)["error"]
    f = call("export", {"kind": "gym", "id": g["id"], "fmt": "file"})
    raw = client.get(f["url"]).content
    assert {x["id"] for x in json.loads(raw)["gym"]["map"]["trainers"]} == {0, 1}
    back = client.post("/api/import/upload", files={"file": (f["file"], raw, "application/json")}).json()["gym"]
    assert back["map"]["look"] == "pixel"
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


def _room(rows, start, leader, trainers=(), props=()):
    return {"w": len(rows[0]), "h": len(rows), "tiles": "".join(rows), "start": list(start),
            "leader": {"x": leader[0], "y": leader[1], "facing": "down"}, "trainers": list(trainers), "props": list(props)}


def test_ice_slides_you_until_something_stops_you():
    rows = ["#########",
            "#...L...#",
            "#.......#",
            "#_______#",
            "#_______#",
            "#_______#",
            "#...S...#",
            "#########"]
    rows = [r.replace("L", ".").replace("S", ".") for r in rows]
    m = _room(rows, (4, 6), (4, 1))
    seen = gymmap.stops(m)
    # walking up from the entrance you slide over the ice up to the first floor tile
    assert (4, 2) in seen and (4, 4) not in seen
    assert gymmap.clean(m, [])["tiles"].count("_") == 21
    # a frozen room with a wall where the slide would end leaves the leader out of reach
    walled = rows[:]
    walled[2] = "#########"
    assert "no way from the entrance to the leader" in _err(_room(walled, (4, 6), (4, 1)), [])


def test_arrows_carry_you_and_a_switch_opens_the_doors():
    rows = ["#########",
            "#.......#",
            "####d####",
            "#.......#",
            "#.>>>>..#",
            "#.......#",
            "#.......#",
            "#########"]
    m = _room(rows, (4, 6), (4, 1))
    assert "a door needs a switch" in _err(m, [])
    with_switch = rows[:]
    with_switch[5] = "#......s#"
    m2 = _room(with_switch, (4, 6), (4, 1))
    assert gymmap.clean(m2, [])
    seen = gymmap.stops(m2)
    assert (4, 2) in seen, "standing in the doorway once the switch was stepped on"
    # stepping on the first arrow carries you to the end of the row
    assert (3, 4) not in seen and (6, 4) in seen


def test_buildings_stand_on_the_map_and_block_the_way():
    rows = ["." * 16] * 12
    rows = ["#" * 16] + ["#" + "." * 14 + "#" for _ in range(10)] + ["#" * 16]
    m = _room(rows, (8, 10), (8, 1), props=[{"kind": "center", "x": 1, "y": 3}, {"kind": "house", "x": 9, "y": 4}])
    out = gymmap.clean(m, [])
    assert [p["kind"] for p in out["props"]] == ["center", "house"]
    assert (2, 4) not in gymmap.stops(out)
    assert "a building's kind" in _err({**m, "props": [{"kind": "castle", "x": 1, "y": 1}]}, [])
    assert "does not fit" in _err({**m, "props": [{"kind": "gym", "x": 12, "y": 1}]}, [])
    assert "overlap" in _err({**m, "props": [{"kind": "house", "x": 1, "y": 1}, {"kind": "house", "x": 3, "y": 3}]}, [])
    assert "stands on the entrance" in _err({**m, "props": [{"kind": "house", "x": 6, "y": 6}]}, [])


def test_trainers_can_turn_and_generated_puzzles_are_solvable():
    ids = [f"t{i}" for i in range(6)]
    m = gymmap.generate(ids, seed="p")
    m["trainers"][0]["turns"] = True
    assert gymmap.clean(m, ids)["trainers"][0]["turns"] is True
    for puzzle, mark in (("ice", "_"), ("arrows", "^<>"), ("switches", "ds")):
        g = gymmap.generate(ids, seed="p", puzzle=puzzle)
        assert any(c in g["tiles"] for c in mark), puzzle
        assert gymmap.clean(g, ids) == g
    assert "puzzle is one of" in _err_gen(ids)


def _err_gen(ids):
    try:
        gymmap.generate(ids, seed="p", puzzle="lava")
    except SilverError as e:
        return e.message
    raise AssertionError("no error")
