// -----------------------------------------------------------------------------
// The monitor against recorded feeds: followed area and filters, scene
// triggers (new, removed, never at the first reading nor after a restart),
// states, transport badges, failures, and the container's own timer.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NO_EVENT_KM, deviceIds } from '../src/device.js';
import { TRIGGERS } from '../src/monitor.js';
import {
  HOUSE,
  NEAR,
  SAND_POINT,
  SAND_POINT_2,
  START,
  URLS,
  USGS_CONFIG,
  createAll,
  createServer,
  createWorld,
  cycle,
  featureId,
  followedKeys,
  lastState,
} from './helpers/world.js';

async function world(t, options = {}) {
  const w = await createWorld(options);
  t.after(() => w.app.stop());
  return w;
}

test('the events within the radius of the house are followed, nearest first', async (t) => {
  const w = await world(t);
  assert.deepEqual(followedKeys(w).slice(0, 3), [NEAR, SAND_POINT, SAND_POINT_2]);
  assert.ok(
    followedKeys(w).every(
      (key) => w.monitor.feeds.get(1).events.find((e) => e.key === key).distanceKm <= 1000,
    ),
  );
});

test('the first reading is a starting point: no scene event', async (t) => {
  const w = await world(t);
  assert.ok(followedKeys(w).length > 0);
  assert.deepEqual(w.fake.sceneEvents, []);
});

test('a new event in the area fires new_event with its data', async (t) => {
  const server = createServer();
  const w = await world(t, { server });
  server.addQuake(NEAR, { id: 'test1', latitude: 61.3, longitude: -149.5, mag: 5.1 });
  await cycle(w);
  assert.equal(w.fake.sceneEvents.length, 1);
  const [{ key, data }] = w.fake.sceneEvents;
  assert.equal(key, TRIGGERS.NEW);
  assert.equal(data.feed, deviceIds(w.gladys, 1).device);
  assert.equal(data.feed_name, 'USGS');
  assert.equal(data.title, 'M 5.1 - test test1');
  assert.equal(data.category, 'earthquake');
  assert.ok(data.distance_km > 15 && data.distance_km < 30, String(data.distance_km));
  assert.equal(data.value, null, 'no property chosen');
  assert.match(data.time, /^2026-10-23T/);
  assert.match(data.url, /^https:\/\/earthquake\.usgs\.gov\//);
  assert.equal(JSON.parse(data.properties).mag, 5.1);
  // Nothing more at the next reading.
  await cycle(w);
  assert.equal(w.fake.sceneEvents.length, 1);
});

test('an event gone from the feed fires event_removed, once', async (t) => {
  const server = createServer();
  const w = await world(t, { server });
  server.removeQuake(NEAR);
  await cycle(w);
  await cycle(w);
  assert.deepEqual(
    w.fake.sceneEvents.map((e) => [e.key, e.data.title]),
    [[TRIGGERS.REMOVED, 'M 2.7 - 66 km WNW of Happy Valley, Alaska']],
  );
});

test('a failed reading changes nothing and fires nothing', async (t) => {
  const server = createServer();
  const w = await world(t, { server });
  const before = followedKeys(w);
  server.down[URLS.usgs] = 503;
  await cycle(w);
  assert.deepEqual(followedKeys(w), before);
  server.down[URLS.usgs] = false;
  await cycle(w);
  assert.deepEqual(w.fake.sceneEvents, []);
});

test('the numeric property: sent as value, and filtered by the minimum', async (t) => {
  const w = await world(t, {
    config: { ...USGS_CONFIG, feed_1_property: 'mag', feed_1_min_value: '4' },
  });
  // Sand Point M4.2 stays, M2.7 and M3.2 go.
  assert.deepEqual(followedKeys(w), [SAND_POINT]);
  const server = w.server;
  server.addQuake(NEAR, { id: 'small', latitude: 61.3, longitude: -149.5, mag: 3.9 });
  server.addQuake(NEAR, { id: 'big', latitude: 61.3, longitude: -149.6, mag: 4.5 });
  await cycle(w);
  assert.deepEqual(
    w.fake.sceneEvents.map((e) => [e.data.title, e.data.value]),
    [['M 4.5 - test big', 4.5]],
  );
});

test('categories: only the events whose category contains a word', async (t) => {
  const w = await world(t, {
    config: { feed_1_url: URLS.nsw, feed_1_radius: '0', feed_1_categories: 'planned' },
  });
  assert.equal(followedKeys(w).length, 2);
  for (const event of w.monitor.feeds.get(1).events) {
    assert.deepEqual(event.categories, ['Planned Burn']);
  }
});

test('maximum age: older events are ignored, undated ones kept', async (t) => {
  const w = await world(t, {
    config: { ...USGS_CONFIG, feed_1_radius: '0', max_age: '1' },
  });
  // Generated at 18:03:54 UTC, read at 18:04: one hour back is 17:04.
  const events = w.monitor.feeds.get(1).events;
  assert.ok(events.length > 0 && events.length < 35, String(events.length));
  assert.ok(events.every((e) => START - e.time <= 3600 * 1000));
  const nsw = await world(t, {
    config: { feed_1_url: URLS.nsw, feed_1_radius: '0', max_age: '1' },
  });
  assert.equal(nsw.monitor.feeds.get(1).events.length, 11, 'NSW dates are not read: kept');
});

test('radius 0 follows the whole feed, even without a centre', async (t) => {
  const w = await world(t, { config: { ...USGS_CONFIG, feed_1_radius: '0' }, houses: [] });
  assert.equal(followedKeys(w).length, 35);
  assert.ok(w.monitor.feeds.get(1).events.every((e) => e.distanceKm === null));
  assert.equal(w.fake.connectionStatus.connected, true);
});

test('a radius without any centre follows nothing, and says why', async (t) => {
  const w = await world(t, { houses: [] });
  assert.deepEqual(followedKeys(w), []);
  assert.match(w.fake.connectionStatus.message.fr, /Aucun centre/);
});

test('configured coordinates take the place of the house', async (t) => {
  const w = await world(t, {
    config: { ...USGS_CONFIG, feed_1_radius: '100', latitude: '38,5', longitude: '14,6' },
  });
  // The two earthquakes near Leni and the one near Malfa (Aeolian Islands).
  assert.deepEqual(followedKeys(w).sort(), ['us6000u4bg', 'us6000u4bk', 'us6000u4dc']);
});

test('every format is read: GeoJSON, Atom, RSS with W3C geo, GeoJSON with polygons', async (t) => {
  const w = await world(t, {
    config: {
      feed_1_url: URLS.usgs,
      feed_1_radius: '0',
      feed_2_url: URLS.atom,
      feed_2_radius: '0',
      feed_3_url: URLS.gdacs,
      feed_3_radius: '0',
      feed_4_url: URLS.nsw,
      feed_4_radius: '0',
    },
  });
  assert.deepEqual(
    [1, 2, 3, 4].map((slot) => w.monitor.feeds.get(slot).events.length),
    [35, 35, 8, 11],
  );
  assert.equal(w.fake.discoveredDevices.length, 4);
});

test('states: count, nearest distance and title, latest event', async (t) => {
  const w = await world(t);
  const [device] = await createAll(w);
  assert.equal(lastState(w, featureId(device, 'event_count')).state, followedKeys(w).length);
  const distance = lastState(w, featureId(device, 'nearest_distance')).state;
  assert.ok(distance > 190 && distance < 215, String(distance));
  assert.equal(
    lastState(w, featureId(device, 'nearest_event')).text,
    'M 2.7 - 66 km WNW of Happy Valley, Alaska',
  );
  assert.match(lastState(w, featureId(device, 'latest_event')).text, / km$/);
  // The widget is asked to refresh at the creation.
  assert.ok(w.fake.widgetRefreshes.length > 0);
});

test('no event: the distance is the farthest possible, the texts say so', async (t) => {
  const w = await world(t, { config: { ...USGS_CONFIG, feed_1_radius: '5' } });
  const [device] = await createAll(w);
  assert.equal(lastState(w, featureId(device, 'event_count')).state, 0);
  assert.equal(lastState(w, featureId(device, 'nearest_distance')).state, NO_EVENT_KM);
  assert.equal(
    lastState(w, featureId(device, 'nearest_event')).text,
    'Aucun événement dans la zone',
  );
});

test('the states are published again, all of them, when the device is created', async (t) => {
  const w = await world(t);
  const [device] = await createAll(w);
  const count = w.fake.states.length;
  await cycle(w);
  assert.equal(w.fake.states.length, count, 'nothing changed, nothing published');
  await w.fake.deviceCreated(device);
  assert.equal(w.fake.states.length, count + 4);
});

test('transport badge: cloud when read, unreachable with the reason when not', async (t) => {
  const server = createServer();
  const w = await world(t, { server });
  await createAll(w);
  assert.equal(w.fake.transports.at(-1).transport, 'cloud');
  server.down[URLS.usgs] = 'network';
  await cycle(w);
  const badge = w.fake.transports.at(-1);
  assert.equal(badge.transport, 'unreachable');
  assert.equal(w.fake.connectionStatus.connected, false);
  assert.match(w.fake.connectionStatus.message.en, /USGS: unreachable/);
});

test('a page that is not a feed is a format error, said in the status', async (t) => {
  const server = createServer();
  server.bodies['https://example.org/page'] = '<!doctype html><html><body>Hello</body></html>';
  const w = await world(t, { server, config: { feed_1_url: 'https://example.org/page' } });
  assert.equal(w.monitor.feeds.get(1).error.kind, 'format');
  assert.match(w.fake.connectionStatus.message.en, /not a GeoJSON, RSS or Atom feed/);
});

test('a restart fires nothing for the events already followed', async (t) => {
  const server = createServer();
  const first = await createWorld({ server });
  await first.app.stop();
  server.addQuake(NEAR, { id: 'while-down', latitude: 61.3, longitude: -149.5 });
  const second = await world(t, { server, dataDir: first.dataDir });
  assert.deepEqual(
    second.fake.sceneEvents.map((e) => e.data.title),
    ['M 2.7 - test while-down'],
    'what came while the container was stopped is news; nothing else',
  );
});

test('a new address in a slot starts again from zero, without triggers', async (t) => {
  const w = await world(t);
  await w.fake.configUpdated({ ...USGS_CONFIG, feed_1_url: URLS.atom });
  await w.monitor.running;
  assert.equal(w.monitor.feeds.get(1).feed.url, URLS.atom);
  assert.deepEqual(w.fake.sceneEvents, []);
  assert.deepEqual(followedKeys(w).slice(0, 1), ['urn:earthquake-usgs-gov:ak:a2026uzkyen']);
});

test('a wider radius after a configuration change fires nothing', async (t) => {
  const w = await world(t);
  assert.equal(followedKeys(w).length, 3);
  await w.fake.configUpdated({ ...USGS_CONFIG, feed_1_radius: '2500' });
  await w.monitor.running;
  assert.equal(followedKeys(w).length, 6);
  assert.deepEqual(w.fake.sceneEvents, []);
});

test('the container reads on its own timer, without onPoll', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const server = createServer();
  const w = await world(t, { server, timers: true });
  const before = server.requests.length;
  t.mock.timers.tick(10 * 60 * 1000);
  await w.monitor.running;
  assert.equal(server.requests.length, before + 1);
});

test('the Gladys houses are used when no coordinates are typed', async (t) => {
  const w = await world(t, { houses: [{ ...HOUSE, latitude: null, longitude: null }, HOUSE] });
  assert.equal(followedKeys(w)[0], NEAR);
});

test('a burst of new events is capped per reading', async (t) => {
  const server = createServer();
  const w = await world(t, { server, config: { ...USGS_CONFIG, feed_1_radius: '0' } });
  for (let i = 0; i < 30; i += 1) {
    server.addQuake(NEAR, { id: `burst${i}` });
  }
  await cycle(w);
  assert.equal(w.fake.sceneEvents.length, 20);
});

test('houses unreadable for a while: the followed events are kept, nothing fires', async (t) => {
  const w = await world(t);
  const before = followedKeys(w);
  await w.app.stop();
  // A new start on the same /data, while Gladys does not answer the houses.
  const failing = await createWorld({ server: w.server, dataDir: w.dataDir, connect: false });
  t.after(() => failing.app.stop());
  t.mock.method(failing.gladys, 'getHouses', async () => {
    throw new Error('Gladys restarting');
  });
  await failing.gladys.connect();
  await failing.app.ready;
  await failing.monitor.running;
  assert.deepEqual(failing.fake.sceneEvents, []);
  t.mock.restoreAll();
  failing.monitor.houseReadAt = -Infinity;
  await cycle(failing);
  assert.deepEqual(followedKeys(failing), before);
  assert.deepEqual(failing.fake.sceneEvents, []);
});

test('an event back among the first 500 is not news', async (t) => {
  const server = createServer();
  const document = server.usgs();
  const base = document.features.find((f) => f.id === NEAR);
  // 600 events; the 100 nearest go away: the far ones come back into the first 500.
  document.features = Array.from({ length: 600 }, (_, i) => {
    const feature = structuredClone(base);
    feature.id = `many${i}`;
    feature.geometry.coordinates = [-149.9, 61.2 + i * 0.01, 10];
    return feature;
  });
  server.setUsgs(document);
  const w = await world(t, { server, config: { ...USGS_CONFIG, feed_1_radius: '0' } });
  const later = server.usgs();
  later.features = later.features.slice(100);
  server.setUsgs(later);
  await cycle(w);
  assert.equal(
    w.fake.sceneEvents.filter((e) => e.key === TRIGGERS.NEW).length,
    0,
    'no new_event for events already followed',
  );
});
