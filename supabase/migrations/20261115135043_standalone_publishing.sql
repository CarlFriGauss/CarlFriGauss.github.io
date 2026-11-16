create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated, service_role;

-- Application data is private. Public articles are explicit publication snapshots.
create table public.members (
  id uuid primary key references auth.users(id),
  byline text not null check (length(byline) between 1 and 100),
  role text not null default 'contributor' check (role in ('owner', 'contributor')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.articles (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.members(id),
  title text not null default '' check (length(title) <= 180),
  summary text not null default '' check (length(summary) <= 500),
  document jsonb not null default '{"type":"doc","content":[{"type":"paragraph"}]}',
  revision integer not null default 0,
  submitted boolean not null default false,
  publication jsonb,
  publication_version integer not null default 0,
  synced_version integer not null default 0,
  published_at timestamptz,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  check (octet_length(document::text) <= 500000)
);
create index articles_author_id_idx on public.articles(author_id);

create table public.media (
  id uuid primary key default gen_random_uuid(),
  article_id uuid not null references public.articles(id) on delete cascade,
  owner_id uuid not null references public.members(id),
  kind text not null check (kind in ('image/webp', 'video/mp4', 'video/webm', 'application/pdf')),
  size bigint not null check (size between 1 and 1073741824),
  fingerprint text not null check (length(fingerprint) <= 100),
  upload_id text,
  parts jsonb not null default '{}',
  state text not null default 'uploading' check (state in ('uploading', 'ready', 'cancelled')),
  created_at timestamptz not null default now()
);
create index media_article_id_idx on public.media(article_id);
create index media_owner_id_idx on public.media(owner_id);

alter table public.members enable row level security;
alter table public.articles enable row level security;
alter table public.media enable row level security;

create function private.is_owner() returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.members where id = auth.uid() and active and role = 'owner')
    and (auth.jwt()->>'aal') = 'aal2';
$$;
create function private.is_contributor() returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.members where id = auth.uid() and active
    and (role = 'contributor' or (auth.jwt()->>'aal') = 'aal2'));
$$;
create function private.can_edit(article uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_contributor() and exists (
    select 1 from public.articles where id = article and (author_id = auth.uid() or private.is_owner())
  );
$$;

create policy members_read on public.members for select to authenticated using (id = auth.uid() or private.is_owner());
create policy articles_read on public.articles for select to authenticated using (private.can_edit(id));
create policy media_read on public.media for select to authenticated using (private.can_edit(article_id));
revoke all on public.members, public.articles, public.media from anon, authenticated;
grant select on public.members, public.articles, public.media to authenticated;

create function private.save_article(article uuid, expected_revision integer, new_title text, new_summary text, new_document jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare saved public.articles;
begin
  if not private.is_contributor() then raise exception 'Contributor access required' using errcode = '42501'; end if;
  if article is null then
    insert into public.articles(author_id, title, summary, document, revision)
      values(auth.uid(), new_title, new_summary, new_document, 1) returning * into saved;
  else
    if not private.can_edit(article) then raise exception 'Article unavailable' using errcode = '42501'; end if;
    update public.articles set title = new_title, summary = new_summary, document = new_document,
      revision = revision + 1, submitted = false, updated_at = now()
      where id = article and revision = expected_revision returning * into saved;
    if saved.id is null then raise exception 'Draft has changed in another session' using errcode = '40001'; end if;
  end if;
  return to_jsonb(saved);
end;
$$;

create function private.submit_article(article uuid, expected_revision integer) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.can_edit(article) then raise exception 'Article unavailable' using errcode = '42501'; end if;
  update public.articles set submitted = true where id = article and revision = expected_revision;
  if not found then raise exception 'Draft has changed' using errcode = '40001'; end if;
end;
$$;

create function private.publish_article(article uuid, expected_revision integer, snapshot jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare saved public.articles;
begin
  if not private.is_owner() then raise exception 'Owner verification required' using errcode = '42501'; end if;
  update public.articles set publication = snapshot, publication_version = publication_version + 1,
    submitted = false, published_at = case when snapshot is null then null else coalesce(published_at, now()) end
    where id = article and revision = expected_revision returning * into saved;
  if saved.id is null then raise exception 'Draft has changed' using errcode = '40001'; end if;
  return to_jsonb(saved);
end;
$$;

create function private.reserve_media(article uuid, file_kind text, file_size bigint, file_fingerprint text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare reserved public.media;
begin
  if not private.can_edit(article) then raise exception 'Article unavailable' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(817045);
  if (select coalesce(sum(size), 0) from public.media where state <> 'cancelled') + file_size > 100000000000 then
    raise exception 'Media storage limit reached' using errcode = '54000';
  end if;
  if (select count(*) from public.media where owner_id = auth.uid() and created_at > now() - interval '1 day') >= 100 then
    raise exception 'Daily upload limit reached' using errcode = '54000';
  end if;
  insert into public.media(article_id, owner_id, kind, size, fingerprint)
    values(article, auth.uid(), file_kind, file_size, file_fingerprint) returning * into reserved;
  return to_jsonb(reserved);
end;
$$;

-- Only the server can mark a verified R2 upload as complete or record a published snapshot.
create function private.record_upload_part(media_id uuid, part_number integer, part_etag text) returns void
language sql security definer set search_path = '' as $$
  update public.media set parts = jsonb_set(parts, array[part_number::text], to_jsonb(part_etag))
    where id = media_id and state = 'uploading';
$$;
revoke all on function private.record_upload_part(uuid, integer, text) from public, anon, authenticated;
grant execute on function private.record_upload_part(uuid, integer, text) to service_role;

revoke all on function private.is_owner(), private.is_contributor(), private.can_edit(uuid),
  private.save_article(uuid, integer, text, text, jsonb), private.submit_article(uuid, integer),
  private.publish_article(uuid, integer, jsonb), private.reserve_media(uuid, text, bigint, text) from public, anon;
grant execute on function private.is_owner(), private.is_contributor(), private.can_edit(uuid),
  private.save_article(uuid, integer, text, text, jsonb), private.submit_article(uuid, integer),
  private.publish_article(uuid, integer, jsonb), private.reserve_media(uuid, text, bigint, text) to authenticated;

create table public.auth_limits (
  key text primary key,
  window_start timestamptz not null default now(),
  attempts integer not null default 0
);
alter table public.auth_limits enable row level security;
revoke all on public.auth_limits from anon, authenticated;
create function private.consume_auth_attempt(bucket text, maximum integer) returns boolean
language plpgsql security definer set search_path = '' as $$
declare used integer;
begin
  insert into public.auth_limits(key, attempts) values(bucket, 1)
    on conflict(key) do update set
      attempts = case when auth_limits.window_start < now() - interval '1 hour' then 1 else auth_limits.attempts + 1 end,
      window_start = case when auth_limits.window_start < now() - interval '1 hour' then now() else auth_limits.window_start end
    returning attempts into used;
  delete from public.auth_limits where window_start < now() - interval '2 days';
  return used <= least(maximum, 30);
end;
$$;
revoke all on function private.consume_auth_attempt(text, integer) from public, anon, authenticated;
grant execute on function private.consume_auth_attempt(text, integer) to service_role;
grant all on public.members, public.articles, public.media, public.auth_limits to service_role;

-- Public RPC wrappers have no elevated privileges; private implementations enforce access.
create function public.save_article(article uuid, expected_revision integer, new_title text, new_summary text, new_document jsonb) returns jsonb
language sql security invoker set search_path = '' as $$ select private.save_article(article, expected_revision, new_title, new_summary, new_document); $$;
revoke all on function public.save_article(uuid, integer, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.save_article(uuid, integer, text, text, jsonb) to authenticated;

create function public.submit_article(article uuid, expected_revision integer) returns void
language sql security invoker set search_path = '' as $$ select private.submit_article(article, expected_revision); $$;
revoke all on function public.submit_article(uuid, integer) from public, anon, authenticated;
grant execute on function public.submit_article(uuid, integer) to authenticated;

create function public.publish_article(article uuid, expected_revision integer, snapshot jsonb) returns jsonb
language sql security invoker set search_path = '' as $$ select private.publish_article(article, expected_revision, snapshot); $$;
revoke all on function public.publish_article(uuid, integer, jsonb) from public, anon, authenticated;
grant execute on function public.publish_article(uuid, integer, jsonb) to authenticated;

create function public.reserve_media(article uuid, file_kind text, file_size bigint, file_fingerprint text) returns jsonb
language sql security invoker set search_path = '' as $$ select private.reserve_media(article, file_kind, file_size, file_fingerprint); $$;
revoke all on function public.reserve_media(uuid, text, bigint, text) from public, anon, authenticated;
grant execute on function public.reserve_media(uuid, text, bigint, text) to authenticated;

create function public.record_upload_part(media_id uuid, part_number integer, part_etag text) returns void
language sql security invoker set search_path = '' as $$ select private.record_upload_part(media_id, part_number, part_etag); $$;
revoke all on function public.record_upload_part(uuid, integer, text) from public, anon, authenticated;
grant execute on function public.record_upload_part(uuid, integer, text) to service_role;

create function public.consume_auth_attempt(bucket text, maximum integer) returns boolean
language sql security invoker set search_path = '' as $$ select private.consume_auth_attempt(bucket, maximum); $$;
revoke all on function public.consume_auth_attempt(text, integer) from public, anon, authenticated;
grant execute on function public.consume_auth_attempt(text, integer) to service_role;

-- Keep the dashboard's automatic-RLS event trigger away from the public RPC roles.
do $$ begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    execute 'revoke all on function public.rls_auto_enable() from public, anon, authenticated';
  end if;
end $$;
