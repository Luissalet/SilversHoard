"""Friends: a league that adds up the results friends bring back from playable pages, and a vote that picks the rule of the week's
challenge.

League: every result imported from a friend (friend_results) counts once per gym or trainer, the best one: a full win is 3 points
(+1 when the app replayed it and it checked out), each battle won on the way 1, and playing the week's challenge 1 more. Seasons are
calendar months (or everything). The table is shown in the app, exported as a page to send around, and published on the family bus
(the Hub) as an event other Hoards can show.

Vote: the host offers a few Pokémon or rules; friends open a link on the room server (pvp_server.py, the same server as live
battles) and vote with their name (one vote per name, a second one replaces the first). Closing the vote makes the winner the rule of
that week's challenge: the playable page asks for it (a Pokémon that must be in the team, or a team-building rule) and the app checks
it when the result comes back.
"""
from __future__ import annotations

import datetime as _dt
import html
import json
import secrets
import threading
import time
from typing import TYPE_CHECKING, Any, Optional

from .errors import SilverError
from .hoard_link.atomic import write_bytes_atomic

if TYPE_CHECKING:  # pragma: no cover
    from .services import Services

# rules a vote can pick: they only shape the team (the validator checks them), so a battle replays the same with or without them
RULES = {
    "Same Type Clause": ("Monotipo: todo el equipo comparte un tipo", "Monotype: the whole team shares a type"),
    "Little Cup": ("Copa Pequeña: solo Pokémon que aún pueden evolucionar", "Little Cup: only Pokémon that can still evolve"),
    "Max Team Size = 3": ("Equipo de tres", "A team of three"),
    "Item Clause = 1": ("Sin objetos repetidos", "No repeated items"),
}
POINTS = {"win": 3, "verified": 1, "battle": 1, "weekly": 1}
MAX_OPTIONS = 8


def _season_of(ts: float) -> str:
    return _dt.datetime.fromtimestamp(ts).strftime("%Y-%m")


class Friends:
    def __init__(self, services: "Services"):
        self.s = services
        self.path = services.config.data_dir / "friends.json"
        self._lock = threading.Lock()

    # ------------------------------------------------------------ storage (polls and the rules of each week)
    def _load(self) -> dict[str, Any]:
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            data = {}
        data.setdefault("polls", {})
        data.setdefault("week_rules", {})
        return data

    def _save(self, data: dict[str, Any]) -> None:
        write_bytes_atomic(self.path, json.dumps(data, ensure_ascii=False, indent=1).encode("utf-8"), fsync=False)

    # ------------------------------------------------------------ league
    def league(self, season: str = "") -> dict[str, Any]:
        """The friends' table of a season (YYYY-MM, empty = this month, all = everything)."""
        now = _season_of(time.time())
        season = season or now
        if season != "all" and not (len(season) == 7 and season[4] == "-" and season[:4].isdigit() and season[5:].isdigit()):
            raise SilverError("invalid", "season is YYYY-MM, empty for this month, or all")
        rows = self.s.store.friend_results()
        seasons = sorted({_season_of(r["created_at"]) for r in rows} | {now}, reverse=True)
        rows = [r for r in rows if season == "all" or _season_of(r["created_at"]) == season]
        # each friend's best result per gym or trainer (and per week for the week's challenge) counts once
        best: dict[tuple[str, str, str, str], dict[str, Any]] = {}
        for r in rows:
            key = (r["challenger"].strip().lower(), r["kind"], r["target_id"], r.get("week") or "")
            score = self._points(r)
            if key not in best or score > best[key]["_points"]:
                best[key] = {**r, "_points": score}
        table: dict[str, dict[str, Any]] = {}
        for (who, *_), r in best.items():
            e = table.setdefault(who, {"challenger": r["challenger"], "points": 0, "wins": 0, "verified_wins": 0, "battles_won": 0,
                                       "played": 0, "weekly": 0, "last": 0})
            e["points"] += r["_points"]
            e["played"] += 1
            e["wins"] += int(bool(r["won"]))
            e["verified_wins"] += int(bool(r["won"]) and bool(r["verified"]))
            e["battles_won"] += int(r.get("battles_won") or 0)
            e["weekly"] += int(bool(r.get("week")))
            e["last"] = max(e["last"], r["created_at"])
        standings = sorted(table.values(), key=lambda e: (-e["points"], -e["wins"], -e["verified_wins"], e["challenger"].lower()))
        for i, e in enumerate(standings):
            e["rank"] = i + 1
        return {"season": season, "current": now, "seasons": seasons, "standings": standings, "points": POINTS}

    @staticmethod
    def _points(r: dict[str, Any]) -> int:
        won = bool(r["won"])
        p = POINTS["win"] + (POINTS["verified"] if r.get("verified") else 0) if won else POINTS["battle"] * int(r.get("battles_won") or 0)
        return p + (POINTS["weekly"] if r.get("week") else 0)

    def league_export(self, season: str = "") -> dict[str, Any]:
        """The table as a page to send to friends (exports folder), and the same table on the family bus for the Hub."""
        lg = self.league(season)
        owner = self.s.settings["player_name"] or "Silver's Hoard"
        rows = "".join(
            f"<tr><td class=r>{e['rank']}</td><td>{html.escape(e['challenger'])}</td><td class=n><b>{e['points']}</b></td>"
            f"<td class=n>{e['wins']}</td><td class=n>{e['verified_wins']}</td><td class=n>{e['played']}</td><td class=n>{e['weekly']}</td></tr>"
            for e in lg["standings"])
        title = f"Liga de amigos · {'todo' if lg['season'] == 'all' else lg['season']}"
        page = f"""<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{html.escape(title)}</title><style>
body{{margin:0;background:#141016;color:#eee;font:15px/1.5 system-ui,sans-serif}}main{{max-width:760px;margin:0 auto;padding:24px 16px}}
h1{{color:#e3424f;font-family:Georgia,serif;font-weight:500;margin:0 0 4px}}p{{color:#aaa;margin:0 0 16px}}table{{width:100%;border-collapse:collapse}}
th,td{{padding:8px 10px;border-bottom:1px solid #2c2430;text-align:left}}th{{color:#aaa;font-weight:600;font-size:13px}}.n{{text-align:right}}
.r{{width:2em;color:#e3424f;font-weight:700}}tr:nth-child(-n+3) td.r{{color:#f2c14e}}</style></head><body><main>
<h1>{html.escape(title)}</h1><p>{html.escape(owner)} · Silver's Hoard · victoria completa {POINTS['win']} (+{POINTS['verified']} comprobada), cada combate ganado {POINTS['battle']}, reto de la semana +{POINTS['weekly']}</p>
<table><thead><tr><th>#</th><th>Amigo</th><th class=n>Puntos</th><th class=n>Victorias</th><th class=n>Comprobadas</th><th class=n>Retos</th><th class=n>Semanales</th></tr></thead>
<tbody>{rows or '<tr><td colspan=7>Aún no hay resultados esta temporada.</td></tr>'}</tbody></table></main></body></html>"""
        name = f"Liga de amigos - {lg['season']}.html"
        (self.s.config.exports_dir / name).write_text(page, encoding="utf-8", newline="\n")
        self.s.emit("friends.league", {"season": lg["season"], "standings": [{k: e[k] for k in ("rank", "challenger", "points", "wins")} for e in lg["standings"][:10]]})
        return {"file": name, "url": f"/api/exports/{name}", "season": lg["season"], "published": True, "standings": len(lg["standings"])}

    # ------------------------------------------------------------ the vote of the week
    def _poll_view(self, p: dict[str, Any], *, host: bool = True) -> dict[str, Any]:
        tally = {o: 0 for o in p["options"]}
        for v in p["votes"].values():
            if v["option"] in tally:
                tally[v["option"]] += 1
        out = {"id": p["id"], "kind": p["kind"], "week": p["week"], "question": p["question"], "status": p["status"], "winner": p.get("winner") or "",
               "options": [{"value": o, "votes": tally[o], **({"label_es": RULES[o][0], "label_en": RULES[o][1]} if p["kind"] == "rule" else {})} for o in p["options"]],
               "votes": len(p["votes"])}
        if host:
            self.s.pvp.ensure_server()
            links = self.s.pvp.links_for(f"/v/{p['id']}?k={p['key']}")
            out.update({"voters": sorted(v["name"] for v in p["votes"].values()), "links": links})
        return out

    def poll_open(self, *, kind: str, options: list[str], week: str = "", question: str = "") -> dict[str, Any]:
        if kind not in ("pokemon", "rule"):
            raise SilverError("invalid", "kind is pokemon (a Pokémon the team must include) or rule (a team-building rule)")
        week = week or self.s.current_week()
        clean: list[str] = []
        for o in options or []:
            o = " ".join(str(o).split())
            if not o or o.lower() in (c.lower() for c in clean):
                continue
            if kind == "rule":
                match = next((r for r in RULES if r.lower() == o.lower()), "")
                if not match:
                    raise SilverError("invalid", f"Unknown rule: {o}", hint="One of: " + ", ".join(RULES))
                o = match
            else:
                try:
                    info = self.s.species(o)
                except SilverError:
                    raise SilverError("invalid", f"Unknown Pokémon: {o}") from None
                o = info.get("name") or o
            clean.append(o)
        if not 2 <= len(clean) <= MAX_OPTIONS:
            raise SilverError("invalid", f"A vote needs 2 to {MAX_OPTIONS} different options.")
        p = {"id": secrets.token_urlsafe(5).replace("-", "a").replace("_", "b"), "key": secrets.token_urlsafe(12), "kind": kind,
             "week": week, "question": " ".join(str(question or "").split())[:140], "options": clean, "votes": {}, "status": "open",
             "created": time.time()}
        with self._lock:
            data = self._load()
            data["polls"][p["id"]] = p
            self._save(data)
        self.s.emit("friends.poll", {"id": p["id"], "week": week, "kind": kind})
        return self._poll_view(p)

    def _poll(self, data: dict[str, Any], poll_id: str) -> dict[str, Any]:
        p = data["polls"].get(poll_id or "")
        if not p:
            raise SilverError("not_found", "That vote does not exist.")
        return p

    def poll_get(self, poll_id: str = "") -> dict[str, Any]:
        data = self._load()
        if poll_id:
            return self._poll_view(self._poll(data, poll_id))
        polls = sorted(data["polls"].values(), key=lambda p: -p["created"])
        return {"polls": [self._poll_view(p) for p in polls[:20]], "week_rules": data["week_rules"], "current_week": self.s.current_week(),
                "rules": [{"value": r, "label_es": es, "label_en": en} for r, (es, en) in RULES.items()]}

    def vote(self, poll_id: str, *, name: str, option: str, key: str = "", host: bool = False) -> dict[str, Any]:
        """A friend's vote (through the room server, with the link's key) or one the host adds (a vote that came by message)."""
        name = " ".join(str(name or "").split())[:40]
        if not name:
            raise SilverError("invalid", "Say who votes.")
        with self._lock:
            data = self._load()
            p = self._poll(data, poll_id)
            if not host and not (key and secrets.compare_digest(key, p["key"])):
                raise SilverError("forbidden", "This link's key is not valid for the vote.")
            if p["status"] != "open":
                raise SilverError("conflict", "This vote is closed.")
            choice = next((o for o in p["options"] if o.lower() == str(option or "").strip().lower()), "")
            if not choice:
                raise SilverError("invalid", "That is not one of the options.")
            p["votes"][name.lower()] = {"name": name, "option": choice, "at": time.time()}
            self._save(data)
        return self._poll_view(p, host=host)

    def poll_close(self, poll_id: str) -> dict[str, Any]:
        """Close a vote: the most voted option (the first offered among a tie) becomes the rule of that week's challenge."""
        with self._lock:
            data = self._load()
            p = self._poll(data, poll_id)
            view = self._poll_view(p, host=False)
            if not view["votes"]:
                raise SilverError("conflict", "Nobody has voted yet.")
            top = max(view["options"], key=lambda o: o["votes"])["value"]
            p["status"] = "closed"
            p["winner"] = top
            data["week_rules"][p["week"]] = {"kind": p["kind"], "value": top, "poll": p["id"]}
            self._save(data)
        self.s.emit("friends.week_rule", {"week": p["week"], "kind": p["kind"], "value": top})
        return {**self._poll_view(p), "week_rule": data["week_rules"][p["week"]]}

    def week_rule(self, week: str) -> Optional[dict[str, Any]]:
        return self._load()["week_rules"].get(week)

    def clear_week_rule(self, week: str) -> dict[str, Any]:
        with self._lock:
            data = self._load()
            data["week_rules"].pop(week, None)
            self._save(data)
        return {"week": week, "cleared": True}

    # ------------------------------------------------------------ the vote page (room server)
    def vote_page(self, poll_id: str, key: str, *, lang: str = "es", message: str = "", voted: str = "") -> str:
        data = self._load()
        p = self._poll(data, poll_id)
        if not (key and secrets.compare_digest(key, p["key"])):
            raise SilverError("forbidden", "This link's key is not valid for the vote.")
        es = lang == "es"
        view = self._poll_view(p, host=False)
        owner = self.s.settings["player_name"] or "Silver's Hoard"
        title = (p["question"] or (f"¿Qué {'Pokémon' if p['kind'] == 'pokemon' else 'regla'} ponemos en el reto de la semana {p['week']}?" if es
                                   else f"Which {'Pokémon' if p['kind'] == 'pokemon' else 'rule'} for the week's challenge {p['week']}?"))
        def label(o: dict[str, Any]) -> str:
            return o.get("label_es" if es else "label_en") or o["value"]
        opts = "".join(
            f"<label class=opt><input type=radio name=option value=\"{html.escape(o['value'])}\" {'checked' if o['value'] == voted else ''} required>"
            f"<span>{html.escape(label(o))}</span><em>{o['votes']}</em></label>" for o in view["options"])
        closed = p["status"] != "open"
        form = (f"<p class=done>{'Votación cerrada' if es else 'Vote closed'}: <b>{html.escape(p.get('winner') or '')}</b></p>" if closed else
                f"<form method=post><input name=name placeholder=\"{'Tu nombre' if es else 'Your name'}\" maxlength=40 required>{opts}"
                f"<button>{'Votar' if es else 'Vote'}</button></form>")
        if closed:
            form += "".join(f"<div class=opt><span>{html.escape(label(o))}</span><em>{o['votes']}</em></div>" for o in view["options"])
        return f"""<!doctype html><html lang="{'es' if es else 'en'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{html.escape(title)}</title><style>
body{{margin:0;background:#141016;color:#eee;font:15px/1.5 system-ui,sans-serif}}main{{max-width:560px;margin:0 auto;padding:24px 16px}}
h1{{color:#e3424f;font-family:Georgia,serif;font-weight:500;font-size:24px;margin:0 0 6px}}p{{color:#aaa}}
input[name=name]{{width:100%;box-sizing:border-box;padding:10px;border-radius:8px;border:1px solid #3a3040;background:#1d171f;color:#eee;margin:8px 0 12px}}
.opt{{display:flex;align-items:center;gap:10px;padding:10px 12px;margin:6px 0;border:1px solid #2c2430;border-radius:10px;background:#1d171f;cursor:pointer}}
.opt span{{flex:1}}.opt em{{color:#aaa;font-style:normal}}button{{margin-top:10px;padding:10px 18px;border:0;border-radius:8px;background:#e3424f;color:#fff;font-weight:700;cursor:pointer}}
.msg{{padding:10px 12px;border-radius:8px;background:#22351f;color:#cfe8c4}}.done b{{color:#f2c14e}}</style></head><body><main>
<h1>{html.escape(title)}</h1><p>{html.escape(owner)} · {view['votes']} {'votos' if es else 'votes'}</p>
{f'<p class=msg>{html.escape(message)}</p>' if message else ''}{form}</main></body></html>"""
