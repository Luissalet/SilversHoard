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

PREFIX = 'fx-pmd-td-'
MOTIFS = {key: value for key, value in SPRITES.items() if key.startswith(PREFIX)}
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
from build_dragon_poison_sprites import SEQUENCES, extend  # noqa: E402


def test_all_selected_frames_preserve_alpha_and_square_source_geometry():
    assert len(MOTIFS) == len(SEQUENCES) == 11
    assert sum(sprite['frames'] for sprite in MOTIFS.values()) == 117
    for key, sprite in MOTIFS.items():
        assert sprite['group'] == 'effect-atlas'
        assert sprite['frame_width'] == sprite['frame_height'] <= 160
        assert 0 <= sprite['still_frame'] < sprite['frames']
        assert len(sprite['frame_rects']) == len(sprite['frame_offsets']) == sprite['source_frames'] == sprite['frames']
        atlas = Image.open(io.BytesIO(base64.b64decode(sprite['image'].split(',')[1])))
        for index in range(sprite['frames']):
            side = sprite['frame_width']
            x, y = index % sprite['columns'] * side, index // sprite['columns'] * side
            frame = atlas.crop((x, y, x + side, y + side))
            assert frame.getbbox(), (key, index)
            assert 0 in frame.getchannel('A').getextrema()
            assert not any(rgb[:3] == tuple(sprite['background_key']) and rgb[3] for rgb in frame.getdata())
        assert 'redblueyellow' in SUPPLIED_ART['sources'][sprite['source']]['credit']


def test_native_catalog_exposes_real_frames_offsets_and_source_routes(call, client):
    catalog = call('leisure_catalog', {'section': 'sprites', 'query': PREFIX, 'limit': 0})
    assert len(catalog['sprites']) == 11
    for entry in catalog['sprites']:
        sprite = MOTIFS[entry['id']]
        assert entry['frame_rects'] == sprite['frame_rects']
        assert entry['frame_offsets'] == sprite['frame_offsets']
        assert entry['background_key'] == [0, 128, 128]
        assert entry['source_band'] == sprite['source_band']
        assert entry['still_frame'] == sprite['still_frame']
        assert client.get(entry['url']).content == base64.b64decode(sprite['image'].split(',')[1])
    profiles = call('leisure_catalog', {'section': 'effects', 'query': 'dragondance', 'limit': 0})
    assert profiles['effects'][0]['area'] == PREFIX + 'dragon-dance'


def test_local_sources_reproduce_every_atlas_pixel_and_rebuild_idempotently(tmp_path):
    folder = Path(os.environ.get('SILVER_SPRITE_SOURCES', ''))
    if not list(folder.glob('*Darkness*Dragon Attack Effects.png')):
        pytest.skip('Set SILVER_SPRITE_SOURCES to the original supplied sheets for pixel-level regeneration')
    for sprite in MOTIFS.values():
        source = SUPPLIED_ART['sources'][sprite['source']]
        path = folder / source['file']
        assert hashlib.sha256(path.read_bytes()).hexdigest() == source['sha256']
        sheet = Image.open(path).convert('RGBA')
        atlas = Image.open(io.BytesIO(base64.b64decode(sprite['image'].split(',')[1])))
        side = sprite['frame_width']
        for i, (rect, offset) in enumerate(zip(sprite['frame_rects'], sprite['frame_offsets'], strict=True)):
            tile = sheet.crop(rect)
            key = tuple(sprite['background_key'])
            tile.putdata([(r, g, b, 0 if (r, g, b) == key else a) for r, g, b, a in tile.getdata()])
            expected = Image.new('RGBA', (side, side))
            expected.alpha_composite(tile, offset)
            x, y = i % sprite['columns'] * side, i // sprite['columns'] * side
            assert atlas.crop((x, y, x + side, y + side)).tobytes() == expected.tobytes()
    manifest = tmp_path / 'manifest.json'
    manifest.write_text(json.dumps(SUPPLIED_ART, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    before = manifest.read_bytes()
    extend(folder, manifest)
    assert manifest.read_bytes() == before
    changed = json.loads(before)
    changed['inventory'][0]['sha256'] = 'bad'
    source_file = SUPPLIED_ART['sources']['pmd-td-dragon']['file']
    for entry in changed['inventory']:
        if entry['file'] == source_file:
            entry['sha256'] = 'bad'
    manifest.write_text(json.dumps(changed), encoding='utf-8')
    with pytest.raises(ValueError, match='source differs'):
        extend(folder, manifest)
