"""The HeartGold/SoulSilver Battle Frontier (frontier.py, frontier_runs.py): the game's formulas and tables, and streaks at the Battle
Hall, Battle Arcade and Battle Castle through the tools (singles, doubles and multi with a partner, turn by turn and in real time),
with the start state reaching the battle."""

import pytest
from conftest import needs_engine, wait_for

from silvers_hoard import frontier, frontier_runs

TEAM = ("Gengar\nLevel: 100\n- Shadow Ball\n- Thunderbolt\n- Hypnosis\n- Explosion\n\n"
        "Garchomp @ Choice Scarf\nLevel: 100\n- Earthquake\n- Dragon Claw\n- Stone Edge\n- Fire Fang\n\n"
        "Starmie\nLevel: 50\n- Surf\n- Psychic\n- Ice Beam\n- Recover\n\n"
        "Pikachu\n- Thunderbolt\n- Quick Attack\n")


# ---------------------------------------------------------------- formulas and tables (no engine)
def test_lc_random_is_the_game_generator():
    assert frontier.LCRandom(0)() == 0   # 24691 >> 16
    for seed in (1, 0xDEADBEEF):
        r, state = frontier.LCRandom(seed), seed
        for _ in range(5):
            state = (state * 1103515245 + 24691) % 2**32
            assert r() == state >> 16
    assert frontier.lc("run", 3)() == frontier.lc("run", 3)() != frontier.lc("run", 4)()


def test_hall_level_matches_the_spec_table():
    assert [frontier.hall_level(10, k, 0) for k in range(10)] == list(range(1, 11))
    assert [frontier.hall_level(50, k, 0) for k in range(10)] == [29, 31, 32, 34, 35, 36, 38, 39, 41, 42]
    assert [frontier.hall_level(100, k, 0) for k in range(10)] == [70, 72, 74, 76, 78, 80, 82, 84, 86, 88]
    assert [frontier.hall_level(50, 0, o) for o in (0, 1, 2, 4, 8, 17)] == [29, 30, 30, 31, 33, 38]
    assert [frontier.hall_level(50, 9, o) for o in (0, 1, 2, 4, 8, 16)] == [42, 43, 43, 44, 46, 50]
    assert frontier.hall_level(50, 10, 0) == frontier.hall_level(50, 9, 0)   # tables use min(rank, 9)


def test_hall_rivals_follow_the_board():
    st = frontier.hall_new({"num": 94}, 50)
    for n in range(1, 21):
        frontier.hall_reset_if_maxed(st)
        cell = frontier.hall_auto_cell(st, frontier.lc("t", n))
        rival = frontier.hall_rival(st, n, cell, "run_t")
        s = frontier.data()["hall_sets"][rival["set_id"] - 1]
        assert frontier.hall_types()[cell] in s["types"] and s["dex"] != 94
        lo, hi = frontier.data()["hall"]["rank_ranges"][min(st["ranks"][cell], 9)]
        assert lo <= rival["set_id"] <= hi
        assert rival["seat"]["team"][0]["level"] == frontier.hall_level(50, st["ranks"][cell], frontier.hall_others(st["ranks"], cell))
        assert rival["iv"] == frontier.data()["hall"]["ivs_by_rank"][min(st["ranks"][cell], 9)]
        assert rival["set_id"] not in st["round_sets"]   # not twice in a round
        frontier.hall_after_win(st, rival, n)
    assert st["bp"] == 2 and st["rounds"] == 2   # 1 BP after rounds 1 and 2
    argenta = frontier.hall_rival(st, 50, 3, "run_t")
    assert argenta["boss"] and argenta["trainer"] == 307 and argenta["level"] == 50 and argenta["iv"] == 31
    gold = frontier.hall_rival(st, 170, 3, "run_t")
    assert 376 <= gold["set_id"] <= 477 and gold["name"].endswith("Argenta")
    st["ranks"] = [10] * 17 + [0]
    assert frontier.hall_reset_if_maxed(st) and st["ranks"][:17] == [9] * 17


def test_arcade_pools_odds_and_cursor():
    assert frontier.arcade_pool(0, 0) == [1, 2, 3, 6, 10, 11, 12, 15, 24, 25, 26, 30]
    assert frontier.arcade_pool(4, 1) == [0, 4, 5, 7, 8, 9, 13, 14, 16, 17, 24, 26, 27, 29, 30]
    assert frontier.arcade_pool(9, 6) == frontier.arcade_pool(6, 6)
    assert [frontier.arcade_odds_row(x) for x in (0, 4, 5, 10, 16, 21, 24)] == [4, 4, 3, 2, 1, 0, 0]
    assert [frontier.arcade_speed_start(r) for r in (0, 3, 4, 7)] == [3, 3, 4, 5]
    # colour frequencies over many boards follow the odds row (row 4 after a poor battle: 10/75/10/5)
    counts = [0, 0, 0, 0]
    for i in range(300):
        b = frontier.arcade_board(2, 0, 0, 3, False, frontier.lc("odds", i))
        for e in b["panels"]:
            counts[frontier.arcade_event(e)["colour"]] += 1
    shares = [c / sum(counts) for c in counts]
    assert abs(shares[1] - 0.75) < 0.04 and abs(shares[0] - 0.10) < 0.03
    # empty colour (round 4, 7th battle): colour 2 goes to the next colour, only "no event" there
    b = frontier.arcade_board(4, 6, 25, 3, False, frontier.lc("empty"))
    assert all(frontier.arcade_event(e)["colour"] != 2 for e in b["panels"])
    b = frontier.arcade_board(0, 0, 0, 3, False, frontier.lc("cursor"))
    assert b["delay"] == 4 and frontier.arcade_panel_at(b, 0) == b["start"] and frontier.arcade_panel_at(b, 8) == (b["start"] + 2) % 16
    r = frontier.arcade_board(0, 0, 0, 7, True, frontier.lc("random"))
    assert r["frames_per_step"] == 1 and frontier.arcade_panel_at(r, 5) == r["jumps"][4]


def test_arcade_events_respect_immunities():
    board = frontier.arcade_board(6, 0, 0, 3, False, frontier.lc("ev"))
    party = [{"species": "Pikachu", "types": ["Electric"], "ability": "Static"}, {"species": "Golem", "types": ["Rock", "Ground"], "ability": "Sturdy"},
             {"species": "Muk", "types": ["Poison"], "ability": "Stench"}]
    par = frontier.arcade_apply(11, board, party, party, frontier.lc("a"))
    assert par["hit"] == [0, 2] and par["start"]["p1"][1] == {}   # Ground is immune to the Arcade's paralysis
    psn = frontier.arcade_apply(1, board, party, party, frontier.lc("b"))
    assert psn["hit"] == [0, 1] and psn["start"]["p2"][0]["status"] == "psn"
    slp = frontier.arcade_apply(13, board, party, party, frontier.lc("c"))
    assert len(slp["hit"]) == 1 and 2 <= slp["start"]["p1"][slp["hit"][0]]["sleep_turns"] <= 5
    immune = [{"species": "Snorlax", "types": ["Normal"], "ability": "Insomnia"}]
    assert frontier.arcade_apply(4, board, party, immune, frontier.lc("d"))["lucky"]
    berry = frontier.arcade_apply(15, board, party, party, frontier.lc("e"))
    assert berry["give_item"]["item"] in frontier.data()["arcade"]["berries"]["6"]
    assert frontier.arcade_apply(23, board, party, party, frontier.lc("f"))["start"]["field"] == {"trickroom": 5}
    assert frontier.arcade_apply(22, board, party, party, frontier.lc("g"))["start"]["field"] == {"weather": "fog"}
    assert frontier.arcade_apply(31, board, party, party, frontier.lc("h"))["bp"] == 3
    assert frontier.arcade_apply(29, board, party, party, frontier.lc("i"))["skip"]
    end = [{"hp": 10, "maxhp": 100, "status": "par"}, {"hp": 0, "maxhp": 100, "fainted": True}, {"hp": 100, "maxhp": 100, "status": ""}]
    assert frontier.arcade_score(end, 2) == 6 + 4 + 10 and frontier.arcade_score([], 12) == 8 + 6


def test_castle_points_and_services():
    full = [{"hp": 100, "maxhp": 100, "pp": [10], "status": ""}] * 3
    assert frontier.castle_points(full, [[10]] * 3, 3)["total"] == 50   # the maximum of a 3-Pokémon single battle
    mixed = [{"hp": 60, "maxhp": 120, "pp": [4], "status": "brn"}, {"hp": 59, "maxhp": 120, "pp": [0], "status": ""},
             {"hp": 0, "maxhp": 100, "fainted": True, "pp": [0], "status": ""}]
    cp = frontier.castle_points(mixed, [[10], [10], [10]], 0)
    assert cp["per_mon"] == [5, 5] and cp["pp_used"] == 26 and cp["total"] == 10
    assert frontier.castle_points([{"hp": 0, "maxhp": 9, "fainted": True, "pp": [0]}], [[30]], 0)["total"] == 1
    st = frontier.castle_new()
    st["party"] = [{"species": "Gengar", "hp": 50, "maxhp": 120, "pp": [3, 8], "maxpp": [24, 8], "item": "", "status": ""}]
    rival = {"seat": {"team": [{"species": "Entei"}, {"species": "Gallade"}, {"species": "Empoleon"}]}}
    assert st["cp"] == 10
    with pytest.raises(frontier.Refusal) as e:
        frontier.castle_do(st, rival, "heal_pp", 0)
    assert e.value.code == "rank" and st["cp"] == 10
    assert frontier.castle_do(st, rival, "heal_hp", 0)["cost"] == 10 and st["party"][0]["hp"] == 120 and st["cp"] == 0
    with pytest.raises(frontier.Refusal):
        frontier.castle_do(st, rival, "heal_hp", 0)   # nothing to heal: refused, not charged
    st["cp"] = 300
    frontier.castle_do(st, rival, "heal_rank_up")
    frontier.castle_do(st, rival, "rental_rank_up")
    assert st["ranks"] == {"heal": 2, "rental": 2, "info": 1} and st["cp"] == 100
    frontier.castle_do(st, rival, "rent_item", 0, "Light Clay")
    with pytest.raises(frontier.Refusal) as e:
        frontier.castle_do(st, rival, "rent_berry", 0, "Lum Berry")
    assert e.value.code == "holding" and st["party"][0]["item"] == "Light Clay" and st["cp"] == 90
    with pytest.raises(frontier.Refusal) as e:
        frontier.castle_do(st, rival, "opp_stats", 1)
    assert e.value.code == "check_first"
    frontier.castle_do(st, rival, "opp_check", 1)
    assert frontier.castle_do(st, rival, "opp_check", 1).get("already") and st["cp"] == 89
    frontier.castle_do(st, rival, "opp_level_up", 2)
    assert frontier.castle_do(st, rival, "opp_level_down", 2)["level"] == 50 and st["cp"] == 89 - 1 - 15
    assert frontier.castle_skip_ok(22) and not frontier.castle_skip_ok(21) and not frontier.castle_skip_ok(49) and not frontier.castle_skip_ok(15)


def test_battle_points_and_brains():
    assert [frontier.round_bp("hall", r, r * 10) for r in (1, 4, 12, 18, 30)] == [1, 2, 6, 12, 12]
    assert frontier.round_bp("hall", 5, 50) == 20 and frontier.round_bp("hall", 17, 170) == 20
    assert [frontier.round_bp("arcade", r, r * 7 + 1) for r in (1, 5, 7, 8, 12)] == [2, 4, 5, 6, 6]
    assert [frontier.round_bp("castle", r, r * 7 + 1) for r in (1, 3, 7, 9)] == [3, 4, 7, 7]
    assert frontier.round_bp("castle", 3, 21) == 20 and frontier.round_bp("arcade", 7, 49) == 20
    dahlia = frontier.facility_rival("arcade", {}, 21, "run_b")
    assert dahlia["boss"] and [m["species"] for m in dahlia["seat"]["team"]] == ["Medicham", "Ludicolo", "Dusknoir"]
    assert all("item" not in m for m in dahlia["seat"]["team"]) and dahlia["iv"] == 31 and dahlia["seat"]["ai_level"] == "expert"
    darach = frontier.facility_rival("castle", {}, 49, "run_b")
    species = [m["species"] for m in darach["seat"]["team"]]
    assert len(set(species)) == 3 and set(species) <= {"Empoleon", "Gallade", "Entei"} and all(m.get("item") for m in darach["seat"]["team"])
    first = frontier.facility_rival("castle", {}, 1, "run_b")
    assert first["trainer"] < 99 and first["iv"] == 3 and first["seat"]["ai_level"] == "easy"
    thorton = frontier.thorton_team(21, "run_b")
    assert thorton["trainer"] == 309 and thorton["iv"] == 12 and all(351 <= i <= 486 for i in thorton["set_ids"])
    assert all(759 <= i <= 950 for i in frontier.thorton_team(49, "run_b")["set_ids"]) and frontier.thorton_team(22, "run_b") is None


def test_doubles_and_multi_rivals():
    assert [frontier.kind_of(x) for x in ("hall4_double", "arcade4_multi", "castle4", "tower4")] == ["hall", "arcade", "castle", ""]
    assert [frontier.mode_of(x) for x in ("hall4", "hall4_double", "castle4_multi")] == ["single", "double", "multi"]
    assert [frontier.party_size(k, m) for k, m in (("hall", "single"), ("hall", "double"), ("hall", "multi"), ("arcade", "double"), ("castle", "multi"))] \
        == [1, 2, 1, 3, 2]
    assert frontier.interleave([1, 2], ["a", "b"]) == [1, "a", 2, "b"] and frontier.owners_of(2, 2) == [0, 1, 0, 1]
    # Hall doubles: one set, two copies; no Argenta outside singles
    st = frontier.hall_new({"num": 94}, 50)
    st["mode"] = "double"
    duo = frontier.hall_rival(st, 1, 1, "run_d")
    a, b = duo["seat"]["team"]
    assert a["species"] == b["species"] and a["moves"] == b["moves"] and a["nature"] == b["nature"] and "owners" not in duo["seat"]
    assert not frontier.hall_rival(st, 50, 1, "run_d")["boss"]
    # Hall multi: the two trainers rolled, rank 9 (IV 26, AI 7) at the party level
    st["mode"] = "multi"
    pair = frontier.hall_rival(st, 1, 1, "run_m")
    assert pair["seat"]["owners"] == [0, 1] and pair["level"] == 50 and pair["iv"] == 26 and pair["seat"]["ai_level"] == "expert"
    assert pair["pair"]["trainer_id"] == pair["trainers_rolled"][1] and " y " in pair["name"] and " & " in pair["seat_name"]
    assert pair["seat"]["team"][0]["species"] == pair["seat"]["team"][1]["species"]
    lo, hi = frontier.data()["hall"]["rank_ranges"][9]
    assert lo <= pair["set_id"] <= hi
    # Arcade and Castle multi: battle n's trainer and battle n + 7's, two sets each, the second without the first's species or items
    for kind in ("arcade", "castle"):
        mst = {"mode": "multi"}
        rv = frontier.facility_rival(kind, mst, 3, "run_m")
        team = rv["seat"]["team"]
        assert len(team) == 4 and rv["seat"]["owners"] == [0, 1, 0, 1] and not rv["boss"]
        assert rv["trainer"] == mst["round_trainers"][2] and rv["pair"]["trainer_id"] == mst["round_trainers"][9]
        first, second = team[0::2], team[1::2]
        assert not {m["species"] for m in first} & {m["species"] for m in second}
        if kind == "castle":
            assert not {m.get("item") for m in first} & {m.get("item") for m in second}
        assert not frontier.facility_rival(kind, {"mode": "multi"}, 21, "run_m")["boss"]
    dbl = frontier.facility_rival("castle", {"mode": "double"}, 21, "run_m")
    assert not dbl["boss"] and len(dbl["seat"]["team"]) == 3
    # Battle Points: the multi tables, the Hall's multi 12 a round, no Brain round outside singles
    assert [frontier.round_bp("arcade", r, r * 7, "multi") for r in (1, 4, 8, 11)] == [7, 10, 17, 17]
    assert [frontier.round_bp("castle", r, r * 7, "multi") for r in (1, 3, 7, 9)] == [8, 11, 18, 18]
    assert frontier.round_bp("hall", 5, 50, "multi") == 12 and frontier.round_bp("hall", 5, 50, "double") == 2
    assert frontier.round_bp("castle", 3, 21, "double") == 4 and frontier.castle_skip_ok(49, "double") and not frontier.castle_skip_ok(49)
    # the facility's partners: their own sets, IV 31, none of the challenger's species
    mates = frontier.partner_sets(301, "castle", 50, frontier.lc("p"), ["Gengar"])
    assert len(mates) == 2 and all(m["level"] == 50 and "item" not in m and m["ivs"]["hp"] == 31 and m["species"] != "Gengar" for m in mates)
    assert len(frontier.partner_sets(300, "hall", 37, frontier.lc("p"))) == 1 and frontier.partner_card(303)["name"] == "Sémola"


def test_real_time_end_state():
    b = {"mode": "realtime", "summary": {"mode": "realtime", "seconds": 37.5, "sides": {"p1": {"pokemon": [
        {"species": "Gengar", "hp": 60, "maxhp": 135, "fainted": False, "status": "par", "item": "Sitrus Berry", "pp": [3, 0], "maxpp": [24, 16]},
        {"species": "Garchomp", "hp": 0, "maxhp": 183, "fainted": True, "status": "brn", "item": ""}]}, "p2": {"pokemon": []}}}}
    end = frontier_runs.end_state(b)
    assert end["turns"] == 7   # one turn every 6 s
    assert end["p1"][0] == {"index": 0, "species": "Gengar", "hp": 60, "maxhp": 135, "fainted": False, "status": "par", "item": "Sitrus Berry",
                            "pp": [3, 0], "maxpp": [24, 16]}
    assert end["p1"][1]["fainted"] and end["p1"][1]["hp"] == 0 and end["p1"][1]["status"] == "" and "pp" not in end["p1"][1]
    assert frontier_runs.end_state({"summary": {"end": {"turns": 3}}}) == {"turns": 3} and frontier_runs.end_state({"summary": {}}) == {}


# ---------------------------------------------------------------- streaks through the tools (engine)
def _trainer(call, name="Frente", paste=TEAM):
    tr = call("trainer_create", {"name": name, "paste": paste})
    return (tr.get("trainer") or tr)["id"]


@needs_engine
def test_facilities_list_and_brains(call, services):
    fac = {f["id"]: f for f in call("facilities_list", {})["facilities"]}
    assert fac["hall4"]["frontier"] == "hall" and fac["hall4"]["picks"] == 1 and fac["hall4"]["round"] == 10
    assert fac["arcade4"]["modes"] == ["classic", "realtime"] and fac["castle4"]["picks"] == 3
    assert [(b["key"], b["at"]) for b in fac["hall4"]["bosses"]] == [("argenta", 50), ("argenta", 170)]
    assert [(b["key"], b["at"]) for b in fac["factory4"]["bosses"]] == [("thorton", 21), ("thorton", 49)]
    assert fac["castle4"]["bosses"][0]["name"] == "Kokuran" and fac["arcade4"]["bosses"][0]["name"] == "Delila"
    assert call("character_get", {"key": "thorton"})["name_es"] == "Espinal"
    assert call("character_get", {"key": "argenta"})["variants"][1]["species"]
    stage = services._facility_stage({"id": "run_f", "target_id": "factory4", "step": 20})
    assert stage["boss"] and "Espinal" in stage["name"] and len(stage["seat"]["team"]) == 3


@needs_engine
def test_hall_streak(call, services):
    tid = _trainer(call, "Sala")
    call("challenge_start", {"kind": "facility", "target_id": "hall4", "challenger_id": tid, "picks": [5]}, status=400)
    run = call("challenge_start", {"kind": "facility", "target_id": "hall4", "challenger_id": tid, "picks": [2], "level": 50})
    fv = run["frontier"]
    assert fv["phase"] == "type" and len(fv["board"]) == 17 and not run["stages"] and fv["party"][0]["species"] == "Starmie"
    call("challenge_next", {"id": run["id"]}, status=409)   # pick a type first
    call("frontier_hall_pick", {"id": run["id"], "cell": "volcán"}, status=400)
    r = call("frontier_hall_pick", {"id": run["id"], "cell": "fuego"})
    assert r["frontier"]["phase"] == "battle" and r["stages"][0]["battle_id"] and "seat" not in r["stages"][0] or r["stages"][0]["battle_id"]
    b = services.store.battle(r["stages"][0]["battle_id"])
    assert b["format"] == "gen4customgame" and b["level_rules"] == {} and b["p1"]["sets"][0]["level"] == 50
    foe = b["p2"]["sets"][0]
    s = next(x for x in frontier.data()["hall_sets"] if x["species"] == foe["species"] and x["moves"] == foe["moves"])
    assert "Fire" in s["types"] and foe["level"] == frontier.hall_level(50, 0, 0) == 29
    # a win ranks Fire up and waits for the next type
    frontier_runs.after_battle(services, services.store.run(run["id"]), {"winner_side": "p1", "summary": {}})
    nxt = call("frontier_get", {"id": run["id"]})
    assert nxt["frontier"]["phase"] == "type" and nxt["frontier"]["board"][1]["rank"] == 1 and nxt["streak"] == 1
    r = call("frontier_hall_pick", {"id": run["id"], "cell": 1})
    foe = services.store.battle(r["stages"][1]["battle_id"])["p2"]["sets"][0]
    assert foe["level"] == frontier.hall_level(50, 1, 0) == 31
    call("battle_forfeit", {"id": r["stages"][1]["battle_id"], "side": "p1"})
    assert call("frontier_get", {"id": run["id"]})["status"] == "lost"


@needs_engine
def test_arcade_roulette_reaches_the_battle(call, services):
    tid = _trainer(call, "Ruleta")
    run = call("challenge_start", {"kind": "facility", "target_id": "arcade4", "challenger_id": tid, "picks": [0, 1, 2]})
    fv = run["frontier"]
    assert fv["phase"] == "board" and len(fv["board"]["panels"]) == 16 and fv["speed"] == 3 and fv["rival"]["name"]
    assert all(m["level"] == 50 and not m["item"] for m in fv["party"])   # capped at 50, no held items
    assert "seat" not in run["stages"][0]   # the rival stays hidden until its battle

    def force(panels):
        r = services.store.run(run["id"])
        ch = r["challenger"]
        ch["frontier"]["board"]["panels"] = panels
        services.store.update_run(run["id"], {"challenger": ch})

    force([19] * 16)   # Rain on every panel
    r = call("frontier_arcade_stop", {"id": run["id"], "panel": 5})
    assert r["frontier"]["event"]["event"] == 19 and r["frontier"]["phase"] == "battle"
    b = call("battle_choose", {"id": r["stages"][0]["battle_id"], "side": "p1", "choice": "team 123"})   # the field starts with the battle
    assert any(l.startswith("|-weather|RainDance") for l in call("battle_get", {"id": b["id"]})["lines"])
    assert services.store.battle(b["id"])["replay"]["start"]["field"] == {"weather": "raindance"}
    frontier_runs.after_battle(services, services.store.run(run["id"]), {"winner_side": "p1", "summary": {"end": {"turns": 4, "p1": []}}})
    force([29] * 16)   # skip: counts as a win, no battle
    r = call("frontier_arcade_stop", {"id": run["id"]})
    assert r["stages"][1]["result"] == "won" and r["stages"][1]["skipped"] and r["frontier"]["phase"] == "board" and r["streak"] == 2
    assert r["frontier"]["bp_gain"] == 20   # the skipped battle kept the score of the first one (no status, no faint, 4 turns)
    force([12] * 16)   # burn on the player's party
    r = call("frontier_arcade_stop", {"id": run["id"], "frames": 100})
    b = services.store.battle(r["stages"][2]["battle_id"])
    statuses = [x.get("status") for x in b["replay"]["start"]["p1"]]
    assert "brn" in statuses
    call("battle_forfeit", {"id": b["id"], "side": "p1"})


@needs_engine
def test_castle_points_carry_over(call, services):
    tid = _trainer(call, "Castillo")
    run = call("challenge_start", {"kind": "facility", "target_id": "castle4", "challenger_id": tid})
    fv = run["frontier"]
    assert fv["phase"] == "castle" and fv["cp"] == 10 and fv["ranks"] == {"heal": 1, "rental": 1, "info": 1}
    assert [m["level"] for m in fv["party"]] == [50, 50, 50] and fv["party"][1]["item"] == ""   # Choice Scarf left at the counter
    call("frontier_castle", {"id": run["id"], "service": "heal_hp", "mon": 0}, status=409)   # nothing to heal: no charge
    r = call("frontier_castle", {"id": run["id"], "service": "opp_check", "mon": 0})
    assert r["frontier"]["cp"] == 9 and r["frontier"]["scout"][0]["species"] and "species" not in r["frontier"]["scout"][1]
    call("frontier_castle", {"id": run["id"], "service": "opp_moves", "mon": 0}, status=409)   # info rank 2 needed
    r = call("frontier_castle", {"id": run["id"], "service": "opp_level_up", "mon": 1})
    assert r["frontier"]["cp"] == 8 and r["frontier"]["scout"][1]["level"] == 55
    r = call("frontier_castle", {"id": run["id"], "service": "go"})
    b = services.store.battle(r["stages"][0]["battle_id"])
    assert [x["level"] for x in b["p2"]["sets"]] == [50, 55, 50] and not any(x.get("item") for x in b["p1"]["sets"])
    party = r["frontier"]["party"]
    end = {"turns": 6, "p1": [
        {"index": 0, "hp": party[0]["maxhp"] // 3, "maxhp": party[0]["maxhp"], "status": "par", "pp": [p - 2 for p in party[0]["maxpp"]], "item": ""},
        {"index": 1, "hp": 0, "maxhp": party[1]["maxhp"], "fainted": True, "status": "", "pp": party[1]["maxpp"], "item": ""},
        {"index": 2, "hp": party[2]["maxhp"], "maxhp": party[2]["maxhp"], "status": "", "pp": party[2]["maxpp"], "item": ""}]}
    frontier_runs.after_battle(services, services.store.run(run["id"]), {"winner_side": "p1", "summary": {"end": end}})
    nxt = call("frontier_get", {"id": run["id"]})["frontier"]
    # 3+1 (alive, under half; paralysed) + 3+3+1 (full, no status) + 6 (8 PP used) + 7 (the rival at level 55) = 24
    assert nxt["cp"] == 8 + 24 and nxt["phase"] == "castle" and nxt["number"] == 2
    assert nxt["party"][0]["hp"] == party[0]["maxhp"] // 3 and nxt["party"][0]["status"] == "" and nxt["party"][1]["hp"] == 1
    r = call("frontier_castle", {"id": run["id"], "service": "go"})
    b = services.store.battle(r["stages"][1]["battle_id"])
    start = b["replay"]["start"]["p1"]
    assert start[0]["hp"] == party[0]["maxhp"] // 3 and start[1]["hp"] == 1 and start[0]["pp"] == [p - 2 for p in party[0]["maxpp"]]
    lines = call("battle_get", {"id": b["id"]})["lines"]
    assert any(l.startswith("|switch|p1a:") or l.startswith("|poke|p1|") for l in lines)
    call("battle_forfeit", {"id": b["id"], "side": "p1"})


@needs_engine
def test_castle_streak_plays_by_itself(call):
    tid = _trainer(call, "Castillo auto")
    run = call("challenge_start", {"kind": "facility", "target_id": "castle4", "challenger_id": tid, "auto": True, "stop_at": 1})

    def settled():
        r = call("frontier_get", {"id": run["id"]})
        return r if r["status"] == "lost" or (r["step"] >= 1 and r["frontier"]["phase"] == "castle") else None

    r = wait_for(settled, timeout=600)
    if r["status"] != "lost":
        assert r["frontier"]["cp"] >= 10 + 1 - 0 and r["stages"][0]["result"] == "won" and r["stages"][0]["after"]["cp"]["total"] >= 1


@needs_engine
def test_generation_four_rules(call):
    tid = _trainer(call, "Moderno", "Sprigatito\n- Leafage\n\nFuecoco\n- Ember\n\nQuaxly\n- Water Gun\n")
    call("challenge_start", {"kind": "facility", "target_id": "castle4", "challenger_id": tid}, status=400)
    run = call("challenge_start", {"kind": "facility", "target_id": "hall4", "challenger_id": tid, "format": "gen9customgame"})
    assert run["frontier"]["phase"] == "type"


@needs_engine
def test_doubles_hall(call, services):
    tid = _trainer(call, "Sala dobles")
    fac = {f["id"]: f for f in call("facilities_list", {})["facilities"]}
    assert fac["hall4_double"]["frontier_mode"] == "double" and fac["hall4_double"]["picks"] == 2 and fac["hall4_double"]["bosses"] == []
    run = call("challenge_start", {"kind": "facility", "target_id": "hall4_double", "challenger_id": tid, "picks": [0, 2]})
    assert run["frontier"]["mode"] == "double" and [m["species"] for m in run["frontier"]["party"]] == ["Gengar", "Starmie"]
    r = call("frontier_hall_pick", {"id": run["id"], "cell": "agua"})
    b = services.store.battle(r["stages"][0]["battle_id"])
    assert b["format"] == "gen4doublescustomgame" and len(b["p1"]["sets"]) == 2
    foes = b["p2"]["sets"]
    assert len(foes) == 2 and foes[0]["species"] == foes[1]["species"] and foes[0]["moves"] == foes[1]["moves"]
    state = call("battle_get", {"id": b["id"]})
    assert len(state["requests"]["p1"]["active"]) == 2
    call("battle_forfeit", {"id": b["id"], "side": "p1"})


@needs_engine
def test_multi_castle_with_a_partner(call, services):
    tid = _trainer(call, "Castillo multi")
    fac = {f["id"]: f for f in call("facilities_list", {})["facilities"]}
    assert fac["castle4_multi"]["picks"] == 2 and [p["id"] for p in fac["castle4_multi"]["partners"]] == ["300", "301", "302", "303", "304"]
    call("challenge_start", {"kind": "facility", "target_id": "castle4", "challenger_id": tid, "partner": "301"}, status=400)
    call("challenge_start", {"kind": "facility", "target_id": "castle4_multi", "challenger_id": tid, "partner": tid}, status=400)
    run = call("challenge_start", {"kind": "facility", "target_id": "castle4_multi", "challenger_id": tid, "partner": "301", "picks": [0, 2]})
    fv = run["frontier"]
    assert fv["mode"] == "multi" and fv["partner"]["name"] == "Maiza" and len(fv["partner"]["party"]) == 2 and len(fv["party"]) == 2
    assert fv["rival"]["pair"]["name"] and len(fv["scout"]) == 4
    r = call("frontier_castle", {"id": run["id"], "service": "go"})
    b = services.store.battle(r["stages"][0]["battle_id"])
    assert b["format"] == "gen4doublescustomgame" and b["p1"]["owners"] == [0, 1, 0, 1] and b["p2"]["owners"] == [0, 1, 0, 1]
    assert b["p1"]["partner"]["name"] == "Maiza" and b["p1"]["partner"]["ai"]["level"] == "expert"
    assert [x["species"] for x in b["p1"]["sets"][0::2]] == ["Gengar", "Starmie"]
    start = b["replay"]["start"]["p1"]
    assert start[1] == {} and start[3] == {} and start[0]["hp"] == fv["party"][0]["maxhp"]
    req = call("battle_get", {"id": b["id"]})["requests"]["p1"]
    assert req["partner_slots"] == [1] and [bool(p.get("partner")) for p in req["side"]["pokemon"]] == [False, True, False, True]
    call("battle_choose", {"id": b["id"], "side": "p1", "choice": "switch 4"}, status=400)   # the partner's
    call("battle_choose", {"id": b["id"], "side": "p1", "choice": "move 1 1"})
    party = fv["party"]
    end = {"turns": 5, "p1": [
        {"index": 0, "hp": 10, "maxhp": party[0]["maxhp"], "status": "", "pp": party[0]["maxpp"], "item": ""},
        {"index": 1, "hp": 0, "maxhp": 100, "fainted": True, "status": "", "item": ""},
        {"index": 2, "hp": party[1]["maxhp"], "maxhp": party[1]["maxhp"], "status": "", "pp": party[1]["maxpp"], "item": ""},
        {"index": 3, "hp": 1, "maxhp": 100, "status": "brn", "item": ""}]}
    frontier_runs.after_battle(services, services.store.run(run["id"]), {"winner_side": "p1", "summary": {"end": end}})
    nxt = call("frontier_get", {"id": run["id"]})["frontier"]
    # your half only: 3+1+1 (under half, no status) + 3+3+1 (full, no status) + 8 (no PP used) = 20
    assert nxt["cp"] == 10 + 20 and nxt["party"][0]["hp"] == 10 and nxt["party"][1]["hp"] == party[1]["maxhp"]
    call("battle_forfeit", {"id": b["id"], "side": "p1"})


@needs_engine
def test_multi_hall_with_your_own_trainer_as_partner(call, services):
    tid = _trainer(call, "Sala multi")
    mate = _trainer(call, "Compañera", "Blissey\n- Seismic Toss\n- Soft-Boiled\n\nSnorlax\n- Body Slam\n")
    run = call("challenge_start", {"kind": "facility", "target_id": "hall4_multi", "challenger_id": tid, "partner": mate, "picks": [1], "level": 50})
    fv = run["frontier"]
    assert fv["partner"]["kind"] == "trainer" and [m["species"] for m in fv["partner"]["party"]] == ["Blissey"] and fv["partner"]["party"][0]["level"] == 50
    r = call("frontier_hall_pick", {"id": run["id"], "cell": 0})
    b = services.store.battle(r["stages"][0]["battle_id"])
    assert [x["species"] for x in b["p1"]["sets"]] == ["Garchomp", "Blissey"] and b["p1"]["owners"] == [0, 1]
    foes = b["p2"]["sets"]
    assert len(foes) == 2 and foes[0]["species"] == foes[1]["species"] and foes[0]["level"] == 50 and b["p2"]["owners"] == [0, 1]
    assert " & " in b["p2"]["name"]
    call("battle_forfeit", {"id": b["id"], "side": "p1"})


@needs_engine
def test_real_time_arcade_and_castle(call, services):
    tid = _trainer(call, "Tiempo real")
    run = call("challenge_start", {"kind": "facility", "target_id": "arcade4", "challenger_id": tid, "mode": "realtime"})
    r = services.store.run(run["id"])
    ch = r["challenger"]
    ch["frontier"]["board"]["panels"] = [23] * 16   # Trick Room
    services.store.update_run(run["id"], {"challenger": ch})
    r = call("frontier_arcade_stop", {"id": run["id"], "panel": 0})
    b = call("battle_get", {"id": r["stages"][0]["battle_id"]})
    assert b["mode"] == "realtime" and b["rt"]["version"] == 9 and b["rt"]["spec"]["start"]["field"] == {"trickroom": 5}
    call("battle_forfeit", {"id": b["id"], "side": "p1"})
    run = call("challenge_start", {"kind": "facility", "target_id": "castle4", "challenger_id": tid, "mode": "realtime"})
    r = call("frontier_castle", {"id": run["id"], "service": "go"})
    b = call("battle_get", {"id": r["stages"][0]["battle_id"]})
    st = b["rt"]["spec"]["start"]["p1"]
    assert b["mode"] == "realtime" and st[0]["pp"] == st[0]["maxpp"] and st[0]["hp"] == st[0]["maxhp"]
