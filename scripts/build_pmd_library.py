"""Build Silver's versioned art library from pinned published art and reviewed original sheets.

The staging directory contains downloaded art, never a checkout or a user's application data.
Run --inventory-only first. Generated art is an explicit input; missing entries remain missing.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import re
import sys
import tempfile
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from silvers_hoard.pmd import PmdSprites
from silvers_hoard.hoard_link.atomic import write_bytes_atomic

SOURCE_SHA = "341342d7ef2ed3e4427c760e829a417b501be17c"
SOURCE = f"https://raw.githubusercontent.com/PMDCollab/SpriteCollab/{SOURCE_SHA}"


def norm(value):
    return re.sub(r"[^a-z0-9]", "", str(value).lower())


def inventory(roster, tracker):
    entries = []
    def visit(entry, folder, labels=(), shiny=False):
        label = entry.get("name", "")
        shiny = shiny or label == "Shiny"
        labels = (*labels, label) if label and label not in ("Shiny", "Male") else labels
        entries.append({"folder": folder, "labels": labels, "shiny": shiny,
                        "animations": list(entry.get("sprite_files") or {}), "credit": entry.get("sprite_credit", {})})
        for key, child in (entry.get("subgroups") or {}).items():
            visit(child, folder + "/" + key, labels, shiny)
    for key, entry in tracker.items():
        visit(entry, key)

    explicit = {
        "pichuspikyeared": "spiky", "taurospaldeacombat": "paldea",
        "meowsticf": "female", "indeedeef": "female", "basculegionf": "female", "oinkolognef": "female",
        "maushold": "three", "mausholdfour": "", "tatsugiricurlymega": "mega",
        "minior": "red", "miniormeteor": "",
    }
    exterior = {"pikachustarter": ("pikachu", 1), "eeveestarter": ("eevee", 1),
                "greninjabond": ("greninja", 1), "rockruffdusk": ("rockruff", 1),
                "gourgeistsmall": ("gourgeist", .8), "gourgeistlarge": ("gourgeist", 1.1),
                "sinisteaantique": ("sinistea", 1), "polteageistantique": ("polteageist", 1),
                "poltchageistartisan": ("poltchageist", 1), "sinistchamasterpiece": ("sinistcha", 1),
                "appletungmax": ("flapplegmax",1), "toxtricitylowkeygmax": ("toxtricitygmax",1),
                "meowsticfmega": ("meowsticmmega",1)}
    def canonical(value):
        return (norm(value).replace("gigantamax", "gmax").replace("galarian", "galar")
                .replace("alolan", "alola").replace("hisuian", "hisui").replace("paldean", "paldea")
                .replace("crownedsword", "crowned").replace("crownedshield", "crowned")
                .replace("striped", "").replace("savannah", "savanna"))
    result = []
    for mon in roster:
        root = f"{mon['num']:04d}"
        wanted = explicit.get(mon["id"], canonical(mon["form"]))
        if mon["id"] in ("burmysandy", "wormadamsandy"):
            wanted = "sand"
        if mon["base"] == "Alcremie" and mon["form"] and mon["form"] != "Gmax":
            wanted += "strawberrysweet"
        available = [e for e in entries if e["folder"].split("/")[0] == root and e["animations"]]
        pool = [e for e in available if not e["shiny"]]
        matches = [e for e in pool if canonical("".join(e["labels"][1:])) == wanted]
        row = {**mon, "folder": min(matches, key=lambda e: len(e["folder"]))["folder"] if matches else None}
        shinies = [e for e in available if e["shiny"] and canonical("".join(e["labels"][1:])) == wanted]
        row["shiny_folder"] = min(shinies, key=lambda e: len(e["folder"]))["folder"] if shinies else None
        if mon["id"].endswith("totem"):
            exterior[mon["id"]] = (mon["id"].removesuffix("totem"), 1.2)
        if mon["id"] in exterior:
            target, scale = exterior[mon["id"]]
            row.update(equivalent=target, display_scale=scale, equivalence="Same visible exterior; rules unchanged")
        if mon["base"] == "Alcremie" and mon["form"] and mon["form"] != "Gmax":
            row["shiny_equivalent"] = "alcremie"  # Cream colours converge to the same shiny exterior with Strawberry Sweet.
        result.append(row)
    return {"version": 1, "source": {"repo": "PMDCollab/SpriteCollab", "sha": SOURCE_SHA}, "entries": result,
            "credits": {e["folder"]: e["credit"] for e in entries if e["animations"]}}


def collect(plan, stage, workers=4):
    import httpx
    stage.mkdir(parents=True, exist_ok=True)
    with httpx.Client(follow_redirects=True, timeout=40, limits=httpx.Limits(max_connections=48)) as client:
        def get(url):
            for attempt in range(3):
                try:
                    response = client.get(url)
                    if response.status_code == 200 or response.status_code == 404:
                        return response.status_code, response.content, response.headers.get("content-type", "")
                except httpx.HTTPError:
                    if attempt == 2:
                        raise
            response.raise_for_status()
        sprites = PmdSprites(stage / "published", {"pmd_server": SOURCE}, get)
        folders = sorted({m[k] for m in plan["entries"] for k in ("folder", "shiny_folder") if m.get(k)})
        report = {"source": plan["source"], "complete": {}, "failed": {}}
        with ThreadPoolExecutor(max_workers=workers) as pool:
            futures = {pool.submit(sprites._meta_for, folder): folder for folder in folders}
            for i, future in enumerate(as_completed(futures), 1):
                folder = futures[future]
                try:
                    meta = future.result()
                    if not meta:
                        raise ValueError("No usable Idle or Walk sheet")
                    report["complete"][folder] = meta
                except Exception as exc:
                    report["failed"][folder] = str(exc)
                if i % 25 == 0 or i == len(folders):
                    (stage / "collection.json").write_text(json.dumps(report, ensure_ascii=False), encoding="utf-8")
                    print(f"published {i}/{len(folders)}; failed {len(report['failed'])}", flush=True)
    return report


def png_bytes(image):
    out = io.BytesIO()
    image.save(out, "PNG", optimize=True)
    return out.getvalue()


def collect_palettes(index, stage, workers=4):
    import httpx
    from silvers_hoard.pmd_shiny import palette_pair
    report = {"complete":[],"failed":[]}
    with httpx.Client(timeout=30,follow_redirects=True) as client:
        def one(item):
            name, candidates = item
            folder = stage / "palettes" / name
            if (folder/"source.json").is_file(): return name,True
            for candidate in candidates:
                try:
                    pair = [client.get(url) for url in candidate["urls"]]
                    if any(r.status_code != 200 for r in pair): continue
                    raw = [r.content for r in pair]
                    if not palette_pair(*raw): continue
                    folder.mkdir(parents=True,exist_ok=True)
                    for filename,data in zip(("normal.png","shiny.png"),raw): (folder/filename).write_bytes(data)
                    source = {**candidate,"sha256":[hashlib.sha256(b).hexdigest() for b in raw]}
                    (folder/"source.json").write_text(json.dumps(source),encoding="utf-8")
                    return name,True
                except (httpx.HTTPError,ValueError,OSError): continue
            return name,False
        with ThreadPoolExecutor(max_workers=workers) as pool:
            for name,good in pool.map(one,index.items()): report["complete" if good else "failed"].append(name)
    (stage/"palette-collection.json").write_text(json.dumps(report,indent=2),encoding="utf-8")
    return report


def split_four(image, axis, count=4):
    """Find transparent gutters; generated grids can have unequal margins."""
    occupied = image.getchannel("A").getprojection()[axis]
    length = len(occupied)
    cuts = [0]
    for quarter in range(1,count):
        expected = length*quarter/count
        left, right = round(expected-length*.105), round(expected+length*.105)
        runs, start = [], None
        for i in range(left, right+1):
            if not occupied[i] and start is None: start = i
            if start is not None and (occupied[i] or i == right):
                end = i
                if end-start >= 3: runs.append((start,end))
                start = None
        if not runs: raise ValueError(f"No transparent gutter at {quarter}/{count} on axis {axis}")
        a,b = min(runs, key=lambda run: abs((run[0]+run[1])/2-expected))
        cuts.append((a+b)//2)
    return [*cuts,length]


def generated_sheet(record, root, shiny=False):
    """Import reviewed four-direction art, preserving a uniform scale across its poses.

    The source grid has directions in columns and actions in rows. Runtime PMD sheets have
    directions in rows. This is tile extraction/alignment, not invented animation frames.
    """
    from PIL import Image
    if record.get("layout") not in (None, "sixteen-poses"):
        raise ValueError("Generated PMD sources require sixteen authored poses, not four static views")
    source_file = record.get("shiny_file") if shiny else record["file"]
    if not source_file:
        raise ValueError("No separately authored shiny source")
    image = Image.open(root / source_file).convert("RGBA")
    image.putalpha(image.getchannel("A").point(lambda x: 255 if x >= 128 else 0))
    count = 4
    rows = split_four(image, 1, count)
    tiles = []
    for action in range(count):
        strip = image.crop((0,rows[action],image.width,rows[action+1]))
        columns = split_four(strip, 0, count)
        row = []
        for direction in range(count):
            tile = strip.crop((columns[direction],0,columns[direction+1],strip.height))
            alpha = tile.getchannel("A")
            bbox = alpha.getbbox()
            if not bbox or bbox[0] == 0 or bbox[1] == 0 or bbox[2] == tile.width or bbox[3] == tile.height:
                raise ValueError(f"Empty or clipped generated tile: {source_file} ({action},{direction})")
            tile = tile.crop(bbox)
            if direction in record.get("flip_columns", []):
                tile = tile.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
            if [action,direction] in record.get("flip_tiles", []):
                tile = tile.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
            row.append(tile)
        tiles.append(row)
    if record.get("column_order"):
        tiles = [[row[i] for i in record["column_order"]] for row in tiles]
    for action,order in record.get("row_orders",{}).items():
        tiles[int(action)] = [tiles[int(action)][i] for i in order]
    factor = min(48 / max(t.width for row in tiles for t in row), 42 / max(t.height for row in tiles for t in row))
    for row in tiles:
        for i, tile in enumerate(row):
            row[i] = tile.resize((max(1, round(tile.width*factor)), max(1, round(tile.height*factor))), Image.Resampling.NEAREST)
    anims, images = {}, {}
    walking = record.get("walk_rows",[1,2])
    animations = [("Idle", [0], [40]), ("Walk", walking, [14//len(walking)]*len(walking)), ("Attack", [3], [12])]
    animations = [a for a in animations if a[0] not in record.get("omit_actions",[])]
    for name, actions, durations in animations:
        sheet = Image.new("RGBA", (64*len(actions), 64*4))
        for direction in range(4):
            for frame, action in enumerate(actions):
                tile = tiles[action][direction]
                sheet.alpha_composite(tile, (64*frame+(64-tile.width)//2, 64*direction+52-tile.height))
        images[name] = png_bytes(sheet)
        anims[name] = {"w":64,"h":64,"n":len(actions),"r":4,"d":durations,"ax":32,"ay":52,
                       "row_map":[0,1,1,2,2,3,3,0]}
    source_edits = {}
    if record.get("atlas_repack"):
        source_edits["atlas_repack"] = {k: record["atlas_repack"][k] for k in ("original_sha256", "method")}
    if record.get("component_edit"):
        source_edits["component_edit"] = record["component_edit"]
    if shiny:
        source_edits = {"normal_parent": {
            "source_sha256": hashlib.sha256((root / record["file"]).read_bytes()).hexdigest(),
            **source_edits,
        }}
    return {"s":1,"a":anims,"credit":record.get("credit",["Silver — generated original art"]),
            "licence":record.get("licence","Project-generated fan art"),
            "source":{"kind":"generated","record":record["id"],"directions":4,"poses":4*sum(len(a[1]) for a in animations),
                      "column_order":record.get("column_order",[0,1,2,3]),
                      "row_orders":record.get("row_orders",{}),"mirrored_tiles":record.get("flip_tiles",[]),
                      "mirrored_columns":record.get("flip_columns",[]),
                      "drawn_directions":4-len(record.get("flip_columns",[])),
                      **({"authored_poses":record["authored_poses"]} if "authored_poses" in record else {}),
                      **source_edits,
                      **({"reference_template":record["reference_template"]} if record.get("reference_template") else {}),
                      "tool":record.get("shiny_generation",{}).get("tool",record["tool"]) if shiny else record["tool"],
                      **({"derivation":record["shiny_generation"]} if shiny and record.get("shiny_generation") else {}),
                      "variant":"shiny" if shiny else "normal",
                      "source_sha256":hashlib.sha256((root/source_file).read_bytes()).hexdigest()}}, images


def supplied_sheet(record, root, shiny=False):
    """Import authored overworld frames without discarding their original registration or bob."""
    from PIL import Image
    variant = "shiny" if shiny else "normal"
    source = record[variant]
    raw = (root / source["file"]).read_bytes()
    image = Image.open(io.BytesIO(raw)).convert("RGBA")
    if record.get("layout") == "authored-walking-atlas":
        # Coordinates and background key are the existing native importer's format contract.
        row_order=record["row_order"]
        tiles=[]
        for row in row_order:
            decoded=[]
            for x,y,width,height in source["frames"][row]:
                if x<0 or y<0 or x+width>image.width or y+height>image.height:
                    raise ValueError("Authored walking frame is outside its source image")
                tile=image.crop((x,y,x+width,y+height))
                background=source.get("background")
                if background is not None:
                    tile.putdata([(*p[:3],0) if list(p)==background else p for p in tile.getdata()])
                decoded.append(tile)
            if len(decoded)!=4: raise ValueError("Expected four native walking cycle slots")
            tiles.append(decoded)
    else:
        if image.width % 4 or image.height % 4:
            raise ValueError(f"Invalid supplied overworld grid: {source['file']}")
        width, height = image.width // 4, image.height // 4
        row_order=[0,2,3,1]
        tiles = [[image.crop((frame*width,row*height,(frame+1)*width,(row+1)*height))
                  for frame in range(4)] for row in row_order]
    boxes = [tile.getchannel("A").getbbox() for row in tiles for tile in row]
    if any(box is None for box in boxes):
        raise ValueError(f"Empty supplied overworld frame: {source['file']}")
    # One shared source rectangle and destination offset retain all authored frame movement.
    bounds = (min(b[0] for b in boxes),min(b[1] for b in boxes),max(b[2] for b in boxes),max(b[3] for b in boxes))
    factor = min(48/(bounds[2]-bounds[0]),42/(bounds[3]-bounds[1]))
    size = (max(1,round((bounds[2]-bounds[0])*factor)),max(1,round((bounds[3]-bounds[1])*factor)))
    anims, images = {}, {}
    for name, frames, durations in [("Idle",[0],[40]),("Walk",[0,1,2,3],[8,8,8,8])]:
        sheet = Image.new("RGBA",(64*len(frames),64*len(tiles)))
        for row in range(len(tiles)):
            for frame, index in enumerate(frames):
                tile = tiles[row][index].crop(bounds).resize(size,Image.Resampling.NEAREST)
                sheet.alpha_composite(tile,(64*frame+(64-size[0])//2,64*row+52-size[1]))
        images[name] = png_bytes(sheet)
        anims[name] = {"w":64,"h":64,"n":len(frames),"r":len(tiles),"d":durations,"ax":32,"ay":52,
                       "row_map":list(range(8)) if len(tiles)==8 else [0,1,1,2,2,3,3,0]}
    return {"s":1,"a":anims,"credit":record["credit"],"licence":record["licence"],
            "source":{"kind":record.get("source_kind","supplied-overworld"),"record":record["id"],"directions":len(tiles),
                      "drawn_directions":record.get("drawn_directions",len(tiles)),
                      "authored_frames":record.get("authored_frames",16),"actions":["Idle","Walk"],"timing":"Existing native walking clock: 8 ticks per cycle slot",
                      "row_order":row_order,"source_sha256":hashlib.sha256(raw).hexdigest(),
                      **({"archive":record["archive"]} if record.get("archive") else {}),
                      **({"provenance":record["provenance"]} if record.get("provenance") else {}),
                      **({"upstream":record["upstream"]} if record.get("upstream") else {}),
                      **({"mirrored_directions":record["mirrored_directions"]} if record.get("mirrored_directions") else {}),
                      **({"member":source["member"]} if source.get("member") else {})}}, images


def native_animation_sheets(record, root, shiny=False):
    """Import reviewed native PMD compositions without resampling their authored frames."""
    from PIL import Image
    folder = root / record["variants"]["shiny" if shiny else "normal"]
    meta = json.loads((folder / "meta.json").read_text("utf-8"))
    images = {}
    for action, geom in meta["a"].items():
        raw = (folder / geom["file"]).read_bytes()
        image = Image.open(io.BytesIO(raw))
        if image.size != (geom["w"] * geom["n"], geom["h"] * geom["r"]):
            raise ValueError(f"Native PMD composition geometry does not match {action}")
        images[action] = raw
    meta["credit"], meta["licence"] = record["credit"], record["licence"]
    meta["source"] = {**meta["source"], "record": record["id"], "variant": "shiny" if shiny else "normal"}
    return meta, images


def indexed_overworld_sheet(record, root, shiny=False):
    """Decode eight authored hardware-indexed frames; index zero is transparent by format."""
    from PIL import Image
    files = record["files"]
    raw = (root/files["png"]).read_bytes()
    image = Image.open(io.BytesIO(raw))
    geometry = json.loads((root/files["geometry"]).read_text("utf-8"))["frames"]
    frames = sorted(geometry.values(), key=lambda item:item["frame"])
    if image.mode != "P" or [f["frame"] for f in frames] != list(range(8)):
        raise ValueError("Indexed overworld requires eight contiguous indexed frames")
    width,height = frames[0]["width"],frames[0]["height"]
    if ((width,height,frames[0].get("coordTrans",0)) not in ((32,32,0),(64,64,16)) or
        image.size != (width,height*8) or any(
        (f["width"],f["height"],f["format"],f["color0"]) != (width,height,3,1) or
        f.get("coordTrans",0) != frames[0].get("coordTrans",0) or
        any(f.get(flag,0) for flag in ("flipX","flipY","repeatX","repeatY")) for f in frames)):
        raise ValueError("Unsupported indexed overworld geometry or flags")
    palette_file = files["shiny_palette" if shiny else "normal_palette"]
    lines = (root/palette_file).read_text("utf-8-sig").splitlines()
    if lines[:3] != ["JASC-PAL","0100","16"] or len(lines) != 19:
        raise ValueError("Indexed overworld requires a sixteen-colour JASC palette")
    palette = [tuple(map(int,line.split())) for line in lines[3:]]
    if any(len(c)!=3 or any(v<0 or v>255 for v in c) for c in palette):
        raise ValueError("Invalid indexed overworld palette colour")
    indices = list(image.getdata())
    if max(indices)>15: raise ValueError("Indexed overworld palette index out of range")
    decoded = Image.new("RGBA",image.size)
    decoded.putdata([(*palette[index],255 if index else 0) for index in indices])
    tiles = [decoded.crop((0,i*height,width,(i+1)*height)) for i in range(8)]
    boxes = [tile.getchannel("A").getbbox() for tile in tiles]
    if any(b is None for b in boxes): raise ValueError("Empty indexed overworld frame")
    bounds = (min(b[0] for b in boxes),min(b[1] for b in boxes),max(b[2] for b in boxes),max(b[3] for b in boxes))
    factor = min(48/(bounds[2]-bounds[0]),42/(bounds[3]-bounds[1]))
    if factor >= 1: factor = int(factor)  # Uniform whole source pixels when enlargement fits.
    size = (max(1,round((bounds[2]-bounds[0])*factor)),max(1,round((bounds[3]-bounds[1])*factor)))
    order = record.get("direction_pairs",[[2,3],[6,7],[0,1],[4,5]])
    if sorted(i for pair in order for i in pair) != list(range(8)) or any(len(p)!=2 for p in order):
        raise ValueError("Invalid indexed overworld direction pairs")
    anims,images = {},{}
    for name,selected,durations in [("Idle",[0],[40]),("Walk",[0,1],[8,8])]:
        sheet=Image.new("RGBA",(64*len(selected),256))
        for row,pair in enumerate(order):
            for frame,phase in enumerate(selected):
                tile=tiles[pair[phase]].crop(bounds).resize(size,Image.Resampling.NEAREST)
                sheet.alpha_composite(tile,(64*frame+(64-size[0])//2,64*row+52-size[1]))
        images[name]=png_bytes(sheet)
        anims[name]={"w":64,"h":64,"n":len(selected),"r":4,"d":durations,"ax":32,"ay":52,"row_map":[0,1,1,2,2,3,3,0]}
    hashes={name:hashlib.sha256((root/path).read_bytes()).hexdigest() for name,path in files.items()}
    return {"s":1,"a":anims,"credit":record["credit"],"licence":record["licence"],
            "source":{"kind":"published-overworld","record":record["id"],"directions":4,"authored_frames":8,
                      "actions":["Idle","Walk"],"direction_pairs":order,"transparent_index":0,
                      "timing":"Adapter default: 8 ticks per Walk frame","palette":"shiny" if shiny else "normal",
                      "source_cell":[width,height],"coordTrans":frames[0].get("coordTrans",0),
                      "source_hashes":hashes,"upstream":record["upstream"],"attribution_note":record["attribution_note"]}},images


def crowd_sheet(meta, originals, key):
    """Small directional PMD poses keep large armies within a bounded decoded image size."""
    from PIL import Image
    images, anims = {}, {}
    sources = [name for name in ("Idle", "Walk") if name in meta["a"]]
    factor = min(30/meta["a"][name][axis] for name in sources for axis in ("w","h"))
    for name in sources:
        geom = meta["a"][name]
        image = Image.open(io.BytesIO(originals[name])).convert("RGBA")
        selected = [0,geom["n"]//2] if name == "Walk" and geom["n"] > 1 else [0]
        if len(selected) == 2:
            def pose(index):
                return image.crop((index*geom["w"],0,(index+1)*geom["w"],image.height)).tobytes()
            if pose(selected[0]) == pose(selected[1]):
                quarters = [geom["n"]//4, 3*geom["n"]//4]
                if pose(quarters[0]) != pose(quarters[1]):
                    selected = quarters
                else:
                    other = next((i for i in range(1,geom["n"]) if pose(i) != pose(0)), None)
                    if other is not None: selected = [0,other]
        frames = len(selected)
        sheet = Image.new("RGBA", (32*frames, 32*geom["r"]))
        # Frame-space scaling keeps anchors and motion; individual poses are never enlarged independently.
        width, height = max(1, round(geom["w"]*factor)), max(1, round(geom["h"]*factor))
        for row in range(geom["r"]):
            for frame, original in enumerate(selected):
                tile = image.crop((original*geom["w"],row*geom["h"],(original+1)*geom["w"],(row+1)*geom["h"]))
                tile = tile.resize((width,height), Image.Resampling.NEAREST)
                sheet.alpha_composite(tile, (32*frame+1,32*row+1))
        total = max(frames,sum(geom["d"]))
        durations = [total//2,total-total//2] if frames == 2 else [geom["d"][0]]
        anims[name] = {"w":32,"h":32,"n":frames,"r":geom["r"],"d":durations,
                       "ax":1+geom["ax"]*factor,"ay":1+geom["ay"]*factor,
                       **({"row_map":geom["row_map"]} if "row_map" in geom else {})}
        images[name] = png_bytes(sheet)
    # Preserve the apparent body size when using the compact sheet.
    return {"key":key+"-crowd","s":meta.get("s",1),"a":anims,"display_scale":meta.get("display_scale",1)/factor,
            "credit":meta.get("credit",[]),"source":{"kind":"compact-pmd","pmd":key}}, images


def previews(meta, originals):
    """Front/back thumbnails are actual PMD poses, including in a cold standalone HUD."""
    from PIL import Image
    geom = meta["a"].get("Idle") or meta["a"]["Walk"]
    raw = originals.get("Idle") or originals["Walk"]
    source = Image.open(io.BytesIO(raw)).convert("RGBA")
    result = {}
    for name,direction in [("PreviewFront",0),("PreviewBack",4)]:
        row = geom.get("row_map",list(range(8)))[direction]
        row = min(row,geom["r"]-1)
        tile = source.crop((0,row*geom["h"],geom["w"],(row+1)*geom["h"]))
        bbox = tile.getchannel("A").getbbox()
        if not bbox: raise ValueError(f"Empty PMD preview: {meta['key']}")
        tile = tile.crop(bbox)
        factor = min(48/tile.width,48/tile.height)
        tile = tile.resize((max(1,round(tile.width*factor)),max(1,round(tile.height*factor))),Image.Resampling.NEAREST)
        canvas = Image.new("RGBA",(64,64))
        canvas.alpha_composite(tile,((64-tile.width)//2,56-tile.height))
        result[name] = png_bytes(canvas)
    return result


class Packs:
    def __init__(self, output, encoded):
        self.output, self.files, self.names = output, {}, []
        self.streams, self.sources, self.encoded = {}, {}, encoded
        encoded.mkdir(parents=True, exist_ok=True)

    def add(self, raw, group="sprites"):
        original = hashlib.sha256(raw).hexdigest()
        if original in self.sources: return self.sources[original]
        if "pmd:"+original in self.files: return "pmd:"+original
        mime = "image/webp" if raw[8:12] == b"WEBP" else "image/png"
        if mime == "image/png":
            from PIL import Image
            path = self.encoded / (original+".webp")
            if path.is_file(): compact = path.read_bytes()
            else:
                image = Image.open(io.BytesIO(raw)).convert("RGBA")
                out = io.BytesIO()
                image.save(out, "WEBP", lossless=True, exact=True, method=3)
                compact = out.getvalue()
                if Image.open(io.BytesIO(compact)).convert("RGBA").tobytes() != image.tobytes():
                    raise ValueError(f"Lossless sprite conversion changed pixels: {original}")
                path.write_bytes(compact)
            if len(compact) < len(raw): raw, mime = compact, "image/webp"
        sha = hashlib.sha256(raw).hexdigest()
        key = "pmd:" + sha
        if key not in self.files:
            current = self.streams.get(group)
            if current is None or current[1].tell() + len(raw) > 4*1024*1024:
                if current: current[1].close()
                self.names.append(f"{group}-{len(self.names):03d}.pmd")
                current = (len(self.names)-1, (self.output / self.names[-1]).open("wb"))
                self.streams[group] = current
            index, stream = current
            offset = stream.tell()
            stream.write(raw)
            self.files[key] = {"pmd":index,"offset":offset,"size":len(raw),"mime":mime,"sha256":sha}
        self.sources[original] = key
        return key

    def flush(self):
        for _,stream in self.streams.values(): stream.flush()

    def close(self):
        for _,stream in self.streams.values(): stream.close()


def compile_library(plan, stage, generated, output, *, allow_missing=False):
    """Publish validated packs without invalidating an installed reader or a failed rebuild."""
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=f".{output.name}-build-", dir=output.parent) as temporary:
        candidate = Path(temporary)
        manifest = _compile_library(plan, stage, generated, candidate, allow_missing=allow_missing)
        names = []
        output.mkdir(parents=True, exist_ok=True)
        for name in manifest["packs"]:
            pack = candidate / name
            digest = hashlib.sha256(pack.read_bytes()).hexdigest()
            published = "assets-" + digest + ".pmd"
            destination = output / published
            if destination.is_file():
                if hashlib.sha256(destination.read_bytes()).hexdigest() != digest:
                    raise ValueError(f"Damaged installed PMD pack: {published}")
                pack.unlink()
            else:
                pack.replace(destination)
            names.append(published)
        manifest["packs"] = names
        for file in candidate.iterdir():
            if file.name != "manifest.json":
                write_bytes_atomic(output / file.name, file.read_bytes(), fsync=False)
        write_bytes_atomic(output / "manifest.json", json.dumps(manifest, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))
        return manifest


def _compile_library(plan, stage, generated, output, *, allow_missing=False):
    """Build the same installed collection for the app, MCP and every standalone HTML export."""
    records_path = generated / "registry.json"
    records = json.loads(records_path.read_text("utf-8")) if records_path.exists() else {}
    by_id = {m["id"]:m for m in plan["entries"]}
    missing = []
    for mon in plan["entries"]:
        if not mon["folder"] and not mon.get("equivalent") and not records.get(mon["id"],{}).get("reviewed"):
            missing.append(mon["name"])
    if missing and not allow_missing:
        raise ValueError(f"Unreviewed or missing original art ({len(missing)}): {', '.join(missing)}")
    output.mkdir(parents=True, exist_ok=True)
    packs = Packs(output, stage / "encoded")
    manifest = {"version":1,"source":plan["source"],"roster":plan["entries"],"entries":{},"metas":{},
                "coverage":{"missing":missing},"files":packs.files,"packs":packs.names}
    notices = generated / "published" / "hg-engine"
    if any(r.get("reviewed") and r.get("layout") == "indexed-overworld-eight-frame" for r in records.values()):
        manifest["notices"] = {name:(notices/name).read_text("utf-8") for name in ("CREDITS.md","README.md")}
        for name,body in manifest["notices"].items():
            (output/("HG_ENGINE_"+name)).write_text(body,encoding="utf-8",newline="\n")
    if any(r.get("reviewed") and r.get("upstream",{}).get("repo") == "Eemeliri/soulgold" for r in records.values()):
        for name in ("CREDITS.md","README.md"):
            body=(generated/"published"/"soulgold"/name).read_text("utf-8")
            manifest.setdefault("notices",{})["SOULGOLD_"+name]=body
            (output/("SOULGOLD_"+name)).write_text(body,encoding="utf-8",newline="\n")
    built = {}
    def build(mon, shiny=False):
        cache_key = (mon["id"], shiny)
        if cache_key in built: return built[cache_key]
        equivalent = mon.get("shiny_equivalent") if shiny else None
        equivalent = equivalent or mon.get("equivalent")
        if equivalent and not mon.get("shiny_folder" if shiny else "folder"):
            target = build(by_id[equivalent], shiny)
            if not target: return None
            meta = json.loads(json.dumps(target))
            meta["display_scale"] = mon.get("display_scale",1)
            meta["source"] = {"kind":"exterior-equivalence","species":equivalent,
                              "parent":target.get("source",{}),
                              "reason":mon.get("equivalence","Identical shiny cream exterior with Strawberry Sweet")}
            originals = {name: read_file(geom["file"]) for name,geom in meta["a"].items()}
        else:
            folder = mon.get("shiny_folder" if shiny else "folder")
            correction = records.get(mon["id"], {})
            if shiny and correction.get("reviewed") and correction.get("shiny_mode") == "reference-palette":
                folder = None
            if folder:
                source = stage / "published" / folder.replace("/","-")
                meta_path = source / "meta.json"
                if not meta_path.is_file(): raise ValueError(f"Uncollected source: {folder}")
                meta = json.loads(meta_path.read_text("utf-8"))
                originals = {name:(source / (name+".png")).read_bytes() for name in meta["a"]}
                credit = plan["credits"][folder]
                names = plan.get("artists", {})
                meta["credit"] = list(dict.fromkeys(names.get(c,c) for c in [credit.get("primary", ""), *credit.get("secondary", [])] if c))
                meta["source"] = {"kind":"published-pmd","folder":folder,"sha":SOURCE_SHA}
                meta["licence"] = "CC BY-NC 4.0"
            elif (records.get(mon["id"],{}).get("reviewed") and
                  records[mon["id"]].get("layout") == "native-pmd-animation-sheets"):
                meta, originals = native_animation_sheets(records[mon["id"]], generated, shiny)
            elif (records.get(mon["id"],{}).get("reviewed") and
                  records[mon["id"]].get("layout") in ("overworld-four-frame","authored-walking-atlas") and
                  not (shiny and records[mon["id"]].get("shiny_mode") == "reference-palette")):
                meta, originals = supplied_sheet(records[mon["id"]], generated, shiny)
            elif (records.get(mon["id"],{}).get("reviewed") and
                  records[mon["id"]].get("layout") == "indexed-overworld-eight-frame" and
                  not (shiny and records[mon["id"]].get("shiny_mode") == "reference-palette")):
                meta, originals = indexed_overworld_sheet(records[mon["id"]], generated, shiny)
            elif (records.get(mon["id"],{}).get("reviewed") and
                  (not shiny or records[mon["id"]].get("shiny_file"))):
                meta, originals = generated_sheet(records[mon["id"]], generated, shiny)
            elif shiny:
                # Palette references are build inputs; a missing pair must never silently relabel normal pixels as shiny.
                normal = build(mon)
                references = stage / "palettes" / mon["id"]
                if not normal or not (references / "source.json").is_file(): return None
                from silvers_hoard.pmd_shiny import palette_pair, recolor
                palette = palette_pair((references/"normal.png").read_bytes(),(references/"shiny.png").read_bytes())
                if not palette: raise ValueError(f"Unaligned shiny palette for {mon['name']}")
                meta = json.loads(json.dumps(normal))
                originals = {name:recolor(read_file(geom["file"]),palette) for name,geom in normal["a"].items()}
                meta["source"] = {"kind":"shiny-recolor","pmd":normal["key"],
                                  "parent":normal.get("source",{}),
                                  "palette":json.loads((references/"source.json").read_text("utf-8"))}
                if mon.get("shiny_folder"):
                    meta["source"]["replaced_published"] = {"folder":mon["shiny_folder"],"sha":SOURCE_SHA,
                                                            "reason":correction["shiny_correction_reason"]}
            else: return None
        signature = hashlib.sha256(json.dumps(meta["a"], sort_keys=True).encode() + b"".join(originals.values())).hexdigest()[:12]
        meta["key"] = f"lib-{mon['id']}-{'s' if shiny else 'n'}-{signature}"
        meta["form_exact"], meta["shiny"] = True, shiny
        crowd, compact = crowd_sheet(meta, originals, meta["key"])
        meta["previews"] = {name:packs.add(raw,"previews") for name,raw in previews(meta,originals).items()}
        for name, raw in originals.items(): meta["a"][name]["file"] = packs.add(raw)
        for name, raw in compact.items(): crowd["a"][name]["file"] = packs.add(raw, "crowd")
        meta["crowd"] = crowd
        manifest["metas"][meta["key"]] = meta
        built[cache_key] = meta
        return meta
    def read_file(key):
        asset = packs.files[key]
        packs.flush()
        with (output / packs.names[asset["pmd"]]).open("rb") as stream:
            stream.seek(asset["offset"])
            return stream.read(asset["size"])
    try:
        for i, mon in enumerate(plan["entries"]):
            for shiny in (False, True):
                meta = build(mon, shiny)
                if meta: manifest["entries"][f"{mon['num']}|{norm(mon['form'])}|{int(shiny)}"] = meta["key"]
            if i % 100 == 0: print(f"packed {i}/{len(plan['entries'])}", flush=True)
    finally: packs.close()
    manifest["coverage"].update(normal=sum(not k.endswith("|1") for k in manifest["entries"]),
                                 shiny=sum(k.endswith("|1") for k in manifest["entries"]),
                                 generated=sum(m["source"]["kind"] == "generated" for m in manifest["metas"].values()))
    manifest["coverage"]["missing_shiny"] = [m["name"] for m in plan["entries"] if f"{m['num']}|{norm(m['form'])}|1" not in manifest["entries"]]
    manifest["coverage"]["complete"] = not missing and not manifest["coverage"]["missing_shiny"]
    if not manifest["coverage"]["complete"] and not allow_missing:
        raise ValueError("The final library must cover every normal and shiny request")
    (output / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False,separators=(",",":")), encoding="utf-8")
    lines = ["# PMD library credits", "",
             f"Published source: https://github.com/PMDCollab/SpriteCollab/tree/{SOURCE_SHA}",
             "Published art retains its authors and CC BY-NC 4.0 terms: https://creativecommons.org/licenses/by-nc/4.0/ .",
             "Upstream use policy: " + SOURCE + "/README.md", "",
             "Published pixels use lossless encoding; compact sheets and previews resize/crop authored poses.",
             "Shiny recolours retain parent provenance and their palette references in manifest.json.",
             "Original generated fan art has separate source records in art/pmd/registry.json; its metadata states actual drawn directions and poses.", "",
             "Supplied overworld art retains its separate normal/shiny originals, archive provenance and available actions. No licence or author is invented for supplied files.", "",
             "Published HGSS overworld sources retain HG-engine community conditions and collective attribution; see HG_ENGINE_CREDITS.md and HG_ENGINE_README.md. These notices also travel in standalone HTML data.", "",
             "| Pokemon | Variant | Artists | Source kind |", "| --- | --- | --- | --- |"]
    for mon in plan["entries"]:
        for shiny in (False,True):
            key = manifest["entries"].get(f"{mon['num']}|{norm(mon['form'])}|{int(shiny)}")
            if not key: continue
            meta = manifest["metas"][key]
            values = [mon["name"],"Shiny" if shiny else "Normal",", ".join(meta.get("credit",[])),meta["source"]["kind"]]
            lines.append("| " + " | ".join(v.replace("|","\\|").replace("\n"," ") for v in values) + " |")
    (output / "CREDITS.md").write_text("\n".join(lines)+"\n",encoding="utf-8",newline="\n")
    return manifest


def main():
    parser = argparse.ArgumentParser(__doc__)
    parser.add_argument("--roster", type=Path, required=True)
    parser.add_argument("--tracker", type=Path, required=True)
    parser.add_argument("--stage", type=Path, required=True)
    parser.add_argument("--inventory-only", action="store_true")
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument("--compile", type=Path, help="Output directory for the installed library")
    parser.add_argument("--generated", type=Path, default=ROOT / "art" / "pmd")
    parser.add_argument("--allow-missing", action="store_true", help="Build an explicitly partial QA library")
    parser.add_argument("--credits", type=Path, help="credit_names.txt from the pinned SpriteCollab revision")
    parser.add_argument("--palette-index", type=Path, help="Collect aligned normal/shiny reference pairs from this URL index")
    args = parser.parse_args()
    plan = inventory(json.loads(args.roster.read_text("utf-8")), json.loads(args.tracker.read_text("utf-8")))
    if args.credits:
        with args.credits.open(encoding="utf-8") as stream:
            plan["artists"] = {r["Discord"]:r["Name"] for r in csv.DictReader(stream, delimiter="\t")}
    args.stage.mkdir(parents=True, exist_ok=True)
    (args.stage / "inventory.json").write_text(json.dumps(plan, ensure_ascii=False, indent=2), encoding="utf-8")
    missing = [m["name"] for m in plan["entries"] if not m["folder"] and not m.get("equivalent")]
    print(f"{len(plan['entries'])} entries, {len(missing)} unresolved art identities", flush=True)
    (args.stage / "missing.json").write_text(json.dumps(missing, ensure_ascii=False, indent=2), encoding="utf-8")
    if args.palette_index:
        result=collect_palettes(json.loads(args.palette_index.read_text("utf-8")),args.stage,args.workers)
        print(f"palettes {len(result['complete'])} complete; missing {result['failed']}",flush=True)
    elif args.compile:
        compile_library(plan, args.stage, args.generated, args.compile, allow_missing=args.allow_missing)
    elif not args.inventory_only:
        collect(plan, args.stage, args.workers)


if __name__ == "__main__":
    main()
