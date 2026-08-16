// Sehr kleiner ZIP-Ersteller (Methode "store", also ohne Komprimierung).
//
// Warum ohne Komprimierung?
// JPEG- und WebP-Dateien sind bereits komprimiert. Ein zweiter Durchgang wuerde
// nichts bringen, aber eine grosse Bibliothek noetig machen. So bleibt das
// Projekt komplett ohne Abhaengigkeiten.

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

/**
 * CRC-32-Pruefsumme (wird vom ZIP-Format verlangt).
 * @param {Uint8Array} bytes
 * @returns {number}
 */
export function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Wandelt Datum/Uhrzeit in das alte DOS-Format um, das ZIP verwendet.
 * @param {Date} date
 */
function dosDateTime(date) {
  const year = Math.max(1980, date.getFullYear());
  const time =
    (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const day = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time: time & 0xffff, date: day & 0xffff };
}

/**
 * Macht einen Dateinamen fuer das ZIP-Archiv unbedenklich.
 * Verzeichniswechsel ("../") sind ausgeschlossen.
 * @param {string} name
 * @returns {string}
 */
export function safeZipName(name) {
  const cleaned = String(name || 'datei')
    .replace(/[\u0000-\u001F\u007F]/g, '')
    // Ein Windows-Pfad soll im Archiv KEINE Ordner erzeugen.
    .replace(/\\/g, '_')
    // ".." und "." entfernen, damit nichts aus dem Archivordner ausbrechen kann.
    .split('/')
    .filter((part) => part !== '' && part !== '.' && part !== '..')
    .join('/')
    // Zeichen, die Windows und macOS in Dateinamen nicht mögen.
    .replace(/[:*?"<>|]/g, '_')
    .slice(0, 180);
  return cleaned === '' ? 'datei' : cleaned;
}

function writeUint32(view, offset, value) {
  view.setUint32(offset, value >>> 0, true);
}
function writeUint16(view, offset, value) {
  view.setUint16(offset, value & 0xffff, true);
}

/**
 * Baut ein ZIP-Archiv aus einer Liste von Dateien.
 * @param {Array<{name: string, data: Uint8Array, date?: Date}>} files
 * @returns {Blob|Uint8Array} Im Browser ein Blob, in Node ein Uint8Array
 */
export function createZip(files) {
  const encoder = new TextEncoder();
  const entries = [];
  let offset = 0;
  const localParts = [];

  const usedNames = new Set();

  for (const file of files) {
    let name = safeZipName(file.name);
    // Doppelte Namen im Archiv vermeiden.
    if (usedNames.has(name)) {
      const dot = name.lastIndexOf('.');
      const base = dot > 0 ? name.slice(0, dot) : name;
      const ext = dot > 0 ? name.slice(dot) : '';
      let counter = 2;
      while (usedNames.has(`${base}-${counter}${ext}`)) counter += 1;
      name = `${base}-${counter}${ext}`;
    }
    usedNames.add(name);

    const nameBytes = encoder.encode(name);
    const data = file.data instanceof Uint8Array ? file.data : new Uint8Array(file.data);
    const checksum = crc32(data);
    const { time, date } = dosDateTime(file.date instanceof Date ? file.date : new Date());

    const header = new Uint8Array(30 + nameBytes.length);
    const view = new DataView(header.buffer);
    writeUint32(view, 0, 0x04034b50); // Signatur
    writeUint16(view, 4, 20); // benoetigte Version
    writeUint16(view, 6, 0x0800); // Flag: Dateiname ist UTF-8
    writeUint16(view, 8, 0); // Methode 0 = store
    writeUint16(view, 10, time);
    writeUint16(view, 12, date);
    writeUint32(view, 14, checksum);
    writeUint32(view, 18, data.length);
    writeUint32(view, 22, data.length);
    writeUint16(view, 26, nameBytes.length);
    writeUint16(view, 28, 0); // keine Zusatzfelder
    header.set(nameBytes, 30);

    localParts.push(header, data);
    entries.push({ nameBytes, checksum, size: data.length, offset, time, date });
    offset += header.length + data.length;
  }

  // Zentrales Verzeichnis
  const centralParts = [];
  let centralSize = 0;
  for (const entry of entries) {
    const record = new Uint8Array(46 + entry.nameBytes.length);
    const view = new DataView(record.buffer);
    writeUint32(view, 0, 0x02014b50);
    writeUint16(view, 4, 20); // erzeugt von
    writeUint16(view, 6, 20); // benoetigte Version
    writeUint16(view, 8, 0x0800);
    writeUint16(view, 10, 0);
    writeUint16(view, 12, entry.time);
    writeUint16(view, 14, entry.date);
    writeUint32(view, 16, entry.checksum);
    writeUint32(view, 20, entry.size);
    writeUint32(view, 24, entry.size);
    writeUint16(view, 28, entry.nameBytes.length);
    writeUint16(view, 30, 0);
    writeUint16(view, 32, 0);
    writeUint16(view, 34, 0);
    writeUint16(view, 36, 0);
    writeUint32(view, 38, 0);
    writeUint32(view, 42, entry.offset);
    record.set(entry.nameBytes, 46);
    centralParts.push(record);
    centralSize += record.length;
  }

  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  writeUint32(endView, 0, 0x06054b50);
  writeUint16(endView, 4, 0);
  writeUint16(endView, 6, 0);
  writeUint16(endView, 8, entries.length);
  writeUint16(endView, 10, entries.length);
  writeUint32(endView, 12, centralSize);
  writeUint32(endView, 16, offset);
  writeUint16(endView, 20, 0);

  const all = [...localParts, ...centralParts, end];

  if (typeof Blob !== 'undefined') {
    return new Blob(all, { type: 'application/zip' });
  }
  const totalLength = all.reduce((sum, part) => sum + part.length, 0);
  const result = new Uint8Array(totalLength);
  let position = 0;
  for (const part of all) {
    result.set(part, position);
    position += part.length;
  }
  return result;
}
