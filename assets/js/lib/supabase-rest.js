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
 * Erzeugt den Client.
 * @param {{url: string, anonKey: string, bucket: string, table: string}} config
 * @param {{fetchImpl?: Function, xhrFactory?: Function}} [deps]
 */
export function createSupabaseClient(config, deps = {}) {
  const baseUrl = String(config.url || '').replace(/\/+$/, '');
  const anonKey = String(config.anonKey || '');
  const bucket = String(config.bucket || 'party-photos');
  const table = String(config.table || 'photo_submissions');

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

    /** Vergibt pro Geraet hoechstens ein Herz fuer ein Foto. */
    async voteForPhoto(submissionId, voterId) {
      const response = await doFetch(`${baseUrl}/rest/v1/rpc/vote_for_photo`, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ p_submission_id: submissionId, p_voter_id: voterId }),
      });
      if (!response.ok) throw await readError(response);
      const value = await response.json();
      return Number(value) || 0;
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
    uploadPhoto({ path, blob, onProgress, signal, timeoutMs = 120000 }) {
      return new Promise((resolve, reject) => {
        const xhr = makeXhr();
        const url = `${baseUrl}/storage/v1/object/${encodeURIComponent(bucket)}/${path
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
    async createSignedUrls(paths, expiresIn = 600) {
      const list = (Array.isArray(paths) ? paths : [paths]).filter(Boolean);
      const result = new Map();
      if (list.length === 0) return result;

      // Supabase begrenzt die Menge pro Anfrage, deshalb in Portionen.
      const chunkSize = 100;
      for (let i = 0; i < list.length; i += chunkSize) {
        const chunk = list.slice(i, i + chunkSize);
        const response = await doFetch(
          `${baseUrl}/storage/v1/object/sign/${encodeURIComponent(bucket)}`,
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
    async deletePhotos(paths) {
      const list = (Array.isArray(paths) ? paths : [paths]).filter(Boolean);
      if (list.length === 0) return { deleted: 0 };
      const response = await doFetch(
        `${baseUrl}/storage/v1/object/${encodeURIComponent(bucket)}`,
        {
          method: 'DELETE',
          headers: authHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ prefixes: list }),
        },
      );
      if (!response.ok) throw await readError(response);
      return { deleted: list.length };
    },
  };
}
