import { cp, lstat, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { pages } from '../content/pages.mjs';
import { posterior } from '../tools/gaussian-process/gp.mjs';
import { publishingPages } from '../content/publishing-pages.mjs';
import { syncPublished } from './publishing.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.resolve(root, 'dist');
if (output !== path.join(root, 'dist') || (await lstat(output).catch(() => null))?.isSymbolicLink()) throw new Error('Invalid build destination.');
let config;
let privacyHashes;
try {
  config = JSON.parse(await readFile(path.join(root, 'publishing.config.json'), 'utf8'));
  privacyHashes = JSON.parse(process.env.PUBLISHING_PRIVACY_HASHES || '[]');
  if (!/^https:\/\/www\.blogger\.com\/blog\/posts\/\d+$/.test(config.editorUrl)) throw new Error();
  if (process.env.GITHUB_ACTIONS === 'true' && (!Array.isArray(privacyHashes) || !privacyHashes.length)) throw new Error();
} catch {
  throw new Error('The publishing configuration or privacy filter is unavailable.');
}
const articles = await syncPublished({ feedUrl: config.feedUrl, outputDir: path.join(root, '_publishing'), privacyHashes });
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await cp(path.join(root, 'assets'), path.join(output, 'assets'), { recursive: true });
await cp(path.join(root, 'tools/gaussian-process'), path.join(output, 'tools/gaussian-process'), { recursive: true, filter: source => !source.endsWith('.test.mjs') && !source.endsWith('README.md') });
await cp(path.join(root, 'GaussianProcess'), path.join(output, 'GaussianProcess'), { recursive: true });
await cp(path.join(root, '_publishing/assets'), path.join(output, 'assets/published'), { recursive: true });
await cp(path.join(root, 'CNAME'), path.join(output, 'CNAME'));
await writeFile(path.join(output, '.nojekyll'), '');
const origin = 'https://carlfriedrichgauss.com';
const email = 'Carl_Fr_Gauss@proton.me';
const escape = text => String(text).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const arrow = '<span aria-hidden="true">↗</span>';
const navItems = [['Essays', '/essays/', 'essays'], ['Academy', '/academy/', 'academy'], ['Explore', '/#explore', 'explore'], ['About', '/about/', 'about']];
const themeIcon = '<svg aria-hidden="true" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M20.2 15.3A8.5 8.5 0 0 1 8.7 3.8 8.5 8.5 0 1 0 20.2 15.3Z"/></svg>';

function header(active) {
  return `<header class="site-header"><div class="container header-inner">
    <a class="brand" href="/" aria-label="Carl Friedrich Gauss — Home"><img src="/assets/gauss-portrait.jpg" alt="" width="52" height="52"><span>Carl Friedrich Gauss<span class="brand-subtitle">Independent thought · Mathematics</span></span></a>
    <button class="menu-toggle" type="button" aria-expanded="false" aria-controls="site-nav" aria-label="Open navigation"><span></span><span></span></button>
    <nav class="site-nav" id="site-nav" aria-label="Main navigation">${navItems.map(([label, url, name]) => `<a href="${url}"${active === name ? ' aria-current="page"' : ''}>${label}</a>`).join('')}</nav>
    <div class="header-actions"><button class="theme-toggle" type="button" aria-label="Switch colour theme" title="Switch colour theme">${themeIcon}</button><a class="contact-link" href="mailto:${email}">Get in touch ${arrow}</a></div>
  </div></header>`;
}

function footer() {
  return `<footer class="site-footer"><div class="container"><div class="footer-top"><div><a class="footer-brand" href="/">Carl Friedrich Gauss<span aria-hidden="true">.</span></a><p>An independent place to think.<br>A thoughtful place to learn.</p></div><nav aria-label="Footer navigation"><a href="/essays/">Essays</a><a href="/academy/">Academy</a><a href="/contributors/">Contribute</a><a href="/about/">About</a><a href="mailto:${email}">Contact ${arrow}</a></nav></div><div class="footer-bottom"><span>© ${new Date().getUTCFullYear()} Carl Friedrich Gauss · A pen name.</span><div><a href="/privacy/">Privacy</a><a href="https://github.com/CarlFriGauss" target="_blank" rel="noopener noreferrer">GitHub ${arrow}</a></div><a href="#top" class="back-top">Back to top ↑</a></div></div></footer>`;
}

function render(page) {
  const url = page.path === '404' ? `${origin}/404.html` : `${origin}/${page.path ? page.path + '/' : ''}`;
  return `<!doctype html>
<html lang="en" id="top"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; connect-src 'none'; ${page.media ? "frame-src https://www.blogger.com https://www.youtube-nocookie.com; " : ''}object-src 'none'; base-uri 'none'; form-action 'none'">
<title>${escape(page.title)} — Carl Friedrich Gauss</title><meta name="description" content="${escape(page.description)}"><link rel="canonical" href="${url}"><meta property="og:type" content="website"><meta property="og:title" content="${escape(page.title)} — Carl Friedrich Gauss"><meta property="og:description" content="${escape(page.description)}"><meta property="og:url" content="${url}"><meta property="og:image" content="${origin}/assets/gauss-portrait.jpg"><meta name="twitter:card" content="summary"><link rel="icon" href="/assets/favicon.svg" type="image/svg+xml"><link rel="stylesheet" href="/assets/site.css"><script type="module" src="/assets/site.mjs"></script>${page.noindex ? '<meta name="robots" content="noindex">' : ''}</head>
<body><a class="skip-link" href="#main">Skip to content</a>${header(page.nav)}<main id="main">${page.body}</main>${footer()}</body></html>\n`.replace('<meta property="og:type" content="website">', `<meta property="og:type" content="${page.article ? 'article' : 'website'}">${page.author ? `<meta name="author" content="${escape(page.author)}">` : ''}`).replace('<link rel="icon"', '<link rel="alternate" type="application/rss+xml" title="Essays" href="/feed.xml"><link rel="icon"');
}

const query = Array.from({ length: 121 }, (_, i) => -4 + i / 15);
const observations = [{ x: -2.8, y: -.6 }, { x: -1.4, y: .9 }, { x: 0, y: .25 }, { x: 1.5, y: -.8 }, { x: 2.8, y: .6 }];
const model = posterior(observations, query, { lengthScale: 1, signalStd: 1, noiseStd: .16 });
const x = value => 24 + (value + 4) * 50;
const y = value => 114 - value * 43;
const line = values => values.map((v, i) => `${i ? 'L' : 'M'}${x(query[i]).toFixed(2)},${y(v).toFixed(2)}`).join(' ');
const band = line(model.upper) + ' ' + model.lower.map((_, n, a) => { const i = a.length - 1 - n; return `L${x(query[i]).toFixed(2)},${y(a[i]).toFixed(2)}`; }).join(' ') + ' Z';
const preview = `<svg class="hero-plot" id="preview-plot" viewBox="0 0 448 240" role="img" aria-labelledby="preview-title preview-desc"><title id="preview-title">A Gaussian process after five observations</title><desc id="preview-desc">Teal mean curve with a shaded 95 percent pointwise interval for the latent function.</desc><defs><pattern id="plot-grid" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M 40 0 L 0 0 0 40" class="preview-grid"/></pattern></defs><rect width="448" height="240" fill="url(#plot-grid)"/><path class="preview-axis" d="M24 114H424"/><path class="preview-band" id="preview-band" d="${band}"/><path class="preview-mean" id="preview-mean" d="${line(model.mean)}"/><g id="preview-points">${observations.map(p => `<circle cx="${x(p.x)}" cy="${y(p.y)}" r="4.5"/>`).join('')}</g><text x="24" y="232" class="preview-label">−4</text><text x="220" y="232" class="preview-label">0</text><text x="416" y="232" class="preview-label">4</text></svg>`;

const home = {
  path: '', nav: '', title: 'Independent thought. Mathematical clarity.',
  description: 'Independent essays, thoughtful conversation, and mathematics from first principles. Explore the work of Carl Friedrich Gauss, a pen name.',
  body: `<section class="home-hero container"><div class="hero-copy"><p class="eyebrow"><span class="small-rule"></span> A space for the curious mind</p><h1>Independent thought.<br><em>Mathematical clarity.</em></h1><p class="hero-lede">A home for ideas worth examining.<br>A place to understand, from first principles.</p><div class="hero-actions"><a class="button" href="/essays/">Explore the writing ${arrow}</a><a class="text-link" href="/academy/">Discover the academy <span aria-hidden="true">→</span></a></div><p class="hero-footnote">Independent essays · Mathematics · Probability · Statistics</p></div>
  <div class="idea-panel" data-reveal><div class="idea-panel-top"><span class="eyebrow">An idea, made visible</span><span class="idea-index">01 / ∞</span></div><h2>The shape of<br>what we don’t know.</h2>${preview}<div class="preview-controls" role="group" aria-label="Gaussian process preview"><button type="button" data-model="prior" aria-pressed="false">Before data</button><button type="button" data-model="posterior" aria-pressed="true">After data</button></div><p id="preview-summary" aria-live="polite">Five observations bring the possible functions into focus.</p><a class="idea-panel-link" href="/tools/gaussian-process/">Open the full explorer ${arrow}</a></div></section>
  <div class="container"><div class="intro-rule"><span>Two pursuits. One spirit of inquiry.</span><span class="down-indicator" aria-hidden="true">↓</span></div></div>
  <section class="section container writing-section" data-reveal><div class="section-label"><span class="section-index">01</span><span class="eyebrow">The writing</span></div><div class="writing-layout"><div><h2 class="section-title">Room to think.<br><em>Freedom to question.</em></h2><p class="section-copy">Some ideas need more than a short post. This is a space for independent essays, considered arguments, and the questions that deserve a longer conversation.</p><a class="text-link" href="/essays/">Visit the essay collection <span aria-hidden="true">→</span></a></div><div class="notebook"><div class="notebook-heading"><span class="eyebrow">An open notebook</span><span aria-hidden="true">↗</span></div><h3>Ideas, examined<br>in full.</h3><p>The first essays are being prepared. Writing will appear here under the name Carl Friedrich Gauss, alongside selected guest contributions.</p><div class="notebook-bottom"><span class="meta">Independent voices. Thoughtful exchange.</span><a href="/contributors/" aria-label="Read about guest contributions">Contribute ${arrow}</a></div></div></div></section>
  <section class="academy-section" data-reveal><div class="container"><div class="academy-intro"><div><div class="section-label"><span class="section-index">02</span><span class="eyebrow">The academy</span></div><h2>Understanding is built.<br><em>One idea at a time.</em></h2></div><div class="academy-description"><span class="status">In development</span><p>A planned academy for mathematics, probability, and statistics. Clear explanations, rigorous foundations, and room to ask why.</p><a class="button button-light" href="/academy/">Explore the academy ${arrow}</a></div></div><div class="academy-links"><a href="/academy/mathematics/"><span class="course-number">I</span><div><h3>Mathematics</h3><p>From intuition to proof.</p></div><span aria-hidden="true">↗</span></a><a href="/academy/probability/"><span class="course-number">II</span><div><h3>Probability</h3><p>A language for uncertainty.</p></div><span aria-hidden="true">↗</span></a><a href="/academy/statistics/"><span class="course-number">III</span><div><h3>Statistics</h3><p>Reasoning from evidence.</p></div><span aria-hidden="true">↗</span></a></div></div></section>
  <section class="section container explore-section" id="explore" data-reveal><div class="section-label"><span class="section-index">03</span><span class="eyebrow">Explore an idea</span></div><div class="explore-layout"><div class="explore-symbol" aria-hidden="true"><span>ƒ</span><svg viewBox="0 0 280 160"><path d="M10 140C68 140 84 20 140 20S212 140 270 140"/><path d="M10 140H270" class="baseline"/></svg><span class="symbol-caption">Intuition meets mathematics.</span></div><div><span class="status">Free interactive tool</span><h2 class="section-title">Uncertainty,<br><em>made visible.</em></h2><p class="section-copy">Add a few observations. Change the assumptions. See a Gaussian process update its view of what might come next.</p><a class="button" href="/tools/gaussian-process/">Try the GP explorer ${arrow}</a><p class="small-note">Runs in your browser. No account or upload required.</p></div></div></section>
  <section class="about-strip"><div class="container about-strip-inner"><img src="/assets/gauss-portrait.jpg" alt="Historical portrait of Carl Friedrich Gauss" width="108" height="108" loading="lazy"><div><p class="eyebrow">Behind the name</p><h2>A shared banner for curiosity and rigor.</h2><p>Carl Friedrich Gauss is the pen name behind this independent writing and educational project.</p></div><a class="text-link" href="/about/">About the project ${arrow}</a></div></section>`
};

const error = { path: '404', title: 'Page not found', description: 'Find your way back to the essays, academy, and mathematics explorer.', nav: '', noindex: true, body: '<section class="container page-hero"><p class="eyebrow">404 · An unexpected turn</p><h1>This page is<br><em>still a mystery.</em></h1><p class="lede">The address may have changed. The main paths are still here.</p><div class="hero-actions"><a class="button" href="/">Return home →</a><a class="text-link" href="/academy/">Explore the academy ↗</a></div></section>' };
if (articles.length) home.body = home.body.replace('The first essays are being prepared. Writing will appear here under the name Carl Friedrich Gauss, alongside selected guest contributions.', 'Explore the essay collection: original writing under the name Carl Friedrich Gauss, alongside invited contributions.');
const basePages = pages.filter(page => !['essays', 'contributors'].includes(page.path)).map(page => {
  if (page.path === 'about' && articles.length) return { ...page, body: page.body.replace('The public site is at the beginning of that work. The first essays are in preparation, the academy is in development, and the free Gaussian process explorer is available now.', 'Explore the essay collection and the free Gaussian process explorer. The academy remains in development.') };
  if (page.path === 'privacy') return { ...page, body: page.body.replace('Last updated 9 November 2026', 'Last updated 14 November 2026').replace('<h2 id="privacy-current">', '<h2>Writing desk and published media</h2><p>Google handles invited authors’ sign-in, drafts and uploads in Blogger. The website imports published text, public bylines and approved media.</p><p>Keep uploads to material intended for public release. People with an upload’s URL may be able to view it before you publish the post. Store private lessons and student information in protected storage.</p><p>The website serves imported images with embedded metadata removed. If you choose to load a video, Blogger or YouTube receives the site’s domain and connection information and may use cookies.</p><h2 id="privacy-current">') };
  return page;
});
const all = [home, ...basePages, ...publishingPages(articles, config)];
for (const page of all) {
  const dir = path.join(output, page.path);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'index.html'), render(page));
}
await writeFile(path.join(output, '404.html'), render(error));
await writeFile(path.join(output, 'robots.txt'), `User-agent: *\nAllow: /\nSitemap: ${origin}/sitemap.xml\n`);
await writeFile(path.join(output, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${[...all.filter(p => !p.noindex).map(p => `${origin}/${p.path ? p.path + '/' : ''}`), `${origin}/tools/gaussian-process/`].map(url => `<url><loc>${url}</loc></url>`).join('')}</urlset>\n`);
const feedItems = articles.map(article => `<item><title>${escape(article.title)}</title><link>${origin}/essays/${escape(article.slug)}/</link><guid isPermaLink="true">${origin}/essays/${escape(article.slug)}/</guid><pubDate>${new Date(article.published).toUTCString()}</pubDate><description>${escape(article.summary)}</description></item>`).join('');
await writeFile(path.join(output, 'feed.xml'), `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>Carl Friedrich Gauss — Essays</title><link>${origin}/essays/</link><description>Independent essays and invited perspectives.</description><language>en</language>${feedItems}</channel></rss>\n`);
const revision = createHash('sha256').update(JSON.stringify(articles)).digest('hex');
await writeFile(path.join(output, 'publication.json'), JSON.stringify({ revision, articleCount: articles.length, sourceRevision: process.env.GITHUB_SHA || 'local', builtAt: new Date().toISOString() }) + '\n');
console.log(`Built ${all.length} pages, 404, sitemap and RSS; ${articles.length} published articles.`);
