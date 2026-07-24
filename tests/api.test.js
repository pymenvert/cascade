'use strict';
/** API HTTP : validation des entrées, presets, projet, import/export. */
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert');
const { start, fixtures } = require('./helpers.js');

describe('API HTTP', () => {
  let h;
  before(async () => { h = await start(); });
  after(async () => { await h.stop(); });

  test('/api/ping identifie Cascade', async () => {
    const r = await h.get('/api/ping');
    assert.equal(r.body.app, 'Cascade');
    assert.match(r.body.version, /^\d+\.\d+\.\d+$/);
  });

  test('/api/state expose tout ce dont l’interface a besoin', async () => {
    const s = await h.state();
    for (const k of ['settings', 'fixtures', 'layers', 'global', 'presets', 'link', 'project', 'levels']) {
      assert.ok(k in s, 'champ manquant : ' + k);
    }
    assert.equal(s.global.running, false);
  });

  test('une URL inconnue renvoie 404, pas une erreur serveur', async () => {
    const r = await h.get('/api/nexistepas');
    assert.equal(r.status, 404);
  });

  test('les valeurs hors bornes sont ramenées dans les clous', async () => {
    const id = (await h.state()).layers[0].id;
    const r = await h.post('/api/layer', { id, set: {
      stepMs: 999999, speed: -50, width: 99, group: 0, level: 12,
      phase: 5000, swing: -900, floor: 3, blocks: 42, sparkle: 9,
    } });
    const L = r.body.layer;
    assert.equal(L.stepMs, 10000);
    assert.equal(L.speed, 0.05);
    assert.equal(L.width, 8);
    assert.equal(L.group, 1);
    assert.equal(L.level, 1);
    assert.equal(L.phase, 360);
    assert.equal(L.swing, -75);
    assert.equal(L.floor, 1);
    assert.equal(L.blocks, 8);
    assert.equal(L.sparkle, 1);
  });

  test('les valeurs absurdes (texte, null) ne cassent rien', async () => {
    const id = (await h.state()).layers[0].id;
    const r = await h.post('/api/layer', { id, set: {
      stepMs: 'beaucoup', pattern: 'inexistant', engine: 'nawak',
      colorA: 'rouge', level: null, bars: 'pas-un-tableau',
    } });
    assert.equal(r.body.ok, true);
    const L = r.body.layer;
    assert.equal(typeof L.stepMs, 'number');
    assert.ok(['lr', 'rl', 'pingpong', 'random', 'evenodd', 'all'].includes(L.pattern));
    assert.equal(L.engine, 'steps');
    assert.match(L.colorA, /^#[0-9a-fA-F]{6}$/);
  });

  test('le nom de paramètre OSC refuse la remontée de chemin', async () => {
    const before = (await h.state()).global.param;
    await h.post('/api/global', { param: '../../etc/passwd' });
    assert.equal((await h.state()).global.param, before);
    await h.post('/api/global', { param: 'dimmer' });
    assert.equal((await h.state()).global.param, 'dimmer');
    await h.post('/api/global', { param: 'luminosity' });
  });

  test('la courbe de gradateur n’accepte que les valeurs connues', async () => {
    await h.post('/api/global', { dimmer: 'square' });
    assert.equal((await h.state()).global.dimmer, 'square');
    await h.post('/api/global', { dimmer: 'n’importe quoi' });
    assert.equal((await h.state()).global.dimmer, 'square');
    await h.post('/api/global', { dimmer: 'linear' });
  });

  test('on ne dépasse jamais 8 couches ni ne descend sous 1', async () => {
    for (let i = 0; i < 20; i++) await h.post('/api/layers', { action: 'add' });
    assert.equal((await h.state()).layers.length, 8);
    for (const L of (await h.state()).layers) await h.post('/api/layers', { action: 'remove', id: L.id });
    assert.equal((await h.state()).layers.length, 1);
  });

  test('les fixtures sont bornées et normalisées', async () => {
    await h.post('/api/fixtures', { fixtures: [
      { id: 'a', name: 'X'.repeat(500), address: '/fixtures/a', x: 42, y: -3 },
      { name: 'sans id', address: '/fixtures/b' },
    ] });
    const fx = (await h.state()).fixtures;
    assert.equal(fx.length, 2);
    assert.equal(fx[0].name.length, 64);
    assert.equal(fx[0].x, 1);
    assert.equal(fx[0].y, 0);
    assert.ok(fx[1].id, 'un id doit être généré');
  });

  test('la carte MIDI rejette les clés mal formées', async () => {
    await h.post('/api/midimap', { map: {
      'cc:1:7': 'master', 'note:10:36': 'start',
      'sql; drop': 'evil', 'cc:1:7:extra': 'evil', 'cc:1:8': 'X'.repeat(200),
    } });
    const m = (await h.state()).midiMap;
    assert.deepEqual(Object.keys(m).sort(), ['cc:1:7', 'note:10:36']);
  });

  test('presets : sauvegarde, rappel, effacement', async () => {
    await h.post('/api/fixtures', { fixtures: fixtures(4) });
    const id = (await h.state()).layers[0].id;
    await h.post('/api/layer', { id, set: { stepMs: 111, name: 'Avant' } });
    await h.post('/api/preset', { action: 'save', slot: 2 });
    await h.post('/api/layer', { id, set: { stepMs: 999, name: 'Après' } });
    assert.equal((await h.state()).layers[0].stepMs, 999);
    await h.post('/api/preset', { action: 'recall', slot: 2 });
    assert.equal((await h.state()).layers[0].stepMs, 111);
    assert.equal((await h.state()).layers[0].name, 'Avant');
    await h.post('/api/preset', { action: 'clear', slot: 2 });
    assert.equal((await h.state()).presets[2], null);
  });

  test('un slot de preset hors bornes ne fait pas planter', async () => {
    const r = await h.post('/api/preset', { action: 'recall', slot: 9999 });
    assert.equal(r.body.ok, true);
    const r2 = await h.post('/api/preset', { action: 'recall', slot: -5 });
    assert.equal(r2.body.ok, true);
  });

  test('export puis import redonnent le même projet', async () => {
    await h.post('/api/project', { name: 'Spectacle Été #2' });
    const id = (await h.state()).layers[0].id;
    await h.post('/api/layer', { id, set: { stepMs: 321, phase: 90, floor: 0.25, blocks: 3 } });
    const exp = await h.get('/api/export');
    assert.match(exp.headers['content-disposition'], /filename="Spectacle-Ete-2\.json"/);
    await h.post('/api/new', { keepFixtures: false });
    assert.equal((await h.state()).layers[0].stepMs, 250);
    const r = await h.post('/api/import', exp.body);
    assert.equal(r.body.ok, true);
    const s = await h.state();
    assert.equal(s.layers[0].stepMs, 321);
    assert.equal(s.layers[0].phase, 90);
    assert.equal(s.layers[0].floor, 0.25);
    assert.equal(s.layers[0].blocks, 3);
    assert.equal(s.project.name, 'Spectacle Été #2');
  });

  test('un import malveillant est neutralisé', async () => {
    const r = await h.post('/api/import', {
      layers: [{ name: 'X', stepMs: -999, pattern: '../../evil', level: 'NaN' }],
      fixtures: [{ id: 'z', address: '/fixtures/z' }],
      global: { param: '../../../etc/passwd', master: 42 },
      presets: ['pas un preset', null, { layers: 'pas un tableau' }],
    });
    assert.equal(r.body.ok, true);
    const s = await h.state();
    assert.equal(s.layers[0].stepMs, 30);
    assert.ok(!s.global.param.includes('..'));
    assert.ok(s.global.master <= 1);
    assert.equal(s.presets.filter(Boolean).length, 0);
  });

  test('un import sans couches est refusé proprement', async () => {
    const r = await h.post('/api/import', { fixtures: [] });
    assert.equal(r.body.ok, false);
  });

  test('un corps JSON illisible ne bloque pas la requête', async () => {
    const raw = await new Promise((resolve, reject) => {
      const req = require('http').request({
        host: '127.0.0.1', port: h.port, path: '/api/global', method: 'POST',
        headers: { 'Content-Type': 'application/json' }, timeout: 4000,
      }, res => { let d = ''; res.on('data', c => d += c); res.on('end', () => resolve(d)); });
      req.on('error', reject);
      req.on('timeout', () => req.destroy(new Error('la requête n’a jamais répondu')));
      req.end('{ ceci n’est pas du JSON ');
    });
    assert.match(raw, /"ok":true/);
  });
});
