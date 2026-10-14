# Silver's Hoard

Un simulador de combates Pokémon local de la familia Hoard. Funciona con el motor de combate de Pokémon Showdown (a través de `@pkmn/sim`), así que todas las generaciones de la 1 a la 9, individuales y dobles, se juegan con las mecánicas reales. Guardas entrenadores, combates contra ellos o los ves combatir, montas gimnasios y ligas, y mandas tus entrenadores y gimnasios a tus amigos como una página que abren en cualquier navegador.

[English version](README.md)

![Combate](docs/screens/battle.png)

## Qué hace

- **Entrenadores.** Nombre, título, equipo, nivel y estilo de IA, imagen y cuatro frases de combate (al empezar, último Pokémon, al ganar, al perder). Se crean pegando lo que exporta Showdown (o PokéPaste, JSON, un equipo empaquetado), con el editor visual de equipos (especie, objeto, habilidad, naturaleza, teratipo, EV, IV y movimientos, con sugerencias limitadas a lo que aprende la especie) o sacando uno aleatorio de los sets de Random Battle de Showdown. Duplicar, favoritos, papelera y recuperar.
- **Personajes de los juegos.** Los equipos reales de los líderes de gimnasio, Alto Mando, campeones, rivales y jefes de Cristal (Johto y Kanto, con Rojo en el Monte Plateado), Rojo Fuego/Verde Hoja y Esmeralda, con sus niveles, movimientos y objetos. Se añade un entrenador o una liga entera: sus ocho gimnasios con medallas y tipos, el Alto Mando y el campeón, con cada gimnasio limitado al nivel de su líder.
- **Combates.** Tú contra la IA, dos personas en el mismo ordenador o dos IA (se juega en segundo plano y luego se ve la repetición). La pantalla de combate muestra los dos bandos con sus sprites, PS, estados, cambios de características, teracristalización, tiempo, campo y trampas; un registro en castellano o inglés (movimientos, habilidades y objetos con su nombre en español); controles de movimientos (con tipo, potencia, PP y Teracristal / Mega / Z / Dinamax cuando la generación los tiene), objetivos en dobles, cambios, vista previa de equipos y rendirse. Los combates terminados se repiten con reproducir, pausa, paso a paso, saltar a un turno y cuatro velocidades. Los combates en juego sobreviven a un reinicio.
- **La IA.** Cinco niveles: al azar, fácil, normal, difícil (la mejor opción calculada en cada turno: daño medido con la fórmula del propio juego sobre una copia del combate, estados, mejoras, trampas, recuperación, cambios, teracristalización) y experto (en individuales juega cada turno candidato en copias del combate contra las respuestas probables del rival y se queda con el de mejor resultado). Cinco estilos: equilibrado, agresivo, defensivo, mejoras y desgaste.
- **Series y torneos.** Los mismos dos entrenadores N veces (porcentaje de victorias, turnos medios, KO, daño y supervivencia de cada Pokémon, el MVP de cada lado y un combate de ejemplo de cada resultado), o un torneo de hasta 64 entrenadores: eliminatoria con exentos o liguilla con clasificación, al mejor de 1, 3, 5 o 7. Van como trabajos en segundo plano.
- **Gimnasios y ligas.** Un gimnasio tiene entrenadores (en orden) y un líder, un tipo, una medalla con su color y reglas (nivel fijo, nivel máximo, nivel mínimo, reglas extra de Showdown). Lo retas tú o dejas que lo haga la IA de tu entrenador; entre combates tu equipo se cura; ganar todos los combates da la medalla. Una liga pide sus medallas y luego el Alto Mando y el campeón; quien la supera entra en el Hall de la Fama. Un reto puede jugarse con la generación del gimnasio o con las reglas actuales.
- **Amigos.** Exporta un entrenador, gimnasio o liga como archivo (`.hoardtrainer`, `.hoardgym`, `.hoardleague`) para otro Silver's Hoard, como código para pegar en un chat, el equipo como texto de Showdown, o como **página jugable**: un solo HTML con el motor de combate y la IA dentro. Tu amigo lo abre en cualquier navegador, pega o genera un equipo y combate contra tu gimnasio o entrenador; al acabar la página le da un código de resultado (y un archivo con la repetición). Al importarlo aquí queda su combate y, si ganó, su medalla.
- **Imágenes.** Cualquiera de los 1.500 sprites de entrenador de Showdown, una imagen subida, una foto convertida aquí en un sprite de 96 px en pixel art (sin fondo, pocos colores, contorno), o un sprite de entrenador dibujado por Prospero's Hoard a partir de la foto con su motor de imagen (un trabajo; eliges entre los resultados).
- **Frases con IA.** El modelo de la familia (por Hoard Hub: las Sparks, Faustus u Ollama) escribe las cuatro frases de un entrenador a partir de su equipo y de la personalidad que describas.
- **Familia.** El copiloto de Faustus en todas las páginas, un servidor MCP con 48 herramientas (`mcp_server.py`), eventos en el bus de la familia y el aspecto común de los Hoards.

## Qué no hace

- No hay combates en línea entre dos copias de la app: tus amigos juegan tus gimnasios y entrenadores contra la IA en la página jugable y te mandan el resultado.
- No trae arte de Pokémon ni en el repositorio ni en la app: los sprites se descargan del servidor de sprites de Showdown la primera vez que hacen falta y se guardan en `data/cache/sprites`. Sin internet el campo muestra iniciales hasta tenerlos guardados.
- La IA conoce los dos equipos, como los entrenadores de los juegos. El nivel experto busca solo en individuales; en dobles juega como difícil.
- Los códigos de resultado no van firmados: son un registro entre amigos, no una prueba.
- Los equipos de los juegos cubren las generaciones 2 y 3 (los juegos con desensamblado completo de la comunidad); los personajes de otras generaciones se pueden montar a mano.

## Instalar y arrancar

```bash
npm ci                       # Node.js 20 o superior: el motor y el cliente
npm run build                # la interfaz y la plantilla de la página jugable
python -m venv venv && venv/Scripts/pip install -r requirements.txt   # o venv/bin/pip en Linux y macOS
venv/Scripts/python -m silvers_hoard    # http://127.0.0.1:5206
```

Hoard Hub la encuentra por `faustus-plugin.json`. Los datos van en `data/` (o `SILVER_DATA_DIR`): `silver.db`, imágenes, exportaciones y la caché de sprites.

## Para asistentes

`python mcp_server.py` es un puente MCP por stdio a la app en marcha (la arranca si hace falta). Las herramientas cubren toda la app: `battle_start` / `battle_choose` para jugar, `series_start` y `tournament_start`, `challenge_start`, `canon_install`, `export` / `import`, `avatar_from_photo`, `trainer_dialogue_write` y el resto (`GET /api/agent/tools`).

## Créditos

Motor de combate: Pokémon Showdown de Guangcong Luo y colaboradores, a través de los paquetes `@pkmn` (MIT). Equipos de los juegos sacados de los desensamblados de pret (pokecrystal, pokefirered, pokeemerald). Nombres en español de movimientos, habilidades, objetos y naturalezas de los datos de PokeAPI. Los sprites los sirve el servidor de sprites de Showdown.

Es un proyecto de fans sin relación con Nintendo, Game Freak, Creatures ni The Pokémon Company. Pokémon y los nombres relacionados son marcas de sus dueños.

## Licencia

MIT (código). Ver [LICENSE](LICENSE).
