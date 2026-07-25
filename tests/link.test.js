'use strict';
/**
 * Ableton Link — tempo ET synchronisation de phase.
 *
 * Un faux Carabiner joue le rôle du vrai : il écoute en TCP sur le port 17000
 * et répond aux `status` avec un BPM et une position de beat qui avance
 * réellement. On vérifie ensuite que les pas du chase tombent bien SUR les
 * beats, et pas seulement au bon tempo.
 */
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert');
const net = require('node:net');
const { start, sleep, fixtures } = require('./helpers.js');

const CARABINER_PORT = 17000;

/** Faux Carabiner : beat 0 à `origine`, avance à `bpm`. */
function fauxCarabiner(bpm, origine) {
  const clients = new Set();
  const srv = net.createServer((sock) => {
    clients.add(sock);
    sock.on('close', () => clients.delete(sock));
    sock.on('error', () => {});
    sock.on('data', (d) => {
      if (!String(d).includes('status')) return;
      const beat = (Date.now() - srv.origine) / (60000 / srv.bpm);
      sock.write(`status { :peers 1 :bpm ${srv.bpm.toFixed(6)} :start 0 :beat ${beat.toFixed(6)} }\n`);
    });
  });
  srv.bpm = bpm;
  srv.origine = origine;
  srv.stop = () => new Promise((r) => {
    for (const c of clients) { try { c.destroy(); } catch (e) {} }
    srv.close(() => r());
  });
  return srv;
}

/** Le port 17000 est-il libre ? (un vrai Carabiner tournerait dessus) */
function portDisponible() {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once('error', () => resolve(false));
    s.listen(CARABINER_PORT, '127.0.0.1', () => s.close(() => resolve(true)));
  });
}

/**
 * Qualité du verrouillage sur la grille, en millisecondes.
 * On juge sur la MÉDIANE : la suite de tests tourne en parallèle et un pic de
 * charge peut retarder un tick isolé. Un tick tardif n'est pas une dérive ;
 * une dérive, elle, décale TOUS les relevés — donc la médiane.
 */
function qualite(ecarts) {
  const t = [...ecarts].sort((a, b) => a - b);
  return { mediane: t[Math.floor(t.length / 2)], max: t[t.length - 1] };
}

describe('Ableton Link', () => {
  let h, carabiner, dispo;

  before(async () => {
    dispo = await portDisponible();
    if (!dispo) return;
    // Beat 0 posé à un instant connu : c'est notre référence de temps fort.
    carabiner = fauxCarabiner(120, Date.now());
    await new Promise((r) => carabiner.listen(CARABINER_PORT, '127.0.0.1', r));
    h = await start();
    await h.post('/api/fixtures', { fixtures: fixtures(4) });
  });
  after(async () => {
    if (h) await h.stop();
    if (carabiner) await carabiner.stop();
  });

  // `skip` est évalué à la DÉFINITION des tests, donc avant le before() :
  // on ne peut pas y mettre le résultat d'une vérification asynchrone.
  const verifier = (t) => {
    if (!dispo) { t.skip('le port 17000 est déjà pris (un vrai Carabiner tourne ?)'); return false; }
    return true;
  };

  test('Link se connecte et récupère le tempo', async (t) => {
    if (!verifier(t)) return;
    await h.post('/api/link', { enabled: true });
    await sleep(1200);
    const l = (await h.state()).link;
    assert.equal(l.active, true);
    assert.equal(l.connected, true, 'la connexion au faux Carabiner a échoué');
    assert.ok(Math.abs(l.bpm - 120) < 0.1, 'BPM attendu 120, vu ' + l.bpm);
    assert.equal(l.peers, 1);
    // 120 BPM → un beat = 500 ms → un pas de 500 ms sur toutes les couches
    assert.equal((await h.state()).layers[0].stepMs, 500);
  });

  test('la grille de phase est verrouillée et avance', async (t) => {
    if (!verifier(t)) return;
    const a = (await h.state()).link;
    assert.equal(a.locked, true, 'la grille devrait être exploitable');
    assert.ok(a.phase >= 0 && a.phase < 1, 'phase hors bornes : ' + a.phase);
    await sleep(600);
    const b = (await h.state()).link;
    assert.notEqual(a.phase, b.phase, 'la phase doit avancer avec le temps');
  });

  // Le cœur du sujet : à 120 BPM, un pas dure 500 ms et les allumages doivent
  // tomber sur les beats — donc à des instants multiples de 500 ms depuis le
  // beat 0, quel que soit le moment où l'on a démarré le show.
  test('les pas tombent SUR les beats, pas juste au bon tempo', async (t) => {
    if (!verifier(t)) return;
    const id = (await h.state()).layers[0].id;
    await h.post('/api/layer', { id, set: {
      pattern: 'lr', mode: 'onoff', width: 1, speed: 1, group: 1, blocks: 1,
      phase: 0, swing: 0, floor: 0, sparkle: 0, oneShot: false, invert: false,
      mirrorH: false, mirrorV: false, level: 1, enabled: true, bars: null, groupId: null } });
    await h.post('/api/blackout');
    await sleep(100);
    // Démarrage volontairement décalé du beat, pour vérifier que ça se recale
    await sleep(180);
    h.clearOsc();
    const t0 = Date.now();
    const horodatages = [];
    h.mm.on('message', () => horodatages.push(Date.now()));
    await h.post('/api/start');
    await sleep(2600); // ~5 beats
    await h.post('/api/stop');

    // On garde les TRANSITIONS éteint → allumé. Le keep-alive réémet la valeur
    // courante toutes les secondes : compter tous les messages « à 1 » ferait
    // passer ces rappels pour des allumages, à des instants quelconques.
    const allumages = [];
    let n = 0, precedent = 0;
    for (const m of h.osc()) {
      if (/bar0\/luminosity$/.test(m.address)) {
        if (m.args[0] > 0.5 && precedent <= 0.5) allumages.push(horodatages[n]);
        precedent = m.args[0];
      }
      n++;
    }
    assert.ok(allumages.length >= 1, 'bar0 ne s’est jamais allumée');

    // Le PREMIER allumage a lieu au START, pas au beat suivant : le show doit
    // partir quand on appuie, sinon on croirait à une panne. C'est à partir du
    // deuxième que la grille impose son rythme.
    assert.ok(allumages[0] - t0 < 400,
      'la lumière doit partir tout de suite au START, vu ' + (allumages[0] - t0) + ' ms');

    // Écart au beat le plus proche (500 ms) depuis l'origine du faux Carabiner
    const ecart = (t) => {
      const r = ((t - carabiner.origine) % 500 + 500) % 500;
      return Math.min(r, 500 - r);
    };
    const ecarts = allumages.slice(1).map(ecart);
    assert.ok(ecarts.length >= 1, 'pas assez d’allumages pour juger de la grille');
    const q = qualite(ecarts);
    // Le moteur tourne à 25 ms : un tick d'écart est le plancher incompressible.
    assert.ok(q.mediane < 45, 'les allumages ne collent pas aux beats, médiane '
      + q.mediane + ' ms — ' + JSON.stringify(ecarts));
    assert.ok(q.max < 250, 'écart ponctuel énorme : ' + JSON.stringify(ecarts));
  });

  test('toutes les barres restent sur la grille, pas seulement la première', async (t) => {
    if (!verifier(t)) return;
    await h.post('/api/blackout');
    await sleep(120);
    h.clearOsc();
    const horodatages = [];
    const brut = h.received.push.bind(h.received);
    h.received.push = (m) => { horodatages.push(Date.now()); return brut(m); };
    await h.post('/api/start');
    await sleep(3200);
    await h.post('/api/stop');
    h.received.push = brut;

    const precedent = {};
    const ecarts = [];
    h.osc().forEach((m, i) => {
      const b = /^\/fixtures\/(bar\d+)\/luminosity$/.exec(m.address);
      if (!b) return;
      if (m.args[0] > 0.5 && !(precedent[b[1]] > 0.5)) {
        const r = ((horodatages[i] - carabiner.origine) % 500 + 500) % 500;
        ecarts.push(Math.min(r, 500 - r));
      }
      precedent[b[1]] = m.args[0];
    });
    assert.ok(ecarts.length >= 4, 'trop peu d’allumages mesurés : ' + ecarts.length);
    // On écarte le premier (l'entrée dans la grille au START)
    const q = qualite(ecarts.slice(1));
    assert.ok(q.mediane < 45, 'dérive constatée, médiane ' + q.mediane + ' ms — ' + JSON.stringify(ecarts));
    assert.ok(q.max < 250, 'écart ponctuel énorme : ' + JSON.stringify(ecarts));
  });

  test('sans synchro de phase, on ne suit que le tempo', async (t) => {
    if (!verifier(t)) return;
    await h.post('/api/link', { phase: false });
    await sleep(200);
    const l = (await h.state()).link;
    assert.equal(l.phaseOn, false);
    assert.equal(l.locked, false, 'la grille doit être ignorée quand la phase est coupée');
    assert.ok(Math.abs(l.bpm - 120) < 0.1, 'le tempo doit continuer d’être suivi');
    await h.post('/api/link', { phase: true });
    await sleep(200);
    assert.equal((await h.state()).link.locked, true);
  });

  test('un changement de tempo Link est suivi sans à-coup', async (t) => {
    if (!verifier(t)) return;
    carabiner.bpm = 150; // 400 ms par beat
    await sleep(1200);
    const l = (await h.state()).link;
    assert.ok(Math.abs(l.bpm - 150) < 0.1, 'BPM attendu 150, vu ' + l.bpm);
    assert.equal((await h.state()).layers[0].stepMs, 400);
    assert.equal(l.locked, true, 'la grille doit rester verrouillée après le changement');
    carabiner.bpm = 120;
    await sleep(900);
  });

  test('la mesure se règle (quantum) et borne les valeurs absurdes', async (t) => {
    if (!verifier(t)) return;
    await h.post('/api/link', { quantum: 3 });
    assert.equal((await h.state()).link.quantum, 3);
    await h.post('/api/link', { quantum: 999 });
    assert.equal((await h.state()).link.quantum, 16);
    await h.post('/api/link', { quantum: 4 });
  });

  test('si Carabiner se tait, la grille cesse d’être fiable', async (t) => {
    if (!verifier(t)) return;
    assert.equal((await h.state()).link.locked, true);
    await carabiner.stop();
    await sleep(5000); // au-delà du délai de confiance
    const l = (await h.state()).link;
    assert.equal(l.locked, false, 'sans nouvelles, la grille ne doit plus être crue');
    // Le serveur ne doit pas s'effondrer pour autant
    assert.equal((await h.get('/api/ping')).body.app, 'Cascade');
    // Le chase continue de tourner, en tempo libre
    await h.post('/api/start');
    await sleep(400);
    assert.ok(h.osc().length > 0, 'le moteur doit continuer sans Link');
    await h.post('/api/stop');
    await h.post('/api/link', { enabled: false });
  });
});
