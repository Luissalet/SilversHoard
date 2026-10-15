# Objetivos de Silver's Hoard

Lo que falta por construir, de más a menos valor. Lo que ya hace está en el [README](README.es.md).

1. **Combates en directo entre amigos.** Hoy un amigo juega contra la IA de tu gimnasio en la página jugable. Siguiente paso:
   dos personas en dos equipos distintos, con el Hub como intermediario o un enlace temporal. Aparcado por decisión de Luis: primero el juego local.
2. **Códigos de resultado firmados.** Firmar el código con una clave del gimnasio para que una medalla no se pueda inventar.
3. **Modo campaña por juego.** Recorrer un juego de principio a fin con tu entrenador (rival, gimnasios, villanos, Alto Mando y
   campeón en el orden del juego, con topes de nivel), con los personajes ya cargados. Aparcado por decisión de Luis hasta
   terminar los modos y el pulido.
4. **Vídeo de combates en tiempo real.** Hoy se graban las repeticiones de los combates por turnos; los de tiempo
   real necesitan reproducir sus entradas en la arena sin ventana con el mismo ritmo.
5. **IA que no ve el equipo rival.** Hoy la IA conoce los dos equipos, como un entrenador del juego. Un nivel
   «de ranking» que solo vea lo revelado y prediga el resto con las estadísticas de uso de `smogon.py`.
6. **Modo Champions real** con los mods `champions` / `championsregmb` / `gen9legends` de Showdown 0.11 (fórmula de PS y SP, PP ≤ 20, formatos Reg M); `@pkmn/sim` 0.10.11 no los trae. Ágora #558.
7. **Créditos visibles** por especie (SpriteCollab) y por sprite de entrenador (Showdown pide crédito al artista). Ágora #560.
8. **Tiempo real: hitstop, temblor, aviso en el suelo antes de los movimientos de área y cut-in** al megaevolucionar, usar Z o teracristalizar (ideas de PokéBonk, código propio). Ágora #561.
9. **Clasificación entre amigos verificada re-simulando la repetición y reto de la semana** con semilla fija. Ágora #562.
10. **Pokémon Unbound jugable**: habilidades cambiadas (PUSE, MIT) y los entrenadores especiales de su Frontera re-derivados. Ágora #563.
11. **Animaciones de PokeRogue/Reborn** como estilo de alta fidelidad con sonido (785 con crédito; reproductor propio). Ágora #564.
