from copy import deepcopy

import pytest

from silvers_hoard.replay_statistics import compute


def classic():
    return {"kind": "watch", "status": "ended", "mode": "classic",
            "p1": {"trainer_id": "a"}, "p2": {"trainer_id": "b"},
            "log_text": "\n".join([
                "|start", "|switch|p1a: Fish|Magikarp, L1|11/11", "|switch|p2a: Mouse|Pikachu, L100|300/300",
                "|turn|1", "|move|p1a: Fish|Splash|p1a: Fish", "|-nothing", "|move|p2a: Mouse|Double Slap|p1a: Fish",
                "|-damage|p1a: Fish|5/11", "|-damage|p1a: Fish|0 fnt", "|-hitcount|p1a: Fish|2", "|win|B"])}


def realtime():
    return {"kind": "play", "status": "ended", "mode": "realtime",
            "p1": {"trainer_id": "a", "name": "A", "sets": [{"species": "Cloyster", "name": "Shell used again"}, {"species": "Ditto"}]},
            "p2": {"trainer_id": "b", "name": "B", "sets": [{"species": "Snorlax"}, {"species": "Mew"}]},
            "summary": {"sides": {"p1": {"pokemon": [{"name": "Shell used again", "species": "Cloyster", "switches": 1, "moves": 1}, {"species": "Ditto", "switches": 0, "moves": 0, "taken": 0}]},
                                  "p2": {"pokemon": [{"species": "Snorlax", "switches": 1, "moves": 1}, {"species": "Mew", "switches": 1}]}}},
            "log_text": "\n".join(["|rt|A vs B|gen9customgame|seed qa", "[0.0] A sent out Shell used again", "[0.0] B sent out Snorlax",
                                    "[1.0] A's Shell used again used Icicle Spear", "[1.1] B's Snorlax took 5 (95/100)",
                                    "[1.2] B's Snorlax took 5 (90/100)", "[2.0] B's Snorlax used Rest", "[3.0] B sent out Mew", "[5.0] A won (time)"])}


def counts(rows):
    return {row["name"]: row["count"] for row in rows}


def test_known_classic_rt_multi_hit_and_unused_bench():
    source = [classic(), realtime()]
    before = deepcopy(source)
    result = compute(source)
    assert result["totals"] == {"battles": 2, "move_uses": 4}
    assert counts(result["moves"]) == {"Splash": 1, "Double Slap": 1, "Icicle Spear": 1, "Rest": 1}
    assert counts(result["species"]) == {name: 1 for name in ["Magikarp", "Pikachu", "Cloyster", "Snorlax", "Mew"]}
    assert counts(result["openings"]) == {name: 1 for name in ["Magikarp", "Pikachu", "Cloyster", "Snorlax"]}
    assert result["coverage"] == {"moves": 2, "species": 2, "openings": 2, "ambiguous_move_lines": 0}
    assert source == before


def test_filters_select_only_the_trainers_side():
    result = compute([classic(), realtime(), {**classic(), "status": "live"}], trainer_id="a")
    assert result["totals"] == {"battles": 2, "move_uses": 2}
    assert counts(result["species"]) == {"Magikarp": 1, "Cloyster": 1}
    assert counts(result["openings"]) == {"Magikarp": 1, "Cloyster": 1}
    assert compute([classic(), realtime()], mode="realtime", kind="watch")["totals"]["battles"] == 0
    assert compute([classic(), realtime()], mode="realtime", kind="play")["totals"]["battles"] == 1
    assert compute([classic()], trainer_id="absent")["totals"]["battles"] == 0
    assert compute([{**classic(), "mode": ""}], mode="classic")["totals"]["battles"] == 1


def test_doubles_openings_are_first_switch_per_position_not_later_replacements():
    battle = classic()
    battle["log_text"] = "\n".join(["|start", "|switch|p1a: P|Pikachu|100/100", "|switch|p1b: E|Eevee|100/100",
                                     "|replace|p1a: Z|Zoroark|100/100", "|turn|1", "|switch|p1a: S|Snorlax|100/100", "|tie"])
    result = compute([battle], trainer_id="a")
    assert counts(result["openings"]) == {"Pikachu": 1, "Eevee": 1}
    assert result["coverage"]["openings"] == 1
    assert "Snorlax" in counts(result["species"])


def test_same_species_counts_presence_once_per_battle_not_per_side_or_switch():
    battle = classic()
    battle["log_text"] = battle["log_text"].replace("Magikarp", "Pikachu")
    assert counts(compute([battle, battle])["species"]) == {"Pikachu": 2}
    assert counts(compute([battle, battle])["openings"]) == {"Pikachu": 2}


def test_incomplete_logs_do_not_claim_complete_coverage_or_invent_moves():
    result = compute([{"kind": "friend", "status": "ended", "p1": {}, "p2": {}, "log_text": "old result"}])
    assert not result["moves"] and not result["species"] and not result["openings"]
    assert result["coverage"] == {"moves": 0, "species": 0, "openings": 0, "ambiguous_move_lines": 0}


def test_rt_duplicate_visible_names_are_not_attributed_to_a_filtered_side():
    battle = realtime()
    for side in ("p1", "p2"):
        battle[side]["name"] = "Same"
        battle[side]["sets"] = [{"species": "Pikachu", "name": "Mouse"}]
    battle["log_text"] = "|rt|Same vs Same|format\n[0.0] Same sent out Mouse\n[1.0] Same's Mouse used Thunderbolt\n[2.0] Same won (time)"
    result = compute([battle], trainer_id="a")
    assert not result["moves"] and not result["openings"]
    assert result["coverage"]["moves"] == result["coverage"]["openings"] == 0
    assert result["coverage"]["ambiguous_move_lines"] == 1
    # Globally the log still unambiguously records one use and this opening species.
    assert counts(compute([battle])["moves"]) == {"Thunderbolt": 1}


def test_rt_unknown_nickname_and_missing_opening_mark_coverage_incomplete():
    battle = realtime()
    battle["log_text"] = battle["log_text"].replace("Shell used again", "unknown")
    result = compute([battle], trainer_id="a")
    assert not result["moves"] and not result["openings"]
    assert result["coverage"]["moves"] == result["coverage"]["openings"] == 0
    assert result["coverage"]["ambiguous_move_lines"] == 1


def test_rt_starting_species_is_not_replaced_by_final_mega_summary():
    battle = realtime()
    battle["p1"]["sets"] = [{"species": "Charizard", "name": "Dragon"}]
    battle["summary"]["sides"]["p1"]["pokemon"] = [{"species": "Charizard-Mega-X", "name": "Dragon", "switches": 1}]
    battle["log_text"] = battle["log_text"].replace("Shell used again", "Dragon")
    result = compute([battle], trainer_id="a")
    assert counts(result["openings"]) == {"Charizard": 1}
    assert counts(result["species"]) == {"Charizard-Mega-X": 1}


def test_limit_is_only_presentation_and_empty_is_stable():
    all_rows = compute([classic(), realtime()], limit=0)
    top = compute([classic(), realtime()], limit=1)
    assert top["totals"] == all_rows["totals"] and top["distinct"] == all_rows["distinct"]
    assert top["moves"] == [{"name": "Double Slap", "count": 1}]
    assert compute([])["totals"] == {"battles": 0, "move_uses": 0}


def test_old_rt_summary_without_activity_uses_only_known_log_participants():
    battle = realtime()
    battle["summary"]["sides"]["p1"]["pokemon"] = [{"species": "Cloyster", "name": "Shell used again"}, {"species": "Ditto"}]
    result = compute([battle], trainer_id="a")
    assert counts(result["species"]) == {"Cloyster": 1}
    assert result["coverage"]["species"] == 0


def test_truncated_classic_log_is_not_complete_participation():
    battle = classic()
    battle["log_text"] = battle["log_text"].replace("|win|B", "")
    result = compute([battle])
    assert result["coverage"]["species"] == result["coverage"]["moves"] == 0
    assert result["coverage"]["openings"] == 1


def test_shared_handler_reads_all_rows_without_writing_or_using_engine(call, services, monkeypatch):
    def forbidden(*args, **kwargs):
        pytest.fail("statistics must not invoke the engine")
    monkeypatch.setattr(services.engine, "call", forbidden)
    for _ in range(65):
        services.store.add_battle({**classic(), "format": "gen9customgame"})
    before = services.store.battles(limit=-1, light=False)
    result = call("replay_statistics", {"limit": 1})
    assert result["totals"] == {"battles": 65, "move_uses": 130}
    assert len(result["moves"]) == 1 and result["distinct"]["moves"] == 2
    assert services.store.battles(limit=-1, light=False) == before
    call("replay_statistics", {"mode": "invalid"}, status=400)
