"""The friends' league (points from imported results, by month) and the vote that picks the rule of the week's challenge."""
import pytest
from fastapi.testclient import TestClient

from conftest import TEAM, needs_engine
from silvers_hoard.errors import SilverError
from silvers_hoard.pvp_server import room_app


def _result(services, who, target, *, won, verified=False, battles=3, battles_won=None, week="", fp=""):
    return services.store.add_friend_result({
        "kind": "gym", "target_id": target, "target_name": target, "challenger": who, "won": int(won), "battles": battles,
        "battles_won": battles if won else (battles_won or 0), "turns": 20, "hp_left": 50.0, "verified": int(verified), "week": week,
        "mode": "classic", "battle_id": "", "badge_id": "", "fingerprint": fp or f"{who}-{target}-{won}-{verified}-{week}", "played_at": ""})


def test_league_points(call, services):
    _result(services, "Ana", "g1", won=True, verified=True)            # 3 + 1
    _result(services, "ana", "g1", won=False, battles_won=2)          # same friend and gym: only the best counts
    _result(services, "Ana", "g2", won=False, battles_won=1)          # 1
    _result(services, "Bea", "g1", won=True, week="2026-W42")         # 3 + 1 (week's challenge)
    _result(services, "Bea", "g3", won=True)                          # 3
    lg = call("friends_league", {})
    table = {e["challenger"]: e for e in lg["standings"]}
    assert table["Bea"]["points"] == 7 and table["Bea"]["rank"] == 1 and table["Bea"]["weekly"] == 1
    assert table["Ana"]["points"] == 5 and table["Ana"]["played"] == 2 and table["Ana"]["verified_wins"] == 1
    assert lg["season"] == lg["current"] and call("friends_league", {"season": "all"})["standings"][0]["challenger"] == "Bea"
    assert call("friends_league", {"season": "1999-01"})["standings"] == []
    call("friends_league", {"season": "lately"}, status=400)
    out = call("friends_league_export", {})
    page = (services.config.exports_dir / out["file"]).read_text(encoding="utf-8")
    assert "Bea" in page and "Liga de amigos" in page and out["published"] is True
    assert any(e["type"] == "friends.league" for e in services.events)


@needs_engine
def test_vote_of_the_week(call, services):
    with pytest.raises(SilverError):
        services.friends.poll_open(kind="rule", options=["Same Type Clause", "No Hackmons Allowed"])
    call("poll_open", {"kind": "pokemon", "options": ["Pikachu", "Pikachu"]}, status=400)    # two different options at least
    p = call("poll_open", {"kind": "pokemon", "options": ["pikachu", "Garchomp", "Gengar"], "week": "2026-W42"})
    assert [o["value"] for o in p["options"]] == ["Pikachu", "Garchomp", "Gengar"] and p["status"] == "open"
    path = "/" + p["links"]["local"].split("/", 3)[3]
    with TestClient(room_app(services), base_url="http://192.168.1.20:5240") as rooms:
        page = rooms.get(path, headers={"accept-language": "es-ES"})
        assert page.status_code == 200 and "Garchomp" in page.text and "Votar" in page.text
        assert rooms.get(f"/v/{p['id']}?k=wrong").status_code == 403
        r = rooms.post(path, data={"name": "Ana", "option": "Garchomp"})
        assert r.status_code == 200 and "Voto guardado" in r.text
        rooms.post(path, data={"name": "Bea", "option": "Gengar"})
        rooms.post(path, data={"name": "ana", "option": "Gengar"})                 # Ana changes her vote
        bad = rooms.post(path, data={"name": "Cris", "option": "Mewtwo"})
        assert "not one of the options" in bad.text
    call("poll_vote", {"id": p["id"], "name": "Dani", "option": "Pikachu"})     # a vote that came by message
    got = call("poll_get", {"id": p["id"]})
    assert {o["value"]: o["votes"] for o in got["options"]} == {"Pikachu": 1, "Garchomp": 0, "Gengar": 2}
    assert got["voters"] == ["Bea", "Dani", "ana"]
    closed = call("poll_close", {"id": p["id"]})
    assert closed["winner"] == "Gengar" and closed["week_rule"] == {"kind": "pokemon", "value": "Gengar", "poll": p["id"]}
    call("poll_vote", {"id": p["id"], "name": "Eva", "option": "Pikachu"}, status=409)
    # the week's challenge of that week asks for it, and a result without it is turned away
    t = call("trainer_create", {"name": "Líder", "paste": TEAM})
    info = services.weekly_info("trainer", services.store.trainer(t["id"]), "2026-W42")
    assert info["rule"] == {"kind": "pokemon", "value": "Gengar"}
    with pytest.raises(SilverError):
        services._check_week_rule(info["rule"], "gen9customgame", [{"species": "Garchomp"}], [], {})
    services._check_week_rule(info["rule"], "gen9customgame", [{"species": "Gengar-Mega"}, {"species": "Garchomp"}], [], {})
    # a team-building rule is checked with the validator
    q = call("poll_open", {"kind": "rule", "options": ["same type clause", "Item Clause = 1"], "week": "2026-W43"})
    call("poll_vote", {"id": q["id"], "name": "Ana", "option": "Same Type Clause"})
    call("poll_close", {"id": q["id"]})
    with pytest.raises(SilverError):
        services._check_week_rule({"kind": "rule", "value": "Same Type Clause"}, "gen9customgame", services.import_team(TEAM)["sets"], [], {})
    listed = call("poll_get", {})
    assert listed["week_rules"]["2026-W43"]["value"] == "Same Type Clause" and len(listed["polls"]) == 2
    call("week_rule_clear", {"week": "2026-W42"})
    assert "rule" not in services.weekly_info("trainer", services.store.trainer(t["id"]), "2026-W42")
