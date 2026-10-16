"""The Pokéathlon: the stars of every Pokémon, the courses, the game's 100 rival teams, the rules that turn scores into points and
bonuses, and the records a trainer keeps."""

import pytest

from silvers_hoard import pokeathlon as pk
from silvers_hoard.agent_tools import tool_catalog

STATS = pk.STATS


def mon(species, **over):
    return {"species": species, "num": 0, "form": "", "name": species, "stars": {k: over.get(k, 3) for k in STATS}, "base": {}, "derived": False}


def team(name, species, human=False, npc=0, cpu=0):
    return {"name": name, "color": "#fff", "human": human, "cpu": cpu, "npc": npc, "mons": [mon(s) for s in species]}


TEAMS = [team("Yo", ("Pikachu", "Machamp", "Gyarados"), human=True), team("Rival A", ("Hoppip", "Oddish", "Bellsprout")),
         team("Rival B", ("Pikachu", "Teddiursa", "Vulpix")), team("Rival C", ("Skarmory", "Aerodactyl", "Gligar"))]
SPEED = ["hurdle_dash", "pennant_capture", "relay_run"]


def zero_counters():
    return [[dict.fromkeys(pk.COUNTERS, 0) for _ in range(3)] for _ in range(4)]


def payload(raws, course="speed", events=None, counters=None, **extra):
    events = events or SPEED
    rounds = [{"event": e, "raw": raw, **({"counters": counters[i]} if counters else {})} for i, (e, raw) in enumerate(zip(events, raws))]
    return {"course": course, "mode": "play", "seed": 7, "teams": TEAMS, "rounds": rounds, **extra}


# a team that wins the speed course whatever the rivals do
STRONG = [[1700, 3600, 3600, 3600], [60, 5, 5, 5], [8 * 1024, 1024, 1024, 1024]]


# ------------------------------------------------------------------------------------------------------------ the stars
def test_stars_of_the_cartridge_pokemon_come_from_its_table(call):
    got = {r["name"]: r for r in call("pokeathlon_stats", {"species": ["Bulbasaur", "Machamp"]})["species"]}
    bulba = got["Bulbasaur"]
    assert bulba["source"] == "rom" and bulba["derived"] is False and bulba["num"] == 1 and bulba["gen"] == 1
    assert {k: (v["base"], v["min"], v["max"]) for k, v in bulba["stars"].items()} == {
        "speed": (2, 2, 3), "power": (2, 2, 3), "skill": (3, 1, 4), "stamina": (3, 1, 4), "jump": (3, 3, 3)}
    assert {k: v["base"] for k, v in got["Machamp"]["stars"].items()} == {"speed": 1, "power": 5, "skill": 4, "stamina": 3, "jump": 2}


def test_stars_of_a_gen_9_pokemon_are_predicted_inside_the_one_to_five_range(call):
    r = call("pokeathlon_stats", {"species": ["Meowscarada", "Pikachu-Partner"]})
    assert [x["name"] for x in r["species"]] == ["Meowscarada", "Pikachu-Partner"] and r["missing"] == []
    mew = r["species"][0]
    assert mew["gen"] == 9 and mew["derived"] is True and mew["source"] == "derived" and mew["num"] == 908
    for s in mew["stars"].values():
        assert 1 <= s["min"] <= s["base"] <= s["max"] <= 5
    assert call("pokeathlon_stats", {"species": ["Missingno"]})["missing"] == ["Missingno"]


def test_the_whole_table_comes_with_limit_zero_and_filters_narrow_it(call):
    everything = call("pokeathlon_stats", {"limit": 0})
    assert everything["full"] is True and len(everything["species"]) == everything["total"] > 1300
    ids = {r["id"] for r in everything["species"]}
    assert {"pikachu", "machamp", "gyarados", "meowscarada", "rotomwash"} <= ids
    gen9 = call("pokeathlon_stats", {"gen": 9, "limit": 0})
    assert gen9["total"] > 100 and all(r["gen"] == 9 for r in gen9["species"]) and sum(r["derived"] for r in gen9["species"]) > 100
    own = call("pokeathlon_stats", {"derived": False, "limit": 0})
    assert own["total"] > 500 and all(not r["derived"] for r in own["species"])
    assert [r["num"] for r in call("pokeathlon_stats", {"query": "25"})["species"]][:1] == [25]
    assert len(call("pokeathlon_stats", {"limit": 5})["species"]) == 5


def test_a_forme_the_cartridge_has_plays_like_its_species_and_the_others_are_predicted(call):
    row = {r["name"]: r for r in call("pokeathlon_stats", {"species": ["Pikachu", "Pikachu-Partner", "Charizard-Mega-X"]})["species"]}
    assert row["Pikachu-Partner"]["source"] == "rom-forme" and row["Pikachu-Partner"]["inheritedFrom"] == "Pikachu"
    assert row["Pikachu-Partner"]["stars"] != row["Pikachu"]["stars"] or row["Pikachu"]["source"] == "rom"
    assert row["Charizard-Mega-X"]["derived"] is True and row["Charizard-Mega-X"]["baseSpecies"] == "Charizard"


# ------------------------------------------------------------------------------------------------------------ courses and rivals
def test_the_courses_and_the_events_they_play(call):
    r = call("pokeathlon_courses")
    by = {c["key"]: c for c in r["courses"]}
    assert list(by) == ["speed", "power", "skill", "stamina", "jump", "supreme"]
    assert by["speed"]["events"] == ["hurdle_dash", "pennant_capture", "relay_run"] and by["speed"]["medal_mask"] == 1
    assert by["jump"]["events"] == ["lamp_jump", "disc_catch", "hurdle_dash"] and by["jump"]["medal_mask"] == 16
    assert by["supreme"]["events"] == [] and len(by["supreme"]["sets"]) == 10 and all(len(s) == 4 for s in by["supreme"]["sets"])
    assert [e["id"] for e in r["events"]] == pk.EVENT_IDS and r["events"][0]["lower_is_better"] is True
    assert r["events"][6]["target"] == 12288 and r["events"][3]["trophy"] == 130
    assert by["speed"]["es"] == "Competición de Velocidad" and r["events"][3]["es"] == "Rompelosas"
    # every course plays three distinct events, the supreme sets four
    assert all(len(set(c["events"])) == 3 for c in r["courses"][:5])


def test_the_hundred_npc_teams_of_the_game(call):
    allteams = call("pokeathlon_npc_teams")["teams"]
    assert [t["team"] for t in allteams] == list(range(1, 101))
    susie = allteams[0]
    assert susie["name"] == "Susie" and [m["name"] for m in susie["mons"]] == ["Pikachu", "Teddiursa", "Vulpix"]
    assert susie["challenge"] == 30 and susie["stars_sum"] == 45 and susie["line_es"].startswith("¡Vaya") and not susie["supreme"]
    assert susie["mons"][0]["stars"] == {"power": 3, "speed": 3, "jump": 3, "stamina": 3, "skill": 3}
    for t in allteams:
        assert t["challenge"] == 75 - t["stars_sum"] and sum(sum(m["stars"].values()) for m in t["mons"]) == t["stars_sum"]
        assert t["supreme"] == (t["team"] > 50) and t["line_en"] and t["line_es"]
    normal = [t["stars_sum"] for t in allteams if t["team"] <= 25]
    hard = [t["stars_sum"] for t in allteams if t["team"] > 75]
    assert 31 <= min(normal) and max(normal) <= 45 and min(hard) >= 39 and max(hard) <= 48


def test_a_course_draws_its_rivals_from_five_teams_the_supreme_ones_from_twenty_five(call):
    assert call("pokeathlon_npc_teams", {"course": "speed"})["pool"] == [1, 2, 3, 4, 5]
    assert call("pokeathlon_npc_teams", {"course": "power"})["pool"] == [6, 7, 8, 9, 10]
    assert call("pokeathlon_npc_teams", {"course": "power", "supreme": True})["pool"] == [56, 57, 58, 59, 60]
    sup = call("pokeathlon_npc_teams", {"course": "supreme"})
    assert sup["pool"] == list(range(76, 101)) and [t["team"] for t in sup["teams"]] == sup["pool"]
    assert [t["team"] for t in call("pokeathlon_npc_teams", {"supreme": True})["teams"]] == list(range(51, 101))
    assert call("pokeathlon_npc_teams", {"team": 61})["teams"][0]["name"] == "Gilmore"
    assert call("pokeathlon_npc_teams", {"course": "nope"}, status=400)


# ------------------------------------------------------------------------------------------------------------ the rules
def test_ranks_are_competition_ranks_from_zero():
    assert pk.rank_scores([20, 20, 15, 10]) == [0, 0, 2, 3]
    assert pk.rank_scores([5, 9, 9, 1]) == [2, 0, 0, 3]
    assert pk.rank_scores([3000, 2400, 3000, 2500], lower_is_better=True) == [2, 0, 2, 1]


def test_event_points_follow_the_games_conversions():
    ep = pk.event_points
    assert ep("hurdle_dash", [3000, 1725, 1000, 6000]) == [115, 200, 200, 57]
    assert ep("pennant_capture", [35, 70, 0, 10]) == [105, 200, 0, 30]
    assert ep("circle_push", [40, 3, 1, 90]) == [120, 9, 3, 200]
    assert ep("block_smash", [80, 250, 0, 12]) == [80, 200, 0, 12]
    assert ep("disc_catch", [0, 40, 1000, 5]) == [30, 121, 148, 64]
    assert ep("lamp_jump", [350, 700, 0, 35]) == [100, 200, 0, 10]
    assert ep("relay_run", [12 * 1024, 12 * 1024 + 512, 30 * 1024, 0]) == [120, 125, 200, 0]
    assert ep("ring_drop", [70, 200, 1, 0]) == [105, 200, 1, 0]
    assert ep("snow_throw", [30, 0, 80, 1]) == [90, 0, 200, 3]
    with pytest.raises(Exception):
        ep("nope", [1, 2, 3, 4])


def test_goal_roll_pays_the_place_and_tied_teams_share_the_lowest_place_of_their_tie():
    assert pk.event_points("goal_roll", [3, 1, 2, 0]) == [100 + 15, 70 + 5, 80 + 10, 60]
    assert pk.event_points("goal_roll", [3, 3, 1, 0]) == [80 + 15, 80 + 15, 70 + 5, 60]
    assert pk.event_points("goal_roll", [2, 2, 2, 2]) == [60 + 10] * 4
    assert pk.event_points("goal_roll", [99, 0, 0, 0]) == [200, 60, 60, 60]


def test_challenge_bonus_is_seventy_five_minus_the_base_stars():
    assert pk.challenge_bonus([1] * 15) == 60 and pk.challenge_bonus([3] * 15) == 30 and pk.challenge_bonus([5] * 15) == 0
    assert pk.challenge_bonus([1] * 3) == 72 and pk.challenge_bonus([5] * 20) == 0


def counters(per=None):
    """per = {(team, slot): {counter: n}} over twelve empty Pokémon."""
    per = per or {}
    mons = zero_counters()
    for (t, s), c in per.items():
        mons[t][s].update(c)
    return mons


def test_no_miss_gives_ten_to_each_pokemon_that_never_failed_fell_or_hit_itself():
    got = pk.award_bonuses(counters({(0, 0): {"failed": 1}, (1, 2): {"fell": 3}, (3, 1): {"impeded": 1}}))
    assert got["no_miss"] == [20, 20, 30, 20]


def test_points_leader_gives_twenty_to_those_with_the_most_points_and_nothing_if_nobody_scored():
    assert pk.award_bonuses(counters())["points_leader"] == [0, 0, 0, 0]
    got = pk.award_bonuses(counters({(0, 0): {"points": 9}, (2, 1): {"points": 9}, (1, 0): {"points": 4}}))
    assert got["points_leader"] == [20, 0, 20, 0]


def test_prize_for_effort_takes_the_drawn_statistic_or_the_next_one_that_is_not_empty():
    mons = counters({(0, 0): {"hit": 4}, (1, 1): {"hit": 4}, (2, 0): {"dashed": 9}})
    got = pk.award_bonuses(mons, effort_kind=1)   # hit
    assert got["effort_kind"] == 1 and got["effort"] == [10, 10, 0, 0]
    got = pk.award_bonuses(mons, effort_kind=0)   # nobody jumped: the next kind with a value
    assert got["effort_kind"] == 1 and got["effort"] == [10, 10, 0, 0]
    got = pk.award_bonuses(mons, effort_kind=3)
    assert got["effort_kind"] == 3 and got["effort"] == [0, 0, 10, 0]
    none = pk.award_bonuses(counters())
    assert none["effort_kind"] == -1 and none["effort"] == [0, 0, 0, 0]


def test_a_tie_for_first_place_keeps_the_team_the_page_drew():
    assert pk.settle([100, 90, 80, 70]) == ([0, 1, 2, 3], 0, False)
    places, winner, tie = pk.settle([100, 100, 80, 80], winner=1)
    assert (places, winner, tie) == ([1, 0, 2, 2], 1, True)
    assert pk.settle([100, 100, 100, 5], winner=3)[1] == 0    # a team that is not tied cannot win the draw


# ------------------------------------------------------------------------------------------------------------ saving and reading
def base_sum(call, species):
    """The sum of the base stars of a team, from the table."""
    return sum(v["base"] for n in species for v in call("pokeathlon_stats", {"species": [n]})["species"][0]["stars"].values())


def test_a_course_is_checked_again_here_and_the_records_keep_the_best(call):
    cs = [zero_counters() for _ in range(3)]
    cs[1][0][0]["points"] = 12            # Pikachu scored the most
    cs[0][0][1]["hit"] = 2
    res = call("pokeathlon_result_save", payload(STRONG, counters=cs, bonuses={"challenge": [75] * 4, "no_miss": [30] * 4, "points_leader": [60] * 4, "effort": [30] * 4}))
    # whatever the page claimed, the bonuses are the ones the counters earn
    b = res["bonus"]
    assert b["challenge"] == [75 - base_sum(call, t) for t in (("Pikachu", "Machamp", "Gyarados"), ("Hoppip", "Oddish", "Bellsprout"),
                                                                ("Pikachu", "Teddiursa", "Vulpix"), ("Skarmory", "Aerodactyl", "Gligar"))]
    assert b["no_miss"] == [30, 30, 30, 30] and b["points_leader"] == [20, 0, 0, 0] and b["effort"] == [10, 0, 0, 0] and b["effort_kind"] == 1
    assert res["rounds"][0]["points"] == [200, 95, 95, 95] and res["rounds"][1]["points"] == [180, 15, 15, 15] and res["rounds"][2]["points"] == [80, 10, 10, 10]
    assert res["rounds"][0]["ranks"] == [0, 1, 1, 1] and res["rounds"][0]["raw"] == [1700, 3600, 3600, 3600]
    assert res["event_totals"][0] == 460
    assert res["totals"][0] == 460 + b["challenge"][0] + 30 + 20 + 10 and res["total"] == res["totals"][0]
    assert res["won"] is True and res["place"] == 0 and res["places"][0] == 0 and res["tie"] is False
    assert res["medal_mask"] == 1 and res["medals"]["es"] == ["Insignia Velocidad"] and res["medals"]["en"] == ["Speed Badge"]
    assert res["new_course_record"] is True and res["best_before"] == 0
    assert res["athlete_points"] == res["total"] + 100 and res["athlete_total"] == res["athlete_points"] and res["cheer"] == 10

    rec = call("pokeathlon_records")
    assert rec["totals"] == {"courses": 1, "wins": 1, "singles": 0} and rec["athlete_points"] == res["athlete_points"] and rec["popularity"] == 10
    card = rec["courses"]["speed"]
    assert card["best"] == res["total"] and card["plays"] == 1 and card["wins"] == 1 and card["best_id"] == res["id"]
    assert [m["species"] for m in rec["medals"]] == ["Gyarados", "Machamp", "Pikachu"] and all(m["mask"] == 1 for m in rec["medals"])
    assert rec["events"]["hurdle_dash"][0]["score"] == 1700 and rec["events"]["hurdle_dash"][0]["species"] == ["Pikachu", "Machamp", "Gyarados"]
    assert rec["events"]["pennant_capture"][0]["score"] == 60 and rec["events"]["relay_run"][0]["score"] == 8 * 1024
    assert rec["events"]["block_smash"] == [] and rec["event_stats"]["hurdle_dash"] == {"plays": 1, "firsts": 1}
    assert rec["recent"][0]["id"] == res["id"] and rec["recent"][0]["won"] is True

    # a worse win is not a record; a better one is, and the course keeps the better total
    worse = call("pokeathlon_result_save", payload([[2000, 3600, 3600, 3600], [40, 5, 5, 5], [6 * 1024, 1024, 1024, 1024]], counters=cs))
    assert worse["won"] and worse["total"] < res["total"] and worse["new_course_record"] is False and worse["best_before"] == res["total"]
    better = call("pokeathlon_result_save", payload([[1500, 3600, 3600, 3600], [70, 5, 5, 5], [12 * 1024, 1024, 1024, 1024]], counters=cs))
    assert better["new_course_record"] is True and better["total"] > res["total"]
    rec = call("pokeathlon_records")
    assert rec["courses"]["speed"]["best"] == better["total"] and rec["courses"]["speed"]["plays"] == 3
    assert [e["score"] for e in rec["events"]["hurdle_dash"]] == [1500, 1700, 2000]      # lower is better
    assert [e["score"] for e in rec["events"]["pennant_capture"]] == [70, 60, 40]
    detail = call("pokeathlon_history", {"id": better["id"]})
    assert detail["total"] == better["total"] and detail["detail"]["rounds"][0]["event"] == "hurdle_dash" and len(detail["detail"]["teams"]) == 4
    assert [c["id"] for c in call("pokeathlon_history")["courses"]][:1] == [better["id"]]


def test_a_course_the_person_loses_gives_no_medal_and_a_smaller_cheer(call):
    losing = [[3600, 1700, 3600, 3600], [5, 60, 5, 5], [1024, 8 * 1024, 1024, 1024]]
    res = call("pokeathlon_result_save", payload(losing, counters=[zero_counters() for _ in range(3)]))
    assert res["won"] is False and res["place"] >= 1 and res["medal_mask"] == 0 and res["new_course_record"] is False
    assert res["athlete_points"] == res["total"] and res["cheer"] in (5, 0, -5)
    rec = call("pokeathlon_records")
    assert rec["medals"] == [] and rec["courses"]["speed"]["wins"] == 0 and rec["courses"]["speed"]["best"] == 0
    assert rec["events"]["hurdle_dash"][0]["score"] == 3600     # the record of an event is kept even when the course is lost


def test_a_tie_for_first_is_settled_with_the_team_the_page_drew(call):
    even = [[3000] * 4, [10] * 4, [4096] * 4]
    zero = zero_counters()
    same = [team(f"T{i}", ("Pikachu", "Pikachu", "Pikachu"), human=i == 0) for i in range(4)]
    res = call("pokeathlon_result_save", {**payload(even, counters=[zero] * 3, winner=2), "teams": same})
    assert res["tie"] is True and res["winner"] == 2 and res["places"] == [1, 1, 0, 1] and res["won"] is False and res["medal_mask"] == 0
    res = call("pokeathlon_result_save", {**payload(even, counters=[zero] * 3, winner=0), "teams": same})
    assert res["winner"] == 0 and res["places"] == [0, 1, 1, 1] and res["won"] is True and res["medal_mask"] == 1


def test_the_supreme_course_doubles_the_total_and_the_supreme_cup_pays_a_bigger_win(call):
    sets = call("pokeathlon_courses")["courses"][-1]["sets"]
    evs = sets[0]
    raws = [[60, 5, 5, 5] if e != "hurdle_dash" else [1700, 3600, 3600, 3600] for e in evs]
    res = call("pokeathlon_result_save", payload(raws, course="supreme", events=evs, counters=[zero_counters() for _ in evs]))
    assert res["supreme"] is True and res["won"] is True and res["medal_mask"] == 0     # the supreme course has no medal
    assert res["athlete_points"] == res["total"] * 2 + 300
    assert call("pokeathlon_records")["courses"]["supreme"]["plays"] == 1
    # a normal course with the supreme cup switched on
    cup = call("pokeathlon_result_save", payload(STRONG, counters=[zero_counters() for _ in SPEED], supreme=True))
    assert cup["supreme"] is True and cup["medal_mask"] == 1 and cup["athlete_points"] == cup["total"] + 300
    rec = call("pokeathlon_records")
    assert rec["supreme_courses"]["speed"]["best"] == cup["total"] and "speed" not in rec["courses"]


def test_a_single_event_only_keeps_its_record(call):
    res = call("pokeathlon_result_save", {"course": "single", "teams": TEAMS, "rounds": [{"event": "block_smash", "raw": [90, 40, 30, 20]}]})
    assert res["places"] == [0, 1, 2, 3] and res["won"] is True and res["athlete_points"] == 0 and res["medal_mask"] == 0
    rec = call("pokeathlon_records")
    assert rec["totals"] == {"courses": 0, "wins": 0, "singles": 1} and rec["athlete_points"] == 0 and rec["courses"] == {}
    assert rec["events"]["block_smash"][0]["score"] == 90 and rec["medals"] == []
    # for the dash a lower time is better and a time of zero is not a time
    for frames in (2500, 0, 2300, 2900, 2600, 2400, 3000):
        call("pokeathlon_result_save", {"course": "single", "teams": TEAMS, "rounds": [{"event": "hurdle_dash", "raw": [frames, 9000, 9000, 9000]}]})
    assert [e["score"] for e in call("pokeathlon_records")["events"]["hurdle_dash"]] == [2300, 2400, 2500, 2600, 2900]


def test_watching_the_cpu_play_is_kept_in_the_history_but_not_in_the_records(call):
    res = call("pokeathlon_result_save", payload(STRONG, counters=[zero_counters() for _ in SPEED], mode="watch"))
    assert res["mode"] == "watch" and res["medal_mask"] == 0 and res["athlete_points"] == 0 and res["new_course_record"] is False
    rec = call("pokeathlon_records")
    assert rec["totals"]["courses"] == 0 and rec["medals"] == [] and rec["courses"] == {} and all(not v for v in rec["events"].values())
    assert call("pokeathlon_history")["courses"][0]["mode"] == "watch"


def test_bonuses_the_page_claims_are_checked_when_it_sends_no_counters(call):
    ok = call("pokeathlon_result_save", payload(STRONG, bonuses={"no_miss": [10, 0, 0, 0], "points_leader": [20, 0, 0, 0], "effort": [10, 0, 0, 0], "effort_kind": 0}))
    assert ok["bonus"]["no_miss"][0] == 10 and ok["bonus"]["points_leader"][0] == 20 and ok["bonus"]["effort_kind"] == 0
    assert ok["total"] == ok["event_totals"][0] + ok["bonus"]["challenge"][0] + 40
    for bad in ({"no_miss": [15, 0, 0, 0]}, {"points_leader": [0, 0, 0, 80]}, {"effort": [40, 0, 0, 0]}):
        assert call("pokeathlon_result_save", payload(STRONG, bonuses=bad), status=400)["error"]
    none = call("pokeathlon_result_save", payload(STRONG))
    assert none["bonus"]["no_miss"] == [0, 0, 0, 0] and none["total"] == none["event_totals"][0] + none["bonus"]["challenge"][0]


def test_the_challenge_bonus_of_a_game_team_is_the_games_own(call):
    npc = call("pokeathlon_npc_teams", {"team": 2})["teams"][0]
    teams = [dict(t) for t in TEAMS]
    teams[1] = {**teams[1], "npc": 2}
    res = call("pokeathlon_result_save", {**payload(STRONG, counters=[zero_counters() for _ in SPEED]), "teams": teams})
    assert res["bonus"]["challenge"][1] == npc["challenge"] == 42


def test_saving_refuses_what_cannot_be_a_course(call):
    zc = [zero_counters() for _ in SPEED]
    bad_events = payload(STRONG, events=["hurdle_dash", "relay_run", "pennant_capture"], counters=zc)
    assert "played in" in call("pokeathlon_result_save", bad_events, status=400)["error"]
    assert call("pokeathlon_result_save", payload(STRONG, course="nope", counters=zc), status=400)
    assert call("pokeathlon_result_save", payload(STRONG, events=["hurdle_dash", "hurdle_dash", "relay_run"], counters=zc), status=400)
    assert call("pokeathlon_result_save", payload([[1, 2, 3, 4]], course="supreme", events=["hurdle_dash"]), status=400)
    assert call("pokeathlon_result_save", payload([[1, 2, 3, 4]] * 2, course="single", events=["hurdle_dash", "relay_run"]), status=400)
    assert call("pokeathlon_result_save", payload([[1, 2, 3, 4]], course="single", events=["not_an_event"]), status=400)
    teams = [dict(t) for t in TEAMS]
    teams[0] = {**teams[0], "mons": [mon("Pikachu", speed=6), mon("Machamp"), mon("Gyarados")]}
    assert "stars" in call("pokeathlon_result_save", {**payload(STRONG), "teams": teams}, status=400)["error"]
    assert call("pokeathlon_result_save", {**payload(STRONG), "teams": TEAMS[:3]}, status=400)
    assert call("pokeathlon_result_save", payload(STRONG, trainer_id="nobody"), status=404)
    assert call("pokeathlon_records")["totals"]["courses"] == 0


def test_records_are_kept_per_trainer_and_everyone_can_be_read_together(call):
    from conftest import TEAM
    a = call("trainer_create", {"name": "Ana", "paste": TEAM})["id"]
    b = call("trainer_create", {"name": "Beto", "paste": TEAM})["id"]
    zc = [zero_counters() for _ in SPEED]
    call("pokeathlon_result_save", payload(STRONG, counters=zc, trainer_id=a))
    call("pokeathlon_result_save", payload([[1900, 3600, 3600, 3600], [50, 5, 5, 5], [6 * 1024, 1024, 1024, 1024]], counters=zc, trainer_id=b))
    assert call("pokeathlon_records", {"trainer_id": a})["events"]["hurdle_dash"][0]["score"] == 1700
    assert call("pokeathlon_records", {"trainer_id": b})["events"]["hurdle_dash"][0]["score"] == 1900
    assert call("pokeathlon_records")["totals"]["courses"] == 0          # the guest has nothing
    everyone = call("pokeathlon_records", {"everyone": True})
    assert everyone["totals"]["courses"] == 2 and [e["score"] for e in everyone["events"]["hurdle_dash"]] == [1700, 1900]
    assert len(call("pokeathlon_history", {"trainer_id": a})["courses"]) == 1


def test_the_athlete_points_and_the_popularity_have_their_caps(call, services):
    zc = [zero_counters() for _ in SPEED]
    for _ in range(3):
        call("pokeathlon_result_save", payload(STRONG, counters=zc))
    first = call("pokeathlon_records")
    assert first["athlete_points"] == sum(c["athlete_points"] for c in call("pokeathlon_history")["courses"]) and first["popularity"] == 30
    services.store.db.execute("UPDATE pokeathlon_courses SET athlete_points = 60000")
    assert call("pokeathlon_records")["athlete_points"] == 99999


def test_the_tools_are_in_the_catalogue():
    names = {t["name"] for t in tool_catalog()}
    assert {"pokeathlon_stats", "pokeathlon_courses", "pokeathlon_npc_teams", "pokeathlon_result_save", "pokeathlon_records", "pokeathlon_history"} <= names
