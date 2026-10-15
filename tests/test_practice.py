import copy
import json

import pytest

from conftest import needs_engine, wait_for
from silvers_hoard.errors import SilverError

pytestmark = needs_engine

def finished(services):
    seats = {"p1": {"name": "A", "paste": "Mew\n- Splash\n- Psychic", "human": True},
             "p2": {"name": "B", "paste": "Chansey\n- Splash", "human": True}}
    b = services.battle_start(**seats, format_="gen9customgame", seed="record")
    for side in ("p1", "p2"):
        b = services.battle_choose(b["id"], side, "team 1")
    for side in ("p1", "p2"):
        b = services.battle_choose(b["id"], side, "move 1")
    return services.battle_forfeit(b["id"], "p1")

def test_branch_survives_restart_and_never_changes_source_or_awards(services):
    source = finished(services)
    original = copy.deepcopy(services.store.battle(source["id"]))
    branch = services.battle_practice(source["id"], turn=2, side="p1")
    assert branch["id"] != source["id"] and branch["turn"] == 2
    assert branch["practice"]["source_id"] == source["id"]
    assert branch["requests"]["p1"] and branch["kind"] == "practice"
    assert not branch.get("run_id") and branch["p2"]["ai"]["hidden"]
    recorded_seed = json.loads(original["replay"]["input"][0].split(" ", 1)[1])["seed"]
    assert services.store.battle(branch["id"])["seed"] == recorded_seed
    services.engine.stop()
    branch = services.battle_choose(branch["id"], "p1", "move 2")
    assert branch["practice"]["turn"] == 2
    if branch["status"] == "live":
        branch = services.battle_forfeit(branch["id"], "p1")
    compared = services.battle_compare(branch["id"])
    assert compared["complete"] and compared["original"]["id"] == source["id"]
    assert services.store.battle(source["id"]) == original
    assert not services.store.badges() and not services.store.hall()

def test_no_record_or_invalid_turn_creates_no_battle(services):
    source = finished(services)
    count = len(services.store.battles())
    with pytest.raises(SilverError):
        services.battle_practice(source["id"], turn=99)
    assert len(services.store.battles()) == count
    services.store.update_battle(source["id"], {"replay": {}})
    with pytest.raises(SilverError, match="saved turn decisions"):
        services.battle_practice(source["id"], turn=1)
    with pytest.raises(SilverError):
        services.battle_compare(source["id"])

def test_forfeit_before_first_turn_has_no_practice_point(services):
    b = services.battle_start(p1={"name":"A","paste":"Mew\n- Splash","human":True},
        p2={"name":"B","paste":"Mew\n- Splash","human":True}, format_="gen9customgame")
    ended = services.battle_forfeit(b["id"],"p1")
    assert not services.battle_get(b["id"])["practice_available"]

def test_watched_battles_keep_their_decisions(services):
    b = services.battle_start(p1={"name":"A","paste":"Mew\n- Psychic","ai_level":"random"},
        p2={"name":"B","paste":"Magikarp\n- Splash","ai_level":"random"}, seed="watch",format_="gen9customgame")
    done = wait_for(lambda: (r:=services.battle_get(b["id"]))["status"] == "ended" and r)
    assert done["practice_available"]
    branch = services.battle_practice(b["id"],turn=1)
    assert branch["status"] == "live"

def test_native_tool_contract(call, services):
    source = finished(services)
    branch = call("battle_practice", {"id":source["id"], "turn":1, "side":"p2"})
    assert "p2" in branch["requests"] and branch["p1"]["ai"]["hidden"]
    cmp = call("battle_compare", {"id":branch["id"]})
    assert not cmp["complete"] and cmp["practice"]["side"] == "p2"
    call("battle_practice", {"id":source["id"], "turn":0},status=400)


def test_practice_of_cup_battle_never_advances_the_cup(services):
    ids = [services.trainer_create(name=name, paste=paste)["id"] for name, paste in
           [("A", "Mew\n- Splash\n- Psychic"), ("B", "Chansey\n- Splash")]]
    cup = services.cups.create(trainer_ids=ids, human_id=ids[0], pace=0, autoplay=False,
                               format_="gen9customgame")
    played = services.cups.play(cup["id"])
    bid = played["battle_id"]
    for side in ("p1", "p2"):
        if side == "p1":
            services.battle_choose(bid, side, "team 1")
    services.battle_choose(bid, "p1", "move 1")
    services.battle_forfeit(bid, "p1")
    before = copy.deepcopy(services.store.cup(cup["id"]))
    branch = services.battle_practice(bid, turn=1)
    assert not branch.get("cup") and not branch.get("run_id")
    services.battle_forfeit(branch["id"], "p1")
    assert services.store.cup(cup["id"]) == before
