import copy
import json
import re

from conftest import needs_engine

pytestmark = needs_engine


def make_battle(services):
    return services.mass.start(mode="ffa", seed="share632", title="QA </script> campal", teams=[
        {"kind": "species", "species": ["Pikachu", "Eevee"]}])


def test_native_export_keeps_the_original_and_the_previous_file(services, call, client):
    battle = make_battle(services)
    before = copy.deepcopy(services.mass.get(battle["id"]))
    out = call("mass_export", {"id": battle["id"]})
    response = client.get(out["url"])
    assert response.status_code == 200
    assert len(response.content) == out["bytes"]
    html = response.text
    raw = re.search(r'<script id="silver-data" type="application/json">(.*?)</script>', html, re.S).group(1)
    data = json.loads(raw)
    assert data["kind"] == "mass" and data["battle"] == before
    assert "</script>" not in raw and "<script id=\"silver-code\"" in html
    assert out["hash"] == before["hash"]
    assert services.mass.get(battle["id"]) == before
    second = call("mass_export", {"id": battle["id"]})
    assert out["file"] != second["file"]
    services.mass.delete(battle["id"])
    assert client.get(out["url"]).text == html


def test_missing_battle_exports_nothing(services, call):
    before = list(services.config.exports_dir.iterdir())
    call("mass_export", {"id": "mass_notfound123"}, status=404)
    assert list(services.config.exports_dir.iterdir()) == before
