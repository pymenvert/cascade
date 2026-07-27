'use strict';
/**
 * Les VUES — basculer d'un axe de projection à l'autre.
 *
 * Le principe, mesuré sur MadMapper 6.0.9 (voir docs/V2-AXES-PISTES.md) : chaque
 * barre physique existe en une copie par vue, toutes à la MÊME adresse DMX,
 * rangées dans un dossier de fixtures par vue. On bascule en n'allumant qu'un
 * dossier. Le `luminosity` d'un dossier atténue ses membres proportionnellement,
 * d'où les fondus.
 *
 * Ce que ces tests protègent avant tout : **un seul dossier allumé à la fois**.
 * Deux dossiers visibles laissent gagner le dernier de la liste MadMapper, et
 * l'ordre de cette liste n'est pas stable — c'est le genre de panne qu'on ne
 * comprend qu'en spectacle.
 */
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert');
const { start, sleep, fixtures } = require('./helpers.js');

/** Dernière valeur envoyée à chaque dossier, par adresse OSC. */
function envois(msgs, suffixe) {
  const o = new Map();
  for (const m of msgs) {
    const mm = new RegExp('^/fixtures/([^/]+)/' + suffixe + '$').exec(m.address);
    if (mm) o.set(mm[1], m.args[0]);
  }
  return o;
}

describe('Vues — un axe de projection à la fois', () => {
  let h;
  before(async () => {
    h = await start();
    await h.post('/api/fixtures', { fixtures: fixtures(4) });
  });
  after(async () => { await h.stop(); });

  /** Repart de trois vues propres. */
  const troisVues = async () => {
    await h.post('/api/vues', { vues: [] });
    await h.post('/api/vues', { action: 'add', name: 'Face', dossier: 'CASCADE-Face' });
    await h.post('/api/vues', { action: 'add', name: 'Dessus', dossier: 'CASCADE-Dessus' });
    await h.post('/api/vues', { action: 'add', name: 'Déplié', dossier: 'MonDeplie', manuelle: true });
    return (await h.state()).vues;
  };

  test('on déclare des vues, et elles sont bornées et nettoyées', async () => {
    const v = await troisVues();
    assert.equal(v.length, 3);
    assert.deepEqual(v.map(x => x.name), ['Face', 'Dessus', 'Déplié']);
    assert.deepEqual(v.map(x => x.dossier), ['CASCADE-Face', 'CASCADE-Dessus', 'MonDeplie']);
    assert.equal(v[2].manuelle, true, 'la vue « à moi » doit être marquée manuelle');
    assert.equal(v[0].manuelle, false);

    // Valeurs hostiles
    await h.post('/api/vues', { action: 'set', id: v[0].id,
      set: { name: 'x'.repeat(80), dossier: 'y'.repeat(200), axAz: 1e9, axEl: 1e9, projection: 'nawak' } });
    const w = (await h.state()).vues[0];
    assert.ok(w.name.length <= 20, 'nom non borné : ' + w.name.length);
    assert.ok(w.dossier.length <= 64, 'dossier non borné : ' + w.dossier.length);
    assert.ok(w.axAz >= -360 && w.axAz < 360, 'azimut hors bornes : ' + w.axAz);
    assert.ok(w.axEl >= -90 && w.axEl <= 90, 'élévation hors bornes : ' + w.axEl);
    assert.ok(['face', 'dessus', 'cote', 'libre'].includes(w.projection),
      'projection invalide acceptée : ' + w.projection);
    // …et l'identifiant ne bouge pas quand on modifie
    assert.equal(w.id, v[0].id, 'l’identifiant d’une vue ne doit jamais changer');
  });

  test('activer une vue allume SON dossier et éteint les autres', async () => {
    const v = await troisVues();
    h.clearOsc();
    const r = await h.post('/api/vue', { id: v[1].id, fadeMs: 0 });
    await sleep(200);
    assert.equal(r.body.vueActive, v[1].id);
    assert.equal((await h.state()).global.vueActive, v[1].id);

    const lum = envois(h.osc(), 'luminosity');
    const vis = envois(h.osc(), 'visible');
    assert.equal(lum.get('CASCADE-Dessus'), 1, 'la vue active doit être à plein');
    assert.equal(lum.get('CASCADE-Face'), 0, 'les autres doivent tomber à zéro');
    assert.equal(lum.get('MonDeplie'), 0);
    assert.equal(vis.get('CASCADE-Dessus'), 1, 'la vue active doit être visible');
    assert.equal(vis.get('CASCADE-Face'), 0, 'les autres doivent être masquées');
  });

  test('« tout éteindre » met les trois dossiers à zéro', async () => {
    const v = await troisVues();
    await h.post('/api/vue', { id: v[0].id, fadeMs: 0 });
    await sleep(120);
    h.clearOsc();
    await h.post('/api/vue', { id: null, fadeMs: 0 });
    await sleep(200);
    const lum = envois(h.osc(), 'luminosity');
    for (const d of ['CASCADE-Face', 'CASCADE-Dessus', 'MonDeplie']) {
      assert.equal(lum.get(d), 0, d + ' devrait être à zéro');
    }
    assert.equal((await h.state()).global.vueActive, null);
  });

  test('jamais deux dossiers à plein en même temps', async () => {
    // LE test qui compte. Deux dossiers visibles laissent gagner le dernier de
    // la liste MadMapper, et cet ordre n'est pas stable dans le temps.
    const v = await troisVues();
    for (const cible of v) {
      h.clearOsc();
      await h.post('/api/vue', { id: cible.id, fadeMs: 0 });
      await sleep(180);
      const lum = envois(h.osc(), 'luminosity');
      const pleins = [...lum.entries()].filter(([, x]) => x > 0.01);
      assert.equal(pleins.length, 1,
        'après avoir activé « ' + cible.name + ' », ' + pleins.length
        + ' dossier(s) allumé(s) : ' + JSON.stringify(pleins));
      assert.equal(pleins[0][0], cible.dossier);
    }
  });

  test('le fondu progresse et finit exactement à 1 et 0', async () => {
    const v = await troisVues();
    await h.post('/api/vue', { id: v[0].id, fadeMs: 0 });
    await sleep(150);
    h.clearOsc();
    const r = await h.post('/api/vue', { id: v[1].id, fadeMs: 600 });
    assert.equal(r.body.fondu, 600);

    await sleep(250);   // en plein fondu
    const enCours = envois(h.osc(), 'luminosity');
    const montant = enCours.get('CASCADE-Dessus');
    const descendant = enCours.get('CASCADE-Face');
    assert.ok(montant > 0.05 && montant < 0.95,
      'la vue entrante devrait être à mi-chemin, vue à ' + montant);
    assert.ok(descendant > 0.05 && descendant < 0.95,
      'la vue sortante devrait être à mi-chemin, vue à ' + descendant);

    await sleep(700);   // fondu terminé
    const fin = envois(h.osc(), 'luminosity');
    assert.equal(fin.get('CASCADE-Dessus'), 1, 'la vue entrante doit finir à 1');
    assert.equal(fin.get('CASCADE-Face'), 0, 'la vue sortante doit finir à 0');
    // Et la sortante doit être masquée à la fin, pas seulement à zéro
    const vis = envois(h.osc(), 'visible');
    assert.equal(vis.get('CASCADE-Face'), 0, 'la vue sortante doit être masquée en fin de fondu');
  });

  test('une bascule pendant un fondu ne laisse pas deux vues en vol', async () => {
    const v = await troisVues();
    await h.post('/api/vue', { id: v[0].id, fadeMs: 0 });
    await sleep(150);
    await h.post('/api/vue', { id: v[1].id, fadeMs: 3000 });
    await sleep(200);
    h.clearOsc();
    // On change d'avis en pleine transition — le doigt nerveux du régisseur
    await h.post('/api/vue', { id: v[2].id, fadeMs: 300 });
    await sleep(700);
    const lum = envois(h.osc(), 'luminosity');
    const pleins = [...lum.entries()].filter(([, x]) => x > 0.01);
    assert.equal(pleins.length, 1, 'une seule vue doit rester : ' + JSON.stringify([...lum]));
    assert.equal(pleins[0][0], 'MonDeplie');
    assert.equal((await h.state()).global.vueActive, v[2].id);
  });

  test('une vue sans dossier n’envoie rien du tout', async () => {
    await h.post('/api/vues', { vues: [] });
    await h.post('/api/vues', { action: 'add', name: 'Vide', dossier: '' });
    const v = (await h.state()).vues;
    h.clearOsc();
    await h.post('/api/vue', { id: v[0].id, fadeMs: 0 });
    await sleep(200);
    assert.deepEqual(h.osc().filter(m => /^\/fixtures\//.test(m.address)), [],
      'une vue sans dossier ne doit toucher à rien');
  });

  test('Cascade ne touche QU’AUX dossiers qu’on lui a déclarés', async () => {
    // Un régisseur peut avoir des fixtures et des dossiers qui ne concernent pas
    // Cascade. Éteindre un dossier inconnu serait s’autoriser à toucher à son
    // projet en dehors de ce qu’il a confié.
    const v = await troisVues();
    h.clearOsc();
    await h.post('/api/vue', { id: v[0].id, fadeMs: 0 });
    await sleep(200);
    const touches = new Set(h.osc()
      .map(m => (/^\/fixtures\/([^/]+)\//.exec(m.address) || [])[1])
      .filter(Boolean));
    for (const d of touches) {
      assert.ok(['CASCADE-Face', 'CASCADE-Dessus', 'MonDeplie'].includes(d),
        'Cascade a touché à « ' + d + ' », qui n’est pas une vue déclarée');
    }
  });

  test('supprimer la vue active éteint la sélection', async () => {
    const v = await troisVues();
    await h.post('/api/vue', { id: v[0].id, fadeMs: 0 });
    await sleep(120);
    await h.post('/api/vues', { action: 'remove', id: v[0].id });
    const et = await h.state();
    assert.equal(et.vues.length, 2);
    assert.equal(et.global.vueActive, null, 'la vue active supprimée doit laisser null');
  });

  test('les vues voyagent avec le projet', async () => {
    const v = await troisVues();
    await h.post('/api/vue', { id: v[2].id, fadeMs: 0 });
    await sleep(120);
    const exp = await h.get('/api/export');
    assert.equal((exp.body.vues || []).length, 3, 'les vues doivent être exportées');
    await h.post('/api/new', { keepFixtures: false });
    assert.equal((await h.state()).vues.length, 0, '« nouveau projet » doit repartir sans vue');
    await h.post('/api/import', exp.body);
    const apres = (await h.state()).vues;
    assert.equal(apres.length, 3);
    assert.equal(apres[2].manuelle, true, 'le drapeau « à moi » doit survivre');
    assert.equal(apres[2].dossier, 'MonDeplie');
  });

  test('la vérification des dossiers ne modifie RIEN', async () => {
    await troisVues();
    h.clearOsc();
    const r = await h.post('/api/vuecheck');
    await sleep(150);
    assert.equal(r.body.ok, true);
    assert.equal((r.body.vues || []).length, 3);
    // Le faux MadMapper des tests ne répond pas à /getControls : les dossiers
    // sont donc annoncés absents, ce qui est la bonne réponse prudente.
    for (const v of r.body.vues) assert.equal(typeof v.existe, 'boolean');
    // Et surtout : aucune écriture
    const ecritures = h.osc().filter(m => !/getControl/.test(m.address));
    assert.deepEqual(ecritures, [], 'la vérification doit être en lecture seule');
  });

  test('« inverser la LED » se mémorise par barre et voyage', async () => {
    await h.post('/api/fixtures', { fixtures: fixtures(3) });
    const ids = (await h.state()).fixtures.map(f => f.id);
    assert.equal((await h.state()).fixtures[0].inverse, false, 'par défaut, non inversée');
    await h.post('/api/fixture3d', { id: ids[1], inverse: true });
    const fx = (await h.state()).fixtures;
    assert.equal(fx[1].inverse, true, 'l’inversion doit être mémorisée');
    assert.equal(fx[0].inverse, false, 'et ne pas contaminer les voisines');
    // Elle ne doit pas perturber la position
    assert.ok(Array.isArray(fx[1].p3) && fx[1].p3.every(Number.isFinite));

    const exp = await h.get('/api/export');
    await h.post('/api/new', { keepFixtures: false });
    await h.post('/api/import', exp.body);
    const rev = (await h.state()).fixtures.find(f => f.id === ids[1]);
    assert.equal(rev.inverse, true, 'l’inversion doit survivre à l’export/import');

    // Et une valeur absurde devient un booléen, pas n'importe quoi
    await h.post('/api/fixture3d', { id: ids[1], inverse: 'oui' });
    assert.equal((await h.state()).fixtures.find(f => f.id === ids[1]).inverse, true);
    await h.post('/api/fixture3d', { id: ids[1], inverse: 0 });
    assert.equal((await h.state()).fixtures.find(f => f.id === ids[1]).inverse, false);
  });

  test('les vues n’interfèrent pas avec le moteur', async () => {
    await h.post('/api/fixtures', { fixtures: fixtures(4) });
    const v = await troisVues();
    await h.post('/api/vue', { id: v[0].id, fadeMs: 0 });
    const id = (await h.state()).layers[0].id;
    await h.post('/api/layer', { id, set: { pattern: 'all', mode: 'onoff', engine: 'steps' } });
    await h.post('/api/blackout');
    await sleep(80);
    h.clearOsc();
    await h.post('/api/start');
    await sleep(250);
    const msgs = h.osc();
    await h.post('/api/stop');
    const barres = new Set(msgs.filter(m => /^\/fixtures\/bar\d+\/luminosity$/.test(m.address))
      .filter(m => m.args[0] > 0.5).map(m => m.address));
    assert.equal(barres.size, 4, 'les 4 barres doivent toujours s’allumer');
  });

  test('aucune erreur n’a été écrite dans le journal du serveur', () => {
    const erreurs = h.logs.join('').split('\n').filter(l =>
      /erreur inattendue|promesse rejetée|erreur moteur|Error:|TypeError|RangeError/.test(l));
    assert.equal(erreurs.length, 0, 'le serveur a signalé :\n' + erreurs.join('\n'));
  });
});
