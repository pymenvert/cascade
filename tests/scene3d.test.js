'use strict';
/**
 * Espace 3D — le modèle spatial de la v2.
 *
 * La règle qu'on protège ici : p3/dir3/len3 sont la VÉRITÉ, x/y/rot en sont
 * dérivés. Le jour où quelqu'un écrit x directement, ces tests tombent.
 * Et surtout : un projet v1 doit se retrouver exactement là où il était.
 */
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert');
const { start, sleep, fixtures } = require('./helpers.js');

const proche = (a, b, tol = 0.01) => Math.abs(a - b) <= tol;

describe('Espace 3D', () => {
  let h;
  before(async () => { h = await start(); });
  after(async () => { await h.stop(); });

  test('le plateau a des dimensions réglables et bornées', async () => {
    const s0 = (await h.state()).scene;
    assert.deepEqual(Object.keys(s0).sort(), ['d', 'h', 'w']);
    await h.post('/api/scene', { scene: { w: 12, d: 9, h: 7 } });
    assert.deepEqual((await h.state()).scene, { w: 12, d: 9, h: 7 });
    // Valeurs absurdes ramenées dans les clous
    await h.post('/api/scene', { scene: { w: 0, d: 99999, h: 'grand' } });
    const s = (await h.state()).scene;
    assert.ok(s.w >= 0.5 && s.d <= 200 && s.h === 7, JSON.stringify(s));
    await h.post('/api/scene', { scene: { w: 10, d: 8, h: 6 } });
  });

  test('un projet v1 est migré sans bouger d’un pixel', async () => {
    // Positions 2D volontairement variées, comme dans un vrai projet
    const v1 = [
      { id: 'a', name: 'A', address: '/fixtures/a', enabled: true, x: 0, y: 0, rot: 0, len: 100 },
      { id: 'b', name: 'B', address: '/fixtures/b', enabled: true, x: 0.5, y: 0.5, rot: 45, len: 50 },
      { id: 'c', name: 'C', address: '/fixtures/c', enabled: true, x: 1, y: 1, rot: 90, len: 100 },
      { id: 'd', name: 'D', address: '/fixtures/d', enabled: true, x: 0.25, y: 0.75, rot: 135, len: 75 },
    ];
    await h.post('/api/fixtures', { fixtures: v1 });
    const fx = (await h.state()).fixtures;
    for (const attendu of v1) {
      const f = fx.find(x => x.id === attendu.id);
      assert.ok(f.p3 && f.p3.length === 3, 'p3 manquant sur ' + attendu.id);
      assert.ok(f.dir3 && f.dir3.length === 3, 'dir3 manquant sur ' + attendu.id);
      assert.ok(f.len3 > 0, 'len3 manquant sur ' + attendu.id);
      // Le point capital : la 2D est inchangée
      assert.ok(proche(f.x, attendu.x), `${attendu.id} : x ${attendu.x} → ${f.x}`);
      assert.ok(proche(f.y, attendu.y), `${attendu.id} : y ${attendu.y} → ${f.y}`);
      assert.ok(proche(f.rot, attendu.rot, 0.2), `${attendu.id} : rot ${attendu.rot} → ${f.rot}`);
    }
  });

  test('la migration place tout dans le plan de face (profondeur nulle)', async () => {
    for (const f of (await h.state()).fixtures) {
      assert.equal(f.p3[1], 0, f.name + ' ne devrait pas avoir de profondeur après migration');
    }
  });

  test('une barre verticale déclarée seulement par « vert » n’est pas couchée', async () => {
    // Piège v1 : rot absent, l'orientation vient du seul drapeau vert
    await h.post('/api/fixtures', { fixtures: [
      { id: 'v', name: 'V', address: '/fixtures/v', enabled: true, x: 0.5, y: 0.5, vert: true },
    ] });
    const f = (await h.state()).fixtures[0];
    assert.ok(proche(Math.abs(f.rot), 90, 0.2), 'la barre doit rester verticale, rot = ' + f.rot);
    assert.ok(Math.abs(f.dir3[2]) > 0.9, 'dir3 doit pointer vers la hauteur : ' + JSON.stringify(f.dir3));
  });

  test('déplacer en 3D met la 2D à jour', async () => {
    await h.post('/api/fixtures', { fixtures: fixtures(3) });
    const id = (await h.state()).fixtures[0].id;
    const s = (await h.state()).scene;
    // Coin haut-droit du plateau, à 2 m de profondeur
    await h.post('/api/fixture3d', { id, p3: [s.w / 2, 2, s.h], dir3: [1, 0, 0], len3: 2 });
    const f = (await h.state()).fixtures.find(x => x.id === id);
    assert.ok(proche(f.x, 1), 'x attendu 1, vu ' + f.x);
    assert.ok(proche(f.y, 0), 'y attendu 0 (haut), vu ' + f.y);
    assert.equal(f.len3, 2);
    assert.equal(f.p3[1], 2, 'la profondeur doit être conservée');
  });

  test('redimensionner le plateau ne déplace aucune barre dans l’espace', async () => {
    const avant = (await h.state()).fixtures.map(f => f.p3.slice());
    await h.post('/api/scene', { scene: { w: 20, d: 8, h: 6 } });
    const apres = (await h.state()).fixtures;
    apres.forEach((f, i) => assert.deepEqual(f.p3, avant[i],
      f.name + ' a bougé en mètres alors que seul le plateau a changé'));
    // …mais la projection 2D, elle, se resserre
    assert.ok(apres[0].x > 0.2 && apres[0].x < 0.8, 'la 2D doit suivre le plateau élargi');
    await h.post('/api/scene', { scene: { w: 10, d: 8, h: 6 } });
  });

  test('un vecteur de direction nul ne casse rien', async () => {
    const id = (await h.state()).fixtures[0].id;
    await h.post('/api/fixture3d', { id, dir3: [0, 0, 0] });
    const f = (await h.state()).fixtures.find(x => x.id === id);
    const n = Math.hypot(...f.dir3);
    assert.ok(proche(n, 1), 'dir3 doit rester unitaire, norme = ' + n);
    assert.ok(Number.isFinite(f.rot), 'rot doit rester un nombre');
  });

  test('des coordonnées hostiles sont bornées', async () => {
    await h.post('/api/fixtures', { fixtures: [{
      id: 'x', name: 'X', address: '/fixtures/x', enabled: true,
      p3: [Infinity, NaN, 'loin'], dir3: [1, 0, 0], len3: -5,
    }] });
    const f = (await h.state()).fixtures[0];
    assert.ok(f.p3.every(Number.isFinite), 'p3 doit rester fini : ' + JSON.stringify(f.p3));
    assert.ok(f.len3 > 0 && f.len3 <= 50, 'len3 hors bornes : ' + f.len3);
    assert.ok(Number.isFinite(f.x) && Number.isFinite(f.y), 'la 2D dérivée doit rester finie');
  });

  test('la 3D survit à l’export/import et aux presets', async () => {
    await h.post('/api/fixtures', { fixtures: fixtures(3) });
    const id = (await h.state()).fixtures[1].id;
    await h.post('/api/fixture3d', { id, p3: [1.5, 3.5, 2.5], dir3: [0, 0, 1], len3: 1.8 });
    await h.post('/api/scene', { scene: { w: 14, d: 11, h: 5 } });
    await h.post('/api/preset', { action: 'save', slot: 3, name: '3D' });

    const exp = await h.get('/api/export');
    await h.post('/api/new', { keepFixtures: false });
    await h.post('/api/import', exp.body);

    const s = (await h.state()).scene;
    assert.deepEqual(s, { w: 14, d: 11, h: 5 }, 'le plateau doit voyager avec le projet');
    const f = (await h.state()).fixtures.find(x => x.id === id);
    assert.deepEqual(f.p3, [1.5, 3.5, 2.5]);
    assert.ok(proche(f.len3, 1.8));
    assert.ok(Math.abs(f.dir3[2]) > 0.9, 'la direction doit être conservée');

    // Et le preset doit avoir mémorisé la 3D lui aussi
    await h.post('/api/fixture3d', { id, p3: [0, 0, 0] });
    await h.post('/api/preset', { action: 'recall', slot: 3 });
    await sleep(80);
    const f2 = (await h.state()).fixtures.find(x => x.id === id);
    assert.deepEqual(f2.p3, [1.5, 3.5, 2.5], 'le preset doit restaurer la position 3D');
    await h.post('/api/scene', { scene: { w: 10, d: 8, h: 6 } });
  });

  test('le moteur continue de tourner normalement avec la 3D', async () => {
    await h.post('/api/fixtures', { fixtures: fixtures(4) });
    const id = (await h.state()).layers[0].id;
    await h.post('/api/layer', { id, set: { pattern: 'all', mode: 'onoff', engine: 'steps' } });
    await h.post('/api/blackout');
    await sleep(80);
    h.clearOsc();
    await h.post('/api/start');
    await sleep(250);
    const msgs = h.osc();
    await h.post('/api/stop');
    const allumees = new Set(msgs.filter(m => /luminosity$/.test(m.address) && m.args[0] > 0.5)
      .map(m => m.address));
    assert.equal(allumees.size, 4, 'les 4 barres doivent toujours s’allumer');
  });
});
