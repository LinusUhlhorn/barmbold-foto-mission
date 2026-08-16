// =========================================================================
// DRUCKSEITE MIT QR-CODE
//
// Der QR-Code wird direkt im Browser erzeugt - aus genau der Adresse, die in
// config/party-config.js unter party.publicUrl steht. Es wird KEIN externer
// Dienst und keine QR-Code-API verwendet, es verlassen also keine Daten das Gerät.
// =========================================================================

import { PARTY_CONFIG } from '../../config/party-config.js';
import { $, $$, announce, clear, downloadBlob, el } from './lib/dom.js';
import { applyTheme } from './lib/theme.js';
import { qrToPngBlob, qrToSvgElement, qrToSvgString } from './lib/qr-render.js';

const config = PARTY_CONFIG;
const url = config.party.publicUrl;
const live = $('[data-live]');

const TEXTS = {
  // Die Überzeile greift den Titel der App auf und wiederholt nicht die Überschrift.
  eyebrow: `Level ${config.party.age}`,
  title: 'DEINE FOTO-MISSION',
  subtitle: 'Zieh eine Aufgabe und halte einen besonderen Moment fest.',
  steps: 'Scannen · Mission ziehen · Foto aufnehmen',
  note: 'Privates Party-Album – Bilder sind nicht öffentlich sichtbar',
  gift: config.party.giftedBy,
};

// Fehlerkorrekturstufe Q: der Code bleibt lesbar, auch wenn eine Karte
// einen Knick oder einen Fleck abbekommt.
const QR_OPTIONS = { ecLevel: 'Q', quietZone: 3 };

/**
 * Baut den QR-Code als SVG-Element.
 */
function qrElement() {
  return qrToSvgElement(url, {
    ...QR_OPTIONS,
    dark: '#07060f',
    light: '#ffffff',
    title: `QR-Code zur Foto-Mission: ${url}`,
  });
}

/**
 * Grosses Plakat (A4 oder A5).
 */
function buildPoster() {
  const poster = el('div', { className: 'poster' });
  poster.appendChild(el('div', { className: 'poster__number', text: String(config.party.age) }));
  poster.appendChild(el('p', { className: 'poster__eyebrow', text: TEXTS.eyebrow }));
  poster.appendChild(el('h1', { className: 'poster__title', text: TEXTS.title }));
  poster.appendChild(el('p', { className: 'poster__subtitle', text: TEXTS.subtitle }));

  const qrBox = el('div', { className: 'poster__qr' });
  qrBox.appendChild(qrElement());
  poster.appendChild(qrBox);

  poster.appendChild(el('p', { className: 'poster__url', text: url }));
  poster.appendChild(el('p', { className: 'poster__steps', text: TEXTS.steps }));
  poster.appendChild(el('p', { className: 'poster__note', text: TEXTS.note }));
  poster.appendChild(el('p', { className: 'poster__gift', text: TEXTS.gift }));
  return poster;
}

/**
 * Eine einzelne Tischkarte.
 */
function buildTableCard() {
  const card = el('div', { className: 'tablecard' });
  card.appendChild(el('span', { className: 'tablecard__number', text: String(config.party.age) }));
  card.appendChild(el('p', { className: 'tablecard__eyebrow', text: TEXTS.eyebrow }));
  card.appendChild(el('h2', { className: 'tablecard__title', text: TEXTS.title }));
  card.appendChild(el('p', { className: 'tablecard__subtitle', text: TEXTS.subtitle }));

  const qrBox = el('div', { className: 'tablecard__qr' });
  qrBox.appendChild(qrElement());
  card.appendChild(qrBox);

  card.appendChild(el('p', { className: 'tablecard__steps', text: TEXTS.steps }));
  card.appendChild(el('p', { className: 'tablecard__note', text: TEXTS.note }));
  card.appendChild(el('p', { className: 'tablecard__gift', text: TEXTS.gift }));
  return card;
}

/**
 * Schnittmarken an den Trennlinien - nur in der Druckansicht sichtbar.
 * @param {number} columns
 * @param {number} rows
 */
function buildCropMarks(columns, rows) {
  const marks = el('div', { className: 'cropmarks' });
  const LENGTH = '4mm';
  const THICK = '0.25mm';

  // Senkrechte Trennlinien
  for (let c = 1; c < columns; c += 1) {
    const x = `${(100 / columns) * c}%`;
    for (const edge of ['top', 'bottom']) {
      const mark = el('span');
      mark.style.left = x;
      mark.style.width = THICK;
      mark.style.height = LENGTH;
      mark.style[edge] = '0';
      marks.appendChild(mark);
    }
  }
  // Waagerechte Trennlinien
  for (let r = 1; r < rows; r += 1) {
    const y = `${(100 / rows) * r}%`;
    for (const edge of ['left', 'right']) {
      const mark = el('span');
      mark.style.top = y;
      mark.style.height = THICK;
      mark.style.width = LENGTH;
      mark.style[edge] = '0';
      marks.appendChild(mark);
    }
  }
  return marks;
}

/**
 * Stellt das gewaehlte Format zusammen.
 * @param {'a4-poster'|'a5-poster'|'cards-4'|'cards-8'} layout
 */
function renderLayout(layout) {
  const sheet = $('[data-sheet]');
  clear(sheet);

  const isA5 = layout === 'a5-poster';
  sheet.className = `sheet ${isA5 ? 'sheet--a5' : 'sheet--a4'}`;

  // Seitenformat für den Druck festlegen.
  $('[data-page-style]').textContent = `@page { size: ${isA5 ? 'A5' : 'A4'} portrait; margin: 0; }`;

  if (layout === 'cards-4' || layout === 'cards-8') {
    const count = layout === 'cards-4' ? 4 : 8;
    const rows = count / 2;
    const wrap = el('div', { className: `cards cards--${count}` });
    for (let i = 0; i < count; i += 1) wrap.appendChild(buildTableCard());
    sheet.appendChild(wrap);
    sheet.appendChild(buildCropMarks(2, rows));
    announce(live, `${count} Tischkarten auf A4 vorbereitet.`);
  } else {
    sheet.appendChild(buildPoster());
    announce(live, `Plakat im Format ${isA5 ? 'A5' : 'A4'} vorbereitet.`);
  }

  fitToScreen();
}

/**
 * Skaliert das Blatt am Bildschirm so, dass es komplett sichtbar ist.
 * Beim Drucken wird die Skalierung wieder aufgehoben (siehe print.css).
 */
function fitToScreen() {
  const sheet = $('[data-sheet]');
  const stage = $('.print-stage');
  if (!sheet || !stage) return;
  sheet.style.transform = 'none';
  sheet.style.marginBottom = '0';

  const available = stage.clientWidth - 8;
  const width = sheet.offsetWidth;
  if (width > 0 && available > 0 && available < width) {
    const scale = available / width;
    sheet.style.transform = `scale(${scale})`;
    // Platz zurückgewinnen, den das verkleinerte Blatt nicht mehr braucht.
    sheet.style.marginBottom = `${-sheet.offsetHeight * (1 - scale)}px`;
  }
}

function bindEvents() {
  for (const input of $$('input[name="layout"]')) {
    input.addEventListener('change', () => {
      if (input.checked) renderLayout(input.value);
    });
  }

  $('[data-print]').addEventListener('click', () => window.print());

  $('[data-download-svg]').addEventListener('click', () => {
    const svg = qrToSvgString(url, { ...QR_OPTIONS, pixelSize: 10, title: 'Foto-Mission' });
    downloadBlob(new Blob([svg], { type: 'image/svg+xml' }), 'foto-mission-qr.svg');
    announce(live, 'QR-Code als SVG gespeichert.');
  });

  $('[data-download-png]').addEventListener('click', async () => {
    try {
      const blob = await qrToPngBlob(url, { ...QR_OPTIONS, pixelSize: 20 });
      downloadBlob(blob, 'foto-mission-qr.png');
      announce(live, 'QR-Code als PNG gespeichert.');
    } catch (error) {
      announce(live, `PNG konnte nicht erzeugt werden: ${error.message}`);
    }
  });

  window.addEventListener('resize', fitToScreen);
  // Vor dem Drucken die Bildschirm-Skalierung entfernen.
  window.addEventListener('beforeprint', () => {
    const sheet = $('[data-sheet]');
    sheet.style.transform = 'none';
    sheet.style.marginBottom = '0';
  });
  window.addEventListener('afterprint', fitToScreen);
}

applyTheme(config.theme);
bindEvents();
renderLayout('a4-poster');
