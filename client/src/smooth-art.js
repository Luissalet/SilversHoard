// a picture this size or smaller is pixel art: enlarged by whole steps, never smoothed
export const PIXEL_MAX = 200;

// Pixel art keeps hard pixels when it is enlarged; drawings, photos and artwork are smoothed instead. Any picture marked
// .pixelated that turns out bigger than PIXEL_MAX gets .is-art (image-rendering: auto), wherever it is on the page.
export function installSmoothArt(root = document) {
  const mark = (img) => {
    if (!(img instanceof HTMLImageElement) || !img.naturalWidth) return;
    img.classList.toggle("is-art", Math.max(img.naturalWidth, img.naturalHeight) > PIXEL_MAX);
  };
  root.addEventListener("load", (e) => mark(e.target), true);
  for (const img of root.querySelectorAll?.("img") || []) if (img.complete) mark(img);
}
