import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildStoragePath,
  effectiveMimeType,
  fileExtension,
  safeOriginalFilename,
  validateCompressedImage,
  validateImageFile,
} from '../assets/js/lib/validate.js';
import { fitWithin } from '../assets/js/lib/image.js';
import { PARTY_CONFIG } from '../config/party-config.js';

const LIMITS = PARTY_CONFIG.limits;

const file = (name, type, size = 1024) => ({ name, type, size });

test('Dateiendungen werden korrekt gelesen', () => {
  assert.equal(fileExtension('foto.JPG'), 'jpg');
  assert.equal(fileExtension('mein.foto.heic'), 'heic');
  assert.equal(fileExtension('ohneEndung'), '');
  assert.equal(fileExtension('endetMitPunkt.'), '');
});

test('Fehlt der MIME-Typ, hilft die Dateiendung weiter (typisch bei iPhones)', () => {
  assert.equal(effectiveMimeType(file('IMG_0001.HEIC', '')), 'image/heic');
  assert.equal(effectiveMimeType(file('IMG_0001.jpg', '')), 'image/jpeg');
  assert.equal(effectiveMimeType(file('egal.xyz', '')), '');
});

test('Normale Fotos werden angenommen', () => {
  for (const [name, type] of [
    ['foto.jpg', 'image/jpeg'],
    ['foto.png', 'image/png'],
    ['foto.webp', 'image/webp'],
    ['IMG_1234.HEIC', 'image/heic'],
  ]) {
    const result = validateImageFile(file(name, type, 2 * 1024 * 1024), LIMITS);
    assert.equal(result.valid, true, `${name} wurde abgelehnt: ${result.error}`);
  }
});

test('SVG wird abgelehnt (könnte Script enthalten)', () => {
  const result = validateImageFile(file('boese.svg', 'image/svg+xml'), LIMITS);
  assert.equal(result.valid, false);
  assert.match(result.error, /nicht erlaubt/);
});

test('HTML und ausführbare Dateien werden abgelehnt', () => {
  for (const [name, type] of [
    ['seite.html', 'text/html'],
    ['code.js', 'text/javascript'],
    ['programm.exe', 'application/octet-stream'],
    ['skript.php', 'application/x-php'],
    ['archiv.zip', 'application/zip'],
  ]) {
    assert.equal(validateImageFile(file(name, type), LIMITS).valid, false, `${name} kam durch`);
  }
});

test('Getarnte Dateien werden abgelehnt (Endung .svg, MIME image/jpeg)', () => {
  assert.equal(validateImageFile(file('trick.svg', 'image/jpeg'), LIMITS).valid, false);
});

test('Nicht unterstützte Bildformate werden mit klarer Meldung abgelehnt', () => {
  const result = validateImageFile(file('alt.tiff', 'image/tiff'), LIMITS);
  assert.equal(result.valid, false);
  assert.match(result.error, /nicht unterstützt/);
});

test('Zu große Dateien werden abgelehnt', () => {
  const result = validateImageFile(file('riesig.jpg', 'image/jpeg', 90 * 1024 * 1024), LIMITS);
  assert.equal(result.valid, false);
  assert.match(result.error, /zu groß/);
});

test('Leere Dateien werden abgelehnt', () => {
  const result = validateImageFile(file('leer.jpg', 'image/jpeg', 0), LIMITS);
  assert.equal(result.valid, false);
  assert.match(result.error, /leer/);
});

test('Fehlt die Datei ganz, gibt es eine verständliche Meldung', () => {
  const result = validateImageFile(null, LIMITS);
  assert.equal(result.valid, false);
  assert.match(result.error, /keine Datei/i);
});

test('Das fertig verkleinerte Bild wird noch einmal geprüft', () => {
  assert.equal(
    validateCompressedImage({ size: 1_000_000, type: 'image/jpeg' }, LIMITS).valid,
    true,
  );
  assert.equal(
    validateCompressedImage({ size: 20 * 1024 * 1024, type: 'image/jpeg' }, LIMITS).valid,
    false,
  );
  assert.equal(validateCompressedImage({ size: 0, type: 'image/jpeg' }, LIMITS).valid, false);
  assert.equal(validateCompressedImage(null, LIMITS).valid, false);
  assert.equal(
    validateCompressedImage({ size: 500, type: 'image/svg+xml' }, LIMITS).valid,
    false,
  );
});

// -------------------------------------------------------------------------
// Speicherpfade
// -------------------------------------------------------------------------

test('Speicherpfade sind zufällig und folgen dem erwarteten Muster', () => {
  const path = buildStoragePath({
    uuid: '4b1f2a3c-5d6e-4f70-8a9b-0c1d2e3f4a5b',
    mimeType: 'image/jpeg',
  });
  assert.equal(path, 'party/4b1f2a3c-5d6e-4f70-8a9b-0c1d2e3f4a5b.jpg');
  // Genau dieses Muster verlangt auch die Datenbank (siehe supabase/setup.sql).
  assert.match(path, /^(party|test)\/[0-9a-fA-F-]{36}\.(jpg|webp|png)$/);
});

test('Testfotos landen in einem eigenen Ordner', () => {
  const path = buildStoragePath({
    uuid: '4b1f2a3c-5d6e-4f70-8a9b-0c1d2e3f4a5b',
    mimeType: 'image/webp',
    isTest: true,
  });
  assert.equal(path, 'test/4b1f2a3c-5d6e-4f70-8a9b-0c1d2e3f4a5b.webp');
});

test('Der ursprüngliche Dateiname wird nie als Speicherpfad verwendet', () => {
  assert.throws(() => buildStoragePath({ uuid: '../../etc/passwd', mimeType: 'image/jpeg' }));
  assert.throws(() => buildStoragePath({ uuid: '', mimeType: 'image/jpeg' }));
  // Auch ein Versuch mit Schrägstrichen scheitert am Zeichenfilter.
  assert.throws(() =>
    buildStoragePath({ uuid: 'a/b/c', mimeType: 'image/jpeg' }),
  );
});

test('Der Original-Dateiname wird entschärft', () => {
  assert.equal(safeOriginalFilename('../../geheim.jpg'), '.._.._geheim.jpg');
  assert.equal(safeOriginalFilename('C:\\Users\\x\\foto.jpg'), 'C:_Users_x_foto.jpg');
  assert.equal(safeOriginalFilename('x'.repeat(300)).length, 120);
  assert.equal(safeOriginalFilename(null), '');
});

// -------------------------------------------------------------------------
// Bildgrößen
// -------------------------------------------------------------------------

test('Hochformat behält das Seitenverhältnis', () => {
  const result = fitWithin(3024, 4032, 2048);
  assert.equal(result.width, 1536);
  assert.equal(result.height, 2048);
  assert.equal(result.scaled, true);
  // Seitenverhältnis darf sich praktisch nicht ändern (keine Verzerrung).
  assert.ok(Math.abs(3024 / 4032 - result.width / result.height) < 0.002);
});

test('Querformat behält das Seitenverhältnis', () => {
  const result = fitWithin(4032, 3024, 2048);
  assert.equal(result.width, 2048);
  assert.equal(result.height, 1536);
  assert.ok(Math.abs(4032 / 3024 - result.width / result.height) < 0.002);
});

test('Sehr breite Panoramabilder werden nicht beschnitten', () => {
  const result = fitWithin(8000, 1000, 2048);
  assert.equal(result.width, 2048);
  assert.equal(result.height, 256);
  assert.ok(Math.abs(8 - result.width / result.height) < 0.02);
});

test('Kleine Bilder werden nicht vergrößert', () => {
  const result = fitWithin(800, 600, 2048);
  assert.deepEqual(result, { width: 800, height: 600, scaled: false });
});

test('Quadratische Bilder bleiben quadratisch', () => {
  const result = fitWithin(3000, 3000, 2048);
  assert.equal(result.width, result.height);
});

test('Winzige Bilder ergeben nie 0 Pixel', () => {
  const result = fitWithin(1, 5000, 100);
  assert.ok(result.width >= 1);
  assert.ok(result.height >= 1);
});
