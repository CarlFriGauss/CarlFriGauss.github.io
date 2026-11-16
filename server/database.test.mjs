import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('database enforces draft ownership, optimistic saves, review permissions, MFA and revocation', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$ select (current_setting('request.jwt.claims', true)::jsonb->>'sub')::uuid $$;
      create function auth.jwt() returns jsonb language sql stable as $$ select current_setting('request.jwt.claims', true)::jsonb $$;
      grant usage on schema auth to authenticated; grant execute on all functions in schema auth to authenticated;`);
    const migrations = new URL('../supabase/migrations/', import.meta.url);
    for (const name of (await readdir(migrations)).filter(name => name.endsWith('.sql')).sort()) {
      await db.exec(await readFile(new URL(name, migrations), 'utf8'));
    }
    const owner = '00000000-0000-4000-8000-000000000001';
    const first = '00000000-0000-4000-8000-000000000002';
    const second = '00000000-0000-4000-8000-000000000003';
    await db.query('insert into auth.users(id) values ($1),($2),($3)', [owner, first, second]);
    await db.query("insert into members(id,byline,role) values ($1,'Carl Friedrich Gauss','owner'),($2,'First contributor','contributor'),($3,'Second contributor','contributor')", [owner, first, second]);
    async function as(id, assurance = 'aal1') {
      await db.exec('reset role');
      await db.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify({ sub: id, aal: assurance })]);
      await db.exec('set role authenticated');
    }
    const doc = JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Private draft.' }] }] });
    await as(first);
    const created = (await db.query('select save_article(null,0,$1,$2,$3) as article', ['Draft', '', doc])).rows[0].article;
    assert.equal(created.author_id, first);
    const id = created.id;
    await assert.rejects(db.query("update members set role='owner' where id=$1", [first]), /permission denied/);
    await as(second);
    assert.equal((await db.query('select id from articles where id=$1', [id])).rows.length, 0);
    await assert.rejects(db.query('select save_article($1,1,$2,$3,$4)', [id, 'Stolen', '', doc]), /unavailable/);
    await assert.rejects(db.query('select publish_article($1,1,$2)', [id, '{}']), /Owner verification/);
    await as(first);
    await db.query('select save_article($1,1,$2,$3,$4)', [id, 'Updated', '', doc]);
    await assert.rejects(db.query('select save_article($1,1,$2,$3,$4)', [id, 'Stale overwrite', '', doc]), /another session/);
    await db.query('select submit_article($1,2)', [id]);
    assert.equal((await db.query('select submitted from articles where id=$1', [id])).rows[0].submitted, true);
    await as(owner);
    assert.equal((await db.query('select id from articles')).rows.length, 0);
    await assert.rejects(db.query('select publish_article($1,2,$2)', [id, '{}']), /Owner verification/);
    await as(owner, 'aal2');
    await db.query('select publish_article($1,2,$2)', [id, '{"title":"Public revision"}']);
    assert.equal((await db.query('select publication_version from articles where id=$1', [id])).rows[0].publication_version, 1);
    await as(first);
    await db.query('select save_article($1,2,$2,$3,$4)', [id, 'Private next revision', '', doc]);
    const edited = (await db.query('select title,publication from articles where id=$1', [id])).rows[0];
    assert.equal(edited.publication.title, 'Public revision');
    await db.exec('reset role');
    await db.query('update members set active=false where id=$1', [first]);
    await as(first);
    assert.equal((await db.query('select id from articles')).rows.length, 0);
    await assert.rejects(db.query('select save_article($1,3,$2,$3,$4)', [id, 'Revoked', '', doc]), /Contributor access/);
    await db.exec('reset role; set role anon');
    await assert.rejects(db.query('select * from articles'), /permission denied/);
  } finally { await db.close(); }
});
