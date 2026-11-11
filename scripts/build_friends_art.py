"""Publish the active PMD previews and expressions as ordinary static files."""
import argparse
import hashlib
import json
from pathlib import Path


def publish(root: Path, output: Path) -> None:
    pmd = root / "pmd"
    faces = root / "portraits"
    body = json.loads((pmd / "manifest.json").read_text("utf-8"))
    portraits = json.loads((faces / "manifest.json").read_text("utf-8"))
    if not (output / "index.html").is_file():
        raise ValueError("Build the Friends page before publishing its art.")
    art = output / "art"
    pngs = art / "files"
    pngs.mkdir(parents=True, exist_ok=True)

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
                    path = pngs / f"{digest}.png"
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
    (art / "index.json").write_text(json.dumps(projection, separators=(",", ":")), "utf-8")
    print(f"Published {len(portraits['entries'])} portrait sets and {len(metas)} sprite variants.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--library", type=Path, default=Path("silvers_hoard/presets"))
    parser.add_argument("--output", type=Path, default=Path("dist/friends"))
    args = parser.parse_args()
    publish(args.library, args.output)
