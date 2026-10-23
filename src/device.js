// -----------------------------------------------------------------------------
// One Gladys device per configured feed, keyed on its slot (1 to 5): the
// external id stays when the address of the slot changes (the feed moved),
// and the followed events of the slot start again from zero.
//
// Features (couples checked against the Gladys front, see
// test/gladys-rules.test.js):
//   - event_count       counter-sensor/integer: the followed events;
//   - nearest_distance  distance-sensor/decimal, km: the nearest followed
//                       event. Without any, NO_EVENT_KM (half the
//                       circumference of the Earth): a "below 20 km"
//                       condition stays false;
//   - nearest_event     text/text: the title of the nearest followed event;
//   - latest_event      text/text: the newest followed event, in words.
//
// Reachability is the transport badge of the device (cloud / unreachable,
// see src/monitor.js), not a feature. Published with should_poll: false: the
// readings run on the container's own timer.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES as TYPES,
  DEVICE_FEATURE_UNITS,
} from '@gladysassistant/integration-sdk';
import { hostOf } from './http.js';

export const DEVICE_TYPE = 'feed';
export const FEATURE_KEYS = {
  COUNT: 'event_count',
  DISTANCE: 'nearest_distance',
  NEAREST: 'nearest_event',
  LATEST: 'latest_event',
};

export const NO_EVENT_KM = 20038;
export const MAX_COUNT = 10000;

// Feature names, frozen at creation in Gladys (language of the configuration).
export const NAMES = {
  en: {
    device: 'Geo feed',
    event_count: 'Events in the area',
    nearest_distance: 'Nearest event distance',
    nearest_event: 'Nearest event',
    latest_event: 'Latest event',
  },
  fr: {
    device: 'Flux géolocalisé',
    event_count: 'Événements dans la zone',
    nearest_distance: "Distance de l'événement le plus proche",
    nearest_event: 'Événement le plus proche',
    latest_event: 'Dernier événement',
  },
  de: {
    device: 'Geo-Feed',
    event_count: 'Ereignisse im Gebiet',
    nearest_distance: 'Entfernung des nächsten Ereignisses',
    nearest_event: 'Nächstes Ereignis',
    latest_event: 'Neuestes Ereignis',
  },
  es: {
    device: 'Feed geolocalizado',
    event_count: 'Eventos en la zona',
    nearest_distance: 'Distancia del evento más cercano',
    nearest_event: 'Evento más cercano',
    latest_event: 'Último evento',
  },
};

export const platformId = (slot) => `slot-${slot}`;

/** External ids of the device of a slot and of its features. */
export function deviceIds(gladys, slot) {
  const ids = gladys.externalIds(DEVICE_TYPE, platformId(slot));
  return {
    device: ids.device,
    count: ids.feature(FEATURE_KEYS.COUNT),
    distance: ids.feature(FEATURE_KEYS.DISTANCE),
    nearest: ids.feature(FEATURE_KEYS.NEAREST),
    latest: ids.feature(FEATURE_KEYS.LATEST),
  };
}

/** The slot of one of our device external ids, or null. */
export function slotOf(gladys, externalId) {
  const match = /:slot-(\d)$/.exec(String(externalId ?? ''));
  if (!match) {
    return null;
  }
  const slot = Number(match[1]);
  return deviceIds(gladys, slot).device === externalId ? slot : null;
}

/** The name shown for a feed: the one typed, else "Geo feed 2 (host)". */
export function feedName(feed, language = 'fr') {
  if (feed.name) {
    return feed.name;
  }
  const names = NAMES[language] ?? NAMES.fr;
  return `${names.device} ${feed.slot} (${hostOf(feed.url)})`.slice(0, 60);
}

const sensor = (name, externalId, category, type, extra) => ({
  name,
  external_id: externalId,
  category,
  type,
  read_only: true,
  has_feedback: false,
  ...extra,
});

/** The discovery payload of the device of a feed. */
export function buildDevice(gladys, feed, language = 'fr') {
  const ids = deviceIds(gladys, feed.slot);
  const names = NAMES[language] ?? NAMES.fr;
  return {
    name: feedName(feed, language),
    external_id: ids.device,
    model: 'GeoJSON / GeoRSS',
    should_poll: false,
    params: [],
    features: [
      sensor(
        names.event_count,
        ids.count,
        DEVICE_FEATURE_CATEGORIES.COUNTER_SENSOR,
        TYPES.SENSOR.INTEGER,
        { keep_history: true, min: 0, max: MAX_COUNT },
      ),
      sensor(
        names.nearest_distance,
        ids.distance,
        DEVICE_FEATURE_CATEGORIES.DISTANCE_SENSOR,
        TYPES.SENSOR.DECIMAL,
        { unit: DEVICE_FEATURE_UNITS.KM, keep_history: true, min: 0, max: NO_EVENT_KM },
      ),
      sensor(names.nearest_event, ids.nearest, DEVICE_FEATURE_CATEGORIES.TEXT, TYPES.TEXT.TEXT, {
        keep_history: false,
        min: 0,
        max: 0,
      }),
      sensor(names.latest_event, ids.latest, DEVICE_FEATURE_CATEGORIES.TEXT, TYPES.TEXT.TEXT, {
        keep_history: false,
        min: 0,
        max: 0,
      }),
    ],
  };
}
