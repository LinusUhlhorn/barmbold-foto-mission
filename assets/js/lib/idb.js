// Kleiner Zwischenspeicher fuer das noch nicht hochgeladene Foto.
//
// Zweck: Wenn der Gast versehentlich die Seite neu laedt, ist sein Foto nicht weg.
// Es wird ausschliesslich lokal im Browser gespeichert und nach dem erfolgreichen
// Upload (oder beim Abbrechen) wieder geloescht.

const DB_NAME = 'foto-mission';
const DB_VERSION = 1;
const STORE = 'pending';
const KEY = 'current';

function openDatabase() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB steht nicht zur Verfügung.'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IndexedDB nicht verfügbar.'));
    request.onblocked = () => reject(new Error('IndexedDB ist blockiert.'));
  });
}

function runTransaction(mode, action) {
  return openDatabase().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const store = tx.objectStore(STORE);
        let result;
        try {
          result = action(store);
        } catch (error) {
          reject(error);
          return;
        }
        tx.oncomplete = () => {
          db.close();
          resolve(result && typeof result.result !== 'undefined' ? result.result : undefined);
        };
        tx.onerror = () => {
          db.close();
          reject(tx.error || new Error('Speichern fehlgeschlagen.'));
        };
        tx.onabort = () => {
          db.close();
          reject(tx.error || new Error('Speichern abgebrochen.'));
        };
      }),
  );
}

/**
 * Legt das aktuelle Foto samt Begleitdaten ab.
 * Fehler werden bewusst verschluckt: der Zwischenspeicher ist ein Komfort,
 * kein Muss. Die App funktioniert auch ohne ihn.
 * @param {{blob: Blob, meta: object}} payload
 * @returns {Promise<boolean>}
 */
export async function savePending(payload) {
  try {
    await runTransaction('readwrite', (store) => store.put(payload, KEY));
    return true;
  } catch {
    return false;
  }
}

/**
 * Holt ein zwischengespeichertes Foto zurueck.
 * @returns {Promise<{blob: Blob, meta: object}|null>}
 */
export async function loadPending() {
  try {
    const value = await runTransaction('readonly', (store) => store.get(KEY));
    if (value && value.blob instanceof Blob) return value;
    return null;
  } catch {
    return null;
  }
}

/** Loescht das zwischengespeicherte Foto. */
export async function clearPending() {
  try {
    await runTransaction('readwrite', (store) => store.delete(KEY));
    return true;
  } catch {
    return false;
  }
}
