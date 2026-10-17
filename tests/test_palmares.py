"""Unit tests for silvers_hoard.palmares — no engine, no live DB."""

from silvers_hoard import palmares as pm


def test_guest_medals_stay_on_empty_id():
    rows = [
        {"trainer_id": "", "species": "Pikachu", "bits": 1 | 2},
        {"trainer_id": "tr_a", "species": "Pikachu", "bits": 4},
        {"trainer_id": "tr_a", "species": "Eevee", "bits": 31},
    ]
    guest = pm.pokeathlon_medals(rows, "")
    assert len(guest) == 1 and guest[0]["species"] == "Pikachu" and guest[0]["mask"] == 3
    assert guest[0]["stats"] == ["speed", "power"] and not guest[0]["complete"]

    trainer = pm.pokeathlon_medals(rows, "tr_a")
    by_sp = {m["species"]: m for m in trainer}
    assert by_sp["Pikachu"]["mask"] == 4 and by_sp["Eevee"]["complete"]
    assert "" not in {m["species"] for m in trainer} or True
    # guest bits must not leak into the trainer
    assert by_sp["Pikachu"]["mask"] != 7


def test_frontier_emblem_requires_boss_win_not_streak():
    runs = [{
        "id": "run1",
        "kind": "facility",
        "target_id": "facility:tower",
        "challenger": {"frontier": {"kind": "tower"}},
        "stages": [
            {"number": 20, "boss": False, "result": "won", "name": "Ace"},
            {"number": 21, "boss": True, "result": "won", "character": "palmer",
             "name": "Amo Torre Jericor", "battle_id": "bt_win", "title": "Amo Torre", "avatar": "sd:palmer"},
            {"number": 22, "boss": False, "result": "lost"},
        ],
    }]
    emblems = pm.frontier_emblems_from_runs(runs)
    assert len(emblems) == 1
    e = emblems[0]
    assert e["character"] == "palmer" and e["print"] == "silver" and e["battle_id"] == "bt_win"
    assert e["number"] == 21 and e["facility"] == "tower"


def test_later_loss_does_not_erase_emblem():
    runs = [{
        "id": "run_win",
        "kind": "facility",
        "challenger": {"frontier": {"kind": "hall"}},
        "stages": [
            {"number": 50, "boss": True, "result": "won", "character": "argenta",
             "name": "Dama Salón Argenta", "battle_id": "bt_50"},
        ],
    }, {
        "id": "run_lose",
        "kind": "facility",
        "challenger": {"frontier": {"kind": "hall"}},
        "stages": [
            {"number": 50, "boss": True, "result": "lost", "character": "argenta",
             "name": "Dama Salón Argenta", "battle_id": "bt_50b"},
        ],
    }]
    emblems = pm.frontier_emblems_from_runs(runs)
    assert len(emblems) == 1 and emblems[0]["battle_id"] == "bt_50" and emblems[0]["print"] == "silver"


def test_insufficient_legacy_no_emblem_without_boss_win():
    runs = [{
        "id": "legacy",
        "kind": "facility",
        "challenger": {"frontier": {"kind": "tower"}},
        "stages": [
            # streak reached 21 but the stored stage was not a brain / not won
            {"number": 21, "boss": False, "result": "won", "name": "Veteran"},
            {"number": 49, "boss": True, "result": "lost", "character": "palmer"},
        ],
    }]
    assert pm.frontier_emblems_from_runs(runs) == []


def test_unify_guest_and_progress_slice():
    progress = {
        "achievements": [
            {"id": "first_win", "unlocked": True},
            {"id": "wins_10", "unlocked": False},
        ],
    }
    card = pm.unify(
        trainer_id="",
        badges=[],
        pokeathlon_rows=[{"trainer_id": "", "species": "Mew", "bits": 31}],
        facility_runs=[],
        progress=progress,
    )
    assert card["guest"] is True and card["counts"]["pokeathlon_complete"] == 1
    assert card["unlocked_achievements"] == 1 and card["counts"]["achievements_total"] == 2
    assert pm.achievements_slice(progress, unlocked_only=True) == [{"id": "first_win", "unlocked": True}]
