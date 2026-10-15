"""Official artwork of trainers and characters, as the Pokémon Wiki (pokemon.fandom.com) lists it on each character's page.

The wiki's API says which pictures a page has, how big they are and where they live; that answer is kept a week in
``data/cache/art``. The pictures stay on the wiki's image server (static.wikia.nocookie.net): the app's page shows them from there
and, when one is chosen, fetches it and hands it to the app as the trainer's own picture (that server answers browsers and turns
scripts away, so the picture always travels through the page). Nothing of that art ships with the app."""

from __future__ import annotations

import hashlib
import json
import logging
import re
import time
from pathlib import Path
from typing import Any, Callable, Optional
from urllib.parse import quote

from .errors import SilverError

log = logging.getLogger("silver.art")

API = "https://pokemon.fandom.com/api.php"
WIKI = "https://pokemon.fandom.com/wiki/"
IMAGE_HOSTS = ("static.wikia.nocookie.net",)
TTL_S = 7 * 24 * 3600
CREDIT = "Pokémon Wiki (Fandom)"
COPYRIGHT = "© Nintendo, Creatures, GAME FREAK, The Pokémon Company"
FULL_HEIGHT = 1200          # the picture a trainer keeps: at most this tall (the wiki scales it down on its server)
THUMB_WIDTH = 240

# what a page shows besides the game art: the anime, the manga, sketches, sprites, menus, merchandise…
SKIP = re.compile(r"(^|[\s_(-])(anime|adventures|manga|concept|sketch|back|backsprite|card|tcg|trailer|generations|origins|evolutions|"
                  r"twilight|journeys|ssbb|ssbu|ssb4|smash|vs|ts|credits|intro|battle|overworld|ow|icon|mugshot|sprite|shiny|dream|menu|"
                  r"model|screenshot|cosplay|figure|plush|merch|logo|pokédex|pokedex|cameo|cutscene|episode|movie|film|comic|"
                  r"artbook|silhouette|chibi|emote|stamp|sticker|poster|banner|wallpaper|tw|dpa|salon|magazine)([\s_.)-]|$)", re.I)
NUMBERED = re.compile(r"^\d{3,4}|\s\d{1,3}$")    # Pokédex-numbered sprites; trading card art ends with its number
STOP = {"the", "of", "and", "team", "trainer", "professor", "pokémon", "pokemon", "game", "leader", "elite", "four", "champion"}

# the games as the wiki names them in its picture titles (newest first: the list's order is the gallery's order)
GAMES: list[tuple[str, str]] = [
    ("Legends: Z-A", "Leyendas Pokémon: Z-A"), ("Legends Z-A", "Leyendas Pokémon: Z-A"),
    ("The Indigo Disk", "El disco índigo"), ("The Teal Mask", "La máscara turquesa"),
    ("Scarlet and Violet", "Escarlata y Púrpura"), ("Legends: Arceus", "Leyendas Pokémon: Arceus"),
    ("Legends Arceus", "Leyendas Pokémon: Arceus"), ("Brilliant Diamond and Shining Pearl", "Diamante Brillante y Perla Reluciente"),
    ("Sword and Shield", "Espada y Escudo"), ("Let's Go, Pikachu! and Let's Go, Eevee!", "Let's Go, Pikachu! y Let's Go, Eevee!"),
    ("Ultra Sun and Ultra Moon", "Ultrasol y Ultraluna"), ("Sun and Moon", "Sol y Luna"),
    ("Omega Ruby and Alpha Sapphire", "Rubí Omega y Zafiro Alfa"), ("X and Y", "X e Y"),
    ("Black 2 and White 2", "Negro 2 y Blanco 2"), ("Black and White", "Negro y Blanco"),
    ("HeartGold and SoulSilver", "Oro HeartGold y Plata SoulSilver"), ("Platinum", "Platino"), ("Diamond and Pearl", "Diamante y Perla"),
    ("Emerald", "Esmeralda"), ("FireRed and LeafGreen", "Rojo Fuego y Verde Hoja"), ("Ruby and Sapphire", "Rubí y Zafiro"),
    ("Colosseum", "Colosseum"), ("XD", "XD"), ("Crystal", "Cristal"), ("Gold and Silver", "Oro y Plata"), ("Yellow", "Amarillo"),
    ("Red and Green", "Rojo y Verde"), ("Red and Blue", "Rojo y Azul"), ("Stadium", "Stadium"), ("Masters", "Pokémon Masters EX"),
    ("Champions", "Pokémon Champions"),
]
ABBR: dict[str, tuple[str, str]] = {
    "ZA": GAMES[0], "SV": GAMES[4], "PLA": GAMES[5], "LA": GAMES[5], "BDSP": GAMES[7], "SWSH": GAMES[8], "LGPE": GAMES[9],
    "USUM": GAMES[10], "SM": GAMES[11], "ORAS": GAMES[12], "XY": GAMES[13], "B2W2": GAMES[14], "BW": GAMES[15], "HGSS": GAMES[16],
    "PT": GAMES[17], "DPPT": GAMES[18], "DP": GAMES[18], "E": GAMES[19], "FRLG": GAMES[20], "RS": GAMES[21], "RSE": GAMES[21],
    "C": GAMES[24], "GSC": GAMES[25], "Y": GAMES[26], "RB": GAMES[28], "RGB": GAMES[28], "MASTERS": GAMES[30],
}
WORDS_ES = {"male": "chico", "female": "chica", "m": "chico", "f": "chica", "alt": "alternativo", "artwork": "", "art": "",
            "official": "", "sygna suit": "traje Sygna", "champion": "Campeón", "young": "joven", "old": "mayor"}


def _norm(text: str) -> str:
    return " ".join(str(text or "").split())


class OfficialArt:
    """Pages and pictures of the Pokémon Wiki. ``get_json(url, params)`` returns the API's answer (a fake in the tests)."""

    def __init__(self, cache_dir: Path, get_json: Optional[Callable[[str, dict[str, Any]], Any]] = None):
        self.cache_dir = cache_dir
        self._get_json = get_json or _get_json

    # ------------------------------------------------------------ cache
    def _cache_path(self, key: str) -> Path:
        return self.cache_dir / (hashlib.sha1(key.encode("utf-8")).hexdigest()[:20] + ".json")

    def _cached(self, key: str, make: Callable[[], Any], refresh: bool = False) -> Any:
        path = self._cache_path(key)
        if not refresh:
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
                if time.time() - float(data.get("t", 0)) < TTL_S:
                    return data["v"]
            except (OSError, ValueError, KeyError, TypeError):
                pass
        value = make()
        try:
            self.cache_dir.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps({"t": time.time(), "k": key, "v": value}, ensure_ascii=False), encoding="utf-8")
        except OSError as exc:
            log.info("art cache not written: %s", exc)
        return value

    def _api(self, **params: Any) -> dict[str, Any]:
        params = {**params, "format": "json", "formatversion": 2}
        try:
            data = self._get_json(API, params)
        except SilverError:
            raise
        except Exception as exc:  # noqa: BLE001 - any network failure reads the same to the user
            raise SilverError("unavailable", f"The Pokémon Wiki did not answer: {exc}", hint="Check the internet connection and try again.") from None
        if not isinstance(data, dict) or "error" in data:
            raise SilverError("unavailable", f"The Pokémon Wiki refused the question: {(data or {}).get('error')}")
        return data

    # ------------------------------------------------------------ search
    def search(self, query: str, *, page: str = "", limit: int = 40, refresh: bool = False) -> dict[str, Any]:
        """The official art of a character or trainer class: ``query`` is a name (Lance, Cynthia, Ace Trainer…); the page found is
        «<name> (game)» when the wiki has one (its game character, not the anime's), else «<name>», else the best search hit that
        has art. ``page`` asks for one page by title (one of ``pages``). Returns the page, the other pages found and its pictures."""
        q = _norm(query)[:80]
        if not q and not page:
            return {"query": "", "page": "", "pages": [], "images": [], "credit": CREDIT, "copyright": COPYRIGHT}
        pages = [] if page else self._cached(f"pages:{q.lower()}", lambda: self._pages(q), refresh)
        order = [_norm(page)] if page else pages
        found, images = "", []
        for title in order[:4]:
            images = self.page_art(title, refresh=refresh)
            if images:
                found = title
                break
        return {"query": q, "page": found or (order[0] if order else ""), "pages": pages, "images": images[: max(1, min(limit, 80))],
                "page_url": WIKI + quote((found or (order[0] if order else "")).replace(" ", "_")) if (found or order) else "",
                "credit": CREDIT, "copyright": COPYRIGHT}

    def _pages(self, q: str) -> list[str]:
        """Existing pages for a name: «<q> (game)» first, then «<q>», then the wiki's search hits."""
        data = self._api(action="query", titles=f"{q} (game)|{q}", redirects=1, list="search", srsearch=q, srlimit=8, srnamespace=0)
        query = data.get("query") or {}
        alias = {r["from"]: r["to"] for r in query.get("redirects") or []}
        alias.update({n["from"]: n["to"] for n in query.get("normalized") or []})
        existing = {p["title"] for p in query.get("pages") or [] if not p.get("missing") and not p.get("invalid")}
        out: list[str] = []

        def add(title: str) -> None:
            seen = set()
            while title in alias and title not in seen:   # normalized, then redirected
                seen.add(title)
                title = alias[title]
            if title and title not in out:
                out.append(title)

        for want in (f"{q} (game)", q):
            t = want
            seen = set()
            while t in alias and t not in seen:
                seen.add(t)
                t = alias[t]
            if t in existing:
                add(t)
        for hit in query.get("search") or []:
            add(hit.get("title", ""))
        return out[:10]

    def page_art(self, title: str, *, refresh: bool = False) -> list[dict[str, Any]]:
        title = _norm(title)[:120]
        if not title:
            return []
        return self._cached(f"art:{title}", lambda: self._page_art(title), refresh)

    def _page_art(self, title: str) -> list[dict[str, Any]]:
        data = self._api(action="query", titles=title, redirects=1, prop="images", imlimit=500)
        pages = (data.get("query") or {}).get("pages") or []
        if not pages or pages[0].get("missing"):
            return []
        real = pages[0].get("title") or title
        base = re.sub(r"\s*\([^)]*\)\s*$", "", real)
        files = [i["title"] for i in pages[0].get("images") or [] if i.get("title")]
        tokens = [w for w in re.findall(r"[a-zà-ÿ0-9]+", base.lower()) if len(w) > 1]
        key = [w for w in tokens if w not in STOP] or tokens

        def plain(f: str) -> str:
            return f.split(":", 1)[-1].rsplit(".", 1)[0]

        def named(f: str, words: list[str]) -> bool:
            low = re.sub(r"[_]", " ", plain(f).lower())
            return all(re.search(rf"(^|[^a-z]){re.escape(w)}", low) for w in words)

        picked = [f for f in files if named(f, tokens)] or [f for f in files if any(named(f, [w]) for w in key)]
        picked = [f for f in picked if not SKIP.search(plain(f)) and not NUMBERED.search(plain(f))
                  and f.lower().rsplit(".", 1)[-1] in ("png", "jpg", "jpeg", "webp")]
        out = []
        for k in range(0, len(picked), 50):
            info = self._api(action="query", titles="|".join(picked[k:k + 50]), prop="imageinfo", iiprop="url|size|mime",
                             iiurlwidth=THUMB_WIDTH)
            for p in (info.get("query") or {}).get("pages") or []:
                ii = (p.get("imageinfo") or [None])[0]
                if not ii:
                    continue
                w, h = int(ii.get("width") or 0), int(ii.get("height") or 0)
                if h < 260 or h < w * 1.15 or not str(ii.get("mime", "")).startswith("image/"):
                    continue   # sprites, menus and wide scenes: the art is a tall full-body picture
                label, label_es, rank = self._label(plain(p["title"]), base)
                url = str(ii.get("url") or "")
                if not _image_host(url):
                    continue
                out.append({"file": p["title"].split(":", 1)[-1], "label": label, "label_es": label_es, "width": w, "height": h,
                            "url": url, "thumb": str(ii.get("thumburl") or url), "full": scaled(url, h), "rank": rank,
                            "page": real, "page_url": WIKI + quote(real.replace(" ", "_"))})
        out.sort(key=lambda x: (x["rank"], -x["height"]))
        return out

    @staticmethod
    def _label(stem: str, base: str) -> tuple[str, str, int]:
        """«Lance HeartGold and SoulSilver» → (HeartGold and SoulSilver, Oro HeartGold y Plata SoulSilver, its place in GAMES)."""
        def cut(text: str, word: str) -> str:
            return re.sub(rf"(?<![A-Za-z]){re.escape(word)}(?![A-Za-z])", " ", text, flags=re.I)

        stem = _norm(stem.replace("_", " "))
        if stem.lower().startswith(base.lower() + " "):
            rest = stem[len(base):]      # «Red Red and Green»: only the name in front goes
        elif stem.lower().endswith(" " + base.lower()):
            rest = stem[: -len(base)]
        else:
            rest = cut(stem, base)
            for w in base.split():
                rest = cut(rest, w)
        rest = _norm(rest).strip(" -,()")
        for i, (en, es) in enumerate(GAMES):
            if en.lower() in rest.lower():
                extra = _norm(re.sub(re.escape(en), " ", rest, flags=re.I)).strip(" -,()")
                return (f"{en} · {extra}" if extra else en), (f"{es} · {_es_words(extra)}" if extra else es), i
        words = rest.split()
        for i, w in enumerate(words):
            hit = ABBR.get(w.upper().strip("()"))
            if hit:
                extra = " ".join(words[:i] + words[i + 1:])
                return (f"{hit[0]} · {_en_words(extra)}" if extra else hit[0]), (f"{hit[1]} · {_es_words(extra)}" if extra else hit[1]), GAMES.index(hit)
        return (rest or "Official art"), (_es_words(rest) or "Arte oficial"), len(GAMES)


def _en_words(text: str) -> str:
    return " ".join({"m": "male", "f": "female"}.get(w.lower(), w) for w in text.split())


def _es_words(text: str) -> str:
    out = []
    for w in text.split():
        es = WORDS_ES.get(w.lower().strip("()"))
        if es is None:
            out.append(w)
        elif es:
            out.append(es)
    return " ".join(out)


def _image_host(url: str) -> bool:
    m = re.match(r"^https://([^/]+)/", url or "")
    return bool(m) and m.group(1) in IMAGE_HOSTS


def scaled(url: str, height: int, target: int = FULL_HEIGHT) -> str:
    """The wiki's own server-side scaling of a picture (…/revision/latest/scale-to-height-down/N?cb=…) when it is taller than N."""
    if height <= target or "/revision/latest" not in url:
        return url
    head, _, query = url.partition("?")
    head = head.rstrip("/")
    return f"{head}/scale-to-height-down/{target}" + (f"?{query}" if query else "")


def _get_json(url: str, params: dict[str, Any]) -> Any:
    import httpx

    with httpx.Client(timeout=20.0, follow_redirects=True, headers={"User-Agent": "SilversHoard/0.1 (local battle simulator)"}) as client:
        r = client.get(url, params=params)
        if r.status_code != 200:
            raise SilverError("unavailable", f"The Pokémon Wiki answered {r.status_code}.")
        return r.json()
