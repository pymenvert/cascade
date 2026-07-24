'use strict';
/**
 * Moteur : ce test écoute l'OSC RÉELLEMENT envoyé vers un faux MadMapper.
 * C'est le filet de sécurité principal avant un spectacle.
 */
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert');
const { start, sleep, fixtures } = require('./helpers.js');

/** Dernier niveau connu par barre, d'après le flux OSC. */
function levels(msgs, param = 'luminosity') {
  const out = new Map();
  for (const m of msgs) {
    const mm = new RegExp('^/fixtures/(bar\\d+)/' + param + '$').exec(m.address);
    if (mm) out.set(mm[1], m.args[0]);
  }
  return out;
}
const addressesTouched = (msgs) => new Set(msgs.map(m => m.address.split('/')[2]));

describe('Moteur', () => {
  let h, id;
  before(async () => {
    h = await start();
    await h.post('/api/fixtures', { fixtures: fixtures(4) });
    id = (await h.state()).layers[0].id;
  });
  after(async () => { await h.stop(); });

  const setL = (set) => h.post('/api/layer', { id, set });
  const reset = async () => {
    await h.post('/api/stop');
    await setL({ engine: 'steps', pattern: 'lr', mode: 'onoff', stepMs: 60, speed: 1,
      width: 1, group: 1, blocks: 1, phase: 0, swing: 0, floor: 0, sparkle: 0,
      oneShot: false, invert: false, level: 1, enabled: true, target: 'intensity', bars: null,
      mirrorH: false, mirrorV: false, axisX: 0.5, axisY: 0.5, curve: 'linear' });
    await h.post('/api/global', { master: 1, speed: 1, dimmer: 'linear' });
    await h.post('/api/blackout'); // repart d'un état connu (toutes les barres à 0)
    await sleep(60);
    h.clearOsc();
  };

  test('STOP n’envoie RIEN (MadMapper garde son état)', async () => {
    await reset();
    await h.post('/api/start');
    await sleep(200);
    await h.post('/api/stop');
    await sleep(60);
    h.clearOsc();
    await sleep(600); // largement plus que le keep-alive de 1 s ? non : on vérifie le silence
    assert.equal(h.osc().length, 0, 'aucun message OSC ne doit sortir à l’arrêt');
  });

  test('BLACKOUT force des zéros sur toutes les barres', async () => {
    await reset();
    await h.post('/api/start');
    await sleep(150);
    h.clearOsc();
    await h.post('/api/blackout');
    await sleep(100);
    const lv = levels(h.osc());
    assert.equal(lv.size, 4);
    for (const [bar, v] of lv) assert.equal(v, 0, bar + ' devrait être à zéro');
    assert.equal((await h.state()).global.running, false);
  });

  test('le chase défile : toutes les barres passent par l’allumage', async () => {
    await reset();
    await h.post('/api/start');
    await sleep(700); // ~11 pas à 60 ms
    await h.post('/api/stop');
    const seen = new Set();
    for (const m of h.osc()) {
      const mm = /^\/fixtures\/(bar\d+)\/luminosity$/.exec(m.address);
      if (mm && m.args[0] > 0.5) seen.add(mm[1]);
    }
    assert.equal(seen.size, 4, 'les 4 barres doivent s’allumer, vu : ' + [...seen]);
  });

  test('une seule barre allumée à la fois en pas-à-pas simple', async () => {
    await reset();
    await setL({ stepMs: 120, mode: 'onoff', width: 1 });
    await h.post('/api/start');
    await sleep(400);
    const lv = levels(h.osc());
    await h.post('/api/stop');
    const on = [...lv.values()].filter(v => v > 0.5).length;
    assert.ok(on <= 1, 'au plus une barre allumée, trouvé ' + on + ' — ' + JSON.stringify([...lv]));
  });

  test('« tous » allume les 4 barres ensemble', async () => {
    await reset();
    await setL({ pattern: 'all', stepMs: 150, mode: 'onoff', width: 1 });
    await h.post('/api/start');
    await sleep(200);
    const lv = levels(h.osc());
    await h.post('/api/stop');
    assert.equal([...lv.values()].filter(v => v > 0.5).length, 4);
  });

  test('niveau bas : les barres éteintes ne descendent jamais à zéro', async () => {
    await reset();
    await setL({ floor: 0.4, mode: 'onoff', stepMs: 80 });
    await h.post('/api/start');
    await sleep(500);
    const msgs = h.osc();
    await h.post('/api/stop');
    const mins = new Map();
    for (const m of msgs) {
      const mm = /^\/fixtures\/(bar\d+)\/luminosity$/.exec(m.address);
      if (mm) mins.set(mm[1], Math.min(mins.get(mm[1]) ?? 1, m.args[0]));
    }
    assert.equal(mins.size, 4);
    for (const [bar, v] of mins) assert.ok(v >= 0.39, bar + ' est descendu à ' + v);
  });

  test('blocs : le motif joue en parallèle sur les deux moitiés', async () => {
    await reset();
    await h.post('/api/fixtures', { fixtures: fixtures(8) });
    await setL({ blocks: 2, pattern: 'lr', mode: 'onoff', stepMs: 150, width: 1 });
    await h.post('/api/start');
    await sleep(220);
    const lv = levels(h.osc());
    await h.post('/api/stop');
    const on = [...lv.entries()].filter(([, v]) => v > 0.5).map(([b]) => b);
    assert.equal(on.length, 2, 'deux barres simultanées attendues, vu : ' + on);
    const nums = on.map(b => +b.replace('bar', '')).sort((a, b) => a - b);
    assert.ok(nums[0] < 4 && nums[1] >= 4, 'une barre par moitié attendue, vu : ' + nums);
    await h.post('/api/fixtures', { fixtures: fixtures(4) });
  });

  test('« une fois » : le motif joue un cycle puis se tait', async () => {
    await reset();
    await setL({ oneShot: true, mode: 'onoff', stepMs: 60, width: 1 });
    await h.post('/api/start');
    await sleep(300); // 4 barres × 60 ms = 240 ms : le cycle est fini
    h.clearOsc();
    await sleep(400);
    const lv = levels(h.osc());
    await h.post('/api/stop');
    for (const [bar, v] of lv) assert.equal(v, 0, bar + ' devrait être retombé après le cycle');
  });

  test('« une fois » repart au resync (GO)', async () => {
    await reset();
    await setL({ oneShot: true, mode: 'onoff', stepMs: 60 });
    await h.post('/api/start');
    await sleep(400);
    h.clearOsc();
    await h.post('/api/resync', { id });
    await sleep(300);
    await h.post('/api/stop');
    const allumées = h.osc().filter(m => /luminosity$/.test(m.address) && m.args[0] > 0.5);
    assert.ok(allumées.length >= 3, 'le GO doit relancer le cycle, vu ' + allumées.length + ' allumages');
  });

  test('le master atténue tout', async () => {
    await reset();
    await setL({ pattern: 'all', mode: 'onoff' });
    await h.post('/api/global', { master: 0.5 });
    await h.post('/api/start');
    await sleep(200);
    const lv = levels(h.osc());
    await h.post('/api/stop');
    const max = Math.max(...lv.values());
    assert.ok(Math.abs(max - 0.5) < 0.02, 'niveau max attendu ~0.5, vu ' + max);
  });

  test('la courbe carrée écrase les niveaux', async () => {
    await reset();
    await setL({ pattern: 'all', mode: 'onoff' });
    await h.post('/api/global', { master: 0.5, dimmer: 'square' });
    await h.post('/api/start');
    await sleep(200);
    const lv = levels(h.osc());
    await h.post('/api/stop');
    await h.post('/api/global', { dimmer: 'linear' });
    const max = Math.max(...lv.values());
    assert.ok(Math.abs(max - 0.25) < 0.02, '0.5² = 0.25 attendu, vu ' + max);
  });

  test('l’inversion allume ce qui était éteint', async () => {
    await reset();
    await setL({ invert: true, mode: 'onoff', stepMs: 150 });
    await h.post('/api/start');
    await sleep(200);
    const lv = levels(h.osc());
    await h.post('/api/stop');
    assert.equal([...lv.values()].filter(v => v > 0.5).length, 3, '3 barres sur 4 allumées');
  });

  test('une couche désactivée n’émet rien', async () => {
    await reset();
    await setL({ enabled: false });
    await h.post('/api/start');
    await sleep(300);
    const msgs = h.osc();
    await h.post('/api/stop');
    const lv = levels(msgs);
    for (const [, v] of lv) assert.equal(v, 0);
  });

  test('une couche restreinte à 2 barres ne touche que celles-là', async () => {
    await reset();
    await setL({ bars: ['f0', 'f1'], pattern: 'all', mode: 'onoff' });
    await h.post('/api/start');
    await sleep(250);
    const lv = levels(h.osc());
    await h.post('/api/stop');
    assert.ok(lv.get('bar0') > 0.5 && lv.get('bar1') > 0.5);
    assert.ok(!(lv.get('bar2') > 0), 'bar2 ne doit jamais s’allumer');
    assert.ok(!(lv.get('bar3') > 0), 'bar3 ne doit jamais s’allumer');
  });

  test('le moteur vague sort des valeurs continues', async () => {
    await reset();
    await setL({ engine: 'wave', pattern: 'lr', waveform: 'sine', stepMs: 200, group: 4, width: 4 });
    await h.post('/api/start');
    await sleep(500);
    const msgs = h.osc();
    await h.post('/api/stop');
    const vals = msgs.filter(m => /bar0\/luminosity$/.test(m.address)).map(m => m.args[0]);
    assert.ok(vals.length > 5, 'la vague doit produire un flux de valeurs');
    const intermédiaires = vals.filter(v => v > 0.1 && v < 0.9).length;
    assert.ok(intermédiaires > 2, 'des valeurs intermédiaires sont attendues, vu ' + intermédiaires);
  });

  test('les couches couleur envoient du RGB', async () => {
    await reset();
    await setL({ target: 'color', pattern: 'all', colorA: '#ff0000', colorB: '#00ff00', mode: 'onoff' });
    await h.post('/api/start');
    await sleep(250);
    const msgs = h.osc();
    await h.post('/api/stop');
    assert.ok(msgs.some(m => /\/color\/red$/.test(m.address)));
    assert.ok(msgs.some(m => /\/color\/green$/.test(m.address)));
    assert.ok(msgs.some(m => /\/color\/blue$/.test(m.address)));
    // Couche couleur seule : l'intensité est forcée au master pour rester visible
    const lum = levels(msgs);
    assert.ok(Math.max(...lum.values()) > 0.9);
  });

  test('changer le tempo en direct ne provoque ni rafale ni trou', async () => {
    await reset();
    // Motif défilant : bar0 s'allume une fois par tour de 4 pas — c'est
    // mesurable, contrairement à « tous » où la barre reste allumée en continu.
    await setL({ stepMs: 200, mode: 'onoff', pattern: 'lr', width: 1 });
    await h.post('/api/start');
    await sleep(500);
    h.clearOsc();
    await setL({ stepMs: 100 });        // tempo doublé en plein show
    await sleep(1000);                  // 10 pas = 2,5 tours à 4 barres
    const msgs = h.osc();
    await h.post('/api/stop');
    const allumages = msgs.filter(m => /bar0\/luminosity$/.test(m.address) && m.args[0] > 0.5).length;
    // Attendu : 2 à 3 allumages (un tour = 400 ms). 0 = moteur figé, >6 = rafale.
    assert.ok(allumages >= 2 && allumages <= 6,
      'allumages de bar0 attendus entre 2 et 6, vu ' + allumages);
  });

  // Régression : les enveloppes en cours étaient datées sur l'ANCIENNE échelle
  // de temps. En accélérant, une barre devenait « trop vieille » pour son
  // enveloppe raccourcie et s'éteignait le temps d'un pas — un clignotement
  // visible à chaque TAP, ÷2, ×2 ou dérive de BPM Link.
  for (const [nom, base] of [
    ['ON/OFF', { mode: 'onoff', width: 1 }],
    ['ON/OFF tenue 2', { mode: 'onoff', width: 2 }],
    ['fondu', { mode: 'fade', width: 1, fadeInPct: 10, fadeOutPct: 50 }],
  ]) {
    test(`malmener le tempo n’éteint aucune barre (${nom})`, async () => {
      await reset();
      // « tous » : toutes les barres restent allumées en continu, donc tout
      // zéro émis est forcément un trou et pas le motif qui défile.
      await setL({ pattern: 'all', stepMs: 300, ...base });
      await h.post('/api/blackout');
      await sleep(80);
      await h.post('/api/start');
      await sleep(500);
      h.clearOsc();
      let creux = [];
      for (const ms of [150, 90, 260, 120, 200, 70, 310, 100, 180, 60]) {
        await setL({ stepMs: ms });
        await sleep(160);
        creux = creux.concat(h.osc().filter(m => /luminosity$/.test(m.address) && m.args[0] === 0));
        h.clearOsc();
      }
      await h.post('/api/stop');
      assert.equal(creux.length, 0,
        creux.length + ' extinction(s) pendant les changements de tempo : '
        + JSON.stringify(creux.slice(0, 3)));
    });
  }

  test('le paramètre de sortie est respecté (dimmer au lieu de luminosity)', async () => {
    await reset();
    await h.post('/api/global', { param: 'dimmer' });
    await setL({ pattern: 'all', mode: 'onoff' });
    await h.post('/api/start');
    await sleep(200);
    const msgs = h.osc();
    await h.post('/api/stop');
    await h.post('/api/global', { param: 'luminosity' });
    assert.ok(msgs.some(m => /\/dimmer$/.test(m.address)));
    assert.ok(!msgs.some(m => /\/luminosity$/.test(m.address)));
  });

  test('zéro fixture : le moteur tourne sans planter', async () => {
    await reset();
    await h.post('/api/fixtures', { fixtures: [] });
    await h.post('/api/start');
    await sleep(300);
    const r = await h.get('/api/ping');
    await h.post('/api/stop');
    await h.post('/api/fixtures', { fixtures: fixtures(4) });
    assert.equal(r.body.app, 'Cascade', 'le serveur doit toujours répondre');
  });

  test('une seule fixture : pas de division par zéro', async () => {
    await reset();
    await h.post('/api/fixtures', { fixtures: fixtures(1) });
    for (const pattern of ['lr', 'rl', 'pingpong', 'random', 'evenodd', 'all']) {
      await setL({ pattern, mode: 'onoff', stepMs: 40 });
      await h.post('/api/start');
      await sleep(120);
    }
    await h.post('/api/stop');
    const lv = levels(h.osc());
    assert.ok([...lv.values()].every(v => Number.isFinite(v)), 'aucune valeur non finie');
    await h.post('/api/fixtures', { fixtures: fixtures(4) });
  });

  test('tous les patterns tournent sans valeur aberrante', async () => {
    await reset();
    for (const engine of ['steps', 'wave']) {
      const pats = engine === 'steps'
        ? ['lr', 'rl', 'pingpong', 'random', 'evenodd', 'all']
        : ['lr', 'rl', 'tb', 'bt', 'pulse', 'radial'];
      for (const pattern of pats) {
        await setL({ engine, pattern, mode: 'fade', stepMs: 50, mirrorH: true, mirrorV: true });
        await h.post('/api/start');
        await sleep(120);
      }
    }
    await h.post('/api/stop');
    // On ne regarde que les valeurs envoyées aux fixtures : les interrogations
    // périodiques de MadMapper (/getControl…) n'ont pas d'argument.
    const bad = h.osc()
      .filter(m => /^\/fixtures\//.test(m.address))
      .filter(m => !Number.isFinite(m.args[0]) || m.args[0] < 0 || m.args[0] > 1);
    assert.equal(bad.length, 0, 'valeurs hors [0,1] : ' + JSON.stringify(bad.slice(0, 3)));
    await setL({ mirrorH: false, mirrorV: false });
  });
});
