// Prüft den Supabase-Client für die privaten Erinnerungen.
//
// Besonders wichtig: Die privaten Dateien dürfen ausschließlich in ihren
// eigenen Bucket gehen, und ein abgebrochener Upload muss dort weitermachen,
// wo er aufgehört hat - auf dem Handy im Funkloch passiert genau das.

import test from 'node:test';
import assert from 'node:assert/strict';

import { base64, createSupabaseClient } from '../assets/js/lib/supabase-rest.js';
import { PARTY_CONFIG } from '../config/party-config.js';

const CONFIG = {
  url: 'https://beispielprojekt.supabase.co',
  anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.beispiel.anon-key-lang-genug',
  bucket: 'party-photos',
  table: 'photo_submissions',
  memoriesBucket: 'private-memories',
  memoriesTable: 'private_memory_uploads',
  memoriesFilesTable: 'private_memory_files',
};

const ORDNER = 'uploads/2026-08-29/20-14-35__anna__550e8400-e29b-41d4-a716-446655440000';

function response(status, body, headers = {}) {
  const lower = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v)]));
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => lower.get(String(name).toLowerCase()) ?? null },
    json: async () => body,
    text: async () => JSON.stringify(body),
    blob: async () => body,
  };
}

function recordingFetch(handler) {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options, method: (options.method || 'GET').toUpperCase() });
    return handler(url, options, calls.length - 1);
  };
  fetchImpl.calls = calls;
  return fetchImpl;
}

/** Eine Datei, wie sie der Browser liefert - mit slice(). */
function fakeFile(size, type = 'video/mp4') {
  return {
    size,
    type,
    slice(von, bis) {
      return { size: bis - von, von, bis, __teil: true };
    },
  };
}

// =========================================================================
// Datensätze
// =========================================================================

test('Ein Upload-Vorgang wird mit selbst erzeugter ID angelegt', async () => {
  const fetchImpl = recordingFetch(async () => response(201, null));
  const client = createSupabaseClient(CONFIG, { fetchImpl });

  await client.insertMemoryUpload({
    id: '550e8400-e29b-41d4-a716-446655440000',
    guest_name: 'Anna',
    message: 'Alles Gute!',
    storage_folder: ORDNER,
  });

  const call = fetchImpl.calls[0];
  assert.match(call.url, /\/rest\/v1\/private_memory_uploads$/);
  // Es wird bewusst nichts zurückgelesen - Gäste haben kein Leserecht.
  assert.equal(call.options.headers.Prefer, 'return=minimal');
  assert.equal(JSON.parse(call.options.body).storage_folder, ORDNER);
});

test('Eine bereits eingetragene Datei ist kein Fehler', async () => {
  const fetchImpl = recordingFetch(async () =>
    response(409, { code: '23505', message: 'duplicate key' }),
  );
  const client = createSupabaseClient(CONFIG, { fetchImpl });
  const ergebnis = await client.insertMemoryFile({ storage_path: `${ORDNER}/fotos/01_foto.jpg` });
  assert.deepEqual(ergebnis, { inserted: false, duplicate: true });
});

test('Andere Fehler beim Eintragen schlagen durch', async () => {
  const fetchImpl = recordingFetch(async () => response(400, { message: 'kaputt' }));
  const client = createSupabaseClient(CONFIG, { fetchImpl });
  await assert.rejects(() => client.insertMemoryFile({ storage_path: 'x' }));
});

test('Der Abschluss fragt die Datenbank, statt selbst zu behaupten', async () => {
  const fetchImpl = recordingFetch(async () =>
    response(200, { status: 'complete', photo_count: 12, video_count: 2, total_size: 999 }),
  );
  const client = createSupabaseClient(CONFIG, { fetchImpl });
  const ergebnis = await client.completeMemoryUpload('550e8400-e29b-41d4-a716-446655440000', 12, 2);

  assert.match(fetchImpl.calls[0].url, /\/rpc\/complete_memory_upload$/);
  assert.deepEqual(JSON.parse(fetchImpl.calls[0].options.body), {
    p_upload_id: '550e8400-e29b-41d4-a716-446655440000',
    p_expected_photos: 12,
    p_expected_videos: 2,
  });
  assert.equal(ergebnis.status, 'complete');
  assert.equal(ergebnis.photoCount, 12);
});

test('Ein unvollständiger Upload wird nicht als vollständig gemeldet', async () => {
  const fetchImpl = recordingFetch(async () =>
    response(200, { status: 'incomplete', photo_count: 3, video_count: 0, total_size: 1 }),
  );
  const client = createSupabaseClient(CONFIG, { fetchImpl });
  const ergebnis = await client.completeMemoryUpload('id', 12, 2);
  assert.equal(ergebnis.status, 'incomplete');
});

// =========================================================================
// Upload der Dateien
// =========================================================================

test('Kleine Dateien gehen den einfachen Weg in den privaten Bucket', async () => {
  const aufrufe = [];
  const xhrFactory = () => ({
    upload: {},
    open(method, url) {
      aufrufe.push({ method, url });
    },
    setRequestHeader() {},
    send() {
      this.status = 200;
      this.responseText = '{}';
      this.onload();
    },
  });
  const client = createSupabaseClient(CONFIG, { fetchImpl: async () => response(200, {}), xhrFactory });

  await client.uploadMemoryFile({
    path: `${ORDNER}/fotos/01_foto.jpg`,
    file: fakeFile(1024, 'image/jpeg'),
    resumableFromBytes: 6 * 1024 * 1024,
  });

  assert.equal(aufrufe.length, 1);
  assert.match(aufrufe[0].url, /\/storage\/v1\/object\/private-memories\//);
  // Der Bucket der Foto-Mission darf hier NIEMALS auftauchen.
  assert.ok(!aufrufe[0].url.includes('party-photos'));
});

test('Große Dateien gehen den unterbrechbaren Weg (TUS)', async () => {
  const groesse = 14 * 1024 * 1024; // 14 MB -> 3 Stücke à 6 MB
  const fortschritt = [];
  let offset = 0;

  const fetchImpl = recordingFetch(async (url, options) => {
    const method = (options.method || 'GET').toUpperCase();
    if (method === 'POST') {
      return response(201, null, { Location: '/storage/v1/upload/resumable/abc123' });
    }
    if (method === 'PATCH') {
      offset = Number(options.headers['Upload-Offset']) + options.body.size;
      return response(204, null, { 'Upload-Offset': String(offset) });
    }
    return response(200, null);
  });

  const client = createSupabaseClient(CONFIG, { fetchImpl });
  const ergebnis = await client.uploadMemoryFile({
    path: `${ORDNER}/videos/01_video.mp4`,
    file: fakeFile(groesse),
    onProgress: (anteil) => fortschritt.push(anteil),
    resumableFromBytes: 6 * 1024 * 1024,
  });

  assert.equal(ergebnis.resumable, true);
  const anlegen = fetchImpl.calls[0];
  assert.match(anlegen.url, /\/storage\/v1\/upload\/resumable$/);
  assert.equal(anlegen.options.headers['Tus-Resumable'], '1.0.0');
  assert.equal(anlegen.options.headers['Upload-Length'], String(groesse));
  // Die Angaben zur Datei müssen Base64-verpackt sein.
  assert.match(anlegen.options.headers['Upload-Metadata'], /bucketName [A-Za-z0-9+/=]+/);
  assert.ok(anlegen.options.headers['Upload-Metadata'].includes(base64('private-memories')));
  assert.ok(anlegen.options.headers['Upload-Metadata'].includes(base64(`${ORDNER}/videos/01_video.mp4`)));
  // Vorhandene Dateien dürfen nicht überschrieben werden.
  assert.equal(anlegen.options.headers['x-upsert'], 'false');

  const stuecke = fetchImpl.calls.filter((call) => call.method === 'PATCH');
  assert.equal(stuecke.length, 3, 'Die Datei muss in 3 Stücken gehen');
  assert.equal(stuecke[0].options.headers['Upload-Offset'], '0');
  assert.equal(stuecke[1].options.headers['Upload-Offset'], String(6 * 1024 * 1024));
  assert.equal(
    stuecke[0].options.headers['Content-Type'],
    'application/offset+octet-stream',
  );
  // Der Fortschritt läuft aufwärts und endet bei 1.
  assert.ok(fortschritt.length >= 3);
  assert.equal(fortschritt[fortschritt.length - 1], 1);
});

test('Nach einem Abbruch macht der Upload dort weiter, wo er war', async () => {
  const groesse = 14 * 1024 * 1024;
  let patchVersuche = 0;
  const gesendet = [];

  const fetchImpl = recordingFetch(async (url, options) => {
    const method = (options.method || 'GET').toUpperCase();
    if (method === 'POST') {
      return response(201, null, { Location: 'https://beispielprojekt.supabase.co/upload/xyz' });
    }
    if (method === 'HEAD') {
      // Der Server hat das erste Stück doch bekommen.
      return response(200, null, { 'Upload-Offset': String(6 * 1024 * 1024) });
    }
    if (method === 'PATCH') {
      patchVersuche += 1;
      gesendet.push(Number(options.headers['Upload-Offset']));
      // Der zweite Versuch bricht ab (Funkloch).
      if (patchVersuche === 2) throw new TypeError('Netzwerkfehler');
      const neu = Number(options.headers['Upload-Offset']) + options.body.size;
      return response(204, null, { 'Upload-Offset': String(neu) });
    }
    return response(200, null);
  });

  const client = createSupabaseClient(CONFIG, { fetchImpl });
  await client.uploadMemoryFile({
    path: `${ORDNER}/videos/01_video.mp4`,
    file: fakeFile(groesse),
    resumableFromBytes: 6 * 1024 * 1024,
  });

  // Es wurde nachgefragt, wie viel schon da ist ...
  assert.ok(fetchImpl.calls.some((call) => call.method === 'HEAD'), 'Es wurde nicht nachgefragt');
  // ... und danach beim richtigen Stand weitergemacht statt von vorn.
  assert.ok(!gesendet.slice(1).includes(0), 'Der Upload hat wieder bei 0 angefangen');
});

test('Bricht der unterbrechbare Weg ganz ab, wird der einfache genommen', async () => {
  const einfach = [];
  const xhrFactory = () => ({
    upload: {},
    open(method, url) {
      einfach.push(url);
    },
    setRequestHeader() {},
    send() {
      this.status = 200;
      this.responseText = '{}';
      this.onload();
    },
  });
  // Das Anlegen scheitert - z. B. weil das Projekt TUS nicht anbietet.
  const fetchImpl = recordingFetch(async () => response(404, { message: 'nicht gefunden' }));
  const client = createSupabaseClient(CONFIG, { fetchImpl, xhrFactory });

  await client.uploadMemoryFile({
    path: `${ORDNER}/videos/01_video.mp4`,
    file: fakeFile(14 * 1024 * 1024),
    resumableFromBytes: 6 * 1024 * 1024,
  });

  assert.equal(einfach.length, 1, 'Der einfache Weg wurde nicht genommen');
  assert.match(einfach[0], /private-memories/);
});

test('Ein Abbruch durch den Gast bleibt ein Abbruch', async () => {
  const fetchImpl = recordingFetch(async () => {
    const fehler = new Error('abgebrochen');
    fehler.name = 'AbortError';
    throw fehler;
  });
  const client = createSupabaseClient(CONFIG, { fetchImpl });
  await assert.rejects(
    () =>
      client.uploadMemoryFile({
        path: `${ORDNER}/videos/01_video.mp4`,
        file: fakeFile(14 * 1024 * 1024),
        resumableFromBytes: 6 * 1024 * 1024,
      }),
    /abgebrochen/,
  );
});

// =========================================================================
// Adminbereich
// =========================================================================

test('Der Adminbereich liest Uploads und Dateien', async () => {
  const fetchImpl = recordingFetch(async () => response(200, []));
  const client = createSupabaseClient(CONFIG, { fetchImpl });

  await client.listMemoryUploads();
  assert.match(fetchImpl.calls[0].url, /private_memory_uploads\?select=\*&order=created_at\.desc/);

  await client.listMemoryFiles();
  assert.match(fetchImpl.calls[1].url, /private_memory_files\?select=\*/);
});

test('Private Dateien werden nur über kurzlebige Links angezeigt', async () => {
  const fetchImpl = recordingFetch(async () =>
    response(200, [{ path: `${ORDNER}/fotos/01_foto.jpg`, signedURL: '/object/sign/x?token=y' }]),
  );
  const client = createSupabaseClient(CONFIG, { fetchImpl });
  const urls = await client.createMemorySignedUrls([`${ORDNER}/fotos/01_foto.jpg`], 300);

  assert.match(fetchImpl.calls[0].url, /\/storage\/v1\/object\/sign\/private-memories$/);
  assert.equal(JSON.parse(fetchImpl.calls[0].options.body).expiresIn, 300);
  assert.match(urls.get(`${ORDNER}/fotos/01_foto.jpg`), /^https:\/\/.*token=y$/);
});

test('Ein kompletter Upload lässt sich mit einem Aufruf löschen', async () => {
  const fetchImpl = recordingFetch(async () => response(204, null));
  const client = createSupabaseClient(CONFIG, { fetchImpl });

  await client.deleteMemoryUpload('550e8400-e29b-41d4-a716-446655440000');
  assert.match(fetchImpl.calls[0].url, /private_memory_uploads\?id=eq\.550e8400/);
  assert.equal(fetchImpl.calls[0].method, 'DELETE');

  await client.deleteMemoryObjects([`${ORDNER}/fotos/01_foto.jpg`]);
  assert.match(fetchImpl.calls[1].url, /\/storage\/v1\/object\/private-memories$/);
});

test('Die Foto-Mission bleibt beim alten Bucket', async () => {
  const aufrufe = [];
  const xhrFactory = () => ({
    upload: {},
    open(method, url) {
      aufrufe.push(url);
    },
    setRequestHeader() {},
    send() {
      this.status = 200;
      this.responseText = '{}';
      this.onload();
    },
  });
  const client = createSupabaseClient(CONFIG, { fetchImpl: async () => response(200, {}), xhrFactory });

  await client.uploadPhoto({ path: 'party/abc.jpg', blob: { size: 10, type: 'image/jpeg' } });
  assert.match(aufrufe[0], /\/object\/party-photos\/party\/abc\.jpg$/);
  assert.ok(!aufrufe[0].includes('private-memories'));
});

test('Die Konfiguration nennt einen eigenen privaten Bucket', () => {
  assert.equal(PARTY_CONFIG.supabase.memoriesBucket, 'private-memories');
  assert.notEqual(PARTY_CONFIG.supabase.memoriesBucket, PARTY_CONFIG.supabase.bucket);
  assert.notEqual(PARTY_CONFIG.supabase.memoriesTable, PARTY_CONFIG.supabase.table);
});
