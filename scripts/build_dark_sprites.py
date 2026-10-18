"""Build inspected local Red Rescue Team Dark motifs without changing previous sprites."""
import argparse
import hashlib
import json
from pathlib import Path
from PIL import Image
from build_rt_particle_sprites import ROOT, pack

FILE = 'Game Boy Advance - Pokemon Mystery Dungeon_ Red Rescue Team - Attacks - Dark-Type Moves.png'
PREFIX, SOURCE = 'fx-pmd-dark-', 'pmd-rrt-dark'
SEQUENCES = {
    'bite': ('Bite jaws', 'Mandíbulas de Mordisco', 2.4,
             [(0,146,35,166),(0,170,35,190),(0,189,35,213),(0,219,35,236),(0,235,35,259),
              (0,260,35,286),(0,285,35,309),(0,308,35,335),(0,334,38,363),(0,363,35,389)]),
    'crunch': ('Crunch jaws', 'Mandíbulas de Triturar', 2.4,
               [(35,154,70,183),(33,197,70,229),(35,253,70,286),(35,303,70,335),(35,348,72,384)]),
    'knock-off': ('Knock Off claws', 'Garras de Desarme', 2.4,
                  [(0,812,34,843),(34,812,69,843),(69,812,101,843)]),
    'pursuit': ('Pursuit column', 'Columna de Persecución', 1.8,
                [(l,1064,r,1172) for l,r in [(0,7),(6,17),(16,35),(34,69),(68,100)]]),
    'torment': ('Torment seal', 'Sello de Tormento', 2.4,
                [(l,1404,r,1441) for l,r in [(4,24),(28,58),(64,100),(101,139),(144,182),(188,226),(230,268)]]),
}

def extend(folder, manifest=None):
    manifest = manifest or ROOT / 'silvers_hoard/presets/supplied_sprites.json'
    art = json.loads(manifest.read_text(encoding='utf8'));previous = {k:v for k,v in art['sprites'].items() if not k.startswith(PREFIX)}
    path = folder / FILE;digest = hashlib.sha256(path.read_bytes()).hexdigest()
    entries = [x for x in art['inventory'] if x['file'] == FILE]
    if len(entries)!=1 or entries[0]['sha256']!=digest:
        raise ValueError('Dark source differs from the supplied inventory')
    source = Image.open(path).convert('RGBA');key = source.getpixel((source.width-1,0))[:3]
    built = {}
    for name,(en,es,scale,rects) in SEQUENCES.items():
        side = max(max(r-l,b-t) for l,t,r,b in rects)
        if side>160:raise ValueError('Selection would be rescaled')
        frames,offsets = [],[]
        for rect in rects:
            if not (0<=rect[0]<rect[2]<=source.width and 0<=rect[1]<rect[3]<=source.height):raise ValueError('Out-of-bounds crop')
            tile = source.crop(rect);tile.putdata([(r,g,b,0 if (r,g,b)==key else a) for r,g,b,a in tile.getdata()])
            if not tile.getbbox():raise ValueError(f'Empty {name} frame')
            if any(tile.crop(edge).getbbox() for edge in [(0,0,tile.width,1),(0,tile.height-1,tile.width,tile.height),(0,0,1,tile.height),(tile.width-1,0,tile.width,tile.height)]):
                raise ValueError(f'Clipped {name} frame {rect}')
            offset = [(side-tile.width)//2,(side-tile.height)//2];frame=Image.new('RGBA',(side,side));frame.alpha_composite(tile,offset)
            frames.append(frame);offsets.append(offset)
        built[PREFIX+name]=pack(frames,name=en,name_es=es,source=SOURCE,display_scale=scale,
            frame_rects=[list(r) for r in rects],frame_offsets=offsets,background_key=list(key),
            still_frame=max(range(len(frames)),key=lambda i:sum(bool(a) for a in frames[i].getchannel('A').getdata())))
    art['sprites'].update(built)
    art['sources'][SOURCE]={'file':FILE,'sha256':digest,'credit':'redblueyellow (ripper; supplied Red Rescue Team Dark-Type Moves sheet)',
                            'copyright':'Pokémon © Nintendo, Creatures, GAME FREAK'}
    for item in art['inventory']:
        if item['sha256']==digest:item['connected']=True
    assert all(art['sprites'][k]==v for k,v in previous.items())
    manifest.write_bytes(json.dumps(art,ensure_ascii=False,separators=(',',':')).encode('utf8'))
    print(f'{len(built)} local Dark motifs, {sum(len(v[-1]) for v in SEQUENCES.values())} frames')

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('folder',type=Path)
    extend(parser.parse_args().folder)
