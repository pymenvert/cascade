# Cascade — séquenceur LED pour MadMapper

App web (Node.js zéro dépendance + page unique) qui pilote les fixtures DMX de
MadMapper en OSC : multi-chasers, vagues, couleur, presets, MIDI/OSC, Ableton
Link. v1.6.0 sur `main`, 2.0.0-dev sur `v2` · MIT · Pierre-Yves Mansour — Collectif WSK. Travail en **français**.

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
- **`npm test`** (= `node --test`) : 240 tests, zéro dépendance. **À lancer avant
  de conclure toute modif du serveur.** ⚠ `node --test tests/` échoue sur Node 24
  (chemin pris pour un module) — utiliser `node --test` tout court.
- Instance isolée pour tester à la main : `CASCADE_PORT=3461 CASCADE_NO_BROWSER=1
  CASCADE_NO_AUTOQUIT=1 CASCADE_CONFIG=/tmp/x.json node server.js` (voir aussi
  `CASCADE_OSCIN`, `CASCADE_FEEDBACK`, `CASCADE_MMPORT`, `CASCADE_MMHOST`).
- Faux Carabiner = serveur TCP local port 17000 qui pousse
  `status { :peers 1 :bpm 128.0 ... }\n`.
- UI : Playwright dispo ; utiliser `waitUntil: 'domcontentloaded'`
  (`networkidle` ne vient jamais, l'UI poll toutes les 120 ms).
- Exécutables : `node build.js` → `build/` (voir `docs/ETAT-DU-PROJET.md` pour
  les pièges pkg : `--no-bytecode` obligatoire, cibles `node22-*` seulement).
- Manuel : `python docs/build-manuel.py <dossier>` (reportlab ; les polices sont
  détectées automatiquement selon la plateforme).

## Où en est la v2 (branche `v2`, au 2026-07-28)

`main` reste la **1.6.0** intacte. La branche `v2` s'annonce **2.0.0-dev** —
délibérément, tant qu'elle n'est pas sortie. **Elle n'est pas fusionnée, et
c'est la décision de Pym, pas la tienne.**

Livré et testé : page Scène 3D et manipulation souris · moteur Champ 3D
(5 formes, netteté, course, bruit dirigé) · vues par axe avec bascule de
dossiers et fondu · 7 modes de fusion · perspective atmosphérique · palette à
N arrêts, branchable sur la profondeur ou la hauteur · décalage réparti ·
crossfader A/B · modulateur (LFO) par couche · coupure de secours · renvoi de disposition · démos · repère 3D.

**240 tests, 18 mutations sur 18 détectées.** Manuel PDF, README, CHANGELOG et
exécutables des 4 plateformes sont à jour ; l'exécutable Windows a été lancé et
interrogé pour de vrai.

Trois garde-fous à connaître avant de toucher au code :

- `npm test` échoue si `dist/` diverge des sources (règle n°1 automatisée) ;
- un test vérifie qu'**aucun mutant de `tests/mutations-liste.js` n'est resté**
  dans `server.js` — un commit est parti comme ça le 28/07, suite verte, la
  palette spatiale morte en silence ;
- `build-manuel.py` refuse de générer si un caractère manque à la police.

Ce qui reste, par ordre de valeur : suiveur audio et modulateur global (le
modulateur par couche existe), grille visuelle des 16 presets, les trois mesures MadMapper non faites (empreinte d'une
barre en pixels, pivot de `output/rot`, DMX Filtering), et « dessiner les
fixtures » — qui attend d'abord un `Export Fixture Definitions…` depuis
MadMapper. Détail dans `docs/V2-INSPIRATIONS.md` et `docs/V2-AXES-PISTES.md`.

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
4. **`../Cascade-RELECTURES.md` (hors dépôt) — à lire avant de reprendre la v2.**
   État des deux campagnes de relecture par agents : ce qui a été mesuré et
   exploité, ce qui reste à mesurer sur MadMapper, et **32 trouvailles sur le
   moteur de champ 3D dont trois bloquantes** — la relecture s'est arrêtée avant
   la phase de vérification, donc rien n'y est confirmé contradictoirement.
   Deux de ces défauts sont **déjà en v1** (couche couleur qui allume les barres
   qu'elle ne pilote pas ; phase non préservée au changement de tempo pour le
   moteur vague).

Le chantier v1.3 « spectacle » (features de chase, UI premium, tests, audit,
exécutables, manuel, CHANGELOG) est **livré** — voir `CHANGELOG.md`.

Le reste des pistes (sync phase Link, thème clair, etc.) : voir la fin de
`docs/ETAT-DU-PROJET.md`.
