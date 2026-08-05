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
    await sleep(1200);
    // ⚠ Cascade interroge MadMapper toutes les 3 s pour savoir s'il répond,
    // même à l'arrêt : c'est voulu, et ça n'allume rien. On ne juge donc que
    // ce qui pilote les fixtures. Compter TOUS les messages faisait échouer ce
    // test environ une fois sur cinq, au hasard du sondage.
    const versFixtures = h.osc().filter(m => /^\/fixtures\//.test(m.address));
    assert.deepEqual(versFixtures, [],
      'aucune valeur ne doit être envoyée aux barres à l’arrêt');
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

  test('une couche qui suit un groupe ne touche que ses barres', async () => {
    await reset();
    const r = await h.post('/api/groups', { action: 'add', name: 'Deux' });
    const gid = r.body.groups[0].id;
    await h.post('/api/groups', { action: 'set', id: gid, bars: ['f1', 'f2'] });
    await setL({ groupId: gid, pattern: 'all', mode: 'onoff' });
    await h.post('/api/start');
    await sleep(250);
    const lv = levels(h.osc());
    await h.post('/api/stop');
    assert.ok(lv.get('bar1') > 0.5 && lv.get('bar2') > 0.5, 'les barres du groupe doivent s’allumer');
    assert.ok(!(lv.get('bar0') > 0), 'bar0 est hors groupe');
    assert.ok(!(lv.get('bar3') > 0), 'bar3 est hors groupe');
    await h.post('/api/groups', { action: 'remove', id: gid });
  });

  test('modifier le groupe change immédiatement ce que joue la couche', async () => {
    await reset();
    const r = await h.post('/api/groups', { action: 'add', name: 'Vivant' });
    const gid = r.body.groups[0].id;
    await h.post('/api/groups', { action: 'set', id: gid, bars: ['f0'] });
    await setL({ groupId: gid, pattern: 'all', mode: 'onoff' });
    await h.post('/api/start');
    await sleep(200);
    assert.ok(levels(h.osc()).get('bar0') > 0.5);
    // On déplace le groupe sur une autre barre, SANS toucher à la couche
    h.clearOsc();
    await h.post('/api/groups', { action: 'set', id: gid, bars: ['f3'] });
    await sleep(250);
    const lv = levels(h.osc());
    await h.post('/api/stop');
    assert.ok(lv.get('bar3') > 0.5, 'la nouvelle barre du groupe doit s’allumer');
    assert.equal(lv.get('bar0'), 0, 'l’ancienne doit s’éteindre');
    await h.post('/api/groups', { action: 'remove', id: gid });
  });

  test('un groupe vide ou disparu ne rend pas la couche muette', async () => {
    await reset();
    const r = await h.post('/api/groups', { action: 'add', name: 'Vide' });
    const gid = r.body.groups[0].id;
    await setL({ groupId: gid, pattern: 'all', mode: 'onoff' });
    await h.post('/api/start');
    await sleep(250);
    const lv = levels(h.osc());
    await h.post('/api/stop');
    // Mieux vaut éclairer trop que rester noir sans explication
    assert.equal([...lv.values()].filter(v => v > 0.5).length, 4,
      'un groupe vide doit retomber sur toutes les barres');
    await h.post('/api/groups', { action: 'remove', id: gid });
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
    // ⚠ Le garde de taille N'EST PAS décoratif : `.every()` est VRAI sur un
    // tableau vide. Sans lui, un moteur qui n'émet plus rien du tout — c'est-à-
    // dire exactement la panne que ce test cherche — passerait au vert.
    assert.ok(lv.size > 0, 'le moteur n’a rien émis : le test ne mesurerait rien');
    assert.ok([...lv.values()].every(v => Number.isFinite(v)), 'aucune valeur non finie');
    await h.post('/api/fixtures', { fixtures: fixtures(4) });
  });

  // ── Fondu entre presets ────────────────────────────────────────────────
  // On compare deux scènes volontairement opposées : preset A = tout allumé,
  // preset B = tout éteint. Le niveau observé doit descendre progressivement
  // au lieu de tomber d'un coup.
  const preparerFondu = async () => {
    await reset();
    await setL({ pattern: 'all', mode: 'onoff', stepMs: 500, width: 8, level: 1 });
    await h.post('/api/preset', { action: 'save', slot: 12, name: 'Plein' });
    await setL({ level: 0 });
    await h.post('/api/preset', { action: 'save', slot: 13, name: 'Vide' });
  };
  // Niveau réel des barres à cet instant : dernière valeur reçue par barre.
  // (Compter sur une tranche des N derniers messages est trompeur — leur
  // nombre dépend du nombre de barres qui viennent de changer.)
  const niveauActuel = () => {
    const lv = levels(h.osc());
    return lv.size ? Math.max(...lv.values()) : 0;
  };

  test('à 0, le rappel de preset reste sec', async () => {
    await preparerFondu();
    await h.post('/api/global', { presetFade: 0 });
    await h.post('/api/preset', { action: 'recall', slot: 12 });
    await h.post('/api/start');
    await sleep(300);
    h.clearOsc();
    await h.post('/api/preset', { action: 'recall', slot: 13 });
    await sleep(150);
    const msgs = h.osc();
    await h.post('/api/stop');
    // Sans fondu : on passe directement à zéro, aucune valeur intermédiaire
    const inter = msgs.filter(m => /luminosity$/.test(m.address) && m.args[0] > 0.05 && m.args[0] < 0.95);
    assert.equal(inter.length, 0, 'valeurs intermédiaires inattendues : ' + inter.length);
    assert.equal(niveauActuel(), 0, 'la scène devrait être éteinte');
  });

  test('avec un fondu, le niveau descend progressivement', async () => {
    await preparerFondu();
    await h.post('/api/global', { presetFade: 1500 });
    await h.post('/api/preset', { action: 'recall', slot: 12 });
    await h.post('/api/start');
    await sleep(300);
    h.clearOsc();
    await h.post('/api/preset', { action: 'recall', slot: 13 });
    await sleep(700); // à peu près la moitié du fondu
    const milieu = niveauActuel();
    await sleep(1200); // le fondu est terminé
    const fin = niveauActuel();
    await h.post('/api/stop');
    await h.post('/api/global', { presetFade: 0 });
    assert.ok(milieu > 0.15 && milieu < 0.85,
      'à mi-fondu on attend un niveau intermédiaire, vu ' + milieu);
    assert.ok(fin < 0.05, 'à la fin du fondu la scène doit être éteinte, vu ' + fin);
  });

  test('le fondu est décroissant, sans à-coup', async () => {
    await preparerFondu();
    await h.post('/api/global', { presetFade: 1200 });
    await h.post('/api/preset', { action: 'recall', slot: 12 });
    await h.post('/api/start');
    await sleep(300);
    h.clearOsc();
    await h.post('/api/preset', { action: 'recall', slot: 13 });
    const releves = [];
    for (let i = 0; i < 6; i++) { await sleep(200); releves.push(niveauActuel()); }
    await h.post('/api/stop');
    await h.post('/api/global', { presetFade: 0 });
    for (let i = 1; i < releves.length; i++) {
      assert.ok(releves[i] <= releves[i - 1] + 0.06,
        'le niveau est remonté en plein fondu : ' + JSON.stringify(releves));
    }
    assert.ok(releves[0] > releves[releves.length - 1], 'aucune décroissance : ' + JSON.stringify(releves));
  });

  test('la durée du fondu peut être forcée pour un rappel', async () => {
    await preparerFondu();
    await h.post('/api/global', { presetFade: 8000 }); // très long par défaut…
    await h.post('/api/preset', { action: 'recall', slot: 12 });
    await h.post('/api/start');
    await sleep(300);
    // …mais ce rappel-ci est demandé sec
    h.clearOsc();
    await h.post('/api/preset', { action: 'recall', slot: 13, fadeMs: 0 });
    await sleep(150);
    const apres = niveauActuel();
    await h.post('/api/stop');
    await h.post('/api/global', { presetFade: 0 });
    assert.equal(apres, 0, 'le rappel forcé à 0 doit être instantané');
  });

  test('STOP et BLACKOUT interrompent un fondu en cours', async () => {
    await preparerFondu();
    await h.post('/api/global', { presetFade: 6000 });
    await h.post('/api/preset', { action: 'recall', slot: 12 });
    await h.post('/api/start');
    await sleep(300);
    await h.post('/api/preset', { action: 'recall', slot: 13 });
    await sleep(200);
    assert.ok((await h.state()).fade > 0, 'un fondu devrait être en cours');
    await h.post('/api/blackout');
    await sleep(100);
    assert.equal((await h.state()).fade, null, 'le blackout doit annuler le fondu');
    await h.post('/api/global', { presetFade: 0 });
  });

  test('le fondu n’est pas déclenché à l’arrêt', async () => {
    await preparerFondu();
    await h.post('/api/global', { presetFade: 4000 });
    await h.post('/api/stop');
    await h.post('/api/preset', { action: 'recall', slot: 13 });
    assert.equal((await h.state()).fade, null, 'rien ne joue : aucun fondu à faire');
    await h.post('/api/global', { presetFade: 0 });
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
