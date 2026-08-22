// Logik fuer die privaten Erinnerungen ("Fuer Britta & Lutz").
//
// Dieses Modul entscheidet, welche Dateien erlaubt sind, zaehlt sie, baut die
// Speicherpfade und formuliert die Meldungen. Es ist bewusst frei von
// Browser-Abhaengigkeiten, damit sich alles ohne Browser testen laesst.
//
// WICHTIG ZUR SICHERHEIT
// Der Ordnername enthaelt den Gaestenamen nur zur Uebersicht. Er ist KEIN
// Schutz. Der Schutz kommt ausschliesslich aus dem privaten Bucket und den
// Regeln in supabase/private-memories.sql.

/** Standardgrenzen, falls die Konfiguration einmal unvollstaendig ist. */
export const DEFAULT_MEMORY_LIMITS = {
  maxPhotos: 20,
  maxVideos: 5,
  maxPhotoBytes: 15 * 1024 * 1024,
  maxVideoBytes: 45 * 1024 * 1024,
  maxMessageLength: 1000,
  photoMimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'],
  videoMimeTypes: ['video/mp4', 'video/quicktime', 'video/webm'],
  photoExtensions: ['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif'],
  videoExtensions: ['mp4', 'mov', 'm4v', 'webm'],
};

/** Fuellt fehlende Werte aus den Standardgrenzen auf. */
export function withMemoryDefaults(limits = {}) {
  return { ...DEFAULT_MEMORY_LIMITS, ...limits };
}

/**
 * Die Endung einer Datei in Kleinbuchstaben, ohne Punkt.
 * @param {string} name
 * @returns {string}
 */
export function fileExtension(name) {
  const value = String(name || '');
  const dot = value.lastIndexOf('.');
  if (dot < 0 || dot === value.length - 1) return '';
  return value
    .slice(dot + 1)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Ist das ein Foto, ein Video oder etwas, das hier nichts zu suchen hat?
 *
 * Handys liefern nicht immer einen brauchbaren MIME-Typ mit (bei .mov und
 * .heic passiert das oft). Deshalb zaehlt zusaetzlich die Dateiendung.
 *
 * @param {{name?: string, type?: string}} file
 * @param {object} [limits]
 * @returns {'photo'|'video'|null}
 */
export function detectMediaKind(file, limits = {}) {
  const l = withMemoryDefaults(limits);
  if (!file) return null;
  const type = String(file.type || '').toLowerCase();
  const extension = fileExtension(file.name);

  if (l.photoMimeTypes.includes(type)) return 'photo';
  if (l.videoMimeTypes.includes(type)) return 'video';
  // Kein oder ein unbekannter MIME-Typ: die Endung entscheidet.
  if (l.photoExtensions.includes(extension)) return 'photo';
  if (l.videoExtensions.includes(extension)) return 'video';
  return null;
}

/** Deutsche Groessenangabe fuer Meldungen ("15 MB"). */
function megabytes(bytes) {
  return `${Math.round(Number(bytes) / (1024 * 1024))} MB`;
}

/**
 * Prueft eine einzelne Datei.
 * @param {{name?: string, type?: string, size?: number}} file
 * @param {object} [limits]
 * @returns {{valid: boolean, kind: 'photo'|'video'|null, error: string|null}}
 */
export function validateMemoryFile(file, limits = {}) {
  const l = withMemoryDefaults(limits);
  const name = String((file && file.name) || 'Datei');
  const kind = detectMediaKind(file, l);

  if (!kind) {
    return { valid: false, kind: null, error: `Der Dateityp von „${name}“ wird nicht unterstützt.` };
  }
  const size = Number((file && file.size) || 0);
  if (size <= 0) {
    return { valid: false, kind, error: `Die Datei „${name}“ ist leer.` };
  }
  const maxBytes = kind === 'photo' ? l.maxPhotoBytes : l.maxVideoBytes;
  if (size > maxBytes) {
    return {
      valid: false,
      kind,
      error:
        kind === 'photo'
          ? `Das Foto „${name}“ ist größer als ${megabytes(maxBytes)}.`
          : `Das Video „${name}“ ist größer als ${megabytes(maxBytes)}.`,
    };
  }
  return { valid: true, kind, error: null };
}

/** Erkennt dieselbe Datei wieder, damit sie nicht doppelt in der Liste landet. */
function fileKey(file) {
  return `${file.name}|${file.size}|${file.lastModified || 0}`;
}

/**
 * Nimmt neue Dateien in die Auswahl auf und erklaert genau, was nicht ging.
 *
 * Es wird bewusst NICHTS stillschweigend verworfen: Wer 18 Fotos hat und 5
 * weitere auswaehlt, bekommt die ersten 2 aufgenommen und dazu einen klaren
 * Satz, warum der Rest nicht passt.
 *
 * @param {Array<{file: object, kind: string}>} current  bisherige Auswahl
 * @param {Array<object>} incoming  neu ausgewaehlte Dateien
 * @param {object} [limits]
 * @returns {{files: Array, added: number, messages: string[]}}
 */
export function addMemoryFiles(current, incoming, limits = {}) {
  const l = withMemoryDefaults(limits);
  const files = Array.isArray(current) ? [...current] : [];
  const messages = [];
  const known = new Set(files.map((entry) => fileKey(entry.file)));

  let photos = files.filter((entry) => entry.kind === 'photo').length;
  let videos = files.filter((entry) => entry.kind === 'video').length;
  // Wie viele Dateien wurden allein wegen des Limits abgewiesen?
  let photosOverLimit = 0;
  let videosOverLimit = 0;
  let added = 0;

  for (const file of Array.isArray(incoming) ? incoming : []) {
    const check = validateMemoryFile(file, l);
    if (!check.valid) {
      messages.push(check.error);
      continue;
    }
    if (known.has(fileKey(file))) {
      messages.push(`„${file.name}“ ist schon in der Liste.`);
      continue;
    }
    if (check.kind === 'photo' && photos >= l.maxPhotos) {
      photosOverLimit += 1;
      continue;
    }
    if (check.kind === 'video' && videos >= l.maxVideos) {
      videosOverLimit += 1;
      continue;
    }

    known.add(fileKey(file));
    files.push({ file, kind: check.kind });
    added += 1;
    if (check.kind === 'photo') photos += 1;
    else videos += 1;
  }

  if (photosOverLimit > 0) {
    messages.push(limitMessage('photo', photos, l));
  }
  if (videosOverLimit > 0) {
    messages.push(limitMessage('video', videos, l));
  }

  return { files, added, messages };
}

/**
 * Der Satz, der erklaert, warum nicht alles aufgenommen wurde.
 * @param {'photo'|'video'} kind
 * @param {number} selected  wie viele schon ausgewaehlt sind
 * @param {object} [limits]
 */
export function limitMessage(kind, selected, limits = {}) {
  const l = withMemoryDefaults(limits);
  const max = kind === 'photo' ? l.maxPhotos : l.maxVideos;
  const wort = kind === 'photo' ? 'Fotos' : 'Videos';
  const frei = Math.max(0, max - selected);

  if (frei === 0) {
    return `Du kannst höchstens ${max} ${wort} hochladen. Du hast bereits ${selected} ${wort} ausgewählt.`;
  }
  const nachschub = frei === 1 ? '1 hinzufügen' : `${frei} hinzufügen`;
  return (
    `Du kannst höchstens ${max} ${wort} hochladen. ` +
    `Du hast bereits ${selected} ${wort} ausgewählt und kannst noch ${nachschub}.`
  );
}

/**
 * Der dauerhaft sichtbare Zaehler ueber dem Auswahlbereich.
 * @param {'photo'|'video'} kind
 * @param {number} count
 * @param {object} [limits]
 */
export function counterText(kind, count, limits = {}) {
  const l = withMemoryDefaults(limits);
  const max = kind === 'photo' ? l.maxPhotos : l.maxVideos;
  return `${kind === 'photo' ? 'Fotos' : 'Videos'}: ${count} von ${max} ausgewählt`;
}

/**
 * Der Hinweis, sobald das Limit voll ist.
 * @param {'photo'|'video'} kind
 * @param {object} [limits]
 */
export function limitReachedText(kind, limits = {}) {
  const l = withMemoryDefaults(limits);
  const max = kind === 'photo' ? l.maxPhotos : l.maxVideos;
  return `Du hast das Limit von ${max} ${kind === 'photo' ? 'Fotos' : 'Videos'} erreicht.`;
}

/**
 * Zaehlt die Auswahl zusammen.
 * @param {Array<{file: {size?: number}, kind: string}>} files
 */
export function summarizeMemoryFiles(files) {
  const list = Array.isArray(files) ? files : [];
  let photoCount = 0;
  let videoCount = 0;
  let totalBytes = 0;
  for (const entry of list) {
    if (!entry || !entry.file) continue;
    totalBytes += Number(entry.file.size) || 0;
    if (entry.kind === 'photo') photoCount += 1;
    else if (entry.kind === 'video') videoCount += 1;
  }
  return { photoCount, videoCount, totalBytes, count: photoCount + videoCount };
}

/**
 * Macht aus einem Gaestenamen ein unbedenkliches Stueck Speicherpfad.
 *
 * Nur Kleinbuchstaben, Ziffern und Bindestriche. Umlaute werden lesbar
 * umgeschrieben, alles andere entfaellt. Der vollstaendige Name wird davon
 * nicht beruehrt - der steht unveraendert in der Datenbank.
 *
 * @param {unknown} raw
 * @returns {string}
 */
export function slugifyGuestName(raw) {
  const umlaute = { ä: 'ae', ö: 'oe', ü: 'ue', Ä: 'ae', Ö: 'oe', Ü: 'ue', ß: 'ss' };
  const value = String(raw == null ? '' : raw)
    .replace(/[äöüÄÖÜß]/g, (ch) => umlaute[ch])
    // Akzente abtrennen und verwerfen: aus "é" wird "e".
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
  return value === '' ? 'gast' : value;
}

/** Zweistellig, fuer Datum und Uhrzeit im Ordnernamen. */
function pad(value) {
  return String(value).padStart(2, '0');
}

/**
 * Zerlegt einen Zeitpunkt in deutscher Zeit (Europe/Berlin).
 *
 * Die Gaeste stehen in Deutschland, die Feier auch - der Ordnername soll
 * deshalb die Uhrzeit zeigen, die an dem Abend auf der Uhr stand, und nicht
 * die Weltzeit.
 *
 * @param {Date|string|number} value
 * @returns {{date: string, time: string, iso: string}}
 */
export function berlinParts(value) {
  const date = value instanceof Date ? value : new Date(value);
  const stamp = Number.isNaN(date.getTime()) ? new Date() : date;
  const formatter = new Intl.DateTimeFormat('de-DE', {
    timeZone: 'Europe/Berlin',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts = {};
  for (const part of formatter.formatToParts(stamp)) parts[part.type] = part.value;
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${pad(parts.hour)}-${parts.minute}-${parts.second}`,
    iso: stamp.toISOString(),
  };
}

/**
 * Der eigene Ordner dieses einen Upload-Vorgangs.
 *
 * Beispiel:
 *   uploads/2026-08-29/20-14-35__linus-uhlhorn__550e8400-e29b-41d4-a716-446655440000
 *
 * Datum und Uhrzeit machen ihn lesbar, die UUID macht ihn eindeutig. Laedt
 * derselbe Gast spaeter noch einmal hoch, entsteht durch Uhrzeit und UUID
 * automatisch ein neuer Ordner.
 *
 * @param {{guestName: string, uploadId: string, at?: Date}} params
 * @returns {string}
 */
export function buildMemoryFolder({ guestName, uploadId, at = new Date() }) {
  const { date, time } = berlinParts(at);
  const slug = slugifyGuestName(guestName);
  const id = String(uploadId || '').toLowerCase();
  if (!/^[0-9a-f-]{36}$/.test(id)) {
    throw new Error('Für den Ordnernamen wird eine gültige UUID gebraucht.');
  }
  return `uploads/${date}/${time}__${slug}__${id}`;
}

/**
 * Der Pfad einer einzelnen Datei innerhalb des Upload-Ordners.
 *
 * Fotos und Videos liegen in getrennten Unterordnern. Der urspruengliche
 * Dateiname wird NICHT uebernommen - er koennte alles Moegliche enthalten.
 * Gespeichert wird eine durchnummerierte, unbedenkliche Fassung; der
 * Originalname steht in der Datenbank.
 *
 * @param {{folder: string, kind: 'photo'|'video', index: number, originalName?: string}} params
 * @returns {string}
 */
export function buildMemoryFilePath({ folder, kind, index, originalName = '' }) {
  const unterordner = kind === 'video' ? 'videos' : 'fotos';
  return `${folder}/${unterordner}/${buildStoredFilename({ kind, index, originalName })}`;
}

/**
 * Der gespeicherte Dateiname: "01_foto.jpg" beziehungsweise "01_video.mp4".
 * @param {{kind: 'photo'|'video', index: number, originalName?: string}} params
 */
export function buildStoredFilename({ kind, index, originalName = '' }) {
  const nummer = pad(Math.max(1, Math.floor(Number(index) || 1)));
  const basis = kind === 'video' ? 'video' : 'foto';
  const erlaubt = kind === 'video' ? DEFAULT_MEMORY_LIMITS.videoExtensions : DEFAULT_MEMORY_LIMITS.photoExtensions;
  let endung = fileExtension(originalName);
  if (!erlaubt.includes(endung)) endung = kind === 'video' ? 'mp4' : 'jpg';
  return `${nummer}_${basis}.${endung}`;
}

/**
 * Der Ordnername im Export-ZIP: "2026-08-29_20-14-35_Linus-Uhlhorn".
 * Hier darf der echte Name stehen - Sonderzeichen werden entschaerft.
 * @param {{guest_name?: string, storage_folder?: string, created_at?: string}} upload
 */
export function exportFolderName(upload) {
  const folder = String((upload && upload.storage_folder) || '');
  const treffer = folder.match(/uploads\/(\d{4}-\d{2}-\d{2})\/(\d{2}-\d{2}-\d{2})__/);
  const { date, time } = treffer
    ? { date: treffer[1], time: treffer[2] }
    : berlinParts((upload && upload.created_at) || Date.now());
  const name = String((upload && upload.guest_name) || 'Gast')
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .replace(/[\\/:*?"<>|]/g, '-')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 60);
  return `${date}_${time}_${name === '' ? 'Gast' : name}`;
}

/** Ein Feld fuer die CSV-Datei sicher einpacken. */
function csvField(value) {
  const text = String(value == null ? '' : value).replace(/\r?\n/g, ' ');
  return `"${text.replace(/"/g, '""')}"`;
}

/**
 * Die Uebersichtstabelle fuer den Gesamtexport.
 *
 * Getrennt mit Semikolon, damit Excel in deutscher Einstellung die Spalten
 * ohne Nachfrage richtig aufteilt.
 *
 * @param {Array<object>} uploads
 * @returns {string}
 */
export function memoryOverviewCsv(uploads) {
  const kopf = [
    'Name',
    'Nachricht',
    'Datum',
    'Uhrzeit',
    'Anzahl Fotos',
    'Anzahl Videos',
    'Gesamtgröße (Bytes)',
    'Ordnername',
    'Status',
  ];
  const zeilen = [kopf.map(csvField).join(';')];

  for (const upload of Array.isArray(uploads) ? uploads : []) {
    const { date, time } = berlinParts(upload.created_at || Date.now());
    zeilen.push(
      [
        upload.guest_name || '',
        upload.message || '',
        date,
        time.replace(/-/g, ':'),
        Number(upload.photo_count) || 0,
        Number(upload.video_count) || 0,
        Number(upload.total_size) || 0,
        exportFolderName(upload),
        upload.status || '',
      ]
        .map(csvField)
        .join(';'),
    );
  }
  // BOM voranstellen, sonst zeigt Excel die Umlaute falsch an.
  return `\uFEFF${zeilen.join('\r\n')}\r\n`;
}

/**
 * Der Inhalt von "Nachricht.txt" im Export-Ordner eines Gastes.
 * @param {object} upload
 */
export function memoryMessageFile(upload) {
  const { date, time } = berlinParts((upload && upload.created_at) || Date.now());
  const zeilen = [
    `Von: ${(upload && upload.guest_name) || 'Ohne Namen'}`,
    `Hochgeladen: ${date} um ${time.replace(/-/g, ':')} Uhr`,
    `Fotos: ${Number((upload && upload.photo_count) || 0)}`,
    `Videos: ${Number((upload && upload.video_count) || 0)}`,
    '',
  ];
  const nachricht = String((upload && upload.message) || '').trim();
  zeilen.push(nachricht === '' ? '(keine persönliche Nachricht)' : nachricht);
  return `${zeilen.join('\r\n')}\r\n`;
}

/**
 * Prueft die persoenliche Nachricht.
 * @param {unknown} raw
 * @param {object} [limits]
 * @returns {{valid: boolean, value: string, error: string|null}}
 */
export function validateMemoryMessage(raw, limits = {}) {
  const l = withMemoryDefaults(limits);
  const value = String(raw == null ? '' : raw)
    // Steuerzeichen raus, Zeilenumbrueche bleiben erlaubt.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .trim();
  if (value.length > l.maxMessageLength) {
    return {
      valid: false,
      value: value.slice(0, l.maxMessageLength),
      error: `Die Nachricht darf höchstens ${l.maxMessageLength} Zeichen lang sein.`,
    };
  }
  return { valid: true, value, error: null };
}
