import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import sharp from 'sharp';
import { syncPublished } from './publishing.mjs';

const SOURCE = 'https://sample-journal.blogspot.com/feeds/posts/default';
const IMAGE = 'https://blogger.googleusercontent.com/sample/image.jpg';
const xml = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
function entry({ id = 'sample-entry-one', title = 'A careful argument', html = '<p>A public essay.</p>', author = 'Guest Writer', published = '2026-01-05T10:00:00Z', updated = '2026-01-06T10:00:00Z', draft = false, extra = '' } = {}) {
  return `<entry><id>${xml(id)}</id><title type="text">${xml(title)}</title>${published ? `<published>${xml(published)}</published>` : ''}${updated ? `<updated>${xml(updated)}</updated>` : ''}<author><name>${xml(author)}</name><uri>https://www.blogger.com/profile/source-profile-marker</uri><email>profile@example.invalid</email></author><content type="html">${xml(html)}</content>${draft ? '<app:control><app:draft>yes</app:draft></app:control>' : ''}${extra}</entry>`;
}
function feed(entries = '', next = '') {
  return `<?xml version="1.0" encoding="UTF-8"?><feed xmlns="http://www.w3.org/2005/Atom" xmlns:app="http://www.w3.org/2007/app"><id>source-feed-marker</id><title>Sample journal</title>${entries}${next ? `<link rel="next" href="${xml(next)}"/>` : ''}</feed>`;
}
const atomResponse = body => new Response(body, { headers: { 'Content-Type': 'application/atom+xml; charset=UTF-8' } });
function fixture(routes) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push(url);
    assert.equal(options.redirect, 'manual');
    assert.equal(options.credentials, 'omit');
    assert.equal(options.referrerPolicy, 'no-referrer');
    assert(options.signal instanceof AbortSignal);
    if (!(url in routes)) throw new Error('Unexpected fixture request');
    return typeof routes[url] === 'function' ? routes[url]() : atomResponse(routes[url]);
  };
  return { fetchImpl, calls };
}
async function temporary(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'publishing-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}
async function run(t, body, options = {}) {
  const outputDir = await temporary(t);
  const requests = fixture({ [SOURCE]: body, ...options.routes });
  const articles = await syncPublished({ feedUrl: SOURCE, outputDir, fetchImpl: requests.fetchImpl, ...options.arguments });
  return { articles, outputDir, ...requests };
}

test('imports only dated public entries and emits an explicit public record', async t => {
  const { articles, outputDir } = await run(t, feed([
    entry({ html: '<h1>Opening</h1><p>A <strong>clear</strong> argument &amp; its evidence.</p>', extra: '<category scheme="http://www.blogger.com/atom/ns#" term="Mathematics"/><georss:point xmlns:georss="http://www.georss.org/georss">1 2</georss:point>' }),
    entry({ id: 'draft-entry', draft: true, html: '<p>Unpublished marker.</p>' }),
    entry({ id: 'scheduled-entry', published: '2999-01-01T00:00:00Z' }),
    entry({ id: 'undated-entry', published: '' }),
    entry({ id: 'unversioned-entry', updated: '' }),
  ].join('')));
  assert.equal(articles.length, 1);
  assert.deepEqual(Object.keys(articles[0]), ['slug', 'title', 'author', 'published', 'updated', 'summary', 'html', 'tags']);
  assert.match(articles[0].slug, /^essay-[a-f0-9]{24}$/u);
  assert.equal(articles[0].author, 'Guest Writer');
  assert.match(articles[0].html, /<h2>Opening<\/h2>/u);
  assert.match(articles[0].summary, /argument & its evidence/u);
  assert.deepEqual(articles[0].tags, ['Mathematics']);
  const stored = await readFile(path.join(outputDir, 'articles.json'), 'utf8');
  assert.doesNotMatch(stored, /profile-marker|profile@example|source-feed-marker|sample-entry-one|georss|Unpublished marker/u);
  assert.deepEqual(JSON.parse(stored), articles);
});

test('stable entry identity survives a title change', async t => {
  const first = await run(t, feed(entry({ title: 'First title' })));
  const second = await run(t, feed(entry({ title: 'Revised title' })));
  assert.equal(first.articles[0].slug, second.articles[0].slug);
});

test('keeps supported rich text and removes executable markup and attributes', async t => {
  const { articles } = await run(t, feed(entry({ html: '<p id="untrusted" style="color:red" onclick="alert(1)">Text<script>alert(1)</script><style>body{display:none}</style><svg><script>bad</script></svg><form><input name="secret"></form></p><table><thead><tr><th scope="col">Value</th></tr></thead><tbody><tr><td>1</td></tr></tbody></table><pre><code>f(x)</code></pre><blockquote>Reasoning</blockquote><ul><li>One</li></ul><p><a href="https://example.org/paper#proof">Reference</a></p>' })));
  const html = articles[0].html;
  assert.doesNotMatch(html, /script|style|onclick|<svg|<form|<input|id=|alert|display:none/u);
  assert.match(html, /<table>/u);
  assert.match(html, /<code>f\(x\)<\/code>/u);
  assert.match(html, /href="https:\/\/example.org\/paper#proof" rel="noopener noreferrer"/u);
});

test('ordinary anchors cannot impersonate generated opt-in video controls', async t => {
  const { articles } = await run(t, feed(entry({ html: '<p><a class="article-video" data-video="true" data-src="https://evil.example/" onclick="bad()" href="https://example.org/">Ordinary reference</a><a href="javascript:alert(1)">Unsafe</a><a href="https://user:password@example.org/">Credentials</a><a href="https://www.blogger.com/profile/source-profile-marker">Profile</a></p><iframe src="https://www.youtube.com/embed/AbCdEfG1234?autoplay=1"></iframe>' })));
  const html = articles[0].html;
  assert.equal((html.match(/class="article-video"/gu) || []).length, 1);
  assert.doesNotMatch(html, /data-|javascript:|password|onclick|source-profile-marker|autoplay/u);
  assert.match(html, /href="https:\/\/www.youtube-nocookie.com\/embed\/AbCdEfG1234" class="article-video"/u);
  assert.doesNotMatch(html, /<iframe/u);
});

test('supports allowlisted Blogger and legacy YouTube object video sources', async t => {
  const { articles } = await run(t, feed(entry({ html: '<iframe class="b-hbp-video b-uploaded" src="https://www.blogger.com/video.g?token=PublicVideoToken123&amp;origin=sample-journal.blogspot.com"></iframe><object data="https://www.youtube.com/v/AbCdEfG1234"></object><object><param name="movie" value="https://www.youtube.com/v/ZyXwVuT9876"></object>' })));
  assert.equal((articles[0].html.match(/class="article-video"/gu) || []).length, 3);
  assert.doesNotMatch(articles[0].html, /<(?:iframe|object|embed|param)\b/u);
  assert.match(articles[0].html, /href="https:\/\/www\.blogger\.com\/video\.g\?token=PublicVideoToken123"/u);
  assert.doesNotMatch(articles[0].html, /origin=/u);
});

test('rejects foreign and credentialed video embeds', async t => {
  for (const source of ['https://evil.example/embed/one', 'https://user:password@www.youtube.com/embed/AbCdEfG1234', 'https://www.blogger.com/video.g?token=PublicVideoToken123&redirect=https://evil.example/', 'https://www.blogger.com/video.g?token=PublicVideoToken123&origin=evil.example', 'https://www.blogger.com/video.g?token=PublicVideoToken123&origin=sample-journal.blogspot.com&origin=sample-journal.blogspot.com']) {
    await assert.rejects(run(t, feed(entry({ html: `<iframe src="${xml(source)}"></iframe>` }))), /could not be synchronized safely/u);
  }
});

test('rejects XML entities and overly deep XML before resolving any resources', async t => {
  const bodies = ['<!DOCTYPE feed [<!ENTITY external SYSTEM "file:///private-fixture">]>' + feed(entry({ title: '&external;' })), feed('<nested>'.repeat(40) + '</nested>'.repeat(40))];
  for (const body of bodies) await assert.rejects(run(t, body), /could not be synchronized safely/u);
});

test('restricts initial feeds, redirect destinations and pagination paths', async t => {
  for (const source of ['http://sample-journal.blogspot.com/feeds/posts/default', 'https://example.org/feeds/posts/default', SOURCE + '?alt=json', 'https://user:password@sample-journal.blogspot.com/feeds/posts/default', SOURCE.replace('/posts/default', '/comments/default')]) {
    let requests = 0;
    await assert.rejects(syncPublished({ feedUrl: source, outputDir: await temporary(t), fetchImpl: async () => { requests++; throw new Error('Should not request'); } }));
    assert.equal(requests, 0);
  }
  const foreignRedirect = fixture({ [SOURCE]: () => new Response(null, { status: 302, headers: { location: 'https://example.org/private' } }) });
  await assert.rejects(syncPublished({ feedUrl: SOURCE, outputDir: await temporary(t), fetchImpl: foreignRedirect.fetchImpl }));
  assert.deepEqual(foreignRedirect.calls, [SOURCE]);
  await assert.rejects(run(t, feed(entry(), 'https://sample-journal.blogspot.com/feeds/comments/default')));
});

test('paginates the configured public feed and fails on loops or duplicate identities', async t => {
  const next = SOURCE + '?start-index=2&max-results=1';
  const { articles, calls } = await run(t, feed(entry(), next), { routes: { [next]: feed(entry({ id: 'sample-entry-two' })) } });
  assert.equal(articles.length, 2);
  assert.deepEqual(calls, [SOURCE, next]);
  await assert.rejects(run(t, feed(entry(), SOURCE)));
  await assert.rejects(run(t, feed(entry() + entry({ title: 'Different content with duplicate identity' }))));
});

test('bounds response bytes and total entry count', async t => {
  await assert.rejects(run(t, 'x'.repeat(8 * 1024 * 1024 + 1)));
  await assert.rejects(run(t, feed(Array.from({ length: 251 }, (_, index) => entry({ id: `sample-${index}` })).join(''))));
  const oversized = fixture({ [SOURCE]: () => new Response('small', { headers: { 'content-type': 'application/atom+xml', 'content-length': '999999999' } }) });
  await assert.rejects(syncPublished({ feedUrl: SOURCE, outputDir: await temporary(t), fetchImpl: oversized.fetchImpl }));
});

test('reencodes allowed raster media, strips metadata and uses content hashes', async t => {
  const image = await sharp({ create: { width: 2000, height: 1000, channels: 3, background: '#99bbaa' } }).jpeg().withExif({ IFD0: { Artist: 'Synthetic metadata marker', Copyright: 'Example only' } }).toBuffer();
  assert((await sharp(image).metadata()).exif);
  const { articles, outputDir } = await run(t, feed(entry({ html: `<p>A figure.</p><img src="${IMAGE}" alt="A public figure" onerror="bad()">` })), { routes: { [IMAGE]: () => new Response(image, { headers: { 'content-type': 'image/jpeg' } }) } });
  const names = await readdir(path.join(outputDir, 'assets'));
  assert.equal(names.length, 1);
  assert.match(names[0], /^[a-f0-9]{64}\.webp$/u);
  const bytes = await readFile(path.join(outputDir, 'assets', names[0]));
  assert.equal(createHash('sha256').update(bytes).digest('hex') + '.webp', names[0]);
  const metadata = await sharp(bytes).metadata();
  assert.equal(metadata.format, 'webp');
  assert.equal(metadata.width, 1600);
  assert.equal(metadata.exif, undefined);
  assert.equal(metadata.xmp, undefined);
  assert.match(articles[0].html, /src="\/assets\/published\/[a-f0-9]{64}\.webp" alt="A public figure" loading="lazy"/u);
  assert.doesNotMatch(articles[0].html, /googleusercontent|onerror|pending-|Synthetic metadata/u);
});

test('allows image redirects only within the approved Google image hosts', async t => {
  const target = 'https://lh3.googleusercontent.com/sample/image.png';
  const bytes = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#ffffff' } }).png().toBuffer();
  const html = `<p>Figure.</p><img src="${IMAGE}" alt="Figure">`;
  const valid = await run(t, feed(entry({ html })), { routes: { [IMAGE]: () => new Response(null, { status: 302, headers: { location: target } }), [target]: () => new Response(bytes, { headers: { 'content-type': 'image/png' } }) } });
  assert.equal(valid.articles.length, 1);
  await assert.rejects(run(t, feed(entry({ html })), { routes: { [IMAGE]: () => new Response(null, { status: 302, headers: { location: 'https://example.org/image.png' } }) } }));
});

test('automatic Blogger image links do not expose the original CDN file', async t => {
  const original = 'https://blogger.googleusercontent.com/sample/s1600/original-file-name.jpg';
  const image = await sharp({ create: { width: 20, height: 10, channels: 3, background: '#669988' } }).jpeg().withExif({ IFD0: { Artist: 'Original metadata marker' } }).toBuffer();
  const html = `<p>A figure.</p><a href="${original}" imageanchor="1"><img src="${IMAGE}" alt="Figure"></a><p><a href="https://1.bp.blogspot.com/sample/original-file-name.jpg">Original image</a></p>`;
  const { articles, calls, outputDir } = await run(t, feed(entry({ html })), { routes: { [IMAGE]: () => new Response(image, { headers: { 'content-type': 'image/jpeg' } }) } });
  assert.deepEqual(calls, [SOURCE, IMAGE]);
  assert.match(articles[0].html, /<a><img src="\/assets\/published\/[a-f0-9]{64}\.webp"/u);
  assert.doesNotMatch(articles[0].html, /googleusercontent|bp\.blogspot|original-file-name|imageanchor|Original metadata marker/u);
  const [filename] = await readdir(path.join(outputDir, 'assets'));
  assert.equal((await sharp(await readFile(path.join(outputDir, 'assets', filename))).metadata()).exif, undefined);
});

test('removes profile links for both Blogger hostname spellings', async t => {
  const { articles } = await run(t, feed(entry({ html: '<p><a href="https://blogger.com/profile/sample-profile-marker">First profile</a><a href="https://www.blogger.com/profile/sample-profile-marker">Second profile</a><a href="https://example.org/author">Approved public reference</a></p>' })));
  assert.doesNotMatch(articles[0].html, /blogger\.com|sample-profile-marker/u);
  assert.match(articles[0].html, /href="https:\/\/example.org\/author"/u);
});

test('rejects foreign, oversized and disguised vector/image payloads', async t => {
  await assert.rejects(run(t, feed(entry({ html: '<p>Figure.</p><img src="https://example.org/image.jpg" alt="Figure">' }))));
  for (const payload of ['<svg xmlns="http://www.w3.org/2000/svg"><script>bad()</script></svg>', '<html>not an image</html>']) {
    await assert.rejects(run(t, feed(entry({ html: `<p>Figure.</p><img src="${IMAGE}" alt="Figure">` })), { routes: { [IMAGE]: () => new Response(payload, { headers: { 'content-type': 'image/jpeg' } }) } }));
  }
  await assert.rejects(run(t, feed(entry({ html: `<p>Figure.</p><img src="${IMAGE}" alt="Figure">` })), { routes: { [IMAGE]: () => new Response('small', { headers: { 'content-type': 'image/jpeg', 'content-length': '999999999' } }) } }));
});

test('privacy guard checks decoded text, bylines and encoded link paths', async t => {
  for (const options of [
    { html: '<p>Sensitive Marker</p>' },
    { html: '<p>&#83;ensitive&#32;Marker</p>' },
    { html: '<p>Text.</p><a href="https://example.org/Sensitive%20Marker">Reference</a>' },
    { author: 'Sensitive Marker' },
  ]) {
    try {
      await run(t, feed(entry(options)), { arguments: { privacyTerms: ['Sensitive Marker'] } });
      assert.fail('Expected a privacy rejection');
    } catch (cause) {
      assert.equal(cause.message, 'The publishing source could not be synchronized safely.');
      assert.doesNotMatch(cause.message, /Sensitive|example\.org/u);
    }
  }
});

const digestMarker = value => {
  const normalized = value.normalize('NFKC').replaceAll(/\p{Cf}/gu, '').toLowerCase();
  return { length: Array.from(normalized).length, sha256: createHash('sha256').update(normalized).digest('hex') };
};

test('hashed privacy markers reject bylines and substrings inside normalized tokens', async t => {
  const marker = digestMarker('Archivist');
  for (const options of [
    { author: 'Guest Archivist' },
    { html: '<p>prefixARCHIVIST123suffix</p>' },
    { html: '<p>prefixArchi\u200bvistSuffix</p>' },
    { html: '<p>Ａｒｃｈｉｖｉｓｔ</p>' },
    { html: '<p>Contact alias archivist123@example.invalid.</p>' },
    { html: '<p>A reference with 100% remaining.</p><a href="https://example.org/pre%41rchivist-post">Reference</a>' },
    { html: '<p>Reference.</p><a href="https://example.org/%2541rchivist">Reference</a>' },
  ]) {
    await assert.rejects(run(t, feed(entry(options)), { arguments: { privacyHashes: [marker] } }), cause => cause.message === 'The publishing source could not be synchronized safely.');
  }
});

test('hashed privacy markers use Unicode codepoint lengths and preserve safe content', async t => {
  const unicodeMarker = digestMarker('𐐀Test');
  assert.equal(unicodeMarker.length, 5);
  await assert.rejects(run(t, feed(entry({ html: '<p>prefix𐐀Testsuffix</p>' })), { arguments: { privacyHashes: [unicodeMarker] } }));
  const safe = await run(t, feed(entry({ html: '<p>An archive is a place to keep public writing.</p>' })), { arguments: { privacyHashes: [digestMarker('Archivist')] } });
  assert.equal(safe.articles.length, 1);
  assert.equal(safe.articles[0].summary, 'An archive is a place to keep public writing.');
});

test('malformed hash configuration fails before requesting the feed', async t => {
  const valid = digestMarker('Archivist');
  for (const privacyHashes of [null, {}, [null], [{ length: 0, sha256: valid.sha256 }], [{ length: 2, sha256: valid.sha256 }], [{ length: 129, sha256: valid.sha256 }], [{ length: 9.5, sha256: valid.sha256 }], [{ length: 9, sha256: 'not-a-digest' }], [{ length: 9, sha256: valid.sha256.toUpperCase() }], [{ ...valid, unexpected: 'Synthetic marker' }], Array.from({ length: 101 }, () => valid)]) {
    let requests = 0;
    await assert.rejects(syncPublished({ feedUrl: SOURCE, outputDir: await temporary(t), privacyHashes, fetchImpl: async () => { requests++; throw new Error('Should not request'); } }));
    assert.equal(requests, 0);
  }
});

test('hash guard bounds oversized tokens before expensive substring work', async t => {
  await assert.rejects(run(t, feed(entry({ html: `<p>${'x'.repeat(8193)}</p>` })), { arguments: { privacyHashes: [digestMarker('Archivist')] } }));
});

test('a failed refresh preserves the previous snapshot and assets', async t => {
  const outputDir = await temporary(t);
  await mkdir(path.join(outputDir, 'assets'));
  await writeFile(path.join(outputDir, 'articles.json'), '[{"previous":true}]\n');
  await writeFile(path.join(outputDir, 'assets', 'previous.webp'), 'Previous bytes');
  const requests = fixture({ [SOURCE]: feed(entry({ html: `<p>New figure.</p><img src="${IMAGE}" alt="Figure">` })), [IMAGE]: () => new Response('unavailable', { status: 503 }) });
  await assert.rejects(syncPublished({ feedUrl: SOURCE, outputDir, fetchImpl: requests.fetchImpl }));
  assert.equal(await readFile(path.join(outputDir, 'articles.json'), 'utf8'), '[{"previous":true}]\n');
  assert.equal(await readFile(path.join(outputDir, 'assets', 'previous.webp'), 'utf8'), 'Previous bytes');
});

test('an empty valid public feed removes the old local publication snapshot', async t => {
  const outputDir = await temporary(t);
  await mkdir(path.join(outputDir, 'assets'));
  await writeFile(path.join(outputDir, 'articles.json'), '[{"previous":true}]\n');
  await writeFile(path.join(outputDir, 'assets', 'previous.webp'), 'Previous bytes');
  const requests = fixture({ [SOURCE]: feed() });
  assert.deepEqual(await syncPublished({ feedUrl: SOURCE, outputDir, fetchImpl: requests.fetchImpl }), []);
  assert.deepEqual(JSON.parse(await readFile(path.join(outputDir, 'articles.json'), 'utf8')), []);
  assert.deepEqual(await readdir(path.join(outputDir, 'assets')), []);
});

test('the CLI reports configuration failure without disclosing input or filesystem details', async t => {
  const directory = await temporary(t);
  await writeFile(path.join(directory, 'publishing.config.json'), '{invalid fixture marker');
  const script = fileURLToPath(new URL('./sync-content.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [script], { cwd: directory, encoding: 'utf8', env: { ...process.env, PUBLISHING_PRIVACY_TERMS: '["Synthetic private marker"]' } });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr.trim(), 'Publishing synchronization failed. The current deployment has not been replaced.');
  assert.doesNotMatch(result.stderr, /fixture marker|Synthetic private marker|publishing-test-|\.mjs|node_modules/u);
});
