# Objetivos de Silver's Hoard

Lo que falta por construir, de más a menos valor. Lo que ya hace está en el [README](README.es.md).

1. **Combates en directo entre amigos.** Hoy un amigo juega contra la IA de tu gimnasio en la página jugable. Siguiente paso:
   dos personas en dos equipos distintos, con el Hub como intermediario o un enlace temporal.
2. **Códigos de resultado firmados.** Firmar el código con una clave del gimnasio para que una medalla no se pueda inventar.
3. **Más personajes de los juegos.** Primera generación (Rojo/Azul/Amarillo, desensamblado pret completo) y, cuando sus
   desensamblados lo permitan, Platino y Oro HeartGold/Plata SoulSilver.
4. **IA experta en dobles.** La búsqueda por copias del combate solo se usa en individuales; en dobles juega como difícil.
5. **Calculadora de daño en el editor de equipos.** Rango de daño de cada movimiento contra un rival elegido.
6. **Repeticiones en vídeo.** Exportar un combate como clip para el editor de vídeo de la familia.
7. **El copiloto comenta la jugada.** Faustus explica por qué la IA eligió un movimiento, con el cálculo del motor.
8. **Tiempo real en la página jugable.** Que un amigo pueda retar tu gimnasio en tiempo real desde el HTML que le mandas: el
   motor ya corre en el navegador; falta la pantalla en la página y que el código de resultado lleve las pulsaciones para
   repetirlo aquí.
9. **Tiempo real en dobles.** Dos Pokémon por entrenador en la arena, con objetivo elegible.
10. **Megaevolución y movimientos Plus en tiempo real**, como en Leyendas Z-A (barra de megaenergía, versiones mejoradas).
11. **Arena más ligera.** La pantalla de tiempo real carga los datos completos de `@pkmn/sim` (unos 6 MB); con `@pkmn/dex` y
    solo las generaciones en uso bajaría a la mitad.
