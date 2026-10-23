// -----------------------------------------------------------------------------
// From feed bodies to located events: the recorded feeds of each format
// (test/fixtures/feeds, see their README), the geometries and GeoRSS forms the
// recordings do not have, the dates, the keys, and the XML safety rules.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { geometryCenter, parseFeed, parseTime, plainText, MAX_EVENTS } from '../src/parse.js';
import { parseXml } from '../src/xml.js';
import { fixtureText } from './helpers/world.js';

const rss = (item) =>
  `<?xml version="1.0"?><rss version="2.0" xmlns:georss="http://www.georss.org/georss" xmlns:gml="http://www.opengis.net/gml" xmlns:geo="http://www.w3.org/2003/01/geo/wgs84_pos#"><channel><title>T</title>${item}</channel></rss>`;

test('USGS GeoJSON: id, title, epoch date, type as category, link, properties', () => {
  const { format, events, skipped } = parseFeed(fixtureText('usgs-2.5_day.geojson'));
  assert.equal(format, 'geojson');
  assert.equal(events.length, 35);
  assert.equal(skipped, 0);
  const [first] = events;
  assert.equal(first.key, 'us6000u4f5');
  assert.equal(first.title, 'M 4.6 - 91 km ESE of Tuensang, India');
  assert.equal(first.time, 1792775185116);
  assert.deepEqual(first.categories, ['earthquake']);
  assert.equal(first.url, 'https://earthquake.usgs.gov/earthquakes/eventpage/us6000u4f5');
  assert.equal(first.latitude, 25.9295);
  assert.equal(first.longitude, 95.6545);
  assert.equal(first.properties.mag, 4.6);
});

test('USGS Atom with georss:point: the same earthquakes', () => {
  const { format, events } = parseFeed(fixtureText('usgs-2.5_day.atom'));
  assert.equal(format, 'atom');
  assert.equal(events.length, 35);
  const [first] = events;
  assert.equal(first.key, 'urn:earthquake-usgs-gov:us:6000u4f5');
  assert.equal(first.title, 'M 4.6 - 91 km ESE of Tuensang, India');
  assert.equal(first.time, Date.parse('2026-10-23T17:30:26.040Z'));
  assert.equal(first.url, 'https://earthquake.usgs.gov/earthquakes/eventpage/us6000u4f5');
  assert.deepEqual(first.categories, ['Past Hour', 'Magnitude 4', 'us']);
  assert.match(first.summary, /^Time · 2026-10-23 17:06:25 UTC/);
  assert.match(first.summary, /25\.930°N/);
  assert.deepEqual([first.latitude, first.longitude], [25.9295, 95.6545]);
});

test('GDACS RSS with geo:lat/geo:long and georss:point, RFC 822 dates', () => {
  const { format, events } = parseFeed(fixtureText('gdacs-rss.xml'));
  assert.equal(format, 'rss');
  assert.equal(events.length, 8);
  const [first] = events;
  assert.equal(first.key, 'EQ1573344');
  assert.match(first.title, /^Green earthquake \(Magnitude 5\.7M/);
  assert.equal(first.time, Date.parse('2026-10-23T10:34:39Z'));
  assert.equal(first.url, 'http://www.gdacs.org/report.aspx?eventtype=EQ&eventid=1573344');
  assert.deepEqual([first.latitude, first.longitude], [38.7199, 14.152]);
  assert.equal(first.properties.alertlevel, 'Green');
  assert.equal(first.properties.title, undefined, 'core fields are not repeated');
});

test('NSW RFS GeoJSON: GeometryCollection (point first), guid, unreadable local dates', () => {
  const { events } = parseFeed(fixtureText('nsw-rfs-major-incidents.json'));
  assert.equal(events.length, 11);
  const [first] = events;
  assert.equal(first.key, 'https://incidents.rfs.nsw.gov.au/api/v1/incidents/683156');
  assert.deepEqual(first.categories, ['Advice']);
  assert.equal(first.time, null, '"23/10/2026 2:49:00 PM" has no time zone: not guessed');
  assert.match(first.summary, /^ALERT LEVEL: Advice · LOCATION:/);
  const collection = JSON.parse(fixtureText('nsw-rfs-major-incidents.json')).features.find(
    (f) => f.geometry.type === 'GeometryCollection',
  );
  const point = collection.geometry.geometries.find((g) => g.type === 'Point').coordinates;
  const event = events.find((e) => e.key === collection.properties.guid);
  assert.deepEqual([event.longitude, event.latitude], point.slice(0, 2));
});

test('geometries: the centre of polygons, multipolygons and lines', () => {
  const square = [
    [0, 0],
    [2, 0],
    [2, 2],
    [0, 2],
    [0, 0],
  ];
  assert.deepEqual(geometryCenter({ type: 'Polygon', coordinates: [square] }), {
    latitude: 1,
    longitude: 1,
  });
  const far = square.map(([x, y]) => [x + 10, y]);
  assert.deepEqual(geometryCenter({ type: 'MultiPolygon', coordinates: [[square], [far]] }), {
    latitude: 1,
    longitude: 6,
  });
  assert.deepEqual(
    geometryCenter({
      type: 'LineString',
      coordinates: [
        [0, 0],
        [4, 2],
      ],
    }),
    { latitude: 1, longitude: 2 },
  );
  assert.equal(geometryCenter({ type: 'Point', coordinates: [200, 0] }), null);
  assert.equal(geometryCenter(null), null);
});

test('GeoRSS polygon, box and GML forms; items without a position are skipped', () => {
  const body = rss(`
    <item><title>Zone</title><guid>a</guid><georss:polygon>45 1 45 3 47 3 47 1 45 1</georss:polygon></item>
    <item><title>Box</title><guid>b</guid><georss:box>40 0 42 2</georss:box></item>
    <item><title>GML</title><guid>c</guid><georss:where><gml:Point><gml:pos>43.6 1.44</gml:pos></gml:Point></georss:where></item>
    <item><title>W3C</title><guid>d</guid><geo:lat>43,5</geo:lat><geo:long>1.5</geo:long></item>
    <item><title>Nowhere</title><guid>e</guid></item>`);
  const { events, skipped } = parseFeed(body);
  assert.deepEqual(
    events.map((e) => [e.key, e.latitude, e.longitude]),
    [
      ['a', 46, 2],
      ['b', 41, 1],
      ['c', 43.6, 1.44],
      ['d', 43.5, 1.5],
    ],
  );
  assert.equal(skipped, 1);
});

test('without an id, the key is a stable digest of the title, link and position', () => {
  const item =
    '<item><title>Fire</title><link>https://x.example/1</link><georss:point>1 2</georss:point></item>';
  const [a] = parseFeed(rss(item)).events;
  const [b] = parseFeed(rss(`<item><pubDate>now</pubDate>${item.slice(6)}`)).events;
  assert.match(a.key, /^sha1:[0-9a-f]{16}$/);
  assert.equal(a.key, b.key);
  const [moved] = parseFeed(rss(item.replace('1 2', '1 3'))).events;
  assert.notEqual(moved.key, a.key);
});

test('dates: epoch seconds and milliseconds, ISO 8601, RFC 822', () => {
  assert.equal(parseTime(1792775185), 1792775185000);
  assert.equal(parseTime(1792775185116), 1792775185116);
  assert.equal(parseTime('2026-10-23T17:30:26Z'), Date.parse('2026-10-23T17:30:26Z'));
  assert.equal(parseTime('Fri, 23 Oct 2026 10:34:39 GMT'), Date.parse('2026-10-23T10:34:39Z'));
  assert.equal(parseTime('23/10/2026 2:49:00 PM'), null);
  assert.equal(parseTime('soon'), null);
  assert.equal(parseTime(''), null);
});

test('XML safety: a DOCTYPE never defines an entity, nothing is expanded', () => {
  const body = `<?xml version="1.0"?><!DOCTYPE rss [<!ENTITY lol "lol"><!ENTITY xxe SYSTEM "file:///etc/passwd">]>${rss(
    '<item><title>&lol;&xxe; &amp; &#233;</title><georss:point>1 2</georss:point></item>',
  ).replace('<?xml version="1.0"?>', '')}`;
  const [event] = parseFeed(body).events;
  assert.equal(event.title, '&lol;&xxe; & é');
});

test('sloppy XML: a stray "<" and an unclosed element do not throw', () => {
  const root = parseXml('<rss><channel><item><title>a < b</title><georss:point>1 2</georss:point>');
  assert.equal(root.name, 'rss');
  const { events } = parseFeed(
    '<rss><channel><item><title>a < b</title><georss:point>1 2</georss:point>',
  );
  assert.equal(events[0].title, 'a < b');
});

test('CDATA and HTML descriptions become plain text', () => {
  assert.equal(plainText('<p>One<br/>two &amp; <b>three</b></p>'), 'One · two & three');
  const [event] = parseFeed(
    rss(
      '<item><title>T</title><description><![CDATA[<p>Hello</p>]]></description><georss:point>1 2</georss:point></item>',
    ),
  ).events;
  assert.equal(event.summary, 'Hello');
});

test('not a feed: a web page, plain JSON, plain text', () => {
  assert.throws(() => parseFeed('<!doctype html><html><body></body></html>'), /web page/);
  assert.throws(() => parseFeed('{"hello": 1}'), /not a GeoJSON/);
  assert.throws(() => parseFeed('{"hello": '), /not valid JSON/);
  assert.throws(() => parseFeed('hello'), /neither GeoJSON nor RSS/);
  assert.throws(() => parseFeed('<svg></svg>'), /neither RSS nor Atom/);
});

test('a huge feed is read up to its cap', () => {
  const feature = { type: 'Feature', geometry: { type: 'Point', coordinates: [1, 2] } };
  const features = Array.from({ length: MAX_EVENTS + 3 }, (_, i) => ({ ...feature, id: i }));
  const result = parseFeed(JSON.stringify({ type: 'FeatureCollection', features }));
  assert.equal(result.events.length, MAX_EVENTS);
  assert.equal(result.truncated, true);
});
