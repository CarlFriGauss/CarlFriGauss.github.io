import { readdir, readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
import { parseDocument } from 'htmlparser2';

const root = path.resolve(fileURLToPath(new URL('../dist/', import.meta.url)));
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
function elements(rootNode) {
  const result = [];
  const pending = [...rootNode.children];
  while (pending.length) {
    const node = pending.pop();
    if (node.attribs) result.push(node);
    if (node.children) pending.push(...node.children);
  }
  return result;
}

const files = await collect(root);
const documents = new Map();
for (const file of files) {
  const text = await readFile(file, 'utf8');
  const nodes = elements(parseDocument(text));
  assert.equal(nodes.filter(node => node.name === 'h1').length, 1, 'Each page needs one H1');
  assert.equal(nodes.filter(node => node.name === 'main').length, 1, 'Each page needs one main landmark');
  assert(nodes.some(node => node.name === 'html' && node.attribs.lang === 'en'), 'Page language must be declared');
  assert(nodes.some(node => node.name === 'meta' && node.attribs['http-equiv']?.toLowerCase() === 'content-security-policy'), 'A page must declare its resource policy');
  for (const node of nodes) {
    assert(!Object.keys(node.attribs).some(name => /^on[a-z]+$/i.test(name)), 'Inline event handlers are not allowed');
    if (node.name === 'img') assert(Object.hasOwn(node.attribs, 'alt'), 'Images need an alt attribute');
  }
  documents.set(file, nodes);
}
let links = 0;
for (const [file, nodes] of documents) {
  const relative = path.relative(root, file).replaceAll(path.sep, '/');
  const base = new URL('/' + relative, origin);
  for (const node of nodes) {
    for (const key of ['href', 'src']) {
      if (!Object.hasOwn(node.attribs, key)) continue;
      const value = node.attribs[key];
      assert(value.trim() && value.trim() !== '#', 'Avoid empty link targets');
      const url = new URL(value, base);
      assert(['https:', 'http:', 'mailto:'].includes(url.protocol), 'Unexpected resource protocol');
      if (url.origin !== origin) continue;
      const local = path.resolve(root, '.' + decodeURIComponent(url.pathname));
      assert(local === root || local.startsWith(root + path.sep), 'Link escaped the website');
      const target = url.pathname.endsWith('/') ? path.join(local, 'index.html') : local;
      assert((await stat(target).catch(() => null))?.isFile(), 'A local link target is missing');
      if (url.hash) {
        const fragment = decodeURIComponent(url.hash.slice(1));
        assert(documents.get(target)?.some(node => node.attribs.id === fragment), 'A local link fragment is missing');
      }
      links++;
    }
  }
}
assert.equal((await readFile(path.join(root, 'CNAME'), 'utf8')).trim(), 'carlfriedrichgauss.com');
console.log(`Checked ${files.length} HTML pages and ${links} local links/assets; landmarks, resource policy, fragments, and domain configuration pass.`);
