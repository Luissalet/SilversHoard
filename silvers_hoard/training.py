"""Saved, portable practice positions. Every attempt is an ordinary independent practice battle."""

import json

from .errors import SilverError


LEVELS = ("random", "easy", "normal", "hard", "expert")


class Training:
    def __init__(self, services):
        self.svc = services

    def _point(self, payload):
        return self.svc.engine.call("practice_snapshot", {"input": payload["input"], "turn": payload["turn"], "side": payload["side"]})

    def create(self, battle_id, *, turn, side="p1", title="", goal="win", target_turns=0):
        source = self.svc.store.battle(battle_id)
        record = (source.get("replay") or {}).get("input")
        if source["status"] != "ended" or source.get("mode") == "realtime" or not record:
            raise SilverError("invalid", "This replay has no saved turn decisions for training.")
        payload = {"input": record, "turn": turn, "side": side, "format": source["format"],
                   "rules": source.get("rules") or [], "level_rules": source.get("level_rules") or {},
                   "seats": {s: {"name": source[s]["name"], "sets": source[s]["sets"]} for s in ("p1", "p2")}}
        point = self._point(payload)
        payload["input"] = point["input"]  # never export the source battle's future decisions
        payload.update(format=point["format"], seats=point["seats"], rules=[], level_rules={})
        if goal not in ("win", "survive") or not 0 <= target_turns <= 1000 or (goal == "survive" and target_turns < 1):
            raise SilverError("invalid", "Choose win (optional turn limit) or survive (at least one turn).")
        eid = self.svc.store.add_exercise({"title": title.strip() or f"{source['p1']['name']} vs {source['p2']['name']} · {turn}",
                    "goal": goal, "target_turns": target_turns, "payload": payload})
        return self.get(eid)

    def _outcome(self, exercise, battle):
        meta = (battle.get("replay") or {}).get("practice") or {}
        side = exercise["payload"]["side"]
        won = battle["status"] == "ended" and battle["winner_side"] == side
        elapsed = max(0, battle["turns"] - exercise["payload"]["turn"] + int(won))
        if exercise["goal"] == "survive":
            passed = won or elapsed >= exercise["target_turns"]
        else:
            passed = won and (not exercise["target_turns"] or elapsed <= exercise["target_turns"])
        return {"id": battle["id"], "status": battle["status"], "passed": passed, "elapsed_turns": elapsed,
                "ai_level": meta.get("ai_level", "normal"), "adaptive": bool(meta.get("adaptive")),
                "winner_side": battle["winner_side"], "updated_at": battle["updated_at"]}

    def get(self, id_):
        exercise = self.svc.store.exercise(id_)
        attempts = [self._outcome(exercise, b) for b in self.svc.store.exercise_attempts(id_)]
        ended = [a for a in attempts if a["status"] == "ended"]
        level = ended[0]["ai_level"] if ended and ended[0]["ai_level"] in LEVELS else "normal"
        recent = [a for a in ended if a["ai_level"] == level][:3]
        step = 0
        if len(recent) == 3:
            if all(a["passed"] for a in recent):
                step = 1
            elif not any(a["passed"] for a in recent):
                step = -1
        recommended = LEVELS[max(0, min(len(LEVELS) - 1, LEVELS.index(level) + step))]
        return {"id": id_, "title": exercise["title"], "goal": exercise["goal"], "target_turns": exercise["target_turns"],
                "turn": exercise["payload"]["turn"], "side": exercise["payload"]["side"], "format": exercise["payload"]["format"],
                "archived": bool(exercise.get("archived")), "attempts": attempts,
                "recommendation": {"level": recommended, "previous_level": level, "samples": len(recent),
                                   "passed": sum(a["passed"] for a in recent), "step": step}}

    def list(self, archived=False):
        return {"exercises": [self.get(e["id"]) for e in self.svc.store.exercises(archived=archived)]}

    def archive(self, id_, archived=True):
        self.svc.store.exercise(id_)
        self.svc.store.update_exercise(id_, {"archived": int(archived)})
        return self.get(id_)

    def start(self, id_, *, adaptive=True, ai_level="normal", lang="en"):
        exercise = self.svc.store.exercise(id_)
        info = self.get(id_)
        level = info["recommendation"]["level"] if adaptive else ai_level
        if level not in (*LEVELS, "master"):
            raise SilverError("invalid", "Choose an existing AI level.")
        payload = exercise["payload"]
        point = self._point(payload)
        side = payload["side"]
        seats = {s: {**payload["seats"][s], "trainer_id": "", "human": s == side, "avatar": {}, "avatar_url": "",
                     "ai": None if s == side else {"level": level, "style": "balanced", "hidden": True}} for s in ("p1", "p2")}
        meta = {"source_id": "", "exercise_id": id_, "turn": payload["turn"], "side": side, "title": exercise["title"],
                "goal": exercise["goal"], "target_turns": exercise["target_turns"], "adaptive": adaptive, "ai_level": level}
        bid = self.svc.store.add_battle({"kind": "practice", "status": "live", "format": payload["format"],
                "rules": payload["rules"], "level_rules": payload["level_rules"], "p1": seats["p1"], "p2": seats["p2"],
                "seed": point["seed"] if isinstance(point["seed"], str) else ",".join(map(str, point["seed"])),
                "snapshot": json.dumps(point["snapshot"]), "turns": payload["turn"],
                "replay": {"practice": meta, "lang": "es" if lang == "es" else "en"}})
        return self.svc.battle_get(bid)

    def export(self, id_):
        e = self.svc.store.exercise(id_)
        code = json.dumps({"kind": "silvers-hoard/exercise", "schema": 1, "title": e["title"], "goal": e["goal"],
                           "target_turns": e["target_turns"], "position": e["payload"]}, ensure_ascii=False, indent=2)
        filename = f"{id_}.silverexercise"
        path = self.svc.config.exports_dir / filename
        path.write_text(code, encoding="utf-8")
        return {"code": code, "file": filename, "url": f"/api/exports/{filename}", "bytes": len(code.encode("utf8"))}

    def import_(self, code):
        try:
            obj = json.loads(code)
            if obj["kind"] != "silvers-hoard/exercise" or obj["schema"] != 1:
                raise ValueError("Unsupported exercise format")
            p = obj["position"]
            if p["side"] not in ("p1", "p2") or not isinstance(p["turn"], int):
                raise ValueError("Invalid side or turn")
            if obj["goal"] not in ("win", "survive") or not isinstance(obj["target_turns"], int) or not 0 <= obj["target_turns"] <= 1000:
                raise ValueError("Invalid goal")
            if obj["goal"] == "survive" and obj["target_turns"] < 1:
                raise ValueError("Survival needs a turn target")
            # Reconstruct with the product engine before saving anything, then keep only its canonical past prefix.
            point = self._point(p)
            payload = {"input": point["input"], "turn": p["turn"], "side": p["side"], "format": point["format"],
                       "rules": [], "level_rules": {}, "seats": point["seats"]}
            eid = self.svc.store.add_exercise({"title": str(obj["title"])[:200], "goal": obj["goal"],
                                             "target_turns": obj["target_turns"], "payload": payload})
            return self.get(eid)
        except (ValueError, KeyError, TypeError) as exc:
            raise SilverError("invalid", f"The exercise could not be read: {exc}") from exc
