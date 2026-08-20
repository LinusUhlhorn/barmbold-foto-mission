// =========================================================================
// FOTO-MISSION - Ablaufsteuerung
//
// Reihenfolge:
//   Start -> Mission ziehen -> Mission annehmen -> Foto -> Vorschau
//   -> Bestaetigen -> Upload -> Geschafft -> (optional) Bonus-Mission
// =========================================================================

import { PARTY_CONFIG } from '../../config/party-config.js';
import { $, announce, clear, el, isTestMode, prefersReducedMotion, wait } from './lib/dom.js';
import { applyBigNumber, applyEffects, applyTheme } from './lib/theme.js';
import { createIcon } from './lib/icons.js';
import { fillTemplate, formatBytes, validateName } from './lib/text.js';
import { drawMission, renderMission, validateMissions } from './lib/missions.js';
import { browserStorage } from './lib/storage.js';
import { createDeviceState, missionAllowance, uuid } from './lib/device.js';
import { processPhoto, sniffImageType } from './lib/image.js';
import {
  buildStoragePath,
  safeOriginalFilename,
  validateCompressedImage,
  validateImageFile,
} from './lib/validate.js';
import {
  createSupabaseClient,
  describeError,
  isSupabaseConfigured,
} from './lib/supabase-rest.js';
import { savePending, loadPending, clearPending } from './lib/idb.js';
import { createSound, vibrate } from './lib/sound.js';

const config = PARTY_CONFIG;
const storage = browserStorage();
const device = createDeviceState(storage);
const sound = createSound(config.theme.sound, storage);
const testMode = isTestMode(config.test.queryParam);
const reduced = prefersReducedMotion();

const templateValues = {
  name: config.party.birthdayPersonName,
  age: config.party.age,
};

const supabaseReady = isSupabaseConfigured(config.supabase);
const supabase = supabaseReady ? createSupabaseClient(config.supabase) : null;

const PENDING_KEY = 'foto-mission:pending:v1';

// Laufender Zustand dieses Durchgangs
const run = {
  guestName: '',
  mission: null,
  missionKind: 'regular', // 'regular' oder 'bonus'
  redrawsUsed: 0,
  photo: null, // {blob, width, height, mimeType, originalBytes, originalName}
  previewUrl: null,
  uploading: false,
};

const gallery = {
  rows: [],
  urls: new Map(),
  // Foto-ID -> Kategorie: Welche Herzen hat dieses Geraet vergeben?
  votes: new Map(),
  // Foto-ID -> {row, button, countNode}: damit sich einzelne Karten
  // aktualisieren lassen, ohne die ganze Galerie neu aufzubauen.
  cards: new Map(),
  loaded: false,
  loading: false,
  loadedAt: 0,
};

const GALLERY_VOTES_KEY = 'foto-mission:gallery-votes:v2';

const live = $('[data-live]');

// -------------------------------------------------------------------------
// Bildschirme
// -------------------------------------------------------------------------

let firstScreen = true;

function showScreen(name) {
  for (const section of document.querySelectorAll('[data-screen]')) {
    section.classList.toggle('is-active', section.dataset.screen === name);
  }
  const active = document.querySelector(`[data-screen="${name}"]`);
  if (!active) return;

  // Beim allerersten Aufbau NICHT den Fokus verschieben - sonst springt der
  // Screenreader mitten in die Seite, bevor der Gast ueberhaupt etwas getan hat.
  if (!firstScreen) {
    const heading = active.querySelector('h1, h2');
    if (heading) {
      heading.setAttribute('tabindex', '-1');
      heading.focus({ preventScroll: true });
    }
    window.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' });
  }
  firstScreen = false;
}

function setText(selector, value) {
  for (const node of document.querySelectorAll(selector)) {
    node.textContent = value;
  }
}

function showError(node, message) {
  if (!node) return;
  if (!message) {
    node.hidden = true;
    clear(node);
    return;
  }
  clear(node);
  node.appendChild(createIcon('info', { size: 18, className: 'notice__icon' }));
  node.appendChild(el('span', { text: message }));
  node.hidden = false;
  announce(live, message);
}

// -------------------------------------------------------------------------
// Oeffentliche Galerie
// -------------------------------------------------------------------------

/**
 * Vergebene Herzen aus dem Browser-Speicher lesen.
 * Die Datenbank bleibt die verlaessliche Quelle; das hier ist nur die
 * Anzeige, solange die Galerie noch laedt oder gerade nichts erreichbar ist.
 * @returns {Map<string, string>} Foto-ID -> Kategorie
 */
function storedVotes() {
  const value = storage.get(GALLERY_VOTES_KEY, null);
  const votes = new Map();
  if (!value || typeof value !== 'object') return votes;
  for (const [id, category] of Object.entries(value)) {
    if (typeof id === 'string' && id !== '') {
      votes.set(id, typeof category === 'string' ? category : '');
    }
  }
  return votes;
}

function rememberVotes(votes) {
  storage.set(GALLERY_VOTES_KEY, Object.fromEntries([...votes].slice(-300)));
}

function setMainView(view) {
  const isGallery = view === 'gallery';
  const main = $('#hauptbereich');
  const galleryNode = $('[data-public-gallery]');
  main.classList.toggle('is-gallery', isGallery);
  galleryNode.hidden = !isGallery;
  for (const button of document.querySelectorAll('[data-view-tab]')) {
    const active = button.dataset.viewTab === view;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', String(active));
  }
  if (isGallery) {
    // Nur neu laden, wenn die Bildlinks abzulaufen drohen - sonst reicht das,
    // was schon da ist, und die Galerie steht sofort.
    if (galleryIsStale()) loadPublicGallery();
    else renderPublicGallery();
    $('#gallery-title').focus({ preventScroll: true });
  }
  window.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' });
}

function galleryRowsForView() {
  const category = $('[data-public-gallery-category]').value;
  const sort = $('[data-public-gallery-sort]').value;
  // Bewusst auf einer Kopie sortieren: gallery.rows soll seine Reihenfolge
  // behalten, sonst wandern die Karten beim naechsten Aufbau durcheinander.
  const rows = gallery.rows.filter((row) => !category || row.mission_category === category);
  if (sort === 'popular') {
    return rows.sort(
      (a, b) =>
        Number(b.likes_count || 0) - Number(a.likes_count || 0) ||
        new Date(b.created_at || 0) - new Date(a.created_at || 0),
    );
  }
  if (sort === 'oldest') {
    return rows.sort((a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0));
  }
  return rows.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
}

/** Beschriftung des Herz-Knopfes, passend zum aktuellen Zustand. */
function likeLabel(row, liked) {
  const category = row.mission_category || 'dieser Kategorie';
  return liked
    ? `Herz wieder wegnehmen (${category})`
    : `Diesem Foto das Herz für ${category} geben`;
}

/** Aktualisiert einen einzelnen Herz-Knopf, ohne die Galerie neu aufzubauen. */
function refreshLikeButton(id) {
  const card = gallery.cards.get(id);
  if (!card) return;
  const liked = gallery.votes.has(id);
  card.button.classList.toggle('is-liked', liked);
  card.button.setAttribute('aria-pressed', String(liked));
  card.button.setAttribute('aria-label', likeLabel(card.row, liked));
  card.countNode.textContent = String(Number(card.row.likes_count || 0));
}

/**
 * Herz vergeben, wegnehmen oder innerhalb der Kategorie umsetzen.
 * Die Regel "ein Herz je Kategorie" setzt die Datenbank durch.
 */
async function toggleLike(row, button) {
  if (!supabaseReady || button.disabled) return;
  const errorNode = $('[data-public-gallery-error]');
  button.disabled = true;
  try {
    const result = await supabase.togglePhotoVote(row.id, device.deviceId);
    showError(errorNode, null);
    row.likes_count = result.likesCount;
    if (result.liked) {
      gallery.votes.set(row.id, result.category || row.mission_category || '');
    } else {
      gallery.votes.delete(row.id);
    }

    // Ist das Herz aus derselben Kategorie umgezogen, muss die alte Karte mit.
    if (result.movedFrom) {
      gallery.votes.delete(result.movedFrom);
      const previous = gallery.rows.find((entry) => entry.id === result.movedFrom);
      if (previous && result.movedFromLikesCount != null) {
        previous.likes_count = result.movedFromLikesCount;
      }
      refreshLikeButton(result.movedFrom);
    }

    rememberVotes(gallery.votes);
    refreshLikeButton(row.id);
    sound.tap();
    vibrate(8);
    announce(
      live,
      result.liked
        ? result.movedFrom
          ? `Dein Herz für ${result.category} ist zu diesem Foto umgezogen.`
          : 'Herz vergeben.'
        : 'Herz wieder weggenommen.',
    );
  } catch (error) {
    showError(errorNode, describeError(error));
  } finally {
    button.disabled = false;
  }
}

function renderPublicGallery() {
  const grid = $('[data-public-gallery-grid]');
  const empty = $('[data-public-gallery-empty]');
  const rows = galleryRowsForView();
  clear(grid);
  gallery.cards.clear();
  empty.hidden = rows.length !== 0;

  for (const row of rows) {
    const card = el('article', { className: 'public-photo' });
    const url = gallery.urls.get(row.storage_path);

    if (url) {
      const image = el('img', {
        className: 'public-photo__image',
        attrs: {
          src: url,
          alt: `Foto von ${row.guest_name || 'einem Gast'} zur Mission ${row.mission_title || ''}`,
          loading: 'lazy',
        },
      });
      // Laedt das Bild nicht (abgelaufener Link, Funkloch), bleibt keine
      // kaputte Grafik stehen, sondern ein ruhiger Platzhalter.
      image.addEventListener('error', () => {
        image.replaceWith(el('div', { className: 'public-photo__missing', text: 'Bild lädt nicht' }));
      });
      card.appendChild(image);
    } else {
      card.appendChild(el('div', { className: 'public-photo__missing', text: 'Bild lädt nicht' }));
    }

    const body = el('div', { className: 'public-photo__body' });
    body.appendChild(el('p', { className: 'public-photo__name', text: row.guest_name || 'Ohne Namen' }));
    body.appendChild(el('p', { className: 'public-photo__mission', text: row.mission_title || 'Foto-Mission' }));

    const footer = el('div', { className: 'public-photo__footer' });
    footer.appendChild(el('span', { className: 'public-photo__category', text: row.mission_category || 'Erinnerung' }));

    const liked = gallery.votes.has(row.id);
    const like = el('button', {
      className: `btn btn--secondary public-photo__like${liked ? ' is-liked' : ''}`,
      attrs: {
        type: 'button',
        'aria-pressed': String(liked),
        'aria-label': likeLabel(row, liked),
      },
    });
    like.appendChild(createIcon('heart', { size: 18 }));
    const countNode = el('span', { text: String(Number(row.likes_count || 0)) });
    like.appendChild(countNode);
    like.disabled = !supabaseReady;
    like.addEventListener('click', () => toggleLike(row, like));

    gallery.cards.set(row.id, { row, button: like, countNode });
    footer.appendChild(like);
    body.appendChild(footer);
    card.appendChild(body);
    grid.appendChild(card);
  }
}

function buildPublicGalleryCategories() {
  const select = $('[data-public-gallery-category]');
  const current = select.value;
  const categories = new Set(config.missions.concat(config.bonusMissions).map((m) => m.category));
  clear(select);
  select.appendChild(el('option', { attrs: { value: '' }, text: 'Alle Kategorien' }));
  for (const category of [...categories].filter(Boolean).sort((a, b) => a.localeCompare(b, 'de'))) {
    select.appendChild(el('option', { attrs: { value: category }, text: category }));
  }
  select.value = current;
}

/**
 * Sind die signierten Bildlinks noch frisch genug?
 * Sie laufen nach config.supabase.signedUrlTtlSeconds ab; deshalb wird die
 * Galerie schon vor Ablauf neu geladen, statt leere Kacheln zu zeigen.
 */
function galleryIsStale() {
  if (!gallery.loaded) return true;
  const ttl = Number(config.supabase.signedUrlTtlSeconds) || 600;
  return Date.now() - gallery.loadedAt > Math.max(30, ttl * 0.5) * 1000;
}

async function loadPublicGallery() {
  if (gallery.loading || !supabaseReady) {
    if (!supabaseReady) $('[data-public-gallery-empty]').hidden = false;
    return;
  }
  gallery.loading = true;
  const errorNode = $('[data-public-gallery-error]');
  showError(errorNode, null);
  try {
    gallery.rows = await supabase.listPublicSubmissions();

    // Die Bilddateien liegen in einem privaten Speicher. Fuer die Galerie
    // werden daraus kurzlebige Links erzeugt.
    gallery.urls = await supabase.createSignedUrls(
      gallery.rows.map((row) => row.storage_path),
      config.supabase.signedUrlTtlSeconds,
    );

    // Welche Herzen hat dieses Geraet schon vergeben? Die Datenbank weiss es
    // genauer als der Browser-Speicher - schlaegt sie fehl, bleibt der
    // gemerkte Stand stehen.
    try {
      gallery.votes = await supabase.listMyVotes(device.deviceId);
      rememberVotes(gallery.votes);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.warn('Die vergebenen Herzen konnten nicht gelesen werden.', error);
      if (gallery.votes.size === 0) gallery.votes = storedVotes();
    }

    gallery.loaded = true;
    gallery.loadedAt = Date.now();
    renderPublicGallery();

    // Fehlende Bildlinks sind der haeufigste Stolperstein (die Leseregel fuer
    // den Speicher fehlt in Supabase). Frueher blieben die Kacheln einfach
    // leer - jetzt sagt die Seite es deutlich.
    const missing = gallery.rows.filter((row) => !gallery.urls.has(row.storage_path));
    if (missing.length > 0) {
      // eslint-disable-next-line no-console
      console.warn(
        `Für ${missing.length} von ${gallery.rows.length} Fotos gibt es keinen Bildlink. ` +
          'Meist fehlt in Supabase die Speicher-Leseregel "Galerie darf Feierfotos ansehen" – ' +
          'dann hilft es, supabase/setup.sql noch einmal vollständig auszuführen.',
      );
      showError(
        errorNode,
        missing.length === gallery.rows.length
          ? 'Die Bilder lassen sich gerade nicht anzeigen. Bitte lade die Seite neu – ' +
              'wenn es dann immer noch fehlt, sag kurz dem Gastgeber Bescheid.'
          : `${missing.length} von ${gallery.rows.length} Bildern lassen sich gerade nicht anzeigen.`,
      );
    }
  } catch (error) {
    showError(errorNode, describeError(error));
  } finally {
    gallery.loading = false;
  }
}

// -------------------------------------------------------------------------
// Texte aus der Konfiguration einsetzen
// -------------------------------------------------------------------------

function applyTexts() {
  document.title = `${fillTemplate(config.texts.appTitle, templateValues)} · ${config.party.birthdayPersonName}`;

  for (const node of document.querySelectorAll('[data-text]')) {
    const key = node.dataset.text;
    if (config.texts[key]) node.textContent = fillTemplate(config.texts[key], templateValues);
  }
  for (const node of document.querySelectorAll('[data-text-privacy]')) {
    const key = node.dataset.textPrivacy;
    if (config.privacy[key]) node.textContent = fillTemplate(config.privacy[key], templateValues);
  }

  setText('[data-brand-label]', fillTemplate(config.texts.appTitle, templateValues));
  const giftedBy = $('[data-gifted-by]');
  if (giftedBy) {
    giftedBy.textContent = config.party.giftedBy || '';
    giftedBy.hidden = !config.party.giftedBy;
  }

  const nameInput = $('#guest-name');
  if (nameInput) {
    nameInput.placeholder = config.texts.namePlaceholder;
    nameInput.maxLength = config.limits.maxNameLength;
  }
}

// -------------------------------------------------------------------------
// Ton
// -------------------------------------------------------------------------

function refreshSoundButton() {
  const button = $('[data-sound-toggle]');
  if (!button) return;
  clear(button);
  button.appendChild(
    el('span', { className: 'visually-hidden', text: sound.enabled ? 'Ton ausschalten' : 'Ton einschalten' }),
  );
  button.appendChild(createIcon(sound.enabled ? 'volume' : 'volumeOff', { size: 20 }));
  button.setAttribute('aria-pressed', String(sound.enabled));
}

// -------------------------------------------------------------------------
// Effekte
// -------------------------------------------------------------------------

function fireFlash() {
  if (reduced) return;
  const flash = $('[data-flash]');
  if (!flash) return;
  flash.classList.remove('is-firing');
  // Neustart der Animation erzwingen
  void flash.offsetWidth;
  flash.classList.add('is-firing');
  window.setTimeout(() => flash.classList.remove('is-firing'), 420);
}

function fireShutter() {
  vibrate([12, 40, 18]);
  sound.shutter();
  if (reduced) return;
  const shutter = $('[data-shutter]');
  if (!shutter) return;
  shutter.classList.add('is-firing');
  window.setTimeout(() => shutter.classList.remove('is-firing'), 460);
}

function fireConfetti() {
  if (reduced || config.theme.effects.confetti === false) return;
  const container = $('[data-confetti]');
  if (!container) return;
  clear(container);
  const colors = [
    config.theme.colors.gold,
    config.theme.colors.goldSoft,
    config.theme.colors.magenta,
    config.theme.colors.violet,
    '#ffffff',
  ];
  const fragment = document.createDocumentFragment();
  for (let i = 0; i < 44; i += 1) {
    const piece = document.createElement('span');
    piece.style.left = `${Math.random() * 100}%`;
    piece.style.background = colors[i % colors.length];
    piece.style.setProperty('--dx', `${(Math.random() - 0.5) * 220}px`);
    piece.style.setProperty('--spin', `${360 + Math.random() * 720}deg`);
    piece.style.animationDuration = `${2.4 + Math.random() * 1.8}s`;
    piece.style.animationDelay = `${Math.random() * 0.5}s`;
    if (Math.random() > 0.6) piece.style.borderRadius = '50%';
    fragment.appendChild(piece);
  }
  container.appendChild(fragment);
  window.setTimeout(() => clear(container), 5200);
}

// -------------------------------------------------------------------------
// Missionen
// -------------------------------------------------------------------------

/**
 * Aus welchem Topf wird gezogen?
 *  regular / extra -> die regulaeren Missionen
 *  bonus           -> die Bonus-Missionen
 * Freiwillige Extra-Missionen laufen bewusst ueber denselben Topf wie die
 * regulaeren - so bleiben die Aufgaben vertraut, und "schon gezogen" wird
 * weiterhin beruecksichtigt.
 */
function missionPool(kind) {
  return kind === 'bonus' ? config.bonusMissions : config.missions;
}

/** Gibt es ueberhaupt noch eine Bonus-Mission zum Ziehen? */
function hasBonusMissions() {
  return config.bonusMissions.some((mission) => mission.active !== false);
}

function renderMissionCard(mission) {
  const rendered = renderMission(mission, templateValues);

  const iconHost = $('[data-mission-icon]');
  clear(iconHost);
  iconHost.appendChild(createIcon(rendered.icon, { size: 26 }));

  const meta = $('[data-mission-meta]');
  clear(meta);
  meta.appendChild(el('span', { className: 'tag tag--gold', text: rendered.category }));
  if (rendered.difficulty) {
    meta.appendChild(el('span', { className: 'tag', text: rendered.difficulty }));
  }
  if (run.missionKind === 'bonus') {
    meta.appendChild(el('span', { className: 'tag tag--bonus', text: 'Bonus' }));
  }
  if (run.missionKind === 'extra') {
    meta.appendChild(el('span', { className: 'tag tag--bonus', text: 'Freiwillig' }));
  }
  if (testMode) {
    meta.appendChild(el('span', { className: 'tag tag--test', text: 'Test' }));
  }

  setText('[data-mission-title]', rendered.title);
  setText('[data-mission-description]', rendered.description);

  // Tauschknopf nur anbieten, solange ein Tausch uebrig ist.
  const redrawButton = $('[data-redraw-mission]');
  const redrawHint = $('[data-redraw-hint]');
  const allowedRedraws = testMode ? Infinity : config.limits.redrawsPerMission;
  if (run.redrawsUsed >= allowedRedraws) {
    redrawButton.hidden = true;
    redrawHint.hidden = false;
    redrawHint.textContent = fillTemplate(config.texts.redrawUsedHint, templateValues);
  } else {
    redrawButton.hidden = false;
    redrawHint.hidden = true;
  }
}

async function performDraw(kind) {
  run.missionKind = kind;
  run.redrawsUsed = 0;
  showScreen('draw');

  const deck = $('[data-deck]');
  deck.classList.add('is-shuffling');
  sound.shuffle();
  vibrate([8, 60, 8, 60, 12]);

  await wait(1260, reduced);
  deck.classList.remove('is-shuffling');

  const mission = drawMission(missionPool(kind), {
    seenIds: device.seenMissionIds,
    excludeId: null,
  });

  if (!mission) {
    showScreen('capture');
    showError($('[data-capture-error]'), 'Es ist keine Mission verfügbar. Bitte prüfe die Konfiguration.');
    return;
  }

  run.mission = mission;
  device.rememberMission(mission.id);
  renderMissionCard(mission);
  sound.reveal();
  vibrate(24);
  showScreen('mission');
  announce(live, `Deine Mission: ${renderMission(mission, templateValues).title}`);
}

async function performRedraw() {
  const allowed = testMode ? Infinity : config.limits.redrawsPerMission;
  if (run.redrawsUsed >= allowed) return;
  run.redrawsUsed += 1;

  const deck = $('[data-deck]');
  showScreen('draw');
  deck.classList.add('is-shuffling');
  sound.shuffle();
  vibrate([8, 50, 8]);
  await wait(820, reduced);
  deck.classList.remove('is-shuffling');

  const mission = drawMission(missionPool(run.missionKind), {
    seenIds: device.seenMissionIds,
    excludeId: run.mission ? run.mission.id : null,
  });
  if (mission) {
    run.mission = mission;
    device.rememberMission(mission.id);
  }
  renderMissionCard(run.mission);
  sound.reveal();
  showScreen('mission');
}

function acceptMission() {
  const rendered = renderMission(run.mission, templateValues);
  setText('[data-capture-mission-title]', rendered.title);
  setText('[data-capture-mission-description]', rendered.description);
  showError($('[data-capture-error]'), null);
  showScreen('capture');
}

// -------------------------------------------------------------------------
// Foto aufnehmen und verarbeiten
// -------------------------------------------------------------------------

function releasePreviewUrl() {
  if (run.previewUrl) {
    URL.revokeObjectURL(run.previewUrl);
    run.previewUrl = null;
  }
}

async function handleFile(file) {
  const errorNode = $('[data-capture-error]');
  showError(errorNode, null);

  const check = validateImageFile(file, config.limits);
  if (!check.valid) {
    sound.error();
    showError(errorNode, check.error);
    return;
  }

  // Zusaetzlich in die Datei hineinschauen: stimmt der Inhalt mit dem Typ ueberein?
  const sniffed = await sniffImageType(file);
  if (sniffed && !config.limits.allowedMimeTypes.includes(sniffed)) {
    sound.error();
    showError(errorNode, 'Dieses Bildformat wird nicht unterstützt. Bitte nimm das Foto direkt mit der Kamera auf.');
    return;
  }

  const buttons = [$('[data-take-photo]'), $('[data-choose-photo]')];
  for (const button of buttons) button.disabled = true;
  announce(live, 'Das Foto wird vorbereitet …');

  try {
    const processed = await processPhoto(file, {
      maxDimension: config.image.maxDimension,
      quality: config.image.quality,
      preferWebp: config.image.preferWebp,
      maxBytes: config.limits.maxUploadBytes,
    });

    const sizeCheck = validateCompressedImage(processed.blob, config.limits);
    if (!sizeCheck.valid) {
      sound.error();
      showError(errorNode, sizeCheck.error);
      return;
    }

    run.photo = { ...processed, originalName: safeOriginalFilename(file.name) };
    releasePreviewUrl();
    run.previewUrl = URL.createObjectURL(processed.blob);

    // Foto lokal sichern, damit ein versehentliches Neuladen nichts zerstoert.
    await savePending({
      blob: processed.blob,
      meta: {
        guestName: run.guestName,
        missionId: run.mission.id,
        missionKind: run.missionKind,
        width: processed.width,
        height: processed.height,
        mimeType: processed.mimeType,
        originalName: run.photo.originalName,
        savedAt: Date.now(),
      },
    });

    showPreview();
  } catch (error) {
    sound.error();
    showError(
      errorNode,
      `${error.message || 'Das Foto konnte nicht verarbeitet werden.'} Bitte versuch es noch einmal.`,
    );
  } finally {
    for (const button of buttons) button.disabled = false;
  }
}

function showPreview() {
  const image = $('[data-preview-image]');
  image.src = run.previewUrl;

  const facts = $('[data-preview-facts]');
  clear(facts);
  facts.appendChild(el('span', { text: `${run.photo.width} × ${run.photo.height} Pixel` }));
  facts.appendChild(el('span', { text: formatBytes(run.photo.blob.size) }));
  facts.appendChild(
    el('span', { text: run.photo.mimeType === 'image/webp' ? 'WebP' : 'JPEG' }),
  );
  facts.appendChild(el('span', { text: 'ohne EXIF-Daten' }));

  showScreen('preview');
}

function showConfirm() {
  fireShutter();
  setText('[data-confirm-name]', run.guestName);
  setText('[data-confirm-mission]', renderMission(run.mission, templateValues).title);
  setText(
    '[data-confirm-file]',
    `${run.photo.width} × ${run.photo.height} · ${formatBytes(run.photo.blob.size)}`,
  );
  $('[data-confirm-image]').src = run.previewUrl;
  $('[data-consent]').checked = false;
  $('[data-consent-error]').textContent = '';
  showError($('[data-confirm-error]'), null);

  if (!supabaseReady) {
    showError(
      $('[data-confirm-error]'),
      'Hinweis: Der Foto-Speicher ist noch nicht eingerichtet. Du kannst alles ausprobieren, ' +
        'aber es wird noch nichts gespeichert. (Supabase-URL und Anon-Key fehlen in der Konfiguration.)',
    );
  } else if (testMode && !isTestUploadAllowed()) {
    showError(
      $('[data-confirm-error]'),
      'Testmodus: Der Upload ist ausgeschaltet. Setze oben den Haken bei „Test-Upload erlauben“, ' +
        'wenn du wirklich hochladen möchtest.',
    );
  }

  showScreen('confirm');
}

async function cancelMission() {
  releasePreviewUrl();
  run.photo = null;
  await clearPending();
  storage.remove(PENDING_KEY);
  showScreen('capture');
}

// -------------------------------------------------------------------------
// Upload
// -------------------------------------------------------------------------

function isTestUploadAllowed() {
  const toggle = $('[data-test-upload-toggle]');
  if (!testMode) return true;
  if (config.test.allowUploadByDefault) return true;
  return Boolean(toggle && toggle.checked);
}

function setProgress(fraction, label) {
  const percent = Math.round(Math.max(0, Math.min(1, fraction)) * 100);
  const bar = $('[data-progress-bar]');
  const track = $('[data-progress-track]');
  const developing = $('[data-developing]');
  bar.classList.remove('progress__bar--indeterminate');
  bar.style.width = `${percent}%`;
  track.setAttribute('aria-valuenow', String(percent));
  setText('[data-progress-percent]', `${percent} %`);
  if (label) setText('[data-progress-text]', label);
  if (developing) developing.style.setProperty('--progress', String(fraction));
}

function setProgressIndeterminate(label) {
  const bar = $('[data-progress-bar]');
  const track = $('[data-progress-track]');
  bar.classList.add('progress__bar--indeterminate');
  track.removeAttribute('aria-valuenow');
  setText('[data-progress-percent]', '');
  if (label) setText('[data-progress-text]', label);
}

/**
 * Merkt sich den Uploadstand, damit ein zweiter Versuch nichts doppelt anlegt.
 */
function readPendingUpload() {
  const value = storage.get(PENDING_KEY, null);
  if (value && typeof value === 'object' && typeof value.submissionId === 'string') return value;
  return null;
}

function writePendingUpload(value) {
  storage.set(PENDING_KEY, value);
}

async function startUpload() {
  if (run.uploading) return; // schuetzt vor mehrfachem schnellem Tippen
  const consent = $('[data-consent]');
  const consentError = $('[data-consent-error]');
  const errorNode = $('[data-confirm-error]');

  if (!consent.checked) {
    consentError.textContent =
      'Bitte bestätige kurz, dass dein Foto ins private Album darf.';
    consent.focus();
    sound.error();
    announce(live, consentError.textContent);
    return;
  }
  consentError.textContent = '';

  if (!supabaseReady) {
    showError(
      errorNode,
      'Der Foto-Speicher ist noch nicht eingerichtet, deshalb kann gerade nichts hochgeladen werden. ' +
        'Dein Foto bleibt hier gespeichert – bitte melde dich kurz beim Gastgeber.',
    );
    sound.error();
    return;
  }

  if (testMode && !isTestUploadAllowed()) {
    showError(
      errorNode,
      'Testmodus: Der Upload ist bewusst ausgeschaltet. Aktiviere oben „Test-Upload erlauben“.',
    );
    sound.error();
    return;
  }

  run.uploading = true;
  const uploadButton = $('[data-upload-button]');
  uploadButton.disabled = true;
  uploadButton.setAttribute('aria-disabled', 'true');
  showError(errorNode, null);

  // Vorhandenen Uploadstand weiterverwenden (idempotent).
  let pending = readPendingUpload();
  if (!pending || pending.missionId !== run.mission.id) {
    pending = {
      submissionId: uuid(),
      storagePath: null,
      uploaded: false,
      missionId: run.mission.id,
      missionKind: run.missionKind,
    };
    writePendingUpload(pending);
  }

  $('[data-developing-image]').src = run.previewUrl;
  showScreen('uploading');
  setProgress(0.02, 'Wird vorbereitet …');

  const slowHint = $('[data-slow-hint]');
  slowHint.hidden = true;
  const slowTimer = window.setTimeout(() => {
    clear(slowHint);
    slowHint.appendChild(createIcon('info', { size: 18, className: 'notice__icon' }));
    slowHint.appendChild(
      el('span', { text: fillTemplate(config.texts.slowConnectionHint, templateValues) }),
    );
    slowHint.hidden = false;
  }, 9000);

  try {
    // ---- Schritt 1: Bilddatei hochladen -------------------------------
    if (!pending.uploaded) {
      if (!pending.storagePath) {
        pending.storagePath = buildStoragePath({
          uuid: uuid(),
          mimeType: run.photo.mimeType,
          isTest: testMode,
        });
        writePendingUpload(pending);
      }

      try {
        await supabase.uploadPhoto({
          path: pending.storagePath,
          blob: run.photo.blob,
          timeoutMs: 180000,
          onProgress: (fraction) => {
            // Der Upload macht 85 % des Fortschritts aus, der Rest ist der Eintrag.
            setProgress(0.02 + fraction * 0.83, 'Foto wird entwickelt …');
          },
        });
      } catch (error) {
        // 409 bedeutet: die Datei liegt bereits dort - also war ein frueherer
        // Versuch doch erfolgreich. Das ist kein Fehler.
        if (error && error.status === 409) {
          pending.uploaded = true;
        } else {
          // Beim naechsten Versuch einen frischen Pfad verwenden, damit ein
          // halb hochgeladener Rest nicht im Weg steht.
          pending.storagePath = null;
          writePendingUpload(pending);
          throw error;
        }
      }
      pending.uploaded = true;
      writePendingUpload(pending);
    }

    // ---- Schritt 2: Datensatz eintragen -------------------------------
    setProgressIndeterminate('Wird ins Album eingetragen …');

    const rendered = renderMission(run.mission, templateValues);
    const guestName = testMode ? `${config.test.guestNamePrefix}${run.guestName}` : run.guestName;

    const result = await supabase.insertSubmission({
      guest_name: guestName,
      mission_id: run.mission.id,
      mission_title: rendered.title,
      mission_category: run.mission.category,
      storage_path: pending.storagePath,
      original_filename: run.photo.originalName || null,
      mime_type: run.photo.mimeType,
      file_size: run.photo.blob.size,
      width: run.photo.width,
      height: run.photo.height,
      is_bonus: run.missionKind === 'bonus',
      is_test: testMode,
      device_submission_id: pending.submissionId,
    });

    // Erfolg wird erst JETZT angezeigt - Datei und Eintrag sind beide fertig.
    setProgress(1, 'Fertig!');
    await wait(320, reduced);

    device.addCompleted({
      submissionId: pending.submissionId,
      kind: run.missionKind,
      missionId: run.mission.id,
      missionTitle: rendered.title,
      category: run.mission.category,
      storagePath: pending.storagePath,
    });
    storage.remove(PENDING_KEY);
    await clearPending();

    // Die Galerie hat jetzt ein Foto mehr - beim naechsten Öffnen neu laden.
    gallery.loaded = false;

    showSuccess(result.duplicate);
  } catch (error) {
    window.clearTimeout(slowTimer);
    sound.error();
    showScreen('confirm');
    showError(
      errorNode,
      `${describeError(error)} Dein Foto ist noch da – du kannst es gleich noch einmal versuchen.`,
    );
  } finally {
    window.clearTimeout(slowTimer);
    run.uploading = false;
    uploadButton.disabled = false;
    uploadButton.removeAttribute('aria-disabled');
  }
}

function showSuccess(wasDuplicate) {
  fireFlash();
  sound.success();
  vibrate([18, 50, 26]);

  const rendered = renderMission(run.mission, templateValues);
  $('[data-success-image]').src = run.previewUrl;
  setText('[data-success-caption]', `${run.guestName} · ${rendered.category}`);
  setText('[data-success-mission]', rendered.title);

  const allowance = missionAllowance(device, config.limits, testMode);
  const nextMissionButton = $('[data-next-mission]');
  const bonusButton = $('[data-bonus-button]');
  const extraButton = $('[data-extra-mission]');
  const doneButton = $('[data-done-button]');
  nextMissionButton.hidden = !allowance.canRegular;
  bonusButton.hidden = !(allowance.canBonus && hasBonusMissions());
  // Pflicht- und Bonus-Mission erledigt? Dann geht es freiwillig weiter.
  extraButton.hidden = allowance.canRegular || allowance.canBonus || !allowance.canExtra;
  doneButton.hidden = allowance.canRegular || allowance.canBonus;

  showScreen('success');
  fireConfetti();
  announce(
    live,
    wasDuplicate
      ? 'Dieses Foto war bereits gespeichert. Alles in Ordnung.'
      : fillTemplate(config.texts.successText, templateValues),
  );
}

function showFinished() {
  const allowance = missionAllowance(device, config.limits, testMode);
  const completed = device.completed;
  const hasCompleted = completed.length > 0;

  setText(
    '[data-finished-title]',
    fillTemplate(hasCompleted ? config.texts.alreadyDoneTitle : config.texts.finishedTitle, templateValues),
  );
  setText(
    '[data-finished-text]',
    fillTemplate(hasCompleted ? config.texts.alreadyDoneText : config.texts.finishedText, templateValues),
  );

  const summary = $('[data-finished-summary]');
  clear(summary);
  if (hasCompleted) {
    for (const entry of completed) {
      const row = el('div', { className: 'summary__row' });
      const kindLabel =
        entry.kind === 'bonus' ? 'Bonus' : entry.kind === 'extra' ? 'Freiwillig' : 'Mission';
      row.appendChild(el('span', { className: 'summary__key', text: kindLabel }));
      row.appendChild(el('span', { className: 'summary__value', text: entry.missionTitle || '–' }));
      summary.appendChild(row);
    }
    summary.hidden = false;
  } else {
    summary.hidden = true;
  }

  const bonusButton = $('[data-finished-bonus]');
  bonusButton.hidden = !(allowance.canBonus && hasBonusMissions());
  // Wer schon alles erledigt hat, darf trotzdem weitermachen.
  $('[data-finished-extra]').hidden =
    allowance.canRegular || allowance.canBonus || !allowance.canExtra;

  showScreen('finished');
}

// -------------------------------------------------------------------------
// Wiederherstellung nach einem Neuladen
// -------------------------------------------------------------------------

async function restorePendingPhoto() {
  const saved = await loadPending();
  if (!saved || !saved.meta) return false;

  // Nur wiederherstellen, wenn die Mission noch existiert.
  const pool = [...config.missions, ...config.bonusMissions];
  const mission = pool.find((m) => m.id === saved.meta.missionId);
  if (!mission) {
    await clearPending();
    return false;
  }
  // Sehr alte Reste (aelter als 12 Stunden) verwerfen.
  if (saved.meta.savedAt && Date.now() - saved.meta.savedAt > 12 * 60 * 60 * 1000) {
    await clearPending();
    return false;
  }

  run.guestName = saved.meta.guestName || device.guestName || '';
  run.mission = mission;
  run.missionKind = saved.meta.missionKind === 'bonus' ? 'bonus' : 'regular';
  run.photo = {
    blob: saved.blob,
    width: saved.meta.width,
    height: saved.meta.height,
    mimeType: saved.meta.mimeType,
    originalBytes: 0,
    originalName: saved.meta.originalName || '',
  };
  releasePreviewUrl();
  run.previewUrl = URL.createObjectURL(saved.blob);

  const rendered = renderMission(mission, templateValues);
  setText('[data-capture-mission-title]', rendered.title);
  setText('[data-capture-mission-description]', rendered.description);
  showPreview();
  announce(live, 'Dein Foto von eben ist noch da.');
  return true;
}

// -------------------------------------------------------------------------
// Testmodus
// -------------------------------------------------------------------------

function setupTestMode() {
  const banner = $('[data-test-banner]');
  if (!testMode) {
    banner.remove();
    return;
  }
  banner.hidden = false;
  setText('[data-test-banner-text]', config.test.bannerText);
  $('[data-test-upload-toggle]').checked = Boolean(config.test.allowUploadByDefault);
  $('[data-test-reset]').addEventListener('click', async () => {
    device.reset();
    storage.remove(PENDING_KEY);
    await clearPending();
    window.location.reload();
  });

  // Konfigurationsfehler im Testmodus sichtbar machen.
  const problems = [
    ...validateMissions(config.missions),
    ...validateMissions(config.bonusMissions),
  ];
  if (problems.length > 0) {
    // eslint-disable-next-line no-console
    console.warn('Probleme in der Missions-Konfiguration:\n' + problems.join('\n'));
    announce(live, `${problems.length} Hinweis(e) zur Missions-Konfiguration – siehe Browser-Konsole.`);
  }
}

// -------------------------------------------------------------------------
// Start
// -------------------------------------------------------------------------

function bindEvents() {
  // Ton beim ersten echten Tippen freischalten (Browser-Vorgabe).
  const unlockOnce = () => {
    sound.unlock();
    document.removeEventListener('pointerdown', unlockOnce);
  };
  document.addEventListener('pointerdown', unlockOnce, { once: true });

  for (const button of document.querySelectorAll('[data-view-tab]')) {
    button.addEventListener('click', () => setMainView(button.dataset.viewTab));
  }
  $('[data-public-gallery-category]').addEventListener('change', renderPublicGallery);
  $('[data-public-gallery-sort]').addEventListener('change', renderPublicGallery);

  const privacyDialog = $('[data-privacy-dialog]');
  $('[data-privacy-open]').addEventListener('click', () => privacyDialog.showModal());
  $('[data-privacy-close]').addEventListener('click', () => privacyDialog.close());
  privacyDialog.addEventListener('click', (event) => {
    if (event.target === privacyDialog) privacyDialog.close();
  });

  $('[data-sound-toggle]').addEventListener('click', () => {
    sound.toggle();
    refreshSoundButton();
    if (sound.enabled) sound.tap();
  });

  // ---- Startformular ----
  $('[data-start-form]').addEventListener('submit', async (event) => {
    event.preventDefault();
    const input = $('#guest-name');
    const errorNode = $('#guest-name-error');
    const check = validateName(input.value, config.limits);
    if (!check.valid) {
      input.setAttribute('aria-invalid', 'true');
      errorNode.textContent = check.error;
      input.focus();
      sound.error();
      return;
    }
    input.removeAttribute('aria-invalid');
    errorNode.textContent = '';
    run.guestName = check.value;
    device.setGuestName(check.value);
    sound.tap();

    const allowance = missionAllowance(device, config.limits, testMode);
    await performDraw(allowance.canRegular ? 'regular' : 'bonus');
  });

  // ---- Mission ----
  $('[data-accept-mission]').addEventListener('click', () => {
    sound.tap();
    vibrate(10);
    acceptMission();
  });
  $('[data-redraw-mission]').addEventListener('click', () => {
    sound.tap();
    performRedraw();
  });

  // ---- Foto ----
  const cameraInput = $('[data-file-camera]');
  const galleryInput = $('[data-file-gallery]');

  $('[data-take-photo]').addEventListener('click', () => {
    sound.tap();
    cameraInput.click();
  });
  $('[data-choose-photo]').addEventListener('click', () => {
    sound.tap();
    galleryInput.click();
  });

  const onFileChosen = (event) => {
    const file = event.target.files && event.target.files[0];
    // Feld leeren, damit dieselbe Datei erneut ausgewaehlt werden kann.
    event.target.value = '';
    if (file) handleFile(file);
  };
  cameraInput.addEventListener('change', onFileChosen);
  galleryInput.addEventListener('change', onFileChosen);

  $('[data-cancel-mission]').addEventListener('click', () => {
    sound.tap();
    showFinished();
  });
  $('[data-cancel-mission-2]').addEventListener('click', () => {
    sound.tap();
    cancelMission();
  });

  // ---- Vorschau ----
  $('[data-use-photo]').addEventListener('click', () => {
    sound.tap();
    showConfirm();
  });
  $('[data-retake-photo]').addEventListener('click', async () => {
    sound.tap();
    releasePreviewUrl();
    run.photo = null;
    await clearPending();
    showScreen('capture');
  });

  // ---- Bestaetigen ----
  $('[data-upload-button]').addEventListener('click', startUpload);
  $('[data-back-to-preview]').addEventListener('click', () => {
    sound.tap();
    showPreview();
  });
  $('[data-consent]').addEventListener('change', () => {
    $('[data-consent-error]').textContent = '';
  });

  // ---- Abschluss ----
  $('[data-next-mission]').addEventListener('click', async () => {
    sound.tap();
    releasePreviewUrl();
    run.photo = null;
    await performDraw('regular');
  });
  $('[data-bonus-button]').addEventListener('click', async () => {
    sound.tap();
    releasePreviewUrl();
    run.photo = null;
    await performDraw('bonus');
  });
  $('[data-done-button]').addEventListener('click', () => {
    sound.tap();
    showFinished();
  });
  $('[data-finished-bonus]').addEventListener('click', async () => {
    sound.tap();
    releasePreviewUrl();
    run.photo = null;
    await performDraw('bonus');
  });

  // ---- Freiwillig weitermachen oder in die Galerie ----
  const drawExtra = async () => {
    sound.tap();
    releasePreviewUrl();
    run.photo = null;
    await performDraw('extra');
  };
  $('[data-extra-mission]').addEventListener('click', drawExtra);
  $('[data-finished-extra]').addEventListener('click', drawExtra);

  const openGallery = () => {
    sound.tap();
    setMainView('gallery');
  };
  $('[data-success-gallery]').addEventListener('click', openGallery);
  $('[data-finished-gallery]').addEventListener('click', openGallery);

  // Beim Verlassen aufraeumen
  window.addEventListener('pagehide', releasePreviewUrl);
}

async function init() {
  applyTheme(config.theme);
  applyEffects(config.theme.effects);
  applyBigNumber(config.party.age);
  applyTexts();
  refreshSoundButton();
  // Gemerkte Herzen als erste Anzeige; die Datenbank korrigiert sie beim Laden.
  gallery.votes = storedVotes();
  buildPublicGalleryCategories();
  setupTestMode();
  bindEvents();

  // Startanimation ausblenden
  const boot = $('[data-boot]');
  if (boot) {
    window.setTimeout(() => boot.classList.add('is-done'), reduced ? 500 : 2300);
  }

  // Namen von vorhin wieder eintragen
  const nameInput = $('#guest-name');
  if (nameInput && device.guestName) {
    nameInput.value = device.guestName;
    run.guestName = device.guestName;
  }

  // 1. Gibt es ein noch nicht hochgeladenes Foto?
  const restored = await restorePendingPhoto();
  if (restored) return;

  // 2. Ist die regulaere Mission schon erledigt?
  const allowance = missionAllowance(device, config.limits, testMode);
  if (!allowance.canRegular && !testMode) {
    showFinished();
    return;
  }

  showScreen('start');
}

init().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  announce(live, 'Beim Start ist ein Fehler aufgetreten. Bitte lade die Seite neu.');
});
