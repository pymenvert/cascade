'use strict';
/**
 * Utilitaires de test — zéro dépendance.
 * Lance un vrai serveur Cascade sur des ports libres, avec une config jetable,
 * et écoute l'OSC réellement émis vers « MadMapper ».
 */
const { spawn } = require('child_process');
const http = require('http');
const dgram = require('dgram');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SERVER = path.join(__dirname, '..', 'server.js');

/** Réserve un port libre en laissant l'OS en choisir un, puis le relâche. */
function freePort(kind = 'tcp') {
  return new Promise((resolve, reject) => {
    if (kind === 'udp') {
      const s = dgram.createSocket('udp4');
      s.once('error', reject);
      s.bind(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
    } else {
      const s = require('net').createServer();
      s.once('error', reject);
      s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
    }
  });
}

/** Décodeur OSC minimal, indépendant de celui du serveur (test croisé). */
function decodeOsc(buf) {
  const readStr = (off) => {
    let end = off;
    while (end < buf.length && buf[end] !== 0) end++;
    const s = buf.toString('utf8', off, end);
    end += 1;
    while (end % 4) end++;
    return [s, end];
  };
  let [address, off] = readStr(0);
  const args = [];
  if (off < buf.length && buf[off] === 0x2c) {
    let types;
    [types, off] = readStr(off);
    for (const t of types.slice(1)) {
      if (t === 'f') { args.push(buf.readFloatBE(off)); off += 4; }
      else if (t === 'i') { args.push(buf.readInt32BE(off)); off += 4; }
      else if (t === 's') { let s; [s, off] = readStr(off); args.push(s); }
    }
  }
  return { address, args };
}

class Harness {
  constructor(o) { Object.assign(this, o); }

  /**
   * `opts.from` = adresse source de la requête. Les alias loopback 127.0.0.2+
   * répondent tous sur cette machine mais ne sont PAS « locaux » au sens du
   * serveur : c'est la seule façon, sans deuxième machine, de mesurer ce que
   * voit quelqu'un sur le réseau.
   */
  async api(method, url, body, opts = {}) {
    return new Promise((resolve, reject) => {
      const data = body === undefined ? null : JSON.stringify(body);
      const conf = {
        host: '127.0.0.1', port: this.port, path: url, method,
        headers: data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {},
        timeout: 5000,
      };
      if (opts.from) conf.localAddress = opts.from;
      const req = http.request(conf, (res) => {
        let d = '';
        res.on('data', c => { d += c; });
        res.on('end', () => {
          try { resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(d) }); }
          catch (e) { resolve({ status: res.statusCode, headers: res.headers, body: d }); }
        });
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(new Error('timeout ' + url)); });
      if (data) req.write(data);
      req.end();
    });
  }
  get(url, opts) { return this.api('GET', url, undefined, opts); }
  post(url, body = {}, opts) { return this.api('POST', url, body, opts); }
  /** Le serveur s'est-il arrêté tout seul ? (arrêt automatique) */
  vivant() { return !!this.child && this.child.exitCode === null && !this.child.signalCode; }
  state() { return this.get('/api/state').then(r => r.body); }

  /** Messages OSC reçus depuis le dernier clearOsc(). */
  osc() { return this.received; }
  clearOsc() { this.received.length = 0; }
  /** Attend qu'une adresse OSC apparaisse (ou expire). */
  async waitOsc(match, ms = 2000) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      const hit = this.received.find(m => match(m));
      if (hit) return hit;
      await sleep(20);
    }
    return null;
  }
  /** Envoie un message OSC de contrôle vers le serveur (port OSC entrant). */
  sendOsc(address, args = []) {
    const pad = (b) => Buffer.concat([b, Buffer.alloc((4 - (b.length % 4)) % 4)]);
    const str = (s) => pad(Buffer.concat([Buffer.from(s, 'utf8'), Buffer.alloc(1)]));
    const parts = [str(address), str(',' + args.map(() => 'f').join(''))];
    for (const a of args) { const b = Buffer.alloc(4); b.writeFloatBE(a); parts.push(b); }
    return new Promise((resolve) => this.ctl.send(Buffer.concat(parts), this.oscInPort, '127.0.0.1', () => resolve()));
  }

  async stop() {
    try { this.mm.close(); } catch (e) {}
    try { this.ctl.close(); } catch (e) {}
    if (this.child && !this.child.killed) {
      this.child.kill();
      await new Promise(r => { this.child.once('exit', r); setTimeout(r, 2000); });
    }
    try { fs.rmSync(this.dir, { recursive: true, force: true }); } catch (e) {}
  }
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/** Démarre un serveur Cascade isolé. `config` = contenu initial du fichier. */
/**
 * `env` = surcharges d'environnement pour CETTE instance. Sert à mesurer ce qui
 * serait autrement invisible : l'arrêt automatique attend 8 s, on le ramène à
 * quelques centaines de millisecondes plutôt que de le vérifier « en principe ».
 */
async function start(config, env) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cascade-test-'));
  const cfgFile = path.join(dir, 'config.json');
  if (config) fs.writeFileSync(cfgFile, typeof config === 'string' ? config : JSON.stringify(config));

  const [port, oscInPort, feedbackPort, mmPort] =
    await Promise.all([freePort(), freePort('udp'), freePort('udp'), freePort('udp')]);

  // Faux MadMapper : on écoute ce que Cascade envoie réellement.
  const received = [];
  const mm = dgram.createSocket('udp4');
  mm.on('message', (buf) => { try { received.push(decodeOsc(buf)); } catch (e) {} });
  await new Promise((res, rej) => { mm.once('error', rej); mm.bind(mmPort, '127.0.0.1', res); });

  const ctl = dgram.createSocket('udp4');
  await new Promise((res, rej) => { ctl.once('error', rej); ctl.bind(0, '127.0.0.1', res); });

  const child = spawn(process.execPath, [SERVER], {
    env: {
      ...process.env,
      CASCADE_CONFIG: cfgFile, CASCADE_PORT: String(port),
      CASCADE_OSCIN: String(oscInPort), CASCADE_FEEDBACK: String(feedbackPort),
      CASCADE_MMPORT: String(mmPort), CASCADE_MMHOST: '127.0.0.1',
      CASCADE_NO_BROWSER: '1', CASCADE_NO_AUTOQUIT: '1',
      ...(env || {}),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const logs = [];
  child.stdout.on('data', d => logs.push(String(d)));
  child.stderr.on('data', d => logs.push(String(d)));

  const h = new Harness({ dir, cfgFile, port, oscInPort, feedbackPort, mmPort, mm, ctl, child, received, logs });

  // Attente de disponibilité
  const t0 = Date.now();
  for (;;) {
    if (Date.now() - t0 > 15000) { await h.stop(); throw new Error('serveur non démarré :\n' + logs.join('')); }
    try { const r = await h.get('/api/ping'); if (r.body && r.body.app === 'Cascade') break; } catch (e) {}
    await sleep(60);
  }
  return h;
}

/** Deux fixtures alignées, prêtes pour un chase. */
function fixtures(n = 4) {
  return Array.from({ length: n }, (_, i) => ({
    id: 'f' + i, name: 'Barre ' + (i + 1), address: '/fixtures/bar' + i,
    enabled: true, x: n === 1 ? 0.5 : i / (n - 1), y: 0.5, rot: 0, len: null, vert: false,
  }));
}

module.exports = { start, sleep, fixtures, decodeOsc, freePort };
