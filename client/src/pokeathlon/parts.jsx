// Small pieces several screens of the Pokéathlon page share.
import React from "react";
import { useApp } from "../context.js";
import { STAT_COLORS } from "./strings.js";

/** The three Pokémon of a team as small pictures. */
export function TeamIcons({ team, size = 28 }) {
  const { sprites } = useApp();
  return (
    <span className="pk-icons">
      {team.mons.map((m, i) => (
        <img key={i} src={sprites.fallback(m.species)} alt="" title={m.name} width={size} height={size} className="pixelated" loading="lazy" />
      ))}
    </span>
  );
}

export function MedalBadge({ stat, size = 56 }) {
  const color = STAT_COLORS[stat] || "#aaa";
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} role="img" aria-hidden="true" className="pk-medal">
      <circle cx="32" cy="32" r="28" fill={color} stroke="rgba(255,255,255,.65)" strokeWidth="3" />
      <circle cx="32" cy="32" r="21" fill="none" stroke="rgba(0,0,0,.28)" strokeWidth="2" />
      <path d="M32 15l4.6 9.7 10.6 1.3-7.8 7.3 2 10.5L32 38.6l-9.4 5.2 2-10.5-7.8-7.3 10.6-1.3z" fill="rgba(255,255,255,.92)" />
    </svg>
  );
}
