export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);

export function safeLink(value) {
  try {
    const url = new URL(value);
    return ['https:', 'http:', 'mailto:'].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

export function renderDocument(document, articleId, availableMedia) {
  if (document?.type !== 'doc' || !Array.isArray(document.content)) throw new Error('Invalid article document.');
  let count = 0;
  const usedMedia = new Set();
  function render(node, depth = 0) {
    if (++count > 10000 || depth > 24 || !node || typeof node !== 'object') throw new Error('Article is too complex.');
    if (node.type === 'text') {
      if (typeof node.text !== 'string') throw new Error('Invalid article text.');
      let text = escapeHtml(node.text);
      for (const mark of node.marks || []) {
        const tag = { bold: 'strong', italic: 'em', underline: 'u', strike: 's', code: 'code' }[mark.type];
        if (tag) text = `<${tag}>${text}</${tag}>`;
        else if (mark.type === 'link') {
          const href = safeLink(mark.attrs?.href);
          if (!href) throw new Error('A link has an unsupported address.');
          text = `<a href="${escapeHtml(href)}" rel="noopener noreferrer">${text}</a>`;
        } else throw new Error('Unsupported text formatting.');
      }
      return text;
    }
    if (node.type === 'media') {
      const { id, kind, alt = '', caption = '' } = node.attrs || {};
      if (!UUID.test(articleId) || !UUID.test(id) || !['image/webp','video/mp4','video/webm','application/pdf'].includes(kind)) throw new Error('Unsupported attachment.');
      if (typeof alt !== 'string' || typeof caption !== 'string' || alt.length > 500 || caption.length > 500) throw new Error('Invalid attachment description.');
      const media = availableMedia.find(item => item.id === id && item.state === 'ready' && item.article_id === articleId);
      if (!media || media.kind !== kind) throw new Error('An attachment is unavailable or still uploading.');
      usedMedia.add(id);
      const src = `/media/${articleId}/${id}`;
      let element;
      if (kind.startsWith('image/')) element = `<img src="${src}" alt="${escapeHtml(alt)}" loading="lazy">`;
      else if (kind.startsWith('video/')) element = `<video controls playsinline preload="metadata" aria-label="${escapeHtml(alt || 'Article video')}"><source src="${src}" type="${kind}"><a href="${src}">Download video</a></video>`;
      else element = `<a href="${src}" download>${escapeHtml(alt || 'Download document')}</a>`;
      return `<figure>${element}${caption ? `<figcaption>${escapeHtml(caption)}</figcaption>` : ''}</figure>`;
    }
    if (node.type === 'hardBreak') return '<br>';
    if (node.type === 'horizontalRule') return '<hr>';
    const children = (node.content || []).map(child => render(child, depth + 1)).join('');
    if (node.type === 'doc') return children;
    if (node.type === 'heading') {
      const level = Number(node.attrs?.level);
      if (![2, 3, 4].includes(level)) throw new Error('Unsupported heading level.');
      return `<h${level}>${children}</h${level}>`;
    }
    if (node.type === 'codeBlock') return `<pre><code>${children}</code></pre>`;
    const tag = { paragraph: 'p', blockquote: 'blockquote', bulletList: 'ul', orderedList: 'ol', listItem: 'li' }[node.type];
    if (!tag) throw new Error('Unsupported article element.');
    return `<${tag}>${children}</${tag}>`;
  }
  return { html: render(document), mediaIds: [...usedMedia] };
}

export function articlePath(article) {
  const slug = article.title.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0,65) || 'essay';
  return `/essays/${slug}--${article.id}/`;
}

export function publicPage(title, content, description = '') {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)} — Carl Friedrich Gauss</title><meta name="description" content="${escapeHtml(description)}"><meta name="referrer" content="no-referrer"><link rel="icon" href="/assets/favicon.svg"><link rel="stylesheet" href="/assets/site.css"><link rel="stylesheet" href="/assets/writing.css"><script type="module" src="/assets/site.mjs"></script></head><body><a class="skip-link" href="#main">Skip to content</a><header class="site-header"><div class="container header-inner"><a class="brand" href="/"><img src="/assets/gauss-portrait.jpg" alt="" width="52" height="52"><span>Carl Friedrich Gauss<span class="brand-subtitle">Independent thought · Mathematics</span></span></a><nav aria-label="Main navigation"><a href="/essays/">Essays</a> · <a href="/academy/">Academy</a> · <a data-account-link href="/write/">Sign in</a></nav></div></header><main id="main">${content}</main><footer class="site-footer"><div class="container"><a href="/">Carl Friedrich Gauss</a> · <a href="/privacy/">Privacy</a></div></footer></body></html>`;
}
