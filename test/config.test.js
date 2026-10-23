import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, normalizeConfig, parseFeedUrl } from '../src/config.js';

test('the defaults give no feed, a radius of 50 km, 10 minutes, French', () => {
  const config = normalizeConfig(DEFAULT_CONFIG);
  assert.deepEqual(config.feeds, []);
  assert.deepEqual(config.invalid, []);
  assert.equal(config.refreshMinutes, 10);
  assert.equal(config.maxAgeHours, 0);
  assert.equal(config.language, 'fr');
  assert.equal(config.center, null);
  assert.equal(normalizeConfig({ feed_2_url: 'https://a.example/f' }).feeds[0].radiusKm, 50);
});

test('a slot with an address is a feed; its filters are parsed', () => {
  const config = normalizeConfig({
    feed_3_url: ' https://a.example/f.json ',
    feed_3_name: ' Fires ',
    feed_3_radius: '25',
    feed_3_categories: 'Emergency, watch AND act;;',
    feed_3_property: 'mag',
    feed_3_min_value: '4,5',
  });
  assert.deepEqual(config.feeds, [
    {
      slot: 3,
      url: 'https://a.example/f.json',
      typed: true,
      name: 'Fires',
      radiusKm: 25,
      categories: ['emergency', 'watch and act'],
      property: 'mag',
      minValue: 4.5,
      problems: [],
    },
  ]);
});

test('unusable values are reported, and filter nothing', () => {
  const config = normalizeConfig({
    feed_1_url: 'ftp://a.example/f',
    feed_2_url: 'https://a.example/f',
    feed_2_property: 'two words',
    feed_2_min_value: 'four',
    feed_2_radius: '42',
  });
  assert.deepEqual(
    config.invalid.map((feed) => [feed.slot, feed.problems]),
    [
      [1, ['url']],
      [2, ['property', 'min_value']],
    ],
  );
  assert.equal(config.feeds.length, 1);
  assert.equal(config.feeds[0].property, null);
  assert.equal(config.feeds[0].minValue, null);
  assert.equal(config.feeds[0].radiusKm, 50);
});

test('feed addresses: http and https only', () => {
  assert.equal(parseFeedUrl('http://a.example/x'), 'http://a.example/x');
  assert.equal(parseFeedUrl('file:///etc/passwd'), null);
  assert.equal(parseFeedUrl('javascript:alert(1)'), null);
  assert.equal(parseFeedUrl('not a url'), null);
  assert.equal(parseFeedUrl(''), null);
});

test('coordinates: both or none, decimal comma accepted', () => {
  assert.deepEqual(normalizeConfig({ latitude: '43,6', longitude: '1.44' }).center, {
    latitude: 43.6,
    longitude: 1.44,
  });
  const half = normalizeConfig({ latitude: '43.6', longitude: '' });
  assert.equal(half.center, null);
  assert.equal(half.invalidCenter, true);
  assert.equal(normalizeConfig({ latitude: '95', longitude: '1' }).center, null);
});
