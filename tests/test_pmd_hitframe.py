import io
import json

from PIL import Image

from silvers_hoard.pmd import PmdSprites, parse_animdata, resolve


def test_hitframe_alias_and_optional_special_attack(tmp_path):
    xml = '<AnimData><Anims><Anim><Name>Idle</Name><FrameWidth>8</FrameWidth><FrameHeight>8</FrameHeight><Durations><Duration>6</Duration><Duration>9</Duration></Durations><HitFrame>1</HitFrame></Anim><Anim><Name>SpAttack</Name><CopyOf>Idle</CopyOf></Anim></Anims></AnimData>'
    anims, _ = parse_animdata(xml)
    assert resolve(anims, "SpAttack")[1]["hit"] == 1
    png = io.BytesIO()
    Image.new("RGBA", (16, 64), "red").save(png, "PNG")
    def http(url):
        return (200, xml.encode(), "text/xml") if url.endswith(".xml") else (200, png.getvalue(), "image/png")
    pmd = PmdSprites(tmp_path, {"pmd_sprites": True, "pmd_server": "https://example.test"}, http)
    meta = pmd._meta_for("0025")
    assert meta["schema"] == 2 and meta["a"]["SpAttack"]["hit"] == 1
    assert pmd.sheet("0025", "SpAttack").exists()
    cached = dict(meta)
    cached.pop("schema")
    (tmp_path / "0025" / "meta.json").write_text(json.dumps(cached))
    upgraded = pmd._meta_for("0025")
    assert upgraded["schema"] == 2


def test_old_metadata_survives_offline_upgrade_and_invalid_markers_are_ignored(tmp_path):
    path = tmp_path / "0025"
    path.mkdir()
    old = {"key": "0025", "s": 1, "a": {"Idle": {"w": 8, "h": 8, "n": 1, "r": 8, "d": [6], "ax": 4, "ay": 6}}}
    (path / "meta.json").write_text(json.dumps(old))
    pmd = PmdSprites(tmp_path, {"pmd_sprites": True, "pmd_server": "https://example.test"}, lambda url: (404, b"", "text/plain"))
    assert pmd._meta_for("0025") == old
    assert json.loads((path / "meta.json").read_text()) == old
    xml = '<Anim><Name>Attack</Name><FrameWidth>8</FrameWidth><FrameHeight>8</FrameHeight><Duration>6</Duration><HitFrame>9</HitFrame></Anim>'
    assert "hit" not in parse_animdata(xml)[0]["Attack"]
