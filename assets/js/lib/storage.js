// Sicherer Zugriff auf localStorage / sessionStorage.
// In privaten Browser-Fenstern kann der Zugriff eine Ausnahme werfen -
// dann wird automatisch auf einen Speicher im Arbeitsspeicher umgeschaltet.

/**
 * Erzeugt einen Speicher, der niemals eine Ausnahme wirft.
 * @param {Storage|null} backend
 * @returns {{get: Function, set: Function, remove: Function, persistent: boolean}}
 */
export function createSafeStorage(backend) {
  let store = backend;
  let persistent = true;

  try {
    if (!store) throw new Error('kein Speicher');
    const probe = '__probe__';
    store.setItem(probe, '1');
    store.removeItem(probe);
  } catch {
    const memory = new Map();
    persistent = false;
    store = {
      getItem: (k) => (memory.has(k) ? memory.get(k) : null),
      setItem: (k, v) => memory.set(k, String(v)),
      removeItem: (k) => memory.delete(k),
    };
  }

  return {
    persistent,
    /**
     * @param {string} key
     * @param {*} fallback
     */
    get(key, fallback = null) {
      try {
        const raw = store.getItem(key);
        if (raw == null) return fallback;
        return JSON.parse(raw);
      } catch {
        return fallback;
      }
    },
    /**
     * @param {string} key
     * @param {*} value
     * @returns {boolean} true, wenn gespeichert werden konnte
     */
    set(key, value) {
      try {
        store.setItem(key, JSON.stringify(value));
        return true;
      } catch {
        return false;
      }
    },
    remove(key) {
      try {
        store.removeItem(key);
        return true;
      } catch {
        return false;
      }
    },
  };
}

/**
 * Standardspeicher des Browsers (localStorage).
 */
export function browserStorage() {
  let backend = null;
  try {
    backend = typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    backend = null;
  }
  return createSafeStorage(backend);
}

/**
 * Speicher nur fuer die aktuelle Registerkarte (sessionStorage).
 * Wird fuer die Admin-Anmeldung verwendet, damit das Album beim
 * Schliessen des Tabs automatisch abgemeldet ist.
 */
export function tabStorage() {
  let backend = null;
  try {
    backend = typeof sessionStorage !== 'undefined' ? sessionStorage : null;
  } catch {
    backend = null;
  }
  return createSafeStorage(backend);
}
