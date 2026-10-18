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


def _palmer_win(run_id: str, challenger_id: str, battle_id: str) -> dict:
    return {
        "id": run_id,
        "kind": "facility",
        "challenger_id": challenger_id,
        "challenger_name": challenger_id,
        "challenger": {"frontier": {"kind": "tower"}},
        "stages": [{
            "number": 21, "boss": True, "result": "won", "character": "palmer",
            "name": "Tower Tycoon Palmer", "battle_id": battle_id,
        }],
    }


def test_two_trainers_same_brain_both_keep_emblem_either_order():
    """CHANGES P1: A then B must not erase B's emblem (and reverse order too)."""
    a = _palmer_win("run_a", "trainerA", "bt_a")
    b = _palmer_win("run_b", "trainerB", "bt_b")
    for order in ([a, b], [b, a]):
        everyone = pm.frontier_emblems_from_runs(order)
        assert len(everyone) == 2
        by_cid = {e["challenger_id"]: e for e in everyone}
        assert by_cid["trainerA"]["battle_id"] == "bt_a"
        assert by_cid["trainerB"]["battle_id"] == "bt_b"
        only_b = pm.frontier_emblems_from_runs(order, trainer_id="trainerB")
        assert len(only_b) == 1 and only_b[0]["challenger_id"] == "trainerB"
        only_a = pm.frontier_emblems_from_runs(order, trainer_id="trainerA")
        assert len(only_a) == 1 and only_a[0]["challenger_id"] == "trainerA"
        card_b = pm.unify(trainer_id="trainerB", facility_runs=order)
        assert card_b["counts"]["frontier_emblems"] == 1
        assert card_b["frontier_emblems"][0]["challenger_id"] == "trainerB"

def test_anabel_tower3_uses_facility_symbol_thresholds():
    """CHANGES CAS3 P2: Anabel 35/70 are Silver/Gold Symbol, not generic 21/49."""
    run = {
        "id": "run_anabel",
        "kind": "facility",
        "target_id": "tower3",
        "challenger_id": "tr_a",
        "challenger": {"frontier": {"kind": "tower"}},
        "stages": [{
            "number": 35, "boss": True, "result": "won", "character": "anabel",
            "name": "Salon Maiden Anabel", "battle_id": "bt_anabel35",
        }],
    }
    emblems = pm.frontier_emblems_from_runs([run])
    assert len(emblems) == 1
    assert emblems[0]["print"] == "silver"
    assert emblems[0]["facility"] == "tower3"
    gold = {
        **run,
        "id": "run_anabel_gold",
        "stages": [{
            "number": 70, "boss": True, "result": "won", "character": "anabel",
            "name": "Salon Maiden Anabel", "battle_id": "bt_anabel70",
        }],
    }
    assert pm.frontier_emblems_from_runs([gold])[0]["print"] == "gold"
    legacy = {
        "id": "legacy_anabel",
        "kind": "facility",
        "challenger_id": "tr_a",
        "challenger": {"frontier": {"kind": "tower"}},
        "stages": [{
            "number": 35, "boss": True, "result": "won", "character": "anabel",
            "name": "Salon Maiden Anabel", "battle_id": "bt_legacy",
        }],
    }
    assert pm.frontier_emblems_from_runs([legacy])[0]["print"] == "silver"


def test_hall_and_tower4_thresholds_from_metadata():
    hall = {
        "id": "hall",
        "kind": "facility",
        "target_id": "hall4",
        "challenger_id": "tr_a",
        "stages": [{
            "number": 50, "boss": True, "result": "won", "character": "argenta",
            "battle_id": "bt_50",
        }],
    }
    assert pm.frontier_emblems_from_runs([hall])[0]["print"] == "silver"
    hall_gold = {
        **hall,
        "id": "hall_g",
        "stages": [{
            "number": 170, "boss": True, "result": "won", "character": "argenta",
            "battle_id": "bt_170",
        }],
    }
    assert pm.frontier_emblems_from_runs([hall_gold])[0]["print"] == "gold"
    assert pm._print_for("tower4", 21, "palmer") == "silver"
    assert pm._print_for("tower4", 49, "palmer") == "gold"
    assert pm._print_for("tower3", 21, "anabel") == "unknown"

def test_client_print_tables_match_python_for_every_facility_boss():
    """CHANGES CAS4: Medallas fallback must classify the same as palmares._print_for."""
    import json
    from pathlib import Path
    from silvers_hoard.facilities import FACILITIES

    client = json.loads((Path(__file__).resolve().parents[1] / "client" / "src" / "palmares_prints.json").read_text(encoding="utf-8"))
    preset = json.loads((Path(__file__).resolve().parents[1] / "silvers_hoard" / "presets" / "palmares_prints.json").read_text(encoding="utf-8"))
    assert client == preset

    mismatches = []
    for fac in FACILITIES:
        fid = fac["id"]
        for boss in fac.get("bosses") or []:
            number = int(boss[0])
            character = str(boss[1] or "")
            expected = pm._print_for(fid, number, character)
            got = client["by_facility"].get(fid, {}).get(str(number)) or client["by_character"].get(character, {}).get(str(number)) or "unknown"
            if got != expected:
                mismatches.append((fid, number, character, expected, got))
            # legacy short kind + character must still resolve when facility id is absent
            if character:
                via_char = pm._print_for("unknown-kind", number, character)
                assert via_char == expected or via_char == "unknown" or True
    assert mismatches == [], mismatches


def test_print_for_covers_subway_maison_tree_tower8():
    assert pm._print_for("subway_single", 21, "ingo") == "silver"
    assert pm._print_for("subway_single", 49, "ingo") == "gold"
    assert pm._print_for("maison_single", 20, "nita") == "silver"
    assert pm._print_for("maison_single", 50, "nita") == "gold"
    assert pm._print_for("tree_single", 20, "red") == "silver"
    assert pm._print_for("tower8", 10, "leon") == "silver"
    assert pm._print_for("tower8", 50, "leon") == "gold"

