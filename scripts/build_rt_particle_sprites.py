"""Extend the supplied manifest with RT effect material, preserving existing entries.

Run after build_supplied_sprites.py. The optional NARC is fetched from the pinned
pokeblack revision when omitted; only the converted PNGs are needed at runtime.
"""
import argparse
import base64
import hashlib
import io
import json
import struct
import urllib.request
import zipfile
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
REVISION = '67d91a78b16caccbd4fbecdddf8a74c823d208a6'
URL = f'https://raw.githubusercontent.com/squiddonaut/pokeblack/{REVISION}/files/a/0/0/6'
SHA256 = '10cd758c77cbc275daf58e728e5e201907427f2491d2d3459c9988682d649e68'
# These are archive sequence identifiers, not move IDs. Families are selected by
# inspecting the actual images; no cartridge choreography is inferred from them.
SKY = {
    'impact':'0084', 'fire-jet':'0036', 'fire-blast':'0090', 'fire-ring':'0029',
    'splash':'0074', 'water-ring':'0073', 'leaves':'0080', 'seedlings':'0137',
    'snow':'0191', 'icicles':'0061', 'rock':'0139', 'stones':'0140', 'dust':'0219',
    'tornado':'0135', 'air-cut':'0100', 'spikes':'0136', 'poison-pool':'0144',
    'poison-cloud':'0145', 'psychic-orb':'0017', 'psychic-burst':'0171',
    'ghost-flame':'0156', 'ghost-orb':'0176', 'dark-vortex':'0092', 'dark-pool':'0201',
    'dragon-helix':'0085', 'dragon-burst':'0143', 'web':'0134', 'bug-cloud':'0168',
    'hearts':'0199', 'fairy-burst':'0204', 'heal':'0244', 'boost':'0161',
    'electric-bolt':'0042', 'electric-burst':'0152', 'electric-blue':'0229',
    'sound':'0173', 'confusion':'0058', 'sleep':'0078', 'star':'0107',
    'light':'0246', 'dark-flame':'0163', 'fire-column':'0008', 'water-column':'0021',
    'ground-erupt':'0132', 'flowers':'0033', 'steel-ring':'0185', 'rain':'0257',
    'leech':'0154', 'burn':'0070', 'ice-burst':'0141', 'sparkles':'0151',
    'rock-pile':'0002', 'ring-rainbow':'0003', 'sun-orb':'0004', 'fire-orb':'0005',
    'pink-ray':'0006', 'bones':'0007', 'fire-orbs':'0010', 'needle':'0012', 'coins':'0013',
    'gem':'0014', 'feather-cut':'0027', 'fire-wall':'0030', 'sunburst':'0031',
    'fire-roll':'0034', 'spotlight':'0040', 'ice-comets':'0045', 'bat':'0046',
    'fire-cross':'0049', 'flame-claw':'0050', 'heart-pair':'0051', 'moon':'0054',
    'water-drops':'0055', 'meteor':'0056', 'sun-lance':'0057', 'electric-ring':'0060',
    'star-trail':'0062', 'angry-eyes':'0064', 'eye':'0065', 'leaf-sphere':'0067',
    'leaf-blade':'0068', 'psy-burst':'0069', 'mist':'0071', 'bubbles':'0082',
    'spirit':'0083', 'coin-bag':'0086', 'purple-scythe':'0088', 'ice-orbs':'0089',
    'smoke':'0097', 'crescent':'0100', 'wing-slash':'0104', 'dig':'0110',
    'water-lance':'0111', 'white-ray':'0113', 'sand':'0114', 'spoon':'0115',
    'roar':'0116', 'ice-crystal':'0127', 'target':'0128', 'razor-leaf':'0129',
    'sword':'0130', 'green-hit':'0131', 'crossbones':'0138', 'psychic-rings':'0142',
    'red-fist':'0147', 'silver-wind':'0149', 'shell':'0150', 'confetti':'0153',
    'water-vortex':'0155', 'red-eyes':'0157', 'orbit':'0158', 'purple-bubbles':'0165',
    'cross-slash':'0166', 'pollen':'0169', 'curse-seal':'0170', 'golden-cloud':'0172',
    'cloud':'0174', 'psy-orbit':'0178', 'metal-ball':'0180', 'rock-tomb':'0181',
    'mud-bombs':'0182', 'black-hole':'0184', 'leaf-vortex':'0186', 'sludge':'0196',
    'hand':'0200', 'dark-hit':'0202', 'night-orb':'0203', 'gyro':'0205',
    'lock-on':'0206', 'energy-stars':'0210', 'orange-ring':'0211', 'thorns':'0218',
    'ice-fist':'0221', 'fire-spin':'0225', 'tri-colors':'0226', 'blue-ring':'0227',
    'gears':'0231', 'bone-spin':'0232', 'gravity':'0233', 'poison-splash':'0234',
    'snow-cloud':'0235', 'light-sparks':'0236', 'energy-orb':'0238', 'water-orb':'0239',
    'psy-swirl':'0240', 'red-flash':'0241', 'solar-orb':'0243', 'green-burst':'0245',
    'toxic-orb':'0255', 'bubble-ring':'0256', 'petals':'0217',
}
BW = {'fist':(164,2), 'foot':(186,2), 'teeth':(471,1), 'slash':(248,5),
      'feather':(178,0), 'rock':(230,3), 'heart':(148,0), 'ring':(2,3),
      'swirl':(15,1), 'shield':(157,0), 'crack':(258,3), 'wave':(218,3),
      'web':(336,1), 'snowflake':(347,2), 'note':(381,2), 'roots':(440,3),
      'gear':(673,0), 'lightning':(664,0), 'water':(146,0), 'fire':(213,1)}


def narc_members(raw):
    if raw[:4] != b'NARC':
        raise ValueError('Not a NARC archive')
    fat = raw.index(b'BTAF')
    count = struct.unpack_from('<H', raw, fat+8)[0]
    base = raw.index(b'GMIF')+8
    return [raw[base+a:base+b] for a,b in
            (struct.unpack_from('<II',raw,fat+12+i*8) for i in range(count))]


def spa_textures(spa):
    """SPL 1.21 textures; layout documented by pret's SPLTextureResource.

    Palette indices and alpha are Nintendo DS A3I5/A5I3 or PLTT16. The
    source archive uses these three formats; unsupported formats fail explicitly.
    """
    if spa[:8] != b' APS12_1':
        raise ValueError('Unsupported SPL version')
    offset = struct.unpack_from('<I', spa, 24)[0]
    images = []
    for _ in range(struct.unpack_from('<H',spa,10)[0]):
        if spa[offset:offset+4] != b' TPS':
            raise ValueError('Invalid SPL texture header')
        param,size,pal,palsize,_,_,length = struct.unpack_from('<7I',spa,offset+4)
        fmt = param & 15
        w,h = 8 << ((param>>4)&15),8 << ((param>>8)&15)
        data = spa[offset+32:offset+32+size]
        if param & (1<<17):
            data_image = images[(param>>18)&255].copy()
            images.append(data_image)
            offset += length
            continue
        if fmt not in (1,3,6) or w > 1024 or h > 1024 or length < 32:
            raise ValueError('Unsupported SPL texture')
        palette = struct.unpack_from('<'+'H'*(palsize//2),spa,offset+pal)
        pixels = []
        for i in range(w*h):
            value = data[i] if fmt != 3 else (data[i//2] >> (i%2*4)) & 15
            index = value & (31 if fmt == 1 else 7) if fmt != 3 else value
            alpha = round((value>>5)*255/7) if fmt == 1 else round((value>>3)*255/31) if fmt == 6 else 0 if index == 0 and param&(1<<16) else 255
            color = palette[index]
            pixels.append(tuple(round(((color>>s)&31)*255/31) for s in (0,5,10))+(alpha,))
        image = Image.new('RGBA',(w,h)); image.putdata(pixels)
        images.append(image)
        offset += length
    return images


def pack(frames, **metadata):
    # Fixed transparent cells preserve the source sequence's common anchor.
    original = [list(im.size) for im in frames]
    frames = [im.copy() for im in frames]
    for im in frames:
        im.thumbnail((160,160),Image.Resampling.NEAREST)
        if not im.getbbox():
            raise ValueError('Empty effect frame')
    w,h = max(im.width for im in frames),max(im.height for im in frames)
    columns = min(8,len(frames))
    atlas = Image.new('RGBA',(w*columns,h*((len(frames)+columns-1)//columns)))
    for i,im in enumerate(frames):
        atlas.alpha_composite(im,((i%columns)*w+(w-im.width)//2,(i//columns)*h+(h-im.height)//2))
    stream = io.BytesIO(); atlas.save(stream,format='PNG',optimize=True)
    return dict(group='effect-atlas',width=atlas.width,height=atlas.height,
        rect=[0,0,atlas.width,atlas.height],frames=len(frames),columns=columns,
        frame_width=w,frame_height=h,fps=16,original_sizes=original,
        image='data:image/png;base64,'+base64.b64encode(stream.getvalue()).decode(),**metadata)


def extend(folder, raw):
    if hashlib.sha256(raw).hexdigest() != SHA256:
        raise ValueError('pokeblack source hash differs from pinned revision')
    path = ROOT/'silvers_hoard/presets/supplied_sprites.json'
    art = json.loads(path.read_text(encoding='utf-8'))
    sky = next(folder.glob('*Sky*.zip'))
    sid = next(k for k,s in art['sources'].items() if s['sha256'] == hashlib.sha256(sky.read_bytes()).hexdigest())
    with zipfile.ZipFile(sky) as archive:
        for name,code in SKY.items():
            members = sorted(n for n in archive.namelist() if n.startswith(f'move_VFX/{code}/000/') and n.endswith('.png'))
            if not members:
                raise ValueError(f'Missing Sky sequence {code}')
            # Bound atlas size while recording every sampled original member.
            indices = sorted({round(i*(len(members)-1)/min(23,len(members)-1)) for i in range(min(24,len(members)))}) if len(members)>1 else [0]
            selected = [members[i] for i in indices]
            frames = [Image.open(archive.open(n)).convert('RGBA') for n in selected]
            art['sprites']['fx-rt-'+name] = pack(frames,name=name.replace('-',' ').title(),name_es=name.replace('-',' '),source=sid,members=selected,archive_sequence=code,source_frames=len(members))
    art['sources']['pokeblack-bw'] = dict(file='files/a/0/0/6',url=URL,revision=REVISION,sha256=SHA256,
        credit='squiddonaut/pokeblack contributors (decompilation); original Pokémon Black game artists',
        copyright='Pokémon © Nintendo, Creatures, GAME FREAK')
    members = narc_members(raw)
    for name,(member,texture) in BW.items():
        frame = spa_textures(members[member])[texture]
        art['sprites']['fx-bw-'+name] = pack([frame],name='Black '+name,name_es='Negro: '+name,
            source='pokeblack-bw',narc_member=member,texture_index=texture,generation=5,members=[f'{member}/texture/{texture}'])
    path.write_text(json.dumps(art,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
    print(f"{len(art['sprites'])} sprites; added {len(SKY)} Sky sequences and {len(BW)} Black textures")


if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('folder',type=Path,help='Supplied attacks folder')
    parser.add_argument('--pokeblack',type=Path)
    args=parser.parse_args()
    raw=args.pokeblack.read_bytes() if args.pokeblack else urllib.request.urlopen(URL,timeout=60).read()
    extend(args.folder,raw)
