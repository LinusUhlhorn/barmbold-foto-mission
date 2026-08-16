// Prüft den GitHub-Actions-Workflow und die Supabase-Einrichtung.
// So kann nichts versehentlich auf dem Webserver landen, das dort nicht hingehört.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { FTP_EXCLUDES, REQUIRED_FILES } from '../tools/deploy-manifest.js';
import { PARTY_CONFIG } from '../config/party-config.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

const WORKFLOW_PATH = '.github/workflows/deploy.yml';
const workflow = read(WORKFLOW_PATH);
const sql = read('supabase/setup.sql');

// =========================================================================
// Workflow
// =========================================================================

test('Der Workflow läuft bei einem Push auf main', () => {
  assert.match(workflow, /on:\s*\n\s*push:\s*\n\s*branches:\s*\n\s*-\s*main/);
});

test('Es wird genau die vorgegebene FTP-Action verwendet', () => {
  assert.match(workflow, /uses:\s*SamKirkland\/FTP-Deploy-Action@v4\.3\.5/);
});

test('Nur die drei vorhandenen FTP-Secrets werden verwendet', () => {
  const used = [...workflow.matchAll(/secrets\.([A-Z_]+)/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(used)].sort(), ['FTP_PASSWORD', 'FTP_SERVER', 'FTP_USERNAME']);
});

test('Im Workflow stehen keine Zugangsdaten im Klartext', () => {
  // Jeder der drei Werte darf ausschließlich über secrets. gesetzt werden.
  for (const key of ['server', 'username', 'password']) {
    const matches = [...workflow.matchAll(new RegExp(`^\\s*${key}:\\s*(.+)$`, 'gm'))];
    assert.ok(matches.length > 0, `${key} fehlt im Workflow`);
    for (const match of matches) {
      assert.match(
        match[1].trim(),
        /^\$\{\{\s*secrets\.[A-Z_]+\s*\}\}$/,
        `${key} steht nicht als Secret drin: ${match[1]}`,
      );
    }
  }
  assert.ok(!/ftp:\/\/[^\s]*:[^\s]*@/.test(workflow), 'Der Workflow enthält eine FTP-Adresse mit Passwort');
});

test('Secrets werden nirgends ausgegeben', () => {
  const echoLines = [...workflow.matchAll(/echo .*/g)].map((m) => m[0]);
  for (const line of echoLines) {
    assert.ok(!line.includes('secrets.'), `Diese Zeile gibt ein Secret aus: ${line}`);
  }
});

test('Tests und Build laufen, bevor hochgeladen wird', () => {
  assert.match(workflow, /run:\s*npm test/);
  assert.match(workflow, /run:\s*npm run build/);
  assert.match(workflow, /needs:\s*test/);
});

test('Die Node-Version im Workflow passt zu den Anforderungen des Projekts', () => {
  // Sonst läuft es lokal, scheitert aber in GitHub Actions - genau das ist
  // schon einmal passiert: Node 20 kann das Muster "tests/*.test.js" nicht
  // selbst auflösen, erst Node 22 kann es.
  const paket = JSON.parse(read('package.json'));
  const verlangt = Number(String(paket.engines.node).replace(/[^\d]/g, '').slice(0, 2));

  const match = workflow.match(/node-version:\s*'(\d+)'/);
  assert.ok(match, 'Im Workflow ist keine Node-Version festgelegt');
  const imWorkflow = Number(match[1]);

  assert.ok(
    imWorkflow >= verlangt,
    `Der Workflow nutzt Node ${imWorkflow}, das Projekt verlangt aber mindestens ${verlangt}`,
  );

  // Wird ein Muster an den Testlauf übergeben, muss Node es auflösen können.
  if (/--test\s+"[^"]*\*/.test(paket.scripts.test)) {
    assert.ok(
      verlangt >= 22,
      'Für Muster wie "tests/*.test.js" wird mindestens Node 22 benötigt',
    );
  }
});

test('Die Ausschlussliste im Workflow entspricht tools/deploy-manifest.js', () => {
  const block = workflow.match(/exclude:\s*\|\r?\n([\s\S]*?)(?=\r?\n\s*- name:)/);
  assert.ok(block, 'Im Workflow gibt es keine exclude-Liste');
  const inWorkflow = block[1]
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  assert.deepEqual(
    inWorkflow,
    FTP_EXCLUDES,
    'Workflow und tools/deploy-manifest.js weichen voneinander ab',
  );
});

test('Entwicklungsdateien werden vom Upload ausgeschlossen', () => {
  for (const muster of [
    '**/.git*',
    '**/.github/**',
    '**/.claude/**',
    '**/node_modules/**',
    '**/tests/**',
    '**/tools/**',
    '**/.env',
    '**/.env.*',
    '**/*.local',
    '**/supabase/**',
    '**/package.json',
  ]) {
    assert.ok(FTP_EXCLUDES.includes(muster), `Ausschluss fehlt: ${muster}`);
  }
});

test('Alles, was die Seite braucht, wird NICHT ausgeschlossen', () => {
  // Grobe Gegenprobe: kein Ausschlussmuster darf eine Pflichtdatei treffen.
  for (const file of REQUIRED_FILES) {
    for (const muster of FTP_EXCLUDES) {
      const regex = new RegExp(
        `^${muster
          .replace(/[.+^${}()|[\]\\]/g, '\\$&')
          .replace(/\*\*\//g, '(?:.*/)?')
          .replace(/\*\*/g, '.*')
          .replace(/\*/g, '[^/]*')}$`,
      );
      assert.ok(!regex.test(file), `"${muster}" würde ${file} ausschließen`);
    }
  }
});

test('Vorhandene Dateien auf dem Server werden nicht gelöscht', () => {
  assert.match(workflow, /dangerous-clean-slate:\s*false/);
});

test('Das Zielverzeichnis passt zur öffentlichen Adresse', () => {
  // Der wichtigste Zusammenhang im ganzen Projekt: Der Ordner, in den
  // hochgeladen wird, muss zu der Adresse passen, aus der der QR-Code
  // erzeugt wird. Sonst zeigen die gedruckten Karten ins Leere.
  const match = workflow.match(/^\s*server-dir:\s*(\S+)\s*$/m);
  assert.ok(match, 'server-dir fehlt im Workflow');
  const serverDir = match[1].replace(/^\.\//, '').replace(/\/$/, '');

  const urlPath = new URL(PARTY_CONFIG.party.publicUrl).pathname.replace(/^\/|\/$/g, '');
  if (urlPath === '') {
    assert.equal(serverDir, '', 'Die App soll im Wurzelverzeichnis liegen');
  } else {
    assert.ok(
      serverDir.endsWith(urlPath),
      `Upload nach "${serverDir}", aber der QR-Code zeigt auf "/${urlPath}/"`,
    );
  }
});

test('Die öffentliche Adresse endet mit einem Schrägstrich', () => {
  // Ohne den abschließenden Schrägstrich lädt der Browser in einem
  // Unterordner die relativen Dateien aus dem falschen Verzeichnis.
  assert.match(PARTY_CONFIG.party.publicUrl, /\/$/);
  assert.match(PARTY_CONFIG.party.publicUrl, /^https:\/\//, 'Die Adresse muss über https laufen');
});

test('Alle Seiten verwenden ausschließlich relative Pfade', () => {
  // Nur so funktioniert die App auch in einem Unterordner.
  for (const page of ['index.html', 'qr-print.html', 'album/index.html']) {
    const html = read(page);
    const absolute = [...html.matchAll(/(?:href|src)="(\/[^/][^"]*)"/g)].map((m) => m[1]);
    assert.deepEqual(absolute, [], `${page} nutzt absolute Pfade: ${absolute.join(', ')}`);
  }
  for (const script of ['assets/js/app.js', 'assets/js/album.js', 'assets/js/qr-print.js']) {
    const code = read(script);
    const absolute = [...code.matchAll(/from '(\/[^']+)'/g)].map((m) => m[1]);
    assert.deepEqual(absolute, [], `${script} importiert absolut: ${absolute.join(', ')}`);
  }
});

test('Die drei Adressen werden im Workflow genannt', () => {
  assert.match(workflow, /\/album\//);
  assert.match(workflow, /qr-print\.html/);
});

// =========================================================================
// Ignorierte Dateien
// =========================================================================

test('Die .gitignore schützt Zugangsdaten und Gästefotos', () => {
  const ignore = read('.gitignore');
  for (const eintrag of ['node_modules/', '.env', '*.jpg', '*.jpeg', '*.png', '*.heic', 'dist/']) {
    assert.ok(ignore.includes(eintrag), `.gitignore fehlt: ${eintrag}`);
  }
});

test('Im Projekt liegt kein einziges Gästefoto', () => {
  const bilder = [];
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === 'dist') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(jpe?g|png|webp|heic|heif|avif)$/i.test(entry.name)) bilder.push(full);
    }
  })(ROOT);
  assert.deepEqual(bilder, [], `Bilddateien im Repository: ${bilder.join(', ')}`);
});

// =========================================================================
// Supabase
// =========================================================================

test('Die SQL-Datei aktiviert Row Level Security', () => {
  assert.match(sql, /alter table public\.photo_submissions enable row level security/i);
  assert.match(sql, /alter table public\.album_admins enable row level security/i);
  assert.match(sql, /force row level security/i);
});

test('Gäste dürfen hochladen und echte Feierfotos sehen, aber nichts löschen', () => {
  assert.match(sql, /create policy "Gaeste duerfen eintragen"[\s\S]*?for insert[\s\S]*?to anon/i);
  assert.match(sql, /create policy "Oeffentliche Galerie darf lesen"[\s\S]*?for select[\s\S]*?using \(not is_test\)/i);
  const anonDelete = [...sql.matchAll(/create policy[\s\S]*?;/g)].find(
    (m) => /to anon/.test(m[0]) && /for delete/i.test(m[0]),
  );
  assert.equal(anonDelete, undefined, 'Anonyme Gäste dürfen Fotos löschen');
});

test('Löschen und Testfotos bleiben auf eingetragene Admins begrenzt', () => {
  assert.match(sql, /create policy "Nur Admin darf lesen"[\s\S]*?is_album_admin\(\)/i);
  assert.match(sql, /create policy "Nur Admin darf loeschen"[\s\S]*?is_album_admin\(\)/i);
  assert.match(sql, /create policy "Galerie darf Feierfotos ansehen"[\s\S]*?name like 'party\/%'/i);
  assert.ok(!/Galerie darf Feierfotos ansehen[\s\S]*?test\/%/.test(sql));
});

test('Der Speicher-Bucket ist nicht öffentlich', () => {
  assert.match(sql, /insert into storage\.buckets/i);
  assert.match(sql, /'party-photos',\s*\n?\s*false/, 'Der Bucket ist als öffentlich angelegt');
  assert.match(sql, /set public\s*=\s*false/i, 'Beim erneuten Ausführen bleibt der Bucket öffentlich');
});

test('Der Bucket begrenzt Dateigröße und Dateitypen', () => {
  assert.match(sql, /file_size_limit/);
  assert.match(sql, /allowed_mime_types/);
  assert.match(sql, /array\['image\/jpeg',\s*'image\/webp',\s*'image\/png'\]/);
  assert.ok(!/image\/svg/i.test(sql), 'SVG darf nicht erlaubt sein');
});

test('Speicherpfade werden auf zufällige UUIDs eingeschränkt', () => {
  // Das gleiche Muster wie in assets/js/lib/validate.js
  const treffer = sql.match(/\^\(party\|test\)\/\[0-9a-fA-F-\]\{36\}/g);
  assert.ok(treffer && treffer.length >= 2, 'Das Pfadmuster fehlt in Tabelle oder Speicher');
});

test('Die Tabelle hat alle geforderten Spalten', () => {
  for (const spalte of [
    'id',
    'guest_name',
    'mission_id',
    'mission_title',
    'mission_category',
    'storage_path',
    'original_filename',
    'mime_type',
    'file_size',
    'width',
    'height',
    'is_bonus',
    'is_test',
    'device_submission_id',
    'created_at',
  ]) {
    assert.match(sql, new RegExp(`^\\s+${spalte}\\s`, 'm'), `Spalte fehlt: ${spalte}`);
  }
});

test('Doppelte Uploads werden von der Datenbank verhindert', () => {
  assert.match(sql, /device_submission_id\s+uuid\s+not null unique/i);
  assert.match(sql, /storage_path\s+text\s+not null unique/i);
});

test('Es gibt Indizes für Zeitleiste, Filter und Testfotos', () => {
  assert.match(sql, /create index if not exists photo_submissions_created_at_idx/i);
  assert.match(sql, /create index if not exists photo_submissions_mission_idx/i);
  assert.match(sql, /create index if not exists photo_submissions_category_idx/i);
  assert.match(sql, /create index if not exists photo_submissions_is_test_idx/i);
});

test('Der Zeitstempel kann nicht vom Gast gefälscht werden', () => {
  assert.match(sql, /create trigger photo_submissions_set_created_at/i);
  assert.match(sql, /new\.created_at := now\(\)/i);
});

test('In der SQL-Datei steht kein echter Schlüssel und kein echtes Passwort', () => {
  assert.ok(!/service_role/i.test(sql.replace(/--.*$/gm, '')), 'Service-Role-Key erwähnt');
  assert.ok(!/eyJ[A-Za-z0-9_-]{30,}/.test(sql));
});

test('Die gefährlichen Aufräum-Befehle sind auskommentiert', () => {
  for (const zeile of sql.split('\n')) {
    const trimmed = zeile.trim();
    if (/^(drop table|delete from)/i.test(trimmed)) {
      assert.fail(`Dieser Befehl darf nicht aktiv sein: ${trimmed}`);
    }
  }
  // Sie müssen aber als Anleitung vorhanden sein.
  assert.match(sql, /-- delete from public\.photo_submissions where is_test;/);
});
