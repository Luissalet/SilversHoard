// A quarter-turn of the picture only. World coordinates and input logs stay unchanged.
export function portraitPoint(x, y, worldWidth) { return { x: y, y: worldWidth - x }; }
export function portraitFacing(fx, fy) { return { fx: fy, fy: -fx }; }
export function worldInput(input, portrait) {
  return portrait ? {...input, mx: -(input.my || 0), my: input.mx || 0} : input;
}

export function portraitHeight(frame) {
  if (typeof getComputedStyle !== "function" || !frame.querySelector) return frame.clientHeight * .5;
  const style = getComputedStyle(frame);
  const title = frame.querySelector(".video-title")?.offsetHeight || 0;
  const top = frame.querySelector(".rt-top");
  const hud = top && getComputedStyle(top).position !== "absolute" ? top.offsetHeight : 0;
  return Math.max(80, frame.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom) - title - hud - 32);
}

export function upright(ctx, x, y, portrait, draw) {
  ctx.save();
  if (portrait) { ctx.translate(x, y); ctx.rotate(Math.PI / 2); ctx.translate(-x, -y); }
  try { return draw(); } finally { ctx.restore(); }
}

export function presentPortrait(target, world) {
  const ctx = target.getContext("2d");
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, target.width, target.height);
  ctx.translate(0, target.height);
  ctx.rotate(-Math.PI / 2);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(world, 0, 0);
  ctx.restore();
  return ctx;
}
