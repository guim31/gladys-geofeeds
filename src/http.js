// -----------------------------------------------------------------------------
// Reading one feed over HTTP: a GET with a timeout and a size cap, redirects
// followed (an http address moved to https), the body as text. Nothing of the
// body is ever run: it is only parsed (src/parse.js).
//
// Errors carry a `kind` (network, timeout, http, too_large, format) that the
// connection status and the action messages translate. Messages name the host
// only: a feed address may carry a token in its query string.
// -----------------------------------------------------------------------------

export const USER_AGENT =
  'gladys-geofeeds (Gladys Assistant integration; +https://github.com/guim31/gladys-geofeeds)';

export const MAX_BYTES = 5 * 1024 * 1024;
export const TIMEOUT_MS = 30000;

export class FeedError extends Error {
  /**
   * @param {string} kind network | timeout | http | too_large | format
   * @param {string} message in English, for the logs
   * @param {number|null} [status] HTTP status
   */
  constructor(kind, message, status = null) {
    super(message);
    this.name = 'FeedError';
    this.kind = kind;
    this.status = status;
  }
}

export const hostOf = (url) => {
  try {
    return new URL(url).host;
  } catch {
    return 'feed';
  }
};

async function readCapped(response, maxBytes, host) {
  const declared = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel?.().catch(() => {});
    throw new FeedError('too_large', `${host}: more than ${maxBytes / 1048576} MB`);
  }
  const reader = response.body?.getReader?.();
  if (!reader) {
    // Test doubles (and some fetch implementations) only offer text().
    const text = await response.text();
    if (Buffer.byteLength(text) > maxBytes) {
      throw new FeedError('too_large', `${host}: more than ${maxBytes / 1048576} MB`);
    }
    return text;
  }
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new FeedError('too_large', `${host}: more than ${maxBytes / 1048576} MB`);
    }
    chunks.push(value);
  }
  return new TextDecoder('utf-8').decode(Buffer.concat(chunks));
}

/**
 * GET a feed. Resolves `{ body, url }`, `url` being the address after the
 * redirects; rejects with a FeedError.
 * @param {Function} fetchImpl fetch
 * @param {string} url
 */
export async function fetchFeed(
  fetchImpl,
  url,
  { timeoutMs = TIMEOUT_MS, maxBytes = MAX_BYTES } = {},
) {
  const host = hostOf(url);
  let response;
  const signal = AbortSignal.timeout(timeoutMs);
  try {
    response = await fetchImpl(url, {
      headers: {
        Accept:
          'application/geo+json, application/json, application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.9, */*;q=0.5',
        'User-Agent': USER_AGENT,
      },
      redirect: 'follow',
      signal,
    });
  } catch (err) {
    if (err?.name === 'TimeoutError' || signal.aborted) {
      throw new FeedError('timeout', `${host}: no answer in ${timeoutMs / 1000} s`);
    }
    throw new FeedError('network', `${host}: ${err?.cause?.code ?? err?.message ?? 'unreachable'}`);
  }
  if (response.status < 200 || response.status >= 300) {
    await response.body?.cancel?.().catch(() => {});
    throw new FeedError('http', `${host}: HTTP ${response.status}`, response.status);
  }
  const finalUrl = typeof response.url === 'string' && response.url ? response.url : url;
  if (!/^https?:/i.test(finalUrl)) {
    throw new FeedError('network', `${host}: redirected outside http(s)`);
  }
  try {
    return { body: await readCapped(response, maxBytes, host), url: finalUrl };
  } catch (err) {
    if (err instanceof FeedError) {
      throw err;
    }
    if (err?.name === 'TimeoutError' || signal.aborted) {
      throw new FeedError('timeout', `${host}: no answer in ${timeoutMs / 1000} s`);
    }
    throw new FeedError('network', `${host}: ${err?.message ?? 'read failed'}`);
  }
}
