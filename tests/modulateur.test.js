'use strict';
/**
 * Le modulateur (LFO) d'une couche.
 *
 * L'idée des modulateurs de Smode, tenue dans une portée qui se finit : un
 * modulateur par couche, sur une liste FERMÉE de réglages continus.
 *
 * Les deux propriétés qui comptent, et que ce fichier verrouille :
 *
 *  1. il ne touche JAMAIS à l'état — sinon ses valeurs seraient sauvegardées,
 *     exportées et mémorisées dans les presets, et on retrouverait un projet
 *     figé sur l'instant où on a cliqué ;
 *  2. il ne peut pas sortir un réglage de sa plage, même avec des bornes
 *     délirantes, parce que sa valeur passe par le même nettoyage qu'une saisie.
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

const enLigne = (n) => Array.from({ length: n }, (_, i) => ({
  id: 'c' + i, name: 'B' + i, address: '/fixtures/bar' + i, enabled: true,
  x: 0.1 + 0.8 * (i / (n - 1)), y: 0.5, rot: 0,
}));

describe('Modulateur — faire respirer un réglage', () => {
  let h;
  before(async () => {
    h = await start();
    await h.post('/api/fixtures', { fixtures: enLigne(6) });
  });
  after(async () => { await h.stop(); });

  /**
   * ⚠ L'identifiant est relu à CHAQUE appel, et ce n'est pas de la prudence
   * gratuite : `/api/import` recrée les couches avec de nouveaux identifiants.
   * Un id capturé dans `before()` devient alors mort, `/api/layer` ne trouve
   * plus rien, et tout réglage posé ensuite part silencieusement dans le vide —
   * le test suivant mesure l'état laissé par le précédent en croyant mesurer le
   * sien. Piège déjà rencontré ailleurs dans ce projet.
   */
  const setL = async (set) =>
    h.post('/api/layer', { id: (await h.state()).layers[0].id, set });

  /** Couche « tout allumé », sans animation : on mesure un niveau, pas un motif. */
  const plate = (extra) => setL({
    engine: 'wave', pattern: 'pulse', waveform: 'square', mode: 'onoff',
    floor: 1, level: 0.5, invert: false, mirrorH: false, mirrorV: false,
    target: 'intensity', blend: 'htp', prof: 0, palette: null, deck: null,
    stepMs: 10000, group: 8, speed: 0.05, width: 8, groupId: null, bars: null,
    lfo: null, ...extra,
  });

  /** Toutes les valeurs vues sur une barre pendant une fenêtre. */
  const suivre = async (bar, ms) => {
    h.clearOsc();
    await sleep(ms);
    return h.osc()
      .filter(m => m.address === '/fixtures/' + bar + '/luminosity')
      .map(m => m.args[0]);
  };

  test('par défaut il n’y en a pas, et rien ne bouge', async () => {
    assert.equal((await h.state()).layers[0].lfo, null, 'aucun modulateur par défaut');
    await plate();
    await h.post('/api/global', { master: 1, speed: 1, dimmer: 'linear' });
    await h.post('/api/start');
    // Fenêtre longue : sans modulateur la valeur ne change pas, et la sortie
    // OSC ne réémet que les changements — seul le rappel d'une seconde passe.
    const v = await suivre('bar0', 1400);
    await h.post('/api/stop');
    assert.ok(v.length >= 1, 'aucune valeur relevée');
    assert.equal(new Set(v.map(x => x.toFixed(3))).size, 1,
      'sans modulateur, le niveau doit être immobile : ' + JSON.stringify(v));
  });

  test('un modulateur fait vraiment respirer le réglage', async () => {
    await plate({ lfo: { on: true, param: 'level', forme: 'sine',
                         periodeMs: 600, min: 0.1, max: 1 } });
    await h.post('/api/start');
    const v = await suivre('bar0', 900);
    await h.post('/api/stop');

    assert.ok(v.length >= 8, 'trop peu de valeurs relevées : ' + v.length);
    assert.ok(Math.max(...v) - Math.min(...v) > 0.6,
      'le niveau doit parcourir presque toute la plage : '
      + Math.min(...v).toFixed(2) + ' → ' + Math.max(...v).toFixed(2));
    assert.ok(Math.max(...v) <= 1.001 && Math.min(...v) >= -0.001,
      'et rester dans les bornes : ' + JSON.stringify([Math.min(...v), Math.max(...v)]));
  });

  test('il ne touche JAMAIS au réglage affiché', async () => {
    // Le point de conception. Un modulateur qui écrirait dans l'état ferait
    // sauvegarder, exporter et mémoriser en preset la valeur de l'instant : le
    // régisseur retrouverait son projet figé sur un hasard.
    await plate({ level: 0.42, lfo: { on: true, param: 'level', forme: 'sine',
                                      periodeMs: 400, min: 0, max: 1 } });
    await h.post('/api/start');
    await sleep(700);                       // le modulateur a tourné plusieurs fois
    const L = (await h.state()).layers[0];
    await h.post('/api/stop');
    assert.equal(L.level, 0.42,
      'le réglage doit rester celui du régisseur, vu ' + L.level);

    // Et l'export non plus ne doit pas contenir la valeur de l'instant.
    const exp = await h.get('/api/export');
    assert.equal(exp.body.layers[0].level, 0.42,
      'l’export doit contenir le réglage, pas la valeur modulée');
  });

  test('des bornes délirantes ne font pas sortir le réglage de sa plage', async () => {
    // ⚠ La version évidente de ce test NE PROUVE RIEN, et l'outil de mutation
    // l'a démontré : moduler `level` de −50 à 900 puis vérifier que la sortie
    // reste dans [0 ; 1] passe même en supprimant tout le nettoyage, parce que
    // `q255()` écrête de toute façon à l'envoi. Test vacuux, supprimé.
    //
    // Le discriminant est `width`, borné à [1 ; 8], parce qu'il change la FORME
    // du motif et pas son niveau : la longueur d'onde vaut width / 8. À 8, une
    // onde entière s'étale sur les barres et l'écart entre elles est grand ; à
    // 800 — valeur qui ne devrait jamais exister — la longueur d'onde vaut 100
    // et les six barres tombent dans 6 % de cycle : elles sortent presque
    // identiques. L'écart minimum observé sépare donc les deux mondes.
    await plate({ pattern: 'lr', waveform: 'sine', mode: 'fade', floor: 0,
                  level: 1, speed: 0.4, stepMs: 1000, group: 6,
                  lfo: { on: true, param: 'width', forme: 'square',
                         periodeMs: 500, min: 8, max: 800 } });
    await h.post('/api/start');
    let ecartMin = 1;
    for (let i = 0; i < 14; i++) {
      h.clearOsc();
      await sleep(70);
      const n = [...niveaux(h.osc()).values()];
      if (n.length < 5) continue;                 // fenêtre trop pauvre, on saute
      ecartMin = Math.min(ecartMin, Math.max(...n) - Math.min(...n));
    }
    await h.post('/api/stop');
    assert.ok(ecartMin > 0.3,
      'la largeur doit rester bornée à 8 : à 800 les barres se confondraient. '
      + 'Écart minimum vu entre barres : ' + ecartMin.toFixed(3));

    // Et le réglage lui-même n'a pas bougé — le modulateur n'écrit pas.
    assert.equal((await h.state()).layers[0].width, 8);
  });

  test('seuls les réglages continus sont modulables', async () => {
    // Laisser moduler `target`, `bars` ou `groupId` fabriquerait des états
    // incohérents plusieurs fois par seconde.
    for (const mauvais of ['target', 'bars', 'groupId', 'engine', 'enabled', 'nawak']) {
      await setL({ lfo: { on: true, param: mauvais, forme: 'sine',
                          periodeMs: 1000, min: 0, max: 1 } });
      assert.equal((await h.state()).layers[0].lfo, null,
        'le paramètre « ' + mauvais + ' » ne doit pas être modulable');
    }
    // Et une forme inconnue retombe sur le sinus au lieu de casser.
    await setL({ lfo: { on: true, param: 'level', forme: 'zigzag',
                        periodeMs: 1000, min: 0, max: 1 } });
    assert.equal((await h.state()).layers[0].lfo.forme, 'sine');
    // La période est bornée des deux côtés.
    await setL({ lfo: { on: true, param: 'level', forme: 'sine',
                        periodeMs: 1, min: 0, max: 1 } });
    assert.ok((await h.state()).layers[0].lfo.periodeMs >= 100);
    await setL({ lfo: { on: true, param: 'level', forme: 'sine',
                        periodeMs: 9e9, min: 0, max: 1 } });
    assert.ok((await h.state()).layers[0].lfo.periodeMs <= 120000);
    await setL({ lfo: null });
  });

  test('le couper rend la main, sans redémarrage', async () => {
    await plate({ level: 0.3, lfo: { on: true, param: 'level', forme: 'sine',
                                     periodeMs: 400, min: 0.8, max: 1 } });
    await h.post('/api/start');
    const anime = await suivre('bar0', 700);
    assert.ok(Math.min(...anime) > 0.7,
      'pendant la modulation, le niveau doit suivre le modulateur : '
      + Math.min(...anime).toFixed(2));

    await setL({ lfo: { on: false, param: 'level', forme: 'sine',
                        periodeMs: 400, min: 0.8, max: 1 } });
    const rendu = await suivre('bar0', 1400);
    await h.post('/api/stop');
    assert.ok(rendu.length >= 1, 'aucune valeur après la coupure');
    assert.ok(Math.abs(rendu[rendu.length - 1] - 0.3) < 0.02,
      'coupé, le réglage du régisseur doit revenir : ' + rendu[rendu.length - 1]);
  });

  test('le modulateur voyage avec le projet et les presets', async () => {
    const m = { on: true, param: 'width', forme: 'rampe',
                periodeMs: 3000, sync: false, cycles: 4, min: 2, max: 12 };
    await setL({ lfo: m });
    await h.post('/api/preset', { action: 'save', slot: 4, name: 'Souffle' });
    const exp = await h.get('/api/export');
    await h.post('/api/new', { keepFixtures: true });
    await h.post('/api/import', exp.body);
    let L = (await h.state()).layers[0];
    assert.deepEqual(L.lfo, m, 'le modulateur doit survivre à l’export/import');

    await setL({ lfo: null });
    await h.post('/api/preset', { action: 'recall', slot: 4 });
    await sleep(120);
    assert.deepEqual((await h.state()).layers[0].lfo, m,
      'le preset doit restaurer le modulateur');
    await setL({ lfo: null });
  });

  test('calé sur le tempo, il suit le tempo — sans qu’on le retouche', async () => {
    // Tout le reste de Cascade est accroché au tempo : un modulateur réglé en
    // millisecondes dérive contre la musique dès qu'on change de morceau.
    // Calé, sa période devient un multiple du cycle de la couche, lequel suit
    // déjà `stepMs` — donc le tap tempo et Ableton Link, qui écrivent dedans.
    //
    // La mesure : le modulateur pilote le niveau en créneau, on compte les
    // bascules. En doublant la vitesse de la couche, il doit y en avoir deux
    // fois plus. En millisecondes, il n'y en aurait pas une de plus.
    const bascules = async (speed) => {
      await plate({ speed, stepMs: 1000, group: 1, level: 1,
                    lfo: { on: true, param: 'level', forme: 'square',
                           sync: true, cycles: 1, periodeMs: 60000,
                           min: 0.1, max: 1 } });
      await h.post('/api/start');
      const v = await suivre('bar0', 2100);
      await h.post('/api/stop');
      let n = 0;
      for (let i = 1; i < v.length; i++) if (Math.abs(v[i] - v[i - 1]) > 0.5) n++;
      return n;
    };

    const lent = await bascules(1);      // cycle de 1 s -> ~4 bascules en 2,1 s
    const vite = await bascules(2);      // cycle de 0,5 s -> ~8
    assert.ok(lent >= 2, 'trop peu de bascules à vitesse 1 : ' + lent);
    assert.ok(vite > lent * 1.5,
      'doubler la vitesse doit à peu près doubler la cadence du modulateur : '
      + lent + ' → ' + vite);

    // Et la période en millisecondes est bel et bien IGNORÉE quand on est calé :
    // elle vaut 60 s ci-dessus, ce qui n'aurait donné aucune bascule.
    assert.ok(lent > 0, 'la période en ms ne doit pas primer sur la synchro');
    await setL({ lfo: null });
  });

  test('aucune erreur n’a été écrite dans le journal du serveur', () => {
    const erreurs = h.logs.join('').split('\n').filter(l =>
      /erreur inattendue|promesse rejetée|erreur moteur|Error:|TypeError|RangeError/.test(l));
    assert.equal(erreurs.length, 0, 'le serveur a signalé :\n' + erreurs.join('\n'));
  });
});
