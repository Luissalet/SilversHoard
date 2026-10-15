from conftest import needs_engine, wait_for

pytestmark = needs_engine


def _trainer(call, name="Fábrica"):
    tr = call("trainer_create", {"name": name, "paste": "Pikachu\n- Thunderbolt\n"})
    return (tr.get("trainer") or tr)["id"]


def test_factory_pick_and_battle(call, services):
    tid = _trainer(call)   # one Pokémon is enough: the Factory lends the team
    run = call("challenge_start", {"kind": "facility", "target_id": "factory9", "challenger_id": tid})
    fac = run["factory"]
    assert fac["phase"] == "pick" and len(fac["rentals"]) == 6 and not run["stages"]
    call("challenge_next", {"id": run["id"]}, status=409)            # pick first
    call("factory_pick", {"id": run["id"], "picks": [0, 0, 1]}, status=400)
    r = call("factory_pick", {"id": run["id"], "picks": [4, 1, 2]})
    assert r["factory"]["phase"] == "battle" and [s["species"] for s in r["factory"]["team"]] == [fac["rentals"][i]["species"] for i in (4, 1, 2)]
    b = services.store.battle(r["stages"][0]["battle_id"])
    assert b["kind"] == "facility" and b["format"] == "gen9customgame" and b["level_rules"] == {"level": 50}
    assert [s["species"] for s in b["p1"]["sets"]] == [s["species"] for s in r["factory"]["team"]] and len(b["p2"]["sets"]) == 3
    call("factory_swap", {"id": run["id"], "give": 0, "take": 0}, status=409)   # not after a win yet
    call("battle_forfeit", {"id": b["id"], "side": "p1"})
    assert call("challenges_list", {"kind": "facility"})["challenges"][0]["status"] == "lost"


def test_factory_auto_then_swap(call):
    tid = _trainer(call, "Fábrica auto")
    run = call("challenge_start", {"kind": "facility", "target_id": "factory3", "challenger_id": tid, "auto": True, "stop_at": 1})

    def settled():
        r = next(x for x in call("challenges_list", {"kind": "facility"})["challenges"] if x["id"] == run["id"])
        return r if r["status"] == "lost" or (r["step"] >= 1 and r["factory"]["phase"] == "swap") else None

    r = wait_for(settled, timeout=600)
    if r["status"] == "lost":
        return
    offer = r["factory"]["offer"]
    assert len(offer) == 3
    call("factory_swap", {"id": run["id"], "give": 5, "take": 0}, status=400)
    nxt = call("factory_swap", {"id": run["id"], "give": 2, "take": 1})
    assert nxt["factory"]["team"][2]["species"] == offer[1]["species"] and nxt["factory"]["phase"] == "battle"
    second = nxt["stages"][1]["battle_id"]
    wait_for(lambda: call("battle_get", {"id": second})["status"] not in ("running", "live"), timeout=600)
