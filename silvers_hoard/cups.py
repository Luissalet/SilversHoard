"""Cups: a knockout bracket that fills in match by match while you watch it.

The trainers come chosen, drawn at random from the ones you have, or both. Any one of them can be yours: its matches wait for you to
play them (turn by turn or in real time) or to send them to the simulator, while every other match is played by the AI in the background,
one after another, so the bracket moves forward on the screen. A match is best of 1, 3, 5 or 7; each game is a stored battle that
replays from the bracket.

The bracket is a full tree of 2^k places with the usual seeding (1 against the last, byes for the best seeds). Each match keeps its two
trainers (``a`` and ``b``; "" while the earlier match is not over, "bye" for a free pass), its wins, its games and its state:
``wait`` (a trainer is still missing), ``ready``, ``live`` (a battle is being played or watched) and ``done``."""

from __future__ import annotations

import logging
import random
import threading
import time
from typing import TYPE_CHECKING, Any, Optional

from .errors import SilverError

if TYPE_CHECKING:  # pragma: no cover
    from .services import Services

log = logging.getLogger("silver.cups")

BYE = "bye"
MAX_ENTRANTS = 64
PACE_DEFAULT = 1.5
MAX_GAMES = 12   # a match of tied games ends after this many


def seed_order(size: int) -> list[int]:
    """Bracket places of the seeds 1..size, so that 1 meets size, 2 meets size-1… and the top two only meet in the final."""
    order = [1]
    while len(order) < size:
        n = len(order) * 2
        order = [x for s in order for x in (s, n + 1 - s)]
    return order


def build_rounds(ids: list[str]) -> list[list[dict[str, Any]]]:
    """The empty bracket for these trainers (already in seed order); byes are played at once."""
    n = len(ids)
    size = 1
    while size < n:
        size *= 2
    places = [ids[s - 1] if s <= n else BYE for s in seed_order(size)]
    rounds: list[list[dict[str, Any]]] = []
    first = [_match(places[i], places[i + 1]) for i in range(0, size, 2)]
    rounds.append(first)
    while len(rounds[-1]) > 1:
        rounds.append([_match("", "") for _ in range(len(rounds[-1]) // 2)])
    for i, m in enumerate(first):
        if BYE in (m["a"], m["b"]):
            m["bye"] = True
            _decide(rounds, 0, i, "a" if m["b"] == BYE else "b")
    return rounds


def _match(a: str, b: str) -> dict[str, Any]:
    return {"a": a, "b": b, "wins": [0, 0], "games": [], "winner": "", "state": "ready" if a and b and BYE not in (a, b) else "wait", "bye": False}


def _decide(rounds: list[list[dict[str, Any]]], r: int, i: int, side: str) -> Optional[str]:
    """The match ends with ``side`` ("a" or "b") through; the winner takes its place in the next round. Returns the champion when
    this was the final."""
    m = rounds[r][i]
    m["winner"] = m[side]
    m["state"] = "done"
    if r + 1 >= len(rounds):
        return m["winner"]
    nxt = rounds[r + 1][i // 2]
    nxt["a" if i % 2 == 0 else "b"] = m["winner"]
    if nxt["a"] and nxt["b"] and nxt["state"] == "wait":
        nxt["state"] = "ready"
    return None


def _locate(rounds: list[list[dict[str, Any]]], battle_id: str) -> Optional[tuple[int, int, int]]:
    for r, rnd in enumerate(rounds):
        for i, m in enumerate(rnd):
            for g, game in enumerate(m["games"]):
                if game.get("battle_id") == battle_id:
                    return r, i, g
    return None


def _needed(best_of: int) -> int:
    return best_of // 2 + 1


class Cups:
    def __init__(self, svc: "Services"):
        self.svc = svc
        self._locks: dict[str, threading.Lock] = {}
        self._guard = threading.Lock()
        self._running: set[str] = set()
        self.stopped = False   # the app is closing: no new matches start

    def _lock(self, cid: str) -> threading.Lock:
        with self._guard:
            return self._locks.setdefault(cid, threading.RLock())  # type: ignore[return-value]

    # ------------------------------------------------------------ creating and reading
    def create(self, *, trainer_ids: Optional[list[str]] = None, random_count: int = 0, human_id: str = "", seeding: str = "random",
               best_of: int = 1, format_: str = "", rules: Optional[list[str]] = None, level_rules: Optional[dict[str, Any]] = None,
               mode: str = "classic", time_limit: int = 0, rt_arena: str = "rocks", ai_level: str = "", title: str = "",
               pace: float = PACE_DEFAULT, seed: Optional[int] = None, autoplay: bool = True, random_from: str = "") -> dict[str, Any]:
        from .services import RT_RULES_VERSION, _rt_arena

        svc = self.svc
        if mode not in ("classic", "realtime"):
            raise SilverError("invalid", "mode is classic or realtime")
        if seeding not in ("random", "chosen"):
            raise SilverError("invalid", "seeding is random (shuffled) or chosen (in the order given)")
        rng = random.Random(seed)
        ids = list(dict.fromkeys(trainer_ids or []))
        if human_id and human_id not in ids:
            ids.insert(0, human_id)
        want = max(len(ids), min(int(random_count or 0), MAX_ENTRANTS))
        if want > len(ids):
            pool = [t["id"] for t in svc.store.trainers(query=random_from, limit=5000) if t["id"] not in ids and t.get("team")]
            if not pool and random_from:
                raise SilverError("not_found", f"No trainers with a team match {random_from!r}.")
            rng.shuffle(pool)
            ids += pool[: want - len(ids)]
        if len(ids) < 2:
            raise SilverError("invalid", "A cup needs at least two trainers with a team.", hint="Pick them, or set random_count.")
        if len(ids) > MAX_ENTRANTS:
            raise SilverError("invalid", f"At most {MAX_ENTRANTS} trainers.")
        entrants = []
        for tid in ids:
            t = svc.store.trainer(tid)
            if not t.get("team"):
                raise SilverError("empty_team", f"{t['name']} has no team.")
            entrants.append({"id": tid, "name": t["name"], "avatar": t["avatar"], "human": tid == human_id})
        if seeding == "random":
            rng.shuffle(entrants)
        fmt = format_ or svc.settings["default_format"]
        svc.format_info(fmt, rules)
        if mode == "realtime":
            fmt, rules = svc._rt_format(fmt), []
        fmt_name = str(svc.format_info(fmt, rules).get("name") or fmt)
        spec = {"format": fmt, "format_name": fmt_name, "rules": rules or [], "level_rules": level_rules or {}, "mode": mode,
                "best_of": max(1, int(best_of) | 1), "rt_arena": _rt_arena(rt_arena), "ai_level": ai_level or "",
                "time_limit": max(30, min(int(time_limit or svc.settings["rt_time_limit"]), 1800)), "pace": max(0.0, min(float(pace), 10.0)),
                "seeding": seeding, "version": RT_RULES_VERSION if mode == "realtime" else 0}
        if mode == "realtime":
            svc.arenas.spec(spec["rt_arena"])   # a custom arena must exist
        rounds = build_rounds([e["id"] for e in entrants])
        cid = svc.store.add_cup({"title": (title or f"Copa de {len(entrants)}")[:80], "status": "active", "spec": spec, "entrants": entrants,
                                 "rounds": rounds, "human_id": human_id or "", "champion": ""})
        svc.emit("cup.created", {"id": cid, "entrants": len(entrants)})
        if autoplay:
            self.advance(cid)
        return self.get(cid)

    def view(self, c: dict[str, Any], *, light: bool = False) -> dict[str, Any]:
        svc = self.svc
        people = {e["id"]: {**e, "avatar_url": svc.avatar_url(e.get("avatar", ""))} for e in c.get("entrants") or []}
        rounds = c.get("rounds") or []
        human = c.get("human_id") or ""
        mine = None
        out_rounds = []
        for r, rnd in enumerate(rounds):
            row = []
            for i, m in enumerate(rnd):
                is_mine = bool(human) and human in (m["a"], m["b"])
                if is_mine and m["state"] in ("ready", "live") and mine is None:
                    live = next((g["battle_id"] for g in m["games"] if not g.get("winner") and not g.get("tie")), "") if m["state"] == "live" else ""
                    mine = {"round": r, "match": i, "opponent": m["b"] if m["a"] == human else m["a"], "battle_id": live}
                row.append({**m, "round": r, "index": i, "mine": is_mine})
            out_rounds.append(row)
        alive = {human} if human else set()
        if human:
            for rnd in rounds:
                for m in rnd:
                    if m["state"] == "done" and human in (m["a"], m["b"]) and m["winner"] != human:
                        alive.discard(human)
        played = sum(1 for rnd in rounds for m in rnd if m["state"] == "done" and not m.get("bye"))
        total = sum(1 for rnd in rounds for m in rnd if not m.get("bye"))
        out = {k: v for k, v in c.items() if k not in ("rounds", "entrants")}
        out.update({"entrants": list(people.values()), "names": people, "rounds": out_rounds, "my_match": mine,
                    "human_alive": bool(human) and human in alive, "played": played, "total": total,
                    "simulating": c["id"] in self._running or any(m["state"] == "sim" for rnd in rounds for m in rnd), "pending_ai": self._pending_ai(c) if c["status"] == "active" else 0})
        if light:
            out.pop("rounds")
            out.pop("names")
            out["champion_name"] = people.get(c.get("champion") or "", {}).get("name", "")
        return out

    def get(self, cid: str) -> dict[str, Any]:
        return self.view(self.svc.store.cup(cid))

    def list(self, status: str = "") -> list[dict[str, Any]]:
        return [self.view(c, light=True) for c in self.svc.store.cups(status=status)]

    def battle_link(self, cid: str) -> Optional[dict[str, Any]]:
        """What a battle screen shows about its cup: a way back to the bracket and the next match of yours, if any."""
        try:
            c = self.view(self.svc.store.cup(cid), light=False)
        except SilverError:
            return None
        names = c["names"]
        return {"id": c["id"], "title": c["title"], "status": c["status"], "champion": c.get("champion") or "",
                "champion_name": names.get(c.get("champion") or "", {}).get("name", ""), "my_match": c["my_match"],
                "human_alive": c["human_alive"]}

    @staticmethod
    def _pending_ai(c: dict[str, Any]) -> int:
        human = c.get("human_id") or ""
        return sum(1 for rnd in c.get("rounds") or [] for m in rnd if m["state"] == "ready" and not (human and human in (m["a"], m["b"])))

    # ------------------------------------------------------------ the AI's matches, in the background
    def advance(self, cid: str) -> dict[str, Any]:
        """Plays every match that does not need you, one after another (a background thread), until only yours are left or the cup is
        over. Nothing happens if it is already doing it."""
        with self._guard:
            if self.stopped:
                return {"simulating": False}
            if cid in self._running:
                return {"simulating": True}
            c = self.svc.store.cup(cid)
            if c["status"] != "active" or not self._pending_ai(c):
                return {"simulating": False}
            self._running.add(cid)
        threading.Thread(target=self._loop, args=(cid,), name=f"silver-cup-{cid}", daemon=True).start()
        return {"simulating": True}

    def _loop(self, cid: str) -> None:
        try:
            while not self.stopped:
                c = self.svc.store.cup(cid)
                if c["status"] != "active":
                    return
                human = c.get("human_id") or ""
                nxt = next(((r, i) for r, rnd in enumerate(c["rounds"]) for i, m in enumerate(rnd)
                            if m["state"] == "ready" and not (human and human in (m["a"], m["b"]))), None)
                if nxt is None:
                    return
                with self._lock(cid):
                    c = self.svc.store.cup(cid)
                    m = c["rounds"][nxt[0]][nxt[1]]
                    if m["state"] != "ready":
                        continue
                    m["state"] = "sim"
                    self.svc.store.update_cup(cid, {"rounds": c["rounds"]})
                started = time.time()
                try:
                    self._simulate(cid, *nxt)
                except Exception:
                    with self._lock(cid):
                        c = self.svc.store.cup(cid)
                        if c["rounds"][nxt[0]][nxt[1]]["state"] == "sim":
                            c["rounds"][nxt[0]][nxt[1]]["state"] = "ready"
                            self.svc.store.update_cup(cid, {"rounds": c["rounds"]})
                    raise
                rest = float(c["spec"].get("pace", PACE_DEFAULT)) - (time.time() - started)
                if rest > 0:
                    time.sleep(rest)
        except Exception:  # noqa: BLE001 - the cup stays as it was; advance() picks it up again
            log.exception("cup %s", cid)
        finally:
            with self._guard:
                self._running.discard(cid)

    def _seat(self, tid: str, ai_level: str) -> dict[str, Any]:
        s = self.svc._seat({"trainer_id": tid, "ai_level": ai_level or None}, tid)
        return {"id": tid, "name": s["name"], "sets": s["sets"], "ai": s["ai"], "avatar": s["avatar"]}

    def _simulate(self, cid: str, r: int, i: int) -> None:
        """A whole match played by the AI in the engine, one game at a time (the bracket shows the score as it goes); each game is
        stored as a battle that replays from the bracket. A tied game does not count; after too many the better score, or a coin,
        decides."""
        import json

        svc = self.svc
        rng = random.Random(f"{cid}:{r}:{i}")
        for _ in range(MAX_GAMES):
            if self.stopped:
                return
            c = svc.store.cup(cid)
            m = c["rounds"][r][i]
            if c["status"] != "active" or m["state"] == "done":
                return
            spec = c["spec"]
            a, b = self._seat(m["a"], spec["ai_level"]), self._seat(m["b"], spec["ai_level"])
            rt = spec["mode"] == "realtime"
            arena = svc.arenas.spec(spec["rt_arena"]) if rt else ""
            res = svc.engine.run_job("tournament", {"format": spec["format"], "rules": spec["rules"], "level_rules": spec["level_rules"],
                                                    "entrants": [a, b], "kind": "bracket", "best_of": 1, "mode": spec["mode"],
                                                    "time_limit": spec["time_limit"], "arena": arena, "max_turns": svc.settings["max_turns"],
                                                    "version": spec.get("version") or 0}, timeout=3 * 3600)
            g = ((res.get("matches") or [{}])[0].get("games") or [{}])[0]
            summary = g.get("summary") or {}
            seat = lambda e: {"trainer_id": e["id"], "name": e["name"], "avatar": e["avatar"], "avatar_url": svc.avatar_url(e["avatar"]),  # noqa: E731
                              "human": False, "ai": e["ai"], "sets": e["sets"]}
            bid = svc.store.add_battle({"kind": "cup", "status": "ended", "format": spec["format"], "rules": spec["rules"],
                                        "level_rules": spec["level_rules"], "p1": seat(a), "p2": seat(b),
                                        "winner_side": summary.get("winner_side", ""), "winner_name": summary.get("winner", ""),
                                        "turns": summary.get("turns", 0), "log_text": "\n".join(g.get("lines") or []), "summary": summary,
                                        "seed": str(g.get("seed")) if rt else json.dumps(g.get("seed")), "run_id": cid,
                                        "title": f"{c['title']} · {a['name']} vs {b['name']}", "mode": spec["mode"],
                                        "replay": {"time_limit": spec["time_limit"], "inputs": [], "version": spec.get("version") or 0,
                                                   "arena": arena} if rt else {}})
            side = "a" if g.get("winner") == a["id"] else "b" if g.get("winner") == b["id"] else ""
            with self._lock(cid):
                c = svc.store.cup(cid)
                m = c["rounds"][r][i]
                if m["state"] == "done":
                    return
                m["games"].append({"battle_id": bid, "p1": "a", "winner": side, "tie": not side, "simulated": True})
                if side:
                    m["wins"][0 if side == "a" else 1] += 1
                need = _needed(spec["best_of"])
                if max(m["wins"]) >= need:
                    self._close_match(c, r, i, "a" if m["wins"][0] >= need else "b")
                    return
                svc.store.update_cup(cid, {"rounds": c["rounds"]})
        with self._lock(cid):
            c = svc.store.cup(cid)
            m = c["rounds"][r][i]
            if m["state"] != "done":
                w = m["wins"]
                self._close_match(c, r, i, "a" if w[0] > w[1] else "b" if w[1] > w[0] else rng.choice("ab"))

    def _close_match(self, c: dict[str, Any], r: int, i: int, side: str) -> None:
        svc = self.svc
        champion = _decide(c["rounds"], r, i, side)
        values: dict[str, Any] = {"rounds": c["rounds"]}
        if champion:
            values.update({"champion": champion, "status": "done"})
        svc.store.update_cup(c["id"], values)
        m = c["rounds"][r][i]
        names = {e["id"]: e["name"] for e in c["entrants"]}
        svc.emit("cup.match", {"id": c["id"], "round": r, "winner": names.get(m["winner"], "")})
        if champion:
            svc.emit("cup.won", {"id": c["id"], "champion": names.get(champion, "")})

    # ------------------------------------------------------------ your matches
    def _mine(self, c: dict[str, Any]) -> tuple[int, int, dict[str, Any]]:
        human = c.get("human_id") or ""
        if not human:
            raise SilverError("invalid", "Nobody plays in this cup: every match is the AI's.")
        if c["status"] != "active":
            raise SilverError("conflict", "The cup is over.")
        for r, rnd in enumerate(c["rounds"]):
            for i, m in enumerate(rnd):
                if human in (m["a"], m["b"]) and m["state"] in ("ready", "live"):
                    return r, i, m
        raise SilverError("conflict", "None of your matches is ready yet.", hint="Wait for the earlier matches, or cup_simulate them.")

    def play(self, cid: str) -> dict[str, Any]:
        """Starts (or resumes) your next game: you against the rival of your current match, turn by turn or in real time."""
        svc = self.svc
        with self._lock(cid):
            c = svc.store.cup(cid)
            r, i, m = self._mine(c)
            for g in m["games"]:
                if not g.get("winner") and not g.get("tie"):
                    b = svc.store.battle(g["battle_id"])
                    if b["status"] == "live":
                        return {"battle_id": b["id"], "resumed": True}
            human = c["human_id"]
            rival = m["b"] if m["a"] == human else m["a"]
            spec = c["spec"]
            names = {e["id"]: e["name"] for e in c["entrants"]}
            p2 = {"trainer_id": rival, "human": False, **({"ai_level": spec["ai_level"]} if spec["ai_level"] else {})}
            b = svc.battle_start(p1={"trainer_id": human, "human": True}, p2=p2, format_=spec["format"], rules=spec["rules"],
                                 level_rules=spec["level_rules"], kind="cup", run_id=cid, mode=spec["mode"], time_limit=spec["time_limit"],
                                 rt_arena=spec["rt_arena"], title=f"{c['title']} · {names.get(human, '')} vs {names.get(rival, '')}")
            c = svc.store.cup(cid)
            m = c["rounds"][r][i]
            m["games"].append({"battle_id": b["id"], "p1": "a" if m["a"] == human else "b", "winner": "", "tie": False})
            m["state"] = "live"
            svc.store.update_cup(cid, {"rounds": c["rounds"]})
            return {"battle_id": b["id"], "resumed": False}

    def watch(self, cid: str, round_: int, match: int) -> dict[str, Any]:
        """One of the AI's matches played as a battle you watch (its next game) instead of in the background."""
        svc = self.svc
        with self._lock(cid):
            c = svc.store.cup(cid)
            try:
                m = c["rounds"][round_][match]
            except (IndexError, TypeError):
                raise SilverError("not_found", "No such match.") from None
            human = c.get("human_id") or ""
            if human and human in (m["a"], m["b"]):
                raise SilverError("invalid", "That one is yours: cup_play it.")
            if m["state"] != "ready":
                raise SilverError("conflict", "That match is not ready to watch.")
            spec = c["spec"]
            lvl = {"ai_level": spec["ai_level"]} if spec["ai_level"] else {}
            names = {e["id"]: e["name"] for e in c["entrants"]}
            m["state"] = "live"
            m["games"].append({"battle_id": "", "p1": "a", "winner": "", "tie": False})
            svc.store.update_cup(cid, {"rounds": c["rounds"]})
        try:
            b = svc.battle_start(p1={"trainer_id": m["a"], "human": False, **lvl}, p2={"trainer_id": m["b"], "human": False, **lvl},
                                 format_=spec["format"], rules=spec["rules"], level_rules=spec["level_rules"], kind="cup", run_id=cid,
                                 mode=spec["mode"], time_limit=spec["time_limit"], rt_arena=spec["rt_arena"],
                                 title=f"{c['title']} · {names.get(m['a'], '')} vs {names.get(m['b'], '')}")
        except Exception:
            with self._lock(cid):
                c = svc.store.cup(cid)
                mm = c["rounds"][round_][match]
                mm["games"] = [g for g in mm["games"] if g.get("battle_id")]
                mm["state"] = "ready"
                svc.store.update_cup(cid, {"rounds": c["rounds"]})
            raise
        with self._lock(cid):
            c = svc.store.cup(cid)
            mm = c["rounds"][round_][match]
            slot = next((g for g in mm["games"] if not g.get("battle_id")), None)
            if slot is not None:
                slot["battle_id"] = b["id"]
                svc.store.update_cup(cid, {"rounds": c["rounds"]})
        if svc.store.battle(b["id"])["status"] == "ended":   # a watched battle can be over before the line above
            self.on_battle_end(cid, svc.store.battle(b["id"]))
        return {"battle_id": b["id"]}

    def simulate_mine(self, cid: str) -> dict[str, Any]:
        """Your current match played by the AI for you (with your trainer's own AI), in the background like the rest."""
        with self._lock(cid):
            c = self.svc.store.cup(cid)
            r, i, m = self._mine(c)
            if m["state"] == "live":
                raise SilverError("conflict", "Your game is being played.", hint="Finish or forfeit it first.")
            m["state"] = "sim"
            self.svc.store.update_cup(cid, {"rounds": c["rounds"]})
        self._background(cid, r, i)
        return self.get(cid)

    def simulate_match(self, cid: str, round_: int, match: int) -> dict[str, Any]:
        """Any ready match played by the AI now, in the background; a watched game nobody finished is dropped and played again."""
        with self._lock(cid):
            c = self.svc.store.cup(cid)
            if c["status"] != "active":
                raise SilverError("conflict", "The cup is over.")
            try:
                m = c["rounds"][round_][match]
            except (IndexError, TypeError):
                raise SilverError("not_found", "No such match.") from None
            if m["state"] == "live":
                for g in [g for g in m["games"] if not g.get("winner") and not g.get("tie")]:
                    b = self.svc.store.battle(g["battle_id"]) if g.get("battle_id") else None
                    if b and b["status"] == "live" and (b.get("p1") or {}).get("human"):
                        raise SilverError("conflict", "Your game is being played.", hint="Finish or forfeit it first.")
                    m["games"].remove(g)
            elif m["state"] != "ready":
                raise SilverError("conflict", "That match is not ready.")
            m["state"] = "sim"
            self.svc.store.update_cup(cid, {"rounds": c["rounds"]})
        self._background(cid, round_, match)
        return self.get(cid)

    def _background(self, cid: str, r: int, i: int) -> None:
        def work() -> None:
            try:
                self._simulate(cid, r, i)
            except Exception:  # noqa: BLE001 - back to ready, to be played again
                log.exception("cup %s match %s/%s", cid, r, i)
                with self._lock(cid):
                    c = self.svc.store.cup(cid)
                    if c["rounds"][r][i]["state"] == "sim":
                        c["rounds"][r][i]["state"] = "ready"
                        self.svc.store.update_cup(cid, {"rounds": c["rounds"]})
            self.advance(cid)

        threading.Thread(target=work, name=f"silver-cup-{cid}-{r}-{i}", daemon=True).start()

    def on_battle_end(self, cid: str, b: dict[str, Any]) -> None:
        """A battle of the cup ended (yours or one being watched): count the game, close the match when somebody has enough wins, and
        let the AI play on."""
        svc = self.svc
        with self._lock(cid):
            try:
                c = svc.store.cup(cid)
            except SilverError:
                return
            where = _locate(c["rounds"], b["id"])
            if where is None or c["status"] != "active":
                return
            r, i, g = where
            m = c["rounds"][r][i]
            game = m["games"][g]
            if game.get("winner") or game.get("tie"):
                return
            w = b.get("winner_side") or ""
            p1 = game.get("p1") or "a"
            side = "" if not w else (p1 if w == "p1" else ("b" if p1 == "a" else "a"))
            game["winner"], game["tie"] = side, not side
            if side:
                m["wins"][0 if side == "a" else 1] += 1
            need = _needed(c["spec"]["best_of"])
            if max(m["wins"]) >= need:
                self._close_match(c, r, i, "a" if m["wins"][0] >= need else "b")
            else:
                m["state"] = "ready"
                svc.store.update_cup(cid, {"rounds": c["rounds"]})
        self.advance(cid)

    def recover(self) -> None:
        """After a restart: matches the AI was playing are ready again, and a watched or played game whose battle did not survive is
        dropped (a battle that did end is counted)."""
        store = self.svc.store
        for c in store.cups(status="active", limit=1000):
            ended = []
            changed = False
            for rnd in c["rounds"]:
                for m in rnd:
                    if m["state"] == "sim":
                        m["state"], changed = "ready", True
                    elif m["state"] == "live":
                        keep = []
                        for g in m["games"]:
                            if g.get("winner") or g.get("tie"):
                                keep.append(g)
                                continue
                            try:
                                b = store.battle(g["battle_id"]) if g.get("battle_id") else None
                            except SilverError:
                                b = None
                            if b and b["status"] in ("live", "ended"):
                                keep.append(g)
                                if b["status"] == "ended":
                                    ended.append(b)
                        if len(keep) != len(m["games"]):
                            changed = True
                        m["games"] = keep
                        if not any(not g.get("winner") and not g.get("tie") for g in keep):
                            m["state"], changed = "ready", True
            if changed:
                store.update_cup(c["id"], {"rounds": c["rounds"]})
            for b in ended:
                self.on_battle_end(c["id"], b)

    # ------------------------------------------------------------ the rest
    def abandon(self, cid: str) -> dict[str, Any]:
        c = self.svc.store.cup(cid)
        if c["status"] == "active":
            self.svc.store.update_cup(cid, {"status": "abandoned"})
        return self.get(cid)

    def delete(self, ids: list[str]) -> dict[str, Any]:
        n = 0
        for cid in ids:
            with self._guard:
                if cid in self._running:
                    raise SilverError("conflict", "That cup is playing its matches.", hint="cup_abandon it first.")
            n += self.svc.store.delete_cup(cid)
        return {"deleted": n}
