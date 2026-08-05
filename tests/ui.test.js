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

  test('les presets forment une grille de 16 pavés, avec l’empreinte des barres', async () => {
    const id = (await h.state()).layers[0].id;
    const bars = (await h.state()).fixtures.slice(0, 2).map(f => f.id);
    await h.post('/api/layer', { id, set: { target: 'color', colorA: '#00ff00', bars, enabled: true } });
    await h.post('/api/preset', { action: 'save', slot: 4, name: 'Vert' });
    await rafraichir();
    const vu = await nav.evaluate(`
      await poll();
      const pr = document.querySelector('#presets');
      const pads = [...pr.querySelectorAll('button.slot')];
      const p4 = pads[4];
      return { n: pads.length,
               affichage: getComputedStyle(pr).display,
               hauteur: p4.getBoundingClientRect().height,
               cases: p4.querySelectorAll('.emp i').length,
               peintes: [...p4.querySelectorAll('.emp i')]
                 .filter(c => c.style.background).length,
               texte: p4.textContent };`);
    assert.equal(vu.n, 16, 'les 16 slots sont là');
    assert.equal(vu.affichage, 'grid', '#presets doit être une grille');
    assert.ok(vu.hauteur >= 50, 'un pavé doit être cliquable au doigt, vu ' + vu.hauteur);
    assert.equal(vu.cases, 6, 'une case par barre du plateau');
    assert.equal(vu.peintes, 2, 'seules les deux barres pilotées sont peintes');
    // L'empreinte ne doit ajouter AUCUN texte : le contrat « 5Vert » tient.
    assert.equal(vu.texte, '5Vert', 'l’empreinte ne doit rien écrire dans le pavé');
    assert.deepEqual(nav.erreurs(), []);
    await h.post('/api/preset', { action: 'clear', slot: 4 });
  });

  test('le pavé qui joue se voit, et celui d’où l’on vient pendant un fondu', async () => {
    await h.post('/api/preset', { action: 'save', slot: 6, name: 'Un' });
    await h.post('/api/preset', { action: 'save', slot: 7, name: 'Deux' });
    await h.post('/api/preset', { action: 'recall', slot: 6 });
    await rafraichir();
    const seul = await nav.evaluate(`
      await poll();
      return [...document.querySelectorAll('#presets button.slot')]
        .map((b, i) => b.classList.contains('joue') ? i : -1).filter(i => i >= 0);`);
    assert.deepEqual(seul, [6], 'un seul pavé joue, et c’est le bon');

    await h.post('/api/global', { presetFade: 2500 });
    await h.post('/api/start');
    await h.post('/api/preset', { action: 'recall', slot: 7 });
    await sleep(400);
    const pendant = await nav.evaluate(`
      await poll();
      const pads = [...document.querySelectorAll('#presets button.slot')];
      return { joue: pads.findIndex(b => b.classList.contains('joue')),
               sortante: pads.findIndex(b => b.classList.contains('sortante')) };`);
    await h.post('/api/stop');
    await h.post('/api/global', { presetFade: 0 });
    assert.equal(pendant.joue, 7, 'le pavé entrant');
    assert.equal(pendant.sortante, 6, 'le pavé sortant, pendant le fondu');
    assert.deepEqual(nav.erreurs(), []);
    for (const s of [6, 7]) await h.post('/api/preset', { action: 'clear', slot: s });
  });

  test('un preset qui ne pilote plus aucune barre le DIT', async () => {
    const id = (await h.state()).layers[0].id;
    // Une couche restreinte à une barre qui n'existe pas : plus rien à piloter.
    await h.post('/api/layer', { id, set: { bars: ['fantome'], groupId: null } });
    await h.post('/api/preset', { action: 'save', slot: 8, name: 'Vide' });
    await rafraichir();
    const vu = await nav.evaluate(`
      await poll();
      const b = document.querySelectorAll('#presets button.slot')[8];
      return { muet: b.classList.contains('muet'), title: b.title };`);
    assert.equal(vu.muet, true, 'le pavé doit être marqué, pas masqué');
    assert.match(vu.title, /aucune barre/, 'et l’infobulle doit le dire');
    assert.deepEqual(nav.erreurs(), []);
    await h.post('/api/layer', { id, set: { bars: null } });
    await h.post('/api/preset', { action: 'clear', slot: 8 });
  });

  test('un nom de preset hostile ne peut pas injecter de HTML dans la grille', async () => {
    await h.post('/api/preset', { action: 'save', slot: 10, name: '"><svg onload=1>' });
    await rafraichir();
    const vu = await nav.evaluate(`
      await poll();
      const pr = document.querySelector('#presets');
      const b = pr.querySelectorAll('button.slot')[10];
      return { pwn: window.__pwn === undefined ? null : window.__pwn,
               balises: pr.querySelectorAll('svg, img, script').length,
               texte: b.textContent };`);
    assert.equal(vu.pwn, null, 'aucun script ne doit s’exécuter');
    assert.equal(vu.balises, 0, 'aucune balise injectée dans la grille');
    assert.match(vu.texte, /svg onload/, 'le nom s’affiche comme du TEXTE');
    assert.deepEqual(nav.erreurs(), []);
    await h.post('/api/preset', { action: 'clear', slot: 10 });
  });

  test('si les empreintes ne se chargent pas, la grille reste utilisable', async () => {
    await h.post('/api/preset', { action: 'save', slot: 12, name: 'Sans' });
    const vu = await nav.evaluate(`
      const vrai = window.fetch;
      window.fetch = (u, o) => String(u).includes('/api/presets-info')
        ? Promise.reject(new Error('coupé')) : vrai(u, o);
      infosPresets = null; infoRev = -1;
      for (let i = 0; i < 6; i++) { await poll(); await new Promise(r => setTimeout(r, 60)); }
      window.fetch = vrai;
      const pads = [...document.querySelectorAll('#presets button.slot')];
      return { n: pads.length, emp: document.querySelectorAll('#presets .emp').length,
               texte: pads[12].textContent };`);
    assert.equal(vu.n, 16, 'les 16 pavés restent là');
    assert.equal(vu.emp, 0, 'simplement sans empreinte');
    assert.equal(vu.texte, '13Sans', 'et toujours lisibles');
    // Le point qui compte : une empreinte manquante ne fait pas de bruit.
    assert.deepEqual(nav.erreurs(), []);
    await h.post('/api/preset', { action: 'clear', slot: 12 });
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

  // ── Page Scène 3D ──────────────────────────────────────────────────────
  test('la bascule entre les deux pages fonctionne', async () => {
    const etat = await nav.evaluate(`
      const lire = () => ({
        conduite: getComputedStyle(document.querySelector('#pageConduite')).display !== 'none',
        scene: getComputedStyle(document.querySelector('#pageScene')).display !== 'none',
      });
      const depart = lire();
      document.querySelector('#pages button[data-page="scene"]').click();
      await new Promise(r => setTimeout(r, 200));
      const surScene = lire();
      document.querySelector('#pages button[data-page="conduite"]').click();
      await new Promise(r => setTimeout(r, 150));
      return { depart, surScene, retour: lire(),
               transportVisible: !!document.querySelector('#btnStart').offsetParent };`);
    assert.deepEqual(etat.depart, { conduite: true, scene: false }, 'on démarre sur la conduite');
    assert.deepEqual(etat.surScene, { conduite: false, scene: true });
    assert.deepEqual(etat.retour, { conduite: true, scene: false });
    assert.equal(etat.transportVisible, true, 'START doit rester atteignable sur les deux pages');
    assert.deepEqual(nav.erreurs(), []);
  });

  test('la vue 3D dessine les barres et sait dire laquelle est sous le curseur', async () => {
    const r = await nav.evaluate(`
      document.querySelector('#pages button[data-page="scene"]').click();
      await new Promise(r => setTimeout(r, 350));
      const cv = document.querySelector('#cv3d');
      const px = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
      let peints = 0;
      for (let i = 3; i < px.length; i += 4) if (px[i] > 8) peints++;
      // On vise le milieu d'une barre connue
      const v = vue3dGeom();
      const f = S.fixtures[2];
      const [A, B] = boutsDe(f);
      const a = projeter(A, v), b = projeter(B, v);
      const sous = barreSous((a.x + b.x) / 2, (a.y + b.y) / 2);
      return { peints, largeur: cv.width, attendue: f.name, trouvee: sous ? sous.name : null,
               info: document.querySelector('#vue3dInfo').textContent };`);
    assert.ok(r.largeur > 100, 'le canvas doit être dimensionné');
    assert.ok(r.peints > 500, 'la vue semble vide : ' + r.peints + ' pixels peints');
    assert.equal(r.trouvee, r.attendue, 'le pointage doit retrouver la barre visée');
    assert.match(r.info, /plateau .* m · \d+ barres?/);
    assert.deepEqual(nav.erreurs(), []);
  });

  test('la vue de face est orthographique — elle coïncide avec la page Conduite', async () => {
    // Deux barres au même endroit en largeur, à des profondeurs différentes :
    // de face elles doivent se superposer exactement, de dessus se séparer.
    await h.post('/api/fixtures', { fixtures: [
      { id: 'p1', name: 'Proche', address: '/fixtures/p1', enabled: true, x: 0.5, y: 0.5, rot: 0 },
      { id: 'p2', name: 'Loin', address: '/fixtures/p2', enabled: true, x: 0.5, y: 0.5, rot: 0 },
    ] });
    await h.post('/api/fixture3d', { id: 'p2', p3: [0, 3, 3] });
    await rafraichir();
    const r = await nav.evaluate(`
      const pos = (vue) => {
        document.querySelector('#vue3dCam button[data-vue="' + vue + '"]').click();
        const v = vue3dGeom();
        return S.fixtures.map(f => { const p = projeter(f.p3, v); return [Math.round(p.x), Math.round(p.y)]; });
      };
      const face = pos('face'), dessus = pos('dessus');
      document.querySelector('#vue3dCam button[data-vue="troisquart"]').click();
      return { faceMemeX: face[0][0] === face[1][0],
               dessusSepare: Math.abs(dessus[0][1] - dessus[1][1]) > 20 };`);
    assert.equal(r.faceMemeX, true,
      'de face, la profondeur ne doit rien décaler — sinon la vue ne vaut plus la page Conduite');
    assert.equal(r.dessusSepare, true, 'de dessus, la profondeur doit se voir');
    await h.post('/api/fixtures', { fixtures: fixtures(6) });
    await rafraichir();
  });

  test('la sélection est commune aux deux pages', async () => {
    const r = await nav.evaluate(`
      document.querySelector('#pages button[data-page="scene"]').click();
      await new Promise(r => setTimeout(r, 250));
      const cible = S.fixtures[3];
      selBar = cible.id; renderSel3d();
      await new Promise(r => setTimeout(r, 150));
      const panneau = document.querySelector('#sel3d').textContent;
      const champs = [...document.querySelectorAll('#sel3d input[type=number]')].length;
      const inverse = !!document.querySelector('#sel3d input[type=checkbox]');
      document.querySelector('#pages button[data-page="conduite"]').click();
      for (let i = 0; i < 4; i++) { await poll(); await new Promise(r => setTimeout(r, 60)); }
      const marquee = document.querySelector('#stage .bar.sel3d');
      return { nom: cible.name, panneauNomme: panneau.startsWith(cible.name),
               champs, inverse, marqueeEn2D: marquee ? marquee.dataset.id : null, attendu: cible.id };`);
    assert.equal(r.panneauNomme, true, 'le panneau doit nommer la barre sélectionnée');
    // On compte les champs NUMÉRIQUES : X, profondeur, hauteur, longueur, angle.
    // Compter tous les `input` cassait dès qu'on ajoutait une case à cocher.
    assert.equal(r.champs, 5, 'X, profondeur, hauteur, longueur, angle');
    assert.equal(r.inverse, true, 'la case « inverser la LED » doit être là');
    assert.equal(r.marqueeEn2D, r.attendu, 'la vue 2D doit marquer la même barre');
    assert.deepEqual(nav.erreurs(), []);
  });

  test('modifier une coordonnée en mètres déplace la barre dans les deux vues', async () => {
    const r = await nav.evaluate(`
      document.querySelector('#pages button[data-page="scene"]').click();
      await new Promise(r => setTimeout(r, 200));
      const id = S.fixtures[3].id;
      selBar = id; renderSel3d();
      await new Promise(r => setTimeout(r, 150));
      const champHauteur = [...document.querySelectorAll('#sel3d input')][2];
      champHauteur.value = '4.5';
      champHauteur.dispatchEvent(new Event('change'));
      await new Promise(r => setTimeout(r, 500));
      for (let i = 0; i < 4; i++) { await poll(); await new Promise(r => setTimeout(r, 60)); }
      const f = S.fixtures.find(x => x.id === id);
      return { z: f.p3[2], y2d: f.y, h: S.scene.h };`);
    assert.ok(Math.abs(r.z - 4.5) < 0.01, 'la hauteur en mètres doit être posée, vue ' + r.z);
    assert.ok(Math.abs(r.y2d - (1 - 4.5 / r.h)) < 0.01,
      'la position 2D doit être recalculée depuis la 3D, vue ' + r.y2d);
    assert.deepEqual(nav.erreurs(), []);
  });

  test('changer les cotes du plateau ne déplace aucune barre en mètres', async () => {
    const r = await nav.evaluate(`
      document.querySelector('#pages button[data-page="scene"]').click();
      await new Promise(r => setTimeout(r, 200));
      const avant = S.fixtures.map(f => f.p3.slice());
      const champ = document.querySelector('#scW');
      champ.value = '20'; champ.dispatchEvent(new Event('change'));
      await new Promise(r => setTimeout(r, 500));
      for (let i = 0; i < 4; i++) { await poll(); await new Promise(r => setTimeout(r, 60)); }
      const apres = S.fixtures.map(f => f.p3.slice());
      return { identiques: JSON.stringify(avant) === JSON.stringify(apres), largeur: S.scene.w };`);
    assert.equal(r.largeur, 20);
    assert.equal(r.identiques, true, 'élargir le plateau ne doit pas déplacer les barres');
    await h.post('/api/scene', { scene: { w: 10, d: 8, h: 6 } });
    await rafraichir();
  });

  // ── Déplacer une barre à la souris, pour de vrai ───────────────────────
  // Ces tests injectent de vrais événements de souris par CDP : c'est la seule
  // façon de vérifier le geste complet, capture du pointeur comprise.

  /** Position à l'écran du centre d'une barre, et la géométrie de la vue. */
  const reperer = (id) => nav.evaluate(`
    document.querySelector('#pages button[data-page="scene"]').click();
    await new Promise(r => setTimeout(r, 250));
    // ⚠ CDP place la souris en coordonnées de FENÊTRE. Si la page est restée
    // défilée par un test précédent, le haut du canevas passe au-dessus du bord
    // et le clic part dans le vide : aucun événement, aucune explication.
    window.scrollTo(0, 0);
    document.querySelector('#vue3d').scrollIntoView({ block: 'center' });
    await new Promise(r => setTimeout(r, 150));
    const f = S.fixtures.find(x => x.id === ${JSON.stringify(id)});
    if (!f) return null;
    const vue = vue3dGeom();
    const p = projeter(f.p3, vue);
    const r = document.querySelector('#cv3d').getBoundingClientRect();
    return { x: r.left + p.x, y: r.top + p.y, p3: f.p3.slice(), dir3: f.dir3.slice(),
             ech: p.ech, vue: { w: vue.w, h: vue.h } };`);

  test('glisser une barre la déplace vraiment, et Ctrl+Z le défait', async () => {
    await h.post('/api/fixtures', { fixtures: [
      { id: 'd1', name: 'Sol jardin', address: '/fixtures/d1', enabled: true, x: 0.3, y: 0.5 },
      { id: 'd2', name: 'Sol cour', address: '/fixtures/d2', enabled: true, x: 0.7, y: 0.5 },
    ] });
    // Vue de dessus : l'écran est le plan du sol, le geste est sans ambiguïté.
    await nav.evaluate(`document.querySelector('#vue3dCam button[data-vue="dessus"]').click();
                        await new Promise(r => setTimeout(r, 150)); return 1`);
    const av = await reperer('d1');
    assert.ok(av, 'la barre d1 doit être visible');

    await nav.glisser(av.x, av.y, av.x + 90, av.y - 60);
    await sleep(300);
    const f = (await h.state()).fixtures.find(x => x.id === 'd1');

    // Vue de dessus : droite = jardin→cour (X croît), haut = vers le lointain
    // (Y croît). La hauteur, elle, ne doit pas bouger d'un millimètre.
    assert.ok(f.p3[0] > av.p3[0] + 0.2,
      'la barre devait partir vers la cour : ' + av.p3 + ' → ' + f.p3);
    assert.ok(f.p3[1] > av.p3[1] + 0.2,
      'la barre devait partir vers le lointain : ' + av.p3 + ' → ' + f.p3);
    assert.ok(Math.abs(f.p3[2] - av.p3[2]) < 0.001,
      'un glissé simple ne doit pas changer la hauteur : ' + f.p3[2]);
    // Le déplacement tombe sur la grille de 5 cm
    for (const v of f.p3) assert.ok(Math.abs(v * 20 - Math.round(v * 20)) < 1e-6,
      'position hors grille de 5 cm : ' + f.p3);
    // L'autre barre n'a pas bougé
    const autre = (await h.state()).fixtures.find(x => x.id === 'd2');
    assert.deepEqual(autre.p3, [(0.7 - 0.5) * 10, 0, (1 - 0.5) * 6],
      'seule la barre saisie doit bouger');

    // Ctrl+Z remet la barre où elle était
    await nav.evaluate(`document.dispatchEvent(new KeyboardEvent('keydown',
      { code: 'KeyZ', key: 'z', ctrlKey: true, bubbles: true })); return 1`);
    await sleep(400);
    const apres = (await h.state()).fixtures.find(x => x.id === 'd1');
    assert.deepEqual(apres.p3, av.p3, 'Ctrl+Z doit rendre la position d’avant');
    assert.deepEqual(nav.erreurs(), []);
  });

  test('Maj+glisser ne change que la hauteur', async () => {
    const av = await reperer('d1');
    await nav.glisser(av.x, av.y, av.x + 80, av.y - 70, { modifiers: 8 });  // 8 = Maj
    await sleep(300);
    const f = (await h.state()).fixtures.find(x => x.id === 'd1');
    assert.ok(f.p3[2] > av.p3[2] + 0.2, 'la barre devait monter : ' + av.p3 + ' → ' + f.p3);
    assert.ok(Math.abs(f.p3[0] - av.p3[0]) < 0.001 && Math.abs(f.p3[1] - av.p3[1]) < 0.001,
      'Maj ne doit pas déplacer au sol : ' + av.p3 + ' → ' + f.p3);
    assert.deepEqual(nav.erreurs(), []);
  });

  test('Alt+glisser oriente la barre sans la déplacer', async () => {
    const av = await reperer('d1');
    await nav.glisser(av.x, av.y, av.x + 100, av.y, { modifiers: 1 });      // 1 = Alt
    await sleep(300);
    const f = (await h.state()).fixtures.find(x => x.id === 'd1');
    assert.deepEqual(f.p3, av.p3, 'Alt ne doit pas déplacer la barre');
    const ecart = Math.hypot(f.dir3[0] - av.dir3[0], f.dir3[1] - av.dir3[1], f.dir3[2] - av.dir3[2]);
    assert.ok(ecart > 0.05, 'la direction devait changer : ' + av.dir3 + ' → ' + f.dir3);
    // Toujours un vecteur unitaire — sinon la longueur de la barre dérive
    assert.ok(Math.abs(Math.hypot(...f.dir3) - 1) < 1e-6, 'direction non normalisée : ' + f.dir3);
    assert.deepEqual(nav.erreurs(), []);
  });

  test('glisser le vide tourne la vue au lieu de déplacer quoi que ce soit', async () => {
    const av = await reperer('d1');
    const avant = (await h.state()).fixtures.map(f => f.p3.slice());
    // Un coin de la vue, loin de toute barre
    const coin = await nav.evaluate(`
      window.scrollTo(0, 0);
      document.querySelector('#vue3d').scrollIntoView({ block: 'center' });
      await new Promise(r => setTimeout(r, 150));
      const r = document.querySelector('#cv3d').getBoundingClientRect();
      return { x: r.left + 18, y: r.top + 18, az: cam.az, haut: r.top };`);
    assert.ok(coin.haut >= 0 && coin.y > 0,
      'le canevas doit être visible pour qu’un clic l’atteigne, haut = ' + coin.haut);
    await nav.glisser(coin.x, coin.y, coin.x + 120, coin.y + 20);
    await sleep(250);
    const apres = (await h.state()).fixtures.map(f => f.p3.slice());
    assert.deepEqual(apres, avant, 'aucune barre ne doit bouger');
    const az = await nav.evaluate('return cam.az');
    assert.notEqual(az, coin.az, 'la caméra devait tourner');
    assert.ok(av, 'garde-fou');
    assert.deepEqual(nav.erreurs(), []);
  });

  test('le bouton d’envoi vers MadMapper demande confirmation, et n’envoie rien si on refuse', async () => {
    h.clearOsc();
    // Refus
    await nav.evaluate(`window.confirm = () => false;
      document.querySelector('#btnGeom').click();
      await new Promise(r => setTimeout(r, 250)); return 1`);
    await sleep(200);
    assert.deepEqual(h.osc().filter(m => /\/output\//.test(m.address)), [],
      'un refus ne doit rien envoyer');

    // Acceptation
    h.clearOsc();
    const etat = await nav.evaluate(`window.confirm = () => true;
      document.querySelector('#btnGeom').click();
      await new Promise(r => setTimeout(r, 400));
      return document.querySelector('#geomEtat').textContent;`);
    await sleep(200);
    const geo = h.osc().filter(m => /\/output\//.test(m.address));
    assert.ok(geo.length >= 6, 'attendu 3 messages × 2 barres, vu ' + geo.length);
    assert.match(etat, /barre/, 'l’interface doit confirmer l’envoi, vu : ' + etat);
    assert.deepEqual(nav.erreurs(), []);
    await h.post('/api/fixtures', { fixtures: fixtures(6) });
    await rafraichir();
  });

  test('le bouton « Trouver le port » répond sans casser la page', async () => {
    const r = await nav.evaluate(`
      document.querySelector('#pages button[data-page="conduite"]').click();
      await new Promise(r => setTimeout(r, 150));
      document.querySelector('#btnSettings').click();
      await new Promise(r => setTimeout(r, 200));
      const b = document.querySelector('#btnTrouverPort');
      if (!b) return { absent: true };
      b.click();
      const pendant = b.textContent;
      // Le balayage prend quelques secondes : on attend qu'il rende la main.
      for (let i = 0; i < 40 && b.disabled; i++) await new Promise(r => setTimeout(r, 300));
      const out = { pendant, apres: b.textContent, bloque: b.disabled,
                    message: document.querySelector('#portTrouve').textContent };
      document.querySelector('#setCancel').click();
      return out;`);
    assert.ok(!r.absent, 'le bouton doit exister');
    assert.match(r.pendant, /recherche/, 'le bouton doit dire qu’il travaille');
    assert.equal(r.bloque, false, 'le bouton doit se réactiver');
    assert.match(r.apres, /Trouver le port/, 'le libellé doit revenir');
    // Le faux MadMapper des tests ne répond pas à /getControls : le message doit
    // alors AIDER — en rappelant que la réponse arrive sur le port de feedback.
    assert.ok(r.message.length > 10, 'un message doit être affiché, vu : ' + r.message);
    assert.deepEqual(nav.erreurs(), []);
  });

  test('le moteur Champ 3D s’affiche et ne montre que les réglages qui agissent', async () => {
    const r = await nav.evaluate(`
      document.querySelector('#pages button[data-page="conduite"]').click();
      await new Promise(r => setTimeout(r, 150));
      const vu = (sel) => {
        const el = document.querySelector(sel);
        return el ? getComputedStyle(el).display !== 'none' : null;
      };
      const etat = async (forme) => {
        if (forme) { $('#fieldForme').value = forme; $('#fieldForme').dispatchEvent(new Event('change')); }
        await new Promise(r => setTimeout(r, 250));
        await poll();
        return { champ: vu('#fieldCtrls'), vague: vu('#waveCtrls'), motifs: vu('#patterns'),
                 axe: vu('#fieldAxe'), src: vu('#fieldSrc'), pas: vu('#stepCtrls'),
                 swing: vu('#rowSwing'),
                 duty: (() => { const e = document.querySelector('#duty');
                   return e ? getComputedStyle(e.closest('label')).display !== 'none' : null; })() };
      };
      document.querySelector('.seg button[data-eng="field"]').click();
      await new Promise(r => setTimeout(r, 250));
      await poll();
      const out = { plan: await etat(null), sphere: await etat('sphere'),
                    bruit: await etat('bruit'), cylindre: await etat('cylindre') };
      // retour au pas-à-pas
      document.querySelector('.seg button[data-eng="steps"]').click();
      await new Promise(r => setTimeout(r, 250));
      await poll();
      out.steps = await etat(null);
      return out;`);

    assert.equal(r.plan.champ, true, 'les réglages du champ doivent apparaître');
    assert.equal(r.plan.vague, false, 'ceux de la vague doivent disparaître');
    assert.equal(r.plan.motifs, false,
      'la grille de motifs n’agit pas sur le champ : elle doit être masquée');
    assert.equal(r.plan.pas, false);
    assert.equal(r.plan.swing, false, 'le swing ne concerne que le pas-à-pas');

    // Un plan n'utilise pas de source ; une sphère, si.
    assert.equal(r.plan.axe, true, 'le plan a besoin de son axe');
    assert.equal(r.plan.src, false, 'le plan n’a pas de source');
    assert.equal(r.sphere.src, true, 'la sphère a besoin d’une source');
    assert.equal(r.sphere.axe, false, 'la sphère n’utilise pas l’axe');
    assert.equal(r.cylindre.axe, true, 'le cylindre a besoin de l’axe');
    assert.equal(r.cylindre.src, true, 'et de la source');
    // Le bruit utilise l'axe — c'est la direction de sa dérive. Il l'a longtemps
    // utilisé SANS le montrer, ce qui donnait un feu qui descend toujours sans
    // réglage pour l'expliquer. Il n'a en revanche pas de source.
    assert.equal(r.bruit.axe, true, 'le bruit doit montrer l’axe : c’est sa dérive');
    assert.equal(r.bruit.src, false, 'le bruit n’a pas de source');
    // La netteté ne s'applique pas au bruit : il ne traverse pas la forme d'onde.
    assert.equal(r.bruit.duty, false, 'la netteté doit être masquée pour le bruit');
    assert.equal(r.plan.duty, true, 'et visible pour un plan');

    // Et on revient bien au pas-à-pas
    assert.equal(r.steps.champ, false);
    assert.equal(r.steps.pas, true);
    assert.equal(r.steps.motifs, true);
    assert.deepEqual(nav.erreurs(), []);
  });

  test('« Centrer la source » pose le milieu du plateau', async () => {
    await h.post('/api/scene', { scene: { w: 12, d: 9, h: 7 } });
    const r = await nav.evaluate(`
      await poll();
      document.querySelector('.seg button[data-eng="field"]').click();
      await new Promise(r => setTimeout(r, 200));
      $('#fieldForme').value = 'sphere'; $('#fieldForme').dispatchEvent(new Event('change'));
      await new Promise(r => setTimeout(r, 250));
      document.querySelector('#btnSrcCentre').click();
      await new Promise(r => setTimeout(r, 350));
      await poll();
      const L = sel();
      return { x: L.srcX, y: L.srcY, z: L.srcZ };`);
    // X et Y sont centrés sur zéro dans le repère du plateau ; seul Z va de 0 à h.
    assert.equal(r.x, 0, 'X au centre du plateau');
    assert.equal(r.y, 0, 'Y au centre du plateau (et non au bord lointain), vu ' + r.y);
    assert.ok(Math.abs(r.z - 3.5) < 0.01, 'Z à mi-hauteur, vu ' + r.z);
    await h.post('/api/scene', { scene: { w: 10, d: 8, h: 6 } });
    await nav.evaluate(`document.querySelector('.seg button[data-eng="steps"]').click();
                        await new Promise(r => setTimeout(r, 200)); return 1`);
    assert.deepEqual(nav.erreurs(), []);
  });

  test('le panneau Vues : créer, nommer un dossier, activer, marquer « à moi »', async () => {
    await h.post('/api/vues', { vues: [] });
    const r = await nav.evaluate(`
      document.querySelector('#pages button[data-page="scene"]').click();
      await new Promise(r => setTimeout(r, 250));
      await poll();
      const vide = document.querySelector('#vuesListe').textContent;

      document.querySelector('#btnVueAdd').click();
      await new Promise(r => setTimeout(r, 350));
      document.querySelector('#btnVueAdd').click();
      await new Promise(r => setTimeout(r, 350));
      await poll();
      const lignes = document.querySelectorAll('#vuesListe .row').length;

      // On nomme le dossier de la première vue
      const champ = document.querySelector('#vuesListe .row input[type=text]');
      champ.value = 'CASCADE-Face';
      champ.dispatchEvent(new Event('change'));
      await new Promise(r => setTimeout(r, 400));
      await poll();

      // On coche « à moi » sur la deuxième
      const cases = document.querySelectorAll('#vuesListe input[type=checkbox]');
      cases[1].click();
      await new Promise(r => setTimeout(r, 400));
      await poll();

      // Et on active la première
      document.querySelector('#vueFade').value = '0';
      document.querySelectorAll('#vuesListe .row button')[0].click();
      await new Promise(r => setTimeout(r, 400));
      await poll();
      const actif = [...document.querySelectorAll('#vuesListe .row button')]
        .filter(b => b.classList.contains('active')).length;
      return { vide, lignes, actif };`);

    assert.match(r.vide, /Aucune vue/, 'sans vue, le panneau doit expliquer quoi faire');
    assert.equal(r.lignes, 2, 'deux vues déclarées doivent donner deux lignes');
    assert.equal(r.actif, 1, 'une seule vue doit apparaître active');

    const et = await h.state();
    assert.equal(et.vues.length, 2);
    assert.equal(et.vues[0].dossier, 'CASCADE-Face', 'le nom du dossier doit être enregistré');
    assert.equal(et.vues[1].manuelle, true, '« à moi » doit être enregistré');
    assert.equal(et.global.vueActive, et.vues[0].id, 'la première vue doit être active');
    assert.deepEqual(nav.erreurs(), []);
  });

  test('un nom de dossier hostile ne peut pas injecter de HTML', async () => {
    await h.post('/api/vues', { vues: [] });
    await h.post('/api/vues', { action: 'add', name: '<img src=q onerror="window.__pwnv=1">',
      dossier: '"><svg onload="window.__pwnv=2">' });
    const r = await nav.evaluate(`
      document.querySelector('#pages button[data-page="scene"]').click();
      await new Promise(r => setTimeout(r, 200));
      document.querySelector('#vuesListe').dataset.sig = '';
      await poll();
      await new Promise(r => setTimeout(r, 300));
      return { pwn: window.__pwnv || null,
               balises: document.querySelectorAll('#vuesListe img, #vuesListe svg').length,
               texte: (document.querySelector('#vuesListe .row button') || {}).textContent || '' };`);
    assert.equal(r.pwn, null, 'du code injecté s’est exécuté');
    assert.equal(r.balises, 0, 'des balises ont été injectées');
    assert.match(r.texte, /^<img/, 'le nom doit s’afficher comme du texte');
    assert.deepEqual(nav.erreurs(), []);
    await h.post('/api/vues', { vues: [] });
  });

  test('« Vérifier les dossiers » rend la main et dit quelque chose', async () => {
    await h.post('/api/vues', { vues: [] });
    await h.post('/api/vues', { action: 'add', name: 'Face', dossier: 'PasLa' });
    const r = await nav.evaluate(`
      document.querySelector('#pages button[data-page="scene"]').click();
      await new Promise(r => setTimeout(r, 200));
      await poll();
      const b = document.querySelector('#btnVueCheck');
      b.click();
      const pendant = b.textContent;
      for (let i = 0; i < 40 && b.disabled; i++) await new Promise(r => setTimeout(r, 300));
      await new Promise(r => setTimeout(r, 300));
      const voyant = document.querySelector('#vuesListe .row span');
      return { pendant, apres: b.textContent, bloque: b.disabled,
               couleur: voyant ? voyant.style.color : null,
               titre: voyant ? voyant.title : null };`);
    assert.match(r.pendant, /vérification/, 'le bouton doit dire qu’il travaille');
    assert.equal(r.bloque, false, 'le bouton doit se réactiver');
    assert.match(r.apres, /Vérifier/, 'le libellé doit revenir');
    // Le faux MadMapper des tests ne répond pas : le voyant doit donc être rouge
    // et le dire — pas rester ambigu.
    assert.ok(r.titre && /AUCUN dossier/.test(r.titre),
      'le voyant doit annoncer un dossier introuvable, vu : ' + r.titre);
    assert.deepEqual(nav.erreurs(), []);
    await h.post('/api/vues', { vues: [] });
  });

  test('la vue 3D dessine le repère du champ, et seulement quand il sert', async () => {
    // Sans ce repère, régler un azimut ou une source se fait à l'aveugle : les
    // réglages vivent sur la page Conduite alors qu'ils décrivent l'espace.
    // On ne peut pas inspecter un canvas facilement : on compte donc les pixels
    // NON NOIRS d'une bande de l'image, ce qui suffit à voir apparaître le repère.
    await h.post('/api/fixtures', { fixtures: fixtures(4) });
    const r = await nav.evaluate(`
      document.querySelector('#pages button[data-page="scene"]').click();
      await new Promise(r => setTimeout(r, 250));
      const cv = document.querySelector('#cv3d');
      const ctx = cv.getContext('2d');
      const encre = () => {
        const d = ctx.getImageData(0, 0, cv.width, cv.height).data;
        let n = 0;
        for (let i = 0; i < d.length; i += 4) if (d[i] + d[i+1] + d[i+2] > 90) n++;
        return n;
      };
      const dessine = async () => {
        besoinRedessin = true;
        await new Promise(r => requestAnimationFrame(r));
        await new Promise(r => requestAnimationFrame(r));
        await new Promise(r => setTimeout(r, 120));
        return encre();
      };
      // Pas-à-pas : aucun repère
      await setL({ engine: 'steps' });
      await new Promise(r => setTimeout(r, 250));
      await poll();
      const sansChamp = await dessine();
      // Champ en plan : la flèche d'axe apparaît
      await setL({ engine: 'field', field: 'plan', axAz: 45, axEl: 20 });
      await new Promise(r => setTimeout(r, 250));
      await poll();
      const avecAxe = await dessine();
      // Sphère avec une course : la croix de source et sa course apparaissent
      await setL({ field: 'sphere', srcX: 1, srcY: 1, srcZ: 3, course: 8 });
      await new Promise(r => setTimeout(r, 250));
      await poll();
      const avecSource = await dessine();
      await setL({ engine: 'steps', course: 0 });
      await new Promise(r => setTimeout(r, 200));
      await poll();
      return { sansChamp, avecAxe, avecSource, largeur: cv.width };`);

    assert.ok(r.largeur > 0, 'le canevas doit avoir une taille');
    assert.ok(r.avecAxe > r.sansChamp,
      'le repère d’axe doit ajouter de l’encre : ' + r.sansChamp + ' → ' + r.avecAxe);
    assert.ok(r.avecSource > r.sansChamp,
      'la source et sa course doivent se voir : ' + r.sansChamp + ' → ' + r.avecSource);
    assert.deepEqual(nav.erreurs(), []);
  });

  test('la DSP du suiveur audio, sans le moindre micro', async () => {
    // `enveloppeAudio` est PURE : on lui donne un spectre fabriqué à la main.
    // C'est ce qui rend la moitié navigateur vérifiable sans entrée son.
    const vu = await nav.evaluate(`
      const grave = new Uint8Array(256); for (let i = 0; i < 20; i++) grave[i] = 200;
      const rien = new Uint8Array(256);
      const r = { bande: 'grave', gain: 1, seuil: 0.06, attaque: 12, relache: 260 };
      let e = { niveau: 0 }, monte = [];
      for (let i = 0; i < 25; i++) { const o = enveloppeAudio(grave, 16, r, e); e = o.etat; monte.push(o.niveau); }
      const haut = e.niveau;
      let descend = [];
      for (let i = 0; i < 40; i++) { const o = enveloppeAudio(rien, 16, r, e); e = o.etat; descend.push(o.niveau); }
      // Bande aiguë sur un spectre uniquement grave : doit rester à zéro.
      let ea = { niveau: 0 };
      const aigu = enveloppeAudio(grave, 16, { ...r, bande: 'aigu' }, ea).niveau;
      // Sous le seuil : porte de bruit fermée.
      const faible = new Uint8Array(256); for (let i = 0; i < 20; i++) faible[i] = 4;
      const porte = enveloppeAudio(faible, 16, r, { niveau: 0 }).niveau;
      return { haut, bas: e.niveau, croissant: monte[24] > monte[0],
               decroissant: descend[39] < descend[0], aigu, porte,
               borne: monte.concat(descend).every(v => v >= 0 && v <= 1) };`);
    assert.ok(vu.croissant, 'l’enveloppe doit monter avec le son');
    assert.ok(vu.haut > 0.5, 'et atteindre un niveau franc, vu ' + vu.haut);
    assert.ok(vu.decroissant, 'puis redescendre au silence');
    assert.ok(vu.bas < 0.1, 'jusqu’à presque zéro, vu ' + vu.bas);
    assert.equal(vu.aigu, 0, 'la bande aiguë ne doit rien voir d’un son grave');
    assert.equal(vu.porte, 0, 'sous le seuil, la porte de bruit doit fermer');
    assert.ok(vu.borne, 'l’enveloppe ne doit jamais sortir de 0..1');
    assert.deepEqual(nav.erreurs(), []);
  });

  test('le suiveur audio démarre pour de vrai et alimente le poll', async () => {
    // Chromium est lancé avec un faux périphérique : le chemin NOMINAL est donc
    // exécuté, permission comprise.
    const vu = await nav.evaluate(`
      const vues = [];
      const vrai = window.fetch;
      window.fetch = (u, o) => { if (String(u).includes('/api/state')) vues.push(String(u)); return vrai(u, o); };
      document.querySelector('#btnAudio').click();
      await new Promise(r => setTimeout(r, 900));
      for (let i = 0; i < 4; i++) { await poll(); await new Promise(r => setTimeout(r, 80)); }
      window.fetch = vrai;
      const actif = suiveur.actif;
      const largeur = document.querySelector('#audioVu i').style.width;
      const badge = document.querySelector('#audioBadge').textContent;
      document.querySelector('#btnAudio').click();
      await new Promise(r => setTimeout(r, 120));
      return { actif, largeur, badge, arrete: !suiveur.actif,
               avecNiveau: vues.filter(u => u.includes('?a=')).length,
               etat: document.querySelector('#audioEtat').textContent };`);
    assert.equal(vu.actif, true, 'le micro doit s’ouvrir');
    assert.ok(vu.avecNiveau > 0, 'le poll doit porter le niveau (?a=)');
    assert.ok(vu.badge.length > 0, 'le repli doit signaler qu’un micro est ouvert');
    assert.equal(vu.arrete, true, 'et un second clic doit le refermer');
    assert.deepEqual(nav.erreurs(), []);
  });

  test('double clic pendant la demande d’autorisation : un seul micro ouvert', async () => {
    // `getUserMedia` bloque sur la demande d'autorisation — le moment le plus
    // long. Un régisseur qui reclique parce qu'il ne voit rien lançait deux
    // démarrages : le second écrasait `flux` et `ctx`, laissant les premiers
    // orphelins. Micro jamais relâché, AudioContext fuité.
    const vu = await nav.evaluate(`
      const vrai = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      let appels = 0;
      // On simule une autorisation LENTE : c'est la fenêtre de la course.
      navigator.mediaDevices.getUserMedia = (c) => {
        appels++;
        return new Promise(r => setTimeout(() => r(vrai(c)), 350));
      };
      document.querySelector('#btnAudio').click();
      await new Promise(r => setTimeout(r, 40));
      document.querySelector('#btnAudio').click();   // le reclic impatient
      await new Promise(r => setTimeout(r, 40));
      document.querySelector('#btnAudio').click();
      await new Promise(r => setTimeout(r, 900));
      const actif = suiveur.actif;
      const pistes = suiveur.flux ? suiveur.flux.getTracks().length : 0;
      document.querySelector('#btnAudio').click();   // on referme
      await new Promise(r => setTimeout(r, 200));
      navigator.mediaDevices.getUserMedia = vrai;
      return { appels, actif, pistes, ferme: !suiveur.actif,
               ctxFerme: !suiveur.ctx };`);
    assert.equal(vu.appels, 1, 'un seul getUserMedia doit partir, vu ' + vu.appels);
    assert.equal(vu.actif, true, 'le micro doit bien avoir démarré');
    assert.equal(vu.ferme, true, 'et se refermer proprement');
    assert.equal(vu.ctxFerme, true, 'sans laisser d’AudioContext orphelin');
    assert.deepEqual(nav.erreurs(), []);
  });

  test('micro refusé : Cascade le dit et continue', async () => {
    const vu = await nav.evaluate(`
      const vrai = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('non', 'NotAllowedError'));
      document.querySelector('#btnAudio').click();
      await new Promise(r => setTimeout(r, 400));
      navigator.mediaDevices.getUserMedia = vrai;
      return { actif: suiveur.actif, etat: document.querySelector('#audioEtat').textContent,
               classe: document.querySelector('#btnAudio').classList.contains('active') };`);
    assert.equal(vu.actif, false, 'aucune écoute ne doit démarrer');
    assert.equal(vu.classe, false, 'le bouton ne doit pas rester allumé');
    assert.match(vu.etat, /refus|indisponible/i, 'et l’écran doit l’expliquer');
    // Le point qui compte : un refus n'est pas une panne, donc pas une erreur.
    assert.deepEqual(nav.erreurs(), []);
  });

  test('le cas iPad : pas de micro hors origine sûre, dit clairement', async () => {
    const vu = await nav.evaluate(`
      const vrai = navigator.mediaDevices;
      Object.defineProperty(navigator, 'mediaDevices', { value: undefined, configurable: true });
      document.querySelector('#btnAudio').click();
      await new Promise(r => setTimeout(r, 200));
      const etat = document.querySelector('#audioEtat').textContent;
      Object.defineProperty(navigator, 'mediaDevices', { value: vrai, configurable: true });
      // La page doit continuer de poller SANS ?a= : un iPad n'écrase pas l'hôte.
      const vues = [];
      const vf = window.fetch;
      window.fetch = (u, o) => { if (String(u).includes('/api/state')) vues.push(String(u)); return vf(u, o); };
      await poll();
      window.fetch = vf;
      return { etat, actif: suiveur.actif, sansNiveau: vues.every(u => !u.includes('?a=')) };`);
    assert.equal(vu.actif, false);
    assert.match(vu.etat, /machine où tourne Cascade/,
      'la limite doit être dite avec des mots utilisables');
    assert.equal(vu.sansNiveau, true, 'sans micro, le poll ne doit rien pousser');
    assert.deepEqual(nav.erreurs(), []);
  });

  test('un nom de périphérique hostile ne peut pas injecter de HTML', async () => {
    const vu = await nav.evaluate(`
      remplirEntrees([{ deviceId: 'x', label: '<img src=x onerror="window.__pwn=1">' },
                      { deviceId: 'y', label: '"><svg onload="window.__pwn=1">' }]);
      await new Promise(r => setTimeout(r, 120));
      const sel = document.querySelector('#audioEntree');
      return { pwn: window.__pwn === undefined ? null : window.__pwn,
               balises: document.querySelectorAll('#advAudio img, #advAudio svg').length,
               texte: sel.options[1].textContent, n: sel.options.length };`);
    assert.equal(vu.pwn, null, 'aucun script ne doit s’exécuter');
    assert.equal(vu.balises, 0, 'aucune balise injectée');
    assert.match(vu.texte, /img src=x/, 'le nom s’affiche comme du TEXTE');
    assert.equal(vu.n, 3, 'défaut + les deux entrées');
    assert.deepEqual(nav.erreurs(), []);
  });

  test('en source micro, les réglages qui n’agissent plus disparaissent', async () => {
    const id = (await h.state()).layers[0].id;
    await h.post('/api/layer', { id, set: { lfo: { on: true, param: 'level', src: 'lfo', min: 0, max: 1 } } });
    await rafraichir();
    const avant = await nav.evaluate(`
      await poll();
      return { forme: document.querySelector('#lfoForme').closest('label').style.display,
               src: document.querySelector('#lfoSrc').value };`);
    await h.post('/api/layer', { id, set: { lfo: { on: true, param: 'level', src: 'audio', min: 0, max: 1 } } });
    await rafraichir();
    const apres = await nav.evaluate(`
      await poll();
      return { forme: document.querySelector('#lfoForme').closest('label').style.display,
               periode: document.querySelector('#rowLfoPeriode').style.display,
               src: document.querySelector('#lfoSrc').value };`);
    await h.post('/api/layer', { id, set: { lfo: null } });
    assert.equal(avant.src, 'lfo');
    assert.notEqual(avant.forme, 'none', 'en oscillateur, la forme sert');
    assert.equal(apres.src, 'audio');
    assert.equal(apres.forme, 'none', 'en micro, la forme d’onde n’agit plus');
    assert.equal(apres.periode, 'none', 'ni la période');
    assert.deepEqual(nav.erreurs(), []);
  });

  test('les replis du panneau Couches signalent ce qu’ils cachent', async () => {
    const id = (await h.state()).layers[0].id;
    // Tout neutre : aucune pastille, rien n’est caché qui compte.
    await h.post('/api/layer', { id, set: { mirrorH: false, mirrorV: false,
      blend: 'htp', prof: 0, spread: 0, deck: null } });
    await rafraichir();
    const neutre = await nav.evaluate(`
      await poll();
      return { m: document.querySelector('#miroirsBadge').textContent,
               x: document.querySelector('#melangeBadge').textContent,
               replis: document.querySelectorAll('#advMiroirs, #advMelange').length };`);
    assert.equal(neutre.replis, 2, 'les deux replis doivent exister');
    assert.equal(neutre.m, '', 'rien d’actif : pas de pastille');
    assert.equal(neutre.x, '', 'rien d’actif : pas de pastille');

    // Des réglages fins posés : la pastille doit les compter ET les nommer,
    // sinon un miroir oublié derrière un repli fermé devient un mystère.
    await h.post('/api/layer', { id, set: { mirrorH: true, blend: 'mul', prof: 0.5, deck: 'b' } });
    await rafraichir();
    const actif = await nav.evaluate(`
      await poll();
      return { m: document.querySelector('#miroirsBadge').textContent,
               mt: document.querySelector('#miroirsBadge').title,
               x: document.querySelector('#melangeBadge').textContent,
               xt: document.querySelector('#melangeBadge').title };`);
    assert.equal(actif.m, '1 actif');
    assert.match(actif.mt, /miroir/);
    assert.equal(actif.x, '3 actifs', 'fusion + profondeur + jeu');
    assert.match(actif.xt, /fusion mul/);
    assert.match(actif.xt, /jeu B/);
    assert.deepEqual(nav.erreurs(), []);
    await h.post('/api/layer', { id, set: { mirrorH: false, blend: 'htp', prof: 0, deck: null } });
  });

  test('un repli refermé à la main le reste, tant qu’on ne change pas de couche', async () => {
    // Le piège déjà payé sur « Groove » : rouvrir à chaque rendu empêche
    // l'utilisateur de refermer quoi que ce soit.
    const id = (await h.state()).layers[0].id;
    await h.post('/api/layer', { id, set: { blend: 'mul' } });
    await rafraichir();
    const vu = await nav.evaluate(`
      const d = document.querySelector('#advMelange');
      // On simule l'ARRIVÉE sur la couche : c'est le seul moment où le repli
      // s'ouvre tout seul. Le marqueur retient la dernière couche affichée.
      d.open = false; delete d.dataset.vu;
      await poll();
      const ouvertAuto = d.open;
      d.open = false;                       // l'utilisateur referme
      for (let i = 0; i < 5; i++) { await poll(); await new Promise(r => setTimeout(r, 60)); }
      return { ouvertAuto, resteFerme: !d.open };`);
    assert.equal(vu.ouvertAuto, true, 'un réglage actif doit ouvrir le repli en arrivant');
    assert.equal(vu.resteFerme, true, 'et il doit RESTER fermé si on le referme');
    assert.deepEqual(nav.erreurs(), []);
    await h.post('/api/layer', { id, set: { blend: 'htp' } });
  });

  test('aucune erreur JavaScript sur l’ensemble de la session', () => {
    assert.deepEqual(nav.erreurs(), [], 'erreurs accumulées pendant les tests');
  });
});
