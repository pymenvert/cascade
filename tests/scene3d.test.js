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
    // ⚠ On change VOLONTAIREMENT le plateau entre l'export et l'import. Sans ça,
    // il resterait à 14/11/5 et le test passerait sans que la scène ait voyagé —
    // c'est exactement le faux positif qui masquait son absence de l'export.
    await h.post('/api/scene', { scene: { w: 7, d: 7, h: 7 } });
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

  // ── Déplacement à la souris : ce que le serveur doit garantir ──────────

  test('les positions absurdes sont bornées, pas acceptées telles quelles', async () => {
    await h.post('/api/fixtures', { fixtures: fixtures(2) });
    const id = (await h.state()).fixtures[0].id;
    // Un glissé emballé, ou une requête malveillante : une barre à 1e9 rendrait
    // la vue inutilisable et la position irrécupérable à la souris.
    await h.post('/api/fixture3d', { id, p3: [1e9, -1e9, 1e12] });
    const f = (await h.state()).fixtures.find(x => x.id === id);
    for (const v of f.p3) assert.ok(Math.abs(v) <= 500, 'position non bornée : ' + f.p3);
    assert.ok(f.x >= 0 && f.x <= 1 && f.y >= 0 && f.y <= 1, 'la 2D doit rester dans le cadre');
    // Et rien de tordu : ni NaN, ni Infinity
    for (const v of [...f.p3, ...f.dir3, f.len3, f.x, f.y, f.rot])
      assert.ok(Number.isFinite(v), 'valeur non finie : ' + v);
  });

  test('un lot de barres se déplace d’un coup (c’est ce qui permet d’annuler)', async () => {
    await h.post('/api/fixtures', { fixtures: fixtures(3) });
    const ids = (await h.state()).fixtures.map(f => f.id);
    const lot = [
      { id: ids[0], p3: [1, 2, 3], dir3: [1, 0, 0], len3: 1.5 },
      { id: ids[1], p3: [-1, 0, 2], dir3: [0, 0, 1], len3: 2 },
      { id: 'inexistante', p3: [9, 9, 9] },   // ignorée sans casser le reste
    ];
    const r = await h.post('/api/fixture3d', { fixtures: lot });
    assert.equal(r.body.ok, true);
    assert.equal(r.body.fixtures.length, 2, 'la barre inconnue doit être ignorée');
    const fx = (await h.state()).fixtures;
    assert.deepEqual(fx.find(f => f.id === ids[0]).p3, [1, 2, 3]);
    assert.deepEqual(fx.find(f => f.id === ids[1]).p3, [-1, 0, 2]);
    assert.ok(Math.abs(fx.find(f => f.id === ids[1]).dir3[2]) > 0.9, 'barre verticale attendue');
  });

  test('un lot entièrement inconnu échoue proprement', async () => {
    const r = await h.post('/api/fixture3d', { fixtures: [{ id: 'nulle' }] });
    assert.equal(r.body.ok, false);
    assert.equal((await h.get('/api/ping')).body.app, 'Cascade');
  });

  // ── Renvoi de la disposition vers MadMapper ────────────────────────────

  test('la disposition ne part vers MadMapper que sur demande explicite', async () => {
    await h.post('/api/fixtures', { fixtures: fixtures(3) });
    const ids = (await h.state()).fixtures.map(f => f.id);
    await h.post('/api/fixture3d', { id: ids[0], p3: [2, 1, 3], dir3: [1, 0, 0], len3: 1.2 });

    // Déplacer une barre ne doit RIEN envoyer : Cascade ne réécrit jamais le
    // projet MadMapper dans le dos de l'utilisateur.
    h.clearOsc();
    await h.post('/api/fixture3d', { id: ids[1], p3: [-2, 0, 1] });
    await sleep(150);
    const geo = h.osc().filter(m => /\/output\//.test(m.address));
    assert.deepEqual(geo, [], 'un déplacement ne doit envoyer aucune géométrie');

    // …et sur clic, oui.
    h.clearOsc();
    const r = await h.post('/api/geometrie', {});
    assert.equal(r.body.ok, true);
    assert.equal(r.body.count, 3);
    await sleep(150);
    const msgs = h.osc();
    for (const suffixe of ['output/x', 'output/y', 'output/rot']) {
      const n = msgs.filter(m => m.address.endsWith(suffixe)).length;
      assert.equal(n, 3, 'attendu 3 messages ' + suffixe + ', vu ' + n);
    }
    // ⚠ MadMapper compte en PIXELS, pas en 0..1 — mesuré sur 6.0.9 : une barre
    // au centre d'une sortie 1920×1080 lit output/x = 960. Envoyer la valeur
    // normalisée entasserait toutes les barres dans le coin supérieur gauche.
    const et = await h.state();
    const f = et.fixtures.find(x => x.id === ids[0]);
    const { outW, outH } = et.settings;
    assert.equal(outW, 1920, 'résolution de sortie par défaut');
    assert.equal(outH, 1080);
    const mx = msgs.find(m => m.address === f.address + '/output/x');
    const my = msgs.find(m => m.address === f.address + '/output/y');
    assert.ok(mx && my, 'pas de message output/x|y pour ' + f.address);
    assert.equal(mx.args[0], Math.round(f.x * outW), 'x attendu en pixels');
    assert.equal(my.args[0], Math.round(f.y * outH), 'y attendu en pixels');
    assert.ok(mx.args[0] > 1.5, 'une valeur normalisée aurait été envoyée : ' + mx.args[0]);
    // L'angle part en degrés, ramené dans [0, 360[ : hors de cet intervalle,
    // MadMapper 6.0.9 ignore le message sans rien dire (mesuré).
    const mr = msgs.find(m => m.address === f.address + '/output/rot');
    assert.ok(mr.args[0] >= 0 && mr.args[0] < 360, 'angle hors plage : ' + mr.args[0]);
    // Ni width ni height : déplacer une barre ne doit pas la redimensionner.
    assert.deepEqual(msgs.filter(m => /\/output\/(width|height)$/.test(m.address)), [],
      'la taille des barres ne doit jamais être écrite');
  });

  test('la résolution de sortie se règle, et la conversion suit', async () => {
    await h.post('/api/settings', { outW: 3840, outH: 2160 });
    const et = await h.state();
    assert.equal(et.settings.outW, 3840);
    const f = et.fixtures.find(x => x.enabled);
    h.clearOsc();
    await h.post('/api/geometrie', {});
    await sleep(150);
    const mx = h.osc().find(m => m.address === f.address + '/output/x');
    assert.equal(mx.args[0], Math.round(f.x * 3840), 'la conversion doit suivre le réglage');

    // Bornes : une résolution absurde ne doit pas passer
    await h.post('/api/settings', { outW: 0, outH: 999999 });
    const b = (await h.state()).settings;
    assert.ok(b.outW >= 16, 'largeur non bornée : ' + b.outW);
    assert.ok(b.outH <= 32768, 'hauteur non bornée : ' + b.outH);
    await h.post('/api/settings', { outW: 1920, outH: 1080 });
  });

  test('les angles négatifs sont ramenés dans [0, 360[ avant l’envoi', async () => {
    // MadMapper 6.0.9 n’accepte QUE [0, 360[ sur output/rot : hors plage il
    // ignore le message SANS RIEN DIRE. Et le rot de Cascade vient d’un atan2,
    // donc entre -180 et +180 — une barre sur deux gardait son ancien angle.
    await h.post('/api/fixtures', { fixtures: fixtures(4) });
    const ids = (await h.state()).fixtures.map(f => f.id);
    // Une barre verticale montante donne rot = -90
    await h.post('/api/fixture3d', { fixtures: [
      { id: ids[0], p3: [0, 0, 2], dir3: [0, 0, 1], len3: 1.2 },     // rot -90
      { id: ids[1], p3: [1, 0, 2], dir3: [-1, 0, 0], len3: 1.2 },    // rot 180
      { id: ids[2], p3: [2, 0, 2], dir3: [0, 0, -1], len3: 1.2 },    // rot +90
      { id: ids[3], p3: [3, 0, 2], dir3: [1, 0, 0], len3: 1.2 },     // rot 0
    ] });
    const fx = (await h.state()).fixtures;
    assert.ok(fx.some(f => f.rot < 0), 'le test perd son sens si aucun angle n’est négatif');

    h.clearOsc();
    await h.post('/api/geometrie', {});
    await sleep(200);
    const rots = h.osc().filter(m => /\/output\/rot$/.test(m.address));
    assert.equal(rots.length, 4);
    for (const m of rots) {
      assert.ok(m.args[0] >= 0 && m.args[0] < 360,
        m.address + ' : angle hors de [0,360[ → MadMapper l’ignorerait : ' + m.args[0]);
    }
    // Et l’angle reste le même modulo 360 : on n’a pas perdu l’orientation
    for (const f of fx) {
      const m = rots.find(x => x.address === f.address + '/output/rot');
      const att = ((f.rot % 360) + 360) % 360;
      assert.ok(Math.abs(m.args[0] - att) < 0.01,
        f.name + ' : ' + f.rot + '° devait devenir ' + att + '°, envoyé ' + m.args[0]);
    }
  });

  test('une barre désactivée n’est pas envoyée', async () => {
    const fx = fixtures(3);
    fx[1].enabled = false;
    await h.post('/api/fixtures', { fixtures: fx });
    h.clearOsc();
    const r = await h.post('/api/geometrie', {});
    assert.equal(r.body.count, 2);
    await sleep(150);
    const adr = new Set(h.osc().filter(m => /\/output\/x$/.test(m.address)).map(m => m.address));
    assert.equal(adr.size, 2);
    assert.ok(!adr.has(fx[1].address + '/output/x'),
      'la barre éteinte (' + fx[1].address + ') ne doit pas être placée');
    await h.post('/api/fixtures', { fixtures: fixtures(4) });
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
