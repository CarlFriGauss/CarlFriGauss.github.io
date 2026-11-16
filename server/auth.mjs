import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { getCookie, setCookie } from 'hono/cookie';

export class RequestError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const databaseOptions = { timeout: 20000, retry: false };
const serviceFetch = (input, options = {}) => fetch(input, { ...options, signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000) });
export function databaseResult(result) {
  if (!result.error) return result.data;
  const status = { '42501': 403, 'PT409': 409, 'PT413': 413, '23514': 400 }[result.error.code] || 503;
  if (status === 503) console.error('Database operation unavailable', { code: result.error.code || 'network', status: result.status || 0 });
  const message = status === 503 ? 'The database is temporarily unavailable. Please retry.' : result.error.message;
  throw new RequestError(status, message);
}
export function authClient(context) {
  if (context.get('supabase')) return context.get('supabase');
  if (!context.env.SUPABASE_URL || !context.env.SUPABASE_PUBLISHABLE_KEY) throw new RequestError(503, 'Account service setup is in progress.');
  const client = createServerClient(context.env.SUPABASE_URL, context.env.SUPABASE_PUBLISHABLE_KEY, {
    db: databaseOptions,
    global: { fetch: serviceFetch },
    cookieOptions: { httpOnly: true, secure: new URL(context.req.url).protocol === 'https:', sameSite: 'Lax', path: '/' },
    cookies: {
      getAll: () => Object.entries(getCookie(context)).map(([name, value]) => ({ name, value })),
      setAll: cookies => cookies.forEach(({ name, value, options }) => setCookie(context, name, value, options))
    }
  });
  context.set('supabase', client);
  return client;
}
export function adminClient(env) {
  if (!env.SUPABASE_SERVICE_KEY) throw new RequestError(503, 'Publishing service setup is in progress.');
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY, { db: databaseOptions, global: { fetch: serviceFetch }, auth: { persistSession: false, autoRefreshToken: false } });
}
export async function identify(context, requireContributor = true) {
  const client = context.get('supabase') || authClient(context);
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) throw new RequestError(401, 'Please sign in.');
  const member = databaseResult(await client.from('members').select('*').eq('id', data.user.id).maybeSingle());
  if (!member?.active) throw new RequestError(403, 'Contributor access is required.');
  const assurance = await client.auth.mfa.getAuthenticatorAssuranceLevel();
  const verified = assurance.data?.currentLevel === 'aal2';
  if (requireContributor && member.role === 'owner' && !verified) throw new RequestError(403, 'Complete two-step verification to continue.');
  return { client, user: data.user, member, verified };
}
export async function requireOwner(context) {
  const identity = await identify(context);
  if (identity.member.role !== 'owner' || !identity.verified) throw new RequestError(403, 'Owner verification required.');
  return identity;
}
export async function readJson(context, maximum = 600000) {
  const bytes = await context.req.arrayBuffer();
  if (bytes.byteLength > maximum) throw new RequestError(413, 'This request is too large.');
  try { return JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw new RequestError(400, 'Invalid request.'); }
}

export async function sendAccountEmail(env, email, tokenHash, type) {
  if (!env.RESEND_API_KEY || !env.MAIL_FROM) throw new RequestError(503, 'Email delivery setup is in progress.');
  const url = `${env.SITE_ORIGIN}/write/#token_hash=${encodeURIComponent(tokenHash)}&type=${type}`;
  const response = await serviceFetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: env.MAIL_FROM, to: [email], subject: type === 'invite' ? 'Your invitation to write' : 'Reset your password',
      text: `Carl Friedrich Gauss\n\n${type === 'invite' ? 'You have been invited to contribute to carlfriedrichgauss.com.' : 'Use the link below to reset your website password.'}\n\n${url}\n\nThis link can be used once. If you did not request it, you can ignore this email.` })
  });
  if (!response.ok) throw new RequestError(503, 'The email could not be sent. Please retry.');
}
