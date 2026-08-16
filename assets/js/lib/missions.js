// Auswahl-Logik fuer die Foto-Missionen.
// Bewusst ohne Browser-Abhaengigkeiten, damit alles testbar ist.

import { fillTemplate } from './text.js';

/**
 * Liefert alle aktiven Missionen aus einer Liste.
 * @param {Array<object>} missions
 * @returns {Array<object>}
 */
export function activeMissions(missions) {
  if (!Array.isArray(missions)) return [];
  return missions.filter(
    (m) => m && typeof m.id === 'string' && m.id.length > 0 && m.active !== false,
  );
}

/**
 * Ersetzt Platzhalter in Titel und Beschreibung einer Mission.
 * Das Original-Objekt bleibt unveraendert.
 * @param {object} mission
 * @param {{name?: string, age?: number|string}} values
 */
export function renderMission(mission, values) {
  if (!mission) return null;
  return {
    ...mission,
    title: fillTemplate(mission.title, values),
    description: fillTemplate(mission.description, values),
  };
}

/**
 * Kryptografisch gute Zufallszahl 0 <= x < max (gleichverteilt, ohne Modulo-Bias).
 * Faellt auf Math.random zurueck, falls keine Web-Crypto verfuegbar ist.
 * @param {number} max
 * @param {Crypto} [cryptoObj]
 * @returns {number}
 */
export function randomIndex(max, cryptoObj) {
  const limit = Math.floor(max);
  if (!Number.isFinite(limit) || limit <= 0) return 0;
  const c =
    cryptoObj || (typeof globalThis !== 'undefined' ? globalThis.crypto : undefined);
  if (c && typeof c.getRandomValues === 'function') {
    // Ablehnungsverfahren: verhindert eine leichte Bevorzugung kleiner Zahlen.
    const range = 4294967296; // 2^32
    const maxUsable = range - (range % limit);
    const buf = new Uint32Array(1);
    for (let attempt = 0; attempt < 64; attempt += 1) {
      c.getRandomValues(buf);
      if (buf[0] < maxUsable) return buf[0] % limit;
    }
    return buf[0] % limit;
  }
  return Math.floor(Math.random() * limit);
}

/**
 * Zieht eine zufaellige Mission.
 *
 * Regeln:
 *  - nur aktive Missionen
 *  - bereits auf diesem Geraet gezogene Missionen werden vermieden
 *  - die zuletzt gezeigte Mission wird niemals direkt erneut gezeigt
 *  - wenn alle Missionen verbraucht sind, wird der Verlauf ignoriert
 *    (aber weiterhin nicht dieselbe wie zuletzt, solange es Alternativen gibt)
 *
 * @param {Array<object>} missions        Liste aus der Konfiguration
 * @param {object} [options]
 * @param {string[]} [options.seenIds]    Auf diesem Geraet bereits gezogene IDs
 * @param {string|null} [options.excludeId] Aktuell sichtbare Mission (nie direkt wiederholen)
 * @param {Crypto} [options.cryptoObj]
 * @returns {object|null}
 */
export function drawMission(missions, options = {}) {
  const { seenIds = [], excludeId = null, cryptoObj } = options;
  const pool = activeMissions(missions);
  if (pool.length === 0) return null;
  if (pool.length === 1) return pool[0];

  const seen = new Set(Array.isArray(seenIds) ? seenIds : []);

  // 1. Versuch: noch nie gezogen UND nicht die aktuelle Mission
  let candidates = pool.filter((m) => !seen.has(m.id) && m.id !== excludeId);
  // 2. Versuch: darf wiederholt werden, aber nicht die aktuelle Mission
  if (candidates.length === 0) {
    candidates = pool.filter((m) => m.id !== excludeId);
  }
  // 3. Notfall: alles erlaubt
  if (candidates.length === 0) candidates = pool;

  return candidates[randomIndex(candidates.length, cryptoObj)];
}

/**
 * Prueft die Missionsliste auf typische Konfigurationsfehler.
 * Wird von den Tests und beim Start im Testmodus verwendet.
 * @param {Array<object>} missions
 * @returns {string[]} Liste der gefundenen Probleme (leer = alles in Ordnung)
 */
export function validateMissions(missions) {
  const problems = [];
  if (!Array.isArray(missions) || missions.length === 0) {
    problems.push('Es ist keine einzige Mission konfiguriert.');
    return problems;
  }
  const seenIds = new Set();
  const allowedCategories = new Set([
    'Menschen',
    'Momente',
    'Kreativ',
    'Lustig',
    'Geburtstag',
    'Gruppe',
    'Erinnerung',
  ]);
  const allowedDifficulty = new Set(['leicht', 'mittel', 'schwer']);

  missions.forEach((mission, index) => {
    const label = `Mission #${index + 1}`;
    if (!mission || typeof mission !== 'object') {
      problems.push(`${label}: ist kein gültiger Eintrag.`);
      return;
    }
    if (typeof mission.id !== 'string' || mission.id.trim() === '') {
      problems.push(`${label}: "id" fehlt.`);
    } else if (seenIds.has(mission.id)) {
      problems.push(`${label}: die id "${mission.id}" kommt doppelt vor.`);
    } else {
      seenIds.add(mission.id);
    }
    if (typeof mission.title !== 'string' || mission.title.trim() === '') {
      problems.push(`${label}: "title" fehlt.`);
    }
    if (typeof mission.description !== 'string' || mission.description.trim() === '') {
      problems.push(`${label}: "description" fehlt.`);
    }
    if (!allowedCategories.has(mission.category)) {
      problems.push(
        `${label}: unbekannte Kategorie "${mission.category}". Erlaubt: ${[...allowedCategories].join(', ')}.`,
      );
    }
    if (mission.difficulty && !allowedDifficulty.has(mission.difficulty)) {
      problems.push(
        `${label}: unbekannte Schwierigkeit "${mission.difficulty}". Erlaubt: leicht, mittel, schwer.`,
      );
    }
  });

  return problems;
}
