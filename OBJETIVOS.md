# Objetivos de Silver's Hoard

Lo que falta por construir, de más a menos valor. Lo que ya hace está en el [README](README.es.md).

1. **Combates en directo entre amigos.** Hoy un amigo juega contra la IA de tu gimnasio en la página jugable. Siguiente paso:
   dos personas en dos equipos distintos, con el Hub como intermediario o un enlace temporal.
2. **Códigos de resultado firmados.** Firmar el código con una clave del gimnasio para que una medalla no se pueda inventar.
3. **Ligas listas de más juegos.** Los personajes de las nueve generaciones ya están con sus equipos juego a juego; falta
   montar con ellos las ligas completas (gimnasios, medallas, Alto Mando y campeón) de Rojo/Azul, Platino, HGSS, Negro/Blanco,
   X/Y, Sol/Luna, Espada/Escudo y Escarlata/Púrpura, como ya existen las de Cristal, RFVH y Esmeralda.
4. **Calculadora de daño en el editor de equipos.** El motor ya la tiene (`damage_calc`: las 16 tiradas, crítico, KO, con
   mejoras, tera, tiempo, campo y pantallas); falta la herramienta de la app y el panel del editor: rango de daño de cada
   movimiento contra un rival elegido.
5. **Repeticiones en vídeo.** Exportar un combate como clip para el editor de vídeo de la familia.
6. **El copiloto comenta la jugada.** Faustus explica por qué la IA eligió un movimiento, con el cálculo del motor.
7. **Tiempo real en la página jugable.** Que un amigo pueda retar tu gimnasio en tiempo real desde el HTML que le mandas: el
   motor ya corre en el navegador; falta la pantalla en la página y que el código de resultado lleve las pulsaciones para
   repetirlo aquí.
8. **Tiempo real en dobles.** Dos Pokémon por entrenador en la arena, con objetivo elegible.
9. **Megaevolución y movimientos Plus en tiempo real**, como en Leyendas Z-A (barra de megaenergía, versiones mejoradas).
10. **Arena más ligera.** La pantalla de tiempo real carga los datos completos de `@pkmn/sim` (unos 6 MB); con `@pkmn/dex` y
    solo las generaciones en uso bajaría a la mitad.
11. **Sprites dibujados con varias poses.** Pedir a Prospero la misma persona de frente (entrenador rival) y de espaldas (lado
    del jugador), y una pose de victoria para el final del combate.
12. **Objetos de la bolsa en combate.** Los personajes traen sus Restaurar Todo, Hiperpociones y demás; la IA podría usarlos
    como en los juegos (una vez por Pokémon, por debajo de cierto PS).
