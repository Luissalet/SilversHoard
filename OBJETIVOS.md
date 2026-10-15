# Objetivos de Silver's Hoard

Lo que falta por construir, de más a menos valor. Lo que ya hace está en el [README](README.es.md).

1. **Combates en directo entre amigos.** Hoy un amigo juega contra la IA de tu gimnasio en la página jugable. Siguiente paso:
   dos personas en dos equipos distintos, con el Hub como intermediario o un enlace temporal. Aparcado por decisión de Luis: primero el juego local.
2. **Códigos de resultado firmados.** Firmar el código con una clave del gimnasio para que una medalla no se pueda inventar.
3. **Modo campaña por juego.** Recorrer un juego de principio a fin con tu entrenador (rival, gimnasios, villanos, Alto Mando y
   campeón en el orden del juego, con topes de nivel), con los personajes ya cargados. Aparcado por decisión de Luis hasta
   terminar los modos y el pulido.
4. **Arena más ligera.** La pantalla de tiempo real carga los datos completos de `@pkmn/sim` (unos 6 MB); con `@pkmn/dex` y
   solo las generaciones en uso bajaría a la mitad.
5. **Vídeo de combates en tiempo real.** Hoy se graban las repeticiones de los combates por turnos; los de tiempo
   real necesitan reproducir sus entradas en la arena sin ventana con el mismo ritmo.
