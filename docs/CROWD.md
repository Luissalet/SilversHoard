# Arena audience

Real-time show mode mixes Pokémon from the generation's catalog with randomly selected overworld trainers at the existing edge seats. Around two fifths of occupied seats are human spectators; the seed fixes their identities and seats, with no duplicate trainer within a crowd. They face the court and use the existing cheering jumps. The crowd switch and plain style still hide the audience. Nothing enters the simulation or changes replay inputs.

The trainer atlas is embedded in the app and exported playable HTML. It needs no remote image service. Offline pages can show these trainers while Pokémon spectators retain their existing dependency on the app's PMD service.

## Sources and credits

277 distinct standing trainer designs are packed from two ZIP files supplied by the user: **FRLG Accurate NPC Megapack (Relic Castle Edition)**, compiled by SoulfulLex, and **Taiga's Trainer Sprites**, distributed by 0rdinarystrawberry, with assets credited to DiegoWT. The original full credit lists are retained in `client/src/battle/rt/art/crowd/CREDITS.txt`. Pokémon and its original graphics belong to their respective owners; these fan resources are not relicensed under the application's code licence.

`manifest.json` records each source archive hash, original member path, original PNG hash and cropped frame dimensions. Only the first standing column of each four-direction RMXP character sheet is packed, in down/left/right/up order. Cycling, surfing and other playable action sheets are excluded. Identical four-frame designs are deduplicated. Sprites are cropped on their alpha bounds and anchored at their feet without smoothing or repainting.

Rebuild with Pillow using:

```powershell
python scripts/build_crowd_trainers.py --frlg <megapack.zip> --taiga <trainer_overworld.zip>
```

[Bulbagarden's overworld trainer category](https://archives.bulbagarden.net/wiki/Category:Overworld_Trainer_sprites) was consulted as the additional reference supplied by the user. No images from that site are needed at runtime or included in this atlas.
