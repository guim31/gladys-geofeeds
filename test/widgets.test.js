// -----------------------------------------------------------------------------
// The `events` widget: valid for the core (content budget, field limits), one
// status row per feed, the nearest events, the settings.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { WIDGET_KEY } from '../src/monitor.js';
import { URLS, USGS_CONFIG, createAll, createServer, createWorld } from './helpers/world.js';

const TWO_FEEDS = {
  ...USGS_CONFIG,
  feed_2_url: URLS.gdacs,
  feed_2_name: 'GDACS',
  feed_2_radius: '2500',
};

async function world(t, options = {}) {
  const w = await createWorld({ config: TWO_FEEDS, ...options });
  t.after(() => w.app.stop());
  return w;
}

async function content(w, options = {}) {
  const { data } = await w.fake.widgetGet(WIDGET_KEY, options);
  return data.content;
}

for (const language of ['en', 'fr', 'de', 'es']) {
  test(`the widget is valid for the core (${language})`, async (t) => {
    const w = await world(t);
    const widget = await content(w, { language });
    assert.doesNotThrow(() => validateWidgetContent(widget));
    assert.deepEqual(
      widget.components.map((c) => c.type),
      ['text', 'status', 'card-list', 'text'],
    );
  });
}

test('one status row per feed, then the nearest events of every feed', async (t) => {
  const w = await world(t);
  const widget = await content(w, { language: 'fr' });
  const [heading, status, list] = widget.components;
  assert.equal(heading.text, '3 événements proches');
  assert.deepEqual(
    status.items.map((item) => [item.label, item.value]),
    [
      ['USGS', 3],
      ['GDACS', 0],
    ],
  );
  assert.equal(list.items[0].title, 'M 2.7 - 66 km WNW of Happy Valley, Alaska');
  assert.equal(list.items[0].subtitle, 'USGS · 203 km');
  assert.equal(list.items[0].badge.text, 'earthquake');
  assert.equal(list.items[0].links[0].url.startsWith('https://'), true);
});

test('the settings keep the chosen feeds only', async (t) => {
  const w = await world(t);
  const [, gdacs] = await createAll(w);
  const widget = await content(w, { language: 'en', settings: { feeds: [gdacs.external_id] } });
  assert.deepEqual(
    widget.components.map((c) => c.type),
    ['text', 'status', 'text'],
  );
  assert.equal(widget.components[0].text, 'No event in the area');
});

test('a feed that cannot be read says why', async (t) => {
  const server = createServer();
  server.down[URLS.gdacs] = 500;
  const w = await world(t, { server });
  const widget = await content(w, { language: 'en' });
  assert.deepEqual(widget.components[1].items[1], {
    label: 'GDACS',
    value: 'HTTP error 500',
    icon: 'wifi-off',
    color: 'danger',
  });
});

test('no feed: a single heading', async (t) => {
  const w = await world(t, { config: {} });
  const widget = await content(w, { language: 'es' });
  assert.deepEqual(widget.components, [
    { type: 'text', variant: 'heading', text: 'Ningún feed configurado' },
  ]);
});
