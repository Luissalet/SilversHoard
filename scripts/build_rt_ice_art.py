"""Encode original PNG losslessly and embed the four measured sprite cells."""
import hashlib
import json
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1] / 'client/src/battle/rt/art/ice'


def main():
    source = ROOT / 'ice-source.png'
    image = Image.open(source).convert('RGBA')
    assert image.width % 2 == image.height % 2 == 0
    w, h = image.width // 2, image.height // 2
    anchors, boxes = [], []
    for i in range(4):
        cell = image.crop((i % 2 * w, i // 2 * h, (i % 2 + 1) * w, (i // 2 + 1) * h))
        box = cell.getchannel('A').point(lambda a: 255 if a > 32 else 0).getbbox()
        assert box and 0 < box[0] < box[2] < w and 0 < box[1] < box[3] < h
        points = [(x, y) for y in range(h) for x in range(w)
                  if (p := cell.getpixel((x, y)))[3] > 180 and p[0] > 205 and p[1] > 220 and p[2] > 225]
        assert points
        anchors.append([sum(x for x, _ in points) / len(points) / w, sum(y for _, y in points) / len(points) / h])
        boxes.append(list(box))
    webp = ROOT / 'ice.webp'
    image.save(webp, format='WEBP', lossless=True, exact=True, method=6)
    decoded = Image.open(webp).convert('RGBA')
    assert decoded.tobytes() == image.tobytes(), 'WebP must preserve pixels and alpha'
    manifest = {'w': w, 'h': h, 'fps': 12, 'anchors': anchors, 'alpha_bounds': boxes,
                'source_sha256': hashlib.sha256(source.read_bytes()).hexdigest(),
                'webp_sha256': hashlib.sha256(webp.read_bytes()).hexdigest()}
    (ROOT / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
    atlas = {key: manifest[key] for key in ['w', 'h', 'fps', 'anchors']}
    (ROOT / 'ice.gen.js').write_text('// Original generated art. Rebuild: python scripts/build_rt_ice_art.py\n'
                                   + 'export const ICE_ATLAS = ' + json.dumps(atlas, separators=(',', ':'))[:-1]
                                   + ',url:new URL("./ice.webp",import.meta.url).href};\n', encoding='utf-8')
    print(json.dumps({'cells': [w, h], 'webp_bytes': webp.stat().st_size, 'anchors': anchors}))


if __name__ == '__main__':
    main()
