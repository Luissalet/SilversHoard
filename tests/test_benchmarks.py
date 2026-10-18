"""Team variant benchmark: shared seeds across variants, deltas vs a reference, no hall of fame writes."""

from conftest import needs_engine, wait_for
from silvers_hoard.errors import SilverError
import pytest
import threading


def _meta_data(services, monkeypatch):
    names = ["Bulbasaur", "Ivysaur", "Venusaur", "Charmander", "Charmeleon", "Charizard", "Squirtle", "Wartortle",
             "Blastoise", "Caterpie", "Metapod", "Butterfree", "Weedle", "Kakuna", "Beedrill", "Pidgey", "Pidgeotto", "Pidgeot"]
    monkeypatch.setattr(services.smogon, "top", lambda fmt, limit: {
        "format": "gen9ou", "battles": 1000, "species": [{"species": s, "usage": i + 1} for i, s in enumerate(names)]})
    monkeypatch.setattr(services, "sets_popular", lambda species, fmt: {
        "team_species": species, "format": "gen9ou", "sets": [{"moves": ["Splash"]}]})
    services.settings.update({"max_turns": 1})


@needs_engine
def test_metagame_job_reuses_exact_pool_and_preserves_trainers_records(services, monkeypatch, call):
    _meta_data(services, monkeypatch)
    candidate = services.trainer_create(name="Meta candidate", paste="Magikarp\n- Splash", format_="gen9customgame")
    before = services.store.trainers()
    job = call("benchmark_start", {"variant_ids": [candidate["id"]], "rival_source": "metagame",
                                    "format": "gen9customgame", "seed": "meta-job728", "games": 1})
    finished = wait_for(lambda: (x := services.job_get(job["id"]))["status"] in ("done", "failed") and x)
    assert finished["status"] == "done", finished
    result = finished["result"]
    assert len(result["metagame"]["pool"]) == len(result["variants"][0]["by_rival"]) == 100
    assert result["variants"][0]["played"] == 100 and result["hall_of_fame_touched"] is False
    assert result["variants"][0]["threats"] == []
    assert result["metagame"]["usage_format"] == "gen9ou"
    assert services.store.trainers() == before
    assert services.store.battles() == []
    # A historic repeat must never ask the provider for a new corpus.
    def unavailable(*args):
        raise AssertionError("historic sample attempted to fetch current data")
    monkeypatch.setattr(services.smogon, "top", unavailable)
    replay = call("benchmark_start", {"variant_ids": [candidate["id"]], "rival_source": "metagame",
                                       "format": "gen9customgame", "sample_job_id": job["id"], "games": 1})
    repeated = wait_for(lambda: (x := services.job_get(replay["id"]))["status"] in ("done", "failed") and x)
    assert repeated["status"] == "done", repeated
    assert repeated["result"]["metagame"] == result["metagame"]
    assert repeated["result"]["variants"] == result["variants"]
    assert str(repeated["result"]["seed"]) == str(result["seed"])
    assert services.store.trainers() == before and services.store.battles() == []
    with pytest.raises(SilverError, match="different format"):
        services.benchmarks.start(variant_ids=[candidate["id"]], rival_ids=[], rival_source="metagame",
                                  format_="gen9customgame", sample_job_id=job["id"], level_rules={"level": 50})


@needs_engine
def test_metagame_no_usage_finishes_with_zero_played_and_explicit_incomplete(services, monkeypatch):
    _meta_data(services, monkeypatch)
    monkeypatch.setattr(services.smogon, "top", lambda fmt, limit: {"format": "", "battles": 0, "species": []})
    candidate = services.trainer_create(name="No data", paste="Magikarp\n- Splash", format_="gen9customgame")
    job = services.benchmarks.start(variant_ids=[candidate["id"]], rival_ids=[], rival_source="metagame",
                                    format_="gen9customgame", seed="empty728", games=1)
    finished = wait_for(lambda: (x := services.job_get(job["id"]))["status"] in ("done", "failed") and x)
    assert finished["status"] == "done", finished
    assert finished["result"]["metagame"]["complete"] is False
    assert finished["result"]["metagame"]["reason"] == "insufficient_species"
    assert finished["result"]["variants"][0]["played"] == 0


@needs_engine
def test_metagame_job_cancels_during_corpus_loading(services, monkeypatch):
    _meta_data(services, monkeypatch)
    candidate = services.trainer_create(name="Cancel", paste="Magikarp\n- Splash", format_="gen9customgame")
    entered, release = threading.Event(), threading.Event()
    def slow_sets(species, fmt):
        entered.set()
        assert release.wait(10)
        return {"sets": []}
    def no_simulation(*args, **kwargs):
        raise AssertionError("cancelled corpus started battles")
    monkeypatch.setattr(services, "sets_popular", slow_sets)
    monkeypatch.setattr(services.engine, "run_job", no_simulation)
    try:
        job = services.benchmarks.start(variant_ids=[candidate["id"]], rival_ids=[], rival_source="metagame",
                                        format_="gen9customgame", seed="cancel728")
        assert entered.wait(10)
        services.job_cancel(job["id"])
    finally:
        release.set()
    finished = wait_for(lambda: (x := services.job_get(job["id"]))["status"] in ("cancelled", "failed", "done") and x)
    assert finished["status"] == "cancelled", finished
    assert services.store.battles() == []


def _trainers(call, n, prefix="bm"):
    return [call("trainer_random", {"seed": f"{prefix}{i}", "ai_level": "easy"})["id"] for i in range(n)]


@needs_engine
def test_benchmark_shared_seeds_and_deltas(call):
    variants = _trainers(call, 3, "bv")
    rivals = _trainers(call, 2, "br")
    hall_before = call("hall_of_fame", {})["hall"]
    job = call("benchmark_start", {
        "variant_ids": variants,
        "rival_ids": rivals,
        "reference_id": variants[0],
        "games": 2,
        "seed": "bench-test",
        "ai_level": "easy",
        "format": "gen9customgame",
    })
    assert job["kind"] == "benchmark" and job["status"] in ("queued", "running", "done")
    done = wait_for(lambda: (x := call("job_get", {"id": job["id"]}))["status"] == "done" and x, timeout=300)
    res = done["result"]
    assert res["reference_id"] == variants[0]
    assert res["hall_of_fame_touched"] is False
    assert len(res["variants"]) == 3
    assert call("hall_of_fame", {})["hall"] == hall_before
    ref = res["variants"][0]
    assert ref["delta"]["wins"] == 0 and ref["delta"]["win_rate"] == 0
    assert ref["wins"] + ref["losses"] + ref["ties"] == 4  # 2 rivals × 2 games
    for row in res["variants"][1:]:
        for ri, br in enumerate(row["by_rival"]):
            assert br["seeds"] == ref["by_rival"][ri]["seeds"]
        assert row["delta"]["wins"] == row["wins"] - ref["wins"]


@needs_engine
def test_benchmark_rejects_one_variant(call):
    a = _trainers(call, 1, "one")[0]
    r = _trainers(call, 1, "riv")[0]
    call("benchmark_start", {"variant_ids": [a], "rival_ids": [r]}, status=400)


@needs_engine
def test_benchmark_resolves_omitted_seed(call):
    variants = _trainers(call, 2, "bs")
    rivals = _trainers(call, 1, "bsr")
    job = call("benchmark_start", {
        "variant_ids": variants,
        "rival_ids": rivals,
        "games": 1,
        "ai_level": "easy",
        "format": "gen9customgame",
    })
    done = wait_for(lambda: (x := call("job_get", {"id": job["id"]}))["status"] == "done" and x, timeout=300)
    seed = done["result"]["seed"]
    assert seed not in (None, "")
    job2 = call("benchmark_start", {
        "variant_ids": variants,
        "rival_ids": rivals,
        "games": 1,
        "seed": str(seed),
        "ai_level": "easy",
        "format": "gen9customgame",
    })
    done2 = wait_for(lambda: (x := call("job_get", {"id": job2["id"]}))["status"] == "done" and x, timeout=300)
    assert done2["result"]["seed"] == seed or str(done2["result"]["seed"]) == str(seed)
    assert done2["result"]["variants"][0]["by_rival"][0]["seeds"] == done["result"]["variants"][0]["by_rival"][0]["seeds"]
