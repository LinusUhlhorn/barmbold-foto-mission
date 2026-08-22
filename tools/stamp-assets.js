// =========================================================================
// VERSIONSSTEMPEL FÜR CSS UND JAVASCRIPT
//
// Warum das nötig ist:
// Nach einem Update holt sich der Browser zwar die neue HTML-Seite, benutzt
// aber gern noch das alte CSS und JavaScript aus seinem Zwischenspeicher.
// Dann passt beides nicht zusammen: Das Menü verrutscht, Knöpfe reagieren
// nicht mehr. Auf dem Handy merkt man das oft erst auf der Feier.
//
// Die Lösung: An jeden Verweis kommt ein kurzer Stempel, der aus dem INHALT
// der Datei berechnet wird, z. B. "app.css?v=3f9a1c02". Ändert sich der
// Inhalt, ändert sich der Stempel - und damit die Adresse. Der Browser muss
// die Datei dann neu holen. Bleibt der Inhalt gleich, bleibt auch der
// Stempel, und die Datei darf weiter aus dem Zwischenspeicher kommen.
//
// Aufruf:  npm run stamp
// Geprüft: tests/deploy.test.js schlägt fehl, wenn ein Stempel veraltet ist.
//          So kann kein Update mit falschen Stempeln hochgeladen werden.
// =========================================================================

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Die Seiten, deren Verweise gestempelt werden. */
export const STAMPED_PAGES = ['index.html', 'album/index.html', 'qr-print.html'];

/** Nur diese Dateitypen bekommen einen Stempel. */
const STAMPED_TYPES = /\.(css|js)$/i;

/**
 * Der Stempel einer Datei: die ersten acht Zeichen ihrer Pruefsumme.
 * @param {string} file  Pfad auf der Festplatte
 * @returns {string}
 */
export function assetStamp(file) {
  const inhalt = fs.readFileSync(file);
  return crypto.createHash('sha1').update(inhalt).digest('hex').slice(0, 8);
}

/**
 * Berechnet, wie eine Seite mit aktuellen Stempeln aussehen muesste.
 *
 * @param {string} page  z. B. "index.html"
 * @param {string} [root]
 * @returns {{html: string, changed: Array<{reference: string, stamp: string}>}}
 */
export function stampPage(page, root = ROOT) {
  const full = path.join(root, page);
  const baseDir = path.dirname(full);
  const original = fs.readFileSync(full, 'utf8');
  const changed = [];

  const html = original.replace(
    /(href|src)="([^"]+)"/g,
    (treffer, attribut, verweis) => {
      // Fremde Adressen und eingebettete Daten bleiben unberuehrt.
      if (/^(https?:|data:|mailto:|#)/.test(verweis)) return treffer;
      const [pfad] = verweis.split('?');
      if (!STAMPED_TYPES.test(pfad)) return treffer;

      const ziel = path.resolve(baseDir, pfad);
      if (!fs.existsSync(ziel)) return treffer;

      const stempel = assetStamp(ziel);
      changed.push({ reference: pfad, stamp: stempel });
      return `${attribut}="${pfad}?v=${stempel}"`;
    },
  );

  return { html, changed };
}

/**
 * Schreibt die Stempel in die Seiten.
 * @returns {Array<{page: string, updated: boolean, count: number}>}
 */
export function stampAll(root = ROOT) {
  const ergebnis = [];
  for (const page of STAMPED_PAGES) {
    const full = path.join(root, page);
    if (!fs.existsSync(full)) continue;
    const vorher = fs.readFileSync(full, 'utf8');
    const { html, changed } = stampPage(page, root);
    const veraendert = html !== vorher;
    if (veraendert) fs.writeFileSync(full, html, 'utf8');
    ergebnis.push({ page, updated: veraendert, count: changed.length });
  }
  return ergebnis;
}

// Direkt aufgerufen? Dann stempeln und berichten.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log('\n=== Versionsstempel setzen ===\n');
  let veraendert = 0;
  for (const eintrag of stampAll()) {
    console.log(
      `  ${eintrag.page.padEnd(20)} ${String(eintrag.count).padStart(2)} Verweise` +
        (eintrag.updated ? '  (aktualisiert)' : '  (schon aktuell)'),
    );
    if (eintrag.updated) veraendert += 1;
  }
  console.log(
    veraendert === 0
      ? '\nAlle Stempel waren schon aktuell.\n'
      : `\n${veraendert} Seite(n) aktualisiert. Bitte mit einchecken.\n`,
  );
}
