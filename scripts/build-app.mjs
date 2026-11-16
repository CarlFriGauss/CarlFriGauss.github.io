import { cp, mkdir, readdir, rm, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, 'dist');
if (path.dirname(output) !== path.resolve(root)) throw new Error('Invalid output directory.');
await rm(output, { recursive: true, force: true });
await mkdir(path.join(output, 'assets'), { recursive: true });

// Copy an explicit public-file allowlist. Server code, credentials, and drafts never enter the asset bundle.
const directories = ['about', 'academy', 'assets', 'contributors', 'essays', 'privacy', 'tools/gaussian-process'];
for (const directory of directories) {
  await cp(path.join(root, directory), path.join(output, directory), { recursive: true, filter: source => !source.endsWith('.test.mjs') });
}
for (const name of ['index.html', '404.html', 'robots.txt', 'sitemap.xml', '.nojekyll']) {
  await cp(path.join(root, name), path.join(output, name));
}
await mkdir(path.join(output, 'write'), { recursive: true });
await cp(path.join(root, 'writing/index.html'), path.join(output, 'write/index.html'));
await cp(path.join(root, 'writing/style.css'), path.join(output, 'assets/writing.css'));
await build({ entryPoints: [path.join(root, 'writing/app.mjs')], outfile: path.join(output, 'assets/writing.mjs'), bundle: true, minify: true, sourcemap: false, format: 'esm', target: ['es2022'], legalComments: 'none' });

// The existing generated site keeps its independent build workflow.
for (const directory of directories.filter(directory => !directory.includes('/') && directory !== 'assets')) {
  const htmlPath = path.join(output, directory, 'index.html');
  const html = await readFile(htmlPath, 'utf8');
  await writeFile(htmlPath, html.replace('<nav aria-label="Footer navigation">', '<nav aria-label="Footer navigation"><a href="/write/">Contributor sign in</a>'));
}
const robots = await readFile(path.join(output, 'robots.txt'), 'utf8');
await writeFile(path.join(output, 'robots.txt'), robots.replace('Allow: /', 'Allow: /\nDisallow: /write/\nDisallow: /api/'));
await writeFile(path.join(output, '_headers'), `/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: no-referrer
  X-Frame-Options: DENY
  Permissions-Policy: camera=(), microphone=(), geolocation=()
https://preview.carlfriedrichgauss.com/*
  X-Robots-Tag: noindex, nofollow
`);
const allowed = new Set(['about','academy','assets','contributors','essays','privacy','tools','write','index.html','404.html','robots.txt','sitemap.xml','.nojekyll','_headers']);
for (const name of await readdir(output)) if (!allowed.has(name)) throw new Error(`Unexpected public artifact: ${name}`);
console.log('Built the website and contributor editor.');
