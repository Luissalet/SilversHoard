"""API/MCP wiring for palmares_get — hermetic store, no battle engine."""

from silvers_hoard import pokeathlon as pk
from silvers_hoard.agent_tools import tool_catalog


def _palmer_run(challenger_id: str, battle_id: str, *, name: str = "") -> dict:
    return {
        "kind": "facility",
        "target_id": "tower",
        "target_name": "Battle Tower",
        "challenger_id": challenger_id,
        "challenger": {"name": name or challenger_id, "frontier": {"kind": "tower"}},
        "status": "won",
        "stages": [{
            "number": 21, "boss": True, "result": "won", "character": "palmer",
            "name": "Tower Tycoon Palmer", "battle_id": battle_id, "trainer_id": "npc_palmer",
        }],
    }


def test_palmares_get_in_tool_catalog():
    assert "palmares_get" in {t["name"] for t in tool_catalog()}


def test_palmares_get_two_trainers_same_brain(call, services):
    pk.service(services)
    a = services.store.add_trainer({"name": "Palmares A", "team": [], "format": "gen9customgame"})
    b = services.store.add_trainer({"name": "Palmares B", "team": [], "format": "gen9customgame"})
    services.store.add_run(_palmer_run(a, "bt_a", name="Palmares A"))
    services.store.add_run(_palmer_run(b, "bt_b", name="Palmares B"))
    db = services.store.db
    db.insert("pokeathlon_medals", {"trainer_id": "", "species": "Pikachu", "bits": 3, "updated_at": 0}, on_conflict="replace")
    db.insert("pokeathlon_medals", {"trainer_id": b, "species": "Eevee", "bits": 31, "updated_at": 0}, on_conflict="replace")

    guest = call("palmares_get", {})
    assert guest["guest"] is True
    assert guest["counts"]["frontier_emblems"] == 2
    assert {e["challenger_id"] for e in guest["frontier_emblems"]} == {a, b}
    assert guest["pokeathlon_medals"][0]["species"] == "Pikachu"
    assert guest["unlocked_achievements"] == 0

    for order_note, first, second in (("AB", a, b), ("BA", b, a)):
        # Re-seed order independence is already covered by pure helpers; API path filters by id.
        card = call("palmares_get", {"trainer_id": second})
        assert card["guest"] is False and card["trainer_id"] == second
        assert card["counts"]["frontier_emblems"] == 1, order_note
        assert card["frontier_emblems"][0]["challenger_id"] == second
        assert card["frontier_emblems"][0]["battle_id"] == ("bt_b" if second == b else "bt_a")

    only_b = call("palmares_get", {"trainer_id": b})
    assert len(only_b["pokeathlon_medals"]) == 1 and only_b["pokeathlon_medals"][0]["complete"]
    # Guest Pikachu must not appear on trainer B
    assert all(m["species"] != "Pikachu" for m in only_b["pokeathlon_medals"])
