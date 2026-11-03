import base64
import hashlib
import io
import json
import re
from pathlib import Path

import pytest
from PIL import Image, ImageDraw

from silvers_hoard import portable_assets, sharing
from silvers_hoard.pmd_library import PmdLibrary
from scripts.build_pmd_library import compile_library, crowd_sheet, generated_sheet, indexed_overworld_sheet, inventory, native_animation_sheets, previews, supplied_sheet


def library_fixture(root):
    root.mkdir()
    raw = io.BytesIO()
    Image.new("RGBA", (2, 2), (80, 120, 160, 255)).save(raw, "PNG")
    png = raw.getvalue()
    pack = b"prefix" + png + b"suffix"
    (root / "sprites-000.pmd").write_bytes(pack)
    asset = {"pmd": 0, "offset": 6, "size": len(png), "mime": "image/png", "sha256": hashlib.sha256(png).hexdigest()}
    geom = {"file": "fixture", "w": 2, "h": 2, "n": 1, "r": 1, "d": [30], "ax": 1, "ay": 2}
    crowd = {"key": "lib-crowd", "a": {"Idle": geom}}
    meta = {"key": "lib-mega", "a": {"Idle": geom}, "credit": ["Fixture artist"], "crowd": crowd,
            "previews":{"PreviewFront":"fixture","PreviewBack":"fixture"}}
    manifest = {"version": 1, "source": {"sha": "fixture"}, "coverage": {"normal": 1},
                "roster": [{"id": "charizardmegay", "num": 6, "form": "Mega-Y"}],
                "entries": {"6|megay|0": meta["key"]}, "metas": {meta["key"]: meta},
                "files": {"fixture": asset}, "packs": ["sprites-000.pmd"]}
    (root / "manifest.json").write_text(json.dumps(manifest), encoding="utf8")
    return PmdLibrary(root), png, pack


def test_library_resolves_exact_forms_and_extracts_the_indexed_png(tmp_path):
    library, png, _ = library_fixture(tmp_path / "library")
    meta = library.resolve(6, "Mega-Y")
    assert meta["form_exact"] and meta["credit"] == ["Fixture artist"]
    assert library.by_species("Charizard-Mega-Y") == meta
    assert library.resolve(6, "Mega-X") is None
    assert library.resolve(6, "Mega-Y", True) is None
    assert library.image_bytes("fixture") == png
    cache = tmp_path / "cache"
    for key in ["lib-mega", "lib-crowd"]:
        assert library.sheet(key, "Idle", cache).read_bytes() == png
    assert library.sheet("lib-mega","PreviewFront",cache).read_bytes() == png
    assert library.sheet("lib-mega", "Attack", cache) is None


def test_library_detects_damaged_pack_before_serving_it(tmp_path):
    library, _, _ = library_fixture(tmp_path / "library")
    (library.root / "sprites-000.pmd").write_bytes(b"damaged")
    with pytest.raises(ValueError, match="Damaged PMD"):
        library.image_bytes("fixture")


def test_compact_walk_uses_opposed_steps_when_first_and_middle_are_identical():
    image = Image.new("RGBA", (32 * 4, 32))
    draw = ImageDraw.Draw(image)
    for frame in range(4):
        x = 32 * frame
        draw.rectangle((x + 8, 6, x + 23, 20), fill=(100, 150, 200, 255))
        draw.rectangle((x + 9, 21, x + 13, 27 if frame != 3 else 23), fill=(80, 100, 140, 255))
        draw.rectangle((x + 18, 21, x + 22, 27 if frame != 1 else 23), fill=(120, 140, 180, 255))
    raw = io.BytesIO()
    image.save(raw, "PNG")
    geom = {"w": 32, "h": 32, "n": 4, "r": 1, "d": [6, 8, 6, 8], "ax": 16, "ay": 28}
    meta, images = crowd_sheet({"a": {"Walk": geom}}, {"Walk": raw.getvalue()}, "native")
    compact = Image.open(io.BytesIO(images["Walk"])).convert("RGBA")
    assert meta["a"]["Walk"]["d"] == [14, 14]
    for slot, original in enumerate((1, 3)):
        expected = Image.new("RGBA", (32, 32))
        expected.alpha_composite(image.crop((original*32, 0, (original+1)*32, 32)).resize((30, 30), Image.Resampling.NEAREST), (1, 1))
        assert compact.crop((slot*32, 0, (slot+1)*32, 32)).tobytes() == expected.tobytes()
    assert compact.crop((0, 0, 32, 32)).tobytes() != compact.crop((32, 0, 64, 32)).tobytes()


def test_native_composition_preserves_eight_directions_clocks_and_both_palettes(tmp_path):
    art = tmp_path / "art"
    record = {"id": "falinks", "reviewed": True, "layout": "native-pmd-animation-sheets",
              "variants": {"normal": "normal", "shiny": "shiny"},
              "credit": ["Component artist"], "licence": "CC BY-NC 4.0"}
    originals = {}
    for variant, color in [("normal", (230, 180, 30, 255)), ("shiny", (120, 70, 35, 255))]:
        folder = art / variant
        folder.mkdir(parents=True)
        anims = {}
        for action, count, durations in [("Idle", 1, [40]), ("Walk", 4, [6, 8, 6, 8])]:
            path = folder / (action + ".png")
            Image.new("RGBA", (8 * count, 64), color).save(path)
            originals[variant, action] = path.read_bytes()
            anims[action] = {"file": path.name, "w": 8, "h": 8, "n": count, "r": 8,
                             "d": durations, "ax": 4, "ay": 6}
        meta = {"key": "source", "s": 1, "a": anims,
                "source": {"kind": "published-pmd-composition", "members": {"brass": 1, "troopers": 5}}}
        (folder / "meta.json").write_text(json.dumps(meta), encoding="utf8")
    (art / "registry.json").write_text(json.dumps({"falinks": record}), encoding="utf8")
    plan = {"source": {"sha": "fixture"}, "credits": {}, "entries": [
        {"id": "falinks", "name": "Falinks", "num": 870, "form": "", "folder": None, "shiny_folder": None}]}
    compile_library(plan, tmp_path / "stage", art, tmp_path / "installed")
    library = PmdLibrary(tmp_path / "installed")
    for shiny, variant in [(False, "normal"), (True, "shiny")]:
        meta, images = native_animation_sheets(record, art, shiny)
        assert images == {action: originals[variant, action] for action in ("Idle", "Walk")}
        packed = library.resolve(870, "", shiny)
        assert packed["source"]["variant"] == variant
        assert packed["source"]["members"] == {"brass": 1, "troopers": 5}
        assert packed["a"]["Walk"]["r"] == 8 and packed["a"]["Walk"]["n"] == 4
        assert packed["a"]["Walk"]["d"] == [6, 8, 6, 8]
        assert Image.open(io.BytesIO(library.image_bytes(packed["a"]["Walk"]["file"]))).convert("RGBA").tobytes() == Image.open(io.BytesIO(images["Walk"])).convert("RGBA").tobytes()
    Image.new("RGBA", (1, 1)).save(art / "normal/Walk.png")
    with pytest.raises(ValueError, match="geometry"):
        native_animation_sheets(record, art)


def test_uncached_library_is_portable_without_network_or_cache_changes(services, tmp_path):
    library, png, pack = library_fixture(tmp_path / "library")
    services.pmd.library = library
    def deny(*args, **kwargs):
        raise AssertionError("Installed PMD art must not fetch")
    services.pmd._http_get = deny
    before = list(services.pmd.cache_dir.rglob("*"))
    assert services.pmd.meta(6, form="Mega-Y")["key"] == "lib-mega"
    bundle = portable_assets.bundle(services)
    assert before == list(services.pmd.cache_dir.rglob("*"))
    assert base64.b64decode(bundle["pmd_chunks"][0]) == pack
    assert bundle["urls"]["/api/sprites/pmd-sheet/lib-crowd/Idle.png"] == "fixture"
    assert bundle["pmd"]["entries"]["6|megay|0"] == "lib-mega"
    assert library.image_bytes("fixture") == png


def test_page_keeps_binary_chunks_outside_json_and_preserves_input(tmp_path):
    library, _, pack = library_fixture(tmp_path / "library")
    assets = library.portable()
    notice = '<!-- ALL-CONTRIBUTORS-LIST:START -->\nCredit </script> and <table> preserved.'
    bundle = {"files": assets["files"], "pmd_chunks": assets["chunks"], "notices": [notice]}
    original = json.dumps(bundle, sort_keys=True)
    template = tmp_path / "play.html"
    template.write_text(sharing.DATA_TAG + sharing.PLACEHOLDER + "</script>", encoding="utf8")
    html = sharing.playable_page(template, {"portable_assets": bundle})
    assert base64.b64decode(re.search(r'data-silver-pmd="0">(.*?)</script>', html).group(1)) == pack
    data = json.loads(html.split(sharing.DATA_TAG, 1)[1].split("</script>", 1)[0])
    assert "pmd_chunks" not in data["portable_assets"]
    assert data["portable_assets"]["notices"] == [notice]
    assert json.dumps(bundle, sort_keys=True) == original


def test_native_sprite_route_uses_installed_art_and_credits_without_http(services, client, call, tmp_path):
    library, png, _ = library_fixture(tmp_path / "library")
    services.pmd.library = library
    def deny(*args, **kwargs):
        raise AssertionError("No cache or credit download for installed art")
    services.pmd._http_get = services.credits._http_get = deny
    meta = client.get("/api/sprites/pmd/6?form=Mega-Y").json()
    assert meta["credit"] == ["Fixture artist"]
    assert client.get("/api/sprites/pmd-sheet/lib-mega/Idle.png").content == png
    assert client.get("/api/sprites/pmd-sheet/lib-mega/PreviewFront.png").content == png
    assert call("pmd_library_status")["requests"] == 1


@pytest.mark.parametrize("kind", ["published-pmd", "published-pmd-composition"])
def test_derived_published_credits_keep_licence_and_string_source_contract(services, tmp_path, kind):
    library, _, _ = library_fixture(tmp_path / "library")
    meta = library.manifest["metas"]["lib-mega"]
    meta.update(licence="CC BY-NC 4.0",source={"kind":"exterior-equivalence","parent":{"kind":kind,"folder":"0006"}})
    services.pmd.library = library
    result = services.credits_get(species="Charizard-Mega-Y")
    assert result["source"] == "PMDCollab SpriteCollab"
    assert result["licence"] == "CC BY-NC 4.0"
    assert result["artists"] == ["Fixture artist"]
    assert result["provenance"]["parent"]["folder"] == "0006"


def test_four_static_views_cannot_replace_a_generated_animated_pmd_source(tmp_path):
    im = Image.new("RGBA", (256,256))
    draw = ImageDraw.Draw(im)
    for row in range(2):
        for col in range(2):
            draw.rectangle((25+col*128,25+row*128,65+col*128,90+row*128),fill=(40+col*80,40+row*80,50,255))
    im.save(tmp_path / "four.png")
    with pytest.raises(ValueError,match="sixteen authored poses"):
        generated_sheet({"id":"fixture","file":"four.png","tool":"fixture","layout":"four-views"},tmp_path)


@pytest.mark.parametrize("derived", [False,True])
def test_supplied_credits_never_claim_silver_generated_authorship(services,tmp_path,derived):
    library,_,_=library_fixture(tmp_path/"library")
    meta=library.manifest["metas"]["lib-mega"]
    original={"kind":"supplied-overworld","archive":{"sha256":"original-archive"}}
    meta.update(credit=["Original supplied artist unknown"],licence="No licence included; no relicensing claimed",
                source={"kind":"shiny-recolor","parent":original} if derived else original)
    services.pmd.library=library
    result=services.credits_get(species="Charizard-Mega-Y")
    assert result["source"] == "User-supplied pixel art"
    assert result["artists"] == meta["credit"] and result["licence"] == meta["licence"]
    assert result["provenance"] == meta["source"]


def test_generated_import_finds_real_gutters_and_preserves_all_sixteen_figures(tmp_path):
    # Feet deliberately cross the mathematical quarter boundaries (as the real generated sheets do).
    im = Image.new("RGBA", (256, 256))
    draw = ImageDraw.Draw(im)
    for row, y in enumerate([20, 80, 145, 200]):
        for col, x in enumerate([12, 78, 142, 207]):
            draw.rectangle((x, y, x+22, y+50), fill=(40+col*50, 40+row*50, 50, 255))
    im.save(tmp_path / "grid.png")
    record = {"id": "fixture", "file": "grid.png", "tool": "fixture"}
    meta, sheets = generated_sheet(record, tmp_path)
    assert meta["source"]["directions"] == 4 and meta["source"]["poses"] == 16
    assert set(sheets) == {"Idle", "Walk", "Attack"}
    template={"repo":"PMDCollab/SpriteCollab","folder":"0160","artists":["Template artist"]}
    adapted,_=generated_sheet({**record,"credit":["Template artist","Silver — generated adaptation"],
                              "licence":"Template attribution retained", "reference_template":template},tmp_path)
    assert adapted["credit"] == ["Template artist","Silver — generated adaptation"]
    assert adapted["licence"] == "Template attribution retained"
    assert adapted["source"]["reference_template"] == template
    thumbs=previews({**meta,"key":"fixture"},sheets)
    assert list(thumbs) == ["PreviewFront","PreviewBack"]
    for raw in thumbs.values():
        image=Image.open(io.BytesIO(raw))
        assert image.size == (64,64) and image.getchannel("A").getbbox()[3] == 56
    for name, raw in sheets.items():
        sheet = Image.open(io.BytesIO(raw)).convert("RGBA")
        geom = meta["a"][name]
        for row in range(4):
            for frame in range(geom["n"]):
                tile = sheet.crop((frame*64,row*64,(frame+1)*64,(row+1)*64))
                bbox = tile.getchannel("A").getbbox()
                assert bbox and 0 < bbox[0] < bbox[2] < 64 and bbox[3] == 52
                assert bbox[3]-bbox[1] == 42
    corrected, used = generated_sheet({**record,"column_order":[0,3,2,1],"walk_rows":[1]},tmp_path)
    assert corrected["a"]["Walk"]["n"] == 1
    assert corrected["source"]["poses"] == 12
    idle=Image.open(io.BytesIO(used["Idle"])).convert("RGBA")
    colours=[]
    for direction in range(4):
        pixels=idle.crop((0,direction*64,64,(direction+1)*64)).getdata()
        colours.append(next(p[:3] for p in pixels if p[3]))
    assert colours == [(40,40,50),(190,40,50),(140,40,50),(90,40,50)]


def test_separately_authored_shiny_is_packaged_without_a_palette_guess(tmp_path):
    art=tmp_path/'art';art.mkdir();stage=tmp_path/'stage';stage.mkdir()
    for name,color in [('normal',(60,30,120)),('shiny',(240,240,244))]:
        image=Image.new('RGBA',(256,256));draw=ImageDraw.Draw(image)
        for row in range(4):
            for col in range(4):
                draw.rectangle((col*64+16,row*64+16,col*64+40,row*64+48),fill=(*color,255))
        image.save(art/(name+'.png'))
    record={'id':'fixture','file':'normal.png','shiny_file':'shiny.png','reviewed':True,
            'tool':'fixture','credit':['Source artist'],'licence':'Original terms',
            'atlas_repack':{'original_sha256':'original-normal','method':'Original normal crops retained'},
            'component_edit':{'unchanged_tiles':14},
            'shiny_generation':{'tool':'canonical palette transfer','method':'aligned reference colours',
                                'canonical_palette':{'urls':['normal-reference','shiny-reference']}}}
    (art/'registry.json').write_text(json.dumps({'fixture':record}),encoding='utf8')
    plan={'source':{'sha':'pinned'},'entries':[{'id':'fixture','name':'Fixture','num':1,
          'form':'','folder':None,'shiny_folder':None}]}
    destination=tmp_path/'library';compile_library(plan,stage,art,destination)
    library=PmdLibrary(destination);normal=library.resolve(1);shiny=library.resolve(1,shiny=True)
    assert shiny['source']['kind']=='generated' and shiny['source']['variant']=='shiny'
    assert normal['source']['source_sha256']!=shiny['source']['source_sha256']
    assert shiny['source']['normal_parent']['source_sha256']==normal['source']['source_sha256']
    assert shiny['source']['normal_parent']['atlas_repack']==normal['source']['atlas_repack']
    assert shiny['source']['normal_parent']['component_edit']==normal['source']['component_edit']
    assert normal['source']['tool']=='fixture' and 'derivation' not in normal['source']
    assert shiny['source']['tool']=='canonical palette transfer'
    assert shiny['source']['derivation']==record['shiny_generation']
    assert 'atlas_repack' not in shiny['source'] and 'component_edit' not in shiny['source']
    assert shiny['credit']==['Source artist'] and shiny['licence']=='Original terms'
    decoded=Image.open(io.BytesIO(library.image_bytes(shiny['a']['Walk']['file']))).convert('RGBA')
    assert {p[:3] for p in decoded.getdata() if p[3]}=={(240,240,244)}


def test_failed_rebuild_preserves_installed_art_and_success_keeps_existing_readers(tmp_path):
    art=tmp_path/'art';art.mkdir();stage=tmp_path/'stage';stage.mkdir();destination=tmp_path/'installed'
    def source(name,color):
        image=Image.new('RGBA',(256,256));draw=ImageDraw.Draw(image)
        for row in range(4):
            for col in range(4):
                draw.rectangle((col*64+16,row*64+16,col*64+40,row*64+48),fill=(*color,255))
        image.save(art/name)
    source('normal.png',(60,100,140));source('shiny.png',(120,180,40))
    record={'id':'fixture','file':'normal.png','shiny_file':'shiny.png','reviewed':True,'tool':'fixture'}
    plan={'source':{'sha':'fixture'},'entries':[{'id':'fixture','name':'Fixture','num':1,'form':'','folder':None,'shiny_folder':None}]}
    registry=art/'registry.json';registry.write_text(json.dumps({'fixture':record}),encoding='utf8')
    compile_library(plan,stage,art,destination)
    reader=PmdLibrary(destination);old_key=reader.resolve(1)['a']['Idle']['file'];old_image=reader.image_bytes(old_key)
    installed={file.name:file.read_bytes() for file in destination.iterdir()}
    source('normal.png',(220,40,100));record.pop('shiny_file');registry.write_text(json.dumps({'fixture':record}),encoding='utf8')
    with pytest.raises(ValueError,match='every normal and shiny'):
        compile_library(plan,stage,art,destination)
    assert {file.name:file.read_bytes() for file in destination.iterdir()}==installed
    assert PmdLibrary(destination).image_bytes(old_key)==old_image
    record['shiny_file']='shiny.png';registry.write_text(json.dumps({'fixture':record}),encoding='utf8')
    compile_library(plan,stage,art,destination)
    updated=PmdLibrary(destination);new_key=updated.resolve(1)['a']['Idle']['file']
    assert updated.image_bytes(new_key)!=old_image
    assert reader.image_bytes(old_key)==old_image
    # Windows denies replacing a file held by an active response; identical packs can be reused.
    with (destination/updated.manifest['packs'][0]).open('rb') as active_response:
        compile_library(plan,stage,art,destination)
        assert active_response.read()
        assert PmdLibrary(destination).image_bytes(new_key)==updated.image_bytes(new_key)


def test_inventory_keeps_meteor_shell_gender_and_missing_male_distinct():
    def node(name, children=None, art=False):
        return {"name": name, "subgroups": children or {}, "sprite_files": {"Idle": True} if art else {}}
    tracker = {"0774": node("Minior", {"0001": node("Red", art=True)}, art=True),
               "0668": node("Pyroar", {"0000": node("", {"0000": node("", {"0002": node("Female", art=True)})})})}
    roster = [{"id": i, "name": n, "num": num, "base": base, "form": f} for i,n,num,base,f in [
        ("minior", "Minior", 774, "Minior", ""), ("miniormeteor", "Minior-Meteor", 774, "Minior", "Meteor"),
        ("pyroar", "Pyroar", 668, "Pyroar", "")]]
    rows = {m["id"]:m for m in inventory(roster,tracker)["entries"]}
    assert rows["minior"]["folder"] == "0774/0001"
    assert rows["miniormeteor"]["folder"] == "0774"
    assert rows["pyroar"]["folder"] is None


def test_supplied_overworld_keeps_source_axes_bob_and_separate_shiny(tmp_path):
    record = {"id":"fixture","credit":["Original artist"],"licence":"Original terms",
              "archive":{"name":"fixture.zip","sha256":"archive-sha"}}
    for variant, blue in [("normal",20),("shiny",220)]:
        im = Image.new("RGBA",(256,256))
        draw = ImageDraw.Draw(im)
        for row in range(4):
            for frame in range(4):
                # A source figure touches its fixed cell edge; bob and pose changes are intentional.
                x, y = frame*64, row*64+6+(frame%2)*4
                draw.rectangle((x,y,x+30+(frame//2)*4,y+40),fill=(40+row*50,90,blue,255))
        name = variant+'.png'
        im.save(tmp_path/name)
        record[variant] = {"file":name,"member":variant+'/'+name}
    before = {v:(tmp_path/record[v]["file"]).read_bytes() for v in ("normal","shiny")}
    normal, images = supplied_sheet(record,tmp_path)
    shiny, shiny_images = supplied_sheet(record,tmp_path,True)
    assert set(images) == {"Idle","Walk"} and normal["a"]["Walk"]["n"] == 4
    assert normal["source"]["authored_frames"] == 16 and normal["source"]["directions"] == 4
    assert normal["a"]["Walk"]["d"] == [8,8,8,8]
    assert normal["source"]["archive"]["sha256"] == "archive-sha"
    assert shiny["source"]["member"] == "shiny/shiny.png"
    assert normal["source"]["source_sha256"] != shiny["source"]["source_sha256"]
    walk = Image.open(io.BytesIO(images["Walk"])).convert("RGBA")
    for row, original_row in enumerate([0,2,3,1]):
        boxes = []
        for frame in range(4):
            tile = walk.crop((frame*64,row*64,(frame+1)*64,(row+1)*64))
            box = tile.getchannel("A").getbbox()
            assert 0 < box[0] < box[2] < 64 and 0 < box[1] < box[3] < 64
            assert next(p[:3] for p in tile.getdata() if p[3]) == (40+original_row*50,90,20)
            boxes.append(box)
        assert boxes[1][1] > boxes[0][1] and boxes[2][2] > boxes[0][2]
    assert images["Walk"] != shiny_images["Walk"]
    assert before == {v:(tmp_path/record[v]["file"]).read_bytes() for v in before}


def test_incorrect_published_shiny_can_use_canonical_palette_without_losing_source_credits(tmp_path):
    art=tmp_path/'art';art.mkdir();stage=tmp_path/'stage';stage.mkdir()
    normal_rgb=(40,60,100);canonical_rgb=(180,20,10)
    for name,color in [('normal',normal_rgb),('bad-shiny',(200,0,200))]:
        atlas=Image.new('RGBA',(64,64));draw=ImageDraw.Draw(atlas)
        for row in range(4):
            for frame in range(4):
                draw.rectangle((frame*16+4,row*16+4,frame*16+10,row*16+13),fill=(*color,255))
        atlas.save(art/(name+'.png'))
    record={'id':'fixture','layout':'overworld-four-frame','reviewed':True,
            'source_kind':'published-overworld','credit':['Published artist'],'licence':'Upstream terms',
            'shiny_mode':'reference-palette','upstream':{'repo':'fixture/art','sha':'pinned'},
            'normal':{'file':'normal.png'},'shiny':{'file':'bad-shiny.png'}}
    (art/'registry.json').write_text(json.dumps({'fixture':record}),encoding='utf8')
    palette=stage/'palettes/fixture';palette.mkdir(parents=True)
    for name,color in [('normal',normal_rgb),('shiny',canonical_rgb)]:
        Image.new('RGBA',(2,2),(*color,255)).save(palette/(name+'.png'))
    (palette/'source.json').write_text(json.dumps({'kind':'canonical-palette-pair','urls':['normal-ref','shiny-ref']}),encoding='utf8')
    plan={'source':{'sha':'pinned'},'entries':[{'id':'fixture','name':'Fixture','num':1,'form':'','folder':None,'shiny_folder':None}]}
    destination=tmp_path/'library';manifest=compile_library(plan,stage,art,destination)
    assert manifest['coverage']['complete']
    library=PmdLibrary(destination);normal=library.resolve(1);shiny=library.resolve(1,shiny=True)
    assert normal['source']['kind']=='published-overworld'
    assert shiny['source']['kind']=='shiny-recolor'
    assert shiny['source']['parent']['kind']=='published-overworld'
    assert shiny['source']['parent']['upstream']['sha']=='pinned'
    assert shiny['credit']==['Published artist'] and shiny['licence']=='Upstream terms'
    decoded=Image.open(io.BytesIO(library.image_bytes(shiny['a']['Walk']['file']))).convert('RGBA')
    assert {p[:3] for p in decoded.getdata() if p[3]}=={canonical_rgb}


@pytest.mark.parametrize("reviewed", [False, True])
def test_identical_published_shiny_is_replaced_only_after_review(tmp_path, reviewed):
    stage = tmp_path / "stage"
    art = tmp_path / "art"
    art.mkdir()
    color = (130, 40, 150, 255)
    target = (210, 170, 30, 255)
    for folder in ("1025", "1025-0000-0001"):
        source = stage / "published" / folder
        source.mkdir(parents=True)
        image = Image.new("RGBA", (16, 16))
        ImageDraw.Draw(image).rectangle((5, 4, 10, 12), fill=color)
        image.save(source / "Idle.png")
        meta = {"s": 1, "a": {"Idle": {"w": 16, "h": 16, "n": 1, "r": 1,
                                        "d": [40], "ax": 8, "ay": 13}}}
        (source / "meta.json").write_text(json.dumps(meta), encoding="utf8")
    palette = stage / "palettes" / "pecharunt"
    palette.mkdir(parents=True)
    for name, rgba in [("normal", color), ("shiny", target)]:
        Image.new("RGBA", (2, 2), rgba).save(palette / (name + ".png"))
    (palette / "source.json").write_text(json.dumps({"urls": ["normal-ref", "shiny-ref"]}), encoding="utf8")
    correction = {"reviewed": reviewed, "shiny_mode": "reference-palette",
                  "shiny_correction_reason": "Published shiny duplicates every normal sheet"}
    (art / "registry.json").write_text(json.dumps({"pecharunt": correction}), encoding="utf8")
    plan = {"source": {"sha": "pinned"}, "credits": {"1025": {"primary": "Artist"},
            "1025/0000/0001": {"primary": "Artist"}}, "entries": [{"id": "pecharunt",
            "name": "Pecharunt", "num": 1025, "form": "", "folder": "1025", "shiny_folder": "1025/0000/0001"}]}
    destination = tmp_path / "library"
    compile_library(plan, stage, art, destination)
    assert b"\r" not in (destination / "CREDITS.md").read_bytes()
    library = PmdLibrary(destination)
    normal = library.resolve(1025)
    shiny = library.resolve(1025, shiny=True)
    a = Image.open(io.BytesIO(library.image_bytes(normal["a"]["Idle"]["file"]))).convert("RGBA")
    b = Image.open(io.BytesIO(library.image_bytes(shiny["a"]["Idle"]["file"]))).convert("RGBA")
    assert a.getchannel("A").tobytes() == b.getchannel("A").tobytes()
    assert normal["credit"] == shiny["credit"] == ["Artist"]
    if reviewed:
        assert {p[:3] for p in b.getdata() if p[3]} == {target[:3]}
        assert shiny["source"]["kind"] == "shiny-recolor"
        assert shiny["source"]["parent"]["folder"] == "1025"
        assert shiny["source"]["replaced_published"]["folder"] == "1025/0000/0001"
    else:
        assert a.tobytes() == b.tobytes()
        assert shiny["source"]["kind"] == "published-pmd"


def test_authored_walking_adapter_keeps_eight_headings_and_the_original_three_phase_cycle(tmp_path):
    image=Image.new('RGBA',(60,160),(30,30,30,255));draw=ImageDraw.Draw(image)
    frames=[]
    for row in range(8):
        frames.append([[frame*20,row*20,20,20] for frame in [0,1,2,1]])
        for frame in range(3):
            draw.rectangle((frame*20+4,row*20+4+frame,frame*20+12,row*20+14+frame),fill=(row*25,frame*80,70,255))
    image.save(tmp_path/'authored.png')
    record={'id':'fixture','layout':'authored-walking-atlas','row_order':list(range(8)),
            'credit':['Original artist'],'licence':'Original terms','authored_frames':15,'drawn_directions':5,
            'provenance':{'source_url':'https://example.org/artist'},
            'normal':{'file':'authored.png','frames':frames,'background':[30,30,30,255]}}
    meta,images=supplied_sheet(record,tmp_path)
    assert set(images)=={'Idle','Walk'} and meta['a']['Walk']['row_map']==list(range(8))
    assert meta['a']['Walk']['r']==8 and meta['a']['Walk']['d']==[8]*4
    assert meta['source']['authored_frames']==15 and meta['source']['drawn_directions']==5
    walk=Image.open(io.BytesIO(images['Walk'])).convert('RGBA')
    for row in range(8):
        tiles=[walk.crop((i*64,row*64,(i+1)*64,(row+1)*64)) for i in range(4)]
        assert tiles[1].tobytes()==tiles[3].tobytes()
        assert len({t.tobytes() for t in tiles})==3
        assert tiles[0].getchannel('A').getbbox()[1]<tiles[1].getchannel('A').getbbox()[1]<tiles[2].getchannel('A').getbbox()[1]
        assert (30,30,30,255) not in set(tiles[0].getdata())


@pytest.mark.parametrize("cell,coord", [(32,0),(64,16)])
def test_indexed_overworld_decodes_alpha_by_index_and_preserves_authored_phases(tmp_path,cell,coord):
    record={"id":"fixture","credit":["Upstream contributors"],"licence":"Upstream community terms",
            "attribution_note":"Individual artist not identified","upstream":{"sha":"pinned"},
            "files":{"png":"indexed.png","geometry":"frames.json","normal_palette":"normal.pal","shiny_palette":"shiny.pal"}}
    image=Image.new("P",(cell,cell*8),0)
    image.putpalette([v for i in range(256) for v in (i,i,i)])
    for i in range(8):
        # Index0 and index2 are both RGB black: only zero is transparent.
        for y in range(4+i%2,12+i%2):
            for x in range(2,7): image.putpixel((x,i*cell+y),i+3)
        image.putpixel((2,i*cell+4+i%2),2)
    image.save(tmp_path/'indexed.png')
    geometry={str(i):dict(frame=i,width=cell,height=cell,format=3,color0=1,coordTrans=coord,flipX=0,flipY=0) for i in range(8)}
    (tmp_path/'frames.json').write_text(json.dumps({"frames":geometry}))
    for variant,blue in [('normal',30),('shiny',220)]:
        palette=[(0,0,0),(80,80,80),(0,0,0)]+[(i*10,100,blue) for i in range(13)]
        (tmp_path/(variant+'.pal')).write_text('JASC-PAL\n0100\n16\n'+'\n'.join(' '.join(map(str,c)) for c in palette)+'\n')
    meta,images=indexed_overworld_sheet(record,tmp_path)
    shiny,other=indexed_overworld_sheet(record,tmp_path,True)
    assert set(images)=={'Idle','Walk'} and meta['a']['Walk']['n']==2
    assert meta['source']['authored_frames']==8 and meta['source']['coordTrans']==coord
    assert shiny['source']['palette']=='shiny' and images['Walk']!=other['Walk']
    walk=Image.open(io.BytesIO(images['Walk'])).convert('RGBA')
    for row,pair in enumerate([[2,3],[6,7],[0,1],[4,5]]):
        boxes=[]
        for frame,original in enumerate(pair):
            tile=walk.crop((frame*64,row*64,(frame+1)*64,(row+1)*64))
            colours=set(tile.getdata());boxes.append(tile.getchannel('A').getbbox())
            assert (0,0,0,255) in colours and (0,0,0,0) in colours
            assert (original*10,100,30,255) in colours
        assert boxes[1][1]>boxes[0][1] and boxes[1][3]>boxes[0][3]
    geometry['0']['flipX']=1
    (tmp_path/'frames.json').write_text(json.dumps({"frames":geometry}))
    with pytest.raises(ValueError,match='Unsupported indexed overworld geometry'):
        indexed_overworld_sheet(record,tmp_path)


def test_published_overworld_credits_and_full_notices_travel_offline(services,tmp_path):
    library,_,_=library_fixture(tmp_path/'library')
    library.manifest['notices']={'CREDITS.md':'Complete upstream credits','README.md':'Original conditions'}
    meta=library.manifest['metas']['lib-mega']
    meta.update(licence='HG-engine community terms',source={'kind':'shiny-recolor','parent':{'kind':'published-overworld'}})
    services.pmd.library=library
    assert services.credits_get(species='Charizard-Mega-Y')['source']=='Published overworld pixel art'
    assert portable_assets.bundle(services)['pmd']['notices']==library.manifest['notices']


def test_concurrent_alias_requests_extract_once_and_never_replace_a_file_being_read(tmp_path, monkeypatch):
    """#2072: Hurt and Faint (or previews) share one cached file; on Windows a second extraction replaced it while another
    request had it open, and opening or replacing it raised PermissionError."""
    import threading
    import time
    from silvers_hoard import pmd_library
    library, png, _ = library_fixture(tmp_path / "library")
    cache = tmp_path / "cache"
    writes = []
    real_write = pmd_library.write_bytes_atomic

    def slow_write(path, data, **kw):
        writes.append(path)
        time.sleep(0.02)  # widen the window in which a second request could start another extraction
        real_write(path, data, **kw)

    monkeypatch.setattr(pmd_library, "write_bytes_atomic", slow_write)
    aliases = ["Idle", "PreviewFront", "PreviewBack"]
    barrier = threading.Barrier(12)
    errors, served = [], []

    def worker(i):
        barrier.wait()
        for _ in range(5):
            try:
                path = library.sheet("lib-mega", aliases[i % len(aliases)], cache)
                with open(path, "rb") as fh:  # what FileResponse does, holding the file open while it streams
                    time.sleep(0.002)
                    served.append(fh.read())
            except Exception as exc:  # noqa: BLE001
                errors.append(repr(exc))

    threads = [threading.Thread(target=worker, args=(i,)) for i in range(12)]
    [t.start() for t in threads]
    [t.join() for t in threads]
    assert errors == []
    assert len(writes) == 1 and len(served) == 60 and set(served) == {png}


def test_body_cache_recovers_a_deleted_or_damaged_copy_with_the_packed_bytes(tmp_path):
    library, png, _ = library_fixture(tmp_path / "library")
    cache = tmp_path / "cache"
    path = library.sheet("lib-mega", "Idle", cache)
    path.unlink()
    assert library.sheet("lib-mega", "PreviewBack", cache).read_bytes() == png
    path.write_bytes(png[:-3])  # truncated
    assert library.sheet("lib-mega", "Idle", cache).read_bytes() == png
    path.write_bytes(bytes(len(png)))  # same size, wrong bytes
    assert library.sheet("lib-mega", "Idle", cache).read_bytes() == png
    # an intact copy written by someone else (another process) is kept as it is
    stamp = path.stat().st_mtime_ns
    fresh = PmdLibrary(library.root)
    assert fresh.sheet("lib-mega", "PreviewFront", cache) == path and path.stat().st_mtime_ns == stamp
