import React from "react";
import art from "../../../silvers_hoard/presets/supplied_sprites.json";

export const suppliedSprites = art.sprites;
export function spriteLabel(id, lang) {
  const sprite = suppliedSprites[id];
  return sprite ? (lang === "es" ? sprite.name_es : sprite.name) : id;
}

export default function SuppliedSprite({ id, size = 32, className = "", style }) {
  const sprite = suppliedSprites[id];
  return sprite ? <img className={`supplied-sprite ${className}`} src={sprite.image} width={size} height={size}
    style={{ objectFit: "contain", imageRendering: "pixelated", flexShrink: 0, ...style }} alt="" aria-hidden="true" draggable={false} /> : null;
}
