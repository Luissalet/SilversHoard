import base64
import hashlib
import io
import json
import os
import sys
from pathlib import Path

import pytest
from PIL import Image

from silvers_hoard.leisure import SPRITES, SUPPLIED_ART

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
from build_rock_sprites import FILE, PREFIX, SEQUENCES, SOURCE, extend  # noqa: E402

MOTIFS = {k: v for k, v in SPRITES.items() if k.startswith(PREFIX)}


def test_selected_rock_frames_have_visible_alpha_and_no_separator_or_label_pixels():
    assert len(MOTIFS) == 4 and sum(s['frames'] for s in MOTIFS.values()) == 29
    for sprite in MOTIFS.values():
        assert sprite['source'] == SOURCE and sprite['frame_width'] == sprite['frame_height'] <= 160
        assert sprite['display_scale'] in (1.7, 2.4)
        assert len(sprite['frame_rects']) == len(sprite['frame_offsets']) == sprite['frames']
        atlas = Image.open(io.BytesIO(base64.b64decode(sprite['image'].split(',')[1])))
        for i in range(sprite['frames']):
            w = sprite['frame_width'];x, y = i % sprite['columns'] * w, i // sprite['columns'] * w
            frame = atlas.crop((x, y, x + w, y + w));assert frame.getbbox()
            assert 0 in frame.getchannel('A').getextrema()
            assert not any(a and ((r, g, b) in [(0, 128, 128), (255, 0, 0), (0, 0, 0)]) for r, g, b, a in frame.getdata())
        assert 0 <= sprite['still_frame'] < sprite['frames']
    assert 'redblueyellow' in SUPPLIED_ART['sources'][SOURCE]['credit']


def test_native_catalog_exposes_rock_metadata_and_actual_embedded_pngs(call, client):
    catalog = call('leisure_catalog', {'section': 'sprites', 'query': PREFIX, 'limit': 0})
    assert len(catalog['sprites']) == 4
    for entry in catalog['sprites']:
        sprite = MOTIFS[entry['id']]
        for key in ['frame_rects', 'frame_offsets', 'background_key', 'source_band', 'still_frame', 'display_scale']:
            assert entry[key] == sprite[key]
        assert client.get(entry['url']).content == base64.b64decode(sprite['image'].split(',')[1])
    p = call('leisure_catalog', {'section': 'effects', 'query': 'rocktomb', 'limit': 0})
    assert p['effects'][0]['area'] == PREFIX + 'rock-tomb'


def test_original_sheet_pixels_and_hash_regenerate_idempotently(tmp_path):
    folder = Path(os.environ.get('SILVER_SPRITE_SOURCES', ''))
    if not (folder / FILE).is_file():
        pytest.skip('Set SILVER_SPRITE_SOURCES to inspect original supplied Rock pixels')
    source = SUPPLIED_ART['sources'][SOURCE]
    assert hashlib.sha256((folder / FILE).read_bytes()).hexdigest() == source['sha256']
    sheet = Image.open(folder / FILE).convert('RGBA')
    for sprite in MOTIFS.values():
        atlas = Image.open(io.BytesIO(base64.b64decode(sprite['image'].split(',')[1])))
        side = sprite['frame_width']
        for i, (rect, offset) in enumerate(zip(sprite['frame_rects'], sprite['frame_offsets'], strict=True)):
            tile = sheet.crop(rect);key = tuple(sprite['background_key'])
            tile.putdata([(r, g, b, 0 if (r, g, b) == key else a) for r, g, b, a in tile.getdata()])
            expected = Image.new('RGBA', (side, side));expected.alpha_composite(tile, offset)
            x, y = i % sprite['columns'] * side, i // sprite['columns'] * side
            assert atlas.crop((x, y, x + side, y + side)).tobytes() == expected.tobytes()
    manifest = tmp_path / 'manifest.json';manifest.write_bytes(json.dumps(SUPPLIED_ART, ensure_ascii=False, separators=(',', ':')).encode('utf8'))
    before = manifest.read_bytes();extend(folder, manifest);assert manifest.read_bytes() == before
    changed = json.loads(before)
    next(x for x in changed['inventory'] if x['file'] == FILE)['sha256'] = 'bad'
    manifest.write_bytes(json.dumps(changed).encode('utf8'))
    with pytest.raises(ValueError, match='source differs'):
        extend(folder, manifest)
