"""Select delimited motifs from the supplied Red Rescue Team Rock sheet; no downloads."""
import argparse
import hashlib
import json
from pathlib import Path

from PIL import Image

from build_rt_particle_sprites import ROOT, pack

FILE = 'Game Boy Advance - Pokemon Mystery Dungeon_ Red Rescue Team - Attacks - Rock-Type Moves.png'
SOURCE = 'pmd-rrt-rock'
PREFIX = 'fx-pmd-rrt-'


def between(top, bottom, dividers):
    # Red separators occupy two columns. Keep only clearly delimited interior frames;
    # the loose tiles and the unbounded material at either end are deliberately omitted.
    return [(left + 2, top, right, bottom) for left, right in zip(dividers, dividers[1:])]


SEQUENCES = {
    'ancient-power': ('Ancient Power stones', 'Piedras de Poder Pasado',
        between(14, 70, [42, 83, 124, 165, 207, 250, 294])),
    'rock-blast': ('Rock Blast fragments', 'Fragmentos de Pedrada',
        between(146, 205, [101, 137, 178, 226, 282, 343, 409, 481])),
    'rock-tomb': ('Rock Tomb ring', 'Anillo de Tumba Rocas',
        between(260, 397, [131, 250, 358, 455, 539, 607, 655, 689, 723, 757])),
    'rollout': ('Rollout fragments', 'Fragmentos de Desenrollar',
        between(548, 610, [19, 55, 96, 144, 200, 261, 327, 399])),
}


def extend(folder, manifest=None):
    manifest = manifest or ROOT / 'silvers_hoard/presets/supplied_sprites.json'
    art = json.loads(manifest.read_text(encoding='utf8'))
    path = folder / FILE
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    entry = [x for x in art['inventory'] if x['file'] == FILE]
    if len(entry) != 1 or entry[0]['sha256'] != digest:
        raise ValueError('Rock source differs from the existing supplied inventory')
    previous = {k: v for k, v in art['sprites'].items() if not k.startswith(PREFIX)}
    sheet = Image.open(path).convert('RGBA')
    key = sheet.getpixel((0, 0))[:3]
    for name, (en, es, rects) in SEQUENCES.items():
        side = max(max(r - l, b - t) for l, t, r, b in rects)
        if side > 160:
            raise ValueError('Selection would be rescaled')
        frames, offsets = [], []
        for rect in rects:
            tile = sheet.crop(rect)
            if any((r, g, b) == (255, 0, 0) for r, g, b, _ in tile.getdata()):
                raise ValueError(f'Separator included in {name}: {rect}')
            tile.putdata([(r, g, b, 0 if (r, g, b) == key else a) for r, g, b, a in tile.getdata()])
            if not tile.getbbox():
                raise ValueError(f'Empty {name} frame')
            edges = [(0, 0, tile.width, 1), (0, tile.height - 1, tile.width, tile.height),
                     (0, 0, 1, tile.height), (tile.width - 1, 0, tile.width, tile.height)]
            if any(tile.crop(box).getbbox() for box in edges):
                raise ValueError(f'Clipped {name} frame: {rect}')
            offset = [(side - tile.width) // 2, (side - tile.height) // 2]
            frame = Image.new('RGBA', (side, side));frame.alpha_composite(tile, offset)
            frames.append(frame);offsets.append(offset)
        art['sprites'][PREFIX + name] = pack(frames, name=en, name_es=es, source=SOURCE,
            source_frames=len(frames), frame_rects=[list(r) for r in rects], frame_offsets=offsets,
            background_key=list(key), source_band=[rects[0][1], rects[0][3]],
            still_frame=max(range(len(frames)), key=lambda i: sum(bool(a) for a in frames[i].getchannel('A').getdata())))
    art['sources'][SOURCE] = {'file': FILE, 'sha256': digest,
        'credit': 'redblueyellow (ripper; supplied Red Rescue Team Rock-Type Moves sheet)',
        'copyright': 'Pokémon © Nintendo, Creatures, GAME FREAK'}
    for item in art['inventory']:
        if item['sha256'] == digest:
            item['connected'] = True
    assert all(art['sprites'][k] == v for k, v in previous.items())
    manifest.write_bytes(json.dumps(art, ensure_ascii=False, separators=(',', ':')).encode('utf8'))
    print(f'{len(SEQUENCES)} local Rock motifs, {sum(len(v[-1]) for v in SEQUENCES.values())} frames')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__);parser.add_argument('folder', type=Path)
    extend(parser.parse_args().folder)
