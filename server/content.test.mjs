import test from 'node:test';
import assert from 'node:assert/strict';
import { renderDocument, safeLink, articlePath } from './content.mjs';
import { checkFileHeader, stripWebpMetadata } from './media.mjs';

const article = '10000000-0000-4000-8000-000000000001';
const fileId = '20000000-0000-4000-8000-000000000001';
const document = content => ({ type: 'doc', content });
test('article text and captions are escaped, and executable links are rejected', () => {
  const result = renderDocument(document([{ type: 'paragraph', content: [{ type: 'text', text: '<script>alert(1)</script>', marks: [{ type: 'bold' }] }] }]), article, []);
  assert.equal(result.html, '<p><strong>&lt;script&gt;alert(1)&lt;/script&gt;</strong></p>');
  assert.equal(safeLink('javascript:alert(1)'), null);
  assert.equal(safeLink('data:text/html,test'), null);
  assert.throws(() => renderDocument(document([{ type: 'paragraph', content: [{ type: 'text', text: 'test', marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }] }] }]), article, []));
});
test('only completed attachments belonging to the article can be rendered', () => {
  const node = { type: 'media', attrs: { id: fileId, kind: 'image/webp', caption: '<img src=x>', alt: 'Diagram' } };
  assert.throws(() => renderDocument(document([node]), article, []));
  assert.throws(() => renderDocument(document([node]), article, [{ id: fileId, kind: 'image/webp', state: 'uploading', article_id: article }]));
  assert.throws(() => renderDocument(document([node]), article, [{ id: fileId, kind: 'image/webp', state: 'ready', article_id: fileId }]));
  const rendered = renderDocument(document([node]), article, [{ id: fileId, kind: 'image/webp', state: 'ready', article_id: article }]);
  assert.match(rendered.html, /&lt;img src=x&gt;/);
  assert.deepEqual(rendered.mediaIds, [fileId]);
});
test('unsupported nodes and deeply nested documents are rejected', () => {
  assert.throws(() => renderDocument(document([{ type: 'iframe', attrs: { src: 'https://example.com' } }]), article, []));
  let nested = { type: 'paragraph' };
  for (let i = 0; i < 30; i++) nested = { type: 'blockquote', content: [nested] };
  assert.throws(() => renderDocument(document([nested]), article, []));
});

test('attachment identifiers and media types remain restricted even in a stored snapshot', () => {
  for (const [id, kind] of [['../private','video/mp4'], [fileId,'video/mp4" onerror="alert(1)']]) {
    const node = { type: 'media', attrs: { id, kind } };
    assert.throws(() => renderDocument(document([node]), article, [{ id, kind, state:'ready', article_id:article }]), /Unsupported attachment/);
  }
});
test('article addresses are safe and include a stable identifier', () => {
  assert.equal(articlePath({ title: 'A <new> idea!', id: article }), `/essays/a-new-idea--${article}/`);
});
test('file signatures reject HTML disguised as video', () => {
  assert.equal(checkFileHeader(new TextEncoder().encode('<html>unsafe content</html>'), 'video/mp4'), false);
  assert.equal(checkFileHeader(new Uint8Array([0,0,0,24,102,116,121,112]), 'video/mp4'), true);
});
test('WebP metadata is removed without copying the identifying chunks', () => {
  function chunk(name, text) {
    const data = new TextEncoder().encode(text);
    const bytes = new Uint8Array(8 + data.length + data.length % 2);
    bytes.set(new TextEncoder().encode(name)); new DataView(bytes.buffer).setUint32(4, data.length, true); bytes.set(data, 8); return bytes;
  }
  const chunks = [chunk('VP8L', 'image'), chunk('EXIF', 'private-location'), chunk('XMP ', 'private-author')];
  const input = new Uint8Array(12 + chunks.reduce((sum, part) => sum + part.length, 0));
  input.set(new TextEncoder().encode('RIFF')); input.set(new TextEncoder().encode('WEBP'), 8);
  new DataView(input.buffer).setUint32(4, input.length - 8, true);
  let offset = 12; for (const part of chunks) { input.set(part, offset); offset += part.length; }
  const cleaned = stripWebpMetadata(input.buffer);
  assert.equal(new TextDecoder().decode(cleaned).includes('private-'), false);
  assert.equal(new DataView(cleaned.buffer).getUint32(4, true), cleaned.length - 8);
});
