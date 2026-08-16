// Zustand pro Geraet: Geraete-ID, bereits gezogene Missionen, abgeschlossene Uploads.
//
// WICHTIGER HINWEIS ZUR SICHERHEIT
// Diese Begrenzung laeuft ausschliesslich im Browser des Gastes. Wer moechte,
// kann den Browser-Speicher loeschen, ein privates Fenster oeffnen oder ein
// anderes Geraet nehmen und dann erneut hochladen. Das ist fuer eine private
// Feier bewusst so gewaehlt (keine Gastkonten). Einen vollstaendigen Schutz
// gegen absichtliche Manipulation bietet sie NICHT.
// Gegen versehentliche Doppel-Uploads schuetzt zusaetzlich der eindeutige
// Datenbank-Index auf "device_submission_id" (siehe supabase/setup.sql).

const STATE_KEY = 'foto-mission:state:v1';
const STATE_VERSION = 1;

/**
 * Erzeugt eine zufaellige UUID (v4).
 * @param {Crypto} [cryptoObj]
 * @returns {string}
 */
export function uuid(cryptoObj) {
  const c = cryptoObj || (typeof globalThis !== 'undefined' ? globalThis.crypto : undefined);
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  if (c && typeof c.getRandomValues === 'function') {
    const bytes = new Uint8Array(16);
    c.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40; // Version 4
    bytes[8] = (bytes[8] & 0x3f) | 0x80; // Variante
    const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  // Letzter Ausweg (sollte in modernen Browsern nie erreicht werden)
  return `xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx`.replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    const v = ch === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Leerer Startzustand.
 * @returns {object}
 */
export function emptyState() {
  return {
    version: STATE_VERSION,
    deviceId: uuid(),
    guestName: '',
    seenMissionIds: [],
    completed: [],
  };
}

/**
 * Repariert einen eingelesenen Zustand, damit die App auch mit
 * kaputten oder alten Daten im Browser-Speicher startet.
 * @param {*} raw
 * @returns {object}
 */
export function normalizeState(raw) {
  const base = emptyState();
  if (!raw || typeof raw !== 'object') return base;
  return {
    version: STATE_VERSION,
    deviceId:
      typeof raw.deviceId === 'string' && raw.deviceId.length >= 8 ? raw.deviceId : base.deviceId,
    guestName: typeof raw.guestName === 'string' ? raw.guestName.slice(0, 80) : '',
    seenMissionIds: Array.isArray(raw.seenMissionIds)
      ? raw.seenMissionIds.filter((id) => typeof id === 'string').slice(-200)
      : [],
    completed: Array.isArray(raw.completed)
      ? raw.completed
          .filter((entry) => entry && typeof entry === 'object' && typeof entry.kind === 'string')
          .slice(-100)
      : [],
  };
}

/**
 * Kapselt den Geraetezustand samt Speichern.
 * @param {{get: Function, set: Function, remove: Function}} storage
 */
export function createDeviceState(storage) {
  let state = normalizeState(storage.get(STATE_KEY, null));
  // Direkt sichern, damit die Geraete-ID stabil bleibt.
  storage.set(STATE_KEY, state);

  function save() {
    storage.set(STATE_KEY, state);
  }

  return {
    get deviceId() {
      return state.deviceId;
    },
    get guestName() {
      return state.guestName;
    },
    setGuestName(name) {
      state.guestName = String(name || '').slice(0, 80);
      save();
    },
    get seenMissionIds() {
      return [...state.seenMissionIds];
    },
    rememberMission(missionId) {
      if (typeof missionId !== 'string' || missionId === '') return;
      state.seenMissionIds = [...state.seenMissionIds.filter((id) => id !== missionId), missionId];
      if (state.seenMissionIds.length > 200) {
        state.seenMissionIds = state.seenMissionIds.slice(-200);
      }
      save();
    },
    get completed() {
      return state.completed.map((entry) => ({ ...entry }));
    },
    /**
     * @param {'regular'|'bonus'} kind
     */
    countCompleted(kind) {
      return state.completed.filter((entry) => entry.kind === kind).length;
    },
    /**
     * Merkt sich einen erfolgreichen Upload.
     * @param {object} entry
     */
    addCompleted(entry) {
      state.completed = [...state.completed, { ...entry, at: entry.at || new Date().toISOString() }];
      save();
    },
    /**
     * Loescht den kompletten Geraetezustand (nur fuer den Testmodus).
     */
    reset() {
      state = emptyState();
      save();
    },
    snapshot() {
      return JSON.parse(JSON.stringify(state));
    },
  };
}

/**
 * Entscheidet, was der Gast als Naechstes darf.
 * @param {{countCompleted: Function}} device
 * @param {{regularMissionsPerDevice?: number, bonusMissionsPerDevice?: number}} limits
 * @param {boolean} testMode
 * @returns {{canRegular: boolean, canBonus: boolean, regularDone: number, bonusDone: number}}
 */
export function missionAllowance(device, limits = {}, testMode = false) {
  const maxRegular = Number.isFinite(limits.regularMissionsPerDevice)
    ? limits.regularMissionsPerDevice
    : 1;
  const maxBonus = Number.isFinite(limits.bonusMissionsPerDevice)
    ? limits.bonusMissionsPerDevice
    : 1;
  const regularDone = device.countCompleted('regular');
  const bonusDone = device.countCompleted('bonus');

  if (testMode) {
    // Im Testmodus darf beliebig oft gezogen werden.
    return { canRegular: true, canBonus: true, regularDone, bonusDone };
  }
  return {
    canRegular: regularDone < maxRegular,
    canBonus: regularDone > 0 && bonusDone < maxBonus,
    regularDone,
    bonusDone,
  };
}
