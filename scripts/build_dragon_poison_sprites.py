"""Add inspected motifs from Luis's local PMD Time/Darkness sheets. No downloads.

The selected rows are source material for the existing RT renderer, not cartridge
emitter programs. Source rectangles and atlas offsets preserve every selected pixel.
"""
import argparse
import hashlib
import json
from pathlib import Path

from PIL import Image

from build_rt_particle_sprites import pack, ROOT


def row(top, bottom, bounds):
    return [(left, top, right, bottom) for left, right in zip(bounds, bounds[1:])]


# Named sprite rows inspected on the supplied sheets; labels and adjacent moves are excluded.
SEQUENCES = {
    'dragon-dance': ('Dragon', 'Dragon Dance rings', 'Aros de Danza Dragón', 965, 1021,
        row(965, 1021, [112, 166, 223, 278, 338, 395, 449, 506, 547, 576, 595, 613, 626])),
    'dragon-pulse': ('Dragon', 'Dragon Pulse orbs', 'Orbes de Pulso Dragón', 1198, 1260,
        row(1198, 1260, [40, 85, 155, 220, 270, 328, 386, 451, 510, 565, 615])),
    'outrage': ('Dragon', 'Outrage flames', 'Llamas de Enfado', 1728, 1848,
        [(left, 1760 if left < 360 else 1735, right, 1848) for left, right in
         [(170, 210), (210, 250), (250, 305), (305, 360), (360, 430), (430, 490), (490, 545), (545, 600), (600, 645), (645, 690)]]),
    'spacial-rend': ('Dragon', 'Spacial Rend rifts', 'Cortes de Corte Vacío', 2094, 2162,
        row(2094, 2162, [60, 90, 120, 165, 225, 300, 374, 445, 515, 585, 650])),
    'acid': ('Poison', 'Acid bubbles', 'Burbujas de Ácido', 25, 53,
        [(11, 25, 34, 53), (38, 25, 63, 53), (64, 25, 89, 53), (92, 25, 115, 53)]),
    'acid-armor': ('Poison', 'Acid Armor rings', 'Aros de Armadura Ácida', 50, 78,
        [(left, 50, right, 78) for left, right in [(128, 146), (148, 168), (171, 197), (203, 233), (242, 276), (289, 328)]]),
    'gunk-shot': ('Poison', 'Gunk Shot orb and fragments', 'Orbe y fragmentos de Lanza Mugre', 258, 342,
        [(left, 258, right, 304) for left, right in
         [(29, 37), (43, 55), (63, 83), (93, 123), (126, 154), (155, 183), (185, 219), (220, 256), (258, 294), (295, 331), (332, 364), (366, 398), (398, 434)]]
        + row(300, 342, [68, 107, 143, 181, 219, 248, 271, 295, 317, 338, 360, 376])),
    'poison-gas': ('Poison', 'Poison Gas cloud', 'Nube de Gas Venenoso', 818, 880,
        row(818, 880, [15, 35, 55, 83, 120, 165, 215, 267, 323, 376, 434, 488, 535, 551])),
    'poison-fang': ('Poison', 'Poison Fang teeth', 'Colmillos de Colmillo Veneno', 130, 152,
        [(608, 130, 641, 152), (648, 130, 670, 152), (680, 130, 698, 152)]),
    'toxic': ('Poison', 'Toxic rings', 'Aros de Tóxico', 1182, 1216,
        row(1182, 1216, [90, 104, 130, 158, 186, 215, 246, 280, 323, 365, 388, 412, 436, 458, 482, 505, 530, 558, 585])),
    'toxic-spikes': ('Poison', 'Toxic Spikes particles', 'Partículas de Púas Tóxicas', 595, 645,
        row(595, 645, [478, 500, 534, 574, 614, 660, 706, 751])),
}


def extend(folder, manifest=None):
    manifest = manifest or ROOT / 'silvers_hoard/presets/supplied_sprites.json'
    art = json.loads(manifest.read_text(encoding='utf-8'))
    original = {key: value for key, value in art['sprites'].items() if not key.startswith('fx-pmd-td-')}
    sheets = {}
    for kind in ('Dragon', 'Poison'):
        path, = folder.glob(f'*Darkness*{kind} Attack Effects.png')
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        inventory = [entry for entry in art['inventory'] if entry['file'] == path.name]
        if len(inventory) != 1 or inventory[0]['sha256'] != digest:
            raise ValueError(f'{kind} source differs from the existing supplied inventory')
        sheet = Image.open(path).convert('RGBA')
        sheets[kind] = sheet
        source = 'pmd-td-' + kind.lower()
        art['sources'][source] = dict(file=path.name, sha256=digest,
            credit='redblueyellow (ripper; supplied Explorers of Time/Darkness sheet)',
            copyright='Pokémon © Nintendo, Creatures, GAME FREAK')
        for entry in art['inventory']:
            if entry['sha256'] == digest:
                entry['connected'] = True
    for name, (kind, en, es, top, bottom, rects) in SEQUENCES.items():
        sheet = sheets[kind]
        key = sheet.getpixel((0, 0))[:3]
        width = max(right - left for left, _, right, _ in rects)
        height = bottom - top if name == 'outrage' else max(rect[3] - rect[1] for rect in rects)
        side = max(width, height)  # The shared renderer draws square destinations; pad rather than stretching source art.
        frames, offsets = [], []
        for rect in rects:
            tile = sheet.crop(rect)
            tile.putdata([(r, g, b, 0 if (r, g, b) == key else a) for r, g, b, a in tile.getdata()])
            if not tile.getbbox():
                raise ValueError(f'Empty {name} frame: {rect}')
            edges = [tile.crop(box) for box in [(0, 0, tile.width, 1), (0, tile.height - 1, tile.width, tile.height),
                     (0, 0, 1, tile.height), (tile.width - 1, 0, tile.width, tile.height)]]
            if any(edge.getbbox() for edge in edges):
                raise ValueError(f'Clipped {name} frame: {rect}')
            offset = [(side - tile.width) // 2, (side - height) // 2 +
                      (rect[1] - top if name == 'outrage' else (height - tile.height) // 2)]
            cell = Image.new('RGBA', (side, side))
            cell.alpha_composite(tile, offset)
            frames.append(cell); offsets.append(offset)
        art['sprites']['fx-pmd-td-' + name] = pack(frames, name=en, name_es=es,
            source='pmd-td-' + kind.lower(), source_frames=len(frames),
            frame_rects=[list(rect) for rect in rects], frame_offsets=offsets,
            background_key=list(key), source_band=[top, bottom],
            still_frame=max(range(len(frames)), key=lambda i: sum(bool(a) for a in frames[i].getchannel('A').getdata())))
    if any(art['sprites'][key] != value for key, value in original.items()):
        raise ValueError('An existing supplied sprite changed')
    manifest.write_text(json.dumps(art, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    print(f'{len(SEQUENCES)} local PMD motifs, {sum(len(v[-1]) for v in SEQUENCES.values())} frames')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('folder', type=Path)
    extend(parser.parse_args().folder)
