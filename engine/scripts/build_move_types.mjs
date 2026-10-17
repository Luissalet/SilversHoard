// Writes client/src/battle/move-types.json: every move's type as passive data, so the battle screen can tint the launch sound of a
// move that the log only names. Run from the repo root: node engine/scripts/build_move_types.mjs
import { writeFileSync } from "node:fs";
import { Dex } from "@pkmn/sim";

const byType = {};
for (const m of Dex.moves.all()) {
  if (m.isNonstandard === "CAP" || m.isNonstandard === "Custom" || (m.id.startsWith("hiddenpower") && m.id !== "hiddenpower")) continue;
  (byType[m.type] ||= []).push(m.id);
}
const packed = Object.fromEntries(Object.entries(byType).map(([t, ids]) => [t, ids.sort().join(" ")]));
const map = {};
for (const [type, ids] of Object.entries(packed)) for (const id of ids.split(" ")) map[id] = type;
writeFileSync(new URL("../../client/src/battle/move-types.json", import.meta.url), JSON.stringify(map, null, 2) + "\n");
console.log(Object.keys(packed).length, "types");
