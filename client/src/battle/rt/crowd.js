// Pick the audience once per battle, independently of the simulation's random stream.
import { crowdSpots } from "./places.js";

export function crowdMembers(battle) {
  if (!battle.dex?.species) return [];
  const floor = battle.floor || "grass";
  let h = 7;
  for (const ch of `${battle.seed}:crowd:${battle.id}:${floor}`) h = (h * 31 + ch.charCodeAt(0)) % 2147483647;
  h ||= 1;
  const rng = () => (h = h * 16807 % 2147483647) / 2147483647;
  const pool = battle.dex.species.all().filter((s) => s.exists && s.num > 0 && !s.forme && s.gen <= battle.gen);
  const members = [];
  for (const spot of crowdSpots()) {
    if (!pool.length || rng() < 0.2) continue;
    const i = Math.floor(rng() * pool.length);
    const species = pool[i];
    pool[i] = pool[pool.length - 1];
    pool.pop();
    members.push({ ...spot, num: species.num, species: species.name, small: spot.fy !== 0 });
  }
  return members;
}
