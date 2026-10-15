"""The sprite drawn by Prospero's Hoard, against a fake that keeps Prospero's real contract: tool names and arguments of its
catalogue, a mandatory reason on writes, unknown arguments refused, jobs that answer asset ids, pictures read by asset id."""
import io

import pytest
from PIL import Image

from silvers_hoard import services as services_mod
from silvers_hoard.services import Services

from conftest import needs_engine, wait_for

ARGS = {
    "studio_projects": {"query", "limit", "offset"},
    "studio_create_project": {"name", "brief", "image_engine"},
    "studio_import": {"project", "path", "kind"},
    "studio_generate_image": {"project", "prompt", "reference_asset_ids", "count", "aspect", "engine"},
    "studio_job": {"job_id", "wait_s"},
    "studio_cancel_job": {"job_id"},
    "studio_edit_image": {"asset_id", "operation"},
}
WRITES = {"studio_create_project", "studio_import", "studio_generate_image", "studio_cancel_job", "studio_edit_image"}


def picture() -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (64, 64), (200, 40, 60)).save(buf, "PNG")
    return buf.getvalue()


class FakeProspero:
    def __init__(self, matting=True):
        self.calls, self.polls, self.matting = [], 0, matting

    def call(self, app, tool, arguments=None, timeout=120.0):
        args = dict(arguments or {})
        assert app == "prospero"
        self.calls.append((tool, dict(args)))
        if tool in WRITES:
            if len(str(args.pop("reason", ""))) < 3:
                return {"ok": False, "status": 400, "error": "reason_required"}
        unknown = set(args) - ARGS[tool]
        if unknown:
            return {"ok": False, "status": 400, "error": f"unknown_argument {sorted(unknown)}"}
        if tool == "studio_projects":
            return {"ok": True, "result": {"items": [], "total": 0}}
        if tool == "studio_create_project":
            return {"ok": True, "result": {"id": "pj_1", "name": args["name"]}}
        if tool == "studio_import":
            self.imports = getattr(self, "imports", 0) + 1
            return {"ok": True, "result": {"id": f"as_photo{self.imports}", "kind": "image"}}
        if tool == "studio_generate_image":
            if args.get("aspect", "1:1") not in ("1:1", "9:16", "16:9", "2:3", "3:2", "4:5"):
                return {"ok": False, "status": 400, "error": "aspect must be one of 1:1, 9:16, 16:9, 2:3, 3:2, 4:5"}
            self.generated = args
            return {"ok": True, "result": {"job": {"id": "jb_1", "state": "queued", "progress": 0}}}
        if tool == "studio_edit_image":
            if not self.matting:
                return {"ok": False, "status": 400, "error": "model_missing: birefnet.safetensors"}
            return {"ok": True, "result": {"job": {"id": "jb_cut_" + args["asset_id"], "state": "queued"}}}
        if tool == "studio_job" and args["job_id"].startswith("jb_cut_"):
            return {"ok": True, "result": {"id": args["job_id"], "state": "done", "asset_ids": [args["job_id"][7:] + "_cut"]}}
        if tool == "studio_job":
            self.polls += 1
            if self.polls == 1:
                return {"ok": True, "result": {"id": "jb_1", "state": "waiting_gpu", "progress": 0}}
            return {"ok": True, "result": {"id": "jb_1", "state": "done", "progress": 1, "asset_ids": ["as_a", "as_b"]}}
        return {"ok": False, "error": "unexpected"}


@pytest.fixture
def prospero(monkeypatch):
    fake = FakeProspero()
    monkeypatch.setattr(services_mod.family, "call", fake.call)
    monkeypatch.setattr(Services, "_prospero_url", staticmethod(lambda: "http://prospero.test"))
    fetched = []

    def fake_file(base, asset_id):
        fetched.append((base, asset_id))
        return picture()
    monkeypatch.setattr(Services, "_prospero_file", staticmethod(fake_file))
    fake.fetched = fetched
    return fake


@needs_engine
def test_prospero_sprite_follows_the_contract(services, prospero):
    t = services.trainer_create(name="Luz", paste="Pikachu\n- Thunderbolt\n")
    trainer_id = t["id"]
    out = services.avatar_from_photo(picture(), trainer_id=trainer_id, mode="prospero")
    job_id = (out.get("job") or out).get("id")
    job = services.job_get(job_id)
    for _ in range(100):
        if (job.get("job") or job).get("status") in ("done", "failed", "error", "cancelled"):
            break
        import time
        time.sleep(0.05)
        job = services.job_get(job_id)
    j = job.get("job") or job
    assert j.get("status") == "done", j
    result = j.get("result") or {}
    assert len(result["candidates"]) == 2
    assert all(c["drawing"]["file"].endswith(".png") for c in result["candidates"])
    refs = prospero.generated["reference_asset_ids"]
    assert refs[0] == "as_photo1" and len(refs) == 2          # the photo, then the style sprites (identical here: one reference)
    assert "Draw the person shown in image 1 " in prospero.generated["prompt"]
    assert "Image 2 is only a style reference" in prospero.generated["prompt"]
    assert [a for _, a in prospero.fetched] == ["as_a_cut", "as_b_cut"]
    assert all(c["cutout"] for c in result["candidates"])
    assert all(b == "http://prospero.test" for b, _ in prospero.fetched)
    tools = [t for t, _ in prospero.calls]
    assert tools[:3] == ["studio_projects", "studio_create_project", "studio_import"]
    assert tools.index("studio_generate_image") > tools.index("studio_import")
    assert all("reason" in a for t, a in prospero.calls if t in WRITES)
    assert services.store.trainer(trainer_id)["avatar"] == result["candidates"][0]["avatar"]


def run_job(services, out):
    import time
    job_id = (out.get("job") or out).get("id")
    for _ in range(200):
        j = services.job_get(job_id)
        j = j.get("job") or j
        if j.get("status") in ("done", "failed", "cancelled"):
            return j
        time.sleep(0.05)
    raise AssertionError("job did not finish")


def test_prospero_sprite_from_several_photos_and_a_description(services, prospero):
    j = run_job(services, services.avatar_draw([picture(), picture(), picture()], description="black jacket, headphones"))
    assert j["status"] == "done", j
    assert prospero.generated["reference_asset_ids"][:3] == ["as_photo1", "as_photo2", "as_photo3"]
    assert "images 1 to 3 (black jacket, headphones)" in prospero.generated["prompt"]
    assert "Image 4 is only a style reference" in prospero.generated["prompt"]


def test_prospero_sprite_from_a_description_only(services, prospero):
    j = run_job(services, services.avatar_draw([], description="a sailor with a red cap", style=False))
    assert j["status"] == "done", j
    assert "reference_asset_ids" not in prospero.generated
    assert prospero.generated["prompt"].startswith("Draw a sailor with a red cap as an original")
    assert not any(t == "studio_import" for t, _ in prospero.calls)


def test_style_references_are_imported_once_and_follow_the_photos(services, prospero):
    from PIL import Image
    services.avatar_style_set(add=[("official-art.png", picture())])
    info = services.avatar_style_get()
    assert info["used"][0] == info["images"][0]["file"] and len(info["used"]) == 3
    sheets = services.style_reference_paths()
    assert len(sheets) == 1 and Image.open(sheets[0]).width > Image.open(sheets[0]).height   # three pictures, one sheet side by side
    run_job(services, services.avatar_draw([], description="a sailor"))
    first = prospero.generated["reference_asset_ids"]
    imports = sum(1 for t, _ in prospero.calls if t == "studio_import")
    run_job(services, services.avatar_draw([], description="a sailor"))
    assert prospero.generated["reference_asset_ids"] == first             # the same Prospero assets again
    assert sum(1 for t, _ in prospero.calls if t == "studio_import") == imports
    assert prospero.generated["prompt"].startswith("Draw a sailor as an original") and "Image 1 shows" not in prospero.generated["prompt"]
    assert ("Images 1 to 2 show" in prospero.generated["prompt"]) == (len(first) == 2)
    services.avatar_style_set(remove=[info["images"][0]["file"]], sprites="")
    assert services.avatar_style_get()["used"] == []
    w, h = Image.open(services.style_reference_paths()[0]).size if services.style_reference_paths() else (0, 0)
    assert (w, h) == (0, 0)


def test_settings_store_only_changes_and_drop_old_defaults(tmp_path):
    import json
    from silvers_hoard.config import DEFAULT_SETTINGS, PREVIOUS_DEFAULTS, Settings
    path = tmp_path / "settings.json"
    path.write_text(json.dumps({"prospero_prompt": PREVIOUS_DEFAULTS["prospero_prompt"][0], "player_name": "Ana"}))
    st = Settings(path)
    assert st["prospero_prompt"] == DEFAULT_SETTINGS["prospero_prompt"] and st["player_name"] == "Ana"
    st.update({"playback_ms": 500})
    stored = json.loads(path.read_text())
    assert stored == {"player_name": "Ana", "playback_ms": 500}


def test_avatar_draw_needs_a_photo_or_a_description(services):
    from silvers_hoard.errors import SilverError
    with pytest.raises(SilverError):
        services.avatar_draw([], description="  ")


def test_prospero_sprite_falls_back_to_the_local_cut_without_matting(services, prospero):
    prospero.matting = False
    j = run_job(services, services.avatar_draw([], description="a hiker"))
    assert j["status"] == "done", j
    assert [a for _, a in prospero.fetched][-2:] == ["as_a", "as_b"]
    assert not any(c["cutout"] for c in j["result"]["candidates"])


def test_local_cut_clears_background_enclosed_by_the_subject_at_the_edges():
    from PIL import Image, ImageDraw
    from silvers_hoard.sprites import cut_background
    img = Image.new("RGB", (60, 80), "white")
    d = ImageDraw.Draw(img)
    d.rectangle((15, 10, 45, 50), fill=(20, 40, 120))      # body
    d.rectangle((15, 50, 24, 79), fill=(20, 40, 120))      # left leg, touching the bottom edge
    d.rectangle((36, 50, 45, 79), fill=(20, 40, 120))      # right leg, touching the bottom edge
    out = cut_background(img)
    assert out.getpixel((30, 70))[3] == 0                  # the gap between the legs is open at the bottom: cleared
    assert out.getpixel((30, 30))[3] == 255                # the body stays


def test_a_job_cancelled_while_queued_never_starts(services):
    import threading
    gate, ran = threading.Event(), []

    def work(name):
        def run(jid, progress, cancelled):
            ran.append(name)
            gate.wait(5)
            return {}
        return run
    workers = services.pool._max_workers
    busy = [services._job("avatar", f"busy {i}", {}, work(f"busy{i}")) for i in range(workers)]
    queued = services._job("avatar", "waiting", {}, work("waiting"))
    qid = (queued.get("job") or queued)["id"]
    out = services.job_cancel(qid)
    assert (out.get("job") or out)["status"] == "cancelled"
    gate.set()
    for b in busy:
        run_job(services, b)
    import time
    time.sleep(0.3)
    assert "waiting" not in ran
    assert (services.job_get(qid).get("job") or services.job_get(qid))["status"] == "cancelled"


def test_a_hub_hiccup_while_waiting_does_not_fail_the_sprite(services, prospero, monkeypatch):
    monkeypatch.setattr(Services, "PROSPERO_RETRY_S", 0.0)
    real = prospero.call
    misses = {"n": 0}

    def flaky(app, tool, arguments=None, timeout=120.0):
        if tool == "studio_job" and not str((arguments or {}).get("job_id", "")).startswith("jb_cut_") and misses["n"] < 2:
            misses["n"] += 1
            return {"ok": False, "status": None, "error": "hub not reachable at http://127.0.0.1:8810"}
        return real(app, tool, arguments, timeout)
    monkeypatch.setattr(services_mod.family, "call", flaky)
    j = run_job(services, services.avatar_draw([], description="a fisherman", style=False))
    assert j["status"] == "done", j
    assert misses["n"] == 2


def test_the_render_of_a_sprite_job_is_remembered_and_cancelled_after_a_restart(services, prospero):
    import time
    j = run_job(services, services.avatar_draw([], description="a gardener", style=False))
    assert j["args"]["prospero_job"] == "jb_1"
    jid = services.store.add_job({"kind": "avatar", "title": "left behind", "status": "running", "args": {"prospero_job": "jb_left"}})
    services.start()                                   # what a restart does with the work it finds unfinished
    for _ in range(100):
        if any(t == "studio_cancel_job" and a.get("job_id") == "jb_left" for t, a in prospero.calls):
            break
        time.sleep(0.02)
    assert any(t == "studio_cancel_job" and a.get("job_id") == "jb_left" for t, a in prospero.calls)
    assert services.store.job(jid)["status"] == "failed"
