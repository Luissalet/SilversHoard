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

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from build_dark_sprites import FILE,PREFIX,SOURCE,extend

MOTIFS={k:v for k,v in SPRITES.items() if k.startswith(PREFIX)}

def test_dark_frames_keep_transparency_geometry_and_visible_reduced_frames():
    assert len(MOTIFS)==5 and sum(s['frames'] for s in MOTIFS.values())==30
    for s in MOTIFS.values():
        assert s['source']==SOURCE and s['frame_width']==s['frame_height']<=160
        assert len(s['frame_rects'])==len(s['frame_offsets'])==s['frames']
        atlas=Image.open(io.BytesIO(base64.b64decode(s['image'].split(',')[1])));side=s['frame_width'];counts=[]
        for i in range(s['frames']):
            x,y=i%s['columns']*side,i//s['columns']*side;frame=atlas.crop((x,y,x+side,y+side))
            assert frame.getbbox() and frame.getchannel('A').getextrema()==(0,255)
            assert not any(a and (r,g,b)==tuple(s['background_key']) for r,g,b,a in frame.getdata())
            counts.append(sum(bool(a) for a in frame.getchannel('A').getdata()))
        assert counts[s['still_frame']]==max(counts)
    assert 'redblueyellow' in SUPPLIED_ART['sources'][SOURCE]['credit']

def test_dark_catalog_has_the_actual_embedded_bytes_and_existing_profile_phases(call,client):
    found=call('leisure_catalog',{'section':'sprites','query':PREFIX,'limit':0})['sprites']
    assert len(found)==5
    for e in found:
        source=MOTIFS[e['id']]
        assert e['display_scale']==source['display_scale'] and e['frame_rects']==source['frame_rects']
        assert client.get(e['url']).content==base64.b64decode(source['image'].split(',')[1])
    assert call('leisure_catalog',{'section':'effects','query':'torment','limit':0})['effects'][0]['area']==PREFIX+'torment'

def test_dark_pixels_and_idempotent_builder_match_the_local_original(tmp_path):
    folder=Path(os.environ.get('SILVER_SPRITE_SOURCES',''))
    if not (folder/FILE).is_file():pytest.skip('Set SILVER_SPRITE_SOURCES for original Dark pixels')
    assert hashlib.sha256((folder/FILE).read_bytes()).hexdigest()==SUPPLIED_ART['sources'][SOURCE]['sha256']
    sheet=Image.open(folder/FILE).convert('RGBA')
    for s in MOTIFS.values():
        atlas=Image.open(io.BytesIO(base64.b64decode(s['image'].split(',')[1])));side=s['frame_width']
        for i,(rect,offset) in enumerate(zip(s['frame_rects'],s['frame_offsets'],strict=True)):
            tile=sheet.crop(rect);tile.putdata([(r,g,b,0 if (r,g,b)==tuple(s['background_key']) else a)for r,g,b,a in tile.getdata()])
            expected=Image.new('RGBA',(side,side));expected.alpha_composite(tile,offset)
            x,y=i%s['columns']*side,i//s['columns']*side
            assert atlas.crop((x,y,x+side,y+side)).tobytes()==expected.tobytes()
    path=tmp_path/'sprites.json';path.write_bytes(json.dumps(SUPPLIED_ART,ensure_ascii=False,separators=(',',':')).encode('utf8'))
    before=path.read_bytes();extend(folder,path);assert path.read_bytes()==before
    wrong=json.loads(before);next(v for v in wrong['inventory'] if v['file']==FILE)['sha256']='wrong';path.write_bytes(json.dumps(wrong).encode('utf8'))
    with pytest.raises(ValueError,match='source differs'):extend(folder,path)
