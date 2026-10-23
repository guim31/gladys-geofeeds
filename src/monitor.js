// -----------------------------------------------------------------------------
// The monitor: reads every configured feed each `refresh_interval` minutes,
// keeps the events of the followed area, publishes the states and transport
// badges of the devices, fires the scene triggers and serves the widget and
// the actions.
//
// Followed events of a feed: within its radius of the centre (the coordinates
// of the configuration, or the first located house of Gladys; radius 0 keeps
// the whole feed), not older than `max_age`, and matching the optional
// category words and numeric threshold of the feed.
//
// Triggers: "new event" when an event enters the followed set, "event removed"
// when it leaves it (gone from the feed, or out of the filters). The first
// reading of a feed, and the first one after a configuration change, fire
// nothing: what is there is the starting point, not news. The followed set is
// kept under /data, so a restart fires nothing either. A failed reading
// changes nothing.
//
// States: `publishChangedStates` sends only what changed, plus a heartbeat
// every 12 hours. The coordinates of the centre and the feed addresses (they
// may hold a token) are never logged: hosts only.
// -----------------------------------------------------------------------------

import { DEVICE_TRANSPORTS, createLogger } from '@gladysassistant/integration-sdk';
import { NO_EVENT_KM, MAX_COUNT, buildDevice, deviceIds, feedName, slotOf } from './device.js';
import { distanceKm } from './geo.js';
import { FeedError, fetchFeed, hostOf } from './http.js';
import { FeedFormatError, parseFeed, toNumber } from './parse.js';
import { PHRASES, STATUS, describe, join, reasonOf, render, titleOf } from './messages.js';
import { LANGUAGES } from './config.js';

const logger = createLogger({ name: 'geofeeds' });

export const WIDGET_KEY = 'events';
export const TRIGGERS = { NEW: 'new_event', REMOVED: 'event_removed' };

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

export const DEFAULT_TIMINGS = {
  heartbeatMs: 12 * HOUR,
  // requestWidgetRefresh is rate-limited to one call every 10 s by the core.
  widgetRefreshMs: 10000,
  // The houses of Gladys are read again this often (no update event).
  housesMaxAgeMs: HOUR,
};

// Scene events fired by one reading of one feed, per trigger: the core takes
// 300 a minute, and a burst is better summed up by the device than by scenes.
export const MAX_EVENTS_PER_CYCLE = 20;
// Followed events kept under /data per feed (enough for "event removed").
export const MAX_KEPT = 500;

const byDistanceThenTime = (a, b) =>
  (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity) || (b.time ?? 0) - (a.time ?? 0);

const round1 = (value) => Math.round(value * 10) / 10;

export class Monitor {
  /**
   * @param {object} options
   * @param {object} options.gladys GladysIntegration (or the SDK fake)
   * @param {object} options.store see src/store.js
   * @param {Function} [options.fetch] fetch
   * @param {boolean} [options.timers] false: no background timer (tests drive the cycles)
   * @param {Function} [options.now] clock in ms
   * @param {object} [options.timings] overrides of DEFAULT_TIMINGS
   */
  constructor({ gladys, store, fetch: fetchImpl, timers = true, now, timings }) {
    this.gladys = gladys;
    this.store = store;
    this.fetch = fetchImpl ?? ((...args) => fetch(...args));
    this.timers = timers;
    this.now = now ?? (() => Date.now());
    this.timings = { ...DEFAULT_TIMINGS, ...timings };
    this.config = null;
    this.data = emptyData();
    // slot → { feed, events, ok, error, lastSuccessAt, lastReadAt, truncated, seed }
    this.feeds = new Map();
    this.lastCycleAt = -Infinity;
    this.house = undefined;
    this.houseReadAt = -Infinity;
    this.statusKey = undefined;
    this.transportsKey = undefined;
    this.cycleTimer = null;
    this.running = null;
    this.lastRefreshAt = -Infinity;
    this.refreshTimer = null;
    this.signature = null;
    this.stopped = false;
    this.failing = new Set();
  }

  /** Log a failure once (warn or error), then at debug until `recovered(key)`. */
  failed(key, level, message, err) {
    const details = err ? [message, err] : [message];
    if (this.failing.has(key)) {
      logger.debug(...details);
      return;
    }
    this.failing.add(key);
    logger[level](...details);
  }

  /** One line when a failure logged by `failed(key)` is over. */
  recovered(key, message) {
    if (this.failing.delete(key)) {
      logger.info(message);
    }
  }

  // --- Lifecycle -------------------------------------------------------------

  async start(config) {
    const saved = await this.store.load();
    if (saved?.version === 1 && saved.feeds && typeof saved.feeds === 'object') {
      this.data = { ...emptyData(), ...saved };
    }
    this.applyConfig(config, { seedAll: false });
    await this.publishDiscovered();
    this.warnAboutConfig();
    logger.info(`Started: ${config.feeds.length} feed(s) read every ${config.refreshMinutes} min`);
    this.schedule();
    this.runCycle();
  }

  /**
   * Takes a configuration: the feed states follow the slots. `seedAll`: the
   * next reading of every feed is a starting point (the filters changed).
   */
  applyConfig(config, { seedAll }) {
    this.config = config;
    const slots = new Set(config.feeds.map((feed) => feed.slot));
    for (const slot of [...this.feeds.keys()]) {
      if (!slots.has(slot)) {
        this.feeds.delete(slot);
      }
    }
    for (const slot of Object.keys(this.data.feeds)) {
      if (!slots.has(Number(slot))) {
        delete this.data.feeds[slot];
      }
    }
    for (const feed of config.feeds) {
      const saved = this.data.feeds[feed.slot];
      // A new address in the slot: what was followed belongs to the old feed.
      if (saved && saved.url !== feed.url) {
        delete this.data.feeds[feed.slot];
      }
      const state = this.feeds.get(feed.slot);
      const urlChanged = state && state.feed.url !== feed.url;
      this.feeds.set(feed.slot, {
        events: [],
        ok: null,
        error: null,
        lastSuccessAt: null,
        lastReadAt: -Infinity,
        truncated: false,
        ...(urlChanged ? {} : state),
        feed,
        seed: seedAll || !this.data.feeds[feed.slot] || Boolean(urlChanged),
      });
    }
    this.store.save(this.data);
  }

  /** Reconnection: Gladys may have restarted, publish everything again. */
  async resync(config) {
    this.config = config;
    this.houseReadAt = -Infinity;
    await this.publishDiscovered();
    this.statusKey = undefined;
    this.transportsKey = undefined;
    await this.updateConnectionStatus();
    this.gladys.forgetPublishedStates?.();
    await this.publishStates();
    await this.publishTransports();
    this.requestRefresh();
  }

  async reconfigure(config) {
    // A cycle already running finishes with the old configuration, whole.
    await this.running;
    this.houseReadAt = -Infinity;
    this.applyConfig(config, { seedAll: true });
    logger.info(`Configuration saved: ${config.feeds.length} feed(s)`);
    this.warnAboutConfig();
    await this.publishDiscovered();
    this.schedule();
    await this.runCycle();
    this.requestRefresh();
  }

  async stop() {
    this.stopped = true;
    clearInterval(this.cycleTimer);
    clearTimeout(this.refreshTimer);
    this.cycleTimer = null;
    await this.running?.catch(() => {});
    await this.store.flush();
  }

  schedule() {
    if (!this.timers || this.stopped) {
      return;
    }
    clearInterval(this.cycleTimer);
    this.cycleTimer = setInterval(() => this.runCycle(), this.config.refreshMinutes * MINUTE);
    this.cycleTimer.unref?.();
  }

  warnAboutConfig() {
    const { invalidCenter, invalid, feeds } = this.config;
    if (invalidCenter) {
      logger.warn('The coordinates of the configuration are not valid: the house is used');
    }
    for (const feed of invalid) {
      logger.warn(`Feed ${feed.slot}: not valid, ignored: ${feed.problems.join(', ')}`);
    }
    if (feeds.length === 0) {
      logger.info('No feed configured yet');
    }
  }

  async publishDiscovered() {
    const devices = this.config.feeds.map((feed) =>
      buildDevice(this.gladys, feed, this.config.language),
    );
    await this.gladys.publishDiscoveredDevices(devices);
  }

  /** The slots whose device is added in Gladys. */
  createdSlots() {
    return new Set(
      (this.gladys.devices ?? [])
        .map((device) => slotOf(this.gladys, device.external_id))
        .filter((slot) => slot !== null && this.feeds.has(slot)),
    );
  }

  // --- Centre ------------------------------------------------------------------

  /** The centre: the configured coordinates, else the first located house. */
  async center() {
    if (this.config.center) {
      return this.config.center;
    }
    if (this.now() - this.houseReadAt >= this.timings.housesMaxAgeMs) {
      try {
        const houses = await this.gladys.getHouses();
        this.house =
          houses.find(
            (house) => Number.isFinite(house.latitude) && Number.isFinite(house.longitude),
          ) ?? null;
        this.houseReadAt = this.now();
        this.recovered('houses', 'The houses of Gladys are readable again');
      } catch (err) {
        this.failed('houses', 'warn', `Cannot read the houses of Gladys: ${err.message}`);
      }
    }
    return this.house ? { latitude: this.house.latitude, longitude: this.house.longitude } : null;
  }

  hasCenter() {
    return Boolean(this.config.center || this.house);
  }

  // --- Cycles ------------------------------------------------------------------

  /** Reads every feed (or the given slots). */
  runCycle(slots = null) {
    if (this.running || this.stopped) {
      return this.running;
    }
    this.running = this.cycle(slots)
      .catch((err) => this.failed('cycle', 'error', 'Refresh cycle failed', err))
      .finally(() => {
        this.running = null;
      });
    return this.running;
  }

  async cycle(slots) {
    this.lastCycleAt = this.now();
    const center = await this.center();
    for (const state of this.feeds.values()) {
      if (slots === null || slots.includes(state.feed.slot)) {
        await this.readFeed(state, center);
      }
    }
    this.recovered('cycle', 'Refresh cycles work again');
    this.store.save(this.data);
    await this.publishStates();
    await this.publishTransports();
    await this.updateConnectionStatus();
    const signature = [...this.feeds.values()]
      .map((s) => `${s.feed.slot}:${s.ok}:${s.events.map((e) => e.key).join(',')}`)
      .join('|');
    if (signature !== this.signature) {
      this.signature = signature;
      this.requestRefresh();
    }
  }

  async readFeed(state, center) {
    const { feed } = state;
    const host = hostOf(feed.url);
    const key = `feed-${feed.slot}`;
    state.lastReadAt = this.now();
    let parsed;
    try {
      const { body } = await fetchFeed(this.fetch, feed.url);
      try {
        parsed = parseFeed(body);
      } catch (err) {
        if (err instanceof FeedFormatError) {
          throw new FeedError('format', `${host}: ${err.message}`);
        }
        throw err;
      }
    } catch (err) {
      state.ok = false;
      state.error = err instanceof FeedError ? err : new FeedError('network', err.message);
      this.failed(key, 'warn', `Feed ${feed.slot} (${host}) cannot be read: ${err.message}`);
      return;
    }
    this.recovered(key, `Feed ${feed.slot} (${host}) can be read again`);
    state.ok = true;
    state.error = null;
    state.truncated = parsed.truncated;
    state.lastSuccessAt = this.now();
    const followed = this.follow(parsed.events, feed, center);
    logger.debug(
      `Feed ${feed.slot} (${host}, ${parsed.format}): ${parsed.events.length} located item(s), ${parsed.skipped} without position, ${followed.length} followed`,
    );
    await this.detectChanges(state, followed);
    state.events = followed;
  }

  /** The events of the followed area, with their distance and value, nearest first. */
  follow(events, feed, center) {
    const maxAgeMs = this.config.maxAgeHours * HOUR;
    const now = this.now();
    return events
      .map((event) => ({
        ...event,
        distanceKm: center
          ? distanceKm(center.latitude, center.longitude, event.latitude, event.longitude)
          : null,
        value: feed.property ? toNumber(event.properties[feed.property]) : null,
      }))
      .filter((event) => {
        if (feed.radiusKm > 0 && (event.distanceKm === null || event.distanceKm > feed.radiusKm)) {
          return false;
        }
        if (maxAgeMs > 0 && event.time !== null && now - event.time > maxAgeMs) {
          return false;
        }
        if (feed.categories.length > 0) {
          const own = event.categories.map((c) => c.toLowerCase());
          if (!feed.categories.some((word) => own.some((c) => c.includes(word)))) {
            return false;
          }
        }
        if (feed.minValue !== null && (event.value === null || event.value < feed.minValue)) {
          return false;
        }
        return true;
      })
      .sort(byDistanceThenTime);
  }

  /** Fire the scene triggers, and remember what is followed. */
  async detectChanges(state, followed) {
    const { feed } = state;
    const saved = this.data.feeds[feed.slot];
    const before = saved?.followed ?? {};
    const seed = state.seed || !saved;
    state.seed = false;
    const current = {};
    for (const event of followed.slice(0, MAX_KEPT)) {
      current[event.key] = this.eventData(feed, event);
    }
    this.data.feeds[feed.slot] = { url: feed.url, followed: current };
    if (seed) {
      logger.debug(`Feed ${feed.slot}: ${followed.length} event(s) taken as known`);
      return;
    }
    // Past MAX_KEPT an event is not remembered: neither new nor removed.
    const added = followed.slice(0, MAX_KEPT).filter((event) => !before[event.key]);
    const removed = Object.entries(before).filter(([eventKey]) => !current[eventKey]);
    const known = new Set(followed.map((event) => event.key));
    for (const [index, event] of added.entries()) {
      if (index >= MAX_EVENTS_PER_CYCLE) {
        logger.debug(`Feed ${feed.slot}: ${added.length - index} more new event(s) not sent`);
        break;
      }
      await this.fire(TRIGGERS.NEW, current[event.key]);
    }
    let sent = 0;
    for (const [eventKey, data] of removed) {
      if (known.has(eventKey)) {
        continue;
      }
      if (sent >= MAX_EVENTS_PER_CYCLE) {
        logger.debug(`Feed ${feed.slot}: more removed event(s) not sent`);
        break;
      }
      sent += 1;
      await this.fire(TRIGGERS.REMOVED, {
        ...data,
        feed_name: feedName(feed, this.config.language),
      });
    }
  }

  async fire(key, data) {
    logger.debug(`Scene event ${key}: ${data.title}`);
    try {
      await this.gladys.publishSceneEvent(key, data);
      this.recovered('scene', 'Scene triggers work again');
    } catch (err) {
      this.failed('scene', 'warn', `Firing the scene trigger failed: ${err.message}`);
    }
  }

  /** The flat data of a scene event (fields, then variables of the manifest). */
  eventData(feed, event) {
    const language = this.config.language;
    const properties = JSON.stringify(event.properties);
    return {
      feed: deviceIds(this.gladys, feed.slot).device,
      feed_name: feedName(feed, language),
      title: titleOf(event).slice(0, 500),
      category: event.categories.join(', ').slice(0, 300),
      distance_km: event.distanceKm === null ? null : round1(event.distanceKm),
      value: event.value,
      time: event.time === null ? null : new Date(event.time).toISOString(),
      url: event.url,
      summary: describe(event, language),
      latitude: Math.round(event.latitude * 1e4) / 1e4,
      longitude: Math.round(event.longitude * 1e4) / 1e4,
      properties: properties.length <= 1000 ? properties : `${properties.slice(0, 999)}…`,
    };
  }

  // --- States ------------------------------------------------------------------

  statesOf(state) {
    if (state.lastSuccessAt === null) {
      return [];
    }
    const ids = deviceIds(this.gladys, state.feed.slot);
    const language = this.config.language;
    const events = state.events;
    const nearest = events[0] ?? null;
    const latest = events.reduce(
      (newest, event) =>
        newest === null || (event.time ?? 0) > (newest.time ?? 0) ? event : newest,
      null,
    );
    const states = [
      { device_feature_external_id: ids.count, state: Math.min(events.length, MAX_COUNT) },
      {
        device_feature_external_id: ids.nearest,
        text: nearest ? titleOf(nearest).slice(0, 250) : PHRASES[language].none,
      },
      {
        device_feature_external_id: ids.latest,
        text: latest ? describe(latest, language) : PHRASES[language].none,
      },
    ];
    // Without a centre there is no distance: nothing published rather than a false one.
    if (this.hasCenter()) {
      states.push({
        device_feature_external_id: ids.distance,
        state:
          nearest?.distanceKm === null || nearest?.distanceKm === undefined
            ? NO_EVENT_KM
            : round1(nearest.distanceKm),
      });
    }
    return states;
  }

  async publishStates(only = null) {
    const created = this.createdSlots();
    const states = [...this.feeds.values()]
      .filter(
        (state) => created.has(state.feed.slot) && (only === null || only === state.feed.slot),
      )
      .flatMap((state) => this.statesOf(state));
    if (states.length === 0) {
      return;
    }
    try {
      await this.gladys.publishChangedStates(states, { heartbeat: this.timings.heartbeatMs });
      this.recovered('publish', 'Publishing the states works again');
    } catch (err) {
      this.failed('publish', 'warn', `Publishing the states failed: ${err.message}`);
    }
  }

  /** The transport badge of each added device: cloud when read, unreachable otherwise. */
  async publishTransports() {
    const created = this.createdSlots();
    const transports = [...this.feeds.values()]
      .filter((state) => created.has(state.feed.slot) && state.ok !== null)
      .map((state) => {
        const externalId = deviceIds(this.gladys, state.feed.slot).device;
        if (state.ok) {
          return { external_id: externalId, transport: DEVICE_TRANSPORTS.CLOUD };
        }
        // The reason is in the connection status and the widget: a badge
        // message needs `degraded`, which "unreachable" is not.
        return { external_id: externalId, transport: DEVICE_TRANSPORTS.UNREACHABLE };
      });
    const key = JSON.stringify(transports);
    if (transports.length === 0 || key === this.transportsKey) {
      return;
    }
    try {
      await this.gladys.publishTransports(transports);
      this.transportsKey = key;
    } catch (err) {
      this.failed('transports', 'warn', `Publishing the transport badges failed: ${err.message}`);
    }
  }

  async updateConnectionStatus() {
    const { feeds, invalid, invalidCenter } = this.config;
    const language = this.config.language;
    const parts = [];
    if (feeds.length === 0) {
      parts.push(render(STATUS, 'noFeed'));
    }
    if (invalid.length > 0) {
      parts.push(render(STATUS, 'invalid', { slots: invalid.map((feed) => feed.slot).join(', ') }));
    }
    for (const state of this.feeds.values()) {
      if (state.ok === false) {
        parts.push(
          Object.fromEntries(
            LANGUAGES.map((lang) => [
              lang,
              render(STATUS, 'feedDown', {
                name: feedName(state.feed, language),
                reason: reasonOf(state.error, lang),
              })[lang],
            ]),
          ),
        );
      } else if (state.truncated) {
        parts.push(render(STATUS, 'truncated', { name: feedName(state.feed, language) }));
      }
    }
    const needsCenter = feeds.some((feed) => feed.radiusKm > 0);
    if (needsCenter && !this.hasCenter()) {
      parts.push(render(STATUS, 'noCenter'));
    } else if (invalidCenter) {
      parts.push(render(STATUS, 'invalidCenter'));
    }
    const message = parts.length > 0 ? join(...parts) : undefined;
    const connected = [...this.feeds.values()].some((state) => state.ok === true);
    const key = JSON.stringify([connected, message]);
    if (key === this.statusKey) {
      return;
    }
    this.statusKey = key;
    await this.gladys.setConnectionStatus(connected, message).catch(() => {});
  }

  // --- Gladys events -----------------------------------------------------------

  async onDeviceCreated(device) {
    const slot = slotOf(this.gladys, device?.external_id);
    const state = this.feeds.get(slot);
    if (!state) {
      return;
    }
    if (state.lastSuccessAt === null) {
      await this.runCycle([slot]);
      await this.running;
    }
    // The SDK forgot the states of the device: everything is published again.
    this.gladys.forgetPublishedStates?.(deviceIds(this.gladys, slot).device);
    await this.publishStates(slot);
    this.transportsKey = undefined;
    await this.publishTransports();
    this.requestRefresh();
  }

  /** onPoll fallback: should_poll is false, but a Gladys polling anyway gets an answer. */
  async poll(device) {
    const slot = slotOf(this.gladys, device?.external_id);
    const state = this.feeds.get(slot);
    if (!state) {
      return;
    }
    if (this.now() - state.lastReadAt >= (this.config.refreshMinutes * MINUTE) / 2) {
      await this.runCycle([slot]);
    } else {
      await this.publishStates(slot);
    }
  }

  /** Every feed read again if the last cycle is older than one interval. */
  async fresh() {
    if (this.now() - this.lastCycleAt >= this.config.refreshMinutes * MINUTE) {
      await this.runCycle();
    }
    await this.running;
    return [...this.feeds.values()];
  }

  // --- Widget -------------------------------------------------------------------

  requestRefresh() {
    if (this.stopped) {
      return;
    }
    const now = this.now();
    const wait = this.lastRefreshAt + this.timings.widgetRefreshMs - now;
    if (wait <= 0) {
      this.lastRefreshAt = now;
      this.gladys.requestWidgetRefresh(WIDGET_KEY);
    } else if (this.timers && !this.refreshTimer) {
      this.refreshTimer = setTimeout(() => {
        this.refreshTimer = null;
        this.requestRefresh();
      }, wait);
      this.refreshTimer.unref?.();
    }
  }
}

function emptyData() {
  return { version: 1, feeds: {} };
}
