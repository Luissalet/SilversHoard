"""Bosses that change tactics: the phase is part of a trainer's lines, reaches the engine in every battle and travels with exports."""

from conftest import needs_engine, wait_for

pytestmark = needs_engine

STRONG = ("Garchomp @ Life Orb\nAbility: Rough Skin\nEVs: 252 Atk / 252 Spe\nJolly Nature\n- Earthquake\n- Outrage\n- Stone Edge\n- Fire Fang\n\n"
          "Dragonite @ Choice Band\nAbility: Multiscale\nEVs: 252 Atk / 252 Spe\nAdamant Nature\n- Extreme Speed\n- Outrage\n- Earthquake\n- Fire Punch\n")
BOSS = ("Pikachu @ Light Ball\nAbility: Static\n- Thunderbolt\n- Surf\n- Volt Switch\n- Nasty Plot\n\n"
        "Raichu @ Life Orb\nAbility: Static\n- Thunderbolt\n- Focus Blast\n- Grass Knot\n- Nasty Plot\n\n"
        "Jolteon @ Leftovers\nAbility: Volt Absorb\n- Thunderbolt\n- Shadow Ball\n- Volt Switch\n- Calm Mind\n")


def test_a_boss_changes_tactics_in_battle(call):
    boss = call("trainer_create", {"name": "Jefa", "paste": BOSS, "ai_level": "easy", "ai_style": "defensive",
                                   "dialogue": {"intro": "Hola", "phase_when": "half", "phase_style": "aggressive", "phase": "¡Ahora sí!"}})
    assert boss["dialogue"]["phase_when"] == "half"
    assert call("trainer_update", {"id": boss["id"], "dialogue": {"phase_when": "sometimes"}}, status=400)
    assert call("trainer_update", {"id": boss["id"], "dialogue": {"phase_level": "godlike"}}, status=400)
    # changing one line keeps the others and the change of tactics
    call("trainer_update", {"id": boss["id"], "dialogue": {"intro": "Bienvenido"}})
    d = call("trainer_get", {"id": boss["id"]})["dialogue"]
    assert d["intro"] == "Bienvenido" and d["phase"] == "¡Ahora sí!" and d["phase_style"] == "aggressive"
    me = call("trainer_create", {"name": "Retador", "paste": STRONG, "ai_level": "expert"})
    bt = call("battle_start", {"p1": {"trainer_id": me["id"]}, "p2": {"trainer_id": boss["id"]}, "format": "gen9customgame"})
    done = wait_for(lambda: (x := call("battle_get", {"id": bt["id"]}))["status"] == "ended" and x, timeout=300)
    assert "|silverphase|p2|¡Ahora sí!" in done["lines"]
    # it travels with the trainer
    code = call("export", {"kind": "trainer", "id": boss["id"], "fmt": "code"})["code"]
    got = call("import", {"content": code})["trainer"]
    assert got["dialogue"]["phase_when"] == "half" and got["dialogue"]["phase"] == "¡Ahora sí!"
