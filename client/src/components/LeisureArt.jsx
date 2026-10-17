import React from "react";
import SuppliedSprite, { suppliedSprites } from "./SuppliedSprite.jsx";

// Geometric tokens for editable accessories and furniture, drawn from one stroke system.
const SHAPES = {
  ribbon: "M12 12L3 5v12l9-5 9 5V5l-9 7M10 14l-3 7M14 14l3 7",
  crown: "M3 7l5 4 4-8 4 8 5-4-3 13H6L3 7z",
  flower: "M12 9c-8-12-12 3-3 3-12 8 3 12 3 3 8 12 12-3 3-3 12-8-3-12-3-3z",
  leaf: "M4 20C-1 9 9 2 21 3c0 13-8 20-17 17L17 7",
  shell: "M12 20L3 11C0 0 24 0 21 11l-9 9zM12 20V5M12 20L7 7M12 20l5-13",
  anchor: "M12 3v17M8 7h8M3 12c0 12 18 12 18 0M2 15l1-3 3 1M18 13l3-1 1 3",
  star: "M12 2l3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1z",
  moon: "M19 18A9 9 0 016 4a9 9 0 0013 14z",
  heart: "M12 21L3 12C-4 2 9-2 12 7c3-9 16-5 9 5l-9 9z",
  stone: "M4 20L2 11l5-8 11 2 4 11-5 5z",
  desk: "M2 6h20v9H2zM5 15v7M19 15v7",
  chair: "M5 3h14v11H5zM4 14h16v4H4zM6 18v4M18 18v4",
  plant: "M8 14h8l-2 8h-4zM12 14V4M12 10C0 9 3 0 12 7M12 8c9-8 13 1 0 3",
  bed: "M3 4h18v18H3zM3 10h18M7 6h10v4H7z",
  shelf: "M3 2h18v20H3zM3 9h18M3 16h18M7 3v6M12 4v5M17 3v6",
  cushion: "M3 5Q12 8 21 5q-3 7 0 14-9-3-18 0 3-7 0-14z",
  rug: "M3 5h18v14H3zM7 8h10v8H7zM4 3v2M9 3v2M14 3v2M19 3v2M4 19v2M9 19v2M14 19v2M19 19v2",
  poster: "M4 2h16v20H4zM7 16l4-7 3 4 3-3v8H7z",
  lamp: "M7 2h10l4 10H3L7 2zM12 12v8M7 22h10",
};
export default function LeisureArt({ kind, size = 32 }) {
  if (suppliedSprites[kind]) return <SuppliedSprite id={kind} size={size} />;
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={SHAPES[kind] || SHAPES.star} /></svg>;
}
