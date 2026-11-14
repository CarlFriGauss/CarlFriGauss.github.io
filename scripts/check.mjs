import { readdir, readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';

const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const origin = 'https://carlfriedrichgauss.com';
async function collect(dir) {
  const files = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    const name = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await collect(name));
    else if (entry.name.endsWith('.html')) files.push(name);
  }
  return files;
}
const files = await collect(root);
const documents = new Map();
for (const file of files) {
  const text = await readFile(file, 'utf8');
  assert.equal((text.match(/<h1\b/gi) || []).length, 1, `${path.relative(root, file)} needs one H1`);
  assert.equal((text.match(/<main\b/gi) || []).length, 1, `${path.relative(root, file)} needs one main landmark`);
  assert.match(text, /<html\b[^>]*lang="en"/, 'Page language must be declared');
  assert.match(text, /Content-Security-Policy/, 'A page must declare its resource policy');
  assert.doesNotMatch(text, /\son[a-z]+\s*=/i, 'Inline event handlers are not allowed');
  assert.doesNotMatch(text, /(?:href|src)="(?:javascript:|#")/i, 'Avoid unsafe or empty link targets');
  for (const image of text.matchAll(/<img\b[^>]*>/gi)) assert.match(image[0], /\balt=/i, 'Images need an alt attribute');
  documents.set(file, text);
}
let links = 0;
for (const [file, text] of documents) {
  const relative = path.relative(root, file).replaceAll(path.sep, '/');
  const base = new URL('/' + relative, origin);
  for (const match of text.matchAll(/\b(?:href|src)="([^"]+)"/g)) {
    const value = match[1].replaceAll('&amp;', '&');
    const url = new URL(value, base);
    if (url.origin !== origin || !['http:', 'https:'].includes(url.protocol)) continue;
    const local = path.resolve(root, '.' + decodeURIComponent(url.pathname));
    assert(local === root || local.startsWith(root + path.sep), 'Link escaped the website');
    let target = local;
    if (url.pathname.endsWith('/')) target = path.join(target, 'index.html');
    assert((await stat(target).catch(() => null))?.isFile(), `Broken local target in ${relative}: ${value}`);
    if (url.hash) {
      const content = documents.get(target) || await readFile(target, 'utf8');
      assert(content.includes(`id="${decodeURIComponent(url.hash.slice(1))}"`), `Missing fragment in ${relative}: ${value}`);
    }
    links++;
  }
}
assert.equal((await readFile(path.join(root, 'CNAME'), 'utf8')).trim(), 'carlfriedrichgauss.com');
console.log(`Checked ${files.length} HTML pages and ${links} local links/assets; landmarks, resource policy, fragments, and domain configuration pass.`);
