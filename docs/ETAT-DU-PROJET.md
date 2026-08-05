# Cascade — état du projet (reprise de travail)

> Fichier de reprise. **À lire en premier** avant toute modification.
> Dernière mise à jour : 2026-08-05 — version **2.0.2**, plus quatre fonctions
> **non publiées** : grille de presets, suiveur audio, replis du panneau Couches,
> code d'accès. ⚠ La prochaine version est donc une **MINEURE (2.1.0)**.
> Voir aussi `CLAUDE.md` (règles) et `CHANGELOG.md` (versions).
> L'audit technique vit **hors du dépôt** : `../Cascade-AUDIT.md`. ⚠ Il est donc
> **absent des clones frais** (sessions distantes, CI) : ne jamais faire dépendre
> une décision de son contenu sans l'avoir sous les yeux. Même chose pour
> `../Cascade-RELECTURES.md`.
>
> ⚠ Les sections « Nouveautés v1.x » plus bas sont conservées comme **historique**.
> Pour l'état courant, se fier à `CHANGELOG.md` et à ce préambule.

## Identité

- **Nom** : Cascade (avant : « Chaser pour MadMapper »). Dossier renommé `Cascade` le 2026-07-09.
- **Auteur / signature** : Pierre-Yves Mansour — Collectif WSK
- **Version** : 2.0.2 · **Licence** : MIT · publié sur GitHub
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

## Moteur de champ 3D (livré en 2.0.0)

✅ **`v2` a été fusionnée dans `main` et taguée `v2.0.0` le 2026-07-28. La
branche `v2` n'a plus de raison d'être ; le développement continue sur `main`.**
Cette section décrit du code **livré**, pas un chantier. Elle contient
tout ce qui précède PLUS un moteur de champ 3D : les barres ont une position en
mètres (`p3`) et un champ scalaire les traverse selon une forme, un axe, une
source, une étendue, une netteté, une course, une dérive. S'y ajoutent les
modes de fusion, la perspective atmosphérique, la palette à N arrêts, les
vues, la scène 3D et le décalage réparti.

**Formes du champ** : `plan` · `sphere` · `cylindre` · `boite` · `bruit`.

⚠ **`boite` = pavé MOBILE, pas des coques.** On ne mesure pas une distance :
on teste l'appartenance à un volume qui traverse le plateau une fois par cycle
le long de l'axe. Bords francs, un bloc de barres qui se déplace. La version
précédente mesurait une distance de Tchebychev — mesuré sur un rig plan :
66 % de valeurs intermédiaires contre 68 % pour la sphère, autrement dit les
deux formes étaient **indiscernables** là où ça compte, toutes les barres
partageant leur profondeur et leur hauteur. `duty` commande la dureté du bord,
`width` la taille du pavé.

⚠ **`mixLevel` décide BARRE PAR BARRE, jamais globalement.** Il testait
`mix.anyInt` — vrai dès qu'une couche d'intensité existait n'importe où — puis
lisait `lum.get(id) || 0`. Mesuré : un wash de couleur sur les contres tombait
à zéro dès qu'on ajoutait un chase sur le sol. Ne jamais revenir à un test
global ; `regressions.test.js` le verrouille.

⚠ **Une couche seule joue toujours, quel que soit son mode de fusion.** Un
fond absent est NEUTRE : sans cette règle, une couche en multiplication
s'annulerait elle-même et on croirait à une panne. Vérifié à la mesure pour
`htp`, `sub`, `mul` et `min` — ce n'est pas un défaut, c'est le comportement
voulu.

⚠ **Les tests sont sensibles à la charge.** La suite lance une dizaine de
serveurs et un navigateur en parallèle. Un test qui mesure une grandeur qui
évolue doit avoir un cycle LONG devant le bruit de charge. Et un test qui
échoue saute son nettoyage : quand deux échecs apparaissent ensemble, le
second est souvent une victime. Élargir une fenêtre au hasard a déjà fait
passer une suite de 1 à 19 échecs — c'est une passe à faire posément.

## Nouveautés v1.6.0 (2026-07-25)

### Synchro de phase Ableton Link

Le BPM seul ne suffit pas : même tempo ≠ même moment. On cale désormais chaque
pas sur la grille de beats de Link.

**Le principe** : `beat` (Carabiner) et `Date.now()` sont **deux horloges
différentes** — on ne les compare jamais. On note « à cet instant local, on
était au beat B » (`linkClock = {anchorLocal, anchorBeat, bpm}`), puis on
extrapole. `linkGrid(now)` rend `{beat, beatMs}` ou `null`.

Dans `stepValues`, quand la grille est là :
```
stepDur = beatMs / (speed × globalSpeed)
origin  = now − beat × parBeat × stepDur − phaseMs
```
`origin` est **recalculé à chaque tick** depuis la position réelle : aucune
dérive possible. Le pas 0 tombe sur le beat 0, donc sur un temps fort.

⚠ **Pièges rencontrés — à ne pas réintroduire :**
1. **Carabiner ne pousse pas en continu**, il pousse sur changement. Sans le
   `status` renvoyé toutes les `LINK_POLL_MS` (400 ms), la grille se périme.
   `LINK_CLOCK_TTL` (4 s) coupe la confiance si le flux s'arrête.
2. **Un moteur neuf doit ENTRER dans la grille au pas courant**
   (`if (e.lastStep < 0) e.lastStep = step - 1`). Sinon, l'origine étant le
   beat 0 de la session — vieux de plusieurs heures — un START rejoue tous les
   pas écoulés d'un seul tick.
3. **`oneShot` garde son origine libre** : le coup part au GO, pas au beat.
4. En mesurant l'alignement, ne compter que les **transitions** 0→1 : le
   keep-alive réémet la valeur courante chaque seconde et se ferait passer
   pour un allumage à un instant quelconque.
5. Le **premier** allumage après START est volontairement hors grille : un show
   démarre quand on appuie.

Réglages : `settings.linkPhase` (défaut **true**), `settings.linkQuantum`
(1–16, défaut 4, sert au témoin). API `POST /api/link {phase, quantum}`,
OSC `/cascade/linkphase`. État : `link {phaseOn, quantum, locked, phase}`.

UI : `#linkPhaseBox` (visible seulement si Link actif), témoin `#beats`
(un point par temps, le premier marqué `fort`).

### Tests Link — faux Carabiner

`tests/link.test.js` ouvre un serveur TCP sur 17000 qui répond aux `status`
avec un beat qui avance vraiment. ⚠ Le test **saute proprement** si le port est
déjà pris (vrai Carabiner). ⚠ `skip` étant évalué à la *définition* des tests,
la vérification asynchrone passe par `t.skip()` **dans** le test.

⚠ La suite tourne en parallèle : juger l'alignement sur la **médiane**, pas sur
le max — un pic de charge retarde un tick isolé sans qu'il y ait dérive.

## Nouveautés v1.5.0 (2026-07-25)

### Groupes de barres

`state.groups[] = { id, name (≤20), bars: [fixtureIds] }`, 16 max. Une couche
les référence par `L.groupId` — **lien vivant, pas une copie**.

`resolveBars(L, enabled)` tranche, dans cet ordre : `groupId` → barres du
groupe · sinon `bars` → sélection manuelle · sinon toutes.
⚠ Un groupe **vide ou disparu retombe sur TOUTES les barres**, jamais sur
aucune : une couche muette sans explication coûte plus cher en régie qu'une
couche qui éclaire trop.

- `/api/groups {action: add|remove|rename|set, id, name, bars}`. `remove`
  libère les couches (`L.groupId = null`).
- Persistés, exportés, importés, assainis (`sanitizeGroups` : ids en double
  écartés, noms bornés, barres dédoublonnées).
- **Pas dans les presets** : un groupe appartient à la scéno, pas au look.
  `POST /api/new` sans `keepFixtures` les efface avec les fixtures.
- UI : panneau Fixtures (`#groupChips`), sélecteur `#layerBars` par couche.
  `assignMode` vaut maintenant `null | {type:'layer'} | {type:'group', id}`.

### Tests dans un vrai navigateur — `tests/browser.js` + `tests/ui.test.js`

Chrome ou Edge lancé en `--headless=new`, piloté en **CDP** via le `WebSocket`
natif de Node. Zéro dépendance.

⚠ **Ne pas lire stderr pour trouver le point d'entrée DevTools** : Chrome y
écrit « DevTools listening on… », **Edge n'écrit rien**. On interroge
`http://127.0.0.1:<port>/json/version` jusqu'à réponse.

- `Target.createTarget` + `Target.attachToTarget {flatten:true}` → `sessionId`
  à joindre à chaque message.
- Erreurs captées via `Runtime.exceptionThrown`, `Runtime.consoleAPICalled`
  (type `error`) et `Log.entryAdded` — c'est ce dernier qui a révélé le 404 du
  favicon.
- Sans navigateur : `describe(..., { skip })`, la suite ne casse pas.
- Efficacité vérifiée en cassant trois choses exprès (erreur au chargement,
  bouton débranché, injection HTML) : les trois sont attrapées.

### Icône

Favicon SVG en `data:` dans le `<head>` — aucun fichier de plus à distribuer,
et plus de 404 au chargement.

## Nouveautés v1.4.0 (2026-07-25)

- **Fondu entre presets** — `state.global.presetFade` (ms, 0–30000, 0 = sec).
  `recallPreset(i, fadeMs)` met la scène sortante de côté dans
  `fade = { start, dur, layers, fixtures, engines }`, **avec une copie de son
  état moteur** (`cloneEngine`) pour qu'elle poursuive sa course.
  - Le mix a été extrait dans `computeMix(layers, fixtures, now, store)` : deux
    scènes sont évaluées dans le même tick, puis mélangées linéairement.
  - ⚠ `eng(id, store)` prend un **magasin** : les identifiants de couche sont
    souvent identiques des deux côtés (un preset sauvé depuis les couches
    courantes), donc un seul `Map` global les ferait se marcher dessus.
  - Couleur : interpolée si les deux côtés en ont une, sinon celui qui en a une
    garde la main (éviter une teinte qui n'existe nulle part).
  - `startChase` / `stopChase` / `blackout` appellent `cancelFade()`.
    Aucun fondu si `!running`. Un nouveau rappel remplace le fondu en cours.
  - Progression exposée dans `/api/state` → `fade` (0–1 ou `null`).
  - OSC `/cascade/presetfade` (0–1 → 0–10 s) ; `fadeMs` dans le corps du POST
    force la durée d'un rappel précis.
- ⚠ **Le script de `index.html` est analysé par les tests** (`new Function`).
  Motif : une variable redéclarée dans `render()` a cassé toute la page sans
  qu'aucun des 82 tests serveur ne le voie. Ils ne touchent jamais au JS du
  navigateur — ne pas l'oublier en ajoutant des fonctionnalités d'interface.

- **Presets nommables** : `savePreset(i, name)` et `action: 'rename'` sur
  `/api/preset`. Nom borné à 16 car., vide → `P<n>`. `presetNames()` renvoie
  désormais **le nom** (ou `null`), plus `true`. ⚠ La signature de rendu des
  presets (`psig`) inclut les noms, sinon un renommage ne s'affiche jamais.
- **Repli « Groove & découpe »** (`<details id="advGroove">`) : les 6 réglages
  fins y sont regroupés. `#grooveBadge` compte ceux hors valeur neutre.
  ⚠ Le repli s'ouvre automatiquement **au changement de couche seulement**
  (`det.dataset.vu !== selId`) — ne jamais le rouvrir à chaque rendu, sinon
  l'utilisateur ne peut plus le refermer.
- **Accueil premier lancement** (`#accueil`) : visible tant que
  `S.fixtures.length === 0`, avec témoin MadMapper.
- **Raccourcis** : `S` start/stop, `B` blackout, `Espace` tap, `R` resync,
  `G` GO couche, `1`–`8` sélection, `?`/`H` aide (`#dlgAide`).
  Neutralisés en saisie, en zone éditable, avec Ctrl/Cmd/Alt, et si un
  `dialog[open]` est présent.
- **`sync-dist.js`** : `node sync-dist.js` copie, `--check` vérifie. Un test
  (`interface.test.js`) échoue si `dist/` diverge — la copie manuelle avait
  déjà failli faire livrer un `dist/` obsolète.

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

### ⚠ Règle d'affichage : jamais de donnée dans `innerHTML`

Toute donnée affichée qui vient de l'extérieur — nom de fixture, adresse OSC,
nom de couche, nom de projet, message d'erreur du serveur — se pose par
`textContent` ou `title`, **jamais** par interpolation dans un gabarit
`innerHTML`. Les gabarits doivent rester vides de données.

`tests/interface.test.js` relit le source et échoue si la règle est enfreinte
(garde-fou vérifié en réintroduisant volontairement le motif fautif).

### Tests — `npm test` (262 tests, zéro dépendance)

`tests/helpers.js` lance un **vrai** serveur en sous-processus (ports libres,
config jetable) et écoute l'OSC réellement émis avec un décodeur **indépendant**
de celui du serveur. Fichiers : `api.test.js` (validation, presets, import/export),
`engine.test.js` (STOP silencieux, blackout, patterns, blocs, one-shot, master,
courbes, tempo à chaud), `control.test.js` (OSC entrant, tap, persistance,
paquets hostiles), `madmapper.test.js` (voyant dans les deux sens),
`charge.test.js` (8 couches × 128 barres, 50 requêtes simultanées, presets en
rafale, scéno changée 12 fois, START/STOP martelés), `interface.test.js`
(garde-fous de source : pas d'`innerHTML` avec donnée externe, version cohérente,
sémantiques non négociables toujours présentes, `dist/` synchrone, aucun mutant
resté dans `server.js`), et `ui.test.js` (**32 tests dans un vrai navigateur**).

⚠ **Les 32 tests d'interface peuvent ne pas tourner sans que rien ne rougisse.**
Sans navigateur, `ui.test.js` s'annonce « ignoré » et la suite reste VERTE : on
lit 230 tests au lieu de 262 et personne ne le voit. **Vérifier le compte, pas la
couleur.** `tests/browser.js` cherche dans l'ordre : `CASCADE_NAVIGATEUR` (chemin
imposé), l'installation Playwright (`PLAYWRIGHT_BROWSERS_PATH`), puis les chemins
système. En CI l'absence de navigateur fait désormais échouer le job.
En conteneur, Chromium exige `--no-sandbox` parce qu'on y tourne en root : le
drapeau n'est ajouté que si l'uid vaut 0.

**Endurance mesurée** (4 min, config maximale) : mémoire 64 → 67 Mo avec
récupération visible à 60 Mo (donc pas de fuite), ~6 450 messages OSC/s,
réponse API 10-22 ms, zéro erreur. Script : voir `charge.test.js` pour la
version courte intégrée à la suite.

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
├── server.js               ← moteur + API (source de travail, ~3020 l.)
├── public/index.html       ← interface complète (source de travail, ~3320 l.)
├── build.js                ← génère les exécutables des 4 plateformes
├── tests/                  ← npm test — 262 tests en 17 fichiers, zéro dép.
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

**Serveur Node.js zéro dépendance** (`server.js`, ~3020 lignes) : encodeur/décodeur OSC maison sur UDP, serveur HTTP + API JSON, client TCP Carabiner, moteur à `setInterval(tick, 25)` (~40 fps). L'interface (`public/index.html`, ~3320 lignes, tout-en-un) fait du polling `/api/state` toutes les 120 ms (`pollTimer`).

### État serveur

- `state.projectName` : nom du projet (≤40 car., défaut « Sans titre ») — export/import/quit
- `state.settings` : `mmHost, mmPort (8000), feedbackPort (9000), httpPort (3333), oscInPort (7000), linkEnabled (bool)`
> ⚠ Ce schéma a longtemps décrit la v1 alors que la v2 était livrée. La liste
> qui fait foi est `LAYER_KEYS` dans `server.js` — s'y reporter en cas de doute.

- `state.fixtures[]` : `{ id, name, address, enabled, x, y, rot, len, vert, inverse, p3, dir3 }`
  (x/y normalisés 0–1 ; `p3`/`dir3` = position et vecteur **en mètres**, v2 ;
  `inverse` = barre branchée à l'envers, sert à la *génération de vues*, pas au pilotage)
- `state.layers[]` (max 8, une couche = un séquenceur) :
  `{ id, name, enabled, engine: 'steps'|'wave'|'field', target: 'intensity'|'color',
     bars: null|[ids], groupId, pattern, mode: 'onoff'|'fade', curve, waveform,
     stepMs, speed, width, group, mirrorH, mirrorV, axisX, axisY,
     fadeInPct, fadeOutPct, invert, level, colorA, colorB,
     phase, swing, floor, blocks, oneShot, sparkle,          ← v1.3
     field, axAz, axEl, srcX, srcY, srcZ, ordre3d, duty, course,
     blend, prof, palette, palSrc, spread, deck, lfo }`      ← v2
- `state.global` : `{ running, speed, master, param: 'luminosity', dimmer: 'linear',
  xfade, modGlobal, vueActive, vueIncertaine, presetFade, coupure }` (les 6 derniers = v2)
- `state.vues[]` : dossiers de fixtures MadMapper, une vue = un axe de projection (v2)
- `state.groups[]` : groupes de barres nommés. **Pas** mémorisés dans les presets
  (ils appartiennent à la scéno, pas au look), mais voyagent avec le fichier projet
- `state.presets[16]` : `{ name, layers[], fixtures[] }` — mémorise aussi la disposition.
  ⚠ `/api/state` n'en expose que les **noms** (`presetNames()`), pas le contenu
- `state.midiMap` : `{ 'cc:ch:num' | 'note:ch:num' → cible }`
- `state.settings.acces` : `{ sel, h }` ou `null` — **haché salé** du code d'accès.
  ⚠ Il ne sort JAMAIS du serveur (`sansCode()` le retire de `/api/state` et de
  `/api/settings`) : 4 chiffres se cassent hors ligne instantanément, donc l'envoyer
  reviendrait à envoyer le code. Il est en revanche dans `cascade-config.json`, en
  clair sur le disque — limite assumée, même domaine de confiance que la machine.
- `state.settings.audio*` : `audioGain, audioSeuil, audioAttaque, audioRelache,
  audioBande` — calibration du suiveur audio. Ici et **pas** dans le `localStorage` :
  la régie doit tenir sur une clé USB.
- `L.lfo.src` / `global.modGlobal.src` : `'lfo' | 'audio'` — d'où vient le mouvement
  du modulateur. Liste fermée ; une valeur inconnue retombe sur `'lfo'`, donc toute
  config existante se comporte comme avant.
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
`POST` : `/api/layer {id,set}` · `/api/layers {action:add|remove,id}` · `/api/global {speed,master,param}` · `/api/preset {action:save|recall|clear|rename, slot, name?, fadeMs?}` · `/api/resync {id?}` · `/api/link {enabled}` · `/api/quit` · `/api/project {name}` · `/api/start` · `/api/stop` · `/api/blackout` · `/api/tap {id}` · `/api/fixtures {fixtures}` · `/api/discover` · `/api/layout` · `/api/inspect {index}` · `/api/test {index}` · `/api/midimap {map}` · `/api/settings` · `/api/import` · `/api/new {keepFixtures}`

Ajoutées en **v2** : `/api/scene` (cotes du plateau) · `/api/fixture3d {id,p3,dir3}` · `/api/geometrie` (renvoi de la disposition vers MadMapper) · `/api/groups` · `/api/vues` · `/api/vue` · `/api/vuecheck` (relecture des dossiers) · `/api/coupure` (coupure de secours) · `/api/demo` · `/api/trouverport`

Ajoutées après la 2.0.2 :

- `GET /api/presets-info` → `{ rev, infos[16] }` — **empreintes** des presets, servies
  À LA DEMANDE. Volontairement hors de `/api/state` : cette réponse part 8 fois par
  seconde. L'interface ne rappelle cette route que quand `presetsRev` change.
- `POST /api/acces` — **hors du portillon**, forcément. `{ code }` = entrer ;
  `{ nouveau }` = poser ou retirer (exige d'être déjà autorisé). Le jeton revient
  en cookie `HttpOnly` + `SameSite=Strict`.

⚠ **Trois gardes sur toutes les routes `/api/`** depuis le code d'accès :

1. **Le portillon** — 401 si un code est posé et que la requête vient du réseau sans
   jeton. Exceptions : `/api/ping` (détection d'instance) et `/api/acces`. La PAGE,
   elle, reste servie : sans elle, impossible d'afficher la demande de code.
2. **`Content-Type: application/json` obligatoire sur les POST** (415 sinon). C'est
   une protection CSRF : `localhost` est exempté de code, donc sans ce garde une
   page piégée ouverte sur la machine hôte pourrait poster un formulaire vers
   `/api/new` ou `/api/quit`. Un formulaire ne peut pas poser ce type de contenu.
   ⚠ **`estJson()` compare l'ESSENCE du type, jamais une sous-chaîne.** La première
   version faisait `.includes('application/json')` et se contournait en une ligne :
   `multipart/form-data; boundary=application/json` contient la sous-chaîne, et la
   règle CORS ne regarde que `type/sous-type` en ignorant les paramètres — ce type-là
   est donc safelisté, un `fetch` en `no-cors` le pose sans pré-vol. **Mesuré** :
   `/api/quit` tuait le processus. On coupe au premier `;` avant de comparer.
3. **`hoteAutorise(req)` — parade au DNS rebinding**, tout en haut du routeur (même
   `/api/ping` y passe). Un nom de domaine attaquant qui se met à pointer sur
   `127.0.0.1` contourne le portillon *et* la règle d'origine, parce que le
   navigateur croit être « chez lui ». On n'accepte donc en `Host` que : `localhost`,
   un littéral IPv4 ou IPv6, un `*.local` (Bonjour), ou aucun `Host` du tout
   (HTTP/1.0, `curl --http1.0`). **Conséquence assumée, décidée avec Pym** : on se
   connecte par IP ou par le QR code, pas par un nom de domaine maison.

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

### Icône de zone de notification — Windows uniquement

Réglage `settings.systray`, **`false` par défaut**. `startSystray()` écrit le
gabarit `SYSTRAY_PS1` dans un fichier temporaire (**avec un BOM** — 5.1 lirait
sinon en page de codes ANSI) et lance
`powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File …` ;
le script pose un `System.Windows.Forms.NotifyIcon` et interroge `/api/ping`
pour peindre la pastille (verte = show en cours, rouge = à l'arrêt). Menu :
ouvrir l'interface, démarrer, arrêter, quitter. `killSystray()` est appelé sur
`exit`, `SIGINT` et `SIGTERM`.

⚠ **`/api/ping`, jamais `/api/state` — c'est la contrainte principale.**
`/api/state` remet `lastUiPollAt` à jour : sondé toutes les 1,5 s, l'arrêt
automatique n'a plus jamais ses 8 s de silence et **Cascade ne se ferme plus
tout seul**. Le défaut a existé ; `tests/api.test.js` le mesure maintenant en
vrai (instance à part, `CASCADE_UI_GONE_MS=400`, on regarde si le processus
meurt), et un mutant le rejoue. `/api/ping` ne révèle `running` et `systray`
qu'à la machine hôte : la route est hors du portillon, donc publique.

⚠ **Un seul chemin de sortie côté script (`Partir`), et il commence par
`$ni.Visible = $false`.** `child.kill()` est un `TerminateProcess` : aucun
finaliseur ne tourne, `NIM_DELETE` n'est jamais envoyé, et Windows garde une
pastille morte jusqu'au passage de la souris. D'où `killSystray(true)` sur le
décochage : le script voit `systray: false` sur son sondage et part proprement,
le kill n'arrive que 3 s plus tard, en filet.

⚠ **Trois échecs de sondage avant de partir.** Un pic de charge dépasse les 3 s
d'attente ; partir au premier échec ferait disparaître l'icône *définitivement*
(rien ne la rallume sans relancer Cascade).

⚠ Trois choses à savoir avant d'y toucher :

- **Zéro dépendance tenu** : PowerShell est dans Windows, `NotifyIcon` est dans
  .NET Framework. Rien à installer.
- **Windows seulement — décidé avec Pym.** macOS n'a aucun moyen de poser une
  icône de barre de menus sans logiciel supplémentaire (`rumps`, un `.app`
  Swift, `xbar`…), ce que le zéro-dépendance interdit. La case est grisée sur
  Mac et le dit. **Ne pas « réparer » cette absence.**
- **JAMAIS EXÉCUTÉE.** Le script a été écrit depuis Linux, sans PowerShell pour
  le lancer, et **la CI ne tourne que sur Ubuntu** : aucune ligne de ce dossier
  ne sera jamais couverte par une exécution réelle. `tests/systray.test.js` lit
  le source — c'est mieux que rien, à condition de savoir que c'est tout ce que
  c'est. Le premier essai sur une vraie machine Windows reste à faire, et c'est
  la première chose à confirmer avec Pym. À l'arrêt, l'icône *disparaît* au lieu
  de rougir : le processus qui la dessine est parti avec Cascade.
- **Windows range toute nouvelle icône dans le tiroir caché** (le chevron `^`).
  Sans la note posée dans les Réglages, le premier essai n'aurait rien prouvé :
  le script tourne, l'icône existe, personne ne la voit, et on conclut que c'est
  mort. C'est de loin l'issue la plus probable d'un premier essai.
- ⚠ **`SYSTRAY_PS1` est un littéral de gabarit JavaScript.** Un accent grave
  (l'échappement de PowerShell) ou une séquence `${…}` casserait `server.js` **au
  chargement** — Cascade ne démarrerait plus du tout, pas seulement l'icône. Un
  test le vérifie.
- Non corrigés, et assumés : sur un poste géré par stratégie de groupe,
  `-ExecutionPolicy Bypass` ne prime pas sur `MachinePolicy`/`UserPolicy`, et le
  motif `powershell -ExecutionPolicy Bypass -File %TEMP%\*.ps1` est signalé par
  les EDR. Sur une machine de régie non gérée, ça passe. **Ne pas basculer sur
  `-EncodedCommand` en croyant améliorer les choses : c'est un marqueur encore
  plus signalé.**

## Pièges connus (importants)

1. **Le montage sandbox sert des lectures tronquées** des fichiers édités (plafonnées à leur ancienne taille). `wc -c`, `cat`, `cp`, `node --check` via bash donnent alors des résultats faux. → **Vérifier avec l'outil Read**, et pour tester, reconstruire une copie dans `/tmp` (en v1.2 : travail fait entièrement dans `/tmp/cascade` puis commit via device_commit_files — bonne méthode).
2. **Impossible de compiler un vrai `.exe`/`.app`** dans l'environnement : `pkg`, `@yao-pkg/pkg`, `postject` et `nodejs.org/dist` sont bloqués (403 allowlist). GitHub releases (Carabiner) aussi bloqué **dans le sandbox** — mais téléchargeable sur la machine de l'utilisateur (les lanceurs s'en chargent). D'où : lanceurs `.bat`/`.command` qui téléchargent Node portable + Carabiner, et « mode app » via `--app=` de Chrome/Edge.
3. **macOS + WhatsApp/mail** : le `.command` arrive en quarantaine → « fichier endommagé » / Terminal −128. Fix utilisateur : `xattr -cr <dossier>` puis `chmod +x <.command>`. Documenté dans `LISEZ-MOI.txt` et le manuel. Seule solution définitive : signer + notariser (compte Apple Developer, 99 $/an).
4. **Manuel PDF** : régénéré en v1.2 (Link, mode app, quitter, sauvegarde). Le script est désormais **conservé** : `docs/build-manuel.py` (`python3 build-manuel.py <dossier_sortie>`, reportlab + polices DejaVu). ⚠️ DejaVu n'a **pas** les glyphes ⏻ (U+23FB) ni ⧉ (U+29C9) ni les exposants/indices Unicode — ils rendent des carrés vides : écrire les mots (« bouton Quitter », « ABLETON LINK »). Copier le PDF généré à la racine **et** dans `dist/`.
5. **Playwright dans le sandbox** : `waitUntil: 'networkidle'` ne se déclenche jamais (polling 120 ms) → utiliser `domcontentloaded`. ⚠ Les tests d'interface du dépôt n'utilisent **pas** Playwright : c'est du CDP maison (`tests/browser.js`), pour tenir le zéro-dépendance.
6. **Une suite verte ne prouve pas que tout a tourné.** `ui.test.js` s'annonce « ignoré » sans navigateur, sans faire rougir quoi que ce soit — 32 tests muets. Lire le **compte** (262), pas la couleur. Même famille que le mutant resté dans `server.js` le 28/07 : les deux fois, la suite était verte.
7. **Les fichiers hors dépôt n'existent pas partout.** `../Cascade-AUDIT.md` et `../Cascade-RELECTURES.md` sont absents des clones frais (sessions distantes, CI). Une consigne qui en dépend est inapplicable là-bas : recopier dans le dépôt ce qui doit survivre.

## Historique des décisions

- Miroirs = **modificateurs** appliqués par-dessus n'importe quel pattern (logique MA Lighting), pas des patterns séparés. `outin`/`inout` restent acceptés côté serveur mais ont disparu de l'UI.
- Presets = photo complète (couches **+** ordre des fixtures **+** vue spatiale), pour changer de scéno d'un clic.
- Sauvegarde config atomique (`.tmp` → rename) + `.bak` restauré au démarrage.
- `uncaughtException` / `unhandledRejection` / `tick` try-catch : une erreur ne coupe jamais le show.
- **v1.2** : Link = Carabiner plutôt qu'un addon natif (zéro-dép) ou Electron (trop lourd). BPM Link → toutes les couches (choix de Pym), pas de case par couche. Mode app = `--app` Chrome/Edge plutôt qu'un vrai .exe (impossible à builder ici, et suffisant à l'usage). Charte : sombre conservé (scène), orange du manuel `#f2900f` en accent unique, `--accent2` neutre.

## Pistes non réalisées

**Demandées explicitement par Pym (prioritaires — détail dans `CLAUDE.md`) :**

- **Icône systray** : point vert/rouge = serveur en route/arrêté ; clic droit → ouvrir l'interface / démarrer / arrêter. Objectif : pouvoir fermer la fenêtre en laissant le serveur tourner, tout en le voyant. (⚠ zéro-dep : pas de systray en Node pur — **arbitrage de Pym nécessaire avant d'écrire une ligne** : petit utilitaire par plateforme, PowerShell/AppleScript, ou accepter une dépendance ici.)
- **Capture ou GIF dans le README** (nécessite une vraie session avec MadMapper). La manip est déjà scénarisée — c'est T16, « le dégradé qui voyage », et son mécanisme est mesuré. Il ne reste que le tournage.
- **Suite de l'audit** (`../Cascade-AUDIT.md` (hors dépôt), section « À faire ») : code d'accès facultatif à 4 chiffres, repli « avancé » du panneau Couches, signature/notarisation macOS (compte Apple Developer, 99 $/an → décision + dépense).

**Autres pistes :**

- Horloge MIDI en alternative à Link. ⚠ À arbitrer avant d'écrire : Web MIDI n'existe que sur Chrome/Edge, et Node n'a pas de MIDI natif sans dépendance.
- Séquenceur pas-à-pas dessinable (grille barres × pas).
- Thème clair. ⚠ Va contre une décision de charte déjà prise (sombre retenu pour la scène) → demander à Pym.
- **Détection de tempo audio** — le suiveur audio livré ne donne qu'une ÉNERGIE.
  Décision prise avec Pym le 2026-08-04 : on livre l'énergie, on essaie en salle,
  et on décide ensuite. ⚠ Deux décisions à ne PAS redécouvrir : pas de détection
  de battement pour l'instant (~150 lignes de DSP, justesse dépendante du
  répertoire, erreur d'octave structurelle, invalidable hors salle) ; et **pas de
  HTTPS auto-signé** pour lever la contrainte d'origine sûre du micro (certificat
  à générer, `openssl` absent de Windows par défaut, écran d'avertissement à
  chaque connexion — impossible à demander à un régisseur). La limite « micro
  seulement sur la machine hôte » est assumée et écrite, comme pour Web MIDI.

⚠ **Cette liste a déjà menti trois fois.** Y traînaient, faites : la **synchro de
phase Link** (livrée en 1.6.0), le **`dist/` généré** (`sync-dist.js`, avec un
test qui échoue si la copie diverge), et les **tests d'interface** — réputés « à
faire en Playwright » alors qu'ils existent en CDP maison depuis la 2.0
(`tests/browser.js`, 32 tests). Ce fichier est censé être lu en premier à chaque
reprise : le laisser mentir coûte une demi-journée à celui qui reprend.

⚠ **Purger cette liste fait partie du travail de livraison**, au même titre que
le CHANGELOG.
