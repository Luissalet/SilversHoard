"""Embed the original floor and water WebPs for both app and standalone builds."""
import base64
import json
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1] / 'client/src/battle/rt/visuals'

def main():
    image = Image.open(ROOT / 'water.webp').convert('RGBA')
    w, h = image.width // 2, image.height // 2
    anchors = []
    for i in range(4):
        cell = image.crop(((i % 2) * w, (i // 2) * h, (i % 2 + 1) * w, (i // 2 + 1) * h))
        box = cell.getchannel('A').point(lambda p: 255 if p > 32 else 0).getbbox()
        assert box and 0 < box[0] < box[2] < w and 0 < box[1] < box[3] < h
        points = [(x, y) for y in range(h) for x in range(w)
                  if (p := cell.getpixel((x, y)))[3] > 180 and p[0] > 190 and p[1] > 220 and p[2] > 215]
        assert points
        anchors.append([sum(p[0] for p in points) / len(points), sum(p[1] for p in points) / len(points)])
    urls = {name: 'data:image/webp;base64,' + base64.b64encode((ROOT / f'{name}.webp').read_bytes()).decode()
            for name in ['forest', 'sand', 'water']}
    packed = '// Original generated art; see PROVENANCE.md. Rebuild: python scripts/build_rt_visual_textures.py\n'
    packed += 'export const TEXTURES = ' + json.dumps(urls, separators=(',', ':')) + ';\n'
    packed += 'export const WATER_CELLS = ' + json.dumps({'w': w, 'h': h, 'anchors': anchors}, separators=(',', ':')) + ';\n'
    (ROOT / 'textures.gen.js').write_text(packed, encoding='utf-8')

if __name__ == '__main__':
    main()
