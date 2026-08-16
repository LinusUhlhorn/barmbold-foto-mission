import test from 'node:test';
import assert from 'node:assert/strict';

import {
  activeMissions,
  drawMission,
  randomIndex,
  renderMission,
  validateMissions,
} from '../assets/js/lib/missions.js';
import { PARTY_CONFIG } from '../config/party-config.js';

function makeMissions(count) {
  return Array.from({ length: count }, (_, i) => ({
    id: `m-${i + 1}`,
    title: `Mission ${i + 1}`,
    description: 'Beschreibung',
    category: 'Momente',
    icon: 'camera',
    difficulty: 'leicht',
    active: true,
  }));
}

test('Nur aktive Missionen werden berücksichtigt', () => {
  const missions = makeMissions(5);
  missions[1].active = false;
  missions[3].active = false;
  const active = activeMissions(missions);
  assert.equal(active.length, 3);
  assert.deepEqual(
    active.map((m) => m.id),
    ['m-1', 'm-3', 'm-5'],
  );
});

test('Missionen ohne id werden aussortiert', () => {
  assert.equal(activeMissions([{ title: 'ohne id', active: true }]).length, 0);
  assert.equal(activeMissions(null).length, 0);
});

test('Zufälliges Ziehen liefert immer eine gültige Mission', () => {
  const missions = makeMissions(10);
  const ids = new Set();
  for (let i = 0; i < 400; i += 1) {
    const mission = drawMission(missions);
    assert.ok(mission, 'Es wurde keine Mission gezogen');
    ids.add(mission.id);
  }
  // Über 400 Ziehungen sollten praktisch alle Missionen vorkommen.
  assert.equal(ids.size, 10);
});

test('Beim Wechseln kommt nie dieselbe Mission direkt erneut', () => {
  const missions = makeMissions(6);
  for (let i = 0; i < 300; i += 1) {
    const mission = drawMission(missions, { excludeId: 'm-3' });
    assert.notEqual(mission.id, 'm-3');
  }
});

test('Bereits gezogene Missionen werden vermieden, solange es Alternativen gibt', () => {
  const missions = makeMissions(4);
  const mission = drawMission(missions, { seenIds: ['m-1', 'm-2', 'm-3'] });
  assert.equal(mission.id, 'm-4');
});

test('Sind alle Missionen verbraucht, wird trotzdem eine geliefert', () => {
  const missions = makeMissions(3);
  const mission = drawMission(missions, { seenIds: ['m-1', 'm-2', 'm-3'], excludeId: 'm-2' });
  assert.ok(mission);
  assert.notEqual(mission.id, 'm-2');
});

test('Eine einzige Mission wird auch dann geliefert, wenn sie ausgeschlossen ist', () => {
  const missions = makeMissions(1);
  assert.equal(drawMission(missions, { excludeId: 'm-1' }).id, 'm-1');
});

test('Ohne Missionen wird null geliefert', () => {
  assert.equal(drawMission([]), null);
  assert.equal(drawMission([{ id: 'x', active: false }]), null);
});

test('Zufallszahlen liegen im gültigen Bereich und sind einigermaßen gleich verteilt', () => {
  const counts = new Array(5).fill(0);
  for (let i = 0; i < 5000; i += 1) {
    const index = randomIndex(5);
    assert.ok(index >= 0 && index < 5);
    counts[index] += 1;
  }
  // Bei 5000 Ziehungen erwarten wir je ~1000. Grosszügige Grenzen.
  for (const count of counts) {
    assert.ok(count > 750 && count < 1250, `Verteilung schief: ${counts.join(', ')}`);
  }
  assert.equal(randomIndex(0), 0);
  assert.equal(randomIndex(-3), 0);
});

test('Platzhalter in Missionen werden ersetzt, das Original bleibt unverändert', () => {
  const mission = {
    id: 'm',
    title: 'Typisch {name}',
    description: 'Stellt die {age} dar.',
    category: 'Geburtstag',
  };
  const rendered = renderMission(mission, { name: 'Alex', age: 42 });
  assert.equal(rendered.title, 'Typisch Alex');
  assert.equal(rendered.description, 'Stellt die 42 dar.');
  assert.equal(mission.title, 'Typisch {name}', 'Das Original wurde verändert');
});

test('Fehlerhafte Missionen werden erkannt', () => {
  const problems = validateMissions([
    { id: 'a', title: 'A', description: 'x', category: 'Momente' },
    { id: 'a', title: 'B', description: 'y', category: 'Momente' },
    { id: '', title: '', description: '', category: 'Unsinn' },
    { id: 'c', title: 'C', description: 'z', category: 'Kreativ', difficulty: 'unmöglich' },
  ]);
  assert.ok(problems.some((p) => p.includes('doppelt')));
  assert.ok(problems.some((p) => p.includes('"id" fehlt')));
  assert.ok(problems.some((p) => p.includes('unbekannte Kategorie')));
  assert.ok(problems.some((p) => p.includes('unbekannte Schwierigkeit')));
});

// -------------------------------------------------------------------------
// Die echte Konfiguration
// -------------------------------------------------------------------------

test('Die mitgelieferte Konfiguration ist fehlerfrei', () => {
  assert.deepEqual(validateMissions(PARTY_CONFIG.missions), []);
  assert.deepEqual(validateMissions(PARTY_CONFIG.bonusMissions), []);
});

test('Es gibt mindestens 20 aktive Foto-Missionen', () => {
  assert.ok(
    activeMissions(PARTY_CONFIG.missions).length >= 20,
    `Nur ${activeMissions(PARTY_CONFIG.missions).length} aktive Missionen`,
  );
});

test('Es gibt mindestens eine aktive Bonus-Mission', () => {
  assert.ok(activeMissions(PARTY_CONFIG.bonusMissions).length >= 1);
});

test('Missions-IDs sind über beide Listen hinweg eindeutig', () => {
  const ids = [...PARTY_CONFIG.missions, ...PARTY_CONFIG.bonusMissions].map((m) => m.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('Alle Kategorien der Aufgabenstellung kommen vor', () => {
  const used = new Set(PARTY_CONFIG.missions.map((m) => m.category));
  for (const category of [
    'Menschen',
    'Momente',
    'Kreativ',
    'Lustig',
    'Jubelpaar',
    'Gruppe',
    'Erinnerung',
  ]) {
    assert.ok(used.has(category), `Kategorie fehlt: ${category}`);
  }
});
