// Kleine DOM-Helfer.
//
// Wichtigste Regel dieser Datei: Texte von Gaesten werden AUSSCHLIESSLICH ueber
// textContent gesetzt, niemals ueber innerHTML. Damit kann kein eingegebener
// Text als HTML oder Script ausgefuehrt werden.

/**
 * Erzeugt ein Element.
 * @param {string} tag
 * @param {object} [props]  z. B. { className, text, attrs, on }
 * @param {Array<Node|string>} [children]
 * @returns {HTMLElement}
 */
export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  if (props.className) node.className = props.className;
  if (props.id) node.id = props.id;
  // "text" landet immer als reiner Text im Element.
  if (props.text !== undefined && props.text !== null) node.textContent = String(props.text);
  if (props.attrs) {
    for (const [key, value] of Object.entries(props.attrs)) {
      if (value === false || value === null || value === undefined) continue;
      node.setAttribute(key, value === true ? '' : String(value));
    }
  }
  if (props.on) {
    for (const [event, handler] of Object.entries(props.on)) {
      node.addEventListener(event, handler);
    }
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

/** Leert ein Element vollstaendig. */
export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

/** Kurzform fuer querySelector. */
export function $(selector, scope = document) {
  return scope.querySelector(selector);
}

/** Kurzform fuer querySelectorAll als echtes Array. */
export function $$(selector, scope = document) {
  return Array.from(scope.querySelectorAll(selector));
}

/**
 * Prueft, ob der Gast reduzierte Bewegung eingestellt hat.
 * @returns {boolean}
 */
export function prefersReducedMotion() {
  try {
    return (
      typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
    );
  } catch {
    return false;
  }
}

/**
 * Gibt eine Meldung an Screenreader weiter.
 * @param {HTMLElement} liveRegion
 * @param {string} message
 */
export function announce(liveRegion, message) {
  if (!liveRegion) return;
  // Kurz leeren, damit auch die gleiche Meldung erneut vorgelesen wird.
  liveRegion.textContent = '';
  window.setTimeout(() => {
    liveRegion.textContent = String(message);
  }, 60);
}

/**
 * Wartet eine bestimmte Zeit. Bei reduzierter Bewegung wird die Wartezeit
 * stark verkuerzt, damit die Bedienung nicht ausgebremst wird.
 * @param {number} ms
 * @param {boolean} [reduced]
 */
export function wait(ms, reduced = prefersReducedMotion()) {
  const duration = reduced ? Math.min(80, ms) : ms;
  return new Promise((resolve) => window.setTimeout(resolve, duration));
}

/**
 * Haelt die Tastaturnavigation innerhalb eines Bereichs (fuer Dialoge).
 * @param {HTMLElement} container
 * @returns {Function} Aufraeumfunktion
 */
export function trapFocus(container) {
  const selector =
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

  function onKeyDown(event) {
    if (event.key !== 'Tab') return;
    const items = Array.from(container.querySelectorAll(selector)).filter(
      (node) => node.offsetParent !== null || node === document.activeElement,
    );
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  container.addEventListener('keydown', onKeyDown);
  return () => container.removeEventListener('keydown', onKeyDown);
}

/**
 * Loest den Download einer Datei aus.
 * @param {Blob} blob
 * @param {string} filename
 */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  // Etwas Zeit lassen, damit der Download wirklich startet.
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/**
 * Liest den Testmodus aus der Adresszeile.
 * @param {string} queryParam
 * @param {string} [search]
 * @returns {boolean}
 */
export function isTestMode(queryParam = 'test', search = window.location.search) {
  try {
    const params = new URLSearchParams(search);
    const value = params.get(queryParam);
    return value === '1' || value === 'true' || value === 'ja';
  } catch {
    return false;
  }
}
