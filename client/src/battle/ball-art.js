import sheetUrl from "./ball-sheet.gen.js";
import { ballFrame } from "./ball-motion.js";
let sheet;
export function ballSheet() {
  if (!sheet && typeof Image !== "undefined") { sheet = new Image(); sheet.src = sheetUrl; }
  return sheet;
}
export function drawBallFrame(ctx, x, y, size, age, opening = false, reduced = false) {
  const image = ballSheet();
  if (!image?.complete || !image.naturalWidth) return false;
  const frame = ballFrame(age, opening, reduced);
  ctx.save();
  ctx.globalAlpha *= frame.opacity;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(image, frame.column * 64, frame.row * 64, 64, 64, x - size / 2, y - size / 2, size, size);
  ctx.restore();
  return true;
}
