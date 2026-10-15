"""Team variant benchmark: shared seeds across variants, deltas vs a reference, no hall of fame writes."""

from conftest import needs_engine, wait_for


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
