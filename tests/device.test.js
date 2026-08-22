import test from 'node:test';
import assert from 'node:assert/strict';

import { createSafeStorage } from '../assets/js/lib/storage.js';
import {
  createDeviceState,
  emptyState,
  missionAllowance,
  normalizeState,
  uuid,
} from '../assets/js/lib/device.js';
import { PARTY_CONFIG } from '../config/party-config.js';

/** Ein einfacher Speicher im Arbeitsspeicher, wie ihn der Browser bereitstellt. */
function fakeStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    _map: map,
  };
}

test('UUIDs sind eindeutig und haben das richtige Format', () => {
  const seen = new Set();
  for (let i = 0; i < 500; i += 1) {
    const value = uuid();
    assert.match(value, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    assert.ok(!seen.has(value), 'UUID kam doppelt vor');
    seen.add(value);
  }
});

test('Der Speicher funktioniert auch, wenn der Browser ihn blockiert', () => {
  const blocked = {
    getItem: () => {
      throw new Error('blockiert');
    },
    setItem: () => {
      throw new Error('blockiert');
    },
    removeItem: () => {
      throw new Error('blockiert');
    },
  };
  const storage = createSafeStorage(blocked);
  assert.equal(storage.persistent, false);
  assert.equal(storage.set('a', { x: 1 }), true);
  assert.deepEqual(storage.get('a'), { x: 1 });
  assert.deepEqual(storage.get('gibtsNicht', 'ersatz'), 'ersatz');
});

test('Kaputte Daten im Speicher lassen die App nicht abstürzen', () => {
  const backend = fakeStorage();
  backend.setItem('kaputt', '{nicht wirklich json');
  const storage = createSafeStorage(backend);
  assert.equal(storage.get('kaputt', 'ersatz'), 'ersatz');
});

test('Ein unbrauchbarer Zustand wird repariert', () => {
  const repaired = normalizeState({ deviceId: 5, seenMissionIds: 'keine Liste', completed: null });
  assert.equal(typeof repaired.deviceId, 'string');
  assert.ok(Array.isArray(repaired.seenMissionIds));
  assert.ok(Array.isArray(repaired.completed));
  assert.deepEqual(normalizeState(null).completed, []);
  assert.deepEqual(normalizeState('quatsch').seenMissionIds, []);
});

test('Der leere Zustand hat eine Geräte-ID', () => {
  assert.ok(emptyState().deviceId.length > 8);
});

test('Die Geräte-ID bleibt über Neustarts hinweg gleich', () => {
  const backend = fakeStorage();
  const first = createDeviceState(createSafeStorage(backend));
  const id = first.deviceId;
  const second = createDeviceState(createSafeStorage(backend));
  assert.equal(second.deviceId, id);
});

test('Gezogene Missionen werden gemerkt und nicht doppelt gespeichert', () => {
  const device = createDeviceState(createSafeStorage(fakeStorage()));
  device.rememberMission('m-1');
  device.rememberMission('m-2');
  device.rememberMission('m-1');
  assert.deepEqual(device.seenMissionIds, ['m-2', 'm-1']);
  device.rememberMission('');
  assert.equal(device.seenMissionIds.length, 2);
});

test('Standardmäßig sind zwei reguläre Missionen vor der Bonus-Mission erlaubt', () => {
  const device = createDeviceState(createSafeStorage(fakeStorage()));
  let allowance = missionAllowance(device, PARTY_CONFIG.limits, false);
  assert.equal(allowance.canRegular, true);
  assert.equal(allowance.canBonus, false, 'Bonus darf es erst NACH der regulären Mission geben');

  device.addCompleted({ kind: 'regular', missionId: 'm-1', missionTitle: 'Test' });

  allowance = missionAllowance(device, PARTY_CONFIG.limits, false);
  assert.equal(allowance.canRegular, true);
  assert.equal(allowance.canBonus, false, 'Bonus darf es erst nach zwei regulären Missionen geben');

  device.addCompleted({ kind: 'regular', missionId: 'm-2', missionTitle: 'Test 2' });
  allowance = missionAllowance(device, PARTY_CONFIG.limits, false);
  assert.equal(allowance.canRegular, false);
  assert.equal(allowance.canBonus, true);
});

test('Nach der Bonus-Mission ist der Pflichtteil erledigt', () => {
  const device = createDeviceState(createSafeStorage(fakeStorage()));
  device.addCompleted({ kind: 'regular', missionId: 'm-1' });
  device.addCompleted({ kind: 'regular', missionId: 'm-2' });
  device.addCompleted({ kind: 'bonus', missionId: 'b-1' });
  const allowance = missionAllowance(device, PARTY_CONFIG.limits, false);
  assert.equal(allowance.canRegular, false);
  assert.equal(allowance.canBonus, false);
  assert.equal(allowance.regularDone, 2);
  assert.equal(allowance.bonusDone, 1);
  // Aber niemand wird ausgesperrt: freiwillig geht es immer weiter.
  assert.equal(allowance.canExtra, true);
});

test('Freiwillige Zusatz-Missionen zählen nicht auf den Pflichtteil', () => {
  const device = createDeviceState(createSafeStorage(fakeStorage()));
  device.addCompleted({ kind: 'regular', missionId: 'm-1' });
  device.addCompleted({ kind: 'regular', missionId: 'm-2' });
  device.addCompleted({ kind: 'bonus', missionId: 'b-1' });
  for (let i = 0; i < 5; i += 1) {
    device.addCompleted({ kind: 'extra', missionId: `x-${i}` });
  }
  const allowance = missionAllowance(device, PARTY_CONFIG.limits, false);
  assert.equal(allowance.extraDone, 5);
  assert.equal(allowance.canExtra, true, 'Es gibt keine Obergrenze für freiwillige Missionen');
  assert.equal(allowance.regularDone, 2, 'Zusatz-Missionen dürfen den Pflichtteil nicht verändern');
  assert.equal(allowance.bonusDone, 1);
});

test('Zusatz-Missionen lassen sich in der Konfiguration abschalten', () => {
  const device = createDeviceState(createSafeStorage(fakeStorage()));
  const allowance = missionAllowance(
    device,
    { ...PARTY_CONFIG.limits, allowExtraMissions: false },
    false,
  );
  assert.equal(allowance.canExtra, false);
});

test('Im Testmodus ist die Anzahl nicht begrenzt', () => {
  const device = createDeviceState(createSafeStorage(fakeStorage()));
  for (let i = 0; i < 12; i += 1) {
    device.addCompleted({ kind: 'regular', missionId: `m-${i}` });
  }
  const allowance = missionAllowance(device, PARTY_CONFIG.limits, true);
  assert.equal(allowance.canRegular, true);
  assert.equal(allowance.canBonus, true);
});

test('Die Anzahl erlaubter Missionen lässt sich in der Konfiguration ändern', () => {
  const device = createDeviceState(createSafeStorage(fakeStorage()));
  device.addCompleted({ kind: 'regular', missionId: 'm-1' });
  const allowance = missionAllowance(
    device,
    { regularMissionsPerDevice: 3, bonusMissionsPerDevice: 0 },
    false,
  );
  assert.equal(allowance.canRegular, true);
  assert.equal(allowance.canBonus, false);
});

test('Nach dem Zurücksetzen ist alles wieder frei (nur für den Testmodus)', () => {
  const device = createDeviceState(createSafeStorage(fakeStorage()));
  device.addCompleted({ kind: 'regular', missionId: 'm-1' });
  device.setGuestName('Anna');
  device.reset();
  assert.equal(device.countCompleted('regular'), 0);
  assert.equal(device.guestName, '');
  assert.equal(missionAllowance(device, PARTY_CONFIG.limits, false).canRegular, true);
});

test('Der Gästename wird gespeichert und begrenzt', () => {
  const device = createDeviceState(createSafeStorage(fakeStorage()));
  device.setGuestName('x'.repeat(200));
  assert.equal(device.guestName.length, 80);
});

test('Abgeschlossene Missionen werden als Kopie geliefert', () => {
  const device = createDeviceState(createSafeStorage(fakeStorage()));
  device.addCompleted({ kind: 'regular', missionId: 'm-1', missionTitle: 'Original' });
  const list = device.completed;
  list[0].missionTitle = 'Verändert';
  assert.equal(device.completed[0].missionTitle, 'Original');
});
