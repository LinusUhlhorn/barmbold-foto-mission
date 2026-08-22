// Prüft die zentrale Konfigurationsdatei.
// Wer hier etwas ändert, merkt sofort, wenn ein Pflichtfeld fehlt.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { PARTY_CONFIG } from '../config/party-config.js';
import defaultExport from '../config/party-config.js';
import { fillTemplate } from '../assets/js/lib/text.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG_SOURCE = fs.readFileSync(path.join(ROOT, 'config', 'party-config.js'), 'utf8');

test('Die Datei beginnt mit dem deutlich sichtbaren Hinweis', () => {
  const kopf = CONFIG_SOURCE.split('\n').slice(0, 4).join('\n');
  assert.match(kopf, /=======================================================/);
  assert.match(kopf, /FOTO-MISSION TEMPLATE/);
});

test('Die Konfiguration ist auch als Standard-Export verfügbar', () => {
  assert.equal(defaultExport, PARTY_CONFIG);
});

test('Alle Hauptbereiche sind vorhanden', () => {
  for (const key of [
    'party',
    'texts',
    'privacy',
    'limits',
    'image',
    'supabase',
    'theme',
    'test',
    'missions',
    'bonusMissions',
  ]) {
    assert.ok(PARTY_CONFIG[key], `Bereich fehlt: ${key}`);
  }
});

test('Die Feier ist für Britta und Lutz personalisiert', () => {
  assert.equal(PARTY_CONFIG.party.birthdayPersonName, 'Britta & Lutz');
  assert.match(PARTY_CONFIG.party.partyTitle, /Silberhochzeit/);
  assert.match(PARTY_CONFIG.party.partyTitle, /Barmbold/);
  assert.equal(PARTY_CONFIG.party.partyDate, '2026');
});

test('Die öffentliche Adresse ist die Silberhochzeits-Domain', () => {
  assert.equal(
    PARTY_CONFIG.party.publicUrl,
    'https://silberhochzeit-barmbold.ulhorn-webdesign.de/',
  );
});

test('Der optionale Absender ist im Template leer', () => {
  assert.equal(PARTY_CONFIG.party.giftedBy, '');
});

test('Die Jubilaeumszahl ist 25', () => {
  assert.equal(PARTY_CONFIG.party.age, 25);
});

test('Alle Texte der Oberfläche sind gefüllt', () => {
  for (const [key, value] of Object.entries(PARTY_CONFIG.texts)) {
    assert.equal(typeof value, 'string', `Text ist kein Text: ${key}`);
    assert.ok(value.trim().length > 0, `Text ist leer: ${key}`);
  }
  // Diese Texte werden vom Programm zwingend gebraucht.
  for (const key of [
    'appTitle',
    'heroSubline',
    'heroExplanation',
    'nameLabel',
    'namePlaceholder',
    'startButton',
    'acceptButton',
    'redrawButton',
    'captureButton',
    'chooseButton',
    'usePhotoButton',
    'retakeButton',
    'cancelMissionButton',
    'uploadButton',
    'uploadingLabel',
    'successTitle',
    'successText',
    'nextMissionButton',
    'bonusButton',
    'extraMissionButton',
    'galleryButton',
    'doneButton',
  ]) {
    assert.ok(PARTY_CONFIG.texts[key], `Pflichttext fehlt: ${key}`);
  }
});

test('Platzhalter in den Texten werden korrekt ersetzt', () => {
  const values = { name: 'Alex', age: 42 };
  const title = fillTemplate(PARTY_CONFIG.texts.appTitle, values);
  assert.ok(title.includes('42'));
  assert.ok(!title.includes('{age}'));
});

test('Der Datenschutzhinweis erklärt die öffentliche Galerie', () => {
  const { notice, consentLabel, consentHint, peopleNotice } = PARTY_CONFIG.privacy;
  assert.match(notice, /öffentlichen Galerie/);
  assert.match(notice, /bewertet werden/);
  assert.match(notice, /Administration gelöscht werden/);
  assert.match(peopleNotice, /abgebildeten Personen mit dem Foto einverstanden/);
  assert.ok(consentHint.trim().length > 0, 'Der Zusatz unter dem Haken fehlt');
});

test('Der Haken vor dem Upload nennt Album, Galerie und die abgebildeten Personen', () => {
  const { consentLabel } = PARTY_CONFIG.privacy;
  assert.match(consentLabel, /Album/, 'Das Album fehlt im Einwilligungstext');
  assert.match(consentLabel, /Galerie/, 'Die öffentliche Galerie fehlt im Einwilligungstext');
  assert.match(
    consentLabel,
    /abgebildeten Personen sind einverstanden/,
    'Das Einverständnis der abgebildeten Personen fehlt',
  );
  // Die Galerie ist öffentlich - "privates Album" wäre irreführend.
  assert.ok(!/privaten? (Silberhochzeits-)?Album/.test(consentLabel));
  // Er steht neben einem Ankreuzfeld und muss auf einen Blick lesbar bleiben.
  assert.ok(consentLabel.length <= 220, 'Der Einwilligungstext ist zu lang für den Haken');
});

test('Die Begrenzungen sind sinnvoll gesetzt', () => {
  const l = PARTY_CONFIG.limits;
  assert.equal(l.regularMissionsPerDevice, 2);
  assert.equal(l.bonusMissionsPerDevice, 1);
  assert.equal(l.redrawsPerMission, 2, 'Es sollen genau zwei Wechsel erlaubt sein');
  assert.equal(l.allowExtraMissions, true, 'Freiwillige Zusatz-Missionen sollen erlaubt sein');
  assert.ok(l.maxInputFileBytes > l.maxUploadBytes);
  assert.ok(l.minNameLength >= 2);
  assert.ok(l.maxNameLength > l.minNameLength && l.maxNameLength <= 100);
  // Die Obergrenze muss zur Datenbank passen (dort: 8 MB).
  assert.ok(l.maxUploadBytes <= 8 * 1024 * 1024, 'maxUploadBytes ist größer als die Datenbank erlaubt');
});

test('Es sind nur echte Bildformate erlaubt', () => {
  const erlaubt = PARTY_CONFIG.limits.allowedMimeTypes;
  assert.ok(erlaubt.includes('image/jpeg'));
  assert.ok(erlaubt.includes('image/heic'), 'iPhone-Fotos müssen erlaubt sein');
  for (const gefaehrlich of ['image/svg+xml', 'text/html', 'application/javascript']) {
    assert.ok(!erlaubt.includes(gefaehrlich), `${gefaehrlich} darf nicht erlaubt sein`);
  }
  for (const type of erlaubt) {
    assert.match(type, /^image\//, `Kein Bildformat: ${type}`);
  }
});

test('Die Bildverarbeitung ist sinnvoll eingestellt', () => {
  const image = PARTY_CONFIG.image;
  assert.ok(image.maxDimension >= 1024 && image.maxDimension <= 4096);
  assert.ok(image.quality > 0.5 && image.quality <= 1);
});

test('In der Konfiguration steht nur ein öffentlicher Supabase-Schlüssel', () => {
  assert.match(PARTY_CONFIG.supabase.url, /^https:\/\/[a-z0-9]+\.supabase\.co\/?$/);
  assert.match(PARTY_CONFIG.supabase.anonKey, /^(sb_publishable_|eyJ)/);
  assert.ok(!/service_role/i.test(PARTY_CONFIG.supabase.anonKey));
  assert.ok(!/^sb_secret_/i.test(PARTY_CONFIG.supabase.anonKey));
});

test('Der Speicherort in Supabase ist benannt', () => {
  assert.equal(PARTY_CONFIG.supabase.bucket, 'party-photos');
  assert.equal(PARTY_CONFIG.supabase.table, 'photo_submissions');
  assert.ok(PARTY_CONFIG.supabase.signedUrlTtlSeconds >= 60);
  assert.ok(
    PARTY_CONFIG.supabase.signedUrlTtlSeconds <= 3600,
    'Signierte Links sollen kurzlebig sein',
  );
});

test('Der Testmodus ist beschrieben und lädt standardmäßig nichts hoch', () => {
  assert.equal(PARTY_CONFIG.test.queryParam, 'test');
  assert.equal(PARTY_CONFIG.test.allowUploadByDefault, false);
  assert.match(PARTY_CONFIG.test.bannerText, /TESTMODUS/i);
  assert.match(PARTY_CONFIG.test.guestNamePrefix, /TEST/i);
});

test('Alle Farben sind gültige Hex-Werte', () => {
  for (const [key, value] of Object.entries(PARTY_CONFIG.theme.colors)) {
    assert.match(value, /^#[0-9a-f]{6}$/i, `Farbe ungültig: ${key} = ${value}`);
  }
});

test('Die Effekte lassen sich einzeln abschalten', () => {
  for (const key of ['grain', 'particles', 'confetti', 'bigNumber']) {
    assert.equal(typeof PARTY_CONFIG.theme.effects[key], 'boolean', `Effekt fehlt: ${key}`);
  }
  assert.equal(typeof PARTY_CONFIG.theme.sound.enabled, 'boolean');
});

test('Jede Mission hat alle Felder in der vorgesehenen Form', () => {
  for (const mission of [...PARTY_CONFIG.missions, ...PARTY_CONFIG.bonusMissions]) {
    assert.match(mission.id, /^[a-z0-9-]+$/, `Ungültige id: ${mission.id}`);
    assert.equal(typeof mission.title, 'string');
    assert.equal(typeof mission.description, 'string');
    assert.equal(typeof mission.category, 'string');
    assert.equal(typeof mission.icon, 'string');
    assert.ok(['leicht', 'mittel', 'schwer'].includes(mission.difficulty));
    assert.equal(typeof mission.active, 'boolean');
  }
});

test('Die Silberhochzeits-Missionen decken wichtige Motive ab', () => {
  const alle = PARTY_CONFIG.missions.map((m) => `${m.title} ${m.description}`).join(' | ');
  for (const stichwort of [
    'Britta & Lutz',
    'Gruppenfoto',
    'Generationen',
    'Outfit',
    'Silber',
    'Tanzmoment',
    'lange nicht gesehen',
    '25 Jahre',
  ]) {
    assert.ok(alle.includes(stichwort), `Diese Mission fehlt: "${stichwort}"`);
  }
});
