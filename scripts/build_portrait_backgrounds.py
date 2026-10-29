"""Build reusable native PMD emotion backgrounds from sampled published palettes."""
from collections import deque
from pathlib import Path
import argparse
import hashlib
import io
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


# Five corrected fields are independent of the historical palette/motif order.
FIELD_STOPS = {
    'Crying': [(0,(111,127,183)),(8,(111,127,183)),(24,(159,215,239)),(39,(159,215,239))],
    'Shouting': [(0,(135,199,255)),(39,(135,199,255))],
    'Determined': [(0,(231,143,183)),(9,(231,143,183)),(15,(247,111,143)),(39,(247,111,143))],
    'Inspired': [(0,(255,255,175)),(13,(255,255,175)),(23,(255,223,127)),(39,(255,223,127))],
    'Dizzy': [(0,(151,207,207)),(11,(151,207,207)),(15,(183,215,191)),(33,(183,215,191)),(39,(151,207,207))],
}
MOTIF_COLORS = {
    'Crying': {'stress': (111,127,183)},
    'Shouting': {'ray': (191,247,199), 'rim': (191,223,223)},
    'Determined': {'ray': (255,167,207)},
    'Inspired': {'star': (255,191,95)},
    'Dizzy': {'arc': (215,231,191)},
}
SHOUTING_RAYS = [
    [(3,0),(6,0),(15,13)], [(18,0),(21,0),(20,12)], [(29,0),(32,0),(25,13)],
    [(39,3),(39,5),(28,16)], [(39,12),(39,17),(29,20)],
    [(39,24),(39,27),(28,23)], [(39,34),(39,36),(27,27)],
    [(30,39),(33,39),(24,28)], [(16,39),(19,39),(19,29)],
    [(4,39),(7,39),(14,28)], [(0,29),(0,32),(12,25)],
    [(0,17),(0,20),(11,19)], [(0,4),(0,7),(12,14)],
]
# Positive exterior observations, not an alpha/colour-key segmentation mask.
REFERENCE_SAMPLES = {
    'Crying': [((39,0),'field',(111,127,183)),((39,39),'field',(159,215,239))],
    'Shouting': [((39,0),'field',(135,199,255)),((39,39),'field',(135,199,255)),
                 ((39,35),'ray',(191,247,199)),((39,2),'rim',(191,223,223))],
    'Determined': [((39,0),'field',(231,143,183)),((39,39),'field',(247,111,143)),
                   ((28,0),'ray',(255,167,207))],
    'Inspired': [((39,0),'field',(255,255,175)),((39,39),'field',(255,223,127))],
    'Dizzy': [((39,0),'field',(151,207,207)),((39,20),'field',(183,215,191)),
              ((39,39),'field',(151,207,207))],
}


def _field_pixel(stops, x, y, bayer):
    for (y0, c0), (y1, c1) in zip(stops, stops[1:]):
        if y0 <= y <= y1:
            return c1 if (y-y0)*16 > bayer[y%4][x%4]*(y1-y0) else c0
    raise ValueError(f'Incomplete native field stops at y={y}')


def _shouting_motif(image):
    mask = Image.new('L', (40,40))
    draw = ImageDraw.Draw(mask)
    for points in SHOUTING_RAYS:
        draw.polygon(points, fill=1)
    draw = ImageDraw.Draw(image)
    for y in range(40):
        for x in range(40):
            if mask.getpixel((x,y)):
                draw.point((x,y), fill=MOTIF_COLORS['Shouting']['ray'])
            elif any(0 <= u < 40 and 0 <= v < 40 and mask.getpixel((u,v))
                     for u,v in ((x-1,y),(x+1,y),(x,y-1),(x,y+1))):
                draw.point((x,y), fill=MOTIF_COLORS['Shouting']['rim'])


def _write_immutable(path, raw):
    if path.is_file():
        if path.read_bytes() != raw:
            raise ValueError(f'Refusing to overwrite historical background artifact: {path}')
    else:
        path.write_bytes(raw)


def _positive_reference_samples(published):
    result = {}
    for emotion, samples in REFERENCE_SAMPLES.items():
        path = published / '0001' / f'{emotion}.png'
        raw = path.read_bytes()
        with Image.open(path) as source:
            image = source.convert('RGBA')
        if image.size != (40,40):
            raise ValueError(f'Expected native Bulbasaur reference: {path}')
        rows = []
        for xy, role, rgb in samples:
            if image.getpixel(xy) != (*rgb,255):
                raise ValueError(f'Published exterior sample changed: {path} {xy}')
            rows.append({'file':path.relative_to(published).as_posix(),
                         'sha256':hashlib.sha256(raw).hexdigest(),
                         'xy':list(xy), 'role':role, 'RGB':list(rgb)})
        result[emotion] = rows
    return result


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
    # Validate all new positive donors before writing any output.
    samples = _positive_reference_samples(published)
    prior_path = destination / 'manifest.json'
    prior_raw = prior_path.read_bytes() if prior_path.is_file() else None
    prior = json.loads(prior_raw) if prior_raw else {}
    pending, checked_history = [prior], set()
    while pending:
        recorded = pending.pop()
        for meta in recorded.get('templates',{}).values():
            historical = destination / meta['file']
            if not historical.is_file() or hashlib.sha256(historical.read_bytes()).hexdigest() != meta['sha256']:
                raise ValueError(f'Existing background input changed: {historical}')
        for meta in recorded.get('previous_manifests',[]):
            historical = destination / meta['file']
            if not historical.is_file() or hashlib.sha256(historical.read_bytes()).hexdigest() != meta['sha256']:
                raise ValueError(f'Existing background history changed: {historical}')
            if meta['sha256'] not in checked_history:
                checked_history.add(meta['sha256'])
                pending.append(json.loads(historical.read_bytes()))
    destination.mkdir(parents=True, exist_ok=True)
    templates = {}
    for emotion, palette in PALETTES.items():
        refs = []
        for number in range(1,252):
            path = published / f'{number:04}' / f'{emotion}.png'
            if not path.is_file():
                continue
            refs.append({'file':path.relative_to(published).as_posix(), 'sha256':hashlib.sha256(path.read_bytes()).hexdigest()})
        image = Image.new('RGBA' if emotion in FIELD_STOPS else 'RGB',(40,40))
        # Author the complete background on the native grid, including pixels hidden
        # behind the reference subjects, so it can fit differently shaped portraits.
        # The eleven historical fields retain their exact RGB renderer.
        stops = FIELD_STOPS.get(emotion)
        if stops is None:
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
                color = (_field_pixel(stops,x,y,bayer) if emotion in FIELD_STOPS
                         else stops[lo+int(mix*16 > bayer[y%4][x%4])])
                image.putpixel((x,y),color)
        draw = ImageDraw.Draw(image)
        if emotion == 'Angry':
            for points in ([(30,0),(30,4),(26,4)],[(34,0),(34,4),(39,4)],[(26,8),(30,8),(30,12)],[(34,12),(34,8),(39,8)]):
                draw.line(points,fill='white',width=1)
        elif emotion in ('Joyous','Inspired'):
            color = palette[-1] if emotion == 'Joyous' else MOTIF_COLORS['Inspired']['star']
            for x,y in ((33,6),(5,13),(32,29)):
                draw.line((x-3,y,x+3,y),fill=color,width=1)
                draw.line((x,y-3,x,y+3),fill=color,width=1)
                draw.point((x-1,y-1),fill=color); draw.point((x+1,y+1),fill=color)
        elif emotion == 'Shouting':
            _shouting_motif(image)
        elif emotion == 'Surprised':
            for points in ([(0,0),(8,14),(4,0)],[(15,0),(18,12),(20,0)],[(39,0),(28,13),(35,0)],[(39,16),(29,19),(39,21)]):
                draw.polygon(points,fill=(223,231,239))
        elif emotion == 'Dizzy':
            draw.arc((24,1,39,16),10,315,fill=MOTIF_COLORS['Dizzy']['arc'],width=1)
            draw.arc((28,5,35,12),0,300,fill=MOTIF_COLORS['Dizzy']['arc'],width=1)
        elif emotion == 'Stunned':
            for x in (3,9,16,26,34,38):
                draw.line((x,0,x,10+(x%5)),fill=(111,127,167),width=1)
        elif emotion in ('Sad','Worried','Crying'):
            for x in (2,8,29,36):
                draw.line((x,0,x,6+x%4),fill=MOTIF_COLORS['Crying']['stress'] if emotion == 'Crying' else palette[0],width=1)
        elif emotion == 'Determined':
            for x in range(-30,40,8):
                draw.line((x,0,x+30,30),fill=MOTIF_COLORS['Determined']['ray'],width=1)
        buffer = io.BytesIO()
        image.save(buffer, format='PNG')
        raw = buffer.getvalue()
        sha = hashlib.sha256(raw).hexdigest()
        # Emotion.png remains the immutable historical input for these five.
        name = f'{emotion}-v2-{sha[:12]}.png' if emotion in FIELD_STOPS else f'{emotion}.png'
        path = destination / name
        _write_immutable(path, raw)
        entry = {'file':name,'sha256':sha,'references':refs}
        if emotion in FIELD_STOPS:
            entry.update({'field_stops':[{'y':y,'RGB':list(rgb)} for y,rgb in FIELD_STOPS[emotion]],
                          'motif_colors':{name:list(rgb) for name,rgb in MOTIF_COLORS[emotion].items()},
                          'positive_reference_samples':samples[emotion],
                          'authorship':{'author':'codex-silver-peer84',
                              'published_reference_credit':'CHUNSOFT / SpriteCollab',
                              'geometry':'13 authored shout polygons with a 4-neighbour gray rim' if emotion == 'Shouting' else 'Retained native Silver stress/diagonal/star/arc geometry',
                              'motif_pigments':'Inspired star and Dizzy arc retain authored template pigments; not claimed as sampled published field',
                              'prototype_manifest_sha256':'5ca834ce583afededaf48a0d9f044026feb226f5533f3160931fea0d9cb96f8e',
                              'pixel_exact_reference_extraction':False, 'new_licence_inferred':False}})
        else:
            previous = prior.get('templates',{}).get(emotion,{})
            if (prior.get('source') == source and previous.get('file') == entry['file']
                    and previous.get('sha256') == entry['sha256'] and previous.get('references') == refs):
                entry = previous  # Preserve the complete eleven keeper metadata objects.
        templates[emotion] = entry
    manifest = {'version':2,'source':source,'method':'Native 40px dither gradients using sampled PMD palettes; authored pixel motifs for anger, joy, inspiration, shout, surprise, dizziness and stress. Published references establish colours; no Pokemon foreground copied.',
                'credit':'SpriteCollab contributors / Chunsoft, CC BY-NC 4.0',
                'credit_scope':'Historical published-reference credit retained; no new licence inferred for authored geometry.',
                'templates':templates}
    history = list(prior.get('previous_manifests',[]))
    prior_content = {key:value for key,value in prior.items() if key != 'previous_manifests'}
    if prior_raw and prior_content != manifest:
        previous_sha = hashlib.sha256(prior_raw).hexdigest()
        previous_name = f'manifest-history-{previous_sha[:12]}.json'
        _write_immutable(destination / previous_name, prior_raw)  # Metadata only, not a code backup.
        if not any(item['sha256'] == previous_sha for item in history):
            history.append({'file':previous_name,'sha256':previous_sha})
    manifest['previous_manifests'] = history
    (destination/'manifest.json').write_text(json.dumps(manifest,indent=2),encoding='utf8')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--published',type=Path,required=True)
    parser.add_argument('--out',type=Path,required=True)
    parser.add_argument('--source',required=True)
    args = parser.parse_args()
    build(args.published,args.out,args.source)
