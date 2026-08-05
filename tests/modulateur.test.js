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
const http = require('node:http');
const { start, sleep } = require('./helpers.js');

/** GET brut, avec des en-têtes choisis — pour éprouver le garde `sec-fetch-dest`. */
function getAvecEntetes(port, chemin, entetes) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: chemin, method: 'GET',
                               headers: entetes, timeout: 5000 }, (res) => {
      let d = '';
      res.on('data', c => { d += c; });
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { resolve(d); } });
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.end();
  });
}

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
    // `src` fait partie de l'objet mémorisé depuis l'arrivée du suiveur audio :
    // sans lui ici, le deepEqual compare une forme périmée.
    const m = { on: true, param: 'width', src: 'lfo', forme: 'rampe',
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

/**
 * Le modulateur GLOBAL — celui qui peut tenir le crossfader tout seul.
 *
 * Même principe que celui des couches, et la même propriété centrale : il
 * n'écrit jamais dans l'état, sa valeur ne vit que le temps d'une image.
 */
describe('Modulateur global', () => {
  let h;
  before(async () => {
    h = await start();
    await h.post('/api/fixtures', { fixtures: enLigne(6) });
  });
  after(async () => { await h.stop(); });

  const niveauxDe = async (ms) => {
    h.clearOsc();
    await sleep(ms);
    return niveaux(h.osc());
  };

  test('par défaut il n’y en a pas', async () => {
    assert.equal((await h.state()).global.modGlobal, null);
  });

  test('branché sur le crossfader, il fait passer d’un jeu à l’autre tout seul', async () => {
    // Deux couches sur des barres différentes, une par jeu. Sans toucher au
    // fader, les deux groupes doivent s'allumer à tour de rôle.
    const S = await h.state();
    const A = S.layers[0].id;
    await h.post('/api/layers', { action: 'add' });
    const B = (await h.state()).layers[1].id;
    const plate = (id, bars, deck) => h.post('/api/layer', { id, set: {
      engine: 'wave', pattern: 'pulse', waveform: 'square', mode: 'onoff',
      floor: 1, level: 1, target: 'intensity', blend: 'htp', deck, bars,
      stepMs: 10000, group: 8, speed: 0.05, width: 8, lfo: null,
    } });
    await plate(A, ['c0', 'c1'], 'a');
    await plate(B, ['c4', 'c5'], 'b');
    await h.post('/api/global', { master: 1, speed: 1, dimmer: 'linear', xfade: 0,
      modGlobal: { on: true, param: 'xfade', forme: 'square',
                   periodeMs: 600, sync: false, cycles: 8, min: 0, max: 1 } });
    await h.post('/api/start');

    let vuA = false, vuB = false;
    for (let i = 0; i < 12; i++) {
      const n = await niveauxDe(90);
      if (n.get('bar0') > 0.9) vuA = true;
      if (n.get('bar4') > 0.9) vuB = true;
    }
    await h.post('/api/stop');
    assert.ok(vuA && vuB,
      'les deux jeux doivent jouer à tour de rôle sans qu’on touche au fader — '
      + 'jeu A vu : ' + vuA + ', jeu B vu : ' + vuB);
  });

  test('il n’écrit pas dans l’état, comme celui des couches', async () => {
    await h.post('/api/global', { xfade: 0.25,
      modGlobal: { on: true, param: 'xfade', forme: 'sine',
                   periodeMs: 400, sync: false, cycles: 8, min: 0, max: 1 } });
    await h.post('/api/start');
    await sleep(700);
    const g = (await h.state()).global;
    await h.post('/api/stop');
    assert.equal(g.xfade, 0.25,
      'le fader doit rester où le régisseur l’a laissé, vu ' + g.xfade);
  });

  test('rien d’hostile ne passe, et les bornes du réglage tiennent', async () => {
    for (const mauvais of ['running', 'param', 'dimmer', 'presetFade', 'nawak']) {
      await h.post('/api/global', { modGlobal: { on: true, param: mauvais,
        forme: 'sine', periodeMs: 1000, min: 0, max: 1 } });
      assert.equal((await h.state()).global.modGlobal, null,
        'le réglage « ' + mauvais + ' » ne doit pas être modulable globalement');
    }
    await h.post('/api/global', { modGlobal: { on: true, param: 'master',
      forme: 'zigzag', periodeMs: 1, sync: 1, cycles: 999, min: -9, max: 9 } });
    const g = (await h.state()).global.modGlobal;
    assert.equal(g.forme, 'sine', 'une forme inconnue retombe sur le sinus');
    assert.ok(g.periodeMs >= 100 && g.cycles <= 64,
      'période et cycles doivent être bornés : ' + JSON.stringify(g));

    // Les bornes délirantes sont ramenées à l'envoi, pas stockées telles quelles
    // dans le réglage global : c'est `sanitizeGlobal` qui tranche à chaque image.
    await h.post('/api/start');
    await sleep(300);
    await h.post('/api/stop');
    await h.post('/api/global', { modGlobal: null, master: 1 });
    assert.equal((await h.state()).global.master, 1,
      'le master doit revenir à ce que le régisseur a posé');
  });

  test('il voyage avec le projet', async () => {
    const m = { on: true, param: 'xfade', src: 'lfo', forme: 'triangle',
                periodeMs: 5000, sync: true, cycles: 4, min: 0.2, max: 0.8 };
    await h.post('/api/global', { modGlobal: m });
    const exp = await h.get('/api/export');
    assert.deepEqual(exp.body.global.modGlobal, m, 'il doit être exporté');
    await h.post('/api/new', { keepFixtures: true });
    assert.equal((await h.state()).global.modGlobal, null,
      'un projet neuf ne doit pas en garder un');
    await h.post('/api/import', exp.body);
    assert.deepEqual((await h.state()).global.modGlobal, m,
      'il doit survivre à l’import');
    await h.post('/api/global', { modGlobal: null });
  });

  test('aucune erreur n’a été écrite dans le journal du serveur', () => {
    const erreurs = h.logs.join('').split('\n').filter(l =>
      /erreur inattendue|promesse rejetée|erreur moteur|Error:|TypeError|RangeError/.test(l));
    assert.equal(erreurs.length, 0, 'le serveur a signalé :\n' + erreurs.join('\n'));
  });
});

/**
 * Le suiveur audio, côté serveur.
 *
 * L'analyse du son vit dans le NAVIGATEUR — le zéro-dépendance interdit une
 * entrée son ici. Le serveur ne reçoit qu'un flottant, poussé sur le poll que
 * l'interface fait déjà. C'est ce qui rend toute cette moitié testable SANS
 * micro : `h.get('/api/state?a=0.9')` suffit à pousser un niveau.
 *
 * La propriété qui compte le plus est la PÉREMPTION QUI REND LA MAIN : sans
 * niveau frais, le modulateur laisse le réglage du régisseur intact au lieu de
 * retomber sur sa borne basse. Sur `master` avec min 0, retomber sur `min`
 * serait le noir en plein spectacle.
 */
describe('Suiveur audio — le micro comme source de modulateur', () => {
  let h, id;
  before(async () => {
    h = await start();
    await h.post('/api/fixtures', { fixtures: enLigne(4) });
    id = (await h.state()).layers[0].id;
    await h.post('/api/layer', { id, set: { pattern: 'all', mode: 'onoff', width: 8 } });
  });
  after(async () => { await h.stop(); });

  const setL = (set) => h.post('/api/layer', { id, set });
  /**
   * Pousse un niveau audio, comme le ferait le poll de l'interface, et rend
   * l'état renvoyé — c'est le même aller-retour que fait le navigateur.
   */
  const pousser = (v) => h.get('/api/state?a=' + v).then(r => r.body);
  /**
   * Les niveaux CALCULÉS, pas l'OSC émis.
   *
   * ⚠ Le cache d'envoi ne réémet PAS une valeur inchangée : un plateau stable
   * ne produit aucun message, et une assertion « toutes les valeurs valent x »
   * passerait alors sur un tableau vide, sans rien mesurer. C'est exactement le
   * piège que ce dépôt a déjà payé deux fois. `runtime.levels` dit ce que le
   * moteur calcule à l'instant, qu'il l'ait émis ou non.
   */
  const calcules = async (st) => {
    const s = st || (await h.state());
    const v = (s.levels || []).filter(x => typeof x === 'number');
    assert.ok(v.length > 0, 'aucun niveau calculé : le test ne mesurerait rien');
    return v;
  };

  test('une source inconnue retombe sur l’oscillateur', async () => {
    const r = await setL({ lfo: { on: true, param: 'level', src: 'pirate', min: 0, max: 1 } });
    assert.equal(r.body.layer.lfo.src, 'lfo', 'liste fermée, comme les formes');
    const r2 = await setL({ lfo: { on: true, param: 'level', min: 0, max: 1 } });
    assert.equal(r2.body.layer.lfo.src, 'lfo', 'absente aussi : rétrocompatible');
    await setL({ lfo: null });
  });

  test('sans le moindre niveau reçu, le réglage du régisseur est intact', async () => {
    await setL({ level: 0.5, lfo: { on: true, param: 'level', src: 'audio', min: 0.1, max: 1 } });
    await h.post('/api/start');
    await sleep(300);
    const vus = await calcules();
    await h.post('/api/stop');
    assert.ok(vus.every(v => Math.abs(v - 0.5) < 0.02),
      'tout doit rester sur la valeur réglée à la main : ' + vus);
    await setL({ lfo: null });
  });

  test('le niveau du micro fait bouger la lumière', async () => {
    await setL({ level: 0.5, lfo: { on: true, param: 'level', src: 'audio', min: 0.1, max: 1 } });
    await h.post('/api/start');
    await sleep(150);
    for (let i = 0; i < 3; i++) { await pousser(0.05); await sleep(60); }
    const bas = Math.max(...(await calcules()));
    for (let i = 0; i < 3; i++) { await pousser(0.95); await sleep(60); }
    const haut = Math.max(...(await calcules()));
    await h.post('/api/stop');
    assert.ok(haut - bas > 0.5,
      'le micro doit vraiment moduler : bas ' + bas.toFixed(3) + ', haut ' + haut.toFixed(3));
    await setL({ lfo: null });
  });

  test('LE TEST DE SÉCURITÉ : la péremption REND LA MAIN, elle ne fige pas', async () => {
    // Onglet fermé, micro débranché, machine en veille : le niveau cesse
    // d'arriver. Le modulateur doit alors rendre la main au réglage posé à la
    // main — surtout PAS rester cloué sur la dernière valeur, ni tomber sur min.
    await setL({ level: 0.5, lfo: { on: true, param: 'level', src: 'audio', min: 0.1, max: 1 } });
    await h.post('/api/start');
    for (let i = 0; i < 4; i++) { await pousser(0.95); await sleep(70); }
    const pendant = Math.max(...(await calcules()));
    // On cesse de pousser, et on laisse la péremption faire son travail.
    await sleep(1200);
    const apres = await calcules();
    await h.post('/api/stop');
    assert.ok(pendant > 0.8, 'le micro pilotait bien, vu ' + pendant.toFixed(3));
    assert.ok(apres.every(v => Math.abs(v - 0.5) < 0.02),
      'après péremption on doit RETROUVER 0,5 — ni 0,95 figé, ni 0,1 (min) : ' + apres);
    await setL({ lfo: null });
  });

  test('LE TEST QUI MANQUAIT : le RETOUR à la main ne passe jamais par le bas', async () => {
    // Le test ci-dessus ne regardait qu'APRÈS la péremption complète, et laissait
    // donc passer un vrai défaut, trouvé par relecture adversariale : entre la
    // tenue (250 ms) et la péremption (700 ms), le NIVEAU décroissait vers 0.
    // Or `min + (max-min) × niveau` envoie un niveau nul sur `min` — le paramètre
    // plongeait donc vers sa borne basse pendant 450 ms avant de rendre la main.
    // Sur le master avec min 0, c'est le noir en plein spectacle : exactement ce
    // que la documentation de la fonction promet d'éviter.
    //
    // On échantillonne ici PENDANT la fenêtre de fondu, avec un min TRÈS bas pour
    // que le plongeon soit visible s'il revient.
    await setL({ level: 0.8, lfo: { on: true, param: 'level', src: 'audio', min: 0, max: 1 } });
    await h.post('/api/start');
    // Le micro pousse un niveau haut, puis décroche.
    for (let i = 0; i < 4; i++) { await pousser(0.85); await sleep(70); }
    const releves = [];
    // On balaie toute la fenêtre tenue + fondu + après (0 à ~1,1 s).
    for (let i = 0; i < 12; i++) { releves.push(...(await calcules())); await sleep(95); }
    await h.post('/api/stop');
    const bas = Math.min(...releves);
    // Le micro pilotait à 0,85 et le réglage vaut 0,8 : la valeur doit rester
    // ENTRE les deux, jamais plonger vers 0. Marge large pour la charge de suite.
    assert.ok(bas > 0.6,
      'le retour à la main ne doit jamais passer par le bas — plus basse valeur vue : '
      + bas.toFixed(3) + ' (le plongeon vers `min` est de retour)');
    const fin = await calcules();
    assert.ok(fin.every(v => Math.abs(v - 0.8) < 0.03),
      'et à la fin, le réglage réglé à la main doit être repris : ' + fin);
    await setL({ lfo: null });
  });

  test('une BALISE IMAGE ne peut pas clouer un modulateur en butée', async () => {
    // Le niveau voyage en query sur un GET. Sans garde, une page piégée ouverte
    // sur la machine hôte boucle sur `<img src="…/api/state?a=1">` et cloue un
    // modulateur audio à fond — sur le master avec min 0, c'est le noir en plein
    // show. Une image annonce `sec-fetch-dest: image` ; le fetch de l'interface
    // annonce `empty`. On refuse tout ce qui n'est pas une requête de script.
    await setL({ level: 0.5, lfo: { on: true, param: 'level', src: 'audio', min: 0.1, max: 1 } });
    await h.post('/api/start');
    // Une « image » pousse un niveau maximal, en boucle.
    for (let i = 0; i < 6; i++) {
      await getAvecEntetes(h.port, '/api/state?a=1', { 'sec-fetch-dest': 'image' });
      await sleep(60);
    }
    const vus = await calcules();
    assert.ok(vus.every(v => Math.abs(v - 0.5) < 0.02),
      'une balise image ne doit RIEN pousser — le réglage doit rester à 0,5 : ' + vus);

    // …alors que la vraie interface, elle, est bien entendue.
    for (let i = 0; i < 6; i++) {
      await getAvecEntetes(h.port, '/api/state?a=1', { 'sec-fetch-dest': 'empty' });
      await sleep(60);
    }
    const apres = await calcules();
    await h.post('/api/stop');
    assert.ok(Math.max(...apres) > 0.9,
      'le fetch de l’interface doit, lui, être pris en compte : ' + apres);
    await setL({ lfo: null });
  });

  test('le suiveur n’écrit jamais dans l’état', async () => {
    await setL({ level: 0.5, lfo: { on: true, param: 'level', src: 'audio', min: 0.1, max: 1 } });
    await h.post('/api/start');
    for (let i = 0; i < 10; i++) await pousser(0.9);
    const st = await h.state();
    await h.post('/api/stop');
    assert.equal(st.layers[0].level, 0.5, 'le réglage affiché ne doit pas bouger');
    assert.ok(!('audio' in st), 'aucun niveau audio dans /api/state');
    const exp = await h.get('/api/export');
    assert.equal(exp.body.layers[0].level, 0.5, 'l’export porte le réglage, pas la mesure');
    await setL({ lfo: null });
  });

  test('STOP reste STOP, même avec du son plein les oreilles', async () => {
    // Règle n°4 : STOP relâche le contrôle, aucun envoi OSC. Le suiveur ne doit
    // pas rouvrir cette porte par la bande.
    await setL({ level: 0.5, lfo: { on: true, param: 'level', src: 'audio', min: 0.1, max: 1 } });
    // Témoin positif d'abord : sans lui, ce test passerait aussi si le moteur
    // n'émettait JAMAIS rien — un test qui ne mesure rien conclut que tout va bien.
    await h.post('/api/start');
    h.clearOsc();
    for (let i = 0; i < 4; i++) { await pousser(i % 2 ? 0.9 : 0.1); await sleep(70); }
    assert.ok(h.osc().length > 0, 'témoin : en marche, le micro fait bien sortir des messages');
    await h.post('/api/stop');
    await sleep(200); h.clearOsc();
    for (let i = 0; i < 5; i++) { await pousser(1); await sleep(80); }
    // ⚠ Cascade sonde MadMapper toutes les 3 s même à l'arrêt : c'est voulu et
    // ça n'allume rien. On ne juge donc que ce qui pilote les barres.
    const versFixtures = h.osc().filter(m => /^\/fixtures\//.test(m.address));
    assert.deepEqual(versFixtures, [], 'aucune valeur ne doit partir aux barres à l’arrêt');
    await setL({ lfo: null });
  });

  test('une valeur hostile en query ne cloue rien en butée', async () => {
    await setL({ level: 0.5, lfo: { on: true, param: 'level', src: 'audio', min: 0.1, max: 1 } });
    for (const v of ['1e12', '-5', 'abc', '', '0.5&a=0.9', '../../etc']) {
      const r = await h.get('/api/state?a=' + encodeURIComponent(v));
      assert.equal(r.status, 200, 'aucune valeur ne doit faire tomber le serveur : ' + v);
    }
    await h.post('/api/start');
    await sleep(200);
    const vus = await calcules();
    await h.post('/api/stop');
    assert.ok(vus.every(v => v >= 0 && v <= 1), 'niveaux hors bornes : ' + vus);
    await setL({ lfo: null });
  });

  test('les bornes sont héritées, pas réimplémentées', async () => {
    // min/max délirants : c'est `sanitizeLayerSet` qui borne, pas du code neuf.
    await setL({ level: 0.5, lfo: { on: true, param: 'level', src: 'audio', min: -5, max: 9 } });
    await h.post('/api/start');
    for (let i = 0; i < 5; i++) { await pousser(1); await sleep(70); }
    const vus = await calcules();
    await h.post('/api/stop');
    assert.ok(vus.every(v => v >= 0 && v <= 1), 'tout doit rester dans 0..1 : ' + vus);
    await setL({ lfo: null });
  });

  test('la source voyage avec le projet et les presets', async () => {
    const m = { on: true, param: 'level', src: 'audio', forme: 'sine',
                periodeMs: 4000, sync: false, cycles: 4, min: 0.2, max: 0.9 };
    await setL({ lfo: m });
    await h.post('/api/preset', { action: 'save', slot: 2, name: 'Micro' });
    const exp = await h.get('/api/export');
    await h.post('/api/new', { keepFixtures: true });
    await h.post('/api/import', exp.body);
    assert.deepEqual((await h.state()).layers[0].lfo, m, 'export/import');
    await setL({ lfo: null });
    await h.post('/api/preset', { action: 'recall', slot: 2 });
    await sleep(150);
    assert.deepEqual((await h.state()).layers[0].lfo, m, 'rappel de preset');
    await setL({ lfo: null });
    await h.post('/api/preset', { action: 'clear', slot: 2 });
  });

  test('le modulateur GLOBAL accepte aussi le micro, et relâche pareil', async () => {
    const id0 = (await h.state()).layers[0].id;
    await h.post('/api/layer', { id: id0, set: { level: 1, lfo: null,
      pattern: 'all', mode: 'onoff', width: 8 } });
    await h.post('/api/global', { master: 0.5,
      modGlobal: { on: true, param: 'master', src: 'audio', min: 0.1, max: 1 } });
    await h.post('/api/start');
    for (let i = 0; i < 4; i++) { await pousser(0.95); await sleep(90); }
    h.clearOsc(); await sleep(200);
    const pendant = Math.max(...niveaux(h.osc()).values());
    await sleep(1200); h.clearOsc(); await sleep(300);
    const apres = [...niveaux(h.osc()).values()];
    await h.post('/api/stop');
    const st = await h.state();
    assert.ok(pendant > 0.8, 'le micro pilotait le master, vu ' + pendant.toFixed(3));
    assert.ok(apres.every(v => Math.abs(v - 0.5) < 0.02),
      'après péremption, le master réglé à la main revient : ' + apres);
    assert.equal(st.global.master, 0.5, 'et l’état n’a jamais été écrit');
    await h.post('/api/global', { modGlobal: null, master: 1 });
  });

  test('aucun conflit avec Ableton Link : le suiveur n’écrit pas stepMs', async () => {
    // Il n'y a rien à arbitrer, et c'est mieux que de bien arbitrer : le suiveur
    // ne touche pas au tempo, donc `applyLinkBpm` n'a rien à écraser.
    const id0 = (await h.state()).layers[0].id;
    await h.post('/api/layer', { id: id0, set: { stepMs: 500,
      lfo: { on: true, param: 'level', src: 'audio', min: 0, max: 1 } } });
    await h.post('/api/start');
    for (let i = 0; i < 6; i++) { await pousser(0.7); await sleep(90); }
    const st = await h.state();
    await h.post('/api/stop');
    assert.equal(st.layers[0].stepMs, 500, 'le tempo de la couche ne bouge pas');
    await h.post('/api/layer', { id: id0, set: { lfo: null } });
  });

  test('la calibration voyage avec la configuration, et est bornée', async () => {
    // Elle vit dans state.settings et PAS dans le localStorage : la promesse du
    // projet est que la régie tienne sur une clé USB.
    await h.post('/api/settings', { audioGain: 99, audioSeuil: -3,
      audioAttaque: 0, audioRelache: 99999, audioBande: 'pirate' });
    const s = (await h.state()).settings;
    assert.equal(s.audioGain, 10, 'gain borné');
    assert.equal(s.audioSeuil, 0, 'seuil borné');
    assert.equal(s.audioAttaque, 1, 'attaque bornée');
    assert.equal(s.audioRelache, 3000, 'relâchement borné');
    assert.equal(s.audioBande, 'grave', 'bande inconnue : repli sur la liste fermée');
    await h.post('/api/settings', { audioGain: 2, audioBande: 'aigu' });
    assert.equal((await h.state()).settings.audioBande, 'aigu');
  });

  test('aucune erreur n’a été écrite dans le journal du serveur', () => {
    const erreurs = h.logs.join('').split('\n').filter(l =>
      /erreur inattendue|promesse rejetée|erreur moteur|Error:|TypeError|RangeError/.test(l));
    assert.equal(erreurs.length, 0, 'le serveur a signalé :\n' + erreurs.join('\n'));
  });
});
