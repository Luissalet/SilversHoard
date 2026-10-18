"""Extract the supplied PMD Red Rescue Team status rows without changing the sheet.

Run after the supplied/RT particle builders. Rectangles are sheet coordinates;
the palette and headings are deliberately excluded. Runtime only needs the PNGs.
"""
import argparse
import hashlib
import json
from pathlib import Path

from PIL import Image

from build_rt_particle_sprites import pack, ROOT

# x, y, cell width, cell height, frames; fixed cells retain their common anchor.
ROWS = {
    'confusion': (104, 48, 16, 16, 10, 'Confusion', 'Confusión'),
    'taunt': (104, 64, 16, 16, 9, 'Taunt', 'Mofa'),
    'protect': (104, 96, 16, 16, 13, 'Protection', 'Protección'),
    'burn': (104, 112, 16, 16, 7, 'Burn', 'Quemado'),
    'paralysis': (104, 128, 16, 16, 8, 'Paralysis', 'Paralizado'),
    'freeze': (104, 144, 32, 32, 6, 'Frozen', 'Congelado'),
    'sleep': (104, 232, 16, 16, 10, 'Sleep / drowsiness', 'Sueño / somnolencia'),
    'poison': (104, 248, 16, 16, 15, 'Poison', 'Envenenado'),
}


def extend(folder):
    path = next(folder.glob('*Red Rescue Team*Status Effects.png'))
    sheet = Image.open(path).convert('RGBA')
    key = sheet.getpixel((343, 351))[:3]
    manifest = ROOT / 'silvers_hoard/presets/supplied_sprites.json'
    art = json.loads(manifest.read_text(encoding='utf-8'))
    sid = 'pmd-red-status'
    art['sources'][sid] = dict(file=path.name, sha256=hashlib.sha256(path.read_bytes()).hexdigest(),
        credit='Supplied PMD Red Rescue Team status sheet; ripper not identified on sheet',
        copyright='Pokémon © Nintendo, Creatures, GAME FREAK')
    for entry in art['inventory']:
        if entry['file']==path.name:
            entry['connected']=True
    for name, (x, y, w, h, count, en, es) in ROWS.items():
        frames, rects = [], []
        for i in range(count):
            box = (x+i*w, y, x+(i+1)*w, y+h)
            im = sheet.crop(box)
            im.putdata([(r,g,b,0 if (r,g,b)==key else a) for r,g,b,a in im.getdata()])
            frames.append(im); rects.append(list(box))
        # Do not silently truncate a row's final hold frames, including duplicate Zs.
        tail=sheet.crop((x+count*w,y,sheet.width,y+h))
        if tail.width and any(pixel[:3]!=key and pixel[3] for pixel in tail.getdata()):
            raise ValueError(f'Unextracted status pixels after {name}')
        art['sprites']['fx-status-'+name] = pack(frames, name=en, name_es=es,
            source=sid, frame_rects=rects, status=name, source_frames=count)
    manifest.write_text(json.dumps(art, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    print(f'{len(ROWS)} PMD status atlases, {sum(r[4] for r in ROWS.values())} frames')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('folder', type=Path)
    extend(parser.parse_args().folder)
