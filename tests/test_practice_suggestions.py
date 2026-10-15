import copy
import pytest
from conftest import needs_engine
from silvers_hoard.errors import SilverError

pytestmark = needs_engine


def source(s):
    b = s.battle_start(p1={"name":"A","paste":"Mew\n- Splash\n- Psychic","human":True},
        p2={"name":"B","paste":"Magikarp\n- Splash","human":True},format_="gen9customgame",seed="suggest")
    for side in ("p1","p2"):
        s.battle_choose(b["id"],side,"team 1")
    for _ in range(2):
        for side in ("p1","p2"):
            s.battle_choose(b["id"],side,"move 1")
    s.battle_forfeit(b["id"],"p1")
    return b["id"]


def test_native_suggestions_accept_position_as_exercise_without_changing_original(services,call):
    id_ = source(services)
    before = copy.deepcopy(services.store.battle(id_))
    r = call("practice_suggestions",{"id":id_,"turn_count":1})
    assert r["hidden"] and r["analysed"] == 1 and r["next_turn"] == 2
    pos = r["suggestions"][0]
    assert pos["slots"][0]["actual"]["name"] == "Splash"
    assert pos["slots"][0]["recommended"]["name"] == "Psychic"
    e = call("exercise_create",{"battle_id":id_,"turn":pos["turn"],"side":pos["side"]})
    attempt = call("exercise_start",{"id":e["id"]})
    assert attempt["kind"] == "practice"
    assert services.store.battle(id_) == before
    assert not services.store.badges() and not services.store.hall()


def test_unavailable_records_and_invalid_parameters_are_explicit(services,call):
    id_ = source(services)
    assert call("practice_suggestions",{"id":id_,"min_gap":100})["suggestions"] == []
    call("practice_suggestions",{"id":id_,"start_turn":0},status=400)
    services.store.update_battle(id_,{"replay":{}})
    with pytest.raises(SilverError):
        services.practice_suggestions(id_)
