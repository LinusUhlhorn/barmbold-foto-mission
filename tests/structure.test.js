// Prüft den Aufbau der Seiten: Verweise, Barrierefreiheit, Sicherheit.
// Diese Tests fangen typische Tippfehler ab, die man im Browser erst spät merkt.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

const PAGES = {
  'index.html': 'assets/js/app.js',
  'album/index.html': 'assets/js/album.js',
  'qr-print.html': 'assets/js/qr-print.js',
};

// =========================================================================
// Verweise
// =========================================================================

test('Alle Verweise in den HTML-Seiten zeigen auf vorhandene Dateien', () => {
  for (const page of Object.keys(PAGES)) {
    const html = read(page);
    const baseDir = path.dirname(path.join(ROOT, page));
    const references = [...html.matchAll(/(?:href|src)="([^"]+)"/g)].map((m) => m[1]);
    for (const reference of references) {
      if (/^(https?:|data:|mailto:|#)/.test(reference) || reference === './') continue;
      const target = path.resolve(baseDir, reference.split('?')[0]);
      assert.ok(fs.existsSync(target), `${page}: "${reference}" gibt es nicht`);
    }
  }
});

test('Jeder data-Haken aus dem JavaScript kommt auch im HTML vor', () => {
  // Das fängt Tippfehler wie data-logout" ab, die sonst still fehlschlagen.
  for (const [page, script] of Object.entries(PAGES)) {
    const html = read(page);
    const code = read(script);
    const hooks = new Set(
      [...code.matchAll(/\[data-([a-z0-9-]+)[\]=]/g)].map((m) => m[1]),
    );
    for (const hook of hooks) {
      assert.ok(
        html.includes(`data-${hook}`),
        `${script} sucht "data-${hook}", aber ${page} hat es nicht`,
      );
    }
  }
});

test('Keine Seite lädt Dateien von fremden Servern nach', () => {
  // Keine CDN-Skripte, keine externen Schriften, kein Tracking.
  for (const page of Object.keys(PAGES)) {
    const html = read(page);
    const external = [...html.matchAll(/(?:href|src)="(https?:\/\/[^"]+)"/g)].map((m) => m[1]);
    assert.deepEqual(external, [], `${page} lädt von außen: ${external.join(', ')}`);
  }
});

test('Es gibt keine Spuren von Tracking oder Werbung', () => {
  const verboten = [
    'google-analytics',
    'googletagmanager',
    'gtag(',
    'fbq(',
    'facebook.net',
    'hotjar',
    'matomo',
    'plausible.io',
    'fonts.googleapis.com',
    'cdn.jsdelivr.net',
    'unpkg.com',
    'cdnjs.cloudflare.com',
  ];
  for (const page of [...Object.keys(PAGES), ...Object.values(PAGES)]) {
    const source = read(page).toLowerCase();
    for (const begriff of verboten) {
      assert.ok(!source.includes(begriff), `${page} enthält "${begriff}"`);
    }
  }
});

// =========================================================================
// Sicherheit
// =========================================================================

test('Es wird nirgends innerHTML oder ähnliches verwendet', () => {
  // Gästenamen werden ausschließlich über textContent gesetzt.
  const jsFiles = [];
  (function collect(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) collect(full);
      else if (entry.name.endsWith('.js')) jsFiles.push(full);
    }
  })(path.join(ROOT, 'assets', 'js'));

  for (const file of jsFiles) {
    // Kommentare herausnehmen: dort darf der Begriff als Erklärung stehen.
    const source = fs
      .readFileSync(file, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');
    const relative = path.relative(ROOT, file);
    for (const gefaehrlich of ['innerHTML', 'outerHTML', 'insertAdjacentHTML', 'document.write']) {
      assert.ok(!source.includes(gefaehrlich), `${relative} verwendet ${gefaehrlich}`);
    }
    assert.ok(!/\beval\s*\(/.test(source), `${relative} verwendet eval()`);
  }
});

test('Im Frontend steht kein geheimer Schlüssel', () => {
  const files = [
    'config/party-config.js',
    'assets/js/app.js',
    'assets/js/album.js',
    'assets/js/lib/supabase-rest.js',
    ...Object.keys(PAGES),
  ];
  for (const file of files) {
    const source = read(file);
    assert.ok(!/service_role/i.test(source), `${file} erwähnt einen Service-Role-Key`);
    assert.ok(!/ftp:\/\/[^\s"']*:[^\s"']*@/i.test(source), `${file} enthält FTP-Zugangsdaten`);
  }
});

test('Die Seiten bitten Suchmaschinen, sie nicht aufzunehmen', () => {
  for (const page of Object.keys(PAGES)) {
    assert.match(read(page), /name="robots"[^>]*noindex/, `${page} fehlt noindex`);
  }
});

// =========================================================================
// Barrierefreiheit und Handy-Tauglichkeit
// =========================================================================

test('Jede Seite ist auf Deutsch ausgezeichnet und für Handys eingerichtet', () => {
  for (const page of Object.keys(PAGES)) {
    const html = read(page);
    assert.match(html, /<html lang="de">/, `${page}: lang fehlt`);
    assert.match(html, /name="viewport"/, `${page}: viewport fehlt`);
    assert.match(html, /viewport-fit=cover/, `${page}: viewport-fit für die Notch fehlt`);
    assert.match(html, /<meta charset="utf-8"/i, `${page}: charset fehlt`);
    assert.match(html, /<noscript>/, `${page}: Hinweis ohne JavaScript fehlt`);
  }
});

test('Meldungen werden an Screenreader weitergegeben', () => {
  for (const page of Object.keys(PAGES)) {
    assert.match(read(page), /aria-live="polite"/, `${page}: aria-live fehlt`);
  }
});

test('Die Hauptseiten haben einen Sprunglink zum Inhalt', () => {
  for (const page of ['index.html', 'album/index.html']) {
    assert.match(read(page), /class="skip-link"/, `${page}: Sprunglink fehlt`);
  }
});

test('Touch-Ziele sind mindestens 44 Pixel groß', () => {
  const css = read('assets/css/base.css');
  const touch = css.match(/--touch:\s*(\d+)px/);
  assert.ok(touch, '--touch ist nicht definiert');
  assert.ok(Number(touch[1]) >= 44, `Touch-Ziel ist nur ${touch[1]}px groß`);
  // Auch die kleinen Knöpfe halten die Grenze ein.
  const small = css.match(/\.btn--small\s*\{[^}]*min-height:\s*(\d+)px/);
  assert.ok(small, '.btn--small hat keine Mindesthöhe');
  assert.ok(Number(small[1]) >= 44, `.btn--small ist nur ${small[1]}px hoch`);
});

test('Das Attribut "hidden" wird nicht von eigenen display-Werten ausgehebelt', () => {
  // Ohne diese Regel bliebe z. B. der Knopf "Andere Mission ziehen" sichtbar,
  // weil .btn ein eigenes display: inline-flex mitbringt.
  const css = read('assets/css/base.css').replace(/\s+/g, ' ');
  assert.match(css, /\[hidden\] \{ display: none !important; \}/);
});

test('Reduzierte Bewegung wird überall berücksichtigt', () => {
  for (const file of ['assets/css/base.css', 'assets/css/app.css']) {
    assert.match(
      read(file),
      /@media \(prefers-reduced-motion: reduce\)/,
      `${file}: prefers-reduced-motion fehlt`,
    );
  }
  assert.match(read('assets/js/lib/dom.js'), /prefers-reduced-motion/);
});

test('Notch und abgerundete Ecken werden berücksichtigt', () => {
  assert.match(read('assets/css/base.css'), /env\(safe-area-inset-top\)/);
  assert.match(read('assets/css/base.css'), /env\(safe-area-inset-bottom\)/);
});

test('Eingabefelder lösen auf iPhones kein automatisches Zoomen aus', () => {
  // Schriftgröße unter 16px führt in Safari zum Hineinzoomen.
  const css = read('assets/css/base.css');
  const input = css.match(/\.field__input\s*\{[^}]*font-size:\s*(\d+)px/);
  assert.ok(input, '.field__input hat keine feste Schriftgröße');
  assert.ok(Number(input[1]) >= 16, `Schriftgröße ist nur ${input[1]}px`);
});

// =========================================================================
// Fotoaufnahme
// =========================================================================

test('Es gibt ein Kamerafeld und ein Galeriefeld', () => {
  const html = read('index.html');
  assert.match(html, /accept="image\/\*"[\s\S]{0,80}capture="environment"/, 'Kamerafeld fehlt');
  assert.match(html, /data-file-gallery/, 'Galeriefeld fehlt');
  // Das Galeriefeld darf KEIN capture haben, sonst öffnet iOS wieder die Kamera.
  const gallery = html.match(/<input[^>]*data-file-gallery[^>]*>/s);
  assert.ok(gallery, 'Galeriefeld nicht gefunden');
  assert.ok(!gallery[0].includes('capture'), 'Das Galeriefeld darf kein capture haben');
});

test('Die Einwilligung ist eine eigene Ankreuzmöglichkeit', () => {
  const html = read('index.html');
  assert.match(html, /data-consent/, 'Einwilligungs-Feld fehlt');
  assert.match(html, /data-text-privacy="notice"/, 'Datenschutzhinweis fehlt');
  assert.match(html, /data-text-privacy="peopleNotice"/, 'Hinweis zu abgebildeten Personen fehlt');
});

test('Der Upload-Knopf lässt sich gegen doppeltes Tippen sperren', () => {
  const code = read('assets/js/app.js');
  assert.match(code, /run\.uploading/, 'Es gibt keinen Schutz gegen mehrfaches Absenden');
  assert.match(code, /uploadButton\.disabled = true/);
});

test('Erfolg wird erst nach Upload UND Datenbankeintrag gemeldet', () => {
  const code = read('assets/js/app.js');
  const uploadIndex = code.indexOf('supabase.uploadPhoto');
  const insertIndex = code.indexOf('supabase.insertSubmission');
  const successIndex = code.indexOf('showSuccess(');
  assert.ok(uploadIndex > 0 && insertIndex > uploadIndex, 'Reihenfolge stimmt nicht');
  assert.ok(
    code.lastIndexOf('showSuccess(result.duplicate)') > insertIndex,
    'Der Erfolg wird zu früh gemeldet',
  );
  assert.ok(successIndex > 0);
});

// =========================================================================
// Album
// =========================================================================

test('Das Album bietet alle geforderten Funktionen an', () => {
  const html = read('album/index.html');
  for (const hook of [
    'data-login-form',
    'data-logout',
    'data-filter-search',
    'data-filter-mission',
    'data-filter-category',
    'data-filter-sort',
    'data-slideshow',
    'data-download-all',
    'data-download-selected',
    'data-delete-selected',
    'data-delete-tests',
    'data-print-sheet',
    'data-lightbox-prev',
    'data-lightbox-next',
    'data-lightbox-download',
    'data-lightbox-delete',
  ]) {
    assert.ok(html.includes(hook), `Im Album fehlt: ${hook}`);
  }
  // Die drei Ansichten
  for (const view of ['grid', 'timeline', 'sheet']) {
    assert.ok(html.includes(`data-view-button="${view}"`), `Ansicht fehlt: ${view}`);
  }
});

test('Vor jedem Löschen kommt eine Sicherheitsabfrage', () => {
  const code = read('assets/js/album.js');
  // Gelöscht wird ausschließlich über confirmDelete, und das hängt am Dialog.
  assert.match(code, /function askDelete/);
  assert.match(code, /function confirmDelete/);
  const deleteCalls = [...code.matchAll(/supabase\.delete(Photos|Submissions)\(/g)];
  assert.equal(deleteCalls.length, 2, 'Es wird an mehr als einer Stelle gelöscht');
  const confirmStart = code.indexOf('async function confirmDelete');
  const confirmEnd = code.indexOf('\n}', code.indexOf('finally', confirmStart));
  for (const match of deleteCalls) {
    assert.ok(
      match.index > confirmStart && match.index < confirmEnd,
      'Es wird außerhalb der Sicherheitsabfrage gelöscht',
    );
  }
});

test('Das Album verwendet kurzlebige signierte Links', () => {
  const code = read('assets/js/album.js');
  assert.match(code, /createSignedUrls/);
  // Und keine dauerhaft öffentliche Adresse.
  assert.ok(!code.includes('getPublicUrl'), 'Es werden öffentliche Adressen verwendet');
  assert.ok(!read('assets/js/lib/supabase-rest.js').includes('/object/public/'));
});

test('Die Anmeldung überlebt das Schließen des Tabs nicht', () => {
  const code = read('assets/js/album.js');
  assert.match(code, /tabStorage\(\)/, 'Das Album nutzt keinen sitzungsbezogenen Speicher');
  assert.ok(!/browserStorage\(\)/.test(code), 'Das Album speichert den Zugang dauerhaft');
});
