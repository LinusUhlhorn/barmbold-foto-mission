// =========================================================================
// ADMINBEREICH: PRIVATE ERINNERUNGEN
//
// Zeigt jeden privaten Upload-Vorgang als eigenen Ordner an. Nur angemeldete
// Album-Admins kommen ueberhaupt an diese Daten - dafuer sorgen die Regeln in
// supabase/private-memories.sql. Die Dateien werden ausschliesslich ueber
// kurzlebige, signierte Links geladen.
// =========================================================================

import { $, announce, clear, downloadBlob, el, trapFocus } from './lib/dom.js';
import { createIcon } from './lib/icons.js';
import { formatBytes } from './lib/text.js';
import { describeError } from './lib/supabase-rest.js';
import { createZip } from './lib/zip.js';
import {
  berlinParts,
  exportFolderName,
  memoryMessageFile,
  memoryOverviewCsv,
} from './lib/memories.js';

// Ab dieser Gesamtgroesse wird das Zusammenpacken im Browser unzuverlaessig
// (alles muss gleichzeitig in den Arbeitsspeicher). Dann hilft das Skript
// tools/export-memories.js.
const ZIP_WARNUNG_AB_BYTES = 800 * 1024 * 1024;

/**
 * Baut den Adminbereich fuer die privaten Erinnerungen auf.
 *
 * @param {object} context
 * @param {object} context.config
 * @param {object} context.supabase
 * @param {Element} context.live
 * @param {Function} context.showNotice   Meldungen anzeigen (aus album.js)
 * @param {Function} context.askDelete    Sicherheitsabfrage (aus album.js)
 */
export function initAlbumMemories({ config, supabase, live, showNotice, askDelete }) {
  const state = {
    uploads: [],
    files: [],
    urls: new Map(),
    // Welche Ordner sind gerade aufgeklappt?
    open: new Set(),
    loading: false,
    loadedAt: 0,
    releaseTrap: null,
  };

  const errorNode = $('[data-memories-admin-error]');
  const listNode = $('[data-memories-admin-list]');
  const emptyNode = $('[data-memories-admin-empty]');

  // -----------------------------------------------------------------------
  // Laden
  // -----------------------------------------------------------------------

  async function load() {
    if (state.loading) return;
    state.loading = true;
    showNotice(errorNode, null);
    try {
      const [uploads, files] = await Promise.all([
        supabase.listMemoryUploads(),
        supabase.listMemoryFiles(),
      ]);
      state.uploads = Array.isArray(uploads) ? uploads : [];
      state.files = Array.isArray(files) ? files : [];
      await refreshUrls();
      state.loadedAt = Date.now();
      render();
    } catch (error) {
      showNotice(errorNode, `Die privaten Erinnerungen konnten nicht geladen werden: ${describeError(error)}`);
    } finally {
      state.loading = false;
    }
  }

  /** Erzeugt fuer alle Dateien frische, kurzlebige Links. */
  async function refreshUrls() {
    const paths = state.files.map((file) => file.storage_path).filter(Boolean);
    if (paths.length === 0) {
      state.urls = new Map();
      return;
    }
    state.urls = await supabase.createMemorySignedUrls(
      paths,
      config.supabase.signedUrlTtlSeconds,
    );
  }

  function filesOf(uploadId) {
    return state.files.filter((file) => file.upload_id === uploadId);
  }

  /**
   * Zaehlt anhand der wirklich vorhandenen Dateien. Die Zahlen im Vorgang
   * werden erst beim Abschluss gesetzt - bei einem abgebrochenen Upload
   * staenden dort sonst Nullen, obwohl Dateien angekommen sind.
   */
  function bestand(upload) {
    const dateien = filesOf(upload.id);
    if (dateien.length === 0) {
      return {
        photos: Number(upload.photo_count) || 0,
        videos: Number(upload.video_count) || 0,
        bytes: Number(upload.total_size) || 0,
      };
    }
    return {
      photos: dateien.filter((file) => file.media_type === 'photo').length,
      videos: dateien.filter((file) => file.media_type === 'video').length,
      bytes: dateien.reduce((summe, file) => summe + (Number(file.file_size) || 0), 0),
    };
  }

  // -----------------------------------------------------------------------
  // Anzeige
  // -----------------------------------------------------------------------

  function render() {
    clear(listNode);

    const gesamtDateien = state.files.length;
    const gesamtBytes = state.uploads.reduce((summe, upload) => summe + bestand(upload).bytes, 0);
    const unvollstaendig = state.uploads.filter((upload) => upload.status !== 'complete').length;

    $('[data-memories-admin-meta]').textContent =
      `${anzahl(state.uploads.length, 'Upload', 'Uploads')} · ` +
      `${anzahl(gesamtDateien, 'Datei', 'Dateien')} · ${formatBytes(gesamtBytes)}` +
      (unvollstaendig > 0 ? ` · ${unvollstaendig} unvollständig` : '');

    emptyNode.hidden = state.uploads.length > 0;
    if (state.uploads.length === 0) return;

    for (const upload of state.uploads) {
      listNode.appendChild(renderUpload(upload));
    }
  }

  function renderUpload(upload) {
    const dateien = filesOf(upload.id);
    const { date, time } = berlinParts(upload.created_at);
    const [jahr, monat, tag] = date.split('-');
    const uhrzeit = time.replace(/-/g, ':').slice(0, 5);
    const offen = state.open.has(upload.id);

    const card = el('article', { className: 'memory-upload' });
    if (upload.status !== 'complete') card.classList.add('memory-upload--incomplete');

    // ---- Kopfzeile: auf einen Blick alles Wichtige ----
    const head = el('button', {
      className: 'memory-upload__head',
      attrs: { type: 'button', 'aria-expanded': String(offen) },
      on: {
        click: () => {
          if (state.open.has(upload.id)) state.open.delete(upload.id);
          else state.open.add(upload.id);
          render();
        },
      },
    });

    const headText = el('div', { className: 'memory-upload__headtext' });
    headText.appendChild(
      el('p', {
        className: 'memory-upload__name',
        text: `${upload.guest_name || 'Ohne Namen'} – ${tag}.${monat}.${jahr} um ${uhrzeit} Uhr`,
      }),
    );
    const zaehlung = bestand(upload);
    const zahlen = [
      anzahl(zaehlung.photos, 'Foto', 'Fotos'),
      anzahl(zaehlung.videos, 'Video', 'Videos'),
      formatBytes(zaehlung.bytes),
      `Status: ${statusText(upload.status)}`,
    ];
    headText.appendChild(el('p', { className: 'memory-upload__meta', text: zahlen.join(' · ') }));
    head.appendChild(headText);
    head.appendChild(createIcon(offen ? 'chevronLeft' : 'chevronRight', { size: 20 }));
    card.appendChild(head);

    if (!offen) return card;

    // ---- Aufgeklappt ----
    const body = el('div', { className: 'memory-upload__body' });

    if (upload.message) {
      const nachricht = el('blockquote', { className: 'memory-upload__message' });
      nachricht.appendChild(el('p', { text: upload.message }));
      body.appendChild(nachricht);
    }

    body.appendChild(
      el('p', { className: 'memory-upload__folder', text: upload.storage_folder || '' }),
    );

    if (upload.status !== 'complete') {
      const hinweis = el('div', { className: 'notice notice--warn' });
      hinweis.appendChild(createIcon('info', { size: 18, className: 'notice__icon' }));
      hinweis.appendChild(
        el('span', {
          text:
            'Dieser Upload ist unvollständig. Vermutlich hat der Gast die Seite zu früh ' +
            'geschlossen. Die bereits gespeicherten Dateien sind unten zu sehen.',
        }),
      );
      body.appendChild(hinweis);
    }

    for (const kind of ['photo', 'video']) {
      const teil = dateien.filter((file) => file.media_type === kind);
      if (teil.length === 0) continue;
      body.appendChild(
        el('h3', {
          className: 'memory-upload__grouptitle',
          text:
            kind === 'photo'
              ? anzahl(teil.length, 'Foto', 'Fotos')
              : anzahl(teil.length, 'Video', 'Videos'),
        }),
      );
      const grid = el('div', { className: 'memory-files' });
      for (const file of teil) grid.appendChild(renderFile(upload, file));
      body.appendChild(grid);
    }

    if (dateien.length === 0) {
      body.appendChild(
        el('p', { className: 'hint', text: 'Zu diesem Upload ist keine einzige Datei angekommen.' }),
      );
    }

    // ---- Aktionen fuer den ganzen Ordner ----
    const actions = el('div', { className: 'btn-row btn-row--inline memory-upload__actions' });
    actions.appendChild(
      el('button', {
        className: 'btn btn--small btn--secondary',
        attrs: { type: 'button' },
        text: 'Ordner als ZIP',
        on: { click: () => downloadUpload(upload) },
      }),
    );
    actions.appendChild(
      el('button', {
        className: 'btn btn--small btn--danger',
        attrs: { type: 'button' },
        text: 'Upload löschen',
        on: {
          click: () =>
            askDelete(
              { art: 'memory-upload', upload },
              `Upload von ${upload.guest_name} löschen?`,
              `${anzahl(dateien.length, 'Datei', 'Dateien')} dieses Ordners werden aus dem ` +
                'Speicher und aus der Datenbank entfernt.',
            ),
        },
      }),
    );
    body.appendChild(actions);
    card.appendChild(body);
    return card;
  }

  /** "1 Foto" statt "1 Fotos". */
function anzahl(zahl, einzahl, mehrzahl) {
  const n = Number(zahl) || 0;
  return `${n} ${n === 1 ? einzahl : mehrzahl}`;
}

function statusText(status) {
    if (status === 'complete') return 'vollständig';
    if (status === 'pending') return 'noch offen';
    return 'unvollständig';
  }

  function renderFile(upload, file) {
    const url = state.urls.get(file.storage_path);
    const item = el('div', { className: 'memory-file' });

    const preview = el('div', { className: 'memory-file__preview' });
    if (!url) {
      preview.appendChild(el('span', { className: 'hint', text: 'Kein Link' }));
    } else if (file.media_type === 'photo') {
      const image = el('img', {
        className: 'memory-file__image',
        attrs: { src: url, alt: file.original_filename || 'Privates Foto', loading: 'lazy' },
      });
      // HEIC zeigt nicht jeder Browser an - dann bleibt ein Hinweis stehen.
      image.addEventListener('error', () => {
        image.replaceWith(
          el('span', {
            className: 'hint',
            text: 'Vorschau nicht möglich (HEIC) – bitte herunterladen.',
          }),
        );
      });
      // Das Bild sitzt in einem Knopf: So laesst es sich auch mit der
      // Tastatur gross ansehen.
      const opener = el('button', {
        className: 'memory-file__open',
        attrs: {
          type: 'button',
          'aria-label': `„${file.original_filename || file.stored_filename}“ groß ansehen`,
        },
        on: { click: () => openViewer(upload, file) },
      });
      opener.appendChild(image);
      preview.appendChild(opener);
      preview.classList.add('is-clickable');
    } else {
      const video = el('video', {
        className: 'memory-file__video',
        attrs: { src: url, controls: true, preload: 'metadata', playsinline: true },
      });
      preview.appendChild(video);
    }
    item.appendChild(preview);

    const body = el('div', { className: 'memory-file__body' });
    body.appendChild(
      el('p', {
        className: 'memory-file__name',
        text: file.original_filename || file.stored_filename,
      }),
    );
    body.appendChild(
      el('p', {
        className: 'memory-file__meta',
        text: `${file.stored_filename} · ${formatBytes(file.file_size)}`,
      }),
    );
    item.appendChild(body);

    const tools = el('div', { className: 'memory-file__tools' });
    tools.appendChild(
      el('button', {
        className: 'btn btn--small btn--secondary',
        attrs: { type: 'button' },
        text: 'Herunterladen',
        on: { click: () => downloadFile(upload, file) },
      }),
    );
    tools.appendChild(
      el('button', {
        className: 'btn btn--small btn--danger',
        attrs: { type: 'button' },
        text: 'Löschen',
        on: {
          click: () =>
            askDelete(
              { art: 'memory-file', upload, file },
              'Diese Datei löschen?',
              `„${file.original_filename || file.stored_filename}“ wird aus dem Speicher und aus ` +
                'der Datenbank entfernt.',
            ),
        },
      }),
    );
    item.appendChild(tools);
    return item;
  }

  // -----------------------------------------------------------------------
  // Vollbild
  // -----------------------------------------------------------------------

  function openViewer(upload, file) {
    const url = state.urls.get(file.storage_path);
    if (!url) return;
    const box = $('[data-memory-viewer]');
    const stage = $('[data-memory-viewer-stage]');
    clear(stage);
    stage.appendChild(
      el('img', {
        className: 'lightbox__image',
        attrs: { src: url, alt: file.original_filename || 'Privates Foto' },
      }),
    );
    $('[data-memory-viewer-title]').textContent = 'Privat – nur für Britta und Lutz';
    $('[data-memory-viewer-name]').textContent = upload.guest_name || 'Ohne Namen';
    $('[data-memory-viewer-meta]').textContent = [
      file.original_filename,
      formatBytes(file.file_size),
      file.mime_type,
    ]
      .filter(Boolean)
      .join(' · ');

    box.classList.add('is-open');
    document.body.style.overflow = 'hidden';
    state.releaseTrap = trapFocus(box);
    $('[data-memory-viewer-close]').focus();
  }

  function closeViewer() {
    const box = $('[data-memory-viewer]');
    box.classList.remove('is-open');
    clear($('[data-memory-viewer-stage]'));
    document.body.style.overflow = '';
    if (state.releaseTrap) {
      state.releaseTrap();
      state.releaseTrap = null;
    }
  }

  // -----------------------------------------------------------------------
  // Herunterladen
  // -----------------------------------------------------------------------

  async function downloadFile(upload, file) {
    const url = state.urls.get(file.storage_path);
    if (!url) {
      showNotice(errorNode, 'Für diese Datei gibt es gerade keinen gültigen Link.');
      return;
    }
    try {
      const blob = await supabase.downloadPhoto(url);
      downloadBlob(blob, `${exportFolderName(upload)}_${file.stored_filename}`);
    } catch (error) {
      showNotice(errorNode, `Download fehlgeschlagen: ${describeError(error)}`);
    }
  }

  /** Holt alle Dateien eines Uploads und packt sie zusammen. */
  async function downloadUpload(upload) {
    const dateien = filesOf(upload.id);
    if (dateien.length === 0) {
      showNotice(errorNode, 'Zu diesem Upload gibt es keine Dateien.');
      return;
    }
    const ordner = exportFolderName(upload);
    const eintraege = [
      { name: `${ordner}/Nachricht.txt`, data: textBytes(memoryMessageFile(upload)) },
    ];
    const fehlend = await sammle(dateien, ordner, eintraege, upload);
    if (eintraege.length === 1) {
      showNotice(errorNode, 'Es konnte keine einzige Datei geladen werden.');
      return;
    }
    downloadBlob(createZip(eintraege), `${ordner}.zip`);
    showNotice(
      errorNode,
      fehlend === 0
        ? `${anzahl(eintraege.length - 1, 'Datei', 'Dateien')} als ZIP gespeichert.`
        : `${anzahl(eintraege.length - 1, 'Datei', 'Dateien')} gespeichert, ${fehlend} konnten nicht geladen werden.`,
      fehlend === 0 ? 'info' : 'warn',
    );
  }

  /** Der grosse Export nach der Feier. */
  async function downloadAll() {
    if (state.uploads.length === 0) {
      showNotice(errorNode, 'Es gibt noch keine privaten Erinnerungen.');
      return;
    }
    const gesamt = state.files.reduce((summe, file) => summe + Number(file.file_size || 0), 0);
    if (gesamt > ZIP_WARNUNG_AB_BYTES) {
      const weiter = window.confirm(
        `Die Erinnerungen sind zusammen ${formatBytes(gesamt)} groß.\n\n` +
          'Ein ZIP dieser Größe im Browser zu bauen, klappt nicht auf jedem Rechner – ' +
          'der gesamte Inhalt muss dafür gleichzeitig in den Arbeitsspeicher.\n\n' +
          'Zuverlässiger ist das Skript "npm run export-erinnerungen" (siehe README).\n\n' +
          'Trotzdem hier im Browser versuchen?',
      );
      if (!weiter) return;
    }

    const button = $('[data-memories-download-all]');
    button.disabled = true;
    showNotice(errorNode, 'Die Erinnerungen werden geladen …', 'info');

    try {
      const wurzel = 'Britta-und-Lutz-Erinnerungen';
      const eintraege = [
        {
          name: `${wurzel}/upload-uebersicht.csv`,
          data: textBytes(memoryOverviewCsv(state.uploads)),
        },
      ];
      let fehlend = 0;
      let erledigt = 0;

      for (const upload of state.uploads) {
        const ordner = `${wurzel}/${exportFolderName(upload)}`;
        eintraege.push({
          name: `${ordner}/Nachricht.txt`,
          data: textBytes(memoryMessageFile(upload)),
        });
        fehlend += await sammle(filesOf(upload.id), ordner, eintraege, upload, () => {
          erledigt += 1;
          showNotice(
            errorNode,
            `${erledigt} von ${state.files.length} Dateien geladen …`,
            'info',
          );
        });
      }

      downloadBlob(createZip(eintraege), `${wurzel}.zip`);
      showNotice(
        errorNode,
        fehlend === 0
          ? `Alle ${state.files.length} Dateien wurden als ZIP gespeichert.`
          : `${state.files.length - fehlend} Dateien gespeichert, ${fehlend} konnten nicht geladen werden.`,
        fehlend === 0 ? 'info' : 'warn',
      );
      announce(live, 'Der Export ist fertig.');
    } catch (error) {
      showNotice(errorNode, `Der Export ist fehlgeschlagen: ${describeError(error)}`);
    } finally {
      button.disabled = false;
    }
  }

  /**
   * Laedt die Dateien eines Uploads und legt sie im Archiv ab.
   * @returns {Promise<number>} Anzahl der Dateien, die nicht geladen werden konnten
   */
  async function sammle(dateien, ordner, eintraege, upload, onFile) {
    let fehlend = 0;
    for (const file of dateien) {
      const url = state.urls.get(file.storage_path);
      if (!url) {
        fehlend += 1;
        if (onFile) onFile();
        continue;
      }
      try {
        const blob = await supabase.downloadPhoto(url);
        const bytes = new Uint8Array(await blob.arrayBuffer());
        const unterordner = file.media_type === 'video' ? 'Videos' : 'Fotos';
        eintraege.push({
          name: `${ordner}/${unterordner}/${file.stored_filename}`,
          data: bytes,
          date: file.created_at ? new Date(file.created_at) : new Date(),
        });
      } catch {
        fehlend += 1;
      }
      if (onFile) onFile();
    }
    return fehlend;
  }

  function textBytes(text) {
    return new TextEncoder().encode(text);
  }

  // -----------------------------------------------------------------------
  // Loeschen (wird aus album.js nach der Sicherheitsabfrage aufgerufen)
  // -----------------------------------------------------------------------

  /**
   * Fuehrt eine bestaetigte Loeschung aus.
   * @param {{art: string, upload: object, file?: object}} auftrag
   */
  async function performDelete(auftrag) {
    if (auftrag.art === 'memory-file') {
      const { file } = auftrag;
      // Erst die Datei, dann der Eintrag - so bleibt nichts Verwaistes liegen.
      await supabase.deleteMemoryObjects([file.storage_path]);
      await supabase.deleteMemoryFileRows([file.id]);
      state.files = state.files.filter((other) => other.id !== file.id);
      await load();
      return;
    }

    if (auftrag.art === 'memory-upload') {
      const { upload } = auftrag;
      const pfade = filesOf(upload.id).map((file) => file.storage_path);
      if (pfade.length > 0) await supabase.deleteMemoryObjects(pfade);
      // Die Dateieintraege verschwinden durch den Fremdschluessel automatisch.
      await supabase.deleteMemoryUpload(upload.id);
      state.open.delete(upload.id);
      await load();
    }
  }

  // -----------------------------------------------------------------------
  // Verdrahtung
  // -----------------------------------------------------------------------

  $('[data-memories-reload]').addEventListener('click', load);
  $('[data-memories-download-all]').addEventListener('click', downloadAll);
  $('[data-memory-viewer-close]').addEventListener('click', closeViewer);
  $('[data-memory-viewer]').addEventListener('click', (event) => {
    if (event.target === $('[data-memory-viewer]')) closeViewer();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && $('[data-memory-viewer]').classList.contains('is-open')) {
      closeViewer();
    }
  });

  return {
    load,
    performDelete,
    /** Sind die Links noch frisch genug? */
    isStale() {
      const ttl = Number(config.supabase.signedUrlTtlSeconds) || 600;
      return state.loadedAt === 0 || Date.now() - state.loadedAt > Math.max(30, ttl * 0.5) * 1000;
    },
    refreshUrls,
  };
}
