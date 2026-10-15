"""Popular sets and usage statistics from data.pkmn.cc: Smogon's sets (read when asked for and kept in data/cache/smogon, never
shipped) and the public usage statistics of Showdown's ladder, trimmed to what the team builder shows."""

from __future__ import annotations

import json
import re
import time
from pathlib import Path
from typing import Any, Callable, Optional

from .errors import SilverError

BASE = "https://data.pkmn.cc"
TTL_S = 7 * 24 * 3600
MISSING_TTL_S = 24 * 3600
TOP = {"items": 8, "abilities": 4, "moves": 12, "teammates": 8, "spreads": 4, "teraTypes": 6}


def _first(value: Any) -> Any:
    return value[0] if isinstance(value, list) and value else value


def _options(value: Any) -> list[Any]:
    if value in (None, "", []):
        return []
    return list(value) if isinstance(value, list) else [value]


def candidates(fmt: str) -> list[str]:
    """data.pkmn.cc formats to try for one of the app's formats, closest first: the format itself, its plain version (National
    Dex AG -> National Dex), and the generation's OU (custom games have no ladder of their own)."""
    # a format id is letters and digits only: it names a URL on data.pkmn.cc and a file in the cache
    fmt = re.sub(r"[^a-z0-9]", "", (fmt or "").lower()) or "gen9ou"
    m = re.match(r"gen(\d)", fmt)
    gen = m.group(1) if m else "9"
    out = [fmt]
    if fmt.endswith("ag"):
        out.append(fmt[:-2])
    if "doubles" in fmt:
        out.append(f"gen{gen}doublesou")
    if "nationaldex" in fmt:
        out.append(f"gen{gen}nationaldex")
    out.append(f"gen{gen}ou")
    # a species that is not used in OU has its sets in its own tier
    if "nationaldex" in fmt:
        out += [f"gen{gen}nationaldexubers", f"gen{gen}nationaldexuu", f"gen{gen}nationaldexmonotype"]
    out += [f"gen{gen}{tier}" for tier in ("ubers", "uu", "ru", "nu", "pu", "zu", "lc")]
    return list(dict.fromkeys(x for x in out if x and "customgame" not in x))


def norm_set(name: str, raw: dict[str, Any]) -> dict[str, Any]:
    moves = [m for m in raw.get("moves") or [] if m]
    evs = raw.get("evs")
    evs = _first(evs) if isinstance(evs, list) else (evs or {})
    ivs = raw.get("ivs")
    ivs = _first(ivs) if isinstance(ivs, list) else (ivs or {})
    out = {
        "name": name,
        "moves": [_first(m) for m in moves][:4],
        "move_options": [_options(m) for m in moves][:4],
        "item": _first(raw.get("item")) or "",
        "item_options": _options(raw.get("item")),
        "ability": _first(raw.get("ability")) or "",
        "ability_options": _options(raw.get("ability")),
        "nature": _first(raw.get("nature")) or "",
        "nature_options": _options(raw.get("nature")),
        "evs": {k: int(v) for k, v in (evs or {}).items() if k in ("hp", "atk", "def", "spa", "spd", "spe")},
        "ivs": {k: int(v) for k, v in (ivs or {}).items() if k in ("hp", "atk", "def", "spa", "spd", "spe")},
        "teraType": _first(raw.get("teratypes") or raw.get("teraTypes")) or "",
        "tera_options": _options(raw.get("teratypes") or raw.get("teraTypes")),
    }
    if raw.get("level"):
        out["level"] = int(_first(raw["level"]))
    return out


def trim_stats(data: dict[str, Any]) -> dict[str, Any]:
    """The usage file of a format (several MB) cut to what is shown: per species the usage share and the most common items,
    abilities, moves, teammates, spreads and Tera types (each as [name, share])."""
    pokemon = {}
    for species, p in (data.get("pokemon") or {}).items():
        entry: dict[str, Any] = {"usage": round(float(((p.get("usage") or {}).get("weighted")) or 0), 4)}
        for key, n in TOP.items():
            table = p.get(key) or {}
            entry[key] = [[k, round(float(v), 4)] for k, v in sorted(table.items(), key=lambda kv: -float(kv[1] or 0))[:n] if k]
        pokemon[species] = entry
    return {"battles": data.get("battles") or 0, "pokemon": pokemon}


class Smogon:
    def __init__(self, cache_dir: Path, fetch: Callable[[str], tuple[int, bytes, str]], enabled: Callable[[], bool] = lambda: True):
        self.cache_dir = Path(cache_dir)
        self.fetch = fetch
        self.enabled = enabled
        self._mem: dict[str, tuple[float, Optional[dict[str, Any]]]] = {}

    def _load(self, kind: str, fmt: str) -> Optional[dict[str, Any]]:
        """sets/<fmt>.json or stats/<fmt>.json (trimmed): from memory, from the cache while fresh, else from data.pkmn.cc; a stale
        copy is used when the site does not answer, and a format the site does not have is remembered for a day."""
        key = f"{kind}-{fmt}"
        now = time.time()
        if key in self._mem and now - self._mem[key][0] < 600:
            return self._mem[key][1]
        path = self.cache_dir / f"{key}.json"
        cached = None
        if path.exists():
            try:
                cached = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                cached = None
        age = now - path.stat().st_mtime if path.exists() else None
        if cached is not None and age is not None and age < (MISSING_TTL_S if cached.get("missing") else TTL_S):
            value = None if cached.get("missing") else cached
            self._mem[key] = (now, value)
            return value
        if not self.enabled():
            value = None if (cached or {}).get("missing") else cached
            self._mem[key] = (now, value)
            return value
        try:
            status, body, _ = self.fetch(f"{BASE}/{kind}/{fmt}.json")
        except Exception:  # noqa: BLE001 - offline: the old copy, if any
            status, body = 0, b""
        value: Optional[dict[str, Any]]
        data = None
        if status == 200 and body:
            try:
                data = json.loads(body.decode("utf-8"))
            except (UnicodeDecodeError, ValueError):
                data = None      # a broken answer counts as no answer: the old copy, if any
        if isinstance(data, dict):
            value = trim_stats(data) if kind == "stats" else {"sets": data}
            self._write(path, value)
        elif status == 404:
            self._write(path, {"missing": True})
            value = None
        else:
            value = None if (cached or {}).get("missing") else cached
        self._mem[key] = (now, value)
        return value

    def _write(self, path: Path, value: dict[str, Any]) -> None:
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".tmp")
        tmp.write_text(json.dumps(value, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        tmp.replace(path)

    def _find(self, kind: str, fmt: str, species: str = "") -> tuple[str, Optional[dict[str, Any]]]:
        """The first candidate format with data (for `species`, when given; without one, only the closest formats)."""
        for f in candidates(fmt) if species else candidates(fmt)[:3]:
            data = self._load(kind, f)
            if not data:
                continue
            table = data.get("sets") if kind == "sets" else data.get("pokemon")
            if not species or self._key(table or {}, species):
                return f, data
        return "", None

    @staticmethod
    def _key(table: dict[str, Any], species: str) -> str:
        if species in table:
            return species
        want = re.sub(r"[^a-z0-9]", "", species.lower())
        return next((k for k in table if re.sub(r"[^a-z0-9]", "", k.lower()) == want), "")

    def sets(self, species: str, fmt: str) -> dict[str, Any]:
        if not species.strip():
            raise SilverError("invalid", "Give a species.")
        used, data = self._find("sets", fmt, species)
        sets = []
        if data:
            raw = data["sets"][self._key(data["sets"], species)]
            sets = [norm_set(name, s) for name, s in raw.items() if isinstance(s, dict)]
        u_fmt, stats = self._find("stats", fmt, species)
        usage = stats["pokemon"][self._key(stats["pokemon"], species)] if stats else None
        if usage and usage.get("abilities"):
            for x in sets:   # a set with one possible ability does not name it
                if not x["ability"]:
                    x["ability"] = usage["abilities"][0][0]
        return {"species": species, "format": used, "sets": sets, "usage_format": u_fmt, "usage": usage,
                "source": "Smogon sets and Showdown usage statistics via data.pkmn.cc"}

    def top(self, fmt: str, limit: int = 30) -> dict[str, Any]:
        used, stats = self._find("stats", fmt)
        rows = sorted(((k, v["usage"]) for k, v in ((stats or {}).get("pokemon") or {}).items()), key=lambda kv: -kv[1])[: max(1, min(limit, 200))]
        return {"format": used, "battles": (stats or {}).get("battles", 0), "species": [{"species": k, "usage": v} for k, v in rows]}

    def sample_team(self, fmt: str, size: int = 6) -> dict[str, Any]:
        """A team from the most used species of the format, each with its first popular set (species without one are skipped)."""
        top = self.top(fmt, 60)
        team = []
        for row in top["species"]:
            if len(team) >= size:
                break
            try:
                found = self.sets(row["species"], fmt)
            except SilverError:
                continue
            if found["sets"]:
                s = found["sets"][0]
                team.append({"species": row["species"], "name": "", **{k: s[k] for k in ("moves", "item", "ability", "nature", "evs", "ivs", "teraType")},
                             "level": s.get("level", 100), "set_name": s["name"]})
        return {"format": top["format"], "team": team}
