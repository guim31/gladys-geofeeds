# Feeds GeoJSON y GeoRSS

Un lector genérico de **feeds de eventos geolocalizados** para Gladys Assistant: pegue la dirección
de hasta cinco feeds (terremotos del USGS, alertas de GDACS, incendios del NSW Rural Fire Service,
el feed de una autoridad local…), y Gladys sigue los eventos en un radio alrededor de su casa, los
muestra en el panel y lanza una escena cuando uno aparece o desaparece.

Formatos leídos: **GeoJSON** (`FeatureCollection`), **GeoRSS** (Simple y GML), **W3C geo**
(`geo:lat` / `geo:long`), **RSS 2.0**, **RSS 1.0** y **Atom**.

Para las catástrofes mundiales o los terremotos europeos, las integraciones dedicadas
[GDACS](https://github.com/guim31/gladys-gdacs) y [EMSC](https://github.com/guim31/gladys-emsc)
conocen mejor su fuente (niveles de alerta, revisiones de magnitud): esta sirve para cualquier otro
feed.

Un complemento, no es un sistema de alerta de seguridad: siga las instrucciones de sus autoridades
locales.

## Lo que obtiene

- Un **dispositivo por feed**: el número de eventos en la zona, la distancia y el título del más
  cercano, el último evento en palabras y una insignia que indica si el feed se puede leer.
- Un **widget** del panel: los eventos actuales de cada feed y luego los más cercanos.
- Dos **disparadores de escena**: nuevo evento en la zona, evento desaparecido.
- Una **acción de escena** que lee los eventos de su zona en una frase.

## Requisitos

- Gladys Assistant 5.1.0 o posterior.
- Acceso a Internet desde Gladys (los feeds los lee el contenedor de la integración).
- La ubicación de su casa en Gladys (Ajustes → Casas), o coordenadas introducidas en la
  configuración. Sin ninguna de las dos, solo funcionan los feeds con el radio «Todo el feed».
- La dirección de un feed público. Algunos que funcionan:
  - terremotos del último día del USGS:
    `https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson`
  - alertas de catástrofes de GDACS: `https://www.gdacs.org/xml/rss.xml`
  - grandes incidentes del NSW Rural Fire Service: `https://www.rfs.nsw.gov.au/feeds/majorIncidents.json`

## Configuración

### Ajustes

Para cada uno de los cinco feeds:

| Ajuste                        | Uso                                                                                             |
| ----------------------------- | ----------------------------------------------------------------------------------------------- |
| Dirección del feed            | http o https, 5 MB como máximo. Vacía: el espacio no se usa.                                    |
| Nombre                        | Se muestra en el widget y las escenas. Vacío: «Feed geolocalizado 1 (host)».                    |
| Radio                         | Distancia del centro al evento. «Todo el feed»: todos los eventos, para un feed local.          |
| Categorías (opcional)         | Conservar solo los eventos cuya categoría contenga una de estas palabras (separadas por comas). |
| Propiedad numérica (opcional) | Una propiedad numérica de los eventos, `mag` para el USGS: se envía a las escenas como `value`. |
| Valor mínimo (opcional)       | Se ignoran los eventos cuya propiedad sea menor o falte.                                        |

Luego, para todos los feeds:

- **Latitud / longitud del centro**: vacías, la ubicación de su casa.
- **Intervalo de actualización**: de 5 a 60 minutos.
- **Antigüedad máxima de los eventos**: los más antiguos se ignoran; se conservan los que no
  tienen fecha legible.
- **Idioma de los textos**: nombres de los dispositivos y funciones al crearlos, textos enviados a
  las escenas.

Guarde, abra la pestaña **Descubrir** y cree los dispositivos.

### Lectura de un feed

- **GeoJSON**: un Point se usa tal cual; para un Polygon, MultiPolygon o línea, el centro de sus
  puntos; para una GeometryCollection, su primer Point (NSW RFS envía el punto del incendio y su
  zona).
- El identificador es `id` o `guid`; sin él, una huella del título, el enlace y la posición.
- Título: `title`, `name`, `headline` o `place`. Fecha: `time`, `date`, `pubDate`, `published`,
  `updated`. Categoría: `category` o `type`. Enlace: `url` o `link`.
- **RSS y Atom**: `georss:point`, `georss:polygon`, `georss:box`, `gml:pos` o `geo:lat` /
  `geo:long`; título, enlace, `guid` o `id`, `pubDate` o `updated`, `category`. Se omiten los
  elementos sin posición.
- Nada de un feed se ejecuta nunca: solo se lee. El DOCTYPE XML se ignora.

## Dispositivo

Un dispositivo por feed, actualizado por la propia integración (sin consulta de Gladys):

| Función                          | Tipo          | Valor                                                                      |
| -------------------------------- | ------------- | -------------------------------------------------------------------------- |
| Eventos en la zona               | contador      | Los eventos seguidos del feed.                                             |
| Distancia del evento más cercano | distancia, km | El evento seguido más cercano; 20 038 km (lo más lejos posible) si no hay. |
| Evento más cercano               | texto         | Su título.                                                                 |
| Último evento                    | texto         | El evento seguido más reciente, con su distancia.                          |

La **insignia** del dispositivo muestra «Cloud» cuando la última lectura funcionó, «Inaccesible»
en caso contrario; el motivo (sin respuesta, error HTTP, no es un feed…) aparece en el estado de la
integración y en el widget.

## Widget del panel

**Eventos geolocalizados**: un título con el número de eventos, una fila por feed (su número, o por
qué no se puede leer), los eventos más cercanos (8 como máximo) con su feed y su distancia, y la
hora de la última lectura. Toque un evento: su resumen, su fecha y un enlace. Los ajustes eligen
los feeds mostrados (vacío: todos).

## Disparadores de escena

**Feed geolocalizado: nuevo evento en la zona**: un evento entra en los eventos seguidos de un feed
(radio, antigüedad, categorías y valor mínimo). **Feed geolocalizado: evento desaparecido**: un
evento seguido sale del feed o ya no corresponde (demasiado antiguo, alejado).

La primera lectura de un feed, y la primera tras un cambio de configuración, no disparan nada: lo
que hay es el punto de partida. Un reinicio tampoco (los eventos seguidos se guardan en `/data`).
Como máximo 20 eventos por feed y por lectura.

Filtro: el feed (vacío: cualquiera). Variables:

| Variable      | Contenido                                                   |
| ------------- | ----------------------------------------------------------- |
| `feed_name`   | El nombre del feed.                                         |
| `title`       | El título del evento.                                       |
| `category`    | Sus categorías, separadas por comas.                        |
| `distance_km` | Distancia al centro, vacía sin centro.                      |
| `value`       | La propiedad numérica elegida para el feed, vacía sin ella. |
| `time`        | La fecha del evento (ISO 8601), vacía si se desconoce.      |
| `url`         | El enlace del evento.                                       |
| `summary`     | Título y distancia, listos para un mensaje.                 |
| `latitude`    | Latitud del evento.                                         |
| `longitude`   | Longitud del evento.                                        |
| `properties`  | Las propiedades simples del evento, en JSON.                |

## Acción de escena

**Feed geolocalizado: leer los eventos** vuelve a leer los feeds si hace falta y responde con
`text` (los eventos en una frase, del más cercano al más lejano), `count` y `nearest_km` (20038 si
no hay ninguno). El filtro de feed la limita a un feed. El botón **Leer los feeds ahora** de la
configuración indica, feed por feed, lo que se ha leído.

## Ejemplos de escenas

- **Terremoto cercano**: disparador «nuevo evento en la zona» en el feed del USGS (radio 250 km,
  propiedad `mag`, mínimo 4) → enviar el mensaje «{{summary}}, magnitud {{value}}».
- **Incendio forestal**: feed NSW RFS, categorías `Watch and Act, Emergency`, radio 50 km →
  encender una lámpara en rojo y enviar el enlace `{{url}}`.
- **Resumen de la mañana**: cada día a las 7:30, acción «leer los eventos» → leer `text` en voz
  alta.

## Fuentes de datos, condiciones y cuotas

Los datos pertenecen al editor de cada feed: lea y respete sus condiciones de uso, y cítelo si los
comparte. Los feeds del USGS son de dominio público
([earthquake.usgs.gov](https://earthquake.usgs.gov/earthquakes/feed/)), GDACS pide ser citado. La
integración lee cada feed como máximo cada 5 minutos, con su propio User-Agent, y lee 5 MB como
máximo: suficiente para los feeds públicos, que suelen actualizarse cada 5 a 15 minutos.

## Solución de problemas

- **«no es un feed GeoJSON, RSS o Atom»**: la dirección devuelve una página web. Busque el enlace
  del feed (GeoJSON, RSS, Atom) en el sitio del editor.
- **Ningún evento aunque el feed tiene**: compruebe el radio y la ubicación de su casa, las
  categorías y el valor mínimo; una propiedad que los eventos no tienen los excluye a todos.
- **«Sin centro»**: indique la ubicación de su casa en Gladys o introduzca coordenadas.
- **Faltan las fechas** (NSW RFS): el feed da fechas locales sin zona horaria; no se adivinan. La
  antigüedad máxima conserva estos eventos.
- Registros: `docker logs` del contenedor de la integración; `LOG_LEVEL=debug` muestra cada
  lectura.

## Límites

- Cinco feeds como máximo; un radio y filtros por feed.
- La distancia se mide hasta el centro de una zona, no hasta su borde: una zona grande alrededor de
  su casa puede estar más lejos que el radio.
- Sin autenticación: solo feeds públicos (un token en la dirección funciona y nunca se registra).
- Sin afiliación con el USGS, GDACS, NSW RFS ni ningún editor de feeds.
