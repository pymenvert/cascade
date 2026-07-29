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
const { test, before, after, afterEach, describe } = require('node:test');
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
   * Filet de nettoyage — il vit ICI, et pas à la fin des corps de test.
   *
   * Une assertion qui tombe saute tout ce qui la suit, nettoyage compris : le
   * test suivant hérite d'un plateau et d'une couche dans un état inconnu. On
   * remet la scéno ET la couche, parce qu'oublier la couche laisse une forme de
   * champ ou une source mobile en place — ça suffit à faire tomber le suivant.
   *
   * ⚠ Honnêteté : la cascade d'échecs a été CHERCHÉE et n'a pas été reproduite
   * sur ce fichier. Deux échecs injectés à des endroits qui laissent du désordre
   * n'ont fait tomber qu'un test chacun, parce que chaque test refait sa propre
   * installation. Le filet est donc une garantie, pas une correction : il rend
   * l'indépendance des tests structurelle au lieu de la laisser au hasard des
   * habitudes d'écriture.
   */
  afterEach(async () => {
    try {
      await h.post('/api/stop');
      await h.post('/api/fixtures', { fixtures: enLigne(6) });
      await h.post('/api/scene', { scene: { w: 10, d: 8, h: 6 } });
      await base({});
    } catch (e) {
      // Le serveur peut être tombé : ne pas masquer l'échec réel avec celui-ci.
    }
  });

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
      field: 'plan', axAz: 0, axEl: 0, srcX: 0, srcY: 0, srcZ: 2,
      duty: 100, course: 0, blend: 'htp', prof: 0, palette: null, ordre3d: false, ...set,
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
  // ⚠ `width: 8` fait partie du gel, et ce n'est pas un détail. À width 4 la
  // longueur d'onde vaut 0,5 : tout décalage de la projection multiple de 0,5
  // devient invisible modulo 1, et le repli du miroir (u → |u − 0,5|) est
  // carrément NEUTRE pour une sinusoïde. Les comparaisons passaient alors sans
  // rien prouver. À width 8 (longueur d'onde 1), un décalage de projection se
  // lit directement en décalage de phase.
  const GEL = { stepMs: 10000, group: 8, speed: 0.05, width: 8 };

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

  /**
   * Suite de clichés pris pendant `duree`, chacun rendu comme un tableau de
   * niveaux dans l'ordre des barres. Sert à juger la FORME d'un profil (franc
   * ou ondulé) et son déplacement, là où `ecartMax` ne compare que deux barres.
   *
   * ⚠ La fenêtre doit rester longue devant le bruit de charge : la suite lance
   * une dizaine de serveurs en parallèle. D'où des cycles d'au moins 900 ms.
   */
  async function releves(duree, pas = 130) {
    await h.post('/api/start');
    const out = [];
    const fin = Date.now() + duree;
    while (Date.now() < fin) {
      h.clearOsc();
      await sleep(pas);
      const niv = niveaux(h.osc());
      if (!niv.size) continue;
      const noms = [...niv.keys()].sort((x, y) =>
        (+x.replace(/\D/g, '') || 0) - (+y.replace(/\D/g, '') || 0));
      out.push(noms.map(k => niv.get(k)));
    }
    await h.post('/api/stop');
    return out;
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

  test('le miroir du champ replie la projection, comme celui de la vague', async () => {
    // Le miroir de la vague fait `x = |x - axe|`. Le champ fait la même chose
    // sur sa projection : l'équivalence des deux moteurs doit donc tenir AUSSI
    // miroir activé — sinon le champ n'est une généralisation qu'à moitié.
    await h.post('/api/fixtures', { fixtures: enLigne(6) });
    await base({ engine: 'wave', pattern: 'lr', mirrorH: true, axisX: 0.5, ...GEL });
    const vague = await clicher();
    await base({ engine: 'field', field: 'plan', axAz: 0, axEl: 0,
                 mirrorH: true, axisX: 0.5, ...GEL });
    const champ = await clicher();
    assert.equal(vague.size, 6);
    for (const [bar, v] of vague) {
      assert.ok(Math.abs(champ.get(bar) - v) < 0.02,
        bar + ' : vague miroir ' + v + ' mais champ ' + champ.get(bar));
    }
  });

  test('le miroir du champ change vraiment quelque chose', async () => {
    // Un test d'équivalence seul ne prouve rien si le miroir est ignoré des
    // DEUX côtés : il faut vérifier qu'il agit.
    await base({ engine: 'field', field: 'plan', axAz: 0, mirrorH: false, ...GEL });
    const sans = await clicher();
    await base({ engine: 'field', field: 'plan', axAz: 0, mirrorH: true, axisX: 0.5, ...GEL });
    const avec = await clicher();
    let differents = 0;
    for (const [bar, v] of sans) if (Math.abs(avec.get(bar) - v) > 0.05) differents++;
    assert.ok(differents >= 2,
      'le miroir doit modifier le rendu, ' + differents + ' barre(s) changée(s) seulement');

    // Et il est SYMÉTRIQUE : deux barres à égale distance de l'axe s'allument
    // pareil. C'est la propriété qui définit un miroir.
    const et = await h.state();
    const paires = [];
    for (const f of et.fixtures) {
      const jumelle = et.fixtures.find(g => g.id !== f.id
        && Math.abs(Math.abs(g.x - 0.5) - Math.abs(f.x - 0.5)) < 0.01);
      if (jumelle) paires.push([f, jumelle]);
    }
    assert.ok(paires.length >= 2, 'il faut des barres symétriques pour juger');
    for (const [f, g] of paires) {
      const a = avec.get(f.address.split('/').pop());
      const b = avec.get(g.address.split('/').pop());
      if (a == null || b == null) continue;
      assert.ok(Math.abs(a - b) < 0.03,
        'miroir non symétrique entre ' + f.name + ' (' + a + ') et ' + g.name + ' (' + b + ')');
    }
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

  test('le pavé a des bords FRANCS : allumé ou éteint, rien entre les deux', async () => {
    // Ce qui distingue un pavé d'une onde, c'est la coupure nette. À netteté
    // 100, une barre est dans le volume ou elle n'y est pas : les valeurs
    // intermédiaires doivent être rarissimes. C'est exactement ce qu'aucune
    // autre forme du champ ne produit.
    await h.post('/api/fixtures', { fixtures: enLigne(12) });
    await base({ engine: 'field', field: 'boite', srcX: 0, srcY: 0, srcZ: 3,
                 stepMs: 900, group: 1, speed: 1, width: 3, duty: 100 });
    const vues = await releves(2200);
    const toutes = vues.flat();
    assert.ok(toutes.length >= 40, 'trop peu de relevés (' + toutes.length + ')');
    const entre = toutes.filter(v => v > 0.06 && v < 0.94).length;
    assert.ok(entre / toutes.length < 0.1,
      'un pavé à netteté 100 doit trancher : ' + Math.round(100 * entre / toutes.length)
      + ' % de valeurs intermédiaires');
    // …et il faut que les deux états existent, sinon « franc » ne veut rien dire
    assert.ok(toutes.some(v => v > 0.94), 'aucune barre allumée');
    assert.ok(toutes.some(v => v < 0.06), 'aucune barre éteinte');
  });

  test('sur un rig PLAN, le pavé ne ressemble pas à la sphère', async () => {
    // Le vrai reproche fait à l'ancienne boîte : sur une simple ligne de barres
    // — le cas le plus courant — sa distance de Tchebychev se réduisait à |dx|,
    // donc à la sphère à un facteur près. Les deux formes étaient
    // indiscernables là où ça compte. On mesure la forme du profil : le pavé
    // tranche, la sphère ondule.
    await h.post('/api/fixtures', { fixtures: enLigne(12) });
    const profil = async (forme) => {
      await base({ engine: 'field', field: forme, srcX: 0, srcY: 0, srcZ: 3,
                   stepMs: 900, group: 1, speed: 1, width: 3, duty: 100 });
      const toutes = (await releves(2200)).flat();
      const entre = toutes.filter(v => v > 0.06 && v < 0.94).length;
      return entre / Math.max(1, toutes.length);
    };
    const pave = await profil('boite');
    const sphere = await profil('sphere');
    assert.ok(sphere - pave > 0.25,
      'les deux formes se ressemblent trop sur une ligne — intermédiaires : pavé '
      + Math.round(pave * 100) + ' %, sphère ' + Math.round(sphere * 100) + ' %');
  });

  test('le pavé se déplace : il ne reste pas planté sur les mêmes barres', async () => {
    await h.post('/api/fixtures', { fixtures: enLigne(12) });
    await base({ engine: 'field', field: 'boite', srcX: 0, srcY: 0, srcZ: 3,
                 stepMs: 1400, group: 1, speed: 1, width: 2, duty: 100 });
    // Fenêtre large : sous charge, une image sur deux arrive incomplète et le
    // cache anti-répétition n'émet que ce qui change. On prend ce qui vient.
    const vues = (await releves(4200)).filter(v => v.length >= 6);
    assert.ok(vues.length >= 4, 'trop peu d’images (' + vues.length + ')');
    // Barycentre des barres allumées : il doit se déplacer le long de la ligne.
    const centres = vues.map(v => {
      let s = 0, n = 0;
      v.forEach((x, i) => { if (x > 0.5) { s += i; n++; } });
      return n ? s / n : null;
    }).filter(c => c !== null);
    assert.ok(centres.length >= 3, 'le pavé n’allume jamais rien');
    const etendue = Math.max(...centres) - Math.min(...centres);
    assert.ok(etendue > 1.5, 'le pavé ne se déplace pas (étendue ' + etendue.toFixed(2) + ' barre)');
    // ⚠ Remettre la scéno ET la couche dans leur état d'origine. Un test qui
    // laisse derrière lui une forme, une source ou une taille de motif fait
    // tomber les suivants — et ils tombent pour une raison qui n'a plus rien à
    // voir avec ce qu'ils vérifient. C'est le piège déjà rencontré deux fois
    // sur ce fichier.
    await h.post('/api/fixtures', { fixtures: enLigne(6) });
    await base({ engine: 'field', field: 'plan', srcX: 0, srcY: 0, srcZ: 2,
                 duty: 100, course: 0, width: 8, spread: 0 });
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

  test('128 barres × 5 champs tiennent la charge sans dériver', async () => {
    // Le plan estimait ce coût « négligeable » sans l'avoir mesuré. On mesure.
    // Configuration volontairement pire que tout show réel : chaque couche
    // exploite une forme différente, sur 128 barres réparties en VOLUME.
    const FORMES = ['plan', 'sphere', 'cylindre', 'boite', 'bruit'];
    const fx = Array.from({ length: 128 }, (_, i) => ({
      id: 'ch' + i, name: 'B' + i, address: '/fixtures/bar' + i, enabled: true, x: 0.5, y: 0.5,
    }));
    await h.post('/api/fixtures', { fixtures: fx });
    // Réparties dans tout le volume : aucune symétrie qui simplifierait le calcul
    await h.post('/api/fixture3d', { fixtures: fx.map((f, i) => ({
      id: f.id,
      p3: [((i * 37) % 100) / 10 - 5, ((i * 53) % 80) / 10, ((i * 29) % 60) / 10],
      dir3: [1, 0, 0], len3: 1,
    })) });

    const etat = await h.state();
    for (let i = etat.layers.length; i < 5; i++) await h.post('/api/layers', { action: 'add' });
    const ids = (await h.state()).layers.map(l => l.id);
    for (let i = 0; i < Math.min(5, ids.length); i++) {
      await h.post('/api/layer', { id: ids[i], set: {
        engine: 'field', field: FORMES[i], enabled: true, target: i === 4 ? 'color' : 'intensity',
        stepMs: 60 + i * 40, speed: 1, group: 1, width: 1 + i, mode: 'fade',
        axAz: i * 60, axEl: i * 15 - 30, srcX: i - 2, srcY: 2 + i, srcZ: 1 + i * 0.5,
        level: 0.6, floor: 0, invert: false, mirrorH: i % 2 === 0, axisX: 0.5,
      } });
    }

    h.clearOsc();
    await h.post('/api/start');
    // Réactivité pendant que les cinq champs tournent
    const mesures = [];
    for (let i = 0; i < 20; i++) {
      const t = Date.now();
      await h.get('/api/state');
      mesures.push(Date.now() - t);
      await sleep(50);
    }
    await sleep(1500);
    const msgs = h.osc();
    await h.post('/api/stop');

    assert.ok(msgs.length > 500, 'flux OSC trop maigre : ' + msgs.length);
    const mauvais = msgs.filter(m => typeof m.args[0] === 'number'
      && (!Number.isFinite(m.args[0]) || m.args[0] < 0 || m.args[0] > 1));
    assert.equal(mauvais.length, 0, 'valeurs hors [0,1] : ' + JSON.stringify(mauvais.slice(0, 3)));
    const barres = new Set(msgs.map(m => m.address.split('/')[2]));
    assert.ok(barres.size > 100, 'seulement ' + barres.size + ' barres touchées sur 128');

    // On juge sur la MÉDIANE : la suite lance une dizaine de serveurs et un
    // navigateur en parallèle, un pic isolé mesure la machine, pas Cascade.
    const tri = [...mesures].sort((a, b) => a - b);
    assert.ok(tri[Math.floor(tri.length / 2)] < 120,
      'réponse médiane ' + tri[Math.floor(tri.length / 2)] + ' ms — ' + JSON.stringify(tri));
    assert.ok(tri[tri.length - 1] < 3000, 'blocage : ' + tri[tri.length - 1] + ' ms');

    // Rien de cassé dans le journal
    const erreurs = h.logs.join('').split('\n').filter(l => /Error:|TypeError|RangeError/.test(l));
    assert.equal(erreurs.length, 0, erreurs.join('\n'));

    // On remet une configuration légère pour les tests suivants
    for (const id of ids.slice(1)) await h.post('/api/layers', { action: 'remove', id });
    await h.post('/api/fixtures', { fixtures: enLigne(6) });
  });

  // ── Angles morts trouvés par test de mutation ─────────────────────────────
  // Chacun de ces tests a été ajouté après avoir cassé le code exprès et
  // constaté que la suite ne s'en apercevait PAS. Le test de mutation est
  // ensuite rejoué pour vérifier qu'il attrape désormais le cassage.

  test('les trois formes d’onde du champ sont justes ET distinctes', async () => {
    // Mutation qui passait inaperçue : remplacer le triangle par « toujours 1 ».
    // Aucun test ne réglait `waveform` ailleurs que sur « sine ».
    await h.post('/api/fixtures', { fixtures: enLigne(6) });
    const par = {};
    for (const wf of ['sine', 'triangle', 'square']) {
      // Le champ doit rendre la même chose que la vague, POUR CHAQUE forme.
      // Les deux moteurs ont leur propre copie du calcul : une seule cassée,
      // et la comparaison tombe.
      await base({ engine: 'wave', pattern: 'lr', waveform: wf, ...GEL });
      const vague = await clicher();
      await base({ engine: 'field', field: 'plan', axAz: 0, waveform: wf, ...GEL });
      const champ = await clicher();
      assert.equal(champ.size, 6, wf + ' : les 6 barres doivent être vues');
      for (const [bar, v] of vague) {
        assert.ok(Math.abs(champ.get(bar) - v) < 0.02,
          wf + ' · ' + bar + ' : vague ' + v + ' mais champ ' + champ.get(bar));
      }
      par[wf] = champ;
    }
    // …et les trois formes ne doivent pas se ressembler : sinon une forme
    // dégénérée (constante, ou copie du sinus) passerait le test ci-dessus.
    const distance = (a, b) => {
      let d = 0;
      for (const [k, v] of a) d = Math.max(d, Math.abs((b.get(k) ?? v) - v));
      return d;
    };
    assert.ok(distance(par.sine, par.triangle) > 0.05,
      'sinus et triangle rendent la même chose : une des deux formes est dégénérée');
    assert.ok(distance(par.sine, par.square) > 0.2,
      'sinus et carré rendent la même chose');
    // Le carré ne prend que deux valeurs, par définition
    const vs = [...new Set([...par.square.values()].map(v => Math.round(v * 1000)))];
    assert.ok(vs.length <= 2, 'le carré devrait ne donner que deux niveaux, vu ' + vs.length);
  });

  test('le décalage de phase agit sur le champ, et boucle à 360°', async () => {
    // Mutation qui passait inaperçue : ignorer purement et simplement L.phase
    // dans le champ. Aucun test ne le réglait ailleurs que sur 0.
    await base({ engine: 'field', field: 'plan', axAz: 0, phase: 0, ...GEL });
    const a = await clicher();
    await base({ engine: 'field', field: 'plan', axAz: 0, phase: 180, ...GEL });
    const b = await clicher();
    await base({ engine: 'field', field: 'plan', axAz: 0, phase: 360, ...GEL });
    const c = await clicher();

    let bouge = 0, revient = 0;
    for (const [bar, v] of a) {
      if (Math.abs((b.get(bar) ?? v) - v) > 0.3) bouge++;
      if (Math.abs((c.get(bar) ?? v) - v) < 0.03) revient++;
    }
    assert.ok(bouge >= 3, 'un décalage d’un demi-cycle doit changer le rendu, '
      + bouge + ' barre(s) seulement ont bougé');
    assert.equal(revient, a.size, '360° est un tour complet : le rendu doit être identique à 0°');
  });

  test('l’inversion retourne bien le champ', async () => {
    // Mutation qui passait inaperçue : ignorer L.invert dans le mélange. Le test
    // qui s’intitulait « … inversion … » ne la vérifiait en réalité jamais.
    await base({ engine: 'field', field: 'plan', axAz: 0, invert: false, ...GEL });
    const droit = await clicher();
    await base({ engine: 'field', field: 'plan', axAz: 0, invert: true, ...GEL });
    const inverse = await clicher();
    assert.equal(inverse.size, droit.size);
    // Relation exacte attendue : v' = 1 - v, barre par barre.
    for (const [bar, v] of droit) {
      const vi = inverse.get(bar);
      assert.ok(Math.abs(vi - (1 - v)) < 0.03,
        bar + ' : sans inversion ' + v.toFixed(3) + ', avec inversion ' + vi.toFixed(3)
        + ' — attendu ' + (1 - v).toFixed(3));
    }
    // Garde-fou : si tout valait 0,5, la relation serait vraie sans rien prouver.
    assert.ok(Math.max(...droit.values()) - Math.min(...droit.values()) > 0.3,
      'le champ doit être contrasté pour que ce test ait un sens');
  });

  test('le bruit ne sature pas plus que ce que sa distribution autorise', async () => {
    // Mutation qui passait inaperçue : revenir à l’étalement rejeté (division
    // par 0,44), qui saturait 24,5 % des valeurs. Le seuil de 35 % le laissait
    // repasser. Mesuré sur la version retenue : 3,8 % de saturation attendue.
    // Le seuil est posé À MI-CHEMIN, pas au petit bonheur.
    await h.post('/api/fixtures', { fixtures: Array.from({ length: 16 }, (_, i) => ({
      id: 'n' + i, name: 'N' + i, address: '/fixtures/bar' + i, enabled: true, x: 0.5, y: 0.5 })) });
    await h.post('/api/fixture3d', { fixtures: Array.from({ length: 16 }, (_, i) => ({
      id: 'n' + i,
      p3: [((i * 31) % 90) / 10 - 4.5, ((i * 47) % 70) / 10, ((i * 23) % 50) / 10],
      dir3: [1, 0, 0], len3: 0.8 })) });
    await base({ engine: 'field', field: 'bruit', stepMs: 200, speed: 1, group: 1, width: 1 });
    await h.post('/api/start');
    // ⚠ On échantillonne les niveaux de la PRÉVIEW, pas le flux OSC. Le moteur
    // n'envoie une valeur que si elle a CHANGÉ : les valeurs collées aux butées
    // se répètent, donc elles sont massivement sous-représentées dans l'OSC.
    // Mesurer la saturation là-dessus la sous-estime — c'est précisément ce qui
    // laissait passer la version rejetée du bruit.
    const vals = [];
    for (let i = 0; i < 30; i++) {
      const st = await h.state();
      for (const v of (st.levels || [])) if (typeof v === 'number') vals.push(v);
      await sleep(70);
    }
    await h.post('/api/stop');
    assert.ok(vals.length > 200, 'échantillon trop maigre pour juger : ' + vals.length);

    const satures = vals.filter(v => v <= 0.001 || v >= 0.999).length / vals.length;
    assert.ok(satures < 0.12,
      'bruit trop saturé : ' + (satures * 100).toFixed(1) + ' % aux butées. '
      + 'La version retenue en donne ~4 %, celle qui a été rejetée 24,5 % — '
      + 'ce seuil est là pour empêcher d’y revenir sans le voir.');
    // Et il doit rester du relief : un bruit constant ne saturerait pas non plus.
    assert.ok(Math.max(...vals) - Math.min(...vals) > 0.4,
      'le bruit doit garder de l’amplitude, étendue vue '
      + (Math.max(...vals) - Math.min(...vals)).toFixed(3));
    await h.post('/api/fixtures', { fixtures: enLigne(6) });
  });

  // ── Netteté, dérive du bruit, source mobile ────────────────────────────────

  test('la netteté resserre vraiment le motif', async () => {
    // Avant ce réglage, mesuré : 48 à 50 % des barres au-dessus de 50 %, quelle
    // que soit la forme, la forme d'onde ou l'étendue. Impossible d'obtenir une
    // bande étroite — donc impossible de faire une comète.
    await h.post('/api/fixtures', { fixtures: enLigne(16) });
    const part = async (duty) => {
      await base({ engine: 'field', field: 'plan', axAz: 0, duty, ...GEL, width: 4 });
      await h.post('/api/start');
      let hauts = 0, total = 0;
      for (let i = 0; i < 8; i++) {
        h.clearOsc();
        await sleep(110);
        const n = niveaux(h.osc());
        for (const v of n.values()) { total++; if (v > 0.5) hauts++; }
      }
      await h.post('/api/stop');
      return total ? hauts / total : 0;
    };
    const plein = await part(100);
    const serre = await part(20);
    assert.ok(plein > 0.3, 'a 100 %, une bonne part du plateau doit etre allumee, vu '
      + (plein * 100).toFixed(0) + ' %');
    assert.ok(serre < plein * 0.55,
      'a 20 % de nettete, la part allumee doit s effondrer : ' + (plein * 100).toFixed(0)
      + ' % -> ' + (serre * 100).toFixed(0) + ' %');
    await h.post('/api/fixtures', { fixtures: enLigne(6) });
  });

  test('la netteté à 100 % ne change RIEN au rendu d’origine', async () => {
    // Garde-fou de compatibilité : la valeur par défaut doit laisser le chemin
    // historique intact, sinon tous les shows existants changent de rendu.
    await base({ engine: 'wave', pattern: 'lr', ...GEL });
    const vague = await clicher();
    await base({ engine: 'field', field: 'plan', axAz: 0, duty: 100, ...GEL });
    const champ = await clicher();
    for (const [bar, v] of vague) {
      assert.ok(Math.abs(champ.get(bar) - v) < 0.02,
        bar + ' : la nettete a 100 % doit rendre la vague au bit pres');
    }
  });

  test('le bruit dérive dans la direction de l’AXE, pas toujours vers le bas', async () => {
    // Défaut mesuré avant correction : le temps n'était ajouté qu'à la troisième
    // coordonnée, donc le motif descendait toujours. Un feu qui descend, ce n'est
    // pas un feu.
    await h.post('/api/fixtures', { fixtures: enLigne(8) });
    const suite = async (axAz) => {
      await base({ engine: 'field', field: 'bruit', axAz, axEl: 0,
                   stepMs: 300, speed: 1, group: 1, width: 3 });
      await h.post('/api/start');
      const s = [];
      for (let i = 0; i < 6; i++) { h.clearOsc(); await sleep(140); const n = niveaux(h.osc()); if (n.size) s.push(n); }
      await h.post('/api/stop');
      return s;
    };
    const av = await suite(0);
    const ar = await suite(180);
    assert.ok(av.length >= 3 && ar.length >= 3, 'trop peu de releves');
    let differe = 0;
    for (const b of ['bar0', 'bar2', 'bar4', 'bar6']) {
      const a1 = av.map(n => n.get(b)).filter(v => v != null);
      const a2 = ar.map(n => n.get(b)).filter(v => v != null);
      if (!a1.length || !a2.length) continue;
      const m1 = a1.reduce((s, v) => s + v, 0) / a1.length;
      const m2 = a2.reduce((s, v) => s + v, 0) / a2.length;
      if (Math.abs(m1 - m2) > 0.03) differe++;
    }
    assert.ok(differe >= 1,
      'changer l axe doit changer la derive du bruit, ' + differe + ' barre(s) affectee(s)');
    await h.post('/api/fixtures', { fixtures: enLigne(6) });
  });

  test('le grain du bruit ne dépend PLUS de l’axe', async () => {
    // Défaut mesuré : le grain était normalisé sur l'étendue du plateau LE LONG
    // DE L'AXE, si bien que passer l'azimut de 0 à 90° changeait la taille des
    // taches de 20 % — sans qu'aucun réglage visible ne l'explique.
    await h.post('/api/fixtures', { fixtures: Array.from({ length: 12 }, (_, i) => ({
      id: 'g' + i, name: 'G' + i, address: '/fixtures/bar' + i, enabled: true, x: 0.5, y: 0.5 })) });
    await h.post('/api/fixture3d', { fixtures: Array.from({ length: 12 }, (_, i) => ({
      id: 'g' + i, p3: [i * 0.7 - 4, 1, 2], dir3: [1, 0, 0], len3: 0.5 })) });
    const ecartType = async (axAz) => {
      await base({ engine: 'field', field: 'bruit', axAz, axEl: 0,
                   stepMs: 10000, group: 8, speed: 0.05, width: 2 });
      await h.post('/api/start');
      const vals = [];
      for (let i = 0; i < 10; i++) {
        const st = await h.state();
        for (const v of (st.levels || [])) if (typeof v === 'number') vals.push(v);
        await sleep(70);
      }
      await h.post('/api/stop');
      const m = vals.reduce((s, v) => s + v, 0) / (vals.length || 1);
      return Math.sqrt(vals.reduce((s, v) => s + (v - m) ** 2, 0) / (vals.length || 1));
    };
    const e0 = await ecartType(0);
    const e90 = await ecartType(90);
    assert.ok(e0 > 0.05 && e90 > 0.05, 'le bruit doit avoir du relief aux deux azimuts');
    assert.ok(Math.abs(e0 - e90) < Math.max(e0, e90) * 0.5,
      'la statistique du bruit ne devrait pas dependre de l axe : ' + e0.toFixed(3)
      + ' contre ' + e90.toFixed(3));
    await h.post('/api/fixtures', { fixtures: enLigne(6) });
  });

  test('une source mobile fait voyager le centre du champ', async () => {
    // La comète : une sphère dont la source balaie un segment. Deux barres aux
    // extrémités du plateau doivent culminer à des MOMENTS différents.
    await h.post('/api/fixtures', { fixtures: [
      { id: 'k1', name: 'Jardin', address: '/fixtures/bar0', enabled: true, x: 0.5, y: 0.5 },
      { id: 'k2', name: 'Cour', address: '/fixtures/bar1', enabled: true, x: 0.5, y: 0.5 },
    ] });
    await h.post('/api/fixture3d', { fixtures: [
      { id: 'k1', p3: [-4, 0, 2], dir3: [1, 0, 0], len3: 1 },
      { id: 'k2', p3: [4, 0, 2], dir3: [1, 0, 0], len3: 1 },
    ] });
    await base({ engine: 'field', field: 'sphere', axAz: 0, axEl: 0,
                 srcX: 0, srcY: 0, srcZ: 2, course: 10, duty: 30,
                 stepMs: 3000, speed: 1, group: 1, width: 8 });
    await h.post('/api/start');
    // ⚠ Cycle LENT et échantillonnage dense : la suite tourne une dizaine de
    // serveurs en parallèle, et avec un cycle de 900 ms les relevés étaient trop
    // espacés pour attraper les deux crêtes — le test échouait une fois sur
    // trois sans que rien ne soit cassé. Ici on couvre ~80 % du cycle.
    const serie = [];
    for (let i = 0; i < 20; i++) {
      h.clearOsc();
      await sleep(120);
      const n = niveaux(h.osc());
      if (n.has('bar0') || n.has('bar1')) serie.push([n.get('bar0'), n.get('bar1')]);
    }
    await h.post('/api/stop');
    assert.ok(serie.length >= 10, 'trop peu de releves : ' + serie.length);
    const iMax = (k) => serie.reduce((best, v, i) =>
      (v[k] != null && (best.v == null || v[k] > best.v)) ? { i, v: v[k] } : best, { i: -1, v: null });
    const a = iMax(0), b = iMax(1);
    assert.ok(a.v > 0.5 && b.v > 0.5,
      'les deux barres doivent etre balayees : ' + JSON.stringify([a.v, b.v]));
    assert.notEqual(a.i, b.i,
      'les deux barres culminent au meme instant : la source ne bouge pas');
    await h.post('/api/fixtures', { fixtures: enLigne(6) });
  });

  test('course et netteté sont bornées', async () => {
    await setL({ duty: 1e9, course: 1e9 });
    let L = (await h.state()).layers[0];
    assert.ok(L.duty >= 5 && L.duty <= 100, 'nettete hors bornes : ' + L.duty);
    assert.ok(L.course >= 0 && L.course <= 200, 'course hors bornes : ' + L.course);
    await setL({ duty: -50, course: -3 });
    L = (await h.state()).layers[0];
    assert.ok(L.duty >= 5, 'nettete negative acceptee : ' + L.duty);
    assert.equal(L.course, 0, 'course negative acceptee : ' + L.course);
    await setL({ duty: 100, course: 0 });
  });

  test('les démos chargent quatre couches qui exploitent vraiment la 3D', async () => {
    // Sans elles, basculer sur « Champ 3D » ne change rien à l'écran : le réglage
    // par défaut rend exactement la vague, et un projet migré a toutes ses barres
    // à la même profondeur. C'est la pire première impression possible.
    await h.post('/api/fixtures', { fixtures: enLigne(8) });
    const r = await h.post('/api/demo');
    assert.equal(r.body.ok, true);
    const L = (await h.state()).layers;
    assert.equal(L.length, 4, 'quatre couches attendues, vu ' + L.length);
    assert.deepEqual(L.map(x => x.name), ['Profondeur', 'Comète', 'Phare', 'Feu']);
    // Toutes en champ, et chacune sur une forme différente : sinon la démo ne
    // montre pas ce qu'elle prétend montrer.
    for (const x of L) assert.equal(x.engine, 'field', x.name + ' devrait être en champ');
    assert.equal(new Set(L.map(x => x.field)).size, 4, 'quatre formes distinctes attendues');
    // Une seule active : quatre couches ensemble donneraient de la bouillie.
    assert.equal(L.filter(x => x.enabled).length, 1, 'une seule couche doit être active');
    // Et la comète doit avoir une source mobile, sinon ce n'est pas une comète.
    const com = L.find(x => x.name === 'Comète');
    assert.ok(com.course > 0, 'la comète doit avoir une course, vu ' + com.course);
    assert.ok(com.duty < 60, 'la comète doit être serrée, vu ' + com.duty);

    // Elles doivent VRAIMENT sortir de la lumière
    await h.post('/api/blackout');
    await sleep(80);
    h.clearOsc();
    await h.post('/api/start');
    await sleep(900);
    const msgs = h.osc();
    await h.post('/api/stop');
    // On juge sur le nombre de BARRES touchées, pas sur un compte de messages :
    // le cache anti-répétition fait varier ce compte d'une exécution à l'autre,
    // alors que « la démo éclaire le plateau » est une propriété stable.
    const touchees = new Set(msgs.filter(m => /^\/fixtures\/bar\d+\//.test(m.address))
      .map(m => m.address.split('/')[2]));
    assert.ok(touchees.size >= 4,
      'les démos doivent éclairer le plateau : ' + touchees.size + ' barre(s) touchée(s)');
    const mauvais = msgs.filter(m => typeof m.args[0] === 'number'
      && (!Number.isFinite(m.args[0]) || m.args[0] < 0 || m.args[0] > 1));
    assert.equal(mauvais.length, 0);
    await h.post('/api/fixtures', { fixtures: enLigne(6) });
  });


  // ── Modes de fusion et perspective atmosphérique ──────────────────────────

  test('les modes de fusion combinent vraiment deux couches', async () => {
    // Cascade ne savait faire que du HTP. Ça interdit tout ce qui fait un
    // compositeur : masquer, additionner, creuser.
    await h.post('/api/fixtures', { fixtures: enLigne(4) });
    while ((await h.state()).layers.length < 2) await h.post('/api/layers', { action: 'add' });
    const ids = (await h.state()).layers.map(l => l.id);

    // Deux couches PLATES, à des niveaux connus : 0,8 puis 0,5.
    const poser = async (blend) => {
      for (const [i, lvl] of [[0, 0.8], [1, 0.5]]) {
        await h.post('/api/layer', { id: ids[i], set: {
          engine: 'wave', pattern: 'pulse', waveform: 'square', mode: 'onoff',
          target: 'intensity', bars: null, enabled: true, level: lvl, floor: 1,
          invert: false, prof: 0, blend: i === 0 ? 'htp' : blend,
          stepMs: 10000, group: 8, speed: 0.05, width: 8 } });
      }
      await h.post('/api/blackout');
      await sleep(80);
      h.clearOsc();
      await h.post('/api/start');
      await sleep(260);
      const n = niveaux(h.osc());
      await h.post('/api/stop');
      return Math.max(...n.values());
    };

    // `floor: 1` force la valeur à 1 avant le niveau : chaque couche sort donc
    // exactement son `level`. Sans ça on mesurerait la forme d'onde, pas la fusion.
    const attendu = { htp: 0.8, add: 1, mul: 0.4, screen: 0.9, min: 0.5, sub: 0.3, remp: 0.5 };
    for (const [mode, cible] of Object.entries(attendu)) {
      const vu = await poser(mode);
      assert.ok(Math.abs(vu - cible) < 0.03,
        'fusion « ' + mode + ' » : attendu ' + cible + ', vu ' + vu.toFixed(3));
    }
    // Nettoyage
    for (const id of ids.slice(1)) await h.post('/api/layers', { action: 'remove', id });
    await h.post('/api/layer', { id: ids[0], set: { blend: 'htp', floor: 0, level: 1 } });
  });

  test('HTP reste le défaut : aucun projet existant ne change de rendu', async () => {
    const L = (await h.state()).layers[0];
    assert.equal(L.blend, 'htp', 'le mode par défaut doit rester HTP');
    assert.equal(L.prof, 0, 'la perspective doit être neutre par défaut');
    // Et un mode inconnu retombe sur HTP plutôt que de casser le mélange
    await setL({ blend: 'nawak' });
    assert.ok(['htp', 'add', 'mul', 'screen', 'min', 'sub', 'remp']
      .includes((await h.state()).layers[0].blend));
    await setL({ blend: 'htp' });
  });

  test('la perspective atmosphérique assombrit le lointain, et lui seul', async () => {
    // C'est CE réglage qui fait lire la profondeur : sans lui, deux barres l'une
    // derrière l'autre sortent au même niveau et se confondent en une surface.
    await h.post('/api/fixtures', { fixtures: [
      { id: 'pf', name: 'Face', address: '/fixtures/bar0', enabled: true, x: 0.5, y: 0.5 },
      { id: 'pm', name: 'Milieu', address: '/fixtures/bar1', enabled: true, x: 0.5, y: 0.5 },
      { id: 'pl', name: 'Lointain', address: '/fixtures/bar2', enabled: true, x: 0.5, y: 0.5 },
    ] });
    const sc = (await h.state()).scene;
    await h.post('/api/fixture3d', { fixtures: [
      { id: 'pf', p3: [0, -sc.d / 2, 2], dir3: [1, 0, 0], len3: 1 },
      { id: 'pm', p3: [0, 0, 2], dir3: [1, 0, 0], len3: 1 },
      { id: 'pl', p3: [0, sc.d / 2, 2], dir3: [1, 0, 0], len3: 1 },
    ] });

    const mesurer = async (prof) => {
      await base({ engine: 'wave', pattern: 'pulse', waveform: 'square', mode: 'onoff',
                   floor: 1, level: 1, prof, blend: 'htp', ...GEL });
      await h.post('/api/start');
      const n = await (async () => { h.clearOsc(); await sleep(240); return niveaux(h.osc()); })();
      await h.post('/api/stop');
      return n;
    };

    const plat = await mesurer(0);
    assert.ok(Math.abs(plat.get('bar0') - plat.get('bar2')) < 0.02,
      'sans perspective, les trois barres doivent sortir pareil : ' + JSON.stringify([...plat]));

    const creuse = await mesurer(80);
    const face = creuse.get('bar0'), milieu = creuse.get('bar1'), loin = creuse.get('bar2');
    assert.ok(face > 0.95, 'la barre de face ne doit pas être touchée, vue à ' + face);
    assert.ok(loin < 0.3, 'la barre du lointain doit s’effacer, vue à ' + loin);
    assert.ok(milieu > loin && milieu < face,
      'le milieu doit être entre les deux : ' + [face, milieu, loin].map(v => v.toFixed(2)));
    // Et la loi est linéaire en profondeur : le milieu vaut la moyenne.
    assert.ok(Math.abs(milieu - (face + loin) / 2) < 0.05,
      'l’atténuation doit être régulière, vu ' + milieu.toFixed(3));
    await h.post('/api/fixtures', { fixtures: enLigne(6) });
  });

  test('fusion et perspective voyagent avec le projet', async () => {
    await setL({ blend: 'mul', prof: 45 });
    const exp = await h.get('/api/export');
    await h.post('/api/new', { keepFixtures: true });
    await h.post('/api/import', exp.body);
    const L = (await h.state()).layers[0];
    assert.equal(L.blend, 'mul');
    assert.equal(L.prof, 45);
    await setL({ blend: 'htp', prof: 0 });
  });


  // ── Palette à N arrêts ─────────────────────────────────────────────────────

  test('une palette traverse VRAIMENT ses arrêts intermédiaires', async () => {
    // Deux couleurs interdisaient tout dégradé qui ne passe pas par le mélange
    // des extrêmes : pas de feu (noir → rouge → orange → jaune → blanc). Le test
    // qui compte est celui-là : les teintes du MILIEU doivent apparaître.
    await h.post('/api/fixtures', { fixtures: enLigne(10) });
    await base({ engine: 'field', field: 'plan', axAz: 0, target: 'color',
                 palette: 'feu', mode: 'fade', ...GEL, width: 8 });
    h.clearOsc();
    await h.post('/api/start');
    await sleep(400);
    const msgs = h.osc();
    await h.post('/api/stop');

    // On reconstitue la couleur de chaque barre depuis les trois canaux.
    const par = {};
    for (const m of msgs) {
      const x = /^\/fixtures\/(bar\d+)\/color\/(red|green|blue)$/.exec(m.address);
      if (x) (par[x[1]] = par[x[1]] || {})[x[2]] = m.args[0];
    }
    const coul = Object.values(par).filter(c => c.red != null && c.green != null && c.blue != null);
    assert.ok(coul.length >= 5, 'trop peu de couleurs relevées : ' + coul.length);

    // Le feu doit produire de l'ORANGE : du rouge fort, du vert moyen, peu de
    // bleu. Avec deux couleurs seulement, cette combinaison est impossible.
    const orange = coul.filter(c => c.red > 0.6 && c.green > 0.2 && c.green < 0.8 && c.blue < 0.4);
    assert.ok(orange.length >= 1,
      'la palette feu doit passer par l’orange, aucune barre trouvée parmi '
      + JSON.stringify(coul.map(c => [c.red, c.green, c.blue].map(v => v.toFixed(2)).join('/'))));
  });

  test('sans palette, on retombe exactement sur les deux couleurs', async () => {
    // Garde-fou de compatibilité : aucun projet existant ne doit changer.
    // ⚠ On juge le défaut sur une couche NEUVE, pas sur celle que les tests
    // précédents ont triturée : sinon on affirme un « défaut » qui n'en est pas un.
    await h.post('/api/layers', { action: 'add' });
    const neuves = (await h.state()).layers;
    const neuve = neuves[neuves.length - 1];
    assert.equal(neuve.palette, null, 'pas de palette par défaut');
    assert.equal(neuve.blend, 'htp', 'HTP par défaut');
    assert.equal(neuve.prof, 0, 'pas de perspective par défaut');
    assert.equal(neuve.duty, 100, 'netteté pleine par défaut');
    await h.post('/api/layers', { action: 'remove', id: neuve.id });
    await base({ engine: 'field', field: 'plan', target: 'color', palette: null,
                 colorA: '#ff0000', colorB: '#0000ff', mode: 'fade', ...GEL, width: 8 });
    h.clearOsc();
    await h.post('/api/start');
    await sleep(300);
    const msgs = h.osc();
    await h.post('/api/stop');
    const verts = msgs.filter(m => /\/color\/green$/.test(m.address)).map(m => m.args[0]);
    assert.ok(verts.length > 0, 'aucune couleur envoyée');
    // Un dégradé rouge → bleu ne contient AUCUN vert. Si la palette s'appliquait
    // par erreur, il y en aurait.
    assert.ok(Math.max(...verts) < 0.02,
      'du vert est apparu dans un dégradé rouge → bleu : ' + Math.max(...verts));
  });

  test('une palette hostile est nettoyée, jamais acceptée telle quelle', async () => {
    await setL({ palette: ['pas une couleur', '#00ff00', 42, '#0000ff'] });
    let L = (await h.state()).layers[0];
    assert.ok(Array.isArray(L.palette) && L.palette.length === 2,
      'seules les couleurs valides doivent rester : ' + JSON.stringify(L.palette));
    // Un seul arrêt valide ne fait pas une palette
    await setL({ palette: ['#00ff00', 'nope'] });
    assert.equal((await h.state()).layers[0].palette, null,
      'une palette d’un seul arrêt doit être refusée');
    // Bornée à huit arrêts
    await setL({ palette: Array.from({ length: 30 }, () => '#123456') });
    L = (await h.state()).layers[0];
    assert.ok(L.palette.length <= 8, 'palette non bornée : ' + L.palette.length);
    // Et un nom inconnu ne casse rien
    await setL({ palette: 'nawak' });
    assert.ok((await h.state()).layers[0].palette === null
      || Array.isArray((await h.state()).layers[0].palette));
    await setL({ palette: null });
  });

  test('la palette voyage avec le projet et les presets', async () => {
    await setL({ palette: 'glace', target: 'color' });
    const avant = (await h.state()).layers[0].palette;
    assert.ok(Array.isArray(avant) && avant.length >= 4);
    await h.post('/api/preset', { action: 'save', slot: 7, name: 'Glace' });
    const exp = await h.get('/api/export');
    await h.post('/api/new', { keepFixtures: true });
    await h.post('/api/import', exp.body);
    assert.deepEqual((await h.state()).layers[0].palette, avant,
      'la palette doit survivre à l’export/import');
    await setL({ palette: null });
    await h.post('/api/preset', { action: 'recall', slot: 7 });
    await sleep(80);
    assert.deepEqual((await h.state()).layers[0].palette, avant,
      'le preset doit restaurer la palette');
    await setL({ palette: null, target: 'intensity' });
  });


  // ── La palette branchée sur l'ESPACE ───────────────────────────────────────

  test('la palette peut suivre la profondeur au lieu du motif', async () => {
    // Le discriminant ne dépend d'aucune convention d'axe : la profondeur NE
    // BOUGE PAS. Donc si la palette la suit, la couleur de chaque barre est FIGÉE
    // alors que le champ continue de tourner. Branchée sur le motif, elle change
    // sans arrêt. Aucun risque de test tautologique.
    await h.post('/api/fixtures', { fixtures: [
      { id: 'qa', name: 'Face', address: '/fixtures/bar0', enabled: true, x: 0.5, y: 0.5 },
      { id: 'qb', name: 'Milieu', address: '/fixtures/bar1', enabled: true, x: 0.5, y: 0.5 },
      { id: 'qc', name: 'Loin', address: '/fixtures/bar2', enabled: true, x: 0.5, y: 0.5 },
    ] });
    const sc = (await h.state()).scene;
    await h.post('/api/fixture3d', { fixtures: [
      { id: 'qa', p3: [0, -sc.d / 2, 2], dir3: [1, 0, 0], len3: 1 },
      { id: 'qb', p3: [0, 0, 2], dir3: [1, 0, 0], len3: 1 },
      { id: 'qc', p3: [0, sc.d / 2, 2], dir3: [1, 0, 0], len3: 1 },
    ] });

    const couleurs = async (palSrc) => {
      await base({ engine: 'field', field: 'plan', target: 'color', mode: 'fade',
                   palette: ['#ff0000', '#0000ff'], palSrc, level: 1, floor: 0,
                   // ⚠ Ici on NE gèle PAS le moteur, au contraire de la plupart
                   // des tests : la démonstration repose sur le fait que le motif
                   // BOUGE pendant la fenêtre. Période = stepMs × group / speed,
                   // soit 400 ms — la fenêtre de 500 ms couvre un cycle entier.
                   // Avec le gel habituel (10 000 × 8 / 0,05) on n'en verrait
                   // qu'un millième : la couleur paraîtrait figée elle aussi et
                   // le test ne prouverait plus rien.
                   speed: 1, width: 8, stepMs: 400, group: 1 });
      h.clearOsc();
      await h.post('/api/start');
      await sleep(500);
      const msgs = h.osc();
      await h.post('/api/stop');
      const par = new Map();
      for (const m of msgs) {
        const x = /^\/fixtures\/(bar\d)\/color\/(red|blue)$/.exec(m.address);
        if (x) {
          if (!par.has(x[1])) par.set(x[1], { red: [], blue: [] });
          par.get(x[1])[x[2]].push(m.args[0]);
        }
      }
      return par;
    };

    const motif = await couleurs('motif');
    const rouges = motif.get('bar1') ? motif.get('bar1').red : [];
    assert.ok(new Set(rouges.map(v => v.toFixed(2))).size >= 3,
      'branchée sur le motif, la couleur doit VOYAGER : ' + rouges.length
      + ' envois, ' + new Set(rouges.map(v => v.toFixed(2))).size + ' valeurs');

    const prof = await couleurs('prof');
    for (const [bar, c] of prof) {
      assert.equal(new Set(c.red.map(v => v.toFixed(3))).size, 1,
        'branchée sur la profondeur, ' + bar + ' doit être FIGÉE : '
        + JSON.stringify(c.red));
    }
    // Et le dégradé va bien du proche au lointain : rouge devant, bleu derrière.
    const r = (b) => prof.get(b).red[0], bl = (b) => prof.get(b).blue[0];
    assert.ok(r('bar0') > 0.9 && bl('bar0') < 0.1,
      'la barre de face doit être rouge, vue ' + r('bar0') + '/' + bl('bar0'));
    assert.ok(r('bar2') < 0.1 && bl('bar2') > 0.9,
      'la barre du lointain doit être bleue, vue ' + r('bar2') + '/' + bl('bar2'));
    assert.ok(Math.abs(r('bar1') - 0.5) < 0.06,
      'le milieu doit être à mi-palette, vu ' + r('bar1'));

    // La hauteur marche pareil, sur un autre axe : les trois barres sont à la
    // même cote, donc elles doivent sortir IDENTIQUES — ce qui prouve que c'est
    // bien la hauteur qui est lue, et pas la profondeur par accident.
    const haut = await couleurs('haut');
    const vals = [...haut.values()].map(c => c.red[0]);
    assert.ok(Math.max(...vals) - Math.min(...vals) < 0.02,
      'à hauteur égale, la palette doit donner la même couleur : ' + JSON.stringify(vals));

    await base({ target: 'intensity', palette: null, palSrc: 'motif' });
    await h.post('/api/fixtures', { fixtures: enLigne(6) });
  });

  // ── Le décalage de phase RÉPARTI (les MAtricks de grandMA) ─────────────────

  test('le décalage réparti désynchronise des barres pourtant confondues', async () => {
    // Toutes les barres au MÊME point 3D : le champ leur donne forcément la même
    // valeur. Si elles sortent différentes, ça ne peut venir que du décalage
    // réparti — aucune autre explication possible.
    const N = 8;
    await h.post('/api/fixtures', { fixtures: enLigne(N) });
    await h.post('/api/fixture3d', { fixtures: Array.from({ length: N }, (_, i) =>
      ({ id: 'c' + i, p3: [0, 0, 2], dir3: [1, 0, 0], len3: 1 })) });

    const mesurer = async (spread, engine, forme) => {
      // ⚠ Les formes d'onde sont sine | triangle | square. Demander « saw » ne
      // lève rien : le sanitizer garde la valeur précédente, et on croit tester
      // une rampe alors qu'on teste une sinusoïde.
      await base({ engine: engine || 'field', field: 'plan', waveform: forme || 'sine',
                   pattern: 'pulse', mode: 'fade', spread, level: 1, floor: 0, ...GEL });
      h.clearOsc();
      await h.post('/api/start');
      await sleep(260);
      const n = niveaux(h.osc());
      await h.post('/api/stop');
      return n;
    };

    const ensemble = await mesurer(0);
    const v0 = [...ensemble.values()];
    assert.ok(v0.length >= N - 1, 'trop peu de barres relevées : ' + v0.length);
    assert.ok(Math.max(...v0) - Math.min(...v0) < 0.02,
      'au même point et sans décalage, tout doit sortir à l’unisson : '
      + JSON.stringify(v0.map(v => v.toFixed(3))));

    const etale = await mesurer(360);
    const v1 = [...etale.values()];
    assert.ok(Math.max(...v1) - Math.min(...v1) > 0.6,
      'un décalage de 360° doit étaler un cycle entier : '
      + JSON.stringify(v1.map(v => v.toFixed(3))));
    // ⚠ On n'exige PAS N valeurs distinctes, et ce n'est pas un test tiède :
    // avec une sinusoïde, un décalage qui couvre exactement un cycle apparie la
    // barre i et la barre N−1−i à la MÊME valeur (le cosinus est symétrique).
    // Quatre valeurs pour huit barres est le maximum théorique, pas un défaut.
    assert.ok(new Set(v1.map(v => v.toFixed(2))).size >= N / 2,
      'chaque barre doit avoir SA place dans le cycle : '
      + JSON.stringify(v1.map(v => v.toFixed(3))));

    // La preuve sans repli possible : en créneau, un décalage d'un cycle entier
    // met forcément une partie des barres en haut et l'autre en bas. Sans
    // décalage elles seraient toutes du même côté — aucune symétrie ne peut
    // fabriquer ça par accident.
    const creneau = [...(await mesurer(360, 'field', 'square')).values()];
    assert.ok(creneau.some(v => v > 0.9) && creneau.some(v => v < 0.1),
      'en créneau, le décalage doit séparer les barres en deux camps : '
      + JSON.stringify(creneau.map(v => v.toFixed(2))));

    // Il ne touche pas la vague : le champ est le seul moteur qui en tient
    // compte. Si ça changeait, l'interface mentirait en cachant le réglage.
    const vague = [...(await mesurer(360, 'wave')).values()];
    assert.ok(Math.max(...vague) - Math.min(...vague) < 0.02,
      'la vague doit ignorer le décalage réparti : '
      + JSON.stringify(vague.map(v => v.toFixed(3))));
    await base({ engine: 'field', spread: 0 });
  });

  test('la source de palette et le décalage voyagent avec le projet', async () => {
    await setL({ palSrc: 'prof', spread: 720, palette: 'distance', target: 'color' });
    await h.post('/api/preset', { action: 'save', slot: 9, name: 'Volume' });
    const exp = await h.get('/api/export');
    await h.post('/api/new', { keepFixtures: true });
    await h.post('/api/import', exp.body);
    let L = (await h.state()).layers[0];
    assert.equal(L.palSrc, 'prof', 'la source de palette doit survivre à l’import');
    assert.equal(L.spread, 720, 'le décalage réparti doit survivre à l’import');

    await setL({ palSrc: 'motif', spread: 0 });
    await h.post('/api/preset', { action: 'recall', slot: 9 });
    await sleep(80);
    L = (await h.state()).layers[0];
    assert.equal(L.palSrc, 'prof', 'le preset doit restaurer la source de palette');
    assert.equal(L.spread, 720, 'le preset doit restaurer le décalage');

    // Bornes : rien d'hostile ne passe.
    await setL({ palSrc: 'nawak', spread: 99999 });
    L = (await h.state()).layers[0];
    assert.ok(['motif', 'prof', 'haut'].includes(L.palSrc),
      'une source inconnue doit être refusée, vu ' + L.palSrc);
    assert.ok(L.spread <= 1440, 'le décalage doit être borné, vu ' + L.spread);
    await setL({ palSrc: 'motif', spread: 0, palette: null, target: 'intensity' });
  });

  test('aucune erreur n’a été écrite dans le journal du serveur', () => {
    const erreurs = h.logs.join('').split('\n').filter(l =>
      /erreur inattendue|promesse rejetée|erreur moteur|Error:|TypeError|RangeError/.test(l));
    assert.equal(erreurs.length, 0, 'le serveur a signalé :\n' + erreurs.join('\n'));
  });
});
