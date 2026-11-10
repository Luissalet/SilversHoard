"""The pixelfx style's catalog, per-move effects, weather/terrain effects and the effects pinned to moves by hand (explorer, REST, MCP)."""

from silvers_hoard.agent_tools import TOOLS_BY_NAME, call_tool, uncapped


def test_the_whole_catalog_is_vendored_and_described(services):
    with uncapped():
        r = call_tool(services, "pixelfx_effects", {})
    assert r["count"] == 244
    ids = {e["id"] for e in r["effects"]}
    for eid in ("status/frozen", "melee/claw-swipe", "weather/rain", "critters/slime", "transitions/iris", "moves/meteor-call"):
        assert eid in ids
    frozen = next(e for e in r["effects"] if e["id"] == "status/frozen")
    assert frozen["on_body"] and frozen["loop"] and "palette" in frozen["options"]
    assert len(r["categories"]) == 21 and sum(c["effects"] for c in r["categories"]) == 244
    fire = call_tool(services, "pixelfx_effects", {"category": "fire"})
    assert fire["count"] == 12 and all(e["category"] == "fire" for e in fire["effects"])
    assert call_tool(services, "pixelfx_effects", {"query": "slash"})["count"] >= 3


def test_coverage_counts_moves_with_their_own_effect(services):
    r = call_tool(services, "pixelfx_map", {})
    cov = r["coverage"]
    assert cov["effects_vendored"] == 244 and cov["effects_upstream"] == 244
    assert cov["effects_mapped"] + cov["effects_explorer_only"] == 244
    assert cov["moves_own"] >= 400, cov
    assert r["own_moves"] == cov["moves_own"] and r["pinned_moves"] == 0


def test_moves_get_effects_that_fit_their_name(services):
    want = {"flamethrower": "fire/flamethrower", "thunder": "lightning/lightning-strike", "earthquake": "nature/quake",
            "hydropump": "water/water-jet", "slash": "melee/sword-slash", "crunch": "melee/claw-swipe", "gigadrain": "shadow/soul-drain",
            "shadowball": "shadow/void-orb", "blizzard": "ice/blizzard-vortex", "quiverdance": "critters/butterfly", "protect": "holy/divine-shield"}
    for move, effect in want.items():
        r = call_tool(services, "pixelfx_map", {"move": move})
        assert r["effect"] == effect and r["source"] == "move", (move, r)
    fb = call_tool(services, "pixelfx_map", {"move": "fireblast"})
    assert fb["role"] == "projectile" and fb["hit"]["effect"] == "explosions/small-explosion"
    assert call_tool(services, "pixelfx_map", {"move": "absorb"})["role"] == "beam"


def test_statuses_weather_and_terrains(services):
    frz = call_tool(services, "pixelfx_map", {"status": "frz"})["plan"]
    assert frz["body"]["effect"] == "status/frozen" and frz["effect"] == "ice/ice-crystal"
    assert call_tool(services, "pixelfx_map", {"weather": "raindance"})["plan"]["effect"] == "weather/rain"
    sand = call_tool(services, "pixelfx_map", {"weather": "sandstorm"})["plan"]
    assert sand["effect"] == "weather/blizzard" and sand["color"] == "#e2bf65"
    assert call_tool(services, "pixelfx_map", {"terrain": "grassyterrain"})["plan"]["effect"] == "weather/falling-leaves"
    assert call_tool(services, "pixelfx_map", {"weather": "nonsense"})["error"]


def test_pin_and_unpin_win_over_the_mapping(services):
    assert TOOLS_BY_NAME["pixelfx_pins"].annotations["readOnlyHint"]
    r = call_tool(services, "pixelfx_pin", {"move": "Tackle", "effect": "melee/claw-swipe", "tint": True})
    assert r["ok"] and r["move"] == "tackle" and r["pins"] == 1
    m = call_tool(services, "pixelfx_map", {"move": "tackle"})
    assert m["effect"] == "melee/claw-swipe" and m["pinned"] and m["source"] == "pin" and m["auto"]["effect"]
    pins = call_tool(services, "pixelfx_pins", {})
    assert pins["count"] == 1 and pins["pins"][0]["auto"]["effect"] == m["auto"]["effect"]
    listed = call_tool(services, "pixelfx_moves", {"source": "pin"})
    assert [x["id"] for x in listed["moves"]] == ["tackle"]
    call_tool(services, "pixelfx_pin", {"move": "ember", "effect": "weather/rain", "color": "#ff0000", "role": "self"})
    assert call_tool(services, "pixelfx_map", {"move": "ember"})["role"] == "self"
    assert call_tool(services, "pixelfx_unpin", {"move": "tackle"})["removed"]
    assert call_tool(services, "pixelfx_unpin", {"move": "tackle"})["removed"] is False
    assert call_tool(services, "pixelfx_map", {"move": "tackle"}).get("pinned") is None
    call_tool(services, "pixelfx_unpin", {"move": "ember"})
    assert call_tool(services, "pixelfx_pins", {})["count"] == 0


def test_bad_pins_are_refused(services):
    import pytest

    for args in ({"move": "nonsense", "effect": "fire/torch"}, {"move": "tackle", "effect": "fire/nothing"},
                 {"move": "tackle", "effect": "fire/torch", "color": "red"}):
        with pytest.raises(Exception):
            call_tool(services, "pixelfx_pin", args)


def test_moves_listing_filters(services):
    fire = call_tool(services, "pixelfx_moves", {"type": "Fire", "source": "move"})
    assert fire["count"] >= 30 and all(m["type"] == "Fire" and m["source"] == "move" for m in fire["moves"])
    users = call_tool(services, "pixelfx_moves", {"effect": "nature/quake"})
    assert {"earthquake", "magnitude"} <= {m["id"] for m in users["moves"]}


def test_rest_routes(client):
    assert client.get("/api/pixelfx/effects", params={"category": "ice"}).json()["count"] == 10
    assert client.get("/api/pixelfx/map", params={"move": "surf"}).json()["effect"] == "water/wave-crash"
    r = client.put("/api/pixelfx/pins/surf", json={"effect": "water/geyser", "tint": False})
    assert r.status_code == 200, r.text
    assert client.get("/api/pixelfx/pins").json()["pins"][0]["move"] == "surf"
    assert client.get("/api/pixelfx/moves", params={"source": "pin"}).json()["count"] == 1
    assert client.delete("/api/pixelfx/pins/surf").json()["removed"]
    assert client.get("/api/pixelfx/pins").json()["count"] == 0
    assert client.put("/api/pixelfx/pins/surf", json={"effect": "nope/none"}).status_code == 400
