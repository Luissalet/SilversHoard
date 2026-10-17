// Standing overworld spectators. The atlas travels with the app and standalone page.
import { image } from "./pmd.js";
import { TRAINER_ATLAS, CROWD_TRAINERS } from "./art/crowd/atlas.js";

export { CROWD_TRAINERS };

/** Replace about two fifths of an existing Pokémon crowd, without changing its places or its input. */
export function mixTrainerCrowd(members, seed) {
  let h = 7;
  for (const ch of `trainers:${seed}`) h = (h * 31 + ch.charCodeAt(0)) % 2147483647;
  const next = () => { h = h * 16807 % 2147483647; return h / 2147483647; };
  const seats = members.map((_, i) => i), trainers = [...CROWD_TRAINERS];
  const shuffle = (items) => {
    for (let i = items.length - 1; i > 0; i--) {
      const j = Math.floor(next() * (i + 1));
      [items[i], items[j]] = [items[j], items[i]];
    }
  };
  shuffle(seats);
  shuffle(trainers);
  const humans = new Map();
  const count = Math.min(Math.round(members.length * 0.4), trainers.length);
  for (let i = 0; i < count; i++) humans.set(seats[i], trainers[i]);
  return members.map((member, i) => humans.has(i) ? { ...member, num: null, trainer: humans.get(i) } : { ...member });
}

/** RMXP sheet rows: down, left, right, up. The bottom row of spectators faces up. */
export function crowdTrainerDirection(fx, fy) {
  return Math.abs(fy) > Math.abs(fx) ? (fy < 0 ? 3 : 0) : (fx < 0 ? 1 : 2);
}

export function loadCrowdTrainerAtlas() {
  return typeof Image === "undefined" ? null : image(TRAINER_ATLAS);
}

export function drawCrowdTrainer(ctx, trainer, x, y, fx, fy, height) {
  const sheet = loadCrowdTrainerAtlas();
  if (!sheet?.ready) return false;
  const i = CROWD_TRAINERS.indexOf(trainer), direction = crowdTrainerDirection(fx, fy);
  if (i < 0) return false;
  const [w, h] = trainer.sizes[direction];
  const k = height / Math.max(...trainer.sizes.map((size) => size[1]));
  const sx = ((i % 8) * 4 + direction) * 64 + Math.floor((64 - w) / 2);
  const sy = Math.floor(i / 8) * 64 + 64 - h;
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(sheet.img, sx, sy, w, h, Math.round(x - w * k / 2), Math.round(y - h * k), Math.round(w * k), Math.round(h * k));
  ctx.restore();
  return true;
}
