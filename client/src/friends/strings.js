const copy = {
  home: ["Inicio de Silver", "Silver home"],
  playMenu: ["Modos de juego", "Game modes"],
  practice: ["Combate contra la IA", "Battle the AI"],
  practiceHelp: ["Trae tu equipo o prueba uno aleatorio.", "Bring your own team or try a random one."],
  friendsHelp: ["Crea una sala privada por invitación.", "Create a private room by invitation."],
  desktop: ["Proyecto y aplicación de escritorio", "Project and desktop app"],
  title: ["Jugar con un amigo", "Play with a friend"],
  description: ["Un duelo por turnos desde dos navegadores.", "A turn-based duel from two browsers."],
  host: ["Crear sala", "Create room"],
  hostTab: ["Crear", "Create"],
  guest: ["Unirme", "Join"],
  name: ["Tu nombre", "Your name"],
  team: ["Tu equipo de Showdown", "Your Showdown team"],
  fixed: ["Nivel fijo", "Fixed level"],
  ruleset: ["Reglamento", "Ruleset"],
  builtIn: ["Formatos de Silver", "Silver formats"],
  saved: ["Reglamentos importados", "Imported rulesets"],
  custom: ["Importar reglamento JSON", "Import ruleset JSON"],
  offer: ["Invitación", "Invitation"],
  offer_help: ["Envíale esta invitación a tu amigo y deja la pestaña abierta. Cuando te responda, pega su código aquí.", "Send this invitation to your friend and keep this tab open. When they reply, paste their code here."],
  response: ["Código de respuesta", "Response code"],
  response_help: ["Devuelve el código a quien creó la sala y deja esta pestaña abierta.", "Send the code back to the host and keep this tab open."],
  copy: ["Copiar", "Copy"],
  copied: ["Copiado", "Copied"],
  join: ["Generar respuesta", "Generate response"],
  connect: ["Conectar", "Connect"],
  connecting: ["Conectando con tu amigo…", "Connecting to your friend…"],
  preparing: ["Preparando la conexión…", "Preparing the connection…"],
  waiting: ["Esperando a tu amigo…", "Waiting for your friend…"],
  connectingTeam: ["Conectados. Preparando el combate…", "Connected. Setting up the battle…"],
  newRoom: ["Volver al inicio", "Back to start"],
  cancelRoom: ["Salir de la sala", "Leave room"],
  leave: ["¿Salir de la sala? Se cerrará la conexión con tu amigo.", "Leave the room? This closes the connection to your friend."],
  disconnected: ["Se ha perdido la conexión. Si no se recupera, vuelve al inicio y crea otra sala.", "Connection lost. If it does not recover, return to the start and create another room."],
  failed: ["No se pudo conectar. Revisad que ambas pestañas sigan abiertas. Si la red bloquea la conexión directa, esta sala necesitará un repetidor TURN.", "Could not connect. Check that both tabs are open. If the network blocks a direct connection, this room will need a TURN relay."],
  signal: ["El código no corresponde a esta sala. Comprueba que lo has copiado entero.", "The code does not match this room. Check that you copied the whole code."],
  invalidRules: ["El reglamento no es válido. Elige un formato individual o doble con equipos propios.", "The ruleset is invalid. Choose a singles or doubles format with custom teams."],
  invalidTeam: ["Escribe tu nombre y pega un equipo de Showdown.", "Enter your name and paste a Showdown team."],
  invalidChoice: ["Esa acción ya no está disponible. Vuelve a elegir.", "That choice is no longer available. Choose again."],
  noBrowser: ["Abre la página por HTTPS o desde localhost en un navegador compatible con WebRTC.", "Open this page over HTTPS or localhost in a browser that supports WebRTC."],
  artFailed: ["No se pudo cargar la biblioteca PMD de esta página.", "This page's PMD library could not be loaded."],
  credits: ["Créditos de los recursos", "Asset credits"],
  forfeit: ["¿Te rindes?", "Forfeit?"],
  won: ["Ha ganado {name}", "{name} won"],
  tied: ["Empate", "Tie"],
};

export function friendsText(lang, key, params = {}) {
  return copy[key][lang === "en" ? 1 : 0].replace(/\{(\w+)\}/g, (match, id) => params[id] ?? match);
}

export function initialWebLang() {
  const requested = new URLSearchParams(location.search).get("lang");
  return requested === "es" || requested === "en" ? requested : navigator.language.startsWith("es") ? "es" : "en";
}
