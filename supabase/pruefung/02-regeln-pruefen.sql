-- Verhaltensprüfung der Regeln: Was darf ein Gast, was darf nur der Admin?
-- Jede Zeile der Ausgabe muss "OK" zeigen.

\set ON_ERROR_STOP off
\pset pager off
\set QUIET on
\set ordner '''uploads/2026-08-29/20-14-35__linus-uhlhorn__550e8400-e29b-41d4-a716-446655440000'''
\set uid '''550e8400-e29b-41d4-a716-446655440000'''

create or replace function pg_temp.pruefe(bezeichnung text, soll_klappen boolean, befehl text)
returns text
language plpgsql
as $$
declare
  geklappt boolean := true;
  meldung  text := '';
begin
  begin
    execute befehl;
  exception when others then
    geklappt := false;
    meldung := sqlerrm;
  end;
  if geklappt = soll_klappen then
    return format('OK    | %s', bezeichnung);
  end if;
  return format('FEHLER| %s (erwartet: %s, war: %s%s)',
                bezeichnung,
                case when soll_klappen then 'erlaubt' else 'abgelehnt' end,
                case when geklappt then 'erlaubt' else 'abgelehnt' end,
                case when meldung = '' then '' else ' – ' || left(meldung, 90) end);
end;
$$;

-- Einen Album-Admin anlegen (wie im echten Projekt von Hand eingetragen).
insert into auth.users (id, email)
values ('00000000-0000-4000-8000-000000000001', 'admin@example.de')
on conflict do nothing;
insert into public.album_admins (user_id, note)
values ('00000000-0000-4000-8000-000000000001', 'Album-Admin')
on conflict do nothing;

\echo ''
\echo '--- ALS GAST (anonym, nicht angemeldet) ---'
set role anon;

select pg_temp.pruefe('Gast legt einen Upload an', true, format(
  'insert into public.private_memory_uploads (id, guest_name, message, storage_folder) values (%L, %L, %L, %L)',
  :uid, 'Linus Uhlhorn', 'Alles Gute!', :ordner));

select pg_temp.pruefe('Gast setzt sich selbst auf "complete"', false, format(
  'insert into public.private_memory_uploads (id, guest_name, storage_folder, status) values (%L, %L, %L, %L)',
  '11111111-1111-4111-8111-111111111111', 'Trickser',
  'uploads/2026-08-29/20-14-35__trickser__11111111-1111-4111-8111-111111111111', 'complete'));

select pg_temp.pruefe('Gast erfindet einen Ordnernamen', false, format(
  'insert into public.private_memory_uploads (id, guest_name, storage_folder) values (%L, %L, %L)',
  '22222222-2222-4222-8222-222222222222', 'Trickser', '../../geheim'));

select pg_temp.pruefe('Gast trägt eine Datei im eigenen Ordner ein', true, format(
  'insert into public.private_memory_files (upload_id, storage_path, original_filename, stored_filename, mime_type, file_size, media_type)
   values (%L, %L, %L, %L, %L, %L, %L)',
  :uid, 'uploads/2026-08-29/20-14-35__linus-uhlhorn__550e8400-e29b-41d4-a716-446655440000/fotos/01_foto.jpg',
  'IMG_1234.JPG', '01_foto.jpg', 'image/jpeg', 2000000, 'photo'));

select pg_temp.pruefe('Gast trägt ein Video im eigenen Ordner ein', true, format(
  'insert into public.private_memory_files (upload_id, storage_path, stored_filename, mime_type, file_size, media_type)
   values (%L, %L, %L, %L, %L, %L)',
  :uid, 'uploads/2026-08-29/20-14-35__linus-uhlhorn__550e8400-e29b-41d4-a716-446655440000/videos/01_video.mp4',
  '01_video.mp4', 'video/mp4', 30000000, 'video'));

select pg_temp.pruefe('Gast schiebt eine Datei in einen fremden Ordner', false, format(
  'insert into public.private_memory_files (upload_id, storage_path, stored_filename, mime_type, file_size, media_type)
   values (%L, %L, %L, %L, %L, %L)',
  :uid, 'uploads/2026-08-29/09-00-00__fremder__99999999-9999-4999-8999-999999999999/fotos/01_foto.jpg',
  '01_foto.jpg', 'image/jpeg', 1000, 'photo'));

select pg_temp.pruefe('Gast trägt eine Datei ohne Upload ein', false, format(
  'insert into public.private_memory_files (upload_id, storage_path, stored_filename, mime_type, file_size, media_type)
   values (%L, %L, %L, %L, %L, %L)',
  '99999999-9999-4999-8999-999999999999',
  'uploads/2026-08-29/20-14-35__linus-uhlhorn__550e8400-e29b-41d4-a716-446655440000/fotos/09_foto.jpg',
  '09_foto.jpg', 'image/jpeg', 1000, 'photo'));

select pg_temp.pruefe('Gast legt ein Foto in den Video-Ordner', false, format(
  'insert into public.private_memory_files (upload_id, storage_path, stored_filename, mime_type, file_size, media_type)
   values (%L, %L, %L, %L, %L, %L)',
  :uid, 'uploads/2026-08-29/20-14-35__linus-uhlhorn__550e8400-e29b-41d4-a716-446655440000/videos/02_video.mp4',
  '02_video.mp4', 'image/jpeg', 1000, 'photo'));

select pg_temp.pruefe('Gast lädt ein zu großes Video hoch (46 MB)', false, format(
  'insert into public.private_memory_files (upload_id, storage_path, stored_filename, mime_type, file_size, media_type)
   values (%L, %L, %L, %L, %L, %L)',
  :uid, 'uploads/2026-08-29/20-14-35__linus-uhlhorn__550e8400-e29b-41d4-a716-446655440000/videos/03_video.mp4',
  '03_video.mp4', 'video/mp4', 48234496, 'video'));

select pg_temp.pruefe('Gast schmuggelt einen Dateinamen ein', false, format(
  'insert into public.private_memory_files (upload_id, storage_path, stored_filename, mime_type, file_size, media_type)
   values (%L, %L, %L, %L, %L, %L)',
  :uid, 'uploads/2026-08-29/20-14-35__linus-uhlhorn__550e8400-e29b-41d4-a716-446655440000/fotos/../../../boese.jpg',
  'boese.jpg', 'image/jpeg', 1000, 'photo'));

\echo ''
\echo '--- GAST DARF NICHTS LESEN, ÄNDERN, LÖSCHEN ---'
select pg_temp.pruefe('Gast liest die Upload-Liste', false,
  'select count(*) from public.private_memory_uploads');
select pg_temp.pruefe('Gast liest die Dateiliste', false,
  'select count(*) from public.private_memory_files');
select pg_temp.pruefe('Gast ändert einen Upload', false,
  'update public.private_memory_uploads set guest_name = ''Hacker''');
select pg_temp.pruefe('Gast löscht einen Upload', false,
  'delete from public.private_memory_uploads');
select pg_temp.pruefe('Gast löscht einen Dateieintrag', false,
  'delete from public.private_memory_files');

\echo ''
\echo '--- SPEICHER: WAS DARF EIN GAST MIT DEN DATEIEN? ---'
select pg_temp.pruefe('Gast lädt in den erlaubten Pfad hoch', true, format(
  'insert into storage.objects (bucket_id, name) values (%L, %L)',
  'private-memories',
  'uploads/2026-08-29/20-14-35__linus-uhlhorn__550e8400-e29b-41d4-a716-446655440000/fotos/01_foto.jpg'));

select pg_temp.pruefe('Gast lädt neben den Ordner', false, format(
  'insert into storage.objects (bucket_id, name) values (%L, %L)',
  'private-memories', 'uploads/beliebig.jpg'));

select pg_temp.pruefe('Gast lädt mit Pfad-Ausbruch hoch', false, format(
  'insert into storage.objects (bucket_id, name) values (%L, %L)',
  'private-memories',
  'uploads/2026-08-29/20-14-35__x__550e8400-e29b-41d4-a716-446655440000/fotos/../../boese.jpg'));

select case when (select count(*) from storage.objects where bucket_id = 'private-memories') = 0
  then 'OK    | Gast sieht keine einzige private Datei'
  else 'FEHLER| Gast kann die privaten Dateien auflisten' end;

with weg as (delete from storage.objects where bucket_id = 'private-memories' returning 1)
select case when (select count(*) from weg) = 0
  then 'OK    | Gast kann keine private Datei löschen'
  else 'FEHLER| Gast konnte eine private Datei löschen' end;

\echo ''
\echo '--- DIE FOTO-MISSION FUNKTIONIERT WEITER ---'
select pg_temp.pruefe('Gast trägt ein Missionsfoto ein', true, format(
  'insert into public.photo_submissions
     (guest_name, mission_id, mission_title, mission_category, storage_path, mime_type, file_size, device_submission_id)
   values (%L, %L, %L, %L, %L, %L, %L, %L)',
  'Anna', 'mission-01', 'Das schönste Lachen', 'Momente',
  'party/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee.jpg', 'image/jpeg', 500000,
  '33333333-3333-4333-8333-333333333333'));

select pg_temp.pruefe('Gast liest die öffentliche Galerie', true,
  'select count(*) from public.photo_submissions where not is_test');

select pg_temp.pruefe('Gast lädt ein Missionsfoto in den alten Bucket', true, format(
  'insert into storage.objects (bucket_id, name) values (%L, %L)',
  'party-photos', 'party/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee.jpg'));

\echo ''
\echo '--- UPLOAD ABSCHLIESSEN ---'
reset role;
set role anon;
select case
  when (select public.complete_memory_upload(:uid::uuid, 1, 1) ->> 'status') = 'complete'
  then 'OK    | Vollständiger Upload wird als "complete" markiert'
  else 'FEHLER| Vollständiger Upload wird nicht als "complete" markiert' end;

select case
  when (select public.complete_memory_upload(:uid::uuid, 5, 5) ->> 'status') = 'incomplete'
  then 'OK    | Fehlende Dateien ergeben "incomplete"'
  else 'FEHLER| Fehlende Dateien werden faelschlich als vollstaendig gemeldet' end;

reset role;
select case
  when photo_count = 1 and video_count = 1 and total_size = 32000000
  then 'OK    | Die Zähler werden aus den echten Dateien errechnet'
  else format('FEHLER| Zähler falsch: %s Fotos, %s Videos, %s Bytes', photo_count, video_count, total_size)
  end
  from public.private_memory_uploads where id = :uid::uuid;

\echo ''
\echo '--- ALS ALBUM-ADMIN (angemeldet und eingetragen) ---'
set role authenticated;
select set_config('test.user_id', '00000000-0000-4000-8000-000000000001', false);

select case when (select count(*) from public.private_memory_uploads) = 1
  then 'OK    | Admin sieht die Uploads'
  else 'FEHLER| Admin sieht die Uploads nicht' end;
select case when (select count(*) from public.private_memory_files) = 2
  then 'OK    | Admin sieht die Dateien'
  else 'FEHLER| Admin sieht die Dateien nicht' end;
select case when (select count(*) from storage.objects where bucket_id = 'private-memories') = 1
  then 'OK    | Admin sieht die Dateien im Speicher'
  else 'FEHLER| Admin sieht die Dateien im Speicher nicht' end;

\echo ''
\echo '--- ANGEMELDET, ABER KEIN ALBUM-ADMIN ---'
select set_config('test.user_id', '00000000-0000-4000-8000-000000000099', false);
select case when (select count(*) from public.private_memory_uploads) = 0
  then 'OK    | Fremder Benutzer sieht nichts'
  else 'FEHLER| Ein beliebiger angemeldeter Benutzer sieht die Erinnerungen' end;
select case when (select count(*) from storage.objects where bucket_id = 'private-memories') = 0
  then 'OK    | Fremder Benutzer sieht keine Dateien'
  else 'FEHLER| Ein beliebiger angemeldeter Benutzer sieht die Dateien' end;

\echo ''
\echo '--- LÖSCHEN DURCH DEN ADMIN ---'
select set_config('test.user_id', '00000000-0000-4000-8000-000000000001', false);
select pg_temp.pruefe('Admin löscht einen Upload', true,
  format('delete from public.private_memory_uploads where id = %L', '550e8400-e29b-41d4-a716-446655440000'));
select case when (select count(*) from public.private_memory_files) = 0
  then 'OK    | Die Dateieinträge verschwinden mit dem Upload'
  else 'FEHLER| Es bleiben verwaiste Dateieinträge zurück' end;

reset role;
