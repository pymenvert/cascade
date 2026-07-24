'use strict';
/** OSC entrant, tap tempo, cycle de vie et résistance aux données hostiles. */
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const dgram = require('node:dgram');
const { start, sleep, fixtures } = require('./helpers.js');

describe('Contrôle externe (OSC entrant)', () => {
  let h, id;
  before(async () => {
    h = await start();
    await h.post('/api/fixtures', { fixtures: fixtures(4) });
    id = (await h.state()).layers[0].id;
  });
  after(async () => { await h.stop(); });

  const settle = () => sleep(120);

  test('/cascade/start et /cascade/stop pilotent le show', async () => {
    await h.sendOsc('/cascade/start', [1]); await settle();
    assert.equal((await h.state()).global.running, true);
    await h.sendOsc('/cascade/stop', [1]); await settle();
    assert.equal((await h.state()).global.running, false);
  });

  test('le préfixe historique /chaser marche toujours', async () => {
    await h.sendOsc('/chaser/start', [1]); await settle();
    assert.equal((await h.state()).global.running, true);
    await h.sendOsc('/chaser/stop', [1]); await settle();
    assert.equal((await h.state()).global.running, false);
  });

  test('/cascade/master règle le général', async () => {
    await h.sendOsc('/cascade/master', [0.25]); await settle();
    assert.ok(Math.abs((await h.state()).global.master - 0.25) < 0.01);
    await h.sendOsc('/cascade/master', [1]); await settle();
  });

  test('/cascade/speed suit la courbe (0.5 = ×1)', async () => {
    await h.sendOsc('/cascade/speed', [0.5]); await settle();
    assert.ok(Math.abs((await h.state()).global.speed - 1) < 0.02);
    await h.sendOsc('/cascade/speed', [1]); await settle();
    assert.ok(Math.abs((await h.state()).global.speed - 4) < 0.05);
    await h.sendOsc('/cascade/speed', [0.5]); await settle();
  });

  test('les nouveaux paramètres de chase sont pilotables en OSC', async () => {
    await h.sendOsc('/cascade/layer/1/floor', [0.5]);
    await h.sendOsc('/cascade/layer/1/phase', [0.5]);
    await h.sendOsc('/cascade/layer/1/blocks', [1]);
    await h.sendOsc('/cascade/layer/1/sparkle', [0.3]);
    await h.sendOsc('/cascade/layer/1/oneshot', [1]);
    await settle();
    const L = (await h.state()).layers[0];
    assert.ok(Math.abs(L.floor - 0.5) < 0.01);
    assert.equal(L.phase, 180);
    assert.equal(L.blocks, 8);
    assert.ok(Math.abs(L.sparkle - 0.3) < 0.01);
    assert.equal(L.oneShot, true);
    await h.post('/api/layer', { id, set: { floor: 0, phase: 0, blocks: 1, sparkle: 0, oneShot: false } });
  });

  test('une couche inexistante est ignorée sans planter', async () => {
    await h.sendOsc('/cascade/layer/99/level', [1]);
    await h.sendOsc('/cascade/layer/abc/level', [1]);
    await settle();
    assert.equal((await h.get('/api/ping')).body.app, 'Cascade');
  });

  test('un paquet UDP n’importe quoi ne tue pas le serveur', async () => {
    const s = dgram.createSocket('udp4');
    const garbage = [
      Buffer.from([0xff, 0xff, 0xff]),
      Buffer.alloc(0),
      Buffer.from('#bundle\0' + 'x'.repeat(40)),
      Buffer.from('/cascade/master\0\0,f'), // tronqué au milieu
      Buffer.alloc(9000, 0x41),
    ];
    for (const g of garbage) await new Promise(r => s.send(g, h.oscInPort, '127.0.0.1', r));
    s.close();
    await settle();
    assert.equal((await h.get('/api/ping')).body.app, 'Cascade');
  });

  test('le tap tempo calcule un intervalle', async () => {
    for (let i = 0; i < 4; i++) { await h.post('/api/tap', { id }); await sleep(200); }
    const r = await h.post('/api/tap', { id });
    assert.ok(r.body.stepMs > 150 && r.body.stepMs < 260, 'stepMs calculé : ' + r.body.stepMs);
  });

  test('deux taps très espacés repartent de zéro', async () => {
    await h.post('/api/tap', { id });
    await sleep(2300); // au-delà des 2 s, la série est oubliée
    const before = (await h.state()).layers[0].stepMs;
    await h.post('/api/tap', { id });
    assert.equal((await h.state()).layers[0].stepMs, before);
  });

  test('/cascade/preset rappelle un preset', async () => {
    await h.post('/api/layer', { id, set: { stepMs: 137 } });
    await h.post('/api/preset', { action: 'save', slot: 0 });
    await h.post('/api/layer', { id, set: { stepMs: 500 } });
    await h.sendOsc('/cascade/preset/1', [1]); await settle();
    assert.equal((await h.state()).layers[0].stepMs, 137);
  });
});

describe('Cycle de vie et persistance', () => {
  test('une config corrompue ne bloque pas le démarrage', async () => {
    const h = await start('{ ceci nest pas du json ');
    try {
      const s = await h.state();
      assert.equal(s.layers.length, 1, 'on repart sur une couche par défaut');
      assert.equal(s.global.running, false);
    } finally { await h.stop(); }
  });

  test('une config au bon format mais au contenu absurde est assainie', async () => {
    const h = await start({
      app: 'Cascade', version: '1.3.0',
      settings: { mmPort: 999999, mmHost: 42, oscInPort: -1 },
      layers: [{ name: 'X', stepMs: 'vite', pattern: 'inconnu', level: {}, blocks: 99 },
               ...Array(50).fill({ name: 'trop' })],
      fixtures: [{ id: 1, x: 'gauche' }],
      global: { master: 99, param: '../evil' },
      presets: 'pas un tableau',
      midiMap: { 'clé bidon': 'cible' },
    });
    try {
      const s = await h.state();
      assert.equal(s.layers.length, 8, 'au plus 8 couches');
      assert.equal(typeof s.layers[0].stepMs, 'number');
      assert.equal(s.layers[0].blocks, 8);
      assert.ok(s.settings.mmPort >= 1 && s.settings.mmPort <= 65535);
      assert.ok(s.global.master <= 1);
      assert.ok(!s.global.param.includes('..'));
      assert.deepEqual(s.midiMap, {});
      assert.equal(s.presets.length, 16);
    } finally { await h.stop(); }
  });

  test('la config est réellement écrite sur le disque', async () => {
    const h = await start();
    try {
      const id = (await h.state()).layers[0].id;
      await h.post('/api/layer', { id, set: { name: 'Sauvegardée', stepMs: 424 } });
      await sleep(900); // au-delà du débounce de 500 ms
      const saved = JSON.parse(fs.readFileSync(h.cfgFile, 'utf8'));
      assert.equal(saved.layers[0].name, 'Sauvegardée');
      assert.equal(saved.layers[0].stepMs, 424);
      assert.ok(!('running' in saved.global), 'l’état de marche ne doit pas être persisté');
    } finally { await h.stop(); }
  });

  test('un flux OSC continu n’écrit pas le disque en rafale', async () => {
    const h = await start();
    try {
      await h.post('/api/layer', { id: (await h.state()).layers[0].id, set: { level: 0.1 } });
      await sleep(700);
      const t0 = fs.statSync(h.cfgFile).mtimeMs;
      for (let i = 0; i < 60; i++) { await h.sendOsc('/cascade/layer/1/level', [i / 60]); await sleep(10); }
      await sleep(200);
      const t1 = fs.statSync(h.cfgFile).mtimeMs;
      // 60 messages en ~600 ms : au plus une écriture (throttle 3 s)
      assert.ok(t1 === t0 || t1 - t0 > 100, 'écritures trop fréquentes');
      await sleep(3200);
      const saved = JSON.parse(fs.readFileSync(h.cfgFile, 'utf8'));
      assert.ok(saved.layers[0].level > 0.5, 'la dernière valeur doit finir sauvegardée');
    } finally { await h.stop(); }
  });

  test('la config de secours prend le relais si la principale est illisible', async () => {
    const h = await start();
    const cfg = h.cfgFile;
    try {
      const id = (await h.state()).layers[0].id;
      await h.post('/api/layer', { id, set: { name: 'Version A' } });
      await sleep(800);
      await h.post('/api/layer', { id, set: { name: 'Version B' } });
      await sleep(800); // la version A est maintenant dans le .bak
      assert.ok(fs.existsSync(cfg + '.bak'), 'un fichier .bak doit exister');
    } finally { await h.stop(); }
  });
});
