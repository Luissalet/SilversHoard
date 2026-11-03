"""Build and install Silver's poke-engine: the pinned 0.0.48 source from PyPI with the rule corrections of engine/poke-engine/patches.

    python scripts/build_poke_engine.py            # download (sha256 checked), patch, build with the 9th generation's rules, pip install
    python scripts/build_poke_engine.py --check    # say which poke-engine is installed and whether it is Silver's build
    python scripts/build_poke_engine.py --plain    # the unpatched upstream build (to compare against it)
    python scripts/build_poke_engine.py --wheel-only --out DIR   # build the wheel into DIR without installing it

poke-engine (pmariglia, MIT) is the master AI's search. Its upstream rules differ from the simulator in a few places (end-of-turn order,
Defog, Rest, Black Sludge, Heal Block and Leftovers, toxic damage rounding, Weakness Policy on a knock-out, Shed Skin); the patches correct
them and the build is versioned 0.0.48+silver.N, so `pip show poke-engine`, the master AI's status and the parity kit's lock all tell the
builds apart. Needs a Rust toolchain (rustup.rs) and git (to apply the patches). The difference is measured by
`python scripts/parity_poke_engine.py --force` and tested by tests/test_master_rules.py.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import io
import os
import subprocess
import sys
import tarfile
import tempfile
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PATCHES = ROOT / "engine" / "poke-engine" / "patches"
VERSION = "0.0.48"
SDIST = f"https://files.pythonhosted.org/packages/source/p/poke-engine/poke_engine-{VERSION}.tar.gz"
SDIST_SHA256 = "070010686f2aedff11e25137e696e301ccd80fd57c805d255464067fc905ca12"
LOCAL = "silver.1"   # bump with every change of the patches
FEATURES = "--no-default-features --features poke-engine/terastallization"


def installed() -> dict:
    try:
        version = importlib.metadata.version("poke-engine")
    except importlib.metadata.PackageNotFoundError:
        return {"installed": False, "version": None, "silver_build": False}
    return {"installed": True, "version": version, "silver_build": f"+{LOCAL}" in version,
            "older_silver_build": "+silver" in version and f"+{LOCAL}" not in version}


def fetch(dest: Path) -> Path:
    """The pinned source distribution, unpacked under dest (its sha256 must match)."""
    raw = urllib.request.urlopen(SDIST, timeout=120).read()
    got = hashlib.sha256(raw).hexdigest()
    if got != SDIST_SHA256:
        raise SystemExit(f"poke-engine {VERSION} source does not match the pinned sha256 ({got})")
    with tarfile.open(fileobj=io.BytesIO(raw)) as tar:
        tar.extractall(dest, filter="data")
    return dest / f"poke_engine-{VERSION}"


def patch(src: Path) -> list[str]:
    applied = []
    for p in sorted(PATCHES.glob("*.patch")):
        r = subprocess.run(["git", "apply", "--whitespace=nowarn", str(p)], cwd=src, capture_output=True, text=True)
        if r.returncode:
            raise SystemExit(f"{p.name} does not apply: {r.stderr.strip()}")
        applied.append(p.name)
    py = src / "pyproject.toml"
    py.write_text(py.read_text("utf-8").replace(f'version = "{VERSION}"', f'version = "{VERSION}+{LOCAL}"', 1), "utf-8")
    return applied


def build(src: Path, out: Path) -> Path:
    env = {**os.environ, "MATURIN_PEP517_ARGS": FEATURES}
    subprocess.run([sys.executable, "-m", "pip", "wheel", "--no-deps", "-w", str(out), str(src)], check=True, env=env)
    wheels = sorted(out.glob("poke_engine-*.whl"), key=lambda p: p.stat().st_mtime)
    if not wheels:
        raise SystemExit("the build left no wheel")
    return wheels[-1]


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--check", action="store_true", help="only report what is installed")
    ap.add_argument("--plain", action="store_true", help="build upstream poke-engine without Silver's patches")
    ap.add_argument("--wheel-only", action="store_true", help="build the wheel and do not install it")
    ap.add_argument("--out", type=Path, help="where to leave the wheel (default: a temporary folder)")
    a = ap.parse_args(argv)
    if a.check:
        print(installed())
        return 0
    with tempfile.TemporaryDirectory(prefix="poke-engine-") as tmp:
        src = fetch(Path(tmp))
        applied = [] if a.plain else patch(src)
        out = a.out or Path(tmp) / "wheels"
        out.mkdir(parents=True, exist_ok=True)
        wheel = build(src, out)
        print(f"built {wheel.name} with {len(applied)} patch(es): {', '.join(applied) or 'none'}")
        if not a.wheel_only:
            subprocess.run([sys.executable, "-m", "pip", "install", "--no-deps", "--force-reinstall", str(wheel)], check=True)
            print(installed())
    return 0


if __name__ == "__main__":
    sys.exit(main())
