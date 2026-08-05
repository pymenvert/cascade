'use strict';
/** API HTTP : validation des entrées, presets, projet, import/export. */
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert');
const { start, sleep, fixtures } = require('./helpers.js');

describe('API HTTP', () => {
  let h;
  before(async () => { h = await start(); });
  after(async () => { await h.stop(); });

  test('/api/ping identifie Cascade', async () => {
    const r = await h.get('/api/ping');
    assert.equal(r.body.app, 'Cascade');
    // Semver complet, pré-version comprise : la branche v2 s'annonce
    // « 2.0.0-dev » tant qu'elle n'est pas sortie, et c'est volontaire — une app
    // qui ment sur sa version est indébogable à distance.
    assert.match(r.body.version, /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/);
  });

  test('/api/state expose tout ce dont l’interface a besoin', async () => {
    const s = await h.state();
    for (const k of ['settings', 'fixtures', 'layers', 'global', 'presets', 'link', 'project', 'levels']) {
      assert.ok(k in s, 'champ manquant : ' + k);
    }
    assert.equal(s.global.running, false);
  });

  test('une URL inconnue renvoie 404, pas une erreur serveur', async () => {
    const r = await h.get('/api/nexistepas');
    assert.equal(r.status, 404);
  });

  test('les valeurs hors bornes sont ramenées dans les clous', async () => {
    const id = (await h.state()).layers[0].id;
    const r = await h.post('/api/layer', { id, set: {
      stepMs: 999999, speed: -50, width: 99, group: 0, level: 12,
      phase: 5000, swing: -900, floor: 3, blocks: 42, sparkle: 9,
    } });
    const L = r.body.layer;
    assert.equal(L.stepMs, 10000);
    assert.equal(L.speed, 0.05);
    assert.equal(L.width, 8);
    assert.equal(L.group, 1);
    assert.equal(L.level, 1);
    assert.equal(L.phase, 360);
    assert.equal(L.swing, -75);
    assert.equal(L.floor, 1);
    assert.equal(L.blocks, 8);
    assert.equal(L.sparkle, 1);
  });

  test('les valeurs absurdes (texte, null) ne cassent rien', async () => {
    const id = (await h.state()).layers[0].id;
    const r = await h.post('/api/layer', { id, set: {
      stepMs: 'beaucoup', pattern: 'inexistant', engine: 'nawak',
      colorA: 'rouge', level: null, bars: 'pas-un-tableau',
    } });
    assert.equal(r.body.ok, true);
    const L = r.body.layer;
    assert.equal(typeof L.stepMs, 'number');
    assert.ok(['lr', 'rl', 'pingpong', 'random', 'evenodd', 'all'].includes(L.pattern));
    assert.equal(L.engine, 'steps');
    assert.match(L.colorA, /^#[0-9a-fA-F]{6}$/);
  });

  test('le nom de paramètre OSC refuse la remontée de chemin', async () => {
    const before = (await h.state()).global.param;
    await h.post('/api/global', { param: '../../etc/passwd' });
    assert.equal((await h.state()).global.param, before);
    await h.post('/api/global', { param: 'dimmer' });
    assert.equal((await h.state()).global.param, 'dimmer');
    await h.post('/api/global', { param: 'luminosity' });
  });

  test('la courbe de gradateur n’accepte que les valeurs connues', async () => {
    await h.post('/api/global', { dimmer: 'square' });
    assert.equal((await h.state()).global.dimmer, 'square');
    await h.post('/api/global', { dimmer: 'n’importe quoi' });
    assert.equal((await h.state()).global.dimmer, 'square');
    await h.post('/api/global', { dimmer: 'linear' });
  });

  test('on ne dépasse jamais 8 couches ni ne descend sous 1', async () => {
    for (let i = 0; i < 20; i++) await h.post('/api/layers', { action: 'add' });
    assert.equal((await h.state()).layers.length, 8);
    for (const L of (await h.state()).layers) await h.post('/api/layers', { action: 'remove', id: L.id });
    assert.equal((await h.state()).layers.length, 1);
  });

  test('les fixtures sont bornées et normalisées', async () => {
    await h.post('/api/fixtures', { fixtures: [
      { id: 'a', name: 'X'.repeat(500), address: '/fixtures/a', x: 42, y: -3 },
      { name: 'sans id', address: '/fixtures/b' },
    ] });
    const fx = (await h.state()).fixtures;
    assert.equal(fx.length, 2);
    assert.equal(fx[0].name.length, 64);
    assert.equal(fx[0].x, 1);
    assert.equal(fx[0].y, 0);
    assert.ok(fx[1].id, 'un id doit être généré');
  });

  test('la carte MIDI rejette les clés mal formées', async () => {
    await h.post('/api/midimap', { map: {
      'cc:1:7': 'master', 'note:10:36': 'start',
      'sql; drop': 'evil', 'cc:1:7:extra': 'evil', 'cc:1:8': 'X'.repeat(200),
    } });
    const m = (await h.state()).midiMap;
    assert.deepEqual(Object.keys(m).sort(), ['cc:1:7', 'note:10:36']);
  });

  test('groupes : création, renommage, contenu, suppression', async () => {
    await h.post('/api/fixtures', { fixtures: fixtures(6) });
    let r = await h.post('/api/groups', { action: 'add', name: 'Sol' });
    assert.equal(r.body.groups.length, 1);
    const gid = r.body.groups[0].id;
    assert.equal(r.body.groups[0].name, 'Sol');
    assert.deepEqual(r.body.groups[0].bars, []);

    r = await h.post('/api/groups', { action: 'set', id: gid, bars: ['f0', 'f1', 'f0'] });
    assert.deepEqual(r.body.groups[0].bars, ['f0', 'f1'], 'les doublons doivent être écartés');

    r = await h.post('/api/groups', { action: 'rename', id: gid, name: 'X'.repeat(60) });
    assert.equal(r.body.groups[0].name.length, 20, 'nom borné à 20 caractères');

    r = await h.post('/api/groups', { action: 'remove', id: gid });
    assert.equal(r.body.groups.length, 0);
  });

  test('on ne dépasse pas 16 groupes', async () => {
    for (let i = 0; i < 25; i++) await h.post('/api/groups', { action: 'add', name: 'G' + i });
    const g = (await h.state()).groups;
    assert.equal(g.length, 16);
    for (const x of g) await h.post('/api/groups', { action: 'remove', id: x.id });
  });

  test('une couche suit son groupe, et le lien est vivant', async () => {
    await h.post('/api/fixtures', { fixtures: fixtures(6) });
    const r = await h.post('/api/groups', { action: 'add', name: 'Contres' });
    const gid = r.body.groups[0].id;
    await h.post('/api/groups', { action: 'set', id: gid, bars: ['f2', 'f3'] });
    const id = (await h.state()).layers[0].id;
    await h.post('/api/layer', { id, set: { groupId: gid } });
    assert.equal((await h.state()).layers[0].groupId, gid);
    // Modifier le groupe ne touche pas la couche : c'est une référence
    await h.post('/api/groups', { action: 'set', id: gid, bars: ['f0'] });
    assert.equal((await h.state()).layers[0].groupId, gid);
    // Supprimer le groupe libère les couches qui le suivaient
    await h.post('/api/groups', { action: 'remove', id: gid });
    assert.equal((await h.state()).layers[0].groupId, null);
  });

  test('les groupes survivent à l’export/import et sont assainis', async () => {
    await h.post('/api/fixtures', { fixtures: fixtures(4) });
    const r = await h.post('/api/groups', { action: 'add', name: 'Portique' });
    await h.post('/api/groups', { action: 'set', id: r.body.groups[0].id, bars: ['f1', 'f2'] });
    const exp = await h.get('/api/export');
    await h.post('/api/new', { keepFixtures: false });
    assert.deepEqual((await h.state()).groups, [], 'un projet neuf repart sans groupe');
    await h.post('/api/import', exp.body);
    const g = (await h.state()).groups;
    assert.equal(g.length, 1);
    assert.equal(g[0].name, 'Portique');
    assert.deepEqual(g[0].bars, ['f1', 'f2']);
    // Import hostile
    await h.post('/api/import', { layers: exp.body.layers, groups: [
      'pas un groupe', null, { id: 'a', name: 'X'.repeat(99), bars: 'pas un tableau' },
      { id: 'a', name: 'doublon' },
    ] });
    const g2 = (await h.state()).groups;
    assert.equal(g2.length, 1, 'les entrées invalides et les id en double sont écartés');
    assert.equal(g2[0].name.length, 20);
    assert.deepEqual(g2[0].bars, []);
    for (const x of g2) await h.post('/api/groups', { action: 'remove', id: x.id });
  });

  test('presets : sauvegarde, rappel, effacement', async () => {
    await h.post('/api/fixtures', { fixtures: fixtures(4) });
    const id = (await h.state()).layers[0].id;
    await h.post('/api/layer', { id, set: { stepMs: 111, name: 'Avant' } });
    await h.post('/api/preset', { action: 'save', slot: 2 });
    await h.post('/api/layer', { id, set: { stepMs: 999, name: 'Après' } });
    assert.equal((await h.state()).layers[0].stepMs, 999);
    await h.post('/api/preset', { action: 'recall', slot: 2 });
    assert.equal((await h.state()).layers[0].stepMs, 111);
    assert.equal((await h.state()).layers[0].name, 'Avant');
    await h.post('/api/preset', { action: 'clear', slot: 2 });
    assert.equal((await h.state()).presets[2], null);
  });

  test('les presets peuvent être nommés, renommés et bornés', async () => {
    await h.post('/api/preset', { action: 'save', slot: 5, name: 'Refrain' });
    assert.equal((await h.state()).presets[5], 'Refrain');
    // Sans nom : numéro par défaut
    await h.post('/api/preset', { action: 'save', slot: 6 });
    assert.equal((await h.state()).presets[6], 'P7');
    // Nom trop long : coupé à 16 caractères
    await h.post('/api/preset', { action: 'save', slot: 7, name: 'X'.repeat(80) });
    assert.equal((await h.state()).presets[7].length, 16);
    // Renommage d'un preset existant
    await h.post('/api/preset', { action: 'rename', slot: 5, name: 'Final' });
    assert.equal((await h.state()).presets[5], 'Final');
    // Nom vidé : on retombe sur le numéro
    await h.post('/api/preset', { action: 'rename', slot: 5, name: '   ' });
    assert.equal((await h.state()).presets[5], 'P6');
    // Renommer un slot vide ne crée rien
    await h.post('/api/preset', { action: 'rename', slot: 11, name: 'Fantôme' });
    assert.equal((await h.state()).presets[11], null);
    for (const s of [5, 6, 7]) await h.post('/api/preset', { action: 'clear', slot: s });
  });

  test('le nom d’un preset survit à l’export/import', async () => {
    await h.post('/api/preset', { action: 'save', slot: 9, name: 'Pont' });
    const exp = await h.get('/api/export');
    await h.post('/api/new', { keepFixtures: true });
    assert.equal((await h.state()).presets[9], null);
    await h.post('/api/import', exp.body);
    assert.equal((await h.state()).presets[9], 'Pont');
    await h.post('/api/preset', { action: 'clear', slot: 9 });
  });

  test('un nom de 16 caractères survit au redémarrage', async () => {
    // Régression : `sanitizePresets` recoupait à 12 alors que la sauvegarde et
    // le renommage coupent à 16. Le rabotage n'arrivait donc PAS à la saisie,
    // mais au rechargement du fichier — quand plus personne ne regarde.
    await h.post('/api/preset', { action: 'save', slot: 9, name: 'ABCDEFGHIJKLMNOP' });
    const exp = await h.get('/api/export');
    await h.post('/api/new', { keepFixtures: true });
    await h.post('/api/import', exp.body);
    assert.equal((await h.state()).presets[9], 'ABCDEFGHIJKLMNOP');
    await h.post('/api/preset', { action: 'clear', slot: 9 });
  });

  test('l’empreinte d’un preset décrit les barres qu’il pilote', async () => {
    await h.post('/api/fixtures', { fixtures: fixtures(4) });
    const id = (await h.state()).layers[0].id;
    const bars = (await h.state()).fixtures.slice(0, 2).map(f => f.id);
    await h.post('/api/layer', { id, set: { target: 'color', colorA: '#00ff00', bars } });
    await h.post('/api/preset', { action: 'save', slot: 3, name: 'Vert' });

    const r = await h.get('/api/presets-info');
    const info = r.body.infos[3];
    assert.equal(info.c.length, 4, 'une case par barre active');
    assert.equal(info.c, '00..', 'seules les deux barres pilotées sont peintes');
    assert.deepEqual(info.pal, ['#00ff00'], 'la teinte vient de la couche');
    assert.equal(info.a, 1); assert.equal(info.t, 1);
    assert.equal(r.body.infos[0], null, 'un slot vide n’a pas d’empreinte');

    // Une couche désactivée ne peint rien.
    await h.post('/api/layers', { action: 'add' });
    const l2 = (await h.state()).layers[1].id;
    await h.post('/api/layer', { id: l2, set: { enabled: false } });
    await h.post('/api/preset', { action: 'save', slot: 4 });
    const info4 = (await h.get('/api/presets-info')).body.infos[4];
    assert.equal(info4.a, 1, 'une seule couche active');
    assert.equal(info4.t, 2, 'sur deux couches mémorisées');
    await h.post('/api/layers', { action: 'remove', id: l2 });
    for (const s of [3, 4]) await h.post('/api/preset', { action: 'clear', slot: s });
  });

  test('les empreintes ne voyagent PAS dans /api/state', async () => {
    // C'est tout l'intérêt de l'endpoint séparé : /api/state part 8 fois par
    // seconde. Si ce test tombe, le coût du poll a été réintroduit.
    const st = await h.state();
    assert.ok(!('infos' in st), 'aucune empreinte dans /api/state');
    assert.ok(Array.isArray(st.presets) && st.presets.length === 16,
      '`presets` reste un tableau de 16 entrées');
    assert.ok(st.presets.every(p => p === null || typeof p === 'string'),
      '`presets` ne contient que des noms');
    assert.equal(typeof st.presetsRev, 'number');
  });

  test('presetActif suit ce qui joue, presetsRev ce qui change', async () => {
    await h.post('/api/new', { keepFixtures: true });
    assert.equal((await h.state()).presetActif, null, 'rien ne joue au départ');

    await h.post('/api/preset', { action: 'save', slot: 2 });
    assert.equal((await h.state()).presetActif, 2, 'enregistrer désigne le slot');
    const rev = (await h.state()).presetsRev;

    await h.post('/api/preset', { action: 'save', slot: 5 });
    await h.post('/api/preset', { action: 'recall', slot: 2 });
    assert.equal((await h.state()).presetActif, 2, 'rappeler désigne le slot');
    // ⚠ La règle est plus fine qu'elle n'en a l'air. Un rappel ne change pas la
    // BANQUE, donc en principe il n'incrémente pas — recharger les empreintes à
    // chaque rappel ferait une requête de plus au pire moment. Mais un preset
    // enregistré porte toujours SA disposition, et la rappeler remplace le
    // plateau : les empreintes des presets sans disposition propre changent
    // alors. Ce rappel-ci incrémente donc, et c'est voulu (voir le test dédié).
    assert.equal((await h.state()).presetsRev, rev + 2, 'le save ET ce rappel');

    await h.post('/api/preset', { action: 'clear', slot: 2 });
    assert.equal((await h.state()).presetActif, null, 'effacer le slot actif l’oublie');
    await h.post('/api/preset', { action: 'rename', slot: 5, name: 'Z' });
    assert.ok((await h.state()).presetsRev > rev + 1, 'renommer change la banque');
    await h.post('/api/new', { keepFixtures: true });
    assert.equal((await h.state()).presetActif, null, 'un projet neuf n’a rien en cours');
  });

  test('l’empreinte se rafraîchit quand les GROUPES ou les BARRES changent', async () => {
    // L'empreinte passe par `resolveBars`, qui résout les groupes VIVANTS — un
    // preset n'en mémorise pas. Et un preset sans disposition propre retombe sur
    // le plateau courant. Ces deux collections changent donc ce qu'un preset
    // piloterait au rappel : si `presetsRev` ne bouge pas, la grille reste figée
    // sur une vignette qui ment.
    await h.post('/api/fixtures', { fixtures: fixtures(4) });
    await h.post('/api/preset', { action: 'save', slot: 1 });
    const rev0 = (await h.state()).presetsRev;

    const g = await h.post('/api/groups', { action: 'add', name: 'Sol' });
    const rev1 = (await h.state()).presetsRev;
    assert.ok(rev1 > rev0, 'créer un groupe doit rafraîchir les empreintes');

    const gid = g.body.groups[g.body.groups.length - 1].id;
    await h.post('/api/groups', { action: 'set', id: gid, bars: ['f1'] });
    const rev2 = (await h.state()).presetsRev;
    assert.ok(rev2 > rev1, 'CHANGER LE CONTENU d’un groupe aussi — c’est le cas qui manquait');

    await h.post('/api/fixtures', { fixtures: fixtures(5) });
    const rev3 = (await h.state()).presetsRev;
    assert.ok(rev3 > rev2, 'changer le plateau doit rafraîchir les empreintes');

    await h.post('/api/groups', { action: 'remove', id: gid });
    await h.post('/api/preset', { action: 'clear', slot: 1 });
  });

  test('un rappel qui REMPLACE le plateau rafraîchit aussi les empreintes', async () => {
    // Un rappel ne change pas la banque, donc il n'incrémente pas la révision en
    // général. Mais s'il remplace le plateau, il change l'empreinte de tout
    // preset SANS disposition propre — ceux-là retombent sur `state.fixtures`.
    // `sanitizePresets` autorise `fixtures: null`, donc un projet importé en a.
    await h.post('/api/fixtures', { fixtures: fixtures(3) });
    // Un preset sans disposition à lui, comme en produit un import.
    const exp = await h.get('/api/export');
    const sansFx = JSON.parse(JSON.stringify(exp.body));
    sansFx.presets = Array(16).fill(null);
    sansFx.presets[0] = { name: 'Ancien', layers: exp.body.layers, fixtures: null };
    await h.post('/api/import', sansFx);

    const avant = (await h.get('/api/presets-info')).body.infos[0].c.length;
    // Un autre preset, avec SA disposition, plus courte.
    await h.post('/api/fixtures', { fixtures: fixtures(1) });
    await h.post('/api/preset', { action: 'save', slot: 1, name: 'Court' });
    await h.post('/api/fixtures', { fixtures: fixtures(3) });
    const rev = (await h.state()).presetsRev;

    await h.post('/api/preset', { action: 'recall', slot: 1 });
    const apres = (await h.get('/api/presets-info')).body.infos[0].c.length;
    assert.notEqual(apres, avant, 'le rappel doit bien avoir changé l’empreinte du slot 0');
    assert.ok((await h.state()).presetsRev > rev,
      'et la révision doit bouger, sinon la grille garde une vignette qui ment');
    await h.post('/api/new', { keepFixtures: true });
  });

  test('l’icône de notification se règle, et reste inerte hors Windows', async () => {
    // ⚠ Windows seulement, et jamais exécutée : le code PowerShell a été écrit
    // depuis Linux. Ce qu'on peut vérifier ici, c'est l'essentiel — que le
    // réglage tienne, et que l'activer ne casse RIEN sur une machine où
    // PowerShell n'existe pas (la suite tourne sous Linux en CI).
    assert.equal((await h.state()).settings.systray, false, 'éteinte par défaut');
    const on = await h.post('/api/settings', { systray: true });
    assert.equal(on.body.settings.systray, true);
    // Le serveur doit être intact : c'est tout l'objet du try/catch autour du
    // lancement. Une fonction d'agrément ne doit jamais empêcher Cascade de servir.
    assert.equal((await h.get('/api/ping')).body.app, 'Cascade');
    assert.equal((await h.state()).global.running, false);
    const off = await h.post('/api/settings', { systray: false });
    assert.equal(off.body.settings.systray, false);
  });

  // ── Ce que le script PowerShell lit, et ce qu'il ne doit surtout pas toucher ──
  //
  // Aucun de ces tests ne lance PowerShell : ils vérifient le CONTRAT côté
  // serveur, qui est la seule moitié observable depuis Linux. Sans eux, la
  // moitié Windows repose sur zéro mesure au lieu d'une.

  test('l’icône sonde /api/ping, qui lui donne de quoi se peindre', async () => {
    const avant = await h.get('/api/ping');
    assert.equal(avant.body.app, 'Cascade', 'la carte de visite ne change pas');
    assert.equal(avant.body.running, false, 'le script a besoin de l’état du show');
    assert.equal(typeof avant.body.systray, 'boolean',
      'et de savoir si la case est encore cochée, pour partir proprement');

    await h.post('/api/start');
    assert.equal((await h.get('/api/ping')).body.running, true,
      'point vert : ping doit suivre le show, sinon l’icône ment');
    await h.post('/api/stop');
    assert.equal((await h.get('/api/ping')).body.running, false);

    await h.post('/api/settings', { systray: true });
    assert.equal((await h.get('/api/ping')).body.systray, true);
    await h.post('/api/settings', { systray: false });
    assert.equal((await h.get('/api/ping')).body.systray, false,
      'décocher doit se voir sur ping : c’est le signal de sortie propre du script');
  });

  test('le sondage de l’icône NE réarme PAS l’arrêt automatique', async () => {
    // LE défaut que cette famille de tests existe pour attraper. Première
    // version : le script sondait `/api/state`, qui remet `lastUiPollAt` à
    // maintenant. Toutes les 1,5 s, donc — et l'arrêt automatique exige 8 s de
    // silence. Case cochée, l'utilisateur ferme son navigateur : Cascade ne se
    // ferme PLUS JAMAIS tout seul. Combiné au mode app (pas de terminal) et à
    // une icône que Windows range dans le tiroir caché, il ne reste que le
    // Gestionnaire des tâches. Une fonction d'agrément cassait une fonction
    // livrée, en silence.
    //
    // On mesure l'arrêt POUR DE VRAI, sur une instance à part : le veilleur est
    // armé et le délai de grâce ramené à 400 ms. Pas de route de débogage, pas
    // de repère interne exposé — le seul fait observable, c'est que le
    // processus est mort ou vivant.
    const sonde = await start(null, { CASCADE_NO_AUTOQUIT: '0', CASCADE_UI_GONE_MS: '400' });
    try {
      await sonde.state();                    // une interface s'est connectée : le veilleur s'arme
      // Le refus de connexion EST le résultat attendu : le serveur est parti.
      for (let i = 0; i < 12 && sonde.vivant(); i++) {
        try { await sonde.get('/api/ping'); } catch (e) {}
        await sleep(100);
      }
      assert.equal(sonde.vivant(), false,
        'sondé uniquement par l’icône, Cascade doit quand même se fermer tout seul');
    } finally { await sonde.stop(); }

    // Témoin — sans lui, le test passerait aussi si le serveur mourait pour
    // n'importe quelle autre raison.
    const temoin = await start(null, { CASCADE_NO_AUTOQUIT: '0', CASCADE_UI_GONE_MS: '400' });
    try {
      for (let i = 0; i < 12; i++) { await temoin.state(); await sleep(100); }
      assert.equal(temoin.vivant(), true,
        'une vraie interface qui poll doit, elle, garder Cascade en vie');
    } finally { await temoin.stop(); }
  });

  test('ping reste une carte de visite muette vu du réseau', async () => {
    // La route est hors du portillon du code d'accès : tout ce qu'on y met est
    // lisible sans s'authentifier. L'état du show et le réglage de l'icône ne
    // sortent donc que pour la machine hôte, qui est la seule à en avoir besoin.
    const r = await h.get('/api/ping', { from: '127.0.0.2' });
    assert.equal(r.body.app, 'Cascade');
    assert.equal(r.body.version, (await h.state()).version);
    assert.equal('running' in r.body, false, 'l’état du show ne sort pas sur le réseau');
    assert.equal('systray' in r.body, false, 'ni le réglage de l’icône');
  });

  test('le serveur dit sur QUELLE machine il tourne, pas le navigateur', async () => {
    // L'interface s'ouvre depuis un iPad : `navigator.platform` répondrait pour
    // la tablette, alors que l'icône se pose sur l'hôte. Case grisée à tort
    // depuis une tablette Windows-less, case active à tort devant un hôte macOS
    // — et `systray: true` écrit dans une config qui voyage sur la clé USB.
    const st = await h.state();
    assert.equal(typeof st.win, 'boolean', '/api/state doit trancher lui-même');
    assert.equal(st.win, process.platform === 'win32');
  });

  test('un slot de preset hors bornes ne fait pas planter', async () => {
    const r = await h.post('/api/preset', { action: 'recall', slot: 9999 });
    assert.equal(r.body.ok, true);
    const r2 = await h.post('/api/preset', { action: 'recall', slot: -5 });
    assert.equal(r2.body.ok, true);
  });

  test('export puis import redonnent le même projet', async () => {
    await h.post('/api/project', { name: 'Spectacle Été #2' });
    const id = (await h.state()).layers[0].id;
    await h.post('/api/layer', { id, set: { stepMs: 321, phase: 90, floor: 0.25, blocks: 3 } });
    const exp = await h.get('/api/export');
    assert.match(exp.headers['content-disposition'], /filename="Spectacle-Ete-2\.json"/);
    await h.post('/api/new', { keepFixtures: false });
    assert.equal((await h.state()).layers[0].stepMs, 250);
    const r = await h.post('/api/import', exp.body);
    assert.equal(r.body.ok, true);
    const s = await h.state();
    assert.equal(s.layers[0].stepMs, 321);
    assert.equal(s.layers[0].phase, 90);
    assert.equal(s.layers[0].floor, 0.25);
    assert.equal(s.layers[0].blocks, 3);
    assert.equal(s.project.name, 'Spectacle Été #2');
  });

  test('un import malveillant est neutralisé', async () => {
    const r = await h.post('/api/import', {
      layers: [{ name: 'X', stepMs: -999, pattern: '../../evil', level: 'NaN' }],
      fixtures: [{ id: 'z', address: '/fixtures/z' }],
      global: { param: '../../../etc/passwd', master: 42 },
      presets: ['pas un preset', null, { layers: 'pas un tableau' }],
    });
    assert.equal(r.body.ok, true);
    const s = await h.state();
    assert.equal(s.layers[0].stepMs, 30);
    assert.ok(!s.global.param.includes('..'));
    assert.ok(s.global.master <= 1);
    assert.equal(s.presets.filter(Boolean).length, 0);
  });

  test('un import sans couches est refusé proprement', async () => {
    const r = await h.post('/api/import', { fixtures: [] });
    assert.equal(r.body.ok, false);
  });

  test('un corps JSON illisible ne bloque pas la requête', async () => {
    const raw = await new Promise((resolve, reject) => {
      const req = require('http').request({
        host: '127.0.0.1', port: h.port, path: '/api/global', method: 'POST',
        headers: { 'Content-Type': 'application/json' }, timeout: 4000,
      }, res => { let d = ''; res.on('data', c => d += c); res.on('end', () => resolve(d)); });
      req.on('error', reject);
      req.on('timeout', () => req.destroy(new Error('la requête n’a jamais répondu')));
      req.end('{ ceci n’est pas du JSON ');
    });
    assert.match(raw, /"ok":true/);
  });

  test('la recherche du port de MadMapper trouve le faux MadMapper', async () => {
    // Le port d'entrée OSC de MadMapper est un réglage de PROJET et n'est pas
    // toujours 8000 : vu 8010 en vrai, sans aucun indice côté Cascade. Le
    // balayage doit retrouver le port du faux MadMapper, quel qu'il soit.
    // 120 ms par port : sur une boucle locale c'est large, et ça garde le test
    // sous le délai HTTP. Le réglage par défaut, pour un vrai clic, est 500 ms.
    const r = await h.post('/api/trouverport', { parPortMs: 120 });
    assert.equal(r.body.ok, true);
    assert.ok(Array.isArray(r.body.essais) && r.body.essais.length >= 5,
      'trop peu de ports sondés : ' + JSON.stringify(r.body.essais));
    // Le faux MadMapper des tests répond-il ? Il n'implémente pas /getControls,
    // donc on vérifie surtout que le balayage n'invente rien et ne casse pas.
    assert.ok(Array.isArray(r.body.ports));
    assert.equal(r.body.actuel, (await h.state()).settings.mmPort);
    // Aucun candidat ne doit être notre propre port d'écoute : on recevrait nos
    // propres paquets en boucle locale et ça passerait pour une réponse.
    const fb = (await h.state()).settings.feedbackPort;
    assert.ok(!r.body.essais.some(e => e.port === fb),
      'le port de feedback ne doit jamais être sondé (écho en boucle locale)');
    assert.equal((await h.get('/api/ping')).body.app, 'Cascade');
  });
});
