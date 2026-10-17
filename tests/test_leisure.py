import copy

import pytest

from conftest import needs_engine

pytestmark = needs_engine


def trainer(call):
    return call("trainer_create", {"name": "Contest host", "format": "gen9customgame", "team": [{"species": "Pikachu", "moves": ["Thunderbolt", "Growl", "Agility", "Quick Attack"]}]})


def finish_contest(call, id_, *, bad_dance=False):
    state = call("contest_get", {"id": id_})
    state = call("contest_choose", {"id": id_, "revision": state["revision"], "accessories": ["star", "crown", "heart"]})
    state = call("contest_choose", {"id": id_, "revision": state["revision"], "steps": [(s + int(bad_dance)) % 4 for s in state["dance"]], "timing": [0] * 8})
    for i in range(4):
        state = call("contest_choose", {"id": id_, "revision": state["revision"], "move": i, "judge": i % 3})
    return state


def test_contest_three_phases_persist_without_changing_battles_or_trainer(call, services):
    host = trainer(call)
    before = copy.deepcopy(services.store.trainer(host["id"]))
    started = call("contest_start", {"trainer_id": host["id"], "seed": "contest-proof", "category": "Cool"})
    assert len(started["entrants"]) == 4 and len(started["voltage"]) == 3
    done = finish_contest(call, started["id"])
    assert done["phase"] == "result" and done["status"] == "done" and done["round"] == 4
    assert done["entrants"][0]["scores"][1] == 32
    assert done["ribbon"] == (done["place"] == 1)
    assert call("contest_get", {"id": done["id"]}) == done
    assert any(c["id"] == done["id"] for c in call("contests_list")["contests"])
    assert services.store.trainer(host["id"]) == before
    assert services.store.battles() == []
    call("contest_choose", {"id": done["id"], "revision": done["revision"], "move": 0}, status=400)


def test_contest_seed_dance_and_revision_checks(call):
    host = trainer(call)
    a = call("contest_start", {"trainer_id": host["id"], "seed": "same"})
    b = call("contest_start", {"trainer_id": host["id"], "seed": "same"})
    assert a["entrants"] == b["entrants"] and a["dance"] == b["dance"]
    bad = finish_contest(call, a["id"], bad_dance=True)
    good = finish_contest(call, b["id"])
    assert bad["entrants"][0]["scores"][1] == 0
    assert good["entrants"][0]["scores"][1] == 32
    assert bad["entrants"][1:] == good["entrants"][1:]
    c = call("contest_start", {"trainer_id": host["id"]})
    call("contest_choose", {"id": c["id"], "revision": 0, "accessories": ["missing"]}, status=400)
    call("contest_choose", {"id": c["id"], "revision": 0, "accessories": ["star", "star"]}, status=400)
    call("contest_choose", {"id": c["id"], "revision": 0, "accessories": []})
    call("contest_choose", {"id": c["id"], "revision": 0, "accessories": []}, status=400)
    assert call("contest_get", {"id": c["id"]})["revision"] == 1
    call("contest_choose", {"id": c["id"], "revision": 1, "steps": [0] * 8, "timing": [99999] * 8}, status=400)


def test_base_roundtrip_archive_and_real_host_battle(call, services):
    host = trainer(call)
    before = services.store.trainer(host["id"])
    base = call("secret_base_save", {"name": "Tree room", "trainer_id": host["id"], "decorations": [
        {"kind": "plant", "x": 1, "y": 1}, {"kind": "doll", "species": "Eevee", "x": 6, "y": 4}, {"kind": "rug", "x": 3, "y": 3}]})
    exported = call("secret_base_export", {"id": base["id"]})
    assert "id" not in exported["base"] and "trainer_id" not in exported["base"]
    imported = call("secret_base_import", {"payload": exported})
    assert imported["id"] != base["id"] and imported["trainer_id"] == ""
    assert imported["team"] == base["team"] and imported["decorations"] == base["decorations"]
    for b in [base, imported]:
        battle = call("secret_base_battle", {"id": b["id"], "trainer_id": host["id"]})
        assert services.store.battle(battle["id"])["p2"]["sets"] == host["team"]
        call("battle_forfeit", {"id": battle["id"], "side": "p1"})
    assert services.store.trainer(host["id"])["team"] == before["team"]
    archived = call("secret_base_save", {**{k: base[k] for k in ("id", "name", "trainer_id", "decorations", "style", "message")}, "archived": True})
    assert not any(b["id"] == base["id"] for b in call("secret_bases_list")["bases"])
    assert archived in call("secret_bases_list", {"archived": True})["bases"]
    call("secret_base_save", {**{k: base[k] for k in ("id", "name", "trainer_id", "decorations", "style", "message")}, "archived": False})
    assert any(b["id"] == base["id"] for b in call("secret_bases_list")["bases"])


@pytest.mark.parametrize("decorations", [
    [{"kind": "plant", "x": 3, "y": 7}], [{"kind": "plant", "x": 3, "y": 1}],
    [{"kind": "plant", "x": -1, "y": 1}], [{"kind": "unknown", "x": 1, "y": 1}],
    [{"kind": "plant", "x": 1, "y": 1}] * 2,
    [{"kind": "plant", "x": x, "y": 4} for x in range(8)],
])
def test_base_rejects_overlap_or_inaccessible_host(call, decorations):
    call("secret_base_save", {"name": "Blocked", "decorations": decorations}, status=400)
    assert call("secret_bases_list")["bases"] == []
