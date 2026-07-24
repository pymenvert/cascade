# Cascade — état du projet (reprise de travail)

> Fichier de reprise. **À lire en premier** avant toute modification.
> Dernière mise à jour : 2026-07-24 — version **1.3.0**.
> Voir aussi `CLAUDE.md` (règles), `CHANGELOG.md` (versions), `docs/AUDIT.md` (audit).

## Identité

- **Nom** : Cascade (avant : « Chaser pour MadMapper »). Dossier renommé `Cascade` le 2026-07-09.
- **Auteur / signature** : Pierre-Yves Mansour — Collectif WSK
- **Version** : 1.2.0 · **Licence** : MIT · destiné à GitHub
- **Quoi** : séquenceur LED multi-couches qui pilote les fixtures DMX de MadMapper en OSC, depuis une page web (ordi, iPad, téléphone). Équivalent de « Chaser » (Hybrid Constructs, pour Resolume), mais pour MadMapper.

## Nouveautés v1.2 (2026-07-09)

1. **Mode application** : les lanceurs installent (fenêtre visible, une fois) puis relancent Cascade **sans terminal** — sur PC via un `.vbs` temporaire (`wscript`, fenêtre 0) qui relance le `.bat` avec l'argument `run` ; sur Mac via `nohup … & disown` + osascript qui ferme la fenêtre Terminal. `openBrowser()` cherche Chrome/Edge/Brave (`findChromish()`) et ouvre `--app=http://localhost:PORT` = fenêtre dédiée sans barre d'adresse ; à défaut, navigateur par défaut. Bouton **⏻ Quitter** → dialogue `dlgQuit` (voir 1b) → `/api/quit` (flush config + kill Carabiner + écran de fin `#byebye`, `pollTimer` arrêté).

1b. **Cycle de vie / sauvegarde** (ajouté le 2026-07-09, même journée) :
   - **Arrêt automatique** : quand plus AUCUNE interface ne poll `/api/state` depuis 8 s (`lastUiPollAt`, watchdog toutes les 2 s) → `flushConfig()` + exit. Garde-fous : jamais avant la première connexion d'une interface ; **jamais si `state.global.running`** (on ne coupe pas un show — le serveur survit à la fermeture de la fenêtre et s'arrête quand le show est stoppé) ; jamais si de l'OSC entrant est arrivé depuis <8 s (`lastOscAt`). Un rechargement de page (<1 s de trou) ne déclenche rien.
   - **`flushConfig()`** : écrit la config immédiatement (le débounce 500 ms de `saveConfig` pouvait perdre la toute dernière modif au quit). Appelé sur `/api/quit`, arrêt auto, SIGINT/SIGTERM. `saveConfig()` = débounce → `writeConfigNow()`.
   - **Nom de projet + suivi d'export** : `state.projectName` (persisté, exporté, restauré à l'import, remis à « Sans titre » sur `/api/new`). `dirtySinceExport` passe à true à chaque `saveConfig()`, à false sur `GET /api/export`, import et nouveau projet ; `lastExportAt` mémorisé. Exposé dans `/api/state` → `project { name, dirty, lastExportAt }`. `POST /api/project {name}` renomme (≤40 car.).
   - **Dialogue Quitter** (`dlgQuit`) : rappelle que la séance est TOUJOURS enregistrée automatiquement ; si `dirty`, signale « modifs non exportées » (avec date du dernier export) + champ nom + bouton « ⬇ Exporter puis quitter » (`exportProject(name)` : POST /api/project → fetch blob /api/export → téléchargement → quit après 400 ms). Le bouton 📁 Sauvegarder réutilise `exportProject` (prompt prérempli avec le nom du projet).
2. **Ableton Link** (Pulse, Live, Traktor…) via **Carabiner** (Deep Symmetry) — binaire officiel embarquant la lib Link, exposé en TCP local port 17000, téléchargé par les lanceurs dans `runtime/` (`carabiner.exe` / `carabiner`). Zéro dépendance npm conservée (client `net` maison, parse EDN par regex `:bpm`/`:peers`). Toggle **⧉ ABLETON LINK** dans le panneau Vitesse ; BPM session → `stepMs` de **toutes** les couches (1 beat = 1 pas, borné 30–2000 ms), chaque couche garde sa « Vitesse » ×0.1–×4. Quand Link actif : slider Temps/pas, TAP, ÷2, ×2 désactivés côté UI, `tap()` neutralisé côté serveur. `state.settings.linkEnabled` persisté (réactivé au boot). API : `POST /api/link {enabled}` ; état dans `/api/state` → `link {active, connected, bpm, peers, error}` ; OSC : `/cascade/link 0-1`. Cascade lance Carabiner lui-même (spawn, `windowsHide`), le tue au disable/quit/exit ; se connecte d'abord au cas où un Carabiner tourne déjà ; ~20 tentatives à 700 ms puis erreur propre (binaire absent → message « relance le lanceur »).
3. **Charte graphique** reprise du manuel : orange signature `#f2900f` (`--accent`), anthracite profond, titres de sections orange espacés avec filet fin (`h2` border-bottom), panneaux radius 14 + ombre, TAP orange plein avec glow, `--accent2` devenu gris-bleu neutre (axes miroirs, hints), footer façon PDF (filet orange centré + signature orange). `button[disabled]`/`input[disabled]` à .35.

## Nouveautés v1.3.0 (2026-07-24)

### Fonctions de chase (inspirées des consoles lumière)

Six nouveaux champs par couche, tous **neutres par défaut** (aucune régression) :

| Champ | Bornes | Sémantique |
|---|---|---|
| `floor` | 0–1 | Niveau bas : `v = floor + (1-floor)·v`, appliqué après `invert`, avant `level`. |
| `phase` | 0–360 | Décalage dans le cycle. **Steps** : converti en ms (`phaseMs`) → décale l'origine, donc suit le tempo. **Wave** : ajouté à `t`. Ignoré si `oneShot`. |
| `swing` | −75…75 | Retarde les pas impairs de `swing/100 · stepDur/2` (fonction `stepStart(k)`). |
| `blocks` | 1–8 | Le motif joue en parallèle sur N tronçons de `cellsPerBlock` cellules. |
| `oneShot` | bool | Ne déclenche plus au-delà de `k >= cellsPerBlock`. Relancé par `resync(id)` = bouton GO. |
| `sparkle` | 0–1 | Gain aléatoire par déclenchement, stocké dans `e.gain` (Map par fixture). |

Plus, en global : `dimmer` (`linear|square|sqrt`), appliqué **après** le master
sur la valeur envoyée (`DIMMERS`).

⚠ **Pièges** : `phase` est en **millisecondes** en interne pour les steps (pour
suivre le tempo) ; `blocks` ≠ `group` (`group` épaissit un pas, `blocks` duplique
le motif). Le swing décale les **temps de déclenchement**, pas la détection de
pas — d'où la boucle `while (stepStart(step+1) <= now)`.

### Fiabilité (bugs trouvés, dont 3 par les tests)

1. `forceResend()` — le cache `lastLum`/`lastRGB` n'était pas vidé au changement
   de `global.param` : la nouvelle adresse ne recevait jamais les valeurs
   inchangées. Vidé aussi au START (un show réaffirme toujours tout).
2. `readBody()` — promesse jamais résolue sur connexion coupée (`error`/`aborted`).
3. `saveConfigSoon()` — throttle 3 s pour l'OSC entrant (un fader tenu écrivait
   le disque toutes les 500 ms). Les commandes transitoires n'écrivent plus rien.
4. `loadConfig()` — tout ce qui vient du disque passe désormais par
   `sanitizeLayer` / `sanitizeFixtures` / `sanitizeGlobal` / `sanitizeSettings` /
   `sanitizeMidiMap` / `sanitizePresets`.
5. Garde-fou veille machine dans `stepValues()` (`step - lastStep > 512`).
6. `pruneCaches()` — les Maps indexées par fixture fuyaient au changement de scéno.
7. `LEGACY_FILE` ignoré si `CASCADE_CONFIG` est défini (une instance isolée
   récupérait sinon le `chaser-config.json` du dossier).

### Voyant MadMapper (point n°1 de l'audit)

L'OSC part en UDP sans accusé : sondage `/getControlValues` (ou `/getControls`)
toutes les **3 s**, `mm.lastSeen` mis à jour à chaque paquet reçu sur le port de
feedback, `alive` = vu depuis moins de **9 s**. Exposé dans `/api/state` →
`mm {alive, socketOk, error, host, port}`. Pastille `#mmLink` dans la barre du
haut, infobulle qui liste quoi vérifier.

### QR code de connexion

Bouton **QR** → dialogue `dlgQR`. Générateur maison 100 % client
(`qrMatrix`/`qrSvg` dans `index.html`) : byte mode, correction M, versions 1–10
(213 car. max), Reed-Solomon GF(256), 8 masques + pénalités, format/version info
— **validé par décodage jsQR sur toutes les versions et toutes les longueurs**.
Fond blanc obligatoire (`#qrBox`). Plusieurs cartes réseau → boutons de choix.

### Tests — `npm test` (55 tests, zéro dépendance)

`tests/helpers.js` lance un **vrai** serveur en sous-processus (ports libres,
config jetable) et écoute l'OSC réellement émis avec un décodeur **indépendant**
de celui du serveur. Fichiers : `api.test.js` (validation, presets, import/export),
`engine.test.js` (STOP silencieux, blackout, patterns, blocs, one-shot, master,
courbes, tempo à chaud), `control.test.js` (OSC entrant, tap, persistance,
paquets hostiles), `madmapper.test.js` (voyant dans les deux sens).

⚠ Deux réflexes appris en écrivant ces tests :
- `reset()` doit **tout** remettre, y compris `mirrorH/mirrorV` — sinon un test
  précédent contamine le suivant.
- Le cache d'envoi fait qu'une valeur inchangée n'est **pas** réémise : faire un
  `/api/blackout` avant de mesurer, sinon une barre déjà allumée n'apparaît pas.

### Exécutables portables

`node build.js [win|mac|mac-arm|linux]` → `build/`. Utilise `npx @yao-pkg/pkg@6`
(aucune dépendance ajoutée au projet). ⚠ **`--no-bytecode` obligatoire** : sinon
pkg doit *exécuter* le binaire de la plateforme cible. Cibles `node22-*` (les
`node18`/`node20` ne sont **pas** dans le cache distant, pkg tenterait alors de
compiler Node depuis les sources et échouerait). L'exe Windows a été testé :
API, interface servie depuis l'archive interne, config écrite à côté du binaire.

### Variables d'environnement

`CASCADE_PORT`, `CASCADE_CONFIG`, `CASCADE_OSCIN`, `CASCADE_FEEDBACK`,
`CASCADE_MMPORT`, `CASCADE_MMHOST`, `CASCADE_NO_BROWSER`, `CASCADE_NO_AUTOQUIT`.

### Interface premium

Barre de transport **collante** (STOP/BLACKOUT toujours atteignables), filet
orange animé + START qui respire pendant un show (`body.running`), halo de
préview proportionnel au niveau, pastille sur les presets occupés, anneaux de
focus clavier, `prefers-reduced-motion`.

## Arborescence

```
Cascade/
├── server.js               ← moteur + API (source de travail, ~1400 l.)
├── public/index.html       ← interface complète (source de travail, ~1500 l.)
├── build.js                ← génère les exécutables des 4 plateformes
├── tests/                  ← npm test — 55 tests, zéro dépendance
│   ├── helpers.js          ← lance un vrai serveur + faux MadMapper
│   ├── api.test.js · engine.test.js · control.test.js · madmapper.test.js
├── dist/                   ← DISTRIBUABLE : copie autonome à envoyer
│   ├── server.js           ← DOIT rester identique à ../server.js
│   ├── public/index.html   ← DOIT rester identique à ../public/index.html
│   ├── Cascade - PC.bat / Cascade - Mac.command  ← identiques à la racine
│   ├── Cascade - Manuel.pdf   (8 pages, v1.3 — généré par docs/build-manuel.py)
│   ├── LISEZ-MOI.txt
│   └── package.json
├── build/                  ← exécutables produits (ignoré par git, ~60 Mo pièce)
├── docs/
│   ├── ETAT-DU-PROJET.md      ← ce fichier
│   ├── AUDIT.md               ← audit technique (fiabilité, sécurité, à faire)
│   ├── madmapper-osc-api.md   ← API OSC MadMapper (lire avant toute recherche web)
│   └── build-manuel.py        ← génère « Cascade - Manuel.pdf » (reportlab)
├── Cascade - PC.bat / Cascade - Mac.command / Cascade - Manuel.pdf
├── LICENSE (MIT) · .gitignore · README.md · CHANGELOG.md · package.json
├── cascade-config.json     ← config runtime (générée ; ancien nom : chaser-config.json)
└── scenoled.madproject, Chaser 4.2.2 Setup.exe, Chaser.zip, serverA.js
                            ← fichiers de Pym, ne pas toucher (exclus du dépôt)
```

**⚠️ Règle n°1 : toute modif de `server.js`, `public/index.html` ou des lanceurs doit être appliquée à l'identique dans `dist/`.** Les deux copies sont actuellement synchrones.

## MadMapper — ce qui est établi (ne pas re-chercher)

- Fixtures DMX : le paramètre d'intensité s'appelle **`luminosity`** (pas `opacity`, qui vaut pour les surfaces vidéo).
- Géométrie des fixtures DMX : **`output/x`, `output/y`** (pixels de la composition, Y vers le bas) et **`output/rot`** (degrés). `output/width|height` = facteurs d'échelle, inexploitables comme longueur.
- Surfaces vidéo : `handles/N/x|y` (cartésien, centre 0,0, Y vers le haut).
- Découverte : `/getControls?root=/surfaces|/fixtures&recursive=0` · Inspection : `/getControlValues?url=<addr>/.*&normalized=0` → réponses en bundle sur le port feedback.
- Ports MadMapper : entrée **8000**, feedback **9000** (Préférences → OSC).
- Relevé complet des contrôles d'une fixture : voir `docs/madmapper-osc-api.md`.

## Carabiner / Ableton Link — ce qui est établi (ne pas re-chercher)

- Release v1.2.0 (dernière) : `https://github.com/Deep-Symmetry/carabiner/releases/download/v1.2.0/` + `Carabiner_Win_x64.zip` (contient un .exe) / `Carabiner_Mac.dmg` (binaire nu, notarisé ; extraction : `hdiutil attach -nobrowse -mountpoint`, `find … -perm +111`, cp, detach) / `Carabiner_Linux_x64.gz`.
- Protocole TCP port 17000, texte + EDN : envoyer `status\n` une fois → Carabiner **pousse** ensuite les mises à jour (max toutes les 20 ms) : `status { :peers N :bpm X :start … :beat … }`. Autres commandes : `bpm`, `beat-at-time`, `time-at-beat`, `enable-start-stop-sync`, `version`.
- Pulse (Hybrid Constructs) ne parle **que** Link (pas d'OSC tempo documenté).
- Aucune implémentation Link en pur JS n'existe ; les paquets npm (`abletonlink` etc.) sont des addons natifs node-gyp → incompatibles avec le zéro-dépendance. Carabiner est LA solution.

## Architecture

**Serveur Node.js zéro dépendance** (`server.js`, ~1080 lignes) : encodeur/décodeur OSC maison sur UDP, serveur HTTP + API JSON, client TCP Carabiner, moteur à `setInterval(tick, 25)` (~40 fps). L'interface (`public/index.html`, ~1080 lignes, tout-en-un) fait du polling `/api/state` toutes les 120 ms (`pollTimer`).

### État serveur

- `state.projectName` : nom du projet (≤40 car., défaut « Sans titre ») — export/import/quit
- `state.settings` : `mmHost, mmPort (8000), feedbackPort (9000), httpPort (3333), oscInPort (7000), linkEnabled (bool)`
- `state.fixtures[]` : `{ id, name, address, enabled, x, y, rot, len, vert }` (x/y normalisés 0–1)
- `state.layers[]` (max 8, une couche = un séquenceur) :
  `{ id, name, enabled, engine: 'steps'|'wave', target: 'intensity'|'color', bars: null|[ids],
     pattern, mode: 'onoff'|'fade', curve, waveform, stepMs, speed, width, group,
     mirrorH, mirrorV, axisX, axisY, fadeInPct, fadeOutPct, invert, level, colorA, colorB,
     phase, swing, floor, blocks, oneShot, sparkle }`  ← les 6 derniers = v1.3
- `state.global` : `{ running, speed, master, param: 'luminosity', dimmer: 'linear' }`
- `state.presets[16]` : `{ name, layers[], fixtures[] }` — mémorise aussi la disposition
- `state.midiMap` : `{ 'cc:ch:num' | 'note:ch:num' → cible }`
- `link` (hors state, runtime) : `{ active, connected, bpm, peers, error }` + `linkSock/linkChild/linkRetry`

### Sémantique importante

- **`group`** = « Barres par pas » : blocs de N barres allumées **strictement simultanément**.
- **`width`** = « Tenue (traîne) » : nb de pas pendant lesquels une barre reste allumée.
- **Miroirs spatiaux** : le pattern tourne sur les barres du côté source de l'axe ; le reflet est la barre la plus proche du point symétrique (positions réelles). Les barres « orphelines » (sur l'axe) sont réintégrées via un set `covered`.
- **STOP relâche le contrôle** : `tick()` sort tôt si `!running` → **aucun envoi OSC**, MadMapper garde son dernier état. Seul **BLACKOUT** force des zéros.
- **Rythme stable** : si `stepMs`/`speed` change en live (y compris via Link), la phase est rebasée (`engine.stepDur`) — jamais de pause ni de rafale. Un retrigger sur une barre encore allumée reprend l'attaque au niveau courant (`engine.lastEnv`).
- **Link → stepMs** : `applyLinkBpm()` écrit `L.stepMs` directement ; le moteur rebase tout seul. `saveConfig()` (débouncé 500 ms) appelé seulement si la valeur entière a changé.
- **Moteur vague** : `period = stepMs × group`, largeur = `width/8` de la scène, patterns `lr|rl|tb|bt|pulse|radial`.
- **Mix** : couches d'intensité en HTP (max) ; couleur = lerp A→B sur `color/red|green|blue` (max par canal) ; si seules des couches couleur existent, `luminosity` est forcée au master pour rester visible.
- **Instance unique** : `/api/ping` renvoie `{app:'Cascade'}`. Sur `EADDRINUSE`, on sonde le port : si c'est Cascade → `openBrowser()` + `process.exit(0)` ; sinon on essaie port+1 (10 fois).
- **Resync** : `resync(layerId?)` supprime l'état runtime (`engines`) → la phase repart maintenant.

### API HTTP

`GET /api/ping` · `GET /api/state` · `GET /api/export`
`POST` : `/api/layer {id,set}` · `/api/layers {action:add|remove,id}` · `/api/global {speed,master,param}` · `/api/preset {action:save|recall|clear, slot}` · `/api/resync {id?}` · `/api/link {enabled}` · `/api/quit` · `/api/project {name}` · `/api/start` · `/api/stop` · `/api/blackout` · `/api/tap {id}` · `/api/fixtures {fixtures}` · `/api/discover` · `/api/layout` · `/api/inspect {index}` · `/api/test {index}` · `/api/midimap {map}` · `/api/settings` · `/api/import` · `/api/new {keepFixtures}`

Toutes les entrées sont validées/bornées (`sanitizeLayerSet`, `sanitizeLayer`, `sanitizeFixtures`, `cnum`, `ENUMS`).

### Contrôle externe

- **OSC entrant** port **7000**. Préfixe `/cascade/…`, `/chaser/…` accepté (rétrocompat) :
  `start stop blackout tap resync link master speed preset/1..16`
  `layer/N/level|stepms|speed|pattern|enable|invert|mirrorh|mirrorv|width|group|tap|resync`
  Valeurs 0–1 ; vitesses : 0.5 = ×1 (courbe log ×0.1–×4) ; pattern = 6 zones.
- **MIDI** : Web MIDI **dans le navigateur** (Chrome/Edge uniquement — pas de lib native côté Node). Dialogue 🎹 avec « Learn » par cible, throttle CC 60 ms. Cibles `sel.*` = couche en cours d'édition.
- **Ableton Link** : voir Nouveautés v1.2 ci-dessus.

### Interface

Barre du haut : badge réseau 📱 (adresse LAN cliquable → copie), bouton **QR** (popup QR code de l'adresse), START / STOP / BLACKOUT, 🎹 MIDI, 📁 Projet, ⚙ Réglages, **⏻ Quitter**. Puis 16 slots de presets, préview, 3 panneaux (Fixtures / Couches / Tempo — avec bouton **⧉ ABLETON LINK** + `#linkStatus`), vue spatiale, footer signé façon manuel.

Interactions : **double-clic ou double-tap** (helper `onDblTap`, anti-rebond 500 ms) = pivoter une barre, renommer une couche, réinitialiser un paramètre (constante `DEFAULTS`). **Espace** = tap, **R** = resync. iPad : `pointer:coarse` agrandit les cibles, 2 colonnes entre 700–1180 px, dialogues en 16 px (anti-zoom iOS).

## Pièges connus (importants)

1. **Le montage sandbox sert des lectures tronquées** des fichiers édités (plafonnées à leur ancienne taille). `wc -c`, `cat`, `cp`, `node --check` via bash donnent alors des résultats faux. → **Vérifier avec l'outil Read**, et pour tester, reconstruire une copie dans `/tmp` (en v1.2 : travail fait entièrement dans `/tmp/cascade` puis commit via device_commit_files — bonne méthode).
2. **Impossible de compiler un vrai `.exe`/`.app`** dans l'environnement : `pkg`, `@yao-pkg/pkg`, `postject` et `nodejs.org/dist` sont bloqués (403 allowlist). GitHub releases (Carabiner) aussi bloqué **dans le sandbox** — mais téléchargeable sur la machine de l'utilisateur (les lanceurs s'en chargent). D'où : lanceurs `.bat`/`.command` qui téléchargent Node portable + Carabiner, et « mode app » via `--app=` de Chrome/Edge.
3. **macOS + WhatsApp/mail** : le `.command` arrive en quarantaine → « fichier endommagé » / Terminal −128. Fix utilisateur : `xattr -cr <dossier>` puis `chmod +x <.command>`. Documenté dans `LISEZ-MOI.txt` et le manuel. Seule solution définitive : signer + notariser (compte Apple Developer, 99 $/an).
4. **Manuel PDF** : régénéré en v1.2 (Link, mode app, quitter, sauvegarde). Le script est désormais **conservé** : `docs/build-manuel.py` (`python3 build-manuel.py <dossier_sortie>`, reportlab + polices DejaVu). ⚠️ DejaVu n'a **pas** les glyphes ⏻ (U+23FB) ni ⧉ (U+29C9) ni les exposants/indices Unicode — ils rendent des carrés vides : écrire les mots (« bouton Quitter », « ABLETON LINK »). Copier le PDF généré à la racine **et** dans `dist/`.
5. **Playwright dans le sandbox** : `waitUntil: 'networkidle'` ne se déclenche jamais (polling 120 ms) → utiliser `domcontentloaded`.

## Historique des décisions

- Miroirs = **modificateurs** appliqués par-dessus n'importe quel pattern (logique MA Lighting), pas des patterns séparés. `outin`/`inout` restent acceptés côté serveur mais ont disparu de l'UI.
- Presets = photo complète (couches **+** ordre des fixtures **+** vue spatiale), pour changer de scéno d'un clic.
- Sauvegarde config atomique (`.tmp` → rename) + `.bak` restauré au démarrage.
- `uncaughtException` / `unhandledRejection` / `tick` try-catch : une erreur ne coupe jamais le show.
- **v1.2** : Link = Carabiner plutôt qu'un addon natif (zéro-dép) ou Electron (trop lourd). BPM Link → toutes les couches (choix de Pym), pas de case par couche. Mode app = `--app` Chrome/Edge plutôt qu'un vrai .exe (impossible à builder ici, et suffisant à l'usage). Charte : sombre conservé (scène), orange du manuel `#f2900f` en accent unique, `--accent2` neutre.

## Pistes non réalisées

**Demandées explicitement par Pym (prioritaires — détail dans `CLAUDE.md`) :**

- **Icône systray** : point vert/rouge = serveur en route/arrêté ; clic droit → ouvrir l'interface / démarrer / arrêter. Objectif : pouvoir fermer la fenêtre en laissant le serveur tourner, tout en le voyant. (⚠ zéro-dep : pas de systray en Node pur — solution à discuter.)
- **Capture ou GIF dans le README** : le seul point des « finitions GitHub » qui reste (nécessite une vraie session avec MadMapper).
- **Suite de l'audit** (`docs/AUDIT.md`, section « À faire ») : code d'accès facultatif à 4 chiffres, repli « avancé » du panneau Couches, tests d'interface Playwright, signature/notarisation macOS.

**Autres pistes :**

- Sync phase Link (aligner les pas sur les beats via `beat-at-time`, resync auto sur le temps fort) — v1.2 ne suit que le BPM.
- Horloge MIDI en alternative à Link.
- Séquenceur pas-à-pas dessinable (grille barres × pas).
- Thème clair.
- Rendre `dist/` un vrai build généré au lieu d'une copie manuelle.
