// Drawing only. Embedded game textures are shared by the app, replay, videos and playable HTML.
import art from "../../../../silvers_hoard/presets/supplied_sprites.json" with { type: "json" };

const FRAMES = { Fire: ["fx-fire-0", "fx-fire-1"], Ice: Array.from({length: 8}, (_, i) => `fx-ice-shards-${i}`),
  Ghost: Array.from({length: 6}, (_, i) => `fx-shadow-ball-${i}`), Normal: ["fx-swift-0"] };
const loaded = new Map();
const impacts = new WeakMap();

export function frameFor(projectile, time, reduced = false) {
  // Swift's star is specific to Swift. Other Normal moves keep their own presentation.
  if (projectile.type === "Normal" && projectile.move !== "swift") return null;
  if (!["ball", "orb", "shard", "star", "shot", "projectile"].includes(projectile.shape)) return null;
  const atlas = `fx-sky-${String(projectile.type).toLowerCase()}`;
  if (art.sprites[atlas]) return atlas;
  const frames = FRAMES[projectile.type];
  return frames?.[(reduced ? 0 : Math.floor(Math.max(0, time) * 12)) % frames.length] || null;
}

export function queueSuppliedImpact(renderer, x, y, time) {
  const list = impacts.get(renderer) || [];
  list.push({x,y,time});
  impacts.set(renderer,list);
}

export function clearSuppliedImpacts(renderer) { impacts.delete(renderer); }

function drawFrame(ctx, id, frame, size) {
  let img = loaded.get(id);
  const sprite = art.sprites[id];
  if (!img) { img = new Image(); img.src = sprite.image; loaded.set(id, img); }
  if (!img.complete || !img.naturalWidth) return;
  if (sprite.frames) {
    const w=sprite.frame_width,h=sprite.frame_height;
    ctx.drawImage(img,frame%sprite.columns*w,Math.floor(frame/sprite.columns)*h,w,h,-size/2,-size/2,size,size);
  } else ctx.drawImage(img,-size/2,-size/2,size,size);
}

export function drawSuppliedProjectiles(ctx, renderer, view, reduced = false) {
  if (typeof Image === "undefined") return;
  for (const p of view.projectiles || []) {
    const id = frameFor(p, renderer.time, reduced);
    if (!id) continue;
    const sprite=art.sprites[id];
    const frame=sprite.frames ? (reduced ? 0 : Math.floor(Math.max(0,renderer.time)*sprite.fps)%sprite.frames) : 0;
    const size = Math.max(.45, Math.min(1.6, (p.r || .3) * 3)) * renderer.scale;
    ctx.save();
    ctx.translate(renderer.px(p.x), renderer.py(p.y - .6));
    ctx.imageSmoothingEnabled = false;
    drawFrame(ctx,id,frame,size);
    ctx.restore();
  }
  const sprite=art.sprites['fx-ranger-impact'];
  if (!sprite) return;
  const keep=[];
  for (const impact of impacts.get(renderer) || []) {
    const age=renderer.time-impact.time;
    if (age<0 || age>=sprite.frames/sprite.fps) continue;
    keep.push(impact);
    ctx.save();
    ctx.translate(renderer.px(impact.x),renderer.py(impact.y-.6));
    ctx.imageSmoothingEnabled=false;
    drawFrame(ctx,'fx-ranger-impact',reduced ? 0 : Math.floor(age*sprite.fps),renderer.scale*1.5);
    ctx.restore();
  }
  impacts.set(renderer,keep);
}
