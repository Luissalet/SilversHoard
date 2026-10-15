# Pendientes y cosas por revisar

Solo lo que no se puede cerrar desde aquí. Los errores encontrados se arreglan, no se apuntan.

- **Faustus carga el plugin al reiniciarse.** El manifiesto está en `plugins/silver/plugin.json` de Faustus; Hoard Hub ya
  lista la app y su puente de herramientas funciona sin reiniciar nada.
- **Tiempo real, batalla campal y mapas de gimnasio con un mando de verdad.** El teclado (fijar con Mayús, rombo I L K J, voltereta, Q / E / R,
  M para megaevolucionar; en los mapas flechas o WASD e Intro), el ratón, la pausa, la rendición y la repetición están probados en el
  navegador; el mando (stick, ZL + X A B Y, Y / B para la voltereta, cruceta, +, R para megaevolucionar, el modo sencillo con L;
  en dobles L o el clic del stick izquierdo cambia de Pokémon y el clic del derecho de rival fijado; en los mapas stick o cruceta y A;
  en la batalla campal stick, A B X Y para los movimientos y RB o ZR para rodar)
  sigue la API Gamepad estándar pero no se ha probado con uno conectado.
- **Cómo suenan los efectos.** Los sonidos de golpes, estados, cambios y movimientos se sintetizan en el navegador y está
  comprobado que se programan y suenan en su momento (gritos y música se descargan y reproducen), pero si suenan bien solo lo
  puede juzgar Luis con los cascos puestos; los volúmenes y el silencio están en el altavoz del campo y en Ajustes > Sonido.
- **Las 49 animaciones GEN8 de PokeRogue (CC BY-NC-SA 4.0).** El estilo Reborn usa solo las 748 que pokerogue-assets marca como
  de Reborn (reutilizables con crédito). Las GEN8 son de licencia no comercial con obligación de compartir igual: Silver ya usa
  material NC (SpriteCollab, música de PokeRogue), así que se podrían añadir, pero es decisión de Luis.
- **Rival que habla con IA en producción.** El código está y probado; en el equipo no hay ahora mismo un modelo que responda
  (Faustus caído y Ollama sin modelos descargados), así que el ajuste sigue apagado y se usan las frases escritas.
- **Primera sala en directo con otro ordenador.** Windows pregunta una vez si deja pasar a Python por el puerto de las salas
  (5240); hay que aceptarlo en el equipo de Luis para que un amigo de fuera de casa entre.
- **Un dibujo en «Estilo Pokémon (sin pixelar)» con Prospero en marcha.** El encargo, las referencias (solo imágenes propias),
  la indicación y el resultado (dibujo hasta 1024 px como imagen del entrenador) están probados contra el contrato de Prospero; no
  se ha lanzado uno de verdad porque Prospero y ComfyUI estaban apagados (Prospero tampoco aparece en las apps del Hub). Hay que
  ver con Prospero en marcha si el estilo sale como el arte oficial o hace falta afinar `prospero_prompt_art` en Ajustes.
