'use strict';
/**
 * Garde-fous sur le source de l'interface.
 *
 * Il n'y a pas de navigateur ici : ces tests lisent le code de public/index.html
 * et vérifient des règles que l'on ne veut plus jamais enfreindre. La règle n°1
 * vient d'un vrai défaut trouvé en 1.3.0 : les noms de couches et de fixtures
 * (qui viennent d'un fichier projet ou de MadMapper, donc de l'extérieur)
 * étaient injectés via innerHTML — du HTML arbitraire atterrissait dans la page.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const UI = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
const SERVEUR = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

describe('Interface — garde-fous du source', () => {
  test('aucune donnée utilisateur n’est injectée via innerHTML', () => {
    // On repère les affectations innerHTML utilisant une interpolation `${…}`
    // qui référence un champ venant de l'extérieur.
    const risques = [];
    const re = /innerHTML\s*=\s*(`[^`]*`|'[^']*'|"[^"]*")/g;
    let m;
    while ((m = re.exec(UI))) {
      const litteral = m[1];
      const interpolations = litteral.match(/\$\{[^}]*\}/g) || [];
      for (const i of interpolations) {
        // Autorisé : booléens de gabarit et valeurs numériques calculées.
        if (/^\$\{[^}]*\?\s*'checked'\s*:\s*''\s*\}$/.test(i)) continue;
        if (/^\$\{\s*(c\[\d\]|Math\.\w+\(|\(?0?\.\d)/.test(i)) continue;
        risques.push({ ligne: UI.slice(0, m.index).split('\n').length, expr: i });
      }
    }
    const dangereux = risques.filter(r =>
      /name|address|projectName|label|title|error|url|nom/i.test(r.expr));
    assert.deepEqual(dangereux, [],
      'donnée externe injectée en HTML :\n' + JSON.stringify(dangereux, null, 1));
  });

  test('les noms affichés passent bien par textContent', () => {
    assert.match(UI, /nom\.textContent\s*=\s*f\.name/, 'nom de fixture');
    assert.match(UI, /querySelector\('span'\)\.textContent\s*=\s*l\.name/, 'nom de couche');
    assert.match(UI, /\.lbl'\)\.textContent\s*=\s*f\.name/, 'étiquette dans la vue spatiale');
  });

  test('la version affichée correspond à celle du serveur', () => {
    const v = /const VERSION = '(\d+)\.(\d+)\.\d+'/.exec(SERVEUR);
    assert.ok(v, 'VERSION introuvable dans server.js');
    const attendu = `CASCADE v${v[1]}.${v[2]}`;
    assert.ok(UI.includes(attendu), `le pied de page devrait afficher « ${attendu} »`);
  });

  test('tous les réglages de couche ont un libellé et une infobulle', () => {
    for (const id of ['floor', 'phase', 'swing', 'blocks', 'sparkle', 'oneShot', 'dimmer']) {
      const re = new RegExp(`id="${id}"`);
      assert.match(UI, re, `contrôle #${id} absent de l'interface`);
    }
    // Chaque nouvelle ligne de réglage doit porter un title= explicatif
    for (const id of ['floor', 'phase', 'swing', 'blocks', 'sparkle']) {
      const bloc = UI.slice(Math.max(0, UI.indexOf(`id="${id}"`) - 400), UI.indexOf(`id="${id}"`));
      assert.match(bloc, /title="/, `le réglage #${id} n'a pas d'infobulle`);
    }
  });

  test('les nouveaux paramètres sont pilotables en OSC', () => {
    for (const k of ['floor', 'phase', 'swing', 'blocks', 'sparkle', 'oneshot', 'go']) {
      assert.ok(SERVEUR.includes(`'${k}'`), `adresse OSC layer/N/${k} absente du serveur`);
    }
  });

  test('les sémantiques non négociables sont toujours en place', () => {
    // STOP ne doit envoyer aucun OSC
    assert.match(SERVEUR, /if \(!state\.global\.running\)[\s\S]{0,400}?return;/,
      'tick() doit sortir tôt à l’arrêt, sans envoyer d’OSC');
    // L'arrêt automatique ne doit jamais couper un show
    assert.match(SERVEUR, /if \(state\.global\.running\) return;/,
      'le veilleur d’arrêt automatique doit épargner un show en cours');
    // La phase doit être rebasée quand le tempo change
    assert.match(SERVEUR, /tempo changé : phase préservée/,
      'la préservation de phase au changement de tempo a disparu');
  });
});
