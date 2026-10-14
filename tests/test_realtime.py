"""Real-time battles (Legends: Z-A rules): started, watched, finished from the screen's inputs, in series, tournaments and gyms."""

from conftest import TEAM, needs_engine, wait_for

pytestmark = needs_engine


def test_watch_and_rules(call):
    a = call("trainer_create", {"name": "Ana", "paste": TEAM, "ai_level": "hard"})
    b = call("trainer_random", {"ai_level": "normal", "seed": "rt-b"})
    bt = call("battle_start", {"p1": {"trainer_id": a["id"]}, "p2": {"trainer_id": b["id"]}, "mode": "realtime", "seed": "w1", "time_limit": 120})
    assert bt["mode"] == "realtime" and bt["rt"]["spec"]["time_limit"] == 120
    done = wait_for(lambda: (x := call("battle_get", {"id": bt["id"]}))["status"] == "ended" and x)
    assert done["summary"]["mode"] == "realtime" and done["summary"]["seconds"] > 0
    assert done["lines"][0].startswith("|rt|") and any("used" in l for l in done["lines"])
    assert done["rt"]["spec"]["seed"] == "w1" and done["rt"]["inputs"] == []
    rules = call("rt_rules")
    assert any("cooldown" in r for r in rules["rules"])
    cds = call("rt_cooldowns", {"trainer_id": a["id"]})
    eq = cds["pokemon"][0]["moves"][0]
    assert eq["name"] == "Earthquake" and eq["cooldown"] == 10 and eq["za"] is True and eq["final"] < 10
    listed = call("battles_list", {})["battles"]
    assert listed[0]["mode"] == "realtime"


def test_play_forfeit_and_finish(call):
    me = call("trainer_create", {"name": "Luis", "paste": TEAM})
    foe = call("trainer_random", {"ai_level": "easy", "seed": "rt-foe"})
    bt = call("battle_start", {"p1": {"trainer_id": me["id"], "human": True}, "p2": {"trainer_id": foe["id"]}, "mode": "realtime", "time_limit": 40})
    assert bt["status"] == "live" and bt["rt"]["human"] == [True, False]
    # the screen saves its inputs as it goes; a reload gets them back
    inputs = [[1, 0, 1, 0, -1, 0, -1], [20, 0, 0, 0, 0, 0, -1]]
    call("battle_rt_save", {"id": bt["id"], "inputs": inputs, "tick": 30})
    assert call("battle_get", {"id": bt["id"]})["rt"]["inputs"] == inputs
    call("battle_choose", {"id": bt["id"], "side": "p1", "choice": "move 1"}, status=400)
    ended = call("battle_forfeit", {"id": bt["id"], "side": "p1"})
    assert ended["status"] == "ended" and ended["winner_side"] == "p2" and ended["summary"]["reason"] == "forfeit"
    assert call("trainer_get", {"id": me["id"]})["record"]["losses"] == 1
    # a whole battle finished from the screen: the engine replays the inputs to the end (an idle player runs out of time or loses)
    bt2 = call("battle_start", {"p1": {"trainer_id": me["id"], "human": True}, "p2": {"trainer_id": foe["id"]}, "mode": "realtime", "time_limit": 30})
    done = call("battle_rt_finish", {"id": bt2["id"], "inputs": [[5, 0, 0.5, 0.25, -1, 0, -1]], "tick": 900})
    assert done["status"] == "ended" and done["summary"]["reason"] in ("ko", "time")


def test_series_tournament_and_gym_in_real_time(call):
    a = call("trainer_create", {"name": "Ana", "paste": TEAM, "ai_level": "hard"})
    b = call("trainer_random", {"ai_level": "normal", "seed": "s-b"})
    c = call("trainer_random", {"ai_level": "normal", "seed": "s-c"})
    job = call("series_start", {"p1": {"trainer_id": a["id"]}, "p2": {"trainer_id": b["id"]}, "count": 3, "mode": "realtime", "time_limit": 60})
    res = wait_for(lambda: (j := call("job_get", {"id": job["id"]}))["status"] == "done" and j)
    assert res["result"]["mode"] == "realtime" and res["result"]["count"] == 3 and res["result"]["avg_seconds"] > 0
    assert all(x["mode"] == "realtime" for x in res["battles"])
    tour = call("tournament_start", {"trainer_ids": [a["id"], b["id"], c["id"]], "mode": "realtime", "time_limit": 45})
    tres = wait_for(lambda: (j := call("job_get", {"id": tour["id"]}))["status"] == "done" and j)
    assert tres["result"]["champion"] and all(x["mode"] == "realtime" for x in tres["battles"])
    gym = call("gym_save", {"name": "Gimnasio Rápido", "leader_id": b["id"], "badge": "Rayo", "type": "Electric", "format": "gen9customgame"})
    run = call("challenge_start", {"kind": "gym", "target_id": gym["id"], "challenger_id": a["id"], "auto": True, "mode": "realtime"})
    final = wait_for(lambda: (r := next(x for x in call("challenges_list", {})["challenges"] if x["id"] == run["id"]))["status"] != "active" and r)
    assert final["status"] in ("won", "lost") and final["mode"] == "realtime"
    battle = call("battle_get", {"id": final["stages"][0]["battle_id"]})
    assert battle["mode"] == "realtime" and battle["kind"] == "gym"


def test_walking_sprites_are_downloaded_once(tmp_path):
    import io

    from PIL import Image

    from silvers_hoard.pmd import PmdSprites, parse_animdata

    xml = ("<AnimData><ShadowSize>1</ShadowSize><Anims>"
           "<Anim><Name>Walk</Name><Index>0</Index><FrameWidth>8</FrameWidth><FrameHeight>8</FrameHeight><Durations><Duration>4</Duration><Duration>4</Duration></Durations></Anim>"
           "<Anim><Name>Idle</Name><Index>7</Index><CopyOf>Walk</CopyOf></Anim></Anims></AnimData>")
    sheet = io.BytesIO()
    Image.new("RGBA", (16, 64), (255, 0, 0, 255)).save(sheet, "PNG")
    shadow = io.BytesIO()
    img = Image.new("RGBA", (16, 64), (0, 0, 0, 0))
    img.putpixel((3, 6), (0, 0, 0, 255))
    img.save(shadow, "PNG")
    seen = []

    def http(url):
        seen.append(url)
        if url.endswith("tracker.json"):
            return 200, b'{"0037": {"subgroups": {"0001": {"name": "Alola", "sprite_files": {"Walk": 1}}}}}', "application/json"
        if url.endswith("AnimData.xml"):
            return 200, xml.encode(), "text/xml"
        if url.endswith("-Shadow.png"):
            return 200, shadow.getvalue(), "image/png"
        return 200, sheet.getvalue(), "image/png"

    anims, size = parse_animdata(xml)
    assert anims["Idle"] == {"copyOf": "Walk"} and size == 1
    pmd = PmdSprites(tmp_path / "pmd", {"pmd_sprites": True, "pmd_server": "https://example.test"}, http)
    meta = pmd.meta(37, form="Alola")
    assert meta["key"] == "0037-0001" and meta["a"]["Walk"] == {"w": 8, "h": 8, "n": 2, "r": 8, "d": [4, 4], "ax": 3.0, "ay": 6.0}
    assert "Idle" in meta["a"] and pmd.sheet("0037-0001", "Walk").exists()
    n = len(seen)
    assert pmd.meta(37, form="Alola") == meta and len(seen) == n, "cached after the first time"
