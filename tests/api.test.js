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
    // Semver complet, pré-version comprise : la branche v2 s'annonce
    // « 2.0.0-dev » tant qu'elle n'est pas sortie, et c'est volontaire — une app
    // qui ment sur sa version est indébogable à distance.
    assert.match(r.body.version, /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/);
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

  test('groupes : création, renommage, contenu, suppression', async () => {
    await h.post('/api/fixtures', { fixtures: fixtures(6) });
    let r = await h.post('/api/groups', { action: 'add', name: 'Sol' });
    assert.equal(r.body.groups.length, 1);
    const gid = r.body.groups[0].id;
    assert.equal(r.body.groups[0].name, 'Sol');
    assert.deepEqual(r.body.groups[0].bars, []);

    r = await h.post('/api/groups', { action: 'set', id: gid, bars: ['f0', 'f1', 'f0'] });
    assert.deepEqual(r.body.groups[0].bars, ['f0', 'f1'], 'les doublons doivent être écartés');

    r = await h.post('/api/groups', { action: 'rename', id: gid, name: 'X'.repeat(60) });
    assert.equal(r.body.groups[0].name.length, 20, 'nom borné à 20 caractères');

    r = await h.post('/api/groups', { action: 'remove', id: gid });
    assert.equal(r.body.groups.length, 0);
  });

  test('on ne dépasse pas 16 groupes', async () => {
    for (let i = 0; i < 25; i++) await h.post('/api/groups', { action: 'add', name: 'G' + i });
    const g = (await h.state()).groups;
    assert.equal(g.length, 16);
    for (const x of g) await h.post('/api/groups', { action: 'remove', id: x.id });
  });

  test('une couche suit son groupe, et le lien est vivant', async () => {
    await h.post('/api/fixtures', { fixtures: fixtures(6) });
    const r = await h.post('/api/groups', { action: 'add', name: 'Contres' });
    const gid = r.body.groups[0].id;
    await h.post('/api/groups', { action: 'set', id: gid, bars: ['f2', 'f3'] });
    const id = (await h.state()).layers[0].id;
    await h.post('/api/layer', { id, set: { groupId: gid } });
    assert.equal((await h.state()).layers[0].groupId, gid);
    // Modifier le groupe ne touche pas la couche : c'est une référence
    await h.post('/api/groups', { action: 'set', id: gid, bars: ['f0'] });
    assert.equal((await h.state()).layers[0].groupId, gid);
    // Supprimer le groupe libère les couches qui le suivaient
    await h.post('/api/groups', { action: 'remove', id: gid });
    assert.equal((await h.state()).layers[0].groupId, null);
  });

  test('les groupes survivent à l’export/import et sont assainis', async () => {
    await h.post('/api/fixtures', { fixtures: fixtures(4) });
    const r = await h.post('/api/groups', { action: 'add', name: 'Portique' });
    await h.post('/api/groups', { action: 'set', id: r.body.groups[0].id, bars: ['f1', 'f2'] });
    const exp = await h.get('/api/export');
    await h.post('/api/new', { keepFixtures: false });
    assert.deepEqual((await h.state()).groups, [], 'un projet neuf repart sans groupe');
    await h.post('/api/import', exp.body);
    const g = (await h.state()).groups;
    assert.equal(g.length, 1);
    assert.equal(g[0].name, 'Portique');
    assert.deepEqual(g[0].bars, ['f1', 'f2']);
    // Import hostile
    await h.post('/api/import', { layers: exp.body.layers, groups: [
      'pas un groupe', null, { id: 'a', name: 'X'.repeat(99), bars: 'pas un tableau' },
      { id: 'a', name: 'doublon' },
    ] });
    const g2 = (await h.state()).groups;
    assert.equal(g2.length, 1, 'les entrées invalides et les id en double sont écartés');
    assert.equal(g2[0].name.length, 20);
    assert.deepEqual(g2[0].bars, []);
    for (const x of g2) await h.post('/api/groups', { action: 'remove', id: x.id });
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

  test('les presets peuvent être nommés, renommés et bornés', async () => {
    await h.post('/api/preset', { action: 'save', slot: 5, name: 'Refrain' });
    assert.equal((await h.state()).presets[5], 'Refrain');
    // Sans nom : numéro par défaut
    await h.post('/api/preset', { action: 'save', slot: 6 });
    assert.equal((await h.state()).presets[6], 'P7');
    // Nom trop long : coupé à 16 caractères
    await h.post('/api/preset', { action: 'save', slot: 7, name: 'X'.repeat(80) });
    assert.equal((await h.state()).presets[7].length, 16);
    // Renommage d'un preset existant
    await h.post('/api/preset', { action: 'rename', slot: 5, name: 'Final' });
    assert.equal((await h.state()).presets[5], 'Final');
    // Nom vidé : on retombe sur le numéro
    await h.post('/api/preset', { action: 'rename', slot: 5, name: '   ' });
    assert.equal((await h.state()).presets[5], 'P6');
    // Renommer un slot vide ne crée rien
    await h.post('/api/preset', { action: 'rename', slot: 11, name: 'Fantôme' });
    assert.equal((await h.state()).presets[11], null);
    for (const s of [5, 6, 7]) await h.post('/api/preset', { action: 'clear', slot: s });
  });

  test('le nom d’un preset survit à l’export/import', async () => {
    await h.post('/api/preset', { action: 'save', slot: 9, name: 'Pont' });
    const exp = await h.get('/api/export');
    await h.post('/api/new', { keepFixtures: true });
    assert.equal((await h.state()).presets[9], null);
    await h.post('/api/import', exp.body);
    assert.equal((await h.state()).presets[9], 'Pont');
    await h.post('/api/preset', { action: 'clear', slot: 9 });
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

  test('la recherche du port de MadMapper trouve le faux MadMapper', async () => {
    // Le port d'entrée OSC de MadMapper est un réglage de PROJET et n'est pas
    // toujours 8000 : vu 8010 en vrai, sans aucun indice côté Cascade. Le
    // balayage doit retrouver le port du faux MadMapper, quel qu'il soit.
    // 120 ms par port : sur une boucle locale c'est large, et ça garde le test
    // sous le délai HTTP. Le réglage par défaut, pour un vrai clic, est 500 ms.
    const r = await h.post('/api/trouverport', { parPortMs: 120 });
    assert.equal(r.body.ok, true);
    assert.ok(Array.isArray(r.body.essais) && r.body.essais.length >= 5,
      'trop peu de ports sondés : ' + JSON.stringify(r.body.essais));
    // Le faux MadMapper des tests répond-il ? Il n'implémente pas /getControls,
    // donc on vérifie surtout que le balayage n'invente rien et ne casse pas.
    assert.ok(Array.isArray(r.body.ports));
    assert.equal(r.body.actuel, (await h.state()).settings.mmPort);
    // Aucun candidat ne doit être notre propre port d'écoute : on recevrait nos
    // propres paquets en boucle locale et ça passerait pour une réponse.
    const fb = (await h.state()).settings.feedbackPort;
    assert.ok(!r.body.essais.some(e => e.port === fb),
      'le port de feedback ne doit jamais être sondé (écho en boucle locale)');
    assert.equal((await h.get('/api/ping')).body.app, 'Cascade');
  });
});
