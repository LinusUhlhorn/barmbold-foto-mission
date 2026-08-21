// =========================================================================
// PRIVATER BEREICH: "FUER BRITTA & LUTZ"
//
// Gaeste laden hier Fotos und kurze Videos hoch, die NIEMALS oeffentlich
// erscheinen. Sie landen in einem eigenen privaten Speicher und sind
// ausschliesslich im Adminbereich sichtbar.
//
// Ablauf eines Uploads:
//   1. Eingaben und Grenzen pruefen
//   2. Upload-ID erzeugen und Ordnerpfad daraus bauen
//   3. Datensatz fuer den Vorgang anlegen
//   4. Fotos hochladen, danach Videos
//   5. Nach jeder Datei einen Dateidatensatz speichern
//   6. Erst wenn alles gespeichert ist, wird der Vorgang abgeschlossen
//      (die Datenbank zaehlt dabei selbst nach)
// =========================================================================

import { $, announce, clear, el } from './lib/dom.js';
import { createIcon } from './lib/icons.js';
import { formatBytes } from './lib/text.js';
import { describeError } from './lib/supabase-rest.js';
import { uuid } from './lib/device.js';
import {
  addMemoryFiles,
  buildMemoryFilePath,
  buildMemoryFolder,
  counterText,
  limitReachedText,
  summarizeMemoryFiles,
  validateMemoryMessage,
  withMemoryDefaults,
} from './lib/memories.js';

/**
 * Baut den privaten Bereich auf und verdrahtet alles.
 *
 * @param {object} context
 * @param {object} context.config        die komplette Konfiguration
 * @param {object|null} context.supabase der Client (null im Demo-Modus)
 * @param {boolean} context.supabaseReady
 * @param {Element} context.live         Bereich fuer Screenreader-Meldungen
 * @param {object} context.sound
 * @param {Function} context.validateName
 * @param {Function} context.showView    wechselt den Hauptbereich
 * @returns {{reset: Function, focus: Function}}
 */
export function initMemories(context) {
  const { config, supabase, supabaseReady, live, sound, validateName, showView } = context;
  const settings = config.memories || {};
  const limits = withMemoryDefaults(settings.limits || {});
  const texts = settings.texts || {};

  // Laufender Zustand dieses Formulars
  const state = {
    // [{file, kind, previewUrl}]
    files: [],
    uploading: false,
    // Merkt sich, welche Dateien schon oben sind. Bei einem zweiten Versuch
    // wird nichts doppelt hochgeladen.
    uploadId: null,
    folder: null,
    done: new Map(), // Schluessel der Datei -> Speicherpfad
    // Laufende Nummer je Art. Sie zaehlt ueber alle Versuche hinweg weiter,
    // damit ein zweiter Versuch niemals denselben Speicherpfad trifft.
    nextIndex: { photo: 0, video: 0 },
  };

  const form = $('[data-memories-form]');
  const errorNode = $('[data-memory-error]');
  const submitButton = $('[data-memory-submit]');
  const progressBox = $('[data-memory-progress]');
  const successBox = $('[data-memory-success]');

  // -----------------------------------------------------------------------
  // Texte und Grundaufbau
  // -----------------------------------------------------------------------

  function applyMemoryTexts() {
    for (const node of document.querySelectorAll('[data-text-memories]')) {
      const key = node.dataset.textMemories;
      if (texts[key]) node.textContent = texts[key];
    }
    const nameInput = $('[data-memory-name]');
    if (nameInput) {
      nameInput.placeholder = texts.namePlaceholder || '';
      nameInput.maxLength = config.limits.maxNameLength;
    }
    const message = $('[data-memory-message]');
    if (message) {
      message.placeholder = texts.messagePlaceholder || '';
      message.maxLength = limits.maxMessageLength;
    }

    // Erlaubte Formate und Groessen: Das soll VOR der Auswahl klar sein.
    $('[data-memory-formats="photo"]').textContent =
      `Erlaubt: JPG, PNG, WebP und HEIC · bis ${megabytes(limits.maxPhotoBytes)} je Foto`;
    $('[data-memory-formats="video"]').textContent =
      `Erlaubt: MP4, MOV und WebM · bis ${megabytes(limits.maxVideoBytes)} je Video`;

    for (const kind of ['photo', 'video']) {
      const host = $(`[data-memory-icon="${kind}"]`);
      clear(host);
      host.appendChild(createIcon(kind === 'photo' ? 'camera' : 'film', { size: 22 }));
      $(`[data-memory-add="${kind}"]`).textContent =
        kind === 'photo' ? 'Fotos auswählen' : 'Videos auswählen';
    }
    $('[data-memory-group-title="photo"]').textContent = 'Deine Fotos';
    $('[data-memory-group-title="video"]').textContent = 'Deine Videos';
  }

  function megabytes(bytes) {
    return `${Math.round(bytes / (1024 * 1024))} MB`;
  }

  // -----------------------------------------------------------------------
  // Meldungen
  // -----------------------------------------------------------------------

  /**
   * Zeigt eine oder mehrere Meldungen an. Jede Datei, die nicht passt, wird
   * einzeln benannt - niemand soll raten muessen, was schiefging.
   * @param {string[]} messages
   */
  function showMessages(messages) {
    const list = (Array.isArray(messages) ? messages : [messages]).filter(Boolean);
    clear(errorNode);
    if (list.length === 0) {
      errorNode.hidden = true;
      return;
    }
    errorNode.appendChild(createIcon('info', { size: 18, className: 'notice__icon' }));
    const box = el('div');
    for (const message of list) {
      box.appendChild(el('p', { text: message }));
    }
    errorNode.appendChild(box);
    errorNode.hidden = false;
    announce(live, list.join(' '));
    sound.error();
  }

  // -----------------------------------------------------------------------
  // Dateiauswahl
  // -----------------------------------------------------------------------

  /** Erkennt eine Datei wieder (fuer Vorschau-Adressen und Wiederholungen). */
  function keyOf(entry) {
    return `${entry.file.name}|${entry.file.size}|${entry.file.lastModified || 0}`;
  }

  function countOf(kind) {
    return state.files.filter((entry) => entry.kind === kind).length;
  }

  function handleChosen(kind, fileList) {
    const incoming = Array.from(fileList || []);
    if (incoming.length === 0) return;

    const result = addMemoryFiles(state.files, incoming, limits);
    // Nur neu aufgenommene Eintraege bekommen eine Vorschau-Adresse.
    for (const entry of result.files) {
      if (!entry.previewUrl && entry.kind === 'photo') {
        entry.previewUrl = URL.createObjectURL(entry.file);
      }
    }
    state.files = result.files;

    showMessages(result.messages);
    if (result.added > 0) {
      sound.tap();
      announce(
        live,
        result.added === 1 ? 'Eine Datei hinzugefügt.' : `${result.added} Dateien hinzugefügt.`,
      );
    }
    render();
  }

  function removeFile(entry) {
    if (state.uploading || entry.stored) return;
    if (entry.previewUrl) URL.revokeObjectURL(entry.previewUrl);
    state.files = state.files.filter((other) => other !== entry);
    // Der Upload-Stand gilt nicht mehr, sobald sich die Auswahl aendert.
    state.done.delete(keyOf(entry));
    showMessages([]);
    sound.tap();
    announce(live, `„${entry.file.name}“ entfernt.`);
    render();
  }

  // -----------------------------------------------------------------------
  // Anzeige
  // -----------------------------------------------------------------------

  function render() {
    for (const kind of ['photo', 'video']) {
      const count = countOf(kind);
      const max = kind === 'photo' ? limits.maxPhotos : limits.maxVideos;

      // Der Zaehler steht dauerhaft im Auswahlbereich.
      $(`[data-memory-counter="${kind}"]`).textContent = counterText(kind, count, limits);

      // Ist das Limit voll, sagt die Seite das deutlich und sperrt den Knopf.
      const voll = count >= max;
      const fullNode = $(`[data-memory-full="${kind}"]`);
      fullNode.textContent = voll ? limitReachedText(kind, limits) : '';
      fullNode.hidden = !voll;
      const addButton = $(`[data-memory-add="${kind}"]`);
      addButton.disabled = voll || state.uploading;
      $(`[data-memory-box="${kind}"]`).classList.toggle('is-full', voll);

      renderList(kind);
    }

    renderSummary();
    updateSubmit();
  }

  function renderList(kind) {
    const group = $(`[data-memory-group="${kind}"]`);
    const list = $(`[data-memory-list="${kind}"]`);
    const entries = state.files.filter((entry) => entry.kind === kind);
    clear(list);
    group.hidden = entries.length === 0;

    entries.forEach((entry, index) => {
      const item = el('li', { className: 'memory-item' });

      // Vorschau: Bei Fotos das Bild, bei Videos ein Symbol.
      const preview = el('div', { className: 'memory-item__preview' });
      if (kind === 'photo' && entry.previewUrl) {
        preview.appendChild(
          el('img', {
            className: 'memory-item__image',
            attrs: { src: entry.previewUrl, alt: '', loading: 'lazy' },
          }),
        );
      } else {
        preview.classList.add('memory-item__preview--video');
        preview.appendChild(createIcon(kind === 'photo' ? 'camera' : 'film', { size: 22 }));
      }
      item.appendChild(preview);

      const body = el('div', { className: 'memory-item__body' });
      body.appendChild(el('p', { className: 'memory-item__name', text: entry.file.name }));
      body.appendChild(
        el('p', {
          className: 'memory-item__meta',
          text: entry.stored
            ? `${formatBytes(entry.file.size)} · ${typeLabel(entry)} · schon gespeichert`
            : `${formatBytes(entry.file.size)} · ${typeLabel(entry)}`,
        }),
      );
      item.appendChild(body);

      // Was bereits sicher gespeichert ist, laesst sich nicht mehr entfernen.
      if (entry.stored) {
        item.classList.add('memory-item--stored');
        const haken = el('span', { className: 'memory-item__stored', attrs: { title: 'Gespeichert' } });
        haken.appendChild(createIcon('check', { size: 18 }));
        item.appendChild(haken);
        item.dataset.position = String(index + 1);
        list.appendChild(item);
        return;
      }

      const remove = el('button', {
        className: 'btn btn--icon memory-item__remove',
        attrs: {
          type: 'button',
          'aria-label': `„${entry.file.name}“ entfernen`,
          title: 'Entfernen',
        },
        on: { click: () => removeFile(entry) },
      });
      remove.appendChild(createIcon('x', { size: 18 }));
      remove.disabled = state.uploading;
      item.appendChild(remove);

      // Nummer, damit die Reihenfolge im Album nachvollziehbar bleibt.
      item.dataset.position = String(index + 1);
      list.appendChild(item);
    });
  }

  /** Zeigt den Dateityp gut lesbar an ("JPG", "MOV"). */
  function typeLabel(entry) {
    const name = String(entry.file.name || '');
    const dot = name.lastIndexOf('.');
    if (dot > 0) return name.slice(dot + 1).toUpperCase();
    const type = String(entry.file.type || '');
    return type.includes('/') ? type.split('/')[1].toUpperCase() : 'Datei';
  }

  function renderSummary() {
    const box = $('[data-memory-summary]');
    const zusammen = summarizeMemoryFiles(state.files);
    clear(box);
    if (zusammen.count === 0) {
      box.hidden = true;
      return;
    }
    const zeilen = [
      ['Fotos', String(zusammen.photoCount)],
      ['Videos', String(zusammen.videoCount)],
      ['Gesamtgröße', formatBytes(zusammen.totalBytes)],
    ];
    for (const [schluessel, wert] of zeilen) {
      const row = el('div', { className: 'summary__row' });
      row.appendChild(el('span', { className: 'summary__key', text: schluessel }));
      row.appendChild(el('span', { className: 'summary__value', text: wert }));
      box.appendChild(row);
    }
    box.hidden = false;
  }

  /**
   * Der Knopf ist nur dann aktiv, wenn wirklich alles stimmt: Name da,
   * mindestens eine Datei da, kein Upload unterwegs.
   */
  function updateSubmit() {
    const name = $('[data-memory-name]').value;
    const hatNamen = validateName(name, config.limits).valid;
    const hatDateien = state.files.length > 0;
    const bereit = hatNamen && hatDateien && !state.uploading && supabaseReady;
    submitButton.disabled = !bereit;

    const hint = $('[data-memory-submit-hint]');
    if (!supabaseReady) {
      hint.textContent =
        'Der private Speicher ist noch nicht eingerichtet. Bitte sag kurz dem Gastgeber Bescheid.';
    } else if (!hatNamen && !hatDateien) {
      hint.textContent = 'Trag deinen Namen ein und wähle mindestens eine Datei aus.';
    } else if (!hatNamen) {
      hint.textContent = 'Trag noch deinen Namen ein.';
    } else if (!hatDateien) {
      hint.textContent = 'Wähle mindestens ein Foto oder Video aus.';
    } else {
      hint.textContent = '';
    }
  }

  // -----------------------------------------------------------------------
  // Fortschritt
  // -----------------------------------------------------------------------

  function setProgress(anteil, text, dateiText) {
    const prozent = Math.round(Math.max(0, Math.min(1, anteil)) * 100);
    $('[data-memory-progress-bar]').style.width = `${prozent}%`;
    $('[data-memory-progress-track]').setAttribute('aria-valuenow', String(prozent));
    $('[data-memory-progress-percent]').textContent = `${prozent} %`;
    if (text) $('[data-memory-progress-text]').textContent = text;
    if (dateiText !== undefined) $('[data-memory-progress-file]').textContent = dateiText;
  }

  function showPanel(name) {
    form.hidden = name !== 'form';
    progressBox.hidden = name !== 'progress';
    successBox.hidden = name !== 'success';
  }

  // -----------------------------------------------------------------------
  // Hochladen
  // -----------------------------------------------------------------------

  async function startUpload(event) {
    event.preventDefault();
    // Schutz gegen mehrfaches schnelles Tippen.
    if (state.uploading) return;

    const nameInput = $('[data-memory-name]');
    const nameError = $('#memory-name-error');
    const pruefung = validateName(nameInput.value, config.limits);
    if (!pruefung.valid) {
      nameInput.setAttribute('aria-invalid', 'true');
      nameError.textContent = pruefung.error;
      nameInput.focus();
      sound.error();
      return;
    }
    nameInput.removeAttribute('aria-invalid');
    nameError.textContent = '';

    if (state.files.length === 0) {
      showMessages(['Wähle mindestens ein Foto oder Video aus.']);
      return;
    }
    if (!supabaseReady) {
      showMessages([
        'Der private Speicher ist noch nicht eingerichtet, deshalb kann gerade nichts ' +
          'hochgeladen werden. Bitte sag kurz dem Gastgeber Bescheid.',
      ]);
      return;
    }

    const nachricht = validateMemoryMessage($('[data-memory-message]').value, limits);
    if (!nachricht.valid) {
      showMessages([nachricht.error]);
      return;
    }

    state.uploading = true;
    render();
    showMessages([]);
    $('[data-memory-progress-warn]').hidden = true;
    showPanel('progress');

    // Fotos zuerst, danach die Videos - so ist das Wichtigste schnell sicher.
    const fotos = state.files.filter((entry) => entry.kind === 'photo');
    const videos = state.files.filter((entry) => entry.kind === 'video');
    const reihenfolge = [...fotos, ...videos];
    const gesamtBytes = reihenfolge.reduce((summe, entry) => summe + entry.file.size, 0) || 1;

    try {
      // ---- Schritt 1: Vorgang anlegen (nur beim ersten Versuch) --------
      if (!state.uploadId) {
        state.uploadId = uuid();
        state.folder = buildMemoryFolder({
          guestName: pruefung.value,
          uploadId: state.uploadId,
        });
        setProgress(0.02, 'Wird vorbereitet …', '');
        await supabase.insertMemoryUpload({
          id: state.uploadId,
          guest_name: pruefung.value,
          message: nachricht.value === '' ? null : nachricht.value,
          storage_folder: state.folder,
        });
      }

      // ---- Schritt 2: Dateien hochladen --------------------------------
      let fertigeBytes = 0;
      const fehlgeschlagen = [];

      for (let i = 0; i < reihenfolge.length; i += 1) {
        const entry = reihenfolge[i];
        const schluessel = keyOf(entry);

        // Schon erledigt? Dann nicht noch einmal hochladen.
        if (state.done.has(schluessel)) {
          fertigeBytes += entry.file.size;
          continue;
        }

        // Die Nummer wird erst hier vergeben und laeuft immer weiter. So kann
        // ein Wiederholungsversuch nicht auf einen belegten Pfad stossen.
        state.nextIndex[entry.kind] += 1;
        const nummer = state.nextIndex[entry.kind];

        const pfad = buildMemoryFilePath({
          folder: state.folder,
          kind: entry.kind,
          index: nummer,
          originalName: entry.file.name,
        });

        setProgress(
          Math.max(0.02, fertigeBytes / gesamtBytes),
          entry.kind === 'photo' ? 'Fotos werden hochgeladen …' : 'Videos werden hochgeladen …',
          `Datei ${i + 1} von ${reihenfolge.length}: ${entry.file.name}`,
        );

        try {
          await supabase.uploadMemoryFile({
            path: pfad,
            file: entry.file,
            resumableFromBytes: limits.resumableFromBytes,
            onProgress: (anteil) => {
              setProgress((fertigeBytes + entry.file.size * anteil) / gesamtBytes);
            },
          });

          // ---- Schritt 3: Datensatz zur Datei ---------------------------
          await supabase.insertMemoryFile({
            upload_id: state.uploadId,
            storage_path: pfad,
            original_filename: String(entry.file.name || '').slice(0, 255),
            stored_filename: pfad.split('/').pop(),
            mime_type: entry.file.type || (entry.kind === 'photo' ? 'image/jpeg' : 'video/mp4'),
            file_size: entry.file.size,
            media_type: entry.kind,
          });

          state.done.set(schluessel, pfad);
          fertigeBytes += entry.file.size;
          setProgress(fertigeBytes / gesamtBytes);
        } catch (error) {
          // Eine einzelne Datei darf den ganzen Vorgang nicht zerstoeren.
          // eslint-disable-next-line no-console
          console.warn(`Datei konnte nicht hochgeladen werden: ${entry.file.name}`, error);
          fehlgeschlagen.push({ entry, error });
          fertigeBytes += entry.file.size;
        }
      }

      // ---- Schritt 4: Abschluss ----------------------------------------
      // Die Datenbank zaehlt selbst nach. Ein falsches "vollstaendig" kann es
      // damit nicht geben.
      setProgress(0.99, 'Wird abgeschlossen …', '');
      const ergebnis = await supabase.completeMemoryUpload(
        state.uploadId,
        fotos.length,
        videos.length,
      );

      if (fehlgeschlagen.length > 0 || ergebnis.status !== 'complete') {
        zeigeTeilerfolg(fehlgeschlagen, ergebnis);
        return;
      }

      setProgress(1, 'Fertig!', '');
      zeigeErfolg(ergebnis);
    } catch (error) {
      showPanel('form');
      showMessages([
        `${describeError(error)} Deine Auswahl ist noch da – du kannst es gleich noch einmal versuchen.`,
      ]);
    } finally {
      state.uploading = false;
      render();
    }
  }

  /** Alles hat geklappt. */
  function zeigeErfolg(ergebnis) {
    const box = $('[data-memory-success-summary]');
    clear(box);
    const zeilen = [];
    if (ergebnis.photoCount > 0) {
      zeilen.push(
        ergebnis.photoCount === 1
          ? '1 Foto erfolgreich hochgeladen'
          : `${ergebnis.photoCount} Fotos erfolgreich hochgeladen`,
      );
    }
    if (ergebnis.videoCount > 0) {
      zeilen.push(
        ergebnis.videoCount === 1
          ? '1 Video erfolgreich hochgeladen'
          : `${ergebnis.videoCount} Videos erfolgreich hochgeladen`,
      );
    }
    for (const zeile of zeilen) {
      const row = el('div', { className: 'summary__row' });
      row.appendChild(createIcon('check', { size: 18, className: 'summary__icon' }));
      row.appendChild(el('span', { className: 'summary__value', text: zeile }));
      box.appendChild(row);
    }

    sound.success();
    showPanel('success');
    $('[data-memory-success-title]').focus({ preventScroll: true });
    announce(live, `${texts.successTitle} ${zeilen.join('. ')}`);

    // Das Formular wird geleert. Ein Neuladen der Seite kann denselben Upload
    // damit nicht noch einmal absenden.
    resetForm();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /** Deutsche Ein- und Mehrzahl: "1 Foto", "2 Fotos". */
  function anzahl(wert, einzahl, mehrzahl) {
    const zahl = Number(wert) || 0;
    return `${zahl} ${zahl === 1 ? einzahl : mehrzahl}`;
  }

  /** Ein Teil ist angekommen, ein Teil nicht. */
  function zeigeTeilerfolg(fehlgeschlagen, ergebnis) {
    showPanel('form');
    const namen = fehlgeschlagen.map(({ entry }) => `„${entry.file.name}“`);
    const meldungen = [];

    if (namen.length > 0) {
      meldungen.push(
        namen.length === 1
          ? `Diese Datei konnte nicht gespeichert werden: ${namen[0]}.`
          : `Diese Dateien konnten nicht gespeichert werden: ${namen.join(', ')}.`,
      );
    }
    meldungen.push(
      `Bereits gespeichert: ${anzahl(ergebnis.photoCount, 'Foto', 'Fotos')} und ` +
        `${anzahl(ergebnis.videoCount, 'Video', 'Videos')}. ` +
        'Tipp einfach noch einmal auf „Erinnerung hochladen“ – es wird nur nachgereicht, was fehlt.',
    );
    showMessages(meldungen);

    // Die erfolgreichen Dateien bleiben in der Liste, werden aber als
    // gespeichert gekennzeichnet. Sie zaehlen weiter gegen die Obergrenze
    // dieses Vorgangs und koennen nicht mehr entfernt werden.
    for (const entry of state.files) {
      if (state.done.has(keyOf(entry))) entry.stored = true;
    }
    render();
  }

  /** Leert das Formular vollstaendig. */
  function resetForm() {
    for (const entry of state.files) {
      if (entry.previewUrl) URL.revokeObjectURL(entry.previewUrl);
    }
    state.files = [];
    state.done = new Map();
    state.uploadId = null;
    state.folder = null;
    state.nextIndex = { photo: 0, video: 0 };
    $('[data-memory-message]').value = '';
    $('#memory-name-error').textContent = '';
    for (const kind of ['photo', 'video']) {
      $(`[data-memory-input="${kind}"]`).value = '';
    }
    showMessages([]);
    updateMessageCount();
    render();
  }

  function updateMessageCount() {
    const message = $('[data-memory-message]');
    const rest = limits.maxMessageLength - message.value.length;
    $('[data-memory-message-count]').textContent =
      message.value.length === 0 ? '' : `Noch ${rest} Zeichen frei`;
  }

  // -----------------------------------------------------------------------
  // Verdrahtung
  // -----------------------------------------------------------------------

  function bind() {
    for (const kind of ['photo', 'video']) {
      const input = $(`[data-memory-input="${kind}"]`);
      $(`[data-memory-add="${kind}"]`).addEventListener('click', () => {
        sound.tap();
        input.click();
      });
      input.addEventListener('change', (event) => {
        handleChosen(kind, event.target.files);
        // Leeren, damit dieselbe Datei erneut ausgewaehlt werden kann.
        event.target.value = '';
      });
    }

    $('[data-memory-name]').addEventListener('input', () => {
      $('#memory-name-error').textContent = '';
      updateSubmit();
    });
    $('[data-memory-message]').addEventListener('input', updateMessageCount);

    form.addEventListener('submit', startUpload);
    $('[data-memory-again]').addEventListener('click', () => {
      sound.tap();
      showPanel('form');
      $('[data-memory-name]').focus();
    });

    // Der Hinweis am Ende der Foto-Mission fuehrt hierher.
    for (const hook of ['[data-memories-jump]', '[data-memories-jump-2]']) {
      const button = $(hook);
      if (button) {
        button.addEventListener('click', () => {
          sound.tap();
          showView('memories');
        });
      }
    }

    // Beim Verlassen der Seite die Vorschau-Adressen freigeben.
    window.addEventListener('pagehide', () => {
      for (const entry of state.files) {
        if (entry.previewUrl) URL.revokeObjectURL(entry.previewUrl);
      }
    });
  }

  applyMemoryTexts();
  bind();
  showPanel('form');
  render();
  updateMessageCount();

  return {
    reset: resetForm,
    focus() {
      $('#memories-title').focus({ preventScroll: true });
    },
  };
}
