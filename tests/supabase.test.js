import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createSupabaseClient,
  describeError,
  isSupabaseConfigured,
  SupabaseError,
} from '../assets/js/lib/supabase-rest.js';

const CONFIG = {
  url: 'https://beispielprojekt.supabase.co',
  anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.beispiel.anon-key-lang-genug',
  bucket: 'party-photos',
  table: 'photo_submissions',
};

/** Baut eine Antwort, wie sie fetch liefern würde. */
function response(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    blob: async () => body,
  };
}

/** Sammelt alle Anfragen, damit der Test sie prüfen kann. */
function recordingFetch(handler) {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    return handler(url, options, calls.length - 1);
  };
  fetchImpl.calls = calls;
  return fetchImpl;
}

// =========================================================================
// Konfiguration
// =========================================================================

test('Platzhalter werden nicht als Konfiguration akzeptiert', () => {
  assert.equal(
    isSupabaseConfigured({ url: '[SUPABASE_PROJECT_URL]', anonKey: '[SUPABASE_ANON_KEY]' }),
    false,
  );
  assert.equal(isSupabaseConfigured({ url: '', anonKey: '' }), false);
  assert.equal(isSupabaseConfigured(null), false);
  assert.equal(isSupabaseConfigured({ url: CONFIG.url, anonKey: 'zu-kurz' }), false);
  // Unverschlüsselte Verbindungen sind nicht erlaubt.
  assert.equal(
    isSupabaseConfigured({ url: 'http://beispiel.supabase.co', anonKey: CONFIG.anonKey }),
    false,
  );
});

test('Eine vollständige Konfiguration wird akzeptiert', () => {
  assert.equal(isSupabaseConfigured(CONFIG), true);
});

// =========================================================================
// Anmeldung
// =========================================================================

test('Die Anmeldung merkt sich den Zugang', async () => {
  const fetchImpl = recordingFetch(async () =>
    response(200, {
      access_token: 'token-abc',
      refresh_token: 'refresh-xyz',
      expires_in: 3600,
      user: { email: 'admin@beispiel.de' },
    }),
  );
  const client = createSupabaseClient(CONFIG, { fetchImpl });
  assert.equal(client.isSignedIn, false);

  const session = await client.signIn('admin@beispiel.de', 'geheim');
  assert.equal(session.access_token, 'token-abc');
  assert.equal(client.isSignedIn, true);

  const call = fetchImpl.calls[0];
  assert.match(call.url, /\/auth\/v1\/token\?grant_type=password$/);
  // Das Passwort geht ausschließlich an Supabase, nicht in die Adresse.
  assert.ok(!call.url.includes('geheim'));
  assert.equal(JSON.parse(call.options.body).password, 'geheim');
});

test('Eine falsche Anmeldung wirft einen verständlichen Fehler', async () => {
  const fetchImpl = recordingFetch(async () =>
    response(400, { message: 'Invalid login credentials' }),
  );
  const client = createSupabaseClient(CONFIG, { fetchImpl });
  await assert.rejects(() => client.signIn('a@b.de', 'falsch'), /Invalid login credentials/);
  assert.equal(client.isSignedIn, false);
});

test('Abmelden entfernt den Zugang auch dann, wenn der Server nicht antwortet', async () => {
  let step = 0;
  const fetchImpl = recordingFetch(async () => {
    step += 1;
    if (step === 1) {
      return response(200, { access_token: 't', refresh_token: 'r', expires_in: 3600, user: {} });
    }
    throw new TypeError('Netzwerkfehler');
  });
  const client = createSupabaseClient(CONFIG, { fetchImpl });
  await client.signIn('a@b.de', 'x');
  await client.signOut();
  assert.equal(client.isSignedIn, false);
});

test('Ohne Zugang schlägt das Auffrischen sauber fehl', async () => {
  const client = createSupabaseClient(CONFIG, { fetchImpl: async () => response(200, {}) });
  await assert.rejects(() => client.refreshSession(), /keine gültige Anmeldung/i);
});

// =========================================================================
// Datensätze
// =========================================================================

test('Ein neuer Datensatz wird ohne Rücklesen eingetragen', async () => {
  const fetchImpl = recordingFetch(async () => response(201, null));
  const client = createSupabaseClient(CONFIG, { fetchImpl });

  const result = await client.insertSubmission({ guest_name: 'Anna' });
  assert.deepEqual(result, { inserted: true, duplicate: false });

  const call = fetchImpl.calls[0];
  assert.equal(call.url, `${CONFIG.url}/rest/v1/photo_submissions`);
  assert.equal(call.options.method, 'POST');
  // "return=minimal" ist wichtig: öffentliche Gäste dürfen nichts lesen.
  assert.equal(call.options.headers.Prefer, 'return=minimal');
  assert.equal(call.options.headers.apikey, CONFIG.anonKey);
});

test('Ein doppelter Upload erzeugt keinen zweiten Datensatz', async () => {
  // 23505 = eindeutiger Index verletzt (device_submission_id gibt es schon)
  const fetchImpl = recordingFetch(async () =>
    response(409, { code: '23505', message: 'duplicate key value violates unique constraint' }),
  );
  const client = createSupabaseClient(CONFIG, { fetchImpl });
  const result = await client.insertSubmission({ guest_name: 'Anna' });
  assert.deepEqual(result, { inserted: false, duplicate: true });
});

test('Ein anderer Konflikt gilt NICHT als Erfolg', async () => {
  // Nur der Code 23505 bedeutet "schon vorhanden". Alles andere muss ein
  // Fehler bleiben, damit kein Erfolg vorgetäuscht wird.
  const fetchImpl = recordingFetch(async () =>
    response(409, { code: '23514', message: 'check constraint verletzt' }),
  );
  const client = createSupabaseClient(CONFIG, { fetchImpl });
  await assert.rejects(() => client.insertSubmission({ guest_name: '' }), SupabaseError);
});

test('Ein echter Fehler beim Eintragen wird weitergereicht', async () => {
  const fetchImpl = recordingFetch(async () =>
    response(500, { message: 'interner Serverfehler' }),
  );
  const client = createSupabaseClient(CONFIG, { fetchImpl });
  await assert.rejects(() => client.insertSubmission({}), SupabaseError);
});

test('Verstößt der Datensatz gegen eine Regel, gibt es keinen Erfolg', async () => {
  const fetchImpl = recordingFetch(async () =>
    response(403, { message: 'new row violates row-level security policy' }),
  );
  const client = createSupabaseClient(CONFIG, { fetchImpl });
  await assert.rejects(() => client.insertSubmission({ guest_name: '' }));
});

test('Das Album liest die Datensätze chronologisch', async () => {
  const rows = [{ id: '1' }, { id: '2' }];
  const fetchImpl = recordingFetch(async () => response(200, rows));
  const client = createSupabaseClient(CONFIG, { fetchImpl });
  assert.deepEqual(await client.listSubmissions(), rows);
  assert.match(fetchImpl.calls[0].url, /order=created_at\.asc/);
});

test('Löschen greift genau die angegebenen Datensätze', async () => {
  const fetchImpl = recordingFetch(async () => response(204, null));
  const client = createSupabaseClient(CONFIG, { fetchImpl });

  const result = await client.deleteSubmissions(['abc', 'def']);
  assert.equal(result.deleted, 2);
  assert.match(fetchImpl.calls[0].url, /id=in\.\(abc,def\)/);
  assert.equal(fetchImpl.calls[0].options.method, 'DELETE');

  // Ohne IDs wird gar keine Anfrage gestellt.
  assert.deepEqual(await client.deleteSubmissions([]), { deleted: 0 });
  assert.equal(fetchImpl.calls.length, 1);
});

// =========================================================================
// Speicher
// =========================================================================

test('Signierte Links werden zu vollständigen Adressen ergänzt', async () => {
  const fetchImpl = recordingFetch(async (url, options) => {
    const paths = JSON.parse(options.body).paths;
    return response(
      200,
      paths.map((path) => ({ path, signedURL: `/object/sign/party-photos/${path}?token=abc` })),
    );
  });
  const client = createSupabaseClient(CONFIG, { fetchImpl });

  const urls = await client.createSignedUrls(['party/a.jpg', 'party/b.jpg'], 600);
  assert.equal(urls.size, 2);
  assert.equal(
    urls.get('party/a.jpg'),
    `${CONFIG.url}/storage/v1/object/sign/party-photos/party/a.jpg?token=abc`,
  );
  assert.equal(JSON.parse(fetchImpl.calls[0].options.body).expiresIn, 600);
});

test('Fehlerhafte Einträge in der Link-Antwort werden übersprungen', async () => {
  const fetchImpl = recordingFetch(async () =>
    response(200, [
      { path: 'party/a.jpg', signedURL: '/object/sign/x?token=1' },
      { path: 'party/b.jpg', error: 'nicht gefunden', signedURL: null },
    ]),
  );
  const client = createSupabaseClient(CONFIG, { fetchImpl });
  const urls = await client.createSignedUrls(['party/a.jpg', 'party/b.jpg']);
  assert.equal(urls.size, 1);
  assert.ok(urls.has('party/a.jpg'));
});

test('Sehr viele Links werden in Portionen angefragt', async () => {
  const fetchImpl = recordingFetch(async (url, options) =>
    response(
      200,
      JSON.parse(options.body).paths.map((path) => ({ path, signedURL: `/x/${path}` })),
    ),
  );
  const client = createSupabaseClient(CONFIG, { fetchImpl });
  const paths = Array.from({ length: 250 }, (_, i) => `party/${i}.jpg`);
  const urls = await client.createSignedUrls(paths);
  assert.equal(urls.size, 250);
  assert.equal(fetchImpl.calls.length, 3, 'Es sollte in drei Portionen angefragt werden');
});

test('Dateien werden über die Prefix-Liste gelöscht', async () => {
  const fetchImpl = recordingFetch(async () => response(200, []));
  const client = createSupabaseClient(CONFIG, { fetchImpl });
  await client.deletePhotos(['party/a.jpg', 'test/b.webp']);
  const call = fetchImpl.calls[0];
  assert.equal(call.options.method, 'DELETE');
  assert.equal(call.url, `${CONFIG.url}/storage/v1/object/party-photos`);
  assert.deepEqual(JSON.parse(call.options.body).prefixes, ['party/a.jpg', 'test/b.webp']);
});

// =========================================================================
// Upload mit Fortschritt
// =========================================================================

/** Ein sehr einfacher Ersatz für XMLHttpRequest. */
function fakeXhr(behaviour) {
  const xhr = {
    headers: {},
    upload: {},
    status: 0,
    responseText: '',
    aborted: false,
    open(method, url) {
      this.method = method;
      this.url = url;
    },
    setRequestHeader(key, value) {
      this.headers[key] = value;
    },
    abort() {
      this.aborted = true;
    },
    send(body) {
      this.body = body;
      // Antwort im nächsten Durchlauf, damit es sich wie ein echter Aufruf verhält.
      setTimeout(() => behaviour(this), 0);
    },
  };
  return xhr;
}

test('Ein erfolgreicher Upload meldet den Fortschritt bis 100 Prozent', async () => {
  let created = null;
  const client = createSupabaseClient(CONFIG, {
    xhrFactory: () => {
      created = fakeXhr((xhr) => {
        xhr.upload.onprogress({ lengthComputable: true, loaded: 50, total: 100 });
        xhr.status = 200;
        xhr.onload();
      });
      return created;
    },
  });

  const seen = [];
  const result = await client.uploadPhoto({
    path: 'party/4b1f2a3c-5d6e-4f70-8a9b-0c1d2e3f4a5b.jpg',
    blob: { type: 'image/jpeg', size: 100 },
    onProgress: (value) => seen.push(value),
  });

  assert.deepEqual(result, { path: 'party/4b1f2a3c-5d6e-4f70-8a9b-0c1d2e3f4a5b.jpg' });
  assert.ok(seen.includes(1), 'Am Ende muss 100 % gemeldet werden');
  assert.ok(seen.some((v) => v > 0 && v < 1), 'Zwischenstände fehlen');
  // Vorhandene Dateien dürfen nicht überschrieben werden.
  assert.equal(created.headers['x-upsert'], 'false');
  assert.equal(created.headers.apikey, CONFIG.anonKey);
  assert.match(created.url, /\/storage\/v1\/object\/party-photos\/party\//);
});

test('Ein abgebrochener Upload meldet einen Netzwerkfehler', async () => {
  const client = createSupabaseClient(CONFIG, {
    xhrFactory: () =>
      fakeXhr((xhr) => {
        xhr.onerror();
      }),
  });
  await assert.rejects(
    () => client.uploadPhoto({ path: 'party/x.jpg', blob: { type: 'image/jpeg' } }),
    TypeError,
  );
});

test('Eine Zeitüberschreitung wird als solche gemeldet', async () => {
  const client = createSupabaseClient(CONFIG, {
    xhrFactory: () =>
      fakeXhr((xhr) => {
        xhr.ontimeout();
      }),
  });
  await assert.rejects(
    () => client.uploadPhoto({ path: 'party/x.jpg', blob: { type: 'image/jpeg' } }),
    (error) => error.name === 'TimeoutError',
  );
});

test('Liegt die Datei schon dort, wird 409 gemeldet (kein zweiter Upload)', async () => {
  const client = createSupabaseClient(CONFIG, {
    xhrFactory: () =>
      fakeXhr((xhr) => {
        xhr.status = 409;
        xhr.responseText = JSON.stringify({ message: 'The resource already exists' });
        xhr.onload();
      }),
  });
  await assert.rejects(
    () => client.uploadPhoto({ path: 'party/x.jpg', blob: { type: 'image/jpeg' } }),
    (error) => error.status === 409,
  );
});

test('Ein Abbruch durch den Gast wird sauber behandelt', async () => {
  const controller = new AbortController();
  const client = createSupabaseClient(CONFIG, {
    xhrFactory: () =>
      fakeXhr(() => {
        controller.abort();
      }),
  });
  await assert.rejects(
    () =>
      client.uploadPhoto({
        path: 'party/x.jpg',
        blob: { type: 'image/jpeg' },
        signal: controller.signal,
      }),
    (error) => error.name === 'AbortError',
  );
});

// =========================================================================
// Fehlermeldungen
// =========================================================================

test('Technische Fehler werden auf Deutsch erklärt', () => {
  assert.match(describeError(new SupabaseError('x', { code: '23505' })), /bereits gespeichert/);
  assert.match(describeError(new SupabaseError('x', { status: 401 })), /abgelehnt/);
  assert.match(describeError(new SupabaseError('x', { status: 403 })), /abgelehnt/);
  assert.match(describeError(new SupabaseError('x', { status: 413 })), /zu groß/);
  assert.match(describeError(new SupabaseError('x', { status: 429 })), /viele Uploads/);
  assert.match(describeError(new SupabaseError('x', { status: 503 })), /Problem/);
  assert.match(describeError(new TypeError('failed to fetch')), /Internetverbindung/);

  const aborted = new Error('weg');
  aborted.name = 'AbortError';
  assert.match(describeError(aborted), /Dein Foto ist noch da/);

  assert.equal(describeError(new Error('Sonderfall')), 'Sonderfall');
  assert.equal(describeError(null), 'Unbekannter Fehler.');
});
