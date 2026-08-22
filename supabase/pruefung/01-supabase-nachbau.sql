-- Nachbau der Teile von Supabase, die die beiden SQL-Dateien voraussetzen.
-- Nur so viel, wie zum Prüfen der Regeln nötig ist.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
end;
$$;

grant usage on schema public to anon, authenticated;

create schema if not exists auth;
create schema if not exists storage;

create table auth.users (
  id    uuid primary key default gen_random_uuid(),
  email text unique
);

-- Supabase liest die angemeldete Benutzer-ID aus dem JWT. Für den Test wird
-- sie über eine Sitzungsvariable gesetzt.
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('test.user_id', true), '')::uuid;
$$;

grant usage on schema auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;

create table storage.buckets (
  id                 text primary key,
  name               text not null,
  public             boolean not null default false,
  file_size_limit    bigint,
  allowed_mime_types text[]
);

create table storage.objects (
  id        uuid primary key default gen_random_uuid(),
  bucket_id text not null references storage.buckets (id),
  name      text not null,
  owner     uuid,
  unique (bucket_id, name)
);

alter table storage.objects enable row level security;
alter table storage.objects force row level security;
grant usage on schema storage to anon, authenticated;
grant select, insert, delete on storage.objects to anon, authenticated;
grant select on storage.buckets to anon, authenticated;

create or replace function storage.foldername(name text)
returns text[]
language sql
immutable
as $$
  select string_to_array(regexp_replace(name, '/[^/]*$', ''), '/');
$$;

grant execute on function storage.foldername(text) to anon, authenticated;
