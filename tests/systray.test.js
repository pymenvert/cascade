'use strict';
/**
 * L'ICÔNE DE ZONE DE NOTIFICATION — garde-fous sur un script qu'on ne peut pas
 * lancer.
 *
 * Le PowerShell embarqué dans `server.js` a été écrit depuis Linux, où
 * PowerShell n'existe pas, et la CI ne tourne que sur Ubuntu : AUCUNE ligne de
 * ce dossier ne sera jamais couverte par une exécution réelle. Ces tests lisent
 * donc le source — ce qui vaut mieux que rien, à condition de savoir que c'est
 * tout ce que c'est.
 *
 * Ils ne sont pas choisis au hasard : chacun correspond à un point où une
 * relecture adversariale a montré qu'un défaut casse quelque chose de concret.
 *
 * ⚠ Ce fichier est SÉPARÉ d'`interface.test.js` exprès. Celui-là vérifie aussi
 * que `dist/` est synchrone avec les sources — or l'outil de mutation modifie
 * `server.js` en place, ce qui fait diverger `dist/` et rend le fichier rouge
 * quoi qu'il arrive. Un mutant y aurait été déclaré « détecté » sans que la
 * moindre assertion sur le PowerShell ait mordu.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SERVEUR = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

describe('Icône de notification — le script qu’on ne peut pas lancer', () => {
  const PS = (/const SYSTRAY_PS1 = `([\s\S]*?)`;/.exec(SERVEUR) || [])[1];
  test('le script est bien extractible du serveur', () => {
    assert.ok(PS && PS.length > 500, 'SYSTRAY_PS1 introuvable ou vide');
  });

  test('il sonde /api/ping, JAMAIS /api/state', () => {
    // Le défaut qui cassait l'arrêt automatique. `/api/state` remet
    // `lastUiPollAt` à jour : sondé toutes les 1,5 s, le veilleur n'a plus
    // jamais ses 8 s de silence et Cascade ne se ferme plus tout seul.
    assert.match(PS, /Invoke-RestMethod -Uri "\$base\/api\/ping"/,
      'le sondage d’état doit passer par /api/ping');
    assert.equal(/\$base\/api\/state/.test(PS), false,
      '/api/state réarmerait l’arrêt automatique — et renvoie 100× trop de données');
  });

  test('trois échecs d’affilée avant de partir, pas un seul', () => {
    // Un pic de charge en plein show fait dépasser le délai de 3 s. Partir au
    // premier échec ferait disparaître l'icône pour de bon : rien ne la
    // rallume sans relancer Cascade.
    assert.match(PS, /\$script:rates -ge 3/, 'le seuil de sortie doit être à 3');
    assert.match(PS, /\$script:rates = \$script:rates \+ 1/,
      'le compteur doit être en portée script, sinon chaque tick repart de zéro');
    assert.match(PS, /\$script:rates = 0/, 'et se remettre à zéro dès qu’une réponse arrive');
  });

  test('un échec de sondage lève bien une exception attrapable', () => {
    // `$ErrorActionPreference = 'SilentlyContinue'` est posé en tête. Sans
    // `-ErrorAction Stop`, le doute reste sur le déclenchement du catch — et
    // s'il ne part pas, `powershell.exe` survit à Cascade indéfiniment en
    // sondant un port mort.
    assert.match(PS, /\/api\/ping"[^\n]*-ErrorAction Stop/,
      'le sondage doit forcer l’erreur terminative');
  });

  test('tout chemin de sortie efface l’icône avant de partir', () => {
    // `TerminateProcess` n'exécute aucun finaliseur : sans NIM_DELETE
    // explicite, Windows garde une pastille morte jusqu'au passage de souris.
    assert.match(PS, /function Partir \{\s*\n\s*\$ni\.Visible = \$false/,
      'Partir doit commencer par effacer l’icône');
    const sorties = PS.match(/Application\]::Exit\(\)/g) || [];
    assert.equal(sorties.length, 1, 'un seul chemin de sortie, dans Partir : ' + sorties.length);
  });

  test('décocher la case fait partir le script de lui-même', () => {
    assert.match(PS, /Properties\['systray'\] -and -not \$e\.systray/,
      'le script doit lire `systray` sur ping pour sortir proprement');
    assert.match(SERVEUR, /killSystray\(true\)/,
      'et le serveur doit lui en laisser le temps avant de le tuer');
  });

  test('le gabarit ne peut pas casser server.js au chargement', () => {
    // C'est un littéral de gabarit JavaScript : un accent grave (échappement
    // PowerShell) ou une séquence ${…} le refermerait, et Cascade ne
    // démarrerait plus DU TOUT — pas seulement l'icône.
    assert.equal(PS.includes('${'), false, 'séquence ${ dans le PowerShell');
    assert.equal(PS.includes('\\`'), false, 'accent grave échappé dans le PowerShell');
  });

  test('le fichier .ps1 part avec un BOM', () => {
    // PowerShell 5.1 lit un .ps1 sans BOM dans la page de codes ANSI, pas en
    // UTF-8. Le script est ASCII pur aujourd'hui, donc ça marcherait — mais
    // le premier accent ajouté casserait tout, très loin d'ici.
    assert.match(SERVEUR, /writeFileSync\(fichier, '﻿' \+ SYSTRAY_PS1\)/,
      'le BOM doit précéder le script');
  });

  test('un échec de lancement se voit dans les logs', () => {
    // Trois bâillons superposés (stdio ignore, SilentlyContinue, catch vide)
    // rendaient tout diagnostic impossible. Pour une fonction jamais
    // exécutée, c'est le premier essai chez Pym qui ne remonterait rien.
    assert.match(SERVEUR, /icône de notification[^\n]*PowerShell a quitté \(code/,
      'le code de sortie de PowerShell doit être journalisé');
  });});
