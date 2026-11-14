import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import sanitizeHtml from 'sanitize-html';
import sharp from 'sharp';

const ATOM = 'http://www.w3.org/2005/Atom';
const LABELS = 'http://www.blogger.com/atom/ns#';
const LIMIT = Object.freeze({ xmlBytes: 8 * 1024 * 1024, totalXmlBytes: 32 * 1024 * 1024, pages: 20, entries: 250, content: 200_000, images: 200, imageBytes: 8 * 1024 * 1024, totalImageBytes: 64 * 1024 * 1024, pixels: 25_000_000 });
const error = () => new Error('The publishing source could not be synchronized safely.');
const hash = value => createHash('sha256').update(value).digest('hex');
const list = value => value === undefined ? [] : Array.isArray(value) ? value : [value];
const text = value => typeof value === 'string' ? value : typeof value?.['#text'] === 'string' ? value['#text'] : '';
const localName = value => value.split(':').at(-1);
function child(object, name) {
  if (!object || typeof object !== 'object') return undefined;
  const key = Object.keys(object).find(key => !key.startsWith('@_') && localName(key) === name);
  return key === undefined ? undefined : object[key];
}

function httpsUrl(value) {
  if (typeof value !== 'string' || value.length > 8192 || /[\u0000-\u0020\u007f\\]/u.test(value)) throw error();
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash) throw error();
  return url;
}

function feedUrl(value, expectedHost) {
  const url = httpsUrl(value);
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.blogspot\.com$/u.test(url.hostname) || expectedHost && url.hostname !== expectedHost || url.pathname !== '/feeds/posts/default') throw error();
  for (const [key, value] of url.searchParams) {
    if (url.searchParams.getAll(key).length !== 1 || !['alt', 'max-results', 'start-index'].includes(key)) throw error();
    if (key === 'alt' && value !== 'atom') throw error();
    if (key === 'max-results' && (!/^\d+$/u.test(value) || +value < 1 || +value > 100)) throw error();
    if (key === 'start-index' && (!/^\d+$/u.test(value) || +value < 1 || +value > 100_000)) throw error();
  }
  return url;
}

function isImageHost(hostname) {
  return hostname === 'blogger.googleusercontent.com' || /^[1-4]\.bp\.blogspot\.com$/u.test(hostname) || /^lh[3-6]\.googleusercontent\.com$/u.test(hostname) || /^bp[0-3]\.blogger\.com$/u.test(hostname);
}

function imageUrl(value) {
  const url = httpsUrl(value);
  if (!isImageHost(url.hostname)) throw error();
  return url;
}

function videoUrl(value, sourceHost) {
  const url = httpsUrl(value);
  if (url.hostname === 'www.blogger.com' && url.pathname === '/video.g') {
    const token = url.searchParams.get('token');
    const origins = url.searchParams.getAll('origin');
    const unknownParameter = [...url.searchParams.keys()].some(key => key !== 'token' && key !== 'origin');
    if (!token || !/^[A-Za-z0-9_.~=-]{10,4096}$/u.test(token) || url.searchParams.getAll('token').length !== 1 || unknownParameter) throw error();
    if (origins.length > 1 || origins.length === 1 && ![sourceHost, `https://${sourceHost}`].includes(origins[0])) throw error();
    return `https://www.blogger.com/video.g?token=${encodeURIComponent(token)}`;
  }
  const youtube = new Set(['www.youtube.com', 'youtube.com', 'www.youtube-nocookie.com', 'youtube-nocookie.com', 'youtu.be']);
  if (!youtube.has(url.hostname)) throw error();
  const id = url.hostname === 'youtu.be' ? url.pathname.slice(1) : url.pathname === '/watch' ? url.searchParams.get('v') : /^\/(?:embed|v)\//u.test(url.pathname) ? url.pathname.split('/')[2] : null;
  if (!id || !/^[A-Za-z0-9_-]{11}$/u.test(id)) throw error();
  const start = url.searchParams.get('start');
  if (start && (!/^\d{1,5}$/u.test(start) || +start > 86400)) throw error();
  return `https://www.youtube-nocookie.com/embed/${id}${start ? `?start=${+start}` : ''}`;
}

function normalLink(value) {
  try {
    const parsed = new URL(value);
    const fragment = parsed.hash;
    parsed.hash = '';
    const url = httpsUrl(parsed.href);
    url.hash = fragment;
    if (['blogger.com', 'www.blogger.com'].includes(url.hostname) && url.pathname.startsWith('/profile') || ['accounts.google.com', 'myaccount.google.com'].includes(url.hostname) || isImageHost(url.hostname)) return undefined;
    return url.href;
  } catch { return undefined; }
}

const xmlParser = new XMLParser({ ignoreAttributes: false, parseTagValue: false, parseAttributeValue: false, trimValues: false, processEntities: true, htmlEntities: true });
function parseXml(xml) {
  if (/<!\s*(?:DOCTYPE|ENTITY)\b/iu.test(xml) || xml.includes('\0')) throw error();
  let depth = 0;
  let nodes = 0;
  for (const match of xml.matchAll(/<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<\/?[A-Za-z_][^<>]*>/gu)) {
    const tag = match[0];
    if (tag.startsWith('<!') || tag.startsWith('<?')) continue;
    if (++nodes > 30_000) throw error();
    if (tag.startsWith('</')) depth--;
    else if (!tag.endsWith('/>')) depth++;
    if (depth > 32 || depth < 0) throw error();
  }
  if (XMLValidator.validate(xml) !== true) throw error();
  const parsed = xmlParser.parse(xml);
  const feed = parsed.feed;
  if (!feed || typeof feed !== 'object' || feed['@_xmlns'] !== ATOM) throw error();
  return feed;
}

function plainText(html) {
  const escaped = sanitizeHtml(html, { allowedTags: [], allowedAttributes: {}, nonTextTags: ['script', 'style', 'textarea', 'option', 'noscript'] });
  const decoded = xmlParser.parse(`<text>${escaped}</text>`).text;
  return text(decoded).replaceAll(/\s+/gu, ' ').trim();
}

function shortText(value, maximum) {
  const result = plainText(text(value));
  if (!result || Array.from(result).length > maximum) throw error();
  return result;
}

async function responseBytes(response, maximum) {
  const length = response.headers.get('content-length');
  if (length && (!/^\d+$/u.test(length) || +length > maximum)) throw error();
  if (!response.body) throw error();
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximum) throw error();
      chunks.push(Buffer.from(value));
    }
  } catch (cause) {
    await reader.cancel().catch(() => {});
    throw cause;
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks, size);
}

async function fetchBytes(value, validate, maximum, fetchImpl, kinds) {
  let url = validate(value);
  for (let redirects = 0; redirects <= 3; redirects++) {
    const response = await fetchImpl(url.href, { redirect: 'manual', credentials: 'omit', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(20_000), headers: { Accept: kinds[0] } });
    if (response.redirected || response.url && response.url !== url.href) throw error();
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      if (!location || redirects === 3) throw error();
      url = validate(new URL(location, url).href);
      await response.body?.cancel().catch(() => {});
      continue;
    }
    if (response.status !== 200 || !kinds.includes((response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase())) throw error();
    return responseBytes(response, maximum);
  }
  throw error();
}

function rasterFormat(bytes) {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return true;
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return true;
  if (/^GIF8[79]a$/u.test(bytes.subarray(0, 6).toString('ascii'))) return true;
  if (bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP') return true;
  return bytes.subarray(4, 8).toString('ascii') === 'ftyp' && ['avif', 'avis'].includes(bytes.subarray(8, 12).toString('ascii'));
}

function sanitizeBody(content, imageSources, sourceHost) {
  if (typeof content !== 'string' || !content.trim() || content.length > LIMIT.content) throw error();
  const toVideo = value => ({ tagName: 'a', attribs: { href: videoUrl(value, sourceHost), class: 'article-video', rel: 'noopener noreferrer' }, text: 'Load video' });
  return sanitizeHtml(content, {
    allowedTags: ['p', 'br', 'h2', 'h3', 'h4', 'strong', 'b', 'em', 'i', 'u', 's', 'sub', 'sup', 'ul', 'ol', 'li', 'blockquote', 'pre', 'code', 'hr', 'a', 'img', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'span', 'div'],
    allowedAttributes: { a: ['href', 'rel', 'class'], img: ['src', 'alt', 'loading', 'decoding'], th: ['scope', 'colspan', 'rowspan'], td: ['colspan', 'rowspan'] },
    allowedSchemes: ['https'],
    allowProtocolRelative: false,
    nonTextTags: ['script', 'style', 'textarea', 'option', 'noscript', 'svg', 'math', 'template', 'form'],
    parser: { decodeEntities: true },
    nestingLimit: 40,
    transformTags: {
      h1: () => ({ tagName: 'h2', attribs: {} }),
      a: (_, attrs) => {
        const href = normalLink(attrs.href);
        return { tagName: 'a', attribs: href ? { href, rel: 'noopener noreferrer' } : {} };
      },
      img: (_, attrs) => {
        const source = imageUrl(attrs.src).href;
        if (!imageSources.has(source) && imageSources.size >= LIMIT.images) throw error();
        const placeholder = `/assets/published/pending-${hash(source)}.webp`;
        imageSources.set(source, placeholder);
        if ((attrs.alt || '').length > 400) throw error();
        return { tagName: 'img', attribs: { src: placeholder, alt: attrs.alt || '', loading: 'lazy', decoding: 'async' } };
      },
      iframe: (_, attrs) => toVideo(attrs.src),
      embed: (_, attrs) => toVideo(attrs.src),
      object: (_, attrs) => attrs.data ? toVideo(attrs.data) : { tagName: 'span', attribs: {} },
      param: (_, attrs) => ['movie', 'src'].includes((attrs.name || '').toLowerCase()) && attrs.value ? toVideo(attrs.value) : { tagName: 'span', attribs: {}, text: '' },
    },
  });
}

function parseDate(value) {
  const raw = text(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/u.test(raw) || !Number.isFinite(Date.parse(raw))) return null;
  return new Date(raw).toISOString();
}

function privacyGuard(terms, digests) {
  if (!Array.isArray(terms) || terms.length > 100 || terms.some(term => typeof term !== 'string' || term.length > 256 || term.trim().length < 3)) throw error();
  if (!Array.isArray(digests) || digests.length > 100) throw error();
  const lengths = new Map();
  for (const item of digests) {
    if (!item || typeof item !== 'object' || Array.isArray(item) || Object.keys(item).length !== 2 || !Object.hasOwn(item, 'length') || !Object.hasOwn(item, 'sha256') || !Number.isSafeInteger(item.length) || item.length < 3 || item.length > 128 || typeof item.sha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(item.sha256)) throw error();
    if (!lengths.has(item.length)) lengths.set(item.length, new Set());
    lengths.get(item.length).add(item.sha256);
  }
  const normalize = value => value.normalize('NFKC').replaceAll(/\p{Cf}/gu, '').toLowerCase();
  const needles = terms.map(term => normalize(term.trim()));
  const checkedTokens = new Set();
  let windows = 0;
  return value => {
    if (typeof value !== 'string' || value.length > 1_000_000) throw error();
    let decoded = value;
    for (let i = 0; i < 2; i++) decoded = decoded.replaceAll(/(?:%[a-f0-9]{2})+/giu, sequence => { try { return decodeURIComponent(sequence); } catch { return sequence; } });
    const haystack = normalize(decoded);
    if (needles.some(needle => haystack.includes(needle))) throw error();
    if (!lengths.size) return;
    for (const [token] of haystack.matchAll(/[\p{L}\p{N}]+/gu)) {
      if (checkedTokens.has(token)) continue;
      const points = Array.from(token);
      if (points.length > 8192 || checkedTokens.size >= 50_000) throw error();
      let cost = 0;
      for (const length of lengths.keys()) cost += Math.max(0, points.length - length + 1);
      windows += cost;
      if (windows > 2_000_000) throw error();
      for (const [length, candidates] of lengths) {
        for (let offset = 0; offset + length <= points.length; offset++) {
          if (candidates.has(hash(points.slice(offset, offset + length).join('')))) throw error();
        }
      }
      checkedTokens.add(token);
    }
  };
}

async function installOutput(outputDir, records, assets) {
  const destination = path.resolve(outputDir);
  if (destination === path.parse(destination).root) throw error();
  await mkdir(destination, { recursive: true });
  const stage = path.join(destination, `.sync-${randomUUID()}`);
  const backup = path.join(destination, `.previous-assets-${randomUUID()}`);
  const assetDir = path.join(destination, 'assets');
  for (const target of [destination, assetDir]) {
    const status = await lstat(target).catch(cause => {
      if (cause.code === 'ENOENT') return null;
      throw cause;
    });
    if (status && (!status.isDirectory() || status.isSymbolicLink())) throw error();
  }
  let movedOldAssets = false;
  let installedAssets = false;
  try {
    await mkdir(path.join(stage, 'assets'), { recursive: true });
    for (const [filename, bytes] of assets) await writeFile(path.join(stage, 'assets', filename), bytes, { flag: 'wx' });
    await writeFile(path.join(stage, 'articles.json'), JSON.stringify(records, null, 2) + '\n', { flag: 'wx' });
    try { await rename(assetDir, backup); movedOldAssets = true; } catch (cause) { if (cause.code !== 'ENOENT') throw cause; }
    await rename(path.join(stage, 'assets'), assetDir);
    installedAssets = true;
    await rename(path.join(stage, 'articles.json'), path.join(destination, 'articles.json'));
  } catch (cause) {
    if (installedAssets) await rm(assetDir, { recursive: true, force: true });
    if (movedOldAssets) await rename(backup, assetDir);
    throw cause;
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
  if (movedOldAssets) await rm(backup, { recursive: true, force: true });
}

/** Refresh the public content snapshot. No account credential or private feed is accepted. */
export async function syncPublished({ feedUrl: configuredUrl, outputDir, fetchImpl = fetch, privacyTerms = [], privacyHashes = [] }) {
  try {
    if (typeof outputDir !== 'string' || !outputDir || typeof fetchImpl !== 'function') throw error();
    const initial = feedUrl(configuredUrl);
    const validateFeed = value => feedUrl(value, initial.hostname);
    const guard = privacyGuard(privacyTerms, privacyHashes);
    const imageSources = new Map();
    const seenPages = new Set();
    const seenEntries = new Set();
    const records = [];
    let next = initial.href;
    let totalXml = 0;
    let totalEntries = 0;
    while (next) {
      if (seenPages.has(next) || seenPages.size >= LIMIT.pages) throw error();
      seenPages.add(next);
      const bytes = await fetchBytes(next, validateFeed, LIMIT.xmlBytes, fetchImpl, ['application/atom+xml', 'application/xml', 'text/xml']);
      totalXml += bytes.length;
      if (totalXml > LIMIT.totalXmlBytes) throw error();
      const feed = parseXml(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
      for (const entry of list(feed.entry)) {
        if (++totalEntries > LIMIT.entries || !entry || typeof entry !== 'object') throw error();
        const publicationControl = child(entry, 'control');
        if (text(child(publicationControl, 'draft')).trim().toLowerCase() === 'yes') continue;
        if (text(child(publicationControl, 'scheduled')).trim().toLowerCase() === 'yes') continue;
        const published = parseDate(entry.published);
        const updated = parseDate(entry.updated);
        if (!published || !updated || Date.parse(published) > Date.now()) continue;
        const id = text(entry.id).trim();
        if (!id || id.length > 1024 || seenEntries.has(id)) throw error();
        seenEntries.add(id);
        const title = shortText(entry.title, 200);
        const author = shortText(list(entry.author || feed.author)[0]?.name, 120);
        if (entry.content?.['@_type'] && entry.content['@_type'] !== 'html') throw error();
        const html = sanitizeBody(text(entry.content), imageSources, initial.hostname);
        const bodyText = plainText(html);
        if (!bodyText && !html.includes('<img ')) throw error();
        const summary = Array.from(bodyText).slice(0, 260).join('');
        const tags = [...new Set(list(entry.category).filter(tag => tag['@_scheme'] === LABELS).map(tag => shortText(tag['@_term'], 60)))];
        if (tags.length > 20) throw error();
        for (const value of [title, author, html, bodyText, ...tags]) guard(value);
        records.push({ slug: `essay-${hash(id).slice(0, 24)}`, title, author, published, updated, summary, html, tags });
      }
      const links = list(feed.link).filter(link => link['@_rel'] === 'next');
      if (links.length > 1) throw error();
      next = links.length ? validateFeed(links[0]['@_href']).href : null;
    }
    const assets = new Map();
    let totalImageBytes = 0;
    for (const [source, placeholder] of imageSources) {
      const bytes = await fetchBytes(source, imageUrl, LIMIT.imageBytes, fetchImpl, ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']);
      totalImageBytes += bytes.length;
      if (totalImageBytes > LIMIT.totalImageBytes || !rasterFormat(bytes)) throw error();
      const converted = await sharp(bytes, { failOn: 'warning', limitInputPixels: LIMIT.pixels, animated: false, sequentialRead: true }).rotate().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).webp({ quality: 82, effort: 4 }).toBuffer();
      if (converted.length > 4 * 1024 * 1024) throw error();
      const filename = `${hash(converted)}.webp`;
      guard(filename);
      guard(`/assets/published/${filename}`);
      assets.set(filename, converted);
      for (const record of records) record.html = record.html.replaceAll(placeholder, `/assets/published/${filename}`);
    }
    records.sort((left, right) => right.published.localeCompare(left.published) || left.slug.localeCompare(right.slug));
    for (const record of records) guard(JSON.stringify(record));
    if (new Set(records.map(record => record.slug)).size !== records.length) throw error();
    await installOutput(outputDir, records, assets);
    return records;
  } catch { throw error(); }
}
