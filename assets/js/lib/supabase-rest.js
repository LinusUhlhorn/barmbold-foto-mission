// Sehr schlanker Supabase-Client, der nur die REST-Schnittstellen anspricht,
// die diese App wirklich braucht.
//
// Warum kein offizielles SDK?
//  - Es gaebe keinen Build-Schritt, also muesste das SDK von einem fremden CDN
//    geladen werden. Das waere eine externe Abhaengigkeit, die verschwinden kann,
//    und es wuerden Daten an Dritte gesendet.
//  - So bleibt die App komplett ohne Abhaengigkeiten.
//
// Verwendet werden ausschliesslich die Projekt-URL und der oeffentliche Anon-Key.
// Ein Service-Role-Key wird hier NIEMALS verwendet.

/**
 * Prueft, ob in der Konfiguration echte Werte stehen (und keine Platzhalter).
 * @param {{url?: string, anonKey?: string}} config
 * @returns {boolean}
 */
export function isSupabaseConfigured(config) {
  if (!config) return false;
  const url = String(config.url || '');
  const key = String(config.anonKey || '');
  if (url === '' || key === '') return false;
  if (url.startsWith('[') || key.startsWith('[')) return false; // Platzhalter
  if (!/^https:\/\/[^\s/]+/i.test(url)) return false;
  return key.length > 20;
}

/** Fehler mit zusaetzlichen Angaben zur Ursache. */
export class SupabaseError extends Error {
  constructor(message, { status = 0, code = '', details = '' } = {}) {
    super(message);
    this.name = 'SupabaseError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/**
 * Uebersetzt technische Fehler in verstaendliche deutsche Meldungen.
 * @param {unknown} error
 * @returns {string}
 */
export function describeError(error) {
  if (error instanceof SupabaseError) {
    if (error.code === '23505') {
      return 'Dieses Foto wurde bereits gespeichert.';
    }
    if (error.status === 401 || error.status === 403) {
      return 'Der Zugriff wurde abgelehnt. Bitte prüfe die Supabase-Berechtigungen.';
    }
    if (error.status === 413) {
      return 'Das Foto ist für den Server zu groß.';
    }
    if (error.status === 429) {
      return 'Gerade sind sehr viele Uploads gleichzeitig unterwegs. Bitte versuch es in ein paar Sekunden noch einmal.';
    }
    if (error.status >= 500) {
      return 'Der Server hat gerade ein Problem. Bitte versuch es gleich noch einmal.';
    }
    return error.message;
  }
  if (error && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
    return 'Der Upload hat zu lange gedauert und wurde abgebrochen. Dein Foto ist noch da – bitte versuch es noch einmal.';
  }
  if (error instanceof TypeError) {
    return 'Keine Verbindung zum Server. Bitte prüfe deine Internetverbindung und versuch es noch einmal.';
  }
  return error && error.message ? error.message : 'Unbekannter Fehler.';
}

/**
 * Verpackt Text nach Base64 - das TUS-Verfahren verlangt das fuer die
 * Angaben zur Datei. Im Browser gibt es btoa, in Node nur Buffer.
 * @param {string} value
 * @returns {string}
 */
export function base64(value) {
  const text = String(value == null ? '' : value);
  const bytes = new TextEncoder().encode(text);
  let binaer = '';
  for (const byte of bytes) binaer += String.fromCharCode(byte);
  if (typeof globalThis.btoa === 'function') return globalThis.btoa(binaer);
  return Buffer.from(bytes).toString('base64');
}

/**
 * Erzeugt den Client.
 * @param {{url: string, anonKey: string, bucket: string, table: string,
 *          memoriesBucket?: string, memoriesTable?: string, memoriesFilesTable?: string}} config
 * @param {{fetchImpl?: Function, xhrFactory?: Function}} [deps]
 */
export function createSupabaseClient(config, deps = {}) {
  const baseUrl = String(config.url || '').replace(/\/+$/, '');
  const anonKey = String(config.anonKey || '');
  const bucket = String(config.bucket || 'party-photos');
  const table = String(config.table || 'photo_submissions');
  // Privater Bereich "Fuer Britta & Lutz" - voellig getrennt von der Mission.
  const memoriesBucket = String(config.memoriesBucket || 'private-memories');
  const memoriesTable = String(config.memoriesTable || 'private_memory_uploads');
  const memoriesFilesTable = String(config.memoriesFilesTable || 'private_memory_files');

  const doFetch =
    deps.fetchImpl || ((...args) => globalThis.fetch(...args));
  const makeXhr =
    deps.xhrFactory || (() => new globalThis.XMLHttpRequest());

  // Zugangsdaten des angemeldeten Admins (nur im Arbeitsspeicher dieser Seite).
  let session = null;

  function authHeaders(extra = {}) {
    const token = session && session.access_token ? session.access_token : anonKey;
    return {
      apikey: anonKey,
      Authorization: `Bearer ${token}`,
      ...extra,
    };
  }

  async function readError(response) {
    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    const message =
      (payload && (payload.message || payload.error_description || payload.error || payload.msg)) ||
      `Anfrage fehlgeschlagen (HTTP ${response.status}).`;
    return new SupabaseError(String(message), {
      status: response.status,
      code: (payload && payload.code) || '',
      details: (payload && payload.details) || '',
    });
  }

  return {
    get isSignedIn() {
      return Boolean(session && session.access_token);
    },
    get session() {
      return session ? { ...session } : null;
    },
    setSession(value) {
      session = value && value.access_token ? { ...value } : null;
    },
    clearSession() {
      session = null;
    },

    // ---------------------------------------------------------------
    // Anmeldung (nur fuer das private Album)
    // ---------------------------------------------------------------

    /**
     * Meldet den Admin mit E-Mail und Passwort an.
     * Das Passwort wird NIEMALS gespeichert.
     */
    async signIn(email, password) {
      const response = await doFetch(`${baseUrl}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: { apikey: anonKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      if (!response.ok) throw await readError(response);
      const data = await response.json();
      session = {
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        expires_at: Date.now() + (Number(data.expires_in) || 3600) * 1000,
        email: data.user && data.user.email ? data.user.email : email,
      };
      return { ...session };
    },

    /** Erneuert eine abgelaufene Anmeldung. */
    async refreshSession(refreshToken) {
      const token = refreshToken || (session && session.refresh_token);
      if (!token) throw new SupabaseError('Keine gültige Anmeldung vorhanden.', { status: 401 });
      const response = await doFetch(`${baseUrl}/auth/v1/token?grant_type=refresh_token`, {
        method: 'POST',
        headers: { apikey: anonKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: token }),
      });
      if (!response.ok) {
        session = null;
        throw await readError(response);
      }
      const data = await response.json();
      session = {
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        expires_at: Date.now() + (Number(data.expires_in) || 3600) * 1000,
        email: data.user && data.user.email ? data.user.email : session && session.email,
      };
      return { ...session };
    },

    async signOut() {
      if (session && session.access_token) {
        try {
          await doFetch(`${baseUrl}/auth/v1/logout`, {
            method: 'POST',
            headers: authHeaders(),
          });
        } catch {
          // Auch wenn der Server nicht antwortet, wird lokal abgemeldet.
        }
      }
      session = null;
    },

    // ---------------------------------------------------------------
    // Datenbank
    // ---------------------------------------------------------------

    /**
     * Traegt einen neuen Foto-Datensatz ein.
     * Es wird bewusst NICHTS zurueckgelesen ("return=minimal"), weil oeffentliche
     * Gaeste keine Leserechte haben.
     * @param {object} row
     * @returns {Promise<{inserted: boolean, duplicate: boolean}>}
     */
    async insertSubmission(row) {
      const response = await doFetch(`${baseUrl}/rest/v1/${table}`, {
        method: 'POST',
        headers: authHeaders({
          'Content-Type': 'application/json',
          Prefer: 'return=minimal',
        }),
        body: JSON.stringify(row),
      });
      if (response.ok) return { inserted: true, duplicate: false };

      const error = await readError(response);
      // 23505 = eindeutiger Index verletzt. Das bedeutet: genau dieser Upload
      // wurde bereits gespeichert. Das ist KEIN Fehler, sondern der gewuenschte
      // Schutz gegen doppelte Datensaetze.
      //
      // Bewusst wird NUR dieser eine Code als "schon vorhanden" gewertet.
      // Jeder andere Fehler - auch ein anderer Konflikt - muss durchschlagen,
      // damit dem Gast niemals ein Erfolg angezeigt wird, den es nicht gab.
      if (error.code === '23505') {
        return { inserted: false, duplicate: true };
      }
      throw error;
    },

    /** Liest die fuer alle sichtbare Galerie mit aktueller Herz-Anzahl. */
    async listPublicSubmissions() {
      const fields = [
        'id',
        'guest_name',
        // Die Kennung der Aufgabe wird fuer die Auswahl "Einzelne Aufgabe"
        // gebraucht. Ohne sie bleibt das Feld in der Galerie leer.
        'mission_id',
        'mission_title',
        'mission_category',
        'storage_path',
        'created_at',
        'likes_count',
      ].join(',');
      const response = await doFetch(
        `${baseUrl}/rest/v1/${table}?select=${fields}&is_test=eq.false&order=created_at.desc`,
        { method: 'GET', headers: authHeaders({ Accept: 'application/json' }) },
      );
      if (!response.ok) throw await readError(response);
      return response.json();
    },

    /**
     * Vergibt ein Herz, nimmt es wieder weg oder setzt es innerhalb derselben
     * Kategorie um. Die Regel "ein Herz je Geraet und Kategorie" wird in der
     * Datenbank durchgesetzt, nicht hier im Browser.
     * @returns {Promise<{liked: boolean, submissionId: string, likesCount: number,
     *                    category: string, movedFrom: string|null, movedFromLikesCount: number|null}>}
     */
    async togglePhotoVote(submissionId, voterId) {
      const response = await doFetch(`${baseUrl}/rest/v1/rpc/toggle_photo_vote`, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ p_submission_id: submissionId, p_voter_id: voterId }),
      });
      if (!response.ok) throw await readError(response);
      const value = await response.json();
      const data = value && typeof value === 'object' ? value : {};
      return {
        liked: Boolean(data.liked),
        submissionId: String(data.submission_id || submissionId),
        likesCount: Number(data.likes_count) || 0,
        category: data.category ? String(data.category) : '',
        movedFrom: data.moved_from ? String(data.moved_from) : null,
        movedFromLikesCount:
          data.moved_from_likes_count == null ? null : Number(data.moved_from_likes_count) || 0,
      };
    },

    /**
     * Liest, welche Herzen dieses Geraet bereits vergeben hat.
     * @returns {Promise<Map<string, string>>} Foto-ID -> Kategorie
     */
    async listMyVotes(voterId) {
      const response = await doFetch(`${baseUrl}/rest/v1/rpc/my_photo_votes`, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ p_voter_id: voterId }),
      });
      if (!response.ok) throw await readError(response);
      const rows = await response.json();
      const result = new Map();
      for (const row of Array.isArray(rows) ? rows : []) {
        if (row && row.submission_id) {
          result.set(String(row.submission_id), String(row.mission_category || ''));
        }
      }
      return result;
    },

    /** Liest alle Datensaetze (nur als angemeldeter Admin erlaubt). */
    async listSubmissions() {
      const query = 'select=*&order=created_at.asc';
      const response = await doFetch(`${baseUrl}/rest/v1/${table}?${query}`, {
        method: 'GET',
        headers: authHeaders({ Accept: 'application/json' }),
      });
      if (!response.ok) throw await readError(response);
      return response.json();
    },

    /** Loescht Datensaetze anhand ihrer IDs (nur als Admin). */
    async deleteSubmissions(ids) {
      const list = (Array.isArray(ids) ? ids : [ids]).filter(Boolean);
      if (list.length === 0) return { deleted: 0 };
      const filter = `id=in.(${list.map((id) => encodeURIComponent(id)).join(',')})`;
      const response = await doFetch(`${baseUrl}/rest/v1/${table}?${filter}`, {
        method: 'DELETE',
        headers: authHeaders({ Prefer: 'return=minimal' }),
      });
      if (!response.ok) throw await readError(response);
      return { deleted: list.length };
    },

    // ---------------------------------------------------------------
    // Datei-Speicher
    // ---------------------------------------------------------------

    /**
     * Laedt ein Bild hoch und meldet den Fortschritt.
     * Verwendet XMLHttpRequest, weil nur damit der Upload-Fortschritt in allen
     * Browsern zuverlaessig gemeldet wird.
     * @param {{path: string, blob: Blob, onProgress?: Function, signal?: AbortSignal, timeoutMs?: number}} params
     */
    uploadPhoto({ path, blob, onProgress, signal, timeoutMs = 120000, bucketName = bucket }) {
      return new Promise((resolve, reject) => {
        const xhr = makeXhr();
        const url = `${baseUrl}/storage/v1/object/${encodeURIComponent(bucketName)}/${path
          .split('/')
          .map(encodeURIComponent)
          .join('/')}`;

        let settled = false;
        const finish = (fn, value) => {
          if (settled) return;
          settled = true;
          if (signal) signal.removeEventListener('abort', onAbort);
          fn(value);
        };
        function onAbort() {
          try {
            xhr.abort();
          } catch {
            /* egal */
          }
          const error = new Error('Upload abgebrochen.');
          error.name = 'AbortError';
          finish(reject, error);
        }

        if (signal) {
          if (signal.aborted) {
            onAbort();
            return;
          }
          signal.addEventListener('abort', onAbort);
        }

        xhr.open('POST', url, true);
        xhr.timeout = timeoutMs;
        xhr.setRequestHeader('apikey', anonKey);
        xhr.setRequestHeader(
          'Authorization',
          `Bearer ${session && session.access_token ? session.access_token : anonKey}`,
        );
        xhr.setRequestHeader('Content-Type', blob.type || 'application/octet-stream');
        // Vorhandene Dateien duerfen NICHT ueberschrieben werden.
        xhr.setRequestHeader('x-upsert', 'false');
        xhr.setRequestHeader('cache-control', 'max-age=3600');

        if (xhr.upload && typeof onProgress === 'function') {
          xhr.upload.onprogress = (event) => {
            if (event.lengthComputable && event.total > 0) {
              onProgress(Math.min(0.99, event.loaded / event.total));
            }
          };
        }

        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            if (typeof onProgress === 'function') onProgress(1);
            finish(resolve, { path });
            return;
          }
          let payload = null;
          try {
            payload = JSON.parse(xhr.responseText);
          } catch {
            payload = null;
          }
          finish(
            reject,
            new SupabaseError(
              (payload && (payload.message || payload.error)) ||
                `Der Upload ist fehlgeschlagen (HTTP ${xhr.status}).`,
              { status: xhr.status, code: (payload && payload.statusCode) || '' },
            ),
          );
        };
        xhr.onerror = () => {
          finish(reject, new TypeError('Netzwerkfehler beim Upload.'));
        };
        xhr.ontimeout = () => {
          const error = new Error('Zeitüberschreitung beim Upload.');
          error.name = 'TimeoutError';
          finish(reject, error);
        };

        xhr.send(blob);
      });
    },

    /**
     * Erzeugt kurzlebige Links fuer die private Galerie.
     * @param {string[]} paths
     * @param {number} expiresIn Sekunden
     * @returns {Promise<Map<string, string>>}
     */
    async createSignedUrls(paths, expiresIn = 600, bucketName = bucket) {
      const list = (Array.isArray(paths) ? paths : [paths]).filter(Boolean);
      const result = new Map();
      if (list.length === 0) return result;

      // Supabase begrenzt die Menge pro Anfrage, deshalb in Portionen.
      const chunkSize = 100;
      for (let i = 0; i < list.length; i += chunkSize) {
        const chunk = list.slice(i, i + chunkSize);
        const response = await doFetch(
          `${baseUrl}/storage/v1/object/sign/${encodeURIComponent(bucketName)}`,
          {
            method: 'POST',
            headers: authHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ expiresIn, paths: chunk }),
          },
        );
        if (!response.ok) throw await readError(response);
        const data = await response.json();
        for (const entry of Array.isArray(data) ? data : []) {
          if (entry && entry.signedURL && !entry.error) {
            const signed = String(entry.signedURL);
            result.set(
              entry.path,
              signed.startsWith('http') ? signed : `${baseUrl}/storage/v1${signed}`,
            );
          }
        }
      }
      return result;
    },

    /** Laedt eine Datei als Blob (nur als Admin, ueber einen signierten Link). */
    async downloadPhoto(signedUrl) {
      const response = await doFetch(signedUrl, { method: 'GET' });
      if (!response.ok) throw await readError(response);
      return response.blob();
    },

    /** Loescht Dateien im Speicher (nur als Admin). */
    async deletePhotos(paths, bucketName = bucket) {
      const list = (Array.isArray(paths) ? paths : [paths]).filter(Boolean);
      if (list.length === 0) return { deleted: 0 };
      const response = await doFetch(
        `${baseUrl}/storage/v1/object/${encodeURIComponent(bucketName)}`,
        {
          method: 'DELETE',
          headers: authHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ prefixes: list }),
        },
      );
      if (!response.ok) throw await readError(response);
      return { deleted: list.length };
    },

    // ---------------------------------------------------------------
    // Private Erinnerungen ("Fuer Britta & Lutz")
    // ---------------------------------------------------------------
    // Diese Aufnahmen liegen in einem eigenen, streng privaten Bucket.
    // Gaeste duerfen ausschliesslich schreiben. Alles Lesende hier
    // funktioniert nur, wenn ein Album-Admin angemeldet ist - dafuer sorgen
    // die Regeln in supabase/private-memories.sql.

    /**
     * Legt einen neuen Upload-Vorgang an.
     *
     * Die ID erzeugt die Seite selbst und schickt sie mit. So muss nichts
     * zurueckgelesen werden - Gaeste haben bewusst kein Leserecht.
     * @param {object} row
     */
    async insertMemoryUpload(row) {
      const response = await doFetch(`${baseUrl}/rest/v1/${memoriesTable}`, {
        method: 'POST',
        headers: authHeaders({
          'Content-Type': 'application/json',
          Prefer: 'return=minimal',
        }),
        body: JSON.stringify(row),
      });
      if (!response.ok) throw await readError(response);
      return { inserted: true };
    },

    /** Traegt eine einzelne hochgeladene Datei ein. */
    async insertMemoryFile(row) {
      const response = await doFetch(`${baseUrl}/rest/v1/${memoriesFilesTable}`, {
        method: 'POST',
        headers: authHeaders({
          'Content-Type': 'application/json',
          Prefer: 'return=minimal',
        }),
        body: JSON.stringify(row),
      });
      if (response.ok) return { inserted: true, duplicate: false };
      const error = await readError(response);
      // 23505 = diese Datei ist bereits eingetragen. Das passiert bei einem
      // zweiten Versuch und ist kein Fehler.
      if (error.code === '23505') return { inserted: false, duplicate: true };
      throw error;
    },

    /**
     * Schliesst einen Upload ab. Die Datenbank zaehlt selbst nach und
     * entscheidet, ob der Vorgang vollstaendig ist.
     * @returns {Promise<{status: string, photoCount: number, videoCount: number, totalSize: number}>}
     */
    async completeMemoryUpload(uploadId, expectedPhotos, expectedVideos) {
      const response = await doFetch(`${baseUrl}/rest/v1/rpc/complete_memory_upload`, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          p_upload_id: uploadId,
          p_expected_photos: Number(expectedPhotos) || 0,
          p_expected_videos: Number(expectedVideos) || 0,
        }),
      });
      if (!response.ok) throw await readError(response);
      const data = (await response.json()) || {};
      return {
        status: String(data.status || 'incomplete'),
        photoCount: Number(data.photo_count) || 0,
        videoCount: Number(data.video_count) || 0,
        totalSize: Number(data.total_size) || 0,
      };
    },

    /**
     * Laedt eine private Datei hoch.
     *
     * Grosse Dateien (vor allem Videos auf dem Handy) gehen ueber den
     * unterbrechbaren Weg (TUS): Bricht die Verbindung ab, wird nur der
     * fehlende Rest nachgereicht statt der ganzen Datei. Klappt das nicht,
     * wird automatisch der einfache Weg genommen.
     *
     * @param {{path: string, file: Blob, onProgress?: Function, signal?: AbortSignal,
     *          resumableFromBytes?: number, timeoutMs?: number}} params
     */
    async uploadMemoryFile({
      path,
      file,
      onProgress,
      signal,
      resumableFromBytes = 6 * 1024 * 1024,
      timeoutMs = 600000,
    }) {
      const gross = Number(file.size) > Number(resumableFromBytes);
      if (gross) {
        try {
          return await this.uploadResumable({
            bucketName: memoriesBucket,
            path,
            file,
            onProgress,
            signal,
          });
        } catch (error) {
          // Abbruch durch den Gast bleibt ein Abbruch.
          if (error && error.name === 'AbortError') throw error;
          // Ist die Datei schon da, ist alles gut.
          if (error && error.status === 409) return { path, resumed: true };
          // Sonst: der einfache Weg als Rueckfall.
          // eslint-disable-next-line no-console
          console.warn('Unterbrechbarer Upload nicht möglich, nutze den einfachen Weg.', error);
        }
      }
      return this.uploadPhoto({
        path,
        blob: file,
        onProgress,
        signal,
        timeoutMs,
        bucketName: memoriesBucket,
      });
    },

    /**
     * Unterbrechbarer Upload nach dem TUS-Verfahren (Version 1.0.0).
     *
     * Ablauf:
     *   1. POST  legt den Upload an und liefert eine eigene Adresse zurueck.
     *   2. PATCH schickt die Datei stueckweise (jeweils 6 MB).
     *   3. HEAD  fragt nach einem Abbruch, wie viel schon angekommen ist.
     *
     * @param {{bucketName: string, path: string, file: Blob, onProgress?: Function,
     *          signal?: AbortSignal, chunkSize?: number}} params
     */
    async uploadResumable({
      bucketName,
      path,
      file,
      onProgress,
      signal,
      chunkSize = 6 * 1024 * 1024,
    }) {
      const total = Number(file.size) || 0;
      const meta = [
        ['bucketName', bucketName],
        ['objectName', path],
        ['contentType', file.type || 'application/octet-stream'],
        ['cacheControl', '3600'],
      ]
        .map(([schluessel, wert]) => `${schluessel} ${base64(wert)}`)
        .join(',');

      // ---- Schritt 1: Upload anlegen ----------------------------------
      const creation = await doFetch(`${baseUrl}/storage/v1/upload/resumable`, {
        method: 'POST',
        headers: authHeaders({
          'Tus-Resumable': '1.0.0',
          'Upload-Length': String(total),
          'Upload-Metadata': meta,
          // Vorhandene Dateien duerfen NICHT ueberschrieben werden.
          'x-upsert': 'false',
        }),
        signal,
      });
      if (!creation.ok) throw await readError(creation);
      const location = creation.headers.get('location') || creation.headers.get('Location');
      if (!location) {
        throw new SupabaseError('Der Server hat keine Upload-Adresse geliefert.', {
          status: creation.status,
        });
      }
      const uploadUrl = location.startsWith('http') ? location : `${baseUrl}${location}`;

      // ---- Schritt 2: stueckweise senden ------------------------------
      let offset = 0;
      let versuche = 0;
      while (offset < total) {
        const ende = Math.min(offset + chunkSize, total);
        try {
          const patch = await doFetch(uploadUrl, {
            method: 'PATCH',
            headers: authHeaders({
              'Tus-Resumable': '1.0.0',
              'Upload-Offset': String(offset),
              'Content-Type': 'application/offset+octet-stream',
            }),
            body: file.slice(offset, ende),
            signal,
          });
          if (!patch.ok) throw await readError(patch);
          const neuerStand = Number(patch.headers.get('upload-offset'));
          offset = Number.isFinite(neuerStand) && neuerStand > offset ? neuerStand : ende;
          versuche = 0;
          if (typeof onProgress === 'function') onProgress(Math.min(0.99, offset / total));
        } catch (error) {
          if (error && error.name === 'AbortError') throw error;
          versuche += 1;
          if (versuche > 3) throw error;
          // ---- Schritt 3: nachfragen, was wirklich angekommen ist ----
          const kopf = await doFetch(uploadUrl, {
            method: 'HEAD',
            headers: authHeaders({ 'Tus-Resumable': '1.0.0' }),
            signal,
          });
          if (!kopf.ok) throw error;
          const stand = Number(kopf.headers.get('upload-offset'));
          if (!Number.isFinite(stand)) throw error;
          offset = stand;
        }
      }

      if (typeof onProgress === 'function') onProgress(1);
      return { path, resumable: true };
    },

    // --- Nur fuer angemeldete Album-Admins ---------------------------

    /** Liest alle privaten Upload-Vorgaenge (neueste zuerst). */
    async listMemoryUploads() {
      const response = await doFetch(
        `${baseUrl}/rest/v1/${memoriesTable}?select=*&order=created_at.desc`,
        { method: 'GET', headers: authHeaders({ Accept: 'application/json' }) },
      );
      if (!response.ok) throw await readError(response);
      return response.json();
    },

    /** Liest alle Dateien der privaten Uploads. */
    async listMemoryFiles() {
      const response = await doFetch(
        `${baseUrl}/rest/v1/${memoriesFilesTable}?select=*&order=storage_path.asc`,
        { method: 'GET', headers: authHeaders({ Accept: 'application/json' }) },
      );
      if (!response.ok) throw await readError(response);
      return response.json();
    },

    /** Kurzlebige Links fuer die privaten Dateien. */
    createMemorySignedUrls(paths, expiresIn = 600) {
      return this.createSignedUrls(paths, expiresIn, memoriesBucket);
    },

    /** Loescht Dateien im privaten Speicher. */
    deleteMemoryObjects(paths) {
      return this.deletePhotos(paths, memoriesBucket);
    },

    /**
     * Loescht einen kompletten Upload-Vorgang. Die Dateieintraege verschwinden
     * durch den Fremdschluessel automatisch mit.
     */
    async deleteMemoryUpload(uploadId) {
      const response = await doFetch(
        `${baseUrl}/rest/v1/${memoriesTable}?id=eq.${encodeURIComponent(uploadId)}`,
        { method: 'DELETE', headers: authHeaders({ Prefer: 'return=minimal' }) },
      );
      if (!response.ok) throw await readError(response);
      return { deleted: 1 };
    },

    /** Loescht einzelne Dateieintraege. */
    async deleteMemoryFileRows(ids) {
      const list = (Array.isArray(ids) ? ids : [ids]).filter(Boolean);
      if (list.length === 0) return { deleted: 0 };
      const filter = `id=in.(${list.map((id) => encodeURIComponent(id)).join(',')})`;
      const response = await doFetch(`${baseUrl}/rest/v1/${memoriesFilesTable}?${filter}`, {
        method: 'DELETE',
        headers: authHeaders({ Prefer: 'return=minimal' }),
      });
      if (!response.ok) throw await readError(response);
      return { deleted: list.length };
    },
  };
}
