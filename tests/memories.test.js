// Prüft die Logik der privaten Erinnerungen ("Für Britta & Lutz").
//
// Die Grenzen (20 Fotos, 5 Videos, 15/45 MB) sind der Kern dieses Bereichs.
// Deshalb werden hier genau die Fälle geprüft, die auf der Feier vorkommen.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_MEMORY_LIMITS,
  addMemoryFiles,
  berlinParts,
  buildMemoryFilePath,
  buildMemoryFolder,
  buildStoredFilename,
  counterText,
  detectMediaKind,
  exportFolderName,
  fileExtension,
  limitMessage,
  limitReachedText,
  memoryMessageFile,
  memoryOverviewCsv,
  slugifyGuestName,
  summarizeMemoryFiles,
  validateMemoryFile,
  validateMemoryMessage,
} from '../assets/js/lib/memories.js';
import { PARTY_CONFIG } from '../config/party-config.js';

const LIMITS = PARTY_CONFIG.memories.limits;
const UUID = '550e8400-e29b-41d4-a716-446655440000';

/** Baut eine Datei, wie sie der Browser liefern würde. */
function datei(name, type, size, lastModified = 1) {
  return { name, type, size, lastModified };
}

function fotos(anzahl, ab = 1) {
  return Array.from({ length: anzahl }, (_, i) =>
    datei(`foto-${ab + i}.jpg`, 'image/jpeg', 1024, ab + i),
  );
}

function videos(anzahl, ab = 1) {
  return Array.from({ length: anzahl }, (_, i) =>
    datei(`video-${ab + i}.mp4`, 'video/mp4', 2048, 100 + ab + i),
  );
}

// =========================================================================
// Dateitypen
// =========================================================================

test('Fotos und Videos werden am MIME-Typ erkannt', () => {
  assert.equal(detectMediaKind(datei('a.jpg', 'image/jpeg', 10), LIMITS), 'photo');
  assert.equal(detectMediaKind(datei('a.png', 'image/png', 10), LIMITS), 'photo');
  assert.equal(detectMediaKind(datei('a.webp', 'image/webp', 10), LIMITS), 'photo');
  assert.equal(detectMediaKind(datei('a.heic', 'image/heic', 10), LIMITS), 'photo');
  assert.equal(detectMediaKind(datei('a.mp4', 'video/mp4', 10), LIMITS), 'video');
  assert.equal(detectMediaKind(datei('a.mov', 'video/quicktime', 10), LIMITS), 'video');
  assert.equal(detectMediaKind(datei('a.webm', 'video/webm', 10), LIMITS), 'video');
});

test('Ohne brauchbaren MIME-Typ entscheidet die Dateiendung', () => {
  // Genau das liefern iPhones bei .mov und .heic regelmäßig.
  assert.equal(detectMediaKind(datei('IMG_0001.MOV', '', 10), LIMITS), 'video');
  assert.equal(detectMediaKind(datei('IMG_0002.HEIC', '', 10), LIMITS), 'photo');
  assert.equal(detectMediaKind(datei('film.mp4', 'application/octet-stream', 10), LIMITS), 'video');
});

test('Alles andere wird abgelehnt', () => {
  for (const [name, type] of [
    ['böse.svg', 'image/svg+xml'],
    ['seite.html', 'text/html'],
    ['skript.js', 'application/javascript'],
    ['musik.mp3', 'audio/mpeg'],
    ['dokument.pdf', 'application/pdf'],
    ['datei.xyz', ''],
  ]) {
    assert.equal(detectMediaKind(datei(name, type, 10), LIMITS), null, `${name} darf nicht durch`);
  }
});

test('Nicht unterstützte Dateien werden mit Namen benannt', () => {
  const check = validateMemoryFile(datei('dateiname.xyz', '', 10), LIMITS);
  assert.equal(check.valid, false);
  assert.equal(check.error, 'Der Dateityp von „dateiname.xyz“ wird nicht unterstützt.');
});

test('Zu große Fotos und Videos werden einzeln benannt', () => {
  const foto = validateMemoryFile(
    datei('dateiname.jpg', 'image/jpeg', 16 * 1024 * 1024),
    LIMITS,
  );
  assert.equal(foto.valid, false);
  assert.equal(foto.error, 'Das Foto „dateiname.jpg“ ist größer als 15 MB.');

  const video = validateMemoryFile(
    datei('dateiname.mov', 'video/quicktime', 46 * 1024 * 1024),
    LIMITS,
  );
  assert.equal(video.valid, false);
  assert.equal(video.error, 'Das Video „dateiname.mov“ ist größer als 45 MB.');
});

test('Genau auf der Grenze ist noch erlaubt', () => {
  assert.equal(
    validateMemoryFile(datei('a.jpg', 'image/jpeg', 15 * 1024 * 1024), LIMITS).valid,
    true,
  );
  assert.equal(
    validateMemoryFile(datei('a.mp4', 'video/mp4', 45 * 1024 * 1024), LIMITS).valid,
    true,
  );
});

test('Die Dateiendung wird sauber gelesen', () => {
  assert.equal(fileExtension('foto.JPG'), 'jpg');
  assert.equal(fileExtension('mein.foto.jpeg'), 'jpeg');
  assert.equal(fileExtension('ohne-endung'), '');
  assert.equal(fileExtension('punkt.'), '');
});

// =========================================================================
// Grenzen: 20 Fotos, 5 Videos
// =========================================================================

test('Bis zu 20 Fotos lassen sich auswählen', () => {
  const ergebnis = addMemoryFiles([], fotos(20), LIMITS);
  assert.equal(ergebnis.added, 20);
  assert.deepEqual(ergebnis.messages, []);
  assert.equal(summarizeMemoryFiles(ergebnis.files).photoCount, 20);
});

test('Das 21. Foto wird mit verständlicher Meldung abgelehnt', () => {
  const voll = addMemoryFiles([], fotos(20), LIMITS);
  const ergebnis = addMemoryFiles(voll.files, fotos(1, 21), LIMITS);
  assert.equal(ergebnis.added, 0);
  assert.equal(summarizeMemoryFiles(ergebnis.files).photoCount, 20);
  assert.equal(
    ergebnis.messages[0],
    'Du kannst höchstens 20 Fotos hochladen. Du hast bereits 20 Fotos ausgewählt.',
  );
});

test('Bis zu 5 Videos lassen sich auswählen', () => {
  const ergebnis = addMemoryFiles([], videos(5), LIMITS);
  assert.equal(ergebnis.added, 5);
  assert.deepEqual(ergebnis.messages, []);
});

test('Das 6. Video wird mit verständlicher Meldung abgelehnt', () => {
  const voll = addMemoryFiles([], videos(5), LIMITS);
  const ergebnis = addMemoryFiles(voll.files, videos(1, 6), LIMITS);
  assert.equal(ergebnis.added, 0);
  assert.equal(summarizeMemoryFiles(ergebnis.files).videoCount, 5);
  assert.equal(
    ergebnis.messages[0],
    'Du kannst höchstens 5 Videos hochladen. Du hast bereits 5 Videos ausgewählt.',
  );
});

test('Bei 18 Fotos werden 2 von 5 aufgenommen und der Rest erklärt', () => {
  // Der Fall aus der Anforderung: nichts wird stillschweigend verworfen.
  const bisher = addMemoryFiles([], fotos(18), LIMITS);
  const ergebnis = addMemoryFiles(bisher.files, fotos(5, 19), LIMITS);
  assert.equal(ergebnis.added, 2, 'Es müssen genau 2 Fotos dazukommen');
  assert.equal(summarizeMemoryFiles(ergebnis.files).photoCount, 20);
  assert.equal(
    ergebnis.messages[0],
    'Du kannst höchstens 20 Fotos hochladen. Du hast bereits 20 Fotos ausgewählt.',
  );
});

test('Der Hinweistext nennt den verbleibenden Platz', () => {
  assert.equal(
    limitMessage('photo', 18, LIMITS),
    'Du kannst höchstens 20 Fotos hochladen. Du hast bereits 18 Fotos ausgewählt und kannst noch 2 hinzufügen.',
  );
  assert.equal(
    limitMessage('video', 4, LIMITS),
    'Du kannst höchstens 5 Videos hochladen. Du hast bereits 4 Videos ausgewählt und kannst noch 1 hinzufügen.',
  );
});

test('Fotos und Videos begrenzen sich nicht gegenseitig', () => {
  const ergebnis = addMemoryFiles([], [...fotos(20), ...videos(5)], LIMITS);
  assert.equal(ergebnis.added, 25);
  const zusammen = summarizeMemoryFiles(ergebnis.files);
  assert.equal(zusammen.photoCount, 20);
  assert.equal(zusammen.videoCount, 5);
});

test('Dieselbe Datei landet nicht doppelt in der Liste', () => {
  const einmal = addMemoryFiles([], fotos(1), LIMITS);
  const nochmal = addMemoryFiles(einmal.files, fotos(1), LIMITS);
  assert.equal(nochmal.added, 0);
  assert.match(nochmal.messages[0], /ist schon in der Liste/);
});

test('Fehlerhafte Dateien kommen nicht in die Liste', () => {
  const ergebnis = addMemoryFiles(
    [],
    [
      datei('gut.jpg', 'image/jpeg', 1024),
      datei('zu-gross.jpg', 'image/jpeg', 20 * 1024 * 1024),
      datei('falsch.xyz', '', 1024),
    ],
    LIMITS,
  );
  assert.equal(ergebnis.added, 1);
  assert.equal(ergebnis.files.length, 1);
  assert.equal(ergebnis.messages.length, 2);
});

test('Die Zähler sind eindeutig formuliert', () => {
  assert.equal(counterText('photo', 0, LIMITS), 'Fotos: 0 von 20 ausgewählt');
  assert.equal(counterText('photo', 7, LIMITS), 'Fotos: 7 von 20 ausgewählt');
  assert.equal(counterText('video', 2, LIMITS), 'Videos: 2 von 5 ausgewählt');
  assert.equal(limitReachedText('photo', LIMITS), 'Du hast das Limit von 20 Fotos erreicht.');
  assert.equal(limitReachedText('video', LIMITS), 'Du hast das Limit von 5 Videos erreicht.');
});

test('Die Zusammenfassung zählt Anzahl und Gesamtgröße', () => {
  const ergebnis = addMemoryFiles([], [...fotos(3), ...videos(2)], LIMITS);
  const zusammen = summarizeMemoryFiles(ergebnis.files);
  assert.equal(zusammen.photoCount, 3);
  assert.equal(zusammen.videoCount, 2);
  assert.equal(zusammen.count, 5);
  assert.equal(zusammen.totalBytes, 3 * 1024 + 2 * 2048);
});

// =========================================================================
// Speicherpfade
// =========================================================================

test('Gästenamen werden für den Speicherpfad sicher bereinigt', () => {
  assert.equal(slugifyGuestName('Linus Uhlhorn'), 'linus-uhlhorn');
  assert.equal(slugifyGuestName('Jörg Müller'), 'joerg-mueller');
  assert.equal(slugifyGuestName('Renée'), 'renee');
  assert.equal(slugifyGuestName('Straßer'), 'strasser');
  assert.equal(slugifyGuestName(''), 'gast');
  assert.equal(slugifyGuestName('   '), 'gast');
});

test('Aus einem Namen kann kein Pfad-Ausbruch werden', () => {
  for (const boese of ['../../etc/passwd', 'a/b/c', '..', './..', '<script>', 'a\\b']) {
    const slug = slugifyGuestName(boese);
    assert.ok(!slug.includes('/'), `Schrägstrich in "${slug}"`);
    assert.ok(!slug.includes('\\'), `Backslash in "${slug}"`);
    assert.ok(!slug.includes('..'), `Punkte in "${slug}"`);
    assert.match(slug, /^[a-z0-9-]+$/, `Ungültiger Slug: ${slug}`);
  }
});

test('Jeder Upload bekommt einen eigenen Ordner mit Datum, Uhrzeit und UUID', () => {
  const ordner = buildMemoryFolder({
    guestName: 'Linus Uhlhorn',
    uploadId: UUID,
    // 20:14:35 deutscher Sommerzeit = 18:14:35 UTC
    at: new Date('2026-08-29T18:14:35Z'),
  });
  assert.equal(ordner, `uploads/2026-08-29/20-14-35__linus-uhlhorn__${UUID}`);
});

test('Die Uhrzeit im Ordner ist deutsche Zeit', () => {
  // Winterzeit: UTC+1
  const winter = buildMemoryFolder({
    guestName: 'Test',
    uploadId: UUID,
    at: new Date('2026-01-15T22:30:00Z'),
  });
  assert.match(winter, /^uploads\/2026-01-15\/23-30-00__test__/);

  // Sommerzeit: UTC+2, der Tageswechsel muss stimmen
  const sommer = buildMemoryFolder({
    guestName: 'Test',
    uploadId: UUID,
    at: new Date('2026-08-29T22:30:00Z'),
  });
  assert.match(sommer, /^uploads\/2026-08-30\/00-30-00__test__/);
});

test('Ohne gültige UUID entsteht kein Ordner', () => {
  assert.throws(() => buildMemoryFolder({ guestName: 'Test', uploadId: 'abc' }));
  assert.throws(() => buildMemoryFolder({ guestName: 'Test', uploadId: '' }));
});

test('Derselbe Gast bekommt beim zweiten Mal einen neuen Ordner', () => {
  const erster = buildMemoryFolder({
    guestName: 'Anna',
    uploadId: UUID,
    at: new Date('2026-08-29T18:14:35Z'),
  });
  const zweiter = buildMemoryFolder({
    guestName: 'Anna',
    uploadId: '11111111-2222-4333-8444-555555555555',
    at: new Date('2026-08-29T19:03:12Z'),
  });
  assert.notEqual(erster, zweiter);
});

test('Fotos und Videos liegen in getrennten Unterordnern', () => {
  const ordner = `uploads/2026-08-29/20-14-35__anna__${UUID}`;
  assert.equal(
    buildMemoryFilePath({ folder: ordner, kind: 'photo', index: 1, originalName: 'IMG_1.jpg' }),
    `${ordner}/fotos/01_foto.jpg`,
  );
  assert.equal(
    buildMemoryFilePath({ folder: ordner, kind: 'video', index: 2, originalName: 'IMG_2.MOV' }),
    `${ordner}/videos/02_video.mov`,
  );
});

test('Der gespeicherte Dateiname übernimmt niemals den Originalnamen', () => {
  assert.equal(
    buildStoredFilename({ kind: 'photo', index: 3, originalName: '../../böse datei.png' }),
    '03_foto.png',
  );
  // Unbekannte Endung: es wird eine sichere Vorgabe verwendet.
  assert.equal(buildStoredFilename({ kind: 'photo', index: 1, originalName: 'x.svg' }), '01_foto.jpg');
  assert.equal(buildStoredFilename({ kind: 'video', index: 1, originalName: 'x' }), '01_video.mp4');
});

test('Alle Dateien eines Uploads liegen im selben Ordner', () => {
  const ordner = buildMemoryFolder({ guestName: 'Anna', uploadId: UUID });
  const pfade = [
    buildMemoryFilePath({ folder: ordner, kind: 'photo', index: 1, originalName: 'a.jpg' }),
    buildMemoryFilePath({ folder: ordner, kind: 'photo', index: 2, originalName: 'b.png' }),
    buildMemoryFilePath({ folder: ordner, kind: 'video', index: 1, originalName: 'c.mp4' }),
  ];
  for (const pfad of pfade) {
    assert.ok(pfad.startsWith(`${ordner}/`), `${pfad} gehört nicht zum Ordner`);
  }
});

test('Die Pfade passen zum Muster der Speicher-Regel', () => {
  // Dasselbe Muster steht in supabase/private-memories.sql.
  const muster =
    /^uploads\/\d{4}-\d{2}-\d{2}\/\d{2}-\d{2}-\d{2}__[a-z0-9-]{1,40}__[0-9a-f-]{36}\/(fotos|videos)\/\d{2}_(foto|video)\.[a-z0-9]{2,4}$/;
  const ordner = buildMemoryFolder({ guestName: 'Jörg Müller', uploadId: UUID });
  for (const kind of ['photo', 'video']) {
    const pfad = buildMemoryFilePath({ folder: ordner, kind, index: 1, originalName: 'a.jpg' });
    assert.match(pfad, muster, `Pfad passt nicht: ${pfad}`);
  }
});

// =========================================================================
// Nachricht und Export
// =========================================================================

test('Die persönliche Nachricht ist begrenzt und wird bereinigt', () => {
  const gut = validateMemoryMessage('Alles Gute euch beiden!\nEuer Max', LIMITS);
  assert.equal(gut.valid, true);
  assert.match(gut.value, /Alles Gute/);
  // Zeilenumbrüche bleiben erhalten.
  assert.ok(gut.value.includes('\n'));

  const zuLang = validateMemoryMessage('x'.repeat(1200), LIMITS);
  assert.equal(zuLang.valid, false);
  assert.equal(zuLang.value.length, 1000);
});

test('Der Exportordner enthält Datum, Uhrzeit und Namen', () => {
  const name = exportFolderName({
    guest_name: 'Linus Uhlhorn',
    storage_folder: `uploads/2026-08-29/20-14-35__linus-uhlhorn__${UUID}`,
    created_at: '2026-08-29T18:14:35Z',
  });
  assert.equal(name, '2026-08-29_20-14-35_Linus-Uhlhorn');
});

test('Die CSV-Übersicht enthält alle geforderten Spalten', () => {
  const csv = memoryOverviewCsv([
    {
      guest_name: 'Linus Uhlhorn',
      message: 'Ein "schöner" Abend;\nmit Zeilenumbruch',
      created_at: '2026-08-29T18:14:35Z',
      photo_count: 12,
      video_count: 2,
      total_size: 148 * 1024 * 1024,
      storage_folder: `uploads/2026-08-29/20-14-35__linus-uhlhorn__${UUID}`,
      status: 'complete',
    },
  ]);
  const zeilen = csv.split('\r\n');
  for (const spalte of [
    'Name',
    'Nachricht',
    'Datum',
    'Uhrzeit',
    'Anzahl Fotos',
    'Anzahl Videos',
    'Gesamtgröße',
    'Ordnername',
  ]) {
    assert.ok(zeilen[0].includes(spalte), `Spalte fehlt: ${spalte}`);
  }
  // Anführungszeichen und Semikolon dürfen die Tabelle nicht zerreißen.
  assert.equal(zeilen[1].split('";"').length, 9);
  assert.ok(zeilen[1].includes('""schöner""'));
  assert.ok(!zeilen[1].includes('\n'));
});

test('Nachricht.txt beschreibt den Upload verständlich', () => {
  const text = memoryMessageFile({
    guest_name: 'Anna',
    message: 'Herzlichen Glückwunsch!',
    created_at: '2026-08-29T18:14:35Z',
    photo_count: 3,
    video_count: 1,
  });
  assert.match(text, /Von: Anna/);
  assert.match(text, /2026-08-29 um 20:14:35 Uhr/);
  assert.match(text, /Fotos: 3/);
  assert.match(text, /Herzlichen Glückwunsch!/);

  const ohne = memoryMessageFile({ guest_name: 'Bert', created_at: '2026-08-29T18:14:35Z' });
  assert.match(ohne, /\(keine persönliche Nachricht\)/);
});

test('Die deutsche Zeitzone wird für Datum und Uhrzeit verwendet', () => {
  const teile = berlinParts('2026-08-29T18:14:35Z');
  assert.equal(teile.date, '2026-08-29');
  assert.equal(teile.time, '20-14-35');
});

test('Die Standardgrenzen passen zur Konfiguration', () => {
  assert.equal(DEFAULT_MEMORY_LIMITS.maxPhotos, LIMITS.maxPhotos);
  assert.equal(DEFAULT_MEMORY_LIMITS.maxVideos, LIMITS.maxVideos);
  assert.equal(DEFAULT_MEMORY_LIMITS.maxPhotoBytes, LIMITS.maxPhotoBytes);
  assert.equal(DEFAULT_MEMORY_LIMITS.maxVideoBytes, LIMITS.maxVideoBytes);
});
