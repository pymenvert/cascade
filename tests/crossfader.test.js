'use strict';
/**
 * Le crossfader entre deux jeux de couches.
 *
 * L'outil de conduite de Madrix, et la différence entre DÉCLENCHER et JOUER :
 * un rappel de preset est un saut, un crossfader se tient à la main.
 *
 * Le point délicat, et la raison d'être de la moitié de ce fichier : le poids
 * du fader s'applique SUR LE RÉSULTAT DE LA FUSION, pas sur la valeur de la
 * couche. Appliqué sur la valeur, une couche en multiplication tombée à zéro
 * deviendrait un masque NOIR et éteindrait tout ce qui est dessous — soit
 * exactement l'inverse de ce qu'on attend d'un fader qu'on baisse.
 */
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert');
const { start, sleep } = require('./helpers.js');

const niveaux = (msgs) => {
  const o = new Map();
  for (const m of msgs) {
    const x = /^\/fixtures\/(bar\d+)\/luminosity$/.exec(m.address);
    if (x) o.set(x[1], m.args[0]);
  }
  return o;
};

/** Six barres en ligne, bien à l'intérieur du plateau. */
const enLigne = (n) => Array.from({ length: n }, (_, i) => ({
  id: 'c' + i, name: 'B' + i, address: '/fixtures/bar' + i, enabled: true,
  x: 0.1 + 0.8 * (i / (n - 1)), y: 0.5, rot: 0,
}));

describe('Crossfader — deux jeux de couches', () => {
  let h;
  before(async () => {
    h = await start();
    await h.post('/api/fixtures', { fixtures: enLigne(6) });
  });
  after(async () => { await h.stop(); });

  /** Relève les niveaux après avoir laissé le moteur tourner. */
  const mesurer = async (ms = 240) => {
    h.clearOsc();
    await sleep(ms);
    return niveaux(h.osc());
  };

  const setL = (id, set) => h.post('/api/layer', { id, set });

  /**
   * Une couche « tout allumé, figé » : pattern `tous`, sans animation.
   * Indispensable ici — on veut mesurer un NIVEAU, pas attraper un motif au vol.
   */
  const couchePlate = (id, niveau, extra) => setL(id, {
    engine: 'wave', pattern: 'pulse', waveform: 'square', mode: 'onoff',
    floor: 1, level: niveau, invert: false, mirrorH: false, mirrorV: false,
    target: 'intensity', blend: 'htp', prof: 0, palette: null, deck: null,
    stepMs: 10000, group: 8, speed: 0.05, width: 8, groupId: null, bars: null,
    ...extra,
  });

  test('sans aucune couche rangée dans un jeu, le fader ne change RIEN', async () => {
    // Garde-fou de compatibilité : c'est l'état de tout projet existant.
    const L0 = (await h.state()).layers[0];
    assert.equal(L0.deck, null, 'aucun jeu par défaut');
    await couchePlate(L0.id, 0.6);
    await h.post('/api/global', { master: 1, speed: 1, dimmer: 'linear', xfade: 0 });
    await h.post('/api/start');

    // ⚠ Fenêtre longue : la sortie OSC ne réémet que ce qui CHANGE, avec un
    // rappel toutes les secondes. Ici justement rien ne doit changer — une
    // fenêtre de 240 ms ne verrait donc aucun message, et le test conclurait à
    // tort qu'il n'y a pas de barres.
    const a = await mesurer(1400);
    await h.post('/api/global', { xfade: 1 });
    const b = await mesurer(1400);
    await h.post('/api/stop');

    assert.ok(a.size >= 5 && b.size >= 5, 'trop peu de barres relevées');
    for (const [bar, v] of a) {
      assert.ok(Math.abs(v - b.get(bar)) < 0.02,
        bar + ' a bougé alors qu’aucune couche n’est dans un jeu : '
        + v + ' → ' + b.get(bar));
    }
    await h.post('/api/global', { xfade: 0 });
  });

  test('le fader fait vraiment passer d’un jeu à l’autre', async () => {
    const s = await h.state();
    const A = s.layers[0].id;
    await h.post('/api/layers', { action: 'add' });
    const B = (await h.state()).layers[1].id;
    // Deux couches sur des barres DIFFÉRENTES : on lit directement qui joue.
    await couchePlate(A, 1, { deck: 'a', bars: ['c0', 'c1'] });
    await couchePlate(B, 1, { deck: 'b', bars: ['c4', 'c5'] });

    // ⚠ Une couche COULEUR permanente, hors des jeux. Sans elle ce test ne
    // prouvait rien à la butée : `col` restait vide, donc le repli couleur de
    // `mixLevel` ne pouvait pas se déclencher et l'assertion « à 1, le jeu A
    // doit être muet » passait pour une mauvaise raison. C'est ce trou qui a
    // laissé passer le défaut du crossfader en butée. Un wash couleur permanent
    // est par ailleurs la conduite la plus banale qui soit.
    await h.post('/api/layers', { action: 'add' });
    const C = (await h.state()).layers[2].id;
    await couchePlate(C, 1, { deck: null, bars: null, target: 'color',
                              colorA: '#ff0000', colorB: '#ff0000' });
    await h.post('/api/start');

    await h.post('/api/global', { xfade: 0 });
    const gaucheA = await mesurer();
    assert.ok(gaucheA.get('bar0') > 0.9, 'à 0, le jeu A doit jouer plein : ' + gaucheA.get('bar0'));
    assert.ok(!(gaucheA.get('bar4') > 0.02), 'à 0, le jeu B doit être muet : ' + gaucheA.get('bar4'));

    await h.post('/api/global', { xfade: 1 });
    const droiteB = await mesurer();
    assert.ok(droiteB.get('bar4') > 0.9, 'à 1, le jeu B doit jouer plein : ' + droiteB.get('bar4'));
    assert.ok(!(droiteB.get('bar0') > 0.02), 'à 1, le jeu A doit être muet : ' + droiteB.get('bar0'));

    await h.post('/api/global', { xfade: 0.5 });
    const milieu = await mesurer();
    assert.ok(Math.abs(milieu.get('bar0') - 0.5) < 0.06,
      'à mi-course, le jeu A doit être à moitié : ' + milieu.get('bar0'));
    assert.ok(Math.abs(milieu.get('bar4') - 0.5) < 0.06,
      'à mi-course, le jeu B doit être à moitié : ' + milieu.get('bar4'));
    await h.post('/api/stop');
    await h.post('/api/global', { xfade: 0 });
  });

  test('baisser une couche MULTIPLICATION n’éteint pas ce qu’elle masque', async () => {
    // LE test de ce fichier. Le poids appliqué sur la VALEUR ferait de cette
    // couche un masque noir : le fond tomberait à zéro en baissant le fader, ce
    // qui est l'inverse de ce qu'on demande. Appliqué sur le RÉSULTAT de la
    // fusion, le fond ressort intact.
    const s = await h.state();
    const fond = s.layers[0].id, masque = s.layers[1].id;
    await couchePlate(fond, 1, { deck: null, bars: null, blend: 'htp' });
    await couchePlate(masque, 0.2, { deck: 'b', bars: null, blend: 'mul' });
    await h.post('/api/start');

    // Fader à fond du côté du masque : il agit, tout est assombri.
    await h.post('/api/global', { xfade: 1 });
    const masqueActif = await mesurer();
    const vm = [...masqueActif.values()];
    assert.ok(Math.max(...vm) < 0.35,
      'le masque doit assombrir quand le fader est de son côté : ' + JSON.stringify(vm));

    // Fader de l'autre côté : le masque n'agit plus DU TOUT, le fond est intact.
    await h.post('/api/global', { xfade: 0 });
    const masqueRetire = await mesurer();
    const vr = [...masqueRetire.values()];
    assert.ok(vr.length >= 5, 'trop peu de barres relevées : ' + vr.length);
    assert.ok(Math.min(...vr) > 0.9,
      'à poids nul le masque ne doit RIEN faire, le fond doit ressortir entier : '
      + JSON.stringify(vr.map(v => v.toFixed(3))));

    // Et à mi-course, le masque agit à moitié — pas de tout ou rien.
    await h.post('/api/global', { xfade: 0.5 });
    const demi = [...(await mesurer()).values()];
    const moy = demi.reduce((a, b) => a + b, 0) / demi.length;
    assert.ok(moy > 0.5 && moy < 0.75,
      'à mi-course le masque doit agir à moitié, vu ' + moy.toFixed(3));
    await h.post('/api/stop');
    await h.post('/api/global', { xfade: 0 });
  });

  test('une console peut tenir le fader en OSC', async () => {
    // C'est tout l'intérêt : un fader physique, pas une souris.
    await h.sendOsc('/chaser/xfade', [0.75]);
    await sleep(120);
    assert.ok(Math.abs((await h.state()).global.xfade - 0.75) < 0.01,
      'l’OSC doit poser le fader, vu ' + (await h.state()).global.xfade);
    await h.sendOsc('/chaser/xfade', [0]);
    await sleep(120);
    assert.equal((await h.state()).global.xfade, 0);
  });

  test('le jeu et le fader voyagent avec le projet et les presets', async () => {
    const id = (await h.state()).layers[0].id;
    await setL(id, { deck: 'a' });
    await h.post('/api/global', { xfade: 0.4 });
    await h.post('/api/preset', { action: 'save', slot: 3, name: 'Jeux' });

    const exp = await h.get('/api/export');
    assert.equal(exp.body.global.xfade, 0.4, 'le fader doit être exporté');
    await h.post('/api/new', { keepFixtures: true });
    await h.post('/api/import', exp.body);
    let S = await h.state();
    assert.equal(S.layers[0].deck, 'a', 'le jeu doit survivre à l’import');
    assert.equal(S.global.xfade, 0.4, 'le fader doit survivre à l’import');

    await setL(S.layers[0].id, { deck: null });
    await h.post('/api/preset', { action: 'recall', slot: 3 });
    await sleep(120);
    assert.equal((await h.state()).layers[0].deck, 'a',
      'le preset doit restaurer le jeu');

    // Rien d'hostile ne passe.
    await setL((await h.state()).layers[0].id, { deck: 'pas un jeu' });
    assert.equal((await h.state()).layers[0].deck, null,
      'un jeu inconnu doit être refusé');
    await h.post('/api/global', { xfade: 42 });
    const x = (await h.state()).global.xfade;
    assert.ok(x >= 0 && x <= 1, 'le fader doit être borné, vu ' + x);
    await h.post('/api/global', { xfade: 0 });
  });

  test('un rappel de preset n’arrache PAS le fader des mains', async () => {
    // Décision de conception, verrouillée ici parce qu'elle est invisible dans
    // le code : un preset mémorise les couches et la scéno, pas les réglages
    // globaux. Le crossfader est un geste en cours — comme le master. Le
    // restaurer déplacerait le fader tout seul au milieu d'un passage, ce qui
    // est exactement ce qu'un régisseur ne pardonne pas.
    const id = (await h.state()).layers[0].id;
    await setL(id, { deck: 'a' });
    await h.post('/api/global', { xfade: 0 });
    await h.post('/api/preset', { action: 'save', slot: 5, name: 'Depart' });

    await h.post('/api/global', { xfade: 0.8 });   // le régisseur tient le fader
    await h.post('/api/preset', { action: 'recall', slot: 5 });
    await sleep(150);
    assert.equal((await h.state()).global.xfade, 0.8,
      'le fader doit rester où le régisseur l’a laissé');

    // Le master obéit à la même règle — c'est la cohérence qui compte.
    await h.post('/api/global', { master: 0.5 });
    await h.post('/api/preset', { action: 'recall', slot: 5 });
    await sleep(150);
    assert.equal((await h.state()).global.master, 0.5,
      'le master non plus ne doit pas être restauré par un preset');
    await h.post('/api/global', { master: 1, xfade: 0 });
  });

  test('aucune erreur n’a été écrite dans le journal du serveur', () => {
    const erreurs = h.logs.join('').split('\n').filter(l =>
      /erreur inattendue|promesse rejetée|erreur moteur|Error:|TypeError|RangeError/.test(l));
    assert.equal(erreurs.length, 0, 'le serveur a signalé :\n' + erreurs.join('\n'));
  });
});
