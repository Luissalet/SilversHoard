// What the app made up (a character's trainer, the gyms and leagues of the games, a random trainer, a ready-made mass battle) comes
// from the server with its words in both languages (`i18n`, silvers_hoard/names_i18n.py); anything the user typed has none and
// shows as it is.
export function loc(obj, lang, field = "name") {
  if (!obj) return "";
  const own = obj.i18n?.[lang === "en" ? "en" : "es"]?.[field];
  return own ?? obj[field] ?? "";
}
