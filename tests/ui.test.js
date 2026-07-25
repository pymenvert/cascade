'use strict';
/**
 * Interface — dans un VRAI navigateur.
 *
 * Ces tests chargent la page dans Chrome ou Edge et la manipulent comme un
 * utilisateur : ils attrapent ce que les tests serveur ne peuvent pas voir —
 * une erreur JavaScript au chargement, un bouton qui ne fait rien, du HTML
 * injecté par un nom de fixture.
 *
 * Sans navigateur installé, la suite s'annonce ignorée au lieu d'échouer.
 */
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert');
const { start, sleep, fixtures } = require('./helpers.js');
const { launch, findBrowser } = require('./browser.js');

const AUCUN_NAVIGATEUR = !findBrowser();

describe('Interface dans un vrai navigateur', { skip: AUCUN_NAVIGATEUR &&
  'aucun navigateur Chrome/Edge/Chromium trouvé sur cette machine' }, () => {
  let h, nav;

  before(async () => {
    h = await start();
    await h.post('/api/fixtures', { fixtures: fixtures(6) });
    nav = await launch();
    if (!nav) throw new Error('le navigateur n’a pas démarré');
    await nav.goto('http://127.0.0.1:' + h.port + '/');
  });
  after(async () => {
    if (nav) await nav.close();
    if (h) await h.stop();
  });

  /** Force plusieurs cycles de rafraîchissement de l'interface. */
  const rafraichir = (n = 4) => nav.evaluate(
    `for (let i = 0; i < ${n}; i++) { await poll(); await new Promise(r => setTimeout(r, 60)); } return 1`);

  test('la page se charge sans la moindre erreur', async () => {
    assert.deepEqual(nav.erreurs(), [], 'erreurs au chargement');
    const pret = await nav.evaluate(
      'return { S: typeof S, poll: typeof poll, render: typeof render, barres: document.querySelectorAll("#stage .bar").length }');
    assert.equal(pret.S, 'object', 'l’état serveur doit être chargé');
    assert.equal(pret.poll, 'function');
    assert.equal(pret.render, 'function');
    assert.equal(pret.barres, 6, 'les 6 barres doivent être dessinées');
  });

  test('START et STOP depuis les vrais boutons', async () => {
    await nav.evaluate('document.querySelector("#btnStart").click(); return 1');
    await sleep(300);
    assert.equal((await h.state()).global.running, true, 'le bouton START doit lancer le show');
    await rafraichir();
    const marque = await nav.evaluate('return document.body.classList.contains("running")');
    assert.equal(marque, true, 'l’interface doit signaler le show en cours');

    await nav.evaluate('document.querySelector("#btnStop").click(); return 1');
    await sleep(300);
    assert.equal((await h.state()).global.running, false);
    assert.deepEqual(nav.erreurs(), []);
  });

  test('les raccourcis clavier agissent vraiment', async () => {
    const touche = (code, key) => nav.evaluate(
      `document.dispatchEvent(new KeyboardEvent('keydown', { code: '${code}', key: '${key}', bubbles: true })); return 1`);
    await touche('KeyS', 's');
    await sleep(300);
    assert.equal((await h.state()).global.running, true, 'S doit démarrer');
    await touche('KeyB', 'b');
    await sleep(300);
    assert.equal((await h.state()).global.running, false, 'B doit faire un blackout');

    // …mais pas pendant une saisie
    await nav.evaluate(`
      const i = document.createElement('input'); document.body.appendChild(i); i.focus();
      i.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyS', key: 's', bubbles: true }));
      i.remove(); return 1`);
    await sleep(300);
    assert.equal((await h.state()).global.running, false, 'un raccourci ne doit pas partir en pleine saisie');
    assert.deepEqual(nav.erreurs(), []);
  });

  test('l’aide s’ouvre et se ferme', async () => {
    await nav.evaluate('document.querySelector("#btnAide").click(); return 1');
    const ouverte = await nav.evaluate('return document.querySelector("#dlgAide").open');
    assert.equal(ouverte, true);
    const lignes = await nav.evaluate('return document.querySelectorAll("#dlgAide table.aide tr").length');
    assert.ok(lignes >= 10, 'l’aide doit lister les raccourcis, vu ' + lignes + ' lignes');
    await nav.evaluate('document.querySelector("#aideClose").click(); return 1');
    assert.equal(await nav.evaluate('return document.querySelector("#dlgAide").open'), false);
  });

  test('le QR code se génère et encode la bonne adresse', async () => {
    const r = await nav.evaluate(`
      if (document.querySelector("#btnQR").disabled) return { ignore: true };
      document.querySelector("#btnQR").click();
      await new Promise(r => setTimeout(r, 200));
      const svg = document.querySelector("#qrBox svg");
      const out = { ouvert: document.querySelector("#dlgQR").open, url: document.querySelector("#qrUrl").textContent,
                    svg: !!svg, modules: svg ? svg.querySelector("path").getAttribute("d").length : 0 };
      document.querySelector("#qrClose").click();
      return out;`);
    if (r.ignore) return; // machine sans adresse réseau
    assert.equal(r.ouvert, true);
    assert.match(r.url, /^http:\/\/\d+\.\d+\.\d+\.\d+:\d+$/, 'une adresse LAN est attendue');
    assert.equal(r.svg, true, 'le QR doit être dessiné');
    assert.ok(r.modules > 500, 'le QR semble vide');
  });

  test('un nom hostile ne peut pas injecter de HTML', async () => {
    await h.post('/api/fixtures', { fixtures: [
      { id: 'x1', name: '<img src=q onerror="window.__pwn=1">', address: '/fixtures/a', enabled: true, x: 0.2, y: 0.5 },
      { id: 'x2', name: '"><svg onload="window.__pwn=2">', address: '/fixtures/b', enabled: true, x: 0.8, y: 0.5 },
    ] });
    const id = (await h.state()).layers[0].id;
    await h.post('/api/layer', { id, set: { name: '<img src=q onerror="window.__pwn=3">' } });
    await h.post('/api/project', { name: '<b onmouseover="window.__pwn=4">x' });
    await h.post('/api/groups', { action: 'add', name: '<img src=q onerror="window.__pwn=5">' });
    await rafraichir(6);
    await sleep(400);
    const r = await nav.evaluate(`return {
      pwn: window.__pwn || null,
      balises: document.querySelectorAll('#fixtures img, #fixtures svg, #layerChips img, #layerChips svg,'
        + ' #stage img, #stage svg, #groupChips img, #groupChips svg').length,
      nomAffiche: (document.querySelector('#fixtures .name') || {}).textContent || '',
    }`);
    assert.equal(r.pwn, null, 'du code injecté s’est exécuté');
    assert.equal(r.balises, 0, 'des balises ont été injectées dans la page');
    assert.match(r.nomAffiche, /^<img/, 'le nom doit s’afficher comme du texte');
    assert.deepEqual(nav.erreurs(), []);
    await h.post('/api/fixtures', { fixtures: fixtures(6) });
    for (const g of (await h.state()).groups) await h.post('/api/groups', { action: 'remove', id: g.id });
  });

  test('groupes : créer, remplir depuis la vue, et une couche qui suit', async () => {
    const r = await h.post('/api/groups', { action: 'add', name: 'Sol' });
    const gid = r.body.groups[0].id;
    await rafraichir();
    // Entrer en édition du groupe, puis « cliquer » deux barres
    const etat = await nav.evaluate(`
      assignMode = { type: 'group', id: ${JSON.stringify(gid)} };
      document.querySelector('#groupChips').dataset.sig = '';
      render();
      toggleAssign('f1');
      await new Promise(r => setTimeout(r, 200));
      toggleAssign('f3');
      await new Promise(r => setTimeout(r, 250));
      await poll();
      return { indice: document.querySelector('#assignHint').textContent,
               chips: document.querySelectorAll('#groupChips .chip').length };`);
    assert.match(etat.indice, /CHOIX DES BARRES/, 'la vue doit annoncer le mode');
    assert.equal(etat.chips, 1);
    const g = (await h.state()).groups[0];
    assert.deepEqual(g.bars.sort(), ['f1', 'f3'], 'les clics doivent remplir le groupe');

    // La couche suit le groupe via le sélecteur
    await nav.evaluate(`
      assignMode = null;
      const s = document.querySelector('#layerBars');
      s.value = 'g:' + ${JSON.stringify(gid)};
      s.dispatchEvent(new Event('change'));
      await new Promise(r => setTimeout(r, 350));
      return 1`);
    await sleep(300);
    assert.equal((await h.state()).layers[0].groupId, gid, 'la couche doit suivre le groupe');
    assert.deepEqual(nav.erreurs(), []);
    await h.post('/api/groups', { action: 'remove', id: gid });
  });

  test('le repli « Groove » signale les réglages actifs', async () => {
    const id = (await h.state()).layers[0].id;
    await h.post('/api/layer', { id, set: { swing: 0, blocks: 1, floor: 0, sparkle: 0, phase: 0, oneShot: false } });
    await rafraichir();
    assert.equal(await nav.evaluate('return document.querySelector("#grooveBadge").textContent'), '');
    await h.post('/api/layer', { id, set: { swing: 30, floor: 0.2 } });
    await rafraichir();
    const badge = await nav.evaluate(
      'return { texte: document.querySelector("#grooveBadge").textContent, titre: document.querySelector("#grooveBadge").title }');
    assert.equal(badge.texte, '2 actifs');
    assert.match(badge.titre, /swing/);
    await h.post('/api/layer', { id, set: { swing: 0, floor: 0 } });
  });

  test('le fondu entre presets se voit dans l’interface', async () => {
    const id = (await h.state()).layers[0].id;
    await h.post('/api/layer', { id, set: { pattern: 'all', mode: 'onoff', width: 8, level: 1, groupId: null, bars: null } });
    await h.post('/api/preset', { action: 'save', slot: 0, name: 'Plein' });
    await h.post('/api/layer', { id, set: { level: 0 } });
    await h.post('/api/preset', { action: 'save', slot: 1, name: 'Noir' });
    await h.post('/api/global', { presetFade: 2500 });
    await h.post('/api/preset', { action: 'recall', slot: 0 });
    await h.post('/api/start');
    await sleep(300);
    await h.post('/api/preset', { action: 'recall', slot: 1 });
    await sleep(900);
    const vu = await nav.evaluate(`
      await poll();
      const pr = document.querySelector('#presets');
      return { classe: pr.classList.contains('fading'),
               filet: pr.style.getPropertyValue('--fade'),
               fade: S.fade };`);
    await h.post('/api/stop');
    await h.post('/api/global', { presetFade: 0 });
    assert.equal(vu.classe, true, 'la barre de presets doit signaler le fondu');
    assert.ok(parseFloat(vu.filet) > 5 && parseFloat(vu.filet) < 95,
      'le filet doit être à mi-course, vu ' + vu.filet);
    assert.deepEqual(nav.erreurs(), []);
  });

  test('les presets nommés s’affichent avec leur nom', async () => {
    await rafraichir();
    const slots = await nav.evaluate(`
      return [...document.querySelectorAll('#presets button.slot')].slice(0, 2)
        .map(b => ({ texte: b.textContent, nomme: b.classList.contains('named') }));`);
    assert.equal(slots[0].texte, '1Plein');
    assert.equal(slots[0].nomme, true);
    assert.equal(slots[1].texte, '2Noir');
    for (const s of [0, 1]) await h.post('/api/preset', { action: 'clear', slot: s });
  });

  test('l’accueil disparaît dès qu’il y a des barres, et revient sans', async () => {
    await rafraichir();
    const visible = () => nav.evaluate(
      'return getComputedStyle(document.querySelector("#accueil")).display !== "none"');
    assert.equal(await visible(), false, 'avec des barres, l’accueil doit être masqué');
    await h.post('/api/fixtures', { fixtures: [] });
    await rafraichir();
    assert.equal(await visible(), true, 'sans barre, l’accueil doit revenir');
    await h.post('/api/fixtures', { fixtures: fixtures(6) });
    await rafraichir();
  });

  test('le panneau Link n’apparaît que quand Link est actif', async () => {
    await rafraichir();
    const cache = await nav.evaluate(
      'return getComputedStyle(document.querySelector("#linkPhaseBox")).display');
    assert.equal(cache, 'none', 'sans Link, le réglage de phase n’a rien à faire là');
  });

  test('le témoin de mesure se dessine avec le bon nombre de temps', async () => {
    // On simule un état Link plutôt que de lancer un Carabiner : ce qui est
    // testé ici, c'est le rendu, pas la liaison (couverte par link.test.js).
    const r = await nav.evaluate(`
      S.link = { active: true, connected: true, bpm: 120, peers: 1,
                 phaseOn: true, quantum: 4, locked: true, phase: 0.55 };
      render();
      const pts = [...document.querySelectorAll('#beats .bt')];
      return { visible: getComputedStyle(document.querySelector('#linkPhaseBox')).display !== 'none',
               points: pts.length,
               fort: pts[0].classList.contains('fort'),
               allume: pts.findIndex(d => d.classList.contains('on')),
               verrou: document.querySelector('#linkLock').textContent,
               caseCochee: document.querySelector('#linkPhase').checked };`);
    assert.equal(r.visible, true);
    assert.equal(r.points, 4, 'une mesure à 4 temps → 4 points');
    assert.equal(r.fort, true, 'le premier point doit être marqué comme temps fort');
    assert.equal(r.allume, 2, 'à 55 % de la mesure, on est sur le 3e temps');
    assert.match(r.verrou, /calé sur la grille/);
    assert.equal(r.caseCochee, true);

    const r3 = await nav.evaluate(`
      S.link = { active: true, connected: true, bpm: 120, peers: 1,
                 phaseOn: false, quantum: 3, locked: false, phase: null };
      render();
      return { points: document.querySelectorAll('#beats .bt').length,
               allume: [...document.querySelectorAll('#beats .bt')].filter(d => d.classList.contains('on')).length,
               verrou: document.querySelector('#linkLock').textContent };`);
    assert.equal(r3.points, 3, 'une valse → 3 points');
    assert.equal(r3.allume, 0, 'sans phase connue, aucun point allumé');
    assert.match(r3.verrou, /tempo seul/);
    assert.deepEqual(nav.erreurs(), []);
    await nav.evaluate('await poll(); return 1'); // on rend la main au vrai état
  });

  test('aucune erreur JavaScript sur l’ensemble de la session', () => {
    assert.deepEqual(nav.erreurs(), [], 'erreurs accumulées pendant les tests');
  });
});
