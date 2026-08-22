// Prüft die SQL-Migration für die privaten Erinnerungen.
//
// Der wichtigste Punkt: Diese Aufnahmen dürfen NIEMALS öffentlich lesbar sein.
// Gäste dürfen ausschließlich hochladen - nicht auflisten, nicht herunterladen.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { PARTY_CONFIG } from '../config/party-config.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sql = fs.readFileSync(path.join(ROOT, 'supabase', 'private-memories.sql'), 'utf8');
const missionSql = fs.readFileSync(path.join(ROOT, 'supabase', 'setup.sql'), 'utf8');

// =========================================================================
// Aufbau
// =========================================================================

test('Die Datei beginnt mit dem Hinweis zum Ausführen', () => {
  const kopf = sql.split('\n').slice(0, 13).join('\n');
  assert.match(kopf, /PRIVATE ERINNERUNGEN/);
  assert.match(kopf, /SQL Editor/);
  // Der erste Buchstabe muss ein Kommentarzeichen sein, sonst bricht der
  // SQL Editor beim Einfügen ab.
  assert.ok(sql.startsWith('-- ='), 'Die erste Zeile ist kein SQL-Kommentar');
});

test('Beide Tabellen werden mit allen geforderten Feldern angelegt', () => {
  assert.match(sql, /create table if not exists public\.private_memory_uploads/i);
  for (const spalte of [
    'id',
    'guest_name',
    'message',
    'storage_folder',
    'photo_count',
    'video_count',
    'total_size',
    'status',
    'created_at',
  ]) {
    assert.match(sql, new RegExp(`^\\s+${spalte}\\s`, 'm'), `Spalte fehlt: ${spalte}`);
  }

  assert.match(sql, /create table if not exists public\.private_memory_files/i);
  for (const spalte of [
    'upload_id',
    'storage_path',
    'original_filename',
    'stored_filename',
    'mime_type',
    'file_size',
    'media_type',
  ]) {
    assert.match(sql, new RegExp(`^\\s+${spalte}\\s`, 'm'), `Spalte fehlt: ${spalte}`);
  }
});

test('Die Namen der Tabellen passen zur Konfiguration', () => {
  assert.match(sql, new RegExp(`public\\.${PARTY_CONFIG.supabase.memoriesTable}\\b`));
  assert.match(sql, new RegExp(`public\\.${PARTY_CONFIG.supabase.memoriesFilesTable}\\b`));
});

test('Die Grenzen der Konfiguration stehen auch in der Datenbank', () => {
  const l = PARTY_CONFIG.memories.limits;
  assert.equal(l.maxPhotos, 20);
  assert.equal(l.maxVideos, 5);
  assert.match(sql, /photo_count between 0 and 20/i, 'Höchstens 20 Fotos fehlt');
  assert.match(sql, /video_count between 0 and 5/i, 'Höchstens 5 Videos fehlt');
  // Die Obergrenze je Datei muss zum größten erlaubten Video passen.
  assert.match(sql, /file_size > 0 and file_size <= 45 \* 1024 \* 1024/i);
  assert.equal(l.maxVideoBytes, 45 * 1024 * 1024);
});

test('media_type lässt nur photo und video zu', () => {
  assert.match(sql, /media_type in \('photo', 'video'\)/i);
});

test('Dateien hängen sicher am Upload und verschwinden mit ihm', () => {
  assert.match(
    sql,
    /references public\.private_memory_uploads \(id\) on delete cascade/i,
    'Fremdschlüssel mit Aufräumen fehlt',
  );
});

test('Es gibt Indizes für Zeitpunkt, Status, Gast und Zugehörigkeit', () => {
  assert.match(sql, /create index if not exists private_memory_uploads_created_at_idx/i);
  assert.match(sql, /create index if not exists private_memory_uploads_status_idx/i);
  assert.match(sql, /create index if not exists private_memory_uploads_guest_idx/i);
  assert.match(sql, /create index if not exists private_memory_files_upload_idx/i);
});

test('Der Zeitstempel kann nicht vom Gast gefälscht werden', () => {
  assert.match(sql, /create trigger private_memory_uploads_set_created_at/i);
  assert.match(sql, /create trigger private_memory_files_set_created_at/i);
  assert.match(sql, /new\.created_at := now\(\)/i);
});

// =========================================================================
// Sicherheit
// =========================================================================

test('Für beide Tabellen gilt Row Level Security - auch für den Eigentümer', () => {
  for (const tabelle of ['private_memory_uploads', 'private_memory_files']) {
    assert.match(sql, new RegExp(`alter table public\\.${tabelle} enable row level security`, 'i'));
    assert.match(sql, new RegExp(`alter table public\\.${tabelle} force row level security`, 'i'));
  }
});

test('Gäste dürfen anlegen und eintragen, aber nichts lesen', () => {
  // Anlegen ist erlaubt ...
  assert.match(sql, /create policy "Gaeste duerfen Erinnerung anlegen"[\s\S]*?for insert[\s\S]*?to anon, authenticated/i);
  assert.match(sql, /create policy "Gaeste duerfen Datei eintragen"[\s\S]*?for insert[\s\S]*?to anon, authenticated/i);

  // ... Lesen ausdrücklich nicht: keine einzige select-Regel für anon.
  const leseregeln = [...sql.matchAll(/create policy "[^"]+"\s*\n\s*on public\.private_memory_\w+\s*\n\s*for select\s*\n\s*to ([^\n]+)/gi)];
  assert.ok(leseregeln.length > 0, 'Es gibt gar keine Leseregel');
  for (const regel of leseregeln) {
    assert.ok(
      !regel[1].includes('anon'),
      `Eine Leseregel gilt für anonyme Gäste: ${regel[0].slice(0, 80)}`,
    );
  }
});

test('Nur eingetragene Album-Admins dürfen lesen und löschen', () => {
  for (const name of [
    'Nur Admin liest Erinnerungen',
    'Nur Admin liest Erinnerungsdateien',
    'Nur Admin loescht Erinnerungen',
    'Nur Admin loescht Erinnerungsdateien',
  ]) {
    assert.match(
      sql,
      new RegExp(`create policy "${name}"[\\s\\S]{0,220}?is_album_admin\\(\\)`, 'i'),
      `Regel fehlt oder prüft den Admin nicht: ${name}`,
    );
  }
  // Die Admin-Logik kommt aus der vorhandenen Einrichtung.
  assert.match(missionSql, /create or replace function public\.is_album_admin/i);
});

test('Gäste dürfen nichts ändern', () => {
  // Es darf KEINE update-Regel geben - ohne Regel ist Ändern automatisch verboten.
  assert.ok(
    !/on public\.private_memory_\w+\s*\n\s*for update/i.test(sql),
    'Es gibt eine Änderungs-Regel für die privaten Erinnerungen',
  );
  assert.ok(
    !/grant[^;]*update[^;]*private_memory/i.test(sql),
    'Es wird ein Änderungsrecht vergeben',
  );
});

test('Die Tabellenrechte sind eng gefasst', () => {
  assert.match(sql, /revoke all on public\.private_memory_uploads from anon, authenticated/i);
  assert.match(sql, /revoke all on public\.private_memory_files\s+from anon, authenticated/i);
  assert.match(sql, /grant insert on public\.private_memory_uploads to anon, authenticated/i);
  // Lesen und Löschen nur für angemeldete Benutzer (und dort nochmals per RLS
  // auf eingetragene Admins begrenzt).
  assert.match(sql, /grant select, delete on public\.private_memory_uploads to authenticated/i);
  assert.ok(
    !/grant select[^;]*to anon/i.test(sql.replace(/--.*$/gm, '')),
    'Anonyme Gäste bekommen ein Leserecht',
  );
});

test('Der Upload-Abschluss zählt selbst nach', () => {
  assert.match(sql, /create or replace function public\.complete_memory_upload/i);
  assert.match(sql, /security definer/i);
  // Der Status darf nicht einfach vom Gast mitgeschickt werden.
  assert.match(sql, /count\(\*\) filter \(where media_type = 'photo'\)/i);
  assert.match(sql, /v_status := 'incomplete'/i);
  assert.match(
    sql,
    /grant execute on function public\.complete_memory_upload\(uuid, integer, integer\) to anon, authenticated/i,
  );
});

test('Ein neuer Upload startet immer als pending', () => {
  assert.match(
    sql,
    /create policy "Gaeste duerfen Erinnerung anlegen"[\s\S]*?status = 'pending'/i,
    'Ein Gast könnte sich selbst auf "complete" setzen',
  );
});

// =========================================================================
// Speicher
// =========================================================================

test('Der Bucket für die Erinnerungen ist privat', () => {
  assert.match(sql, /insert into storage\.buckets/i);
  assert.match(
    sql,
    /'private-memories',\s*\n?\s*'private-memories',\s*\n?\s*false/i,
    'Der Bucket wird als öffentlich angelegt',
  );
  assert.match(sql, /set public\s*=\s*false/i, 'Beim erneuten Ausführen bliebe der Bucket öffentlich');
  assert.equal(PARTY_CONFIG.supabase.memoriesBucket, 'private-memories');
});

test('Der Bucket begrenzt Größe und Dateitypen', () => {
  assert.match(sql, /file_size_limit/);
  assert.match(sql, /47185920/, '45 MB als Obergrenze fehlt');
  for (const typ of ['image/jpeg', 'image/heic', 'video/mp4', 'video/quicktime', 'video/webm']) {
    assert.ok(sql.includes(`'${typ}'`), `MIME-Typ fehlt: ${typ}`);
  }
  assert.ok(!/image\/svg/i.test(sql), 'SVG darf nicht erlaubt sein');
});

test('Gäste dürfen nur in den erwarteten Pfad hochladen', () => {
  assert.match(
    sql,
    /create policy "Gaeste duerfen Erinnerungen hochladen"[\s\S]*?bucket_id = 'private-memories'/i,
  );
  // Genau das Muster, das assets/js/lib/memories.js erzeugt.
  assert.match(sql, /\^uploads\/\[0-9\]\{4\}-\[0-9\]\{2\}-\[0-9\]\{2\}\//);
  assert.match(sql, /\(fotos\|videos\)/);
});

test('Nur Admins dürfen die Dateien sehen und löschen', () => {
  assert.match(
    sql,
    /create policy "Nur Admin sieht Erinnerungsdateien"[\s\S]*?for select\s*\n\s*to authenticated[\s\S]*?is_album_admin\(\)/i,
  );
  assert.match(
    sql,
    /create policy "Nur Admin loescht Dateien im Speicher"[\s\S]*?for delete\s*\n\s*to authenticated[\s\S]*?is_album_admin\(\)/i,
  );
  // Es darf KEINE Leseregel für anonyme Gäste auf storage.objects geben,
  // sonst könnten Gäste sich signierte Links erzeugen.
  const speicherLesen = [...sql.matchAll(/on storage\.objects\s*\n\s*for select\s*\n\s*to ([^\n]+)/gi)];
  for (const regel of speicherLesen) {
    assert.ok(!regel[1].includes('anon'), 'Anonyme Gäste dürfen Dateien lesen');
  }
});

// =========================================================================
// Die Foto-Mission bleibt unberührt
// =========================================================================

test('Die vorhandene Foto-Mission wird nicht angefasst', () => {
  const aktiv = sql
    .split('\n')
    .filter((zeile) => !zeile.trim().startsWith('--'))
    .join('\n');
  assert.ok(!/photo_submissions/i.test(aktiv), 'Die Tabelle der Foto-Mission wird verändert');
  assert.ok(
    !/insert into storage\.buckets[\s\S]{0,200}party-photos/i.test(aktiv),
    'Der Bucket der Foto-Mission wird verändert',
  );
  assert.ok(!/drop policy[^;]*party-photos/i.test(aktiv), 'Eine Regel der Foto-Mission wird entfernt');
});

test('Die Regeln der Foto-Mission gelten nicht für den neuen Bucket', () => {
  // Jede Speicher-Regel der Foto-Mission muss ihren Bucket beim Namen nennen.
  const regeln = [...missionSql.matchAll(/create policy "([^"]+)"\s*\n\s*on storage\.objects[\s\S]*?;/gi)];
  assert.ok(regeln.length >= 3, 'Es wurden keine Speicher-Regeln gefunden');
  for (const regel of regeln) {
    assert.ok(
      regel[0].includes("bucket_id = 'party-photos'"),
      `Diese Regel gilt für jeden Bucket: ${regel[1]}`,
    );
  }
});

test('Die gefährlichen Aufräum-Befehle sind auskommentiert', () => {
  for (const zeile of sql.split('\n')) {
    const trimmed = zeile.trim();
    assert.ok(
      !/^(drop table|delete from|drop policy if exists "Gaeste duerfen Fotos)/i.test(trimmed),
      `Dieser Befehl darf nicht aktiv sein: ${trimmed}`,
    );
  }
  assert.match(sql, /-- delete from public\.private_memory_uploads;/);
});

test('In der SQL-Datei steht kein Schlüssel und kein Passwort', () => {
  const ohneKommentare = sql.replace(/--.*$/gm, '');
  assert.ok(!/service_role/i.test(ohneKommentare));
  assert.ok(!/eyJ[A-Za-z0-9_-]{30,}/.test(sql));
  assert.ok(!/sb_secret_/i.test(sql));
});
