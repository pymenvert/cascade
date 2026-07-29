'use strict';
/**
 * La page Conduite déplace-t-elle vraiment les barres ?
 *
 * Chemin que personne ne couvrait, et qui était MORT : la page Conduite pilote
 * la position en 2D (`x`, `y`, `rot`) puis renvoie TOUT le tableau des fixtures
 * — `p3` compris, celui du dernier relevé, donc cohérent avec l'ANCIENNE
 * position. Le serveur voyait un `p3` valide, décrétait que la 3D fait foi, et
 * recalculait x/y/rot depuis l'ancien `p3` : la modification était jetée.
 *
 * Symptôme : on glisse une barre, elle suit la souris, puis le relevé suivant
 * (120 ms) la remet où elle était. Et « Importer depuis MadMapper » annonçait
 * « N fixtures placées » sans que rien ne bouge.
 *
 * ⚠ Les tests d'API existants envoyaient des fixtures SANS `p3` — donc la
 * branche de migration v1 — et passaient au vert. C'est le trou exact.
 */
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert');
const { start } = require('./helpers.js');

describe('Disposition 2D — page Conduite', () => {
  let h;
  before(async () => { h = await start(); });
  after(async () => { await h.stop(); });

  /** Reproduit `pushFixtures()` : on renvoie la fixture telle qu'on l'a reçue,
   *  `p3` compris, avec seulement la 2D modifiée. */
  const deplacer = async (chg) => {
    const avant = (await h.state()).fixtures[0];
    await h.post('/api/fixtures', { fixtures: [{ ...avant, ...chg }] });
    return (await h.state()).fixtures[0];
  };

  const poser = (extra) => h.post('/api/fixtures', { fixtures: [
    { id: 'a', name: 'A', address: '/fixtures/bar0', enabled: true,
      x: 0.2, y: 0.5, rot: 0, ...extra },
  ] });

  test('glisser une barre la déplace VRAIMENT, malgré le p3 renvoyé', async () => {
    await poser();
    const f = await deplacer({ x: 0.8, y: 0.2 });
    assert.ok(Math.abs(f.x - 0.8) < 0.005, 'x doit valoir 0,8, vu ' + f.x);
    assert.ok(Math.abs(f.y - 0.2) < 0.005, 'y doit valoir 0,2, vu ' + f.y);
    // Et la 3D a suivi : les deux représentations restent cohérentes.
    assert.ok(f.p3[0] > 0, 'la barre doit être passée à cour, p3 = ' + JSON.stringify(f.p3));
  });

  test('la rotation tient aussi', async () => {
    await poser();
    const f = await deplacer({ rot: 45 });
    const ecart = Math.abs((((f.rot - 45) % 360) + 540) % 360 - 180);
    assert.ok(ecart < 0.5, 'rot doit valoir 45°, vu ' + f.rot);
  });

  test('déplacer dans le plan de face ne ramène pas la barre au premier plan', async () => {
    // La 2D n'a pas de profondeur. La conserver est ce qui permet de garder une
    // page Conduite utilisable sur une scéno en volume : on range une barre de
    // gauche à droite sans la déplacer en profondeur sans le vouloir.
    await poser();
    await h.post('/api/fixture3d', { id: 'a', p3: [-3, 4, 3], dir3: [1, 0, 0], len3: 1.2 });
    const profAvant = (await h.state()).fixtures[0].p3[1];
    assert.equal(profAvant, 4, 'préparation : la barre doit être au lointain');

    const f = await deplacer({ x: 0.9 });
    assert.equal(f.p3[1], 4,
      'la profondeur doit être préservée, vue ' + f.p3[1]);
    assert.ok(Math.abs(f.x - 0.9) < 0.005, 'et le déplacement doit avoir eu lieu');
  });

  test('renvoyer le tableau SANS rien changer ne bouge rien', async () => {
    // Garde-fou du garde-fou : la page renvoie tout le tableau à chaque
    // changement de case « activée », de nom, d'adresse. Si la lecture « la 2D
    // contredit la 3D » se déclenchait à tort, la moindre de ces actions
    // repositionnerait les barres.
    await poser();
    await h.post('/api/fixture3d', { id: 'a', p3: [1.5, 2, 4], dir3: [0.6, 0, -0.8], len3: 2 });
    const avant = (await h.state()).fixtures[0];
    await h.post('/api/fixtures', { fixtures: [{ ...avant, name: 'Renommée' }] });
    const apres = (await h.state()).fixtures[0];
    assert.deepEqual(apres.p3, avant.p3, 'p3 ne doit pas bouger : ' + JSON.stringify([avant.p3, apres.p3]));
    assert.deepEqual(apres.dir3, avant.dir3, 'dir3 ne doit pas bouger');
    assert.equal(apres.name, 'Renommée', 'le renommage doit passer');
  });

  test('un projet v1, sans p3, est toujours migré comme avant', async () => {
    // Compatibilité : ce chemin-là marchait, il doit continuer.
    await h.post('/api/fixtures', { fixtures: [
      { id: 'v1', name: 'Ancienne', address: '/fixtures/bar9', enabled: true,
        x: 0.75, y: 0.25, rot: 90 },
    ] });
    const f = (await h.state()).fixtures[0];
    assert.ok(Math.abs(f.x - 0.75) < 0.005 && Math.abs(f.y - 0.25) < 0.005,
      'la 2D d’un projet v1 doit être conservée : ' + JSON.stringify([f.x, f.y]));
    assert.ok(Array.isArray(f.p3) && f.p3.length === 3, 'et une 3D doit en être déduite');
  });

  test('aucune erreur n’a été écrite dans le journal du serveur', () => {
    const erreurs = h.logs.join('').split('\n').filter(l =>
      /erreur inattendue|promesse rejetée|erreur moteur|Error:|TypeError|RangeError/.test(l));
    assert.equal(erreurs.length, 0, 'le serveur a signalé :\n' + erreurs.join('\n'));
  });
});
