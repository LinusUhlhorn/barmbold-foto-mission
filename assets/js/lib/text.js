// Textwerkzeuge: Platzhalter ersetzen, Namen bereinigen, HTML sicher machen.
// Dieses Modul ist bewusst frei von Browser-Abhaengigkeiten, damit es getestet werden kann.

/**
 * Ersetzt {name} und {age} in einem Text.
 * @param {string} template
 * @param {{name?: string, age?: number|string}} values
 * @returns {string}
 */
export function fillTemplate(template, values = {}) {
  if (typeof template !== 'string') return '';
  const name = values.name == null ? '' : String(values.name);
  const age = values.age == null ? '' : String(values.age);
  return template.replace(/\{name\}/g, name).replace(/\{age\}/g, age);
}

/**
 * Maskiert HTML-Sonderzeichen. Wird nur fuer Faelle gebraucht, in denen
 * ausnahmsweise HTML erzeugt wird (z. B. beim SVG-/Druck-Export).
 * Im normalen UI wird ausschliesslich textContent verwendet.
 * @param {unknown} value
 * @returns {string}
 */
export function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Bereinigt einen Gaestenamen:
 *  - entfernt Steuerzeichen und Zeilenumbrueche
 *  - entfernt spitze Klammern (kein HTML, kein Script)
 *  - fasst mehrfache Leerzeichen zusammen
 *  - schneidet Leerzeichen am Rand ab
 * @param {unknown} raw
 * @returns {string}
 */
export function sanitizeName(raw) {
  if (raw == null) return '';
  let value = String(raw);
  // Unicode normalisieren, damit z. B. "e + Akzent" wie "é" zaehlt.
  if (typeof value.normalize === 'function') value = value.normalize('NFC');
  value = value
    // Steuerzeichen inkl. Zeilenumbruch und Tabulator durch Leerzeichen ersetzen
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ')
    // Unsichtbare Zeichen entfernen (Zero-Width, BOM, Schreibrichtungs-Tricks)
    .replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, '')
    // Kein HTML zulassen
    .replace(/[<>]/g, '')
    // Mehrfache Leerzeichen zusammenfassen
    .replace(/\s+/g, ' ')
    .trim();
  return value;
}

/**
 * Prueft einen Gaestenamen.
 * @param {unknown} raw
 * @param {{minNameLength?: number, maxNameLength?: number}} limits
 * @returns {{valid: boolean, value: string, error: string|null}}
 */
export function validateName(raw, limits = {}) {
  const min = Number.isFinite(limits.minNameLength) ? limits.minNameLength : 2;
  const max = Number.isFinite(limits.maxNameLength) ? limits.maxNameLength : 40;
  const value = sanitizeName(raw);

  if (value.length === 0) {
    return { valid: false, value, error: 'Bitte trag deinen Namen ein.' };
  }
  if (value.length < min) {
    return {
      valid: false,
      value,
      error: `Der Name braucht mindestens ${min} Zeichen.`,
    };
  }
  if (value.length > max) {
    return {
      valid: false,
      value: value.slice(0, max),
      error: `Der Name darf höchstens ${max} Zeichen lang sein.`,
    };
  }
  // Mindestens ein Buchstabe oder eine Ziffer muss enthalten sein.
  if (!/[\p{L}\p{N}]/u.test(value)) {
    return { valid: false, value, error: 'Bitte trag einen echten Namen ein.' };
  }
  return { valid: true, value, error: null };
}

/**
 * Kuerzt einen Text auf eine maximale Laenge (fuer Anzeige-Zwecke).
 * @param {string} value
 * @param {number} max
 */
export function truncate(value, max) {
  const str = String(value == null ? '' : value);
  if (str.length <= max) return str;
  return `${str.slice(0, Math.max(0, max - 1))}…`;
}

/**
 * Formatiert eine Byte-Zahl gut lesbar.
 * @param {number} bytes
 */
export function formatBytes(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n < 0) return '–';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Formatiert einen Zeitstempel als deutsches Datum mit Uhrzeit.
 * @param {string|number|Date} value
 */
export function formatDateTime(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '–';
  const pad = (n) => String(n).padStart(2, '0');
  return (
    `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()}` +
    ` · ${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}
