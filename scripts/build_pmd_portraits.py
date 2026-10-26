"""Collect pinned published PMD portraits and inventory exact expression gaps.

Original published portraits keep priority, with explicit reviewed per-cell mirrors
retaining their source bytes and credit. Generated sheets are separate reviewed
inputs; a neutral face is never counted as a newly drawn expression.
"""
from __future__ import annotations

import argparse
import copy
import hashlib
import io
import json
import sys
import tempfile
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(Path(__file__).parent))
from build_pmd_library import inventory
from silvers_hoard.pmd import EMOTIONS, EMOTION_FALLBACK
from silvers_hoard.hoard_link.atomic import write_bytes_atomic
from silvers_hoard.credits import parse_credit_names, pmd_credits
from build_portrait_backgrounds import edge_region


def atlas_tile(image, record, cell, background=None):
    """Extract one source cell and replace only edge-connected keyed backdrop."""
    from PIL import Image, ImageDraw
    columns, rows = record['grid']
    x,y = cell
    trim = record.get('trim',0)
    bounds = (round(x*image.width/columns)+trim,round(y*image.height/rows)+trim,
              round((x+1)*image.width/columns)-trim,round((y+1)*image.height/rows)-trim)
    crop = image.crop(bounds).convert('RGBA')
    tile = crop.resize((40,40),Image.Resampling.NEAREST)
    if background is not None and record.get('background_mode') == 'alpha':
        return Image.alpha_composite(background.convert('RGBA'),tile)
    if background is not None and record.get('background_key'):
        key = record['background_key']
        tolerance = record.get('background_tolerance',18)
        # Segment before downsampling when requested: a thin source outline may
        # disappear at 40px and otherwise connect cream fur to the keyed backdrop.
        mask_source = crop if record.get('background_mask_source') else tile
        region = edge_region(mask_source.convert('RGB'),lambda c:max(abs(a-b) for a,b in zip(c,key)) <= tolerance,
                             seed_bottom=bool(record.get('background_seed_bottom',False)),
                             seed_sides=bool(record.get('background_seed_sides',True)))
        mask = Image.new('L',mask_source.size)
        for point in region:
            mask.putpixel(point,255)
        # Some source cells have a cream gutter connected to a pale chest that
        # ends at the frame. Reviewed foreground guards preserve its source
        # pixels even when its colour is indistinguishable from the backdrop.
        for left,top,right,bottom in record.get('background_protect',[]):
            if not (0 <= left < right <= 40 and 0 <= top < bottom <= 40):
                raise ValueError('Invalid portrait foreground guard')
            ImageDraw.Draw(mask).rectangle((round(left*mask.width/40),round(top*mask.height/40),
                                           round(right*mask.width/40)-1,round(bottom*mask.height/40)-1),fill=0)
        if mask.size != tile.size:
            mask = mask.resize(tile.size,Image.Resampling.NEAREST)
        tile.paste(background,(0,0),mask)
    return tile


def portrait_inventory(roster, tracker):
    tracker = copy.deepcopy(tracker)
    folders = {}

    def visit(entry, folder):
        folders[folder] = entry
        entry["sprite_files"] = entry.get("portrait_files", {})
        entry["sprite_credit"] = entry.get("portrait_credit", {})
        for key, child in entry.get("subgroups", {}).items():
            visit(child, folder + "/" + key)

    for key, entry in tracker.items():
        visit(entry, key)
    # Published portrait names differ from the battle roster for these exact
    # forms. Translate only the lookup name; preserve the roster identity/form.
    form_names = {
        "pikachuoriginal": "Original Cap", "pikachuhoenn": "Hoenn Cap",
        "pikachusinnoh": "Sinnoh Cap", "pikachuunova": "Unova Cap",
        "pikachukalos": "Kalos Cap", "pikachualola": "Alola Cap",
        "pikachupartner": "Partner Cap", "pikachuworld": "World Cap",
        "dudunsparcethreesegment": "Three",
        "meowsticmmega": "Mega", "calyrexice": "Ice Rider",
    }
    portrait_roster = [{**mon, "form": form_names.get(mon["id"], mon["form"])} for mon in roster]
    plan = inventory(portrait_roster, tracker)
    original_forms = {mon["id"]: mon["form"] for mon in roster}
    for row in plan["entries"]:
        row["form"] = original_forms[row["id"]]
    plan["folders"] = {folder: {"emotions": [e for e in EMOTIONS if e in entry.get("portrait_files", {})],
                                "credit": entry.get("portrait_credit", {})}
                       for folder, entry in folders.items() if entry.get("portrait_files")}
    plan["visible_frame_equivalences"] = json.loads(
        (ROOT / "art/portraits/visible-frame-equivalences.json").read_text("utf8"))["groups"]
    return plan


def collect(plan, stage, source, workers=12):
    import httpx
    from PIL import Image

    stage = Path(stage)
    folders = {entry[field] for entry in plan["entries"] for field in ("folder", "shiny_folder") if entry.get(field)}
    jobs = [(folder, emotion) for folder in sorted(folders) for emotion in plan["folders"][folder]["emotions"]]
    receipts = {}
    with httpx.Client(timeout=40, follow_redirects=True, limits=httpx.Limits(max_connections=workers)) as client:
        def fetch(job):
            folder, emotion = job
            rel = f"{folder}/{emotion}.png"
            path = stage / "published" / rel
            if not path.is_file():
                url = source.rstrip("/") + "/portrait/" + rel
                for attempt in range(3):
                    try:
                        response = client.get(url)
                        response.raise_for_status()
                        raw = response.content
                        image = Image.open(io.BytesIO(raw))
                        assert image.size == (40, 40), (rel, image.size)
                        path.parent.mkdir(parents=True, exist_ok=True)
                        path.write_bytes(raw)
                        break
                    except (httpx.HTTPError, OSError):
                        if attempt == 2:
                            raise
            raw = path.read_bytes()
            image = Image.open(io.BytesIO(raw))
            assert image.size == (40, 40), (rel, image.size)
            return rel, {"bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()}

        with ThreadPoolExecutor(max_workers=workers) as pool:
            futures = [pool.submit(fetch, job) for job in jobs]
            for n, future in enumerate(as_completed(futures), 1):
                rel, receipt = future.result()
                receipts[rel] = receipt
                if n % 1000 == 0:
                    print(f"{n}/{len(jobs)} portraits", flush=True)
    (stage / "published-receipts.json").write_text(json.dumps(receipts, sort_keys=True), encoding="utf8")
    print(f"Collected {len(receipts)} exact published portraits", flush=True)


def compile_library(plan, stage, destination, registry=None, allow_missing=False):
    """Compile exact published faces and explicitly reviewed atlas cells atomically."""
    from PIL import Image

    stage, destination = Path(stage), Path(destination)
    records = json.loads(registry.read_text("utf8")) if registry and registry.is_file() else {}
    # Reuse exact receipt-verified published PNG bytes from the previous installation.
    # Rebuilding a palette must not reopen thirty thousand tiny files on Windows.
    old_path = destination/'manifest.json'
    old = json.loads(old_path.read_text('utf8')) if old_path.is_file() else {}
    receipts_path = stage/'published-receipts.json'
    receipts = json.loads(receipts_path.read_text('utf8')) if receipts_path.is_file() and old.get('source') == plan['source'] else {}
    old_packs = {}

    def published_bytes(folder,emotion):
        relative = f'{folder}/{emotion}.png'
        sha = receipts.get(relative,{}).get('sha256')
        asset = old.get('files',{}).get(f'portraits/{sha}.png') if sha else None
        if asset:
            index = asset['pmd']
            if index not in old_packs:
                old_packs[index] = (destination/old['packs'][index]).read_bytes()
            raw = old_packs[index][asset['offset']:asset['offset']+asset['size']]
            if hashlib.sha256(raw).hexdigest() == sha:
                return raw
        return (stage/'published'/relative).read_bytes()
    background_root = registry.parent/'backgrounds' if registry else None
    background_manifest = background_root/'manifest.json' if background_root else None
    backgrounds = {}
    if background_manifest and background_manifest.is_file():
        for emotion,meta in json.loads(background_manifest.read_text('utf8'))['templates'].items():
            path = background_root/meta['file']
            assert hashlib.sha256(path.read_bytes()).hexdigest() == meta['sha256']
            backgrounds[emotion] = Image.open(path).convert('RGBA')
    entries, files, sources, packs, buffers = {}, {}, {}, [], [bytearray()]
    byid = {row["id"]: row for row in plan["entries"]}
    visible_frames = {target: group for group in plan.get("visible_frame_equivalences", [])
                      for target in group["targets"]}
    counts = Counter()

    def add(raw):
        image = Image.open(io.BytesIO(raw))
        assert image.size == (40, 40)
        sha = hashlib.sha256(raw).hexdigest()
        key = "portraits/" + sha + ".png"
        if key not in files:
            if buffers[-1] and len(buffers[-1]) + len(raw) > 4 * 1024 * 1024:
                buffers.append(bytearray())
            files[key] = {"pmd": len(buffers) - 1, "offset": len(buffers[-1]), "size": len(raw), "sha256": sha, "mime": "image/png"}
            buffers[-1].extend(raw)
        return key

    def faces(row, shiny, seen=()):
        if row["id"] in seen:
            raise ValueError("Portrait equivalence cycle")
        folder = row.get("shiny_folder" if shiny else "folder")
        record = records.get(f"{row['id']}|{int(shiny)}")
        result = {}
        if folder:
            for emotion in plan["folders"][folder]["emotions"]:
                raw = published_bytes(folder,emotion)
                mirror_source = record.get("published_flips", {}).get(emotion) if record and record.get("reviewed") is True else None
                if mirror_source:
                    if hashlib.sha256(raw).hexdigest() != mirror_source:
                        raise ValueError(f"Published portrait mirror source changed: {row['id']} / {emotion}")
                    original = add(raw)
                    tile = Image.open(io.BytesIO(raw)).convert("RGBA").transpose(Image.Transpose.FLIP_LEFT_RIGHT)
                    buffer = io.BytesIO(); tile.save(buffer, format="PNG")
                    raw = buffer.getvalue()
                    sources[f"{row['id']}|{int(shiny)}:{emotion}"] = {
                        "kind": "published_derivative", "operation": "flip_x", "folder": folder,
                        "source_file": original, "source_sha256": mirror_source,
                        "credit": plan["folders"][folder]["credit"],
                        "artists": plan["folders"][folder].get("artists", [])}
                result[emotion] = add(raw)
            sources[folder] = {"kind": "published", "folder": folder, "credit": plan["folders"][folder]["credit"],
                               "artists": plan["folders"][folder].get("artists", [])}
        equivalent = row.get("shiny_equivalent") if shiny else None
        equivalent = equivalent or row.get("equivalent")
        if equivalent:
            inherited = faces(byid[equivalent], shiny, (*seen, row["id"]))
            result = {**inherited, **result}
        visible = visible_frames.get(row["id"])
        if visible and visible["species"] in byid:
            source_row = byid[visible["species"]]
            inherited = faces(source_row, shiny, (*seen, row["id"]))
            source_folder = source_row.get("shiny_folder" if shiny else "folder")
            for emotion, sha in visible["source_sha256"][str(int(shiny))].items():
                file = f"portraits/{sha}.png"
                if emotion not in result and inherited.get(emotion) == file:
                    result[emotion] = file
                    sources[f"{row['id']}|{int(shiny)}:{emotion}"] = {
                        "kind": "visible-frame-equivalence", "species": visible["species"],
                        "source_pin": visible["source_pin"], "source_sha256": sha,
                        "folder": source_folder, "credit": plan["folders"][source_folder]["credit"],
                        "artists": plan["folders"][source_folder].get("artists", [])}
        if record and record.get("reviewed") is True:
            uses_background = record.get('background_key') or record.get('background_mode') == 'alpha'
            if uses_background and not record.get('background_reviewed') and not allow_missing:
                raise ValueError(f"Portrait background review pending: {row['id']}")
            if uses_background and any(emotion not in backgrounds for emotion in record['cells']):
                raise ValueError(f"Portrait background templates missing: {row['id']}")
            path = registry.parent / record["file"]
            raw = path.read_bytes()
            assert hashlib.sha256(raw).hexdigest() == record["sha256"], row["id"]
            image = Image.open(io.BytesIO(raw)).convert("RGBA")
            columns, rows = record["grid"]
            # Reviewed atlases can have rectangular source cells; atlas_tile
            # already uses the independent width/height quarter boundaries.
            trim = record.get("trim", 0)
            assert columns == rows and columns > 0
            assert image.width // columns > 2 * trim and image.height // rows > 2 * trim
            for emotion, cell in record["cells"].items():
                if emotion not in EMOTIONS or emotion in result:
                    continue  # Existing published art remains exact and wins over generation.
                x, y = cell
                assert 0 <= x < columns and 0 <= y < rows
                tile = atlas_tile(image,record,cell,backgrounds.get(emotion))
                buffer = io.BytesIO(); tile.save(buffer, format="PNG")
                result[emotion] = add(buffer.getvalue())
            sources[f"{row['id']}|{int(shiny)}"] = {"kind": "generated", **record}
        return result

    for row in plan["entries"]:
        for shiny in (False, True):
            key = f"{row['id']}|{int(shiny)}"
            entry = faces(row, shiny)
            entries[key] = entry
            counts["complete" if len(entry) == len(EMOTIONS) else "partial" if entry else "missing"] += 1
    if not allow_missing and counts["partial"] + counts["missing"]:
        raise ValueError(f"Portrait expression coverage incomplete: {dict(counts)}")
    destination.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="portrait-build-", dir=destination.parent) as temp:
        temp = Path(temp)
        for buffer in buffers:
            raw = bytes(buffer)
            name = "portraits-" + hashlib.sha256(raw).hexdigest() + ".pmd"
            (temp / name).write_bytes(raw); packs.append(name)
        manifest = {"version": 1, "source": plan["source"], "emotions": EMOTIONS, "fallbacks": EMOTION_FALLBACK,
                    "notice": "Published PMD portraits: SpriteCollab contributors / Chunsoft, CC BY-NC 4.0; generated additions retain separate tool and reference provenance.",
                    "coverage": dict(counts), "entries": entries, "files": files, "packs": packs, "sources": sources,
                    "backgrounds": json.loads(background_manifest.read_text('utf8')) if backgrounds else {}}
        for name in packs:
            target = destination / name
            if target.exists():
                assert target.read_bytes() == (temp / name).read_bytes()
            else:
                (temp / name).replace(target)
        write_bytes_atomic(destination / "manifest.json", json.dumps(manifest, ensure_ascii=False, separators=(",", ":")).encode("utf8"))
    print(json.dumps({"coverage": dict(counts), "images": len(files), "packs": len(packs)}), flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tracker", type=Path, required=True)
    parser.add_argument("--roster", type=Path, required=True)
    parser.add_argument("--stage", type=Path, required=True)
    parser.add_argument("--source", required=True, help="Pinned SpriteCollab raw URL")
    parser.add_argument("--collect", action="store_true")
    parser.add_argument("--workers", type=int, default=12)
    parser.add_argument("--compile", type=Path, help="Installed portrait output directory")
    parser.add_argument("--registry", type=Path, default=ROOT / "art/portraits/registry.json")
    parser.add_argument("--allow-missing", action="store_true", help="Explicitly partial QA collection")
    args = parser.parse_args()
    roster = json.loads(args.roster.read_text("utf8"))
    if isinstance(roster, dict):
        roster = roster["roster"]
    plan = portrait_inventory(roster, json.loads(args.tracker.read_text("utf8")))
    plan["source"] = args.source
    credit_names = args.tracker.parent / "credit_names.txt"
    if credit_names.is_file():
        artists = pmd_credits(json.loads(args.tracker.read_text("utf8")), parse_credit_names(credit_names.read_text("utf8")), "portrait")
        for folder, meta in plan["folders"].items():
            meta["artists"] = artists.get(folder, [])
    args.stage.mkdir(parents=True, exist_ok=True)
    (args.stage / "inventory.json").write_text(json.dumps(plan, ensure_ascii=False), encoding="utf8")
    if args.collect:
        collect(plan, args.stage, args.source, args.workers)
    if args.compile:
        compile_library(plan, args.stage, args.compile, args.registry, args.allow_missing)


if __name__ == "__main__":
    main()
