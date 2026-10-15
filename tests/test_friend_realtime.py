"""Real time on the friends' playable pages: the export option, the result code with a replay inside, and its check on import."""

import json
import shutil
import subprocess
from pathlib import Path

import pytest

from conftest import TEAM, needs_engine
from silvers_hoard import sharing

pytestmark = needs_engine

ROOT = Path(__file__).resolve().parents[1]
# two Pokémon that cannot hurt anyone: a person who attacks wins, a person who stands still ties (two standing against two, same HP)
WEAK = "Magikarp\nLevel: 5\n- Splash\n\nMagikarp\nLevel: 5\n- Splash\n"


def record(spec, bot="attack"):
    """A scripted person plays the first seat (the page's input log); returns rows, tick, winner_side and the log as the page packs it."""
    out = subprocess.run([shutil.which("node"), str(ROOT / "tests" / "rt_record.mjs")], input=json.dumps({"spec": spec, "bot": bot}), text=True,
                         capture_output=True, cwd=str(ROOT), timeout=180, check=True)
    return json.loads(out.stdout)


@pytest.fixture
def world(call, services):
    call("settings_set", {"rt_time_limit": 60})
    weak = call("trainer_create", {"name": "Pez", "paste": WEAK, "ai_level": "easy", "format": "gen9customgame"})
    weak2 = call("trainer_create", {"name": "Pez 2", "paste": WEAK, "ai_level": "easy", "format": "gen9customgame"})
    gym = call("gym_save", {"name": "Gimnasio Charco", "leader_id": weak["id"], "trainers": [weak2["id"]], "badge": "Medalla Charco", "type": "Water",
                            "format": "gen9customgame"})
    team = services.import_team(TEAM)["sets"]
    return {"gym": gym, "weak": weak, "weak2": weak2, "team": team}


def stage_for(services, w, trainer, bot="attack", seed="test-seed-1", name="Ana", gym_id=None):
    """What the page would put in a stage of the code: a scripted person plays it against the trainer as the app has it. The attacking
    person does not always win a given seed, so it tries seeds until one is won (the same ones every run)."""
    obj = services.store.trainer(trainer["id"])
    gym = services.store.gym(gym_id or w["gym"]["id"])
    keys = services._rt_page_info("gym", gym)["keys"]
    for attempt in range(8):
        seed_i = seed if attempt == 0 else f"{seed}-{attempt}"
        spec = {"id": f"p-{seed_i}", "seed": seed_i, "format": "gen9customgame", "level_rules": {}, "time_limit": 60, "version": 2, "arena": "rocks",
                "p1": {"name": name, "sets": w["team"], "ai": None}, "p2": {"name": obj["name"], "sets": obj["team"], "ai": {"level": obj["ai_level"], "style": obj["ai_style"]}}}
        rec = record(spec, bot)
        if bot != "attack" or rec["winner_side"] == "p1":
            break
    assert bot != "attack" or rec["winner_side"] == "p1", "the scripted person wins one of the seeds"
    stage = {"name": obj["name"], "won": rec["winner_side"] == "p1", "turns": 0, "mode": "realtime",
             "rt": {"trainer": obj["id"], "key": keys[obj["id"]], "v": 2, "arena": "rocks", "seed": seed_i, "limit": 60, "inputs": rec["packed"], "tick": rec["tick"], "forfeit": ""}}
    return stage, rec


def result(w, stages, *, won=None, **extra):
    won = all(s["won"] for s in stages) and len(stages) == 2 if won is None else won
    return {"kind": "gym", "gym_id": w["gym"]["id"], "gym_name": w["gym"]["name"], "challenger": "Ana", "won": won, "turns": 0, "v": 2, "team": w["team"],
            "team_paste": "", "date": "2026-10-15T10:00:00Z", "stages": stages, **extra}


def code_of(r):
    return sharing.pack_code(sharing.RESULT_PREFIX_RT, r)


def test_export_option_is_validated_and_carried(call, client, services, world):
    for bad in ("nope", "turn", ""):
        call("export", {"kind": "gym", "id": world["gym"]["id"], "fmt": "page", "friend_mode": bad}, status=400)
    with pytest.raises(Exception):
        services.export("gym", world["gym"]["id"], fmt="page", friend_mode="x")
    # the tool's catalogue says what the parameter does
    spec = next(t for t in client.get("/api/agent/tools").json()["tools"] if t["name"] == "export")
    assert spec["inputSchema"]["properties"]["friend_mode"]["enum"] == ["choose", "turns", "realtime"]
    gym = services.store.gym(world["gym"]["id"])
    info = services._rt_page_info("gym", gym)
    assert info["format"] == "gen9customgame" and info["arena"] == "rocks" and info["version"] == 3 and info["time_limit"] == 60
    assert set(info["keys"]) == {world["weak"]["id"], world["weak2"]["id"]}
    for mode, has_rt in (("choose", True), ("realtime", True), ("turns", False)):
        page = call("export", {"kind": "gym", "id": world["gym"]["id"], "fmt": "page", "friend_mode": mode})
        html = client.get(page["url"]).text
        if "__SILVER_DATA__" in html:   # the template is not built here
            continue
        data = json.loads(html.split('<script id="silver-data" type="application/json">', 1)[1].split("</script>", 1)[0].replace("<\\/", "</"))
        assert data["mode"] == mode and ("rt" in data) is has_rt
        if has_rt:
            assert data["rt"]["keys"] == info["keys"]
        # the default is to let the friend choose
    default = call("export", {"kind": "gym", "id": world["gym"]["id"], "fmt": "page"})
    html = client.get(default["url"]).text
    if "__SILVER_DATA__" not in html:
        assert '"mode":"choose"' in html
    # a trainer page takes it too; a league page still does not exist
    tr = call("export", {"kind": "trainer", "id": world["weak"]["id"], "fmt": "page", "friend_mode": "realtime"})
    assert tr["bytes"] > 1000
    league = call("league_save", {"name": "Liga", "gyms": [world["gym"]["id"]], "champion_id": world["weak"]["id"]})
    call("export", {"kind": "league", "id": league["id"], "fmt": "page", "friend_mode": "realtime"}, status=400)


def test_gym_pages_list_the_trainers_in_the_gym_order(call, services, world):
    gym = services.store.gym(world["gym"]["id"])
    # touching the first trainer makes it the most recently updated: the order of the page must not change
    call("trainer_update", {"id": world["weak2"]["id"], "notes": "x"})
    payload = services._gym_payload(gym)
    assert [t["name"] for t in payload["trainers"]] == ["Pez 2"] and payload["leader"]["name"] == "Pez"


def test_real_time_result_round_trip(call, services, world):
    s1, rec1 = stage_for(services, world, world["weak2"], seed="rt-a")
    s2, rec2 = stage_for(services, world, world["weak"], seed="rt-b")
    assert rec1["winner_side"] == "p1" and rec2["winner_side"] == "p1", "the scripted person beats a level 5 Magikarp"
    # the page's packer and the app's decoder agree
    assert sharing.decode_rt_inputs(rec1["packed"]) == [[r[0], 0, r[2], r[3], r[4], r[5], r[6], r[7], r[8], r[9]] for r in rec1["rows"]]
    assert sharing.decode_rt_inputs(sharing.encode_rt_inputs(rec1["rows"])) == sharing.decode_rt_inputs(rec1["packed"])
    code = code_of(result(world, [s1, s2]))
    assert code.startswith("SILVERWIN2-") and len(code) < 8000, len(code)
    out = call("import", {"content": f"aquí va: {code} :)"})
    assert out["kind"] == "result" and out["won"] and out["badge_id"] and out["verified_real_time"] == 2
    badge = call("badges_list", {"gym_id": world["gym"]["id"]})["badges"][0]
    assert badge["challenger_name"] == "Ana" and badge["source"] == "friend" and badge["proof"]["verified_real_time"] == 2
    b = call("battle_get", {"id": out["battle_id"]})
    assert b["mode"] == "realtime" and b["kind"] == "friend" and b["status"] == "ended" and b["winner_side"] == "p1" and b["winner_name"] == "Ana"
    assert b["rt"]["spec"]["seed"].startswith("rt-b") and b["rt"]["spec"]["arena"] == "rocks" and b["rt"]["human"] == [True, False] and b["rt"]["inputs"]
    assert b["p2"]["name"] == "Pez" and b["lines"][0].startswith("|rt|")
    # it is a real-time battle with its replay: the stage before it is in the list too
    assert len([x for x in call("battles_list", {})["battles"] if x["kind"] == "friend"]) == 2


def test_a_file_with_the_code_is_accepted(client, services, world):
    s1, _ = stage_for(services, world, world["weak2"], seed="f-a")
    s2, _ = stage_for(services, world, world["weak"], seed="f-b")
    code = code_of(result(world, [s1, s2]))
    r = client.post("/api/import/upload", files={"file": ("resultado.txt", code.encode(), "text/plain")})
    assert r.status_code == 200 and r.json()["won"] and r.json()["verified_real_time"] == 2


def test_a_battle_not_won_is_recorded_without_a_badge(call, services, world):
    lost, rec = stage_for(services, world, world["weak2"], bot="idle", seed="lost-1")
    assert rec["winner_side"] != "p1" and not lost["won"]   # standing still against harmless foes ties
    out = call("import", {"content": code_of(result(world, [lost]))})
    assert out["kind"] == "result" and not out["won"] and out["badge_id"] is None and out["verified_real_time"] == 1
    assert call("badges_list", {"gym_id": world["gym"]["id"]})["badges"] == []


def test_forfeit_in_real_time_counts_as_a_loss(call, services, world):
    stage, _ = stage_for(services, world, world["weak2"], bot="idle", seed="ff-1")
    stage["won"] = False
    stage["rt"].update({"forfeit": "p1", "tick": 90})
    out = call("import", {"content": code_of(result(world, [stage]))})
    assert not out["won"] and out["badge_id"] is None


def test_tampered_codes_are_rejected(call, services, world):
    s1, _ = stage_for(services, world, world["weak2"], seed="t-a")
    s2, _ = stage_for(services, world, world["weak"], seed="t-b")
    good = result(world, [s1, s2])

    def reject(r, text, status=400):
        out = call("import", {"content": code_of(r)}, status=status)
        assert text in json.dumps(out), out
        assert call("badges_list", {"gym_id": world["gym"]["id"]})["badges"] == [], "nothing was recorded"
        assert not [x for x in call("battles_list", {})["battles"] if x["kind"] == "friend"]

    # a battle nobody won claimed as a win
    lost, _ = stage_for(services, world, world["weak"], bot="idle", seed="t-lost")
    assert not lost["won"]
    reject(result(world, [s1, {**lost, "won": True}]), "does not end as the code says")
    # the input log of a won battle emptied, or swapped for the log of the battle nobody won
    reject(result(world, [s1, {**s2, "rt": {**s2["rt"], "inputs": sharing.encode_rt_inputs([])}}]), "does not end as the code says")
    reject(result(world, [s1, {**s2, "rt": {**s2["rt"], "inputs": lost["rt"]["inputs"]}}]), "does not end as the code says")
    # a won battle that the code makes a forfeit
    reject(result(world, [s1, {**s2, "rt": {**s2["rt"], "forfeit": "p1", "tick": 60}}]), "does not end as the code says")
    # damaged pieces
    reject(result(world, [s1, {**s2, "rt": {**s2["rt"], "inputs": "AAAA"}}]), "damaged")
    reject(result(world, [s1, {**s2, "rt": {**s2["rt"], "limit": 5}}]), "damaged")
    reject(result(world, [s1, {**s2, "rt": {**s2["rt"], "v": 9}}]), "damaged")
    reject(result(world, [s1, {**s2, "rt": {**s2["rt"], "forfeit": "p2"}}]), "damaged")
    # the code says one thing and its battles another, or has battles after a lost one, or a team that breaks the rules
    reject(result(world, [s1], won=True), "altered")
    reject(result(world, [lost, s2], won=False), "after a lost one")
    reject(result(world, [s1, s2, s2]), "more battles", status=409)
    reject({**good, "team": [{"species": "Mewtwo", "moves": ["Psystrike"]}] * 2 + [{"species": "Nope", "moves": ["Tackle"]}]}, "invalid")
    reject({**good, "team": []}, "no valid team")
    # against another trainer than the one at that place in the gym
    reject(result(world, [s1, {**s2, "rt": {**s2["rt"], "trainer": world["weak2"]["id"]}}]), "another version", status=409)
    # and a code whose compressed text is cut
    cut_code = code_of(good)[:-40]
    call("import", {"content": cut_code}, status=400)
    # the untouched code still works
    assert call("import", {"content": code_of(good)})["won"]


def test_a_changed_gym_is_told_apart_from_a_forgery(call, services, world):
    s1, _ = stage_for(services, world, world["weak2"], seed="c-a")
    s2, _ = stage_for(services, world, world["weak"], seed="c-b")
    call("trainer_update", {"id": world["weak"]["id"], "paste": "Magikarp\nLevel: 6\n- Splash\n"})
    out = call("import", {"content": code_of(result(world, [s1, s2]))}, status=409)
    assert "another version" in json.dumps(out) and "changed after the page was exported" in json.dumps(out)


def test_turn_based_and_mixed_results(call, services, world):
    # a result of turn-based battles keeps its old prefix and works as before: nothing to replay
    old = {"kind": "gym", "gym_id": world["gym"]["id"], "gym_name": world["gym"]["name"], "challenger": "Ana", "won": True, "turns": 31, "team": world["team"],
           "stages": [{"name": "Pez 2", "won": True, "turns": 14}, {"name": "Pez", "won": True, "turns": 17}], "log": ["|player|p1|Ana||", "|win|Ana"]}
    out = call("import", {"content": sharing.pack_code(sharing.RESULT_PREFIX, old)})
    assert out["won"] and out["badge_id"] and "verified_real_time" not in out
    assert call("battle_get", {"id": out["battle_id"]})["mode"] == "classic"
    # turns first and real time for the leader: only the real-time battle is replayed
    s2, _ = stage_for(services, world, world["weak"], seed="m-b")
    mixed = result(world, [{"name": "Pez 2", "won": True, "turns": 14}, s2], log=["|player|p1|Ana||", "|win|Ana"])
    out = call("import", {"content": code_of(mixed)})
    assert out["won"] and out["verified_real_time"] == 1
    battle = call("battle_get", {"id": out["battle_id"]})
    assert battle["mode"] == "classic" and battle["summary"]["stages"][0]["mode"] == "classic" and battle["summary"]["stages"][1]["mode"] == "realtime"
    assert call("battle_get", {"id": battle["summary"]["stages"][1]["battle_id"]})["mode"] == "realtime"
    assert len(call("badges_list", {"gym_id": world["gym"]["id"]})["badges"]) == 2


def test_trainer_pages_in_real_time(call, services, world):
    obj = services.store.trainer(world["weak"]["id"])
    info = services._rt_page_info("trainer", obj)
    spec = {"id": "p-tr", "seed": "tr-1", "format": info["format"], "level_rules": {}, "time_limit": 60, "version": 2, "arena": "rocks",
            "p1": {"name": "Ana", "sets": world["team"], "ai": None}, "p2": {"name": obj["name"], "sets": obj["team"], "ai": {"level": obj["ai_level"], "style": obj["ai_style"]}}}
    rec = record(spec)
    stage = {"name": obj["name"], "won": rec["winner_side"] == "p1", "turns": 0, "mode": "realtime",
             "rt": {"trainer": obj["id"], "key": info["keys"][obj["id"]], "v": 2, "arena": "rocks", "seed": "tr-1", "limit": 60, "inputs": rec["packed"], "tick": rec["tick"], "forfeit": ""}}
    r = {"kind": "trainer", "trainer_id": obj["id"], "trainer_name": obj["name"], "challenger": "Ana", "won": True, "turns": 0, "v": 2, "team": world["team"], "stages": [stage]}
    out = call("import", {"content": code_of(r)})
    assert out["kind"] == "result" and out["won"] and out["verified_real_time"] == 1
    assert call("trainer_get", {"id": obj["id"]})["record"]["losses"] == 1


def test_codes_do_not_inflate_without_limit():
    import base64
    import zlib
    bomb = base64.urlsafe_b64encode(zlib.compress(b"0" * (sharing.MAX_UNPACKED + 10_000), 9)).decode().rstrip("=")
    with pytest.raises(Exception) as exc:
        sharing.unpack_code(sharing.RESULT_PREFIX_RT, sharing.RESULT_PREFIX_RT + bomb)
    assert "too long" in str(exc.value)
    assert sharing.parse_any(sharing.pack_code(sharing.RESULT_PREFIX_RT, {"a": 1})) == ("result", {"a": 1})
    assert sharing.parse_any(sharing.pack_code(sharing.RESULT_PREFIX, {"a": 2})) == ("result", {"a": 2})


def test_doubles_input_rows_round_trip():
    from silvers_hoard import sharing
    rows = [[3, 0, 0.5, -1.0, -1, 0, -1, 1, 0, 0, 1, 0], [9, 0, 0.0, 0.0, 2, 0, -1, 1, 1, 0, 0, 1]]
    assert sharing.decode_rt_inputs(sharing.encode_rt_inputs(rows)) == rows
    singles = [[3, 0, 0.5, -1.0, -1, 0, -1, 1, 0, 0]]
    assert sharing.decode_rt_inputs(sharing.encode_rt_inputs(singles)) == singles
