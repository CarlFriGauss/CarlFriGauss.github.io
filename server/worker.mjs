import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { adminClient, authClient, databaseResult, identify, requireOwner, readJson, RequestError, sendAccountEmail } from './auth.mjs';
import { renderDocument, escapeHtml, UUID, articlePath, publicPage } from './content.mjs';
import { mediaRoutes, mediaKey, PART_SIZE } from './media.mjs';

const app = new Hono();
const policy = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; media-src 'self' blob:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'";
app.use('*', async (context, next) => {
  context.header('Content-Security-Policy', policy);
  context.header('X-Content-Type-Options', 'nosniff');
  context.header('Referrer-Policy', 'no-referrer');
  context.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (context.req.path.startsWith('/api/') || context.req.path.startsWith('/write/')) {
    context.header('Cache-Control', 'no-store');
    context.header('X-Robots-Tag', 'noindex, nofollow');
  }
  if (!['GET', 'HEAD', 'OPTIONS'].includes(context.req.method)) {
    if (context.req.header('origin') !== new URL(context.req.url).origin) throw new RequestError(403, 'This request must come from the website.');
  }
  await next();
  // Asset-service and streamed Responses do not inherit Hono's prepared headers.
  context.res = new Response(context.res.body, context.res);
  if (!context.res.headers.has('Content-Security-Policy')) context.header('Content-Security-Policy', policy);
  context.header('X-Content-Type-Options', 'nosniff');
  context.header('Referrer-Policy', 'no-referrer');
  context.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (context.req.path.startsWith('/api/') || context.req.path.startsWith('/write/')) {
    context.header('Cache-Control', 'no-store');
    context.header('X-Robots-Tag', 'noindex, nofollow');
  }
  if (context.env.PREVIEW_MODE === 'true') context.header('X-Robots-Tag', 'noindex, nofollow');
});
app.use('/api/*', bodyLimit({ maxSize: PART_SIZE + 1024, onError: context => context.json({ error: 'Request too large.' }, 413) }));
app.onError((error, context) => context.json({ error: error instanceof RequestError ? error.message : 'The operation could not finish. Keep this page open and retry.' }, error instanceof RequestError ? error.status : 503));

async function articleFor(context) {
  const identity = await identify(context);
  if (!UUID.test(context.req.param('id'))) throw new RequestError(404, 'Article unavailable.');
  const article = databaseResult(await identity.client.from('articles').select('*').eq('id', context.req.param('id')).maybeSingle());
  if (!article) throw new RequestError(404, 'Article unavailable.');
  const media = databaseResult(await identity.client.from('media').select('*').eq('article_id', article.id).neq('state', 'cancelled'));
  return { ...identity, article, media };
}

async function limitAuth(context, action, maximum) {
  const ip = context.req.header('cf-connecting-ip') || 'local';
  const bytes = new TextEncoder().encode(`${action}:${ip}`);
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
  if (!databaseResult(await adminClient(context.env).rpc('consume_auth_attempt', { bucket: digest, maximum }))) throw new RequestError(429, 'Too many attempts. Please try again later.');
}

app.get('/api/session', async context => {
  try {
    const { member, verified, client } = await identify(context, false);
    const factors = await client.auth.mfa.listFactors();
    return context.json({ member, verified, factors: (factors.data?.totp || []).map(factor => ({ id: factor.id, status: factor.status })) });
  } catch (error) {
    if (error.status === 401) return context.json({ member: null });
    throw error;
  }
});
app.post('/api/login', async context => {
  await limitAuth(context, 'login', 30);
  const { email, password } = await readJson(context, 3000);
  const client = authClient(context);
  const result = await client.auth.signInWithPassword({ email, password });
  if (result.error) throw new RequestError(401, 'The email or password was not accepted.');
  context.set('supabase', client);
  await identify(context, false);
  return context.json({ signedIn: true });
});
app.post('/api/logout', async context => {
  const { error } = await authClient(context).auth.signOut();
  if (error) throw new RequestError(503, 'Sign out could not finish. Please retry.');
  return context.json({ signedOut: true });
});
app.post('/api/accept', async context => {
  await limitAuth(context, 'accept', 20);
  const { token_hash, type } = await readJson(context, 3000);
  if (!['invite', 'recovery'].includes(type) || typeof token_hash !== 'string') throw new RequestError(400, 'Invalid account link.');
  const { error } = await authClient(context).auth.verifyOtp({ token_hash, type });
  if (error) throw new RequestError(401, 'This account link has expired or has already been used.');
  return context.json({ accepted: true });
});
app.post('/api/password', async context => {
  const { client } = await identify(context);
  const { password } = await readJson(context, 3000);
  if (typeof password !== 'string' || password.length < 14 || password.length > 128) throw new RequestError(400, 'Use a password of 14–128 characters.');
  const { error } = await client.auth.updateUser({ password });
  if (error) throw new RequestError(400, 'The password could not be updated. Please retry.');
  return context.json({ updated: true });
});
app.post('/api/recover', async context => {
  await limitAuth(context, 'recovery', 5);
  const { email } = await readJson(context, 2000);
  if (typeof email !== 'string' || email.length > 254) throw new RequestError(400, 'Enter your email address.');
  const admin = adminClient(context.env);
  const link = await admin.auth.admin.generateLink({ type: 'recovery', email });
  if (link.data?.user) {
    const member = databaseResult(await admin.from('members').select('active').eq('id', link.data.user.id).maybeSingle());
    if (member?.active) await sendAccountEmail(context.env, email, link.data.properties.hashed_token, 'recovery');
  }
  return context.json({ sent: true });
});
app.post('/api/mfa/enroll', async context => {
  const { client, member, verified } = await identify(context, false);
  if (member.role !== 'owner') throw new RequestError(403, 'Owner access required.');
  const factors = await client.auth.mfa.listFactors();
  if (factors.error) throw new RequestError(503, 'Authenticator setup could not start.');
  if (!verified && factors.data.all.some(factor => factor.status === 'verified')) throw new RequestError(403, 'Verify your existing authenticator first.');
  for (const factor of factors.data?.all || []) {
    if (factor.status === 'unverified') await client.auth.mfa.unenroll({ factorId: factor.id });
  }
  const result = await client.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Writing desk' });
  if (result.error) throw new RequestError(400, 'Authenticator setup could not start.');
  return context.json({ id: result.data.id, secret: result.data.totp.secret, uri: result.data.totp.uri });
});
app.post('/api/mfa/verify', async context => {
  const { client } = await identify(context, false);
  const { factorId, code } = await readJson(context, 1000);
  const result = await client.auth.mfa.challengeAndVerify({ factorId, code });
  if (result.error) throw new RequestError(400, 'The verification code was not accepted.');
  return context.json({ verified: true });
});

app.get('/api/articles', async context => {
  const { client } = await identify(context);
  const articles = databaseResult(await client.from('articles').select('id,author_id,title,summary,revision,submitted,publication_version,synced_version,published_at,updated_at').order('updated_at', { ascending: false }).limit(300));
  return context.json({ articles });
});
app.get('/api/articles/:id', async context => {
  const { article, media } = await articleFor(context);
  return context.json({ article, media: media.map(item => ({ ...item, upload_id: undefined })) });
});
app.post('/api/articles', async context => {
  const { client } = await identify(context);
  const article = databaseResult(await client.rpc('save_article', { article: null, expected_revision: 0, new_title: '', new_summary: '', new_document: { type: 'doc', content: [{ type: 'paragraph' }] } }));
  return context.json({ article }, 201);
});
app.put('/api/articles/:id', async context => {
  const { client, article, media } = await articleFor(context);
  const input = await readJson(context);
  if (typeof input.title !== 'string' || typeof input.summary !== 'string' || !Number.isInteger(input.revision)) throw new RequestError(400, 'Invalid draft.');
  try { renderDocument(input.document, article.id, media); } catch (error) { throw new RequestError(400, error.message); }
  const saved = databaseResult(await client.rpc('save_article', { article: article.id, expected_revision: input.revision, new_title: input.title, new_summary: input.summary, new_document: input.document }));
  return context.json({ article: saved });
});
app.post('/api/articles/:id/submit', async context => {
  const { client, article } = await articleFor(context);
  const { revision } = await readJson(context, 1000);
  if (!article.title.trim()) throw new RequestError(400, 'Add a title before submitting.');
  databaseResult(await client.rpc('submit_article', { article: article.id, expected_revision: revision }));
  return context.json({ submitted: true });
});

export async function syncPublication(env, article, admin = adminClient(env)) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const key = `published/${article.id}.json`;
    const existing = await env.MEDIA.head(key);
    const storedVersion = Number(existing?.customMetadata?.version || 0);
    if (storedVersion >= article.publication_version) {
      if (storedVersion) databaseResult(await admin.from('articles').update({ synced_version: storedVersion }).eq('id', article.id).gte('publication_version', storedVersion).lt('synced_version', storedVersion));
      return;
    }
    const snapshot = { id: article.id, version: article.publication_version, live: Boolean(article.publication), publishedAt: article.published_at, ...article.publication };
    const metadata = { version: String(snapshot.version), live: String(snapshot.live), title: snapshot.title || '', summary: (snapshot.summary || '').slice(0,120), byline: snapshot.byline || '', date: snapshot.publishedAt || '' };
    const saved = await env.MEDIA.put(key, JSON.stringify(snapshot), { onlyIf: existing ? { etagMatches: existing.etag } : { etagDoesNotMatch: '*' }, customMetadata: metadata, httpMetadata: { contentType: 'application/json' } });
    if (saved) {
      databaseResult(await admin.from('articles').update({ synced_version: snapshot.version }).eq('id', article.id).lt('synced_version', snapshot.version));
      return;
    }
    article = databaseResult(await admin.from('articles').select('*').eq('id', article.id).single());
  }
  throw new RequestError(409, 'Another publication update is finishing. Please retry.');
}
app.post('/api/articles/:id/publish', async context => {
  await requireOwner(context);
  const { client, article, media } = await articleFor(context);
  const { revision, withdraw } = await readJson(context, 1000);
  let snapshot = null;
  if (!withdraw) {
    if (!article.title.trim()) throw new RequestError(400, 'Add an article title.');
    const byline = databaseResult(await client.from('members').select('byline').eq('id', article.author_id).single()).byline;
    let rendered;
    try { rendered = renderDocument(article.document, article.id, media); } catch (error) { throw new RequestError(400, error.message); }
    snapshot = { title: article.title, summary: article.summary, document: article.document, byline, mediaIds: rendered.mediaIds };
  }
  const saved = databaseResult(await client.rpc('publish_article', { article: article.id, expected_revision: revision, snapshot }));
  await syncPublication(context.env, saved);
  return context.json({ published: !withdraw, path: articlePath(saved) });
});
app.post('/api/articles/:id/sync', async context => {
  await requireOwner(context);
  const { article } = await articleFor(context);
  await syncPublication(context.env, article);
  return context.json({ synced: true });
});

app.get('/api/contributors', async context => {
  const { client } = await requireOwner(context);
  return context.json({ members: databaseResult(await client.from('members').select('*').order('created_at')) });
});
app.post('/api/contributors', async context => {
  await requireOwner(context);
  const { email, byline } = await readJson(context, 2000);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || typeof byline !== 'string' || !byline.trim() || byline.length > 100) throw new RequestError(400, 'Enter a valid email and public byline.');
  const admin = adminClient(context.env);
  const result = await admin.auth.admin.generateLink({ type: 'invite', email });
  if (result.error) throw new RequestError(400, 'An invitation could not be created. If this contributor is already listed, use Send account link beside their name.');
  databaseResult(await admin.from('members').upsert({ id: result.data.user.id, byline: byline.trim(), role: 'contributor', active: true }, { onConflict: 'id', ignoreDuplicates: true }));
  await sendAccountEmail(context.env, email, result.data.properties.hashed_token, 'invite');
  return context.json({ invited: true });
});
app.post('/api/contributors/:id/invite', async context => {
  await requireOwner(context);
  const admin = adminClient(context.env);
  const member = databaseResult(await admin.from('members').select('id,role,active').eq('id', context.req.param('id')).maybeSingle());
  if (!member?.active || member.role !== 'contributor') throw new RequestError(400, 'Choose an active contributor.');
  const user = await admin.auth.admin.getUserById(member.id);
  if (user.error || !user.data.user?.email) throw new RequestError(503, 'The account could not be loaded.');
  const link = await admin.auth.admin.generateLink({ type: 'recovery', email: user.data.user.email });
  if (link.error) throw new RequestError(503, 'The account link could not be created.');
  await sendAccountEmail(context.env, user.data.user.email, link.data.properties.hashed_token, 'recovery');
  return context.json({ sent: true });
});
app.patch('/api/contributors/:id', async context => {
  const { member } = await requireOwner(context);
  const { active } = await readJson(context, 1000);
  if (context.req.param('id') === member.id || typeof active !== 'boolean') throw new RequestError(400, 'Choose a contributor account.');
  databaseResult(await adminClient(context.env).from('members').update({ active }).eq('id', context.req.param('id')).eq('role', 'contributor'));
  return context.json({ updated: true });
});
mediaRoutes(app);

async function snapshotFor(env, id) {
  const object = await env.MEDIA.get(`published/${id}.json`);
  if (!object) return null;
  return object.json();
}

export function byteRange(value, size) {
  if (!value) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!match || (!match[1] && !match[2])) throw new RequestError(416, 'Invalid byte range.');
  let start, end;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix < 1) throw new RequestError(416, 'Invalid byte range.');
    start = Math.max(0, size - suffix); end = size - 1;
  } else {
    start = Number(match[1]); end = match[2] ? Number(match[2]) : size - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= size || end < start) throw new RequestError(416, 'Invalid byte range.');
    end = Math.min(end, size - 1);
  }
  return { offset: start, length: end - start + 1 };
}
app.get('/essays/', async context => {
  if (!context.env.MEDIA) return context.env.ASSETS.fetch(context.req.raw);
  const listed = await context.env.MEDIA.list({ prefix: 'published/', include: ['customMetadata'], limit: 1000 });
  const articles = listed.objects.filter(object => object.customMetadata?.live === 'true').map(object => ({ id: object.key.slice(10, -5), ...object.customMetadata })).sort((a,b) => b.date.localeCompare(a.date));
  if (!articles.length) return context.env.ASSETS.fetch(context.req.raw);
  const cards = articles.map(article => `<article class="essay-entry"><p class="eyebrow">${escapeHtml(article.byline)}</p><h2><a href="${articlePath(article)}">${escapeHtml(article.title)}</a></h2><p>${escapeHtml(article.summary)}</p><time datetime="${escapeHtml(article.date)}">${escapeHtml(new Date(article.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }))}</time></article>`).join('');
  context.header('Cache-Control', 'no-cache');
  return context.html(publicPage('Essays', `<section class="container page-hero"><p class="eyebrow">Writing & inquiry</p><h1>Give an idea the room it deserves.</h1></section><section class="container essay-list">${cards}</section>`));
});
app.get('/essays/:slug/', async context => {
  const id = context.req.param('slug').slice(-36);
  const snapshot = UUID.test(id) ? await snapshotFor(context.env, id) : null;
  if (!snapshot?.live) return context.notFound();
  const canonicalPath = articlePath(snapshot);
  if (new URL(context.req.url).pathname !== canonicalPath) return context.redirect(canonicalPath, 301);
  const media = snapshot.mediaIds.map(mediaId => ({ id: mediaId, state: 'ready', article_id: id }));
  function findKinds(node) { if (node.type === 'media') { const item = media.find(item => item.id === node.attrs.id); if (item) item.kind = node.attrs.kind; } (node.content || []).forEach(findKinds); }
  findKinds(snapshot.document);
  const { html } = renderDocument(snapshot.document, id, media);
  context.header('Cache-Control', 'no-cache');
  return context.html(publicPage(snapshot.title, `<article class="reading-page"><header><p class="eyebrow">${escapeHtml(snapshot.byline)}</p><h1>${escapeHtml(snapshot.title)}</h1><p class="lede">${escapeHtml(snapshot.summary)}</p></header><div class="prose article-body">${html}</div></article>`, snapshot.summary));
});
app.on(['GET', 'HEAD'], '/media/:article/:id', async context => {
  const articleId = context.req.param('article');
  const id = context.req.param('id');
  if (!UUID.test(articleId) || !UUID.test(id)) return context.notFound();
  const publication = await snapshotFor(context.env, articleId);
  if (!publication?.live || !publication.mediaIds.includes(id)) {
    const { client } = await identify(context);
    const media = databaseResult(await client.from('media').select('id').eq('id', id).eq('article_id', articleId).eq('state', 'ready').maybeSingle());
    if (!media) return context.notFound();
  }
  const key = mediaKey({ id, article_id: articleId });
  const metadata = await context.env.MEDIA.head(key);
  if (!metadata) return context.notFound();
  let range = null;
  if (context.req.method !== 'HEAD' && (!context.req.header('if-range') || context.req.header('if-range') === metadata.httpEtag)) {
    try { range = byteRange(context.req.header('range'), metadata.size); }
    catch { return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${metadata.size}`, 'Cache-Control': 'no-store' } }); }
  }
  const object = context.req.method === 'HEAD' ? metadata : await context.env.MEDIA.get(key, range ? { range } : {});
  if (!object) return context.notFound();
  const headers = new Headers({ 'Cache-Control': 'private, no-store', 'Accept-Ranges': 'bytes', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox" });
  object.writeHttpMetadata(headers);
  headers.set('ETag', object.httpEtag);
  if (object.httpMetadata?.contentType === 'application/pdf') headers.set('Content-Disposition', 'attachment; filename="document.pdf"');
  if (object.range) {
    const start = object.range.offset || 0;
    headers.set('Content-Range', `bytes ${start}-${start + object.range.length - 1}/${object.size}`);
    headers.set('Content-Length', String(object.range.length));
  } else headers.set('Content-Length', String(object.size));
  return new Response(context.req.method === 'HEAD' ? null : object.body, { status: object.range ? 206 : 200, headers });
});
app.get('/write', context => context.redirect('/write/'));
app.get('/write/*', context => context.env.ASSETS.fetch(new Request(new URL('/write/', context.req.url), context.req.raw)));
app.all('/api/*', context => context.json({ error: 'Unknown request.' }, 404));
app.all('*', context => context.env.ASSETS.fetch(context.req.raw));
export default app;
