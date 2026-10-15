"""The rival talks: situational lines a trainer says by itself, and the AI's moves commented in character by the family's model."""

from conftest import TEAM, needs_engine, wait_for

pytestmark = needs_engine


def test_the_ai_comments_its_moves_in_the_background(call, services, monkeypatch):
    from silvers_hoard import services as svc_mod

    asked = []

    def fake_chat(messages, **kw):
        asked.append(messages[0]["content"])
        return {"ok": True, "model": "fake", "json": {"lines": [{"i": i, "line": f"  «¡Ahí va el golpe {i}!»  "} for i in range(8)]}}

    monkeypatch.setattr(svc_mod.family, "chat", fake_chat)
    a = call("trainer_create", {"name": "Charla", "paste": TEAM, "ai_level": "normal", "dialogue": {"intro": "Vamos a ello"}})
    b = call("trainer_create", {"name": "Silencio", "paste": TEAM, "ai_level": "normal"})
    # off by default: no lines, nobody asked
    bt = call("battle_start", {"p1": {"trainer_id": a["id"]}, "p2": {"trainer_id": b["id"]}})
    wait_for(lambda: call("battle_get", {"id": bt["id"]})["status"] == "ended")
    assert "banter" not in call("battle_get", {"id": bt["id"]}) and not asked
    call("settings_set", {"ai_banter": True})
    bt = call("battle_start", {"p1": {"trainer_id": a["id"]}, "p2": {"trainer_id": b["id"]}})
    got = wait_for(lambda: (x := call("battle_get", {"id": bt["id"]})).get("banter") and not x.get("banter_pending") and x, timeout=120)
    lines = got["banter"]
    assert lines and all(x["line"].startswith("¡Ahí va el golpe") and x["line"].endswith("!") for x in lines), "quotes and spaces trimmed"
    assert all(x["side"] in ("p1", "p2") and x["turn"] >= 1 for x in lines)
    assert len({(x["turn"], x["side"]) for x in lines}) == len(lines), "one line per trainer and turn"
    assert "Charla" in asked[0] and "castellano" in asked[0]


def test_situational_lines_and_writing_them_keeps_the_change_of_tactics(call, services, monkeypatch):
    from silvers_hoard import services as svc_mod

    t = call("trainer_create", {"name": "Jefe", "paste": TEAM, "dialogue": {"on_ko": "¡Fuera!", "phase_when": "last", "phase": "¡Aún no!"}})
    assert t["dialogue"]["on_ko"] == "¡Fuera!"
    lines = {"intro": "Hola", "win": "Gané", "lose": "Perdí", "last": "El último", "on_ko": "¡Caído!", "on_faint": "¡No!",
             "on_super": "¡Toma!", "on_switch": "Cambio", "phase_when": "half"}
    monkeypatch.setattr(svc_mod.family, "chat", lambda messages, **kw: {"ok": True, "model": "fake", "json": lines})
    out = call("trainer_dialogue_write", {"id": t["id"]})["dialogue"]
    assert out["on_switch"] == "Cambio" and out["phase_when"] == "last" and out["phase"] == "¡Aún no!", "the model never touches the change of tactics"
