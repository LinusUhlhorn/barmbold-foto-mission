import test from 'node:test';
import assert from 'node:assert/strict';

import {
  chooseVersion,
  dataCodewordCount,
  dataModuleOrder,
  encodeQr,
  formatInfoBits,
  generatorPolynomial,
  reedSolomonEncode,
  totalCodewordCount,
  versionInfoBits,
  __internals,
} from '../assets/js/lib/qr.js';
import { modulesToPath, qrToSvgString } from '../assets/js/lib/qr-render.js';
import { PARTY_CONFIG } from '../config/party-config.js';

const PUBLIC_URL = 'https://silberhochzeit-barmbold.ulhorn-webdesign.de/';

// =========================================================================
// Bekannte Werte aus der Norm ISO/IEC 18004
// =========================================================================

test('Reed-Solomon stimmt mit dem Beispiel aus der Norm überein', () => {
  // Beispiel "01234567", Version 1, Stufe M (Anhang der Norm)
  const data = [
    0x10, 0x20, 0x0c, 0x56, 0x61, 0x80, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11, 0xec,
    0x11,
  ];
  const expected = [0xa5, 0x24, 0xd4, 0xc1, 0xed, 0x36, 0xc7, 0x87, 0x2c, 0x55];
  assert.deepEqual([...reedSolomonEncode(data, 10)], expected);
});

test('Das Generatorpolynom hat den richtigen Grad', () => {
  for (const degree of [7, 10, 13, 17, 26, 30]) {
    assert.equal(generatorPolynomial(degree).length, degree + 1);
    assert.equal(generatorPolynomial(degree)[0], 1);
  }
});

test('Alle 32 Formatinformationen entsprechen der Norm', () => {
  const table = {
    L: [0x77c4, 0x72f3, 0x7daa, 0x789d, 0x662f, 0x6318, 0x6c41, 0x6976],
    M: [0x5412, 0x5125, 0x5e7c, 0x5b4b, 0x45f9, 0x40ce, 0x4f97, 0x4aa0],
    Q: [0x355f, 0x3068, 0x3f31, 0x3a06, 0x24b4, 0x2183, 0x2eda, 0x2bed],
    H: [0x1689, 0x13be, 0x1ce7, 0x19d0, 0x0762, 0x0255, 0x0d0c, 0x083b],
  };
  for (const [level, values] of Object.entries(table)) {
    values.forEach((expected, mask) => {
      assert.equal(
        formatInfoBits(level, mask),
        expected,
        `Stufe ${level}, Maske ${mask}`,
      );
    });
  }
});

test('Die Versionsinformationen entsprechen der Norm', () => {
  assert.equal(versionInfoBits(7), 0x07c94);
  assert.equal(versionInfoBits(8), 0x085bc);
  assert.equal(versionInfoBits(9), 0x09a99);
  assert.equal(versionInfoBits(10), 0x0a4d3);
});

test('Ungültige Eingaben werden abgewiesen', () => {
  assert.throws(() => formatInfoBits('X', 0), /Fehlerkorrekturstufe/);
  assert.throws(() => formatInfoBits('M', 9), /Maske/);
  assert.throws(() => encodeQr(''), /kein Text/);
  assert.throws(() => encodeQr('x'.repeat(3000)), /zu lang/);
});

test('Die Anzahl der Codewörter entspricht der Norm', () => {
  const expected = {
    1: 26,
    2: 44,
    3: 70,
    4: 100,
    5: 134,
    6: 172,
    7: 196,
    8: 242,
    9: 292,
    10: 346,
  };
  for (const [version, total] of Object.entries(expected)) {
    for (const level of ['L', 'M', 'Q', 'H']) {
      assert.equal(
        totalCodewordCount(Number(version), level),
        total,
        `Version ${version}, Stufe ${level}`,
      );
    }
  }
});

// =========================================================================
// Aufbau des Rasters
// =========================================================================

function rebuildReserved(version) {
  const size = version * 4 + 17;
  const { modules, reserved } = __internals.createMatrix(size);
  __internals.placeFinder(modules, reserved, 0, 0);
  __internals.placeFinder(modules, reserved, 0, size - 7);
  __internals.placeFinder(modules, reserved, size - 7, 0);
  __internals.placeAlignment(modules, reserved, version);
  __internals.placeTiming(modules, reserved);
  __internals.reserveFormatAreas(modules, reserved, version);
  return reserved;
}

test('Die Anzahl freier Module passt genau zur Anzahl der Codewörter', () => {
  // Das ist eine starke Gegenprobe: Die Tabellen der Fehlerkorrektur und der
  // tatsächlich aufgebaute Raster müssen unabhängig voneinander passen.
  for (let version = 1; version <= 10; version += 1) {
    const free = dataModuleOrder(rebuildReserved(version)).length;
    for (const level of ['L', 'M', 'Q', 'H']) {
      const needed = totalCodewordCount(version, level) * 8;
      const remainder = free - needed;
      assert.ok(
        remainder >= 0 && remainder < 8,
        `Version ${version}, Stufe ${level}: ${free} freie Module, ${needed} benötigt`,
      );
    }
  }
});

test('Jedes Datenmodul kommt in der Schreibreihenfolge genau einmal vor', () => {
  for (let version = 1; version <= 10; version += 1) {
    const order = dataModuleOrder(rebuildReserved(version));
    const seen = new Set(order.map(([r, c]) => `${r},${c}`));
    assert.equal(seen.size, order.length, `Version ${version} schreibt ein Modul doppelt`);
  }
});

test('Die Spalte 6 (Taktmuster) wird beim Schreiben übersprungen', () => {
  for (let version = 1; version <= 10; version += 1) {
    const order = dataModuleOrder(rebuildReserved(version));
    assert.ok(
      order.every(([, col]) => col !== 6),
      `Version ${version} schreibt in Spalte 6`,
    );
  }
});

test('Suchmuster, Taktmuster und dunkles Modul sitzen richtig', () => {
  const qr = encodeQr(PUBLIC_URL, { ecLevel: 'M' });
  const { size, modules } = qr;

  // Suchmuster: der äußere Ring ist dunkel, der Rahmen darum hell.
  for (const [top, left] of [
    [0, 0],
    [0, size - 7],
    [size - 7, 0],
  ]) {
    assert.equal(modules[top][left], 1, 'Ecke des Suchmusters ist nicht dunkel');
    assert.equal(modules[top + 3][left + 3], 1, 'Mitte des Suchmusters ist nicht dunkel');
    assert.equal(modules[top + 1][left + 1], 0, 'Ring des Suchmusters ist nicht hell');
  }

  // Taktmuster: abwechselnd dunkel/hell
  for (let i = 8; i < size - 8; i += 1) {
    assert.equal(modules[6][i], i % 2 === 0 ? 1 : 0, `Taktmuster waagerecht bei ${i}`);
    assert.equal(modules[i][6], i % 2 === 0 ? 1 : 0, `Taktmuster senkrecht bei ${i}`);
  }

  // Das dunkle Modul ist immer dunkel.
  assert.equal(modules[size - 8][8], 1);
});

test('Die Formatinformation steht an beiden vorgesehenen Stellen', () => {
  for (const level of ['L', 'M', 'Q', 'H']) {
    const qr = encodeQr(PUBLIC_URL, { ecLevel: level });
    const { size, modules } = qr;
    const expected = formatInfoBits(level, qr.mask);

    let copy1 = 0;
    let copy2 = 0;
    for (let i = 0; i < 15; i += 1) {
      const bit1 =
        i < 6 ? modules[i][8] : i === 6 ? modules[7][8] : i === 7 ? modules[8][8] : i === 8 ? modules[8][7] : modules[8][14 - i];
      const bit2 = i < 8 ? modules[8][size - 1 - i] : modules[size - 15 + i][8];
      copy1 |= bit1 << i;
      copy2 |= bit2 << i;
    }
    assert.equal(copy1, expected, `Stufe ${level}: erste Kopie stimmt nicht`);
    assert.equal(copy2, expected, `Stufe ${level}: zweite Kopie stimmt nicht`);
  }
});

// =========================================================================
// Vollständiger Rückweg: den erzeugten Code wieder auslesen
// =========================================================================

/**
 * Liest einen erzeugten QR-Code zurück in Text.
 * Prüft damit Datenkodierung, Fehlerkorrektur-Blöcke, Verschachtelung,
 * Platzierung und Maskierung in einem Durchgang.
 */
function decodeQr(qr) {
  const { version, ecLevel, mask, modules } = qr;
  const reserved = rebuildReserved(version);
  const order = dataModuleOrder(reserved);

  // 1. Maske entfernen und Bits einsammeln
  const bits = order.map(([row, col]) => {
    const value = modules[row][col];
    return __internals.maskCondition(mask, row, col) ? value ^ 1 : value;
  });

  // 2. Bits zu Codewörtern zusammensetzen
  const total = totalCodewordCount(version, ecLevel);
  const codewords = new Uint8Array(total);
  for (let i = 0; i < total; i += 1) {
    let byte = 0;
    for (let b = 0; b < 8; b += 1) byte = (byte << 1) | bits[i * 8 + b];
    codewords[i] = byte;
  }

  // 3. Verschachtelung der Datenblöcke rückgängig machen
  const [, g1Blocks, g1Words, g2Blocks, g2Words] = __internals.EC_TABLE[version][ecLevel];
  const blockCount = g1Blocks + g2Blocks;
  const blocks = Array.from({ length: blockCount }, () => []);
  const maxWords = Math.max(g1Words, g2Words || 0);
  let index = 0;
  for (let i = 0; i < maxWords; i += 1) {
    for (let b = 0; b < blockCount; b += 1) {
      const size = b < g1Blocks ? g1Words : g2Words;
      if (i < size) blocks[b].push(codewords[index++]);
    }
  }
  const data = blocks.flat();

  // 4. Nutzdaten auslesen
  let position = 0;
  const readBits = (count) => {
    let value = 0;
    for (let i = 0; i < count; i += 1) {
      const byte = data[position >> 3];
      const bit = (byte >> (7 - (position & 7))) & 1;
      value = (value << 1) | bit;
      position += 1;
    }
    return value;
  };

  const mode = readBits(4);
  assert.equal(mode, 0b0100, 'Es wurde kein Byte-Modus verwendet');
  const length = readBits(__internals.charCountBits(version));
  const bytes = [];
  for (let i = 0; i < length; i += 1) bytes.push(readBits(8));
  return new TextDecoder().decode(Uint8Array.from(bytes));
}

test('Die öffentliche Adresse lässt sich in jeder Stufe wieder auslesen', () => {
  for (const level of ['L', 'M', 'Q', 'H']) {
    const qr = encodeQr(PUBLIC_URL, { ecLevel: level });
    assert.equal(decodeQr(qr), PUBLIC_URL, `Stufe ${level}`);
  }
});

test('Die Adresse aus der Konfiguration ergibt genau diesen QR-Code', () => {
  assert.equal(
    PARTY_CONFIG.party.publicUrl,
    PUBLIC_URL,
    'Die öffentliche Adresse in der Konfiguration weicht ab',
  );
  const qr = encodeQr(PARTY_CONFIG.party.publicUrl, { ecLevel: 'Q' });
  assert.equal(decodeQr(qr), PARTY_CONFIG.party.publicUrl);
});

test('Texte jeder Länge werden korrekt kodiert und wieder ausgelesen', () => {
  const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 .:/?-_äöüß';
  for (let length = 1; length <= 120; length += 7) {
    let text = '';
    for (let i = 0; i < length; i += 1) {
      text += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
    for (const level of ['L', 'Q']) {
      const qr = encodeQr(text, { ecLevel: level });
      assert.equal(decodeQr(qr), text, `Länge ${length}, Stufe ${level}`);
    }
  }
});

test('Umlaute und Sonderzeichen überstehen den Weg (UTF-8)', () => {
  for (const text of ['Grüße', 'äöüßÄÖÜ', 'Straße 30 · Fürth', 'Café-Besuch']) {
    assert.equal(decodeQr(encodeQr(text, { ecLevel: 'M' })), text);
  }
});

test('Alle acht Masken erzeugen einen lesbaren Code', () => {
  for (let mask = 0; mask < 8; mask += 1) {
    const qr = encodeQr(PUBLIC_URL, { ecLevel: 'M', mask });
    assert.equal(qr.mask, mask);
    assert.equal(decodeQr(qr), PUBLIC_URL, `Maske ${mask}`);
  }
});

test('Die automatisch gewählte Maske ist eine der acht erlaubten', () => {
  const qr = encodeQr(PUBLIC_URL, { ecLevel: 'M' });
  assert.ok(qr.mask >= 0 && qr.mask <= 7);
});

// =========================================================================
// Version und Größe
// =========================================================================

test('Für längere Texte wird eine größere Version gewählt', () => {
  const short = encodeQr('kurz', { ecLevel: 'M' });
  const long = encodeQr('x'.repeat(120), { ecLevel: 'M' });
  assert.ok(long.version > short.version);
  assert.equal(short.size, short.version * 4 + 17);
  assert.equal(long.size, long.version * 4 + 17);
});

test('Eine höhere Fehlerkorrektur braucht mehr Platz', () => {
  const l = encodeQr(PUBLIC_URL, { ecLevel: 'L' });
  const h = encodeQr(PUBLIC_URL, { ecLevel: 'H' });
  assert.ok(h.version >= l.version);
});

test('Die Versionswahl passt zur Kapazität', () => {
  for (const level of ['L', 'M', 'Q', 'H']) {
    for (let bytes = 1; bytes <= 200; bytes += 13) {
      const version = chooseVersion(bytes, level);
      if (version === null) continue;
      const capacity = dataCodewordCount(version, level) * 8;
      const needed = 4 + (version <= 9 ? 8 : 16) + bytes * 8;
      assert.ok(needed <= capacity, `Version ${version} zu klein für ${bytes} Bytes (${level})`);
      if (version > 1) {
        // Die nächstkleinere Version darf gerade NICHT reichen.
        const smaller = version - 1;
        const smallerCapacity = dataCodewordCount(smaller, level) * 8;
        const smallerNeeded = 4 + (smaller <= 9 ? 8 : 16) + bytes * 8;
        assert.ok(
          smallerNeeded > smallerCapacity,
          `Version ${version} war unnötig groß für ${bytes} Bytes (${level})`,
        );
      }
    }
  }
});

// =========================================================================
// Darstellung
// =========================================================================

test('Der SVG-Export enthält alle dunklen Module', () => {
  const qr = encodeQr(PUBLIC_URL, { ecLevel: 'M' });
  const path = modulesToPath(qr);
  // Jedes "M" im Pfad ist ein waagerechter Block dunkler Module.
  const blocks = path.split('M').length - 1;
  assert.ok(blocks > 0);

  let dark = 0;
  for (let row = 0; row < qr.size; row += 1) {
    for (let col = 0; col < qr.size; col += 1) dark += qr.modules[row][col];
  }
  // Die Summe aller Blocklängen muss der Anzahl dunkler Module entsprechen.
  const lengths = [...path.matchAll(/h(\d+)v1/g)].reduce((sum, m) => sum + Number(m[1]), 0);
  assert.equal(lengths, dark);
});

test('Das erzeugte SVG ist wohlgeformt und enthält keinen fremden Inhalt', () => {
  const svg = qrToSvgString(PUBLIC_URL, { ecLevel: 'Q', title: 'Foto-Mission' });
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.match(svg, /<\/svg>$/);
  assert.match(svg, /<title>Foto-Mission<\/title>/);
  assert.ok(!svg.includes('<script'));
  // Es wird kein externer Dienst aufgerufen.
  assert.ok(!/https?:\/\/(?!www\.w3\.org)/.test(svg.replace(PUBLIC_URL, '')));
});

test('Ein Titel mit Sonderzeichen wird maskiert', () => {
  const svg = qrToSvgString('x', { title: '<script>alert(1)</script>' });
  assert.ok(!svg.includes('<script>'));
  assert.match(svg, /&lt;script&gt;/);
});
