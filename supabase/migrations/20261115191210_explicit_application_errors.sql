-- Application conflicts and quotas must not be reported as infrastructure failures.
create or replace function private.save_article(article uuid, expected_revision integer, new_title text, new_summary text, new_document jsonb)
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
    if saved.id is null then raise exception 'Draft has changed in another session' using errcode = 'PT409'; end if;
  end if;
  return to_jsonb(saved);
end;
$$;

create or replace function private.submit_article(article uuid, expected_revision integer) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.can_edit(article) then raise exception 'Article unavailable' using errcode = '42501'; end if;
  update public.articles set submitted = true where id = article and revision = expected_revision;
  if not found then raise exception 'Draft has changed' using errcode = 'PT409'; end if;
end;
$$;

create or replace function private.publish_article(article uuid, expected_revision integer, snapshot jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare saved public.articles;
begin
  if not private.is_owner() then raise exception 'Owner verification required' using errcode = '42501'; end if;
  update public.articles set publication = snapshot, publication_version = publication_version + 1,
    submitted = false, published_at = case when snapshot is null then null else coalesce(published_at, now()) end
    where id = article and revision = expected_revision returning * into saved;
  if saved.id is null then raise exception 'Draft has changed' using errcode = 'PT409'; end if;
  return to_jsonb(saved);
end;
$$;

create or replace function private.reserve_media(article uuid, file_kind text, file_size bigint, file_fingerprint text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare reserved public.media;
begin
  if not private.can_edit(article) then raise exception 'Article unavailable' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(817045);
  if (select coalesce(sum(size), 0) from public.media where state <> 'cancelled') + file_size > 100000000000 then
    raise exception 'Media storage limit reached' using errcode = 'PT413';
  end if;
  if (select count(*) from public.media where owner_id = auth.uid() and created_at > now() - interval '1 day') >= 100 then
    raise exception 'Daily upload limit reached' using errcode = 'PT413';
  end if;
  insert into public.media(article_id, owner_id, kind, size, fingerprint)
    values(article, auth.uid(), file_kind, file_size, file_fingerprint) returning * into reserved;
  return to_jsonb(reserved);
end;
$$;
