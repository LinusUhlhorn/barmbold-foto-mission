// =========================================================================
// PRIVATES PARTY-ALBUM
//
// Sicherheit:
//  - Der Bereich ist nur nach einer Anmeldung ueber Supabase Auth nutzbar.
//  - Die Bilder werden ueber kurzlebige, signierte Links geladen. Es gibt
//    keine dauerhaft oeffentliche Adresse.
//  - Der Zugang wird nur in sessionStorage gehalten: schliesst man den Tab,
//    ist man abgemeldet.
//  - Es wird niemals ein Service-Role-Key verwendet.
// =========================================================================

import { PARTY_CONFIG } from '../../config/party-config.js';
import { $, $$, announce, clear, downloadBlob, el, trapFocus } from './lib/dom.js';
import { applyBigNumber, applyTheme } from './lib/theme.js';
import { createIcon } from './lib/icons.js';
import { formatBytes, formatDateTime, truncate } from './lib/text.js';
import { tabStorage } from './lib/storage.js';
import { createSupabaseClient, describeError, isSupabaseConfigured } from './lib/supabase-rest.js';
import { createZip } from './lib/zip.js';

const config = PARTY_CONFIG;
const session = tabStorage();
const SESSION_KEY = 'foto-mission:admin-session';

const live = $('[data-live]');
const supabaseReady = isSupabaseConfigured(config.supabase);
const supabase = supabaseReady ? createSupabaseClient(config.supabase) : null;

const state = {
  rows: [],
  visible: [],
  signedUrls: new Map(),
  selected: new Set(),
  view: 'grid',
  lightboxIndex: -1,
  slideshowTimer: null,
  urlRefreshTimer: null,
  pendingDelete: null,
  releaseTrap: null,
};

// -------------------------------------------------------------------------
// Hilfsfunktionen
// -------------------------------------------------------------------------

function showNotice(node, message, kind = 'error') {
  if (!node) return;
  if (!message) {
    node.hidden = true;
    clear(node);
    return;
  }
  clear(node);
  node.className = `notice notice--${kind}`;
  node.appendChild(createIcon('info', { size: 18, className: 'notice__icon' }));
  node.appendChild(el('span', { text: message }));
  node.hidden = false;
  announce(live, message);
}

function photoFileName(row, index) {
  const time = row.created_at ? new Date(row.created_at) : new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const stamp =
    `${time.getFullYear()}${pad(time.getMonth() + 1)}${pad(time.getDate())}` +
    `-${pad(time.getHours())}${pad(time.getMinutes())}${pad(time.getSeconds())}`;
  const name = String(row.guest_name || 'Gast')
    .replace(/[^\p{L}\p{N} _-]/gu, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 30);
  const ext = row.storage_path && row.storage_path.endsWith('.webp') ? 'webp' : 'jpg';
  const prefix = row.is_test ? 'TEST-' : '';
  return `${prefix}${stamp}-${String(index + 1).padStart(3, '0')}-${name || 'Gast'}.${ext}`;
}

// -------------------------------------------------------------------------
// Anmeldung
// -------------------------------------------------------------------------

function showLogin() {
  $('[data-view="login"]').hidden = false;
  $('[data-view="album"]').hidden = true;
}

function showAlbum() {
  $('[data-view="login"]').hidden = true;
  $('[data-view="album"]').hidden = false;
}

async function restoreSession() {
  const saved = session.get(SESSION_KEY, null);
  if (!saved || !saved.refresh_token) return false;
  try {
    // Immer erneuern: so ist das Zugangstoken garantiert frisch.
    const fresh = await supabase.refreshSession(saved.refresh_token);
    session.set(SESSION_KEY, fresh);
    return true;
  } catch {
    session.remove(SESSION_KEY);
    return false;
  }
}

async function handleLogin(event) {
  event.preventDefault();
  const errorNode = $('[data-login-error]');
  const button = $('[data-login-button]');
  const email = $('#admin-email').value.trim();
  const password = $('#admin-password').value;

  showNotice(errorNode, null);

  if (!supabaseReady) {
    showNotice(
      errorNode,
      'Supabase ist noch nicht eingerichtet. Trag zuerst URL und Anon-Key in config/party-config.js ein.',
    );
    return;
  }
  if (!email || !password) {
    showNotice(errorNode, 'Bitte E-Mail und Passwort eingeben.');
    return;
  }

  button.disabled = true;
  clear(button);
  button.appendChild(el('span', { className: 'spinner' }));
  button.appendChild(el('span', { text: 'Wird angemeldet …' }));

  try {
    const fresh = await supabase.signIn(email, password);
    session.set(SESSION_KEY, fresh);
    // Passwortfeld sofort leeren.
    $('#admin-password').value = '';
    showAlbum();
    await loadPhotos();
  } catch (error) {
    showNotice(errorNode, `Anmeldung fehlgeschlagen: ${describeError(error)}`);
  } finally {
    button.disabled = false;
    clear(button);
    button.textContent = 'Anmelden';
  }
}

async function handleLogout() {
  stopSlideshow();
  try {
    await supabase.signOut();
  } finally {
    session.remove(SESSION_KEY);
    state.rows = [];
    state.visible = [];
    state.signedUrls.clear();
    state.selected.clear();
    showLogin();
    announce(live, 'Du bist abgemeldet.');
  }
}

// -------------------------------------------------------------------------
// Daten laden
// -------------------------------------------------------------------------

async function loadPhotos() {
  const errorNode = $('[data-album-error]');
  showNotice(errorNode, null);
  renderSkeleton();

  try {
    const rows = await supabase.listSubmissions();
    state.rows = Array.isArray(rows) ? rows : [];

    // Kurzlebige Links fuer alle Bilder holen.
    const paths = state.rows.map((row) => row.storage_path).filter(Boolean);
    state.signedUrls = await supabase.createSignedUrls(
      paths,
      config.supabase.signedUrlTtlSeconds,
    );

    buildFilterOptions();
    applyFilters();
    scheduleUrlRefresh();
    announce(live, `${state.rows.length} Fotos geladen.`);
  } catch (error) {
    showNotice(errorNode, `Die Fotos konnten nicht geladen werden: ${describeError(error)}`);
    state.rows = [];
    applyFilters();
  }
}

/**
 * Signierte Links laufen bewusst schnell ab. Damit ein lange geoeffnetes
 * Album nicht ploetzlich leere Bilder zeigt, werden sie rechtzeitig erneuert.
 */
function scheduleUrlRefresh() {
  if (state.urlRefreshTimer) window.clearTimeout(state.urlRefreshTimer);
  const ttl = Math.max(120, Number(config.supabase.signedUrlTtlSeconds) || 600);
  state.urlRefreshTimer = window.setTimeout(
    async () => {
      if (!supabase || !supabase.isSignedIn || state.rows.length === 0) return;
      try {
        // Zugang auffrischen, danach neue Links holen.
        const fresh = await supabase.refreshSession();
        session.set(SESSION_KEY, fresh);
        const paths = state.rows.map((row) => row.storage_path).filter(Boolean);
        state.signedUrls = await supabase.createSignedUrls(paths, ttl);
        render();
        scheduleUrlRefresh();
      } catch {
        // Beim naechsten "Neu laden" versucht es die App erneut.
      }
    },
    (ttl - 60) * 1000,
  );
}

function renderSkeleton() {
  const grid = $('[data-grid]');
  clear(grid);
  for (let i = 0; i < 8; i += 1) {
    const box = el('div', { className: 'photo' });
    const shape = el('div', { className: 'skeleton photo__placeholder' });
    shape.style.aspectRatio = i % 3 === 0 ? '3 / 4' : '4 / 3';
    box.appendChild(shape);
    grid.appendChild(box);
  }
  $('[data-empty]').hidden = true;
}

function buildFilterOptions() {
  const missionSelect = $('[data-filter-mission]');
  const categorySelect = $('[data-filter-category]');
  const missions = new Map();
  const categories = new Set();

  for (const row of state.rows) {
    if (row.mission_id) missions.set(row.mission_id, row.mission_title || row.mission_id);
    if (row.mission_category) categories.add(row.mission_category);
  }

  const keepMission = missionSelect.value;
  const keepCategory = categorySelect.value;

  clear(missionSelect);
  missionSelect.appendChild(el('option', { attrs: { value: '' }, text: 'Alle Missionen' }));
  for (const [id, title] of [...missions.entries()].sort((a, b) => a[1].localeCompare(b[1], 'de'))) {
    missionSelect.appendChild(el('option', { attrs: { value: id }, text: truncate(title, 48) }));
  }
  missionSelect.value = keepMission;

  clear(categorySelect);
  categorySelect.appendChild(el('option', { attrs: { value: '' }, text: 'Alle Kategorien' }));
  for (const category of [...categories].sort((a, b) => a.localeCompare(b, 'de'))) {
    categorySelect.appendChild(el('option', { attrs: { value: category }, text: category }));
  }
  categorySelect.value = keepCategory;
}

// -------------------------------------------------------------------------
// Filtern und sortieren
// -------------------------------------------------------------------------

function applyFilters() {
  const search = $('[data-filter-search]').value.trim().toLocaleLowerCase('de');
  const mission = $('[data-filter-mission]').value;
  const category = $('[data-filter-category]').value;
  const sort = $('[data-filter-sort]').value;
  const onlyTest = $('[data-filter-test]').checked;

  let rows = state.rows.filter((row) => {
    if (mission && row.mission_id !== mission) return false;
    if (category && row.mission_category !== category) return false;
    if (onlyTest && !row.is_test) return false;
    if (search) {
      const name = String(row.guest_name || '').toLocaleLowerCase('de');
      if (!name.includes(search)) return false;
    }
    return true;
  });

  const byTime = (a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0);
  if (sort === 'asc') rows = rows.sort(byTime);
  else if (sort === 'desc') rows = rows.sort((a, b) => byTime(b, a));
  else if (sort === 'name') {
    rows = rows.sort((a, b) =>
      String(a.guest_name || '').localeCompare(String(b.guest_name || ''), 'de'),
    );
  } else if (sort === 'random') {
    rows = shuffle(rows);
  }

  state.visible = rows;
  // Auswahl auf sichtbare Fotos begrenzen.
  const visibleIds = new Set(rows.map((row) => row.id));
  for (const id of [...state.selected]) {
    if (!visibleIds.has(id)) state.selected.delete(id);
  }

  render();
}

function shuffle(list) {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

// -------------------------------------------------------------------------
// Darstellung
// -------------------------------------------------------------------------

function render() {
  const grid = $('[data-grid]');
  const timeline = $('[data-timeline]');
  const sheet = $('[data-sheet]');
  const empty = $('[data-empty]');

  grid.hidden = state.view !== 'grid';
  timeline.hidden = state.view !== 'timeline';
  sheet.hidden = state.view !== 'sheet';

  $('[data-album-meta]').textContent =
    `${state.rows.length} Fotos insgesamt · ${state.visible.length} angezeigt` +
    (config.party.partyDate ? ` · ${config.party.partyDate}` : '');

  if (state.visible.length === 0) {
    clear(grid);
    clear(timeline);
    clear($('[data-sheet-grid]'));
    empty.hidden = false;
    clear(empty);
    empty.appendChild(
      el('p', {
        text:
          state.rows.length === 0
            ? 'Noch keine Fotos im Album. Sobald die ersten Gäste hochladen, erscheinen sie hier.'
            : 'Zu diesen Filtern gibt es keine Fotos.',
      }),
    );
    updateSelectBar();
    return;
  }
  empty.hidden = true;

  if (state.view === 'grid') renderGrid();
  else if (state.view === 'timeline') renderTimeline();
  else renderSheet();

  updateSelectBar();
}

function badgesFor(row) {
  const wrap = el('div', { className: 'photo__badges' });
  wrap.appendChild(el('span', { className: 'tag', text: row.mission_category || '–' }));
  if (row.is_bonus) wrap.appendChild(el('span', { className: 'tag tag--bonus', text: 'Bonus' }));
  if (row.is_test) wrap.appendChild(el('span', { className: 'tag tag--test', text: 'Test' }));
  return wrap;
}

function renderGrid() {
  const grid = $('[data-grid]');
  clear(grid);

  state.visible.forEach((row, index) => {
    const card = el('figure', { className: 'photo' });
    if (state.selected.has(row.id)) card.classList.add('is-selected');

    const checkbox = el('input', {
      className: 'photo__check',
      attrs: { type: 'checkbox', 'aria-label': `Foto von ${row.guest_name} auswählen` },
    });
    checkbox.checked = state.selected.has(row.id);
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) state.selected.add(row.id);
      else state.selected.delete(row.id);
      card.classList.toggle('is-selected', checkbox.checked);
      updateSelectBar();
    });
    // Das Kästchen sitzt in einer großzügigen Tippfläche.
    card.appendChild(el('label', { className: 'photo__select' }, [checkbox]));

    const button = el('button', {
      className: 'photo__button',
      attrs: { type: 'button', 'aria-label': `Foto von ${row.guest_name} groß anzeigen` },
      on: { click: () => openLightbox(index) },
    });

    const url = state.signedUrls.get(row.storage_path);
    if (url) {
      const image = el('img', {
        className: 'photo__image',
        attrs: {
          src: url,
          alt: `${row.mission_title || 'Foto'} – aufgenommen von ${row.guest_name}`,
          loading: 'lazy',
          decoding: 'async',
          width: row.width || undefined,
          height: row.height || undefined,
        },
      });
      button.appendChild(image);
    } else {
      const placeholder = el('div', { className: 'skeleton photo__placeholder' });
      button.appendChild(placeholder);
    }
    card.appendChild(button);

    const info = el('figcaption', { className: 'photo__info' });
    info.appendChild(el('p', { className: 'photo__name', text: row.guest_name || 'Ohne Namen' }));
    info.appendChild(
      el('p', {
        className: 'photo__mission',
        text: `${row.mission_title || '–'} · ${formatDateTime(row.created_at)}`,
      }),
    );
    info.appendChild(badgesFor(row));
    card.appendChild(info);

    grid.appendChild(card);
  });
}

function renderTimeline() {
  const timeline = $('[data-timeline]');
  clear(timeline);

  // Chronologisch, unabhaengig von der gewaehlten Sortierung.
  const rows = [...state.visible].sort(
    (a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0),
  );

  let lastLabel = '';
  rows.forEach((row, index) => {
    const entry = el('article', { className: 'timeline__entry' });
    entry.style.animationDelay = `${Math.min(index * 45, 700)}ms`;
    entry.appendChild(el('span', { className: 'timeline__dot' }));

    const label = formatDateTime(row.created_at);
    if (label !== lastLabel) {
      entry.appendChild(el('p', { className: 'timeline__time', text: label }));
      lastLabel = label;
    }

    const card = el('div', { className: 'timeline__card' });
    const url = state.signedUrls.get(row.storage_path);
    const visibleIndex = state.visible.findIndex((item) => item.id === row.id);
    if (url) {
      const thumbButton = el(
        'button',
        {
          className: 'timeline__thumb',
          attrs: { type: 'button', 'aria-label': `Foto von ${row.guest_name} groß anzeigen` },
          on: { click: () => openLightbox(visibleIndex) },
        },
        [
          el('img', {
            attrs: {
              src: url,
              alt: `Foto von ${row.guest_name}`,
              loading: 'lazy',
              style: 'width:100%;height:100%;object-fit:cover;border-radius:inherit',
            },
          }),
        ],
      );
      card.appendChild(thumbButton);
    }

    const body = el('div', { className: 'timeline__body' });
    body.appendChild(el('p', { className: 'photo__name', text: row.guest_name || 'Ohne Namen' }));
    body.appendChild(el('p', { className: 'photo__mission', text: row.mission_title || '–' }));
    body.appendChild(badgesFor(row));
    card.appendChild(body);

    entry.appendChild(card);
    timeline.appendChild(entry);
  });
}

function renderSheet() {
  const grid = $('[data-sheet-grid]');
  clear(grid);
  $('[data-sheet-title]').textContent =
    `${config.party.birthdayPersonName} · ${config.party.age} Jahre verheiratet`;
  $('[data-sheet-meta]').textContent =
    `${state.visible.length} Fotos${config.party.partyDate ? ` · ${config.party.partyDate}` : ''}`;

  state.visible.forEach((row) => {
    const item = el('figure', { className: 'contactsheet__item' });
    const url = state.signedUrls.get(row.storage_path);
    if (url) {
      item.appendChild(
        el('img', { attrs: { src: url, alt: `Foto von ${row.guest_name}`, loading: 'lazy' } }),
      );
    } else {
      item.appendChild(el('div', { className: 'skeleton', attrs: { style: 'aspect-ratio:1' } }));
    }
    item.appendChild(
      el('figcaption', {
        text: `${row.guest_name || 'Gast'} · ${truncate(row.mission_title || '', 30)}`,
      }),
    );
    grid.appendChild(item);
  });
}

function updateSelectBar() {
  const bar = $('[data-selectbar]');
  const count = state.selected.size;
  bar.hidden = count === 0;
  $('[data-select-count]').textContent =
    count === 1 ? '1 Foto ausgewählt' : `${count} Fotos ausgewählt`;
}

// -------------------------------------------------------------------------
// Vollbild
// -------------------------------------------------------------------------

function openLightbox(index) {
  if (index < 0 || index >= state.visible.length) return;
  state.lightboxIndex = index;
  const box = $('[data-lightbox]');
  box.classList.add('is-open');
  document.body.style.overflow = 'hidden';
  state.releaseTrap = trapFocus(box);
  renderLightbox();
  $('[data-lightbox-close]').focus();
}

function renderLightbox() {
  const row = state.visible[state.lightboxIndex];
  if (!row) return;
  const url = state.signedUrls.get(row.storage_path);
  const image = $('[data-lightbox-image]');
  image.src = url || '';
  image.alt = `${row.mission_title || 'Foto'} – aufgenommen von ${row.guest_name}`;

  $('[data-lightbox-name]').textContent = row.guest_name || 'Ohne Namen';
  const details = [
    row.mission_title,
    row.mission_category,
    formatDateTime(row.created_at),
    row.width && row.height ? `${row.width} × ${row.height}` : null,
    row.file_size ? formatBytes(row.file_size) : null,
    row.is_bonus ? 'Bonus-Mission' : null,
    row.is_test ? 'TESTFOTO' : null,
  ].filter(Boolean);
  $('[data-lightbox-meta]').textContent = details.join(' · ');
  $('[data-lightbox-position]').textContent =
    `${state.lightboxIndex + 1} von ${state.visible.length}`;
}

function closeLightbox() {
  stopSlideshow();
  const box = $('[data-lightbox]');
  box.classList.remove('is-open');
  document.body.style.overflow = '';
  if (state.releaseTrap) {
    state.releaseTrap();
    state.releaseTrap = null;
  }
  state.lightboxIndex = -1;
}

function stepLightbox(delta) {
  if (state.visible.length === 0) return;
  state.lightboxIndex =
    (state.lightboxIndex + delta + state.visible.length) % state.visible.length;
  renderLightbox();
}

function startSlideshow() {
  if (state.visible.length === 0) return;
  stopSlideshow();
  // Zufaellige Reihenfolge fuer die Diashow
  state.visible = shuffle(state.visible);
  openLightbox(0);
  state.slideshowTimer = window.setInterval(() => stepLightbox(1), 4000);
  announce(live, 'Diashow gestartet. Mit Escape beenden.');
}

function stopSlideshow() {
  if (state.slideshowTimer) {
    window.clearInterval(state.slideshowTimer);
    state.slideshowTimer = null;
  }
}

// -------------------------------------------------------------------------
// Herunterladen
// -------------------------------------------------------------------------

async function downloadSingle(row) {
  const url = state.signedUrls.get(row.storage_path);
  if (!url) {
    showNotice($('[data-album-error]'), 'Für dieses Foto gibt es gerade keinen gültigen Link.');
    return;
  }
  try {
    const blob = await supabase.downloadPhoto(url);
    downloadBlob(blob, photoFileName(row, 0));
  } catch (error) {
    showNotice($('[data-album-error]'), `Download fehlgeschlagen: ${describeError(error)}`);
  }
}

async function downloadMany(rows, zipName) {
  if (rows.length === 0) return;
  const errorNode = $('[data-album-error]');
  showNotice(errorNode, `0 von ${rows.length} Fotos geladen …`, 'info');

  const files = [];
  let failed = 0;
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    const url = state.signedUrls.get(row.storage_path);
    if (!url) {
      failed += 1;
      continue;
    }
    try {
      const blob = await supabase.downloadPhoto(url);
      const bytes = new Uint8Array(await blob.arrayBuffer());
      files.push({
        name: photoFileName(row, i),
        data: bytes,
        date: row.created_at ? new Date(row.created_at) : new Date(),
      });
    } catch {
      failed += 1;
    }
    showNotice(errorNode, `${i + 1} von ${rows.length} Fotos geladen …`, 'info');
  }

  if (files.length === 0) {
    showNotice(errorNode, 'Es konnte kein Foto geladen werden.');
    return;
  }

  const zip = createZip(files);
  downloadBlob(zip, zipName);
  showNotice(
    errorNode,
    failed === 0
      ? `${files.length} Fotos als ZIP gespeichert.`
      : `${files.length} Fotos gespeichert, ${failed} konnten nicht geladen werden.`,
    failed === 0 ? 'info' : 'warn',
  );
}

// -------------------------------------------------------------------------
// Loeschen
// -------------------------------------------------------------------------

function askDelete(rows, titleText, bodyText) {
  if (rows.length === 0) return;
  state.pendingDelete = rows;
  $('[data-dialog-title]').textContent = titleText;
  $('[data-dialog-text]').textContent = bodyText;
  showNotice($('[data-dialog-error]'), null);
  const dialog = $('[data-dialog]');
  dialog.classList.add('is-open');
  state.releaseTrap = trapFocus(dialog);
  $('[data-dialog-cancel]').focus();
}

function closeDialog() {
  $('[data-dialog]').classList.remove('is-open');
  state.pendingDelete = null;
  if (state.releaseTrap) {
    state.releaseTrap();
    state.releaseTrap = null;
  }
}

async function confirmDelete() {
  const rows = state.pendingDelete;
  if (!rows || rows.length === 0) return;
  const button = $('[data-dialog-confirm]');
  const errorNode = $('[data-dialog-error]');
  button.disabled = true;
  showNotice(errorNode, null);

  try {
    const paths = rows.map((row) => row.storage_path).filter(Boolean);
    const ids = rows.map((row) => row.id).filter(Boolean);

    // Erst die Datei, dann der Datenbankeintrag. Falls der zweite Schritt
    // scheitert, bleibt der Eintrag sichtbar - das ist besser als eine
    // Karteileiche ohne Bild, die niemand mehr findet.
    await supabase.deletePhotos(paths);
    await supabase.deleteSubmissions(ids);

    for (const id of ids) state.selected.delete(id);
    state.rows = state.rows.filter((row) => !ids.includes(row.id));
    closeDialog();
    closeLightbox();
    applyFilters();
    announce(live, `${rows.length} Foto(s) gelöscht.`);
  } catch (error) {
    showNotice(errorNode, `Löschen fehlgeschlagen: ${describeError(error)}`);
  } finally {
    button.disabled = false;
  }
}

// -------------------------------------------------------------------------
// Ereignisse
// -------------------------------------------------------------------------

function bindEvents() {
  $('[data-login-form]').addEventListener('submit', handleLogin);
  $('[data-logout]').addEventListener('click', handleLogout);
  $('[data-reload]').addEventListener('click', loadPhotos);

  for (const button of $$('[data-view-button]')) {
    button.addEventListener('click', () => {
      state.view = button.dataset.viewButton;
      for (const other of $$('[data-view-button]')) {
        other.setAttribute('aria-selected', String(other === button));
      }
      render();
    });
  }

  for (const selector of [
    '[data-filter-search]',
    '[data-filter-mission]',
    '[data-filter-category]',
    '[data-filter-sort]',
    '[data-filter-test]',
  ]) {
    const node = $(selector);
    node.addEventListener('input', applyFilters);
    node.addEventListener('change', applyFilters);
  }

  $('[data-select-all]').addEventListener('click', () => {
    for (const row of state.visible) state.selected.add(row.id);
    render();
  });
  $('[data-select-none]').addEventListener('click', () => {
    state.selected.clear();
    render();
  });

  $('[data-download-selected]').addEventListener('click', () => {
    const rows = state.visible.filter((row) => state.selected.has(row.id));
    downloadMany(rows, `party-album-auswahl-${rows.length}.zip`);
  });
  $('[data-download-all]').addEventListener('click', () => {
    downloadMany(state.visible, `party-album-${state.visible.length}-fotos.zip`);
  });

  $('[data-delete-selected]').addEventListener('click', () => {
    const rows = state.visible.filter((row) => state.selected.has(row.id));
    askDelete(
      rows,
      `${rows.length} Foto(s) löschen?`,
      'Die ausgewählten Fotos werden aus dem Speicher und aus der Datenbank entfernt.',
    );
  });
  $('[data-delete-tests]').addEventListener('click', () => {
    const rows = state.rows.filter((row) => row.is_test);
    if (rows.length === 0) {
      showNotice($('[data-album-error]'), 'Es gibt keine Testfotos.', 'info');
      return;
    }
    askDelete(
      rows,
      `${rows.length} Testfoto(s) löschen?`,
      'Es werden ausschließlich Fotos entfernt, die eindeutig als Testdaten markiert sind.',
    );
  });

  $('[data-print-sheet]').addEventListener('click', () => {
    state.view = 'sheet';
    for (const other of $$('[data-view-button]')) {
      other.setAttribute('aria-selected', String(other.dataset.viewButton === 'sheet'));
    }
    render();
    window.setTimeout(() => window.print(), 350);
  });

  $('[data-slideshow]').addEventListener('click', startSlideshow);

  // Vollbild
  $('[data-lightbox-close]').addEventListener('click', closeLightbox);
  $('[data-lightbox-prev]').addEventListener('click', () => {
    stopSlideshow();
    stepLightbox(-1);
  });
  $('[data-lightbox-next]').addEventListener('click', () => {
    stopSlideshow();
    stepLightbox(1);
  });
  $('[data-lightbox-download]').addEventListener('click', () => {
    const row = state.visible[state.lightboxIndex];
    if (row) downloadSingle(row);
  });
  $('[data-lightbox-delete]').addEventListener('click', () => {
    const row = state.visible[state.lightboxIndex];
    if (row) {
      askDelete(
        [row],
        'Dieses Foto löschen?',
        `Das Foto von ${row.guest_name || 'diesem Gast'} wird endgültig entfernt.`,
      );
    }
  });

  $('[data-dialog-confirm]').addEventListener('click', confirmDelete);
  $('[data-dialog-cancel]').addEventListener('click', closeDialog);

  document.addEventListener('keydown', (event) => {
    if ($('[data-dialog]').classList.contains('is-open')) {
      if (event.key === 'Escape') closeDialog();
      return;
    }
    if (!$('[data-lightbox]').classList.contains('is-open')) return;
    if (event.key === 'Escape') closeLightbox();
    else if (event.key === 'ArrowLeft') {
      stopSlideshow();
      stepLightbox(-1);
    } else if (event.key === 'ArrowRight') {
      stopSlideshow();
      stepLightbox(1);
    }
  });

  // Symbole in die Knöpfe setzen
  const closeButton = $('[data-lightbox-close]');
  closeButton.appendChild(createIcon('x', { size: 20 }));
  $('[data-lightbox-prev]').appendChild(createIcon('chevronLeft', { size: 22 }));
  $('[data-lightbox-next]').appendChild(createIcon('chevronRight', { size: 22 }));
}

// -------------------------------------------------------------------------
// Start
// -------------------------------------------------------------------------

async function init() {
  applyTheme(config.theme);
  applyBigNumber(config.party.age);
  $('[data-album-title]').textContent =
    `${config.party.birthdayPersonName} · Silberhochzeit`;
  document.title = `Privates Album · ${config.party.birthdayPersonName}`;

  bindEvents();

  if (!supabaseReady) {
    showLogin();
    showNotice(
      $('[data-login-error]'),
      'Supabase ist noch nicht eingerichtet. Trag zuerst URL und Anon-Key in config/party-config.js ein ' +
        'und führe supabase/setup.sql aus.',
      'warn',
    );
    return;
  }

  const restored = await restoreSession();
  if (restored) {
    showAlbum();
    await loadPhotos();
  } else {
    showLogin();
  }
}

init().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  showNotice($('[data-login-error]'), 'Das Album konnte nicht geladen werden.');
});
