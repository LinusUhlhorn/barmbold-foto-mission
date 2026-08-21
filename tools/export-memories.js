// =========================================================================
// GESAMTEXPORT DER PRIVATEN ERINNERUNGEN
//
// Holt alle privaten Aufnahmen aus Supabase und legt sie geordnet auf der
// Festplatte ab - fertig zum Übergeben an Britta und Lutz.
//
// Aufruf:  npm run export-erinnerungen
//
// WICHTIG ZUM SCHLÜSSEL
// Dieses Skript läuft NUR auf deinem eigenen Rechner und braucht den
// Service-Role-Key. Der steht ausschließlich in einer lokalen .env-Datei,
// niemals im Repository und niemals im Frontend. Die .env ist in
// .gitignore eingetragen; als Vorlage dient .env.example.
//
// Ergebnis:
//   export/Britta-und-Lutz-Erinnerungen/
//   ├── 2026-08-29_20-14-35_Linus-Uhlhorn/
//   │   ├── Fotos/
//   │   ├── Videos/
//   │   └── Nachricht.txt
//   └── upload-uebersicht.csv
// =========================================================================

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  exportFolderName,
  memoryMessageFile,
  memoryOverviewCsv,
} from '../assets/js/lib/memories.js';
import { PARTY_CONFIG } from '../config/party-config.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ZIEL = path.join(ROOT, 'export', 'Britta-und-Lutz-Erinnerungen');

// ---------------------------------------------------------------------------
// 1. Zugangsdaten aus der lokalen .env lesen
// ---------------------------------------------------------------------------

/** Liest eine .env-Datei, ohne eine Bibliothek dafür zu brauchen. */
function readEnvFile(file) {
  const werte = {};
  if (!fs.existsSync(file)) return werte;
  for (const zeile of fs.readFileSync(file, 'utf8').split('\n')) {
    const treffer = zeile.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!treffer) continue;
    werte[treffer[1]] = treffer[2].replace(/^["']|["']$/g, '').trim();
  }
  return werte;
}

const env = { ...readEnvFile(path.join(ROOT, '.env')), ...process.env };

const SUPABASE_URL = (env.SUPABASE_URL || PARTY_CONFIG.supabase.url || '').replace(/\/+$/, '');
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY || '';
const BUCKET = env.SUPABASE_MEMORIES_BUCKET || PARTY_CONFIG.supabase.memoriesBucket;
const TABELLE = PARTY_CONFIG.supabase.memoriesTable;
const DATEI_TABELLE = PARTY_CONFIG.supabase.memoriesFilesTable;

function abbruch(nachricht) {
  console.error(`\n  ${nachricht}\n`);
  process.exit(1);
}

if (!SERVICE_KEY) {
  abbruch(
    'Es fehlt der Service-Role-Key.\n\n' +
      '  So geht es:\n' +
      '    1. Kopiere .env.example nach .env\n' +
      '    2. Trage dort SUPABASE_SERVICE_ROLE_KEY ein\n' +
      '       (Supabase → Project Settings → API → service_role)\n' +
      '    3. npm run export-erinnerungen erneut ausführen\n\n' +
      '  Die .env-Datei darf NIEMALS ins Repository.',
  );
}
if (!/^https:\/\/[^\s/]+/.test(SUPABASE_URL)) {
  abbruch('Die Supabase-Adresse fehlt oder ist ungültig (SUPABASE_URL in der .env).');
}

const kopf = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
};

// ---------------------------------------------------------------------------
// 2. Kleine Helfer
// ---------------------------------------------------------------------------

async function hole(pfad) {
  const antwort = await fetch(`${SUPABASE_URL}${pfad}`, { headers: { ...kopf, Accept: 'application/json' } });
  if (!antwort.ok) {
    throw new Error(`Anfrage fehlgeschlagen (HTTP ${antwort.status}): ${await antwort.text()}`);
  }
  return antwort.json();
}

function megabyte(bytes) {
  return `${(Number(bytes) / (1024 * 1024)).toFixed(1)} MB`;
}

/** Legt einen Ordner an, falls es ihn noch nicht gibt. */
function ordner(...teile) {
  const ziel = path.join(...teile);
  fs.mkdirSync(ziel, { recursive: true });
  return ziel;
}

// ---------------------------------------------------------------------------
// 3. Export
// ---------------------------------------------------------------------------

async function main() {
  console.log('\n=== Export der privaten Erinnerungen ===\n');
  console.log(`  Projekt: ${SUPABASE_URL}`);
  console.log(`  Speicher: ${BUCKET}\n`);

  const uploads = await hole(`/rest/v1/${TABELLE}?select=*&order=created_at.asc`);
  const dateien = await hole(`/rest/v1/${DATEI_TABELLE}?select=*&order=storage_path.asc`);

  if (uploads.length === 0) {
    console.log('  Es gibt noch keine privaten Erinnerungen.\n');
    return;
  }

  const gesamt = dateien.reduce((summe, datei) => summe + Number(datei.file_size || 0), 0);
  console.log(`  ${uploads.length} Upload(s), ${dateien.length} Dateien, ${megabyte(gesamt)}\n`);

  fs.mkdirSync(ZIEL, { recursive: true });

  let geladen = 0;
  let fehlend = 0;
  const unvollstaendig = [];

  for (const upload of uploads) {
    const name = exportFolderName(upload);
    const ordnerPfad = ordner(ZIEL, name);
    const eigene = dateien.filter((datei) => datei.upload_id === upload.id);

    // Die persönliche Nachricht liegt als Textdatei daneben.
    fs.writeFileSync(path.join(ordnerPfad, 'Nachricht.txt'), memoryMessageFile(upload), 'utf8');

    if (upload.status !== 'complete') unvollstaendig.push(`${upload.guest_name} (${name})`);

    for (const datei of eigene) {
      const unterordner = ordner(ordnerPfad, datei.media_type === 'video' ? 'Videos' : 'Fotos');
      const zielDatei = path.join(unterordner, datei.stored_filename);

      // Schon vorhanden und vollständig? Dann nicht noch einmal laden.
      if (fs.existsSync(zielDatei) && fs.statSync(zielDatei).size === Number(datei.file_size)) {
        geladen += 1;
        continue;
      }

      const adresse =
        `${SUPABASE_URL}/storage/v1/object/${encodeURIComponent(BUCKET)}/` +
        datei.storage_path.split('/').map(encodeURIComponent).join('/');

      try {
        const antwort = await fetch(adresse, { headers: kopf });
        if (!antwort.ok) throw new Error(`HTTP ${antwort.status}`);
        const daten = Buffer.from(await antwort.arrayBuffer());
        fs.writeFileSync(zielDatei, daten);
        geladen += 1;
        process.stdout.write(`\r  ${geladen} von ${dateien.length} Dateien geladen …   `);
      } catch (error) {
        fehlend += 1;
        console.warn(`\n  Nicht geladen: ${datei.storage_path} (${error.message})`);
      }
    }
  }

  // Die Übersicht für alle Uploads.
  fs.writeFileSync(path.join(ZIEL, 'upload-uebersicht.csv'), memoryOverviewCsv(uploads), 'utf8');

  console.log(`\n\n  Fertig. ${geladen} Dateien liegen in:`);
  console.log(`  ${ZIEL}\n`);
  if (fehlend > 0) {
    console.log(`  ${fehlend} Datei(en) konnten nicht geladen werden.\n`);
  }
  if (unvollstaendig.length > 0) {
    console.log('  Diese Uploads sind unvollständig (der Gast hat vermutlich zu früh geschlossen):');
    for (const eintrag of unvollstaendig) console.log(`    · ${eintrag}`);
    console.log('');
  }
  console.log('  Der Ordner "export/" ist in .gitignore eingetragen und landet nicht im Repository.\n');
}

main().catch((error) => {
  console.error(`\n  Der Export ist fehlgeschlagen: ${error.message}\n`);
  process.exit(1);
});
