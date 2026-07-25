'use strict';
/**
 * Pilotage d'un vrai navigateur — sans aucune dépendance.
 *
 * Les autres tests parlent au serveur ; aucun n'exécute le JavaScript de la
 * page. Une simple variable redéclarée a déjà cassé toute l'interface sans
 * qu'un seul test ne bronche. Ce module comble ce trou : il lance Chrome ou
 * Edge en mode « headless » et le pilote par le protocole DevTools (CDP), à
 * travers le WebSocket intégré à Node — donc toujours zéro dépendance.
 *
 * Si aucun navigateur n'est installé, `launch()` renvoie null et les tests
 * concernés s'annoncent ignorés plutôt que d'échouer.
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

/** Chemins usuels de Chrome / Edge / Chromium, par plateforme. */
function findBrowser() {
  const existe = (p) => { try { return p && fs.existsSync(p) ? p : null; } catch (e) { return null; } };
  const premier = (liste) => liste.map(existe).find(Boolean) || null;
  if (process.platform === 'win32') {
    const pf = process.env['ProgramFiles'] || 'C:\\Program Files';
    const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    const lad = process.env['LocalAppData'] || '';
    return premier([
      pf + '\\Google\\Chrome\\Application\\chrome.exe',
      pf86 + '\\Google\\Chrome\\Application\\chrome.exe',
      lad && lad + '\\Google\\Chrome\\Application\\chrome.exe',
      pf86 + '\\Microsoft\\Edge\\Application\\msedge.exe',
      pf + '\\Microsoft\\Edge\\Application\\msedge.exe',
    ]);
  }
  if (process.platform === 'darwin') {
    return premier([
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
    ]);
  }
  return premier([
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
    '/snap/bin/chromium', '/usr/bin/microsoft-edge',
  ]);
}

/** Client CDP minimal : un WebSocket, des requêtes numérotées, des événements. */
class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.enAttente = new Map();
    this.ecouteurs = [];
    ws.addEventListener('message', (ev) => {
      let m;
      try { m = JSON.parse(ev.data); } catch (e) { return; }
      if (m.id != null && this.enAttente.has(m.id)) {
        const { resolve, reject } = this.enAttente.get(m.id);
        this.enAttente.delete(m.id);
        if (m.error) reject(new Error(m.error.message || 'erreur CDP'));
        else resolve(m.result);
      } else if (m.method) {
        for (const f of this.ecouteurs) f(m);
      }
    });
  }
  envoyer(method, params = {}, sessionId) {
    const id = ++this.id;
    const msg = { id, method, params };
    if (sessionId) msg.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      this.enAttente.set(id, { resolve, reject });
      this.ws.send(JSON.stringify(msg));
      setTimeout(() => {
        if (this.enAttente.delete(id)) reject(new Error('CDP sans réponse : ' + method));
      }, 20000);
    });
  }
  surEvenement(f) { this.ecouteurs.push(f); }
}

const dormir = (ms) => new Promise(r => setTimeout(r, ms));

function portLibre() {
  return new Promise((resolve, reject) => {
    const s = require('net').createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
  });
}

/** Attend que DevTools réponde et renvoie l'adresse WebSocket du navigateur. */
async function attendreDevTools(port, delaiMax) {
  const http = require('http');
  const t0 = Date.now();
  while (Date.now() - t0 < delaiMax) {
    const url = await new Promise((resolve) => {
      const req = http.get({ host: '127.0.0.1', port, path: '/json/version', timeout: 1000 }, (res) => {
        let d = '';
        res.on('data', c => { d += c; });
        res.on('end', () => { try { resolve(JSON.parse(d).webSocketDebuggerUrl || null); } catch (e) { resolve(null); } });
      });
      req.on('error', () => resolve(null));
      req.on('timeout', () => { req.destroy(); resolve(null); });
    });
    if (url) return url;
    await dormir(200);
  }
  return null;
}

/**
 * Lance un navigateur et ouvre une page. Renvoie null si aucun n'est installé.
 * L'objet rendu expose : goto, evaluate, erreurs(), close().
 */
async function launch() {
  const bin = findBrowser();
  if (!bin) return null;

  const profil = fs.mkdtempSync(path.join(os.tmpdir(), 'cascade-cdp-'));
  const port = await portLibre();
  const child = spawn(bin, [
    '--headless=new',
    '--remote-debugging-port=' + port,
    '--user-data-dir=' + profil,
    '--no-first-run', '--no-default-browser-check', '--disable-gpu',
    '--disable-extensions', '--disable-background-networking',
    '--disable-features=Translate,MediaRouter',
    '--window-size=1400,1000',
    'about:blank',
  ], { stdio: 'ignore' });

  // On interroge le point d'entrée HTTP de DevTools plutôt que de lire stderr :
  // Edge n'y annonce rien, contrairement à Chrome.
  const urlWs = await attendreDevTools(port, 20000);
  if (!urlWs) {
    try { child.kill(); } catch (e) {}
    try { fs.rmSync(profil, { recursive: true, force: true }); } catch (e) {}
    return null;
  }

  const ws = new WebSocket(urlWs);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', () => reject(new Error('WebSocket CDP refusé')), { once: true });
  });
  const cdp = new Cdp(ws);

  const { targetId } = await cdp.envoyer('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.envoyer('Target.attachToTarget', { targetId, flatten: true });

  const erreurs = [];
  cdp.surEvenement((m) => {
    if (m.sessionId !== sessionId) return;
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails || {};
      erreurs.push('exception : ' + (d.exception && d.exception.description || d.text || '?'));
    } else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      erreurs.push('console.error : ' + (m.params.args || []).map(a => a.value ?? a.description ?? '').join(' '));
    } else if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') {
      // 404 de ressources, erreurs réseau…
      erreurs.push('log : ' + m.params.entry.text);
    }
  });
  await cdp.envoyer('Runtime.enable', {}, sessionId);
  await cdp.envoyer('Page.enable', {}, sessionId);
  await cdp.envoyer('Log.enable', {}, sessionId);

  return {
    nom: path.basename(bin),
    erreurs: () => erreurs.slice(),
    viderErreurs: () => { erreurs.length = 0; },

    async goto(url) {
      const charge = new Promise((resolve) => {
        const f = (m) => {
          if (m.sessionId === sessionId && m.method === 'Page.loadEventFired') resolve();
        };
        cdp.surEvenement(f);
        setTimeout(resolve, 15000);
      });
      await cdp.envoyer('Page.navigate', { url }, sessionId);
      await charge;
      await dormir(250); // laisse le premier poll s'exécuter
    },

    /** Évalue une expression dans la page et renvoie sa valeur. */
    async evaluate(expr) {
      const r = await cdp.envoyer('Runtime.evaluate', {
        expression: `(async () => { ${expr} })()`,
        awaitPromise: true, returnByValue: true,
      }, sessionId);
      if (r.exceptionDetails) {
        const d = r.exceptionDetails;
        throw new Error('évaluation : ' + (d.exception && d.exception.description || d.text));
      }
      return r.result.value;
    },

    async close() {
      try { ws.close(); } catch (e) {}
      try { child.kill(); } catch (e) {}
      await dormir(120);
      try { fs.rmSync(profil, { recursive: true, force: true }); } catch (e) {}
    },
  };
}

module.exports = { launch, findBrowser, dormir };
