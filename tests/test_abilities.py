import copy
from conftest import needs_engine

pytestmark = needs_engine


def test_native_classic_activation_feed_is_read_only(services,call):
    b=services.battle_start(p1={"name":"A","paste":"Gyarados\nAbility: Intimidate\n- Splash","human":True},
        p2={"name":"B","paste":"Mew\n- Splash","human":True},format_="gen9customgame",seed="abilities")
    for side in ("p1","p2"):
        services.battle_choose(b["id"],side,"team 1")
    before=copy.deepcopy(services.store.battle(b["id"]))
    r=call("battle_abilities",{"id":b["id"]})
    assert r["mode"] == "turns"
    assert any(e["ability"] == "Intimidate" and e["pokemon"] == "Gyarados" for e in r["activations"])
    assert services.store.battle(b["id"]) == before


def test_native_realtime_reconstructs_current_tick_not_future(services,call):
    b=services.battle_start(p1={"name":"A","paste":"Pelipper\nAbility: Drizzle\n- Splash","human":True},
        p2={"name":"B","paste":"Mew\n- Splash","human":True},format_="gen9customgame",mode="realtime",seed="abilities")
    before=copy.deepcopy(services.store.battle(b["id"]))
    r=call("battle_abilities",{"id":b["id"]})
    assert r["mode"] == "realtime" and r["version"] == 7 and r["tick"] == 0
    assert any(e["ability"] == "Drizzle" and e["tick"] == 0 for e in r["activations"])
    assert services.store.battle(b["id"]) == before
