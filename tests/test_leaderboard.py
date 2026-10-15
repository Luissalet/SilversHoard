"""Friends' leaderboard and the week's challenge: every imported result is ranked per gym (best result per friend, checked results
first), a code counts once, a page exported as the week's challenge carries the week's seed and its battles must have been played
with it, and results can be taken off the board."""
import json
import shutil
import subprocess
from pathlib import Path

import pytest

from conftest import TEAM, needs_engine
from silvers_hoard import sharing

pytestmark = needs_engine

ROOT = Path(__file__).resolve().parents[1]
WEAK = "Magikarp\nLevel: 5\n- Splash\n\nMagikarp\nLevel: 5\n- Splash\n"


def play(services, trainer, team, seed=""):
    t = services.store.trainer(trainer["id"])
    spec = {"format": "gen9customgame", "level_rules": {}, "p1": {"name": "Ana", "sets": team}, "seed": seed,
            "p2": {"name": t["name"], "sets": t["team"], "ai": {"level": t["ai_level"], "style": t["ai_style"]}}, "forfeit": False}
    out = subprocess.run([shutil.which("node"), str(ROOT / "tests" / "turn_record.mjs")], input=json.dumps(spec), text=True, capture_output=True,
                         cwd=str(ROOT), timeout=180, check=True)
    return json.loads(out.stdout)


@pytest.fixture
def gym(call, services):
    weak = call("trainer_create", {"name": "Pez", "paste": WEAK, "ai_level": "hard", "format": "gen9customgame"})
    g = call("gym_save", {"name": "Gimnasio Charco", "leader_id": weak["id"], "badge": "Medalla Charco", "type": "Water", "format": "gen9customgame"})
    return {"gym": g, "weak": weak, "team": services.import_team(TEAM)["sets"]}


def code(services, w, rec, who="Ana", **over):
    stage = {"name": "Pez", "won": rec["winner_side"] == "p1", "turns": rec["turns"], "input": rec["input"], "rng": rec["rng"], "forfeit": ""}
    r = {"kind": "gym", "gym_id": w["gym"]["id"], "gym_name": w["gym"]["name"], "challenger": who, "won": stage["won"], "turns": rec["turns"],
         "team": w["team"], "team_paste": "", "date": "2026-10-15T10:00:00Z", "stages": [stage], "v": 3, "ai_version": services.ai_version()}
    r.update(over)
    return sharing.pack_code(sharing.RESULT_PREFIX, r)


def test_the_weeks_challenge(call, client, services, gym):
    page = call("export", {"kind": "gym", "id": gym["gym"]["id"], "fmt": "page", "weekly": True, "friend_mode": "realtime"})
    week = services.current_week()
    info = services.weekly_info("gym", gym["gym"])
    assert page["week"] == week and week in page["file"]
    html = client.get(page["url"]).text
    assert info["seed"] in html and week in html
    # played with the week's seed: checked, ranked this week with the HP left
    rec = play(services, gym["weak"], gym["team"], seed=f"{info['seed']}-0")
    assert rec["winner_side"] == "p1" and rec["rng"] == f"{info['seed']}-0"
    out = call("import", {"content": code(services, gym, rec, weekly=week)})
    assert out["won"] and out["verified"] and out["week"] == week
    board = call("leaderboard", {"week": "current"})
    assert board["week"] == week and board["weeks"] == [week] and len(board["boards"]) == 1
    top = board["boards"][0]["entries"][0]
    assert top["challenger"] == "Ana" and top["rank"] == 1 and top["verified"] and top["won"] and top["hp_left"] > 0 and top["week"] == week
    assert top["turns"] == rec["turns"] and board["boards"][0]["badge"] == "Medalla Charco"
    # the same code twice counts once
    again = call("import", {"content": code(services, gym, rec, weekly=week)}, status=409)
    assert "already imported" in json.dumps(again)
    # a battle not played with the week's seed, a week's code with a battle in real time, a damaged week
    plain = play(services, gym["weak"], gym["team"])
    bad = call("import", {"content": code(services, gym, plain, who="Bea", weekly=week)}, status=400)
    assert "this week" in json.dumps(bad)
    call("import", {"content": code(services, gym, rec, who="Bea", weekly="semana 42")}, status=400)
    rt = sharing.pack_code(sharing.RESULT_PREFIX, {"kind": "gym", "gym_id": gym["gym"]["id"], "gym_name": "x", "challenger": "Eva", "won": True, "turns": 0,
                                                     "team": gym["team"], "weekly": week, "v": 2,
                                                     "stages": [{"name": "Pez", "won": True, "turns": 0, "mode": "realtime", "rt": {"seed": "x"}}]})
    assert "turn by turn" in json.dumps(call("import", {"content": rt}, status=400))
    # the same seed again gives the same battle with the same choices: the luck really is the same for everyone
    assert play(services, gym["weak"], gym["team"], seed=f"{info['seed']}-0")["input"] == rec["input"]


def test_the_leaderboard_ranks_and_forgets(call, services, gym):
    # a checked win, an older page's win (not checked) and a loss
    rec = play(services, gym["weak"], gym["team"])
    call("import", {"content": code(services, gym, rec, who="Ana")})
    old = sharing.pack_code(sharing.RESULT_PREFIX, {"kind": "gym", "gym_id": gym["gym"]["id"], "gym_name": "x", "challenger": "Bea", "won": True, "turns": 3,
                                                      "team": gym["team"], "stages": [{"name": "Pez", "won": True, "turns": 3}]})
    call("import", {"content": old})
    lost = sharing.pack_code(sharing.RESULT_PREFIX, {"kind": "gym", "gym_id": gym["gym"]["id"], "gym_name": "x", "challenger": "Ceci", "won": False, "turns": 2,
                                                       "team": gym["team"], "stages": [{"name": "Pez", "won": False, "turns": 2}]})
    call("import", {"content": lost})
    # Ana again, slower: her best result stays and the attempts add up
    slow = sharing.pack_code(sharing.RESULT_PREFIX, {"kind": "gym", "gym_id": gym["gym"]["id"], "gym_name": "x", "challenger": "ana ", "won": True, "turns": 90,
                                                       "team": gym["team"], "stages": [{"name": "Pez", "won": True, "turns": 90}], "date": "later"})
    call("import", {"content": slow})
    b = call("leaderboard", {"kind": "gym", "target_id": gym["gym"]["id"]})
    assert b["total"] == 4 and b["week"] == ""
    entries = b["boards"][0]["entries"]
    assert [e["challenger"] for e in entries] == ["Ana", "Bea", "Ceci"]
    assert entries[0]["verified"] and not entries[1]["verified"] and entries[0]["attempts"] == 2 and len(entries[0]["ids"]) == 2
    assert not entries[2]["won"] and entries[2]["battles_won"] == 0
    assert call("leaderboard", {"week": "current"})["boards"] == []
    call("leaderboard", {"week": "nope"}, status=400)
    # taken off the board: the battles and the badges stay
    assert call("leaderboard_remove", {"ids": entries[2]["ids"]})["removed"] == 1
    assert [e["challenger"] for e in call("leaderboard", {})["boards"][0]["entries"]] == ["Ana", "Bea"]
    assert len(call("badges_list", {"gym_id": gym["gym"]["id"]})["badges"]) == 3


def test_the_weeks_challenge_is_only_a_page(call, gym):
    call("export", {"kind": "gym", "id": gym["gym"]["id"], "fmt": "file", "weekly": True}, status=400)
