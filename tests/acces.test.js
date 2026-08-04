'use strict';
/**
 * Le code d'accès facultatif à 4 chiffres.
 *
 * Cascade s'ouvre depuis un iPad, donc depuis le Wi-Fi de la salle. Ce code
 * empêche un curieux de prendre la main sur la lumière pendant le spectacle.
 *
 * ⚠ CE QUE CE FICHIER VERROUILLE AVANT TOUT : la limitation des tentatives.
 * Quatre chiffres, c'est 10 000 combinaisons — sans limitation, ça se casse en
 * quelques secondes et le code ne protège RIEN. La première version écrite ici
 * avait précisément ce défaut : le compteur d'essais se remettait à zéro à
 * chaque tentative (`jusqua <= maintenant` est vrai aussi pour `jusqua = 0`), et
 * l'interface répondait « encore 4 essais » indéfiniment.
 *
 * Le portillon lui-même ne se voit que depuis une adresse NON locale : la
 * machine hôte est exemptée, exprès, pour qu'on ne puisse pas s'enfermer dehors.
 * Les tests qui en ont besoin cherchent donc une vraie adresse réseau.
 */
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const os = require('node:os');
const { start, sleep } = require('./helpers.js');

/** Première adresse IPv4 non locale de la machine, ou null. */
function adresseReseau() {
  for (const liste of Object.values(os.networkInterfaces() || {})) {
    for (const i of liste || []) {
      if (i.family === 'IPv4' && !i.internal) return i.address;
    }
  }
  return null;
}
const IP = adresseReseau();

/** Requête brute : on choisit l'adresse visée ET on peut porter un cookie. */
function requete(host, port, method, chemin, corps, cookie) {
  return new Promise((resolve, reject) => {
    const data = corps === undefined ? null : JSON.stringify(corps);
    const headers = {};
    if (data) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(data);
    }
    if (cookie) headers.Cookie = cookie;
    const req = http.request({ host, port, path: chemin, method, headers, timeout: 5000 }, (res) => {
      let d = '';
      res.on('data', c => { d += c; });
      res.on('end', () => {
        let body = d;
        try { body = JSON.parse(d); } catch (e) { /* page HTML */ }
        resolve({ status: res.statusCode, body, cookies: res.headers['set-cookie'] || [] });
      });
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('timeout ' + chemin)));
    if (data) req.write(data);
    req.end();
  });
}

describe('Code d’accès — la machine hôte, la limitation, le secret', () => {
  let h;
  before(async () => { h = await start(); });
  after(async () => {
    await h.post('/api/acces', { nouveau: '' }); // ne pas laisser un code derrière soi
    await h.stop();
  });

  const local = (m, c, b, k) => requete('127.0.0.1', h.port, m, c, b, k);

  test('un code doit faire exactement quatre chiffres', async () => {
    for (const mauvais of ['12', '12345', 'abcd', '12a4', ' 12 ']) {
      const r = await local('POST', '/api/acces', { nouveau: mauvais });
      assert.equal(r.body.ok, false, 'refusé : ' + JSON.stringify(mauvais));
    }
    const bon = await local('POST', '/api/acces', { nouveau: '4731' });
    assert.equal(bon.body.ok, true);
    assert.equal(bon.body.actif, true);
    assert.equal((await h.state()).acces.actif, true);
  });

  test('le haché ne sort JAMAIS du serveur', async () => {
    // Un haché salé de 4 chiffres se casse hors ligne instantanément : l'envoyer
    // reviendrait à envoyer le code.
    const st = await h.state();
    assert.ok(!('acces' in st.settings), 'pas de haché dans /api/state');
    const rg = await local('POST', '/api/settings', {});
    assert.ok(!('acces' in rg.body.settings), 'pas de haché dans /api/settings');
    const exp = await h.get('/api/export');
    assert.ok(!JSON.stringify(exp.body).includes('acces'),
      'un projet exporté ne doit pas porter le code');
  });

  test('la machine hôte n’est jamais bloquée dehors', async () => {
    // C'est ce qui garantit qu'il y a toujours une voie pour retirer le code.
    assert.equal((await local('GET', '/api/state')).status, 200);
    assert.equal((await local('POST', '/api/global', { master: 1 })).status, 200);
    assert.equal((await h.state()).acces.local, true);
  });

  test('LE TEST QUI COMPTE : les tentatives sont limitées', async () => {
    // Sans ça, 10 000 combinaisons se passent en revue en quelques secondes.
    const vus = [];
    for (let i = 0; i < 5; i++) {
      const r = await local('POST', '/api/acces', { code: '0000' });
      vus.push(r.body.restants);
      assert.equal(r.body.ok, false);
    }
    // Le compteur doit DESCENDRE. La version fautive rendait 4 à chaque fois.
    assert.deepEqual(vus, [4, 3, 2, 1, 0], 'les essais restants doivent décroître : ' + vus);

    // Et une fois bloqué, même le BON code est refusé : sinon un attaquant
    // n'aurait qu'à continuer.
    const bloque = await local('POST', '/api/acces', { code: '4731' });
    assert.equal(bloque.status, 429, 'l’adresse doit être bloquée');
    assert.ok(bloque.body.attendre > 0, 'et Cascade doit dire combien de temps');
  });

  test('le bon code ouvre une session, la retirer la referme', async () => {
    // Nouveau serveur : l'adresse du précédent est encore bloquée.
    const h2 = await start();
    try {
      await requete('127.0.0.1', h2.port, 'POST', '/api/acces', { nouveau: '2580' });
      const ok = await requete('127.0.0.1', h2.port, 'POST', '/api/acces', { code: '2580' });
      assert.equal(ok.body.ok, true);
      const ck = (ok.cookies[0] || '');
      assert.match(ck, /^cascade_acces=[a-f0-9]{48}/, 'un jeton doit être posé');
      assert.match(ck, /HttpOnly/, 'le jeton doit être hors de portée du JavaScript');
      assert.match(ck, /SameSite=Strict/, 'et ne pas partir depuis un autre site');

      await requete('127.0.0.1', h2.port, 'POST', '/api/acces', { nouveau: '' });
      assert.equal((await requete('127.0.0.1', h2.port, 'GET', '/api/state')).body.acces.actif, false);
    } finally { await h2.stop(); }
  });

  test('aucune erreur n’a été écrite dans le journal du serveur', () => {
    const erreurs = h.logs.join('').split('\n').filter(l =>
      /erreur inattendue|promesse rejetée|erreur moteur|Error:|TypeError|RangeError/.test(l));
    assert.equal(erreurs.length, 0, 'le serveur a signalé :\n' + erreurs.join('\n'));
  });
});

/**
 * Le portillon lui-même. Il ne se voit que depuis une adresse NON locale, donc
 * ces tests demandent une vraie interface réseau.
 *
 * ⚠ Sans elle ils s'annoncent ignorés — et la suite reste verte. C'est le même
 * angle mort que les tests d'interface sans navigateur : en intégration
 * continue, l'absence d'adresse fait échouer le job, pour qu'un « ignoré » ne
 * passe jamais pour un « réussi ».
 */
describe('Code d’accès — le portillon, vu du réseau',
  { skip: !IP && 'aucune adresse réseau non locale sur cette machine' }, () => {
  let h;
  before(async () => {
    h = await start();
    await requete('127.0.0.1', h.port, 'POST', '/api/acces', { nouveau: '4731' });
  });
  after(async () => {
    await requete('127.0.0.1', h.port, 'POST', '/api/acces', { nouveau: '' });
    await h.stop();
  });

  const reseau = (m, c, b, k) => requete(IP, h.port, m, c, b, k);

  test('sans le code, l’API est fermée — mais la PAGE reste servie', async () => {
    assert.equal((await reseau('GET', '/api/state')).status, 401);
    assert.equal((await reseau('POST', '/api/start')).status, 401);
    assert.equal((await reseau('POST', '/api/blackout')).status, 401);
    assert.equal((await reseau('GET', '/api/export')).status, 401);
    // La page DOIT passer : sans elle, impossible d'afficher la demande de code.
    const page = await reseau('GET', '/');
    assert.equal(page.status, 200);
    assert.ok(String(page.body).includes('dlgAcces'), 'la page porte la demande de code');
    // Et le ping reste ouvert : il sert à repérer une instance déjà lancée.
    assert.equal((await reseau('GET', '/api/ping')).status, 200);
  });

  test('un inconnu ne peut pas REMPLACER le code par le sien', async () => {
    const r = await reseau('POST', '/api/acces', { nouveau: '0000' });
    assert.equal(r.status, 401);
    // Le code d'origine doit toujours être le bon.
    const ok = await reseau('POST', '/api/acces', { code: '4731' });
    assert.equal(ok.body.ok, true, 'le code d’origine doit encore fonctionner');
  });

  test('avec le jeton, tout s’ouvre ; changer le code referme tout', async () => {
    const ok = await reseau('POST', '/api/acces', { code: '4731' });
    const jeton = (ok.cookies[0] || '').split(';')[0];
    assert.ok(jeton, 'un jeton doit être posé');
    assert.equal((await reseau('GET', '/api/state', undefined, jeton)).status, 200);
    assert.equal((await reseau('POST', '/api/stop', {}, jeton)).status, 200);

    // Changer le code doit déconnecter l'iPad d'hier.
    await requete('127.0.0.1', h.port, 'POST', '/api/acces', { nouveau: '1357' });
    assert.equal((await reseau('GET', '/api/state', undefined, jeton)).status, 401,
      'l’ancien jeton ne doit plus rien ouvrir');
    await requete('127.0.0.1', h.port, 'POST', '/api/acces', { nouveau: '4731' });
  });

  test('le serveur ne se coupe pas pendant qu’on tape le code', async () => {
    // L'arrêt automatique regarde la date du dernier poll d'interface. Une page
    // qui affiche la demande de code poll quand même, et reçoit 401 : si ces
    // 401 ne comptaient pas, Cascade pourrait s'éteindre sous les doigts du
    // régisseur. Le pire qu'un curieux puisse faire est de le garder allumé.
    const avant = (await requete('127.0.0.1', h.port, 'GET', '/api/state')).status;
    assert.equal(avant, 200);
    await reseau('GET', '/api/state');          // un 401
    await sleep(120);
    // Le serveur répond toujours : il ne s'est pas arrêté.
    assert.equal((await requete('127.0.0.1', h.port, 'GET', '/api/state')).status, 200);
  });

  test('aucune erreur n’a été écrite dans le journal du serveur', () => {
    const erreurs = h.logs.join('').split('\n').filter(l =>
      /erreur inattendue|promesse rejetée|erreur moteur|Error:|TypeError|RangeError/.test(l));
    assert.equal(erreurs.length, 0, 'le serveur a signalé :\n' + erreurs.join('\n'));
  });
});
