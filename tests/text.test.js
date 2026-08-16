import test from 'node:test';
import assert from 'node:assert/strict';

import {
  escapeHtml,
  fillTemplate,
  formatBytes,
  formatDateTime,
  sanitizeName,
  truncate,
  validateName,
} from '../assets/js/lib/text.js';

const LIMITS = { minNameLength: 2, maxNameLength: 40 };

test('Platzhalter im Text werden ersetzt', () => {
  assert.equal(
    fillTemplate('Alles Gute, {name}! Du wirst {age}.', { name: 'Alex', age: 42 }),
    'Alles Gute, Alex! Du wirst 42.',
  );
  assert.equal(fillTemplate('{name} und {name}', { name: 'A' }), 'A und A');
  assert.equal(fillTemplate(null, {}), '');
});

test('Namen werden von Leerzeichen und Steuerzeichen befreit', () => {
  assert.equal(sanitizeName('   Anna   Maria   '), 'Anna Maria');
  assert.equal(sanitizeName('Anna\nMaria'), 'Anna Maria');
  assert.equal(sanitizeName('Anna\tMaria'), 'Anna Maria');
  assert.equal(sanitizeName('​Anna​'), 'Anna');
  assert.equal(sanitizeName('﻿Anna'), 'Anna');
});

test('Namen können kein HTML oder Script enthalten', () => {
  assert.equal(sanitizeName('<script>alert(1)</script>'), 'scriptalert(1)/script');
  assert.equal(sanitizeName('<img src=x onerror=alert(1)>'), 'img src=x onerror=alert(1)');
  // Nach der Bereinigung ist kein einziges spitzes Zeichen mehr enthalten.
  for (const evil of ['<b>', 'a<b>c', '<<>>', '<svg/onload=1>']) {
    const cleaned = sanitizeName(evil);
    assert.ok(!cleaned.includes('<'), `"${cleaned}" enthält noch <`);
    assert.ok(!cleaned.includes('>'), `"${cleaned}" enthält noch >`);
  }
});

test('Start ohne Namen wird abgelehnt', () => {
  const result = validateName('', LIMITS);
  assert.equal(result.valid, false);
  assert.match(result.error, /Namen/);
});

test('Zu kurzer Name wird abgelehnt', () => {
  const result = validateName('A', LIMITS);
  assert.equal(result.valid, false);
  assert.match(result.error, /mindestens 2/);
});

test('Name nur aus Leerzeichen wird abgelehnt', () => {
  assert.equal(validateName('     ', LIMITS).valid, false);
});

test('Name nur aus Sonderzeichen wird abgelehnt', () => {
  const result = validateName('!!!???', LIMITS);
  assert.equal(result.valid, false);
  assert.match(result.error, /echten Namen/);
});

test('Zu langer Name wird abgelehnt und gekürzt zurückgegeben', () => {
  const result = validateName('x'.repeat(60), LIMITS);
  assert.equal(result.valid, false);
  assert.equal(result.value.length, 40);
});

test('Gültige Namen werden angenommen', () => {
  for (const name of ['Jo', ' Anna ', 'Björn', 'Zoë', 'Jean-Luc', 'Ali 42', '李雷']) {
    const result = validateName(name, LIMITS);
    assert.equal(result.valid, true, `"${name}" wurde abgelehnt: ${result.error}`);
  }
});

test('HTML-Maskierung schützt alle gefährlichen Zeichen', () => {
  assert.equal(escapeHtml('<a href="x">&\'</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
});

test('Byte-Angaben werden lesbar formatiert', () => {
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(2048), '2 KB');
  assert.equal(formatBytes(3 * 1024 * 1024), '3.0 MB');
  assert.equal(formatBytes(-1), '–');
  assert.equal(formatBytes('keine Zahl'), '–');
});

test('Datum wird deutsch formatiert', () => {
  const value = formatDateTime('2026-08-12T19:05:00');
  assert.match(value, /^12\.08\.2026 · \d{2}:\d{2}$/);
  assert.equal(formatDateTime('kein Datum'), '–');
});

test('Texte werden bei Bedarf gekürzt', () => {
  assert.equal(truncate('Hallo Welt', 20), 'Hallo Welt');
  assert.equal(truncate('Hallo Welt', 6), 'Hallo…');
});
