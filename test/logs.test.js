// -----------------------------------------------------------------------------
// What the integration writes to `docker logs`: at info, only the lifecycle
// (the start, a feed lost and back, a user action), never one line per
// reading nor per event; a failure that repeats at every reading is logged
// once, plus one line when it is over. Never the coordinates of the centre
// nor the feed addresses (a query string may hold a token): hosts only.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  HOUSE,
  NEAR,
  URLS,
  USGS_CONFIG,
  captureLogs,
  createAll,
  createServer,
  createWorld,
  cycle,
} from './helpers/world.js';

const strip = (line) => line.text.replace(/^\[[^\]]+\] /, '');

async function world(t, options = {}) {
  const w = await createWorld(options);
  t.after(() => w.app.stop());
  return w;
}

test('the start is one info line', async (t) => {
  const lines = captureLogs(t, 'info');
  await world(t);
  assert.deepEqual(lines.map(strip), ['[INFO] [geofeeds] Started: 1 feed(s) read every 10 min']);
});

test('normal readings write nothing at info, new events included', async (t) => {
  const server = createServer();
  const w = await world(t, { server });
  await createAll(w);
  const lines = captureLogs(t, 'info');
  server.addQuake(NEAR, { id: 'quiet', latitude: 61.3, longitude: -149.5 });
  for (let i = 0; i < 4; i += 1) {
    await cycle(w);
  }
  assert.equal(w.fake.sceneEvents.length, 1);
  assert.deepEqual(lines, []);
});

test('LOG_LEVEL=debug shows the readings, never the centre nor the address', async (t) => {
  const lines = captureLogs(t, 'debug');
  const server = createServer();
  const secret = `${URLS.usgs}?token=s3cret`;
  server.bodies[secret] = server.bodies[URLS.usgs];
  const w = await world(t, { server, config: { ...USGS_CONFIG, feed_1_url: secret } });
  await cycle(w);
  const configured = await world(t, {
    config: { ...USGS_CONFIG, latitude: '43.6045', longitude: '1.444' },
  });
  await cycle(configured);
  assert.ok(
    lines.some((line) =>
      /Feed 1 \(earthquake\.usgs\.gov, geojson\): 35 located item\(s\), 0 without position, 3 followed/.test(
        line.text,
      ),
    ),
  );
  const all = lines.map((line) => line.text).join('\n');
  for (const value of [HOUSE.latitude, HOUSE.longitude, 43.6045, 1.444, 's3cret', '2.5_day']) {
    assert.doesNotMatch(all, new RegExp(String(value).replace('.', '\\.')));
  }
});

test('a feed down at every reading: one warning, then one line at recovery', async (t) => {
  const server = createServer();
  const w = await world(t, { server });
  const lines = captureLogs(t, 'info');
  server.down[URLS.usgs] = 503;
  for (let i = 0; i < 4; i += 1) {
    await cycle(w);
  }
  assert.deepEqual(lines.map(strip), [
    '[WARN] [geofeeds] Feed 1 (earthquake.usgs.gov) cannot be read: earthquake.usgs.gov: HTTP 503',
  ]);
  server.down[URLS.usgs] = false;
  await cycle(w);
  assert.deepEqual(lines.slice(1).map(strip), [
    '[INFO] [geofeeds] Feed 1 (earthquake.usgs.gov) can be read again',
  ]);
});

test('states refused at every reading: one warning, then one line at recovery', async (t) => {
  const w = await world(t);
  await createAll(w);
  const lines = captureLogs(t, 'info');
  const publish = t.mock.method(w.gladys, 'publishChangedStates', async () => {
    throw new Error('Gladys unreachable');
  });
  for (let i = 0; i < 3; i += 1) {
    await cycle(w);
  }
  assert.ok(publish.mock.callCount() >= 3);
  assert.deepEqual(lines.map(strip), [
    '[WARN] [geofeeds] Publishing the states failed: Gladys unreachable',
  ]);
  publish.mock.restore();
  await cycle(w);
  assert.match(lines.at(-1).text, /\[INFO\].*Publishing the states works again/);
});

test('a configuration problem is said once, at the start or the save', async (t) => {
  const lines = captureLogs(t, 'info');
  const w = await world(t, {
    config: { ...USGS_CONFIG, latitude: 'abc', longitude: '2', feed_2_url: 'ftp://x' },
  });
  for (let i = 0; i < 3; i += 1) {
    await cycle(w);
  }
  assert.deepEqual(lines.map(strip), [
    '[WARN] [geofeeds] The coordinates of the configuration are not valid: the house is used',
    '[WARN] [geofeeds] Feed 2: not valid, ignored: url',
    '[INFO] [geofeeds] Started: 1 feed(s) read every 10 min',
  ]);
});
