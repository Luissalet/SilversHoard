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
    if len(colors) > 256:
        try:
            from scipy.spatial import cKDTree
        except ImportError:
            pass
        else:
            visible = sorted({c[:3] for c in image.getdata() if c[3] >= 128})
            if visible:
                _, nearest_indices = cKDTree(colors).query(visible)
                cache.update((rgb, colors[int(index)]) for rgb, index in zip(visible, nearest_indices))
    def nearest(color):
        if color not in cache:
            cache[color] = min(colors, key=lambda c: sum((a - b) ** 2 for a, b in zip(c, color)))
        return cache[color]
    image.putdata([(*nearest(c[:3]), 255) if c[3] >= 128 else (0, 0, 0, 0) for c in image.getdata()])
    return image


def compose_components(image, record):
    """Assemble drawn individuals in a declared native formation, without warping."""
    spec = record["composition"]
    directions, frames = record["directions"], record["frames"]
    roles = len(spec["component_heights"][0])
    columns = 2 * frames * roles
    ys = grid_cuts(image, 1, directions)
    units = []
    for row in range(directions):
        row_image = image.crop((0, ys[row], image.width, ys[row + 1]))
        xs = grid_cuts(row_image, 0, columns)
        parts = []
        for role in range(roles):
            drawn = []
            for frame in range(2 * frames):
                col = role * 2 * frames + frame
                tile = row_image.crop((xs[col], 0, xs[col + 1], row_image.height))
                drawn.append(tile.crop(tile.getbbox()))
            factor = spec["component_heights"][row][role] / drawn[0].height
            parts.append([t.resize((max(1, round(t.width * factor)), max(1, round(t.height * factor))),
                                   Image.Resampling.NEAREST) for t in drawn])
        units.append(parts)
    padding = 16
    width, height = [value + 2 * padding for value in spec["canvas"]]
    output = Image.new("RGBA", (2 * frames * width, directions * height))
    for row in range(directions):
        for frame in range(2 * frames):
            for member_index in spec["draw_order"][row]:
                member = spec["members"][member_index]
                tile = units[row][member["component"]][frame]
                center, baseline = member["positions"][row]
                x = frame * width + padding + round(center - tile.width / 2)
                y = row * height + padding + baseline - tile.height
                if x < frame * width or x + tile.width > (frame + 1) * width or y < row * height or y + tile.height > (row + 1) * height:
                    raise ValueError(f"Component outside formation cell: {record['id']}:{row}:{frame}")
                output.alpha_composite(tile, (x, y))
    return output


def extract(record: dict, library: PmdLibrary, art: Path = ART, *, shiny=False):
    source = art / "sources" / (record["shiny_image"] if shiny else record.get("image", record["id"] + ".png"))
    raw = source.read_bytes()
    image = Image.open(io.BytesIO(raw)).convert("RGBA")
    image.putalpha(image.getchannel("A").point(lambda a: 255 if a >= 128 else 0))
    if record.get("composition"):
        image = compose_components(image, record)
    directions = record["directions"]
    frame_count = record.get("frames", 4)
    legacy = record.get("layout") == "action-rows-direction-columns"
    cols, rows = (frame_count, 2 * directions) if legacy else (2 * frame_count, directions)
    ys = grid_cuts(image, 1, rows)
    row_cuts = [grid_cuts(image.crop((0, ys[r], image.width, ys[r + 1])), 0, cols) for r in range(rows)]
    tiles = {name: [[] for _ in range(directions)] for name in ("Pain", "HitGround")}
    for name in tiles:
        for direction in range(directions):
            for frame in range(frame_count):
                col = frame if legacy else frame + (frame_count if name == "HitGround" else 0)
                source_direction = record.get("row_sources", {}).get(str(direction), direction)
                row = source_direction + (directions if name == "HitGround" else 0) if legacy else source_direction
                xs = row_cuts[row]
                tile = image.crop((xs[col], ys[row], xs[col + 1], ys[row + 1]))
                bbox = tile.getbbox()
                if not bbox:
                    raise ValueError(f"Empty {record['id']}:{name}:{direction}:{frame}")
                tile = tile.crop(bbox)
                if [name, direction, frame] in record.get("mirror_frames", []):
                    tile = tile.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
                tiles[name][direction].append(tile)
    normal = library.resolve(record["num"], record.get("form", ""), shiny=shiny)
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
    native_frames = {}
    for spec in record.get("native_frames", []):
        g = normal["a"][spec["animation"]]
        image = Image.open(io.BytesIO(library.image_bytes(g["file"]))).convert("RGBA")
        row, frame = spec["row"], spec.get("index", 0)
        tile = image.crop((frame*g["w"], row*g["h"], (frame+1)*g["w"], (row+1)*g["h"]))
        tile = tile.crop(tile.getbbox())
        native_frames[(spec["action"], spec["direction"], spec["frame"])] = tile
        width = max(width, math.ceil((tile.width + 8) / 8) * 8)
        cell_height = max(cell_height, math.ceil((tile.height + 12) / 8) * 8)
    offsets = record.get("baseline_offsets", [0] * directions)
    if len(offsets) != directions:
        raise ValueError(f"Invalid formation baselines: {record['id']}")
    if record.get("baseline_offsets"):
        top = max(tile.height * factor - offsets[row]
                  for action in tiles.values() for row, frames in enumerate(action) for tile in frames)
        top = max([top] + [tile.height - offsets[row] for (_, row, _), tile in native_frames.items()])
        cell_height = math.ceil((top + max(offsets) + 12) / 8) * 8
    anchor_y = cell_height - 6 - max(offsets)
    geometry, images = {}, {}
    for name, headings in tiles.items():
        sheet = Image.new("RGBA", (frame_count * width, directions * cell_height))
        hashes = []
        for row, frames in enumerate(headings):
            distinct = set()
            for frame, tile in enumerate(frames):
                native = native_frames.get((name, row, frame))
                tile = native.copy() if native is not None else tile.resize(
                    (max(1, round(tile.width * factor)), max(1, round(tile.height * factor))), Image.Resampling.NEAREST)
                if native is None:
                    tile = align_palette(tile, palette)
                distinct.add(hashlib.sha256(tile.tobytes()).hexdigest())
                sheet.alpha_composite(tile, (frame * width + (width - tile.width) // 2,
                                             row * cell_height + anchor_y + offsets[row] - tile.height))
            if len(distinct) < min(3, frame_count):
                raise ValueError(f"Too few distinct drawn poses: {record['id']}:{name}:{row}")
            hashes.append(len(distinct))
        source_info = {"kind": "generated-shiny-pmd-reaction" if shiny else "generated-pmd-reaction",
                       "record": record["id"], "tool": "builtin-imagegen",
                       "source_sha256": hashlib.sha256(raw).hexdigest(),
                       "authored_directions": directions - len(record.get("row_sources", {})),
                       "authored_frames": frame_count * (directions - len(record.get("row_sources", {}))),
                       "generated_frames": frame_count * (directions - len(record.get("row_sources", {}))) - sum(
                           s["action"] == name for s in record.get("native_frames", [])),
                       "distinct_frames_per_direction": hashes,
                       "reference": {"num": record["num"], "form": record.get("form", ""), "key": normal["key"]}}
        assembly = {k: record[k] for k in ("row_sources", "mirror_frames", "native_frames", "composition", "baseline_offsets") if record.get(k)}
        if assembly:
            source_info["assembly"] = assembly
        if record.get("composition"):
            source_info.update(kind="composed-generated-pmd-reaction", authored_frames=0,
                               authored_component_frames=frame_count * directions * len(record["composition"]["component_heights"][0]),
                               composed_frames=frame_count * directions)
        geom = {"w": width, "h": cell_height, "r": directions, "n": frame_count,
                "d": [12, 20] if frame_count == 2 else [8, 9, 12, 10][:frame_count],
                "ax": width / 2, "ay": anchor_y, "source": source_info}
        if directions == 4:
            geom["row_map"] = [0, 1, 1, 2, 2, 3, 3, 0]
        if name == "HitGround":
            geom["ground_frames"] = [frame_count - 1] * directions
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
    shiny_geometry, shiny_images = {}, {}
    if record.get("shiny_image"):
        shiny_geometry, shiny_images = extract(record, library, art, shiny=True)
    elif palette:
        shiny_geometry = copy.deepcopy(geometry)
        shiny_palette = native_palette(library, shiny)
        for name, raw in images.items():
            # Delta transfer can create new shades when generated normal pixels
            # have no exact reference match. Export only installed shiny colours.
            recolored = Image.open(io.BytesIO(recolor(raw, palette))).convert("RGBA")
            recolored = align_palette(recolored, shiny_palette)
            g = shiny_geometry[name]
            for spec in record.get("native_frames", []):
                if spec["action"] != name:
                    continue
                original = shiny["a"][spec["animation"]]
                sheet = Image.open(io.BytesIO(library.image_bytes(original["file"]))).convert("RGBA")
                row, frame = spec["row"], spec.get("index", 0)
                tile = sheet.crop((frame*original["w"], row*original["h"],
                                   (frame+1)*original["w"], (row+1)*original["h"]))
                tile = tile.crop(tile.getbbox())
                row, frame = spec["direction"], spec["frame"]
                offset = record.get("baseline_offsets", [0] * record["directions"])[row]
                if tile.width > g["w"] or tile.height > g["ay"] + offset:
                    raise ValueError(f"Native shiny frame outside cell: {record['id']}:{name}:{row}:{frame}")
                recolored.paste((0, 0, 0, 0), (frame*g["w"], row*g["h"], (frame+1)*g["w"], (row+1)*g["h"]))
                recolored.alpha_composite(tile, (frame*g["w"] + (g["w"] - tile.width)//2,
                                                 row*g["h"] + int(g["ay"]) + offset - tile.height))
            shiny_images[name] = png(recolored)
            source = shiny_geometry[name]["source"]
            source.update(kind="shiny-composed-pmd-reaction" if record.get("composition") else "shiny-generated-pmd-reaction", palette_from=shiny["key"],
                          sha256=hashlib.sha256(shiny_images[name]).hexdigest())
    output = art / "compiled" / record["id"]
    for name, raw in images.items():
        output.mkdir(parents=True, exist_ok=True)
        (output / (name + ".png")).write_bytes(raw)
        if name in shiny_images:
            (output / (name + "-shiny.png")).write_bytes(shiny_images[name])
    provenance = {"id": record["id"], "num": record["num"], "form": record.get("form", ""),
                  "tool": "builtin-imagegen", "prompt": record.get("prompt_template", record.get("prompt", "")),
                  "source_image": record.get("image", record["id"] + ".png"),
                  "source_sha256": geometry["Pain"]["source"]["source_sha256"]}
    provenance.update({k: record[k] for k in ("row_sources", "mirror_frames", "native_frames", "composition", "baseline_offsets") if record.get(k)})
    if record.get("source_record"):
        provenance["source_record"] = record["source_record"]
    if record.get("shiny_image"):
        provenance["shiny_source_image"] = record["shiny_image"]
        provenance["shiny_prompt"] = record["shiny_prompt"]
    (output / "meta.json").write_text(json.dumps({"a": geometry, "shiny": {"a": shiny_geometry},
                                                 "pending": [] if shiny_images else ["shiny"], "provenance": provenance,
                                                 "reviewed": record.get("reviewed", False),
                                                 "shiny_reviewed": record.get("shiny_reviewed", record.get("reviewed", False)
                                                     if not record.get("shiny_image") else False)}, indent=2) + "\n", encoding="utf8", newline="\n")
    return geometry


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("ids", nargs="*")
    parser.add_argument("--keep-going", action="store_true", help="Compile other named candidates after a malformed sheet")
    args = parser.parse_args()
    library = PmdLibrary(with_reactions=False)
    failures = 0
    for source in sorted((ART / "sources").glob("*.json")):
        record = json.loads(source.read_text("utf8"))
        record["source_record"] = source.name
        if args.ids and source.stem not in args.ids:
            continue
        if not args.ids and not record.get("reviewed"):
            continue
        try:
            geometry = compile_one(record, library)
        except ValueError as error:
            if not args.keep_going:
                raise
            failures += 1
            print(f"INVALID {source.stem}: {error}", file=sys.stderr, flush=True)
            continue
        print(record["id"], {name: [g["w"], g["h"], g["r"]] for name, g in geometry.items()}, flush=True)
    sys.exit(bool(failures))
