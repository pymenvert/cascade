'use strict';
/** Voyant de liaison MadMapper : il doit dire la vérité, dans les deux sens. */
const { test, describe } = require('node:test');
const assert = require('node:assert');
const dgram = require('node:dgram');
const { start, sleep, fixtures } = require('./helpers.js');

describe('Liaison MadMapper', () => {
  test('sans MadMapper qui répond, le voyant est rouge', async () => {
    const h = await start();
    try {
      await h.post('/api/fixtures', { fixtures: fixtures(2) });
      await sleep(400);
      const s = await h.state();
      assert.equal(s.mm.socketOk, true, 'le port de feedback doit être ouvert');
      assert.equal(s.mm.alive, false, 'personne ne répond : le voyant doit être rouge');
      assert.equal(s.mm.error, null);
    } finally { await h.stop(); }
  });

  test('Cascade interroge bien MadMapper (sondage périodique)', async () => {
    const h = await start();
    try {
      await h.post('/api/fixtures', { fixtures: fixtures(2) });
      h.clearOsc();
      await sleep(3500); // au moins un sondage
      const sondes = h.osc().filter(m => /getControl/.test(m.address));
      assert.ok(sondes.length >= 1, 'aucune interrogation envoyée : ' + sondes.length);
    } finally { await h.stop(); }
  });

  test('dès que MadMapper répond, le voyant passe au vert', async () => {
    const h = await start();
    try {
      await h.post('/api/fixtures', { fixtures: fixtures(2) });
      // On se fait passer pour MadMapper : on répond sur le port de feedback.
      const faux = dgram.createSocket('udp4');
      const pad = (b) => Buffer.concat([b, Buffer.alloc((4 - (b.length % 4)) % 4)]);
      const str = (s) => pad(Buffer.concat([Buffer.from(s, 'utf8'), Buffer.alloc(1)]));
      const val = Buffer.alloc(4); val.writeFloatBE(0.5);
      const rep = Buffer.concat([str('/fixtures/bar0/luminosity'), str(',f'), val]);
      await new Promise(r => faux.send(rep, h.feedbackPort, '127.0.0.1', r));
      await sleep(300);
      assert.equal((await h.state()).mm.alive, true, 'le voyant doit passer au vert');
      faux.close();
      // Puis plus rien : au-delà du délai, il doit repasser au rouge.
      await sleep(9500);
      assert.equal((await h.state()).mm.alive, false, 'le voyant doit retomber au rouge');
    } finally { await h.stop(); }
  });
});
