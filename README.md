# GeoJSON & GeoRSS feeds for Gladys Assistant

A generic reader of located event feeds for [Gladys Assistant](https://gladysassistant.com): paste
the address of up to five **GeoJSON**, **GeoRSS**, **RSS** or **Atom** feeds (USGS earthquakes,
GDACS alerts, NSW Rural Fire Service incidents, the feed of a local authority…), and Gladys
follows the events within a radius of your house, shows them on the dashboard and starts a scene
when one appears or disappears. No account, no API key.

A complement, not a safety alert system: the instructions of your local authorities always
prevail. Not affiliated with the USGS, GDACS, NSW RFS nor any feed publisher.

## Features

- **One device per feed**: events in the area, distance and title of the nearest one, latest
  event in words; a transport badge says whether the feed can be read.
- **Filters per feed**: radius (or the whole feed), category words, a numeric property and its
  minimum (`mag` for the USGS); a maximum age for every feed.
- **Scene triggers**: a new event in the area, an event removed; filtered by feed, with the title,
  distance, category, link, value and properties of the event as variables.
- **Scene action**: the events of your area as one sentence, to send by message or read aloud.
- **Dashboard widget**: the current events of each feed, then the nearest ones.
- Texts in English, French, German and Spanish.

Formats: GeoJSON `FeatureCollection` (Point, and the centre of Polygon, MultiPolygon, lines and
GeometryCollection), GeoRSS Simple (`georss:point`, `georss:polygon`, `georss:box`), GeoRSS GML
(`gml:pos`), W3C geo (`geo:lat` / `geo:long`), RSS 2.0, RSS 1.0 and Atom.

For worldwide disasters or European earthquakes, the dedicated integrations
[gladys-gdacs](https://github.com/guim31/gladys-gdacs) and
[gladys-emsc](https://github.com/guim31/gladys-emsc) know their sources better.

## Requirements

- Gladys Assistant 5.1 or later.
- Internet access from the Gladys host, to the feeds.
- A location for your house in Gladys, or coordinates in the configuration (not needed for a
  feed read whole).

## Installation

1. In Gladys, open **Integrations → Install from GitHub** and enter
   `https://github.com/guim31/gladys-geofeeds` (or install it from the catalog once it is listed).
   The install screen shows the **location** access it asks for (the centre of the area).
2. In **Configuration**, paste the address of a feed, choose its radius and filters, then save.
   **Read the feeds now** tells what each feed gives.
3. Open the **Discover** tab and add the devices of the feeds.

The user guide is in [`docs/en.md`](docs/en.md) ([français](docs/fr.md), [Deutsch](docs/de.md),
[español](docs/es.md)); Gladys links it from the Configuration screen.

## How it works

```
Integration container ──HTTP(S)──▶ the feeds (GeoJSON, RSS, Atom; 5 MB at most each)
      │ SDK (WebSocket + host API)
      ▼
Gladys core ── devices, states, transport badges, scene events, scene action, widget
```

- Every 5 to 60 minutes the container reads each feed (redirects followed, 30 s timeout, 5 MB
  cap), parses it with a small built-in XML reader that never expands entities nor runs anything,
  and keeps the events of the followed area. Devices are published with `should_poll: false`: the
  container refreshes them on its own timer (GladysAssistant/Gladys#3198).
- Distances are great-circle distances from the centre to the point of the event, or to the
  centre of its area.
- The followed events of each feed are kept under `/data`: a restart fires no trigger for an event
  already seen, and the first reading of a feed (or after a change of settings) is a starting
  point, not news.

## Limitations

- Five feeds at most; public feeds only (no authentication header).
- The distance is measured to the centre of an area, not to its edge.
- Dates without a time zone (NSW RFS gives local dates) are not guessed: these events have no date.
- Developed and tested against real feeds and the SDK's fake Gladys; not yet on a real Gladys
  instance: feedback welcome.

## Development

```bash
npm ci
npm run format:check && npm run lint && npm test
npx -y github:GladysAssistant/integration-store --skip-image-check .
```

The tests run against the SDK's fake Gladys and fake servers serving real feeds recorded on
23/10/2026 (`test/fixtures/feeds/`): never the network.

## Credits

- The Home Assistant [GeoJSON](https://www.home-assistant.io/integrations/geo_json_events/) and
  [GeoRSS](https://www.home-assistant.io/integrations/geo_rss_events/) integrations and the
  [aio_geojson_client](https://github.com/exxamalte/python-aio-geojson-client) and
  [georss_client](https://github.com/exxamalte/python-georss-client) libraries by Malte Franken
  (Apache 2.0) showed what users expect from such an integration; no code is copied from them.
- Recorded test feeds: [USGS](https://earthquake.usgs.gov/earthquakes/feed/) (public domain),
  [GDACS](https://www.gdacs.org) (European Commission JRC, UN OCHA; CC BY 4.0),
  [NSW Rural Fire Service](https://www.rfs.nsw.gov.au/news-and-media/stay-up-to-date/feeds).
- Built on the [Gladys integration SDK](https://github.com/GladysAssistant/integration-sdk-js) and
  the official JavaScript template.

## License

[Apache 2.0](LICENSE).
