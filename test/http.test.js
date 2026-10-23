// -----------------------------------------------------------------------------
// Reading a feed over HTTP: the size cap (declared or streamed), the errors
// and their kinds, the headers sent, the address after redirects.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FeedError, USER_AGENT, decode, fetchFeed } from '../src/http.js';

const URL_ = 'https://feeds.example.org/events.geojson?token=s3cret';

test('a feed is read as text, with our User-Agent', async () => {
  let seen;
  const result = await fetchFeed(async (url, init) => {
    seen = init;
    return new Response('{"type":"FeatureCollection","features":[]}');
  }, URL_);
  assert.equal(result.body, '{"type":"FeatureCollection","features":[]}');
  assert.equal(result.url, URL_);
  assert.equal(seen.headers['User-Agent'], USER_AGENT);
  assert.equal(seen.redirect, 'follow');
});

test('a body larger than the cap is refused, declared or streamed', async () => {
  const big = 'x'.repeat(2048);
  await assert.rejects(
    fetchFeed(async () => new Response(big, { headers: { 'content-length': '2048' } }), URL_, {
      maxBytes: 1024,
    }),
    (err) => err instanceof FeedError && err.kind === 'too_large',
  );
  const stream = new ReadableStream({
    pull(controller) {
      controller.enqueue(new TextEncoder().encode(big));
    },
  });
  await assert.rejects(
    fetchFeed(async () => new Response(stream), URL_, { maxBytes: 100000 }),
    (err) => err.kind === 'too_large',
  );
});

test('errors carry their kind and name the host only, never the query', async () => {
  const cases = [
    [async () => new Response('no', { status: 503 }), 'http'],
    [
      async () => {
        throw new TypeError('fetch failed', { cause: { code: 'ENOTFOUND' } });
      },
      'network',
    ],
    [
      async () => {
        const err = new Error('aborted');
        err.name = 'TimeoutError';
        throw err;
      },
      'timeout',
    ],
  ];
  for (const [fetchImpl, kind] of cases) {
    await assert.rejects(fetchFeed(fetchImpl, URL_), (err) => {
      assert.equal(err.kind, kind);
      assert.match(err.message, /^feeds\.example\.org: /);
      assert.doesNotMatch(err.message, /s3cret/);
      return true;
    });
  }
});

test('the address after the redirects is returned', async () => {
  const response = new Response('{}');
  Object.defineProperty(response, 'url', { value: 'https://feeds.example.org/moved.geojson' });
  const result = await fetchFeed(async () => response, 'http://feeds.example.org/events.geojson');
  assert.equal(result.url, 'https://feeds.example.org/moved.geojson');
});

test('a network error never copies the address into the message', async () => {
  await assert.rejects(
    fetchFeed(async () => {
      throw new TypeError(`Request cannot be constructed from a URL: ${URL_}`);
    }, URL_),
    (err) => err.kind === 'network' && !err.message.includes('s3cret'),
  );
});

test('the charset of the answer, or of the XML prolog, is respected', () => {
  const latin1 = Buffer.from(
    '<?xml version="1.0" encoding="ISO-8859-1"?><rss>Séisme</rss>',
    'latin1',
  );
  assert.match(decode(latin1), /Séisme/);
  assert.match(decode(Buffer.from('Séisme', 'latin1'), 'text/xml; charset=iso-8859-1'), /Séisme/);
  assert.equal(decode(Buffer.from('Séisme')), 'Séisme');
});
