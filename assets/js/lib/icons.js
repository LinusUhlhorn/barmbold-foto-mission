// Kleine, selbst gezeichnete Symbolsammlung.
// Bewusst KEINE externe Icon-Bibliothek und keine externen Bilder:
// So kann nichts verschwinden und es werden keine Daten an Dritte gesendet.
// Alle Pfade sind fuer eine 24x24-Zeichenflaeche gedacht.

export const ICON_PATHS = {
  camera:
    'M4 8h3l1.5-2h7L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z M12 16.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z',
  aperture:
    'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M12 3v8 M19.8 7.5 12 12 M19.8 16.5 12 12 M12 21v-9 M4.2 16.5 12 12 M4.2 7.5 12 12',
  users:
    'M16 19v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 17.5V19 M10 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z M20 19v-1.5a3.5 3.5 0 0 0-2.6-3.4 M15.5 4.2a3.5 3.5 0 0 1 0 6.6',
  heart:
    'M12 20s-7-4.4-7-9a4 4 0 0 1 7-2.6A4 4 0 0 1 19 11c0 4.6-7 9-7 9z',
  sparkles:
    'M12 3l1.7 4.6L18 9.3l-4.3 1.7L12 15.6l-1.7-4.6L6 9.3l4.3-1.7L12 3z M18.5 15l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2z M5 14l.6 1.7L7.3 16l-1.7.6L5 18.3l-.6-1.7L2.7 16l1.7-.6L5 14z',
  star: 'M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.9-5.2-2.8-5.2 2.8 1-5.9L3.5 9.7l5.9-.8L12 3.5z',
  film:
    'M3.5 5.5h17v13h-17z M3.5 9.5h17 M3.5 14.5h17 M7.5 5.5v13 M16.5 5.5v13',
  music:
    'M9 18V6l10-2v12 M9 18a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0z M19 16a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0z',
  gift:
    'M3.5 11.5h17v8h-17z M2.5 7.5h19v4h-19z M12 7.5v12 M12 7.5S10 3.5 7.75 3.5a2.25 2.25 0 0 0 0 4.5H12z M12 7.5s2-4 4.25-4a2.25 2.25 0 0 1 0 4.5H12z',
  cake:
    'M4 20h16 M4.5 20v-6.5a2 2 0 0 1 2-2h11a2 2 0 0 1 2 2V20 M4.5 15.5c1.6 1.4 3.2 1.4 4.8 0s3.2-1.4 4.8 0 3.2 1.4 4.4 0 M12 8.5V6 M8 8.5V6.5 M16 8.5V6.5',
  moon: 'M20 14.2A8.2 8.2 0 0 1 9.8 4 8.5 8.5 0 1 0 20 14.2z',
  zap: 'M13.5 2.5 4.5 14h6l-1 7.5 9-11.5h-6l1-7.5z',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M12 7v5.2l3.4 2',
  eye: 'M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  smile:
    'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M8.5 13.5s1.2 2.2 3.5 2.2 3.5-2.2 3.5-2.2 M9 9.5v.6 M15 9.5v.6',
  compass:
    'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M15.5 8.5l-2 5-5 2 2-5 5-2z',
  check: 'M4.5 12.5 9.5 17.5 19.5 6.5',
  x: 'M6 6l12 12 M18 6 6 18',
  download: 'M12 4v10 M8 10.5l4 4 4-4 M4.5 19.5h15',
  trash:
    'M4.5 6.5h15 M9.5 6.5V4.5h5v2 M6.5 6.5 7.5 20h9l1-13.5 M10 10v6.5 M14 10v6.5',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z M16.2 16.2 20.5 20.5',
  play: 'M7.5 4.5 19 12 7.5 19.5z',
  logout: 'M14.5 4.5h4a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-4 M10.5 15.5 14.5 12l-4-3.5 M14 12H3.5',
  grid: 'M4 4h6v6H4z M14 4h6v6h-6z M4 14h6v6H4z M14 14h6v6h-6z',
  timeline: 'M12 3.5v17 M12 7.5h6.5 M12 12h-6.5 M12 16.5h6.5 M12 7.5a1.5 1.5 0 1 0 0-3 M12 21a1.5 1.5 0 1 0 0-3',
  printer:
    'M7 9V4.5h10V9 M5 9h14a1.5 1.5 0 0 1 1.5 1.5v5H17V19H7v-3.5H3.5v-5A1.5 1.5 0 0 1 5 9z M7 15.5h10',
  volume: 'M5 9.5h3l4-3.5v12l-4-3.5H5z M16 9a4.5 4.5 0 0 1 0 6',
  volumeOff: 'M5 9.5h3l4-3.5v12l-4-3.5H5z M16 9.5l4 5 M20 9.5l-4 5',
  refresh:
    'M20 12a8 8 0 1 1-2.6-5.9 M20 3.5V9h-5.5',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M12 11v6 M12 7.5v.6',
  lock: 'M6.5 10.5h11v9h-11z M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5',
  chevronLeft: 'M14.5 5.5 8 12l6.5 6.5',
  chevronRight: 'M9.5 5.5 16 12l-6.5 6.5',
};

/**
 * Erzeugt ein SVG-Symbol als DOM-Element (kein innerHTML).
 * @param {string} name  Schluessel aus ICON_PATHS
 * @param {{size?: number, className?: string, strokeWidth?: number}} [options]
 * @returns {SVGElement}
 */
export function createIcon(name, options = {}) {
  const { size = 24, className = 'icon', strokeWidth = 1.6 } = options;
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', String(strokeWidth));
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  if (className) svg.setAttribute('class', className);

  const d = ICON_PATHS[name] || ICON_PATHS.camera;
  const path = document.createElementNS(NS, 'path');
  path.setAttribute('d', d);
  svg.appendChild(path);
  return svg;
}

/**
 * Prueft, ob ein Symbolname bekannt ist (wird von den Tests genutzt).
 * @param {string} name
 */
export function hasIcon(name) {
  return Object.prototype.hasOwnProperty.call(ICON_PATHS, name);
}
