// Sehr dezente Klaenge, die der Browser selbst erzeugt (Web Audio API).
//
// Bewusste Entscheidungen:
//  - KEINE Musikdatei, keine externe Quelle, keine Urheberrechtsfrage.
//  - Nichts startet von allein. Der Ton wird erst erzeugt, nachdem der Gast
//    aktiv getippt hat - so verlangen es auch die Browser selbst.
//  - Der Gast kann den Ton jederzeit abschalten, die Einstellung wird gemerkt.

const STORAGE_KEY = 'foto-mission:sound';

/**
 * @param {{enabled?: boolean}} config
 * @param {{get: Function, set: Function}} storage
 */
export function createSound(config = {}, storage) {
  const configEnabled = config.enabled !== false;
  let enabled = storage ? storage.get(STORAGE_KEY, configEnabled) : configEnabled;
  let context = null;

  function ensureContext() {
    if (!enabled) return null;
    const Ctor = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!Ctor) return null;
    if (!context) {
      try {
        context = new Ctor();
      } catch {
        return null;
      }
    }
    if (context.state === 'suspended') context.resume().catch(() => {});
    return context;
  }

  /**
   * Ein einzelner kurzer Ton.
   */
  function tone({ frequency, duration, type = 'sine', gain = 0.05, sweepTo = null, delay = 0 }) {
    const ctx = ensureContext();
    if (!ctx) return;
    const start = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const amp = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(frequency, start);
    if (sweepTo) osc.frequency.exponentialRampToValueAtTime(sweepTo, start + duration);
    amp.gain.setValueAtTime(0.0001, start);
    amp.gain.exponentialRampToValueAtTime(gain, start + 0.012);
    amp.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    osc.connect(amp);
    amp.connect(ctx.destination);
    osc.start(start);
    osc.stop(start + duration + 0.02);
  }

  /** Kurzes Rauschen - dient als "Klack" des Auslösers. */
  function noiseBurst({ duration = 0.06, gain = 0.06, delay = 0 } = {}) {
    const ctx = ensureContext();
    if (!ctx) return;
    const frames = Math.floor(ctx.sampleRate * duration);
    const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < frames; i += 1) {
      // Nach hinten leiser werden lassen.
      data[i] = (Math.random() * 2 - 1) * (1 - i / frames) ** 2;
    }
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const amp = ctx.createGain();
    amp.gain.value = gain;
    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 900;
    source.connect(filter);
    filter.connect(amp);
    amp.connect(ctx.destination);
    source.start(ctx.currentTime + delay);
  }

  return {
    get enabled() {
      return enabled;
    },
    toggle() {
      enabled = !enabled;
      if (storage) storage.set(STORAGE_KEY, enabled);
      if (!enabled && context) {
        try {
          context.close();
        } catch {
          /* egal */
        }
        context = null;
      }
      return enabled;
    },
    /** Wird beim ersten Tippen aufgerufen, damit der Ton spaeter sofort da ist. */
    unlock() {
      ensureContext();
    },
    /** Leises Tippen auf einen Knopf. */
    tap() {
      tone({ frequency: 620, duration: 0.05, type: 'triangle', gain: 0.025 });
    },
    /** Karten werden gemischt. */
    shuffle() {
      for (let i = 0; i < 5; i += 1) {
        noiseBurst({ duration: 0.035, gain: 0.02, delay: i * 0.075 });
      }
    },
    /** Die Mission wird aufgedeckt. */
    reveal() {
      tone({ frequency: 330, sweepTo: 880, duration: 0.28, type: 'sine', gain: 0.045 });
      tone({ frequency: 660, sweepTo: 1320, duration: 0.34, type: 'sine', gain: 0.02, delay: 0.05 });
    },
    /** Der Auslöser der Kamera. */
    shutter() {
      noiseBurst({ duration: 0.05, gain: 0.07 });
      noiseBurst({ duration: 0.07, gain: 0.05, delay: 0.075 });
    },
    /** Der Upload war erfolgreich. */
    success() {
      tone({ frequency: 523.25, duration: 0.16, type: 'sine', gain: 0.04 });
      tone({ frequency: 659.25, duration: 0.16, type: 'sine', gain: 0.04, delay: 0.11 });
      tone({ frequency: 783.99, duration: 0.34, type: 'sine', gain: 0.045, delay: 0.22 });
    },
    /** Etwas ist schiefgelaufen. */
    error() {
      tone({ frequency: 220, duration: 0.18, type: 'triangle', gain: 0.035 });
      tone({ frequency: 165, duration: 0.26, type: 'triangle', gain: 0.03, delay: 0.12 });
    },
  };
}

/**
 * Kurzes Vibrieren, sofern das Geraet es unterstuetzt.
 * Auf iPhones passiert nichts - das ist in Ordnung und kein Fehler.
 * @param {number|number[]} pattern
 */
export function vibrate(pattern) {
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate(pattern);
    }
  } catch {
    /* Vibration ist nur ein Extra. */
  }
}
