// -----------------------------------------------------------------------------
// Dashboard widget (manifest `widgets`, Gladys 5.1+): `events`.
//
// A heading with the number of followed events, a status list with one row per
// feed (its count, or why it cannot be read), then the nearest events of the
// chosen feeds as a `card-list` (8 rows at most, the core's cap): the title,
// the feed and distance as subtitle, the first category as badge. Tapping a
// row opens the core's detail panel: the summary of the feed, the date and a
// link to the event (https only, a rule of the card-list). The caption gives
// the time of the last reading.
// Settings: the feeds to show (their devices; empty: all).
// Budget: 2 texts, 1 status, 1 card-list.
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { feedName, slotOf } from './device.js';
import { formatDate, kmText, reasonOf, titleOf } from './messages.js';
import { WIDGET_KEY } from './monitor.js';

export const MAX_ITEMS = 8;
export const MAX_ROWS = 10;
export const TTL_SECONDS = 300;

export const TEXT = {
  waiting: {
    en: 'Waiting for the feeds…',
    fr: 'En attente des flux…',
    de: 'Warte auf die Feeds…',
    es: 'Esperando los feeds…',
  },
  noFeed: {
    en: 'No feed configured',
    fr: 'Aucun flux configuré',
    de: 'Kein Feed eingerichtet',
    es: 'Ningún feed configurado',
  },
  none: {
    en: 'No event in the area',
    fr: 'Aucun événement proche',
    de: 'Kein Ereignis im Gebiet',
    es: 'Ningún evento cercano',
  },
  one: {
    en: '1 event nearby',
    fr: '1 événement proche',
    de: '1 Ereignis in der Nähe',
    es: '1 evento cercano',
  },
  many: {
    en: ' events nearby',
    fr: ' événements proches',
    de: ' Ereignisse in der Nähe',
    es: ' eventos cercanos',
  },
  shown: { en: ' shown', fr: ' affichés', de: ' angezeigt', es: ' mostrados' },
  updated: { en: 'Read at', fr: 'Lu à', de: 'Gelesen um', es: 'Leído a las' },
  open: { en: 'Open', fr: 'Ouvrir', de: 'Öffnen', es: 'Abrir' },
};

const t = (text, language) => text[language] ?? text.en;
const clip = (text, max) => (text.length <= max ? text : `${text.slice(0, max - 1)}…`);

function heading(count, language) {
  if (count === 0) {
    return t(TEXT.none, language);
  }
  if (count === 1) {
    return t(TEXT.one, language);
  }
  const shown = count > MAX_ITEMS ? ` (${MAX_ITEMS}${t(TEXT.shown, language)})` : '';
  return `${count}${t(TEXT.many, language)}${shown}`;
}

/** The feed states the widget shows: the chosen devices, or every feed. */
export function chosenStates(monitor, settings) {
  const chosen = [settings?.feeds ?? []]
    .flat()
    .map((id) => slotOf(monitor.gladys, id))
    .filter((slot) => slot !== null);
  const states = [...monitor.feeds.values()];
  return chosen.length === 0 ? states : states.filter((s) => chosen.includes(s.feed.slot));
}

/** One row of the list, and its detail panel. */
export function itemOf(event, name, language) {
  const distance = event.distanceKm === null ? null : `${kmText(event.distanceKm, language)} km`;
  const item = {
    title: clip(titleOf(event), 60),
    subtitle: clip([name, distance].filter(Boolean).join(' · '), 60),
    description: clip(
      [event.summary, event.time === null ? null : formatDate(event.time, language)]
        .filter(Boolean)
        .join('\n') || titleOf(event),
      2000,
    ),
  };
  if (event.categories[0]) {
    item.badge = { text: clip(event.categories[0], 16), color: WIDGET_COLORS.INFO };
  }
  if (event.url?.startsWith('https://')) {
    item.links = [{ url: event.url, label: t(TEXT.open, language) }];
  }
  return item;
}

function row(state, monitor, language) {
  const label = clip(feedName(state.feed, monitor.config.language), 40);
  if (state.ok === false) {
    return {
      label,
      value: clip(reasonOf(state.error, language), 40),
      icon: 'wifi-off',
      color: WIDGET_COLORS.DANGER,
    };
  }
  if (state.ok === null) {
    return { label, value: '…', icon: 'clock', color: WIDGET_COLORS.NEUTRAL };
  }
  return {
    label,
    value: state.events.length,
    icon: 'map-pin',
    color: state.events.length > 0 ? WIDGET_COLORS.WARNING : WIDGET_COLORS.SUCCESS,
  };
}

export const WIDGETS = {
  [WIDGET_KEY]: {
    async get(monitor, { settings, language = 'en' } = {}) {
      const lang = TEXT.none[language] ? language : 'en';
      const states = chosenStates(monitor, settings);
      if (states.length === 0) {
        return {
          ttl_seconds: TTL_SECONDS,
          components: [{ type: 'text', variant: 'heading', text: t(TEXT.noFeed, lang) }],
        };
      }
      const read = states.filter((state) => state.lastSuccessAt !== null);
      const events = read
        .flatMap((state) =>
          state.events.map((event) => ({
            event,
            name: feedName(state.feed, monitor.config.language),
          })),
        )
        .sort(
          (a, b) =>
            (a.event.distanceKm ?? Infinity) - (b.event.distanceKm ?? Infinity) ||
            (b.event.time ?? 0) - (a.event.time ?? 0),
        );
      const components = [
        {
          type: 'text',
          variant: 'heading',
          text: read.length === 0 ? t(TEXT.waiting, lang) : heading(events.length, lang),
        },
        {
          type: 'status',
          items: states.slice(0, MAX_ROWS).map((state) => row(state, monitor, lang)),
        },
      ];
      if (events.length > 0) {
        components.push({
          type: 'card-list',
          display: 'list',
          items: events.slice(0, MAX_ITEMS).map(({ event, name }) => itemOf(event, name, lang)),
        });
      }
      const updated = Math.max(0, ...read.map((state) => state.lastSuccessAt));
      if (updated > 0) {
        components.push({
          type: 'text',
          variant: 'caption',
          text: `${t(TEXT.updated, lang)} ${formatDate(updated, lang)}`,
        });
      }
      return { ttl_seconds: TTL_SECONDS, components };
    },
  },
};
