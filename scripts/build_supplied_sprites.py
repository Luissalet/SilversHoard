"""Cut Luis's supplied game sheets into named, transparent sprites. No source files are changed.

Usage: python scripts/build_supplied_sprites.py <Sprites for Silvers folder>
The crop manifest keeps original filenames, SHA256 hashes and credits. Pillow is build-only.
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import io
import json
import re
import zipfile
from collections import deque
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "silvers_hoard/presets/supplied_sprites.json"


def build(folder: Path) -> dict:
    sources, sprites = {}, {}

    def source(pattern, credit):
        path, = folder.glob(pattern)
        sid = str(len(sources))
        sources[sid] = {"file": path.name, "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
                        "credit": credit, "copyright": "Pokémon © Nintendo, Creatures, GAME FREAK"}
        return sid, Image.open(path).convert("RGBA")

    def cut(src, id_, box, name, es, group, *, background=None, **extra):
        sid, sheet = src
        im = sheet.crop(box)
        if background is not None:
            # Erase only edge-connected sheet backgrounds; white eyes, hats and highlights stay opaque.
            colors = {tuple(c) for c in background}
            pixels = im.load()
            todo = deque([(x, y) for x in range(im.width) for y in (0, im.height-1)] +
                         [(x, y) for y in range(im.height) for x in (0, im.width-1)])
            seen = set()
            while todo:
                x, y = todo.popleft()
                if (x,y) in seen or not 0 <= x < im.width or not 0 <= y < im.height:
                    continue
                seen.add((x,y))
                r,g,b,a = pixels[x,y]
                if (r,g,b) not in colors:
                    continue
                pixels[x,y] = (r,g,b,0)
                todo.extend(((x-1,y),(x+1,y),(x,y-1),(x,y+1)))
        bbox = im.getbbox()
        if not bbox:
            raise ValueError(f"Empty crop: {id_}")
        # Fixed frame canvases keep animations anchored. Static sprites trim only transparent margins.
        if not extra.get("frame"):
            im = im.crop(bbox)
        stream = io.BytesIO()
        im.save(stream, format="PNG", optimize=True)
        sprites[id_] = {"name": name, "name_es": es, "group": group, "source": sid, "rect": list(box),
                        "width": im.width, "height": im.height,
                        "image": "data:image/png;base64," + base64.b64encode(stream.getvalue()).decode(), **extra}

    def atlas(sid, id_, frames, name, es, members, *, fps=12):
        w,h=max(im.width for im in frames),max(im.height for im in frames)
        cols=min(8,len(frames))
        sheet=Image.new("RGBA",(w*cols,h*((len(frames)+cols-1)//cols)))
        for i,im in enumerate(frames):
            sheet.alpha_composite(im,((i%cols)*w+(w-im.width)//2,(i//cols)*h+(h-im.height)//2))
        stream=io.BytesIO();sheet.save(stream,format="PNG",optimize=True)
        sprites[id_]={"name":name,"name_es":es,"group":"effect-atlas","source":sid,"rect":[0,0,sheet.width,sheet.height],
            "width":sheet.width,"height":sheet.height,"image":"data:image/png;base64,"+base64.b64encode(stream.getvalue()).decode(),
            "frames":len(frames),"frame_width":w,"frame_height":h,"columns":cols,"fps":fps,"members":members}

    bw = source("*Black _ White*Accessories.png", "redblueyellow (ripping); original sheet: no credit needed")
    rows = [
        (0, "Pink Bow|Blue Bow|Red Bow|Gift Bow|Orange Bow|Green Bow|Black Bow|Aqua Bow|Leaf Brooch|Blue Flower|Red Flower|Orange Flower",
         "Lazo rosa|Lazo azul|Lazo rojo|Lazo de regalo|Lazo naranja|Lazo verde|Lazo negro|Lazo celeste|Broche de hojas|Flor azul|Flor roja|Flor naranja"),
        (33, "Tiara|Pearl Tiara|Royal Crown|Top Hat|White Top Hat|Blue Tiara|Witch Hat|Santa Hat|Beret|Graduation Cap|Viking Helmet|Laurel|Straw Hat|Cowboy Hat|Crescent|Chef Hat|Safety Helmet|Black Cap|White Collar",
         "Diadema|Diadema de perlas|Corona real|Chistera|Chistera blanca|Tiara azul|Sombrero de bruja|Gorro navideño|Boina|Birrete|Casco vikingo|Laurel|Sombrero de paja|Sombrero vaquero|Media luna|Gorro de chef|Casco de obra|Gorra negra|Cuello blanco"),
        (66, "Sunglasses|Black Glasses|Round Glasses|Monocle|Black Tie|Blue Tie|Pink Tie|Blue Button|Orange Button|Red Button|Necklace|White Beard|Skull|Belt|Shield|Bib|Pikachu Mask|Handbag",
         "Gafas de sol|Gafas negras|Gafas redondas|Monóculo|Corbata negra|Corbata azul|Corbata rosa|Botón azul|Botón naranja|Botón rojo|Collar|Barba blanca|Calavera|Cinturón|Escudo|Babero|Máscara Pikachu|Bolso"),
        (99, "Candy|Birthday Cake|Gift|Trumpet|Tambourine|Maraca|Rattle|Torch|Lantern|Smile Badge|Pocket Watch|Football|Shuriken|Book|Hammer|Snowflake|Windup Key|Snowball|Mushroom|Wrench",
         "Caramelo|Tarta|Regalo|Trompeta|Pandereta|Maraca|Sonajero|Antorcha|Farol|Insignia sonriente|Reloj de bolsillo|Balón|Shuriken|Libro|Martillo|Copo de nieve|Llave de cuerda|Bola de nieve|Seta|Llave inglesa"),
    ]
    categories = ["Cute", "Cool", "Beautiful", "Clever", "Tough"]
    themes = ["party", "night", "garden", "sea"]
    for y, names, spanish in rows:
        for col, (name, es) in enumerate(zip(names.split("|"), spanish.split("|"))):
            x = col * 33
            # Each cell has its own flat green/grey background and white separator.
            bg = [bw[1].getpixel((x + 1, y + 1))[:3], (255, 255, 255)]
            id_ = "bw-" + re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
            cut(bw, id_, (x+1, y+1, x+33, y+33), name, es, "accessory", background=bg,
                category=categories[col % 5], theme=themes[(col + y // 33) % 4])
    for col, (name, es) in enumerate(zip(
            "Sword|Curved Sword|Rose|White Flower|Bouquet|Microphone|Guitar|Parasol|Umbrella|Golf Club|Whisk|Frying Pan|Cane|Walking Stick|Racket|Fishing Rod|Bone|Pennant|Trident".split("|"),
            "Espada|Espada curva|Rosa|Flor blanca|Ramo|Micrófono|Guitarra|Sombrilla|Paraguas|Palo de golf|Batidor|Sartén|Bastón|Bastón de madera|Raqueta|Caña de pescar|Hueso|Banderín|Tridente".split("|"))):
        x, y = col * 33, 198
        cut(bw, "bw-"+name.lower().replace(" ", "-"), (x+1,y+1,x+33,264), name, es, "accessory",
            background=[bw[1].getpixel((x+1,y+1))[:3], (255,255,255)], category=categories[col%5], theme=themes[col%4])

    dp = source("*Diamond _ Pearl*Accessories.png", "redblueyellow (ripping); original sheet: no credit needed")
    # Legacy accessory IDs retain their category/theme and receive real art.
    for id_, box in {"ribbon":(7,529,34,554), "crown":(8,786,45,815), "flower":(11,374,26,394),
                     "leaf":(116,112,140,140), "shell":(58,26,82,53), "anchor":(17,151,37,176),
                     "star":(6,333,21,353), "moon":(62,267,119,307), "heart":(172,621,207,679),
                     "stone":(80,26,108,54)}.items():
        cut(dp, id_, box, id_.title(), id_.title(), "legacy-accessory", background=[(0,128,128)])

    dolls = source("*Diamond _ Pearl*Pokedolls.png", "Pimplup (ripping); original sheet requests credit")
    names = "Bulbasaur Squirtle Charmander Chikorita Blastoise Cyndaquil Treecko Mudkip Torchic Turtwig Piplup Chimchar Pikachu Plusle Minun Clefairy Jigglypuff Meowth Glameow Weavile Munchlax Bonsly Mime-Jr Skitty Wobbuffet Buneary Lucario Buizel Mantyke Chatot".split()
    for n, name in enumerate(names):
        x, y = (n % 3) * 32, (n // 3) * 32
        cut(dolls, "doll-"+name.lower(), (x,y,x+32,y+32), name.replace("-", " ")+" Doll", "Muñeco de "+name.replace("-", " "), "decoration", background=[dolls[1].getpixel((x,y))[:3], dolls[1].getpixel((x,y+31))[:3]], solid=True, footprint=[1,1])
    # Large dolls and the final two rows do not use the small three-column grid.
    for id_, box, name, footprint in [("manaphy",(0,320,32,352),"Manaphy",[1,1]),("snorlax",(32,316,64,348),"Snorlax",[1,1]), ("wailord",(64,316,96,348),"Wailord",[1,1]),
            ("magnezone",(0,348,32,380),"Magnezone",[2,2]), ("drifloon",(32,352,64,384),"Drifloon",[1,1]),("happiny",(64,352,96,384),"Happiny",[1,1]),
            ("pachirisu",(32,384,64,412),"Pachirisu",[1,1])]:
        cut(dolls,"doll-"+id_,box,name+" Doll","Muñeco de "+name,"decoration",background=[dolls[1].getpixel((box[0],box[1]))[:3],dolls[1].getpixel((box[0],box[3]-1))[:3]],solid=True,footprint=footprint)

    emerald = source("*Emerald*Secret Bases.png", "Biohazard13 (ripping); original sheet requests credit")
    bg = [emerald[1].getpixel((860,0))[:3]]
    furniture = [
        ("desk",(173,1415,223,1453),"Heavy Desk","Mesa grande",[3,2]),
        ("chair",(234,1442,251,1459),"Wooden Chair","Silla de madera",[1,1]),
        ("plant",(174,1342,194,1375),"Red Plant","Planta roja",[1,1]),
        ("emerald-brick-desk",(119,1465,170,1513),"Brick Desk","Mesa de ladrillo",[3,2]),
        ("emerald-wood-desk",(120,1517,169,1568),"Wood Desk","Mesa de madera",[3,2]),
        ("cushion",(277,1442,292,1459),"Pink Cushion","Cojín rosa",[1,1]),
        ("rug",(7,1354,54,1408),"Blue Rug","Alfombra azul",[3,3]),
        ("poster",(312,1408,328,1424),"Cross Poster","Póster de cruz",[1,1]),
        ("emerald-red-stand",(452,1438,470,1475),"Red Stand","Soporte rojo",[1,2]),
        ("emerald-blue-desk",(174,1524,223,1574),"Blue Desk","Mesa azul",[3,3]),
        ("emerald-yellow-desk",(173,1454,223,1486),"Yellow Desk","Mesa amarilla",[3,2]),
        ("emerald-pretty-flowers",(216,1342,238,1376),"Pretty Flowers","Flores bonitas",[1,2]),
        ("emerald-bonsai",(208,1380,242,1409),"Bonsai","Bonsái",[2,2]),
        ("emerald-tropical-plant",(243,1377,278,1413),"Tropical Plant","Planta tropical",[2,2]),
        ("emerald-tv",(398,1407,416,1425),"TV","Televisor",[1,1]),
        ("emerald-slide",(389,1469,423,1538),"Slide","Tobogán",[2,4]),
        ("emerald-fence",(520,1437,540,1475),"Fence","Valla",[1,2]),
        ("emerald-statue",(507,1471,532,1511),"Statue","Estatua",[1,2]),
    ]
    for id_,box,name,es,footprint in furniture:
        # Old generic furniture occupies one tile forever; named additions use measured footprints.
        cut(emerald,id_,box,name,es,"legacy-decoration" if not id_.startswith("emerald-") else "decoration",background=bg,
            solid=id_ not in ("rug","cushion","poster"),footprint=[1,1] if not id_.startswith("emerald-") else footprint)
    for style, xy in {"tree":(48,190),"cave":(48,40),"shrub":(270,210)}.items():
        x,y=xy
        cut(emerald,"floor-"+style,(x,y,x+16,y+16),style.title(),style.title(),"floor")

    statues = source("*Explorers of Sky*Statues.png", "Nidoking (ripping); original credit retained")
    for i, name in enumerate(("Croagunk", "Kangaskhan", "Duskull")):
        cut(statues,"statue-"+name.lower(),(16+44*i,8,52+44*i,43),name+" Statue","Estatua de "+name,"decoration",
            background=[statues[1].getpixel((0,0))[:3]],solid=True,footprint=[1,1])
    rotom = source("*Rotom Icons.png", "Dragoon (ripping); original sheet: credit not needed")
    for id_, box, name, es, fp in [("oven",(23,24,42,43),"Rotom Oven","Horno de Rotom",[1,1]),
            ("fan",(49,20,72,44),"Rotom Fan","Ventilador de Rotom",[1,1]),
            ("fridge",(77,12,98,44),"Rotom Fridge","Nevera de Rotom",[1,2]),
            ("washer",(105,20,128,44),"Rotom Washer","Lavadora de Rotom",[1,1]),
            ("mower",(133,18,154,44),"Rotom Mower","Cortacésped de Rotom",[1,1])]:
        cut(rotom,"rotom-"+id_,box,name,es,"decoration",background=[(255,255,255)],solid=True,footprint=fp)
    berries = source("*Overworld Berries.png", "Shaked Silverman / snked (ripping); original credit retained")
    names = "Cheri Chesto Pecha Rawst Aspear Leppa Oran Persim Lum Sitrus Figy Wiki Mago Aguav Iapapa Razz Bluk Nanab Wepear Pinap Pomeg Kelpsy Qualot Hondew Grepa Tamato Cornn Magost Rabuta Nomel Spelon Pamtre Watmel Durin Belue Occa Passho Wacan Rindo Yache Chople Kebia Shuca Coba Payapa Tanga Charti Kasib Haban Colbur Babiri Chilan Liechi Ganlon Salac Petaya Apicot Lansat Starf Enigma Micle Custap Jaboca Rowap".split()
    for n, name in enumerate(names):
        x,y=(n%16)*47+2,(n//16)*106+70
        cut(berries,f"berry-{n+1:02}",(x,y+2,x+22,y+31),f"Berry Plant {n+1:02}",f"Planta de bayas {n+1:02}","decoration",
            background=[berries[1].getpixel((x,y+2))[:3]],solid=True,footprint=[1,1])

    bw2 = source("*Black 2*Pokemon Decorations.png", "Original Pokémon game artists; supplied sheet has no artist attribution")
    for n,(name,es,box) in enumerate([
            ("Red Cape","Capa roja",(294,92,351,126)),("Bat Wings","Alas de murciélago",(0,163,64,193)),
            ("White Wings","Alas blancas",(99,162,159,190)),("Dragon Wings","Alas de dragón",(164,218,217,256)),
            ("Black Wings","Alas negras",(0,217,65,255)),("Pink Wings","Alas rosas",(164,218,217,256)),
            ("Laurel Garland","Guirnalda de laurel",(255,294,291,319)),("Hula Skirt","Falda hawaiana",(111,354,157,388)),
            ("Confetti Ball","Bola de confeti",(9,289,58,321)),("Silver Crown","Corona plateada",(383,224,416,252)),
            ("Jester Hat","Gorro de bufón",(363,160,404,189)),("Red Scarf","Bufanda roja",(138,5,187,28))]):
        cut(bw2,"bw2-"+name.lower().replace(" ","-"),box,name,es,"accessory",background=[(0,0,0)],category=categories[n%5],theme=themes[n%4])

    seals=source("*Ball Capsules.png", "redblueyellow (ripping); original sheet: no credit needed")
    for n,(name,es) in enumerate([( "Heart Seal","Sello corazón"),("Music Seal","Sello musical"),("Star Seal","Sello estrella"),("Flower Seal","Sello floral"),("Smoke Seal","Sello humo"),("Bubble Seal","Sello burbuja"),("Fire Seal","Sello fuego")]):
        y=[8,58,82,156,205,306,353][n]
        box=(327,33,350,56) if name == "Music Seal" else (272,y,295,y+24)
        cut(seals,"seal-"+name.lower().split()[0],box,name,es,"accessory",background=[(255,255,255)],category=categories[n%5],theme=themes[n%4])

    # The custom balls remain decorations, so none replaces the existing animated battle ball.
    balls=source("*Overworld Pokeballs.png", "UnEliwygNatu (sprite edits); original sheet: credit appreciated, not needed")
    for n,name in enumerate(("Poke", "Great", "Ultra", "Master")):
        cut(balls,"ball-"+name.lower(),(22+n*14,0,36+n*14,17),name+" Ball Display","Expositor "+name+" Ball","decoration",
            background=[balls[1].getpixel((0,0))[:3]],solid=True,footprint=[1,1])
    hisui=source("*Hisuian*.png", "Original custom sheet supplied by Luis; author not identified on sheet")
    for n,name in enumerate(("Poke", "Great", "Ultra")):
        cut(hisui,"hisui-"+name.lower(),(n*28,0,n*28+27,26),"Hisuian "+name+" Ball","Poké Ball de Hisui: "+name,"decoration",
            background=[hisui[1].getpixel((0,0))[:3]],solid=True,footprint=[1,1])

    menu = source("*Platinum*Menu Icons.png", "Spaceemotion (ripping); original sheet requests credit")
    for col, x, names in [(0,248,"pokedex pokemon bag trainer save options exit chat flag watch"),
                           (1,340,"underground-bag underground-record underground-sphere underground-treasure underground-card underground-radar underground-exit")]:
        for row,name in enumerate(names.split()):
            y=103+32*row
            cut(menu,"menu-"+name,(x,y,x+24,y+25),name.replace("-"," ").title(),name,"menu",background=[(255,255,255)])

    attacks, = folder.glob("*Diamond*Attack*.zip")
    sid=str(len(sources))
    sources[sid]={"file":attacks.name,"sha256":hashlib.sha256(attacks.read_bytes()).hexdigest(),
                  "credit":"Original rippers; Shadow Ball: K.L.NOTHINCOMIN (sheet requests credit)","copyright":"Pokémon © Nintendo, Creatures, GAME FREAK"}
    with zipfile.ZipFile(attacks) as archive:
        for name, boxes in {"Fire.png":[(0,0,27,27),(48,0,75,27)],
                "Ice-Shards.png":[(i*30,0,i*30+30,30) for i in range(8)],
                "Shadow-Ball.png":[(320,y,448,y+140) for y in (0,140,289,440,592,741)],
                "Swift.png":[(128,0,200,57)]}.items():
            src=(sid,Image.open(archive.open(name)).convert("RGBA"))
            for i, box in enumerate(boxes):
                backgrounds=[src[1].getpixel((box[0],box[1]))[:3],(255,255,255),(243,243,243)]
                id_="fx-"+name.removesuffix(".png").lower()+"-"+str(i)
                cut(src,id_,box,name.removesuffix(".png"),name,"effect",background=backgrounds,frame=True,member=name)

    goods = folder / "Gen IV decoration goods"
    sizes = {**{i:(2,1) for i in range(1,6)}, 6:(2,2),10:(3,3),11:(2,2),13:(1,3),14:(3,1),15:(3,3),
             16:(2,2),17:(1,2),18:(2,2),19:(2,2),20:(2,2),21:(1,2),22:(2,2),23:(2,2),24:(2,2),25:(2,1),
             26:(1,2),27:(2,1),28:(2,3),31:(2,2),32:(2,2),34:(2,2),35:(2,2),36:(1,2),38:(2,3),39:(2,3),40:(1,2),
             42:(1,2),43:(2,1),44:(2,1),46:(3,3),47:(1,2),**{i:(3,3) for i in range(48,56)},
             **{i:(2,2) for i in range(77,81)},**{i:(2,1) for i in range(81,85)},89:(2,2),90:(2,2),91:(2,2),125:(2,2),
             133:(2,1),136:(1,2),137:(1,2),138:(3,1)}
    spanish = {7:"Cojín amarillo",8:"Cojín azul",9:"Silla de madera",10:"Mesa grande",11:"Mesa sencilla",12:"Mesa pequeña",
        13:"Mesa larga",14:"Mesa ancha",15:"Mesa Poké",16:"Estantería grande",17:"Estantería pequeña",18:"Estantería de investigación",
        19:"Herramientas de bicicleta",20:"Estantería de tienda",21:"Expositor",22:"Alacena",23:"Cómoda de madera",24:"Cómoda rosa",
        25:"Televisor",26:"Nevera",27:"Fregadero",28:"Cama mullida",29:"Papelera",30:"Caja de cartón",31:"Cajón",32:"Contenedor",
        33:"Bidón",34:"Bidones grandes",35:"Viga de hierro",36:"Planta en maceta",37:"Flor Poké",38:"Máquina de curación",
        39:"Máquina de laboratorio",40:"Máquina de pruebas",41:"Videoconsola",42:"Máquina expendedora",43:"Bicicleta roja",
        44:"Bicicleta verde",45:"Prismáticos",46:"Globo terráqueo",47:"Estatua de gimnasio",48:"Tienda roja",49:"Tienda azul",
        50:"Tienda transparente",51:"Bloque de laberinto 1",52:"Bloque de laberinto 2",53:"Bloque de laberinto 3",
        54:"Bloque de laberinto 4",55:"Bloque de laberinto 5",56:"Herramienta de agujero",57:"Herramienta de foso",
        58:"Herramienta de humo",59:"Herramienta de humo grande",60:"Herramienta de roca",61:"Herramienta de rocas",
        62:"Herramienta de espuma",63:"Herramienta de burbujas",64:"Avisador 1",65:"Avisador 2",66:"Avisador 3",67:"Avisador 4",
        68:"Herramienta de hojas",69:"Herramienta de flores",70:"Herramienta de brasas",71:"Herramienta de fuego",
        72:"Copa Dulzura",73:"Copa Carisma",74:"Copa Belleza",75:"Copa Dureza",76:"Copa Ingenio",77:"Cristal azul",
        78:"Cristal rosa",79:"Cristal rojo",80:"Cristal amarillo",81:"Gema bonita",82:"Gema brillante",83:"Gema mística",84:"Gema reluciente",
        85:"Trofeo de bronce",86:"Trofeo de plata",87:"Trofeo de oro",88:"Gran trofeo",89:"Adorno Poké Ball",90:"Adorno redondo",
        91:"Adorno transparente",133:"Sofá ancho",134:"Bonsái",135:"Flores delicadas",136:"Flores preciosas",137:"Flores bonitas",138:"Jardinera"}
    for path in sorted(goods.glob("*.png")) if goods.exists() else []:
        number = int(path.name[:3])
        raw = path.read_bytes()
        im = Image.open(io.BytesIO(raw))
        name = re.sub(r"(?:_Sprite_DPPt|_IV)$", "", path.stem.split("_",1)[1]).replace("_", " ")
        if name.startswith("Doll "):
            name = name[5:] + " Doll"
        es = spanish.get(number, "Muñeco de " + name.removesuffix(" Doll") if name.endswith(" Doll") else
                         "PC (bandera " + ["normal","bronce","plata","oro","platino"][number-1] + ")" if number<=5 else
                         "Roca grande" if number==6 else "Agujero de base " + str(number-128))
        sid = str(len(sources))
        sources[sid] = {"file": path.relative_to(folder).as_posix(), "sha256":hashlib.sha256(raw).hexdigest(),
                        "credit":"Original game artists; supplied from Bulbagarden Archives", "copyright":"Pokémon © Nintendo, Creatures, GAME FREAK"}
        sprites[f"gen4-{number:03}"] = {"name":name,"name_es":es,"group":"decoration","source":sid,
             "rect":[0,0,im.width,im.height],"width":im.width,"height":im.height,
             "image":"data:image/png;base64,"+base64.b64encode(raw).decode(),"solid":number not in (7,8,129,130,131,132) and number not in range(56,72),
             "footprint":list(sizes.get(number,(1,1))),"generation":4,"goods_number":number,"decoration_only":True}
    # Give old generic objects matching art without changing their historical one-cell layout.
    for old, new in (("bed","gen4-028"),("shelf","gen4-017")):
        if new in sprites:
            sprites[old] = {**sprites[new],"group":"legacy-decoration","footprint":[1,1]}

    attack_folder=folder/"attacks"
    sky_path=next(attack_folder.glob("*Sky*.zip"),None) if attack_folder.exists() else None
    if sky_path:
        sid=str(len(sources));sources[sid]={"file":sky_path.relative_to(folder).as_posix(),"sha256":hashlib.sha256(sky_path.read_bytes()).hexdigest(),
            "credit":"Pokémon Mystery Dungeon: Explorers of Sky; original game artists and archive rippers","copyright":"Pokémon © Nintendo, Creatures, GAME FREAK"}
        chosen={"Fire":"0053","Ice":"0141","Ghost":"0156","Normal":"0107","Poison":"0046","Dark":"0092","Rock":"0117",
            "Electric":"0042","Dragon":"0075","Grass":"0129","Water":"0013","Psychic":"0017","Fighting":"0005","Steel":"0136",
            "Fairy":"0051","Ground":"0041","Bug":"0067","Flying":"0100"}
        with zipfile.ZipFile(sky_path) as archive:
            for type_,code in chosen.items():
                members=sorted(n for n in archive.namelist() if n.startswith(f"move_VFX/{code}/000/") and n.endswith(".png"))
                if not members:
                    raise ValueError(f"Missing Explorers animation {code}")
                frames=[Image.open(archive.open(n)).convert("RGBA") for n in members]
                atlas(sid,"fx-sky-"+type_.lower(),frames,type_+" projectile",type_+": proyectil",members)
    ranger_path=next(attack_folder.glob("*Ranger*.zip"),None) if attack_folder.exists() else None
    if ranger_path:
        sid=str(len(sources));sources[sid]={"file":ranger_path.relative_to(folder).as_posix(),"sha256":hashlib.sha256(ranger_path.read_bytes()).hexdigest(),
            "credit":"Pokémon Ranger: Guardian Signs; original game artists and archive rippers","copyright":"Pokémon © Nintendo, Creatures, GAME FREAK"}
        with zipfile.ZipFile(ranger_path) as archive:
            im=Image.open(archive.open("17.png")).convert("RGBA")
            frames=[]
            for i in range(4):
                frame=im.crop((0,i*71,71,(i+1)*71))
                frame.putdata([(r,g,b,0) if (r,g,b)==(255,0,255) else (r,g,b,a) for r,g,b,a in frame.getdata()])
                frames.append(frame)
            atlas(sid,"fx-ranger-impact",frames,"Impact burst","Impacto",["17.png"],fps=16)
    # Inventory every supplied file, including sheets not yet connected to a game surface.
    source_hashes={s["sha256"] for s in sources.values()}
    inventory=[{"file":p.relative_to(folder).as_posix(),"sha256":hashlib.sha256(p.read_bytes()).hexdigest(),
                "connected":hashlib.sha256(p.read_bytes()).hexdigest() in source_hashes} for p in sorted(folder.rglob("*")) if p.is_file()]
    return {"schema":1,"sources":sources,"sprites":sprites,"inventory":inventory,
            "reference":"https://bulbapedia.bulbagarden.net/wiki/List_of_decoration_goods_in_Generation_IV"}


if __name__ == "__main__":
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("folder",type=Path)
    args=parser.parse_args()
    result=build(args.folder)
    OUTPUT.write_text(json.dumps(result,ensure_ascii=False,separators=(",",":"))+"\n",encoding="utf-8",newline="\n")
    print(f"{len(result['sprites'])} sprites from {len(result['sources'])} sheets; {len(result['inventory'])} supplied files inventoried")
