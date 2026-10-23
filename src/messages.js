// -----------------------------------------------------------------------------
// Texts sent from the container (feature values, connection status, action and
// scene messages, transport badges), in the four languages of the Gladys
// interface. Entries are strings or functions of one parameter object. German
// says "du", Spanish "usted". Titles come from the feeds, as they are.
// -----------------------------------------------------------------------------

import { LANGUAGES } from './config.js';

export const PHRASES = {
  en: {
    none: 'No event in the area',
    item: ({ what, km }) => `${what}${km === null ? '' : `, ${km} km away`}`,
    list: ({ head, items }) => `${head}: ${items.join('; ')}.`,
    more: ({ count }) => `and ${count} more`,
    events: ({ count }) => (count === 1 ? '1 event' : `${count} events`),
    noEvent: 'No event in your area.',
    unread: 'The feeds could not be read.',
  },
  fr: {
    none: 'Aucun événement dans la zone',
    item: ({ what, km }) => `${what}${km === null ? '' : `, à ${km} km`}`,
    list: ({ head, items }) => `${head} : ${items.join(' ; ')}.`,
    more: ({ count }) => `et ${count} de plus`,
    events: ({ count }) => (count === 1 ? '1 événement' : `${count} événements`),
    noEvent: 'Aucun événement dans votre zone.',
    unread: "Les flux n'ont pas pu être lus.",
  },
  de: {
    none: 'Kein Ereignis im Gebiet',
    item: ({ what, km }) => `${what}${km === null ? '' : `, ${km} km entfernt`}`,
    list: ({ head, items }) => `${head}: ${items.join('; ')}.`,
    more: ({ count }) => `und ${count} weitere`,
    events: ({ count }) => (count === 1 ? '1 Ereignis' : `${count} Ereignisse`),
    noEvent: 'Kein Ereignis in deinem Gebiet.',
    unread: 'Die Feeds konnten nicht gelesen werden.',
  },
  es: {
    none: 'Ningún evento en la zona',
    item: ({ what, km }) => `${what}${km === null ? '' : `, a ${km} km`}`,
    list: ({ head, items }) => `${head}: ${items.join('; ')}.`,
    more: ({ count }) => `y ${count} más`,
    events: ({ count }) => (count === 1 ? '1 evento' : `${count} eventos`),
    noEvent: 'Ningún evento en su zona.',
    unread: 'No se pudieron leer los feeds.',
  },
};

// Why a feed could not be read (FeedError and FeedFormatError kinds).
export const ERRORS = {
  en: {
    network: 'unreachable',
    timeout: 'no answer',
    http: ({ status }) => `HTTP error ${status}`,
    too_large: 'larger than 5 MB',
    format: 'not a GeoJSON, RSS or Atom feed',
  },
  fr: {
    network: 'injoignable',
    timeout: 'pas de réponse',
    http: ({ status }) => `erreur HTTP ${status}`,
    too_large: 'plus de 5 Mo',
    format: 'pas un flux GeoJSON, RSS ou Atom',
  },
  de: {
    network: 'nicht erreichbar',
    timeout: 'keine Antwort',
    http: ({ status }) => `HTTP-Fehler ${status}`,
    too_large: 'größer als 5 MB',
    format: 'kein GeoJSON-, RSS- oder Atom-Feed',
  },
  es: {
    network: 'inaccesible',
    timeout: 'sin respuesta',
    http: ({ status }) => `error HTTP ${status}`,
    too_large: 'más de 5 MB',
    format: 'no es un feed GeoJSON, RSS o Atom',
  },
};

// Connection status of the Configuration screen, and messages of the actions.
export const STATUS = {
  en: {
    initFailed: 'Initialization failed, check the integration logs.',
    noFeed: 'No feed yet: paste the address of a GeoJSON, RSS or Atom feed.',
    feedDown: ({ name, reason }) => `${name}: ${reason}.`,
    invalid: ({ slots }) => `Feed ${slots}: a value is not valid (address, property or threshold).`,
    noCenter:
      'No centre: give your house a location in Gladys (Settings, Houses) or type coordinates.',
    invalidCenter: 'The coordinates are not valid: the location of your house is used.',
    truncated: ({ name }) => `${name}: more than 5,000 items, only the first ones are read.`,
    feedLine: ({ name, text }) => `${name}: ${text}`,
    summary: ({ lines, time }) => `${lines} Checked at ${time}.`,
  },
  fr: {
    initFailed: "L'initialisation a échoué, consultez les logs de l'intégration.",
    noFeed: "Aucun flux pour l'instant : collez l'adresse d'un flux GeoJSON, RSS ou Atom.",
    feedDown: ({ name, reason }) => `${name} : ${reason}.`,
    invalid: ({ slots }) =>
      `Flux ${slots} : une valeur n'est pas valide (adresse, propriété ou seuil).`,
    noCenter:
      'Aucun centre : indiquez la position de votre maison dans Gladys (Paramètres, Maisons) ou saisissez des coordonnées.',
    invalidCenter:
      'Les coordonnées ne sont pas valides : la position de votre maison est utilisée.',
    truncated: ({ name }) => `${name} : plus de 5 000 éléments, seuls les premiers sont lus.`,
    feedLine: ({ name, text }) => `${name} : ${text}`,
    summary: ({ lines, time }) => `${lines} Vérifié à ${time}.`,
  },
  de: {
    initFailed: 'Initialisierung fehlgeschlagen, sieh dir die Protokolle der Integration an.',
    noFeed: 'Noch kein Feed: Füge die Adresse eines GeoJSON-, RSS- oder Atom-Feeds ein.',
    feedDown: ({ name, reason }) => `${name}: ${reason}.`,
    invalid: ({ slots }) =>
      `Feed ${slots}: Ein Wert ist ungültig (Adresse, Eigenschaft oder Schwelle).`,
    noCenter:
      'Kein Mittelpunkt: Gib deinem Haus in Gladys einen Standort (Einstellungen, Häuser) oder trage Koordinaten ein.',
    invalidCenter: 'Die Koordinaten sind ungültig: Der Standort deines Hauses wird verwendet.',
    truncated: ({ name }) => `${name}: mehr als 5.000 Einträge, nur die ersten werden gelesen.`,
    feedLine: ({ name, text }) => `${name}: ${text}`,
    summary: ({ lines, time }) => `${lines} Geprüft um ${time}.`,
  },
  es: {
    initFailed: 'La inicialización ha fallado, consulte los registros de la integración.',
    noFeed: 'Todavía no hay feed: pegue la dirección de un feed GeoJSON, RSS o Atom.',
    feedDown: ({ name, reason }) => `${name}: ${reason}.`,
    invalid: ({ slots }) => `Feed ${slots}: un valor no es válido (dirección, propiedad o umbral).`,
    noCenter:
      'Sin centro: indique la ubicación de su casa en Gladys (Ajustes, Casas) o introduzca coordenadas.',
    invalidCenter: 'Las coordenadas no son válidas: se usa la ubicación de su casa.',
    truncated: ({ name }) => `${name}: más de 5000 elementos, solo se leen los primeros.`,
    feedLine: ({ name, text }) => `${name}: ${text}`,
    summary: ({ lines, time }) => `${lines} Comprobado a las ${time}.`,
  },
};

/** One entry of a message table, in every language: `{ en, fr, de, es }`. */
export function render(table, key, params = {}) {
  return Object.fromEntries(
    LANGUAGES.map((language) => {
      const entry = table[language][key];
      return [language, typeof entry === 'function' ? entry(params) : entry];
    }),
  );
}

/** Several multi-language texts joined, language by language. */
export function join(...messages) {
  return Object.fromEntries(
    LANGUAGES.map((language) => [
      language,
      messages
        .filter(Boolean)
        .map((message) => message[language])
        .join(' '),
    ]),
  );
}

/** Why a feed failed, in one language. */
export function reasonOf(error, language) {
  const entry = ERRORS[language][error?.kind] ?? ERRORS[language].network;
  return typeof entry === 'function' ? entry({ status: error.status ?? '?' }) : entry;
}

const locale = (language) => (language === 'en' ? 'en-GB' : language);

/** A date in the user's time zone (TZ, set by the Gladys supervisor), e.g. "13/10 18:35". */
export function formatDate(time, language) {
  return new Intl.DateTimeFormat(locale(language), {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(time));
}

/** A time of day, e.g. "18:35". */
export function formatTime(time, language) {
  return new Intl.DateTimeFormat(locale(language), {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(time));
}

/** A number in the user's language, e.g. "1 234" or "4,5" in French. */
export function formatNumber(value, language, digits = 0) {
  return new Intl.NumberFormat(locale(language), {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(value);
}

export const kmText = (distance, language) =>
  formatNumber(distance, language, distance < 10 ? 1 : 0);

const clip = (text, max) => (text.length <= max ? text : `${text.slice(0, max - 1)}…`);

/** The title of an event, never empty. */
export const titleOf = (event) => event.title || event.categories[0] || event.key;

/** The value of the "Latest event" feature: "M 4.6 - 91 km ESE of Tuensang · 1,234 km". */
export function describe(event, language) {
  return clip(
    [titleOf(event), event.distanceKm === null ? '' : `${kmText(event.distanceKm, language)} km`]
      .filter(Boolean)
      .join(' · '),
    250,
  );
}

// Events named in one sentence: a scene that reads it aloud stays short.
export const SENTENCE_EVENTS = 5;

/** The followed events as one sentence, nearest first. */
export function sentence(events, language) {
  const p = PHRASES[language];
  if (events.length === 0) {
    return p.noEvent;
  }
  const parts = events.slice(0, SENTENCE_EVENTS).map((event) =>
    p.item({
      what: clip(titleOf(event), 120),
      km: event.distanceKm === null ? null : kmText(event.distanceKm, language),
    }),
  );
  const rest = events.length - SENTENCE_EVENTS;
  if (rest > 0) {
    parts.push(p.more({ count: rest }));
  }
  return p.list({ head: p.events({ count: events.length }), items: parts });
}
