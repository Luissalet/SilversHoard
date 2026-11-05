"""The Pokéathlon: stars of any Pokémon, the courses, the rival draws, and saved courses with their records and medals."""

import pytest

from silvers_hoard.pokeathlon import (COURSES, EVENTS, MASTER_SETS, challenge_bonus, event_points, rank_scores, rank_teams)

STARS = {"speed": 3, "power": 3, "skill": 3, "stamina": 3, "jump": 3}


def mons(*names, stars=None):
    return [{"species": n, "name": n, "stars": stars or STARS} for n in names]


def team(name, *species, human=False, stars=None):
    return {"name": name, "color": "red", "human": human, "mons": mons(*species, stars=stars)}


TEAMS = [team("Tú", "Pikachu", "Eevee", "Machop", human=True), team("Susie", "Pikachu", "Teddiursa", "Vulpix"),
         team("Eva", "Hoppip", "Oddish", "Bellsprout"), team("Chase", "Rattata", "Sentret", "Sandshrew")]


def rounds(course, raws):
    return [{"event": e, "raw": r} for e, r in zip(COURSES[course]["events"], raws)]


def test_stars_of_the_game_and_of_later_generations(call):
    got = call("pokeathlon_stats", {"species": ["Bulbasaur", "Rotom-Wash", "Pawmot", "Not A Pokémon"]})["pokemon"]
    bulba, rotom, pawmot, nope = got
    assert bulba["stars"] == {"speed": 2, "power": 2, "skill": 3, "stamina": 3, "jump": 3} and not bulba["estimated"] and bulba["source"] == "rom"
    assert bulba["min"]["skill"] == 1 and bulba["max"]["skill"] == 4 and bulba["gen"] == 1 and bulba["types"] == ["Grass", "Poison"]
    assert rotom["stars"]["stamina"] == 4 and not rotom["estimated"]
    # Pawmot (generation 9) is not in the game: predicted, flagged, and still inside 1-5 with min <= base <= max
    assert pawmot["estimated"] and pawmot["gen"] == 9
    for k, v in pawmot["stars"].items():
        assert 1 <= pawmot["min"][k] <= v <= pawmot["max"][k] <= 5
    assert nope["missing"] and nope["estimated"] and set(nope["stars"].values()) == {3}


def test_search_by_name_number_and_generation(call):
    r = call("pokeathlon_stats", {"query": "bulba"})
    assert [p["name"] for p in r["pokemon"]] == ["Bulbasaur"]
    assert call("pokeathlon_stats", {"query": "25", "limit": 3})["pokemon"][0]["name"] == "Pikachu"
    only9 = call("pokeathlon_stats", {"gen": 9, "limit": 300})
    assert only9["total"] > 100 and all(p["gen"] == 9 and (p["estimated"] or p["name"] == "Wooper-Paldea") for p in only9["pokemon"])
    exact = call("pokeathlon_stats", {"estimated": False, "limit": 1})
    assert exact["total"] > 500


def test_courses_and_events(call):
    c = call("pokeathlon_courses", {})
    assert [x["id"] for x in c["courses"]] == list(range(11)) and len(c["events"]) == 10
    assert c["courses"][0]["events"] == [0, 1, 6] and c["courses"][0]["medals"] == ["speed"] and c["courses"][0]["medal_mask"] == 1
    assert c["courses"][5]["medal_mask"] == 0x11 and c["courses"][6]["medal_mask"] == 0x14 and c["courses"][10]["events"] == []
    assert [e["es"] for e in c["events"]][:3] == ["Saltaobstáculos", "Atrapabanderas", "Pisacírculos"]
    assert c["events"][0]["lower_is_better"] and not c["events"][3]["lower_is_better"]
    assert c["courses"][10]["es"] == "Competición Suprema"


def test_the_games_rival_teams_and_the_supreme_cup(call):
    seen = set()
    for course in range(5):
        r = call("pokeathlon_rivals", {"course": course, "seed": f"s{course}"})
        nums = {t["team"] for t in r["teams"]}
        assert len(nums) == 3 and nums <= set(range(5 * course + 1, 5 * course + 6)) and r["events"] == COURSES[course]["events"]
        seen |= nums
        sup = call("pokeathlon_rivals", {"course": course, "seed": f"s{course}", "supreme": True})
        assert {t["team"] for t in sup["teams"]} <= set(range(5 * course + 51, 5 * course + 56)) and sup["supreme"]
    assert len(seen) == 15
    again = call("pokeathlon_rivals", {"course": 2, "seed": "x"})
    assert again == call("pokeathlon_rivals", {"course": 2, "seed": "x"}) and again["teams"][0]["line_es"] and again["teams"][0]["line_en"]
    t = again["teams"][0]
    assert len(t["mons"]) == 3 and t["mons"][0]["stars"] and not t["mons"][0]["estimated"]


def test_the_supreme_course_draws_its_events_and_the_hardest_teams(call):
    for seed in ("a", "b", "c", "d", "e"):
        r = call("pokeathlon_rivals", {"course": 10, "seed": seed})
        assert tuple(r["events"]) in MASTER_SETS and r["supreme"]
        assert {t["team"] for t in r["teams"]} <= set(range(76, 101))
    assert len({tuple(call("pokeathlon_rivals", {"course": 10, "seed": str(i)})["events"]) for i in range(30)}) > 3


def test_rivals_from_the_whole_pokedex_are_balanced_like_the_games(call):
    for sup, (low, high) in ((False, (31, 45)), (True, (39, 48))):
        for i in range(5):
            r = call("pokeathlon_rivals", {"course": 1, "seed": f"any{i}", "any_pokemon": True, "supreme": sup})
            assert len(r["teams"]) == 3 and r["any_pokemon"]
            for t in r["teams"]:
                assert not t["npc"] and len({m["name"] for m in t["mons"]}) == 3
                assert low <= sum(sum(m["stars"].values()) for m in t["mons"]) <= high
    # random picks come from every generation, not just the game's
    gens = {m["gen"] for i in range(20) for t in call("pokeathlon_rivals", {"seed": f"g{i}", "any_pokemon": True})["teams"] for m in t["mons"]}
    assert len(gens) >= 5


def test_challenge_bonus_of_the_games_teams_matches_its_own_numbers(services):
    p = services.pokeathlon
    p._load()
    assert len(p._npc) == 100
    for t in p._npc:
        stars = [p.find(n)["stats"][k][0] for n in t["mons"] for k in ("speed", "power", "skill", "stamina", "jump")]
        assert sum(stars) == t["stars_sum"] and challenge_bonus(stars) == t["challenge"]
    assert challenge_bonus([1] * 15) == 60 and challenge_bonus([3] * 15) == 30 and challenge_bonus([5] * 15) == 0


@pytest.mark.parametrize("event,score,points", [(0, 3000, 115), (0, 1725, 200), (0, 1000, 200), (1, 35, 105), (1, 80, 200), (2, 40, 120), (3, 80, 80), (3, 250, 200),
                                                (4, 0, 30), (4, 40, 121), (5, 350, 100), (6, 12288, 120), (6, 1024, 10), (7, 70, 105), (8, 30, 90)])
def test_event_points_at_the_target_scores(event, score, points):
    assert event_points(event, [score, 0 if event else 99999, 0 if event else 99999, 0 if event else 99999])[0] == points


def test_goal_roll_points_follow_the_places_and_ties():
    assert event_points(9, [3, 2, 1, 0]) == [115, 90, 75, 60]
    assert event_points(9, [2, 2, 1, 0]) == [90, 90, 75, 60]     # tied first places both get the second place's 80
    assert event_points(9, [0, 0, 0, 0]) == [60, 60, 60, 60]


def test_ranks_keep_ties_and_the_draw_breaks_a_tie_for_first():
    assert rank_scores([20, 20, 15, 10]) == [0, 0, 2, 3]
    assert rank_scores([3000, 2500, 2500, 4000], lower_is_better=True) == [2, 0, 0, 3]
    assert rank_teams([100, 100, 90, 80], [0, 3, 1, 2]) == [1, 0, 2, 3]
    assert rank_teams([100, 100, 90, 80], [3, 0, 1, 2]) == [0, 1, 2, 3]
    assert rank_teams([90, 100, 100, 80], [0, 1, 2, 3]) == [2, 1, 0, 3] or rank_teams([90, 100, 100, 80], [0, 1, 2, 3])[3] == 3


def test_a_won_course_is_scored_here_and_records_the_medals(call):
    body = {"course": 0, "seed": "win", "teams": TEAMS, "team": 0, "rounds": rounds(0, [[2400, 4000, 3600, 4400], [40, 10, 12, 8], [13000, 8000, 9000, 7000]]),
            "bonuses": [{"no_miss": 20, "leader": 20, "effort": 10}, {}, {}, {}]}
    r = call("pokeathlon_result_save", body)
    assert [x["points"][0] for x in r["rounds"]] == [143, 120, 126]      # 11500/80 s = 143, 3 x 40, 13000 / 1024 x 10
    base = [p["stars"][k] for p in call("pokeathlon_stats", {"species": ["Pikachu", "Eevee", "Machop"]})["pokemon"] for k in STARS]
    bonus = challenge_bonus(base)                                # the game's own stars count, whatever the team was given
    assert r["bonuses"][0]["challenge"] == bonus == 75 - sum(base) > 0
    assert r["total"] == 143 + 120 + 126 + bonus + 20 + 20 + 10 and r["won"] and r["place"] == 0 and r["new_best"]
    assert r["medal_bits"] == 1 and r["medals"]["es"] == ["Insignia Velocidad"] and r["medals"]["en"] == ["Speed Badge"]
    assert r["athlete_points"] == r["total"] + 100 and r["cheer"] == 10
    rec = call("pokeathlon_records", {})
    assert rec["courses"][0]["course"] == 0 and rec["courses"][0]["best_total"] == r["total"] and rec["courses"][0]["wins"] == 1
    assert {m["species"] for m in rec["medals"]} == {"Pikachu", "Eevee", "Machop"} and rec["medals"][0]["bits"] == 1
    assert rec["stats"]["courses"] == 1 and rec["stats"]["wins"] == 1 and rec["stats"]["popularity"] == 10
    by_event = {e["event"]: e for e in rec["events"]}
    assert by_event[0]["top"][0]["raw"] == 2400 and by_event[0]["beats_target"] and by_event[6]["top"][0]["raw"] == 13000
    # a second win in another course adds its badge to the same species; a better total in the first replaces the best
    body2 = {**body, "course": 4, "seed": "win2", "rounds": rounds(4, [[400, 60, 70], [3, 2, 1]][0:0] + [[400, 100, 200, 100], [40, 10, 10, 10], [2400, 4000, 4000, 4000]])}
    r2 = call("pokeathlon_result_save", body2)
    assert r2["won"] and r2["medal_bits"] == 16
    med = {m["species"]: m for m in call("pokeathlon_records", {})["medals"]}
    assert med["Pikachu"]["bits"] == 17 and not med["Pikachu"]["complete"]
    r3 = call("pokeathlon_result_save", {**body, "seed": "again", "rounds": rounds(0, [[2000, 4000, 3600, 4400], [50, 10, 12, 8], [14000, 8000, 9000, 7000]])})
    assert r3["new_best"] and r3["best_before"] == r["total"]
    assert call("pokeathlon_records", {})["courses"][0]["plays"] == 3
    hist = call("pokeathlon_history", {})["courses"]
    assert len(hist) == 3 and hist[0]["id"] == r3["id"]
    full = call("pokeathlon_history", {"id": r["id"]})
    assert full["detail"]["totals"][0] == r["total"] and full["detail"]["teams"][0]["mons"][0]["species"] == "Pikachu"


def test_losing_or_watching_gives_no_medal_and_the_trainer_keeps_its_own_records(call):
    t = call("trainer_random", {"seed": "athlon", "ai_level": "easy"})
    lose = {"course": 1, "seed": "lose", "trainer_id": t["id"], "teams": TEAMS, "team": 0,
            "rounds": rounds(1, [[10, 50, 60, 70], [10, 20, 30, 40], [0, 3, 1, 1]]), "bonuses": [{}, {}, {}, {}]}
    r = call("pokeathlon_result_save", lose)
    assert not r["won"] and r["place"] > 0 and r["medal_bits"] == 0 and not r["new_best"] and r["cheer"] <= 0
    rec = call("pokeathlon_records", {"trainer_id": t["id"]})
    assert rec["medals"] == [] and rec["courses"][0]["wins"] == 0 and rec["courses"][0]["best_total"] == 0
    assert call("pokeathlon_records", {})["stats"]["courses"] == 0           # the guest has nothing
    assert call("pokeathlon_records", {"everyone": True})["stats"]["courses"] == 1
    watch = call("pokeathlon_result_save", {**lose, "mode": "watch", "seed": "w", "rounds": rounds(1, [[100, 50, 60, 70], [90, 20, 30, 40], [3, 0, 1, 1]])})
    assert watch["won"] and watch["medal_bits"] == 0 and not watch["new_best"]
    assert call("pokeathlon_records", {"trainer_id": t["id"]})["stats"]["courses"] == 1       # watching is not a record
    assert len(call("pokeathlon_history", {"trainer_id": t["id"]})["courses"]) == 2
    call("pokeathlon_result_save", {**lose, "trainer_id": "nobody"}, status=404)


def test_the_supreme_cup_and_the_supreme_course_pay_more(call):
    win = {"course": 0, "supreme": True, "seed": "s", "teams": TEAMS, "team": 0, "rounds": rounds(0, [[2400, 4000, 3600, 4400], [40, 10, 12, 8], [13000, 8000, 9000, 7000]]),
           "bonuses": [{}, {}, {}, {}]}
    r = call("pokeathlon_result_save", win)
    assert r["supreme"] and r["athlete_points"] == r["total"] + 300
    assert call("pokeathlon_records", {})["courses"][0]["supreme"] is True
    master = {"course": 10, "seed": "m", "teams": TEAMS, "team": 0, "rounds": [{"event": e, "raw": [90, 30, 20, 10]} for e in MASTER_SETS[0]], "bonuses": [{}, {}, {}, {}]}
    m = call("pokeathlon_result_save", master)
    assert m["medal_bits"] == 0 and m["athlete_points"] == m["total"] * 2 + 500 and m["supreme"]
    call("pokeathlon_result_save", {**master, "rounds": [{"event": e, "raw": [1, 1, 1, 1]} for e in (0, 1, 2, 3)]}, status=400)


def test_a_save_is_checked(call):
    base = {"course": 0, "teams": TEAMS, "team": 0, "rounds": rounds(0, [[2400, 4000, 3600, 4400], [40, 10, 12, 8], [13000, 8000, 9000, 7000]]),
            "bonuses": [{}, {}, {}, {}]}
    assert "events" in call("pokeathlon_result_save", {**base, "rounds": [{"event": 1, "raw": [1, 2, 3, 4]}] * 3}, status=400)["error"]
    assert call("pokeathlon_result_save", {**base, "bonuses": [{"no_miss": 15}, {}, {}, {}]}, status=400)
    bad = [dict(TEAMS[0], mons=mons("A", "B", "C", stars={"speed": 9, "power": 3, "skill": 3, "stamina": 3, "jump": 3}))] + TEAMS[1:]
    assert call("pokeathlon_result_save", {**base, "teams": bad}, status=400)
    assert call("pokeathlon_result_save", {**base, "lots": [0, 0, 1, 2]}, status=400)
    assert call("pokeathlon_records", {})["stats"]["courses"] == 0


def test_event_data_is_consistent():
    assert [e["id"] for e in EVENTS] == list(range(10))
    for c in COURSES[:10]:
        assert len(set(c["events"])) == len(c["events"]) and len(c["events"]) == (3 if c["id"] < 5 else 4)
    for s in MASTER_SETS:
        assert len(set(s)) == 4
