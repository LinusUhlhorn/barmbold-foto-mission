// Prüft den Aufbau der Seiten: Verweise, Barrierefreiheit, Sicherheit.
// Diese Tests fangen typische Tippfehler ab, die man im Browser erst spät merkt.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { PARTY_CONFIG } from '../config/party-config.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

// Zu jeder Seite gehoeren die Skripte, die ihre data-Haken verwenden.
const PAGES = {
  'index.html': ['assets/js/app.js', 'assets/js/memories.js'],
  'album/index.html': ['assets/js/album.js', 'assets/js/album-memories.js'],
  'qr-print.html': ['assets/js/qr-print.js'],
};

/** Alle Skripte aller Seiten, flach. */
const ALL_SCRIPTS = Object.values(PAGES).flat();

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
  for (const [page, scripts] of Object.entries(PAGES)) {
    const html = read(page);
    for (const script of scripts) {
      const code = read(script);
      const hooks = new Set([...code.matchAll(/\[data-([a-z0-9-]+)[\]=]/g)].map((m) => m[1]));
      for (const hook of hooks) {
        assert.ok(
          html.includes(`data-${hook}`),
          `${script} sucht "data-${hook}", aber ${page} hat es nicht`,
        );
      }
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
  for (const page of [...Object.keys(PAGES), ...ALL_SCRIPTS]) {
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
    ...ALL_SCRIPTS,
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

test('Vorschau und Bestätigen haben einen festen Aktionsbereich', () => {
  // Auf dem Handy müssen "Dieses Foto verwenden" bzw. Haken und
  // "Foto hochladen" sichtbar sein, ohne dass jemand scrollen muss.
  const html = read('index.html').replace(/\s+/g, ' ');
  for (const screen of ['preview', 'confirm']) {
    const abschnitt = html.match(
      new RegExp(`<section class="screen screen--sheet" data-screen="${screen}"[\\s\\S]*?</section>`),
    );
    assert.ok(abschnitt, `Der Bildschirm "${screen}" ist nicht als Blatt aufgebaut`);
    assert.match(abschnitt[0], /class="card__scroll"/, `${screen}: Scrollbereich fehlt`);
    assert.match(abschnitt[0], /class="card__actions"/, `${screen}: Aktionsbereich fehlt`);
  }

  // Die wichtigen Bedienelemente stehen im Aktionsbereich, nicht im Scrollteil.
  const aktionen = [...html.matchAll(/class="card__actions">([\s\S]*?)<\/section>/g)]
    .map((treffer) => treffer[1])
    .join(' ');
  assert.match(aktionen, /data-use-photo/, 'Der Knopf "Foto verwenden" klebt nicht unten');
  assert.match(aktionen, /data-consent/, 'Der Haken klebt nicht unten');
  assert.match(aktionen, /data-upload-button/, 'Der Hochladen-Knopf klebt nicht unten');
});

test('Der Aktionsbereich bleibt beim Scrollen stehen', () => {
  const css = read('assets/css/app.css').replace(/\s+/g, ' ');
  assert.match(css, /\.card__actions \{[^}]*position: sticky;[^}]*bottom: 0;/);
  // Eine abgeschnittene Karte würde sticky wirkungslos machen.
  assert.match(css, /\.card--sheet \{[^}]*overflow: visible;/);
});

test('Fotos der Galerie lassen sich in voller Größe ansehen', () => {
  const html = read('index.html');
  for (const hook of [
    'data-lightbox',
    'data-lightbox-close',
    'data-lightbox-prev',
    'data-lightbox-next',
    'data-lightbox-image',
    'data-lightbox-stage',
    'data-lightbox-like',
    'data-lightbox-position',
  ]) {
    assert.ok(html.includes(hook), `Im Vollbild fehlt: ${hook}`);
  }
  // Es ist ein echter Dialog, kein bloßes Bild-Overlay.
  assert.match(html, /class="lightbox"[\s\S]*?role="dialog"[\s\S]*?aria-modal="true"/);

  const code = read('assets/js/app.js');
  // Bedienung: schließen mit Escape, blättern mit den Pfeiltasten und per Wisch.
  assert.match(code, /event\.key === 'Escape'/);
  assert.match(code, /event\.key === 'ArrowLeft'/);
  assert.match(code, /touchend/, 'Wischen zum Blättern fehlt');
  // Die Tastatur darf nicht hinter den Dialog entwischen.
  assert.match(code, /trapFocus/);
});

test('Ein vergebenes Herz bleibt auch unter dem Mauszeiger lesbar', () => {
  // Ohne die zweite Regel gewinnt der Hover-Zustand von .btn--secondary,
  // und dunkle Schrift stünde auf hellgrauem Grund.
  const css = read('assets/css/app.css').replace(/\s+/g, ' ');
  assert.match(css, /\.public-photo__like\.is-liked:hover:not\(:disabled\)/);
});

test('Nach dem Pflichtteil geht es freiwillig weiter oder in die Galerie', () => {
  const html = read('index.html');
  for (const hook of [
    'data-extra-mission',
    'data-success-gallery',
    'data-finished-extra',
    'data-finished-gallery',
  ]) {
    assert.ok(html.includes(hook), `Es fehlt: ${hook}`);
  }
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

// =========================================================================
// Private Erinnerungen ("Für Britta & Lutz")
// =========================================================================

test('Der private Bereich hat einen eigenen Menüpunkt und alle Bedienelemente', () => {
  const html = read('index.html');
  assert.match(html, /data-view-tab="memories"/, 'Der Menüpunkt fehlt');
  for (const hook of [
    'data-memories-form',
    'data-memory-name',
    'data-memory-message',
    'data-memory-input="photo"',
    'data-memory-input="video"',
    'data-memory-counter="photo"',
    'data-memory-counter="video"',
    'data-memory-full="photo"',
    'data-memory-full="video"',
    'data-memory-list="photo"',
    'data-memory-list="video"',
    'data-memory-summary',
    'data-memory-submit',
    'data-memory-progress',
    'data-memory-success',
  ]) {
    assert.ok(html.includes(hook), `Im privaten Bereich fehlt: ${hook}`);
  }
});

test('Fotos und Videos haben getrennte Auswahlbereiche', () => {
  const html = read('index.html');
  const fotoFeld = html.match(/<input[^>]*data-memory-input="photo"[^>]*>/s);
  const videoFeld = html.match(/<input[^>]*data-memory-input="video"[^>]*>/s);
  assert.ok(fotoFeld && videoFeld, 'Es fehlt ein Auswahlfeld');
  assert.ok(fotoFeld[0].includes('multiple'), 'Mehrere Fotos müssen möglich sein');
  assert.ok(videoFeld[0].includes('multiple'), 'Mehrere Videos müssen möglich sein');
  // Das Videofeld darf keine Bilder annehmen und umgekehrt.
  assert.ok(fotoFeld[0].includes('image/'), 'Das Fotofeld nimmt keine Bilder an');
  assert.ok(videoFeld[0].includes('video/'), 'Das Videofeld nimmt keine Videos an');
  assert.ok(!fotoFeld[0].includes('video/'), 'Das Fotofeld nimmt auch Videos an');
});

test('Der geforderte Text steht wortgleich auf der Seite', () => {
  const texts = PARTY_CONFIG.memories.texts;
  assert.equal(texts.title, 'Eine Erinnerung an diesen Abend');
  assert.match(texts.intro, /Habt ihr einen schönen Moment festgehalten\?/);
  assert.match(texts.intro, /nicht öffentlich angezeigt/);
  assert.match(texts.intro, /persönliches Erinnerungsalbum übergeben/);
  assert.equal(
    texts.privateBadge,
    'Privater Upload – nur Britta und Lutz erhalten diese Aufnahmen.',
  );
  assert.equal(texts.uploadButton, 'Erinnerung hochladen');
  assert.equal(texts.successTitle, 'Vielen Dank!');
  assert.match(texts.successText, /werden Britta und Lutz nach der Feier übergeben/);
  // Der Hinweis am Ende der Foto-Mission.
  assert.match(texts.missionHint, /Habt ihr noch weitere schöne Momente aufgenommen\?/);
  assert.equal(texts.missionHintButton, 'Erinnerungen hochladen');
  // Der Hinweis auf die Videolänge muss VOR der Auswahl stehen.
  assert.match(texts.videoHint, /30 Sekunden/);
});

test('Die privaten Aufnahmen erscheinen nirgends öffentlich', () => {
  // Die öffentliche Galerie liest ausschließlich die Tabelle der Foto-Mission.
  const app = read('assets/js/app.js');
  assert.ok(
    !/listMemoryUploads|listMemoryFiles|createMemorySignedUrls/.test(app),
    'Die Startseite liest private Erinnerungen',
  );
  const galerie = app.slice(app.indexOf('function renderPublicGallery'), app.indexOf('function buildPublicGalleryCategories'));
  assert.ok(!/memor/i.test(galerie), 'In der Galerie tauchen private Erinnerungen auf');

  // Der Gäste-Teil lädt nur hoch und liest nichts zurück.
  const memories = read('assets/js/memories.js');
  for (const verboten of ['listMemoryUploads', 'listMemoryFiles', 'createMemorySignedUrls', 'downloadPhoto']) {
    assert.ok(!memories.includes(verboten), `Der Gästebereich verwendet ${verboten}`);
  }
});

test('Der private Bereich nutzt einen eigenen Speicher', () => {
  const rest = read('assets/js/lib/supabase-rest.js');
  assert.match(rest, /memoriesBucket/, 'Es gibt keinen eigenen Bucket');
  assert.notEqual(PARTY_CONFIG.supabase.memoriesBucket, PARTY_CONFIG.supabase.bucket);
  assert.notEqual(PARTY_CONFIG.supabase.memoriesTable, PARTY_CONFIG.supabase.table);
});

test('Der Adminbereich zeigt die privaten Erinnerungen gruppiert an', () => {
  const html = read('album/index.html');
  for (const hook of [
    'data-view-button="memories"',
    'data-memories-view',
    'data-memories-admin-list',
    'data-memories-reload',
    'data-memories-download-all',
    'data-memory-viewer',
  ]) {
    assert.ok(html.includes(hook), `Im Album fehlt: ${hook}`);
  }
});

test('Private Dateien werden nur über kurzlebige Links geladen', () => {
  const code = read('assets/js/album-memories.js');
  assert.match(code, /createMemorySignedUrls/);
  assert.ok(!code.includes('getPublicUrl'), 'Es werden öffentliche Adressen verwendet');
  assert.ok(!code.includes('/object/public/'), 'Es wird eine öffentliche Adresse gebaut');
});

test('Vor dem Löschen privater Erinnerungen kommt eine Sicherheitsabfrage', () => {
  const code = read('assets/js/album-memories.js');
  // Gelöscht wird ausschließlich in performDelete - und das läuft über den Dialog.
  const loeschAufrufe = [...code.matchAll(/supabase\.delete(MemoryObjects|MemoryUpload|MemoryFileRows)\(/g)];
  assert.ok(loeschAufrufe.length >= 3, 'Es wird gar nicht gelöscht');
  const start = code.indexOf('async function performDelete');
  const ende = code.indexOf('\n  }', code.indexOf("if (auftrag.art === 'memory-upload')", start));
  for (const treffer of loeschAufrufe) {
    assert.ok(
      treffer.index > start && treffer.index < ende,
      'Es wird außerhalb der Sicherheitsabfrage gelöscht',
    );
  }
  // Und der Knopf ruft askDelete auf, nicht direkt das Löschen.
  assert.match(code, /askDelete\(\s*\{ art: 'memory-upload'/);
  assert.match(code, /askDelete\(\s*\{ art: 'memory-file'/);
});

test('Das Exportskript hält den geheimen Schlüssel aus dem Projekt heraus', () => {
  const code = read('tools/export-memories.js');
  // Der Key kommt ausschließlich aus der lokalen .env.
  assert.match(code, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(code, /readEnvFile/);
  assert.ok(!/sb_secret_|eyJ[A-Za-z0-9_-]{30,}/.test(code), 'Im Skript steht ein echter Schlüssel');

  // Die Vorlage enthält keinen Wert.
  const vorlage = read('.env.example');
  assert.match(vorlage, /SUPABASE_SERVICE_ROLE_KEY=\s*$/m, 'In der Vorlage steht ein Wert');

  // Und die echte .env darf niemals eingecheckt werden.
  const ignore = read('.gitignore');
  assert.match(ignore, /^\.env$/m);
  assert.match(ignore, /^export\/$/m);

  // Das Frontend kennt den Service-Role-Key nicht.
  for (const datei of ['assets/js/memories.js', 'assets/js/album-memories.js', 'config/party-config.js']) {
    assert.ok(!/service_role/i.test(read(datei)), `${datei} erwähnt den Service-Role-Key`);
  }
});
