// Bildverarbeitung im Browser: drehen, verkleinern, komprimieren.
//
// Ein angenehmer Nebeneffekt: Beim Neuzeichnen auf ein Canvas gehen ALLE
// Metadaten verloren - also auch EXIF-Daten mit GPS-Standort, Geraetemodell
// und Aufnahmezeit. Es werden ausschliesslich die reinen Bildpunkte
// weiterverwendet.

/**
 * Berechnet die Zielgroesse. Das Seitenverhaeltnis bleibt exakt erhalten,
 * es wird niemals beschnitten oder verzerrt.
 * @param {number} width
 * @param {number} height
 * @param {number} maxDimension
 * @returns {{width: number, height: number, scaled: boolean}}
 */
export function fitWithin(width, height, maxDimension) {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  const max = Math.max(1, Math.round(maxDimension));
  if (w <= max && h <= max) return { width: w, height: h, scaled: false };
  const ratio = Math.min(max / w, max / h);
  return {
    width: Math.max(1, Math.round(w * ratio)),
    height: Math.max(1, Math.round(h * ratio)),
    scaled: true,
  };
}

/**
 * Prueft einmalig, ob der Browser WebP schreiben kann.
 * @returns {Promise<boolean>}
 */
let webpSupport = null;
export async function supportsWebp() {
  if (webpSupport !== null) return webpSupport;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', 0.8));
    webpSupport = Boolean(blob && blob.type === 'image/webp');
  } catch {
    webpSupport = false;
  }
  return webpSupport;
}

/**
 * Laedt eine Bilddatei so, dass die EXIF-Drehung bereits angewendet ist.
 * @param {Blob} file
 * @returns {Promise<{source: CanvasImageSource, width: number, height: number, release: Function}>}
 */
export async function loadOrientedImage(file) {
  // Weg 1: createImageBitmap wendet die Drehung selbst an und ist am schnellsten.
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        release: () => {
          if (typeof bitmap.close === 'function') bitmap.close();
        },
      };
    } catch {
      // Weiter mit Weg 2.
    }
  }

  // Weg 2: klassisches <img>. Moderne Browser wenden die EXIF-Drehung
  // beim Zeichnen ebenfalls automatisch an.
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise((resolve, reject) => {
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => resolve(img);
      img.onerror = () =>
        reject(new Error('Dieses Bild konnte vom Browser nicht geöffnet werden.'));
      img.src = url;
    });
    const width = image.naturalWidth || image.width;
    const height = image.naturalHeight || image.height;
    if (!width || !height) {
      URL.revokeObjectURL(url);
      throw new Error('Dieses Bild konnte vom Browser nicht geöffnet werden.');
    }
    return {
      source: image,
      width,
      height,
      release: () => URL.revokeObjectURL(url),
    };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

function canvasToBlob(canvas, mimeType, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Das Bild konnte nicht gespeichert werden.'));
      },
      mimeType,
      quality,
    );
  });
}

/**
 * Verkleinert und komprimiert ein Foto.
 *
 * @param {Blob} file  Die vom Gast ausgewaehlte Datei
 * @param {{maxDimension?: number, quality?: number, preferWebp?: boolean, maxBytes?: number}} [options]
 * @returns {Promise<{blob: Blob, width: number, height: number, mimeType: string, originalBytes: number}>}
 */
export async function processPhoto(file, options = {}) {
  const {
    maxDimension = 2048,
    quality = 0.82,
    preferWebp = true,
    maxBytes = 6 * 1024 * 1024,
  } = options;

  const loaded = await loadOrientedImage(file);
  try {
    const useWebp = preferWebp && (await supportsWebp());
    let targetMime = useWebp ? 'image/webp' : 'image/jpeg';

    let currentMax = maxDimension;
    let currentQuality = quality;
    let best = null;

    // Bis zu vier Anlaeufe: erst Qualitaet senken, dann die Groesse.
    // So bleibt das Bild sichtbar gut, wird aber sicher klein genug.
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const size = fitWithin(loaded.width, loaded.height, currentMax);
      const canvas = document.createElement('canvas');
      canvas.width = size.width;
      canvas.height = size.height;
      const ctx = canvas.getContext('2d', { alpha: false });
      if (!ctx) throw new Error('Der Browser kann das Bild nicht verarbeiten.');
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      // Weisser Untergrund, damit durchsichtige PNG-Bereiche nicht schwarz werden.
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, size.width, size.height);
      ctx.drawImage(loaded.source, 0, 0, size.width, size.height);

      let blob = await canvasToBlob(canvas, targetMime, currentQuality);
      // Manche Browser liefern PNG zurueck, wenn das gewuenschte Format fehlt.
      if (blob.type !== targetMime) {
        targetMime = 'image/jpeg';
        blob = await canvasToBlob(canvas, targetMime, currentQuality);
      }

      best = { blob, width: size.width, height: size.height, mimeType: blob.type };
      if (blob.size <= maxBytes) break;

      if (attempt === 0) currentQuality = Math.max(0.6, currentQuality - 0.15);
      else if (attempt === 1) currentQuality = 0.5;
      else currentMax = Math.max(800, Math.round(currentMax * 0.7));
    }

    if (!best) throw new Error('Das Bild konnte nicht verarbeitet werden.');
    return { ...best, originalBytes: file.size || 0 };
  } finally {
    loaded.release();
  }
}

/**
 * Liest die ersten Bytes einer Datei und prueft die "Magic Bytes".
 * Damit wird erkannt, ob wirklich ein Bild vorliegt - unabhaengig davon,
 * was der Dateiname oder der gemeldete MIME-Typ behaupten.
 * @param {Blob} file
 * @returns {Promise<string>} erkannter Typ oder '' wenn unbekannt
 */
export async function sniffImageType(file) {
  try {
    const buffer = await file.slice(0, 16).arrayBuffer();
    const bytes = new Uint8Array(buffer);
    if (bytes.length < 12) return '';
    // JPEG: FF D8 FF
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
    // PNG: 89 50 4E 47 0D 0A 1A 0A
    if (
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47 &&
      bytes[4] === 0x0d &&
      bytes[5] === 0x0a &&
      bytes[6] === 0x1a &&
      bytes[7] === 0x0a
    ) {
      return 'image/png';
    }
    // GIF
    if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return 'image/gif';
    // RIFF....WEBP
    const tag = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]);
    if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) {
      if (tag === 'WEBP') return 'image/webp';
    }
    // ISO-BMFF: ....ftypheic / ftypmif1 / ftypavif
    if (String.fromCharCode(bytes[4], bytes[5], bytes[6], bytes[7]) === 'ftyp') {
      const brand = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]);
      if (brand.startsWith('hei') || brand === 'mif1' || brand === 'msf1') return 'image/heic';
      if (brand === 'avif' || brand === 'avis') return 'image/avif';
    }
    return '';
  } catch {
    return '';
  }
}
