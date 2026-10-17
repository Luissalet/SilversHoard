// What the app made up (a character's trainer, the gyms and leagues of the games, a random trainer, a ready-made mass battle) comes
// from the server with its words in both languages (`i18n`, silvers_hoard/names_i18n.py); anything the user typed has none and
// shows as it is.
export function loc(obj, lang, field = "name") {
  if (!obj) return "";
  const own = obj.i18n?.[lang === "en" ? "en" : "es"]?.[field];
  return own ?? obj[field] ?? "";
}

/** A battle's seat names for its log (useBattlePlayer's `names`): {p1: [saved, shown], p2: [...]}, shown in the reader's language. */
export function seatNames(battle, lang) {
  if (!battle?.p1 || !battle?.p2) return null;
  return { p1: [battle.p1.name || "", loc(battle.p1, lang)], p2: [battle.p2.name || "", loc(battle.p2, lang)] };
}

/** The winner's name: the battle keeps it cut to 40 characters, so the winning seat's (in the reader's language) when it is that one. */
export function winnerName(battle, lang) {
  const seat = battle?.winner_name && battle[battle.winner_side];
  return seat?.name?.startsWith(battle.winner_name) ? loc(seat, lang) : battle?.winner_name || "";
}

/** A battle's title ("Cup · A vs B", "Facility · 11 · Rival", or "A vs B" when it has none) with its trainers' names and its
 * challenge (gym, league, facility) in the reader's language. */
export function battleTitle(battle, lang) {
  if (!battle?.p1 || !battle?.p2) return battle?.title || "";
  const shown = { p1: loc(battle.p1, lang), p2: loc(battle.p2, lang) };
  if (!battle.title) return `${shown.p1} vs ${shown.p2}`;
  const swaps = ["p1", "p2"].map((s) => [battle[s].name, shown[s]]);
  if (battle.run) swaps.push([battle.run.target_name, loc(battle.run, lang, "target_name")]);
  if (battle.cup) swaps.push([battle.cup.title, loc(battle.cup, lang, "title")]);
  let title = battle.title;
  for (const [saved, mine] of swaps) if (saved && mine && saved !== mine) title = title.split(saved).join(mine);
  return title;
}
