"""Extend the installed collection with published and newly drawn reactions.

Unfinished identities retain the explicitly marked legacy runtime fallback.
Use --require-raster to verify complete drawn coverage before the final release.
Original library packs, palettes and portraits stay intact.
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import httpx
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from silvers_hoard.pmd import ground_anchor, parse_animdata, resolve
from silvers_hoard.pmd_library import PmdLibrary
from silvers_hoard.pmd_shiny import palette_pair, recolor

ACTIONS = ("Pain", "HitGround")


def load_generated(library, art):
    """Read reviewed raster exports; a pending shiny is never a normal copy."""
    generated = {}
    for path in sorted((art / "compiled").glob("*/meta.json")):
        record = json.loads(path.read_text("utf8"))
        if not record.get("reviewed"):
            continue
        provenance = record["provenance"]
        for shiny in (False, True):
            if shiny and not record.get("shiny_reviewed", record["reviewed"]):
                continue
            actions = record.get("shiny", {}).get("a", {}) if shiny else record["a"]
            target = library.resolve(provenance["num"], provenance["form"], shiny=shiny)
            for action, geom in actions.items():
                raw = (path.parent / (action + ("-shiny" if shiny else "") + ".png")).read_bytes()
                image = Image.open(io.BytesIO(raw))
                if (image.size != (geom["w"] * geom["n"], geom["h"] * geom["r"])
                        or hashlib.sha256(raw).hexdigest() != geom["source"]["sha256"]):
                    raise ValueError(f"Changed raster export: {path.parent.name}/{action}")
                generated.setdefault(target["key"], {})[action] = (geom, raw)
    return generated


def published(source):
    if source.get("kind") == "published-pmd":
        return source
    return published(source["parent"]) if source.get("parent") else None


def collect(library, stage, workers):
    sources = {(s["sha"], s["folder"]) for m in library.metas.values()
               if (s := published(m.get("source", {})))}
    stage.mkdir(parents=True, exist_ok=True)
    with httpx.Client(timeout=30, follow_redirects=True, limits=httpx.Limits(max_connections=workers)) as client:
        def fetch(url, path):
            if path.is_file():
                return path.read_bytes()
            for attempt in range(3):
                try:
                    response = client.get(url)
                    if response.status_code == 404:
                        path.write_bytes(b"")
                        return b""
                    response.raise_for_status()
                    path.write_bytes(response.content)
                    return response.content
                except httpx.HTTPError:
                    if attempt == 2:
                        raise

        def one(item):
            sha, folder = item
            dest = stage / sha / folder.replace("/", "-")
            dest.mkdir(parents=True, exist_ok=True)
            base = f"https://raw.githubusercontent.com/PMDCollab/SpriteCollab/{sha}/sprite/{folder}"
            raw = fetch(base + "/AnimData.xml", dest / "AnimData.xml")
            anims, _ = parse_animdata(raw.decode("utf8")) if raw else ({}, 1)
            found = {}
            for action in ACTIONS:
                name, geom = resolve(anims, action)
                if not geom or name in ("Idle", "Walk", "Hurt", "Cringe"):
                    continue
                png = fetch(f"{base}/{name}-Anim.png", dest / f"{name}-Anim.png")
                if not png:
                    continue
                size = Image.open(io.BytesIO(png)).size
                if size[0] != geom["w"] * geom["n"] or size[1] % geom["h"]:
                    raise ValueError(f"Invalid geometry: {folder}/{action}")
                shadow = fetch(f"{base}/{name}-Shadow.png", dest / f"{name}-Shadow.png")
                anchor = ground_anchor(shadow, geom["w"], geom["h"]) if shadow else None
                if not anchor:
                    anchor = (geom["w"] / 2, geom["h"] * .78)
                found[action] = ({**geom, "r": size[1] // geom["h"], "ax": anchor[0], "ay": anchor[1],
                                  "source": {"kind": "published-pmd-reaction", "sha": sha,
                                             "folder": folder, "animation": name,
                                             "sha256": hashlib.sha256(png).hexdigest()}}, png)
                if action == "HitGround":
                    image = Image.open(io.BytesIO(png)).convert("RGBA")
                    # Some authored sequences stand up again. Stop at their lowest
                    # visible grounded pose instead of replaying that recovery.
                    def lowest(row):
                        bounds = [image.crop((i*geom["w"],row*geom["h"],(i+1)*geom["w"],(row+1)*geom["h"]))
                                       .getbbox() for i in range(geom["n"])]
                        return min((i for i,b in enumerate(bounds) if b),
                                   key=lambda i:(bounds[i][3]-bounds[i][1], -(bounds[i][2]-bounds[i][0]), i))
                    found[action][0]["ground_frames"] = [lowest(row) for row in range(size[1] // geom["h"])]
            return item, found

        result = {}
        with ThreadPoolExecutor(max_workers=workers) as pool:
            jobs = [pool.submit(one, s) for s in sorted(sources)]
            for i, job in enumerate(as_completed(jobs), 1):
                key, found = job.result()
                result[key] = found
                if i % 100 == 0 or i == len(jobs):
                    print(f"Published reactions {i}/{len(jobs)}", flush=True)
        return result


def compile_reactions(library, collected, generated=None, *, require_raster=False):
    # One additive, content-addressed pack; never rewrite an installed pack.
    manifest = {"version": 1, "metas": {}, "files": {}, "packs": [], "coverage": {}}
    data = bytearray()

    def pack(raw):
        sha = hashlib.sha256(raw).hexdigest()
        key = "pmd:" + sha
        if key not in library.manifest["files"] and key not in manifest["files"]:
            manifest["files"][key] = {"pmd": 0, "offset": len(data), "size": len(raw),
                                      "mime": "image/png", "sha256": sha}
            data.extend(raw)
        return key

    entries = library.manifest["entries"]
    for key, meta in library.manifest["metas"].items():
        src = published(meta.get("source", {}))
        native = collected.get((src["sha"], src["folder"]), {}) if src else {}
        palette = None
        # Derived shiny/exterior metadata records its original published folder.
        # Transfer colours from this exact identity's aligned installed sheets.
        requests = [e for e, k in entries.items() if k == key and e.endswith("|1")]
        normal = library.manifest["metas"].get(entries.get(requests[0][:-1] + "0")) if requests else None
        if src and normal and published(normal.get("source", {})) == src:
            if normal:
                for action in ("Idle", "Walk", "Hurt"):
                    a, b = normal["a"].get(action), meta["a"].get(action)
                    if a and b:
                        palette = palette_pair(library.image_bytes(a["file"]), library.image_bytes(b["file"]))
                        if palette:
                            break
            if not palette:
                native = {}
        extra = {}
        for action in ACTIONS:
            if action in native:
                geom, raw = native[action]
                geom = {**geom, "source": dict(geom["source"])}
                if palette:
                    raw = recolor(raw, palette)
                    geom["source"].update(kind="shiny-pmd-reaction", palette_from=key)
                extra[action] = {**geom, "file": pack(raw)}
                kind = "authored" if not palette else "recolored"
            elif action in (generated or {}).get(key, {}):
                geom, raw = generated[key][action]
                extra[action] = {**geom, "file": pack(raw)}
                kind = "generated"
            else:
                source = "Hurt" if action == "Pain" and "Hurt" in meta["a"] else "Idle"
                extra[action] = {**meta["a"][source], "reaction": "pain" if action == "Pain" else "ground",
                                 "source": {"kind": "runtime-pmd-acting", "animation": source, "identity": key}}
                if action == "HitGround":
                    geom = extra[action]
                    sheet = Image.open(io.BytesIO(library.image_bytes(geom["file"]))).convert("RGBA")
                    geom["pose_bounds"] = [list(sheet.crop((0, row * geom["h"], geom["w"], (row + 1) * geom["h"]))
                                                     .getbbox() or (0, 0, geom["w"], geom["h"])) for row in range(geom["r"])]
                kind = "acting"
            label = action + ":" + kind
            manifest["coverage"][label] = manifest["coverage"].get(label, 0) + 1
        manifest["metas"][key] = extra
    if require_raster and any(manifest["coverage"].get(action + ":acting", 0) for action in ACTIONS):
        raise ValueError(f"Incomplete raster reactions: {manifest['coverage']}")
    name = "reactions-" + hashlib.sha256(data).hexdigest() + ".pmd"
    (library.root / name).write_bytes(data)
    manifest["packs"] = [name]
    (library.root / "reactions.json").write_text(json.dumps(manifest, separators=(",", ":")), encoding="utf8")
    return manifest


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--stage", type=Path, required=True)
    parser.add_argument("--workers", type=int, default=20)
    parser.add_argument("--art", type=Path, default=ROOT / "art" / "reactions")
    parser.add_argument("--require-raster", action="store_true")
    args = parser.parse_args()
    library = PmdLibrary(with_reactions=False)
    result = compile_reactions(library, collect(library, args.stage, args.workers),
                               load_generated(library, args.art), require_raster=args.require_raster)
    print(json.dumps(result["coverage"]), flush=True)
