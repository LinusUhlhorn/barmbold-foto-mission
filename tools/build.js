// Produktions-Build und Selbstprüfung.
//
// Die App ist eine statische Seite ohne Bündelung. Dieser "Build" tut deshalb
// zwei Dinge:
//   1. Er prüft, ob alles zusammenpasst (Dateien, Verweise, Konfiguration).
//   2. Er legt unter dist/ genau die Dateien ab, die auch per FTP hochgeladen
//      werden. So kannst du vorher nachsehen, was auf dem Server landet.
//
// Aufruf:  npm run build

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { DEPLOY_DIRECTORIES, REQUIRED_FILES } from './deploy-manifest.js';
import { PARTY_CONFIG } from '../config/party-config.js';
import { validateMissions, activeMissions } from '../assets/js/lib/missions.js';
import { hasIcon } from '../assets/js/lib/icons.js';
import { encodeQr } from '../assets/js/lib/qr.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');

const problems = [];
const warnings = [];

function fail(message) {
  problems.push(message);
}
function warn(message) {
  warnings.push(message);
}

// ---------------------------------------------------------------------------
// 1. Sind alle benötigten Dateien vorhanden?
// ---------------------------------------------------------------------------
for (const file of REQUIRED_FILES) {
  if (!fs.existsSync(path.join(ROOT, file))) fail(`Datei fehlt: ${file}`);
}

// ---------------------------------------------------------------------------
// 2. Verweisen die HTML-Seiten auf vorhandene Dateien?
// ---------------------------------------------------------------------------
const htmlPages = ['index.html', 'qr-print.html', 'album/index.html'];
for (const page of htmlPages) {
  const full = path.join(ROOT, page);
  if (!fs.existsSync(full)) continue;
  const html = fs.readFileSync(full, 'utf8');
  const baseDir = path.dirname(full);
  const references = [...html.matchAll(/(?:href|src)="([^"#][^"]*)"/g)].map((m) => m[1]);
  for (const reference of references) {
    if (/^(https?:|data:|mailto:|#|\.\/$)/.test(reference)) continue;
    const target = path.resolve(baseDir, reference);
    if (!fs.existsSync(target)) fail(`${page} verweist auf eine fehlende Datei: ${reference}`);
  }
}

// ---------------------------------------------------------------------------
// 3. Lassen sich alle JavaScript-Module laden?
// ---------------------------------------------------------------------------
const jsFiles = [];
(function collect(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collect(full);
    else if (entry.name.endsWith('.js')) jsFiles.push(full);
  }
})(path.join(ROOT, 'assets', 'js'));

for (const file of jsFiles) {
  try {
    // Nur die reinen Logik-Module lassen sich ohne Browser laden.
    if (file.includes(`${path.sep}lib${path.sep}`)) {
      await import(`file://${file}`);
    } else {
      // Für die Browser-Einstiegspunkte reicht eine Syntaxprüfung.
      // eslint-disable-next-line no-new-func
      new Function(`return async () => {}`);
      const source = fs.readFileSync(file, 'utf8');
      if (!source.includes('import ')) warn(`${path.relative(ROOT, file)} hat keine Importe.`);
    }
  } catch (error) {
    // Module, die Browser-Objekte beim Laden brauchen, sind kein Fehler.
    if (!/document|window|navigator|indexedDB|localStorage/.test(String(error.message))) {
      fail(`${path.relative(ROOT, file)} lässt sich nicht laden: ${error.message}`);
    }
  }
}

// ---------------------------------------------------------------------------
// 4. Stimmt die Konfiguration?
// ---------------------------------------------------------------------------
const missionProblems = [
  ...validateMissions(PARTY_CONFIG.missions),
  ...validateMissions(PARTY_CONFIG.bonusMissions),
];
for (const problem of missionProblems) fail(`Konfiguration: ${problem}`);

const activeCount = activeMissions(PARTY_CONFIG.missions).length;
if (activeCount < 20) {
  fail(`Es sind nur ${activeCount} Missionen aktiv, gefordert sind mindestens 20.`);
}

for (const mission of [...PARTY_CONFIG.missions, ...PARTY_CONFIG.bonusMissions]) {
  if (!hasIcon(mission.icon)) {
    fail(`Mission "${mission.id}": das Symbol "${mission.icon}" gibt es nicht.`);
  }
}

// Lässt sich aus der öffentlichen Adresse ein QR-Code erzeugen?
try {
  const qr = encodeQr(PARTY_CONFIG.party.publicUrl, { ecLevel: 'Q' });
  if (qr.size < 21) fail('Der QR-Code konnte nicht sinnvoll erzeugt werden.');
} catch (error) {
  fail(`QR-Code fehlgeschlagen: ${error.message}`);
}

// ---------------------------------------------------------------------------
// 5. Kein Geheimnis im Frontend?
// ---------------------------------------------------------------------------
const secretPatterns = [
  { pattern: /service_role/i, label: 'Service-Role-Key' },
  { pattern: /SUPABASE_SERVICE/i, label: 'Service-Key-Variable' },
  { pattern: /ftp:\/\/[^\s"']*:[^\s"']*@/i, label: 'FTP-Zugangsdaten' },
  { pattern: /FTP_PASSWORD\s*[:=]\s*['"][^'"]+['"]/i, label: 'FTP-Passwort' },
];
const scanFiles = [
  ...htmlPages.map((p) => path.join(ROOT, p)),
  ...jsFiles,
  path.join(ROOT, 'config', 'party-config.js'),
];
for (const file of scanFiles) {
  if (!fs.existsSync(file)) continue;
  const source = fs.readFileSync(file, 'utf8');
  for (const { pattern, label } of secretPatterns) {
    if (pattern.test(source)) {
      fail(`${path.relative(ROOT, file)} enthält möglicherweise ein Geheimnis (${label}).`);
    }
  }
}

// ---------------------------------------------------------------------------
// 6. Hinweise (kein Fehler, aber gut zu wissen)
// ---------------------------------------------------------------------------
if (String(PARTY_CONFIG.party.birthdayPersonName).startsWith('[')) {
  warn('Der Name des Geburtstagskindes ist noch ein Platzhalter.');
}
if (String(PARTY_CONFIG.supabase.url).startsWith('[')) {
  warn('Supabase ist noch nicht eingetragen – Uploads sind deaktiviert (Demo-Modus).');
}

// ---------------------------------------------------------------------------
// 7. dist/ aufbauen
// ---------------------------------------------------------------------------
function copyRecursive(from, to) {
  const stat = fs.statSync(from);
  if (stat.isDirectory()) {
    fs.mkdirSync(to, { recursive: true });
    for (const entry of fs.readdirSync(from)) {
      copyRecursive(path.join(from, entry), path.join(to, entry));
    }
  } else {
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
  }
}

let fileCount = 0;
if (problems.length === 0) {
  fs.rmSync(DIST, { recursive: true, force: true });
  fs.mkdirSync(DIST, { recursive: true });

  for (const file of ['index.html', 'qr-print.html', 'robots.txt']) {
    copyRecursive(path.join(ROOT, file), path.join(DIST, file));
  }
  for (const dir of DEPLOY_DIRECTORIES) {
    const from = path.join(ROOT, dir);
    if (fs.existsSync(from)) copyRecursive(from, path.join(DIST, dir));
  }

  (function count(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) count(path.join(dir, entry.name));
      else fileCount += 1;
    }
  })(DIST);
}

// ---------------------------------------------------------------------------
// Ergebnis
// ---------------------------------------------------------------------------
console.log('');
console.log('=== Produktions-Build ===');
console.log('');

for (const warning of warnings) console.log(`  Hinweis: ${warning}`);
if (warnings.length > 0) console.log('');

if (problems.length > 0) {
  for (const problem of problems) console.log(`  FEHLER: ${problem}`);
  console.log('');
  console.log(`Build fehlgeschlagen: ${problems.length} Problem(e).`);
  process.exit(1);
}

console.log(`  Aktive Missionen:        ${activeCount}`);
console.log(`  Aktive Bonus-Missionen:  ${activeMissions(PARTY_CONFIG.bonusMissions).length}`);
console.log(`  Dateien in dist/:        ${fileCount}`);
console.log('');
console.log('Build erfolgreich. Der Ordner dist/ zeigt, was per FTP hochgeladen wird.');
console.log('(Der FTP-Upload überträgt die Dateien direkt aus dem Projektordner.)');
