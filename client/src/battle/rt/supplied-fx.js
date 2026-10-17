// Drawing only. Embedded game textures are shared by the app, replay, videos and playable HTML.
import art from "../../../../silvers_hoard/presets/supplied_sprites.json" with { type: "json" };

const FRAMES = { Fire: ["fx-fire-0", "fx-fire-1"], Ice: Array.from({length: 8}, (_, i) => `fx-ice-shards-${i}`),
  Ghost: Array.from({length: 6}, (_, i) => `fx-shadow-ball-${i}`), Normal: ["fx-swift-0"] };
const loaded = new Map();

export function frameFor(projectile, time, reduced = false) {
  // Swift's star is specific to Swift. Other Normal moves keep their own presentation.
  if (projectile.type === "Normal" && projectile.move !== "swift") return null;
  if (!["ball", "orb", "shard", "star", "shot", "projectile"].includes(projectile.shape)) return null;
  const frames = FRAMES[projectile.type];
  return frames?.[(reduced ? 0 : Math.floor(Math.max(0, time) * 12)) % frames.length] || null;
}

export function drawSuppliedProjectiles(ctx, renderer, view, reduced = false) {
  if (typeof Image === "undefined") return;
  for (const p of view.projectiles || []) {
    const id = frameFor(p, renderer.time, reduced);
    if (!id) continue;
    let img = loaded.get(id);
    if (!img) { img = new Image(); img.src = art.sprites[id].image; loaded.set(id, img); }
    if (!img.complete || !img.naturalWidth) continue;
    const size = Math.max(.45, Math.min(1.6, (p.r || .3) * 3)) * renderer.scale;
    ctx.save();
    ctx.translate(renderer.px(p.x), renderer.py(p.y - .6));
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, -size / 2, -size / 2, size, size);
    ctx.restore();
  }
}
