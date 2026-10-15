"""Why the AI chose: notes kept with battles the app starts (watched and played), battle_explain with turn filters, text and
advice for a person's side, and the notes kept out of the battle view."""
from conftest import needs_engine, wait_for

MINE = "Garchomp\nAbility: Rough Skin\n- Earthquake\n- Dragon Claw\n- Swords Dance\n\nLucario\n- Aura Sphere\n- Flash Cannon\n"
THEIRS = "Heatran\n- Flamethrower\n- Earth Power\n\nBlissey\n- Seismic Toss\n"


@needs_engine
def test_watched_battle_keeps_why(call):
    b = call("battle_start", {"p1": {"paste": MINE, "name": "Ana", "ai_level": "expert"}, "p2": {"paste": THEIRS, "name": "Bea", "ai_level": "hard"},
                              "format": "gen9customgame"})
    done = wait_for(lambda: (lambda x: x if x["status"] == "ended" else None)(call("battle_get", {"id": b["id"]})))
    assert done["ai_notes_count"] > 2 and "ai_notes" not in done["summary"]
    r = call("battle_explain", {"id": b["id"], "limit": 800})
    assert r["total"] == done["ai_notes_count"] and len(r["notes"]) == r["total"]
    turn1 = call("battle_explain", {"id": b["id"], "turn": 1})
    assert {n["side"] for n in turn1["notes"]} == {"p1", "p2"} and all(n["turn"] == 1 for n in turn1["notes"])
    ana = next(n for n in turn1["notes"] if n["side"] == "p1")
    assert ana["level"] == "expert" and ana["slots"][0]["mon"] == "Garchomp" and len(ana["playouts"]) > 1
    text = next(t for t in turn1["text"] if t.startswith("Turn 1, Ana"))
    assert "Garchomp" in text and "chose" in text and "Turns played out" in text
    only = call("battle_explain", {"id": b["id"], "side": "p2", "from_turn": 2})
    assert all(n["side"] == "p2" and n["turn"] >= 2 for n in only["notes"])


@needs_engine
def test_live_battle_notes_and_advice(call):
    b = call("battle_start", {"p1": {"paste": MINE, "name": "Yo", "human": True}, "p2": {"paste": THEIRS, "name": "Bea", "ai_level": "hard"},
                              "format": "gen9customgame"})
    assert b["status"] == "live"
    b = call("battle_choose", {"id": b["id"], "side": "p1", "choice": "default"})      # team preview
    r = call("battle_explain", {"id": b["id"]})
    adv = r["advice"]["p1"]
    assert adv["kind"] == "turn" and adv["level"] == "expert" and adv["slots"][0]["options"]
    assert "advice from the expert AI" in adv["text"]
    assert all(n["side"] == "p2" for n in r["notes"])         # the person's own choices have no notes
    before = r["total"]
    call("battle_choose", {"id": b["id"], "side": "p1", "choice": "move 1"})
    after = call("battle_explain", {"id": b["id"], "advice": False})
    assert after["total"] > before and "advice" not in after


def test_realtime_and_bad_side_are_refused(services):
    import pytest
    from silvers_hoard.errors import SilverError
    bid = services.store.add_battle({"kind": "play", "status": "ended", "format": "gen9customgame", "mode": "realtime", "p1": {}, "p2": {}})
    with pytest.raises(SilverError):
        services.battle_explain(bid)
    bid2 = services.store.add_battle({"kind": "play", "status": "ended", "format": "gen9customgame", "p1": {}, "p2": {}})
    with pytest.raises(SilverError):
        services.battle_explain(bid2, side="p3")
    r = services.battle_explain(bid2)
    assert r["notes"] == [] and "hint" in r
