// Eigener QR-Code-Encoder (QR Model 2, Byte-Modus, Versionen 1-10).
//
// Warum selbst gebaut?
// Die Aufgabe verlangt ausdruecklich, KEINE externe QR-Code-API zu verwenden,
// die Nutzungsdaten erhalten koennte. Ausserdem bleibt das Projekt so komplett
// ohne Abhaengigkeiten und ohne Build-Schritt.
//
// Aufbau:
//   1. Text -> Bitfolge (Modus, Laenge, UTF-8-Daten, Fuellbytes)
//   2. Aufteilen in Bloecke + Reed-Solomon-Fehlerkorrektur
//   3. Verschachteln der Bloecke
//   4. Platzieren im Raster (Zickzack von unten rechts)
//   5. Alle 8 Masken testen, die mit der geringsten Strafpunktzahl gewinnt
//   6. Format- und Versionsinformationen eintragen

// ---------------------------------------------------------------------------
// Tabellen aus der QR-Norm (ISO/IEC 18004)
// ---------------------------------------------------------------------------

// Fehlerkorrektur-Stufen: [Bitmuster fuer die Formatinformation]
export const EC_LEVELS = { L: 0b01, M: 0b00, Q: 0b11, H: 0b10 };

// Pro Version und Stufe:
// [Fehlerkorrektur-Codewoerter je Block, Bloecke Gruppe 1, Datenwoerter Gruppe 1,
//  Bloecke Gruppe 2, Datenwoerter Gruppe 2]
const EC_TABLE = {
  1: { L: [7, 1, 19, 0, 0], M: [10, 1, 16, 0, 0], Q: [13, 1, 13, 0, 0], H: [17, 1, 9, 0, 0] },
  2: { L: [10, 1, 34, 0, 0], M: [16, 1, 28, 0, 0], Q: [22, 1, 22, 0, 0], H: [28, 1, 16, 0, 0] },
  3: { L: [15, 1, 55, 0, 0], M: [26, 1, 44, 0, 0], Q: [18, 2, 17, 0, 0], H: [22, 2, 13, 0, 0] },
  4: { L: [20, 1, 80, 0, 0], M: [18, 2, 32, 0, 0], Q: [26, 2, 24, 0, 0], H: [16, 4, 9, 0, 0] },
  5: { L: [26, 1, 108, 0, 0], M: [24, 2, 43, 0, 0], Q: [18, 2, 15, 2, 16], H: [22, 2, 11, 2, 12] },
  6: { L: [18, 2, 68, 0, 0], M: [16, 4, 27, 0, 0], Q: [24, 4, 19, 0, 0], H: [28, 4, 15, 0, 0] },
  7: { L: [20, 2, 78, 0, 0], M: [18, 4, 31, 0, 0], Q: [18, 2, 14, 4, 15], H: [26, 4, 13, 1, 14] },
  8: {
    L: [24, 2, 97, 0, 0],
    M: [22, 2, 38, 2, 39],
    Q: [22, 4, 18, 2, 19],
    H: [26, 4, 14, 2, 15],
  },
  9: {
    L: [30, 2, 116, 0, 0],
    M: [22, 3, 36, 2, 37],
    Q: [20, 4, 16, 4, 17],
    H: [24, 4, 12, 4, 13],
  },
  10: {
    L: [18, 2, 68, 2, 69],
    M: [26, 4, 43, 1, 44],
    Q: [24, 6, 19, 2, 20],
    H: [28, 6, 15, 2, 16],
  },
};

// Mittelpunkte der Ausrichtungsmuster je Version.
const ALIGNMENT_POSITIONS = {
  1: [],
  2: [6, 18],
  3: [6, 22],
  4: [6, 26],
  5: [6, 30],
  6: [6, 34],
  7: [6, 22, 38],
  8: [6, 24, 42],
  9: [6, 26, 46],
  10: [6, 28, 50],
};

export const MIN_VERSION = 1;
export const MAX_VERSION = 10;

// ---------------------------------------------------------------------------
// Galois-Feld GF(256), Primitivpolynom 0x11D
// ---------------------------------------------------------------------------

const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
(function buildGaloisTables() {
  let x = 1;
  for (let i = 0; i < 255; i += 1) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i += 1) GF_EXP[i] = GF_EXP[i - 255];
})();

function gfMul(a, b) {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

/**
 * Erzeugt das Generatorpolynom fuer n Fehlerkorrektur-Codewoerter.
 * @param {number} degree
 * @returns {Uint8Array}
 */
export function generatorPolynomial(degree) {
  let poly = Uint8Array.from([1]);
  for (let i = 0; i < degree; i += 1) {
    const next = new Uint8Array(poly.length + 1);
    for (let j = 0; j < poly.length; j += 1) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], GF_EXP[i]);
    }
    poly = next;
  }
  return poly;
}

/**
 * Berechnet die Reed-Solomon-Fehlerkorrektur-Codewoerter.
 * @param {Uint8Array|number[]} data
 * @param {number} ecCount
 * @returns {Uint8Array}
 */
export function reedSolomonEncode(data, ecCount) {
  const generator = generatorPolynomial(ecCount);
  const remainder = new Uint8Array(ecCount);
  for (let i = 0; i < data.length; i += 1) {
    const factor = data[i] ^ remainder[0];
    remainder.copyWithin(0, 1);
    remainder[ecCount - 1] = 0;
    if (factor !== 0) {
      for (let j = 0; j < ecCount; j += 1) {
        remainder[j] ^= gfMul(generator[j + 1], factor);
      }
    }
  }
  return remainder;
}

// ---------------------------------------------------------------------------
// BCH-Codes fuer Format- und Versionsinformation
// ---------------------------------------------------------------------------

function bchRemainder(value, generator, generatorBits) {
  let result = value;
  const valueBits = generatorBits;
  while (bitLength(result) >= valueBits) {
    result ^= generator << (bitLength(result) - valueBits);
  }
  return result;
}

function bitLength(value) {
  let length = 0;
  let v = value;
  while (v !== 0) {
    length += 1;
    v >>>= 1;
  }
  return length;
}

/**
 * 15-Bit-Formatinformation (Fehlerkorrekturstufe + Maske).
 * @param {'L'|'M'|'Q'|'H'} ecLevel
 * @param {number} mask 0..7
 * @returns {number}
 */
export function formatInfoBits(ecLevel, mask) {
  const levelBits = EC_LEVELS[ecLevel];
  if (levelBits === undefined) throw new Error(`Unbekannte Fehlerkorrekturstufe: ${ecLevel}`);
  if (!Number.isInteger(mask) || mask < 0 || mask > 7) {
    throw new Error(`Ungültige Maske: ${mask}`);
  }
  const data = (levelBits << 3) | mask;
  const remainder = bchRemainder(data << 10, 0b10100110111, 11);
  return ((data << 10) | remainder) ^ 0b101010000010010;
}

/**
 * 18-Bit-Versionsinformation (erst ab Version 7 noetig).
 * @param {number} version
 * @returns {number}
 */
export function versionInfoBits(version) {
  const remainder = bchRemainder(version << 12, 0b1111100100101, 13);
  return (version << 12) | remainder;
}

// ---------------------------------------------------------------------------
// Datenkodierung
// ---------------------------------------------------------------------------

function textToBytes(text) {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(text);
  // Sehr einfacher UTF-8-Encoder als Notfall-Loesung.
  const out = [];
  for (const char of String(text)) {
    let code = char.codePointAt(0);
    if (code < 0x80) out.push(code);
    else if (code < 0x800) out.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    else if (code < 0x10000) {
      out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    } else {
      out.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      );
    }
  }
  return Uint8Array.from(out);
}

/** Anzahl der Bits fuer die Zeichenanzahl im Byte-Modus. */
function charCountBits(version) {
  return version <= 9 ? 8 : 16;
}

/** Gesamtzahl der Datencodewoerter fuer Version + Stufe. */
export function dataCodewordCount(version, ecLevel) {
  const [, g1Blocks, g1Words, g2Blocks, g2Words] = EC_TABLE[version][ecLevel];
  return g1Blocks * g1Words + g2Blocks * g2Words;
}

/** Gesamtzahl aller Codewoerter (Daten + Fehlerkorrektur). */
export function totalCodewordCount(version, ecLevel) {
  const [ecPerBlock, g1Blocks, g1Words, g2Blocks, g2Words] = EC_TABLE[version][ecLevel];
  return g1Blocks * g1Words + g2Blocks * g2Words + (g1Blocks + g2Blocks) * ecPerBlock;
}

/**
 * Sucht die kleinste Version, in die der Text passt.
 * @param {number} byteLength
 * @param {'L'|'M'|'Q'|'H'} ecLevel
 * @param {number} minVersion
 * @param {number} maxVersion
 */
export function chooseVersion(byteLength, ecLevel, minVersion = MIN_VERSION, maxVersion = MAX_VERSION) {
  for (let version = Math.max(MIN_VERSION, minVersion); version <= Math.min(MAX_VERSION, maxVersion); version += 1) {
    const capacityBits = dataCodewordCount(version, ecLevel) * 8;
    const neededBits = 4 + charCountBits(version) + byteLength * 8;
    if (neededBits <= capacityBits) return version;
  }
  return null;
}

/**
 * Baut die vollstaendige Codewort-Folge inklusive Fehlerkorrektur.
 * @param {string} text
 * @param {number} version
 * @param {'L'|'M'|'Q'|'H'} ecLevel
 * @returns {Uint8Array}
 */
export function buildCodewords(text, version, ecLevel) {
  const bytes = textToBytes(text);
  const totalDataWords = dataCodewordCount(version, ecLevel);
  const capacityBits = totalDataWords * 8;

  const bits = [];
  const pushBits = (value, count) => {
    for (let i = count - 1; i >= 0; i -= 1) bits.push((value >> i) & 1);
  };

  pushBits(0b0100, 4); // Byte-Modus
  pushBits(bytes.length, charCountBits(version));
  for (const byte of bytes) pushBits(byte, 8);

  // Abschlusszeichen (bis zu 4 Nullbits)
  const terminator = Math.min(4, capacityBits - bits.length);
  for (let i = 0; i < terminator; i += 1) bits.push(0);
  // Auf ganze Bytes auffuellen
  while (bits.length % 8 !== 0) bits.push(0);

  const dataWords = new Uint8Array(totalDataWords);
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0;
    for (let b = 0; b < 8; b += 1) byte = (byte << 1) | bits[i + b];
    dataWords[i / 8] = byte;
  }
  // Fuellbytes 0xEC / 0x11 im Wechsel
  const usedWords = bits.length / 8;
  for (let i = usedWords; i < totalDataWords; i += 1) {
    dataWords[i] = i % 2 === usedWords % 2 ? 0xec : 0x11;
  }

  // In Bloecke aufteilen
  const [ecPerBlock, g1Blocks, g1Words, g2Blocks, g2Words] = EC_TABLE[version][ecLevel];
  const dataBlocks = [];
  const ecBlocks = [];
  let offset = 0;
  for (let i = 0; i < g1Blocks + g2Blocks; i += 1) {
    const size = i < g1Blocks ? g1Words : g2Words;
    const block = dataWords.subarray(offset, offset + size);
    offset += size;
    dataBlocks.push(block);
    ecBlocks.push(reedSolomonEncode(block, ecPerBlock));
  }

  // Verschachteln
  const result = new Uint8Array(totalCodewordCount(version, ecLevel));
  let index = 0;
  const maxDataWords = Math.max(g1Words, g2Words || 0);
  for (let i = 0; i < maxDataWords; i += 1) {
    for (const block of dataBlocks) {
      if (i < block.length) result[index++] = block[i];
    }
  }
  for (let i = 0; i < ecPerBlock; i += 1) {
    for (const block of ecBlocks) {
      result[index++] = block[i];
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Raster aufbauen
// ---------------------------------------------------------------------------

function createMatrix(size) {
  const modules = [];
  const reserved = [];
  for (let row = 0; row < size; row += 1) {
    modules.push(new Uint8Array(size));
    reserved.push(new Uint8Array(size));
  }
  return { modules, reserved };
}

function placeFinder(modules, reserved, top, left) {
  for (let r = -1; r <= 7; r += 1) {
    for (let c = -1; c <= 7; c += 1) {
      const row = top + r;
      const col = left + c;
      if (row < 0 || col < 0 || row >= modules.length || col >= modules.length) continue;
      const isBorder = r === 0 || r === 6 || c === 0 || c === 6;
      const isCore = r >= 2 && r <= 4 && c >= 2 && c <= 4;
      const inside = r >= 0 && r <= 6 && c >= 0 && c <= 6;
      modules[row][col] = inside && (isBorder || isCore) ? 1 : 0;
      reserved[row][col] = 1;
    }
  }
}

function placeAlignment(modules, reserved, version) {
  const positions = ALIGNMENT_POSITIONS[version] || [];
  const size = modules.length;
  for (const centerRow of positions) {
    for (const centerCol of positions) {
      // Die drei Ecken sind bereits von den Suchmustern belegt.
      const nearFinder =
        (centerRow <= 8 && centerCol <= 8) ||
        (centerRow <= 8 && centerCol >= size - 9) ||
        (centerRow >= size - 9 && centerCol <= 8);
      if (nearFinder) continue;
      for (let r = -2; r <= 2; r += 1) {
        for (let c = -2; c <= 2; c += 1) {
          const row = centerRow + r;
          const col = centerCol + c;
          const isRing = Math.max(Math.abs(r), Math.abs(c)) !== 1;
          modules[row][col] = isRing ? 1 : 0;
          reserved[row][col] = 1;
        }
      }
    }
  }
}

function placeTiming(modules, reserved) {
  const size = modules.length;
  for (let i = 8; i < size - 8; i += 1) {
    const value = i % 2 === 0 ? 1 : 0;
    if (!reserved[6][i]) {
      modules[6][i] = value;
      reserved[6][i] = 1;
    }
    if (!reserved[i][6]) {
      modules[i][6] = value;
      reserved[i][6] = 1;
    }
  }
}

function reserveFormatAreas(modules, reserved, version) {
  const size = modules.length;
  // Dunkles Modul - gehoert fest zum Symbol.
  modules[size - 8][8] = 1;
  reserved[size - 8][8] = 1;

  for (let i = 0; i < 9; i += 1) {
    if (!reserved[8][i]) reserved[8][i] = 1;
    if (!reserved[i][8]) reserved[i][8] = 1;
  }
  for (let i = 0; i < 8; i += 1) {
    reserved[8][size - 1 - i] = 1;
    reserved[size - 1 - i][8] = 1;
  }

  if (version >= 7) {
    for (let i = 0; i < 6; i += 1) {
      for (let j = 0; j < 3; j += 1) {
        reserved[size - 11 + j][i] = 1;
        reserved[i][size - 11 + j] = 1;
      }
    }
  }
}

/**
 * Reihenfolge, in der die Datenmodule beschrieben werden:
 * zwei Spalten gleichzeitig, von unten rechts im Zickzack nach oben.
 * Spalte 6 (senkrechtes Taktmuster) wird uebersprungen.
 * @param {Uint8Array[]} reserved
 * @returns {Array<[number, number]>}
 */
export function dataModuleOrder(reserved) {
  const size = reserved.length;
  const order = [];
  let upward = true;
  for (let right = size - 1; right >= 1; right -= 2) {
    // Spalte 6 ist das senkrechte Taktmuster und wird komplett uebersprungen.
    if (right === 6) right = 5;
    for (let step = 0; step < size; step += 1) {
      const row = upward ? size - 1 - step : step;
      for (const col of [right, right - 1]) {
        if (!reserved[row][col]) order.push([row, col]);
      }
    }
    upward = !upward;
  }
  return order;
}

function maskCondition(mask, row, col) {
  switch (mask) {
    case 0:
      return (row + col) % 2 === 0;
    case 1:
      return row % 2 === 0;
    case 2:
      return col % 3 === 0;
    case 3:
      return (row + col) % 3 === 0;
    case 4:
      return (Math.floor(row / 2) + Math.floor(col / 3)) % 2 === 0;
    case 5:
      return ((row * col) % 2) + ((row * col) % 3) === 0;
    case 6:
      return (((row * col) % 2) + ((row * col) % 3)) % 2 === 0;
    case 7:
      return (((row + col) % 2) + ((row * col) % 3)) % 2 === 0;
    default:
      throw new Error(`Unbekannte Maske: ${mask}`);
  }
}

function applyFormatInfo(modules, ecLevel, mask) {
  const size = modules.length;
  const bits = formatInfoBits(ecLevel, mask);
  for (let i = 0; i < 15; i += 1) {
    const bit = (bits >> i) & 1;
    // Kopie 1: senkrecht in Spalte 8 (Zeile 6 wird als Taktmuster uebersprungen),
    // danach waagerecht in Zeile 8 (Spalte 6 wird uebersprungen).
    if (i < 6) modules[i][8] = bit;
    else if (i === 6) modules[7][8] = bit;
    else if (i === 7) modules[8][8] = bit;
    else if (i === 8) modules[8][7] = bit;
    else modules[8][14 - i] = bit;

    // Kopie 2: waagerecht unter dem Suchmuster oben rechts,
    // senkrecht neben dem Suchmuster unten links.
    if (i < 8) modules[8][size - 1 - i] = bit;
    else modules[size - 15 + i][8] = bit;
  }
}

function applyVersionInfo(modules, version) {
  if (version < 7) return;
  const size = modules.length;
  const bits = versionInfoBits(version);
  for (let i = 0; i < 18; i += 1) {
    const bit = (bits >> i) & 1;
    const row = Math.floor(i / 3);
    const col = size - 11 + (i % 3);
    modules[row][col] = bit;
    modules[col][row] = bit;
  }
}

// Strafpunkte nach der Norm - je weniger, desto besser lesbar.
function maskPenalty(modules) {
  const size = modules.length;
  let penalty = 0;

  // Regel 1: fuenf oder mehr gleiche Module in einer Reihe
  for (let i = 0; i < size; i += 1) {
    let runRow = 1;
    let runCol = 1;
    for (let j = 1; j < size; j += 1) {
      runRow = modules[i][j] === modules[i][j - 1] ? runRow + 1 : 1;
      if (runRow === 5) penalty += 3;
      else if (runRow > 5) penalty += 1;
      runCol = modules[j][i] === modules[j - 1][i] ? runCol + 1 : 1;
      if (runCol === 5) penalty += 3;
      else if (runCol > 5) penalty += 1;
    }
  }

  // Regel 2: 2x2-Bloecke gleicher Farbe
  for (let row = 0; row < size - 1; row += 1) {
    for (let col = 0; col < size - 1; col += 1) {
      const v = modules[row][col];
      if (v === modules[row][col + 1] && v === modules[row + 1][col] && v === modules[row + 1][col + 1]) {
        penalty += 3;
      }
    }
  }

  // Regel 3: Muster, das dem Suchmuster aehnelt
  const patternA = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
  const patternB = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
  const matches = (get, start) => {
    let a = true;
    let b = true;
    for (let k = 0; k < 11; k += 1) {
      const value = get(start + k);
      if (value !== patternA[k]) a = false;
      if (value !== patternB[k]) b = false;
    }
    return a || b;
  };
  for (let i = 0; i < size; i += 1) {
    for (let j = 0; j <= size - 11; j += 1) {
      if (matches((k) => modules[i][k], j)) penalty += 40;
      if (matches((k) => modules[k][i], j)) penalty += 40;
    }
  }

  // Regel 4: Verhaeltnis dunkler Module
  let dark = 0;
  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size; col += 1) dark += modules[row][col];
  }
  const ratio = (dark * 100) / (size * size);
  penalty += Math.floor(Math.abs(ratio - 50) / 5) * 10;

  return penalty;
}

/**
 * Erzeugt einen QR-Code.
 * @param {string} text
 * @param {{ecLevel?: 'L'|'M'|'Q'|'H', minVersion?: number, maxVersion?: number, mask?: number|null}} [options]
 * @returns {{size: number, version: number, ecLevel: string, mask: number, modules: Uint8Array[]}}
 */
export function encodeQr(text, options = {}) {
  const ecLevel = options.ecLevel || 'M';
  if (!(ecLevel in EC_LEVELS)) throw new Error(`Unbekannte Fehlerkorrekturstufe: ${ecLevel}`);
  const value = String(text == null ? '' : text);
  if (value.length === 0) throw new Error('Für den QR-Code wurde kein Text übergeben.');

  const byteLength = textToBytes(value).length;
  const version = chooseVersion(byteLength, ecLevel, options.minVersion, options.maxVersion);
  if (version === null) {
    throw new Error(
      `Der Text ist zu lang für einen QR-Code der Version ${MAX_VERSION} mit Stufe ${ecLevel}.`,
    );
  }

  const size = version * 4 + 17;
  const { modules, reserved } = createMatrix(size);

  placeFinder(modules, reserved, 0, 0);
  placeFinder(modules, reserved, 0, size - 7);
  placeFinder(modules, reserved, size - 7, 0);
  placeAlignment(modules, reserved, version);
  placeTiming(modules, reserved);
  reserveFormatAreas(modules, reserved, version);

  const codewords = buildCodewords(value, version, ecLevel);
  const order = dataModuleOrder(reserved);

  // Sicherheitsnetz: die Anzahl freier Module muss zur Codewortzahl passen.
  const expectedBits = codewords.length * 8;
  if (order.length < expectedBits) {
    throw new Error(
      `Interner Fehler: ${order.length} freie Module, benötigt werden ${expectedBits}.`,
    );
  }

  for (let i = 0; i < order.length; i += 1) {
    const [row, col] = order[i];
    const byteIndex = i >> 3;
    const bitIndex = 7 - (i & 7);
    const bit = byteIndex < codewords.length ? (codewords[byteIndex] >> bitIndex) & 1 : 0;
    modules[row][col] = bit;
  }

  // Maske waehlen
  const candidates = options.mask == null ? [0, 1, 2, 3, 4, 5, 6, 7] : [options.mask];
  let best = null;
  for (const mask of candidates) {
    const masked = modules.map((row) => Uint8Array.from(row));
    for (const [row, col] of order) {
      if (maskCondition(mask, row, col)) masked[row][col] ^= 1;
    }
    applyFormatInfo(masked, ecLevel, mask);
    applyVersionInfo(masked, version);
    const penalty = maskPenalty(masked);
    if (best === null || penalty < best.penalty) best = { mask, penalty, modules: masked };
  }

  return { size, version, ecLevel, mask: best.mask, modules: best.modules };
}

// Nur fuer Tests: interne Hilfsfunktionen zugaenglich machen.
export const __internals = {
  maskCondition,
  maskPenalty,
  createMatrix,
  placeFinder,
  placeAlignment,
  placeTiming,
  reserveFormatAreas,
  textToBytes,
  charCountBits,
  EC_TABLE,
  ALIGNMENT_POSITIONS,
};
