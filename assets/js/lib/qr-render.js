// Darstellung eines QR-Codes als SVG (scharf in jeder Groesse) oder PNG.

import { encodeQr } from './qr.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Baut den "d"-Pfad fuer alle dunklen Module.
 * Waagerecht zusammenhaengende Module werden zu einem Rechteck zusammengefasst,
 * das haelt die Datei klein.
 * @param {{size: number, modules: Uint8Array[]}} qr
 * @returns {string}
 */
export function modulesToPath(qr) {
  const parts = [];
  for (let row = 0; row < qr.size; row += 1) {
    let col = 0;
    while (col < qr.size) {
      if (qr.modules[row][col] !== 1) {
        col += 1;
        continue;
      }
      let run = 1;
      while (col + run < qr.size && qr.modules[row][col + run] === 1) run += 1;
      parts.push(`M${col} ${row}h${run}v1h-${run}z`);
      col += run;
    }
  }
  return parts.join('');
}

/**
 * Erzeugt einen QR-Code als SVG-Text (z. B. zum Herunterladen).
 * @param {string} text
 * @param {{ecLevel?: string, quietZone?: number, dark?: string, light?: string, pixelSize?: number, title?: string}} [options]
 * @returns {string}
 */
export function qrToSvgString(text, options = {}) {
  const {
    ecLevel = 'M',
    quietZone = 4,
    dark = '#000000',
    light = '#ffffff',
    pixelSize = 8,
    title = 'QR-Code',
  } = options;

  const qr = encodeQr(text, { ecLevel });
  const total = qr.size + quietZone * 2;
  const pixels = total * pixelSize;
  const path = modulesToPath(qr);
  // Der Titel wird maskiert, damit auch ungewoehnliche Zeichen sicher sind.
  const safeTitle = String(title)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  return (
    `<svg xmlns="${SVG_NS}" width="${pixels}" height="${pixels}" ` +
    `viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges" role="img" ` +
    `aria-label="${safeTitle}">` +
    `<title>${safeTitle}</title>` +
    `<rect width="${total}" height="${total}" fill="${light}"/>` +
    `<g transform="translate(${quietZone} ${quietZone})" fill="${dark}">` +
    `<path d="${path}"/>` +
    `</g></svg>`
  );
}

/**
 * Erzeugt einen QR-Code direkt als SVG-Element fuer die Anzeige.
 * Es wird kein innerHTML verwendet.
 * @param {string} text
 * @param {object} [options]
 * @returns {SVGElement}
 */
export function qrToSvgElement(text, options = {}) {
  const {
    ecLevel = 'M',
    quietZone = 4,
    dark = '#000000',
    light = '#ffffff',
    title = 'QR-Code zur Foto-Mission',
  } = options;

  const qr = encodeQr(text, { ecLevel });
  const total = qr.size + quietZone * 2;

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${total} ${total}`);
  svg.setAttribute('shape-rendering', 'crispEdges');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', title);

  const titleEl = document.createElementNS(SVG_NS, 'title');
  titleEl.textContent = title;
  svg.appendChild(titleEl);

  const background = document.createElementNS(SVG_NS, 'rect');
  background.setAttribute('width', String(total));
  background.setAttribute('height', String(total));
  background.setAttribute('fill', light);
  svg.appendChild(background);

  const group = document.createElementNS(SVG_NS, 'g');
  group.setAttribute('transform', `translate(${quietZone} ${quietZone})`);
  group.setAttribute('fill', dark);
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', modulesToPath(qr));
  group.appendChild(path);
  svg.appendChild(group);

  return svg;
}

/**
 * Zeichnet den QR-Code auf ein Canvas und liefert einen PNG-Blob.
 * Laeuft nur im Browser.
 * @param {string} text
 * @param {{ecLevel?: string, quietZone?: number, pixelSize?: number, dark?: string, light?: string}} [options]
 * @returns {Promise<Blob>}
 */
export function qrToPngBlob(text, options = {}) {
  const {
    ecLevel = 'M',
    quietZone = 4,
    pixelSize = 12,
    dark = '#000000',
    light = '#ffffff',
  } = options;

  const qr = encodeQr(text, { ecLevel });
  const total = qr.size + quietZone * 2;
  const canvas = document.createElement('canvas');
  canvas.width = total * pixelSize;
  canvas.height = total * pixelSize;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = light;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = dark;
  for (let row = 0; row < qr.size; row += 1) {
    for (let col = 0; col < qr.size; col += 1) {
      if (qr.modules[row][col] === 1) {
        ctx.fillRect(
          (col + quietZone) * pixelSize,
          (row + quietZone) * pixelSize,
          pixelSize,
          pixelSize,
        );
      }
    }
  }
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Der QR-Code konnte nicht als PNG erzeugt werden.'));
    }, 'image/png');
  });
}
