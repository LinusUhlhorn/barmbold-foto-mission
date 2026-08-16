import test from 'node:test';
import assert from 'node:assert/strict';

import { createZip, crc32, safeZipName } from '../assets/js/lib/zip.js';

const encoder = new TextEncoder();

async function toBytes(value) {
  if (value instanceof Uint8Array) return value;
  return new Uint8Array(await value.arrayBuffer());
}

/** Liest ein ZIP-Archiv wieder aus - nur so viel, wie der Test braucht. */
function readZip(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder();
  const entries = [];
  let offset = 0;

  while (offset + 4 <= bytes.length && view.getUint32(offset, true) === 0x04034b50) {
    const method = view.getUint16(offset + 8, true);
    const checksum = view.getUint32(offset + 14, true);
    const size = view.getUint32(offset + 22, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const name = decoder.decode(bytes.subarray(offset + 30, offset + 30 + nameLength));
    const dataStart = offset + 30 + nameLength + extraLength;
    const data = bytes.subarray(dataStart, dataStart + size);
    entries.push({ name, method, checksum, data });
    offset = dataStart + size;
  }

  // Am Ende muss das zentrale Verzeichnis stehen.
  const centralStart = offset;
  const centralCount = (() => {
    let position = bytes.length - 22;
    while (position >= 0 && view.getUint32(position, true) !== 0x06054b50) position -= 1;
    assert.ok(position >= 0, 'Der Abschlussblock des ZIP-Archivs fehlt');
    return {
      count: view.getUint16(position + 10, true),
      centralSize: view.getUint32(position + 12, true),
      centralOffset: view.getUint32(position + 16, true),
    };
  })();

  return { entries, centralStart, ...centralCount };
}

test('CRC-32 stimmt mit dem bekannten Prüfwert überein', () => {
  // Standard-Prüfwert für die Zeichenfolge "123456789"
  assert.equal(crc32(encoder.encode('123456789')), 0xcbf43926);
  assert.equal(crc32(new Uint8Array(0)), 0);
});

test('Dateinamen im Archiv können nicht aus dem Ordner ausbrechen', () => {
  assert.equal(safeZipName('../../geheim.jpg'), 'geheim.jpg');
  assert.equal(safeZipName('/etc/passwd'), 'etc/passwd');
  // Ein Windows-Pfad wird zu einem einzigen Dateinamen, nicht zu Ordnern.
  assert.equal(safeZipName('C:\\Users\\x\\foto.jpg'), 'C__Users_x_foto.jpg');
  assert.equal(safeZipName('./././'), 'datei');
  assert.equal(safeZipName(''), 'datei');
  assert.equal(safeZipName('a?b*c.jpg'), 'a_b_c.jpg');
  assert.ok(!safeZipName('../'.repeat(20) + 'x.jpg').includes('..'));
});

test('Ein Archiv enthält alle Dateien unverändert', async () => {
  const files = [
    { name: 'anna.jpg', data: encoder.encode('Inhalt von Anna') },
    { name: 'bernd.webp', data: encoder.encode('Bernd hat mehr Inhalt als Anna.') },
    { name: 'ümläute.jpg', data: encoder.encode('mit Umlauten') },
  ];
  const bytes = await toBytes(createZip(files));
  const zip = readZip(bytes);

  assert.equal(zip.entries.length, 3);
  assert.equal(zip.count, 3);
  assert.equal(zip.centralOffset, zip.centralStart);

  for (let i = 0; i < files.length; i += 1) {
    assert.equal(zip.entries[i].name, files[i].name);
    assert.equal(zip.entries[i].method, 0, 'Es wird bewusst nicht komprimiert');
    assert.deepEqual([...zip.entries[i].data], [...files[i].data]);
    assert.equal(zip.entries[i].checksum, crc32(files[i].data));
  }
});

test('Gleiche Dateinamen bekommen automatisch eine Nummer', async () => {
  const files = [
    { name: 'foto.jpg', data: encoder.encode('eins') },
    { name: 'foto.jpg', data: encoder.encode('zwei') },
    { name: 'foto.jpg', data: encoder.encode('drei') },
  ];
  const zip = readZip(await toBytes(createZip(files)));
  const names = zip.entries.map((e) => e.name);
  assert.deepEqual(names, ['foto.jpg', 'foto-2.jpg', 'foto-3.jpg']);
  assert.equal(new Set(names).size, 3);
});

test('Ein leeres Archiv ist trotzdem gültig', async () => {
  const zip = readZip(await toBytes(createZip([])));
  assert.equal(zip.entries.length, 0);
  assert.equal(zip.count, 0);
});

test('Auch größere Dateien landen unverändert im Archiv', async () => {
  const data = new Uint8Array(200_000);
  for (let i = 0; i < data.length; i += 1) data[i] = (i * 7) % 256;
  const zip = readZip(await toBytes(createZip([{ name: 'gross.jpg', data }])));
  assert.equal(zip.entries[0].data.length, data.length);
  assert.equal(zip.entries[0].checksum, crc32(data));
});
