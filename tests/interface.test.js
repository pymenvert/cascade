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
    // Le suffixe de pré-version (« 2.0.0-dev ») fait partie de la version du
    // serveur, mais pas du pied de page, qui n'affiche que majeure.mineure.
    const v = /const VERSION = '(\d+)\.(\d+)\.\d+[^']*'/.exec(SERVEUR);
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
    for (const id of ['floor', 'phase', 'swing', 'blocks', 'sparkle',
                      'audioGain', 'audioSeuil', 'audioAttaque', 'audioRelache', 'audioBande']) {
      const bloc = UI.slice(Math.max(0, UI.indexOf(`id="${id}"`) - 400), UI.indexOf(`id="${id}"`));
      assert.match(bloc, /title="/, `le réglage #${id} n'a pas d'infobulle`);
    }
  });

  test('les nouveaux paramètres sont pilotables en OSC', () => {
    for (const k of ['floor', 'phase', 'swing', 'blocks', 'sparkle', 'oneshot', 'go']) {
      assert.ok(SERVEUR.includes(`'${k}'`), `adresse OSC layer/N/${k} absente du serveur`);
    }
  });

  // Ce test vient d'un vrai incident : une variable redéclarée a cassé TOUT le
  // script de la page, sans qu'aucun des 82 autres tests ne s'en aperçoive —
  // ils parlent au serveur, jamais au JavaScript du navigateur.
  test('le script de l’interface est syntaxiquement valide', () => {
    const m = UI.match(/<script>([\s\S]*)<\/script>/);
    assert.ok(m, 'script introuvable dans index.html');
    assert.doesNotThrow(() => new Function(m[1]),
      'le script de la page ne peut pas être analysé — l’interface serait morte au chargement');
  });

  test('aucune variable de rendu n’est déclarée deux fois', () => {
    // `new Function` attrape déjà les collisions dans une même portée ; ici on
    // vérifie en plus que render() ne redéclare pas un nom qu'elle utilise déjà.
    const m = /function render\(\) \{([\s\S]*?)\n\}/.exec(UI);
    assert.ok(m, 'render() introuvable');
    const noms = [...m[1].matchAll(/\n  const (\w+)\s*=/g)].map(x => x[1]);
    const doublons = noms.filter((n, i) => noms.indexOf(n) !== i);
    assert.deepEqual([...new Set(doublons)], [], 'déclarations en double dans render()');
  });

  test('les repères d’usage courant sont présents', () => {
    for (const [quoi, motif] of [
      ['accueil premier lancement', /id="accueil"/],
      ['repli Groove & découpe', /id="advGroove"/],
      ['pastille de réglages actifs', /id="grooveBadge"/],
      ['dialogue d’aide', /id="dlgAide"/],
      ['bouton d’aide', /id="btnAide"/],
      ['voyant MadMapper', /id="mmLink"/],
      ['bouton QR', /id="btnQR"/],
      // La classe est statique : un retour accidentel à la rangée de boutons
      // serait attrapé ici, et pas seulement à l'œil.
      ['grille de presets', /id="presets" class="grille"/],
      ['repli du suiveur audio', /id="advAudio"/],
      ['bouton du micro', /id="btnAudio"/],
      ['source du modulateur de couche', /id="lfoSrc"/],
      ['source du modulateur global', /id="mgSrc"/],
      ['repli des symétries', /id="advMiroirs"/],
      ['repli mélange & espace', /id="advMelange"/],
      ['pastille des symétries', /id="miroirsBadge"/],
      ['pastille mélange & espace', /id="melangeBadge"/],
      ['demande du code d’accès', /id="dlgAcces"/],
      ['champ du code d’accès', /id="setAcces"/],
      ['retrait explicite du code', /id="btnAccesRetirer"/],
      ['réglage de l’icône de notification', /id="setSystray"/],
    ]) assert.match(UI, motif, quoi + ' introuvable');
  });

  test('les raccourcis ne se déclenchent ni en saisie ni dans un dialogue', () => {
    const bloc = UI.slice(UI.indexOf("addEventListener('keydown'"));
    assert.match(bloc, /INPUT\|SELECT\|TEXTAREA/, 'les champs de saisie doivent être exclus');
    assert.match(bloc, /isContentEditable/, 'les zones éditables doivent être exclues');
    assert.match(bloc, /dialog\[open\]/, 'un dialogue ouvert doit neutraliser les raccourcis');
    assert.match(bloc, /ctrlKey \|\| e\.metaKey \|\| e\.altKey/, 'les combinaisons système doivent passer');
  });

  test('dist/ est synchrone avec les sources', () => {
    // dist/ est la copie qu'on envoie telle quelle. Livrer un dist/ obsolète,
    // c'est livrer une version qui n'a jamais été testée.
    const r = require('node:child_process').spawnSync(
      process.execPath, [path.join(__dirname, '..', 'sync-dist.js'), '--check'],
      { encoding: 'utf8' });
    assert.equal(r.status, 0, (r.stdout || '') + (r.stderr || ''));
  });

  test('aucun mutant de test n’est resté dans server.js', () => {
    // Le 28/07/2026, un commit est parti avec un cassage volontaire encore en
    // place : `const src = 'motif'` au lieu de `L.palSrc || 'motif'`. La palette
    // spatiale était morte, et TOUTE LA SUITE RESTAIT VERTE — c'est normal, un
    // mutant tue une fonction, pas un test. Rien ne le signalait.
    //
    // Ce test ferme le trou : il vérifie que le code source contient toujours la
    // forme SAINE de chaque endroit que l'outil de mutation sait casser. Si un
    // mutant survit à un `finally` interrompu, il est attrapé avant le commit.
    const MUTATIONS = require('./mutations-liste.js');
    const restes = MUTATIONS.filter(m => !SERVEUR.includes(m.de));
    assert.equal(restes.length, 0,
      'la forme saine a disparu de server.js — un mutant est peut-être resté :\n'
      + restes.map(m => '  - ' + m.nom + '\n      attendu : ' + m.de.trim()).join('\n'));
    // Et le garde-fou doit lui-même être vivant : une liste vide passerait tout.
    assert.ok(MUTATIONS.length >= 27,
      'la liste des mutations a maigri : ' + MUTATIONS.length);
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
