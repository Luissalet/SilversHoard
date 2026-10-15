import base64
import io
import json

from conftest import TEAM, needs_engine, wait_for

pytestmark = needs_engine


def _png(size=16, color=(200, 40, 40, 255)):
    from PIL import Image
    buf = io.BytesIO()
    Image.new("RGBA", (size, size), color).save(buf, "PNG")
    return buf.getvalue()


def _noisy_png(size=700):
    """A big picture that does not compress (a drawing-sized avatar)."""
    import os
    from PIL import Image
    buf = io.BytesIO()
    Image.frombytes("RGBA", (size, size), os.urandom(size * size * 4)).save(buf, "PNG")
    return buf.getvalue()


def test_badge_pictures_travel_with_the_gym(call, client):
    leader = call("trainer_create", {"name": "Líder", "paste": TEAM})
    gym = call("gym_save", {"name": "Gimnasio Llama", "badge": "Medalla Llama", "badge_color": "#ee8130", "type": "Fire", "leader_id": leader["id"],
                            "badge_image": "shape:flame"})
    assert gym["badge_image"] == "shape:flame"
    call("gym_save", {"id": gym["id"], "badge_image": "shape:nope"}, status=400)
    # a shape travels as a shape
    f = call("export", {"kind": "gym", "id": gym["id"], "fmt": "file"})
    data = json.loads(client.get(f["url"]).content)
    assert data["gym"]["badge_image"] == {"kind": "shape", "shape": "flame"}
    # an own picture: uploaded through the route and through the tool
    up = client.post("/api/badges/upload", files={"file": ("medalla.png", _png(), "image/png")}, data={"gym_id": gym["id"]}).json()
    assert up["badge_image"].startswith("file:badge-") and client.get(up["url"]).status_code == 200
    assert call("gym_get", {"id": gym["id"]})["badge_image"] == up["badge_image"]
    via_tool = call("badge_image_set", {"data_base64": base64.b64encode(_png(32)).decode()})
    assert via_tool["badge_image"].startswith("file:") and not via_tool["gym_id"]
    f = call("export", {"kind": "gym", "id": gym["id"], "fmt": "file"})
    raw = client.get(f["url"]).content
    pic = json.loads(raw)["gym"]["badge_image"]
    assert pic["kind"] == "image" and base64.b64decode(pic["data"]).startswith(b"\x89PNG")
    back = client.post("/api/import/upload", files={"file": (f["file"], raw, "application/json")}).json()
    again = call("gym_get", {"id": back["gym"]["id"]})
    assert again["badge_image"].startswith("file:") and again["badge_image"] != up["badge_image"]
    # the badge a friend wins keeps the picture
    from silvers_hoard import sharing
    out = call("import", {"content": sharing.pack_code(sharing.RESULT_PREFIX, {"kind": "gym", "gym_id": gym["id"], "gym_name": gym["name"], "challenger": "Ana",
                                                                                  "won": True, "turns": 9, "team": [{"species": "Pikachu", "moves": ["Thunderbolt"]}]})})
    assert call("badges_list", {"gym_id": gym["id"]})["badges"][0]["badge_image"] == up["badge_image"] and out["badge_id"]


def test_badge_draw_needs_prospero(call):
    job = call("badge_draw", {"description": "a golden flame"})
    done = wait_for(lambda: (lambda j: j if j["status"] not in ("queued", "running") else None)(call("job_get", {"id": job["id"]})))
    assert done["status"] == "failed" and done["kind"] == "badge"
    call("badge_draw", {}, status=400)


def test_own_sprite_travels_in_share_codes(call, client):
    tr = call("trainer_create", {"name": "Con foto", "paste": TEAM})
    up = client.post("/api/avatars/upload", files={"file": ("yo.png", _png(64, (10, 120, 200, 255)), "image/png")},
                     data={"trainer_id": tr["id"], "mode": "upload", "remove_background": "false"}).json()
    assert call("trainer_get", {"id": tr["id"]})["avatar"].startswith("file:"), up
    code = call("export", {"kind": "trainer", "id": tr["id"], "fmt": "code"})["code"]
    got = call("import", {"content": code})["trainer"]
    assert got["avatar"].startswith("file:") and client.get(got["avatar_url"]).status_code == 200
    # a big drawing goes shrunk so the code stays pasteable
    big = client.post("/api/avatars/upload", files={"file": ("dibujo.png", _noisy_png(), "image/png")},
                      data={"trainer_id": tr["id"], "mode": "upload", "remove_background": "false"}).json()
    assert big
    code = call("export", {"kind": "trainer", "id": tr["id"], "fmt": "code"})["code"]
    assert len(code) < 120_000
    assert call("import", {"content": code})["trainer"]["avatar"].startswith("file:")
