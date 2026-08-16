// Uebertraegt die Farben aus config/party-config.js in die CSS-Variablen
// und baut die dezenten Hintergrundeffekte auf.

import { prefersReducedMotion } from './dom.js';

const COLOR_VARIABLES = {
  background: '--c-bg',
  backgroundDeep: '--c-bg-deep',
  indigo: '--c-indigo',
  violet: '--c-violet',
  magenta: '--c-magenta',
  gold: '--c-gold',
  goldSoft: '--c-gold-soft',
  text: '--c-text',
  textMuted: '--c-text-muted',
  danger: '--c-danger',
  success: '--c-success',
};

// Nur sichere Farbangaben zulassen (Hex, rgb/rgba, hsl/hsla).
const SAFE_COLOR = /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%/]+\)|hsla?\([\d\s.,%/deg]+\))$/i;

/**
 * @param {{colors?: object}} theme
 */
export function applyTheme(theme = {}) {
  const colors = theme.colors || {};
  const root = document.documentElement;
  for (const [key, variable] of Object.entries(COLOR_VARIABLES)) {
    const value = colors[key];
    if (typeof value === 'string' && SAFE_COLOR.test(value.trim())) {
      root.style.setProperty(variable, value.trim());
    }
  }
  const themeColorMeta = document.querySelector('meta[name="theme-color"]');
  if (themeColorMeta && typeof colors.background === 'string' && SAFE_COLOR.test(colors.background)) {
    themeColorMeta.setAttribute('content', colors.background);
  }
}

/**
 * Streut ein paar Lichtpunkte in den Hintergrund.
 * @param {HTMLElement|null} container
 * @param {{count?: number}} [options]
 */
export function createParticles(container, options = {}) {
  if (!container || prefersReducedMotion()) return;
  const count = options.count || 18;
  const fragment = document.createDocumentFragment();
  for (let i = 0; i < count; i += 1) {
    const dot = document.createElement('span');
    dot.className = 'particle';
    const size = 1.5 + Math.random() * 2.5;
    dot.style.width = `${size}px`;
    dot.style.height = `${size}px`;
    dot.style.left = `${Math.random() * 100}%`;
    dot.style.top = `${20 + Math.random() * 80}%`;
    dot.style.setProperty('--drift', `${(Math.random() - 0.5) * 60}px`);
    dot.style.animationDuration = `${9 + Math.random() * 11}s`;
    dot.style.animationDelay = `${-Math.random() * 14}s`;
    fragment.appendChild(dot);
  }
  container.appendChild(fragment);
}

/**
 * Schaltet die im Design vorgesehenen Effekte je nach Konfiguration ab.
 * @param {{grain?: boolean, particles?: boolean, bigNumber?: boolean}} effects
 */
export function applyEffects(effects = {}) {
  if (effects.grain === false) {
    const grain = document.querySelector('[data-grain]');
    if (grain) grain.remove();
  }
  if (effects.bigNumber === false) {
    const number = document.querySelector('[data-big-number]');
    if (number) number.remove();
  }
  if (effects.particles !== false) {
    createParticles(document.querySelector('[data-particles]'));
  }
}

/**
 * Setzt die grosse Hintergrundzahl auf das konfigurierte Alter.
 * @param {number|string} age
 */
export function applyBigNumber(age) {
  const node = document.querySelector('[data-big-number]');
  if (node && age) node.textContent = String(age);
}
