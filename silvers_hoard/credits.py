"""Who drew what: the artists of the trainer sprites (Showdown's trainer sprite index, which asks for credit to the artist when a
sprite is used elsewhere) and of the arena's walking sprites (PMDCollab's SpriteCollab tracker, by species and form), plus the fixed
list of sources the app uses. Both lists are downloaded when first asked for and kept in ``data/cache/credits`` (a month for the
trainer sprites, a week for SpriteCollab); a stale copy is used when the network is down, and nothing waits on the network unless
asked to (``wait=True``): screens get what is cached and the download runs in the background."""

from __future__ import annotations

import html
import json
import logging
import re
import threading
import time
from pathlib import Path
from typing import Any, Callable, Optional

from .hoard_link.atomic import write_bytes_atomic

log = logging.getLogger("silver.credits")

TRAINERS_URL = "https://play.pokemonshowdown.com/sprites/trainers/"
TRAINERS_TTL_S = 30 * 24 * 3600
PMD_TTL_S = 7 * 24 * 3600
FIGURE = re.compile(r'<figure id="([^"]+)\.png">.*?<figcaption>(.*?)</figcaption>', re.S)
BY = re.compile(r"<br\s*/?>\s*by\s+(.+)$", re.S)
TAG = re.compile(r"<[^>]+>")

# what the app shows or plays and where it comes from (the README's credits, as data for the credits page and the tool)
SOURCES: list[dict[str, str]] = [
    {"id": "showdown", "what": "Battle engine", "what_es": "Motor de combate", "by": "Pokémon Showdown (Guangcong Luo and contributors), through the @pkmn packages", "by_es": "Pokémon Showdown (Guangcong Luo y colaboradores), a través de los paquetes @pkmn",
     "licence": "MIT", "url": "https://github.com/smogon/pokemon-showdown"},
    {"id": "showdown-text", "what": "Official log messages and their parser", "what_es": "Mensajes oficiales del registro y su intérprete",
     "by": "Pokémon Showdown: data/text and the client's battle-text-parser.ts", "by_es": "Pokémon Showdown: data/text y battle-text-parser.ts de su cliente", "licence": "MIT", "url": "https://github.com/smogon/pokemon-showdown-client"},
    {"id": "showdown-anims", "what": "Turn-based move animations", "what_es": "Animaciones de los movimientos por turnos",
     "by": "Pokémon Showdown's battle client (battle-animations-moves.ts, CC0; battle-animations.ts, MIT); effect pictures by Kris Johnson, Kevin Lau, Ridaz, Catherine D. (SailorCosmos), Shriansh Chari (Tb0lt) and others", "by_es": "El cliente de combate de Pokémon Showdown (battle-animations-moves.ts, CC0; battle-animations.ts, MIT); dibujos de efectos de Kris Johnson, Kevin Lau, Ridaz, Catherine D. (SailorCosmos), Shriansh Chari (Tb0lt) y otros",
     "licence": "CC0 / MIT", "url": "https://pokemonshowdown.com/credits"},
    {"id": "showdown-backdrops", "what": "Battle backdrops", "what_es": "Fondos de combate", "by": "Kyle Dove (Pokémon Showdown)", "licence": "credit to the artist", "licence_es": "crédito al artista",
     "url": "https://pokemonshowdown.com/credits"},
    {"id": "showdown-trainers", "what": "Trainer sprites", "what_es": "Sprites de entrenador", "by": "the games' art and Showdown's artists (each one below)", "by_es": "el arte de los juegos y los artistas de Showdown (cada uno abajo)",
     "licence": "credit to the artist", "licence_es": "crédito al artista", "url": TRAINERS_URL},
    {"id": "showdown-sprites", "what": "Pokémon sprites, cries and battle music", "what_es": "Sprites de Pokémon, gritos y música de combate",
     "by": "Showdown's sprite and audio servers (cries and tracks belong to their game studios and composers)", "by_es": "los servidores de sprites y audio de Showdown (gritos y pistas son de sus estudios y compositores)", "licence": "©", "url": "https://play.pokemonshowdown.com/sprites/"},
    {"id": "spritecollab", "what": "Walking sprites of the real-time arena and the Pokémon's portraits with emotions", "what_es": "Sprites que caminan en la arena en tiempo real y retratos de los Pokémon con emociones",
     "by": "PMDCollab's SpriteCollab, by its many artists (each Pokémon's below)", "by_es": "SpriteCollab de PMDCollab, de sus muchos artistas (los de cada Pokémon, abajo)", "licence": "CC BY-NC 4.0", "url": "https://sprites.pmdcollab.org/"},
    {"id": "kenney-particles", "what": "Particle textures of the real-time effects", "what_es": "Texturas de las partículas del tiempo real",
     "by": "Kenney's Particle Pack (kenney.nl)", "by_es": "el Particle Pack de Kenney (kenney.nl)", "licence": "CC0", "url": "https://kenney.nl/assets/particle-pack"},
    {"id": "pokeapi-sprites", "what": "3D Pokémon sprites of Champions, Legends: Z-A and Scarlet / Violet (optional sets)",
     "what_es": "Sprites 3D de Pokémon de Champions, Leyendas Z-A y Escarlata y Púrpura (conjuntos opcionales)",
     "by": "PokeAPI's sprite collection (the pictures are the games' art)", "by_es": "la colección de sprites de PokeAPI (las imágenes son arte de los juegos)",
     "licence": "©", "url": "https://github.com/PokeAPI/sprites"},
    {"id": "pokesurvivor", "what": "Lining walking sprites up by their shadow", "what_es": "Alinear los sprites que caminan por su sombra",
     "by": "PokéSurvivor's sprite tools", "by_es": "las herramientas de sprites de PokéSurvivor", "licence": "MIT", "url": ""},
    {"id": "pokeapi", "what": "Spanish names and descriptions of moves, abilities, items and natures", "what_es": "Nombres y descripciones en castellano de movimientos, habilidades, objetos y naturalezas",
     "by": "PokeAPI", "licence": "BSD-3-Clause (data © its owners)", "licence_es": "BSD-3-Clause (datos © sus dueños)", "url": "https://pokeapi.co/"},
    {"id": "bulbapedia", "what": "The characters' teams of every game", "what_es": "Los equipos de los personajes en cada juego", "by": "Bulbapedia",
     "licence": "CC BY-NC-SA 2.5", "url": "https://bulbapedia.bulbagarden.net/"},
    {"id": "unbound", "what": "Pokémon Unbound's Battle Frontier trainers and the abilities Unbound gives each species",
     "what_es": "Los entrenadores de la Frontera de Pokémon Unbound y las habilidades que Unbound da a cada especie",
     "by": "Skeli and the Unbound team (the sets' facts, from Complete Fire Red Upgrade) and PUSE by Zannael (abilities read from the ROM)",
     "by_es": "Skeli y el equipo de Unbound (los datos de los sets, de Complete Fire Red Upgrade) y PUSE de Zannael (habilidades leídas de la ROM)",
     "licence": "facts of the sets; PUSE: MIT", "licence_es": "datos de los sets; PUSE: MIT", "url": "https://github.com/Zannael/PUSE"},
    {"id": "pret", "what": "In-game teams of Crystal, FireRed/LeafGreen and Emerald", "what_es": "Equipos de Cristal, RojoFuego/VerdeHoja y Esmeralda",
     "by": "the pret disassemblies (pokecrystal, pokefirered, pokeemerald)", "by_es": "los desensamblados de pret (pokecrystal, pokefirered, pokeemerald)", "licence": "—", "url": "https://github.com/pret"},
    {"id": "pkmn-data", "what": "Popular sets and usage statistics", "what_es": "Sets populares y estadísticas de uso", "by": "data.pkmn.cc (Smogon's sets and Showdown's ladder)", "by_es": "data.pkmn.cc (sets de Smogon y ranking de Showdown)",
     "licence": "MIT (tools); data © Smogon", "licence_es": "MIT (herramientas); datos © Smogon", "url": "https://data.pkmn.cc/"},
    {"id": "poke-engine", "what": "The master AI's search", "what_es": "La búsqueda de la IA maestra", "by": "poke-engine (pmariglia)", "licence": "MIT",
     "url": "https://github.com/pmariglia/poke-engine"},
    {"id": "metamon", "what": "The neural AI's policy (optional, run from its own environment)", "what_es": "La política de la IA neuronal (opcional, en su propio entorno)",
     "by": "metamon and amago (UT Austin Robot Perception and Learning Lab)", "by_es": "metamon y amago (UT Austin Robot Perception and Learning Lab)",
     "licence": "MIT", "url": "https://github.com/UT-Austin-RPL/metamon"},
    {"id": "za", "what": "Real-time rules and move cooldowns", "what_es": "Reglas del tiempo real y recargas de los movimientos",
     "by": "Pokémon Legends: Z-A as documented by Serebii and Bulbapedia", "by_es": "Leyendas Pokémon: Z-A según Serebii y Bulbapedia", "licence": "—", "url": "https://www.serebii.net/legendsz-a/"},
]


def parse_trainer_index(page: str) -> dict[str, str]:
    """{sprite name: artist} from Showdown's trainer sprite index (sprites without an artist are the games' own art)."""
    out: dict[str, str] = {}
    for name, caption in FIGURE.findall(page):
        m = BY.search(caption)
        if m:
            artist = html.unescape(TAG.sub("", m.group(1))).strip()
            if artist:
                out[name.strip().lower()] = artist[:80]
    return out


def parse_credit_names(text: str) -> dict[str, str]:
    """SpriteCollab's credit_names.txt (Name, Discord, Contact): {discord id or name: name}."""
    out: dict[str, str] = {}
    for line in text.splitlines()[1:]:
        cols = line.split("\t")
        if len(cols) >= 2 and cols[0].strip():
            name = cols[0].strip()
            out[cols[1].strip()] = name
            out[name] = name
    return out


def pmd_credits(tracker: dict[str, Any], names: dict[str, str], kind: str = "sprite") -> dict[str, list[str]]:
    """{sprite folder ("0006", "0006/0001", "0006/0000/0001"): [artists, the main one first]} from SpriteCollab's tracker; kind
    "portrait" gives the artists of the portraits instead of the walking sprites."""
    out: dict[str, list[str]] = {}

    def who(ref: str) -> str:
        ref = str(ref or "").strip()
        return names.get(ref) or ("" if ref.startswith("<@") else ref)

    def walk(prefix: str, entry: dict[str, Any]) -> None:
        credit = entry.get(f"{kind}_credit") or {}
        if entry.get(f"{kind}_files") and credit.get("primary"):
            people = [who(credit.get("primary")), *(who(x) for x in credit.get("secondary") or [])]
            people = list(dict.fromkeys(p for p in people if p))
            if people:
                out[prefix] = people[:6]
        for sub, child in (entry.get("subgroups") or {}).items():
            if isinstance(child, dict) and sub != "0000":
                walk(f"{prefix}/{sub}", child)
            elif isinstance(child, dict) and child.get("subgroups"):
                for sub2, child2 in child["subgroups"].items():
                    if isinstance(child2, dict) and sub2 != "0000":
                        walk(f"{prefix}/0000/{sub2}", child2)

    for dex, entry in tracker.items():
        if isinstance(entry, dict) and str(dex).isdigit():
            walk(f"{int(dex):04d}", entry)
    return out


class Credits:
    def __init__(self, cache_dir: Path, settings: Any, http_get: Callable[[str], tuple[int, bytes, str]],
                 pmd_base: Callable[[], str]):
        self.cache_dir = Path(cache_dir)
        self.settings = settings
        self._http_get = http_get
        self._pmd_base = pmd_base
        self._mem: dict[str, Any] = {}
        self._busy: set[str] = set()
        self._guard = threading.Lock()

    # ------------------------------------------------------------ cache
    def _read(self, name: str, ttl: float) -> tuple[Optional[Any], bool]:
        """(data, fresh): the cached list and whether it is younger than ttl."""
        if name in self._mem:
            data, at = self._mem[name]
            return data, time.time() - at < ttl
        path = self.cache_dir / f"{name}.json"
        try:
            data = json.loads(path.read_text("utf-8"))
        except (OSError, ValueError):
            return None, False
        at = path.stat().st_mtime
        self._mem[name] = (data, at)
        return data, time.time() - at < ttl

    def _write(self, name: str, data: Any) -> None:
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        write_bytes_atomic(self.cache_dir / f"{name}.json", json.dumps(data, separators=(",", ":"), ensure_ascii=False).encode("utf-8"),
                           fsync=False)
        self._mem[name] = (data, time.time())

    def _get(self, url: str) -> Optional[bytes]:
        try:
            status, body, _ = self._http_get(url)
        except Exception as exc:  # noqa: BLE001 - offline: the old copy (or nothing) is used
            log.info("credits %s: %s", url, exc)
            return None
        return body if status == 200 and body else None

    def _load(self, name: str, ttl: float, fetch: Callable[[], Optional[Any]], wait: bool) -> dict[str, Any]:
        data, fresh = self._read(name, ttl)
        if fresh or not self.settings.get("sprite_downloads", True):
            return data or {}
        if not wait:
            with self._guard:
                if name in self._busy:
                    return data or {}
                self._busy.add(name)

            def run() -> None:
                try:
                    got = fetch()
                    if got:
                        self._write(name, got)
                finally:
                    with self._guard:
                        self._busy.discard(name)
            threading.Thread(target=run, name=f"silver-credits-{name}", daemon=True).start()
            return data or {}
        got = fetch()
        if got:
            self._write(name, got)
            return got
        return data or {}

    # ------------------------------------------------------------ the two lists
    def _fetch_trainers(self) -> Optional[dict[str, str]]:
        body = self._get(TRAINERS_URL)
        found = parse_trainer_index(body.decode("utf-8", "replace")) if body else {}
        return found or None

    def _fetch_pmd(self, kind: str = "sprite") -> Optional[dict[str, list[str]]]:
        base = self._pmd_base().rstrip("/")
        raw = self._get(f"{base}/tracker.json")
        if not raw:
            return None
        names = self._get(f"{base}/credit_names.txt")
        try:
            return pmd_credits(json.loads(raw.decode("utf-8")), parse_credit_names(names.decode("utf-8", "replace")) if names else {}, kind) or None
        except (ValueError, AttributeError) as exc:
            log.warning("credits tracker: %s", exc)
            return None

    def trainers(self, wait: bool = False) -> dict[str, str]:
        return self._load("trainers", TRAINERS_TTL_S, self._fetch_trainers, wait)

    def pmd(self, wait: bool = False) -> dict[str, list[str]]:
        return self._load("pmd", PMD_TTL_S, self._fetch_pmd, wait)

    def portraits(self, wait: bool = False) -> dict[str, list[str]]:
        return self._load("pmd_portraits", PMD_TTL_S, lambda: self._fetch_pmd("portrait"), wait)

    def trainer(self, name: str, wait: bool = False) -> str:
        return self.trainers(wait).get(str(name or "").lower(), "")

    def walking(self, folder: str, wait: bool = False) -> list[str]:
        """Artists of a SpriteCollab folder ("0006/0001"), falling back to the plain form's."""
        table = self.pmd(wait)
        f = folder.replace("-", "/")
        while f:
            if f in table:
                return table[f]
            f = f.rsplit("/", 1)[0] if "/" in f else ""
        return []

    def summary(self, wait: bool = False) -> dict[str, Any]:
        t = self.trainers(wait)
        p = self.pmd(wait)
        artists: dict[str, int] = {}
        for a in t.values():
            artists[a] = artists.get(a, 0) + 1
        walkers: dict[str, int] = {}
        for people in p.values():
            for a in people:
                walkers[a] = walkers.get(a, 0) + 1
        faces: dict[str, int] = {}
        q = self.portraits(wait)
        for people in q.values():
            for a in people:
                faces[a] = faces.get(a, 0) + 1
        top = lambda d: [{"artist": a, "sprites": n} for a, n in sorted(d.items(), key=lambda x: (-x[1], x[0].lower()))]
        return {"sources": SOURCES, "trainer_sprites": {"credited": len(t), "artists": top(artists)},
                "walking_sprites": {"folders": len(p), "artists": top(walkers)},
                "portraits": {"folders": len(q), "artists": top(faces)}}
