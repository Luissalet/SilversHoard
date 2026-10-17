"""The agent route must expose an entire non-paginated trainer catalog, including long fields."""
import copy
import json

import pytest

from conftest import needs_engine

pytestmark = needs_engine


@pytest.fixture
def catalog(call, services):
    for i in range(12):
        call("trainer_create", {"name": f"Catálogo Ñ {i:02}", "format": "gen9customgame",
                                "notes": f"Nota © {i}: " + "ñ" * 2400 + f" FINAL {i}",
                                "team": [{"species": "Pikachu", "moves": ["Thunderbolt"]}]})
    expected = services.trainers_list()
    assert len(expected) == 12 and len(json.dumps(expected, ensure_ascii=False).encode()) > 20_000
    return expected


def agent_list(client, services, args):
    response = client.post("/api/agent/call", headers={"Authorization": "Bearer " + services.token},
                           json={"name": "trainers_list", "arguments": args})
    assert response.status_code == 200, response.text
    return response.json()


def test_agent_catalog_keeps_every_row_and_long_unicode_fields(client, services, catalog):
    before = copy.deepcopy(services.store.trainers())
    result = agent_list(client, services, {})
    assert "truncated" not in result
    assert result["trainers"] == catalog
    assert {row["id"] for row in result["trainers"]} == {row["id"] for row in catalog}
    assert services.store.trainers() == before


def test_agent_catalog_filters_remain_complete_without_changing_records(client, services, catalog):
    before = copy.deepcopy(services.store.trainers())
    broad = agent_list(client, services, {"query": "Catálogo Ñ", "origin": "own"})
    assert "truncated" not in broad and broad["trainers"] == catalog
    narrow = agent_list(client, services, {"query": "Ñ 11", "origin": "own"})
    assert narrow["trainers"] == [row for row in catalog if row["name"] == "Catálogo Ñ 11"]
    assert agent_list(client, services, {"query": "No matching trainer"})["trainers"] == []
    assert agent_list(client, services, {"origin": "friend"})["trainers"] == []
    assert services.store.trainers() == before
