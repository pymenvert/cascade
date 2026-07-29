'use strict';
/**
 * Qualité du hachage du bruit 3D — et surtout de son axe Z.
 *
 * `hash3` n'est pas exporté : le serveur est un script, pas un module. On lit
 * donc sa source et on l'évalue, comme `interface.test.js` le fait déjà pour les
 * garde-fous du source. C'est le seul moyen de tester une fonction pure sans
 * démonter l'architecture du projet, et ça vaut mieux que de juger une propriété
 * numérique à travers trente relevés OSC bruités.
 *
 * Ce que ce fichier protège vient d'une mesure : le multiplicateur de l'axe Z
 * valait 2147483647, soit 2^31 - 1. En arithmétique 32 bits, multiplier par
 * cette valeur revient à `-z` plus un bit de parité — un multiplicateur
 * DÉGÉNÉRÉ. L'avalanche qui suit brouille assez la sortie pour que rien ne se
 * voie à l'œil, et aucun test ne l'attrapait.
 *
 * ⚠ C'est Z qui porte le TEMPS dans le bruit 3D. Un axe Z mal haché, c'est un
 * bruit qui se répète dans la durée — le défaut le plus visible en spectacle et
 * le plus difficile à nommer quand on le regarde.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SERVEUR = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

/** Extrait `hash3` de la source et en fait une vraie fonction. */
function extraireHash3() {
  const m = /function hash3\(x, y, z\) \{([\s\S]*?)\n\}/.exec(SERVEUR);
  assert.ok(m, 'hash3 introuvable dans server.js — la source a changé de forme');
  return new Function('x', 'y', 'z', m[1]);
}

/**
 * Combien d'écarts DISTINCTS entre valeurs consécutives, le long d'un axe ?
 *
 * C'est la mesure qui trahit un multiplicateur dégénéré. Un axe bien haché
 * donne presque autant d'écarts distincts que de pas ; un axe dégénéré tourne
 * sur une poignée de valeurs, quoi qu'en dise l'aspect « désordonné » de la
 * sortie prise isolément.
 */
function ecartsDistincts(h3, axe, n) {
  const s = [];
  for (let k = 0; k < n; k++) {
    s.push(axe === 'x' ? h3(k, 7, 3) : axe === 'y' ? h3(3, k, 3) : h3(3, 7, k));
  }
  const d = new Set();
  for (let i = 1; i < s.length; i++) d.add((s[i] - s[i - 1]).toFixed(6));
  return d.size;
}

describe('Hachage du bruit 3D', () => {
  test('l’axe Z est haché aussi bien que X et Y', () => {
    const h3 = extraireHash3();
    const N = 200;
    const x = ecartsDistincts(h3, 'x', N);
    const y = ecartsDistincts(h3, 'y', N);
    const z = ecartsDistincts(h3, 'z', N);

    // Repères mesurés : X 199, Y 197 sur 199 pas. Le multiplicateur dégénéré
    // ramenait Z à 14. Le seuil est posé très en dessous des axes sains et très
    // au-dessus du cas dégénéré — il n'y a pas d'ambiguïté à trancher.
    assert.ok(x > 150 && y > 150,
      'les axes X et Y servent de repère et doivent être bien hachés : '
      + JSON.stringify({ x, y }));
    assert.ok(z > 150,
      'l’axe Z est mal haché : ' + z + ' écarts distincts sur ' + (N - 1)
      + ' pas, contre ' + x + ' pour X. Or c’est Z qui porte le temps — '
      + 'le bruit 3D se répéterait dans la durée. Vérifier que son '
      + 'multiplicateur n’est pas dégénéré (2^31-1 revient à « -z plus un bit »).');
  });

  test('le hachage reste dans [0 ; 1] et couvre l’intervalle', () => {
    const h3 = extraireHash3();
    const v = [];
    for (let i = 0; i < 5000; i++) v.push(h3((i * 7) % 91, (i * 13) % 83, (i * 3) % 71));
    assert.ok(Math.min(...v) >= 0 && Math.max(...v) <= 1,
      'hors bornes : ' + JSON.stringify([Math.min(...v), Math.max(...v)]));
    assert.ok(Math.min(...v) < 0.02 && Math.max(...v) > 0.98,
      'le hachage doit couvrir tout l’intervalle, vu '
      + JSON.stringify([Math.min(...v).toFixed(3), Math.max(...v).toFixed(3)]));
    const moy = v.reduce((a, b) => a + b, 0) / v.length;
    assert.ok(Math.abs(moy - 0.5) < 0.02, 'moyenne attendue vers 0,5, vue ' + moy.toFixed(4));
  });

  test('il est reproductible d’un appel à l’autre', () => {
    // Le bruit doit être une fonction de l'espace et du temps, pas d'un état
    // caché : deux machines qui jouent le même show doivent voir la même chose.
    const h3 = extraireHash3();
    for (const [a, b, c] of [[0, 0, 0], [12, -5, 987654], [-3, 7, 2], [1e6, 1e6, 1e6]]) {
      assert.equal(h3(a, b, c), h3(a, b, c), 'appel non reproductible en ' + [a, b, c]);
    }
  });
});
