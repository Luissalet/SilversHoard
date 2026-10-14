// Words of the playable page (Spanish first, English second).
const S = {
  from: ["{name} te reta", "{name} challenges you"],
  gym_intro: ["Gimnasio", "Gym"],
  trainer_intro: ["Entrenador", "Trainer"],
  leader: ["Líder", "Leader"],
  then_leader: ["{n} entrenadores y después el líder", "{n} trainers and then the leader"],
  only_leader: ["Directamente contra el líder", "Straight against the leader"],
  format: ["Formato", "Format"],
  level_fixed: ["Todos al nivel {n}", "Everyone at level {n}"],
  level_cap: ["Nivel máximo {n}", "Level cap {n}"],
  level_min: ["Nivel mínimo {n}", "Minimum level {n}"],
  your_name: ["Tu nombre", "Your name"],
  your_team: ["Tu equipo", "Your team"],
  tab_paste: ["Pegar de Showdown", "Paste from Showdown"],
  tab_random: ["Aleatorio", "Random"],
  tab_file: ["Archivo de entrenador", "Trainer file"],
  paste_ph: ["Pega aquí el equipo exportado desde Showdown o PokéPaste", "Paste the team exported from Showdown or PokéPaste"],
  roll: ["Otro equipo aleatorio", "Another random team"],
  file_help: ["Un .hoardtrainer que te haya dado Silver's Hoard.", "A .hoardtrainer from Silver's Hoard."],
  check: ["Comprobar", "Check"],
  team_ok: ["Equipo listo", "Team ready"],
  problems: ["Problemas con las reglas:", "Rule problems:"],
  start: ["Empezar el reto", "Start the challenge"],
  stage: ["Combate {n} de {total}", "Battle {n} of {total}"],
  next: ["Siguiente: {name}", "Next: {name}"],
  won_all: ["¡Has ganado la {badge}!", "You earned the {badge}!"],
  won_trainer: ["¡Has vencido a {name}!", "You beat {name}!"],
  lost_to: ["Has perdido contra {name}", "You lost to {name}"],
  result_code: ["Código de resultado", "Result code"],
  result_help: ["Mándaselo a {name}: lo pega en su Silver's Hoard y tu combate queda registrado.", "Send it to {name}: they paste it in their Silver's Hoard and your battle is recorded."],
  copy: ["Copiar", "Copy"],
  copied: ["Copiado", "Copied"],
  download_result: ["Descargar resultado con la repetición", "Download the result with the replay"],
  retry: ["Volver a intentarlo", "Try again"],
  no_data: ["Esta página es la plantilla de Silver's Hoard: expórtala desde la app con un gimnasio o un entrenador.", "This page is Silver's Hoard's template: export it from the app with a gym or a trainer."],
  language: ["English", "Español"],
  thinking: ["El rival está pensando…", "The opponent is thinking…"],
  badge: ["medalla", "badge"],
  made_with: ["Hecho con Silver's Hoard · motor de Pokémon Showdown", "Made with Silver's Hoard · Pokémon Showdown engine"],
};

export function playT(lang) {
  const i = lang === "en" ? 1 : 0;
  return (key, vars) => {
    let v = (S[key] || [key, key])[i];
    if (vars) for (const [k, x] of Object.entries(vars)) v = v.replaceAll(`{${k}}`, String(x));
    return v;
  };
}
