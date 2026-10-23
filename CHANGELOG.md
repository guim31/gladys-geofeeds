# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Added

- Up to five located event feeds: GeoJSON, GeoRSS (Simple and GML), W3C geo,
  RSS 2.0, RSS 1.0 and Atom, read every 5 to 60 minutes (5 MB at most each).
- One device per feed: events in the area, nearest event distance and title,
  latest event; a transport badge says whether the feed can be read.
- Filters per feed: radius around the house or coordinates (or the whole
  feed), category words, a numeric property and its minimum; a maximum age
  for all feeds.
- Scene triggers "new event in the area" and "event removed", filtered by
  feed, with the title, distance, category, link, value and properties of
  the event.
- Scene action "read the events": the events of the area as one sentence.
- Dashboard widget: the current events per feed, then the nearest ones.
- Texts and documentation in English, French, German and Spanish.

[Unreleased]: https://github.com/guim31/gladys-geofeeds/commits/main
