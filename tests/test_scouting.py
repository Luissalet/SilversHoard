from copy import deepcopy

import pytest

from silvers_hoard.scouting import encounter_species, public_species, scouting_history
from conftest import needs_engine, wait_for


def battle(id_, p1="you", p2="rival", **values):
    return {"id": id_, "status": "ended", "mode": "classic", "p1": {"trainer_id": p1},
            "p2": {"trainer_id": p2}, "replay": {}, "summary": {}, **values}


class History:
    def __init__(self, rows):
        self.rows = rows

    def battle(self, id_):
        return deepcopy(next(b for b in self.rows if b["id"] == id_))

    def battles(self, **_):
        return deepcopy(self.rows)


def test_public_protocol_uses_details_not_nicknames_and_folds_private_splits():
    lines = ["|switch|p1a: nickname|Pikachu, L50|100/100", "|split|p2",
             "|switch|p2a: Pikachu|Zoroark, L50|140/140", "|switch|p2a: Pikachu|Pikachu, L50|100/100",
             "|replace|p2a: Pikachu|Zoroark, L50|100/100", "|-formechange|p1a: nickname|Pikachu-Rock-Star|[msg]",
             "|move|p1a: nickname|Surf|p2a: Pikachu"]
    result = public_species(lines)
    assert result["p1"] == ["Pikachu", "Pikachu-Rock-Star"]
    assert result["p2"] == ["Pikachu", "Zoroark"]
    # A private illusion species is not an observation before the public replacement.
    assert public_species(lines[:4])["p2"] == ["Pikachu"]


def test_legacy_omniscient_switch_is_not_public_evidence():
    b = battle("old", log_text="|switch|p1a: hidden|Zoroark, L50|140/140\n|win|you")
    b["p1"]["sets"] = [{"species": "Zoroark"}, {"species": "Mew"}]
    b["summary"] = {"sides": {"p1": {"pokemon": [{"species": "Zoroark", "switches": 1}]}}}
    assert encounter_species(b, "p1")["species"] == []
    assert encounter_species(b, "p1")["coverage"] == "none"


def test_legacy_explicit_preview_does_not_include_private_switches():
    b = battle("preview", log_text="|poke|p1|Pikachu, L50|\n|poke|p1|Eevee, L50|\n|teampreview|\n"
               "|switch|p1a: hidden|Zoroark, L50|140/140")
    assert encounter_species(b, "p1")["species"] == ["Pikachu", "Eevee"]
    assert encounter_species(b, "p1")["source"] == "legacy_preview"


def test_finished_public_snapshot_survives_changed_current_team():
    b = battle("saved", replay={"scouting": public_species(["|switch|p1a: A|Eevee, L50|100/100"])})
    b["p1"]["sets"] = [{"species": "Mewtwo"}]
    assert encounter_species(b, "p1")["species"] == ["Eevee"]


def test_rt_only_deployed_members_without_name_matching():
    b = battle("rt", mode="realtime", summary={"sides": {"p1": {"pokemon": [
        {"name": "same", "species": "Pikachu", "switches": 1},
        {"name": "same", "species": "Mew", "switches": 0},
        {"name": "same", "species": "Eevee"}]}}, "ai_notes": [{"species": "Mewtwo"}]})
    assert encounter_species(b, "p1")["species"] == ["Pikachu"]
    assert encounter_species(b, "p1")["coverage"] == "partial"


def test_history_matches_both_ids_in_reversed_seats_ignores_names_and_live():
    def record(id_, p1, p2, species, side="p1", **values):
        return battle(id_, p1, p2, replay={"scouting": public_species([f"|switch|{side}a: X|{species}, L50|1/1"])}, **values)
    anchor = record("anchor", "you", "rival", "Eevee")
    reverse = record("reverse", "rival", "you", "Pikachu", "p2")
    wrong = record("homonym", "other", "rival", "Mewtwo")
    live = record("live", "you", "rival", "Mew", status="live")
    for b in (anchor, reverse, wrong, live):
        b["p1"]["name"] = b["p2"]["name"] = "renamed"
    store = History([anchor, reverse, wrong, live])
    before = deepcopy(store.rows)
    result = scouting_history(store, "anchor", "p2")
    assert result["species"] == ["Eevee", "Pikachu"]
    assert [(r["id"], r["observed_side"]) for r in result["encounters"]] == [("anchor", "p1"), ("reverse", "p2")]
    assert store.rows == before


def test_direct_seats_only_use_explicit_encounters_and_orientation():
    a = battle("a", "", "", replay={"scouting": public_species(["|switch|p1a: X|Eevee|1/1"])})
    b = battle("b", "", "", replay={"scouting": public_species(["|switch|p2a: X|Pikachu|1/1"])})
    store = History([a, b])
    assert scouting_history(store, "a", "p2")["species"] == ["Eevee"]
    result = scouting_history(store, "a", "p2", encounters=[{"id": "b", "rival_side": "p1"}])
    assert result["species"] == ["Eevee", "Pikachu"]


@pytest.mark.parametrize("side", ["host", "", "p3"])
def test_invalid_orientation(side):
    with pytest.raises(Exception, match="p1 or p2"):
        scouting_history(History([battle("a")]), "a", side)


def test_live_anchor_is_not_scouted_even_with_public_data():
    a = battle("a", status="live", replay={"scouting": public_species(["|switch|p1a: X|Mew|1/1"])})
    with pytest.raises(Exception, match="finished"):
        scouting_history(History([a]), "a", "p2")


@needs_engine
def test_finished_classic_captures_public_view_before_engine_close(services):
    b = services.battle_start(p1={"name": "A", "human": True, "team": [
        {"species": "Zoroark", "ability": "Illusion", "moves": ["Splash"]},
        {"species": "Pikachu", "moves": ["Splash"]}]},
        p2={"name": "B", "human": True, "team": [{"species": "Eevee", "moves": ["Splash"]}]},
        format_="gen5customgame", rules=["!Team Preview"])
    assert not b["requests"]["p1"].get("teamPreview")
    public = services.engine.call("match_log", {"id": b["id"], "view": "spectator"})["lines"]
    expected = public_species(public)
    assert expected["p1"] == ["Pikachu"]
    services.battle_forfeit(b["id"], side="p1")
    saved = services.store.battle(b["id"])
    assert saved["replay"]["scouting"] == expected
    assert encounter_species(saved, "p1")["species"] == ["Pikachu"]


def finished_fixture(services, fmt="gen9customgame", observed="Gyarados"):
    you = services.trainer_create(name="Same", team=[{"species": "Eevee", "moves": ["Splash"]}])
    rival = services.trainer_create(name="Same", team=[{"species": "Snorlax", "moves": ["Tackle"]}])
    id_ = services.store.add_battle({"kind": "play", "status": "ended", "format": fmt,
        "p1": {"trainer_id": you["id"], "name": "old name", "sets": [{"species": "Mewtwo"}]},
        "p2": {"trainer_id": rival["id"], "name": "old rival", "sets": rival["team"]},
        "replay": {"scouting": public_species([f"|switch|p1a: X|{observed}|1/1"])}})
    return id_, rival


def popular_data(monkeypatch, services, names=("Pikachu", "Venusaur")):
    monkeypatch.setattr(services.smogon, "top", lambda fmt, n: {"format": fmt, "species": [
        {"species": name, "usage": 10} for name in names]})
    def popular(name, fmt, **_):
        return {"set": {"name": "popular", "moves": ["Thunderbolt" if name == "Pikachu" else "Giga Drain"],
                        "ability": "", "item": "", "nature": "", "evs": {}, "ivs": {}, "teraType": ""},
                "source": "smogon", "format": fmt}
    monkeypatch.setattr(services.smogon, "popular_set", popular)


@needs_engine
def test_scout_api_uses_real_popular_set_builder_and_validates_without_saving(call, services, monkeypatch):
    id_, rival = finished_fixture(services)
    popular_data(monkeypatch, services)
    before = deepcopy(services.store.battle(id_))
    calls = []
    original = services.team_popular_sets
    def observe(*args, **kwargs):
        calls.append(kwargs)
        return original(*args, **kwargs)
    monkeypatch.setattr(services, "team_popular_sets", observe)
    job = call("rival_scout", {"id": id_, "rival_side": "p2", "size": 1})
    result = wait_for(lambda: (j if (j := services.job_get(job["id"]))["status"] in ("done", "failed") else None))
    assert result["status"] == "done", result
    out = result["result"]
    assert out["status"] == "ready" and out["team"][0]["species"] == "Pikachu"
    assert out["choices"][0]["coverage"] == [{"species": "Gyarados", "move_type": "Electric", "multiplier": 4}]
    assert services.validate_team(out["format"], out["team"])["ok"]
    assert all(c["save"] is False and not c.get("trainer_id") for c in calls)
    assert services.store.trainer(rival["id"])["team"] == rival["team"]
    assert services.store.battle(id_) == before
    assert len(services.store.battles(limit=-1)) == 1


@needs_engine
def test_scout_no_evidence_avoids_provider_and_retains_original(services, monkeypatch):
    id_, rival = finished_fixture(services)
    services.store.update_battle(id_, {"replay": {}, "log_text": "|switch|p1a: X|Mewtwo|100/100"})
    def forbidden(*_):
        raise AssertionError("No provider call without public evidence")
    monkeypatch.setattr(services.smogon, "top", forbidden)
    job = services.rival_scout(id_)
    done = wait_for(lambda: (j if (j := services.job_get(job["id"]))["status"] == "done" else None))
    assert done["result"]["reason"] == "no_public_observations"
    assert done["result"]["team"] == []
    assert done["result"]["original_team"] == rival["team"]


@needs_engine
def test_scout_rejects_whole_illegal_proposal_and_leaves_rival_untouched(services, monkeypatch):
    id_, rival = finished_fixture(services, "gen9ou")
    popular_data(monkeypatch, services, names=("Mewtwo",))
    job = services.rival_scout(id_)
    done = wait_for(lambda: (j if (j := services.job_get(job["id"]))["status"] in ("done", "failed") else None))
    assert done["status"] == "done", done
    assert done["result"]["reason"] == "invalid_proposal"
    assert done["result"]["problems"] and done["result"]["team"] == []
    assert services.store.trainer(rival["id"])["team"] == rival["team"]


@needs_engine
def test_scout_source_follows_chosen_set_when_mega_normalization_shares_species(services, monkeypatch):
    id_, _ = finished_fixture(services, observed="Scizor")
    monkeypatch.setattr(services.smogon, "top", lambda fmt, n: {"format": fmt, "species": [
        {"species": "Charizard", "usage": 20}, {"species": "Charizard-Mega-X", "usage": 10}]})
    def builder(names, **kwargs):
        mega = names[0].endswith("Mega-X")
        return {"team": [{"species": "Charizard", "moves": ["Dragon Claw" if mega else "Flamethrower"],
                          "item": "Charizardite X" if mega else ""}], "unresolved": [],
                "members": [{"asked": names[0], "set_name": "Mega" if mega else "Base", "source_format": kwargs["format_"]}]}
    monkeypatch.setattr(services, "team_popular_sets", builder)
    job = services.rival_scout(id_)
    done = wait_for(lambda: (j if (j := services.job_get(job["id"]))["status"] in ("done", "failed") else None))
    assert done["status"] == "done", done
    out = done["result"]
    assert out["status"] == "ready" and out["team"][0]["moves"] == ["Flamethrower"]
    assert out["choices"][0]["source"]["asked"] == "Charizard"
