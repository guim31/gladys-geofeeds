// -----------------------------------------------------------------------------
// A complete test world: the SDK's fake Gladys, fake feed servers serving the
// recorded feeds of test/fixtures/feeds (editable, to make events appear and
// disappear), a manual clock, a temporary /data, and the integration wired on
// top through registerHandlers. Nothing touches the network.
// -----------------------------------------------------------------------------

import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { registerHandlers } from '../../src/app.js';
import { Store } from '../../src/store.js';

process.env.LOG_LEVEL ??= 'silent';
process.env.TZ = 'Europe/Paris';

export const fixtureText = (name) =>
  readFileSync(new URL(`../fixtures/feeds/${name}`, import.meta.url), 'utf8');

// The USGS feeds were generated on 23/10/2026 at 18:03:54 UTC.
export const START = Date.parse('2026-10-23T18:04:00Z');

// A house in Anchorage, Alaska (public coordinates of the city centre).
export const HOUSE = {
  id: 'house-1',
  name: 'Home',
  selector: 'home',
  latitude: 61.2181,
  longitude: -149.9003,
};

export const URLS = {
  usgs: 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson',
  atom: 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.atom',
  gdacs: 'https://www.gdacs.org/xml/rss.xml',
  nsw: 'https://www.rfs.nsw.gov.au/feeds/majorIncidents.json',
};

// Recorded USGS events and their distance from the house.
export const NEAR = 'aka2026uzkyen'; // M2.7, 66 km WNW of Happy Valley, about 203 km
export const SAND_POINT = 'us6000u4ah'; // M4.2, about 932 km
export const SAND_POINT_2 = 'us6000u49f'; // M3.2, about 943 km

/**
 * Fake feed servers. `server.down[url]`: 'network', 'timeout' or an HTTP status.
 */
export function createServer() {
  const server = {
    bodies: {
      [URLS.usgs]: fixtureText('usgs-2.5_day.geojson'),
      [URLS.atom]: fixtureText('usgs-2.5_day.atom'),
      [URLS.gdacs]: fixtureText('gdacs-rss.xml'),
      [URLS.nsw]: fixtureText('nsw-rfs-major-incidents.json'),
    },
    down: {},
    requests: [],

    /** The USGS GeoJSON, as an object to edit. */
    usgs() {
      return JSON.parse(server.bodies[URLS.usgs]);
    },
    setUsgs(document) {
      server.bodies[URLS.usgs] = JSON.stringify(document);
    },

    /** A new USGS earthquake, copied from a recorded one. */
    addQuake(fromId, { id, latitude, longitude, mag, time } = {}) {
      const document = server.usgs();
      const feature = structuredClone(document.features.find((f) => f.id === fromId));
      feature.id = id;
      if (latitude !== undefined) {
        feature.geometry.coordinates = [longitude, latitude, 10];
      }
      if (mag !== undefined) {
        feature.properties.mag = mag;
      }
      if (time !== undefined) {
        feature.properties.time = time;
      }
      feature.properties.title = `M ${feature.properties.mag} - test ${id}`;
      document.features.unshift(feature);
      server.setUsgs(document);
    },

    removeQuake(id) {
      const document = server.usgs();
      document.features = document.features.filter((f) => f.id !== id);
      server.setUsgs(document);
    },

    async fetch(input) {
      const url = String(input);
      server.requests.push(url);
      const down = server.down[url];
      if (down === 'network') {
        throw new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } });
      }
      if (down === 'timeout') {
        const err = new Error('The operation was aborted due to timeout');
        err.name = 'TimeoutError';
        throw err;
      }
      if (down) {
        return new Response('Service Unavailable', { status: down });
      }
      const body = server.bodies[url];
      if (body === undefined) {
        return new Response('Not Found', { status: 404 });
      }
      return new Response(body, { status: 200 });
    },
  };
  return server;
}

/** A manual clock. */
export function createClock(start = START) {
  const clock = {
    time: start,
    now: () => clock.time,
    advance(ms) {
      clock.time += ms;
    },
  };
  return clock;
}

export const USGS_CONFIG = { feed_1_url: URLS.usgs, feed_1_radius: '1000', feed_1_name: 'USGS' };

/**
 * @param {object} [options]
 * @param {object} [options.config] raw integration config (default: the USGS feed, 1,000 km)
 * @param {Array} [options.devices] devices already created in Gladys
 * @param {Array} [options.houses] houses of Gladys
 * @param {object} [options.server] from createServer
 * @param {boolean} [options.connect]
 * @param {boolean} [options.timers] true: the monitor's own timer runs (mock it)
 */
export async function createWorld({
  config = USGS_CONFIG,
  devices = [],
  houses = [HOUSE],
  server = createServer(),
  connect = true,
  timers = false,
  clock = createClock(),
  dataDir = mkdtempSync(join(tmpdir(), 'gladys-geofeeds-')),
} = {}) {
  const gladys = createFakeGladys({ config, devices, houses });
  const store = new Store(dataDir);
  const app = registerHandlers(gladys, { store, fetch: server.fetch, timers, now: clock.now });
  if (connect) {
    await gladys.connect();
    await app.ready;
    await app.monitor.running;
  }
  return { gladys, fake: gladys.fake, app, monitor: app.monitor, server, clock, store, dataDir };
}

/** Create every discovered device in Gladys, as the user would. */
export async function createAll(world) {
  for (const device of world.fake.discoveredDevices) {
    await world.fake.deviceCreated(device);
  }
  return world.fake.discoveredDevices;
}

/** External id of one feature of a device. */
export const featureId = (device, key) =>
  device.features.find((feature) => feature.external_id.endsWith(`:${key}`))?.external_id;

/** Run one refresh cycle, `minutes` later. */
export async function cycle(world, minutes = 10) {
  world.clock.advance(minutes * 60 * 1000);
  await world.monitor.runCycle();
}

/** Keys of the followed events of a slot, nearest first. */
export const followedKeys = (world, slot = 1) =>
  world.monitor.feeds.get(slot).events.map((event) => event.key);

/** The last state published for a feature. */
export function lastState(world, externalId) {
  const states = world.fake.states.filter((s) => s.device_feature_external_id === externalId);
  return states[states.length - 1];
}

/**
 * Capture the integration's log lines at `level` and above (LOG_LEVEL is read
 * at every call). Returns the lines as `{ level, text }`.
 */
export function captureLogs(t, level = 'info') {
  const previous = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = level;
  const lines = [];
  const record = (...args) => {
    const text = args.map((arg) => (arg instanceof Error ? arg.message : String(arg))).join(' ');
    const match = /^\[[^\]]+\] \[(\w+)\]/.exec(text);
    lines.push({ level: match ? match[1].toLowerCase() : 'raw', text });
  };
  t.mock.method(console, 'log', record);
  t.mock.method(console, 'error', record);
  t.after(() => {
    process.env.LOG_LEVEL = previous;
  });
  return lines;
}
