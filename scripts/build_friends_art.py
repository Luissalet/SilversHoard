"""Publish the active PMD previews and expressions as ordinary static files."""
import argparse
import gzip
import hashlib
import json
import re
from pathlib import Path
from zipfile import ZIP_STORED, ZipFile, ZipInfo


BUNDLE = Path("assets/friends-pmd")
IMAGE = re.compile(r"files/[0-9a-f]{64}\.(?:png|webp)\Z")
EXTENSIONS = {"image/png": "png", "image/webp": "webp"}
CHUNK_BYTES = 8 * 1024 * 1024
PRIVATE_PNG_CHUNKS = {b"tEXt", b"zTXt", b"iTXt", b"eXIf"}


def strip_png_metadata(raw: bytes) -> bytes:
    chunks = [raw[:8]]
    offset = 8
    while offset < len(raw):
        end = offset + 12 + int.from_bytes(raw[offset:offset + 4], "big")
        if raw[offset + 4:offset + 8] not in PRIVATE_PNG_CHUNKS:
            chunks.append(raw[offset:end])
        offset = end
    return b"".join(chunks)


def art_directory(output: Path) -> Path:
    if not (output / "index.html").is_file():
        raise ValueError("Build the Friends page before publishing its art.")
    art = output / "art"
    (art / "files").mkdir(parents=True, exist_ok=True)
    return art


def publish(root: Path, output: Path) -> None:
    pmd = root / "pmd"
    faces = root / "portraits"
    body = json.loads((pmd / "manifest.json").read_text("utf-8"))
    portraits = json.loads((faces / "manifest.json").read_text("utf-8"))
    art = art_directory(output)
    images = art / "files"

    files = {}

    def write_images(library, manifest, keys):
        by_pack = {}
        for key in keys:
            record = manifest["files"][key]
            by_pack.setdefault(record["pmd"], []).append((key, record))
        for pack, items in by_pack.items():
            with (library / manifest["packs"][pack]).open("rb") as stream:
                for key, record in items:
                    stream.seek(record["offset"])
                    raw = stream.read(record["size"])
                    digest = hashlib.sha256(raw).hexdigest()
                    if digest != record["sha256"]:
                        raise ValueError(f"Invalid art: {key}")
                    ext = EXTENSIONS[record["mime"]]
                    if ext == "png":
                        raw = strip_png_metadata(raw)
                        digest = hashlib.sha256(raw).hexdigest()
                    path = images / f"{digest}.{ext}"
                    if not path.exists():
                        path.write_bytes(raw)
                    files[key] = f"files/{path.name}"

    metas = {key: {"previews": meta["previews"]} for key, meta in body["metas"].items() if meta.get("previews")}
    species = {mon["id"]: {"num": mon["num"], "form": mon["form"]} for mon in body["roster"]}
    write_images(pmd, body, {key for meta in metas.values() for key in meta["previews"].values()})
    write_images(faces, portraits, {key for entry in portraits["entries"].values() for key in entry.values()})
    projection = {
        "version": 1, "files": files, "urls": {},
        "pmd": {"entries": body["entries"], "metas": metas, "species": species},
        "portraits": {"entries": portraits["entries"], "fallbacks": portraits.get("fallbacks", {})},
    }
    (art / "index.json").write_text(json.dumps(projection, separators=(",", ":"), sort_keys=True), "utf-8")
    body_credits = (pmd / "CREDITS.md").read_text("utf-8")
    portrait_credits = [
        "# Portrait credits", "", portraits["notice"], "", f"Published source: {portraits['source']}", "",
        "SpriteCollab licence: https://creativecommons.org/licenses/by-nc/4.0/", "",
    ]
    for entry, source in sorted(portraits["sources"].items()):
        artists = source.get("artists")
        if artists:
            portrait_credits.append(f"- `{entry}`: " + ", ".join(artists))
    credits = "\n".join(portrait_credits) + "\n\n" + body_credits
    (art / "CREDITS.md").write_text(credits, encoding="utf-8", newline="\n")
    print(f"Published {len(portraits['entries'])} portrait sets and {len(metas)} sprite variants.")


def image_names(index: bytes) -> set[str]:
    names = set(json.loads(index)["files"].values())
    if not names or any(not IMAGE.fullmatch(name) for name in names):
        raise ValueError("The art index contains an invalid image path.")
    return names


def pack_art(art: Path, bundle: Path) -> None:
    """Record the exact publication inputs, without local library history or source files."""
    index = (art / "index.json").read_bytes()
    bundle.mkdir(parents=True, exist_ok=True)
    (bundle / "index.json.gz").write_bytes(gzip.compress(index, mtime=0))
    (bundle / "CREDITS.md").write_bytes((art / "CREDITS.md").read_bytes())
    write_packs(bundle, {name: (art / name).read_bytes() for name in image_names(index)})


def write_packs(bundle: Path, images: dict[str, bytes]) -> None:
    groups = [[]]
    size = 0
    for name in sorted(images):
        length = len(images[name])
        if size and size + length > CHUNK_BYTES:
            groups.append([])
            size = 0
        groups[-1].append(name)
        size += length
    expected = set()
    for number, group in enumerate(groups, 1):
        path = bundle / f"images-{number:02}.zip"
        expected.add(path)
        with ZipFile(path, "w", compression=ZIP_STORED) as archive:
            for name in group:
                archive.writestr(ZipInfo(name), images[name])
    for old in bundle.glob("images-[0-9][0-9].zip"):
        if old not in expected:
            old.unlink()


def publish_bundle(bundle: Path, output: Path) -> None:
    index = gzip.decompress((bundle / "index.json.gz").read_bytes())
    pending = image_names(index)
    art = art_directory(output)
    for path in sorted(bundle.glob("images-*.zip")):
        with ZipFile(path) as archive:
            for entry in archive.infolist():
                name = entry.filename
                if name not in pending:
                    raise ValueError(f"Unexpected or duplicate image: {name}")
                raw = archive.read(entry)
                if hashlib.sha256(raw).hexdigest() != Path(name).stem:
                    raise ValueError(f"Invalid art: {name}")
                (art / name).write_bytes(raw)
                pending.remove(name)
    if pending:
        raise ValueError(f"Missing {len(pending)} images from the art packs.")
    (art / "index.json").write_bytes(index)
    (art / "CREDITS.md").write_bytes((bundle / "CREDITS.md").read_bytes())
    print("Published the checked-in PMD previews and portraits.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--library", type=Path, help="Read this installed PMD library instead of the checked-in packs.")
    parser.add_argument("--refresh-bundle", action="store_true", help="Update the checked-in packs from --library.")
    parser.add_argument("--bundle", type=Path, default=BUNDLE)
    parser.add_argument("--output", type=Path, default=Path("dist/friends"))
    args = parser.parse_args()
    if args.refresh_bundle and args.library is None:
        parser.error("--refresh-bundle requires --library")
    if args.library:
        publish(args.library, args.output)
        if args.refresh_bundle:
            pack_art(args.output / "art", args.bundle)
    else:
        publish_bundle(args.bundle, args.output)
