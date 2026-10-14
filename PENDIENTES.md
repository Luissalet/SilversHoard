# Pendientes y cosas por revisar

Solo lo que no se puede cerrar desde aquí. Los errores encontrados se arreglan, no se apuntan.

- **Render real del sprite con Prospero.** El contrato está comprobado en vivo (proyecto, importación de la foto con `reason`,
  descarga del resultado por id) y por una prueba que imita a Prospero. Falta ver una imagen generada de verdad: el render
  va a la ComfyUI principal de Prospero, que puede caer en las GPU 0 o 1, y esas se dejan libres en las pruebas. Probarlo
  cuando haya una GPU libre o desde la página de Avatares (modo «Dibujado por Prospero»).
- **Faustus carga el plugin al reiniciarse.** El manifiesto está en `plugins/silver/plugin.json` de Faustus; Hoard Hub ya
  lista la app y su puente de herramientas funciona sin reiniciar nada.
- **Repositorio en GitHub.** Sin crear ni subir: subir es cosa de Luis.
