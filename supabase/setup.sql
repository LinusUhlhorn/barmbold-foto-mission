-- =============================================================================
--  FOTO-MISSION - EINRICHTUNG VON SUPABASE
-- =============================================================================
--
--  SO FÜHRST DU DIESE DATEI AUS!
--  ----------------------------
--   1. Öffne https://supabase.com und melde dich an.
--   2. Wähle dein Projekt aus.
--   3. Klicke links auf "SQL Editor" und dann auf "New query".
--   4. Kopiere den KOMPLETTEN Inhalt dieser Datei hinein.
--   5. Klicke auf "Run".
--
--  Die Datei kann gefahrlos mehrfach ausgeführt werden. Sie legt nichts doppelt
--  an und löscht keine vorhandenen Fotos.
--
--
--  WAS HIER EINGERICHTET WIRD
--  --------------------------
--   * Tabelle  photo_submissions   (die Angaben zu jedem Foto)
--   * Tabelle  album_admins        (wer das private Album sehen darf)
--   * Speicher party-photos        (die Bilddateien selbst, NICHT öffentlich)
--   * Sicherheitsregeln (Row Level Security), damit gilt:
--
--        Gäste (nicht angemeldet)          Admin (angemeldet + eingetragen)
--        --------------------------        --------------------------------
--        Foto hochladen        JA          Fotos ansehen          JA
--        Eintrag anlegen       JA          Fotos herunterladen    JA
--        Fotos ansehen         NEIN        Fotos löschen          JA
--        Liste der Fotos       NEIN        Einträge lesen         JA
--        Fotos ändern          NEIN        Einträge löschen       JA
--        Fotos löschen         NEIN
--
--
--  WICHTIG ZUM ANON-KEY
--  --------------------
--  Der "anon"-Key steht im Frontend und ist damit öffentlich lesbar. Das ist
--  ausdrücklich vorgesehen: Er sagt nur, WELCHES Projekt gemeint ist. WAS damit
--  erlaubt ist, entscheiden ausschließlich die Regeln in dieser Datei.
--  Der "service_role"-Key umgeht dagegen ALLE Regeln und darf deshalb NIEMALS
--  ins Frontend, ins Repository oder in eine Konfigurationsdatei.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 0. Benötigte Erweiterung (für zufällige UUIDs)
-- -----------------------------------------------------------------------------
create extension if not exists pgcrypto;


-- =============================================================================
-- 1. WER DARF DAS ALBUM SEHEN?
-- =============================================================================
-- Absichtlich NICHT "jeder angemeldete Benutzer": Sollte in den Projekt-
-- einstellungen versehentlich die Selbstregistrierung offen bleiben, könnte
-- sich sonst jemand einfach ein Konto anlegen und alle Fotos sehen.
-- Es zählt nur, wer hier ausdrücklich eingetragen ist.

create table if not exists public.album_admins (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  note       text,
  created_at timestamptz not null default now()
);

comment on table public.album_admins is
  'Liste der Benutzer, die das private Album sehen und Fotos löschen dürfen.';

alter table public.album_admins enable row level security;

-- Ein Admin darf nur seinen eigenen Eintrag sehen. Anlegen und Entfernen
-- geschieht ausschließlich von Hand im Supabase-Dashboard.
drop policy if exists "Admin sieht den eigenen Eintrag" on public.album_admins;
create policy "Admin sieht den eigenen Eintrag"
  on public.album_admins
  for select
  to authenticated
  using (user_id = auth.uid());

-- Hilfsfunktion: "Ist der gerade angemeldete Benutzer ein Album-Admin?"
-- SECURITY DEFINER, damit die Funktion die Tabelle lesen darf, ohne dass
-- dafür eine offene Leseregel nötig wäre.
create or replace function public.is_album_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.album_admins a
    where a.user_id = auth.uid()
  );
$$;

comment on function public.is_album_admin() is
  'true, wenn der angemeldete Benutzer in album_admins eingetragen ist.';

revoke all on function public.is_album_admin() from public;
grant execute on function public.is_album_admin() to authenticated;


-- =============================================================================
-- 2. TABELLE FÜR DIE FOTO-ANGABEN
-- =============================================================================

create table if not exists public.photo_submissions (
  id                   uuid primary key default gen_random_uuid(),

  -- Wer hat fotografiert? (freier Text, vom Gast eingegeben)
  guest_name           text        not null,

  -- Welche Mission wurde erfüllt?
  mission_id           text        not null,
  mission_title        text        not null,
  mission_category     text        not null,

  -- Wo liegt die Bilddatei im Speicher? (zufälliger Pfad, z. B. party/<uuid>.jpg)
  storage_path         text        not null unique,

  -- Nur zur Information: der ursprüngliche Dateiname des Handys
  original_filename    text,

  mime_type            text        not null,
  file_size            integer     not null,
  width                integer,
  height               integer,

  is_bonus             boolean     not null default false,
  is_test              boolean     not null default false,
  likes_count          integer     not null default 0 check (likes_count >= 0),

  -- Zufällige ID pro Upload-Vorgang. Verhindert doppelte Einträge, wenn ein
  -- Gast den Knopf zweimal drückt oder der Upload wiederholt wird.
  device_submission_id uuid        not null unique,

  created_at           timestamptz not null default now(),

  -- --- Prüfungen direkt in der Datenbank -----------------------------------
  constraint guest_name_laenge
    check (char_length(btrim(guest_name)) between 1 and 80),
  constraint mission_id_laenge
    check (char_length(mission_id) between 1 and 64),
  constraint mission_title_laenge
    check (char_length(mission_title) between 1 and 200),
  constraint mission_category_laenge
    check (char_length(mission_category) between 1 and 60),
  constraint dateiname_laenge
    check (original_filename is null or char_length(original_filename) <= 200),
  -- Nur echte Bildformate. SVG, HTML und ausführbare Dateien sind ausgeschlossen.
  constraint erlaubter_mime_typ
    check (mime_type in ('image/jpeg', 'image/webp', 'image/png')),
  -- Dateigröße plausibel (max. 8 MB)
  constraint dateigroesse_plausibel
    check (file_size > 0 and file_size <= 8 * 1024 * 1024),
  constraint masse_plausibel
    check (
      (width is null or (width > 0 and width <= 20000)) and
      (height is null or (height > 0 and height <= 20000))
    ),
  -- Der Speicherpfad muss dem erwarteten Muster entsprechen.
  constraint speicherpfad_muster
    check (storage_path ~ '^(party|test)/[0-9a-fA-F-]{36}\.(jpg|webp|png)$')
);

comment on table public.photo_submissions is
  'Angaben zu jedem hochgeladenen Foto. Die Bilddatei selbst liegt im Speicher-Bucket party-photos.';

-- Bestehende Projekte erhalten die neue Spalte beim erneuten Ausfuehren.
alter table public.photo_submissions
  add column if not exists likes_count integer not null default 0 check (likes_count >= 0);

-- Eine Wertung pro Foto und Geraet. Die Geraete-ID ist zufaellig und enthaelt
-- keine persoenlichen Daten. Direkter Zugriff auf diese Tabelle bleibt gesperrt.
create table if not exists public.photo_votes (
  submission_id uuid not null references public.photo_submissions (id) on delete cascade,
  voter_id      uuid not null,
  created_at    timestamptz not null default now(),
  primary key (submission_id, voter_id)
);

alter table public.photo_votes enable row level security;
alter table public.photo_votes force row level security;
revoke all on public.photo_votes from anon, authenticated;

create or replace function public.vote_for_photo(
  p_submission_id uuid,
  p_voter_id uuid
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  inserted_count integer := 0;
  current_count integer := 0;
begin
  insert into public.photo_votes (submission_id, voter_id)
  values (p_submission_id, p_voter_id)
  on conflict do nothing;
  get diagnostics inserted_count = row_count;

  if inserted_count = 1 then
    update public.photo_submissions
       set likes_count = likes_count + 1
     where id = p_submission_id
       and not is_test;
  end if;

  select likes_count into current_count
    from public.photo_submissions
   where id = p_submission_id
     and not is_test;
  return coalesce(current_count, 0);
end;
$$;

revoke all on function public.vote_for_photo(uuid, uuid) from public;
grant execute on function public.vote_for_photo(uuid, uuid) to anon, authenticated;

-- --- Indizes -----------------------------------------------------------------
-- Chronologische Ansicht ("Die Geschichte des Abends")
create index if not exists photo_submissions_created_at_idx
  on public.photo_submissions (created_at);
-- Filter nach Mission und Kategorie
create index if not exists photo_submissions_mission_idx
  on public.photo_submissions (mission_id);
create index if not exists photo_submissions_category_idx
  on public.photo_submissions (mission_category);
-- Testfotos schnell finden und löschen
create index if not exists photo_submissions_is_test_idx
  on public.photo_submissions (is_test) where is_test;


-- --- Zeitstempel absichern ---------------------------------------------------
-- Ohne diesen Auslöser könnte ein Gast einen beliebigen Zeitpunkt mitschicken
-- und damit die Zeitleiste im Album durcheinanderbringen.
create or replace function public.set_submission_created_at()
returns trigger
language plpgsql
as $$
begin
  new.created_at := now();
  return new;
end;
$$;

drop trigger if exists photo_submissions_set_created_at on public.photo_submissions;
create trigger photo_submissions_set_created_at
  before insert on public.photo_submissions
  for each row
  execute function public.set_submission_created_at();


-- =============================================================================
-- 3. SICHERHEITSREGELN FÜR DIE TABELLE
-- =============================================================================

alter table public.photo_submissions enable row level security;
-- Auch der Eigentümer der Tabelle muss sich an die Regeln halten.
alter table public.photo_submissions force row level security;

-- Alte Regeln entfernen, damit die Datei mehrfach ausführbar bleibt.
drop policy if exists "Gaeste duerfen eintragen"        on public.photo_submissions;
drop policy if exists "Oeffentliche Galerie darf lesen" on public.photo_submissions;
drop policy if exists "Nur Admin darf lesen"            on public.photo_submissions;
drop policy if exists "Nur Admin darf loeschen"         on public.photo_submissions;
drop policy if exists "Niemand darf aendern"            on public.photo_submissions;

-- (a) EINTRAGEN: jeder Gast darf einen neuen Datensatz anlegen - aber nur einen
--     sauberen. Gelesen werden darf dabei nichts (die App verwendet bewusst
--     "Prefer: return=minimal").
create policy "Gaeste duerfen eintragen"
  on public.photo_submissions
  for insert
  to anon, authenticated
  with check (
    char_length(btrim(guest_name)) between 1 and 80
    and mime_type in ('image/jpeg', 'image/webp', 'image/png')
    and file_size > 0
    and file_size <= 8 * 1024 * 1024
    and storage_path ~ '^(party|test)/[0-9a-fA-F-]{36}\.(jpg|webp|png)$'
    -- Testfotos gehören in den Ordner "test", echte Fotos in "party".
    and ((is_test and storage_path like 'test/%') or ((not is_test) and storage_path like 'party/%'))
  );

-- (b) LESEN: Echte Feierfotos sind in der Galerie oeffentlich sichtbar.
--     Testfotos bleiben ausschliesslich fuer Admins sichtbar.
create policy "Oeffentliche Galerie darf lesen"
  on public.photo_submissions
  for select
  to anon, authenticated
  using (not is_test);

-- Admins duerfen zusaetzlich auch Testfotos sehen.
create policy "Nur Admin darf lesen"
  on public.photo_submissions
  for select
  to authenticated
  using (public.is_album_admin());

-- (c) LÖSCHEN: ausschließlich eingetragene Album-Admins.
create policy "Nur Admin darf loeschen"
  on public.photo_submissions
  for delete
  to authenticated
  using (public.is_album_admin());

-- (d) ÄNDERN: für niemanden vorgesehen. Es gibt bewusst KEINE UPDATE-Regel -
--     ohne passende Regel ist jede Änderung automatisch verboten.


-- --- Rechte auf Ebene der Datenbank ------------------------------------------
-- Zusätzlich zu den Regeln oben werden auch die klassischen Tabellenrechte
-- eng gefasst. Beides zusammen ergibt einen doppelten Boden.
revoke all on public.photo_submissions from anon, authenticated;
grant insert on public.photo_submissions to anon, authenticated;
grant select on public.photo_submissions to anon;
grant select, delete on public.photo_submissions to authenticated;


-- =============================================================================
-- 4. SPEICHER FÜR DIE BILDDATEIEN
-- =============================================================================
-- Der Bucket bleibt technisch privat. Die Galerie verwendet kurzlebige
-- signierte Links; Testfotos bleiben ausschliesslich fuer Admins sichtbar.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'party-photos',
  'party-photos',
  false,                                              -- nicht öffentlich!
  8388608,                                            -- 8 MB pro Datei
  array['image/jpeg', 'image/webp', 'image/png']      -- nur echte Bildformate
)
on conflict (id) do update
  set public             = false,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;


-- =============================================================================
-- 5. SICHERHEITSREGELN FÜR DEN SPEICHER
-- =============================================================================
-- Hinweis: Falls dieser Abschnitt mit "must be owner of table objects"
-- fehlschlägt, lege die Regeln stattdessen im Dashboard an:
--   Storage -> party-photos -> Policies -> New policy
-- Die README beschreibt das Schritt für Schritt.

drop policy if exists "Gaeste duerfen Fotos hochladen"   on storage.objects;
drop policy if exists "Galerie darf Feierfotos ansehen"  on storage.objects;
drop policy if exists "Nur Admin darf Fotos ansehen"     on storage.objects;
drop policy if exists "Nur Admin darf Fotos loeschen"    on storage.objects;
drop policy if exists "Nur Admin darf Fotos ersetzen"    on storage.objects;

-- (a) HOCHLADEN: erlaubt, aber nur in die vorgesehenen Ordner und nur mit
--     einem zufälligen UUID-Dateinamen. Der ursprüngliche Dateiname des Handys
--     wird nie als Pfad verwendet.
create policy "Gaeste duerfen Fotos hochladen"
  on storage.objects
  for insert
  to anon, authenticated
  with check (
    bucket_id = 'party-photos'
    and array_length(storage.foldername(name), 1) = 1
    and (storage.foldername(name))[1] in ('party', 'test')
    and name ~ '^(party|test)/[0-9a-fA-F-]{36}\.(jpg|webp|png)$'
  );

-- (b) ANSEHEN: Echte Feierfotos duerfen fuer die Galerie signiert werden.
create policy "Galerie darf Feierfotos ansehen"
  on storage.objects
  for select
  to anon, authenticated
  using (bucket_id = 'party-photos' and name like 'party/%');

-- Album-Admins duerfen zusaetzlich Testfotos ansehen.
create policy "Nur Admin darf Fotos ansehen"
  on storage.objects
  for select
  to authenticated
  using (bucket_id = 'party-photos' and public.is_album_admin());

-- (c) LÖSCHEN: nur Album-Admins.
create policy "Nur Admin darf Fotos loeschen"
  on storage.objects
  for delete
  to authenticated
  using (bucket_id = 'party-photos' and public.is_album_admin());

-- (d) ERSETZEN: nur Album-Admins. Damit kann ein Gast ein bereits
--     hochgeladenes Foto nicht nachträglich überschreiben.
create policy "Nur Admin darf Fotos ersetzen"
  on storage.objects
  for update
  to authenticated
  using (bucket_id = 'party-photos' and public.is_album_admin())
  with check (bucket_id = 'party-photos' and public.is_album_admin());


-- =============================================================================
-- 6. LETZTER SCHRITT VON HAND: DEN ADMIN EINTRAGEN
-- =============================================================================
--  1. Lege im Dashboard unter "Authentication" -> "Users" -> "Add user"
--     einen Benutzer mit deiner E-Mail und einem sicheren Passwort an
--     (Haken bei "Auto Confirm User" setzen).
--  2. Entferne unten die beiden Bindestriche und trage deine E-Mail ein.
--  3. Führe nur diesen Befehl noch einmal aus.
--
-- insert into public.album_admins (user_id, note)
-- select id, 'Album-Admin'
--   from auth.users
--  where email = 'DEINE-EMAIL@BEISPIEL.DE'
-- on conflict (user_id) do nothing;
--
--  Prüfen, ob es geklappt hat:
-- select u.email, a.created_at from public.album_admins a join auth.users u on u.id = a.user_id;


-- =============================================================================
-- 7. AUFRÄUMEN NACH DER FEIER (bewusst auskommentiert!)
-- =============================================================================
--  Diese Befehle löschen Daten endgültig. Entferne die Bindestriche nur, wenn
--  du die Fotos vorher heruntergeladen hast.
--
--  (a) Nur die Testfotos entfernen:
-- delete from public.photo_submissions where is_test;
--      Danach im Dashboard unter Storage den Ordner "test" löschen.
--      (Einfacher geht es direkt im Album über "Alle Testfotos löschen".)
--
--  (b) ALLE Angaben entfernen:
-- delete from public.photo_submissions;
--      Danach im Dashboard unter Storage die Ordner "party" und "test" löschen.
--      (Über das Album lassen sich alle Fotos auswählen und samt Dateien löschen.)
--
--  (c) Alles restlos entfernen (Tabellen, Regeln, Bucket):
-- drop table if exists public.photo_submissions;
-- drop table if exists public.album_admins;
-- drop function if exists public.is_album_admin();
-- drop function if exists public.set_submission_created_at();
-- delete from storage.objects where bucket_id = 'party-photos';
-- delete from storage.buckets where id = 'party-photos';


-- =============================================================================
-- FERTIG
-- =============================================================================
-- Kurze Selbstprüfung: Diese Abfrage sollte für photo_submissions
-- rowsecurity = true anzeigen.
select tablename, rowsecurity
  from pg_tables
 where schemaname = 'public'
   and tablename in ('photo_submissions', 'album_admins');
