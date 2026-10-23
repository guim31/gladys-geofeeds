// -----------------------------------------------------------------------------
// The scene action `read_events` and the configuration action `check_now`.
// Both read the feeds again when the last cycle is older than one interval.
// `read_events` answers with the followed events as one sentence (nearest
// first), for one feed or all; `check_now` tells, feed by feed, what was read.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { LANGUAGES } from './config.js';
import { NO_EVENT_KM, feedName, slotOf } from './device.js';
import { PHRASES, STATUS, formatTime, reasonOf, render, sentence } from './messages.js';

const logger = createLogger({ name: 'geofeeds-actions' });

export const SCENE_ACTION = 'read_events';
export const CONFIG_ACTION = 'check_now';

const byDistance = (a, b) => (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity);

/** Scene action: outputs `text`, `count` and `nearest_km`; throws if no feed could be read. */
export async function readEvents(monitor, fields = {}) {
  const language = monitor.config.language;
  const slot = fields.feed ? slotOf(monitor.gladys, fields.feed) : null;
  const states = (await monitor.fresh()).filter(
    (state) => slot === null || state.feed.slot === slot,
  );
  const read = states.filter((state) => state.ok);
  if (read.length === 0) {
    throw new Error(states.length === 0 ? STATUS[language].noFeed : PHRASES[language].unread);
  }
  const events = read.flatMap((state) => state.events).sort(byDistance);
  const nearest = events.find((event) => event.distanceKm !== null);
  return {
    text: sentence(events, language),
    count: events.length,
    nearest_km: nearest ? Math.round(nearest.distanceKm * 10) / 10 : NO_EVENT_KM,
  };
}

/** Configuration action: what each feed gives now, in every language. */
export async function checkNow(monitor) {
  const states = await monitor.fresh();
  logger.info(
    `Check requested: ${states.filter((s) => s.ok).length} of ${states.length} feed(s) read`,
  );
  if (states.length === 0) {
    return render(STATUS, 'noFeed');
  }
  const time = Math.max(...states.map((state) => state.lastSuccessAt ?? 0));
  return Object.fromEntries(
    LANGUAGES.map((language) => {
      const lines = states
        .map((state) =>
          STATUS[language].feedLine({
            name: feedName(state.feed, monitor.config.language),
            text: state.ok
              ? sentence(state.events, language)
              : `${reasonOf(state.error, language)}.`,
          }),
        )
        .join(' ');
      return [
        language,
        time > 0 ? STATUS[language].summary({ lines, time: formatTime(time, language) }) : lines,
      ];
    }),
  );
}
