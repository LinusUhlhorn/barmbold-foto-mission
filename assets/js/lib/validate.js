// Pruefung der ausgewaehlten Bilddatei.
// Ohne Browser-Abhaengigkeiten: es wird nur mit {name, type, size} gearbeitet,
// damit die Logik in den Tests ohne echte Dateien geprueft werden kann.

import { formatBytes } from './text.js';

// Dateiendungen, die niemals akzeptiert werden - auch dann nicht,
// wenn der Browser einen harmlos aussehenden MIME-Typ meldet.
const FORBIDDEN_EXTENSIONS = [
  'svg',
  'svgz',
  'html',
  'htm',
  'xhtml',
  'xml',
  'js',
  'mjs',
  'php',
  'phtml',
  'exe',
  'sh',
  'bat',
  'cmd',
  'com',
  'jar',
  'apk',
  'pdf',
  'zip',
];

// MIME-Typen, die aktiv gefaehrlich sind.
const FORBIDDEN_MIME = [
  'image/svg+xml',
  'text/html',
  'application/xhtml+xml',
  'text/xml',
  'application/xml',
  'application/javascript',
  'text/javascript',
];

// Wenn der Browser keinen MIME-Typ liefert (kommt bei HEIC auf iOS vor),
// wird ersatzweise die Dateiendung geprueft.
const EXTENSION_TO_MIME = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  jpe: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heif',
  avif: 'image/avif',
  gif: 'image/gif',
  bmp: 'image/bmp',
  tif: 'image/tiff',
  tiff: 'image/tiff',
};

/**
 * Liest die Dateiendung in Kleinbuchstaben aus.
 * @param {string} filename
 * @returns {string}
 */
export function fileExtension(filename) {
  const name = String(filename || '');
  const dot = name.lastIndexOf('.');
  if (dot < 0 || dot === name.length - 1) return '';
  return name.slice(dot + 1).toLowerCase();
}

/**
 * Ermittelt den effektiven MIME-Typ einer Datei.
 * @param {{name?: string, type?: string}} file
 * @returns {string}
 */
export function effectiveMimeType(file) {
  const declared = String((file && file.type) || '').toLowerCase();
  if (declared) return declared;
  const ext = fileExtension(file && file.name);
  return EXTENSION_TO_MIME[ext] || '';
}

/**
 * Prueft die vom Gast ausgewaehlte Datei.
 * @param {{name?: string, type?: string, size?: number}} file
 * @param {{maxInputFileBytes?: number, allowedMimeTypes?: string[]}} limits
 * @returns {{valid: boolean, error: string|null, mimeType: string}}
 */
export function validateImageFile(file, limits = {}) {
  const maxBytes = Number.isFinite(limits.maxInputFileBytes)
    ? limits.maxInputFileBytes
    : 40 * 1024 * 1024;
  const allowed = Array.isArray(limits.allowedMimeTypes)
    ? limits.allowedMimeTypes.map((t) => String(t).toLowerCase())
    : ['image/jpeg', 'image/png', 'image/webp'];

  if (!file) {
    return { valid: false, error: 'Es wurde keine Datei ausgewählt.', mimeType: '' };
  }

  const ext = fileExtension(file.name);
  const mimeType = effectiveMimeType(file);

  if (FORBIDDEN_EXTENSIONS.includes(ext) || FORBIDDEN_MIME.includes(mimeType)) {
    return {
      valid: false,
      error: 'Dieser Dateityp ist nicht erlaubt. Bitte wähle ein normales Foto aus.',
      mimeType,
    };
  }

  if (!mimeType || !mimeType.startsWith('image/')) {
    return {
      valid: false,
      error: 'Das sieht nicht nach einem Foto aus. Bitte wähle ein Bild aus.',
      mimeType,
    };
  }

  if (!allowed.includes(mimeType)) {
    return {
      valid: false,
      error:
        'Dieses Bildformat wird nicht unterstützt. Bitte nimm das Foto direkt mit der Kamera auf.',
      mimeType,
    };
  }

  const size = Number(file.size);
  if (Number.isFinite(size) && size > maxBytes) {
    return {
      valid: false,
      error: `Das Bild ist zu groß (${formatBytes(size)}). Erlaubt sind höchstens ${formatBytes(maxBytes)}.`,
      mimeType,
    };
  }

  if (Number.isFinite(size) && size === 0) {
    return {
      valid: false,
      error: 'Die Datei ist leer. Bitte nimm das Foto noch einmal auf.',
      mimeType,
    };
  }

  return { valid: true, error: null, mimeType };
}

/**
 * Prueft das fertig komprimierte Bild vor dem Upload.
 * @param {{size?: number, type?: string}} blob
 * @param {{maxUploadBytes?: number}} limits
 * @returns {{valid: boolean, error: string|null}}
 */
export function validateCompressedImage(blob, limits = {}) {
  const maxBytes = Number.isFinite(limits.maxUploadBytes)
    ? limits.maxUploadBytes
    : 6 * 1024 * 1024;
  if (!blob || !Number.isFinite(Number(blob.size)) || Number(blob.size) === 0) {
    return { valid: false, error: 'Das Bild konnte nicht verarbeitet werden.' };
  }
  if (Number(blob.size) > maxBytes) {
    return {
      valid: false,
      error: `Das Bild ist auch nach dem Verkleinern zu groß (${formatBytes(blob.size)}).`,
    };
  }
  const type = String(blob.type || '').toLowerCase();
  if (type && !['image/jpeg', 'image/webp', 'image/png'].includes(type)) {
    return { valid: false, error: 'Unerwartetes Bildformat nach dem Verkleinern.' };
  }
  return { valid: true, error: null };
}

/**
 * Baut einen zufaelligen, sicheren Speicherpfad.
 * Der urspruengliche Dateiname wird NIEMALS als Pfad verwendet.
 * @param {{uuid: string, mimeType: string, isTest?: boolean}} params
 * @returns {string}
 */
export function buildStoragePath({ uuid, mimeType, isTest = false }) {
  // Bewusst streng: nur eine echte UUID wird akzeptiert. Es wird NICHTS
  // "zurechtgebogen" - so kann aus einem manipulierten Wert niemals ein
  // gueltiger Pfad entstehen (z. B. "../../etwas").
  const value = String(uuid || '');
  if (!/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(value)) {
    throw new Error('Ungültige UUID für den Speicherpfad.');
  }
  const ext = mimeType === 'image/webp' ? 'webp' : mimeType === 'image/png' ? 'png' : 'jpg';
  const folder = isTest ? 'test' : 'party';
  return `${folder}/${value}.${ext}`;
}

/**
 * Kuerzt den Original-Dateinamen auf einen unbedenklichen Wert,
 * der nur zur Information in der Datenbank landet.
 * @param {string} filename
 */
export function safeOriginalFilename(filename) {
  return String(filename || '')
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .replace(/[\\/]/g, '_')
    .slice(0, 120);
}
