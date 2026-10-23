// -----------------------------------------------------------------------------
// From the body of a feed to plain located events, whatever the format:
//   - GeoJSON: a FeatureCollection (or one Feature). Point geometries, and the
//     centre of the others: Polygon, MultiPolygon, LineString, MultiPoint, and
//     a GeometryCollection (its first Point, else the centre of its first
//     shape: NSW RFS sends a Point and the fire area together);
//   - XML: RSS 2.0, RSS 1.0 (RDF) and Atom, located by GeoRSS Simple
//     (`georss:point`, `georss:polygon`, `georss:box`), GeoRSS GML
//     (`gml:pos`, `gml:posList`) or W3C geo (`geo:lat` / `geo:long`).
//
// An event is `{ key, title, time, categories, url, summary, latitude,
// longitude, properties }`. `key` is the id the feed gives (`id`, `guid`),
// else a stable digest of the title, link and position. `time` is null when
// the feed gives no date this code can read without guessing its time zone.
// Items without a position are skipped: nothing to measure.
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import { child, childrenNamed, descendants, localName, parseXml, textOf } from './xml.js';

// What one feed can bring, at most: beyond, the rest is not read (truncated).
export const MAX_EVENTS = 5000;
export const MAX_PROPERTIES = 30;
const MAX_TEXT = 500;
const MAX_KEY = 200;

export class FeedFormatError extends Error {
  constructor(message) {
    super(message);
    this.name = 'FeedFormatError';
  }
}

const clean = (text) =>
  String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim();

const clip = (text, max) => (text.length <= max ? text : `${text.slice(0, max - 1)}…`);

/** Plain text of an HTML fragment (descriptions are often HTML). */
export function plainText(html) {
  // Bounded first: the result is clipped anyway, and a hostile description
  // of megabytes must not cost seconds of CPU.
  const text = String(html ?? '')
    .slice(0, 8 * MAX_TEXT)
    .replace(/<br\s*\/?>/gi, ' · ')
    .replace(/<\/(p|div|li|dd|dt|tr|h\d)>/gi, ' · ')
    .replace(/<[^<>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&(?:#x[0-9a-f]+|#\d+|lt|gt|amp|quot|apos|deg);/gi, (entity) =>
      entity.toLowerCase() === '&deg;' ? '°' : decodeOne(entity),
    );
  return clean(text)
    .replace(/(?:\s*·\s*)+/g, ' · ')
    .replace(/^ ?· | · ?$/g, '')
    .trim();
}

function decodeOne(entity) {
  const body = entity.slice(1, -1);
  if (body[0] === '#') {
    const code =
      body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : Number(body.slice(1));
    return Number.isInteger(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
  }
  return { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" }[body.toLowerCase()] ?? entity;
}

// --- Numbers, dates, positions -------------------------------------------------

/** A number, or a numeric string (decimal comma accepted); null otherwise. */
export function toNumber(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value !== 'string') {
    return null;
  }
  const text = value.trim().replace(',', '.');
  if (text.length > 40) {
    return null;
  }
  return /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(text) ? Number(text) : null;
}

/**
 * A date of a feed in ms: epoch numbers (seconds or milliseconds), ISO 8601,
 * RFC 822. Day-first dates without a zone ("23/10/2026 2:49:00 PM", NSW RFS)
 * are local to the publisher: null rather than a guess hours off.
 */
export function parseTime(value) {
  const number = toNumber(value);
  if (number !== null) {
    // 20261023 is a day (AAAAMMJJ), not seconds since 1970: not guessed.
    if (number <= 0 || /^\d{8}$/.test(String(value).trim())) {
      return null;
    }
    return number < 1e11 ? number * 1000 : number;
  }
  if (typeof value !== 'string' || value.trim() === '' || value.length > 100) {
    return null;
  }
  const text = value.trim();
  // Local to the publisher, without a zone: day-first dates, and ISO times
  // without "Z" nor offset (Date.parse would read them in the TZ of Gladys).
  if (
    /^\d{1,2}\/\d{1,2}\//.test(text) ||
    (/^\d{4}-\d\d-\d\d[T ]\d\d:\d\d/.test(text) && !/(?:Z|[+-]\d\d:?\d\d)$/i.test(text))
  ) {
    return null;
  }
  const time = Date.parse(text);
  return Number.isFinite(time) ? time : null;
}

const validPosition = (latitude, longitude) =>
  Number.isFinite(latitude) &&
  Number.isFinite(longitude) &&
  Math.abs(latitude) <= 90 &&
  Math.abs(longitude) <= 180;

function average(points) {
  const valid = points.filter(([lat, lon]) => validPosition(lat, lon));
  if (valid.length === 0) {
    return null;
  }
  const latitude = valid.reduce((sum, [lat]) => sum + lat, 0) / valid.length;
  // An area across the antimeridian (179° … -179°, around Fiji): averaged on
  // 0° … 360°, else its centre would fall on the other side of the Earth.
  const longitudes = valid.map(([, lon]) => lon);
  const wraps = Math.max(...longitudes) - Math.min(...longitudes) > 180;
  let longitude =
    longitudes.reduce((sum, lon) => sum + (wraps && lon < 0 ? lon + 360 : lon), 0) / valid.length;
  if (longitude > 180) {
    longitude -= 360;
  }
  return { latitude, longitude };
}

// A closed ring repeats its first point: counted once.
const openRing = (ring) => {
  if (ring.length > 1) {
    const [first, last] = [ring[0], ring[ring.length - 1]];
    if (first[0] === last[0] && first[1] === last[1]) {
      return ring.slice(0, -1);
    }
  }
  return ring;
};

// GeoJSON positions are [longitude, latitude, (altitude)].
const geoJsonPoints = (positions) =>
  (Array.isArray(positions) ? positions : [])
    .filter((p) => Array.isArray(p) && p.length >= 2)
    .map(([lon, lat]) => [lat, lon]);

/** The point of a GeoJSON geometry used for the distance; null if none. */
export function geometryCenter(geometry, depth = 0) {
  // Nested collections: a few levels at most (no stack overflow).
  if (!geometry || typeof geometry !== 'object' || depth > 8) {
    return null;
  }
  const c = geometry.coordinates;
  switch (geometry.type) {
    case 'Point':
      return Array.isArray(c) ? average(geoJsonPoints([c])) : null;
    case 'MultiPoint':
    case 'LineString':
      return average(geoJsonPoints(c));
    case 'MultiLineString':
      return average((Array.isArray(c) ? c : []).flatMap(geoJsonPoints));
    case 'Polygon':
      return Array.isArray(c) ? average(openRing(geoJsonPoints(c[0]))) : null;
    case 'MultiPolygon':
      return average(
        (Array.isArray(c) ? c : []).flatMap((polygon) =>
          Array.isArray(polygon) ? openRing(geoJsonPoints(polygon[0])) : [],
        ),
      );
    case 'GeometryCollection': {
      const geometries = Array.isArray(geometry.geometries) ? geometry.geometries : [];
      const point = geometries.find((g) => g?.type === 'Point');
      for (const g of point ? [point, ...geometries] : geometries) {
        const center = geometryCenter(g, depth + 1);
        if (center) {
          return center;
        }
      }
      return null;
    }
    default:
      return null;
  }
}

/** "lat lon lat lon …" (GeoRSS, GML) as [lat, lon] pairs. */
function pairs(text) {
  const numbers = clean(text)
    .split(/[\s,]+/)
    .filter(Boolean)
    .map(Number);
  const found = [];
  for (let i = 0; i + 1 < numbers.length; i += 2) {
    found.push([numbers[i], numbers[i + 1]]);
  }
  return found;
}

// --- Keys --------------------------------------------------------------------

function keyOf(id, event) {
  const given = clean(id);
  if (given) {
    return clip(given, MAX_KEY);
  }
  // No id: a digest of what makes the event itself, stable between readings.
  const basis = [event.title, event.url, event.latitude.toFixed(4), event.longitude.toFixed(4)];
  return `sha1:${createHash('sha1').update(basis.join('|')).digest('hex').slice(0, 16)}`;
}

// --- GeoJSON -----------------------------------------------------------------

const firstOf = (object, names) => {
  for (const name of names) {
    const value = object[name];
    if (value !== undefined && value !== null && value !== '') {
      return value;
    }
  }
  return undefined;
};

const ID_NAMES = ['id', 'guid', 'identifier', 'eventid', 'event_id', 'uuid'];
const TITLE_NAMES = ['title', 'name', 'headline', 'place', 'eventname', 'label'];
const TIME_NAMES = [
  'time',
  'date',
  'pubDate',
  'published',
  'datetime',
  'fromdate',
  'start',
  'updated',
  'lastupdate',
];
const CATEGORY_NAMES = ['category', 'categories', 'type', 'eventtype', 'event_type'];
const URL_NAMES = ['url', 'link', 'href', 'web', 'website'];
const SUMMARY_NAMES = ['description', 'summary', 'details', 'place'];

// 1000 characters at most: the limit of a string in a scene event.
const isHttpUrl = (value) =>
  typeof value === 'string' && value.length <= 1000 && /^https?:\/\/\S+$/i.test(value.trim());

function urlOf(value) {
  if (isHttpUrl(value)) {
    return value.trim();
  }
  if (value && typeof value === 'object') {
    // GDACS gives { report, details, geometry }: the first web address.
    return Object.values(value).find(isHttpUrl)?.trim() ?? null;
  }
  return null;
}

function categoriesOf(value) {
  const list = Array.isArray(value) ? value : [value];
  return list
    .filter((item) => typeof item === 'string' || typeof item === 'number')
    .map((item) => clip(clean(item), 100))
    .filter(Boolean);
}

/** The scalar properties of a feature (numbers, booleans, short texts). */
function scalarProperties(properties) {
  const found = {};
  for (const [name, value] of Object.entries(properties)) {
    if (Object.keys(found).length >= MAX_PROPERTIES) {
      break;
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      found[name] = value;
    } else if (typeof value === 'boolean') {
      found[name] = value;
    } else if (typeof value === 'string' && value.trim() !== '' && value.length <= 200) {
      found[name] = value.trim();
    }
  }
  return found;
}

export function parseFeature(feature) {
  if (!feature || typeof feature !== 'object') {
    return null;
  }
  const center = geometryCenter(feature.geometry);
  if (!center) {
    return null;
  }
  const p = feature.properties && typeof feature.properties === 'object' ? feature.properties : {};
  const title = clip(clean(firstOf(p, TITLE_NAMES) ?? ''), MAX_TEXT);
  const event = {
    title,
    time: parseTime(firstOf(p, TIME_NAMES)),
    categories: categoriesOf(firstOf(p, CATEGORY_NAMES)),
    url: urlOf(firstOf(p, URL_NAMES)),
    summary: clip(plainText(firstOf(p, SUMMARY_NAMES) ?? ''), MAX_TEXT),
    latitude: center.latitude,
    longitude: center.longitude,
    properties: scalarProperties(p),
  };
  const id = feature.id ?? firstOf(p, ID_NAMES);
  event.key = keyOf(typeof id === 'object' ? '' : id, event);
  return event;
}

function parseGeoJson(document) {
  if (document?.type === 'FeatureCollection' && Array.isArray(document.features)) {
    return document.features;
  }
  if (document?.type === 'Feature') {
    return [document];
  }
  throw new FeedFormatError('JSON, but not a GeoJSON FeatureCollection');
}

// --- RSS / Atom ------------------------------------------------------------------

function xmlPosition(item) {
  const point = descendants(item, 'point').find((node) => pairs(textOf(node)).length === 1);
  if (point) {
    const [[lat, lon]] = pairs(textOf(point));
    if (validPosition(lat, lon)) {
      return { latitude: lat, longitude: lon };
    }
  }
  const lat = toNumber(textOf(descendants(item, 'lat')[0]));
  const lon = toNumber(textOf(descendants(item, 'long')[0] ?? descendants(item, 'lon')[0]));
  if (validPosition(lat, lon)) {
    return { latitude: lat, longitude: lon };
  }
  const pos = descendants(item, 'pos')[0];
  if (pos) {
    const center = average(pairs(textOf(pos)).slice(0, 1));
    if (center) {
      return center;
    }
  }
  for (const name of ['polygon', 'posList', 'box', 'line']) {
    const node = descendants(item, name)[0];
    if (node) {
      const points = pairs(textOf(node));
      const center = average(name === 'polygon' || name === 'posList' ? openRing(points) : points);
      if (center) {
        return center;
      }
    }
  }
  return null;
}

function xmlLink(item) {
  const links = childrenNamed(item, 'link');
  // Atom: <link rel="alternate" href="…"/>; RSS: <link>…</link>.
  const alternate =
    links.find(
      (link) => link.attributes.href && (link.attributes.rel ?? 'alternate') === 'alternate',
    ) ?? links.find((link) => link.attributes.href);
  if (alternate) {
    return isHttpUrl(alternate.attributes.href) ? alternate.attributes.href.trim() : null;
  }
  const text = clean(textOf(links[0]));
  if (isHttpUrl(text)) {
    return text;
  }
  const guid = child(item, 'guid');
  const guidText = clean(textOf(guid));
  return guid && guid.attributes.isPermaLink !== 'false' && isHttpUrl(guidText) ? guidText : null;
}

// Read into the event itself: not repeated among the properties.
const XML_FIELDS = new Set([
  'title',
  'description',
  'summary',
  'content',
  'link',
  'guid',
  'id',
  'category',
  'subject',
  'pubDate',
  'published',
  'updated',
  'point',
  'polygon',
  'box',
  'line',
  'lat',
  'long',
]);

/** The simple children of an item (no sub-element, short text) as properties. */
function xmlProperties(item) {
  const found = {};
  for (const node of item.children) {
    if (Object.keys(found).length >= MAX_PROPERTIES) {
      break;
    }
    const name = localName(node.name);
    const text = clean(node.text);
    if (
      node.children.length === 0 &&
      text &&
      text.length <= 200 &&
      !XML_FIELDS.has(name) &&
      !(name in found)
    ) {
      found[name] = text;
    }
  }
  return found;
}

// A title is plain text ("5 < 10" stays), unless Atom says it is HTML.
function titleText(node) {
  if (!node) {
    return '';
  }
  const type = node.attributes.type;
  return type === 'html' || type === 'xhtml'
    ? plainText(textOf(node))
    : clean(textOf(node).slice(0, 8 * MAX_TEXT));
}

export function parseItem(item) {
  const center = xmlPosition(item);
  if (!center) {
    return null;
  }
  const time = ['pubDate', 'published', 'updated', 'date', 'issued', 'modified']
    .map((name) => parseTime(clean(textOf(child(item, name)))))
    .find((value) => value !== null);
  const categories = [...childrenNamed(item, 'category'), ...childrenNamed(item, 'subject')]
    .map((node) => clean(node.attributes.term ?? textOf(node)))
    .filter(Boolean)
    .map((text) => clip(text, 100));
  const summaryNode = child(item, 'description', 'summary', 'content');
  const event = {
    title: clip(titleText(child(item, 'title')), MAX_TEXT),
    time: time ?? null,
    categories: [...new Set(categories)],
    url: xmlLink(item),
    summary: clip(plainText(textOf(summaryNode)), MAX_TEXT),
    latitude: center.latitude,
    longitude: center.longitude,
    properties: xmlProperties(item),
  };
  event.key = keyOf(textOf(child(item, 'guid', 'id')), event);
  return event;
}

function xmlItems(root) {
  const name = localName(root.name);
  if (name === 'feed') {
    return childrenNamed(root, 'entry');
  }
  if (name === 'rss') {
    const channel = child(root, 'channel');
    return channel ? childrenNamed(channel, 'item') : [];
  }
  if (name === 'RDF') {
    return childrenNamed(root, 'item');
  }
  throw new FeedFormatError(`XML, but neither RSS nor Atom (<${root.name.slice(0, 40)}>)`);
}

// --- Entry point -------------------------------------------------------------------

/**
 * Parses the body of a feed. Returns `{ format, events, skipped, truncated }`:
 * `skipped` counts the items without a usable position.
 */
export function parseFeed(body) {
  const text = String(body ?? '').replace(/^\uFEFF/, '');
  const start = text.trimStart()[0];
  let format;
  let raw;
  let parse;
  if (start === '{') {
    let document;
    try {
      document = JSON.parse(text);
    } catch {
      throw new FeedFormatError('not valid JSON');
    }
    format = 'geojson';
    raw = parseGeoJson(document);
    parse = parseFeature;
  } else if (start === '<') {
    const root = parseXml(text);
    if (!root) {
      throw new FeedFormatError('no XML element');
    }
    if (localName(root.name).toLowerCase() === 'html') {
      throw new FeedFormatError('a web page, not a feed');
    }
    raw = xmlItems(root);
    format = localName(root.name) === 'feed' ? 'atom' : 'rss';
    parse = parseItem;
  } else {
    throw new FeedFormatError('neither GeoJSON nor RSS/Atom');
  }
  const truncated = raw.length > MAX_EVENTS;
  const events = new Map();
  let skipped = 0;
  for (const item of raw.slice(0, MAX_EVENTS)) {
    const event = parse(item);
    if (!event) {
      skipped += 1;
    } else if (!events.has(event.key)) {
      events.set(event.key, event);
    }
  }
  return { format, events: [...events.values()], skipped, truncated };
}
