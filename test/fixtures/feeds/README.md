# Recorded feeds

Real public feeds, recorded on 23/10/2026 around 18:05 UTC, served by the fake servers of
`test/helpers/world.js`. Public data, nothing personal: the editor e-mail addresses of the GDACS
channel were removed.

| File                           | Source                                                                    | Format                                         |
| ------------------------------ | ------------------------------------------------------------------------- | ---------------------------------------------- |
| `usgs-2.5_day.geojson`         | https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson | GeoJSON, Point, epoch ms dates (public domain) |
| `usgs-2.5_day.atom`            | https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.atom    | Atom + `georss:point`, HTML summaries in CDATA |
| `gdacs-rss.xml`                | https://www.gdacs.org/xml/rss.xml (first 8 of 309 items)                  | RSS 2.0 + `geo:Point` and `georss:point`, BOM  |
| `nsw-rfs-major-incidents.json` | https://www.rfs.nsw.gov.au/feeds/majorIncidents.json                      | GeoJSON, GeometryCollection, local dates       |
