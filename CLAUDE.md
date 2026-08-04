# Cascade — séquenceur LED pour MadMapper

App web (Node.js zéro dépendance + page unique) qui pilote les fixtures DMX de
MadMapper en OSC : multi-chasers, vagues, couleur, presets, MIDI/OSC, Ableton
Link. **2.0.2** · MIT · Pierre-Yves Mansour — Collectif WSK. Travail en **français**.

## À lire EN PREMIER

**`docs/V2-AXES-PISTES.md`** — comment projeter une texture sur l'axe qu'on veut.
Toutes les pistes explorées, celles retenues comme celles écartées, avec les
mesures qui les tranchent. **À lire avant de reparler d'axes ou de dispositions.**

**`docs/ETAT-DU-PROJET.md`** — architecture complète, sémantique des paramètres,
API MadMapper et Carabiner/Link déjà établies (ne pas re-chercher), pièges
connus, historique des décisions, TODO. Sans ça, tu vas redécouvrir des choses
qui ont déjà coûté cher. `docs/madmapper-osc-api.md` = référence OSC MadMapper.

## Règles non négociables

1. **`dist/` est une copie manuelle du distribuable** : toute modif de
   `server.js`, `public/index.html`, des lanceurs ou du manuel PDF doit être
   recopiée à l'identique dans `dist/`. Vérifier avec `diff` avant de finir.
2. **Zéro dépendance npm** côté serveur (encodeur OSC maison, client TCP
   Carabiner maison). Ne pas introduire de paquet sans accord explicite de Pym.
3. Fixtures DMX MadMapper : intensité = `luminosity` (pas `opacity`),
   géométrie = `output/x`, `output/y`, `output/rot`.
4. **STOP relâche le contrôle** (aucun envoi OSC) ; seul BLACKOUT envoie des
   zéros. Ne jamais casser cette sémantique, ni la préservation de phase du
   tempo, ni la protection « on ne coupe jamais un show » de l'arrêt auto.
5. Manuel PDF : regénérer avec `python3 docs/build-manuel.py <dossier_sortie>`
   (reportlab + DejaVu ; pas de glyphes ⏻ ⧉ ni d'exposants Unicode → carrés vides).
6. Édits ciblés (Edit/Grep) plutôt que réécritures ; réponses concises ;
   économiser les tokens (préférence explicite de Pym).
7. Ne pas toucher : `scenoled.madproject`, `Chaser 4.2.2 Setup.exe`, `serverA.js`.

## Lancer / tester

- `node server.js` → http://localhost:3333 (config générée : `cascade-config.json`).
- **`npm test`** (= `node --test`) : 290 tests, zéro dépendance. **À lancer avant
  de conclure toute modif du serveur.** ⚠ `node --test tests/` échoue sur Node 24
  (chemin pris pour un module) — utiliser `node --test` tout court.
- Instance isolée pour tester à la main : `CASCADE_PORT=3461 CASCADE_NO_BROWSER=1
  CASCADE_NO_AUTOQUIT=1 CASCADE_CONFIG=/tmp/x.json node server.js` (voir aussi
  `CASCADE_OSCIN`, `CASCADE_FEEDBACK`, `CASCADE_MMPORT`, `CASCADE_MMHOST`).
- Faux Carabiner = serveur TCP local port 17000 qui pousse
  `status { :peers 1 :bpm 128.0 ... }\n`.
- UI : les 43 tests d'interface pilotent un vrai navigateur en CDP maison
  (`tests/browser.js`, zéro dépendance) — **pas** Playwright. Sans navigateur ils
  s'annoncent ignorés SANS faire rougir la suite : vérifier le compte (290), pas
  la couleur. `CASCADE_NAVIGATEUR=<binaire>` impose un navigateur ;
  `PLAYWRIGHT_BROWSERS_PATH` est balayé tout seul. Si tu passes par Playwright
  à la main, `waitUntil: 'domcontentloaded'` (`networkidle` ne vient jamais,
  l'UI poll toutes les 120 ms).
- Exécutables : `node build.js` → `build/` (voir `docs/ETAT-DU-PROJET.md` pour
  les pièges pkg : `--no-bytecode` obligatoire, cibles `node22-*` seulement).
- Manuel : `python docs/build-manuel.py <dossier>` (reportlab ; les polices sont
  détectées automatiquement selon la plateforme).

## La 2.0 est SORTIE (2026-07-28)

`v2` a été fusionnée dans `main` et taguée `v2.0.0`, sur décision explicite de
Pym. **Le développement continue sur `main`** — la branche `v2` n'a plus de
raison d'être.

**Intégration continue et release, depuis la 2.0** (le dépôt n'avait rien avant) :

- `.github/workflows/tests.yml` — `npm test` sur chaque push vers `main` et sur
  chaque PR. Vérifie aussi qu'**aucune dépendance npm** n'a été introduite.
- `.github/workflows/release.yml` — pousser un tag `vX.Y.Z` construit les quatre
  exécutables et publie la release avec eux en pièces jointes. La description
  vient du CHANGELOG via `tools/notes-version.js`, jamais d'un texte recopié.
  Republier : onglet Actions → Release → « Run workflow », en donnant le tag.

⚠ **Attendre la CI verte avant de taguer.** Elle attrape ce qui est invisible en
local : courses de timing sur runner lent, chemins spécifiques à Windows.

Livré et testé : page Scène 3D et manipulation souris · moteur Champ 3D
(5 formes, netteté, course, bruit dirigé) · vues par axe avec bascule de
dossiers et fondu · 7 modes de fusion · perspective atmosphérique · palette à
N arrêts, branchable sur la profondeur ou la hauteur · décalage réparti ·
crossfader A/B · modulateurs (LFO) par couche et global · coupure de secours · renvoi de disposition · démos · repère 3D.

**290 tests, 30 mutations sur 30 détectées.** Manuel PDF, README, CHANGELOG et
exécutables des 4 plateformes sont à jour ; l'exécutable Windows a été lancé et
interrogé pour de vrai.

Trois garde-fous à connaître avant de toucher au code :

- `npm test` échoue si `dist/` diverge des sources (règle n°1 automatisée) ;
- un test vérifie qu'**aucun mutant de `tests/mutations-liste.js` n'est resté**
  dans `server.js` — un commit est parti comme ça le 28/07, suite verte, la
  palette spatiale morte en silence ;
- `build-manuel.py` refuse de générer si un caractère manque à la police.

✅ **Suiveur audio et grille de presets sont LIVRÉS** (2026-08-04) — ne pas les
reprendre. Le micro est une *source de modulateur* (`src: 'lfo' | 'audio'`),
analysé en Web Audio côté page et poussé en query sur le poll. ⚠ Il lit une
**énergie, pas un tempo**, et n'est lisible que sur la machine hôte (origine
sûre) : les deux limites sont assumées, écrites, et **décidées avec Pym** — ne
pas rouvrir sans lui. La détection de battement attend un essai en salle.

Ce qui reste, par ordre de valeur : les **deux** mesures MadMapper non faites
(empreinte d'une barre en pixels, DMX Filtering), et « dessiner les fixtures » —
qui attend d'abord un `Export Fixture Definitions…` depuis MadMapper. Détail
dans `docs/V2-INSPIRATIONS.md` et `docs/V2-AXES-PISTES.md`.

✅ **Le pivot de `output/rot` est mesuré** (2026-07-29) : la rotation ne
translate pas la fixture (écart 0,00 en x et y), donc l'ordre position/rotation
est libre. C'était la troisième mesure ; elle est faite.

## Prochaines demandes de Pym (exprimées, PAS encore réalisées)

1. **Icône de zone de notification (systray)** : point vert = serveur en route,
   rouge = arrêté ; clic droit → ouvrir l'interface / démarrer / arrêter le
   serveur. Idée : pouvoir fermer la fenêtre en laissant tourner le serveur
   tout en le voyant. ⚠ Contrainte zéro-dépendance : pas de systray natif en
   Node pur — pistes à discuter avec Pym (petit utilitaire par plateforme,
   PowerShell/AppleScript, ou accepter une dépendance ici).
2. **Capture ou GIF dans le README** — nécessite une vraie session MadMapper.
3. Suite de l'audit : voir la section « À faire » de `../Cascade-AUDIT.md` (hors dépôt)
   (code d'accès 4 chiffres, repli « avancé » du panneau Couches, tests d'UI).
4. **`../Cascade-RELECTURES.md` (hors dépôt)** — état des deux campagnes de
   relecture par agents. ⚠ Ce fichier vit **hors du dépôt** : il est absent des
   clones frais (sessions distantes, CI), donc ne jamais faire dépendre une
   décision de son contenu sans l'avoir sous les yeux.

   ⚠ **Les deux « défauts déjà en v1 » que ce fichier signalait sont CORRIGÉS**
   — vérifié dans le code le 2026-08-04, ne pas repartir les chasser :
   - *couche couleur qui allume les barres qu'elle ne pilote pas* → `mixLevel()`
     décide barre par barre (`server.js`) ; la forme fautive globale
     (`mix.anyCol`) a disparu. Corrigé par `648327c`, listé `CHANGELOG.md:213`,
     couvert par `tests/regressions.test.js`.
   - *phase non préservée au changement de tempo (moteur vague)* → `phaseContinue()`
     intègre `dt / period` au lieu de `now / period` ; le chaser, lui, rebase
     `startTime`. Corrigé par `619bee8`, listé `CHANGELOG.md:215`, couvert par
     `tests/regressions.test.js` (`stepMs` 10000 → 9999, écart < 0,05).

   La relecture s'était arrêtée avant sa phase de vérification : ses trouvailles
   n'étaient **pas** confirmées contradictoirement, et celles-là étaient périmées.
   Traiter le reste de la liste avec la même prudence — vérifier dans le code
   avant d'y croire.

   **Piste restée ouverte, elle, et non couverte** : `resolveBars()` replie sur
   *toutes* les barres actives quand le groupe d'une couche est vide. Vider un
   groupe (au lieu de le supprimer, qui remet `L.groupId = null`) fait donc
   basculer une couche couleur sur tout le plateau. Comportement délibéré et
   documenté, mais c'est la seule voie vivante qui reproduit le symptôme
   d'origine, et aucun test ne la couvre.

Le chantier v1.3 « spectacle » (features de chase, UI premium, tests, audit,
exécutables, manuel, CHANGELOG) est **livré** — voir `CHANGELOG.md`.

Le reste des pistes (sync phase Link, thème clair, etc.) : voir la fin de
`docs/ETAT-DU-PROJET.md`.
