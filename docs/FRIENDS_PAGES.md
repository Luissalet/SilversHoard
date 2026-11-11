# Duelo privado en una página estática

**Jugar con un amigo** ejecuta un combate por turnos en dos navegadores. El anfitrión ejecuta el motor de Silver y envía al invitado la vista de su lado. El anfitrión recibe ambos equipos, por lo que esta sala está pensada para partidas privadas de confianza.

1. Crea una sala con tu nombre, un equipo de Showdown y un formato. Puedes importar un reglamento JSON de Silver que incluya cláusulas y niveles.
2. Envía el enlace de invitación a tu amigo y deja abierta la pestaña.
3. Tu amigo abre el enlace, introduce su nombre y su equipo y pulsa **Generar respuesta**.
4. Pega su código de respuesta y pulsa **Conectar**. Una vez conectados, ambos eligen sus movimientos desde la arena.

El intercambio inicial usa dos mensajes que podéis copiar por cualquier chat. El duelo usa un canal WebRTC directo. La versión de prueba consulta STUN para encontrar una ruta y admite redes con conexión directa. Si las redes requieren un repetidor TURN, esta versión no podrá conectarlas. Si se cierra la pestaña, cread otra sala.

## Compilar para GitHub Pages

Desde la raíz de Silver, ejecuta:

```sh
npm ci
npm run build:friends
python scripts/build_friends_art.py
```

La compilación toma los paquetes versionados de `assets/friends-pmd/` y produce `dist/friends/`, con rutas relativas válidas bajo `/<repositorio>/` o `/<repositorio>/friends/`. Publica esa carpeta como artefacto de GitHub Pages o su contenido como raíz de una rama de publicación. El despliegue es estático y no requiere una API de Silver. Los archivos publicados en Pages son descargables. El sitio incluye los créditos de los recursos.

Para actualizar los paquetes desde una biblioteca instalada, ejecuta `python scripts/build_friends_art.py --library "RUTA/DE/SILVER/silvers_hoard/presets" --refresh-bundle` después de compilar. El exportador solo lee las vistas previas PMD y las expresiones activas referenciadas por sus manifiestos. Los paquetes excluyen entrenadores, avatares, equipos, partidas, archivos de procedencia locales y el historial de imágenes.

Para probar localmente, ejecuta `python -m http.server 8090 --bind 127.0.0.1 --directory dist/friends` y abre `http://127.0.0.1:8090/` en dos navegadores. `?ice=local` permite comprobar el canal en la misma red sin consultar STUN. Para validar una publicación pública, probad la dirección HTTPS desde dos redes distintas.

El sitio publica las imágenes PNG y WebP activas para las vistas previas PMD y los retratos de expresión. El navegador solicita las imágenes cuando las usa. La primera versión cubre el duelo por turnos.
