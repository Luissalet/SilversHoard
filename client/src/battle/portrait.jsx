import React, { useState } from "react";
import "./portrait.css";

export function FormatPicker({ aspect, onChange, lang }) {
  return <div className="seg battle-format" role="group" aria-label={lang === "en" ? "Frame format" : "Formato del encuadre"}>
    <button type="button" aria-pressed={aspect === "landscape"} onClick={() => onChange("landscape")}>Horizontal · 16:9</button>
    <button type="button" aria-pressed={aspect === "portrait"} onClick={() => onChange("portrait")}>Vertical · 9:16</button>
  </div>;
}

export default function BattlePresentation({ children, lang }) {
  const [aspect, setAspect] = useState("landscape");
  return <div className="space-y-3">
    <FormatPicker aspect={aspect} onChange={setAspect} lang={lang} />
    <div className={aspect === "portrait" ? "portrait-layout battle-portrait" : undefined}>{children}</div>
  </div>;
}
