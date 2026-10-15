"""The arena designer: real-time arenas drawn by hand, used in battles and gyms, kept in replays and carried by exports."""

import json

from conftest import TEAM, needs_engine, wait_for

ROCKS = [{"x": 9, "y": 3, "r": 1}, {"x": 14, "y": 8.5, "r": 2}]


def test_save_checks_the_rocks_and_mirrors_them(call):
    a = call("arena_save", {"name": "Cráter", "floor": "cave", "rocks": ROCKS, "mirror": True})
    assert a["value"] == f"custom:{a['id']}" and a["floor"] == "cave"
    assert a["rocks"] == [{"x": 9.0, "y": 3.0, "r": 1.0}, {"x": 19.0, "y": 3.0, "r": 1.0}, {"x": 14.0, "y": 8.5, "r": 2.0}]
    for bad, why in (([{"x": 5, "y": 8.5, "r": 1}], "spot"), ([{"x": 27.5, "y": 8, "r": 1}], "edge"), ([{"x": 10, "y": 3, "r": 5}], "radius"),
                     ([{"x": 8 + i % 10, "y": 2 + i // 10, "r": 0.4} for i in range(17)], "16")):
        assert why in call("arena_save", {"name": "Mal", "rocks": bad}, status=400)["error"]
    assert call("arena_save", {"name": "x", "floor": "lava"}, status=400)
    a2 = call("arena_save", {"id": a["id"], "name": "Cráter grande"})
    assert a2["name"] == "Cráter grande" and len(a2["rocks"]) == 3
    assert [x["id"] for x in call("arenas_list", {})["arenas"]] == [a["id"]]


def test_a_gym_fights_on_its_arena_and_takes_it_and_its_backdrop_along(call, client):
    a = call("arena_save", {"name": "Volcán", "floor": "sand", "rocks": ROCKS})
    leader = call("trainer_create", {"name": "Blaine", "paste": TEAM})
    gym = call("gym_save", {"name": "Gimnasio Isla Canela", "leader_id": leader["id"], "rt_arena": a["value"], "backdrop": "bg-volcanocave.png"})
    assert gym["rt_arena"] == a["value"] and gym["rt_arena_name"] == "Volcán" and gym["backdrop"] == "bg-volcanocave.png"
    assert call("gym_save", {"id": gym["id"], "backdrop": "../../etc/passwd"}, status=400)
    assert call("gym_save", {"id": gym["id"], "rt_arena": "custom:nope"}, status=404)
    assert call("arena_get", {"id": a["id"]})["used_by"] == ["Gimnasio Isla Canela"]
    # exported and imported: the arena comes along as the field itself and is reused when it is already here
    f = call("export", {"kind": "gym", "id": gym["id"], "fmt": "file"})
    raw = client.get(f["url"]).content
    assert json.loads(raw)["gym"]["rt_arena"] == {"name": "Volcán", "floor": "sand", "rocks": a["rocks"]}

    def bring():
        return client.post("/api/import/upload", files={"file": (f["file"], raw, "application/json")}).json()["gym"]

    g2 = bring()
    assert g2["rt_arena"] == a["value"] and g2["backdrop"] == "bg-volcanocave.png"
    call("arenas_delete", {"ids": [a["id"]]})
    assert call("gym_get", {"id": gym["id"]})["rt_arena"] == ""
    g3 = bring()
    assert g3["rt_arena"].startswith("custom:") and g3["rt_arena_name"] == "Volcán"


@needs_engine
def test_a_real_time_battle_keeps_the_arena_it_was_played_on(call):
    a = call("arena_save", {"name": "Pasillo", "floor": "ice", "rocks": ROCKS, "mirror": True})
    p1 = call("trainer_random", {"seed": "arena-a", "ai_level": "easy"})
    p2 = call("trainer_random", {"seed": "arena-b", "ai_level": "easy"})
    bt = call("battle_start", {"p1": {"trainer_id": p1["id"]}, "p2": {"trainer_id": p2["id"]}, "mode": "realtime", "rt_arena": a["value"], "time_limit": 30})
    done = wait_for(lambda: (x := call("battle_get", {"id": bt["id"]}))["status"] == "ended" and x)
    spec = done["rt"]["spec"]
    assert spec["arena"]["floor"] == "ice" and len(spec["arena"]["rocks"]) == 3
    call("arena_save", {"id": a["id"], "rocks": []})      # editing the arena later does not change the battle
    again = call("battle_get", {"id": bt["id"]})["rt"]["spec"]["arena"]
    assert len(again["rocks"]) == 3


def test_a_gym_backdrop_of_your_own_travels_inside_the_gym(call, client):
    import base64
    import io
    import os

    from PIL import Image

    buf = io.BytesIO()   # a big photo that does not compress: it is shrunk until it can travel
    Image.frombytes("RGB", (1600, 900), os.urandom(1600 * 900 * 3)).save(buf, "PNG")
    up = client.post("/api/backdrops/upload", files={"file": ("foto.png", buf.getvalue(), "image/png")}).json()
    assert up["backdrop"].startswith("file:backdrop-") and client.get(up["url"]).status_code == 200
    pic = Image.open(io.BytesIO(client.get(up["url"]).content))
    assert max(pic.size) <= 800 and len(client.get(up["url"]).content) <= 400_000
    leader = call("trainer_create", {"name": "Pino", "paste": TEAM})
    gym = call("gym_save", {"name": "Gimnasio Propio", "leader_id": leader["id"], "backdrop": up["backdrop"]})
    assert gym["backdrop"] == up["backdrop"]
    assert call("gym_save", {"id": gym["id"], "backdrop": "file:no-such.png"}, status=404)
    # the tool puts a picture on a gym at once
    small = io.BytesIO()
    Image.new("RGB", (320, 180), (30, 90, 160)).save(small, "PNG")
    t = call("backdrop_image_set", {"gym_id": gym["id"], "data_base64": base64.b64encode(small.getvalue()).decode()})
    assert call("gym_get", {"id": gym["id"]})["backdrop"] == t["backdrop"] != up["backdrop"]
    # the file carries the picture itself; importing it stores a copy here
    f = call("export", {"kind": "gym", "id": gym["id"], "fmt": "file"})
    raw = client.get(f["url"]).content
    bd = json.loads(raw)["gym"]["backdrop"]
    assert bd["kind"] == "image" and base64.b64decode(bd["data"])[:4] == b"\x89PNG"
    g2 = client.post("/api/import/upload", files={"file": (f["file"], raw, "application/json")}).json()["gym"]
    assert g2["backdrop"].startswith("file:backdrop-") and g2["backdrop"] != t["backdrop"]
    assert client.get(f"/api/avatars/{g2['backdrop'][5:]}").status_code == 200
    # and the playable page has it inline
    page = client.post("/api/ui/call", json={"name": "export", "arguments": {"kind": "gym", "id": gym["id"], "fmt": "page"}})
    if page.status_code == 200:   # the page template exists once the client is built
        assert bd["data"][:200] in client.get(page.json()["url"]).text
