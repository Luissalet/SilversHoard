import json

from conftest import TEAM, needs_engine
from silvers_hoard import sharing

pytestmark = needs_engine


def test_trainer_code_file_paste_roundtrip(call):
    tr = call("trainer_create", {"name": "Luis", "paste": TEAM, "avatar": "sd:red", "dialogue": {"win": "¡Toma!"}})
    code = call("export", {"kind": "trainer", "id": tr["id"], "fmt": "code"})["code"]
    assert code.startswith(sharing.CODE_PREFIX) and len(code) < 4000
    got = call("import", {"content": f"mira esto: {code} :)"})
    assert got["kind"] == "trainer" and got["trainer"]["origin"] == "friend" and got["trainer"]["dialogue"]["win"] == "¡Toma!"
    assert got["trainer"]["avatar"] == "sd:red"
    paste = call("export", {"kind": "trainer", "id": tr["id"], "fmt": "paste"})["paste"]
    assert "Garchomp" in paste
    as_team = call("import", {"content": paste, "name": "Copia"})
    assert as_team["trainer"]["name"] == "Copia"


def test_gym_file_page_and_friend_result(call, client, services):
    leader = call("trainer_create", {"name": "Líder", "paste": TEAM})
    gym = call("gym_save", {"name": "Gimnasio Volcán", "badge": "Medalla Volcán", "badge_color": "#ee8130", "leader_id": leader["id"]})
    f = call("export", {"kind": "gym", "id": gym["id"], "fmt": "file"})
    r = client.get(f["url"])
    assert r.status_code == 200 and json.loads(r.content)["kind"] == "silvers-hoard/gym"
    imported = client.post("/api/import/upload", files={"file": (f["file"], r.content, "application/json")}).json()
    assert imported["kind"] == "gym" and imported["gym"]["leader"]["name"] == "Líder" and imported["gym"]["id"] != gym["id"]
    page = call("export", {"kind": "gym", "id": gym["id"], "fmt": "page"})
    html = client.get(page["url"]).text
    if "__SILVER_DATA__" not in html:   # the template is built (npm run build)
        assert "Gimnasio Volcán" in html and 'id="silver-data"' in html
        back = call("import", {"content": html})
        assert back["kind"] == "gym"
    result = {"kind": "gym", "gym_id": gym["id"], "gym_name": gym["name"], "challenger": "Ana", "won": True, "turns": 31,
              "team": [{"species": "Pikachu", "moves": ["Thunderbolt"]}], "log": ["|player|p1|Ana||", "|win|Ana"]}
    code = sharing.pack_code(sharing.RESULT_PREFIX, result)
    out = call("import", {"content": code})
    assert out["kind"] == "result" and out["won"] and out["badge_id"]
    badges = call("badges_list", {"gym_id": gym["id"]})["badges"]
    assert badges[0]["challenger_name"] == "Ana" and badges[0]["source"] == "friend"
    assert call("battle_get", {"id": out["battle_id"]})["kind"] == "friend"
    league = call("league_save", {"name": "Liga", "gyms": [gym["id"]], "champion_id": leader["id"]})
    lf = call("export", {"kind": "league", "id": league["id"], "fmt": "file"})
    assert lf["bytes"] > 500
    call("export", {"kind": "league", "id": league["id"], "fmt": "page"}, status=400)


def test_sprites_cache_and_avatars(client, services, call):
    r = client.get("/api/sprites/pokemon/pikachu?set=gen5")
    assert r.status_code == 200 and r.content.startswith(b"\x89PNG")
    assert (services.config.sprites_dir / "gen5" / "pikachu.png").exists()
    assert client.get("/api/sprites/pokemon/missing").status_code == 404
    assert client.get("/api/sprites/pokemon/..%2F..%2Fetc").status_code in (400, 404)
    assert client.get("/api/sprites/trainers/red.png").status_code == 200
    from PIL import Image
    import io
    buf = io.BytesIO()
    img = Image.new("RGB", (300, 400), (255, 255, 255))
    for x in range(100, 200):
        for y in range(80, 380):
            img.putpixel((x, y), (200, 40, 60))
    img.save(buf, "PNG")
    tr = call("trainer_create", {"name": "Foto", "paste": TEAM})
    up = client.post("/api/avatars/upload", files={"file": ("me.png", buf.getvalue(), "image/png")}, data={"trainer_id": tr["id"], "mode": "pixel"}).json()
    assert up["avatar"].startswith("file:")
    pic = client.get(up["url"])
    assert pic.status_code == 200
    sprite = Image.open(io.BytesIO(pic.content))
    assert sprite.size == (96, 96) and sprite.getpixel((0, 0))[3] == 0   # background cut out
    assert call("trainer_get", {"id": tr["id"]})["avatar"] == up["avatar"]


def test_parse_any_and_codes():
    obj = {"a": "ñ" * 10}
    assert sharing.unpack_code("X-", sharing.pack_code("X-", obj)) == obj
    kind, payload = sharing.parse_any("Pikachu\n- Thunderbolt\n")
    assert kind == "paste"
    try:
        sharing.unpack_code(sharing.CODE_PREFIX, sharing.CODE_PREFIX + "%%%")
    except Exception as exc:  # noqa: BLE001
        assert "damaged" in str(exc)


def test_settings_and_catalogue(call, client):
    s = call("settings_set", {"player_name": "Luis", "sprite_set": "gen5", "playback_ms": 500})
    assert s["player_name"] == "Luis" and call("settings_get")["sprite_set"] == "gen5"
    call("settings_set", {"default_ai_level": "godlike"}, status=400)
    cat = client.get("/api/agent/tools").json()
    names = {t["name"] for t in cat["tools"]}
    assert {"battle_start", "battle_choose", "challenge_start", "export", "import", "tournament_start", "canon_install"} <= names
    for t in cat["tools"]:
        assert len(t["description"].split("\n")[0]) <= 110
    assert client.post("/api/agent/call", json={"name": "silver_overview", "arguments": {}}).status_code == 401
