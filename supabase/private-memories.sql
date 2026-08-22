-- =============================================================================
--  PRIVATE ERINNERUNGEN - "FUER BRITTA & LUTZ"
-- =============================================================================
--
--  SO FÜHRST DU DIESE DATEI AUS!
--  ----------------------------
--   1. Öffne https://supabase.com und melde dich an.
--   2. Wähle dein Projekt aus.
--   3. Klicke links auf "SQL Editor" und dann auf "New query".
--   4. Kopiere den KOMPLETTEN Inhalt dieser Datei hinein.
--      (Wichtig: Die erste Zeile muss "-- ====..." sein.)
--   5. Klicke auf "Run".
--
--  Die Datei kann gefahrlos mehrfach ausgeführt werden. Sie löscht nichts und
--  fasst die vorhandene Foto-Mission NICHT an: weder die Tabelle
--  photo_submissions noch den Bucket party-photos.
--
--  Voraussetzung: supabase/setup.sql wurde bereits ausgeführt. Von dort wird
--  die Tabelle album_admins und die Funktion is_album_admin() gebraucht.
--
--
--  WAS HIER EINGERICHTET WIRD
--  --------------------------
--   * Tabelle  private_memory_uploads  (ein Eintrag je Upload-Vorgang)
--   * Tabelle  private_memory_files    (ein Eintrag je Datei)
--   * Speicher private-memories        (streng privat, NICHT öffentlich)
--   * Sicherheitsregeln, damit gilt:
--
--        Gäste (nicht angemeldet)            Album-Admin (angemeldet)
--        ----------------------------        ------------------------------
--        Upload anlegen          JA          Uploads lesen            JA
--        Dateien hochladen       JA          Dateien ansehen          JA
--        Uploads lesen           NEIN        Dateien herunterladen    JA
--        Dateien auflisten       NEIN        Dateien löschen          JA
--        Dateien herunterladen   NEIN        Uploads löschen          JA
--        Etwas ändern/löschen    NEIN
--
--  Diese Aufnahmen erscheinen NIEMALS in der öffentlichen Galerie. Sie werden
--  von der Foto-Mission gar nicht gelesen.
-- =============================================================================


create extension if not exists pgcrypto;


-- =============================================================================
-- 1. SICHERHEITSNETZ: GIBT ES DIE ADMIN-LOGIK SCHON?
-- =============================================================================
-- Ohne album_admins bzw. is_album_admin() hätten die Regeln weiter unten keine
-- Grundlage. Dann bricht die Datei lieber hier verständlich ab, statt einen
-- Bereich anzulegen, den niemand mehr lesen kann.

do $$
begin
  if to_regclass('public.album_admins') is null then
    raise exception
      'Bitte zuerst supabase/setup.sql ausführen: die Tabelle album_admins fehlt.';
  end if;
  if not exists (select 1 from pg_proc where proname = 'is_album_admin') then
    raise exception
      'Bitte zuerst supabase/setup.sql ausführen: die Funktion is_album_admin() fehlt.';
  end if;
end;
$$;


-- =============================================================================
-- 2. EIN EINTRAG JE UPLOAD-VORGANG
-- =============================================================================

create table if not exists public.private_memory_uploads (
  -- Die ID wird von der Seite erzeugt und wandert in den Ordnernamen.
  -- So braucht der Gast nach dem Anlegen NICHTS zurückzulesen.
  id             uuid primary key,

  -- Vollständiger Name, so wie der Gast ihn geschrieben hat.
  guest_name     text        not null,

  -- Freiwillige Nachricht an Britta und Lutz.
  message        text,

  -- Der eigene Ordner dieses Vorgangs, z. B.
  -- uploads/2026-08-29/20-14-35__linus-uhlhorn__<uuid>
  storage_folder text        not null unique,

  photo_count    integer     not null default 0,
  video_count    integer     not null default 0,
  total_size     bigint      not null default 0,

  -- pending   = angelegt, Dateien noch unterwegs
  -- complete  = alle angekündigten Dateien sind da
  -- incomplete= der Gast hat abgebrochen oder es fehlten Dateien
  status         text        not null default 'pending',

  created_at     timestamptz not null default now(),

  -- --- Prüfungen direkt in der Datenbank -----------------------------------
  constraint memory_guest_name_laenge
    check (char_length(btrim(guest_name)) between 1 and 80),
  constraint memory_nachricht_laenge
    check (message is null or char_length(message) <= 1000),
  -- Höchstens 20 Fotos und 5 Videos je Upload-Vorgang.
  constraint memory_hoechstens_20_fotos
    check (photo_count between 0 and 20),
  constraint memory_hoechstens_5_videos
    check (video_count between 0 and 5),
  constraint memory_groesse_plausibel
    -- 20 * 15 MB + 5 * 45 MB = 525 MB, mit etwas Luft nach oben.
    check (total_size >= 0 and total_size <= 600 * 1024 * 1024),
  constraint memory_status_erlaubt
    check (status in ('pending', 'complete', 'incomplete')),
  -- Der Ordner muss dem erwarteten Muster entsprechen. Das verhindert, dass
  -- über den Ordnernamen etwas Unerwartetes in die Tabelle kommt.
  constraint memory_ordner_muster
    check (
      storage_folder ~
        '^uploads/[0-9]{4}-[0-9]{2}-[0-9]{2}/[0-9]{2}-[0-9]{2}-[0-9]{2}__[a-z0-9-]{1,40}__[0-9a-f-]{36}$'
    )
);

comment on table public.private_memory_uploads is
  'Ein Eintrag je privatem Upload-Vorgang. Diese Aufnahmen sind NICHT öffentlich.';


-- =============================================================================
-- 3. EIN EINTRAG JE DATEI
-- =============================================================================

create table if not exists public.private_memory_files (
  id                uuid primary key default gen_random_uuid(),

  -- Beim Löschen eines Upload-Vorgangs verschwinden auch seine Dateieinträge.
  upload_id         uuid        not null
                    references public.private_memory_uploads (id) on delete cascade,

  storage_path      text        not null unique,
  original_filename text,
  stored_filename   text        not null,
  mime_type         text        not null,
  file_size         bigint      not null,
  media_type        text        not null,
  created_at        timestamptz not null default now(),

  constraint memory_datei_art
    check (media_type in ('photo', 'video')),
  constraint memory_datei_groesse
    -- 45 MB ist die Obergrenze (Videos). Fotos prüft zusätzlich die Seite.
    check (file_size > 0 and file_size <= 45 * 1024 * 1024),
  constraint memory_dateiname_laenge
    check (original_filename is null or char_length(original_filename) <= 255),
  -- Der Pfad muss im Ordner eines Upload-Vorgangs liegen, im richtigen
  -- Unterordner, mit einem durchnummerierten, unbedenklichen Dateinamen.
  constraint memory_datei_pfad_muster
    check (
      storage_path ~
        '^uploads/[0-9]{4}-[0-9]{2}-[0-9]{2}/[0-9]{2}-[0-9]{2}-[0-9]{2}__[a-z0-9-]{1,40}__[0-9a-f-]{36}/(fotos|videos)/[0-9]{2}_(foto|video)\.[a-z0-9]{2,4}$'
    ),
  -- Fotos gehören nach "fotos", Videos nach "videos".
  constraint memory_datei_ordner_passt
    check (
      (media_type = 'photo' and storage_path ~ '/fotos/')
      or (media_type = 'video' and storage_path ~ '/videos/')
    )
);

comment on table public.private_memory_files is
  'Einzelne Dateien eines privaten Upload-Vorgangs. Die Datei selbst liegt im Bucket private-memories.';


-- --- Indizes -----------------------------------------------------------------
-- Die Übersicht im Adminbereich sortiert nach Zeitpunkt.
create index if not exists private_memory_uploads_created_at_idx
  on public.private_memory_uploads (created_at desc);
-- Unvollständige Uploads schnell finden.
create index if not exists private_memory_uploads_status_idx
  on public.private_memory_uploads (status);
-- Nach Gast sortieren und suchen.
create index if not exists private_memory_uploads_guest_idx
  on public.private_memory_uploads (guest_name);
-- Alle Dateien eines Vorgangs.
create index if not exists private_memory_files_upload_idx
  on public.private_memory_files (upload_id);
create index if not exists private_memory_files_media_type_idx
  on public.private_memory_files (upload_id, media_type);


-- --- Zeitstempel absichern ---------------------------------------------------
-- Ohne das könnte ein Gast einen beliebigen Zeitpunkt mitschicken.
create or replace function public.set_memory_created_at()
returns trigger
language plpgsql
as $$
begin
  new.created_at := now();
  return new;
end;
$$;

drop trigger if exists private_memory_uploads_set_created_at on public.private_memory_uploads;
create trigger private_memory_uploads_set_created_at
  before insert on public.private_memory_uploads
  for each row
  execute function public.set_memory_created_at();

drop trigger if exists private_memory_files_set_created_at on public.private_memory_files;
create trigger private_memory_files_set_created_at
  before insert on public.private_memory_files
  for each row
  execute function public.set_memory_created_at();


-- =============================================================================
-- 4. SICHERHEITSREGELN FÜR DIE TABELLEN
-- =============================================================================

alter table public.private_memory_uploads enable row level security;
alter table public.private_memory_uploads force row level security;
alter table public.private_memory_files enable row level security;
alter table public.private_memory_files force row level security;

-- Alte Regeln entfernen, damit die Datei mehrfach ausführbar bleibt.
drop policy if exists "Gaeste duerfen Erinnerung anlegen"   on public.private_memory_uploads;
drop policy if exists "Nur Admin liest Erinnerungen"        on public.private_memory_uploads;
drop policy if exists "Nur Admin loescht Erinnerungen"      on public.private_memory_uploads;
drop policy if exists "Gaeste duerfen Datei eintragen"      on public.private_memory_files;
drop policy if exists "Nur Admin liest Erinnerungsdateien"  on public.private_memory_files;
drop policy if exists "Nur Admin loescht Erinnerungsdateien" on public.private_memory_files;

-- (a) ANLEGEN: Jeder Gast darf einen neuen Upload-Vorgang eintragen.
--     Gelesen werden darf dabei nichts (die Seite verwendet bewusst
--     "Prefer: return=minimal" und kennt die ID, weil sie sie selbst erzeugt).
create policy "Gaeste duerfen Erinnerung anlegen"
  on public.private_memory_uploads
  for insert
  to anon, authenticated
  with check (
    char_length(btrim(guest_name)) between 1 and 80
    and (message is null or char_length(message) <= 1000)
    -- Ein neuer Vorgang startet immer als "pending".
    and status = 'pending'
  );

-- (b) DATEI EINTRAGEN: nur zu einem Vorgang, den es wirklich gibt.
--
--     Kleine Hilfsfunktion: Sie liefert den Ordner eines Upload-Vorgangs -
--     aber nur, solange er frisch ist. Ein alter Ordner lässt sich damit nicht
--     nachträglich mit fremden Dateien auffüllen.
--
--     Warum eine Funktion und keine Unterabfrage in der Regel?
--     Eine Regel wird mit den Rechten des Aufrufers ausgewertet. Ein Gast darf
--     private_memory_uploads aber gar nicht lesen - eine Unterabfrage käme
--     deshalb immer leer zurück und der Upload würde grundsätzlich scheitern.
--     SECURITY DEFINER löst genau das, ohne den Gästen Leserechte zu geben:
--     Zurück kommt nur der Ordnername, niemals Name oder Nachricht.
create or replace function public.memory_upload_folder(p_upload_id uuid)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select u.storage_folder
    from public.private_memory_uploads u
   where u.id = p_upload_id
     and u.created_at > now() - interval '6 hours';
$$;

revoke all on function public.memory_upload_folder(uuid) from public;
grant execute on function public.memory_upload_folder(uuid) to anon, authenticated;

create policy "Gaeste duerfen Datei eintragen"
  on public.private_memory_files
  for insert
  to anon, authenticated
  with check (
    -- Die Datei muss im Ordner ihres eigenen Vorgangs liegen. Gibt es den
    -- Vorgang nicht (oder ist er zu alt), kommt NULL zurück und der Eintrag
    -- wird abgelehnt.
    starts_with(storage_path, public.memory_upload_folder(upload_id) || '/')
  );

-- (c) LESEN: ausschließlich eingetragene Album-Admins.
--     Für Gäste gibt es KEINE Leseregel - damit ist Lesen automatisch verboten.
create policy "Nur Admin liest Erinnerungen"
  on public.private_memory_uploads
  for select
  to authenticated
  using (public.is_album_admin());

create policy "Nur Admin liest Erinnerungsdateien"
  on public.private_memory_files
  for select
  to authenticated
  using (public.is_album_admin());

-- (d) LÖSCHEN: ausschließlich Album-Admins.
create policy "Nur Admin loescht Erinnerungen"
  on public.private_memory_uploads
  for delete
  to authenticated
  using (public.is_album_admin());

create policy "Nur Admin loescht Erinnerungsdateien"
  on public.private_memory_files
  for delete
  to authenticated
  using (public.is_album_admin());

-- (e) ÄNDERN: für niemanden vorgesehen. Es gibt bewusst KEINE UPDATE-Regel.
--     Den Abschluss eines Uploads erledigt weiter unten eine geprüfte Funktion.


-- --- Rechte auf Ebene der Datenbank ------------------------------------------
revoke all on public.private_memory_uploads from anon, authenticated;
revoke all on public.private_memory_files   from anon, authenticated;

grant insert on public.private_memory_uploads to anon, authenticated;
grant insert on public.private_memory_files   to anon, authenticated;
grant select, delete on public.private_memory_uploads to authenticated;
grant select, delete on public.private_memory_files   to authenticated;


-- =============================================================================
-- 5. UPLOAD ABSCHLIESSEN
-- =============================================================================
-- Gäste dürfen keine Datensätze ändern. Den Abschluss übernimmt deshalb diese
-- geprüfte Funktion: Sie zählt selbst nach, was wirklich angekommen ist, und
-- setzt den Status danach. Ein falsches "vollständig" ist damit nicht möglich -
-- auch nicht, wenn jemand die Zahlen von außen mitschicken würde.
create or replace function public.complete_memory_upload(
  p_upload_id uuid,
  p_expected_photos integer,
  p_expected_videos integer
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_photos  integer := 0;
  v_videos  integer := 0;
  v_size    bigint  := 0;
  v_status  text;
begin
  if not exists (select 1 from public.private_memory_uploads where id = p_upload_id) then
    raise exception 'Diesen Upload gibt es nicht.';
  end if;

  select
    count(*) filter (where media_type = 'photo'),
    count(*) filter (where media_type = 'video'),
    coalesce(sum(file_size), 0)
  into v_photos, v_videos, v_size
  from public.private_memory_files
  where upload_id = p_upload_id;

  -- Vollständig ist nur, was auch wirklich vollständig angekommen ist.
  if v_photos >= coalesce(p_expected_photos, 0)
     and v_videos >= coalesce(p_expected_videos, 0)
     and (v_photos + v_videos) > 0
  then
    v_status := 'complete';
  else
    v_status := 'incomplete';
  end if;

  update public.private_memory_uploads
     set photo_count = v_photos,
         video_count = v_videos,
         total_size  = v_size,
         status      = v_status
   where id = p_upload_id;

  return jsonb_build_object(
    'status', v_status,
    'photo_count', v_photos,
    'video_count', v_videos,
    'total_size', v_size
  );
end;
$$;

revoke all on function public.complete_memory_upload(uuid, integer, integer) from public;
grant execute on function public.complete_memory_upload(uuid, integer, integer) to anon, authenticated;


-- =============================================================================
-- 6. PRIVATER SPEICHER FÜR DIE ERINNERUNGEN
-- =============================================================================
-- Ein eigener Bucket. Der Bucket der Foto-Mission (party-photos) wird hier
-- bewusst NICHT angefasst.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'private-memories',
  'private-memories',
  false,                                   -- niemals öffentlich!
  47185920,                                -- 45 MB pro Datei
  array[
    'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif',
    'video/mp4', 'video/quicktime', 'video/webm'
  ]
)
on conflict (id) do update
  set public             = false,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;


-- =============================================================================
-- 7. SICHERHEITSREGELN FÜR DEN PRIVATEN SPEICHER
-- =============================================================================
-- Hinweis: Falls dieser Abschnitt mit "must be owner of table objects"
-- fehlschlägt, lege die Regeln stattdessen im Dashboard an:
--   Storage -> private-memories -> Policies -> New policy
-- Die README beschreibt das Schritt für Schritt.

drop policy if exists "Gaeste duerfen Erinnerungen hochladen" on storage.objects;
drop policy if exists "Nur Admin sieht Erinnerungsdateien"     on storage.objects;
drop policy if exists "Nur Admin loescht Dateien im Speicher"  on storage.objects;

-- (a) HOCHLADEN: erlaubt, aber ausschließlich in diesen Bucket und nur mit
--     einem Pfad, der genau dem erwarteten Muster entspricht.
create policy "Gaeste duerfen Erinnerungen hochladen"
  on storage.objects
  for insert
  to anon, authenticated
  with check (
    bucket_id = 'private-memories'
    and name ~
      '^uploads/[0-9]{4}-[0-9]{2}-[0-9]{2}/[0-9]{2}-[0-9]{2}-[0-9]{2}__[a-z0-9-]{1,40}__[0-9a-f-]{36}/(fotos|videos)/[0-9]{2}_(foto|video)\.[a-z0-9]{2,4}$'
  );

-- (b) ANSEHEN UND HERUNTERLADEN: ausschließlich Album-Admins.
--     Ohne Leseregel kann ein Gast weder auflisten noch signierte Links
--     erzeugen noch eine Datei herunterladen.
create policy "Nur Admin sieht Erinnerungsdateien"
  on storage.objects
  for select
  to authenticated
  using (bucket_id = 'private-memories' and public.is_album_admin());

-- (c) LÖSCHEN: ausschließlich Album-Admins.
create policy "Nur Admin loescht Dateien im Speicher"
  on storage.objects
  for delete
  to authenticated
  using (bucket_id = 'private-memories' and public.is_album_admin());

-- (d) ERSETZEN: für niemanden vorgesehen. Ohne UPDATE-Regel kann eine einmal
--     hochgeladene Datei nicht überschrieben werden.


-- =============================================================================
-- 8. GREIFT EINE ALTE REGEL VERSEHENTLICH AUF DEN NEUEN BUCKET?
-- =============================================================================
-- Die Regeln der Foto-Mission nennen ihren Bucket ausdrücklich beim Namen.
-- Diese Prüfung zeigt trotzdem alle Speicher-Regeln, die auf JEDEN Bucket
-- passen könnten. Hier sollte KEINE Zeile herauskommen.

select policyname as bitte_pruefen,
       cmd        as vorgang,
       roles      as gilt_fuer
  from pg_policies
 where schemaname = 'storage'
   and tablename = 'objects'
   and coalesce(qual, '') || coalesce(with_check, '') not like '%bucket_id%';


-- =============================================================================
-- 9. AUFRÄUMEN NACH DER FEIER (bewusst auskommentiert!)
-- =============================================================================
--  Erst ausführen, wenn die Erinnerungen heruntergeladen und übergeben sind.
--
--  (a) Einen einzelnen Upload entfernen (Dateieinträge gehen automatisch mit):
-- delete from public.private_memory_uploads where id = 'HIER-DIE-UUID';
--
--  (b) Alle privaten Erinnerungen entfernen:
-- delete from public.private_memory_uploads;
--      Danach im Dashboard unter Storage den Ordner "uploads" im Bucket
--      private-memories löschen. (Einfacher geht es im Album über
--      "Upload löschen" - das entfernt Dateien und Einträge zusammen.)
--
--  (c) Alles restlos entfernen:
-- drop table if exists public.private_memory_files;
-- drop table if exists public.private_memory_uploads;
-- drop function if exists public.complete_memory_upload(uuid, integer, integer);
-- drop function if exists public.memory_upload_folder(uuid);
-- drop function if exists public.set_memory_created_at();
-- delete from storage.objects where bucket_id = 'private-memories';
-- delete from storage.buckets where id = 'private-memories';


-- =============================================================================
-- FERTIG
-- =============================================================================
-- Selbstprüfung: Hier müssen ALLE Zeilen "vorhanden = true" zeigen.
select 'Tabelle private_memory_uploads' as pruefung,
       to_regclass('public.private_memory_uploads') is not null as vorhanden
union all
select 'Tabelle private_memory_files',
       to_regclass('public.private_memory_files') is not null
union all
select 'Privater Bucket private-memories (nicht öffentlich)',
       exists (select 1 from storage.buckets where id = 'private-memories' and public = false)
union all
select 'Gäste dürfen hochladen',
       exists (
         select 1 from pg_policies
          where schemaname = 'storage' and tablename = 'objects'
            and policyname = 'Gaeste duerfen Erinnerungen hochladen'
       )
union all
select 'Nur Admin sieht die Dateien',
       exists (
         select 1 from pg_policies
          where schemaname = 'storage' and tablename = 'objects'
            and policyname = 'Nur Admin sieht Erinnerungsdateien'
       )
union all
select 'Funktion complete_memory_upload',
       exists (select 1 from pg_proc where proname = 'complete_memory_upload')
union all
select 'Foto-Mission unberührt (Bucket party-photos existiert weiter)',
       exists (select 1 from storage.buckets where id = 'party-photos');
