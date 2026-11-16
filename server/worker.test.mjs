import test from 'node:test';
import assert from 'node:assert/strict';
import app, { byteRange, syncPublication } from './worker.mjs';

const articleId = '00000000-0000-4000-8000-000000000001';
const mediaId = '00000000-0000-4000-8000-000000000002';
const origin = 'https://example.test';

test('cross-site writes and requests without an origin fail before accessing services', async () => {
  for (const headers of [{}, { origin: 'https://other.test' }]) {
    const response = await app.request(`${origin}/api/articles`, { method: 'POST', headers }, {});
    assert.equal(response.status, 403);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }
});

test('writing desk resolves the canonical asset directory without an index redirect', async () => {
  let requested;
  const response = await app.request(`${origin}/write/`, {}, { ASSETS: { fetch(request) { requested = new URL(request.url).pathname; return new Response('Writing desk'); } } });
  assert.equal(requested, '/write/');
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.equal(response.headers.get('x-robots-tag'), 'noindex, nofollow');
});

test('video byte ranges support seeking, suffixes, open ends and bounded end offsets', () => {
  assert.deepEqual(byteRange('bytes=20-39', 100), { offset: 20, length: 20 });
  assert.deepEqual(byteRange('bytes=80-', 100), { offset: 80, length: 20 });
  assert.deepEqual(byteRange('bytes=-30', 100), { offset: 70, length: 30 });
  assert.deepEqual(byteRange('bytes=90-999', 100), { offset: 90, length: 10 });
  assert.equal(byteRange(null, 100), null);
  for (const range of ['bytes=100-', 'bytes=3-2', 'bytes=-0', 'bytes=-', 'bytes=0-1,5-6', 'bytes=NaN-']) {
    assert.throws(() => byteRange(range, 100), error => error.status === 416);
  }
});

function mediaEnvironment(live = true) {
  const bytes = new Uint8Array(100).map((_, index) => index);
  const metadata = { size: bytes.length, httpEtag: '"test-etag"', httpMetadata: { contentType: 'video/mp4' }, writeHttpMetadata(headers) { headers.set('Content-Type', 'video/mp4'); } };
  return { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'test-key', MEDIA: {
    async head() { return metadata; },
    async get(key, options = {}) {
      if (key.startsWith('published/')) return { json: async () => ({ live, mediaIds: [mediaId] }) };
      const range = options.range;
      return { ...metadata, range, body: range ? bytes.slice(range.offset, range.offset + range.length) : bytes };
    }
  } };
}

test('public video delivery returns correct partial content and rejects invalid ranges', async () => {
  const url = `${origin}/media/${articleId}/${mediaId}`;
  const partial = await app.request(url, { headers: { range: 'bytes=20-39' } }, mediaEnvironment());
  assert.equal(partial.status, 206);
  assert.equal(partial.headers.get('content-range'), 'bytes 20-39/100');
  assert.equal(partial.headers.get('content-length'), '20');
  assert.deepEqual(new Uint8Array(await partial.arrayBuffer()), new Uint8Array(20).map((_, index) => index + 20));
  const invalid = await app.request(url, { headers: { range: 'bytes=100-' } }, mediaEnvironment());
  assert.equal(invalid.status, 416);
  assert.equal(invalid.headers.get('content-range'), 'bytes */100');
  const changed = await app.request(url, { headers: { range: 'bytes=20-', 'if-range': '"old-etag"' } }, mediaEnvironment());
  assert.equal(changed.status, 200);
  const head = await app.request(url, { method: 'HEAD', headers: { range: 'bytes=20-' } }, mediaEnvironment());
  assert.equal(head.status, 200);
  assert.equal(head.headers.get('content-length'), '100');
  assert.equal((await head.arrayBuffer()).byteLength, 0);
});

test('an unpublished attachment is unavailable to an anonymous reader', async () => {
  const response = await app.request(`${origin}/media/${articleId}/${mediaId}`, {}, mediaEnvironment(false));
  assert.equal(response.status, 401);
  assert.doesNotMatch(await response.text(), /test-etag/);
});

function publicationHarness() {
  let stored;
  let syncedVersion = 0;
  let failUpdate = false;
  const env = { MEDIA: {
    async head() { return stored && { etag: String(stored.version), customMetadata: { version: String(stored.version) } }; },
    async put(key, content, options) {
      if (stored && options.onlyIf.etagMatches !== String(stored.version)) return null;
      stored = JSON.parse(content);
      return { etag: String(stored.version) };
    }
  } };
  const admin = { from() { return { update({ synced_version }) {
    const chain = { eq() { return chain; }, gte() { return chain; }, async lt() {
      if (failUpdate) return { error: { code: 'unavailable', message: 'Synthetic outage' } };
      syncedVersion = Math.max(syncedVersion, synced_version); return { data: null };
    } }; return chain;
  } }; } };
  return { env, admin, get stored() { return stored; }, get syncedVersion() { return syncedVersion; }, fail(value) { failUpdate = value; } };
}

test('publication retry repairs the database after R2 succeeded but acknowledgement failed', async () => {
  const harness = publicationHarness();
  const article = { id: articleId, publication_version: 1, publication: { title: 'Test essay', byline: 'Carl Friedrich Gauss' }, published_at: '2026-01-01T00:00:00Z' };
  harness.fail(true);
  await assert.rejects(syncPublication(harness.env, article, harness.admin));
  assert.equal(harness.stored.version, 1);
  assert.equal(harness.syncedVersion, 0);
  harness.fail(false);
  await syncPublication(harness.env, article, harness.admin);
  assert.equal(harness.syncedVersion, 1);
  await syncPublication(harness.env, { ...article, publication_version: 2, publication: null, published_at: null }, harness.admin);
  assert.equal(harness.stored.live, false);
  await syncPublication(harness.env, article, harness.admin);
  assert.equal(harness.stored.version, 2);
  assert.equal(harness.stored.live, false);
});
