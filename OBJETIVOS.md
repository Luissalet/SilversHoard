# Objetivos de Silver's Hoard

Lo que falta por construir, de más a menos valor. Lo que ya hace está en el [README](README.es.md).

1. **Combates en directo entre amigos.** Hoy un amigo juega contra la IA de tu gimnasio en la página jugable. Siguiente paso:
   dos personas en dos equipos distintos, con el Hub como intermediario o un enlace temporal.
2. **Códigos de resultado firmados.** Firmar el código con una clave del gimnasio para que una medalla no se pueda inventar.
3. **Repeticiones en vídeo.** Exportar un combate como clip para el editor de vídeo de la familia.
4. **El copiloto comenta la jugada.** Faustus explica por qué la IA eligió un movimiento, con el cálculo del motor.
5. **Tiempo real en la página jugable.** Que un amigo pueda retar tu gimnasio en tiempo real desde el HTML que le mandas: el
   motor ya corre en el navegador; falta la pantalla en la página y que el código de resultado lleve las pulsaciones para
   repetirlo aquí.
6. **Tiempo real en dobles.** Dos Pokémon por entrenador en la arena, con objetivo elegible.
7. **Megaevolución y movimientos Plus en tiempo real**, como en Leyendas Z-A (barra de megaenergía, versiones mejoradas).
8. **Arena más ligera.** La pantalla de tiempo real carga los datos completos de `@pkmn/sim` (unos 6 MB); con `@pkmn/dex` y
    solo las generaciones en uso bajaría a la mitad.
9. **Sprites dibujados con varias poses.** Pedir a Prospero la misma persona de frente (entrenador rival) y de espaldas (lado
    del jugador), y una pose de victoria para el final del combate.
10. **Los personajes que faltan.** Los equipos de la Torre Batalla de Diamante Brillante y Perla Reluciente, Noland, Argenta
    y Thorton (sus tablas usan otra plantilla en la wiki) y los de Leyendas Pokémon: Arceus.
11. **Fijar al rival con efecto en tiempo real.** Hoy Mayús / ZL fija la mira y enciende los movimientos; en Z-A además el
    Pokémon se mueve de cara al rival (desplazamiento lateral): hace falta una entrada más en el simulador y en las repeticiones.
