"""A dated seven-battle rental challenge on the existing playable-page/result pipeline."""
from __future__ import annotations

import copy
import datetime as dt
import hashlib
from functools import lru_cache
from typing import Any

from . import __version__, sharing
from .errors import SilverError
from .hoard_link.ids import new_id


class DailyChallenge:
    def __init__(self, services: Any):
        self.s = services
        self._cached = lru_cache(maxsize=64)(self._build)

    @staticmethod
    def _day(value: str = "") -> str:
        value = value or dt.date.today().isoformat()
        try:
            if not isinstance(value, str) or dt.date.fromisoformat(value).isoformat() != value:
                raise ValueError
        except (TypeError, ValueError):
            raise SilverError("invalid", "day is a real calendar date in YYYY-MM-DD form.") from None
        return value

    def spec(self, day: str = "") -> dict[str, Any]:
        return copy.deepcopy(self._cached(self._day(day)))

    def _build(self, day: str) -> dict[str, Any]:
        seed = hashlib.sha256(f"silver-daily:1:{day}:gen9customgame:3:50".encode()).hexdigest()[:16]
        # Use the Factory's rental source and rival builder, replacing its random run id
        # with the shared date seed. No trainer, gym, run or league is created.
        rentals = self.s.random_team("gen9randombattle", f"{seed}:rentals:1")["sets"][:6]
        opponents = []
        for i in range(7):
            stage = self.s._facility_stage({"id": seed, "step": i, "target_id": "factory9"})
            opponents.append({"id": f"daily-v1-{day}-{i}", "source_id": f"daily-v1-{day}-{i}",
                              "name": stage["name"], "title": stage.get("title") or "", "avatar": stage.get("avatar") or "",
                              "team": stage["seat"]["team"], "ai_level": stage["seat"]["ai_level"],
                              "ai_style": stage["seat"]["ai_style"], "format": "gen9customgame"})
        out = {"version": 1, "day": day, "id": f"daily-v1-{day}", "seed": seed, "format": "gen9customgame",
               "rules": [], "level_rules": {"level": 50}, "size": 3, "goal": 7,
               "rentals": rentals, "opponents": opponents, "ai_version": self.s.ai_version()}
        # Presentation (names, portraits and locale) is not part of the battle rules.
        out["key"] = sharing.fingerprint({**{k: out[k] for k in ("version", "day", "seed", "format", "rules", "level_rules", "rentals", "ai_version")},
                                           "opponents": [{k: o[k] for k in ("team", "ai_level", "ai_style")} for o in opponents]})
        return out

    def info(self, day: str = "") -> dict[str, Any]:
        spec = self.spec(day)
        rows = self.s.store.friend_results(kind="daily")
        return {**spec, "current_day": dt.date.today().isoformat(),
                "days": sorted({r["target_id"].removeprefix("daily-v1-") for r in rows}),
                "boards": self.s.leaderboard(kind="daily", target_id=spec["id"])["boards"]}

    def export(self, day: str = "") -> dict[str, Any]:
        spec = self.spec(day)
        opponents = [{**o, "ai": {"level": o["ai_level"], "style": o["ai_style"]}} for o in spec["opponents"]]
        gym = {"source_id": spec["id"], "name": f"Daily challenge {spec['day']}", "owner": "",
               "format": spec["format"], "rules": spec["rules"], "level_rules": spec["level_rules"],
               "trainers": opponents[:-1], "leader": opponents[-1], "badge": "", "badge_color": "#e3424f"}
        data = {"kind": "gym", "payload": {"gym": gym}, "from": self.s.settings["player_name"],
                "app_version": __version__, "sprite_server": self.s.settings["sprite_server"], "sprite_set": self.s.settings["sprite_set"],
                "mode": "turns", "ai_version": spec["ai_version"], "daily": spec}
        template = self.s.config.engine_dir.parent / "silvers_hoard/static/play/play.html"
        html = sharing.playable_page(template, data)
        filename = f"Daily-{spec['day']}-{new_id('page')}.html"
        (self.s.config.exports_dir / filename).write_text(html, encoding="utf-8", newline="\n")
        return {"day": spec["day"], "key": spec["key"], "file": filename, "url": f"/api/exports/{filename}",
                "bytes": len(html.encode("utf-8"))}

    def import_result(self, result: dict[str, Any]) -> dict[str, Any]:
        meta = result.get("daily")
        if result.get("kind") != "daily" or not isinstance(meta, dict):
            raise SilverError("invalid", "This is not a daily challenge result.")
        if not isinstance(meta.get("day"), str) or not meta["day"]:
            raise SilverError("invalid", "The daily result is missing its calendar date.")
        spec = self.spec(meta["day"])
        if type(meta.get("version")) is not int or meta["version"] != spec["version"] or meta.get("key") != spec["key"]:
            raise SilverError("conflict", "The daily challenge rules or generator differ from this result.",
                              hint="Use the page exported for this date and these rules.")
        name = " ".join(str(result.get("challenger") or "").split())[:60]
        if not name:
            raise SilverError("invalid", "The daily result needs the player's name.")
        team = result.get("team")
        if not isinstance(team, list) or len(team) != spec["size"] or not all(isinstance(m, dict) for m in team):
            raise SilverError("invalid", "Choose three of the day's six rental Pokémon.")
        team = self.s.import_team(team)["sets"]
        allowed = [sharing.fingerprint(m) for m in self.s.import_team(spec["rentals"])["sets"]]
        chosen = [sharing.fingerprint(m) for m in team]
        if len(set(chosen)) != 3 or any(m not in allowed for m in chosen):
            raise SilverError("invalid", "The result's team is not three unchanged rentals from this day.")
        stages = result.get("stages")
        if (not isinstance(stages, list) or not 1 <= len(stages) <= 7 or not all(isinstance(st, dict) for st in stages)
                or any(st.get("rt") is not None for st in stages) or any(not st.get("won") for st in stages[:-1])):
            raise SilverError("invalid", "The daily result must be the consecutive turn-based battles played before the streak ended.")
        won = len(stages) == 7 and all(st.get("won") for st in stages)
        if bool(result.get("won")) != won or (len(stages) < 7 and stages[-1].get("won")):
            raise SilverError("invalid", "A completed daily challenge needs seven wins; a shorter streak ends with a loss.")
        fp = self.s._result_fingerprint(result)
        self.s._check_new_result(fp, result)
        checked = [self.s._check_turn_stage(st, spec["opponents"][i], spec["format"], spec["rules"], spec["level_rules"],
                                            team, spec["ai_version"], expect_seed=f"{spec['seed']}-{i}") for i, st in enumerate(stages)]
        # Verify every recorded battle before any write. Preserve the existing friend
        # table, replay views and ranking; rentals do not award trainer wins or badges.
        ids = []
        for tp in checked:
            opp, res = tp["opp"], tp["res"]
            ids.append(self.s.store.add_battle({"kind": "friend", "status": "ended", "format": spec["format"],
                        "rules": spec["rules"], "level_rules": spec["level_rules"],
                        "p1": {"name": name, "human": True, "sets": team},
                        "p2": {"name": opp["name"], "human": False, "avatar": opp["avatar"], "sets": opp["team"],
                               "ai": {"level": opp["ai_level"], "style": opp["ai_style"]}},
                        "winner_side": res.get("winner_side") or "", "winner_name": name if res.get("winner_side") == "p1" else opp["name"] if res.get("winner_side") else "",
                        "turns": int(res.get("turns") or 0), "log_text": "\n".join(res.get("lines") or []),
                        "summary": {"from_friend": True, "replayed": True, "ai_checked": tp["ai_checked"], "daily": meta},
                        "title": f"Daily {spec['day']} · {opp['name']} · {name}"}))
        total_turns = sum(int(tp["res"].get("turns") or 0) for tp in checked)
        rid = self.s._record_friend_result(result, "daily", {"id": spec["id"], "name": f"Daily challenge {spec['day']}"},
                                           challenger=name, won=won, battle_id=ids[-1], fp=fp, battles=7, verified=True,
                                           hp_left=float(checked[-1]["res"].get("hp_left") or 0), turns=total_turns)
        return {"kind": "daily", "day": spec["day"], "result_id": rid, "won": won,
                "wins": sum(bool(st.get("won")) for st in stages), "goal": 7,
                "verified": True, "verified_turns": len(checked), "battle_id": ids[-1], "battle_ids": ids}
