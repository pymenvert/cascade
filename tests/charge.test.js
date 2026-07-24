'use strict';
/**
 * Endurance et charge — le test qui répond à « est-ce que ça tient un show ? ».
 * Configuration maximale (8 couches × 128 barres, toutes les fonctions activées),
 * requêtes concurrentes, changements brutaux, et vérification que le serveur
 * répond toujours, sans fuite ni valeur aberrante.
 */
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert');
const { start, sleep, fixtures } = require('./helpers.js');

const PATTERNS = ['lr', 'rl', 'pingpong', 'random', 'evenodd', 'all'];

describe('Charge et endurance', () => {
  let h, ids;
  before(async () => {
    h = await start();
    await h.post('/api/fixtures', { fixtures: fixtures(128) });
    for (let i = 1; i < 8; i++) await h.post('/api/layers', { action: 'add' });
    ids = (await h.state()).layers.map(l => l.id);
    // Configuration « tout allumé » : chaque couche exploite des fonctions différentes
    for (let i = 0; i < ids.length; i++) {
      await h.post('/api/layer', { id: ids[i], set: {
        engine: i % 3 === 2 ? 'wave' : 'steps',
        pattern: PATTERNS[i % PATTERNS.length],
        target: i === 7 ? 'color' : 'intensity',
        mode: 'fade', curve: ['linear', 'easeIn', 'easeOut', 'easeInOut', 'expo'][i % 5],
        stepMs: 40 + i * 25, width: 1 + (i % 4), group: 1 + (i % 3), blocks: 1 + (i % 4),
        phase: i * 45, swing: (i % 3) * 25 - 25, floor: (i % 4) * 0.1,
        sparkle: (i % 3) * 0.25, mirrorH: i % 2 === 0, mirrorV: i % 3 === 0,
        fadeInPct: 10 + i * 5, fadeOutPct: 50 + i * 30, level: 0.5 + i * 0.06,
      } });
    }
    assert.equal((await h.state()).layers.length, 8);
  });
  after(async () => { await h.stop(); });

  test('8 couches × 128 barres tournent sans valeur aberrante', async () => {
    h.clearOsc();
    await h.post('/api/start');
    await sleep(4000);
    const msgs = h.osc();
    await h.post('/api/stop');
    assert.ok(msgs.length > 500, 'flux OSC trop maigre : ' + msgs.length);
    const bad = msgs.filter(m => typeof m.args[0] === 'number'
      && (!Number.isFinite(m.args[0]) || m.args[0] < 0 || m.args[0] > 1));
    assert.equal(bad.length, 0, 'valeurs hors [0,1] : ' + JSON.stringify(bad.slice(0, 3)));
    const barres = new Set(msgs.map(m => m.address.split('/')[2]));
    assert.ok(barres.size > 100, 'seulement ' + barres.size + ' barres touchées sur 128');
  });

  test('le serveur reste réactif pendant le show', async () => {
    await h.post('/api/start');
    const mesures = [];
    for (let i = 0; i < 25; i++) {
      const t = Date.now();
      await h.get('/api/state');
      mesures.push(Date.now() - t);
      await sleep(40);
    }
    await h.post('/api/stop');
    const pire = Math.max(...mesures);
    const moy = mesures.reduce((a, b) => a + b, 0) / mesures.length;
    assert.ok(pire < 500, 'réponse la plus lente : ' + pire + ' ms (moyenne ' + moy.toFixed(0) + ')');
  });

  test('50 requêtes simultanées ne cassent rien', async () => {
    await h.post('/api/start');
    const paquet = [];
    for (let i = 0; i < 50; i++) {
      const id = ids[i % ids.length];
      paquet.push(h.post('/api/layer', { id, set: { stepMs: 60 + i, level: (i % 10) / 10 } }));
      paquet.push(h.get('/api/state'));
    }
    const res = await Promise.all(paquet);
    await h.post('/api/stop');
    assert.ok(res.every(r => r.status === 200), 'toutes les réponses doivent être 200');
  });

  test('rappels de presets en rafale pendant le show', async () => {
    for (let s = 0; s < 4; s++) {
      await h.post('/api/layer', { id: ids[0], set: { stepMs: 100 + s * 50 } });
      await h.post('/api/preset', { action: 'save', slot: s });
    }
    await h.post('/api/start');
    h.clearOsc();
    for (let i = 0; i < 30; i++) {
      await h.post('/api/preset', { action: 'recall', slot: i % 4 });
      await sleep(25);
    }
    await sleep(300);
    const msgs = h.osc();
    await h.post('/api/stop');
    assert.equal((await h.get('/api/ping')).body.app, 'Cascade');
    const bad = msgs.filter(m => typeof m.args[0] === 'number' && !Number.isFinite(m.args[0]));
    assert.equal(bad.length, 0);
  });

  test('changements de scéno répétés : pas de fuite dans les caches', async () => {
    await h.post('/api/start');
    for (let i = 0; i < 12; i++) {
      // On remplace complètement les fixtures : les anciens identifiants
      // disparaissent et ne doivent laisser aucune trace en mémoire.
      const fx = Array.from({ length: 40 }, (_, k) => ({
        id: 'gen' + i + '_' + k, name: 'B' + k, address: '/fixtures/g' + i + '_' + k,
        enabled: true, x: k / 39, y: 0.5, rot: 0,
      }));
      await h.post('/api/fixtures', { fixtures: fx });
      await sleep(80);
    }
    await h.post('/api/stop');
    const s = await h.state();
    assert.equal(s.fixtures.length, 40);
    assert.equal(s.levels.length, 40, 'la préview doit suivre la scéno courante');
    assert.equal((await h.get('/api/ping')).body.app, 'Cascade');
    await h.post('/api/fixtures', { fixtures: fixtures(128) });
  });

  test('START/STOP/BLACKOUT en rafale (doigt nerveux sur la console)', async () => {
    for (let i = 0; i < 40; i++) {
      await h.post(['/api/start', '/api/stop', '/api/blackout'][i % 3]);
    }
    await h.post('/api/stop');
    assert.equal((await h.state()).global.running, false);
    assert.equal((await h.get('/api/ping')).body.app, 'Cascade');
  });

  test('aucune erreur n’a été écrite dans le journal du serveur', () => {
    const journal = h.logs.join('');
    const erreurs = journal.split('\n').filter(l =>
      /erreur inattendue|promesse rejetée|erreur moteur|Error:|TypeError|RangeError/.test(l));
    assert.equal(erreurs.length, 0, 'le serveur a signalé :\n' + erreurs.join('\n'));
  });
});
