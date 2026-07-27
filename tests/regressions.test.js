'use strict';
/**
 * Défauts trouvés par relecture, confirmés par la mesure, puis corrigés.
 *
 * Chaque test de ce fichier a été écrit APRÈS avoir reproduit le défaut sur un
 * vrai serveur, et vérifié qu'il échoue sur le code d'avant. C'est la seule
 * façon d'être sûr qu'il protège quelque chose : un test écrit après la
 * correction, sans avoir vu l'échec, ne prouve rien.
 *
 * Quatre de ces défauts existaient DÉJÀ EN v1 — donc dans la version qui part
 * en spectacle. Ils sont marqués « v1 ».
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
const ecartMax = (a, b) => {
  let d = 0;
  for (const [k, v] of a) d = Math.max(d, Math.abs((b.get(k) ?? v) - v));
  return d;
};
const enLigne = (n) => Array.from({ length: n }, (_, i) => ({
  id: 'b' + i, name: 'B' + i, address: '/fixtures/bar' + i, enabled: true,
  x: 0.1 + 0.8 * (i / (n - 1)), y: 0.5, rot: 0,
}));

describe('Défauts corrigés — ils ne doivent jamais revenir', () => {
  let h;
  before(async () => {
    h = await start();
    await h.post('/api/fixtures', { fixtures: enLigne(6) });
    await h.post('/api/scene', { scene: { w: 10, d: 8, h: 6 } });
  });
  after(async () => { await h.stop(); });

  const premiere = async () => (await h.state()).layers[0].id;
  const setL = async (set) => {
    const r = await h.post('/api/layer', { id: await premiere(), set });
    assert.equal(r.body.ok, true, 'le réglage de la couche a échoué');
  };
  /** Période énorme : la phase n'avance plus, on compare deux instants comparables. */
  const GEL = { stepMs: 10000, group: 8, speed: 0.05 };
  const lire = async (ms = 200) => { h.clearOsc(); await sleep(ms); return niveaux(h.osc()); };

  // ── v1 ────────────────────────────────────────────────────────────────────

  test('v1 · une couche COULEUR n’allume que les barres qu’elle pilote', async () => {
    // Défaut mesuré : `mixLevel` renvoyait 1 dès qu'une couche couleur existait,
    // pour TOUTES les fixtures. Une couche limitée à deux barres sur six en
    // allumait donc six. Sur scène : un plein feu involontaire.
    await h.post('/api/fixtures', { fixtures: enLigne(6) });
    await h.post('/api/blackout');
    await sleep(80);
    await setL({ engine: 'wave', pattern: 'all', target: 'color', mode: 'fade',
                 bars: ['b0', 'b1'], level: 1, enabled: true, ...GEL });
    h.clearOsc();
    await h.post('/api/start');
    await sleep(300);
    const lum = niveaux(h.osc());
    await h.post('/api/stop');

    assert.ok((lum.get('bar0') ?? 0) > 0.9, 'la barre pilotée doit s’allumer, vu ' + lum.get('bar0'));
    assert.ok((lum.get('bar1') ?? 0) > 0.9);
    for (const b of ['bar2', 'bar3', 'bar4', 'bar5']) {
      assert.ok((lum.get(b) ?? 0) < 0.01,
        b + ' n’est pas pilotée par cette couche et sort pourtant à ' + lum.get(b));
    }
    // …et la couleur, elle, doit bien être envoyée aux deux barres pilotées
    const rouges = h.osc().filter(m => /\/color\/red$/.test(m.address));
    assert.ok(rouges.length > 0, 'la couche couleur doit envoyer des couleurs');
  });

  test('v1 · la phase est préservée quand le tempo change', async () => {
    // Défaut mesuré : `now / period` n'a aucune continuité quand la période
    // change. +0,01 % de tempo faisait sauter les niveaux de 0,93. Or Ableton
    // Link change le tempo en permanence, et c'est la règle n°4 du projet.
    for (const moteur of ['wave', 'field']) {
      await h.post('/api/blackout');
      await sleep(60);
      await setL({ engine: moteur, pattern: 'lr', field: 'plan', target: 'intensity',
                   mode: 'fade', waveform: 'sine', bars: null, width: 4, ...GEL });
      await h.post('/api/start');
      const avant = await lire();
      await setL({ stepMs: 9999 });          // 0,01 % — imperceptible
      const apres = await lire();
      await h.post('/api/stop');
      assert.ok(ecartMax(avant, apres) < 0.05,
        moteur + ' : la phase a sauté de ' + ecartMax(avant, apres).toFixed(3)
        + ' pour 0,01 % de tempo');
    }
  });

  test('v1 · GO / RESYNC ramène les moteurs continus au début du cycle', async () => {
    // Défaut mesuré : `resync` ne vidait qu'un état lu par le seul pas-à-pas.
    // Le bouton promet « tous les chasers » et ne faisait rien sur la vague.
    for (const moteur of ['wave', 'field']) {
      await setL({ engine: moteur, pattern: 'lr', field: 'plan', target: 'intensity',
                   mode: 'fade', waveform: 'sine', bars: null, width: 8,
                   stepMs: 1200, group: 1, speed: 1, phase: 0 });
      await h.post('/api/blackout');
      await sleep(80);
      await h.post('/api/resync');
      await h.post('/api/start');
      const debut = await lire(90);
      await sleep(500);                       // ~40 % du cycle
      const milieu = await lire(90);
      await h.post('/api/resync');
      const apres = await lire(90);
      await h.post('/api/stop');

      // Garde-fou : si la phase n'avait pas avancé, le test ne prouverait rien.
      assert.ok(ecartMax(debut, milieu) > 0.2,
        moteur + ' : la phase doit avancer pour que le test ait un sens ('
        + ecartMax(debut, milieu).toFixed(3) + ')');
      assert.ok(ecartMax(debut, apres) < 0.12,
        moteur + ' : après RESYNC on devrait retrouver le début du cycle, écart '
        + ecartMax(debut, apres).toFixed(3));
    }
  });

  test('v1 · le rappel de preset re-dérive la 2D depuis la 3D', async () => {
    // Défaut mesuré : `recallPreset` copiait les fixtures sans repasser par
    // derive2D — le seul chemin d'écriture qui ne le faisait pas. Un preset
    // enregistré sur un plateau de 10 m puis rappelé sur un plateau de 20 m
    // laissait x = 0,90 là où la position 3D imposait 0,70. En v2, « Renvoyer
    // la disposition » aurait écrit ces faux pixels dans MadMapper.
    await h.post('/api/fixtures', { fixtures: enLigne(3) });
    await h.post('/api/scene', { scene: { w: 10, d: 8, h: 6 } });
    await h.post('/api/fixture3d', { id: 'b0', p3: [4, 0, 3], dir3: [1, 0, 0], len3: 1 });
    await h.post('/api/preset', { action: 'save', slot: 1, name: 'p' });
    await h.post('/api/scene', { scene: { w: 20, d: 8, h: 6 } });
    await h.post('/api/preset', { action: 'recall', slot: 1 });
    await sleep(150);

    const et = await h.state();
    const f = et.fixtures.find(x => x.id === 'b0');
    const attendu = f.p3[0] / et.scene.w + 0.5;
    assert.ok(Math.abs(f.x - attendu) < 0.001,
      'x = ' + f.x + ' alors que p3x = ' + f.p3[0] + ' sur un plateau de '
      + et.scene.w + ' m impose ' + attendu);
    await h.post('/api/scene', { scene: { w: 10, d: 8, h: 6 } });
    await h.post('/api/fixtures', { fixtures: enLigne(6) });
  });

  // ── v2 ────────────────────────────────────────────────────────────────────

  test('v2 · le bruit 3D bouge dans le TEMPS, pas seulement dans l’espace', async () => {
    // Défaut mesuré : `hash3` multipliait en virgule flottante. La coordonnée Z
    // du bruit porte le temps (plusieurs centaines de millions) ; multipliée par
    // 2 147 483 647 elle dépassait 2^53 et les bits de poids faible étaient
    // perdus. Le bruit était GELÉ : une barre à 1,0000 sur huit relevés.
    //
    // ⚠ Les tests d'origine ne l'avaient pas vu parce qu'ils mesuraient la
    // variation ENTRE BARRES, qui elle fonctionnait. D'où ce test, qui suit
    // chaque barre dans le temps.
    await h.post('/api/fixtures', { fixtures: enLigne(6) });
    await h.post('/api/blackout');
    await sleep(80);
    await setL({ engine: 'field', field: 'bruit', target: 'intensity', mode: 'fade',
                 bars: null, stepMs: 500, group: 1, speed: 1, width: 4, phase: 0 });
    await h.post('/api/start');
    const suite = [];
    for (let i = 0; i < 8; i++) {
      h.clearOsc();
      await sleep(260);
      const n = niveaux(h.osc());
      if (n.size) suite.push(n);
    }
    await h.post('/api/stop');
    assert.ok(suite.length >= 5, 'trop peu de relevés : ' + suite.length);

    let bougent = 0;
    const details = [];
    for (const b of ['bar0', 'bar1', 'bar2', 'bar3', 'bar4', 'bar5']) {
      const vs = suite.map(n => n.get(b)).filter(v => v != null);
      if (vs.length < 3) continue;
      const et = Math.max(...vs) - Math.min(...vs);
      details.push(b + '=' + et.toFixed(3));
      if (et > 0.05) bougent++;
    }
    assert.ok(bougent >= 3,
      'le bruit doit vivre dans le temps : seulement ' + bougent + ' barre(s) sur 6 varient — '
      + details.join(' '));
  });

  test('v2 · le centre du champ en profondeur est bien le milieu du plateau', async () => {
    // Défaut : `cy = sc.d / 2` alors que Y est centré sur ZÉRO (la grille du sol
    // va de -d/2 à +d/2, et un projet v1 migré arrive à y = 0). Le plan en
    // profondeur était décalé d'une demi-profondeur.
    //
    // La propriété qui le prouve : deux barres SYMÉTRIQUES par rapport au centre
    // du plateau doivent recevoir la même valeur quand on replie le champ sur
    // son centre. Si le centre est faux, elles diffèrent.
    await h.post('/api/fixtures', { fixtures: [
      { id: 'p1', name: 'Devant', address: '/fixtures/bar0', enabled: true, x: 0.5, y: 0.5 },
      { id: 'p2', name: 'Derrière', address: '/fixtures/bar1', enabled: true, x: 0.5, y: 0.5 },
    ] });
    await h.post('/api/fixture3d', { fixtures: [
      { id: 'p1', p3: [0, -3, 3], dir3: [1, 0, 0], len3: 1 },
      { id: 'p2', p3: [0, 3, 3], dir3: [1, 0, 0], len3: 1 },
    ] });
    // Plan en profondeur, replié sur son centre (axisX 0,5 = le centre de u)
    await setL({ engine: 'field', field: 'plan', axAz: 90, axEl: 0, target: 'intensity',
                 mode: 'fade', bars: null, mirrorH: true, axisX: 0.5, width: 8, ...GEL });
    await h.post('/api/start');
    const n = await lire(250);
    await h.post('/api/stop');
    assert.equal(n.size, 2, 'les deux barres doivent être vues');
    assert.ok(Math.abs(n.get('bar0') - n.get('bar1')) < 0.02,
      'deux barres symétriques en profondeur doivent recevoir la même valeur — '
      + 'vu ' + n.get('bar0') + ' et ' + n.get('bar1')
      + ' : le centre du champ n’est pas au milieu du plateau');
    await h.post('/api/fixtures', { fixtures: enLigne(6) });
  });

  test('v2 · « Centrer la source » vise le vrai centre du plateau', async () => {
    // Le bouton écrivait srcY = d/2, c'est-à-dire le bord LOINTAIN, puisque Y
    // est centré sur zéro. Ici on vérifie la règle côté serveur : une source au
    // centre doit être à égale distance de deux barres symétriques.
    await h.post('/api/fixtures', { fixtures: [
      { id: 's1', name: 'A', address: '/fixtures/bar0', enabled: true, x: 0.5, y: 0.5 },
      { id: 's2', name: 'B', address: '/fixtures/bar1', enabled: true, x: 0.5, y: 0.5 },
    ] });
    await h.post('/api/fixture3d', { fixtures: [
      { id: 's1', p3: [0, -3, 3], dir3: [1, 0, 0], len3: 1 },
      { id: 's2', p3: [0, 3, 3], dir3: [1, 0, 0], len3: 1 },
    ] });
    const sc = (await h.state()).scene;
    await setL({ engine: 'field', field: 'sphere', target: 'intensity', mode: 'fade',
                 bars: null, srcX: 0, srcY: 0, srcZ: sc.h / 2, width: 8, ...GEL });
    await h.post('/api/start');
    const n = await lire(250);
    await h.post('/api/stop');
    assert.ok(Math.abs(n.get('bar0') - n.get('bar1')) < 0.02,
      'une source au centre doit traiter deux barres symétriques à l’identique — '
      + n.get('bar0') + ' vs ' + n.get('bar1'));
    await h.post('/api/fixtures', { fixtures: enLigne(6) });
  });

  test('v2 · le cylindre ne bascule pas en traversant les élévations', async () => {
    // Défaut mesuré : le vecteur de référence changeait à |sin(élévation)| = 0,9,
    // soit 64,16°. La base s'inversait et le faisceau sautait d'un demi-tour —
    // 0,98 d'écart pour UN degré d'élévation.
    //
    // ⚠ Le correctif qu'on m'avait proposé (« prendre toujours (0,0,1) »)
    // dégénère à l'aplomb : le produit vectoriel s'annule et le champ devient
    // uniforme. On balaie donc TOUTE la plage, pôles compris.
    // ⚠ Barres placées aux azimuts 45/135/225/315, JAMAIS sur l'axe.
    // Une barre posée exactement sur l'axe du phare n'a pas d'azimut : sa valeur
    // change brusquement quand l'axe la traverse, et c'est géométriquement
    // inévitable, pas un défaut. Mesuré séparément (test suivant). Les mettre
    // ici rendrait ce test-ci incapable de distinguer les deux phénomènes.
    await h.post('/api/fixtures', { fixtures: [0, 1, 2, 3].map(i => ({
      id: 'c' + i, name: 'C' + i, address: '/fixtures/bar' + i, enabled: true, x: 0.5, y: 0.5 })) });
    await h.post('/api/fixture3d', { fixtures: [0, 1, 2, 3].map(i => {
      const a = Math.PI / 4 + i * Math.PI / 2;
      return { id: 'c' + i, p3: [3 * Math.cos(a), 3 * Math.sin(a), 2], dir3: [1, 0, 0], len3: 1 };
    }) });

    const parEl = new Map();
    for (let el = -90; el <= 90; el += 5) {
      await setL({ engine: 'field', field: 'cylindre', axAz: 0, axEl: el, target: 'intensity',
                   mode: 'fade', bars: null, srcX: 0, srcY: 0, srcZ: 2, width: 8, ...GEL });
      await h.post('/api/start');
      parEl.set(el, await lire(140));
      await h.post('/api/stop');
    }

    const els = [...parEl.keys()];
    let pire = 0, ou = '';
    for (let i = 1; i < els.length; i++) {
      const d = ecartMax(parEl.get(els[i - 1]), parEl.get(els[i]));
      if (d > pire) { pire = d; ou = els[i - 1] + '° → ' + els[i] + '°'; }
    }
    assert.ok(pire < 0.35,
      'saut de ' + pire.toFixed(3) + ' entre ' + ou + ' : la base du cylindre bascule');

    // Et le champ ne doit JAMAIS devenir uniforme — c'est le piège du correctif
    // naïf : aux pôles, une base mal construite annule l'angle pour tout le monde.
    for (const el of [-90, -45, 0, 45, 90]) {
      const vs = [...parEl.get(el).values()];
      assert.ok(Math.max(...vs) - Math.min(...vs) > 0.2,
        'à ' + el + '° le cylindre ne distingue plus les azimuts : ' + JSON.stringify(vs));
    }
    await h.post('/api/fixtures', { fixtures: enLigne(6) });
  });

  test('v2 · une barre posée SUR l’axe du phare reste saine et stable', async () => {
    // Singularité géométrique assumée : un point situé exactement sur l'axe d'un
    // phare n'a pas d'azimut. Le moteur lui donne l'angle 0, ce qui est
    // arbitraire — mais deux choses doivent tenir, et c'est tout ce que ce test
    // affirme : la valeur reste FINIE, et elle ne clignote pas d'une image à
    // l'autre. (J'avais d'abord écrit que la barre resterait « au centre du
    // faisceau », donc allumée en permanence : mesuré, c'est faux. Elle suit la
    // phase courante comme une barre à l'azimut zéro.)
    await h.post('/api/fixtures', { fixtures: [
      { id: 'ax', name: 'Sur l’axe', address: '/fixtures/bar0', enabled: true, x: 0.5, y: 0.5 },
      { id: 'ho', name: 'Hors axe', address: '/fixtures/bar1', enabled: true, x: 0.5, y: 0.5 },
    ] });
    await h.post('/api/fixture3d', { fixtures: [
      { id: 'ax', p3: [3, 0, 2], dir3: [1, 0, 0], len3: 1 },   // sur l’axe à axEl 0
      { id: 'ho', p3: [0, 3, 2], dir3: [1, 0, 0], len3: 1 },   // jamais sur l’axe
    ] });
    await setL({ engine: 'field', field: 'cylindre', axAz: 0, axEl: 0, target: 'intensity',
                 mode: 'fade', bars: null, srcX: 0, srcY: 0, srcZ: 2, width: 8, ...GEL });
    await h.post('/api/start');
    const a = await lire(220);
    const b = await lire(220);
    await h.post('/api/stop');
    for (const bar of ['bar0', 'bar1']) {
      assert.ok(Number.isFinite(a.get(bar)), bar + ' : valeur non finie ' + a.get(bar));
      assert.ok(a.get(bar) >= 0 && a.get(bar) <= 1, bar + ' hors bornes : ' + a.get(bar));
      // Phase gelée : deux relevés successifs doivent coïncider. Un clignotement
      // ici trahirait un calcul instable au voisinage de la singularité.
      if (b.get(bar) != null) {
        assert.ok(Math.abs(b.get(bar) - a.get(bar)) < 0.02,
          bar + ' clignote : ' + a.get(bar) + ' puis ' + b.get(bar));
      }
    }
    await h.post('/api/fixtures', { fixtures: enLigne(6) });
  });

  test('v2 · le cylindre ne se déchire pour aucune étendue', async () => {
    // Défaut mesuré : l'angle est cyclique, donc au raccord la phase saute de
    // 1/wl. Ce saut n'est invisible que s'il vaut un nombre ENTIER de cycles —
    // vrai pour width 1, 2, 4, 8, faux pour 3, 5, 6, 7. À width 3, deux barres
    // voisines de 10° sautaient de 0,918 alors que l'écart médian valait 0,168.
    const N = 24;
    await h.post('/api/fixtures', { fixtures: Array.from({ length: N }, (_, i) => ({
      id: 'r' + i, name: 'R' + i, address: '/fixtures/bar' + i, enabled: true, x: 0.5, y: 0.5 })) });
    await h.post('/api/fixture3d', { fixtures: Array.from({ length: N }, (_, i) => {
      const a = (i / N) * 2 * Math.PI;
      return { id: 'r' + i, p3: [3 * Math.cos(a), 3 * Math.sin(a), 2], dir3: [1, 0, 0], len3: 0.5 };
    }) });

    for (const width of [1, 2, 3, 4, 5, 6, 7, 8]) {
      await setL({ engine: 'field', field: 'cylindre', axAz: 0, axEl: 90, target: 'intensity',
                   mode: 'fade', bars: null, srcX: 0, srcY: 0, srcZ: 2, width, ...GEL });
      await h.post('/api/start');
      const n = await lire(160);
      await h.post('/api/stop');
      // Écart entre barres VOISINES sur le cercle, raccord compris
      const suite = Array.from({ length: N }, (_, i) => n.get('bar' + i)).filter(v => v != null);
      if (suite.length < N) continue;
      const sauts = suite.map((v, i) => Math.abs(suite[(i + 1) % N] - v)).sort((a, b) => a - b);
      const median = sauts[Math.floor(sauts.length / 2)];
      const pire = sauts[sauts.length - 1];
      // Un champ continu sur un cercle : le plus grand saut ne doit pas écraser
      // les autres. On tolère un facteur 4 — au-delà, c'est une déchirure.
      assert.ok(pire < Math.max(0.25, median * 4 + 0.05),
        'width ' + width + ' : saut de ' + pire.toFixed(3)
        + ' entre deux barres voisines pour un écart médian de ' + median.toFixed(3));
    }
    await h.post('/api/fixtures', { fixtures: enLigne(6) });
  });

  // ── Coupure générale : le noir de secours du régime texture ───────────────

  test('la coupure générale met la sortie DMX de MadMapper à zéro', async () => {
    // Mesuré sur MadMapper 6.0.9 : /master/master_dmx_level à 0 met les 240
    // canaux à zéro, y compris ceux des fixtures que Cascade ne connaît pas.
    // C'est la seule voie qui coupe VRAIMENT quand une texture joue.
    h.clearOsc();
    const r = await h.post('/api/coupure', { on: true });
    await sleep(150);
    assert.equal(r.body.ok, true);
    assert.equal(r.body.coupure, true);
    const m = h.osc().find(x => x.address === '/master/master_dmx_level');
    assert.ok(m, 'aucun message /master/master_dmx_level envoyé');
    assert.equal(m.args[0], 0, 'la coupure doit envoyer zéro');
    assert.equal((await h.state()).global.coupure, true, 'l’état doit être visible dans l’interface');

    h.clearOsc();
    await h.post('/api/coupure', { on: false });
    await sleep(150);
    const m2 = h.osc().find(x => x.address === '/master/master_dmx_level');
    assert.ok(m2 && m2.args[0] === 1, 'le rétablissement doit renvoyer 1');
    assert.equal((await h.state()).global.coupure, false);
  });

  test('la coupure ne se confond PAS avec BLACKOUT ni avec STOP', async () => {
    // Règle n°4 du projet : STOP relâche le contrôle (aucun envoi), seul
    // BLACKOUT envoie des zéros AUX BARRES. La coupure touche un réglage GLOBAL
    // de MadMapper — la mélanger aux deux autres casserait la confiance qu'un
    // régisseur met dans ces boutons.
    await h.post('/api/coupure', { on: false });
    await sleep(100);

    // BLACKOUT ne doit pas toucher au master de MadMapper
    await h.post('/api/fixtures', { fixtures: enLigne(4) });
    await h.post('/api/start');
    await sleep(150);
    h.clearOsc();
    await h.post('/api/blackout');
    await sleep(200);
    assert.deepEqual(h.osc().filter(x => /^\/master\//.test(x.address)), [],
      'BLACKOUT ne doit rien envoyer au master de MadMapper');
    assert.equal((await h.state()).global.coupure, false, 'BLACKOUT ne doit pas engager la coupure');

    // STOP non plus, évidemment
    await h.post('/api/start');
    await sleep(120);
    h.clearOsc();
    await h.post('/api/stop');
    await sleep(200);
    assert.deepEqual(h.osc().filter(x => /^\/master\//.test(x.address)), [],
      'STOP ne doit rien envoyer du tout');

    // …et inversement : la coupure ne doit pas arrêter le moteur.
    await h.post('/api/start');
    await h.post('/api/coupure', { on: true });
    await sleep(150);
    assert.equal((await h.state()).global.running, true,
      'la coupure est une sécurité de sortie, elle n’arrête pas le show');
    await h.post('/api/coupure', { on: false });
    await h.post('/api/stop');
  });

  test('la coupure survit à un redémarrage, pour que l’interface puisse le dire', async () => {
    // Si Cascade redémarre alors que la coupure est engagée, MadMapper reste
    // noir. Oublier l'état laisserait le régisseur chercher pourquoi rien ne
    // s'allume — c'est exactement le genre de mystère qui coûte un spectacle.
    await h.post('/api/coupure', { on: true });
    await sleep(150);
    const exp = await h.get('/api/export');
    assert.equal(exp.body.global.coupure, true, 'l’état doit être exporté');
    await h.post('/api/coupure', { on: false });
    await sleep(100);
    assert.equal((await h.state()).global.coupure, false);
  });

  test('aucune erreur n’a été écrite dans le journal du serveur', () => {
    const erreurs = h.logs.join('').split('\n').filter(l =>
      /erreur inattendue|promesse rejetée|erreur moteur|Error:|TypeError|RangeError/.test(l));
    assert.equal(erreurs.length, 0, 'le serveur a signalé :\n' + erreurs.join('\n'));
  });
});
