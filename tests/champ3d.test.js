'use strict';
/**
 * Moteur « champ 3D » — les effets calculés à la position RÉELLE des barres.
 *
 * Le test qui compte le plus est le premier : un plan sur l'axe X doit rendre
 * EXACTEMENT ce que rendait la vague `lr`. C'est ce qui garantit qu'aucun show
 * existant ne change de rendu, et que le nouveau moteur est bien une
 * généralisation et non un deuxième moteur à maintenir en parallèle.
 *
 * Comme pour le reste de la suite, on juge sur l'OSC réellement envoyé.
 */
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert');
const { start, sleep, fixtures } = require('./helpers.js');

/** Dernier niveau connu par barre, d'après le flux OSC. */
function niveaux(msgs) {
  const out = new Map();
  for (const m of msgs) {
    const mm = /^\/fixtures\/(bar\d+)\/luminosity$/.exec(m.address);
    if (mm) out.set(mm[1], m.args[0]);
  }
  return out;
}

/** Barres réparties sur une ligne, bien à l'intérieur du plateau. */
function enLigne(n) {
  return Array.from({ length: n }, (_, i) => ({
    id: 'c' + i, name: 'B' + i, address: '/fixtures/bar' + i, enabled: true,
    x: 0.1 + 0.8 * (i / (n - 1)), y: 0.5, rot: 0,
  }));
}

describe('Champ 3D', () => {
  let h;
  before(async () => {
    h = await start();
    await h.post('/api/fixtures', { fixtures: enLigne(6) });
    await h.post('/api/scene', { scene: { w: 10, d: 8, h: 6 } });
  });
  after(async () => { await h.stop(); });

  /**
   * Règle la PREMIÈRE couche, en relisant son identifiant à chaque appel.
   *
   * ⚠ Ne jamais mémoriser cet identifiant : le test d'export/import remplace
   * les couches, donc un identifiant capturé au démarrage devient périmé — et
   * `/api/layer` sur une couche inconnue ne fait rien, SANS erreur. Les tests
   * suivants passaient alors pour de mauvaises raisons : ils mesuraient le
   * comportement par défaut en croyant mesurer un réglage. C'est exactement le
   * genre de faux vert qui donne confiance à tort.
   */
  const setL = async (set) => {
    const L = (await h.state()).layers[0];
    assert.ok(L, 'aucune couche à régler');
    const r = await h.post('/api/layer', { id: L.id, set });
    assert.equal(r.body.ok, true, 'le réglage de la couche a échoué');
    return r;
  };
  /** Repart d'un état connu, moteur figé (vitesse lente + phase fixe). */
  const base = async (set) => {
    await h.post('/api/stop');
    await setL({
      engine: 'wave', pattern: 'lr', waveform: 'sine', mode: 'fade', curve: 'linear',
      stepMs: 4000, speed: 1, width: 4, group: 1, phase: 0, floor: 0, sparkle: 0,
      level: 1, invert: false, mirrorH: false, mirrorV: false, oneShot: false,
      target: 'intensity', bars: null, groupId: null, blocks: 1,
      field: 'plan', axAz: 0, axEl: 0, srcX: 0, srcY: 0, srcZ: 2, ...set,
    });
    await h.post('/api/global', { master: 1, speed: 1, dimmer: 'linear' });
    await h.post('/api/blackout');
    await sleep(60);
    h.clearOsc();
  };

  // ⚠ `stepMs` est plafonné à 10 000 ms par le sanitizer : demander 60 000 ne
  // fige PAS la vague, et deux clichés pris à deux secondes d'intervalle
  // tombent alors à 1 % de cycle l'un de l'autre — assez pour faire échouer une
  // comparaison au centième. La période complète vaut
  // stepMs × group / (speed × vitesse globale) : avec 10 000 × 8 / 0,05 on
  // obtient 1 600 000 ms, et deux secondes ne pèsent plus que 0,0013 cycle.
  const GEL = { stepMs: 10000, group: 8, speed: 0.05 };

  /**
   * Écart maximal entre deux barres, relevé sur PLUSIEURS phases du cycle.
   *
   * Nécessaire parce qu'une phase figée arbitraire ne prouve rien : deux barres
   * peuvent se croiser à la même valeur à un instant donné tout en étant très
   * différentes le reste du temps. On cherche donc le maximum sur un cycle.
   */
  async function ecartMax(a, b, n = 12, ms = 110) {
    await h.post('/api/start');
    let ecart = 0, vus = 0;
    for (let i = 0; i < n; i++) {
      h.clearOsc();
      await sleep(ms);
      const niv = niveaux(h.osc());
      if (!(niv.has(a) && niv.has(b))) continue;
      vus++;
      ecart = Math.max(ecart, Math.abs(niv.get(a) - niv.get(b)));
    }
    await h.post('/api/stop');
    return { ecart, vus };
  }

  /** Un cliché des niveaux, pris juste après le démarrage. */
  async function clicher() {
    h.clearOsc();
    await h.post('/api/start');
    await sleep(180);
    const n = niveaux(h.osc());
    await h.post('/api/stop');
    return n;
  }

  // ── LE test de non-régression ────────────────────────────────────────────

  test('un plan sur l’axe X rend la même chose qu’une vague « lr »', async () => {
    // Vitesse volontairement très lente : les deux clichés tombent au même
    // endroit du cycle, à quelques millisecondes près. Sans ça on comparerait
    // deux instants différents d'une vague qui défile, et le test ne prouverait
    // rien — c'est le piège de cette comparaison.
    await base({ engine: 'wave', pattern: 'lr', ...GEL });
    const vague = await clicher();
    await base({ engine: 'field', field: 'plan', axAz: 0, axEl: 0, ...GEL });
    const champ = await clicher();

    assert.equal(vague.size, 6, 'la vague doit toucher les 6 barres');
    assert.equal(champ.size, 6, 'le champ doit toucher les 6 barres');
    // Les deux ne sont pas allumées uniformément : sinon l'égalité serait vide
    // de sens (six fois la même valeur se compare trivialement).
    assert.ok(new Set([...vague.values()]).size >= 3,
      'la vague doit donner des niveaux variés, vu ' + JSON.stringify([...vague]));
    for (const [bar, v] of vague) {
      const c = champ.get(bar);
      assert.ok(Math.abs(c - v) < 0.02,
        bar + ' : vague ' + v + ' mais champ ' + c + ' — le champ n’est pas une généralisation');
    }
  });

  test('un plan vers le bas rend la même chose qu’une vague « tb »', async () => {
    // Barres réparties en HAUTEUR, pour que l'axe vertical ait un sens
    await h.post('/api/fixtures', { fixtures: Array.from({ length: 5 }, (_, i) => ({
      id: 'v' + i, name: 'V' + i, address: '/fixtures/bar' + i, enabled: true,
      x: 0.5, y: 0.1 + 0.8 * (i / 4), rot: 0,
    })) });
    await base({ engine: 'wave', pattern: 'tb', ...GEL });
    const vague = await clicher();
    // axEl = -90 : l'axe pointe vers le sol
    await base({ engine: 'field', field: 'plan', axAz: 0, axEl: -90, ...GEL });
    const champ = await clicher();
    assert.ok(new Set([...vague.values()]).size >= 3, 'niveaux trop uniformes pour juger');
    for (const [bar, v] of vague) {
      assert.ok(Math.abs(champ.get(bar) - v) < 0.02,
        bar + ' : vague tb ' + v + ' mais champ ' + champ.get(bar));
    }
    await h.post('/api/fixtures', { fixtures: enLigne(6) });
  });

  // ── Les formes ───────────────────────────────────────────────────────────

  test('la profondeur devient enfin un axe utilisable', async () => {
    // Deux barres au même endroit à l'écran, mais à des profondeurs différentes :
    // c'est le cas que la v1 ne pouvait PAS distinguer.
    await h.post('/api/fixtures', { fixtures: [
      { id: 'pr1', name: 'Face', address: '/fixtures/bar0', enabled: true, x: 0.5, y: 0.5 },
      { id: 'pr2', name: 'Lointain', address: '/fixtures/bar1', enabled: true, x: 0.5, y: 0.5 },
    ] });
    await h.post('/api/fixture3d', { fixtures: [
      // u = p3y / profondeur : 0 et 0,5 → un demi-cycle d'écart avec width 8,
      // c'est-à-dire le contraste maximal possible entre deux barres.
      { id: 'pr1', p3: [0, 0, 3], dir3: [1, 0, 0], len3: 1.2 },
      { id: 'pr2', p3: [0, 4, 3], dir3: [1, 0, 0], len3: 1.2 },
    ] });
    const et = await h.state();
    assert.ok(Math.abs(et.fixtures[0].x - et.fixtures[1].x) < 0.001
      && Math.abs(et.fixtures[0].y - et.fixtures[1].y) < 0.001,
      'les deux barres doivent être confondues en 2D pour que le test ait un sens');

    // axAz = 90 : l'axe pointe vers le lointain (+Y). Cycle court et écart
    // relevé sur plusieurs phases — une phase figée pourrait tomber pile là où
    // les deux barres se croisent, et le test passerait pour de mauvaises raisons.
    await base({ engine: 'field', field: 'plan', axAz: 90, axEl: 0,
                 stepMs: 300, group: 1, speed: 1, width: 8 });
    const champ = await ecartMax('bar0', 'bar1');
    assert.ok(champ.vus >= 6, 'trop peu de relevés : ' + champ.vus);
    assert.ok(champ.ecart > 0.3,
      'un plan en profondeur doit séparer deux barres confondues en 2D — écart max ' + champ.ecart);

    // …et la vague 2D, elle, ne peut pas les distinguer : c'est la limite qu'on lève
    await base({ engine: 'wave', pattern: 'lr', stepMs: 300, group: 1, speed: 1 });
    const vague = await ecartMax('bar0', 'bar1');
    assert.ok(vague.ecart < 0.02,
      'la vague 2D devrait les traiter à l’identique — écart max ' + vague.ecart);
    await h.post('/api/fixtures', { fixtures: enLigne(6) });
  });

  test('la sphère ne dépend QUE de la distance à la source', async () => {
    // ⚠ Mon premier essai supposait qu'une distance nulle donne la crête. C'est
    // faux : `u = 0` donne la phase COURANTE du cycle, pas le maximum. Un test
    // qui fige le temps sur une phase arbitraire ne prouve donc rien.
    //
    // La bonne propriété, celle qui définit un champ sphérique et qui tient à
    // TOUT instant : deux barres à égale distance de la source reçoivent la même
    // valeur, quelle que soit leur direction — et une barre à une autre distance
    // finit par en différer au cours du cycle.
    const R = 3;
    await h.post('/api/fixtures', { fixtures: [
      { id: 'sa', name: 'A', address: '/fixtures/bar0', enabled: true, x: 0.5, y: 0.5 },
      { id: 'sb', name: 'B', address: '/fixtures/bar1', enabled: true, x: 0.5, y: 0.5 },
      { id: 'sc', name: 'C', address: '/fixtures/bar2', enabled: true, x: 0.5, y: 0.5 },
    ] });
    // A et B à la distance R dans deux directions opposées ; C deux fois plus loin.
    await h.post('/api/fixture3d', { fixtures: [
      { id: 'sa', p3: [R, 2, 2], dir3: [1, 0, 0], len3: 1 },
      { id: 'sb', p3: [-R, 2, 2], dir3: [1, 0, 0], len3: 1 },
      { id: 'sc', p3: [0, 2 + 2 * R, 2], dir3: [1, 0, 0], len3: 1 },
    ] });

    // Cycle court : on échantillonne plusieurs phases au lieu d'en figer une.
    await base({ engine: 'field', field: 'sphere', srcX: 0, srcY: 2, srcZ: 2,
                 stepMs: 300, group: 1, speed: 1, width: 8 });
    const ab = await ecartMax('bar0', 'bar1');
    const ac = await ecartMax('bar0', 'bar2');
    const ecartAB = ab.ecart, ecartAC = ac.ecart;
    assert.ok(ab.vus >= 6 && ac.vus >= 6, 'trop peu de relevés exploitables');
    // La propriété forte : à distance égale, aucune différence, JAMAIS.
    assert.ok(ecartAB < 0.02,
      'deux barres à égale distance doivent recevoir la même valeur — écart max vu ' + ecartAB);
    // Et la sphère fait bien quelque chose : la barre lointaine s'en écarte.
    assert.ok(ecartAC > 0.3,
      'une barre deux fois plus loin doit se distinguer — écart max vu ' + ecartAC);
    await h.post('/api/fixtures', { fixtures: enLigne(6) });
  });

  test('la boîte fait des coques rectangulaires, pas des sphères', async () => {
    // Le test qui distingue vraiment `boite` de `sphere` : deux barres à la même
    // distance de Tchebychev mais à des distances euclidiennes différentes
    // doivent recevoir la même valeur en boîte — et des valeurs différentes en
    // sphère. Sans ce test, les deux formes pourraient être le même code.
    await h.post('/api/fixtures', { fixtures: [
      { id: 'ba', name: 'A', address: '/fixtures/bar0', enabled: true, x: 0.5, y: 0.5 },
      { id: 'bb', name: 'B', address: '/fixtures/bar1', enabled: true, x: 0.5, y: 0.5 },
    ] });
    // Plateau 10 × 8 × 6 → demi-cotes 5, 4, 3.
    // A : x = 2,5 → 0,5 ; y = 0 → 0. B : x = 2,5 → 0,5 ; y = 2 → 0,5.
    // Tchebychev identique (0,5), mais B est plus loin en euclidien.
    await h.post('/api/fixture3d', { fixtures: [
      { id: 'ba', p3: [2.5, 4, 3], dir3: [1, 0, 0], len3: 1 },
      { id: 'bb', p3: [2.5, 6, 3], dir3: [1, 0, 0], len3: 1 },
    ] });
    const mesure = async (forme) => {
      await base({ engine: 'field', field: forme, srcX: 0, srcY: 4, srcZ: 3,
                   stepMs: 300, group: 1, speed: 1, width: 8 });
      const r = await ecartMax('bar0', 'bar1', 10);
      assert.ok(r.vus >= 5, forme + ' : trop peu de relevés (' + r.vus + ')');
      return r.ecart;
    };
    const enBoite = await mesure('boite');
    const enSphere = await mesure('sphere');
    assert.ok(enBoite < 0.02,
      'en boîte, deux barres à même distance de Tchebychev doivent être égales — écart ' + enBoite);
    assert.ok(enSphere > 0.15,
      'en sphère, elles doivent différer (sinon les deux formes sont le même code) — écart ' + enSphere);
    await h.post('/api/fixtures', { fixtures: enLigne(6) });
  });

  test('le cylindre balaie en tournant : l’angle décide, pas la distance', async () => {
    // Quatre barres aux quatre azimuts autour d'un axe vertical, TOUTES à la
    // même distance : seule leur direction peut les différencier.
    await h.post('/api/fixtures', { fixtures: Array.from({ length: 4 }, (_, i) => ({
      id: 'cy' + i, name: 'C' + i, address: '/fixtures/bar' + i, enabled: true, x: 0.5, y: 0.5,
    })) });
    const R = 3;
    await h.post('/api/fixture3d', { fixtures: [0, 1, 2, 3].map(i => {
      const a = i * Math.PI / 2;
      return { id: 'cy' + i, p3: [R * Math.cos(a), R * Math.sin(a), 2], dir3: [1, 0, 0], len3: 1 };
    }) });
    await base({ engine: 'field', field: 'cylindre', axAz: 0, axEl: 90,
                 srcX: 0, srcY: 0, srcZ: 2, stepMs: 60000, width: 8 });
    const n = await clicher();
    assert.equal(n.size, 4);
    const vs = [...n.values()];
    assert.ok(Math.max(...vs) - Math.min(...vs) > 0.4,
      'à distance égale, l’angle doit séparer les barres : ' + JSON.stringify([...n]));
    await h.post('/api/fixtures', { fixtures: enLigne(6) });
  });

  test('le bruit 3D donne du relief, sans jamais sortir de [0,1]', async () => {
    // ⚠ Dérive volontairement rapide. Le moteur n'envoie une valeur que si elle
    // a CHANGÉ (cache anti-répétition) : un bruit qui dérive lentement produit
    // donc très peu de messages, et le test devient famélique sans que le code
    // soit en cause. Mesuré : à 2 000 ms de période, 8 messages en 700 ms.
    await base({ engine: 'field', field: 'bruit', stepMs: 200, speed: 1, group: 1, width: 1 });
    h.clearOsc();
    await h.post('/api/start');
    await sleep(700);
    const msgs = h.osc();
    await h.post('/api/stop');
    const vals = msgs.filter(m => /luminosity$/.test(m.address)).map(m => m.args[0]);
    assert.ok(vals.length > 10, 'flux trop maigre : ' + vals.length);
    for (const v of vals) {
      assert.ok(Number.isFinite(v) && v >= 0 && v <= 1, 'valeur hors bornes : ' + v);
    }
    // Du relief : le bruit ne doit pas rendre la même valeur partout.
    // On juge sur l'ÉTENDUE plutôt que sur un nombre de paliers distincts : sous
    // charge, la suite tourne moins de ticks et le comptage de paliers devenait
    // instable — alors que l'étendue, elle, dit vraiment s'il y a du relief.
    const etendue = Math.max(...vals) - Math.min(...vals);
    assert.ok(etendue > 0.2, 'le bruit devrait varier, étendue vue ' + etendue.toFixed(3));

    // …et il ne doit pas passer son temps aux butées : un bruit saturé, sur
    // scène, ce n'est pas du mouvement organique, c'est du clignotement dur.
    const satures = vals.filter(v => v <= 0.001 || v >= 0.999).length / vals.length;
    assert.ok(satures < 0.35, 'bruit trop saturé : ' + Math.round(satures * 100) + ' % aux butées');
  });

  test('le bruit est déterministe : deux évaluations du même instant concordent', async () => {
    // Un bruit qui tremble entre deux ticks se voit tout de suite sur scène.
    // Ici : vitesse quasi nulle → la valeur doit être stable dans le temps.
    await base({ engine: 'field', field: 'bruit', stepMs: 10000, speed: 0.05, width: 2 });
    await h.post('/api/start');
    await sleep(300);
    const a = niveaux(h.osc());
    h.clearOsc();
    await sleep(400);
    const b = niveaux(h.osc());
    await h.post('/api/stop');
    for (const [bar, v] of a) {
      if (!b.has(bar)) continue;
      assert.ok(Math.abs(b.get(bar) - v) < 0.15,
        bar + ' tremble : ' + v + ' puis ' + b.get(bar));
    }
  });

  // ── Robustesse ───────────────────────────────────────────────────────────

  test('les réglages du champ sont bornés et les valeurs absurdes refusées', async () => {
    await setL({ field: 'nawak', axAz: 1e9, axEl: 1e9, srcX: 'loin', srcY: NaN, srcZ: 1e12 });
    const L = (await h.state()).layers[0];
    assert.ok(['plan', 'sphere', 'cylindre', 'boite', 'bruit'].includes(L.field),
      'forme invalide acceptée : ' + L.field);
    assert.ok(L.axAz >= 0 && L.axAz < 360, 'azimut hors bornes : ' + L.axAz);
    assert.ok(L.axEl >= -90 && L.axEl <= 90, 'élévation hors bornes : ' + L.axEl);
    for (const k of ['srcX', 'srcY', 'srcZ']) {
      assert.ok(Number.isFinite(L[k]) && Math.abs(L[k]) <= 500, k + ' = ' + L[k]);
    }
  });

  test('un plateau dégénéré ne fait pas exploser le champ', async () => {
    await h.post('/api/scene', { scene: { w: 0.5, d: 0.5, h: 0.5 } });
    for (const forme of ['plan', 'sphere', 'cylindre', 'boite', 'bruit']) {
      await base({ engine: 'field', field: forme, stepMs: 200, width: 1 });
      h.clearOsc();
      await h.post('/api/start');
      await sleep(220);
      const msgs = h.osc();
      await h.post('/api/stop');
      const mauvais = msgs.filter(m => typeof m.args[0] === 'number'
        && (!Number.isFinite(m.args[0]) || m.args[0] < 0 || m.args[0] > 1));
      assert.equal(mauvais.length, 0,
        forme + ' : valeurs aberrantes ' + JSON.stringify(mauvais.slice(0, 3)));
    }
    await h.post('/api/scene', { scene: { w: 10, d: 8, h: 6 } });
    assert.equal((await h.get('/api/ping')).body.app, 'Cascade');
  });

  test('un axe vertical ne casse pas le cylindre (le piège des pôles)', async () => {
    // Un produit vectoriel avec un axe colinéaire s'annule : l'angle devient
    // n'importe quoi. Les deux orientations extrêmes doivent rester saines.
    for (const axEl of [90, -90, 0]) {
      await base({ engine: 'field', field: 'cylindre', axEl, axAz: 0, stepMs: 300, width: 4 });
      h.clearOsc();
      await h.post('/api/start');
      await sleep(250);
      const msgs = h.osc();
      await h.post('/api/stop');
      const mauvais = msgs.filter(m => typeof m.args[0] === 'number' && !Number.isFinite(m.args[0]));
      assert.equal(mauvais.length, 0, 'axEl=' + axEl + ' : ' + JSON.stringify(mauvais.slice(0, 3)));
      assert.ok(msgs.length > 0, 'axEl=' + axEl + ' : aucun envoi');
    }
  });

  test('tout l’acquis v1 s’applique au champ : niveau bas, inversion, master, couleur', async () => {
    await base({ engine: 'field', field: 'plan', floor: 0.4, stepMs: 400, width: 4 });
    await h.post('/api/start');
    await sleep(500);
    const msgs = h.osc();
    await h.post('/api/stop');
    const mins = new Map();
    for (const m of msgs) {
      const mm = /^\/fixtures\/(bar\d+)\/luminosity$/.exec(m.address);
      if (mm) mins.set(mm[1], Math.min(mins.get(mm[1]) ?? 1, m.args[0]));
    }
    assert.ok(mins.size >= 4, 'trop peu de barres vues');
    for (const [bar, v] of mins) assert.ok(v >= 0.39, bar + ' est descendu à ' + v);

    // Master
    await base({ engine: 'field', field: 'plan', stepMs: 60000, width: 8 });
    await h.post('/api/global', { master: 0.5 });
    const n = await clicher();
    await h.post('/api/global', { master: 1 });
    assert.ok(Math.max(...n.values()) <= 0.52, 'le master doit plafonner le champ');

    // Couleur
    await base({ engine: 'field', field: 'plan', target: 'color', stepMs: 60000, width: 8,
                 colorA: '#ff0000', colorB: '#0000ff' });
    h.clearOsc();
    await h.post('/api/start');
    await sleep(200);
    const couleurs = h.osc().filter(m => /\/color\/(red|green|blue)$/.test(m.address));
    await h.post('/api/stop');
    assert.ok(couleurs.length >= 6, 'le champ doit pouvoir piloter la couleur, vu ' + couleurs.length);
    for (const m of couleurs) assert.ok(m.args[0] >= 0 && m.args[0] <= 1);
  });

  test('le champ voyage avec les presets et l’export', async () => {
    await base({ engine: 'field', field: 'cylindre', axAz: 137, axEl: 42,
                 srcX: 1.5, srcY: 2.5, srcZ: 3.5, stepMs: 700 });
    await h.post('/api/preset', { action: 'save', slot: 5, name: 'Phare' });
    const exp = await h.get('/api/export');
    await h.post('/api/new', { keepFixtures: false });
    await h.post('/api/import', exp.body);
    const L = (await h.state()).layers.find(x => x.engine === 'field');
    assert.ok(L, 'la couche champ doit survivre à l’export/import');
    assert.equal(L.field, 'cylindre');
    assert.equal(L.axAz, 137);
    assert.equal(L.axEl, 42);
    assert.ok(Math.abs(L.srcY - 2.5) < 1e-6, 'srcY = ' + L.srcY);

    // …et le preset aussi
    await h.post('/api/layer', { id: L.id, set: { field: 'plan', axAz: 0 } });
    assert.equal((await h.state()).layers.find(x => x.id === L.id).field, 'plan');
    await h.post('/api/preset', { action: 'recall', slot: 5 });
    await sleep(80);
    const L2 = (await h.state()).layers.find(x => x.engine === 'field');
    assert.equal(L2.field, 'cylindre', 'le preset doit restaurer la forme du champ');
    assert.equal(L2.axAz, 137);
  });

  // ── L'ordre du pas-à-pas suit la géométrie ────────────────────────────────

  test('« ordre = axe 3D » fait suivre au chase la scéno, pas la liste', async () => {
    // Barres ajoutées VOLONTAIREMENT dans le désordre : c'est le cas réel, quand
    // on importe une scéno ou qu'on ajoute une barre après coup.
    // Ordre de la liste : bar0(x=+4) bar1(x=-4) bar2(x=0) bar3(x=+2)
    // Ordre géométrique sur +X : bar1(-4) bar2(0) bar3(+2) bar0(+4)
    await h.post('/api/fixtures', { fixtures: [
      { id: 'o0', name: 'D', address: '/fixtures/bar0', enabled: true, x: 0.5, y: 0.5 },
      { id: 'o1', name: 'A', address: '/fixtures/bar1', enabled: true, x: 0.5, y: 0.5 },
      { id: 'o2', name: 'B', address: '/fixtures/bar2', enabled: true, x: 0.5, y: 0.5 },
      { id: 'o3', name: 'C', address: '/fixtures/bar3', enabled: true, x: 0.5, y: 0.5 },
    ] });
    await h.post('/api/fixture3d', { fixtures: [
      { id: 'o0', p3: [4, 0, 2], dir3: [1, 0, 0], len3: 1 },
      { id: 'o1', p3: [-4, 0, 2], dir3: [1, 0, 0], len3: 1 },
      { id: 'o2', p3: [0, 0, 2], dir3: [1, 0, 0], len3: 1 },
      { id: 'o3', p3: [2, 0, 2], dir3: [1, 0, 0], len3: 1 },
    ] });

    /** Ordre d'allumage des barres, relevé sur le flux OSC. */
    const ordreVu = async () => {
      await h.post('/api/blackout');
      await sleep(80);
      h.clearOsc();
      await h.post('/api/resync');
      await h.post('/api/start');
      await sleep(560);           // ~4 pas de 120 ms
      await h.post('/api/stop');
      const vus = [];
      const precedent = {};
      for (const m of h.osc()) {
        const mm = /^\/fixtures\/(bar\d+)\/luminosity$/.exec(m.address);
        if (!mm) continue;
        if (m.args[0] > 0.5 && !(precedent[mm[1]] > 0.5) && !vus.includes(mm[1])) vus.push(mm[1]);
        precedent[mm[1]] = m.args[0];
      }
      return vus;
    };

    // Sans l'option : l'ordre de la liste
    await base({ engine: 'steps', pattern: 'lr', mode: 'onoff', stepMs: 120,
                 group: 1, speed: 1, width: 1, ordre3d: false });
    const liste = await ordreVu();
    assert.deepEqual(liste, ['bar0', 'bar1', 'bar2', 'bar3'],
      'sans l’option, le chase suit la liste — vu ' + JSON.stringify(liste));

    // Avec l'option, axe +X : l'ordre géométrique de jardin vers cour
    await base({ engine: 'steps', pattern: 'lr', mode: 'onoff', stepMs: 120,
                 group: 1, speed: 1, width: 1, ordre3d: true, axAz: 0, axEl: 0 });
    const geo = await ordreVu();
    assert.deepEqual(geo, ['bar1', 'bar2', 'bar3', 'bar0'],
      'avec l’option, le chase doit suivre l’axe — vu ' + JSON.stringify(geo));

    // Et l'axe compte : à 180° l'ordre s'inverse
    await base({ engine: 'steps', pattern: 'lr', mode: 'onoff', stepMs: 120,
                 group: 1, speed: 1, width: 1, ordre3d: true, axAz: 180, axEl: 0 });
    const inverse = await ordreVu();
    assert.deepEqual(inverse, ['bar0', 'bar3', 'bar2', 'bar1'],
      'un axe retourné doit retourner l’ordre — vu ' + JSON.stringify(inverse));
    await h.post('/api/fixtures', { fixtures: enLigne(6) });
  });

  test('l’ordre 3D reste stable quand deux barres sont à égalité', async () => {
    // Deux barres exactement au même endroit sur l'axe : si le tri n'est pas
    // départagé, elles s'échangent d'un tick à l'autre et le chase saute.
    await h.post('/api/fixtures', { fixtures: [
      { id: 'e1', name: 'E1', address: '/fixtures/bar0', enabled: true, x: 0.5, y: 0.5 },
      { id: 'e2', name: 'E2', address: '/fixtures/bar1', enabled: true, x: 0.5, y: 0.5 },
      { id: 'e3', name: 'E3', address: '/fixtures/bar2', enabled: true, x: 0.5, y: 0.5 },
    ] });
    // Toutes à x = 0 : égalité parfaite sur l'axe +X
    await h.post('/api/fixture3d', { fixtures: [
      { id: 'e1', p3: [0, 1, 2], dir3: [1, 0, 0], len3: 1 },
      { id: 'e2', p3: [0, 3, 2], dir3: [1, 0, 0], len3: 1 },
      { id: 'e3', p3: [0, 5, 2], dir3: [1, 0, 0], len3: 1 },
    ] });
    await base({ engine: 'steps', pattern: 'lr', mode: 'onoff', stepMs: 100,
                 group: 1, speed: 1, width: 1, ordre3d: true, axAz: 0, axEl: 0 });
    const relever = async () => {
      await h.post('/api/blackout'); await sleep(70); h.clearOsc();
      await h.post('/api/resync'); await h.post('/api/start');
      await sleep(400); await h.post('/api/stop');
      const vus = []; const prec = {};
      for (const m of h.osc()) {
        const mm = /^\/fixtures\/(bar\d+)\/luminosity$/.exec(m.address);
        if (!mm) continue;
        if (m.args[0] > 0.5 && !(prec[mm[1]] > 0.5) && !vus.includes(mm[1])) vus.push(mm[1]);
        prec[mm[1]] = m.args[0];
      }
      return vus;
    };
    const a = await relever();
    const b = await relever();
    assert.equal(a.length, 3, 'les 3 barres doivent s’allumer, vu ' + JSON.stringify(a));
    assert.deepEqual(a, b, 'l’ordre doit être le MÊME d’une exécution à l’autre : '
      + JSON.stringify(a) + ' puis ' + JSON.stringify(b));
    await h.post('/api/fixtures', { fixtures: enLigne(6) });
  });

  test('l’ordre 3D ne dérange pas les autres couches', async () => {
    // Le tri se fait sur une COPIE : trier sur place changerait l'ordre pour
    // toute l'interface et pour les autres couches.
    await h.post('/api/fixtures', { fixtures: enLigne(4) });
    const avant = (await h.state()).fixtures.map(f => f.id);
    await base({ engine: 'steps', pattern: 'lr', mode: 'onoff', stepMs: 100, ordre3d: true, axAz: 180 });
    await h.post('/api/start');
    await sleep(400);
    await h.post('/api/stop');
    const apres = (await h.state()).fixtures.map(f => f.id);
    assert.deepEqual(apres, avant, 'l’ordre des fixtures ne doit pas être touché');
    await h.post('/api/fixtures', { fixtures: enLigne(6) });
  });

  test('aucune erreur n’a été écrite dans le journal du serveur', () => {
    const erreurs = h.logs.join('').split('\n').filter(l =>
      /erreur inattendue|promesse rejetée|erreur moteur|Error:|TypeError|RangeError/.test(l));
    assert.equal(erreurs.length, 0, 'le serveur a signalé :\n' + erreurs.join('\n'));
  });
});
