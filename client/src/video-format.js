// Presentation only: the simulation and its saved inputs never depend on the frame.
export function videoFormat(size = "720p", aspect = "landscape") {
  const short = size === "1080p" ? 1080 : 720;
  const long = size === "1080p" ? 1920 : 1280;
  return aspect === "portrait" ? { width: short, height: long } : { width: long, height: short };
}

export function videoPreviewPath(id, { aspect = "landscape", speed = "normal", lang = "en", play_id = "" } = {}) {
  const query = new URLSearchParams({ aspect, lang });
  if (String(id).startsWith("mass_")) {
    query.set("mspeed", String({ slow: 1, normal: 2, fast: 4 }[speed] || 2));
    if (play_id) query.set("play", play_id);
  } else query.set("speed", String({ slow: 1300, normal: 900, fast: 550 }[speed] || 900));
  return `#/video/${encodeURIComponent(id)}?${query}`;
}
