import React from "react";
import { ARENA_ART } from "./arena-art.js";

export const W = 28;
export const H = 17;
export const HOME = [{ x: 5, y: 8.5 }, { x: 23, y: 8.5 }];
const CLEAR = 1.2;
export const FLOORS = { grass: ["#4f8a4a", "#4a8345"], sand: ["#d7bd86", "#cfb47c"], ice: ["#cfe6f0", "#c4dfeb"], cave: ["#4b4239", "#463e35"],
  indoor: ["#b5875a", "#ad7f53"], water: ["#4f8fbf", "#4a88b6"],
  // places from the games: their decor and ambience are drawn in the battle (battle/rt/places.js)
  pyre: ["#b8d0cb", "#b0c8c3"], summit: ["#e8f0f5", "#dfe8ee"], meteor: ["#6d6283", "#665b7c"], champion: ["#3f7f86", "#3a777e"], castle: ["#ddd6c1", "#d5ceb8"] };
export const blocked = (rk) => HOME.some((h) => Math.hypot(h.x - rk.x, h.y - rk.y) < rk.r + CLEAR);

/** The field as a picture: ground, lines, entry spots and rocks (for the list, small; for the editor, with handles). */
export function ArenaField({ floor = "grass", rocks = [], ghosts = [], selected = -1, onDown, svgRef, small = false }) {
  const [a, b] = FLOORS[floor] || FLOORS.grass;
  return (
    <svg ref={svgRef} className={`arena-svg ${small ? "is-small" : ""}`} viewBox={`-2.6 -0.6 ${W + 5.2} ${H + 1.2}`} onPointerDown={onDown}
      role="img" aria-label="arena">
      <rect x={-2.6} y={-0.6} width={W + 5.2} height={H + 1.2} fill="#1d2a22" />
      {Array.from({ length: W / 2 }, (_, i) => <rect key={i} x={i * 2} y={0} width={2} height={H} fill={i % 2 ? b : a} />)}
      {ARENA_ART[floor] && <image href={ARENA_ART[floor]} x={0} y={0} width={W} height={H} preserveAspectRatio="none" pointerEvents="none" />}
      <rect x={0} y={0} width={W} height={H} fill="none" stroke="rgba(255,255,255,.55)" strokeWidth={0.08} />
      <line x1={W / 2} y1={0} x2={W / 2} y2={H} stroke="rgba(255,255,255,.55)" strokeWidth={0.08} />
      <circle cx={W / 2} cy={H / 2} r={2.6} fill="none" stroke="rgba(255,255,255,.55)" strokeWidth={0.08} />
      <rect x={-2.3} y={H / 2 - 2.2} width={2.1} height={4.4} fill="rgba(0,0,0,.25)" />
      <rect x={W + 0.2} y={H / 2 - 2.2} width={2.1} height={4.4} fill="rgba(0,0,0,.25)" />
      {!small && HOME.map((h, i) => <circle key={i} cx={h.x} cy={h.y} r={0.6} fill="rgba(255,255,255,.25)" stroke="rgba(255,255,255,.7)" strokeDasharray="0.25 0.2" strokeWidth={0.06} />)}
      {ghosts.map((rk, i) => <circle key={`g${i}`} cx={rk.x} cy={rk.y} r={rk.r} className="arena-rock is-ghost" />)}
      {rocks.map((rk, i) => (
        <g key={i} data-rock={i}>
          <circle cx={rk.x + rk.r * 0.2} cy={rk.y + rk.r * 0.28} r={rk.r} fill="rgba(10,20,10,.35)" />
          <circle cx={rk.x} cy={rk.y} r={rk.r} data-rock={i} className={`arena-rock ${i === selected ? "is-on" : ""} ${blocked(rk) ? "is-bad" : ""}`} />
        </g>
      ))}
    </svg>
  );
}

