# Cascade — séquenceur LED pour MadMapper

App web (Node.js zéro dépendance + page unique) qui pilote les fixtures DMX de
MadMapper en OSC : multi-chasers, vagues, couleur, presets, MIDI/OSC, Ableton
Link. v1.3.0 · MIT · Pierre-Yves Mansour — Collectif WSK. Travail en **français**.

## À lire EN PREMIER

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
- **`npm test`** (= `node --test`) : 55 tests, zéro dépendance. **À lancer avant
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

Le chantier v1.3 « spectacle » (features de chase, UI premium, tests, audit,
exécutables, manuel, CHANGELOG) est **livré** — voir `CHANGELOG.md`.

Le reste des pistes (sync phase Link, thème clair, etc.) : voir la fin de
`docs/ETAT-DU-PROJET.md`.
