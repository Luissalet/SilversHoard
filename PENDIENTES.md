# Pendientes y cosas por revisar

Solo lo que no se puede cerrar desde aquí. Los errores encontrados se arreglan, no se apuntan.

- **Faustus carga el plugin al reiniciarse.** El manifiesto está en `plugins/silver/plugin.json` de Faustus; Hoard Hub ya
  lista la app y su puente de herramientas funciona sin reiniciar nada.
- **Tiempo real con un mando de verdad.** El teclado (fijar con Mayús, rombo I L K J, voltereta, Q / E / R, F para el Plus,
  M para megaevolucionar), el ratón, la pausa, la rendición y la repetición están probados en el navegador; el mando (stick,
  ZL + X A B Y, Y / B para la voltereta, cruceta, +, ZL + + para el Plus, R para megaevolucionar, y el modo sencillo con L y −;
  en dobles L o el clic del stick izquierdo cambia de Pokémon y el clic del derecho de rival fijado) sigue la API Gamepad
  estándar pero no se ha probado con uno conectado.
- **Cómo suenan los efectos.** Los sonidos de golpes, estados, cambios y movimientos se sintetizan en el navegador y está
  comprobado que se programan y suenan en su momento (gritos y música se descargan y reproducen), pero si suenan bien solo lo
  puede juzgar Luis con los cascos puestos; los volúmenes y el silencio están en el altavoz del campo y en Ajustes > Sonido.
