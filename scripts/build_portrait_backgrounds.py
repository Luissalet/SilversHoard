"""Build reusable native PMD emotion backgrounds from sampled published palettes."""
from collections import deque
from pathlib import Path
import argparse
import hashlib
import json
from PIL import Image, ImageDraw

# Background palette sampled from the pinned Chunsoft Bulbasaur expression set.
# Foregrounds are never copied into the reusable templates.
PALETTES = {
    'Normal': [(119,199,215),(175,223,175),(215,255,191)],
    'Happy': [(255,255,175),(255,231,119)],
    'Pain': [(119,135,183),(135,175,191),(143,207,191)],
    'Angry': [(223,127,175),(247,103,135),(167,95,127),(255,255,255)],
    'Worried': [(119,151,191),(135,175,199),(159,215,239)],
    'Sad': [(119,151,191),(135,175,199),(159,215,239)],
    'Crying': [(111,127,183),(159,215,239),(255,255,255)],
    'Shouting': [(135,199,255),(191,223,223),(191,247,199)],
    'Teary-Eyed': [(247,191,199),(239,175,191),(231,119,167),(255,255,255)],
    'Determined': [(231,143,183),(247,111,143),(255,255,255)],
    'Joyous': [(255,255,199),(255,231,119),(255,191,151),(255,143,135)],
    'Inspired': [(255,255,175),(255,223,127),(255,255,255)],
    'Surprised': [(111,143,183),(135,175,207),(167,207,223),(223,231,239)],
    'Dizzy': [(151,207,207),(183,215,191),(215,231,191)],
    'Sigh': [(254,241,164),(254,230,121),(255,207,79)],
    'Stunned': [(120,135,177),(139,157,198),(163,199,219)],
}


def edge_region(image, accepts, seed_bottom=True, seed_sides=True):
    """Flood the actual backdrop; an outlined tooth/cream cheek is not backdrop."""
    pixels = image.load()
    w, h = image.size
    borders = (0,h-1) if seed_bottom else (0,)
    sides = [(x,y) for x in (0,w-1) for y in range(h)] if seed_sides else []
    queue = deque([(x,y) for x in range(w) for y in borders] + sides)
    visited, region = set(), set()
    while queue:
        x,y = queue.popleft()
        if (x,y) in visited or not (0 <= x < w and 0 <= y < h):
            continue
        visited.add((x,y))
        if not accepts(pixels[x,y]):
            continue
        region.add((x,y))
        queue.extend(((x-1,y),(x+1,y),(x,y-1),(x,y+1)))
    return region


def build(published, destination, source):
    destination.mkdir(parents=True, exist_ok=True)
    templates = {}
    for emotion, palette in PALETTES.items():
        refs = []
        for number in range(1,252):
            path = published / f'{number:04}' / f'{emotion}.png'
            if not path.is_file():
                continue
            refs.append({'file':path.relative_to(published).as_posix(), 'sha256':hashlib.sha256(path.read_bytes()).hexdigest()})
        image = Image.new('RGB',(40,40))
        # Author the complete background on the native grid, including pixels hidden
        # behind the reference subjects, so it can fit differently shaped portraits.
        stops = palette[:3] if emotion not in ('Angry','Joyous','Surprised') else {
            'Angry':[(247,103,135),(223,127,175)],
            'Joyous':[(255,255,199),(255,231,119)],
            'Surprised':[(135,175,207),(167,207,223)],
        }[emotion]
        bayer = ((0,8,2,10),(12,4,14,6),(3,11,1,9),(15,7,13,5))
        for y in range(40):
            p = y / 39 * (len(stops)-1)
            lo = min(len(stops)-2,int(p))
            mix = p-lo
            for x in range(40):
                image.putpixel((x,y),stops[lo+int(mix*16 > bayer[y%4][x%4])])
        draw = ImageDraw.Draw(image)
        if emotion == 'Angry':
            for points in ([(30,0),(30,4),(26,4)],[(34,0),(34,4),(39,4)],[(26,8),(30,8),(30,12)],[(34,12),(34,8),(39,8)]):
                draw.line(points,fill='white',width=1)
        elif emotion in ('Joyous','Inspired'):
            color = palette[-1] if emotion == 'Joyous' else (255,191,95)
            for x,y in ((33,6),(5,13),(32,29)):
                draw.line((x-3,y,x+3,y),fill=color,width=1)
                draw.line((x,y-3,x,y+3),fill=color,width=1)
                draw.point((x-1,y-1),fill=color); draw.point((x+1,y+1),fill=color)
        elif emotion == 'Shouting':
            for a,b in (((0,0),(12,13)),((16,0),(18,12)),((39,0),(27,13)),((39,18),(29,19)),((39,39),(27,27)),((0,39),(12,27)),((0,19),(11,20))):
                draw.line((a,b),fill=(191,247,199),width=2)
        elif emotion == 'Surprised':
            for points in ([(0,0),(8,14),(4,0)],[(15,0),(18,12),(20,0)],[(39,0),(28,13),(35,0)],[(39,16),(29,19),(39,21)]):
                draw.polygon(points,fill=(223,231,239))
        elif emotion == 'Dizzy':
            draw.arc((24,1,39,16),10,315,fill=(215,231,191),width=1)
            draw.arc((28,5,35,12),0,300,fill=(215,231,191),width=1)
        elif emotion == 'Stunned':
            for x in (3,9,16,26,34,38):
                draw.line((x,0,x,10+(x%5)),fill=(111,127,167),width=1)
        elif emotion in ('Sad','Worried','Crying'):
            for x in (2,8,29,36):
                draw.line((x,0,x,6+x%4),fill=palette[0],width=1)
        elif emotion == 'Determined':
            for x in range(-30,40,8):
                draw.line((x,0,x+30,30),fill=(255,191,207),width=1)
        path = destination / f'{emotion}.png'
        image.save(path)
        templates[emotion] = {'file':path.name,'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'references':refs}
    manifest = {'version':1,'source':source,'method':'Native 40px dither gradients using sampled PMD palettes; authored pixel motifs for anger, joy, inspiration, shout, surprise, dizziness and stress. Published references establish colours; no Pokemon foreground copied.',
                'credit':'SpriteCollab contributors / Chunsoft, CC BY-NC 4.0','templates':templates}
    (destination/'manifest.json').write_text(json.dumps(manifest,indent=2),encoding='utf8')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--published',type=Path,required=True)
    parser.add_argument('--out',type=Path,required=True)
    parser.add_argument('--source',required=True)
    args = parser.parse_args()
    build(args.published,args.out,args.source)
