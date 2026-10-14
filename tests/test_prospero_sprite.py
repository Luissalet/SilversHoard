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
    "studio_generate_image": {"project", "prompt", "reference_asset_ids", "count", "aspect"},
    "studio_job": {"job_id", "wait_s"},
    "studio_cancel_job": {"job_id"},
}
WRITES = {"studio_create_project", "studio_import", "studio_generate_image", "studio_cancel_job"}


def picture() -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (64, 64), (200, 40, 60)).save(buf, "PNG")
    return buf.getvalue()


class FakeProspero:
    def __init__(self):
        self.calls, self.polls = [], 0

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
            return {"ok": True, "result": {"id": "as_photo", "kind": "image"}}
        if tool == "studio_generate_image":
            assert args["reference_asset_ids"] == ["as_photo"]
            return {"ok": True, "result": {"job": {"id": "jb_1", "state": "queued", "progress": 0}}}
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
    assert [a for _, a in prospero.fetched] == ["as_a", "as_b"]
    assert all(b == "http://prospero.test" for b, _ in prospero.fetched)
    tools = [t for t, _ in prospero.calls]
    assert tools[:4] == ["studio_projects", "studio_create_project", "studio_import", "studio_generate_image"]
    assert all("reason" in a for t, a in prospero.calls if t in WRITES)
    assert services.store.trainer(trainer_id)["avatar"] == result["candidates"][0]["avatar"]
