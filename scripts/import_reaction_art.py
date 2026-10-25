"""Extract generated, genuinely redrawn reaction poses into registered PMD PNGs.

This importer only crops, scales uniformly and transfers the installed palette.
It never invents poses by warping, rotating or translating a standing sprite.
"""
from __future__ import annotations

import argparse
import copy
import hashlib
import io
import json
import math
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from silvers_hoard.pmd_library import PmdLibrary
from silvers_hoard.pmd_shiny import palette_pair, recolor

ART = ROOT / "art" / "reactions"


def grid_cuts(image: Image.Image, axis: int, count: int) -> list[int]:
    """Find actual transparent gutters; generated sheets can include wide margins."""
    alpha = image.getchannel("A").point(lambda a: 255 if a >= 128 else 0)
    size = (image.width, 1) if axis == 0 else (1, image.height)
    density = list(alpha.resize(size, Image.Resampling.BOX).getdata())
    runs, start = [], None
    for i, value in enumerate([*density, 0]):
        if value > 2 and start is None:
            start = i
        elif value <= 2 and start is not None:
            runs.append([start, i])
            start = None
    joined = []
    for run in runs:
        if joined and run[0] - joined[-1][1] <= max(2, len(density) // 250):
            joined[-1][1] = run[1]
        else:
            joined.append(run)
    joined = [r for r in joined if r[1] - r[0] >= max(3, len(density) // (count * 20))]
    if len(joined) != count:
        raise ValueError(f"Expected {count} occupied strips on axis {axis}; found {joined}")
    return [0, *[(joined[i - 1][1] + joined[i][0]) // 2 for i in range(1, count)], len(density)]


def png(image: Image.Image) -> bytes:
    stream = io.BytesIO()
    image.save(stream, "PNG", optimize=True)
    return stream.getvalue()


def native_palette(library, meta):
    colors = set()
    for name in ("Idle", "Walk", "Attack"):
        if name not in meta["a"]:
            continue
        sheet = Image.open(io.BytesIO(library.image_bytes(meta["a"][name]["file"]))).convert("RGBA")
        colors.update(c[:3] for c in sheet.getdata() if c[3] >= 128)
    return sorted(colors)


def align_palette(image, colors):
    """Keep the installed identity's exact palette and a crisp binary alpha."""
    cache = {}
    def nearest(color):
        if color not in cache:
            cache[color] = min(colors, key=lambda c: sum((a - b) ** 2 for a, b in zip(c, color)))
        return cache[color]
    image.putdata([(*nearest(c[:3]), 255) if c[3] >= 128 else (0, 0, 0, 0) for c in image.getdata()])
    return image


def extract(record: dict, library: PmdLibrary, art: Path = ART):
    source = art / "sources" / record.get("image", record["id"] + ".png")
    raw = source.read_bytes()
    image = Image.open(io.BytesIO(raw)).convert("RGBA")
    image.putalpha(image.getchannel("A").point(lambda a: 255 if a >= 128 else 0))
    directions = record["directions"]
    legacy = record.get("layout") == "action-rows-direction-columns"
    cols, rows = (4, 8) if legacy else (8, directions)
    ys = grid_cuts(image, 1, rows)
    row_cuts = [grid_cuts(image.crop((0, ys[r], image.width, ys[r + 1])), 0, cols) for r in range(rows)]
    tiles = {name: [[] for _ in range(directions)] for name in ("Pain", "HitGround")}
    for name in tiles:
        for direction in range(directions):
            for frame in range(4):
                col = frame if legacy else frame + (4 if name == "HitGround" else 0)
                row = direction + (4 if name == "HitGround" else 0) if legacy else direction
                xs = row_cuts[row]
                tile = image.crop((xs[col], ys[row], xs[col + 1], ys[row + 1]))
                bbox = tile.getbbox()
                if not bbox:
                    raise ValueError(f"Empty {record['id']}:{name}:{direction}:{frame}")
                tile = tile.crop(bbox)
                if [name, direction, frame] in record.get("mirror_frames", []):
                    tile = tile.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
                tiles[name][direction].append(tile)
    normal = library.resolve(record["num"], record.get("form", ""))
    original = normal["a"]["Idle"]
    idle = Image.open(io.BytesIO(library.image_bytes(original["file"]))).convert("RGBA")
    height = max(idle.crop((0, r * original["h"], original["w"], (r + 1) * original["h"]))
                 .getbbox()[3] - idle.crop((0, r * original["h"], original["w"], (r + 1) * original["h"]))
                 .getbbox()[1] for r in range(original["r"]))
    factor = height / max(row[0].height for row in tiles["Pain"])
    palette = native_palette(library, normal)
    all_tiles = [t for action in tiles.values() for row in action for t in row]
    width = math.ceil((max(t.width for t in all_tiles) * factor + 8) / 8) * 8
    cell_height = math.ceil((max(t.height for t in all_tiles) * factor + 12) / 8) * 8
    geometry, images = {}, {}
    for name, headings in tiles.items():
        sheet = Image.new("RGBA", (4 * width, directions * cell_height))
        hashes = []
        for row, frames in enumerate(headings):
            distinct = set()
            for frame, tile in enumerate(frames):
                tile = tile.resize((max(1, round(tile.width * factor)), max(1, round(tile.height * factor))), Image.Resampling.NEAREST)
                tile = align_palette(tile, palette)
                distinct.add(hashlib.sha256(tile.tobytes()).hexdigest())
                sheet.alpha_composite(tile, (frame * width + (width - tile.width) // 2,
                                             row * cell_height + cell_height - 6 - tile.height))
            if len(distinct) < 3:
                raise ValueError(f"Fewer than three genuinely distinct drawn poses: {record['id']}:{name}:{row}")
            hashes.append(len(distinct))
        source_info = {"kind": "generated-pmd-reaction", "record": record["id"], "tool": "builtin-imagegen",
                       "source_sha256": hashlib.sha256(raw).hexdigest(), "authored_directions": directions,
                       "authored_frames": 4 * directions, "distinct_frames_per_direction": hashes,
                       "reference": {"num": record["num"], "form": record.get("form", ""), "key": normal["key"]}}
        geom = {"w": width, "h": cell_height, "r": directions, "n": 4, "d": [8, 9, 12, 10],
                "ax": width / 2, "ay": cell_height - 6, "source": source_info}
        if directions == 4:
            geom["row_map"] = [0, 1, 1, 2, 2, 3, 3, 0]
        if name == "HitGround":
            geom["ground_frames"] = [3] * directions
        images[name] = png(sheet)
        geom["source"]["sha256"] = hashlib.sha256(images[name]).hexdigest()
        geometry[name] = geom
    return geometry, images


def compile_one(record, library, art=ART):
    geometry, images = extract(record, library, art)
    normal = library.resolve(record["num"], record.get("form", ""))
    shiny = library.resolve(record["num"], record.get("form", ""), shiny=True)
    palette = {}
    for name in ("Idle", "Walk", "Attack", "Shoot", "Charge", "Hurt", "Sleep"):
        left, right = normal["a"].get(name), shiny["a"].get(name)
        if left and right:
            palette.update(palette_pair(library.image_bytes(left["file"]), library.image_bytes(right["file"])))
    if not palette:
        # Published regular/shiny sheets sometimes use different cell padding.
        # Compare corresponding cropped poses rather than resizing either one.
        for name, left in normal["a"].items():
            right = shiny["a"].get(name)
            if not right or (left["n"], left["r"]) != (right["n"], right["r"]):
                continue
            a = Image.open(io.BytesIO(library.image_bytes(left["file"]))).convert("RGBA")
            b = Image.open(io.BytesIO(library.image_bytes(right["file"]))).convert("RGBA")
            for row in range(left["r"]):
                for frame in range(left["n"]):
                    pair = []
                    for sheet, g in ((a, left), (b, right)):
                        tile = sheet.crop((frame*g["w"], row*g["h"], (frame+1)*g["w"], (row+1)*g["h"]))
                        bbox = tile.getbbox()
                        if not bbox:
                            break
                        pair.append(png(tile.crop(bbox)))
                    if len(pair) == 2:
                        palette.update(palette_pair(*pair))
    if not palette:
        raise ValueError(f"No aligned shiny palette for {record['id']}")
    shiny_geometry = copy.deepcopy(geometry)
    shiny_images = {}
    for name, raw in images.items():
        shiny_images[name] = recolor(raw, palette)
        source = shiny_geometry[name]["source"]
        source.update(kind="shiny-generated-pmd-reaction", palette_from=shiny["key"],
                      sha256=hashlib.sha256(shiny_images[name]).hexdigest())
    output = art / "compiled" / record["id"]
    for name, raw in images.items():
        output.mkdir(parents=True, exist_ok=True)
        (output / (name + ".png")).write_bytes(raw)
        (output / (name + "-shiny.png")).write_bytes(shiny_images[name])
    provenance = {"id": record["id"], "num": record["num"], "form": record.get("form", ""),
                  "tool": "builtin-imagegen", "prompt": record.get("prompt_template", record.get("prompt", "")),
                  "source_image": record.get("image", record["id"] + ".png"),
                  "source_sha256": geometry["Pain"]["source"]["source_sha256"]}
    (output / "meta.json").write_text(json.dumps({"a": geometry, "shiny": {"a": shiny_geometry}, "provenance": provenance,
                                                 "reviewed": record.get("reviewed", False)}, indent=2) + "\n", encoding="utf8", newline="\n")
    return geometry


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("ids", nargs="*")
    args = parser.parse_args()
    library = PmdLibrary(with_reactions=False)
    for source in sorted((ART / "sources").glob("*.json")):
        record = json.loads(source.read_text("utf8"))
        if args.ids and source.stem not in args.ids:
            continue
        if not args.ids and not record.get("reviewed"):
            continue
        geometry = compile_one(record, library)
        print(record["id"], {name: [g["w"], g["h"], g["r"]] for name, g in geometry.items()}, flush=True)
