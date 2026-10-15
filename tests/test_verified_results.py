"""Friends' turn-based battles checked by replaying them: a page-like record is replayed on import (badge only when it ends as the
code says), a changed outcome or opponent choices are caught, another AI version is accepted without the AI check, and the record of
each battle is the replay's own log."""
import json
import shutil
import subprocess
from pathlib import Path

import pytest

from conftest import TEAM, needs_engine
from silvers_hoard import sharing
from silvers_hoard.errors import SilverError

pytestmark = needs_engine

ROOT = Path(__file__).resolve().parents[1]
WEAK = "Magikarp\nLevel: 5\n- Splash\n\nMagikarp\nLevel: 5\n- Splash\n"


def play(services, trainer, team, forfeit=False):
    t = services.store.trainer(trainer["id"])
    spec = {"format": "gen9customgame", "level_rules": {}, "p1": {"name": "Ana", "sets": team},
            "p2": {"name": t["name"], "sets": t["team"], "ai": {"level": t["ai_level"], "style": t["ai_style"]}}, "forfeit": forfeit}
    out = subprocess.run([shutil.which("node"), str(ROOT / "tests" / "turn_record.mjs")], input=json.dumps(spec), text=True, capture_output=True,
                         cwd=str(ROOT), timeout=180, check=True)
    return json.loads(out.stdout)


@pytest.fixture
def gym(call, services):
    weak = call("trainer_create", {"name": "Pez", "paste": WEAK, "ai_level": "hard", "format": "gen9customgame"})
    g = call("gym_save", {"name": "Gimnasio Charco", "leader_id": weak["id"], "badge": "Medalla Charco", "type": "Water", "format": "gen9customgame"})
    return {"gym": g, "weak": weak, "team": services.import_team(TEAM)["sets"]}


def result(services, w, rec, **over):
    stage = {"name": "Pez", "won": rec["winner_side"] == "p1", "turns": rec["turns"], "input": rec["input"], "rng": rec["rng"], "forfeit": ""}
    stage.update(over.pop("stage", {}))
    r = {"kind": "gym", "gym_id": w["gym"]["id"], "gym_name": w["gym"]["name"], "challenger": "Ana", "won": stage["won"], "turns": rec["turns"],
         "team": w["team"], "team_paste": "", "date": "2026-10-15T10:00:00Z", "stages": [stage], "v": 3, "ai_version": services.ai_version()}
    r.update(over)
    return r


def test_a_replayed_win_gets_its_badge(call, services, gym):
    rec = play(services, gym["weak"], gym["team"])
    assert rec["winner_side"] == "p1"
    out = call("import", {"content": sharing.pack_code(sharing.RESULT_PREFIX, result(services, gym, rec))})
    assert out["won"] and out["badge_id"] and out["verified"] is True and out["verified_turns"] == 1
    b = call("battle_get", {"id": out["battle_id"]})
    assert b["summary"]["replayed"] and b["summary"]["ai_checked"] and b["summary"]["ai_decisions"] >= 1 and "|win|Ana" in "\n".join(b["lines"])
    badge = call("badges_list", {"gym_id": gym["gym"]["id"]})["badges"][0]
    assert badge["proof"]["verified"] is True


def test_what_is_caught(services, gym):
    rec = play(services, gym["weak"], gym["team"])
    with pytest.raises(SilverError) as e:            # a win claimed for a lost battle (here: a won one marked lost the other way round)
        services.import_result(result(services, gym, rec, stage={"won": False}, won=False))
    assert "does not end as the code says" in e.value.message
    changed = list(rec["input"])
    i = next(k for k, line in enumerate(changed) if line.startswith(">p2 move"))
    # the opponent made to play differently (with or without Terastallization): an illegal choice or one its AI would not make
    changed[i] = changed[i][: -len(" terastallize")] if changed[i].endswith(" terastallize") else changed[i] + " terastallize"
    bad = dict(rec, input=changed)
    with pytest.raises(SilverError):
        services.import_result(result(services, gym, bad))
    with pytest.raises(SilverError):                  # the friend's team in the record is not the one in the code
        services.import_result(result(services, gym, rec, team=services.import_team("Mewtwo\n- Psystrike")["sets"]))


def test_another_ai_version_is_not_held_against_the_friend(services, gym):
    rec = play(services, gym["weak"], gym["team"])
    out = services.import_result(result(services, gym, rec, ai_version="older"))
    assert out["verified"] is True
    assert services.store.battle(out["battle_id"])["summary"]["ai_checked"] is False


def test_a_forfeit_replays_as_a_loss(services, gym):
    rec = play(services, gym["weak"], gym["team"], forfeit=True)
    out = services.import_result(result(services, gym, rec, stage={"forfeit": "p1", "won": False}, won=False))
    assert out["won"] is False and out["badge_id"] is None
