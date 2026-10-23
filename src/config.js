// -----------------------------------------------------------------------------
// Integration configuration: defaults (they mirror the `default` values of the
// manifest `config_schema`, see test/manifest.test.js) and normalization, so
// the rest of the code never deals with strings, blanks or `undefined`.
//
// Five feed slots, `feed_1_…` to `feed_5_…`: a slot with an address is a feed,
// and a Gladys device keyed on its slot number. Select values are strings in
// the manifest; the normalized config holds numbers.
// -----------------------------------------------------------------------------

export const LANGUAGES = ['en', 'fr', 'de', 'es'];

export const SLOTS = [1, 2, 3, 4, 5];

// Kilometres around the centre; 0 keeps the whole feed (a local feed).
export const RADII = ['0', '5', '10', '25', '50', '100', '250', '500', '1000', '2500'];

// Minutes between two readings: 5 at least, the courtesy owed to a public feed.
export const REFRESH_INTERVALS = ['5', '10', '15', '30', '60'];

// Hours: events older than this are ignored (0: any age). Events without a
// readable date are always kept.
export const MAX_AGES = ['0', '1', '6', '24', '72', '168', '720'];

export const FEED_FIELDS = ['name', 'url', 'radius', 'categories', 'property', 'min_value'];

const FEED_DEFAULTS = {
  name: '',
  url: '',
  radius: '50',
  categories: '',
  property: '',
  min_value: '',
};

export const DEFAULT_CONFIG = {
  ...Object.fromEntries(
    SLOTS.flatMap((slot) =>
      FEED_FIELDS.map((field) => [`feed_${slot}_${field}`, FEED_DEFAULTS[field]]),
    ),
  ),
  latitude: '',
  longitude: '',
  refresh_interval: '10',
  max_age: '0',
  language: 'fr',
};

/** A decimal number typed by the user (decimal comma accepted), null if blank or invalid. */
export function parseDecimal(value) {
  const text = String(value ?? '')
    .trim()
    .replace(',', '.');
  if (!/^[+-]?\d+(?:\.\d+)?$/.test(text)) {
    return null;
  }
  return Number(text);
}

export function parseCoordinate(value, limit) {
  const number = parseDecimal(value);
  return number !== null && Math.abs(number) <= limit ? number : null;
}

/** The address of a feed: http or https only, without spaces; null otherwise. */
export function parseFeedUrl(value) {
  const text = String(value ?? '').trim();
  if (text === '') {
    return null;
  }
  try {
    const url = new URL(text);
    // No user:password@: fetch refuses it, and it would be a secret in the configuration.
    return ['http:', 'https:'].includes(url.protocol) &&
      !/\s/.test(text) &&
      url.username === '' &&
      url.password === ''
      ? url.href
      : null;
  } catch {
    return null;
  }
}

/** Category words, separated by commas or semicolons, lowercased. */
export const parseCategories = (text) => [
  ...new Set(
    String(text ?? '')
      .split(/[,;]/)
      .map((word) => word.trim().toLowerCase())
      .filter(Boolean),
  ),
];

const pick = (value, allowed, fallback) =>
  allowed.includes(String(value)) ? Number(value) : Number(fallback);

const PROPERTY_NAME = /^[\w.:-]{1,64}$/;

function normalizeFeed(source, slot) {
  const get = (field) => source[`feed_${slot}_${field}`];
  const rawUrl = String(get('url') ?? '').trim();
  const url = parseFeedUrl(rawUrl);
  const property = String(get('property') ?? '').trim();
  const minText = String(get('min_value') ?? '').trim();
  const minValue = parseDecimal(minText);
  const problems = [];
  if (rawUrl !== '' && url === null) {
    problems.push('url');
  }
  if (property !== '' && !PROPERTY_NAME.test(property)) {
    problems.push('property');
  }
  if (minText !== '' && minValue === null) {
    problems.push('min_value');
  }
  return {
    slot,
    url,
    typed: rawUrl !== '',
    name: String(get('name') ?? '')
      .trim()
      .slice(0, 60),
    radiusKm: pick(get('radius'), RADII, FEED_DEFAULTS.radius),
    categories: parseCategories(get('categories')),
    property: PROPERTY_NAME.test(property) ? property : null,
    // A threshold without a property, or the reverse, filters nothing.
    minValue: PROPERTY_NAME.test(property) ? minValue : null,
    problems,
  };
}

/**
 * @param {Record<string, unknown>} raw the configuration returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const latitude = parseCoordinate(source.latitude, 90);
  const longitude = parseCoordinate(source.longitude, 180);
  // Both or none: half a centre falls back on the house.
  const center = latitude !== null && longitude !== null ? { latitude, longitude } : null;
  const typed = String(source.latitude ?? '').trim() + String(source.longitude ?? '').trim();
  const slots = SLOTS.map((slot) => normalizeFeed(source, slot));
  return {
    center,
    invalidCenter: center === null && typed !== '',
    feeds: slots.filter((feed) => feed.url !== null),
    // Slots with a value that is not usable, said in the connection status.
    invalid: slots.filter((feed) => feed.problems.length > 0),
    refreshMinutes: pick(
      source.refresh_interval,
      REFRESH_INTERVALS,
      DEFAULT_CONFIG.refresh_interval,
    ),
    maxAgeHours: pick(source.max_age, MAX_AGES, DEFAULT_CONFIG.max_age),
    language: LANGUAGES.includes(source.language) ? source.language : DEFAULT_CONFIG.language,
  };
}
