// Words of the sound controls (battle screens and the settings page), Spanish (castellano de España) first, English second.
export const SND = {
  snd_title: ["Sonido", "Sound"],
  snd_mute: ["Silenciar todo", "Mute everything"],
  snd_master: ["Volumen general", "Master volume"],
  snd_music: ["Música", "Music"],
  snd_sfx: ["Efectos", "Effects"],
  snd_cries: ["Gritos de Pokémon", "Pokémon cries"],
  snd_help: ["Los efectos se generan en el navegador. Los gritos y la música se bajan del servidor de audio de Showdown la primera vez y se guardan en el disco; sin conexión el combate suena solo con efectos.",
    "Effects are generated in the browser. Cries and music are fetched from the Showdown audio server the first time and kept on disk; offline, the battle plays with effects only."],
  snd_test: ["Probar", "Test"],
  snd_cache: ["{n} audios guardados ({mb} MB).", "{n} audio files kept ({mb} MB)."],
  snd_downloads: ["Descargar gritos y música que falten", "Download missing cries and music"],
  snd_downloads_help: ["Los audios no vienen con la app: se bajan la primera vez y se guardan en data/cache/audio.", "Audio does not ship with the app: it is fetched the first time and kept in data/cache/audio."],
};

export function sndT(lang) {
  const i = lang === "en" ? 1 : 0;
  return (key) => (SND[key] || [key, key])[i];
}
