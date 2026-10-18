import copy

from conftest import TEAM, needs_engine
from silvers_hoard.agent_tools import TOOLS_BY_NAME, tool_catalog

pytestmark = needs_engine


def test_analysis_is_native_read_only_uncapped_and_does_not_fetch(services, call, monkeypatch):
    def no_network(*args, **kwargs):
        raise AssertionError("Analysis must not fetch remote data")

    monkeypatch.setattr(services.sprites, "_http_get", no_network, raising=False)
    trainer = services.trainer_create(name="Analysis fixture", paste=TEAM, format_="gen9customgame")
    before = copy.deepcopy(services.trainer_get(trainer["id"]))
    result = call("team_analysis", {"team": before["team"], "format": "gen9customgame"})
    assert result["members"][0]["defence"]["Ice"] == 4
    assert result["members"][1]["defence"]["Ground"] == 2  # type-only; Levitate excluded
    assert result["speed_order"] == [0, 1]
    assert services.trainer_get(trainer["id"]) == before
    assert len(result["defence"]) == len(result["coverage"]) == 18
    assert not TOOLS_BY_NAME["team_analysis"].capped
    catalog = tool_catalog()
    assert any(t["name"] == "team_analysis" for t in catalog)


def test_paste_and_level_rules_share_the_engine_handler(call):
    r = call("team_analysis", {"paste": TEAM, "format": "gen9customgame", "level_rules": {"level": 50}})
    assert r["members"][0]["speed"] == 169
    assert r["members"][0]["level"] == 50
    assert r["basis"]["speed"] == "unmodified_stat"
    assert r["basis"]["battle_state"] is False


def test_team_analysis_validates_input_and_format(call):
    call("team_analysis", {"team": []}, status=400)
    call("team_analysis", {"paste": "Mew\n- Psychic", "format": "bad-format"}, status=400)
    call("team_analysis", {"team": [{"species": "Unknown"}]}, status=400)
    call("team_analysis", {"team": [{"species": "Mew"}] * 7}, status=400)
