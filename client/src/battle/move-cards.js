// Supplied titles are presentation only: no move rules or damage read this module.
import art from '../../../silvers_hoard/presets/supplied_sprites.json' with {type:'json'};

export const MOVE_CARD_SECONDS = 1.25;
const images = new Map();
const cards = new WeakMap();
const idOf = move => String(move || '').toLowerCase().replace(/[^a-z0-9]/g, '');

export function moveCardFor(move, lang = 'en', variant = 'usum') {
  const suffix = `${lang === 'es' ? 'es' : 'en'}-${idOf(move)}`;
  const id = `z-${variant}-${suffix}`;
  return art.sprites[id] ? id : art.sprites[`z-usum-${suffix}`] ? `z-usum-${suffix}` : null;
}

export function queueMoveCard(renderer, move, lang, time, life = MOVE_CARD_SECONDS) {
  const id = moveCardFor(move, lang);
  if (id) cards.set(renderer, {id, time, life});
  return !!id;
}

export function clearMoveCards(renderer) { cards.delete(renderer); }

export function moveCardActive(renderer, time) {
  const card = cards.get(renderer);
  if (!card) return false;
  if (time < card.time || time - card.time >= card.life) { cards.delete(renderer); return false; }
  return true;
}

export function drawMoveCard(ctx, renderer, time, width, height, reduced = false, top = .04) {
  if (!moveCardActive(renderer, time) || typeof Image === 'undefined') return;
  const {id, time: start, life} = cards.get(renderer), sprite = art.sprites[id];
  let img = images.get(id);
  if (!img) { img = new Image(); img.src = sprite.image; images.set(id, img); }
  if (!img.complete || !img.naturalWidth) return;
  const w = Math.min(width * .7, height * .22 * sprite.width / sprite.height);
  const h = w * sprite.height / sprite.width, age = time - start;
  ctx.save();
  const rate = life / MOVE_CARD_SECONDS;
  ctx.globalAlpha *= reduced ? 1 : Math.min(1, age / (.1 * rate), (life - age) / (.2 * rate));
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(img, (width - w) / 2, height * top, w, h);
  ctx.restore();
}
