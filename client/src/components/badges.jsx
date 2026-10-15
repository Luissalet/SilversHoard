// Gym badge pictures: drawn shapes in the badge's colour, or a picture of your own (uploaded or drawn by Prospero). Shared by the
// app and the playable page, so it imports nothing from the app (no context, no API).
import React from "react";

const gear = (() => {
  const pts = [];
  for (let i = 0; i < 32; i++) {
    const a = (i / 32) * Math.PI * 2;
    const r = i % 4 < 2 ? 18 : 13.5;
    pts.push(`${(20 + Math.cos(a) * r).toFixed(1)} ${(20 + Math.sin(a) * r).toFixed(1)}`);
  }
  return `M${pts.join("L")}z`;
})();

export const BADGE_SHAPES = {
  hexagon: "M20 2l15 8.7v18.6L20 38 5 29.3V10.7z",
  boulder: "M13 3h14l10 10v14L27 37H13L3 27V13z",
  drop: "M20 2C20 2 7 17 7 26a13 13 0 0 0 26 0C33 17 20 2 20 2z",
  bolt: "M23 2L7 23h11l-3 15 18-22H22z",
  leaf: "M34 4C14 4 5 14 5 26c0 5 2 8 4 10 2-9 8-17 16-21-7 6-11 13-12 22 15 0 22-12 21-33z",
  flame: "M20 2c3 8 12 12 12 23a12 12 0 0 1-24 0c0-6 3-9 5-12 0 5 2 7 4 8-1-8 3-14 3-19z",
  heart: "M20 36S4 25 4 14a8 8 0 0 1 16-3 8 8 0 0 1 16 3c0 11-16 22-16 22z",
  star: "M20 2l5 12 13 1-10 9 3 13-11-7-11 7 3-13L2 15l13-1z",
  flake: "M20 2l3 9 9-4-4 9 9 3-9 3 4 9-9-4-3 9-3-9-9 4 4-9-9-3 9-3-4-9 9 4z",
  wing: "M3 30C8 14 22 6 37 5c-4 4-6 7-7 11 3-1 5-1 7 0-5 3-8 6-10 10 2 0 4 0 6 1-7 5-17 6-30 3z",
  gear,
  fist: "M8 14a4 4 0 0 1 4-4h16a6 6 0 0 1 6 6v10a10 10 0 0 1-10 10h-6A10 10 0 0 1 8 26z",
  eye: "M2 20C8 10 14 7 20 7s12 3 18 13c-6 10-12 13-18 13S8 30 2 20z",
  moon: "M26 3a17 17 0 1 0 11 27A14 14 0 1 1 26 3z",
  scale: "M20 2l16 6v12c0 9-7 15-16 18C11 35 4 29 4 20V8z",
  shell: "M20 36L4 14a18 14 0 0 1 32 0z",
  rainbow: "M3 30a17 17 0 0 1 34 0h-8a9 9 0 0 0-18 0z",
  crown: "M4 32V12l9 8 7-14 7 14 9-8v20z",
};

/** The shape that suits each type, offered first in the picker. */
export const TYPE_SHAPE = {
  Normal: "hexagon", Fire: "flame", Water: "drop", Electric: "bolt", Grass: "leaf", Ice: "flake", Fighting: "fist", Poison: "eye",
  Ground: "boulder", Flying: "wing", Psychic: "eye", Bug: "shell", Rock: "boulder", Ghost: "moon", Dragon: "scale", Dark: "moon",
  Steel: "gear", Fairy: "heart",
};

/** The URL of a badge picture: "file:<name>" (this app), {kind: "image", data} (a friend's file or page), or a plain URL. */
export function badgeImageUrl(image, base = "") {
  if (!image) return "";
  if (typeof image === "object") return image.kind === "image" && image.data ? `data:${image.mime || "image/png"};base64,${image.data}` : "";
  if (image.startsWith("file:")) return `${base}/api/avatars/${image.slice(5)}`;
  if (image.startsWith("shape:")) return "";
  return image;
}

function shapeOf(image) {
  if (!image) return "hexagon";
  if (typeof image === "object") return image.kind === "shape" && BADGE_SHAPES[image.shape] ? image.shape : "hexagon";
  return image.startsWith("shape:") && BADGE_SHAPES[image.slice(6)] ? image.slice(6) : "hexagon";
}

/** A badge: the picture when there is one, else the drawn shape (hexagon by default) in its colour. */
export function BadgeArt({ color = "#c0c0c0", size = 34, label = "", image = "", base = "" }) {
  const url = badgeImageUrl(image, base);
  if (url) return <img src={url} width={size} height={size} alt={label} title={label || undefined} className="gym-badge gym-badge-img" draggable={false} />;
  const d = BADGE_SHAPES[shapeOf(image)];
  const id = `bg-${String(color).replace(/[^a-z0-9]/gi, "")}`;
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" role={label ? "img" : undefined} aria-label={label || undefined} aria-hidden={label ? undefined : "true"} className="gym-badge">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.85" />
          <stop offset="0.35" stopColor={color} />
          <stop offset="1" stopColor={color} stopOpacity="0.65" />
        </linearGradient>
      </defs>
      <path d={d} fill={`url(#${id})`} stroke="#0008" strokeWidth="1.5" strokeLinejoin="round" />
      <path d={d} fill="#fff3" stroke="#fff8" strokeWidth="1.6" transform="translate(20 20) scale(0.55) translate(-20 -20)" />
    </svg>
  );
}
